export type SoftTowerRuntimeEvent = {
  kind: "peer" | "relay" | "probe" | "handshake" | "self-test";
  at: number;
  peerId?: string;
  peerName?: string;
  detail?: string;
};

export type PeerRouteHistory = {
  peerId: string;
  peerName?: string;
  firstSightedAt: number;
  lastSeenAt: number;
  hops: number;
  relayCount: number;
  lastPath: string[];
  lastTransport?: string;
  handshakeState: "none" | "seen" | "handshaken";
};

export type SoftTowerRuntimeDiagnostics = {
  peerSightings: number;
  relayEvents: number;
  peerCount: number;
  probeCount: number;
  probeReceipts: number;
  handshakeEvents: number;
  lastPeerSeenAt: number;
  lastRelayAt: number;
  lastProbeAt: number;
  lastProbeReceiptAt: number;
  lastHandshakeAt: number;
  lastHandshakePeerId: string;
  lastHandshakePeerName: string;
  recentEvents: SoftTowerRuntimeEvent[];
  peerRoutes: Record<string, PeerRouteHistory>;
  lastSelfTestStatus?: "pass" | "fail" | "pending";
  lastSelfTestDetail?: string;
  lastSelfTestAt?: number;
  nativeBridgeStatus?: "idle" | "ready" | "stopped" | "unavailable" | "error";
  nativeBridgeDetail?: string;
  nativeBridgeSeenAt?: number;
};

const STORAGE_KEY = "gridcaller_soft_tower_diagnostics";
const memoryStore = new Map<string, string>();

function readStoredDiagnostics(): string | null {
  try {
    if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
      return window.localStorage.getItem(STORAGE_KEY);
    }
  } catch {}
  return memoryStore.get(STORAGE_KEY) ?? null;
}

function writeStoredDiagnostics(value: string) {
  try {
    if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, value);
      return;
    }
  } catch {}
  memoryStore.set(STORAGE_KEY, value);
}

export function createRuntimeDiagnosticsState(): SoftTowerRuntimeDiagnostics {
  return {
    peerSightings: 0,
    relayEvents: 0,
    peerCount: 0,
    probeCount: 0,
    probeReceipts: 0,
    handshakeEvents: 0,
    lastPeerSeenAt: 0,
    lastRelayAt: 0,
    lastProbeAt: 0,
    lastProbeReceiptAt: 0,
    lastHandshakeAt: 0,
    lastHandshakePeerId: "",
    lastHandshakePeerName: "",
    recentEvents: [],
    peerRoutes: {},
    lastSelfTestStatus: "pending",
    lastSelfTestDetail: "",
    lastSelfTestAt: 0,
    nativeBridgeStatus: "idle",
    nativeBridgeDetail: "",
    nativeBridgeSeenAt: 0,
  };
}

export function updateNativeBridgeDiagnostics(
  state: SoftTowerRuntimeDiagnostics,
  status: "idle" | "ready" | "stopped" | "unavailable" | "error",
  detail?: string,
) {
  state.nativeBridgeStatus = status;
  state.nativeBridgeDetail = detail || "";
  state.nativeBridgeSeenAt = Date.now();
}

export function recordPeerSighting(
  state: SoftTowerRuntimeDiagnostics,
  peerId?: string,
  peerName?: string,
  detail?: string,
  transport?: string,
  hops?: number,
  path?: string[],
) {
  state.peerSightings += 1;
  state.lastPeerSeenAt = Date.now();
  if (peerId) {
    const existing = state.peerRoutes[peerId] || {
      peerId,
      peerName: peerName || peerId,
      firstSightedAt: state.lastPeerSeenAt,
      lastSeenAt: state.lastPeerSeenAt,
      hops: hops || 0,
      relayCount: 0,
      lastPath: path || [peerId],
      lastTransport: transport,
      handshakeState: "seen",
    };
    state.peerRoutes[peerId] = {
      ...existing,
      peerId,
      peerName: peerName || existing.peerName || peerId,
      lastSeenAt: state.lastPeerSeenAt,
      hops: hops !== undefined ? Math.min(hops, 99) : existing.hops,
      lastPath: path && path.length ? path : existing.lastPath,
      lastTransport: transport || existing.lastTransport,
      handshakeState: existing.handshakeState === "handshaken" ? "handshaken" : "seen",
    };
  }
  state.recentEvents = [
    { kind: "peer", at: state.lastPeerSeenAt, peerId, peerName, detail: detail || "sighted" },
    ...state.recentEvents,
  ].slice(0, 12);
}

export function recordRelay(
  state: SoftTowerRuntimeDiagnostics,
  peerId?: string,
  peerName?: string,
  detail?: string,
) {
  state.relayEvents += 1;
  state.lastRelayAt = Date.now();
  if (peerId) {
    const existing = state.peerRoutes[peerId] || {
      peerId,
      peerName: peerName || peerId,
      firstSightedAt: state.lastRelayAt,
      lastSeenAt: state.lastRelayAt,
      hops: 0,
      relayCount: 0,
      lastPath: [peerId],
      lastTransport: undefined,
      handshakeState: "none",
    };
    state.peerRoutes[peerId] = {
      ...existing,
      peerId,
      peerName: peerName || existing.peerName || peerId,
      relayCount: existing.relayCount + 1,
      lastSeenAt: state.lastRelayAt,
    };
  }
  state.recentEvents = [
    { kind: "relay", at: state.lastRelayAt, peerId, peerName, detail: detail || "relayed" },
    ...state.recentEvents,
  ].slice(0, 12);
}

export function syncPeerCount(state: SoftTowerRuntimeDiagnostics, count: number) {
  state.peerCount = count;
}

export function recordProbe(state: SoftTowerRuntimeDiagnostics) {
  state.probeCount += 1;
  state.lastProbeAt = Date.now();
}

export function recordProbeReceipt(state: SoftTowerRuntimeDiagnostics) {
  state.probeReceipts += 1;
  state.lastProbeReceiptAt = Date.now();
}

export function recordHandshake(state: SoftTowerRuntimeDiagnostics, peerId: string, peerName?: string) {
  state.handshakeEvents += 1;
  state.lastHandshakeAt = Date.now();
  state.lastHandshakePeerId = peerId;
  state.lastHandshakePeerName = peerName || "Peer";
  const existing = state.peerRoutes[peerId] || {
    peerId,
    peerName: peerName || peerId,
    firstSightedAt: state.lastHandshakeAt,
    lastSeenAt: state.lastHandshakeAt,
    hops: 0,
    relayCount: 0,
    lastPath: [peerId],
    lastTransport: undefined,
    handshakeState: "none",
  };
  state.peerRoutes[peerId] = {
    ...existing,
    peerId,
    peerName: peerName || existing.peerName || peerId,
    lastSeenAt: state.lastHandshakeAt,
    handshakeState: "handshaken",
  };
  state.recentEvents = [
    { kind: "handshake", at: state.lastHandshakeAt, peerId, peerName: peerName || "Peer", detail: "hello" },
    ...state.recentEvents,
  ].slice(0, 12);
}

export function appendRecentEvent(state: SoftTowerRuntimeDiagnostics, event: SoftTowerRuntimeEvent) {
  state.recentEvents = [{ ...event }, ...state.recentEvents].slice(0, 12);
}

export function recordSelfTestResult(state: SoftTowerRuntimeDiagnostics, status: "pass" | "fail" | "pending", detail?: string) {
  state.lastSelfTestStatus = status;
  state.lastSelfTestDetail = detail || "";
  state.lastSelfTestAt = Date.now();
  state.recentEvents = [
    { kind: "self-test", at: state.lastSelfTestAt, detail: `${status}:${detail || "self-test"}` },
    ...state.recentEvents,
  ].slice(0, 12);
}

export function persistRuntimeDiagnostics(state: SoftTowerRuntimeDiagnostics) {
  try {
    const payload = JSON.stringify({
      ...state,
      recentEvents: state.recentEvents.slice(0, 50),
      peerRoutes: Object.fromEntries(Object.entries(state.peerRoutes).slice(0, 50)),
    });
    writeStoredDiagnostics(payload);
  } catch {}
}

export function loadPersistedRuntimeDiagnostics(): SoftTowerRuntimeDiagnostics {
  try {
    const raw = readStoredDiagnostics();
    if (!raw) return createRuntimeDiagnosticsState();
    const parsed = JSON.parse(raw);
    const state = createRuntimeDiagnosticsState();
    return {
      ...state,
      ...parsed,
      recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : [],
      peerRoutes: parsed.peerRoutes && typeof parsed.peerRoutes === "object" ? parsed.peerRoutes : {},
      lastSelfTestStatus: parsed.lastSelfTestStatus || "pending",
      lastSelfTestDetail: parsed.lastSelfTestDetail || "",
      lastSelfTestAt: parsed.lastSelfTestAt || 0,
      nativeBridgeStatus: parsed.nativeBridgeStatus || "idle",
      nativeBridgeDetail: parsed.nativeBridgeDetail || "",
      nativeBridgeSeenAt: parsed.nativeBridgeSeenAt || 0,
    };
  } catch {
    return createRuntimeDiagnosticsState();
  }
}
