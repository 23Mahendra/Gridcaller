/**
 * Resilient multi-path mesh — stay connected however possible.
 *
 * Priority:
 *  1) Same Wi‑Fi + PC hub (lowest latency, full mesh)
 *  2) Internet swarm (Trystero) when hub/Wi‑Fi gone but data available
 *  3) Soft-tower hop via any online peer
 *  4) Bluetooth LE nearby scan — keep soft presence when radio range only
 *
 * One-time OS permissions (Location / BT / Nearby) required; then automatic.
 */

import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { MeshEngine } from "./mesh";
import softTowerHop from "./softTowerHopNet";
import freeMeshFabric from "./freeMeshFabric";
import { startAutoMesh, getStatus as autoStatus, getPeers as autoPeers } from "./autoMesh";
import { S } from "./storage";
import { bus } from "./bus";

export type PathHealth = {
  wifiHub: boolean;
  swarm: boolean;
  softTower: boolean;
  bluetooth: boolean;
  onlinePeers: number;
  activePaths: string[];
  note: string;
};

let started = false;
let pathTimer: ReturnType<typeof setInterval> | null = null;
let bleTimer: ReturnType<typeof setInterval> | null = null;
let bleScanning = false;
let lastBleOk = 0;
const listeners = new Set<(h: PathHealth) => void>();

function name() {
  return S.get("user_name") || S.get("mesh_name") || "GridUser";
}

function emit(h: PathHealth) {
  for (const fn of listeners) {
    try {
      fn(h);
    } catch {}
  }
  try {
    bus.emit("resilientMesh:health", h);
  } catch {}
}

export function onPathHealth(fn: (h: PathHealth) => void) {
  listeners.add(fn);
  try {
    fn(getPathHealth());
  } catch {}
  return () => listeners.delete(fn);
}

export function getPathHealth(): PathHealth {
  const st = autoStatus();
  let softN = 0;
  try {
    softN = softTowerHop.getPeers().length;
  } catch {}
  const onlinePeers = Math.max(st.peerCount, softN, autoPeers().length);
  const bluetooth = Date.now() - lastBleOk < 90000;
  const active: string[] = [];
  if (st.hubOk) active.push("wifi-hub");
  if (st.trysteroOk) active.push("swarm");
  if (softN > 0 || st.started) active.push("soft-tower");
  if (bluetooth) active.push("bluetooth");

  let note = "Mesh ready";
  if (st.hubOk && onlinePeers > 0) note = "Wi‑Fi hub mesh · peers online";
  else if (st.hubOk) note = "Wi‑Fi hub ON · waiting for other phones";
  else if (st.trysteroOk) note = "Swarm mesh (hub offline)";
  else if (bluetooth) note = "Bluetooth nearby path active";
  else if (softN) note = "Soft-tower hop path";
  else note = "Searching paths (Wi‑Fi / swarm / BT)…";

  return {
    wifiHub: st.hubOk,
    swarm: st.trysteroOk,
    softTower: softN > 0 || st.started,
    bluetooth,
    onlinePeers,
    activePaths: active,
    note,
  };
}

/** Background BLE scan — find nearby devices, feed soft mesh (no manual Connect) */
async function bleAutoPass() {
  if (!Capacitor.isNativePlatform()) return;
  if (bleScanning) return;
  // If hub is solid with peers, scan less often (handled by caller interval)
  bleScanning = true;
  try {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await BleClient.initialize({ androidNeverForLocation: false });
    try {
      const on = await BleClient.isEnabled();
      if (!on) {
        // Don't force dialog every cycle — only when totally offline
        const h = getPathHealth();
        if (!h.wifiHub && !h.swarm) {
          try {
            await BleClient.requestEnable();
          } catch {}
        }
      }
    } catch {}

    const found: { id: string; name: string; rssi: number }[] = [];
    const seen = new Set<string>();
    await BleClient.requestLEScan({ allowDuplicates: false }, (result) => {
      const id = result?.device?.deviceId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const nm =
        result.device?.name ||
        result.localName ||
        (result as any).localName ||
        "BT device";
      found.push({
        id,
        name: String(nm),
        rssi: typeof result.rssi === "number" ? result.rssi : -100,
      });
    });
    await new Promise((r) => setTimeout(r, 4500));
    try {
      await BleClient.stopLEScan();
    } catch {}

    if (found.length) {
      lastBleOk = Date.now();
      // Prefer GridCaller-ish names, then strongest
      found.sort((a, b) => {
        const score = (n: string) =>
          /grid|caller|mesh|alive/i.test(n) ? 2 : /nearby|unknown|^bt /i.test(n) ? 0 : 1;
        const d = score(b.name) - score(a.name);
        if (d) return d;
        return b.rssi - a.rssi;
      });
      for (const f of found.slice(0, 8)) {
        // Inject as soft mesh peer so UI shows nearby path
        try {
          const mp = (MeshEngine as any).peers || {};
          const peerId = `ble_${f.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`;
          mp[peerId] = {
            name: f.name,
            lastSeen: Date.now(),
            via: ["bluetooth"],
            rssi: f.rssi,
          };
          (MeshEngine as any).peers = mp;
        } catch {}
      }
      try {
        freeMeshFabric.start(name());
        softTowerHop.start(name());
      } catch {}
      bus.emit("resilientMesh:ble", { count: found.length, top: found[0] });
    }
  } catch (e) {
    console.warn("[ResilientMesh] BLE pass", e);
  } finally {
    bleScanning = false;
  }
}

async function refreshPaths() {
  try {
    await startAutoMesh(name());
  } catch {}
  try {
    softTowerHop.start(name());
  } catch {}
  try {
    freeMeshFabric.start(name());
  } catch {}
  try {
    (MeshEngine as any).start?.();
    (MeshEngine as any).reconnect?.();
  } catch {}

  const h = getPathHealth();
  // When Wi‑Fi hub weak → more aggressive BT
  if (!h.wifiHub || h.onlinePeers === 0) {
    void bleAutoPass();
  }
  emit(getPathHealth());
}

export async function startResilientMesh() {
  if (started) {
    void refreshPaths();
    return getPathHealth();
  }
  started = true;

  await startAutoMesh(name());
  try {
    softTowerHop.start(name());
    freeMeshFabric.start(name());
  } catch {}

  // Network change → immediate repath
  try {
    Network.addListener("networkStatusChange", (status) => {
      console.info("[ResilientMesh] network", status.connected, status.connectionType);
      void refreshPaths();
      if (!status.connected || status.connectionType === "none") {
        void bleAutoPass();
      }
    });
  } catch {}

  pathTimer = setInterval(() => void refreshPaths(), 7000);
  // BLE background every 25s when away from strong hub
  bleTimer = setInterval(() => {
    const h = getPathHealth();
    if (!h.wifiHub || h.onlinePeers < 1) void bleAutoPass();
  }, 25000);

  // First BLE pass after short delay (permissions may just have been granted)
  setTimeout(() => void bleAutoPass(), 3000);

  void refreshPaths();
  console.info("[ResilientMesh] multi-path ON · wifi · swarm · hop · ble");
  return getPathHealth();
}

export function stopResilientMesh() {
  started = false;
  if (pathTimer) clearInterval(pathTimer);
  if (bleTimer) clearInterval(bleTimer);
  pathTimer = null;
  bleTimer = null;
}
