/**
 * Persistent mesh directory — device always "knows" the mesh network.
 * Peers, handles, phones, last paths survive app kill/restart.
 * Call logs stay in existing recents storage; this is the peer/mesh map.
 */

import { S } from "./storage";
import { MeshEngine } from "./mesh";
import { bus } from "./bus";

const DIR_KEY = "gc_mesh_directory_v1";
const LOG_KEY = "gc_mesh_event_log_v1";
const MAX_PEERS = 80;
const MAX_EVENTS = 200;

export type MeshDirPeer = {
  id: string;
  name: string;
  handle?: string;
  phone?: string;
  lastSeen: number;
  via: string[];
  hops?: number;
  /** times we successfully talked / saw them */
  hits: number;
};

export type MeshEvent = {
  ts: number;
  kind: string;
  detail: string;
  peerId?: string;
};

function loadDir(): Record<string, MeshDirPeer> {
  try {
    return (S.get(DIR_KEY, {}) as Record<string, MeshDirPeer>) || {};
  } catch {
    return {};
  }
}

function saveDir(d: Record<string, MeshDirPeer>) {
  S.set(DIR_KEY, d);
}

export function listDirectoryPeers(): MeshDirPeer[] {
  const d = loadDir();
  return Object.values(d).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function rememberPeer(
  id: string,
  partial: {
    name?: string;
    handle?: string;
    phone?: string;
    via?: string;
    hops?: number;
  }
) {
  if (!id || id === "hub-pc") return;
  try {
    if (id === MeshEngine.localId || id === S.get("mesh_id", "")) return;
  } catch {}
  const d = loadDir();
  const prev = d[id];
  const vias = new Set([...(prev?.via || []), partial.via || "mesh"].filter(Boolean));
  d[id] = {
    id,
    name: partial.name || prev?.name || id.slice(0, 12),
    handle: partial.handle || prev?.handle,
    phone: partial.phone || prev?.phone,
    lastSeen: Date.now(),
    via: [...vias].slice(0, 8),
    hops: partial.hops ?? prev?.hops,
    hits: (prev?.hits || 0) + 1,
  };
  // Cap size — keep most recent
  const arr = Object.values(d).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_PEERS);
  const next: Record<string, MeshDirPeer> = {};
  for (const p of arr) next[p.id] = p;
  saveDir(next);

  // Mirror into live MeshEngine so ONLINE rebuilds from memory
  try {
    const mp = (MeshEngine as any).peers || {};
    mp[id] = {
      ...(mp[id] || {}),
      name: d[id].name,
      handle: d[id].handle,
      phone: d[id].phone,
      lastSeen: d[id].lastSeen,
      via: d[id].via,
    };
    (MeshEngine as any).peers = mp;
  } catch {}

  bus.emit("meshDirectory:peer", d[id]);
}

/** On app boot — restore peers into MeshEngine so device "remembers" the mesh */
export function hydrateMeshFromDirectory() {
  const d = loadDir();
  const now = Date.now();
  try {
    const mp = (MeshEngine as any).peers || {};
    for (const p of Object.values(d)) {
      // Soft online if seen in last 24h (will refresh when they actually poll)
      if (now - p.lastSeen > 86400000 * 7) continue;
      mp[p.id] = {
        name: p.name,
        handle: p.handle,
        phone: p.phone,
        lastSeen: p.lastSeen,
        via: p.via || ["memory"],
        fromMemory: true,
      };
    }
    (MeshEngine as any).peers = mp;
  } catch {}
  logMeshEvent("hydrate", `Restored ${Object.keys(d).length} mesh peers from memory`);
}

export function logMeshEvent(kind: string, detail: string, peerId?: string) {
  try {
    const rows = (S.get(LOG_KEY, []) as MeshEvent[]) || [];
    rows.unshift({ ts: Date.now(), kind, detail, peerId });
    S.set(LOG_KEY, rows.slice(0, MAX_EVENTS));
  } catch {}
}

export function listMeshEvents(): MeshEvent[] {
  return (S.get(LOG_KEY, []) as MeshEvent[]) || [];
}

/** Resolve dial from persistent directory (even if peer offline briefly) */
export function resolveFromDirectory(q: string): MeshDirPeer | null {
  const raw = String(q || "").trim();
  if (!raw) return null;
  const dig = raw.replace(/\D/g, "");
  const h = raw.replace(/^@/, "").toLowerCase();
  const list = listDirectoryPeers();
  for (const p of list) {
    if (p.id === raw) return p;
    if (p.handle && p.handle.toLowerCase() === h) return p;
    if (dig.length >= 10 && p.phone && p.phone.slice(-10) === dig.slice(-10)) return p;
    if (dig.length >= 10 && p.handle && p.handle.replace(/\D/g, "").slice(-10) === dig.slice(-10)) return p;
  }
  return null;
}

let hooked = false;

/** Hook MeshEngine messages → always persist peers */
export function startMeshDirectory() {
  if (hooked) {
    hydrateMeshFromDirectory();
    return;
  }
  hooked = true;
  hydrateMeshFromDirectory();
  try {
    MeshEngine.onMessage((msg: any) => {
      if (!msg?.from) return;
      if (msg.from === MeshEngine.localId) return;
      const d = msg.data || {};
      rememberPeer(msg.from, {
        name: msg.fromName || d.name || d.fromName,
        handle: d.handle,
        phone: d.phone,
        via: String(msg.type || "mesh").slice(0, 24),
      });
    });
  } catch {}
  // Periodic save of live peers
  setInterval(() => {
    try {
      const mp = (MeshEngine as any).peers || {};
      for (const [id, v] of Object.entries(mp) as any) {
        if (!id || id === MeshEngine.localId) continue;
        rememberPeer(id, {
          name: v?.name,
          handle: v?.handle,
          phone: v?.phone,
          via: Array.isArray(v?.via) ? v.via[0] : "live",
        });
      }
    } catch {}
  }, 8000);
  logMeshEvent("start", "Mesh directory active");
  console.info("[MeshDirectory] persistent peer memory ON");
}
