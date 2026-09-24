// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — MeshEngine
// Local-first multi-device mesh bus.
// Browser tabs use BroadcastChannel; device-to-device swarm uses Trystero;
// an explicitly enabled self-hosted LAN hub may be used as an optional bridge.
// ═══════════════════════════════════════════════════════

import type { MeshEngineAPI } from "./types";
import { S } from "./storage";
import { resolveHubHttp, resolveMeshWsUrl, ensureHubDefaults } from "./meshHubConfig";
import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";
import {
  PENDING_OUTBOUND_MAX_AGE_MS,
  createPendingOutboundMessage,
  shouldRetryPendingOutboundMessage,
  type PendingOutboundMessage,
} from "../lib/meshReliability";
import { createLocalMeshEnvelope, readLocalMeshEnvelope } from "./serverlessMesh";
import { iceServersForMesh, useLocalMeshOnly } from "./offlineMode";

let meshBC: BroadcastChannel | null = null;
let meshBCListenerAttached = false;
let meshWs: WebSocket | null = null;
let meshWsTimer: ReturnType<typeof setTimeout> | null = null;
let meshConnected = false;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectAttempt = 0;
let pendingOutbound: PendingOutboundMessage[] = [];
let pendingOutboundTimer: ReturnType<typeof setInterval> | null = null;
let lastWsFailureLogAt = 0;

try {
  meshBC = new BroadcastChannel("gridalive-mesh");
} catch {}

function meshHubHttp(): string {
  return resolveHubHttp();
}

function meshWsUrl(): string {
  return resolveMeshWsUrl();
}

function localHubExplicitlyAllowed() {
  return S.get("gc_allow_local_hub", false) === true;
}

function shouldUseLocalHub() {
  return localHubExplicitlyAllowed();
}

function getMeshSecret(engine: any) {
  return String(S.get("mesh_secret") || S.get("mesh_id") || engine?.localId || "gridcaller");
}

function unwrapMeshEnvelope(raw: any, engine: any) {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.kind === "mesh-envelope" || raw.type === "mesh-envelope") {
    try {
      const decoded = readLocalMeshEnvelope(raw, getMeshSecret(engine));
      if (decoded && typeof decoded === "object") return decoded;
    } catch {}
  }
  return raw;
}

function deliverToListeners(engine: any, m: any) {
  if (!m) return;
  const payload = unwrapMeshEnvelope(m, engine);
  if (!payload || typeof payload !== "object") return;
  // Never deliver our own outbound as inbound (self-call / self-msg bug)
  if (payload.from && payload.from === engine.localId) return;
  if (payload.from) {
    engine.peers = engine.peers || {};
    engine.peers[payload.from] = {
      ...(engine.peers[payload.from] || {}),
      name: payload.fromName || payload.data?.fromName || payload.data?.name || payload.from,
      lastSeen: Date.now(),
    };
  }
  const list = (engine.listeners || []) as any[];
  for (const f of list) {
    try {
      f(payload);
    } catch (err) {
      console.warn("[MeshEngine] listener error", err);
    }
  }
}

function myIdentity() {
  const name = S.get("mesh_name") || S.get("user_name") || "GridUser";
  const handle = String(S.get("global_call_handle", "") || "")
    .trim()
    .replace(/^@/, "");
  const phone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
  const displayNumber =
    String(S.get("gc_test_display_number", "") || "").trim() || handle || phone;
  return { name, handle, phone, displayNumber };
}

function logMeshWsFailure(error: unknown, url: string) {
  const now = Date.now();
  if (now - lastWsFailureLogAt < 30000) return;
  lastWsFailureLogAt = now;
  console.warn("[MeshEngine] mesh-ws failed", error, url);
}

function savePendingOutbound() {
  try {
    S.set("mesh_pending_outbound", pendingOutbound.slice(0, 200));
  } catch {}
}

function queuePendingOutbound(msg: any) {
  const entry = createPendingOutboundMessage({
    id: msg.id || `${msg.type}:${Date.now()}`,
    type: msg.type,
    payload: msg,
    createdAt: Date.now(),
  });
  const existing = pendingOutbound.find((item) => item.id === entry.id);
  if (existing) {
    existing.payload = entry.payload;
    existing.attempts = Math.max(existing.attempts, 1);
    existing.status = "pending";
  } else {
    pendingOutbound.unshift(entry);
  }
  savePendingOutbound();
}

function flushPendingOutbound(engine: any, now = Date.now()) {
  if (!pendingOutbound.length) return;
  const pruned = pendingOutbound.filter(
    (entry) => entry.status !== "sent" && now - entry.createdAt <= PENDING_OUTBOUND_MAX_AGE_MS
  );
  if (pruned.length !== pendingOutbound.length) {
    pendingOutbound = pruned;
    savePendingOutbound();
  }

  for (const entry of [...pendingOutbound]) {
    if (entry.status === "sent" || !shouldRetryPendingOutboundMessage(entry, now)) continue;
    entry.lastAttemptAt = now;
    entry.attempts += 1;
    try {
      if (meshWs && meshWs.readyState === WebSocket.OPEN) {
        meshWs.send(JSON.stringify(entry.payload));
        entry.status = "sent";
      }
    } catch {}
  }
  savePendingOutbound();
}
function startHttpBus(engine: any) {
  // No HTTP publish/poll path in the core. Pending messages are flushed only
  // through an explicitly enabled self-hosted WebSocket hub.
  if (!shouldUseLocalHub()) return;
  pendingOutbound = (S.get("mesh_pending_outbound", []) || []) as PendingOutboundMessage[];
  if (!pendingOutboundTimer) {
    pendingOutboundTimer = setInterval(() => flushPendingOutbound(engine, Date.now()), 2500);
  }
}

function connectMeshWs(engine: any) {
  if (typeof WebSocket === "undefined") return;
  ensureHubDefaults();
  startHttpBus(engine);
  try {
    meshWs?.close();
  } catch {}
  const url = meshWsUrl();
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  try {
    const ws = new WebSocket(url);
    meshWs = ws;
    ws.onopen = () => {
      meshConnected = true;
      wsReconnectAttempt = 0;
      flushPendingOutbound(engine, Date.now());
      try {
        const name = S.get("mesh_name") || S.get("user_name") || engine.localId;
        ws.send(JSON.stringify({ type: "HELLO", id: engine.localId, name }));
        // Presence is carried by the normal MeshEngine broadcast path.
      } catch {}
      console.info("[MeshEngine] optional local hub WS connected", url);
      try {
        window.dispatchEvent(new CustomEvent("gc-mesh-status", { detail: { connected: true, url } }));
      } catch {}
    };
    ws.onmessage = (ev) => {
      try {
        const raw = JSON.parse(String(ev.data));
        const m = unwrapMeshEnvelope(raw, engine);
        if (m?.type === "WELCOME" && Array.isArray(m.data?.peers)) {
          for (const p of m.data.peers) {
            if (!p?.id || p.id === engine.localId) continue;
            engine.peers = engine.peers || {};
            engine.peers[p.id] = { name: p.name || p.id, lastSeen: Date.now() };
          }
          return;
        }
        if (m?.type === "PEER_ANNOUNCE") {
          const id = m.from || m.data?.id;
          if (id && id !== engine.localId) {
            engine.peers = engine.peers || {};
            engine.peers[id] = {
              name: m.fromName || m.data?.name || id,
              lastSeen: Date.now(),
            };
          }
        }
        deliverToListeners(engine, m);
      } catch {}
    };
    ws.onclose = () => {
      meshConnected = false;
      meshWs = null;
      try {
        window.dispatchEvent(new CustomEvent("gc-mesh-status", { detail: { connected: false, url } }));
      } catch {}
      if (meshWsTimer) clearTimeout(meshWsTimer);
      const backoff = Math.min(15000, 2500 * Math.pow(2, wsReconnectAttempt));
      wsReconnectAttempt += 1;
      meshWsTimer = setTimeout(() => connectMeshWs(engine), backoff);
    };
    ws.onerror = () => {
      meshConnected = false;
    };
  } catch (e) {
    logMeshWsFailure(e, url);
    meshConnected = false;
    if (meshWsTimer) clearTimeout(meshWsTimer);
    const backoff = Math.min(20000, 3000 * Math.pow(2, wsReconnectAttempt));
    wsReconnectAttempt += 1;
    meshWsTimer = setTimeout(() => connectMeshWs(engine), backoff);
  }
}

export const MeshEngine: MeshEngineAPI = {
  peers: {},
  localId:
    S.get("mesh_id") ||
    (() => {
      const id =
        "user_" +
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 8));
      S.set("mesh_id", id);
      return id;
    })(),
  listeners: [] as ((msg: any) => void)[],

  broadcast(type: string, data: any) {
    try {
      const fromName = S.get("mesh_name") || S.get("user_name") || this.localId;
      const handle = String(S.get("global_call_handle", "") || "").trim();
      const phone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
      const base = data && typeof data === "object" ? { ...data } : { value: data };
      if (!base.handle && handle) base.handle = handle;
      if (!base.phone && phone) base.phone = phone;
      const secret = getMeshSecret(this);
      const msg = {
        type,
        data: base,
        from: this.localId,
        fromName,
        time: Date.now(),
        ts: Date.now(),
        encrypted: true,
      };
      const envelope = createLocalMeshEnvelope(msg, secret);
      queuePendingOutbound(envelope);
      // 1) same-origin tabs only
      try {
        meshBC?.postMessage(envelope);
      } catch {}
      // 2) Optional local/self-hosted WebSocket hub (never required)
      try {
        if (meshWs && meshWs.readyState === WebSocket.OPEN) {
          meshWs.send(JSON.stringify(envelope));
        }
      } catch {}
      // 3) No remote HTTP publish in the free peer-first core.\n      // 4) Trystero swarm — serverless relay when hub is unavailable
      //    Every device is a node; no central server required.
      try {
        (window as any).__gc_trystero_relay?.(type, base, this.localId, fromName);
      } catch {}
      // DO NOT deliver outbound to local listeners (that was self-msg / self-call)
    } catch (e) {
      console.warn("[MeshEngine] broadcast failed", type, e);
    }
  },

  onMessage(fn: (msg: any) => void) {
    if (typeof fn !== "function") return () => {};
    if (!(this as any).listeners) (this as any).listeners = [];
    (this as any).listeners.push(fn);
    if (meshBC && !meshBCListenerAttached) {
      meshBCListenerAttached = true;
      meshBC.addEventListener("message", (e: any) => {
        try {
          deliverToListeners(this as any, e.data);
        } catch {}
      });
    }
    if (shouldUseLocalHub() && (!meshWs || meshWs.readyState > 1)) {
      connectMeshWs(this as any);
    }
    startHttpBus(this as any);
    return () => {
      try {
        (this as any).listeners = ((this as any).listeners || []).filter((f: any) => f !== fn);
      } catch {}
    };
  },

  initWebRTC() {
    if (typeof RTCPeerConnection === "undefined") return null;
    if (!tryBeginPeerConnection()) return null;
    try {
      const pc = new RTCPeerConnection({
        iceServers: iceServersForMesh(),
      });
      const originalClose = pc.close.bind(pc);
      pc.close = () => {
        endPeerConnection();
        return originalClose();
      };
      return pc;
    } catch {
      endPeerConnection();
      return null;
    }
  },

  start() {
    ensureHubDefaults();
    if (meshWsTimer) clearTimeout(meshWsTimer);
    wsReconnectAttempt = 0;
    // Keep MeshEngine.localId in sync with settings mesh_id
    try {
      const mid = S.get("mesh_id", "");
      if (mid && mid !== this.localId) {
        (this as any).localId = mid;
      }
    } catch {}
    if (shouldUseLocalHub()) connectMeshWs(this as any);
    startHttpBus(this as any);
  },

  isConnected() {
    return (
(meshConnected && !!meshWs && meshWs.readyState === WebSocket.OPEN)
    );
  },

  getHubUrl() {
    return meshHubHttp();
  },

  getWsUrl() {
    return meshWsUrl();
  },

  reconnect() {
    ensureHubDefaults();
    if (meshWsTimer) clearTimeout(meshWsTimer);
    wsReconnectAttempt = 0;
    if (!useLocalMeshOnly() || S.get("gc_allow_local_hub", false) === true) connectMeshWs(this as any);
    startHttpBus(this as any);
  },
} as any;

// Auto-connect
try {
  if (typeof window !== "undefined") {
    ensureHubDefaults();
    setTimeout(() => {
      if (shouldUseLocalHub()) {
        connectMeshWs(MeshEngine as any);
      }
      startHttpBus(MeshEngine as any);
    }, 300);
  }
} catch {}
