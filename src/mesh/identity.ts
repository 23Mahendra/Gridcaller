const ID_KEY = "gc_peer_id";
const NAME_KEY = "gc_display_name";
const ROOM_KEY = "gc_room";
const SIGNAL_KEY = "gc_signal_url";
const HUB_KEY = "gc_hub_http";
const HANDLE_KEY = "gc_mesh_handle";
const DEVICE_KEY = "gc_device_label";
const IMEI_KEY = "gc_device_imei";
const PHONE_KEY = "user_phone";
const DISPLAY_KEY = "gc_test_display_number";
const META_KEY = "gc_device_identity_meta_v1";

export type DeviceIdentitySource = "sim" | "imei" | "stored-phone" | "stored-imei" | "peer-id-fallback";

export type DeviceIdentityMeta = {
  source: DeviceIdentitySource;
  locked: boolean;
  nativeAvailable: boolean;
  fetchedAt: number | null;
  note: string;
};

export type DeviceIdentitySnapshot = {
  peerId: string;
  phone: string;
  imei: string;
  handle: string;
  displayNumber: string;
  source: DeviceIdentitySource;
  locked: boolean;
  nativeAvailable: boolean;
  fetchedAt: number | null;
  note: string;
};

export function getIdentitySourceLabel(source: DeviceIdentitySource) {
  if (source === "sim") return "SIM detected";
  if (source === "stored-phone") return "Stored SIM number";
  if (source === "imei") return "IMEI detected";
  if (source === "stored-imei") return "Stored IMEI";
  return "Peer fallback";
}

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

function readStoredJson<T>(key: string): T | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStoredJson(key: string, value: unknown) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {}
}

function normalizeSeed(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function formatDeviceDisplayNumber(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("0")) return formatDeviceDisplayNumber(d.slice(1));
  if (d.length > 10 && d.startsWith("91")) return `+${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length > 6) return `+${d}`;
  return d;
}

function stableHashSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString();
}

function deriveNumericHandle(input?: { phone?: string; imei?: string; peerId?: string }): string {
  const phone = digitsOnly(input?.phone || readStoredString(PHONE_KEY));
  if (phone.length >= 10) {
    return phone.slice(-10);
  }

  const imei = digitsOnly(input?.imei || readStoredString(IMEI_KEY));
  if (imei.length >= 10) {
    return imei.slice(-10);
  }

  const peerId = digitsOnly(input?.peerId || readStoredString(ID_KEY) || "mesh-local");
  const seed = [phone, imei, peerId].filter(Boolean).join("");
  const hash = stableHashSeed(seed || "mesh-local");
  const numeric = (Number(hash) % 10000000000).toString().padStart(10, "0");
  return numeric;
}

export function deriveStableMeshHandle(input?: { phone?: string; imei?: string; peerId?: string }): string {
  return deriveNumericHandle(input);
}

function readDeviceIdentityMeta(): DeviceIdentityMeta {
  const saved = readStoredJson<Partial<DeviceIdentityMeta>>(META_KEY);
  return {
    source:
      saved?.source === "sim" ||
      saved?.source === "imei" ||
      saved?.source === "stored-phone" ||
      saved?.source === "stored-imei"
        ? saved.source
        : "peer-id-fallback",
    locked: saved?.locked !== false,
    nativeAvailable: saved?.nativeAvailable === true,
    fetchedAt: typeof saved?.fetchedAt === "number" ? saved.fetchedAt : null,
    note: String(saved?.note || "Identity is locked to this local device."),
  };
}

function writeDeviceIdentityMeta(meta: DeviceIdentityMeta) {
  writeStoredJson(META_KEY, meta);
}

function buildIdentitySnapshot(peerId?: string): DeviceIdentitySnapshot {
  const resolvedPeerId = String(peerId || readStoredString(ID_KEY) || getPeerId()).trim();
  const phone = digitsOnly(readStoredString(PHONE_KEY));
  const imei = digitsOnly(readStoredString(IMEI_KEY));
  const handle = deriveStableMeshHandle({ phone, imei, peerId: resolvedPeerId });
  const displayNumber = phone.length >= 10 ? formatDeviceDisplayNumber(phone) : handle;
  const meta = readDeviceIdentityMeta();
  return {
    peerId: resolvedPeerId,
    phone,
    imei,
    handle,
    displayNumber,
    source: meta.source,
    locked: meta.locked,
    nativeAvailable: meta.nativeAvailable,
    fetchedAt: meta.fetchedAt,
    note: meta.note,
  };
}

function persistDeviceIdentity(input: {
  peerId?: string;
  phone?: string;
  imei?: string;
  source: DeviceIdentitySource;
  nativeAvailable: boolean;
  note: string;
  fetchedAt?: number | null;
}) {
  const peerId = String(input.peerId || readStoredString(ID_KEY) || getPeerId()).trim();
  const phone = digitsOnly(input.phone || readStoredString(PHONE_KEY));
  const imei = digitsOnly(input.imei || readStoredString(IMEI_KEY));
  if (peerId) writeStoredString(ID_KEY, peerId);
  if (phone) writeStoredString(PHONE_KEY, phone);
  if (imei) writeStoredString(IMEI_KEY, imei);
  const handle = deriveStableMeshHandle({ phone, imei, peerId });
  const displayNumber = phone.length >= 10 ? formatDeviceDisplayNumber(phone) : handle;
  writeStoredString(HANDLE_KEY, handle);
  writeStoredString("global_call_handle", handle);
  writeStoredString(DISPLAY_KEY, displayNumber);
  writeDeviceIdentityMeta({
    source: input.source,
    locked: true,
    nativeAvailable: input.nativeAvailable,
    fetchedAt: input.fetchedAt ?? Date.now(),
    note: input.note,
  });
  return buildIdentitySnapshot(peerId);
}

async function tryReadNativeIdentity(): Promise<{
  phone?: string;
  imei?: string;
  nativeAvailable: boolean;
  note: string;
}> {
  const root = globalThis as typeof globalThis & {
    Capacitor?: { Plugins?: Record<string, any> };
    GridCallerNative?: { getDeviceIdentity?: () => Promise<any> | any };
  };
  const candidates = [
    root.GridCallerNative?.getDeviceIdentity,
    root.Capacitor?.Plugins?.MeshCall?.getDeviceIdentity,
    root.Capacitor?.Plugins?.GridCallerIdentity?.getDeviceIdentity,
  ].filter((fn): fn is (() => Promise<any> | any) => typeof fn === "function");

  for (const getIdentity of candidates) {
    try {
      const data = await getIdentity.call(null);
      const phone = digitsOnly(
        data?.phoneNumber || data?.phone || data?.simNumber || data?.msisdn || data?.line1Number || ""
      );
      const imei = digitsOnly(data?.imei || data?.deviceImei || data?.deviceId || "");
      if (phone || imei) {
        return {
          phone,
          imei,
          nativeAvailable: true,
          note: phone
            ? "Immutable identity synced from SIM 1 / SIM 2 line number."
            : "SIM number unavailable, so immutable identity is locked to local device IMEI.",
        };
      }
      return {
        nativeAvailable: true,
        note: "Native device identity bridge is present, but it returned no SIM number or IMEI.",
      };
    } catch (error: any) {
      return {
        nativeAvailable: true,
        note: error?.message || "Native device identity bridge failed.",
      };
    }
  }

  return {
    nativeAvailable: false,
    note: "This build has no native SIM/IMEI bridge, so only locally stored device identity is available.",
  };
}

function deriveHandleFromPeerId(peerId: string): string {
  return deriveStableMeshHandle({ peerId });
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
  const snapshot = buildIdentitySnapshot();
  writeStoredString(HANDLE_KEY, snapshot.handle);
  writeStoredString("global_call_handle", snapshot.handle);
  writeStoredString(DISPLAY_KEY, snapshot.displayNumber);
  return snapshot.handle;
}

export function getHandleNodeIdCode() {
  return `${getMeshHandle()}@${getPeerId()}`;
}

export function parseHandleNodeIdCode(code: string): { handle: string; nodeId: string } | null {
  const raw = String(code || "").trim();
  if (!raw) return null;
  const at = raw.indexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  const handle = raw.slice(0, at).trim();
  const nodeId = raw.slice(at + 1).trim();
  if (!handle || !nodeId) return null;
  return { handle, nodeId };
}

export function ensureMeshIdentity() {
  const peerId = getPeerId();
  const handle = rememberDeviceIdentity({
    phone: readStoredString(PHONE_KEY),
    imei: readStoredString(IMEI_KEY),
    peerId,
  });
  const deviceLabel = readStoredString(DEVICE_KEY);
  if (!deviceLabel) {
    const fallback = `device-${peerId.split("_")[1] || peerId.slice(-4)}`;
    writeStoredString(DEVICE_KEY, fallback);
  }
  return { peerId, handle, deviceLabel: readStoredString(DEVICE_KEY, `device-${peerId.slice(-4)}`) };
}

export function setMeshHandle(handle: string) {
  return getMeshHandle();
}

export function rememberDeviceIdentity(input: { phone?: string; imei?: string; peerId?: string }) {
  const phone = String(input.phone || "").replace(/\D/g, "");
  const imei = String(input.imei || "").replace(/\D/g, "");
  const snapshot = persistDeviceIdentity({
    peerId: input.peerId,
    phone,
    imei,
    source: phone ? "stored-phone" : imei ? "stored-imei" : "peer-id-fallback",
    nativeAvailable: false,
    note: phone
      ? "Immutable identity is locked to the locally stored SIM number."
      : imei
        ? "SIM number unavailable, so immutable identity is locked to the locally stored IMEI."
        : "No SIM/IMEI stored, so identity falls back to the local peer id hash.",
  });
  return snapshot.handle;
}

export async function syncLocalDeviceIdentity(input?: { phone?: string; imei?: string; peerId?: string }) {
  const peerId = String(input?.peerId || readStoredString(ID_KEY) || getPeerId()).trim();
  const native = await tryReadNativeIdentity();
  const phone = digitsOnly(native.phone || input?.phone || readStoredString(PHONE_KEY));
  const imei = digitsOnly(native.imei || input?.imei || readStoredString(IMEI_KEY));
  return persistDeviceIdentity({
    peerId,
    phone,
    imei,
    source: phone ? (native.phone ? "sim" : "stored-phone") : imei ? (native.imei ? "imei" : "stored-imei") : "peer-id-fallback",
    nativeAvailable: native.nativeAvailable,
    note: native.note,
    fetchedAt: Date.now(),
  });
}

export function getLocalDeviceIdentity(): DeviceIdentitySnapshot {
  return buildIdentitySnapshot();
}

export function getImmutableDisplayNumber() {
  return buildIdentitySnapshot().displayNumber;
}

export function isIdentityDeviceLocked() {
  return buildIdentitySnapshot().locked;
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
