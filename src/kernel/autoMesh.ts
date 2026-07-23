/**
 * AutoMesh — install GridCaller → phone automatically joins the mesh.
 *
 * No per-device "Connect" for other GridCaller phones.
 * Discovery paths (all start on launch):
 *  1) Hub LAN (WS + HTTP poll/publish) — same Wi‑Fi as PC hub
 *  2) Trystero global room — internet, no hub needed for discovery
 *  3) Soft-tower hop beacon — multi-hop relay via any online peer
 *
 * Honesty: Android still requires one-time OS grants (Location / Nearby /
 * Bluetooth) so the OS can expose GPS + radios. After that, peers join
 * automatically — we do NOT do silent no-permission radio penetration.
 */

import { joinRoom, type Room } from "trystero";
import { MeshEngine } from "./mesh";
import { S } from "./storage";
import { ensureMeshIdentity, getMeshHandle } from "../mesh/identity";
import { ensureHubDefaults, resolveHubHttp, probeHub } from "./meshHubConfig";
import softTowerHop from "./softTowerHopNet";
import freeMeshFabric from "./freeMeshFabric";

export const AUTO_MESH_APP_ID = "gridcaller-auto-mesh-v1";
export const AUTO_MESH_ROOM = "gridcaller-global";

export type AutoMeshPeer = {
  id: string;
  name: string;
  lastSeen: number;
  via: string[];
  lat?: number;
  lng?: number;
  phone?: string;
  displayNumber?: string;
  hops?: number;
  online: boolean;
};

export type AutoMeshStatus = {
  started: boolean;
  hubOk: boolean;
  hubUrl: string;
  trysteroOk: boolean;
  peerCount: number;
  localId: string;
  localName: string;
  note: string;
};

type PresencePayload = {
  type: "AM_PRESENCE" | "AM_LOCATION" | "AM_RELAY" | "AM_HELLO";
  id: string;
  name: string;
  phone?: string;
  displayNumber?: string;
  lat?: number;
  lng?: number;
  hops?: number;
  ts: number;
  /** Nested mesh envelope for hop relay */
  envelope?: any;
};

const STALE_MS = 55000;
const PRESENCE_MS = 3500;
const HUB_PROBE_MS = 8000;

let started = false;
let trysteroRoom: Room | null = null;
let trySend: ((data: PresencePayload, peerId?: string) => void) | null = null;
let announceTimer: ReturnType<typeof setInterval> | null = null;
let hubProbeTimer: ReturnType<typeof setInterval> | null = null;
let announceBackoffMs = 3500;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let hubOk = false;
let trysteroOk = false;
let lastGps: { lat: number; lng: number } | null = null;

const peers = new Map<string, AutoMeshPeer>();
const listeners = new Set<(peers: AutoMeshPeer[]) => void>();
const statusListeners = new Set<(s: AutoMeshStatus) => void>();
const locationListeners = new Set<(p: AutoMeshPeer) => void>();

function localName(): string {
  return (
    String(S.get("user_name", "") || "").trim() ||
    String(S.get("mesh_name", "") || "").trim() ||
    "GridUser"
  );
}

function ensureIdentitySeed() {
  const identity = ensureMeshIdentity();
  if (!String(S.get("global_call_handle", "") || "").trim()) {
    S.set("global_call_handle", identity.handle);
  }
  if (!String(S.get("gc_test_display_number", "") || "").trim()) {
    S.set("gc_test_display_number", identity.handle);
  }
  if (!String(S.get("mesh_id", "") || "").trim()) {
    S.set("mesh_id", identity.peerId);
  }
  if (!String(S.get("ga_mesh_id", "") || "").trim()) {
    S.set("ga_mesh_id", identity.peerId);
  }
  if (!String(S.get("omni_node_id", "") || "").trim()) {
    S.set("omni_node_id", identity.peerId);
  }
  return identity;
}

/** One stable id for MeshEngine / hop / fabric / auto mesh */
export function unifyLocalIdentity(): string {
  const seed = ensureIdentitySeed();
  let id =
    String(S.get("mesh_id", "") || "").trim() ||
    String(MeshEngine.localId || "").trim();
  if (!id || id === "undefined") {
    id = seed.peerId;
  }
  S.set("mesh_id", id);
  try {
    (MeshEngine as any).localId = id;
  } catch {}
  // Keep fabric / omni on same id so map/call never show "self" as peer
  const omni = String(S.get("omni_node_id", "") || "").trim();
  if (!omni || omni.startsWith("fab_")) {
    S.set("omni_node_id", id);
  }
  if (!S.get("ga_mesh_id", "")) S.set("ga_mesh_id", id);
  if (!S.get("user_id", "")) S.set("user_id", id);
  if (!S.get("global_call_handle", "")) S.set("global_call_handle", getMeshHandle());
  return id;
}

function isSelf(id: string): boolean {
  if (!id) return true;
  const me = unifyLocalIdentity();
  if (id === me) return true;
  if (id === S.get("mesh_id", "")) return true;
  if (id === S.get("omni_node_id", "")) return true;
  if (id === S.get("ga_mesh_id", "")) return true;
  try {
    if (id === MeshEngine.localId) return true;
  } catch {}
  return false;
}

function emitPeers() {
  const list = getPeers();
  for (const fn of listeners) {
    try {
      fn(list);
    } catch {}
  }
}

function emitStatus() {
  const s = getStatus();
  for (const fn of statusListeners) {
    try {
      fn(s);
    } catch {}
  }
}

function upsertPeer(
  id: string,
  partial: Partial<AutoMeshPeer> & { name?: string },
  via: string
) {
  if (!id || isSelf(id)) return;
  const prev = peers.get(id);
  const viaSet = new Set([...(prev?.via || []), via]);
  const next: AutoMeshPeer = {
    id,
    name: partial.name || prev?.name || id.slice(0, 12),
    lastSeen: Date.now(),
    via: [...viaSet],
    lat: partial.lat ?? prev?.lat,
    lng: partial.lng ?? prev?.lng,
    phone: partial.phone ?? prev?.phone,
    displayNumber: partial.displayNumber ?? prev?.displayNumber,
    hops: partial.hops ?? prev?.hops ?? 1,
    online: true,
  };
  peers.set(id, next);

  // Mirror into MeshEngine so Call/Msg + ONLINE list work without buttons
  try {
    const mp = (MeshEngine as any).peers || {};
    mp[id] = {
      ...(mp[id] || {}),
      name: next.name,
      lastSeen: next.lastSeen,
      lat: next.lat,
      lng: next.lng,
      phone: next.phone,
      via: next.via,
    };
    (MeshEngine as any).peers = mp;
  } catch {}

  if (
    typeof next.lat === "number" &&
    typeof next.lng === "number" &&
    Number.isFinite(next.lat) &&
    Number.isFinite(next.lng)
  ) {
    for (const fn of locationListeners) {
      try {
        fn(next);
      } catch {}
    }
  }
  emitPeers();
}

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of peers) {
    if (now - p.lastSeen > STALE_MS) {
      peers.delete(id);
      changed = true;
    }
  }
  if (changed) emitPeers();
}

function buildPresence(extra?: Partial<PresencePayload>): PresencePayload {
  const id = unifyLocalIdentity();
  return {
    type: extra?.type || "AM_PRESENCE",
    id,
    name: localName(),
    phone: String(S.get("user_phone", "") || "") || undefined,
    displayNumber:
      String(S.get("gc_test_display_number", "") || S.get("global_call_handle", "") || "") ||
      undefined,
    lat: extra?.lat ?? lastGps?.lat,
    lng: extra?.lng ?? lastGps?.lng,
    hops: extra?.hops ?? 0,
    ts: Date.now(),
    envelope: extra?.envelope,
  };
}

function announce() {
  const payload = buildPresence({ type: "AM_HELLO" });
  if (!navigator.onLine && !S.get("gc_allow_offline_mesh", true)) {
    return;
  }
  // 1) Hub mesh bus
  try {
    MeshEngine.broadcast("AM_PRESENCE", payload);
    MeshEngine.broadcast("GRIDCALLER_LOCATION", {
      lat: payload.lat,
      lng: payload.lng,
      name: payload.name,
      phone: payload.phone,
      displayNumber: payload.displayNumber,
      peerId: payload.id,
    });
  } catch {}
  // 2) Trystero swarm (internet / no hub)
  try {
    trySend?.(payload);
  } catch {}
  // 3) Soft tower beacon already runs; ensure hop fabric is up
  try {
    softTowerHop.start(localName());
  } catch {}
}

function handleInbound(raw: any, via: string) {
  if (!raw) return;
  // Trystero action payload or MeshEngine envelope
  const data = raw.data && (raw.type === "AM_PRESENCE" || raw.type === "GRIDCALLER_LOCATION")
    ? { ...raw.data, type: raw.type, from: raw.from }
    : raw;

  const type = data.type || raw.type;
  const id = String(data.id || data.peerId || raw.from || "").trim();
  if (!id || isSelf(id)) return;

  if (
    type === "AM_PRESENCE" ||
    type === "AM_HELLO" ||
    type === "AM_LOCATION" ||
    type === "GRIDCALLER_LOCATION" ||
    type === "presence"
  ) {
    const lat = Number(data.lat ?? data.data?.lat);
    const lng = Number(data.lng ?? data.data?.lng);
    upsertPeer(
      id,
      {
        name: data.name || data.fromName || id.slice(0, 12),
        lat: Number.isFinite(lat) ? lat : undefined,
        lng: Number.isFinite(lng) ? lng : undefined,
        phone: data.phone,
        displayNumber: data.displayNumber,
        hops: data.hops || 1,
      },
      via
    );
  }

  if (type === "AM_RELAY" && data.envelope) {
    try {
      // Re-inject into MeshEngine listeners without looping as self
      const env = data.envelope;
      if (env?.from && !isSelf(env.from)) {
        MeshEngine.broadcast?.(env.type || "RELAY", env.data || env);
      }
    } catch {}
  }
}

async function startTrystero() {
  if (trysteroRoom) return;
  try {
    const room = joinRoom({ appId: AUTO_MESH_APP_ID }, AUTO_MESH_ROOM);
    trysteroRoom = room;
    const [send, get] = room.makeAction("gcauto");
    trySend = send as any;

    get((data: any, peerKey: string) => {
      trysteroOk = true;
      const id = String(data?.id || peerKey);
      handleInbound({ ...data, id }, "trystero");
      // Also map trystero peerKey → our logical id
      if (data?.id && data.id !== peerKey) {
        upsertPeer(data.id, { name: data.name }, "trystero");
      }
    });

    room.onPeerJoin((peerKey) => {
      trysteroOk = true;
      // Soft presence until HELLO arrives
      upsertPeer(peerKey, { name: peerKey.slice(0, 10), hops: 1 }, "trystero");
      try {
        send(buildPresence({ type: "AM_HELLO" }), peerKey);
      } catch {}
      emitStatus();
    });

    room.onPeerLeave((peerKey) => {
      // Don't hard-delete — may still be on hub; mark stale via prune
      const hit = [...peers.values()].find(
        (p) => p.id === peerKey || p.via.includes("trystero")
      );
      if (hit && hit.id === peerKey) {
        peers.delete(peerKey);
        emitPeers();
      }
      emitStatus();
    });

    trysteroOk = true;
    // Immediate hello to room
    try {
      send(buildPresence({ type: "AM_HELLO" }));
    } catch {}
    console.info("[AutoMesh] Trystero room joined", AUTO_MESH_ROOM);
  } catch (e) {
    trysteroOk = false;
    console.warn("[AutoMesh] Trystero failed (needs network for trackers)", e);
  }
  emitStatus();
}

async function probeAndRegisterHub() {
  ensureHubDefaults();
  const hub = resolveHubHttp();
  try {
    (MeshEngine as any).start?.();
    (MeshEngine as any).reconnect?.();
  } catch {}
  const p = await probeHub(hub);
  hubOk = !!p.ok;
  emitStatus();
  return p;
}

/**
 * Start automatic mesh for this device.
 * Safe to call many times — idempotent.
 */
export async function startAutoMesh(name?: string): Promise<AutoMeshStatus> {
  if (name) {
    S.set("user_name", name);
    S.set("mesh_name", name);
  }
  const id = unifyLocalIdentity();
  ensureHubDefaults();

  if (started) {
    announce();
    return getStatus();
  }
  started = true;

  try {
    (MeshEngine as any).start?.();
  } catch {}

  // Soft tower + free fabric = hop mesh (nearest peers auto)
  try {
    freeMeshFabric.start(localName());
  } catch {}
  try {
    softTowerHop.start(localName());
  } catch {}

  // Listen hub / MeshEngine traffic
  try {
    MeshEngine.onMessage((msg: any) => {
      handleInbound(msg, "hub");
      if (msg?.type === "AM_PRESENCE" || msg?.type === "GRIDCALLER_LOCATION") {
        handleInbound(
          {
            ...(msg.data || {}),
            type: msg.type,
            from: msg.from,
            fromName: msg.fromName,
            id: msg.data?.peerId || msg.data?.id || msg.from,
            name: msg.data?.name || msg.fromName,
          },
          "hub"
        );
      }
    });
  } catch {}

  // Soft-tower peers → auto mesh table
  try {
    softTowerHop.onPacket((pkt) => {
      if (pkt.from && !isSelf(pkt.from)) {
        upsertPeer(
          pkt.from,
          {
            name: pkt.fromName || pkt.from,
            hops: (pkt.hops || 0) + 1,
            phone: pkt.payload?.phone,
          },
          "soft-tower"
        );
      }
    });
  } catch {}

  void startTrystero();
  void probeAndRegisterHub();
  announce();

  presenceTimer = setInterval(() => {
    prune();
    announce();
  }, PRESENCE_MS);

  announceTimer = setInterval(() => {
    announce();
    if (navigator.onLine) {
      announceBackoffMs = Math.max(3500, announceBackoffMs - 250);
    }
  }, announceBackoffMs);

  hubProbeTimer = setInterval(() => {
    void probeAndRegisterHub();
  }, HUB_PROBE_MS);

  console.info("[AutoMesh] started · id=", id, "· room=", AUTO_MESH_ROOM);
  emitStatus();
  return getStatus();
}

/** Feed live GPS — auto-broadcast to all mesh paths (map + peers) */
export function setAutoMeshGps(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  lastGps = { lat, lng };
  const payload = buildPresence({ type: "AM_LOCATION", lat, lng });
  try {
    MeshEngine.broadcast("GRIDCALLER_LOCATION", {
      lat,
      lng,
      name: payload.name,
      phone: payload.phone,
      displayNumber: payload.displayNumber,
      peerId: payload.id,
    });
    MeshEngine.broadcast("AM_LOCATION", payload);
  } catch {}
  try {
    trySend?.(payload);
  } catch {}
}

export function getPeers(): AutoMeshPeer[] {
  const now = Date.now();
  return [...peers.values()]
    .map((p) => ({
      ...p,
      online: now - p.lastSeen < STALE_MS,
    }))
    .filter((p) => p.online)
    .sort((a, b) => (a.hops || 1) - (b.hops || 1));
}

export function getStatus(): AutoMeshStatus {
  const list = getPeers();
  const noteParts: string[] = [];
  if (hubOk) noteParts.push("Hub mesh ON");
  else noteParts.push("Hub offline — using swarm");
  if (trysteroOk) noteParts.push("Global swarm ON");
  noteParts.push("Auto-join (no manual peer connect)");
  return {
    started,
    hubOk,
    hubUrl: resolveHubHttp(),
    trysteroOk,
    peerCount: list.length,
    localId: unifyLocalIdentity(),
    localName: localName(),
    note: noteParts.join(" · "),
  };
}

export function onPeers(fn: (peers: AutoMeshPeer[]) => void) {
  listeners.add(fn);
  try {
    fn(getPeers());
  } catch {}
  return () => listeners.delete(fn);
}

export function onStatus(fn: (s: AutoMeshStatus) => void) {
  statusListeners.add(fn);
  try {
    fn(getStatus());
  } catch {}
  return () => statusListeners.delete(fn);
}

export function onPeerLocation(fn: (p: AutoMeshPeer) => void) {
  locationListeners.add(fn);
  return () => locationListeners.delete(fn);
}

export function stopAutoMesh() {
  started = false;
  if (presenceTimer) clearInterval(presenceTimer);
  if (announceTimer) clearInterval(announceTimer);
  if (hubProbeTimer) clearInterval(hubProbeTimer);
  presenceTimer = null;
  announceTimer = null;
  hubProbeTimer = null;
  try {
    trysteroRoom?.leave();
  } catch {}
  trysteroRoom = null;
  trySend = null;
  trysteroOk = false;
}

// Eager start in browser / WebView (APK)
try {
  if (typeof window !== "undefined") {
    ensureHubDefaults();
    unifyLocalIdentity();
    setTimeout(() => {
      void startAutoMesh();
    }, 400);
  }
} catch {}

export default {
  start: startAutoMesh,
  setGps: setAutoMeshGps,
  getPeers,
  getStatus,
  onPeers,
  onStatus,
  onPeerLocation,
  unifyLocalIdentity,
  stop: stopAutoMesh,
};
