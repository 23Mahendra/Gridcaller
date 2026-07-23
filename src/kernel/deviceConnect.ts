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

export function listWifi(): SavedWifi[] {
  return (S.get(WIFI_KEY, []) as SavedWifi[]) || [];
}

export function saveWifi(ssid: string, password: string, opts?: { note?: string; home?: boolean }): SavedWifi {
  const rows = listWifi();
  const existing = rows.find((w) => w.ssid.toLowerCase() === ssid.trim().toLowerCase());
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
  rows.unshift(row);
  S.set(WIFI_KEY, rows.slice(0, 40));
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
  const i = rows.findIndex((b) => b.id === id || b.deviceId === id || b.name === name);
  if (i >= 0) {
    rows[i] = { ...rows[i], name, deviceId: device.deviceId || id, lastOk: Date.now() };
  } else {
    rows.unshift({
      id,
      name,
      deviceId: device.deviceId || id,
      linkedAt: Date.now(),
      lastOk: Date.now(),
    });
  }
  S.set(BT_KEY, rows.slice(0, 40));
  return rows[0];
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

    const pick = found[0];

    // Best-effort GATT connect (optional for mesh presence)
    try {
      await BleClient.connect(pick.deviceId, () => {
        bus.emit("deviceConnect:bt-disconnect", { id: pick.deviceId });
      });
    } catch {
      /* scan-link is enough for mesh list */
    }

    saveBt({ id: pick.deviceId, deviceId: pick.deviceId, name: pick.name });
    try {
      await freeMeshFabric.enableBluetooth();
    } catch {}
    try {
      softTowerHop.start(S.get("user_name", "Node") || "Node");
    } catch {}
    bus.emit("deviceConnect:bt", { name: pick.name, id: pick.deviceId, native: true });
    return {
      ok: true,
      name: `${pick.name} (${found.length} nearby)`,
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
      ? `“${ssid}” saved. Password copied. Select this network in Wi‑Fi settings and paste the password. Mesh strengthens after join.`
      : `“${ssid}” saved. Open Settings → Wi‑Fi → “${ssid}” and enter the password. Keep GridCaller open.`,
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
  let downlink: number | undefined;
  try {
    downlink = (navigator as any).connection?.downlink;
  } catch {}

  return {
    online,
    downlinkMbps: downlink,
    wifiSaved: listWifi().length,
    btLinked: listBt().length,
    softTowers: hop?.softTowers ?? 1,
    hopRange: hop?.estimatedRangeLabel ?? "—",
    hopRelayed: hop?.relayed ?? 0,
    fabricPeers: fabric?.onlinePeers ?? 0,
    fabricRange: fabric?.estimatedRangeLabel ?? "—",
    fabricLinks: fabric?.bonded || [],
    score: scoreStrength(hop, fabric, listBt().length, listWifi().length),
  };
}

export { getDevicePanelStatus } from "./devicePanelStatus";

function scoreStrength(hop: any, fabric: any, bt: number, wifi: number): number {
  let s = 10;
  s += Math.min(40, (hop?.softTowers || 1) * 8);
  s += Math.min(20, (fabric?.onlinePeers || 0) * 5);
  s += Math.min(15, (fabric?.bonded?.length || 0) * 5);
  s += Math.min(10, bt * 3);
  s += Math.min(5, wifi > 0 ? 5 : 0);
  return Math.min(100, Math.round(s));
}
