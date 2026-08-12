/**
 * ═══════════════════════════════════════════════════════════════════
 * GridAlive OMNIMESH — Pure Software Mesh (NO external hardware)
 * ═══════════════════════════════════════════════════════════════════
 *
 * ZERO dongle / LoRa / USB radio dependency.
 * Each runtime can participate when at least one real transport is connected:
 *   · RAM store-and-forward buffer (size from device memory)
 *   · Network IN/OUT (Wi‑Fi/LAN WebSocket + WebRTC + BroadcastChannel + Gun)
 *   · validated transmit / receive / relay packet lifecycle
 *   · bounded RAM-only retry queue
 *
 * Optional BLE/LoRa (if OS exposes them) may attach as EXTRA edges —
 * they are NEVER required for the mesh to run.
 *
 * Same code path: Windows · Mac · Linux · Android · iOS · PWA.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import meshComms from "./meshCommsEngine";
import { resolveMeshWsUrl } from "./meshHubConfig";
import {
  OmniLanWebSocketTransport,
  type WebSocketFactory,
} from "./omniLanWebSocketTransport";

// ── Software-only transports (always the product core) ───────────
export type OmniTransport =
  | "ram-relay" // in-process + store-forward queue (every device)
  | "broadcast-tab" // same origin / multi-tab
  | "wifi-lan-ws" // local mesh node on LAN
  | "webrtc-p2p" // peer data/voice signaling plane
  | "gun-graph" // offline graph + multi-device sync
  | "trystero-sw"; // software P2P room (no dongle)

/** Adapter identifiers. Availability is established at runtime, not assumed. */
export const SOFTWARE_TRANSPORTS: OmniTransport[] = [
  "ram-relay",
  "broadcast-tab",
  "wifi-lan-ws",
  "webrtc-p2p",
  "gun-graph",
  "trystero-sw",
];

export interface TransportHealth {
  id: OmniTransport;
  available: boolean;
  score: number;
  latencyMs: number;
  successRate: number;
  rangeHintM: number;
  powerCost: number;
  lastOk: number;
  lastErr: number;
  tx: number;
  rx: number;
  label: string;
  required: boolean; // software core = true
}

export interface OmniPeer {
  id: string;
  name: string;
  transports: OmniTransport[];
  lastSeen: number;
  hops: number;
  score: number;
  ramMB?: number;
  relayLoad?: number;
  online: boolean;
}

export interface OmniPacket {
  id: string;
  type: string;
  payload: any;
  from: string;
  fromName?: string;
  to?: string;
  /** Immediate LAN recipient; final application destination remains `to`. */
  nextHop?: string;
  ts: number;
  hops: number;
  ttl: number;
  path: string[];
  via: OmniTransport[];
  shardIndex?: number;
  shardTotal?: number;
  priority: "sos" | "call" | "sms" | "data" | "presence" | "relay";
  /** Store-forward: deliver later if peer offline */
  holdUntil?: number;
  /** Wall-clock expiry, independent from hop TTL. */
  expiresAt: number;
  /** Application ACK packets correlate to the delivered logical packet. */
  ackFor?: string;
}

export type DeliveryState = "queued" | "transport-sent" | "destination-delivered" | "acked" | "failed";

export interface DispatchResult {
  packetId: string;
  attempted: OmniTransport[];
  succeeded: OmniTransport[];
  failed: OmniTransport[];
  transportAccepted: boolean;
  destinationDelivered: boolean;
  endToEndAck: boolean;
}

export type OmniTransportSender = (packet: OmniPacket) => void | Promise<void>;

export interface OmniMeshEngineOptions {
  nodeId?: string;
  nodeName?: string;
  now?: () => number;
  transportSenders?: Partial<Record<OmniTransport, OmniTransportSender>>;
  /** Deterministic harnesses opt out of browser/network startup. */
  manualStart?: boolean;
}

export type OmniTraceEvent = {
  event: "TX" | "RX" | "RELAY" | "DELIVER" | "ACK_TX" | "ACK_RX";
  nodeId: string;
  packetId: string;
  type: string;
  from: string;
  to?: string;
  nextHop?: string;
  hops: number;
  ttl: number;
  path: string[];
  at: number;
};

export interface OmniStats {
  mode: "software-mesh";
  noExternalHardware: true;
  bonded: OmniTransport[];
  peers: number;
  onlinePeers: number;
  pathsLearned: number;
  packetsOut: number;
  packetsIn: number;
  packetsRelayed: number;
  permutationsTried: number;
  ramBudgetMB: number;
  ramUsedMB: number;
  storeForwardQueue: number;
  estimatedRangeM: number;
  estimatedRangeLabel: string;
  aiMode: string;
  uptime: number;
  platformEqual: boolean;
}

type Handler = (pkt: OmniPacket) => void;

const RANGE_HINT: Record<OmniTransport, number> = {
  "ram-relay": 0,
  "broadcast-tab": 0,
  "wifi-lan-ws": 0,
  "webrtc-p2p": 0,
  "gun-graph": 0,
  "trystero-sw": 0,
};

const LABELS: Record<OmniTransport, string> = {
  "ram-relay": "RAM-only retry queue (not a transport)",
  "broadcast-tab": "Same-device, same-origin tab bus",
  "wifi-lan-ws": "Configured HTTP/WebSocket hub path",
  "webrtc-p2p": "WebRTC peer data path (requires signaling)",
  "gun-graph": "Gun graph path (requires a reachable peer for cross-device sync)",
  "trystero-sw": "Trystero WebRTC room (requires signaling/discovery)",
};

type GunStoreLike = {
  ensure?: () => unknown;
  init?: () => unknown;
  map: (path: string, callback: (data: any, key: string) => void) => (() => void) | void;
  put: (path: string, data: any) => void;
};

let gunStorePromise: Promise<GunStoreLike | null> | null = null;

async function getGunStore(): Promise<GunStoreLike | null> {
  if (!gunStorePromise) {
    gunStorePromise = import("../plugins/gunStore")
      .then((mod) => mod.gunStore as GunStoreLike)
      .catch(() => null);
  }
  return gunStorePromise;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function fnv(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Device RAM budget for store-and-forward (MB) */
function detectRamBudgetMB(): number {
  try {
    const dm = (navigator as any).deviceMemory; // Chrome: 0.25–8+
    if (typeof dm === "number" && dm > 0) {
      // Use ~1.5% of reported RAM, clamp 8–128 MB
      return Math.max(8, Math.min(128, Math.round(dm * 1024 * 0.015)));
    }
  } catch {}
  return 24; // safe default every platform
}

function permutations(list: OmniTransport[], max = 20): OmniTransport[][] {
  if (!list.length) return [];
  const out: OmniTransport[][] = [];
  for (const t of list) out.push([t]);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      out.push([list[i], list[j]]);
      out.push([list[j], list[i]]);
    }
  }
  out.push([...list]);
  out.push([...list].reverse());
  // latency-first vs diversity-first
  out.push([...list].sort((a, b) => RANGE_HINT[a] - RANGE_HINT[b]));
  out.push([...list].sort((a, b) => RANGE_HINT[b] - RANGE_HINT[a]));
  return out.slice(0, max);
}

export class OmniMeshEngine {
  private nodeId: string;
  private nodeName: string;
  private health = new Map<OmniTransport, TransportHealth>();
  private peers = new Map<string, OmniPeer>();
  private routeMemory = new Map<string, { via: OmniTransport[]; score: number; ts: number; hops: number }>();
  private handlers = new Set<Handler>();
  private seen = new Map<string, number>();
  private started = false;
  private startTs = Date.now();
  private stats = {
    packetsOut: 0,
    packetsIn: 0,
    packetsRelayed: 0,
    permutationsTried: 0,
    pathsLearned: 0,
  };
  private bc: BroadcastChannel | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private learnTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private gunUnsub: (() => void) | null = null;

  /** Bounded, RAM-only retry queue. It is not crash-safe persistence. */
  private storeForward: Array<{ packet: OmniPacket; attempts: number; nextAttemptAt: number }> = [];
  private ramBudgetMB = detectRamBudgetMB();
  private stripeBuf = new Map<string, { n: number; parts: Map<number, string>; meta: OmniPacket }>();
  private delivery = new Map<string, DeliveryState>();
  private acked = new Set<string>();
  private readonly now: () => number;
  private readonly transportSenders: Partial<Record<OmniTransport, OmniTransportSender>>;
  private readonly manualStart: boolean;
  private readonly seenRetentionMs = 5 * 60_000;
  private readonly maxAttempts = 4;
  private lanTransport: OmniLanWebSocketTransport | null = null;
  private traceHandlers = new Set<(event: OmniTraceEvent) => void>();

  constructor(options: OmniMeshEngineOptions = {}) {
    this.now = options.now || Date.now;
    this.transportSenders = options.transportSenders || {};
    this.manualStart = options.manualStart === true;
    this.nodeId = options.nodeId ||
      S.get("omni_node_id") ||
      (() => {
        const id = "omni_" + uid();
        S.set("omni_node_id", id);
        return id;
      })();
    this.nodeName = options.nodeName || S.get("user_name") || S.get("mesh_name") || "Node";
    for (const t of SOFTWARE_TRANSPORTS) {
      this.health.set(t, {
        id: t,
        available: t === "ram-relay" || !!this.transportSenders[t],
        score: t === "ram-relay" ? 70 : 40,
        latencyMs: t === "ram-relay" ? 0 : 999,
        successRate: t === "ram-relay" ? 1 : 0.5,
        rangeHintM: RANGE_HINT[t],
        powerCost: t === "ram-relay" ? 1 : 4,
        lastOk: t === "ram-relay" ? this.now() : 0,
        lastErr: 0,
        tx: 0,
        rx: 0,
        label: LABELS[t],
        required: false,
      });
    }
  }

  get id() {
    return this.nodeId;
  }

  /** Explicit receive entry used by every transport and deterministic adapters. */
  receive(raw: unknown, via: OmniTransport) {
    this.ingest(raw, via);
  }

  getDeliveryState(packetId: string): DeliveryState | undefined {
    return this.delivery.get(packetId);
  }

  getQueuedPacketIds(): string[] {
    return this.storeForward.map((entry) => entry.packet.id);
  }

  async flushRetries() {
    await this.flushStoreForward();
  }

  async retransmitQueued(packetId: string): Promise<boolean> {
    const entry = this.storeForward.find((candidate) => candidate.packet.id === packetId);
    if (!entry) return false;
    const result = await this.dispatchCombo(
      entry.packet,
      this.availableTransports().filter((transport) => transport !== "ram-relay")
    );
    return result.transportAccepted;
  }

  /** Transmit an already-created local packet, used by durable/recovery adapters. */
  transmitExistingPacket(packet: OmniPacket) {
    if (packet.from !== this.nodeId || !this.validPacket(packet)) {
      throw new Error("Cannot transmit an invalid or foreign packet");
    }
    if (!this.lanTransport) throw new Error("LAN WebSocket transport is not configured");
    this.trace(packet.type === "OMNI_ACK" ? "ACK_TX" : "TX", packet);
    this.lanTransport.send(packet);
  }

  onTrace(handler: (event: OmniTraceEvent) => void) {
    this.traceHandlers.add(handler);
    return () => this.traceHandlers.delete(handler);
  }

  async connectLan(url = resolveMeshWsUrl(), createWebSocket?: WebSocketFactory, reconnect = true) {
    this.lanTransport?.close();
    this.lanTransport = new OmniLanWebSocketTransport({
      url,
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      createWebSocket,
      reconnect,
      onPacket: (packet) => this.ingest(packet, "wifi-lan-ws"),
      onState: (state) => this.markAvailable("wifi-lan-ws", state === "open", 0),
    });
    await this.lanTransport.connect();
  }

  /** Boot software mesh — same on every platform, no hardware required */
  start(name?: string) {
    if (this.started) return;
    this.started = true;
    this.startTs = Date.now();
    this.ramBudgetMB = detectRamBudgetMB();
    if (name) {
      this.nodeName = name;
      S.set("mesh_name", name);
      S.set("user_name", name);
    }

    // Always-on RAM queue
    this.markAvailable("ram-relay", true, 0);

    // Multi-instance bus
    try {
      this.bc = new BroadcastChannel("gridalive-omnimesh");
      this.bc.onmessage = (ev) => this.ingest(ev.data, "broadcast-tab");
      this.markAvailable("broadcast-tab", true, 1);
    } catch {
      this.markAvailable("broadcast-tab", false);
    }

    // Kernel mesh bridge
    try {
      MeshEngine.onMessage((msg: any) => {
        const embedded = msg?.data?._omni;
        if (embedded && typeof embedded === "object") {
          this.ingest({ ...embedded, via: ["wifi-lan-ws"] }, "wifi-lan-ws");
          return;
        }
        this.ingest(
          {
            id: msg.id || fnv(JSON.stringify(msg).slice(0, 80) + msg.from),
            type: msg.type,
            payload: msg.data ?? msg,
            from: msg.from,
            fromName: msg.fromName,
            to: msg.to ?? msg.data?.to,
            ts: msg.time ?? Date.now(),
            hops: msg.hops ?? msg.data?._omni?.hops ?? 0,
            ttl: msg.ttl ?? msg.data?._omni?.ttl ?? 14,
            path: msg.path ?? msg.data?._omni?.path ?? [msg.from],
            via: ["broadcast-tab"],
            priority: this.classifyPriority(msg.type),
            expiresAt: msg.expiresAt ?? msg.data?._omni?.expiresAt ?? ((msg.time ?? this.now()) + 60000),
            ackFor: msg.ackFor ?? msg.data?._omni?.ackFor,
          } as OmniPacket,
          "broadcast-tab"
        );
      });
    } catch {}

    // Gun + WebRTC software plane
    try {
      meshComms.init(this.nodeId, this.nodeName);
      void this.attachGunGraph();
      // API presence is not an established peer data channel.
      this.markAvailable("webrtc-p2p", false, 35);
      this.markAvailable("trystero-sw", false, 50);
    } catch {
      this.markAvailable("gun-graph", false);
      this.markAvailable("webrtc-p2p", typeof RTCPeerConnection !== "undefined");
      this.markAvailable("trystero-sw", false);
    }

    this.probeLanWs();
    void this.connectLan().catch(() => this.markAvailable("wifi-lan-ws", false));

    // Advertise observed adapter state; relay is true only with a cross-device edge.
    this.announcePresence();

    this.probeTimer = setInterval(() => this.heartbeat(), 4000);
    this.learnTimer = setInterval(() => this.aiLearnCycle(), 10000);
    this.flushTimer = setInterval(() => this.flushStoreForward(), 2500);

    bus.emit("omnimesh:ready", {
      nodeId: this.nodeId,
      mode: "software-mesh",
      noExternalHardware: true,
      transports: this.availableTransports(),
      ramBudgetMB: this.ramBudgetMB,
    });
    console.info(
      "[OmniMesh] SOFTWARE mesh · no dongle · RAM",
      this.ramBudgetMB,
      "MB ·",
      this.availableTransports().join("+")
    );
  }

  stop() {
    this.started = false;
    if (this.probeTimer) clearInterval(this.probeTimer);
    if (this.learnTimer) clearInterval(this.learnTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    try {
      this.gunUnsub?.();
    } catch {}
    this.gunUnsub = null;
    try {
      this.bc?.close();
    } catch {}
    this.lanTransport?.close();
    this.lanTransport = null;
  }

  onPacket(fn: Handler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  getTransports(): TransportHealth[] {
    return SOFTWARE_TRANSPORTS.map((t) => ({ ...this.health.get(t)! }));
  }

  getPeers(): OmniPeer[] {
    const now = Date.now();
    return [...this.peers.values()].map((p) => ({
      ...p,
      online: now - p.lastSeen < 45000,
    }));
  }

  getStats(): OmniStats {
    const bonded = this.availableTransports();
    const est = this.aiEstimateRangeM();
    return {
      mode: "software-mesh",
      noExternalHardware: true,
      bonded,
      peers: this.peers.size,
      onlinePeers: this.getPeers().filter((p) => p.online).length,
      pathsLearned: this.routeMemory.size,
      packetsOut: this.stats.packetsOut,
      packetsIn: this.stats.packetsIn,
      packetsRelayed: this.stats.packetsRelayed,
      permutationsTried: this.stats.permutationsTried,
      ramBudgetMB: this.ramBudgetMB,
      ramUsedMB: this.estimateRamUsedMB(),
      storeForwardQueue: this.storeForward.length,
      estimatedRangeM: est,
      estimatedRangeLabel: this.rangeLabel(est),
      aiMode: this.aiModeLabel(),
      uptime: Math.floor((Date.now() - this.startTs) / 1000),
      platformEqual: false,
    };
  }

  /**
   * Send using only software transports + AI permutations.
   * Total transport failure is retained in the bounded RAM retry queue.
   */
  async send(
    type: string,
    payload: any,
    opts?: {
      to?: string;
      priority?: OmniPacket["priority"];
      ttl?: number;
      forceTransports?: OmniTransport[];
      expiresInMs?: number;
      ackFor?: string;
      nextHop?: string;
    }
  ) {
    if (!this.started && !this.manualStart) this.start();
    const priority = opts?.priority || this.classifyPriority(type);
    const ttl = opts?.ttl ?? (priority === "sos" ? 18 : priority === "call" ? 10 : 14);
    if (!Number.isSafeInteger(ttl) || ttl < 0) throw new RangeError("ttl must be a non-negative integer");
    const available = (
      opts?.forceTransports?.length
        ? opts.forceTransports
        : this.availableTransports()
    ).filter((t) => this.health.get(t)?.available);

    // Always include ram-relay in the plan for hold/retransmit
    const plan = Array.from(new Set<OmniTransport>(["ram-relay", ...available]));
    const ranked = this.aiRankPermutations(plan, priority, opts?.to);
    this.stats.permutationsTried += ranked.length;

    const pkt: OmniPacket = {
      id: uid(),
      type,
      payload,
      from: this.nodeId,
      fromName: this.nodeName,
      to: opts?.to,
      nextHop: opts?.nextHop,
      ts: Date.now(),
      hops: 0,
      ttl,
      path: [this.nodeId],
      via: ranked[0] || plan,
      priority,
      holdUntil: this.now(),
      expiresAt: this.now() + (opts?.expiresInMs ?? (priority === "sos" ? 120000 : 60000)),
      ackFor: opts?.ackFor,
    };
    this.seen.set(pkt.id, this.now());
    this.rememberDelivery(pkt.id, "queued");

    const combos =
      priority === "sos" || priority === "call"
        ? ranked.slice(0, 8)
        : priority === "sms"
          ? ranked.slice(0, 4)
          : ranked.slice(0, 3);

    const attempted = new Set<OmniTransport>();
    const succeeded = new Set<OmniTransport>();
    if (ttl > 0) for (const combo of combos) {
      const wire = combo.filter((t) => t !== "ram-relay" && !attempted.has(t));
      wire.forEach((t) => attempted.add(t));
      if (!wire.length) continue;
      const result = await this.dispatchCombo({ ...pkt, via: wire }, wire);
      result.succeeded.forEach((t) => succeeded.add(t));
    }

    if (succeeded.size && this.delivery.get(pkt.id) === "queued") {
      this.rememberDelivery(pkt.id, "transport-sent");
    }
    if (ttl > 0 && pkt.to && pkt.type !== "OMNI_ACK" && !this.acked.has(pkt.id)) {
      this.enqueueStoreForward(pkt);
    } else if (!succeeded.size && ttl > 0) {
      this.enqueueStoreForward(pkt);
    } else if (!succeeded.size) {
      this.rememberDelivery(pkt.id, "failed");
    }

    this.stats.packetsOut++;
    if (!pkt.to) this.notify(pkt);
    return pkt;
  }

  sendSms(to: string, text: string, toName?: string) {
    return this.send(
      "OMNI_SMS",
      { text, to, toName, fromName: this.nodeName },
      { to, priority: "sms", ttl: 16 }
    );
  }

  sendCallSignal(kind: string, to: string, data: any) {
    return this.send(
      "OMNI_CALL_" + kind,
      { ...data, to },
      { to, priority: "call", ttl: 10 }
    );
  }

  /** Explicit bounded replay of held packets over verified transports. */
  private async attachGunGraph() {
    try {
      const store = await getGunStore();
      store?.ensure?.();
      store?.init?.();
      const unsub = store?.map("gridalive.omni.sw", (data: any, key: string) => {
        if (!data || data.from === this.nodeId) return;
        let payload = data.payload;
        try {
          if (typeof payload === "string") payload = JSON.parse(payload);
        } catch {}
        this.ingest(
          {
            id: key || data.id || uid(),
            type: data.type || "GUN_EVENT",
            payload,
            from: data.from,
            fromName: data.fromName,
            to: data.to || undefined,
            ts: data.ts || Date.now(),
            hops: data.hops ?? 0,
            ttl: data.ttl ?? 14,
            path: data.path ? String(data.path).split(",") : [data.from],
            via: ["gun-graph"],
            priority: this.classifyPriority(data.type || ""),
            expiresAt: data.expiresAt ?? ((data.ts ?? this.now()) + 60000),
            ackFor: data.ackFor || undefined,
          } as OmniPacket,
          "gun-graph"
        );
      });
      this.gunUnsub = typeof unsub === "function" ? unsub : null;
      // Local Gun initialization is not evidence of a reachable remote peer.
      this.markAvailable("gun-graph", false, 10);
    } catch {
      this.markAvailable("gun-graph", false, 20);
    }
  }

  async amplifyRelay() {
    const held = this.storeForward.slice(-20);
    for (const entry of held) {
      await this.relayPacket(entry.packet);
    }
    await this.send(
      "OMNI_RELAY_PULSE",
      {
        from: this.nodeId,
        name: this.nodeName,
        ramMB: this.ramBudgetMB,
        queue: this.storeForward.length,
        peers: this.getPeers().filter((p) => p.online).map((p) => p.id).slice(0, 32),
      },
      { priority: "relay", ttl: 12 }
    );
  }

  // ── internals ────────────────────────────────────────────────

  private availableTransports(): OmniTransport[] {
    return SOFTWARE_TRANSPORTS.filter((t) => this.health.get(t)?.available);
  }

  private markAvailable(t: OmniTransport, ok: boolean, latency = 50) {
    const h = this.health.get(t);
    if (!h) return;
    h.available = ok;
    if (ok) {
      h.latencyMs = latency;
      h.lastOk = Date.now();
      h.successRate = Math.min(1, h.successRate * 0.9 + 0.1);
    } else {
      h.lastErr = Date.now();
      h.successRate = Math.max(0, h.successRate * 0.85);
    }
    h.score = this.scoreTransport(h);
  }

  private scoreTransport(h: TransportHealth): number {
    const rangeN = Math.min(1, Math.log10(h.rangeHintM + 10) / 4);
    const latN = 1 - Math.min(1, h.latencyMs / 1500);
    const powN = 1 - h.powerCost / 10;
    let s = rangeN * 30 + latN * 28 + h.successRate * 32 + powN * 10;
    if (!h.available) s *= 0.05;
    // RAM queue is useful for retry scheduling but is not a network edge.
    if (h.id === "ram-relay" && h.available) s = Math.max(s, 65);
    if (h.id === "wifi-lan-ws" && h.available) s += 12;
    if (h.id === "webrtc-p2p" && h.available) s += 10;
    return Math.round(Math.max(0, Math.min(100, s)));
  }

  private aiRankPermutations(
    available: OmniTransport[],
    priority: OmniPacket["priority"],
    to?: string
  ): OmniTransport[][] {
    const mem = to ? this.routeMemory.get(to) : null;
    const perms = permutations(
      available.filter((t) => t !== "ram-relay" || available.length === 1),
      priority === "sos" ? 28 : 18
    );

    const online = this.getPeers().filter((p) => p.online).length;
    const scored = perms.map((p) => {
      let score = 0;
      for (const t of p) score += this.health.get(t)?.score || 0;
      score += p.length * 8; // diversity
      const bestRange = Math.max(...p.map((t) => this.health.get(t)?.rangeHintM || RANGE_HINT[t] || 0));
      score += Math.log10(bestRange + 10) * 10;
      // Observed peers modestly prefer adapters with demonstrated activity.
      score += Math.log2(online + 1) * 2;
      if (priority === "call" && (p.includes("webrtc-p2p") || p.includes("wifi-lan-ws"))) score += 18;
      if (priority === "sms" && (p.includes("gun-graph") || p.includes("wifi-lan-ws"))) score += 12;
      if (priority === "sos") score += p.length * 5;
      if (mem && mem.via.join() === p.join()) score += mem.score * 0.35;
      return { p, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.p);
  }

  private estimateRamUsedMB(): number {
    try {
      const bytes = new Blob([JSON.stringify(this.storeForward)]).size;
      return Math.round((bytes / (1024 * 1024)) * 100) / 100;
    } catch {
      return Math.round(this.storeForward.length * 0.002 * 100) / 100;
    }
  }

  private enqueueStoreForward(pkt: OmniPacket) {
    if (this.storeForward.some((entry) => entry.packet.id === pkt.id)) return;
    this.storeForward.push({ packet: { ...pkt }, attempts: 0, nextAttemptAt: this.now() + 1000 });
    // Evict oldest until under RAM budget
    while (
      this.storeForward.length > 20 &&
      this.estimateRamUsedMB() > this.ramBudgetMB
    ) {
      this.storeForward.shift();
    }
    // Cap absolute queue length for tiny devices
    const maxQ = Math.max(40, Math.min(400, this.ramBudgetMB * 8));
    if (this.storeForward.length > maxQ) {
      this.storeForward = this.storeForward.slice(-maxQ);
    }
  }

  private async flushStoreForward() {
    if (!this.storeForward.length) return;
    const now = this.now();
    this.cleanupSeen(now);
    this.storeForward = this.storeForward.filter((entry) => {
      const expired = entry.packet.expiresAt <= now;
      const exhausted = entry.attempts >= this.maxAttempts;
      if (expired || exhausted) this.rememberDelivery(entry.packet.id, "failed");
      return !expired && !exhausted && !this.acked.has(entry.packet.id);
    });
    const batch = this.storeForward.filter((entry) => entry.nextAttemptAt <= now).slice(0, 8);
    for (const entry of batch) {
      entry.attempts++;
      entry.nextAttemptAt = now + Math.min(30000, 1000 * 2 ** (entry.attempts - 1));
      const result = await this.dispatchCombo(
        entry.packet,
        this.availableTransports().filter((t) => t !== "ram-relay")
      );
      if (result.transportAccepted && this.delivery.get(entry.packet.id) !== "acked") {
        this.rememberDelivery(entry.packet.id, "transport-sent");
      }
      if (result.transportAccepted && entry.packet.type === "OMNI_ACK") {
        this.storeForward = this.storeForward.filter((candidate) => candidate !== entry);
      }
    }
  }

  private async relayPacket(pkt: OmniPacket): Promise<DispatchResult | null> {
    if (pkt.from === this.nodeId) return null;
    if (pkt.path.includes(this.nodeId)) return null;
    if (pkt.expiresAt <= this.now() || pkt.hops >= pkt.ttl) return null;

    const relay: OmniPacket = {
      ...pkt,
      nextHop: undefined,
      hops: pkt.hops + 1,
      path: [...pkt.path, this.nodeId],
      priority: pkt.priority === "presence" ? "relay" : pkt.priority,
    };
    this.trace("RELAY", relay);
    this.stats.packetsRelayed++;
    // Track actual bytes relayed so bandwidth_sell earnings are measurement-based
    try {
      const payloadBytes = JSON.stringify(relay.payload ?? null).length;
      bus.emit("omnimesh:bytes_relayed", { bytes: payloadBytes, packetId: relay.id });
    } catch {}
    const wire = this.availableTransports().filter((t) => t !== "ram-relay").slice(0, 3);
    if (!wire.length) {
      this.enqueueStoreForward(relay);
      return null;
    }
    const result = await this.dispatchCombo(relay, wire);
    if (!result.transportAccepted) this.enqueueStoreForward(relay);
    return result;
  }

  private async dispatchCombo(pkt: OmniPacket, combo: OmniTransport[]): Promise<DispatchResult> {
    const succeeded: OmniTransport[] = [];
    const failed: OmniTransport[] = [];
    await Promise.all(
      combo.map(async (t) => {
        const t0 = performance.now();
        try {
          await this.sendOn(t, pkt);
          const ms = performance.now() - t0;
          const h = this.health.get(t)!;
          h.tx++;
          h.latencyMs = h.latencyMs * 0.7 + ms * 0.3;
          h.successRate = Math.min(1, h.successRate * 0.92 + 0.08);
          h.lastOk = Date.now();
          h.score = this.scoreTransport(h);
          succeeded.push(t);
        } catch {
          const h = this.health.get(t)!;
          h.lastErr = Date.now();
          h.successRate = Math.max(0, h.successRate * 0.8);
          h.score = this.scoreTransport(h);
          failed.push(t);
        }
      })
    );
    const routeEvidence = succeeded.filter((t) => t !== "broadcast-tab" && t !== "ram-relay");
    if (pkt.to && routeEvidence.length) {
      this.routeMemory.set(pkt.to, {
        via: routeEvidence,
        score: routeEvidence.reduce((s, t) => s + (this.health.get(t)?.score || 0), 0),
        ts: Date.now(),
        hops: pkt.hops,
      });
      this.stats.pathsLearned = this.routeMemory.size;
    }
    return {
      packetId: pkt.id,
      attempted: [...combo],
      succeeded,
      failed,
      transportAccepted: succeeded.length > 0,
      destinationDelivered: this.delivery.get(pkt.id) === "destination-delivered",
      endToEndAck: this.acked.has(pkt.id),
    };
  }

  private async sendStriped(pkt: OmniPacket, combo: OmniTransport[]) {
    if (!combo.length) return;
    const raw = JSON.stringify(pkt.payload);
    const n = combo.length;
    const size = Math.ceil(raw.length / n);
    await Promise.all(
      combo.map((t, i) =>
        this.sendOn(t, {
          ...pkt,
          id: pkt.id + "_s" + i,
          payload: {
            _stripe: true,
            i,
            n,
            key: pkt.id,
            shard: raw.slice(i * size, (i + 1) * size),
          },
          shardIndex: i,
          shardTotal: n,
          via: [t],
        })
      )
    );
  }

  private async sendOn(t: OmniTransport, pkt: OmniPacket) {
    const injected = this.transportSenders[t];
    if (injected) {
      await injected(structuredClone(pkt));
      return;
    }
    const wire = { ...pkt, omni: true, transport: t, softwareOnly: true };
    this.trace(pkt.type === "OMNI_ACK" ? "ACK_TX" : "TX", pkt);

    switch (t) {
      case "ram-relay":
        this.enqueueStoreForward(pkt);
        break;

      case "broadcast-tab":
        if (!this.bc) throw new Error("BroadcastChannel is unavailable");
        this.bc.postMessage(wire);
        break;

      case "wifi-lan-ws":
        if (!this.lanTransport) throw new Error("LAN WebSocket transport is not configured");
        this.lanTransport.send(pkt);
        break;

      case "gun-graph":
        {
          const store = await getGunStore();
          if (!store) throw new Error("Gun store unavailable");
          store.ensure?.();
          const payload = JSON.stringify(pkt.payload);
          if (payload.length > 6000) throw new Error("Gun packet exceeds 6000 byte adapter limit");
          store.put(`gridalive.omni.sw.${pkt.id}`, {
            type: pkt.type,
            payload,
            from: pkt.from,
            fromName: pkt.fromName || "",
            to: pkt.to || "",
            ts: pkt.ts,
            hops: pkt.hops,
            path: pkt.path.join(","),
            ttl: pkt.ttl,
            expiresAt: pkt.expiresAt,
            ackFor: pkt.ackFor || "",
            priority: pkt.priority,
          });
        }
        break;

      case "webrtc-p2p":
      case "trystero-sw":
        {
          const ch = t === "trystero-sw" ? "omni_sw_global" : "omni_sw_mesh";
          meshComms.joinWalkieChannel?.(ch, (msg: any) => {
            if (!msg?.message?.startsWith?.("{")) return;
            try {
              const j = JSON.parse(msg.message);
              this.ingest(
                {
                  id: j.id || msg.id,
                  type: j.t || "SW_P2P",
                  payload: j.p,
                  from: j.from || msg.peerId,
                  fromName: j.fromName || msg.user,
                  to: j.to,
                  ts: msg.timestamp || Date.now(),
                  hops: j.hops ?? 0,
                  ttl: j.ttl ?? 12,
                  path: j.path ?? [msg.peerId],
                  via: [t],
                  priority: j.priority || this.classifyPriority(j.t || ""),
                  expiresAt: j.expiresAt ?? ((msg.timestamp ?? this.now()) + 60000),
                  ackFor: j.ackFor,
                } as OmniPacket,
                t
              );
            } catch {}
          });
          if (!meshComms.sendWalkieTextMessage) throw new Error("P2P sender unavailable");
          const serialized = JSON.stringify({
            t: pkt.type, p: pkt.payload, id: pkt.id, from: pkt.from, fromName: pkt.fromName,
            to: pkt.to, hops: pkt.hops, ttl: pkt.ttl, path: pkt.path,
            expiresAt: pkt.expiresAt, ackFor: pkt.ackFor, priority: pkt.priority,
          });
          if (serialized.length > 3500) throw new Error("P2P packet exceeds 3500 byte adapter limit");
          await Promise.resolve(meshComms.sendWalkieTextMessage(
            ch,
            serialized,
            this.nodeName
          ));
        }
        break;
    }
  }

  private ingest(raw: any, via: OmniTransport) {
    if (!raw) return;
    let pkt: OmniPacket;
    if (raw.omni || raw.softwareOnly || raw.via) {
      pkt = raw as OmniPacket;
    } else if (raw.type && (raw.payload !== undefined || raw.data !== undefined)) {
      const body = raw.payload ?? raw.data;
      pkt = {
        id: raw.id || fnv(String(raw.type) + raw.from + (raw.ts || raw.time)),
        type: raw.type,
        payload: body?._omni?.payload ?? body,
        from: raw.from,
        fromName: raw.fromName,
        to: raw.to || body?.to || body?._omni?.to,
        ts: raw.ts ?? raw.time ?? this.now(),
        hops: raw.hops ?? body?._omni?.hops ?? 0,
        ttl: raw.ttl ?? body?._omni?.ttl ?? 14,
        path: raw.path ?? body?.path ?? body?._omni?.path ?? [raw.from],
        via: raw.via ?? body?.via ?? body?._omni?.via ?? [via],
        priority: this.classifyPriority(raw.type),
        expiresAt: raw.expiresAt ?? body?._omni?.expiresAt ?? ((raw.ts ?? raw.time ?? this.now()) + 60000),
        ackFor: raw.ackFor ?? body?._omni?.ackFor,
      };
    } else return;

    if (!this.validPacket(pkt)) return;
    if (pkt.from === this.nodeId) return;
    if (pkt.expiresAt <= this.now()) return;
    this.cleanupSeen(this.now());

    const h = this.health.get(via);
    if (h) {
      h.rx++;
      h.lastOk = Date.now();
      h.available = true;
      h.score = this.scoreTransport(h);
    }

    // stripe reassembly
    if (pkt.payload?._stripe) {
      const key = pkt.payload.key;
      let buf = this.stripeBuf.get(key);
      if (!buf) {
        buf = { n: pkt.payload.n, parts: new Map(), meta: pkt };
        this.stripeBuf.set(key, buf);
      }
      buf.parts.set(pkt.payload.i, pkt.payload.shard);
      if (buf.parts.size >= buf.n) {
        let full = "";
        for (let i = 0; i < buf.n; i++) full += buf.parts.get(i) || "";
        this.stripeBuf.delete(key);
        try {
          pkt = { ...pkt, id: key, payload: JSON.parse(full), shardIndex: undefined, shardTotal: undefined };
        } catch {
          return;
        }
      } else return;
    }

    if (this.seen.has(pkt.id)) return;
    this.seen.set(pkt.id, this.now());
    this.trace("RX", pkt);

    // Peer table records observations; it does not by itself prove relay capability.
    if (pkt.from) {
      const prev = this.peers.get(pkt.from);
      const transports = new Set(prev?.transports || []);
      for (const t of pkt.via || [via]) transports.add(t);
      this.peers.set(pkt.from, {
        id: pkt.from,
        name: pkt.fromName || prev?.name || pkt.from.slice(0, 12),
        transports: [...transports],
        lastSeen: Date.now(),
        hops: pkt.hops,
        score: prev?.score || 55,
        ramMB: pkt.payload?.ramMB ?? prev?.ramMB,
        relayLoad: pkt.payload?.queue ?? prev?.relayLoad,
        online: true,
      });
    }

    if (pkt.type === "OMNI_PRESENCE" && pkt.payload?.id) {
      this.peers.set(pkt.payload.id, {
        id: pkt.payload.id,
        name: pkt.payload.name || pkt.payload.id,
        transports: pkt.payload.transports || SOFTWARE_TRANSPORTS,
        lastSeen: Date.now(),
        hops: pkt.hops,
        score: 60,
        ramMB: pkt.payload.ramMB,
        relayLoad: pkt.payload.queue,
        online: true,
      });
    }

    this.stats.packetsIn++;
    const directedToUs = pkt.to === this.nodeId;
    const broadcast = pkt.to === undefined;

    if (directedToUs || broadcast) {
      this.rememberDelivery(pkt.id, "destination-delivered");
      if (pkt.type === "OMNI_ACK" && pkt.ackFor) {
        this.acked.add(pkt.ackFor);
        this.rememberDelivery(pkt.ackFor, "acked");
        this.storeForward = this.storeForward.filter((entry) => entry.packet.id !== pkt.ackFor);
        this.trace("ACK_RX", pkt);
      }
      this.trace("DELIVER", pkt);
      this.notify(pkt);
      if (directedToUs && pkt.type !== "OMNI_ACK") void this.sendAck(pkt);
    }

    if (!directedToUs && pkt.hops < pkt.ttl && !pkt.path.includes(this.nodeId)) {
      void this.relayPacket(pkt);
    }
  }

  private validPacket(pkt: OmniPacket): boolean {
    return !!pkt && typeof pkt.id === "string" && pkt.id.length > 0 && pkt.id.length <= 256 &&
      typeof pkt.type === "string" && typeof pkt.from === "string" && pkt.from.length > 0 &&
      (pkt.to === undefined || typeof pkt.to === "string") &&
      (pkt.nextHop === undefined || typeof pkt.nextHop === "string") && Number.isFinite(pkt.ts) &&
      Number.isSafeInteger(pkt.hops) && pkt.hops >= 0 && Number.isSafeInteger(pkt.ttl) && pkt.ttl >= 0 &&
      Number.isFinite(pkt.expiresAt) && Array.isArray(pkt.path) && pkt.path.length <= 128 &&
      pkt.path.every((node) => typeof node === "string" && node.length > 0) &&
      Array.isArray(pkt.via);
  }

  private cleanupSeen(now: number) {
    for (const [id, seenAt] of this.seen) {
      if (now - seenAt > this.seenRetentionMs) this.seen.delete(id);
    }
    while (this.seen.size > 3000) this.seen.delete(this.seen.keys().next().value!);
    for (const [key, buffer] of this.stripeBuf) {
      if (buffer.meta.expiresAt <= now) this.stripeBuf.delete(key);
    }
    while (this.delivery.size > 3000) this.delivery.delete(this.delivery.keys().next().value!);
    while (this.acked.size > 3000) this.acked.delete(this.acked.values().next().value!);
  }

  private rememberDelivery(packetId: string, state: DeliveryState) {
    this.delivery.delete(packetId);
    this.delivery.set(packetId, state);
    while (this.delivery.size > 3000) this.delivery.delete(this.delivery.keys().next().value!);
  }

  private async sendAck(delivered: OmniPacket) {
    await this.send("OMNI_ACK", { packetId: delivered.id }, {
      to: delivered.from,
      priority: "relay",
      ttl: Math.max(1, delivered.ttl),
      expiresInMs: Math.max(1, delivered.expiresAt - this.now()),
      ackFor: delivered.id,
      nextHop: delivered.path.at(-1),
    });
  }

  private trace(event: OmniTraceEvent["event"], packet: OmniPacket) {
    const entry: OmniTraceEvent = {
      event,
      nodeId: this.nodeId,
      packetId: packet.ackFor || packet.id,
      type: packet.type,
      from: packet.from,
      to: packet.to,
      nextHop: packet.nextHop,
      hops: packet.hops,
      ttl: packet.ttl,
      path: [...packet.path],
      at: this.now(),
    };
    for (const handler of this.traceHandlers) handler(entry);
  }

  private notify(pkt: OmniPacket) {
    for (const fn of this.handlers) {
      try {
        fn(pkt);
      } catch {}
    }
    bus.emit("omnimesh:packet", pkt);
  }

  private classifyPriority(type: string): OmniPacket["priority"] {
    const t = (type || "").toUpperCase();
    if (t.includes("SOS") || t.includes("EMERGENCY")) return "sos";
    if (t.includes("CALL") || t.includes("OFFER") || t.includes("WEBRTC")) return "call";
    if (t.includes("SMS") || t.includes("MSG") || t.includes("CHAT") || t.includes("WALKIE"))
      return "sms";
    if (t.includes("RELAY")) return "relay";
    if (t.includes("PRESENCE") || t.includes("HELLO") || t.includes("PEER")) return "presence";
    return "data";
  }

  private announcePresence() {
    this.send(
      "OMNI_PRESENCE",
      {
        id: this.nodeId,
        name: this.nodeName,
        transports: this.availableTransports(),
        ramMB: this.ramBudgetMB,
        queue: this.storeForward.length,
        softwareOnly: true,
        relay: this.availableTransports().some((t) => t !== "ram-relay" && t !== "broadcast-tab"),
        platformEqual: false,
      },
      { priority: "presence", ttl: 10 }
    );
  }

  private async probeLanWs() {
    if (this.lanTransport?.connected) {
      this.markAvailable("wifi-lan-ws", true, 0);
      return;
    }
    const t0 = performance.now();
    try {
      const hub = String((MeshEngine as any).getHubUrl?.() || "").replace(/\/$/, "");
      const r = await fetch(`${hub}/api/health`, { cache: "no-store" });
      if (r.ok) {
        this.markAvailable("wifi-lan-ws", true, performance.now() - t0);
        return;
      }
    } catch {}
    try {
      const r = await fetch("http://127.0.0.1:8787/api/health", { cache: "no-store" });
      this.markAvailable("wifi-lan-ws", r.ok, performance.now() - t0);
    } catch {
      this.markAvailable("wifi-lan-ws", false);
    }
  }

  private heartbeat() {
    this.probeLanWs();
    this.announcePresence();
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > 120000) this.peers.delete(id);
    }
  }

  /** Refresh evidence scores without inventing physical range. */
  private aiLearnCycle() {
    const online = this.getPeers().filter((p) => p.online);

    for (const h of this.health.values()) {
      const baseScore = this.scoreTransport(h);
      h.score = baseScore;
      h.rangeHintM = RANGE_HINT[h.id];
    }

    for (const p of this.peers.values()) {
      p.score = Math.min(
        100,
        35 +
          p.transports.length * 10 +
          (p.online ? 25 : 0) +
          Math.max(0, 15 - p.hops * 2) +
          Math.min(15, (p.ramMB || 0) / 8)
      );
    }

    bus.emit("omnimesh:ai_tick", this.getStats());
  }

  private aiEstimateRangeM(): number {
    // No adapter measures physical distance or RF link budget.
    return 0;
  }

  private rangeLabel(_m: number): string {
    return "Physical range unmeasured · software reach depends on connected transports";
  }

  private aiModeLabel(): string {
    const n = this.getPeers().filter((p) => p.online).length;
    if (n >= 2) return `Software peers observed: ${n} · relay requires transport evidence`;
    if (n === 1) return "One software peer observed";
    return "No remote peer observed";
  }

  /** FreeMeshFabric can tag bonded free-spectrum links onto presence */
  markFreeLinks(links: string[]) {
    try {
      S.set("omni_free_links", JSON.stringify(links || []));
    } catch {}
    bus.emit("omnimesh:free_links", { links });
  }
}

export const omniMesh = new OmniMeshEngine();
export default omniMesh;
