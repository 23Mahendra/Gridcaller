const ID_KEY = "gc_peer_id";
const NAME_KEY = "gc_display_name";
const ROOM_KEY = "gc_room";
const SIGNAL_KEY = "gc_signal_url";
const HUB_KEY = "gc_hub_http";
const HANDLE_KEY = "gc_mesh_handle";
const DEVICE_KEY = "gc_device_label";

function rid(prefix = "gc") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function safeStorage() {
  try {
    const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    if (storage) return storage;
  } catch {}
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return null;
}

function readStoredString(key: string, fallback = "") {
  const storage = safeStorage();
  if (!storage) return fallback;
  const value = storage.getItem(key);
  return value && value.trim() ? value.trim() : fallback;
}

function writeStoredString(key: string, value: string) {
  const storage = safeStorage();
  if (!storage) return;
  storage.setItem(key, value);
}

function deriveHandleFromPeerId(peerId: string): string {
  const base = peerId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return base ? `mesh-${base}` : "mesh-local";
}

export function getPeerId(): string {
  let id = readStoredString(ID_KEY);
  if (!id) {
    id = rid("mesh");
    writeStoredString(ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string {
  return readStoredString(NAME_KEY, "GridUser");
}

export function setDisplayName(name: string) {
  writeStoredString(NAME_KEY, name.trim().slice(0, 32) || "GridUser");
}

export function getMeshHandle(): string {
  const saved = readStoredString(HANDLE_KEY);
  if (saved) return saved;
  const peerId = getPeerId();
  const derived = deriveHandleFromPeerId(peerId);
  writeStoredString(HANDLE_KEY, derived);
  return derived;
}

export function ensureMeshIdentity() {
  const peerId = getPeerId();
  const handle = getMeshHandle();
  const deviceLabel = readStoredString(DEVICE_KEY);
  if (!deviceLabel) {
    const fallback = `device-${peerId.split("_")[1] || peerId.slice(-4)}`;
    writeStoredString(DEVICE_KEY, fallback);
  }
  return { peerId, handle, deviceLabel: readStoredString(DEVICE_KEY, `device-${peerId.slice(-4)}`) };
}

export function setMeshHandle(handle: string) {
  const normalized = String(handle || "").trim().replace(/^@/, "").slice(0, 24);
  if (!normalized) return getMeshHandle();
  writeStoredString(HANDLE_KEY, normalized);
  return normalized;
}

export function getRoom(): string {
  return localStorage.getItem(ROOM_KEY) || "gridcaller";
}

export function setRoom(room: string) {
  localStorage.setItem(ROOM_KEY, room.trim().slice(0, 64) || "gridcaller");
}

export function getDefaultSignalUrl(): string {
  // GridAlive real mesh bus path
  if (typeof window === "undefined") return "ws://127.0.0.1:8765/mesh-ws";
  const host = window.location.hostname || "127.0.0.1";
  if (window.location.port === "8765" || window.location.protocol === "https:") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (host === "localhost" && (window as any).Capacitor) {
      return localStorage.getItem(SIGNAL_KEY) || "ws://192.168.1.8:8765/mesh-ws";
    }
    return `${proto}//${window.location.host}/mesh-ws`;
  }
  return `ws://${host}:8765/mesh-ws`;
}

export function getSignalUrl(): string {
  return localStorage.getItem(SIGNAL_KEY) || getDefaultSignalUrl();
}

export function setSignalUrl(url: string) {
  localStorage.setItem(SIGNAL_KEY, url.trim());
}

export function getHubHttp(): string {
  const saved = localStorage.getItem(HUB_KEY);
  if (saved) return saved;
  try {
    const u = new URL(getSignalUrl().replace(/^ws/, "http"));
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://127.0.0.1:8765";
  }
}

export function setHubHttp(url: string) {
  localStorage.setItem(HUB_KEY, url.replace(/\/$/, ""));
}

export const APP_ID = "gridcaller-mesh-v2";

// Ensure the app boots with a stable local identity even before user data is entered.
if (typeof window !== "undefined") {
  try {
    ensureMeshIdentity();
  } catch {}
}
