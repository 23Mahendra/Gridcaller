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

import { bus } from "./bus.ts";
import { S } from "./storage.ts";
import { MeshEngine } from "./mesh.ts";
import freeMeshFabric from "./freeMeshFabric.ts";
import { setForceLocalMesh } from "./offlineMode.ts";
import { MeshRoutingTable } from "./meshRoutingTable.ts";
import { resolveTowerRelayPolicy, type TowerRelayPolicy } from "./towerRelayPolicy.ts";
import { pickBestRoute, type SmartRouteCandidate } from "./smartRouting.ts";
import { buildAdaptiveRelayPlan } from "./jamResistance.ts";
import {
  createRuntimeDiagnosticsState,
  persistRuntimeDiagnostics,
  recordHandshake,
  recordPeerSighting,
  recordProbe,
  recordProbeReceipt,
  recordRelay,
  recordSelfTestResult,
  syncPeerCount,
  updateNativeBridgeDiagnostics,
  type SoftTowerRuntimeDiagnostics,
} from "./softTowerDiagnostics.ts";
import {
  buildReplayEnvelope,
  decryptReplayEnvelope,
  enqueuePendingPacket,
  prunePendingPackets,
  shouldStoreForReplay,
  type PendingPacket,
} from "./meshReliability.ts";
import {
  addNativeMeshPacketListener,
  broadcastNativeMeshPacket,
  sendNativeMeshPacket,
  startNativeMeshEngine,
  stopNativeMeshEngine,
} from "../plugins/meshCallNative.ts";

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

export class SoftTowerHopNet {
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
  private policy: TowerRelayPolicy = { enabled: true, maxTtl: MAX_TTL, beaconMs: BEACON_MS, localOnly: true };
  private pendingPackets: PendingPacket[] = [];
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  private runtimeDiagnostics: SoftTowerRuntimeDiagnostics = createRuntimeDiagnosticsState();
  private nativeForwardedPackets = new Set<string>();
  private nativeListenerCleanup: (() => void) | null = null;

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
    this.policy = resolveTowerRelayPolicy(S);
    this.started = true;
    setForceLocalMesh(this.policy.localOnly !== false);
    updateNativeBridgeDiagnostics(this.runtimeDiagnostics, "idle", "starting native bridge");

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
    this.loadPendingPackets();

    try {
      freeMeshFabric.start(this.nodeName);
    } catch {}

    try {
      MeshEngine.start?.();
    } catch {}

    try {
      this.bc = new BroadcastChannel("gridcaller-soft-tower");
      this.bc.onmessage = (ev) => void this.ingest(ev.data, "bc-tab");
    } catch {}

    try {
      this.fabricBc = new BroadcastChannel("gridalive-free-fabric");
      this.fabricBc.onmessage = (ev) => {
        const d = ev.data;
        if (d?.type === "SOFT_TOWER_HOP" || d?.kind) void this.ingest(d.type === "SOFT_TOWER_HOP" ? d.data || d : d, "fabric-bc");
      };
    } catch {}

    MeshEngine.onMessage((msg: any) => {
      if (msg?.type === "SOFT_TOWER_HOP" && msg.data) {
        void this.ingest(msg.data, "wifi-lan");
      }
    });

    this.beaconTimer = setInterval(() => {
      this.pruneSeen();
      this.beacon();
      this.handshakeSweep();
      this.replayPendingPackets();
    }, this.policy.beaconMs || BEACON_MS);

    this.replayTimer = setInterval(() => {
      this.replayPendingPackets();
    }, 7000);

    this.installNativePacketListener();
    void this.bootstrapNativeBridge();
    this.beacon();
    bus.emit("softTowerHop:ready", { id: this.nodeId, name: this.nodeName });
    console.info("[SoftTowerHop] node online as soft cell tower ·", this.nodeId);
    return this;
  }

  stop() {
    this.started = false;
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    if (this.replayTimer) clearInterval(this.replayTimer);
    try {
      this.bc?.close();
    } catch {}
    try {
      this.fabricBc?.close();
    } catch {}
    try {
      this.nativeListenerCleanup?.();
      this.nativeListenerCleanup = null;
    } catch {}
    void stopNativeMeshEngine();
    updateNativeBridgeDiagnostics(this.runtimeDiagnostics, "stopped", "native bridge stopped");
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

  getRouteFor(targetId: string) {
    const candidates = this.routingTable.snapshot().filter((route) => route.targetId === targetId);
    return pickBestRoute(candidates as SmartRouteCandidate[], {
      battery: 0.7,
      signal: 0.7,
      stability: 0.8,
      transportScore: 0.8,
    });
  }

  getRuntimeDiagnostics() {
    syncPeerCount(this.runtimeDiagnostics, this.peers.size);
    const snapshot = { ...this.runtimeDiagnostics, peerRoutes: { ...this.runtimeDiagnostics.peerRoutes } };
    persistRuntimeDiagnostics(snapshot);
    return snapshot;
  }

  markSelfTestResult(status: "pass" | "fail" | "pending", detail?: string) {
    recordSelfTestResult(this.runtimeDiagnostics, status, detail);
    persistRuntimeDiagnostics(this.getRuntimeDiagnostics());
  }

  probeRelay() {
    const probeId = rid("probe");
    recordProbe(this.runtimeDiagnostics);
    const packet = {
      id: probeId,
      kind: "msg" as const,
      from: this.nodeId,
      fromName: this.nodeName,
      to: "",
      hops: 0,
      ttl: MAX_TTL,
      path: [this.nodeId],
      transportsTried: [] as HopTransport[],
      ts: Date.now(),
      payload: { text: `diag:${Date.now()}`, emergency: false },
    };
    this.flood(packet);
    return probeId;
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
    if (!this.policy.enabled) return;
    const pkt: HopPacket = {
      id: rid("bcn"),
      kind: "tower-beacon",
      from: this.nodeId,
      fromName: this.nodeName,
      hops: 0,
      ttl: Math.min(this.policy.maxTtl || MAX_TTL, 8),
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
        ttl: Math.min(this.policy.maxTtl || MAX_TTL, 10),
        path: [this.nodeId],
        transportsTried: [],
        ts: Date.now(),
        payload: { handshake: true, want: "relay" },
      };
      this.flood(pkt);
    }
  }

  /** Multi-hop text message (GridCaller SMS over soft towers) */
  sendMessage(
    to: string,
    text: string,
    toName?: string,
    opts?: {
      emergency?: boolean;
      urgency?: "normal" | "critical";
      lowBandwidth?: boolean;
      location?: { lat: number; lng: number } | null;
      kind?: "broadcast" | "sos" | "note" | "message";
    }
  ) {
    if (!text.trim()) return null;
    const id = rid("msg");
    const pkt: HopPacket = {
      id,
      kind: "msg",
      from: this.nodeId,
      fromName: this.nodeName,
      to,
      hops: 0,
      ttl: opts?.emergency ? Math.min(MAX_TTL + 4, 20) : MAX_TTL,
      path: [this.nodeId],
      transportsTried: [],
      ts: Date.now(),
      payload: {
        text: text.trim(),
        toName,
        phone: S.get("user_phone", ""),
        emergency: Boolean(opts?.emergency),
        disaster: opts?.emergency
          ? {
              kind: opts.kind || "message",
              priority: opts.urgency === "critical" ? "critical" : "normal",
              lowBandwidth: Boolean(opts.lowBandwidth),
              location: opts.location || undefined,
            }
          : undefined,
        resilience: opts?.emergency
          ? { urgency: opts.urgency || "critical", lowBandwidth: Boolean(opts.lowBandwidth) }
          : undefined,
      },
    };
    void this.protectPacket(pkt).then((protectedPkt) => {
      this.maybeQueueForReplay(protectedPkt);
      this.flood(protectedPkt);
    });
    bus.emit("softTowerHop:msg-sent", { id, to, text: text.trim(), emergency: Boolean(opts?.emergency) });
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
    const emergency = this.isEmergencyTraffic(pkt);
    if (emergency) {
      const plan = this.buildEmergencyPlan(pkt);
      if (plan.length) {
        for (const copy of plan) {
          const relayPacket = {
            ...pkt,
            payload: {
              ...pkt.payload,
              __jam: {
                channel: copy.channel,
                copyId: copy.id,
                delayMs: copy.delayMs,
                transportOrder: copy.transportOrder,
              },
            },
          };
          const transport = copy.transport as HopTransport;
          if (copy.delayMs > 0) {
            window.setTimeout(() => this.sendOn(transport, relayPacket), copy.delayMs);
          } else {
            this.sendOn(transport, relayPacket);
          }
        }
        return;
      }
    }

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

  private buildEmergencyPlan(pkt: HopPacket) {
    const isCritical = pkt.payload?.disaster?.priority === "critical" || pkt.payload?.resilience?.urgency === "critical";
    const linkQuality = typeof pkt.payload?.resilience?.linkQuality === "number"
      ? pkt.payload.resilience.linkQuality
      : 0.8;
    const interference = typeof pkt.payload?.resilience?.interferenceScore === "number"
      ? pkt.payload.resilience.interferenceScore
      : 0.25;

    const transports = this.permutationTransports().filter((t) => t !== "optical");
    const copies = isCritical ? 6 : 4;
    const plan = buildAdaptiveRelayPlan(
      { id: pkt.id, hops: pkt.hops || 0, ttl: pkt.ttl || MAX_TTL },
      transports,
      {
        copies,
        seed: `${this.nodeId}:${pkt.id}:${this.nodeName}`,
        urgency: isCritical ? "critical" : "normal",
        interferenceScore: interference,
        linkQuality,
        batteryBudget: 0.9,
      }
    );
    return plan;
  }

  private isEmergencyTraffic(pkt: HopPacket) {
    return Boolean(
      pkt.payload?.emergency ||
      pkt.payload?.disaster ||
      pkt.payload?.resilience?.urgency === "critical" ||
      pkt.payload?.resilience?.lowBandwidth
    );
  }

  private sendOn(t: HopTransport, pkt: HopPacket) {
    const wire = { ...pkt, transportsTried: [...(pkt.transportsTried || []), t] };
    this.maybeForwardToNativeBridge(wire);
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

  private async bootstrapNativeBridge() {
    const started = await startNativeMeshEngine();
    if (started) {
      updateNativeBridgeDiagnostics(this.runtimeDiagnostics, "ready", "native mesh bridge running");
      return;
    }
    updateNativeBridgeDiagnostics(this.runtimeDiagnostics, "unavailable", "native mesh bridge unavailable");
  }

  private installNativePacketListener() {
    try {
      this.nativeListenerCleanup?.();
    } catch {}
    this.nativeListenerCleanup = addNativeMeshPacketListener((event) => {
      const payloadText = this.decodeNativePacketPayload(event);
      if (!payloadText) return;
      const parsed = this.parseNativePacketPayload(payloadText);
      if (parsed) {
        void this.ingest(parsed, "wifi-lan");
      }
    });
  }

  private decodeNativePacketPayload(event: { payload?: string; payloadBase64?: string }) {
    const raw = event.payloadBase64 || event.payload || "";
    if (!raw) return "";
    try {
      if (typeof window !== "undefined" && typeof window.atob === "function" && event.payloadBase64) {
        return window.atob(event.payloadBase64);
      }
    } catch {}
    return typeof raw === "string" ? raw : "";
  }

  private parseNativePacketPayload(payloadText: string) {
    if (!payloadText) return null;
    try {
      const parsed = JSON.parse(payloadText);
      if (parsed?.type === "SOFT_TOWER_HOP" && parsed.data) {
        return parsed.data;
      }
      if (parsed?.kind && parsed?.from) {
        return parsed;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private maybeForwardToNativeBridge(pkt: HopPacket) {
    if (!pkt?.id || this.nativeForwardedPackets.has(pkt.id)) return;
    this.nativeForwardedPackets.add(pkt.id);
    const payload = JSON.stringify(pkt);
    if (pkt.to) {
      void sendNativeMeshPacket(pkt.to, payload);
    } else {
      void broadcastNativeMeshPacket(payload);
    }
  }

  private async ingest(raw: any, via: HopTransport) {
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

    const normalized = await this.unwrapPacket(pkt);
    if (normalized) {
      this.maybeQueueForReplay(normalized);
    }

    // Learn tower peer
    this.touchPeer(normalized.from, normalized.fromName || normalized.from, normalized.hops || 1, via, normalized.payload);
    this.learnRoute(normalized);

    // Deliver if for us or flood beacon
    const forUs = !normalized.to || normalized.to === this.nodeId || normalized.to === MeshEngine.localId;
    if (forUs) {
      this.stats.delivered++;
      if (normalized.payload?.text?.startsWith("diag:")) {
        recordProbeReceipt(this.runtimeDiagnostics);
      }
      this.deliver(normalized);
    }

    // Relay hop (soft tower behavior)
    const maxTtl = this.policy.maxTtl || MAX_TTL;
    if ((normalized.hops || 0) + 1 < (normalized.ttl || maxTtl) && !(normalized.path || []).includes(this.nodeId)) {
      // Don't relay if unicast and we delivered to self only? Still relay flood for density
      const shouldRelay = !normalized.to || !forUs || normalized.kind === "tower-beacon" || normalized.kind === "hello";
      // Always relay unicast until delivered widely — store-and-forward style
      if (shouldRelay || (normalized.to && !forUs) || (normalized.to && forUs)) {
        if (normalized.to && forUs && (normalized.kind === "msg" || normalized.kind === "call-signal")) {
          // delivered — still optional rebroadcast for redundant paths? skip msg rebroadcast to reduce storm
        } else {
          this.relay(normalized, via);
        }
        if (normalized.to && !forUs) this.relay(normalized, via);
      }
    }

    for (const fn of this.listeners) {
      try {
        fn(normalized);
      } catch {}
    }
  }

  private relay(pkt: HopPacket, via: HopTransport) {
    if ((pkt.path || []).includes(this.nodeId)) return;
    if ((pkt.hops || 0) + 1 >= (pkt.ttl || this.policy.maxTtl || MAX_TTL)) return;
    this.stats.relayed++;
    recordRelay(this.runtimeDiagnostics, pkt.from, pkt.fromName, `forwarded ${((pkt.hops || 0) + 1)} hop${(pkt.hops || 0) + 1 === 1 ? "" : "s"}`);
    const next: HopPacket = {
      ...pkt,
      hops: (pkt.hops || 0) + 1,
      path: [...(pkt.path || []), this.nodeId],
      transportsTried: [],
    };
    const transports = this.permutationTransports().filter((t) => t !== via);
    const list = transports.length ? transports : this.permutationTransports();
    const plan = buildAdaptiveRelayPlan(
      { id: pkt.id, hops: next.hops, ttl: next.ttl || MAX_TTL },
      list,
      {
        copies: Math.max(3, Math.min(7, list.length)),
        seed: `${this.nodeId}:${pkt.id}:${this.nodeName}`,
      }
    );

    for (const copy of plan) {
      const relayPacket = {
        ...next,
        payload: {
          ...next.payload,
          __jam: {
            channel: copy.channel,
            copyId: copy.id,
            delayMs: copy.delayMs,
            transportOrder: copy.transportOrder,
          },
        },
      };
      const transport = copy.transport as HopTransport;
      if (copy.delayMs > 0) {
        window.setTimeout(() => this.sendOn(transport, relayPacket), copy.delayMs);
      } else {
        this.sendOn(transport, relayPacket);
      }
    }
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
      if (pkt.kind === "hello") {
        recordHandshake(this.runtimeDiagnostics, pkt.from, pkt.fromName);
      }
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
    recordPeerSighting(this.runtimeDiagnostics, id, name, `sighted via ${via}`, via, hops, [this.nodeId, id]);
    this.peers.set(id, {
      id,
      name: name || prev?.name || id.slice(0, 10),
      hops: prev ? Math.min(prev.hops, hops || 1) : hops || 1,
      lastSeen: Date.now(),
      links: [...links],
      phone: payload?.phone || prev?.phone,
      isTower: true,
    });
    void this.replayPendingPackets(id);
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

  private loadPendingPackets() {
    try {
      const raw = S.get("gridcaller_soft_tower_pending", []);
      this.pendingPackets = Array.isArray(raw) ? raw : [];
      this.pendingPackets = prunePendingPackets(this.pendingPackets, Date.now());
    } catch {
      this.pendingPackets = [];
    }
  }

  private savePendingPackets() {
    try {
      S.set("gridcaller_soft_tower_pending", this.pendingPackets.slice(0, 24));
    } catch {}
  }

  private maybeQueueForReplay(pkt: HopPacket) {
    if (!shouldStoreForReplay(pkt, this.nodeId)) return;
    const entry: PendingPacket = {
      id: pkt.id,
      to: pkt.to,
      createdAt: Date.now(),
      expiresAt: Date.now() + 180000,
      attempts: 0,
      payload: pkt.payload,
      packet: pkt,
    };
    this.pendingPackets = enqueuePendingPacket(this.pendingPackets, entry);
    this.savePendingPackets();
  }

  private replayPendingPackets(peerId?: string) {
    this.pendingPackets = prunePendingPackets(this.pendingPackets, Date.now());
    if (!this.pendingPackets.length) return;
    const ready = this.pendingPackets.filter((entry) => !peerId || entry.to === peerId);
    for (const entry of ready) {
      const packet = entry.packet as HopPacket | undefined;
      if (!packet) continue;
      const replayPacket = {
        ...packet,
        ts: Date.now(),
        hops: Math.max(0, (packet.hops || 0) - 1),
        path: [...(packet.path || [])],
      } as HopPacket;
      this.flood(replayPacket);
      entry.attempts += 1;
      entry.expiresAt = Date.now() + 120000;
      if (entry.attempts >= 3) {
        this.pendingPackets = this.pendingPackets.filter((item) => item.id !== entry.id);
      }
    }
    this.savePendingPackets();
  }

  private async protectPacket(pkt: HopPacket): Promise<HopPacket> {
    const payload = pkt.payload;
    if (!payload || typeof payload !== "object") return pkt;
    const secret = String(S.get("gridcaller_transport_secret", "gridcaller-mesh"));
    const envelope = await buildReplayEnvelope(payload, this.nodeId, secret);
    return {
      ...pkt,
      payload: envelope,
    };
  }

  private async unwrapPacket(pkt: HopPacket): Promise<HopPacket> {
    const payload = pkt.payload;
    if (!payload || typeof payload !== "object") return pkt;
    const envelope = payload as { __encrypted?: boolean; __cipher?: string; __iv?: string; __body?: any };
    if (!envelope.__encrypted || !envelope.__cipher || !envelope.__iv) return pkt;
    const secret = String(S.get("gridcaller_transport_secret", "gridcaller-mesh"));
    const plain = await decryptReplayEnvelope(envelope, this.nodeId, secret);
    return {
      ...pkt,
      payload: plain,
    };
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
      void this.ingest(data, "optical");
      return true;
    } catch {
      return false;
    }
  }
}

export const softTowerHop = new SoftTowerHopNet();
export default softTowerHop;
