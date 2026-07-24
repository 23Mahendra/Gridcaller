/**
 * Unified list of REAL connected devices only.
 * No demos, no ghosts, no duplicate "Me" / fabric noise.
 */

import { MeshEngine } from "./mesh";
import softTowerHop from "./softTowerHopNet";
import freeMeshFabric from "./freeMeshFabric";
import freeRadio from "./radioMesh";
import { listBt, listWifi } from "./deviceConnect";
import { S } from "./storage";
import { getPeers as getAutoMeshPeers } from "./autoMesh";

export type ConnectedDevice = {
  id: string;
  name: string;
  kind: "self" | "soft-tower" | "mesh" | "fabric" | "radio" | "bluetooth" | "wifi-saved";
  detail?: string;
  hops?: number;
  online: boolean;
};

/** All local identities this device may use across engines */
function localIdentitySet(): Set<string> {
  const ids = new Set<string>();
  const add = (x: any) => {
    const s = String(x || "").trim();
    if (s) ids.add(s);
  };
  try {
    add(MeshEngine.localId);
  } catch {}
  add(S.get("mesh_id", ""));
  add(S.get("ga_mesh_id", ""));
  add(S.get("omni_node_id", ""));
  add(S.get("user_id", ""));
  try {
    add((softTowerHop as any).id);
  } catch {}
  return ids;
}

function isSelfId(id: string, localIds: Set<string>): boolean {
  if (!id) return true;
  if (localIds.has(id)) return true;
  // Soft aliases used by hop / fabric engines
  if (id.startsWith("fab_") && localIds.has(S.get("omni_node_id", ""))) {
    // only if it matches our omni id
    if (id === S.get("omni_node_id", "")) return true;
  }
  return false;
}

function isStale(lastSeen?: number, maxAge = 45000): boolean {
  if (!lastSeen || lastSeen <= 0) return true;
  return Date.now() - lastSeen > maxAge;
}

function isPlaceholderPeerIdentity(id: string, name: string): boolean {
  const normalizedId = String(id || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim().toLowerCase();
  const placeholderIds = new Set([
    "",
    "self",
    "me",
    "mesh",
    "meshpeer",
    "mesh-peer",
    "peer",
    "node",
    "unknown",
    "this-device",
    "this-phone",
    "device",
  ]);
  const placeholderNames = new Set([
    "",
    "me",
    "self",
    "mesh",
    "mesh peer",
    "meshpeer",
    "peer",
    "node",
    "unknown",
    "this device",
    "this phone",
  ]);
  return placeholderIds.has(normalizedId) || placeholderNames.has(normalizedName);
}

/**
 * Real devices only:
 * · You (once)
 * · Live mesh peers (not self)
 * · Soft-tower / fabric peers that are online, recent, not self
 * · Radio peers live
 * · Bluetooth sessions you actually linked
 * · Wi‑Fi credentials are NOT counted as "connected online"
 */
export function listConnectedDevices(opts?: {
  meshPeers?: { id: string; name: string; online?: boolean }[];
  globalPeers?: { id: string; name: string; online?: boolean }[];
  includeSavedWifi?: boolean;
}): { count: number; onlineCount: number; devices: ConnectedDevice[] } {
  const devices: ConnectedDevice[] = [];
  const seenIds = new Set<string>();
  const localIds = localIdentitySet();

  const push = (d: ConnectedDevice) => {
    if (!d.id) return;
    // One row per real id (across kinds)
    if (seenIds.has(d.id)) return;
    // Also block duplicate self-named rows for local
    if (d.kind !== "self" && isSelfId(d.id, localIds)) return;
    seenIds.add(d.id);
    devices.push(d);
  };

  const meId = MeshEngine.localId || S.get("mesh_id", "") || "this-device";
  const meName = S.get("user_name", "") || S.get("mesh_name", "") || "This device";
  push({
    id: String(meId),
    name: meName,
    kind: "self",
    detail: "This phone",
    hops: 0,
    online: true,
  });
  // Mark other local aliases as seen so they never reappear as peers
  for (const id of localIds) seenIds.add(id);

  // ── AutoMesh (Trystero + hub) — no manual connect ──
  try {
    for (const p of getAutoMeshPeers()) {
      if (!p?.id || isSelfId(p.id, localIds)) continue;
      if (!p.online) continue;
      if (isPlaceholderPeerIdentity(p.id, p.name || "")) continue;
      push({
        id: p.id,
        name: p.name || p.id.slice(0, 12),
        kind: "mesh",
        detail: `Auto-mesh · ${(p.via || []).join("+") || "swarm"}`,
        hops: p.hops,
        online: true,
      });
    }
  } catch {}

  // ── Real mesh peers (MeshEngine / UI state) ──
  for (const p of opts?.meshPeers || []) {
    if (!p?.id || isSelfId(p.id, localIds)) continue;
    if (p.online === false) continue;
    if (isPlaceholderPeerIdentity(p.id, p.name || "")) continue;
    push({
      id: p.id,
      name: p.name || p.id.slice(0, 12),
      kind: "mesh",
      detail: "Mesh peer",
      online: true,
    });
  }

  for (const p of opts?.globalPeers || []) {
    if (!p?.id || isSelfId(p.id, localIds)) continue;
    if (p.online === false) continue;
    if (isPlaceholderPeerIdentity(p.id, p.name || "")) continue;
    push({
      id: p.id,
      name: p.name || p.id.slice(0, 12),
      kind: "mesh",
      detail: "Global mesh peer",
      online: true,
    });
  }

  // MeshEngine live table (source of truth for LAN mesh)
  try {
    const eng = (MeshEngine as any).getPeers?.() || (MeshEngine as any).peers || [];
    const list = Array.isArray(eng) ? eng : eng instanceof Map ? [...eng.values()] : [];
    for (const p of list) {
      const id = p?.id || p?.peerId;
      if (!id || isSelfId(id, localIds)) continue;
      if (p.online === false) continue;
      push({
        id: String(id),
        name: p.name || String(id).slice(0, 12),
        kind: "mesh",
        detail: "Mesh peer",
        online: true,
      });
    }
  } catch {}

  // Soft-tower neighbors (must be online + recent)
  try {
    for (const p of softTowerHop.getPeers()) {
      if (!p?.id || isSelfId(p.id, localIds)) continue;
      if ((p as any).online === false) continue;
      if (isStale((p as any).lastSeen, 45000)) continue;
      push({
        id: p.id,
        name: p.name || p.id.slice(0, 12),
        kind: "soft-tower",
        detail: `Relay · ${(p.links || []).filter(Boolean).join("+") || "mesh"}`,
        hops: p.hops,
        online: true,
      });
    }
  } catch {}

  // Fabric peers — only if truly online and not self (deduped by id)
  try {
    for (const p of freeMeshFabric.getPeers()) {
      if (!p?.id || isSelfId(p.id, localIds)) continue;
      if (!p.online) continue;
      if (isStale(p.lastSeen, 50000)) continue;
      // Skip generic ghost names without a real mesh handshake if already listed
      push({
        id: p.id,
        name: p.name && p.name !== "Node" ? p.name : p.id.slice(0, 12),
        kind: "fabric",
        detail: `Fabric · ${(p.links || []).filter(Boolean).join("+") || "link"}`,
        hops: p.hops,
        online: true,
      });
    }
  } catch {}

  // Free radio live peers
  try {
    for (const p of freeRadio.peerList) {
      if (!p?.id || isSelfId(p.id, localIds)) continue;
      if (!p.live) continue;
      push({
        id: p.id,
        name: p.name || p.id.slice(0, 12),
        kind: "radio",
        detail: `Radio · ${freeRadio.channelName}`,
        online: true,
      });
    }
  } catch {}

  // Bluetooth sessions you actually paired in this app
  for (const b of listBt()) {
    if (!b?.id) continue;
    push({
      id: b.id,
      name: b.name || "Bluetooth device",
      kind: "bluetooth",
      detail: "Bluetooth linked",
      online: true,
    });
  }

  // Saved Wi‑Fi credentials (not live "connected" peers) — optional, offline
  if (opts?.includeSavedWifi) {
    for (const w of listWifi()) {
      if (!w?.id) continue;
      push({
        id: w.id,
        name: w.ssid,
        kind: "wifi-saved",
        detail: w.home ? "Saved Wi‑Fi (home)" : "Saved Wi‑Fi",
        online: false,
      });
    }
  }

  const onlineCount = devices.filter((d) => d.online).length;
  return { count: devices.length, onlineCount, devices };
}
