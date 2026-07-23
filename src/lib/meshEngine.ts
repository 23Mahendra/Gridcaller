/**
 * GridAlive Mesh Engine — software-only multi-hop mesh
 * (no RF hardware / external antennas required)
 *
 * Transports:
 *  1. WebSocket → local mesh node (/mesh-ws) — LAN multi-device bus
 *  2. BroadcastChannel — same-device tabs (instant local hop)
 *  3. Store-and-forward queue + HTTP publish fallback
 *  4. Directed multi-hop routing (TTL + path loop prevention)
 *
 * Inspired by local-first / offline-first principles (original implementation;
 * not a copy of any third-party codebase).
 */

import { v4 as uuidv4 } from "uuid";
import S from "./storage";

export type MeshMsg = {
  id: string;
  type: string;
  data: any;
  from: string;
  fromName?: string;
  /** If set, only the target (or relays toward it) should process as destination */
  to?: string;
  ts: number;
  hops: number;
  ttl: number;
  path?: string[];
};

type MsgHandler = (msg: MeshMsg) => void;

const QUEUE_KEY = "mesh_queue";
const ID_KEY = "mesh_id";
const NAME_KEY = "mesh_name";
const MAX_QUEUE = 300;
const MAX_HOPS = 12;
const SEEN_TTL_MS = 5 * 60 * 1000;
const PEER_ONLINE_MS = 35000;

function loadOrCreateId(): string {
  let id = S.getRaw(ID_KEY, null) as string | null;
  if (!id) {
    id = "node_" + uuidv4().replace(/-/g, "").slice(0, 12);
    S.setRaw(ID_KEY, id);
  }
  return id;
}

/** Prefer GridCaller hub (same as GridAlive mesh-ws protocol) */
function meshWsUrl(): string {
  try {
    const saved = localStorage.getItem("gc_signal_url") || localStorage.getItem("gc_hub_http");
    if (saved) {
      // ws://ip:8765/ws → ws://ip:8765/mesh-ws  |  http://ip:8765 → ws://ip:8765/mesh-ws
      let u = saved.trim();
      if (u.startsWith("http://")) u = "ws://" + u.slice(7);
      if (u.startsWith("https://")) u = "wss://" + u.slice(8);
      u = u.replace(/\/ws\/?$/, "").replace(/\/$/, "");
      if (!u.endsWith("/mesh-ws")) u = u + "/mesh-ws";
      return u;
    }
  } catch {}
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "127.0.0.1";
  const port = window.location.port;
  // GridCaller hub default 8765; GridAlive dev 3001
  if (port === "8765" || port === "3001" || !port) {
    return `${proto}//${host}${port ? `:${port}` : ""}/mesh-ws`.replace(
      /:\/\//,
      "://"
    );
  }
  return `${proto}//${window.location.host}/mesh-ws`;
}

function meshWsUrlFallback(): string {
  try {
    const hub = localStorage.getItem("gc_hub_http");
    if (hub) {
      const u = new URL(hub);
      const p = u.protocol === "https:" ? "wss:" : "ws:";
      return `${p}//${u.host}/mesh-ws`;
    }
  } catch {}
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "127.0.0.1";
  return `${proto}//${host}:8765/mesh-ws`;
}

export type MeshPeerInfo = {
  id: string;
  name: string;
  lastSeen: number;
  hasLlm?: boolean;
  online: boolean;
  hops?: number;
  latencyMs?: number;
};

class MeshEngineImpl {
  localId: string;
  localName: string;
  peers = new Map<
    string,
    { id: string; name: string; lastSeen: number; hasLlm?: boolean; latencyMs?: number; hops?: number }
  >();
  connected = false;
  messagesRouted = 0;
  private handlers = new Set<MsgHandler>();
  private seen = new Map<string, number>();
  private bc: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private useFallbackUrl = false;
  private trafficLog: { id: string; type: string; from: string; to: string; ts: number; hops: number }[] = [];

  constructor() {
    this.localId = loadOrCreateId();
    this.localName = (S.getRaw(NAME_KEY, null) as string) || "Node-" + this.localId.slice(-4);
  }

  setName(name: string) {
    this.localName = name || this.localName;
    S.setRaw(NAME_KEY, this.localName);
    this.broadcast("PEER_ANNOUNCE", { name: this.localName, id: this.localId });
    this._wsSend({ type: "REGISTER", id: this.localId, name: this.localName });
  }

  start() {
    if (this.started) return;
    this.started = true;

    try {
      this.bc = new BroadcastChannel("gridalive-mesh");
      this.bc.onmessage = (ev) => this._ingest(ev.data, "broadcast");
    } catch {
      /* older browsers */
    }

    this._connectWs();

    this.heartbeatTimer = setInterval(() => {
      this._pruneSeen();
      this.broadcast("HEARTBEAT", {
        id: this.localId,
        name: this.localName,
        peers: [...this.peers.keys()].slice(0, 48),
        ts: Date.now(),
        hasLlm: false,
      });
      // Latency probe to known peers
      for (const p of this.getPeerList().filter((x) => x.online).slice(0, 8)) {
        this.sendTo(p.id, "MESH_PING", { t0: Date.now() }, 4);
      }
      this._httpRegister();
    }, 6000);

    setTimeout(() => {
      this.broadcast("PEER_ANNOUNCE", { id: this.localId, name: this.localName });
    }, 400);

    console.log(`[Mesh] started as ${this.localId} (software multi-hop)`);
  }

  stop() {
    this.started = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.bc?.close();
    } catch {}
    this.bc = null;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.peers.clear();
    this.connected = false;
  }

  onMessage(handler: MsgHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Flood broadcast to all mesh peers */
  broadcast(type: string, data: any = {}, ttl = MAX_HOPS) {
    const msg: MeshMsg = {
      id: uuidv4(),
      type,
      data,
      from: this.localId,
      fromName: this.localName,
      ts: Date.now(),
      hops: 0,
      ttl,
      path: [this.localId],
    };
    this._logTraffic(msg, "broadcast");
    this._send(msg);
    this._queue(msg);
    this._notify(msg);
    return msg.id;
  }

  /**
   * Directed multi-hop send — software mesh hopping.
   * Message is relayed by intermediate nodes until `to` receives it or TTL expires.
   */
  sendTo(peerId: string, type: string, data: any = {}, ttl = MAX_HOPS) {
    if (!peerId) return null;
    const msg: MeshMsg = {
      id: uuidv4(),
      type,
      data,
      from: this.localId,
      fromName: this.localName,
      to: peerId,
      ts: Date.now(),
      hops: 0,
      ttl,
      path: [this.localId],
    };
    this._logTraffic(msg, "direct");
    this._send(msg);
    this._queue(msg);
    // Local loopback (same tab testing)
    if (peerId === this.localId) this._notify(msg);
    return msg.id;
  }

  connectTo(peerId: string) {
    if (!peerId || peerId === this.localId) return;
    this.sendTo(peerId, "PEER_PING", { target: peerId, from: this.localId }, 6);
    this.broadcast("PEER_ANNOUNCE", { id: this.localId, name: this.localName });
  }

  getPeerList(): MeshPeerInfo[] {
    const now = Date.now();
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      lastSeen: p.lastSeen,
      online: now - p.lastSeen < PEER_ONLINE_MS,
      hasLlm: !!p.hasLlm,
      hops: p.hops ?? 1,
      latencyMs: p.latencyMs,
    }));
  }

  getTraffic(limit = 40) {
    return this.trafficLog.slice(0, limit);
  }

  getStatus() {
    const peers = this.getPeerList();
    return {
      localId: this.localId,
      localName: this.localName,
      connected: this.connected,
      peerCount: peers.length,
      onlinePeers: peers.filter((p) => p.online).length,
      messagesRouted: this.messagesRouted,
      transports: {
        broadcastChannel: !!this.bc,
        websocket: !!this.ws && this.ws.readyState === WebSocket.OPEN,
        multiHop: true,
        hardwareRf: false, // software-only by design
      },
    };
  }

  // ── internals ──────────────────────────────────────

  private _connectWs() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const url = this.useFallbackUrl ? meshWsUrlFallback() : meshWsUrl();
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        console.log("[Mesh] WebSocket open", url);
        this._wsSend({ type: "HELLO", id: this.localId, name: this.localName });
        this._flushQueueWs();
        this._httpRegister();
      };

      ws.onmessage = (ev) => {
        try {
          const raw = JSON.parse(String(ev.data));
          if (raw.type === "WELCOME" && Array.isArray(raw.data?.peers)) {
            for (const p of raw.data.peers) {
              this.peers.set(p.id, {
                id: p.id,
                name: p.name || p.id,
                lastSeen: Date.now(),
                hasLlm: !!p.hasLlm,
                hops: 1,
              });
            }
            return;
          }
          this._ingest(raw, "websocket");
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        this.useFallbackUrl = !this.useFallbackUrl;
        this._scheduleReconnect();
      };
    } catch (e) {
      console.warn("[Mesh] WS connect failed", e);
      this.useFallbackUrl = !this.useFallbackUrl;
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect() {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.started) this._connectWs();
    }, 2000);
  }

  private _wsSend(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch {}
    }
    return false;
  }

  private async _httpRegister() {
    const body = JSON.stringify({ id: this.localId, name: this.localName });
    for (const url of ["/api/mesh/register", "http://127.0.0.1:8787/api/mesh/register"]) {
      try {
        await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        return;
      } catch {}
    }
  }

  private async _httpPublish(msg: MeshMsg) {
    const body = JSON.stringify(msg);
    for (const url of ["/api/mesh/publish", "http://127.0.0.1:8787/api/mesh/publish"]) {
      try {
        await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        return;
      } catch {}
    }
  }

  private _send(msg: MeshMsg) {
    try {
      this.bc?.postMessage(msg);
    } catch {}
    if (!this._wsSend(msg)) void this._httpPublish(msg);
  }

  private _relay(msg: MeshMsg) {
    if ((msg.hops ?? 0) >= (msg.ttl ?? MAX_HOPS)) return;
    if ((msg.path || []).includes(this.localId)) return;
    const relay: MeshMsg = {
      ...msg,
      hops: (msg.hops || 0) + 1,
      path: [...(msg.path || []), this.localId],
    };
    this.messagesRouted++;
    this._logTraffic(relay, "relay");
    // Don't re-queue forever — only forward once
    try {
      this.bc?.postMessage(relay);
    } catch {}
    this._wsSend(relay);
  }

  private _ingest(raw: any, _via: string) {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as MeshMsg;
    if (!msg.type) return;
    if (msg.from === this.localId) return;
    if (msg.id && this.seen.has(msg.id)) return;
    if (msg.id) this.seen.set(msg.id, Date.now());

    // Track peer
    if (msg.from) {
      const existing = this.peers.get(msg.from);
      const name = msg.data?.name || msg.fromName || existing?.name || msg.from.slice(0, 12);
      this.peers.set(msg.from, {
        id: msg.from,
        name,
        lastSeen: Date.now(),
        hasLlm: msg.type === "LLM_ANNOUNCE" || existing?.hasLlm || !!msg.data?.hasLlm,
        hops: msg.hops ?? existing?.hops ?? 1,
        latencyMs: existing?.latencyMs,
      });
    }

    if (msg.type === "PEER_LEAVE" && msg.data?.id) {
      this.peers.delete(msg.data.id);
      this._notify(msg);
      return;
    }

    // Latency response
    if (msg.type === "MESH_PING" && msg.to === this.localId) {
      this.sendTo(msg.from, "MESH_PONG", { t0: msg.data?.t0, t1: Date.now() }, 6);
    }
    if (msg.type === "MESH_PONG" && msg.to === this.localId && msg.data?.t0) {
      const latency = Date.now() - Number(msg.data.t0);
      const p = this.peers.get(msg.from);
      if (p) {
        p.latencyMs = latency;
        p.hops = msg.hops ?? 1;
        p.lastSeen = Date.now();
      }
    }

    // Gossip peer discovery
    if (msg.type === "HEARTBEAT" && Array.isArray(msg.data?.peers)) {
      for (const pid of msg.data.peers) {
        if (pid !== this.localId && !this.peers.has(pid)) {
          this.peers.set(pid, {
            id: pid,
            name: String(pid).slice(0, 12),
            lastSeen: Date.now() - 1000,
            hops: (msg.hops || 0) + 1,
          });
        }
      }
    }

    // Directed message: deliver or hop
    if (msg.to && msg.to !== this.localId) {
      this._relay(msg);
      // Still allow intermediate nodes to observe call signaling? No — privacy: only destination
      return;
    }

    this._notify(msg);

    // Flood messages also get rebroadcast once for multi-hop coverage
    // (only for high-priority types, avoid storms)
    const floodTypes = new Set([
      "SOS",
      "sos",
      "RADIO_MSG",
      "radio_msg",
      "FEED_POST",
      "PEER_ANNOUNCE",
      "LLM_REQUEST",
      "LLM_RESPONSE",
      "MESH_DM_BROADCAST",
    ]);
    if (!msg.to && floodTypes.has(msg.type) && (msg.hops || 0) < (msg.ttl || MAX_HOPS)) {
      this._relay(msg);
    }
  }

  private _notify(msg: MeshMsg) {
    for (const h of this.handlers) {
      try {
        h(msg);
      } catch (e) {
        console.warn("[Mesh] handler error", e);
      }
    }
  }

  private _queue(msg: MeshMsg) {
    try {
      const q: MeshMsg[] = S.getRaw(QUEUE_KEY, []) || [];
      q.push(msg);
      while (q.length > MAX_QUEUE) q.shift();
      S.setRaw(QUEUE_KEY, q);
    } catch {}
  }

  private _flushQueueWs() {
    try {
      const q: MeshMsg[] = S.getRaw(QUEUE_KEY, []) || [];
      for (const m of q.slice(-30)) this._wsSend(m);
    } catch {}
  }

  private _pruneSeen() {
    const now = Date.now();
    for (const [id, ts] of this.seen) {
      if (now - ts > SEEN_TTL_MS) this.seen.delete(id);
    }
  }

  private _logTraffic(msg: MeshMsg, kind: string) {
    this.trafficLog.unshift({
      id: msg.id,
      type: kind + ":" + msg.type,
      from: msg.fromName || msg.from,
      to: msg.to || "*",
      ts: msg.ts || Date.now(),
      hops: msg.hops || 0,
    });
    if (this.trafficLog.length > 100) this.trafficLog.length = 100;
  }
}

export const MeshEngine = new MeshEngineImpl();
export default MeshEngine;
