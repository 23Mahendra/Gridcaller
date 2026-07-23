/**
 * Mesh App Bridge — route device app traffic over mesh + internet path
 *
 * Goals:
 *  · GridCaller + Mesh Comms share one sync bus
 *  · Apps can publish/subscribe via mesh (Gun / OmniMesh / MeshEngine WS)
 *  · Internet-capable peers act as gateways for offline mesh nodes (best-effort)
 *
 * Not a full VPN: browser sandbox cannot tunnel raw TCP for every OS app.
 * We provide: message bus, HTTP proxy hop via mesh node, app session registry.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import meshComms from "./meshCommsEngine";
import omniMesh from "./omniMeshEngine";

export type MeshAppSession = {
  appId: string;
  name: string;
  online: boolean;
  lastSeen: number;
  via: "local" | "mesh" | "internet-gateway";
};

const KEYS = {
  apps: "mesh_app_sessions",
  gateway: "mesh_internet_gateway",
};

class MeshAppBridge {
  private started = false;
  private unsub: (() => void) | null = null;

  start(userName?: string) {
    if (this.started) return this.getStatus();
    this.started = true;
    try {
      meshComms.init(undefined, userName || S.get("user_name") || "User");
      meshComms.startPresence?.(userName || S.get("user_name") || "User", "user");
      meshComms.startNetworkMonitor?.();
    } catch {}
    try {
      omniMesh.start(userName);
    } catch {}
    try {
      (MeshEngine as any).ensureWs?.();
      MeshEngine.start?.();
    } catch {}

    // Join shared channels used by GridCaller + Mesh Comms
    try {
      meshComms.joinWalkieChannel?.("gridcaller_sms", (msg: any) => {
        bus.emit("meshApp:sms", msg);
      });
      meshComms.joinWalkieChannel?.("mesh_comms_global", (msg: any) => {
        bus.emit("meshApp:radio", msg);
      });
      meshComms.joinWalkieChannel?.("mesh_app_bridge", (msg: any) => {
        bus.emit("meshApp:packet", msg);
      });
    } catch {}

    // Advertise this node as internet gateway when online
    this.publishGateway();
    const iv = setInterval(() => this.publishGateway(), 15000);
    this.unsub = () => clearInterval(iv);

    bus.emit("meshApp:ready", this.getStatus());
    console.info("[MeshAppBridge] synced · GridCaller + Mesh Comms + app gateway");
    return this.getStatus();
  }

  stop() {
    this.started = false;
    this.unsub?.();
    this.unsub = null;
  }

  private publishGateway() {
    const online = typeof navigator !== "undefined" ? navigator.onLine : false;
    const payload = {
      nodeId: MeshEngine.localId || S.get("omni_node_id"),
      name: S.get("user_name") || "Node",
      internet: online,
      ts: Date.now(),
      gateway: online,
    };
    S.set(KEYS.gateway, payload);
    try {
      MeshEngine.broadcast("MESH_INTERNET_GATEWAY", payload);
    } catch {}
    try {
      meshComms.sendWalkieTextMessage?.(
        "mesh_app_bridge",
        JSON.stringify({ type: "gateway", ...payload }),
        payload.name
      );
    } catch {}
  }

  /** Register a logical app running over mesh (browser/PWA/Electron tools) */
  registerApp(appId: string, name: string) {
    const apps = (S.get(KEYS.apps, {}) as Record<string, MeshAppSession>) || {};
    apps[appId] = {
      appId,
      name,
      online: true,
      lastSeen: Date.now(),
      via: navigator.onLine ? "internet-gateway" : "mesh",
    };
    S.set(KEYS.apps, apps);
    try {
      MeshEngine.broadcast("MESH_APP_REGISTER", apps[appId]);
    } catch {}
    bus.emit("meshApp:register", apps[appId]);
    return apps[appId];
  }

  listApps(): MeshAppSession[] {
    const apps = (S.get(KEYS.apps, {}) as Record<string, MeshAppSession>) || {};
    return Object.values(apps).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Send a cross-app message over all mesh transports
   * (used by GridCaller SMS + Mesh Comms text)
   */
  sendMessage(channel: string, text: string, meta?: { to?: string; fromName?: string; id?: string }) {
    const id = meta?.id || `mab_${Date.now().toString(36)}`;
    const fromName = meta?.fromName || S.get("user_name") || "User";
    const packet = {
      id,
      channel,
      text,
      to: meta?.to,
      fromName,
      from: MeshEngine.localId,
      ts: Date.now(),
    };

    try {
      meshComms.joinWalkieChannel?.(channel, () => {});
      meshComms.sendWalkieTextMessage?.(channel, text, fromName);
    } catch {}
    try {
      omniMesh.sendSms?.(meta?.to || "broadcast", text, fromName);
    } catch {}
    try {
      MeshEngine.broadcast("MESH_APP_MSG", packet);
    } catch {}
    try {
      void omniMesh.send?.("MESH_APP_MSG", packet, { priority: "data", ttl: 12 });
    } catch {}

    bus.emit("meshApp:out", packet);
    return packet;
  }

  /**
   * Best-effort fetch via local mesh node proxy when available
   * (apps use this instead of raw internet when offline mesh has a gateway)
   */
  async fetchViaMesh(url: string, init?: RequestInit): Promise<Response> {
    // Prefer same-origin mesh node proxy
    try {
      const proxied = `/api/browser-proxy?url=${encodeURIComponent(url)}`;
      const r = await fetch(proxied, init);
      if (r.ok) return r;
    } catch {}
    // Direct fallback when this device has internet
    if (navigator.onLine) {
      return fetch(url, init);
    }
    throw new Error("No mesh gateway / internet path for this request");
  }

  getStatus() {
    const gw = S.get(KEYS.gateway, null) as any;
    let peers = 0;
    try {
      peers = (meshComms.getPeers?.() || meshComms.nearbyPeers || []).filter((p: any) => p.online).length;
    } catch {}
    return {
      started: this.started,
      online: typeof navigator !== "undefined" ? navigator.onLine : false,
      meshPeers: peers,
      gateway: gw,
      apps: this.listApps().length,
      note:
        "Browser mesh carries GridAlive apps + messages + calls. Native OS apps need Electron shell or mesh-node proxy for full internet hop.",
    };
  }
}

export const meshAppBridge = new MeshAppBridge();
export default meshAppBridge;
