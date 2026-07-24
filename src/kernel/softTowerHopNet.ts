/**
 * Soft Tower Hop Network — every GridCaller is a software cell tower
 *
 * Goal: strong hopping fabric so call + msg reach far via peer density,
 * without SIM / carrier / paid RF hardware.
 *
 * Transports (software-only permutations, no hardware dependency):
 *  1) wifi-lan     — mesh-ws + /api/mesh/publish (hotspot / same Wi‑Fi)
 *  2) bc-tab       — BroadcastChannel (tabs / same origin shell)
 *  3) fabric-bc    — freeMeshFabric channel
 *  4) bt-web       — Web Bluetooth session when user grants (optional edge)
 *  5) optical      — QR payload handoff (air-gap hop)
 *
 * Routing: TTL + path loop prevention + multi-path flood (permutations).
 * Each device rebroadcasts → range grows with more GridCallers nearby.
 *
 * Honesty: we cannot open raw cellular spectrum in a browser. We turn
 * every nearby *app-running* device into a hop — soft cellular network.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import freeMeshFabric from "./freeMeshFabric";
import { setForceLocalMesh } from "./offlineMode";
import { MeshRoutingTable } from "./meshRoutingTable";

export type HopTransport = "wifi-lan" | "bc-tab" | "fabric-bc" | "bt-web" | "optical";

export type HopPacket = {
  id: string;
  kind: "hello" | "msg" | "call-signal" | "ack" | "tower-beacon";
  from: string;
  fromName: string;
  to?: string; // empty = flood / beacon
  hops: number;
  ttl: number;
  path: string[];
  transportsTried: HopTransport[];
  ts: number;
  /** encrypted optional later */
  payload: any;
};

export type SoftTowerPeer = {
  id: string;
  name: string;
  hops: number;
  lastSeen: number;
  links: HopTransport[];
  phone?: string;
  isTower: true;
};

const MAX_TTL = 16;
const SEEN_MAX = 800;
const BEACON_MS = 2500;

type Listener = (pkt: HopPacket) => void;

function rid(p = "hop") {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class SoftTowerHopNet {
  private started = false;
  private nodeId = "";
  private nodeName = "Tower";
  private peers = new Map<string, SoftTowerPeer>();
  private seen = new Map<string, number>();
  private listeners = new Set<Listener>();
  private msgListeners = new Set<(m: { from: string; fromName: string; text: string; id: string; hops: number }) => void>();
  private callListeners = new Set<(sig: any) => void>();
  private bc: BroadcastChannel | null = null;
  private fabricBc: BroadcastChannel | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private stats = { tx: 0, rx: 0, relayed: 0, delivered: 0 };
  private routingTable = new MeshRoutingTable();

  get id() {
    return this.nodeId;
  }

  get ready() {
    return this.started;
  }

  start(name?: string) {
    if (this.started) {
      this.nodeName = name || this.nodeName;
      this.beacon();
      return this;
    }
    this.started = true;
    setForceLocalMesh(true);

    this.nodeId =
      S.get("mesh_id") ||
      S.get("omni_node_id") ||
      MeshEngine.localId ||
      (() => {
        const id = "tower_" + rid().slice(-8);
        S.set("mesh_id", id);
        return id;
      })();
    this.nodeName = name || S.get("user_name") || S.get("mesh_name") || "SoftTower";
    this.routingTable.setLocalId(this.nodeId);

    try {
      freeMeshFabric.start(this.nodeName);
    } catch {}

    try {
      MeshEngine.start?.();
    } catch {}

    try {
      this.bc = new BroadcastChannel("gridcaller-soft-tower");
      this.bc.onmessage = (ev) => this.ingest(ev.data, "bc-tab");
    } catch {}

    try {
      this.fabricBc = new BroadcastChannel("gridalive-free-fabric");
      this.fabricBc.onmessage = (ev) => {
        const d = ev.data;
        if (d?.type === "SOFT_TOWER_HOP" || d?.kind) this.ingest(d.type === "SOFT_TOWER_HOP" ? d.data || d : d, "fabric-bc");
      };
    } catch {}

    MeshEngine.onMessage((msg: any) => {
      if (msg?.type === "SOFT_TOWER_HOP" && msg.data) {
        this.ingest(msg.data, "wifi-lan");
      }
    });

    this.beaconTimer = setInterval(() => {
      this.pruneSeen();
      this.beacon();
      this.handshakeSweep();
    }, BEACON_MS);

    this.beacon();
    bus.emit("softTowerHop:ready", { id: this.nodeId, name: this.nodeName });
    console.info("[SoftTowerHop] node online as soft cell tower ·", this.nodeId);
    return this;
  }

  stop() {
    this.started = false;
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    try {
      this.bc?.close();
    } catch {}
    try {
      this.fabricBc?.close();
    } catch {}
  }

  onPacket(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onHopMessage(fn: (m: { from: string; fromName: string; text: string; id: string; hops: number }) => void) {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }

  onHopCallSignal(fn: (sig: any) => void) {
    this.callListeners.add(fn);
    return () => this.callListeners.delete(fn);
  }

  getPeers(): SoftTowerPeer[] {
    const now = Date.now();
    return [...this.peers.values()]
      .map((p) => ({ ...p, online: now - p.lastSeen < 45000 } as any))
      .filter((p: any) => p.online)
      .sort((a: any, b: any) => a.hops - b.hops);
  }

  getNetworkHealth() {
    const peers = this.getPeers();
    const density = peers.length + 1;
    // Permutation factor: more links × more peers → estimated hop range
    let linkScore = 1;
    try {
      const st = freeMeshFabric.getStats();
      linkScore = Math.max(1, st.bonded.length);
    } catch {}
    const estHops = Math.min(MAX_TTL, Math.ceil(Math.log2(density + 1) * 2 + linkScore));
    const estRangeM = Math.round(50 * density * Math.log2(density + 1) * (1 + linkScore * 0.25));
    return {
      softTowers: density,
      neighbors: peers.length,
      avgHops: peers.length ? peers.reduce((s, p) => s + p.hops, 0) / peers.length : 0,
      maxObservedHops: peers.reduce((m, p) => Math.max(m, p.hops), 0),
      estimatedUsefulHops: estHops,
      estimatedRangeM: estRangeM,
      estimatedRangeLabel:
        estRangeM < 100
          ? `~${estRangeM}m (room/street)`
          : estRangeM < 1000
            ? `~${(estRangeM / 1000).toFixed(1)}km multi-hop`
            : `~${(estRangeM / 1000).toFixed(1)}km dense fabric`,
      tx: this.stats.tx,
      rx: this.stats.rx,
      relayed: this.stats.relayed,
      delivered: this.stats.delivered,
      transports: this.availableTransports(),
      doctrine: "Every GridCaller = soft tower · relay calls/texts until clear · no SIM",
    };
  }

  private availableTransports(): HopTransport[] {
    const t: HopTransport[] = ["bc-tab", "wifi-lan", "fabric-bc"];
    try {
      if ((navigator as any).bluetooth) t.push("bt-web");
    } catch {}
    t.push("optical");
    return t;
  }

  /** Handshake HELLO — announce as soft tower with capabilities */
  private beacon() {
    const pkt: HopPacket = {
      id: rid("bcn"),
      kind: "tower-beacon",
      from: this.nodeId,
      fromName: this.nodeName,
      hops: 0,
      ttl: 6,
      path: [this.nodeId],
      transportsTried: [],
      ts: Date.now(),
      payload: {
        isTower: true,
        phone: S.get("user_phone", "") || undefined,
        links: this.availableTransports(),
        meshId: MeshEngine.localId,
      },
    };
    this.flood(pkt);
  }

  /** Proactive handshake to known peers (permutations of paths) */
  private handshakeSweep() {
    for (const p of this.getPeers().slice(0, 12)) {
      const pkt: HopPacket = {
        id: rid("hs"),
        kind: "hello",
        from: this.nodeId,
        fromName: this.nodeName,
        to: p.id,
        hops: 0,
        ttl: 8,
        path: [this.nodeId],
        transportsTried: [],
        ts: Date.now(),
        payload: { handshake: true, want: "relay" },
      };
      this.flood(pkt);
    }
  }

  /** Multi-hop text message (GridCaller SMS over soft towers) */
  sendMessage(to: string, text: string, toName?: string) {
    if (!to || !text.trim()) return null;
    const id = rid("msg");
    const pkt: HopPacket = {
      id,
      kind: "msg",
      from: this.nodeId,
      fromName: this.nodeName,
      to,
      hops: 0,
      ttl: MAX_TTL,
      path: [this.nodeId],
      transportsTried: [],
      ts: Date.now(),
      payload: { text: text.trim(), toName, phone: S.get("user_phone", "") },
    };
    this.flood(pkt);
    // local echo for UI
    bus.emit("softTowerHop:msg-sent", { id, to, text: text.trim() });
    return id;
  }

  /** Multi-hop call signaling (invite/sdp/ice/end) */
  sendCallSignal(to: string, signal: any) {
    if (!to) return null;
    const id = rid("call");
    const pkt: HopPacket = {
      id,
      kind: "call-signal",
      from: this.nodeId,
      fromName: this.nodeName,
      to,
      hops: 0,
      ttl: MAX_TTL,
      path: [this.nodeId],
      transportsTried: [],
      ts: Date.now(),
      payload: signal,
    };
    this.flood(pkt);
    return id;
  }

  /** Flood with all transport permutations (software multi-path) */
  private flood(pkt: HopPacket) {
    this.stats.tx++;
    this.markSeen(pkt.id);
    const order = this.permutationTransports();
    for (const t of order) {
      this.sendOn(t, pkt);
    }
  }

  /** Shuffle transport order each send — load-balance + resilience */
  private permutationTransports(): HopTransport[] {
    const base = this.availableTransports().filter((t) => t !== "optical"); // optical is manual
    // Fisher-Yates light shuffle for combinations
    for (let i = base.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [base[i], base[j]] = [base[j], base[i]];
    }
    return base;
  }

  private sendOn(t: HopTransport, pkt: HopPacket) {
    const wire = { ...pkt, transportsTried: [...(pkt.transportsTried || []), t] };
    try {
      if (t === "bc-tab" && this.bc) {
        this.bc.postMessage(wire);
      }
      if (t === "fabric-bc" && this.fabricBc) {
        this.fabricBc.postMessage({ type: "SOFT_TOWER_HOP", data: wire });
      }
      if (t === "wifi-lan") {
        MeshEngine.broadcast("SOFT_TOWER_HOP", wire);
      }
      // bt-web: capability beacon only via freeMeshFabric stats — full BLE mesh needs native shell
    } catch {}
  }

  private ingest(raw: any, via: HopTransport) {
    if (!raw || typeof raw !== "object") return;
    const pkt = raw as HopPacket;
    if (!pkt.id || !pkt.kind || !pkt.from) return;
    if (pkt.from === this.nodeId) return;
    if (pkt.from === MeshEngine.localId) return;
    if (pkt.from === S.get("mesh_id", "")) return;
    if (pkt.from === S.get("omni_node_id", "")) return;
    if (this.seen.has(pkt.id)) return;
    this.markSeen(pkt.id);
    this.stats.rx++;

    // Learn tower peer
    this.touchPeer(pkt.from, pkt.fromName || pkt.from, pkt.hops || 1, via, pkt.payload);
    this.learnRoute(pkt);

    // Deliver if for us or flood beacon
    const forUs = !pkt.to || pkt.to === this.nodeId || pkt.to === MeshEngine.localId;
    if (forUs) {
      this.stats.delivered++;
      this.deliver(pkt);
    }

    // Relay hop (soft tower behavior)
    if ((pkt.hops || 0) + 1 < (pkt.ttl || MAX_TTL) && !(pkt.path || []).includes(this.nodeId)) {
      // Don't relay if unicast and we delivered to self only? Still relay flood for density
      const shouldRelay = !pkt.to || !forUs || pkt.kind === "tower-beacon" || pkt.kind === "hello";
      // Always relay unicast until delivered widely — store-and-forward style
      if (shouldRelay || (pkt.to && !forUs) || (pkt.to && forUs)) {
        if (pkt.to && forUs && (pkt.kind === "msg" || pkt.kind === "call-signal")) {
          // delivered — still optional rebroadcast for redundant paths? skip msg rebroadcast to reduce storm
        } else {
          this.relay(pkt, via);
        }
        if (pkt.to && !forUs) this.relay(pkt, via);
      }
    }

    for (const fn of this.listeners) {
      try {
        fn(pkt);
      } catch {}
    }
  }

  private relay(pkt: HopPacket, via: HopTransport) {
    if ((pkt.path || []).includes(this.nodeId)) return;
    if ((pkt.hops || 0) + 1 >= (pkt.ttl || MAX_TTL)) return;
    this.stats.relayed++;
    const next: HopPacket = {
      ...pkt,
      hops: (pkt.hops || 0) + 1,
      path: [...(pkt.path || []), this.nodeId],
      transportsTried: [],
    };
    // Prefer transports other than the one we received on (path diversity)
    const order = this.permutationTransports().filter((t) => t !== via);
    const list = order.length ? order : this.permutationTransports();
    for (const t of list) this.sendOn(t, next);
  }

  private learnRoute(pkt: HopPacket) {
    if (!pkt?.from || pkt.from === this.nodeId) return;
    const targetId = pkt.to || pkt.from;
    const nextHop = pkt.path?.[pkt.path.length - 2] || pkt.from;
    const quality = Math.max(0.1, Math.min(1, 1 - (pkt.hops || 0) * 0.08));
    const cost = Math.max(1, (pkt.hops || 0) + 2);
    const route = this.routingTable.observeRoute(targetId, nextHop, {
      via: pkt.kind === "tower-beacon" ? "beacon" : "relay",
      quality,
      cost,
      hops: (pkt.hops || 0) + 1,
      path: pkt.path || [pkt.from, targetId],
      lastSeen: Date.now(),
      gateway: Boolean(pkt.payload?.gateway || pkt.payload?.isTower),
    });
    if (route && pkt.to) {
      this.routingTable.observeDirectLink(pkt.from, {
        via: "direct",
        quality: Math.max(0.6, route.quality),
        cost: Math.max(1, route.cost - 1),
        hops: Math.max(1, route.hops - 1),
        path: [pkt.from],
        lastSeen: Date.now(),
      });
    }
  }

  private deliver(pkt: HopPacket) {
    if (pkt.kind === "tower-beacon" || pkt.kind === "hello") {
      bus.emit("softTowerHop:peer", { from: pkt.from, name: pkt.fromName, hops: pkt.hops });
      return;
    }
    if (pkt.kind === "msg" && pkt.payload?.text) {
      const m = {
        from: pkt.from,
        fromName: pkt.fromName,
        text: String(pkt.payload.text),
        id: pkt.id,
        hops: pkt.hops || 0,
      };
      for (const fn of this.msgListeners) {
        try {
          fn(m);
        } catch {}
      }
      bus.emit("softTowerHop:msg", m);
      // also bridge to GridCaller SMS bus
      bus.emit("meshApp:sms", {
        id: pkt.id,
        peerId: pkt.from,
        user: pkt.fromName,
        text: m.text,
        message: m.text,
        timestamp: pkt.ts,
        hops: pkt.hops,
      });
      return;
    }
    if (pkt.kind === "call-signal") {
      for (const fn of this.callListeners) {
        try {
          fn({ ...pkt.payload, from: pkt.from, fromName: pkt.fromName, hops: pkt.hops });
        } catch {}
      }
      bus.emit("softTowerHop:call", { from: pkt.from, fromName: pkt.fromName, ...pkt.payload });
    }
  }

  private touchPeer(id: string, name: string, hops: number, via: HopTransport, payload?: any) {
    const prev = this.peers.get(id);
    const links = new Set(prev?.links || []);
    links.add(via);
    if (Array.isArray(payload?.links)) {
      for (const L of payload.links) links.add(L);
    }
    this.peers.set(id, {
      id,
      name: name || prev?.name || id.slice(0, 10),
      hops: prev ? Math.min(prev.hops, hops || 1) : hops || 1,
      lastSeen: Date.now(),
      links: [...links],
      phone: payload?.phone || prev?.phone,
      isTower: true,
    });
  }

  private markSeen(id: string) {
    this.seen.set(id, Date.now());
  }

  private pruneSeen() {
    const now = Date.now();
    for (const [id, ts] of this.seen) {
      if (now - ts > 120000) this.seen.delete(id);
    }
    if (this.seen.size > SEEN_MAX) {
      const entries = [...this.seen.entries()].sort((a, b) => a[1] - b[1]);
      for (const [id] of entries.slice(0, entries.length - SEEN_MAX / 2)) this.seen.delete(id);
    }
    // prune dead peers
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > 90000) this.peers.delete(id);
    }
  }

  /** Optical hop: export packet as QR-friendly JSON string */
  exportOpticalPayload(text: string, to?: string): string {
    const pkt: HopPacket = {
      id: rid("opt"),
      kind: "msg",
      from: this.nodeId,
      fromName: this.nodeName,
      to,
      hops: 0,
      ttl: 4,
      path: [this.nodeId],
      transportsTried: ["optical"],
      ts: Date.now(),
      payload: { text },
    };
    return JSON.stringify({ type: "SOFT_TOWER_HOP", data: pkt });
  }

  importOpticalPayload(raw: string) {
    try {
      const j = JSON.parse(raw);
      const data = j.data || j;
      this.ingest(data, "optical");
      return true;
    } catch {
      return false;
    }
  }
}

export const softTowerHop = new SoftTowerHopNet();
export default softTowerHop;
