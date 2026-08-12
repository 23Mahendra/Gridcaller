/**
 * FreeMeshFabric — capability facade for configured LAN and manual optical links.
 *
 *  Links:
 *   · wifi-open     — open LAN / Wi‑Fi WebSocket + WebRTC host candidates
 *   · bt-open       — discovery/pairing only; no packet GATT protocol exists here
 *   · ir-optical    — optical bridge (QR / camera flash handoff) — free, air-gap OK
 *   · rf-free       — compatibility label only; not a physical transport
 *
 *  Reality check (product honesty):
 *   Browser/PWA cannot open raw 433 MHz / ISM radio without hardware.
 *   No physical range is measured by this module.
 */

import { bus } from "./bus";
import { S } from "./storage";
import omniMesh, { type OmniTransport } from "./omniMeshEngine";
import { getUniversalInfo } from "../lib/universalPlatform";

export type FreeLink =
  | "wifi-open"
  | "bt-open"
  | "ir-optical"
  | "rf-free";

export interface FreeLinkHealth {
  id: FreeLink;
  available: boolean;
  label: string;
  /** Zero until a transport supplies measured physical distance. */
  rangeHintM: number;
  /** After multi-hop density factor */
  effectiveRangeM: number;
  powerCost: number; // 1–10
  tx: number;
  rx: number;
  lastOk: number;
  note: string;
  free: true;
}

export interface FabricPeer {
  id: string;
  name: string;
  links: FreeLink[];
  hops: number;
  lastSeen: number;
  online: boolean;
  platform?: string;
}

export interface FabricStats {
  mode: "free-mesh-fabric";
  noCentralServer: boolean;
  freeSpectrumOnly: boolean;
  links: FreeLinkHealth[];
  bonded: FreeLink[];
  peers: number;
  onlinePeers: number;
  densityFactor: number;
  estimatedRangeM: number;
  estimatedRangeLabel: string;
  platforms: string[];
  interconnect: string;
  uptime: number;
}

const LINK_META: Record<
  FreeLink,
  { label: string; rangeHintM: number; powerCost: number; note: string }
> = {
  "wifi-open": {
    label: "Open Wi‑Fi / LAN",
    rangeHintM: 0,
    powerCost: 4,
    note: "Same Wi‑Fi / LAN mesh node + WebRTC — free local spectrum path",
  },
  "bt-open": {
    label: "Open Bluetooth",
    rangeHintM: 0,
    powerCost: 3,
    note: "Web Bluetooth / BLE when device grants session access",
  },
  "ir-optical": {
    label: "QR / Optical handoff",
    rangeHintM: 0,
    powerCost: 1,
    note: "Payload encoded as QR; peer scans with camera. Not infrared — manual scan required.",
  },
  "rf-free": {
    label: "Software Mesh Fabric",
    rangeHintM: 0,
    powerCost: 2,
    note: "Compatibility label only; no RF packet transport is implemented.",
  },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

class FreeMeshFabric {
  private started = false;
  private startTs = Date.now();
  private health = new Map<FreeLink, FreeLinkHealth>();
  private peers = new Map<string, FabricPeer>();
  private bc: BroadcastChannel | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private opticalInbox: string[] = [];
  private btSupported = false;
  private nodeId = "";
  private nodeName = "";

  constructor() {
    for (const id of Object.keys(LINK_META) as FreeLink[]) {
      const m = LINK_META[id];
      this.health.set(id, {
        id,
        available: false,
        label: m.label,
        rangeHintM: m.rangeHintM,
        effectiveRangeM: m.rangeHintM,
        powerCost: m.powerCost,
        tx: 0,
        rx: 0,
        lastOk: 0,
        note: m.note,
        free: true,
      });
    }
  }

  start(name?: string) {
    if (this.started) return this;
    this.started = true;
    this.startTs = Date.now();
    this.nodeId =
      S.get("omni_node_id") ||
      (() => {
        const id = "fab_" + uid();
        S.set("omni_node_id", id);
        return id;
      })();
    this.nodeName = name || S.get("user_name") || S.get("mesh_name") || "Node";

    // Always start omni software mesh (foundation)
    try {
      omniMesh.start(this.nodeName);
    } catch {}

    this.probeWifiOpen();
    this.probeBluetooth();
    this.probeOptical();
    this.bondRfFree();

    try {
      this.bc = new BroadcastChannel("gridalive-free-fabric");
      this.bc.onmessage = (ev) => this.ingestFabric(ev.data, "wifi-open");
    } catch {}

    // OmniMesh packets → fabric peer table
    try {
      omniMesh.onPacket((pkt) => {
        if (pkt.from && pkt.from !== this.nodeId) {
          this.touchPeer(pkt.from, pkt.fromName || pkt.from, ["rf-free", "wifi-open"], pkt.hops || 1);
          this.bumpRx("rf-free");
          this.bumpRx("wifi-open");
        }
        if (pkt.type === "FABRIC_HELLO" && pkt.payload?.id) {
          this.touchPeer(
            pkt.payload.id,
            pkt.payload.name || pkt.payload.id,
            pkt.payload.links || ["rf-free"],
            pkt.hops || 1,
            pkt.payload.platform
          );
        }
      });
    } catch {}

    this.timers.push(setInterval(() => this.heartbeat(), 5000));
    this.timers.push(setInterval(() => this.probeWifiOpen(), 15000));
    this.timers.push(setInterval(() => this.bondRfFree(), 8000));

    bus.emit("fabric:ready", this.getStats());
    console.info(
      "[FreeMeshFabric] free links ·",
      this.bonded().join("+") || "probing",
      "· verified adapter state"
    );
    return this;
  }

  stop() {
    this.started = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try {
      this.bc?.close();
    } catch {}
  }

  getStats(): FabricStats {
    const online = this.getPeers().filter((p) => p.online);
    const density = Math.max(1, online.length + 1);
    const est = 0;
    const platforms = Array.from(
      new Set(online.map((p) => p.platform || "device").concat([getUniversalInfo().label]))
    );

    // Update effective ranges
    for (const h of this.health.values()) {
      if (h.id === "rf-free") {
        h.effectiveRangeM = 0;
        h.rangeHintM = 0;
      } else {
        h.effectiveRangeM = 0;
      }
    }

    return {
      mode: "free-mesh-fabric",
      noCentralServer: false,
      freeSpectrumOnly: false,
      links: [...this.health.values()],
      bonded: this.bonded(),
      peers: this.peers.size,
      onlinePeers: online.length,
      densityFactor: density,
      estimatedRangeM: est,
      estimatedRangeLabel: this.rangeLabel(est),
      platforms,
      interconnect: "Configured LAN hub; manual QR handoff is separate",
      uptime: Math.floor((Date.now() - this.startTs) / 1000),
    };
  }

  getPeers(): FabricPeer[] {
    const now = Date.now();
    return [...this.peers.values()].map((p) => ({
      ...p,
      online: now - p.lastSeen < 50000,
    }));
  }

  getLinks(): FreeLinkHealth[] {
    return [...this.health.values()];
  }

  /** User-triggered Bluetooth session grant */
  async enableBluetooth(): Promise<boolean> {
    const nav = navigator as any;
    if (!nav.bluetooth?.requestDevice) {
      this.mark("bt-open", false, "Web Bluetooth not available on this shell");
      return false;
    }
    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["battery_service", "generic_access"],
      });
      this.btSupported = true;
      this.mark("bt-open", false, `BT paired: ${device?.name || "device"}; packet GATT protocol unavailable`);
      this.bumpTx("bt-open");
      await this.broadcastHello(["bt-open"]);
      bus.emit("fabric:bt", { name: device?.name, id: device?.id });
      return true;
    } catch (e: any) {
      // User cancel is OK — keep probing passive support
      if (nav.bluetooth) {
        this.mark("bt-open", false, "Bluetooth API present; no packet GATT protocol implemented");
      } else {
        this.mark("bt-open", false, e?.message || "BT denied");
      }
      return false;
    }
  }

  /**
   * Optical / IR-style free bridge:
   * Encode a small payload as QR data URL for screen→camera hop.
   */
  async createOpticalPayload(text: string): Promise<{ token: string; payload: string }> {
    const token = "opt_" + uid();
    const payload = JSON.stringify({
      t: "FABRIC_OPTICAL",
      token,
      from: this.nodeId,
      name: this.nodeName,
      text: String(text).slice(0, 800),
      ts: Date.now(),
    });
    this.opticalInbox.push(token);
    this.mark("ir-optical", true, "Optical payload ready · show QR to peer camera");
    this.bumpTx("ir-optical");
    // Also flood on software mesh so same-room devices with camera get it if scanning UI posts back
    try {
      await omniMesh.send("FABRIC_OPTICAL", JSON.parse(payload), { priority: "data", ttl: 6 });
    } catch {}
    bus.emit("fabric:optical:out", { token, payload });
    return { token, payload };
  }

  /** Peer scanned QR / typed optical token → ingest */
  acceptOpticalPayload(raw: string): boolean {
    try {
      const j = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!j || (j.t !== "FABRIC_OPTICAL" && j.type !== "FABRIC_OPTICAL")) return false;
      this.mark("ir-optical", true, "Optical frame received");
      this.bumpRx("ir-optical");
      this.touchPeer(j.from || "optical", j.name || "Optical peer", ["ir-optical", "rf-free"], 1);
      bus.emit("fabric:optical:in", j);
      // Re-broadcast into free fabric so multi-hop continues
      void omniMesh.send(
        "FABRIC_OPTICAL_FWD",
        { ...j, hopVia: this.nodeId },
        { priority: "data", ttl: 10 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Flood a free-fabric message on all bonded free links */
  async sendFree(type: string, payload: any, opts?: { to?: string }) {
    if (!this.started) this.start();
    const links = this.bonded();
    this.bumpTx("rf-free");
    for (const l of links) {
      if (l !== "rf-free") this.bumpTx(l);
    }
    try {
      this.bc?.postMessage({
        fabric: true,
        type,
        payload,
        from: this.nodeId,
        fromName: this.nodeName,
        to: opts?.to,
        links,
        ts: Date.now(),
      });
    } catch {}
    await omniMesh.send(
      type.startsWith("FABRIC_") ? type : "FABRIC_" + type,
      { ...payload, freeLinks: links },
      { to: opts?.to, priority: "data", ttl: 16 }
    );
  }

  /** Request a bounded replay over currently verified OmniMesh transports. */
  async amplify() {
    await this.broadcastHello(this.bonded());
    try {
      await omniMesh.amplifyRelay();
    } catch {}
    this.bondRfFree();
    bus.emit("fabric:amplify", this.getStats());
  }

  // ── probes ────────────────────────────────────────────────

  private async probeWifiOpen() {
    let ok = false;
    const t0 = performance.now();
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      ok = r.ok;
    } catch {
      try {
        const r = await fetch("http://127.0.0.1:8787/api/health", { cache: "no-store" });
        ok = r.ok;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      this.mark(
        "wifi-open",
        true,
        `LAN mesh node · ${Math.round(performance.now() - t0)}ms`
      );
    } else {
      this.mark("wifi-open", false, "No reachable configured LAN node");
    }
  }

  private probeBluetooth() {
    const nav = navigator as any;
    const uni = getUniversalInfo();
    const nativeBt = uni.caps.bluetooth;
    if (nav.bluetooth || nativeBt) {
      this.btSupported = true;
      this.mark("bt-open", false, nativeBt
        ? "Bluetooth capability present; packet GATT protocol unavailable"
        : "Web Bluetooth API present; packet GATT protocol unavailable");
    } else {
      this.mark("bt-open", false, "No Bluetooth API on this runtime");
    }
  }

  private probeOptical() {
    const cam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    // Optical always software-possible via QR display even without camera (one-way)
    this.mark(
      "ir-optical",
      true,
      cam
        ? "Camera + QR optical bridge ready (free light path)"
        : "QR emit ready · camera optional for receive"
    );
  }

  private bondRfFree() {
    this.mark("rf-free", false, "No RF packet transport is implemented");
    // Sync omni free transports if engine exposes them
    try {
      (omniMesh as any).markFreeLinks?.(this.bonded());
    } catch {}
  }

  private async heartbeat() {
    await this.broadcastHello(this.bonded());
  }

  private async broadcastHello(links: FreeLink[]) {
    const uni = getUniversalInfo();
    const body = {
      id: this.nodeId,
      name: this.nodeName,
      links,
      platform: uni.label,
      free: true,
      ts: Date.now(),
    };
    try {
      this.bc?.postMessage({ fabric: true, type: "FABRIC_HELLO", payload: body, from: this.nodeId });
    } catch {}
    try {
      await omniMesh.send("FABRIC_HELLO", body, { priority: "presence", ttl: 10 });
    } catch {}
  }

  private ingestFabric(raw: any, via: FreeLink) {
    if (!raw || raw.from === this.nodeId) return;
    this.bumpRx(via);
    if (raw.type === "FABRIC_HELLO" && raw.payload?.id) {
      this.touchPeer(
        raw.payload.id,
        raw.payload.name || raw.payload.id,
        raw.payload.links || [via],
        1,
        raw.payload.platform
      );
    }
    bus.emit("fabric:packet", raw);
  }

  private touchPeer(
    id: string,
    name: string,
    links: FreeLink[],
    hops: number,
    platform?: string
  ) {
    if (!id) return;
    // Never register this device as a remote fabric peer
    if (
      id === this.nodeId ||
      id === S.get("omni_node_id", "") ||
      id === S.get("mesh_id", "") ||
      id === S.get("ga_mesh_id", "")
    ) {
      return;
    }

    const prev = this.peers.get(id);
    const set = new Set([...(prev?.links || []), ...links]);
    this.peers.set(id, {
      id,
      name: name && name !== "Node" ? name : prev?.name || name || id.slice(0, 12),
      links: [...set],
      hops,
      lastSeen: Date.now(),
      online: true,
      platform: platform || prev?.platform,
    });
  }

  private mark(id: FreeLink, available: boolean, note?: string) {
    const h = this.health.get(id);
    if (!h) return;
    h.available = available;
    if (note) h.note = note;
    if (available) h.lastOk = Date.now();
  }

  private bumpTx(id: FreeLink) {
    const h = this.health.get(id);
    if (h) h.tx++;
  }

  private bumpRx(id: FreeLink) {
    const h = this.health.get(id);
    if (h) {
      h.rx++;
      h.lastOk = Date.now();
      h.available = true;
    }
  }

  private bonded(): FreeLink[] {
    return (Object.keys(LINK_META) as FreeLink[]).filter((id) => this.health.get(id)?.available);
  }

  private rangeLabel(m: number) {
    void m;
    return "Physical range unmeasured";
  }
}

export const freeMeshFabric = new FreeMeshFabric();
export default freeMeshFabric;

/** Map free links onto OmniMesh transport names when sending */
export function freeLinksToOmni(links: FreeLink[]): OmniTransport[] {
  const out: OmniTransport[] = ["ram-relay"];
  if (links.includes("wifi-open")) {
    out.push("wifi-lan-ws");
  }
  return Array.from(new Set(out));
}
