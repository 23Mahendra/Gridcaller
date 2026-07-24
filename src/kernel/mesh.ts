// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — MeshEngine
// Real multi-device bus: WebSocket /mesh-ws + HTTP publish/poll
// (APK cannot rely on BroadcastChannel alone)
// ═══════════════════════════════════════════════════════

import type { MeshEngineAPI } from "./types";
import { S } from "./storage";
import { resolveHubHttp, resolveMeshWsUrl, ensureHubDefaults } from "./meshHubConfig";
import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";
import { createPendingOutboundMessage, shouldRetryPendingOutboundMessage, type PendingOutboundMessage } from "../lib/meshReliability";
import { createLocalMeshEnvelope, readLocalMeshEnvelope } from "./serverlessMesh";

let meshBC: BroadcastChannel | null = null;
let meshBCListenerAttached = false;
let meshWs: WebSocket | null = null;
let meshWsTimer: ReturnType<typeof setTimeout> | null = null;
let meshConnected = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollAfter = 0;
let lastRegister = 0;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectAttempt = 0;
let pendingOutbound: PendingOutboundMessage[] = [];
let pendingOutboundTimer: ReturnType<typeof setInterval> | null = null;

try {
  meshBC = new BroadcastChannel("gridalive-mesh");
} catch {}

function meshHubHttp(): string {
  return resolveHubHttp();
}

function meshWsUrl(): string {
  return resolveMeshWsUrl();
}

function deliverToListeners(engine: any, m: any) {
  if (!m) return;
  // Never deliver our own outbound as inbound (self-call / self-msg bug)
  if (m.from && m.from === engine.localId) return;
  if (m.from) {
    engine.peers = engine.peers || {};
    engine.peers[m.from] = {
      ...(engine.peers[m.from] || {}),
      name: m.fromName || m.data?.fromName || m.data?.name || m.from,
      lastSeen: Date.now(),
    };
  }
  const list = (engine.listeners || []) as any[];
  for (const f of list) {
    try {
      f(m);
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

async function httpRegister(engine: any) {
  const now = Date.now();
  if (now - lastRegister < 2500) return;
  lastRegister = now;
  const hub = meshHubHttp();
  const id = engine.localId;
  const ident = myIdentity();
  try {
    const r = await fetch(`${hub}/api/mesh/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: ident.name,
        handle: ident.handle,
        phone: ident.phone,
        displayNumber: ident.displayNumber,
        hasLlm: false,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = await r.json();
      engine.peers = engine.peers || {};
      // Seed peers from register response (instant handshake)
      if (Array.isArray(j.others)) {
        for (const p of j.others) {
          if (!p?.id || p.id === id) continue;
          engine.peers[p.id] = {
            name: p.name || p.handle || p.id,
            handle: p.handle,
            phone: p.phone,
            lastSeen: p.lastSeen || Date.now(),
          };
        }
      }
      try {
        window.dispatchEvent(
          new CustomEvent("gc-mesh-status", {
            detail: {
              connected: true,
              url: hub,
              via: "http-register",
              peers: Object.keys(engine.peers).length,
            },
          })
        );
      } catch {}
    }
  } catch {
    /* offline */
  }
}

async function httpPoll(engine: any) {
  const hub = meshHubHttp();
  const ident = myIdentity();
  try {
    const q = new URLSearchParams({
      after: String(pollAfter),
      id: engine.localId,
    });
    if (ident.handle) q.set("handle", ident.handle);
    if (ident.phone) q.set("phone", ident.phone);
    const r = await fetch(`${hub}/api/mesh/poll?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.messages)) {
      for (const e of j.messages) {
        if (e.seq > pollAfter) pollAfter = e.seq;
        if (e.msg) {
          // HELLO → peer table
          if (e.msg.type === "PEER_HELLO" || e.msg.type === "PEER_ANNOUNCE") {
            const pid = e.msg.from || e.msg.data?.id;
            if (pid && pid !== engine.localId) {
              engine.peers = engine.peers || {};
              engine.peers[pid] = {
                name: e.msg.fromName || e.msg.data?.name || pid,
                handle: e.msg.data?.handle,
                phone: e.msg.data?.phone,
                lastSeen: Date.now(),
              };
            }
          }
          deliverToListeners(engine, e.msg);
        }
      }
    }
    // Advance only to what we received (hub advanceTo = max batch seq). Never skip offers.
    if (typeof j.advanceTo === "number" && j.advanceTo > pollAfter) {
      pollAfter = j.advanceTo;
    }
    if (Array.isArray(j.peers)) {
      engine.peers = engine.peers || {};
      for (const p of j.peers) {
        if (!p?.id || p.id === engine.localId) continue;
        engine.peers[p.id] = {
          name: p.name || p.handle || p.id,
          handle: p.handle,
          phone: p.phone,
          displayNumber: p.displayNumber,
          lastSeen: p.lastSeen || Date.now(),
        };
      }
    }
    // Hub reachable via HTTP poll (APK path)
    if (j.ok || (j.peers && j.peers.length) || (j.messages && j.messages.length)) {
      try {
        window.dispatchEvent(
          new CustomEvent("gc-mesh-status", {
            detail: {
              connected: true,
              url: hub,
              via: "http-poll",
              peers: Object.keys(engine.peers || {}).length,
            },
          })
        );
      } catch {}
    }
  } catch {
    /* offline */
  }
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
  for (const entry of [...pendingOutbound]) {
    if (entry.status === "sent") continue;
    if (!shouldRetryPendingOutboundMessage(entry, now)) continue;
    entry.lastAttemptAt = now;
    entry.attempts += 1;
    savePendingOutbound();
    try {
      if (meshWs && meshWs.readyState === WebSocket.OPEN) {
        meshWs.send(JSON.stringify(entry.payload));
      }
    } catch {}
    try {
      const hub = meshHubHttp();
      fetch(`${hub}/api/mesh/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.payload),
      }).catch(() => {});
    } catch {}
    if (entry.attempts >= 6) {
      entry.status = "sent";
      savePendingOutbound();
    }
  }
}

function startHttpBus(engine: any) {
  if (pollTimer) return;
  pendingOutbound = (S.get("mesh_pending_outbound", []) || []) as PendingOutboundMessage[];
  if (!pendingOutboundTimer) {
    pendingOutboundTimer = setInterval(() => flushPendingOutbound(engine, Date.now()), 2500);
  }
  void httpRegister(engine);
  void httpPoll(engine);
  // Fast poll so call signaling (OFFER/ANSWER/ICE) arrives quickly on 2 phones
  pollTimer = setInterval(() => {
    void httpRegister(engine);
    void httpPoll(engine);
  }, 500);
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
        void httpRegister(engine);
      } catch {}
      console.info("[MeshEngine] REAL hub WS connected", url);
      try {
        window.dispatchEvent(new CustomEvent("gc-mesh-status", { detail: { connected: true, url } }));
      } catch {}
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data));
        if (m.type === "WELCOME" && Array.isArray(m.data?.peers)) {
          for (const p of m.data.peers) {
            if (!p?.id || p.id === engine.localId) continue;
            engine.peers = engine.peers || {};
            engine.peers[p.id] = { name: p.name || p.id, lastSeen: Date.now() };
          }
          return;
        }
        if (m.type === "PEER_ANNOUNCE") {
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
    console.warn("[MeshEngine] mesh-ws failed", e, url);
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
      const secret = String(S.get("mesh_secret") || S.get("mesh_id") || this.localId || "gridcaller");
      const msg = {
        type,
        data: base,
        from: this.localId,
        fromName,
        time: Date.now(),
        ts: Date.now(),
        encrypted: false,
      };
      const envelope = createLocalMeshEnvelope(msg, secret);
      queuePendingOutbound(msg);
      // 1) same-origin tabs only
      try {
        meshBC?.postMessage(msg);
      } catch {}
      // 2) WebSocket hub
      try {
        if (meshWs && meshWs.readyState === WebSocket.OPEN) {
          meshWs.send(JSON.stringify(msg));
        }
      } catch {}
      // 3) HTTP publish → hub bus (critical for APK when WS is dead)
      try {
        const hub = meshHubHttp();
        fetch(`${hub}/api/mesh/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg),
        }).catch(() => {});
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
    if (!meshWs || meshWs.readyState > 1) {
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
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
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
    connectMeshWs(this as any);
    startHttpBus(this as any);
  },

  isConnected() {
    return (
      (meshConnected && !!meshWs && meshWs.readyState === WebSocket.OPEN) ||
      pollAfter > 0
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
    connectMeshWs(this as any);
    startHttpBus(this as any);
  },
} as any;

// Auto-connect
try {
  if (typeof window !== "undefined") {
    ensureHubDefaults();
    setTimeout(() => {
      connectMeshWs(MeshEngine as any);
      startHttpBus(MeshEngine as any);
    }, 300);
  }
} catch {}
