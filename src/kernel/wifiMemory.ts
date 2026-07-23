/**
 * Wi‑Fi memory — always remember networks in app storage and prefer auto-reconnect.
 *
 * Android cannot silently join arbitrary SSIDs without user/system Wi‑Fi picker
 * on modern versions. We:
 *  · Auto-save every network the user enters (password vault)
 *  · Auto-mark last successful mesh hub SSID/session as preferred
 *  · On Wi‑Fi drop → open OS Wi‑Fi settings for preferred home network
 *  · Keep list forever in S storage (app memory)
 */

import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { S } from "./storage";
import { bus } from "./bus";
import { listWifi, saveWifi, type SavedWifi } from "./deviceConnect";
import { probeHub, resolveHubHttp } from "./meshHubConfig";

const META_KEY = "gc_wifi_memory_meta_v1";

export type WifiMemoryMeta = {
  lastConnectedAt: number;
  lastConnectionType: string;
  preferredSsid: string;
  autoConnect: boolean;
  lastHubOkAt: number;
  lastHubUrl: string;
  /** SSIDs seen while mesh was healthy */
  knownGoodSsids: string[];
};

function meta(): WifiMemoryMeta {
  const m = S.get(META_KEY, null) as WifiMemoryMeta | null;
  return (
    m || {
      lastConnectedAt: 0,
      lastConnectionType: "none",
      preferredSsid: "",
      autoConnect: true,
      lastHubOkAt: 0,
      lastHubUrl: "",
      knownGoodSsids: [],
    }
  );
}

function setMeta(partial: Partial<WifiMemoryMeta>) {
  const next = { ...meta(), ...partial };
  S.set(META_KEY, next);
  bus.emit("wifiMemory:update", next);
  return next;
}

export function getWifiMemory(): WifiMemoryMeta {
  return meta();
}

export function setPreferredWifi(ssid: string, password?: string) {
  const s = ssid.trim();
  if (!s) return;
  if (password != null && password !== "") {
    saveWifi(s, password, { home: true, note: "Preferred mesh Wi‑Fi" });
  } else {
    // Mark existing as home
    const rows = listWifi();
    const hit = rows.find((w) => w.ssid.toLowerCase() === s.toLowerCase());
    if (hit) {
      hit.home = true;
      hit.lastUsed = Date.now();
      S.set("gc_wifi_networks_v1", rows);
    } else {
      saveWifi(s, "", { home: true, note: "Preferred (password optional)" });
    }
  }
  setMeta({ preferredSsid: s, autoConnect: true });
}

export function listRememberedWifi(): SavedWifi[] {
  return listWifi().sort((a, b) => {
    if (a.home !== b.home) return a.home ? -1 : 1;
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  });
}

/** Touch "this network is good for mesh" when hub answers */
export async function rememberMeshNetworkOk() {
  const hub = resolveHubHttp();
  const p = await probeHub(hub);
  if (!p.ok) return;
  const m = meta();
  const known = new Set(m.knownGoodSsids || []);
  if (m.preferredSsid) known.add(m.preferredSsid);
  // Also mark home wifi rows as lastUsed
  const rows = listWifi();
  let changed = false;
  for (const w of rows) {
    if (w.home || w.ssid === m.preferredSsid) {
      w.lastUsed = Date.now();
      changed = true;
    }
  }
  if (changed) S.set("gc_wifi_networks_v1", rows);
  setMeta({
    lastHubOkAt: Date.now(),
    lastHubUrl: hub,
    knownGoodSsids: [...known].slice(0, 20),
    lastConnectedAt: Date.now(),
    lastConnectionType: "wifi",
  });
}

/** When user saves Wi‑Fi from UI — always persist + set preferred if first/home */
export function rememberWifiCredentials(ssid: string, password: string, home = true) {
  const row = saveWifi(ssid, password, {
    home,
    note: home ? "Auto mesh home network" : "Saved Wi‑Fi",
  });
  if (home) setMeta({ preferredSsid: row.ssid, autoConnect: true });
  return row;
}

let started = false;

/**
 * Start Wi‑Fi memory watcher.
 * Keeps networks in app memory; on disconnect tries to guide back to preferred.
 */
export function startWifiMemory() {
  if (started) return;
  started = true;

  // Default: auto-connect preference ON
  const m = meta();
  if (m.autoConnect === undefined) setMeta({ autoConnect: true });

  const onNet = async () => {
    try {
      const st = await Network.getStatus();
      setMeta({
        lastConnectedAt: Date.now(),
        lastConnectionType: st.connectionType || (st.connected ? "unknown" : "none"),
      });
      if (st.connected && st.connectionType === "wifi") {
        await rememberMeshNetworkOk();
      }
      // If offline and we have preferred Wi‑Fi vault — remind / open settings
      if (!st.connected && meta().autoConnect && listWifi().length) {
        bus.emit("wifiMemory:need-network", {
          preferred: meta().preferredSsid || listWifi().find((w) => w.home)?.ssid || listWifi()[0]?.ssid,
        });
      }
    } catch {}
  };

  void onNet();
  try {
    Network.addListener("networkStatusChange", () => {
      void onNet();
    });
  } catch {}

  // Periodic: keep hub-good memory fresh when online
  setInterval(() => {
    void rememberMeshNetworkOk();
  }, 20000);

  console.info("[WifiMemory] vault active · auto-connect preferred networks");
}

/** Open Android Wi‑Fi settings so user can rejoin remembered SSID */
export async function openWifiSettingsForPreferred(): Promise<{ ok: boolean; message: string }> {
  const preferred =
    meta().preferredSsid || listWifi().find((w) => w.home)?.ssid || listWifi()[0]?.ssid || "";
  try {
    // Capacitor has no official Wi‑Fi join API; open system settings
    if (Capacitor.isNativePlatform()) {
      // intent via window — works on many WebViews
      try {
        (window as any).location.href = "intent:#Intent;action=android.settings.WIFI_SETTINGS;end";
      } catch {
        window.open("app-settings:", "_system");
      }
      return {
        ok: true,
        message: preferred
          ? `Open Wi‑Fi settings and join: ${preferred} (saved in app memory)`
          : "Open Wi‑Fi settings and join your home network",
      };
    }
    return { ok: false, message: "Wi‑Fi settings only on Android app" };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Could not open Wi‑Fi settings" };
  }
}

export function wifiMemorySummary(): string {
  const m = meta();
  const n = listWifi().length;
  const pref = m.preferredSsid || listWifi().find((w) => w.home)?.ssid || "—";
  return `Saved Wi‑Fi: ${n} · Preferred: ${pref} · Auto: ${m.autoConnect ? "ON" : "OFF"}`;
}
