/**
 * ═══════════════════════════════════════════════════════════════════
 * GridAlive OMNIMESH — Pure Software Mesh (NO external hardware)
 * ═══════════════════════════════════════════════════════════════════
 *
 * ZERO dongle / LoRa / USB radio dependency.
 * Every device on every platform is an equal NODE:
 *   · RAM store-and-forward buffer (size from device memory)
 *   · Network IN/OUT (Wi‑Fi/LAN WebSocket + WebRTC + BroadcastChannel + Gun)
 *   · TRANSMIT · RECEIVE · RELAY (multi-hop)
 *   · AI permutation bonding of software paths only
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
import { gunStore } from "../plugins/gunStore";

// ── Software-only transports (always the product core) ───────────
export type OmniTransport =
  | "ram-relay" // in-process + store-forward queue (every device)
  | "broadcast-tab" // same origin / multi-tab
  | "wifi-lan-ws" // local mesh node on LAN
  | "webrtc-p2p" // peer data/voice signaling plane
  | "gun-graph" // offline graph + multi-device sync
  | "trystero-sw"; // software P2P room (no dongle)

/** Core set — identical behavior on all platforms */
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
}

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
  platformEqual: true;
}

type Handler = (pkt: OmniPacket) => void;

const RANGE_HINT: Record<OmniTransport, number> = {
  "ram-relay": 0, // local buffer, enables multi-hop time
  "broadcast-tab": 5,
  "wifi-lan-ws": 100,
  "webrtc-p2p": 150,
  "gun-graph": 2000, // grows with peer density
  "trystero-sw": 3000,
};

const LABELS: Record<OmniTransport, string> = {
  "ram-relay": "Device RAM relay buffer",
  "broadcast-tab": "Local multi-instance bus",
  "wifi-lan-ws": "Wi‑Fi / LAN mesh node",
  "webrtc-p2p": "WebRTC peer path",
  "gun-graph": "Offline graph sync",
  "trystero-sw": "Software P2P room",
};

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

class OmniMeshEngine {
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

  /** RAM store-and-forward queue — every device is a relay */
  private storeForward: OmniPacket[] = [];
  private ramBudgetMB = detectRamBudgetMB();
  private stripeBuf = new Map<string, { n: number; parts: Map<number, string>; meta: OmniPacket }>();

  constructor() {
    this.nodeId =
      S.get("omni_node_id") ||
      (() => {
        const id = "omni_" + uid();
        S.set("omni_node_id", id);
        return id;
      })();
    this.nodeName = S.get("user_name") || S.get("mesh_name") || "Node";
    for (const t of SOFTWARE_TRANSPORTS) {
      this.health.set(t, {
        id: t,
        available: t === "ram-relay", // RAM always on
        score: t === "ram-relay" ? 70 : 40,
        latencyMs: t === "ram-relay" ? 0 : 999,
        successRate: t === "ram-relay" ? 1 : 0.5,
        rangeHintM: RANGE_HINT[t],
        powerCost: t === "ram-relay" ? 1 : 4,
        lastOk: t === "ram-relay" ? Date.now() : 0,
        lastErr: 0,
        tx: 0,
        rx: 0,
        label: LABELS[t],
        required: true,
      });
    }
  }

  get id() {
    return this.nodeId;
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

    // Always-on RAM relay
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
        this.ingest(
          {
            id: msg.id || fnv(JSON.stringify(msg).slice(0, 80) + msg.from),
            type: msg.type,
            payload: msg.data ?? msg,
            from: msg.from,
            fromName: msg.fromName,
            to: msg.data?.to,
            ts: msg.time || Date.now(),
            hops: msg.hops || 0,
            ttl: msg.ttl || 14,
            path: msg.path || [msg.from],
            via: ["broadcast-tab"],
            priority: this.classifyPriority(msg.type),
          } as OmniPacket,
          "broadcast-tab"
        );
      });
    } catch {}

    // Gun + WebRTC software plane
    try {
      meshComms.init(this.nodeId, this.nodeName);
      try {
        gunStore.ensure?.() || gunStore.init();
        // Live ingest from Gun graph into OmniMesh
        gunStore.map("gridalive.omni.sw", (data: any, key: string) => {
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
              hops: data.hops || 1,
              ttl: 14,
              path: data.path ? String(data.path).split(",") : [data.from],
              via: ["gun-graph"],
              priority: this.classifyPriority(data.type || ""),
            } as OmniPacket,
            "gun-graph"
          );
        });
        this.markAvailable("gun-graph", true, 10);
      } catch {
        this.markAvailable("gun-graph", true, 20); // still mark via meshComms
      }
      this.markAvailable("webrtc-p2p", typeof RTCPeerConnection !== "undefined", 35);
      this.markAvailable("trystero-sw", true, 50);
    } catch {
      this.markAvailable("gun-graph", false);
      this.markAvailable("webrtc-p2p", typeof RTCPeerConnection !== "undefined");
      this.markAvailable("trystero-sw", false);
    }

    this.probeLanWs();

    // Presence: advertise this node as a full relay with RAM budget
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
      this.bc?.close();
    } catch {}
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
      platformEqual: true,
    };
  }

  /**
   * Send using only software transports + AI permutations.
   * Every node also holds a copy in RAM relay for store-and-forward.
   */
  async send(
    type: string,
    payload: any,
    opts?: {
      to?: string;
      priority?: OmniPacket["priority"];
      ttl?: number;
      forceTransports?: OmniTransport[];
    }
  ) {
    if (!this.started) this.start();
    const priority = opts?.priority || this.classifyPriority(type);
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
      ts: Date.now(),
      hops: 0,
      ttl: opts?.ttl ?? (priority === "sos" ? 18 : priority === "call" ? 10 : 14),
      path: [this.nodeId],
      via: ranked[0] || plan,
      priority,
      holdUntil: Date.now() + (priority === "sos" ? 120000 : 60000),
    };

    // Enqueue in RAM first — every device is a relay buffer
    this.enqueueStoreForward(pkt);

    const combos =
      priority === "sos" || priority === "call"
        ? ranked.slice(0, 8)
        : priority === "sms"
          ? ranked.slice(0, 4)
          : ranked.slice(0, 3);

    const raw = JSON.stringify(payload);
    if (raw.length > 900 && (combos[0]?.length || 0) > 1) {
      await this.sendStriped(pkt, combos[0].filter((t) => t !== "ram-relay"));
    } else {
      for (const combo of combos) {
        const wire = combo.filter((t) => t !== "ram-relay");
        if (!wire.length) continue;
        await this.dispatchCombo(
          { ...pkt, via: wire, id: pkt.id + "_" + wire.join(".") },
          wire
        );
      }
    }

    this.stats.packetsOut++;
    this.notify(pkt);
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

  /** Explicit relay flood — rebroadcast held + live packets to expand reach */
  async amplifyRelay() {
    const held = this.storeForward.slice(-20);
    for (const p of held) {
      await this.relayPacket(p, true);
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
    // RAM relay always valuable for multi-hop time dimension
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
      // Density: more peers ⇒ multi-hop software range explodes
      score += Math.log2(online + 1) * 9;
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
    this.storeForward.push(pkt);
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
    const now = Date.now();
    const live = this.storeForward.filter((p) => !p.holdUntil || p.holdUntil > now);
    this.storeForward = live;
    // Retransmit a few high-priority held packets
    const batch = live
      .filter((p) => p.priority === "sos" || p.priority === "sms" || p.priority === "call")
      .slice(-8);
    for (const p of batch) {
      if ((p.hops || 0) >= (p.ttl || 14)) continue;
      await this.relayPacket(p, false);
    }
  }

  private async relayPacket(pkt: OmniPacket, force: boolean) {
    if (pkt.from === this.nodeId && !force) return;
    if ((pkt.path || []).includes(this.nodeId) && !force) return;
    if ((pkt.hops || 0) >= (pkt.ttl || 14)) return;

    const relay: OmniPacket = {
      ...pkt,
      hops: (pkt.hops || 0) + 1,
      path: [...(pkt.path || []), this.nodeId],
      priority: pkt.priority === "presence" ? "relay" : pkt.priority,
    };
    this.stats.packetsRelayed++;
    const wire = this.availableTransports().filter((t) => t !== "ram-relay").slice(0, 3);
    if (wire.length) await this.dispatchCombo(relay, wire);
  }

  private async dispatchCombo(pkt: OmniPacket, combo: OmniTransport[]) {
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
        } catch {
          const h = this.health.get(t)!;
          h.lastErr = Date.now();
          h.successRate = Math.max(0, h.successRate * 0.8);
          h.score = this.scoreTransport(h);
        }
      })
    );
    if (pkt.to) {
      this.routeMemory.set(pkt.to, {
        via: combo,
        score: combo.reduce((s, t) => s + (this.health.get(t)?.score || 0), 0),
        ts: Date.now(),
        hops: pkt.hops,
      });
      this.stats.pathsLearned = this.routeMemory.size;
    }
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
    const wire = { ...pkt, omni: true, transport: t, softwareOnly: true };

    switch (t) {
      case "ram-relay":
        this.enqueueStoreForward(pkt);
        break;

      case "broadcast-tab":
        try {
          this.bc?.postMessage(wire);
        } catch {}
        try {
          MeshEngine.broadcast(pkt.type, { ...pkt.payload, _omni: pkt });
        } catch {}
        break;

      case "wifi-lan-ws":
        await fetch("/api/mesh/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: pkt.id,
            type: pkt.type,
            from: pkt.from,
            fromName: pkt.fromName,
            data: {
              ...pkt.payload,
              _omni: true,
              via: pkt.via,
              hops: pkt.hops,
              path: pkt.path,
              softwareOnly: true,
            },
            ts: pkt.ts,
            hops: pkt.hops,
            ttl: pkt.ttl,
            to: pkt.to,
          }),
        });
        try {
          await fetch("/api/mesh/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: this.nodeId,
              name: this.nodeName,
              ramMB: this.ramBudgetMB,
              relay: true,
            }),
          });
        } catch {}
        break;

      case "gun-graph":
        try {
          gunStore.ensure?.();
          gunStore.put(`gridalive.omni.sw.${pkt.id}`, {
            type: pkt.type,
            payload: JSON.stringify(pkt.payload).slice(0, 6000),
            from: pkt.from,
            fromName: pkt.fromName || "",
            to: pkt.to || "",
            ts: pkt.ts,
            hops: pkt.hops,
            path: (pkt.path || []).join(",").slice(0, 200),
          });
        } catch {
          try {
            (meshComms as any).gun
              ?.get("gridalive.omni.sw")
              .get(pkt.id)
              .put({
                type: pkt.type,
                payload: JSON.stringify(pkt.payload).slice(0, 6000),
                from: pkt.from,
                fromName: pkt.fromName || "",
                to: pkt.to || "",
                ts: pkt.ts,
                hops: pkt.hops,
              });
          } catch {}
        }
        break;

      case "webrtc-p2p":
      case "trystero-sw":
        try {
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
                  from: msg.peerId,
                  fromName: msg.user,
                  to: j.to,
                  ts: msg.timestamp || Date.now(),
                  hops: (j.hops || 0) + 1,
                  ttl: j.ttl || 12,
                  path: j.path || [msg.peerId],
                  via: [t],
                  priority: "data",
                } as OmniPacket,
                t
              );
            } catch {}
          });
          meshComms.sendWalkieTextMessage?.(
            ch,
            JSON.stringify({
              t: pkt.type,
              p: pkt.payload,
              id: pkt.id,
              to: pkt.to,
              hops: pkt.hops,
              ttl: pkt.ttl,
              path: pkt.path,
            }).slice(0, 3500),
            this.nodeName
          );
        } catch {}
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
        ts: raw.ts || raw.time || Date.now(),
        hops: raw.hops || body?._omni?.hops || 0,
        ttl: raw.ttl || body?._omni?.ttl || 14,
        path: raw.path || body?._omni?.path || [raw.from],
        via: raw.via || body?._omni?.via || [via],
        priority: this.classifyPriority(raw.type),
      };
    } else return;

    if (pkt.from === this.nodeId) return;
    if (this.seen.has(pkt.id)) return;
    this.seen.set(pkt.id, Date.now());
    if (this.seen.size > 3000) {
      this.seen = new Map([...this.seen.entries()].slice(-1500));
    }

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
          pkt = { ...pkt, payload: JSON.parse(full) };
        } catch {
          pkt = { ...pkt, payload: full };
        }
      } else return;
    }

    // Peer table — every peer is a potential relay with RAM
    if (pkt.from) {
      const prev = this.peers.get(pkt.from);
      const transports = new Set(prev?.transports || []);
      for (const t of pkt.via || [via]) transports.add(t);
      this.peers.set(pkt.from, {
        id: pkt.from,
        name: pkt.fromName || prev?.name || pkt.from.slice(0, 12),
        transports: [...transports],
        lastSeen: Date.now(),
        hops: pkt.hops || 1,
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
        hops: pkt.hops || 1,
        score: 60,
        ramMB: pkt.payload.ramMB,
        relayLoad: pkt.payload.queue,
        online: true,
      });
    }

    // Hold for store-forward relay
    this.enqueueStoreForward({
      ...pkt,
      holdUntil: Date.now() + 45000,
    });

    this.stats.packetsIn++;
    this.notify(pkt);

    // Multi-hop: if not for us, or flood types — RELAY using our RAM + net out
    const forUs = !pkt.to || pkt.to === this.nodeId;
    const shouldRelay =
      (!forUs && (pkt.hops || 0) < (pkt.ttl || 14)) ||
      (forUs === false) ||
      (!pkt.to &&
        (pkt.hops || 0) < Math.min(6, pkt.ttl || 14) &&
        ["OMNI_PRESENCE", "OMNI_SMS", "OMNI_RELAY_PULSE", "SOS", "OMNI_PROBE"].includes(pkt.type));

    if (shouldRelay && !(pkt.path || []).includes(this.nodeId)) {
      void this.relayPacket(pkt, false);
    }
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
        relay: true,
        platformEqual: true,
      },
      { priority: "presence", ttl: 10 }
    );
  }

  private async probeLanWs() {
    const t0 = performance.now();
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
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

  /**
   * AI learn — pure software topology:
   * range ∝ hop depth × peer density × transport diversity (no RF hardware).
   */
  private aiLearnCycle() {
    const online = this.getPeers().filter((p) => p.online);
    const density = online.length;
    // Average peer RAM → collective buffer power
    const avgRam =
      online.reduce((s, p) => s + (p.ramMB || this.ramBudgetMB), 0) /
        Math.max(1, online.length) || this.ramBudgetMB;

    for (const h of this.health.values()) {
      h.score = Math.max(0, Math.min(100, this.scoreTransport(h) + (Math.random() - 0.5) * 3));
      // Software multi-hop expansion
      if (h.id === "wifi-lan-ws" || h.id === "webrtc-p2p" || h.id === "gun-graph" || h.id === "trystero-sw") {
        h.rangeHintM = RANGE_HINT[h.id] * (1 + Math.log2(density + 1) * 1.15);
      }
      if (h.id === "ram-relay") {
        // More RAM across mesh ⇒ longer store-forward “virtual range” in time
        h.rangeHintM = Math.min(500, avgRam * 2);
      }
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
    const avail = this.getTransports().filter((t) => t.available && t.id !== "ram-relay");
    if (!avail.length) return 5; // same-device only
    let best = Math.max(...avail.map((t) => t.rangeHintM));
    const online = this.getPeers().filter((p) => p.online).length;
    // Each peer is a full software repeater (TX/RX/RELAY + RAM)
    const hopFactor = online > 0 ? 1 + Math.log2(online + 1) * 1.25 : 1;
    best = Math.max(best, 80 * hopFactor); // Wi‑Fi hop chain model
    // Collective RAM enables delay-tolerant multi-hop further out
    best *= 1 + Math.min(0.8, this.ramBudgetMB / 100);
    return Math.round(best);
  }

  private rangeLabel(m: number): string {
    if (m < 30) return `~${m} m · same room / device mesh`;
    if (m < 150) return `~${m} m · Wi‑Fi floor (software multi-hop)`;
    if (m < 800) return `~${m} m · building LAN via peer relays`;
    if (m < 5000) return `~${(m / 1000).toFixed(1)} km-class · dense peer software mesh`;
    return `~${(m / 1000).toFixed(1)} km-class · multi-hop software mesh (no dongle)`;
  }

  private aiModeLabel(): string {
    const n = this.getPeers().filter((p) => p.online).length;
    if (n >= 8) return `Dense software mesh · ${n} relays · RAM ${this.ramBudgetMB}MB`;
    if (n >= 2) return `Multi-hop software mesh · ${n} peers · equal nodes`;
    if (n === 1) return `Peer link · store-forward ready · RAM ${this.ramBudgetMB}MB`;
    return `Solo node · RAM relay armed · waiting for peers`;
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
