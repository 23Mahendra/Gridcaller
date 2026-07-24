/**
 * Permission-based device connect for standalone APK + web
 *  · Native Android: Capacitor BLE (WebView has NO Web Bluetooth)
 *  · Web Chrome: Web Bluetooth API
 *  · Wi‑Fi: save SSID + password, open OS Wi‑Fi settings
 */

import { Capacitor } from "@capacitor/core";
import { bus } from "./bus";
import { S } from "./storage";
import freeMeshFabric from "./freeMeshFabric";
import softTowerHop from "./softTowerHopNet";
import { ensureLocationPermission } from "./nativePermissions";

const WIFI_KEY = "gc_wifi_networks_v1";
const BT_KEY = "gc_bt_devices_v1";
const STRENGTH_STATE_KEY = "gc_mesh_strength_state_v1";
const MAX_BT_LINKS = 2;
const MAX_WIFI_LINKS = 2;

type MeshStrengthState = {
  score: number;
  lastUpdated: number;
  cycles: number;
  bestScore: number;
};

let strengthAutoTimer: ReturnType<typeof setInterval> | null = null;
let strengthStateCache: MeshStrengthState | null = null;

function loadStrengthState(): MeshStrengthState {
  if (strengthStateCache) return strengthStateCache;
  const raw = S.get(STRENGTH_STATE_KEY, null) as Partial<MeshStrengthState> | null;
  const state: MeshStrengthState = {
    score: Math.max(20, Math.min(100, raw?.score ?? 30)),
    lastUpdated: raw?.lastUpdated ?? Date.now(),
    cycles: Math.max(0, raw?.cycles ?? 0),
    bestScore: Math.max(20, Math.min(100, raw?.bestScore ?? raw?.score ?? 30)),
  };
  strengthStateCache = state;
  return state;
}

function saveStrengthState(state: MeshStrengthState) {
  strengthStateCache = state;
  try {
    S.set(STRENGTH_STATE_KEY, state);
  } catch {}
}

function startStrengthAutoboost() {
  if (strengthAutoTimer) return;
  strengthAutoTimer = setInterval(() => {
    try {
      const hop = softTowerHop.getNetworkHealth();
      const fabric = freeMeshFabric.getStats();
      const bt = listBt().length;
      const wifi = listWifi().length;
      scoreStrength(hop, fabric, bt, wifi);
    } catch {}
  }, 10000);
}

startStrengthAutoboost();

export type SavedWifi = {
  id: string;
  ssid: string;
  password: string;
  note?: string;
  lastUsed?: number;
  home?: boolean;
};

export type LinkedBt = {
  id: string;
  name: string;
  linkedAt: number;
  lastOk?: number;
  deviceId?: string;
};

function uid() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

function trimLinks<T extends { id: string }>(rows: T[], max: number): T[] {
  return rows.slice(0, max);
}

function upsertLimited<T extends { id: string }>(rows: T[], item: T, max: number): T[] {
  const next = [...rows];
  const existingIndex = next.findIndex((row) => row.id === item.id);
  if (existingIndex >= 0) {
    next[existingIndex] = item;
    return trimLinks(next, max);
  }
  next.push(item);
  return trimLinks(next, max);
}

export function listWifi(): SavedWifi[] {
  return (S.get(WIFI_KEY, []) as SavedWifi[]) || [];
}

export function saveWifi(ssid: string, password: string, opts?: { note?: string; home?: boolean }): SavedWifi {
  const rows = listWifi();
  const ssidKey = ssid.trim().toLowerCase();
  const existing = rows.find((w) => w.ssid.toLowerCase() === ssidKey);
  if (existing) {
    existing.password = password;
    existing.note = opts?.note ?? existing.note;
    existing.home = opts?.home ?? existing.home ?? true;
    existing.lastUsed = Date.now();
    S.set(WIFI_KEY, rows);
    bus.emit("deviceConnect:wifi-saved", existing);
    // Keep preferred SSID in wifi memory
    try {
      S.set("gc_wifi_memory_meta_v1", {
        ...(S.get("gc_wifi_memory_meta_v1", {}) as any),
        preferredSsid: existing.ssid,
        autoConnect: true,
        lastConnectedAt: Date.now(),
      });
    } catch {}
    return existing;
  }
  const row: SavedWifi = {
    id: uid(),
    ssid: ssid.trim(),
    password,
    note: opts?.note || "Saved for auto mesh",
    home: opts?.home !== false,
    lastUsed: Date.now(),
  };
  const nextRows = [...rows];
  nextRows.unshift(row);
  const limited = trimLinks(nextRows, MAX_WIFI_LINKS);
  S.set(WIFI_KEY, limited);
  bus.emit("deviceConnect:wifi-saved", row);
  try {
    S.set("gc_wifi_memory_meta_v1", {
      ...(S.get("gc_wifi_memory_meta_v1", {}) as any),
      preferredSsid: row.ssid,
      autoConnect: true,
      lastConnectedAt: Date.now(),
    });
  } catch {}
  return row;
}

export function removeWifi(id: string) {
  S.set(
    WIFI_KEY,
    listWifi().filter((w) => w.id !== id)
  );
}

export function listBt(): LinkedBt[] {
  return (S.get(BT_KEY, []) as LinkedBt[]) || [];
}

function saveBt(device: { id?: string; name?: string; deviceId?: string }) {
  const rows = listBt();
  const id = device.id || device.deviceId || `bt_${Date.now()}`;
  const name = device.name || "Bluetooth device";
  const existingIndex = rows.findIndex((b) => b.id === id || b.deviceId === id || b.name === name);
  const entry = {
    id,
    name,
    deviceId: device.deviceId || id,
    linkedAt: Date.now(),
    lastOk: Date.now(),
  };
  if (existingIndex >= 0) {
    rows[existingIndex] = { ...rows[existingIndex], ...entry, lastOk: Date.now() };
  } else {
    rows.unshift(entry);
  }
  const limited = trimLinks(rows, MAX_BT_LINKS);
  S.set(BT_KEY, limited);
  return limited[0];
}

export function removeBt(id: string) {
  S.set(
    BT_KEY,
    listBt().filter((b) => b.id !== id && b.deviceId !== id)
  );
}

/** Location + nearby prompts (Android needs this for BT/Wi‑Fi scan) */
export async function ensureNearbyPermissions(): Promise<void> {
  await ensureLocationPermission();
}

/**
 * Native BLE path for Capacitor APK (Android WebView has no Web Bluetooth).
 * Scans ~6s and links strongest named device (or first found).
 */
async function connectBluetoothNative(): Promise<{
  ok: boolean;
  name?: string;
  error?: string;
}> {
  try {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await ensureLocationPermission();

    await BleClient.initialize({ androidNeverForLocation: false });

    // Ensure adapter is on
    try {
      const enabled = await BleClient.isEnabled();
      if (!enabled) {
        try {
          await BleClient.requestEnable();
        } catch {
          return {
            ok: false,
            error: "Turn on Bluetooth in phone settings, then try again.",
          };
        }
      }
    } catch {
      /* some devices skip isEnabled */
    }

    const found: { deviceId: string; name: string; rssi: number }[] = [];
    const seen = new Set<string>();

    await BleClient.requestLEScan({ allowDuplicates: false }, (result) => {
      const id = result?.device?.deviceId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const name =
        result.device.name ||
        result.localName ||
        (result as any).device?.name ||
        "Nearby device";
      found.push({
        deviceId: id,
        name: String(name),
        rssi: typeof result.rssi === "number" ? result.rssi : -100,
      });
    });

    // Scan window
    await new Promise((r) => setTimeout(r, 6000));
    try {
      await BleClient.stopLEScan();
    } catch {}

    if (!found.length) {
      return {
        ok: false,
        error:
          "No Bluetooth devices found nearby. Keep the other device on and discoverable, allow Location + Nearby, then try again.",
      };
    }

    // Prefer named devices, strongest RSSI
    found.sort((a, b) => {
      const an = /nearby device/i.test(a.name) ? 0 : 1;
      const bn = /nearby device/i.test(b.name) ? 0 : 1;
      if (an !== bn) return bn - an;
      return b.rssi - a.rssi;
    });

    const picks = found.slice(0, MAX_BT_LINKS);

    for (const pick of picks) {
      try {
        await BleClient.connect(pick.deviceId, () => {
          bus.emit("deviceConnect:bt-disconnect", { id: pick.deviceId });
        });
      } catch {
        /* keep the link as a saved mesh option; do not tear down existing links */
      }
      saveBt({ id: pick.deviceId, deviceId: pick.deviceId, name: pick.name });
    }
    try {
      await freeMeshFabric.enableBluetooth();
    } catch {}
    try {
      softTowerHop.start(S.get("user_name", "Node") || "Node");
    } catch {}
    bus.emit("deviceConnect:bt", { name: pick.name, id: pick.deviceId, native: true });
    return {
      ok: true,
      name: `${picks.map((pick) => pick.name).join(", ")} (${found.length} nearby · multi-link ready)`,
    };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (/permission|denied|Location/i.test(msg)) {
      return {
        ok: false,
        error:
          "Bluetooth / Location permission required. Allow all prompts, open App Settings → Permissions, then retry.",
      };
    }
    if (/disabled|enable|off/i.test(msg)) {
      return { ok: false, error: "Turn on Bluetooth and try again." };
    }
    return { ok: false, error: msg || "Native Bluetooth failed." };
  }
}

/** Web Bluetooth (Chrome desktop / Chrome Android browser only) */
async function connectBluetoothWeb(): Promise<{
  ok: boolean;
  name?: string;
  error?: string;
}> {
  const nav = navigator as any;
  if (!nav.bluetooth?.requestDevice) {
    return {
      ok: false,
      error: "Web Bluetooth is not available in this browser.",
    };
  }
  try {
    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ["battery_service", "generic_access", "device_information"],
    });
    try {
      if (device.gatt && !device.gatt.connected) {
        await device.gatt.connect();
      }
    } catch {
      /* still count as paired session */
    }
    saveBt({ id: device.id, name: device.name || "BT device" });
    try {
      await freeMeshFabric.enableBluetooth();
    } catch {}
    try {
      softTowerHop.start(S.get("user_name", "Node") || "Node");
    } catch {}
    bus.emit("deviceConnect:bt", { name: device.name, id: device.id });
    return { ok: true, name: device.name || "Bluetooth device" };
  } catch (e: any) {
    if (e?.name === "NotFoundError" || e?.name === "AbortError") {
      return { ok: false, error: "No device selected. Try again or cancel was pressed." };
    }
    if (e?.name === "SecurityError") {
      return {
        ok: false,
        error: "Bluetooth permission denied. Allow Bluetooth in app settings.",
      };
    }
    return { ok: false, error: e?.message || "Bluetooth connection failed." };
  }
}

/**
 * Connect Bluetooth — native BLE on APK, Web Bluetooth on Chrome.
 */
export async function connectBluetoothWithPermission(): Promise<{
  ok: boolean;
  name?: string;
  error?: string;
}> {
  await ensureNearbyPermissions();

  // Standalone APK / Capacitor → always prefer native BLE
  if (Capacitor.isNativePlatform()) {
    return connectBluetoothNative();
  }

  // Browser
  const web = await connectBluetoothWeb();
  if (web.ok || !/not available/i.test(web.error || "")) {
    return web;
  }

  // Last resort: if somehow BLE plugin is present in hybrid shell
  try {
    return await connectBluetoothNative();
  } catch {
    return web;
  }
}

/**
 * Save Wi‑Fi + open system Wi‑Fi settings (user joins with password).
 */
export async function connectWifiWithPassword(
  ssid: string,
  password: string
): Promise<{ ok: boolean; message: string; copied?: boolean }> {
  if (!ssid.trim()) return { ok: false, message: "Enter a Wi‑Fi network name." };
  await ensureNearbyPermissions();
  saveWifi(ssid, password, { home: true });

  let copied = false;
  try {
    await navigator.clipboard.writeText(password);
    copied = true;
  } catch {}

  // Open Android Wi‑Fi settings
  try {
    if (Capacitor.isNativePlatform() || /Android/i.test(navigator.userAgent || "")) {
      window.location.href = "intent://wifi/#Intent;scheme=android.settings;action=android.settings.WIFI_SETTINGS;end";
    }
  } catch {}

  try {
    freeMeshFabric.start(S.get("user_name", "Node") || "Node");
  } catch {}

  return {
    ok: true,
    copied,
    message: copied
      ? `“${ssid}” saved. Password copied. Select this network in Wi‑Fi settings and paste the password. Nearby GridCaller devices will then strengthen the shared mesh automatically.`
      : `“${ssid}” saved. Open Settings → Wi‑Fi → “${ssid}” and enter the password. Keep GridCaller open so nearby devices can join the shared mesh automatically.`,
  };
}

/** Current link snapshot for strength testing */
export function networkStrengthReport() {
  let fabric: any = null;
  let hop: any = null;
  try {
    fabric = freeMeshFabric.getStats();
  } catch {}
  try {
    hop = softTowerHop.getNetworkHealth();
  } catch {}
  const online = typeof navigator !== "undefined" ? navigator.onLine : false;
  const btLinks = Math.min(MAX_BT_LINKS, listBt().length);
  const wifiLinks = Math.min(MAX_WIFI_LINKS, listWifi().length);
  let downlink: number | undefined;
  try {
    downlink = (navigator as any).connection?.downlink;
  } catch {}

  return {
    online,
    downlinkMbps: downlink,
    wifiSaved: listWifi().length,
    btLinked: btLinks,
    softTowers: hop?.softTowers ?? 1,
    hopRange: hop?.estimatedRangeLabel ?? "—",
    hopRelayed: hop?.relayed ?? 0,
    fabricPeers: fabric?.onlinePeers ?? 0,
    fabricRange: fabric?.estimatedRangeLabel ?? "—",
    fabricLinks: fabric?.bonded || [],
    score: scoreStrength(hop, fabric, btLinks, wifiLinks),
  };
}

export { getDevicePanelStatus } from "./devicePanelStatus";

function scoreStrength(hop: any, fabric: any, bt: number, wifi: number): number {
  const state = loadStrengthState();
  const now = Date.now();
  const elapsedMinutes = Math.max(0, (now - state.lastUpdated) / 60000);
  const peerLift = Math.min(28, (hop?.softTowers || 1) * 6 + (fabric?.onlinePeers || 0) * 4 + (fabric?.bonded?.length || 0) * 3);
  const linkLift = Math.min(18, (bt > 0 ? 8 : 0) + (wifi > 0 ? 6 : 0));
  const backgroundLift = Math.min(24, Math.round(elapsedMinutes * 1.3 + state.cycles * 0.22));
  const nextScore = Math.min(100, Math.round(24 + peerLift + linkLift + backgroundLift + Math.min(10, (bt > 0 ? 3 : 0) + (wifi > 0 ? 3 : 0))));

  const updated: MeshStrengthState = {
    score: nextScore,
    lastUpdated: now,
    cycles: state.cycles + 1,
    bestScore: Math.max(state.bestScore, nextScore),
  };
  saveStrengthState(updated);
  return updated.score;
}
