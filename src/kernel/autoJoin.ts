/**
 * Proximity Auto-Mesh Fabric
 * ─────────────────────────
 * ANY device with GridCaller stays mesh-joined automatically.
 * No per-device Connect. When another GridCaller enters range
 * (same Wi‑Fi / hotspot / internet swarm / Bluetooth proximity /
 * soft multi-hop), it appears ONLINE by itself.
 *
 * Paths (all permutations, continuous):
 *  · wifi-hub     — LAN hub HTTP register/poll + WS
 *  · multi-hub    — probe common LAN IPs if default hub down
 *  · swarm        — Trystero global room (WebRTC discovery)
 *  · soft-tower   — multi-hop software relay (peer density = range)
 *  · free-fabric  — bonded free links
 *  · bluetooth    — continuous BLE scan (nearby radios)
 *
 * Honesty: raw cellular/ISM RF chips are not open to apps.
 * "RF fabric" here = software multi-hop over every OS-allowed radio.
 *
 * One-time OS permissions (Location / Nearby / BT / Mic), then forever auto.
 */

import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { App as CapApp } from "@capacitor/app";
import { MeshEngine } from "./mesh";
import { S } from "./storage";
import { bus } from "./bus";
import {
  ensureHubDefaults,
  resolveHubHttp,
  fetchHubMeshPeers,
  probeHub,
  getDefaultHubHttp,
} from "./meshHubConfig";
import { startAutoMesh, unifyLocalIdentity, getStatus as autoStatus, getPeers as autoPeers } from "./autoMesh";
import { startResilientMesh } from "./resilientMesh";
import { startCallSession } from "./callSession";
import softTowerHop from "./softTowerHopNet";
import freeMeshFabric from "./freeMeshFabric";
import { ensureLocationPermission } from "./nativePermissions";
import { rememberPeer } from "./meshDirectory";
import { buildHandshakeReply, shouldReplyToHello, rememberHelloPeer } from "./meshHandshake";

export type AutoJoinStatus = {
  running: boolean;
  wifi: boolean;
  hub: boolean;
  swarm: boolean;
  bluetooth: boolean;
  softTower: boolean;
  peers: number;
  note: string;
  lastBleScan: number;
  bleFound: number;
  paths: string[];
};

let running = false;
let wifiTimer: ReturnType<typeof setInterval> | null = null;
let bleTimer: ReturnType<typeof setInterval> | null = null;
let helloTimer: ReturnType<typeof setInterval> | null = null;
let bleBusy = false;
let lastBleScan = 0;
let bleFound = 0;
let hubOk = false;
let wifiOk = false;
let appListeners = false;
const statusListeners = new Set<(s: AutoJoinStatus) => void>();

function meName() {
  return S.get("user_name") || S.get("mesh_name") || "GridUser";
}

function meIdentity() {
  return {
    id: MeshEngine.localId || S.get("mesh_id", ""),
    name: meName(),
    handle: String(S.get("global_call_handle", "") || "").replace(/^@/, ""),
    phone: String(S.get("user_phone", "") || "").replace(/\D/g, ""),
  };
}

function emit() {
  const st = getAutoJoinStatus();
  for (const fn of statusListeners) {
    try {
      fn(st);
    } catch {}
  }
  try {
    bus.emit("autoJoin:status", st);
  } catch {}
}

export function getAutoJoinStatus(): AutoJoinStatus {
  let peers = 0;
  try {
    peers = Object.keys((MeshEngine as any).peers || {}).length;
  } catch {}
  try {
    peers = Math.max(peers, softTowerHop.getPeers().length, autoPeers().length);
  } catch {}
  const am = autoStatus();
  const softN = (() => {
    try {
      return softTowerHop.getPeers().length;
    } catch {
      return 0;
    }
  })();
  const paths: string[] = [];
  if (hubOk) paths.push("wifi-hub");
  if (am.trysteroOk) paths.push("webrtc-swarm");
  if (softN > 0 || am.started) paths.push("soft-tower-hop");
  if (Date.now() - lastBleScan < 90000) paths.push("bluetooth");
  paths.push("free-fabric");

  const parts: string[] = [];
  if (hubOk) parts.push("Wi‑Fi");
  if (am.trysteroOk) parts.push("WebRTC swarm");
  if (softN) parts.push(`hop×${softN}`);
  if (bleFound > 0) parts.push(`BT ${bleFound}`);
  parts.push("auto-connect ON");

  return {
    running,
    wifi: wifiOk,
    hub: hubOk,
    swarm: !!am.trysteroOk,
    bluetooth: Date.now() - lastBleScan < 90000,
    softTower: softN > 0 || am.started,
    peers,
    note: parts.join(" · "),
    lastBleScan,
    bleFound,
    paths,
  };
}

export function onAutoJoinStatus(fn: (s: AutoJoinStatus) => void) {
  statusListeners.add(fn);
  try {
    fn(getAutoJoinStatus());
  } catch {}
  return () => statusListeners.delete(fn);
}

function injectPeer(
  id: string,
  name: string,
  via: string,
  extra?: { handle?: string; phone?: string; hops?: number }
) {
  if (!id) return;
  try {
    const mid = MeshEngine.localId;
    if (id === mid || id === S.get("mesh_id", "") || id === "hub-pc") return;
  } catch {}
  try {
    const mp = (MeshEngine as any).peers || {};
    const prev = mp[id] || {};
    const vias = new Set([...(prev.via || []), via]);
    mp[id] = {
      ...prev,
      name: name || prev.name || id.slice(0, 12),
      lastSeen: Date.now(),
      via: [...vias],
      handle: extra?.handle ?? prev.handle,
      phone: extra?.phone ?? prev.phone,
      hops: extra?.hops ?? prev.hops ?? 1,
      autoMesh: true,
    };
    (MeshEngine as any).peers = mp;
  } catch {}
  try {
    bus.emit("autoJoin:peer", { id, name, via });
  } catch {}
  try {
    rememberPeer(id, { name, handle: extra?.handle, phone: extra?.phone, via, hops: extra?.hops });
  } catch {}
}

/** Flood presence on every bonded path so nearby GridCallers see us */
function floodPresence() {
  const me = meIdentity();
  const payload = {
    id: me.id,
    name: me.name,
    handle: me.handle,
    phone: me.phone,
    autoJoin: true,
    fabric: true,
    ts: Date.now(),
  };
  try {
    rememberHelloPeer(me.id, Date.now());
  } catch {}
  try {
    MeshEngine.broadcast("AM_HELLO", payload);
    MeshEngine.broadcast("PEER_HELLO", payload);
    MeshEngine.broadcast("AM_PRESENCE", payload);
    MeshEngine.broadcast("GRIDCALLER_PRESENCE", payload);
  } catch {}
  try {
    softTowerHop.start(me.name);
  } catch {}
}

/** Probe default + common LAN hub IPs so phones find PC without config */
async function probeAnyHub(): Promise<string | null> {
  const candidates = new Set<string>();
  candidates.add(resolveHubHttp());
  candidates.add(getDefaultHubHttp());
  // Common home router PC addresses
  for (const host of [
    "192.168.1.8",
    "192.168.0.8",
    "192.168.1.2",
    "192.168.1.10",
    "192.168.29.1",
    "10.0.0.2",
  ]) {
    candidates.add(`http://${host}:8765`);
  }
  try {
    const saved = localStorage.getItem("gc_hub_http");
    if (saved) candidates.add(saved.replace(/\/$/, ""));
  } catch {}

  for (const hub of candidates) {
    try {
      const h = await probeHub(hub);
      if (h.ok) {
        try {
          localStorage.setItem("gc_hub_http", hub);
          localStorage.setItem(
            "gc_signal_url",
            hub.replace(/^http/, "ws") + "/mesh-ws"
          );
        } catch {}
        return hub;
      }
    } catch {}
  }
  return null;
}

async function wifiAutoPass() {
  ensureHubDefaults();
  try {
    (MeshEngine as any).start?.();
    (MeshEngine as any).reconnect?.();
  } catch {}
  try {
    await startAutoMesh(meName());
  } catch {}
  try {
    softTowerHop.start(meName());
    freeMeshFabric.start(meName());
  } catch {}

  try {
    if (Capacitor.isNativePlatform()) {
      const n = await Network.getStatus();
      wifiOk = !!n.connected;
    } else {
      wifiOk = navigator.onLine !== false;
    }
  } catch {
    wifiOk = true;
  }

  let hub = resolveHubHttp();
  let health = await probeHub(hub);
  if (!health.ok) {
    const alt = await probeAnyHub();
    if (alt) {
      hub = alt;
      health = await probeHub(hub);
    }
  }
  hubOk = !!health.ok;

  // Hub peer directory → auto ONLINE
  try {
    const list = await fetchHubMeshPeers(hub);
    for (const p of list) {
      if (!p.id || p.id === "hub-pc") continue;
      injectPeer(p.id, p.name || p.handle || p.id, "wifi-hub", {
        handle: p.handle,
        phone: p.phone,
      });
    }
  } catch {}

  // Soft tower + autoMesh peers
  try {
    for (const p of softTowerHop.getPeers()) {
      injectPeer(p.id, p.name, "soft-tower", { hops: p.hops });
    }
  } catch {}
  try {
    for (const p of autoPeers()) {
      injectPeer(p.id, p.name, "swarm", { phone: p.phone, handle: p.displayNumber });
    }
  } catch {}
  try {
    for (const p of freeMeshFabric.getPeers()) {
      if (p.online) injectPeer(p.id, p.name, "free-fabric", { hops: p.hops });
    }
  } catch {}

  floodPresence();
  emit();
}

async function bleAutoPass() {
  if (!Capacitor.isNativePlatform()) return;
  if (bleBusy) return;
  bleBusy = true;
  try {
    await ensureLocationPermission();
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await BleClient.initialize({ androidNeverForLocation: false });

    try {
      const on = await BleClient.isEnabled();
      if (!on) {
        try {
          await BleClient.requestEnable();
        } catch {
          lastBleScan = Date.now();
          emit();
          return;
        }
      }
    } catch {}

    try {
      const anyBle = BleClient as any;
      if (typeof anyBle.startAdvertising === "function") {
        await anyBle.startAdvertising({
          name: `GridCaller-${String(MeshEngine.localId || "node").slice(-6)}`,
        });
      }
    } catch {
      /* optional */
    }

    const found: { deviceId: string; name: string; rssi: number }[] = [];
    const seen = new Set<string>();
    await BleClient.requestLEScan({ allowDuplicates: false }, (result) => {
      const id = result?.device?.deviceId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const nm =
        result.device?.name ||
        result.localName ||
        (result as any).localName ||
        "BT nearby";
      found.push({
        deviceId: id,
        name: String(nm),
        rssi: typeof result.rssi === "number" ? result.rssi : -100,
      });
    });

    await new Promise((r) => setTimeout(r, 4500));
    try {
      await BleClient.stopLEScan();
    } catch {}

    lastBleScan = Date.now();
    bleFound = found.length;

    found.sort((a, b) => {
      const score = (n: string) =>
        /gridcaller|grid.?alive|mesh/i.test(n)
          ? 4
          : /phone|galaxy|pixel|redmi|vivo|oppo|oneplus|mi |realme|samsung/i.test(n)
            ? 2
            : 1;
      const d = score(b.name) - score(a.name);
      return d || b.rssi - a.rssi;
    });

    // Proximity = auto mesh node (no manual pair UI)
    for (const f of found.slice(0, 16)) {
      const peerId = `ble_${f.deviceId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
      injectPeer(peerId, f.name || "Nearby radio", "bluetooth");
      try {
        await BleClient.connect(f.deviceId, () => {
          bus.emit("autoJoin:ble-disconnect", { id: f.deviceId });
        });
      } catch {
        /* presence via scan is enough */
      }
    }

    if (found.length) {
      try {
        freeMeshFabric.start(meName());
        softTowerHop.start(meName());
        floodPresence();
      } catch {}
    }
  } catch (e) {
    console.warn("[AutoJoin] BLE", e);
    lastBleScan = Date.now();
  } finally {
    bleBusy = false;
    emit();
  }
}

/**
 * Start continuous proximity mesh. Idempotent.
 * Every GridCaller in Wi‑Fi / BT / swarm range auto-stays connected.
 */
export async function startFullAutoJoin(userName?: string): Promise<AutoJoinStatus> {
  if (userName) {
    S.set("user_name", userName);
    S.set("mesh_name", userName);
  }
  unifyLocalIdentity();
  ensureHubDefaults();

  if (running) {
    void wifiAutoPass();
    void bleAutoPass();
    floodPresence();
    return getAutoJoinStatus();
  }
  running = true;

  try {
    (MeshEngine as any).start?.();
  } catch {}
  startCallSession();
  await startAutoMesh(meName());
  await startResilientMesh();
  try {
    softTowerHop.start(meName());
    freeMeshFabric.start(meName());
  } catch {}

  await wifiAutoPass();
  setTimeout(() => void bleAutoPass(), 1500);

  // Aggressive continuous discovery — proximity fabric
  wifiTimer = setInterval(() => void wifiAutoPass(), 3000);
  bleTimer = setInterval(() => void bleAutoPass(), 12000);
  helloTimer = setInterval(() => floodPresence(), 5000);

  // Network change → rejoin all paths immediately
  try {
    if (Capacitor.isNativePlatform()) {
      Network.addListener("networkStatusChange", (st) => {
        wifiOk = !!st.connected;
        void wifiAutoPass();
        void bleAutoPass();
        floodPresence();
      });
    }
  } catch {}

  // App back to foreground → rejoin
  if (!appListeners) {
    appListeners = true;
    try {
      if (Capacitor.isNativePlatform()) {
        CapApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            void wifiAutoPass();
            void bleAutoPass();
            floodPresence();
          }
        });
        CapApp.addListener("resume", () => {
          void wifiAutoPass();
          void bleAutoPass();
          floodPresence();
        });
      }
    } catch {}
    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void wifiAutoPass();
          floodPresence();
        }
      });
    } catch {}
  }

  // Any hello → peer ONLINE (auto connect table)
  try {
    MeshEngine.onMessage((msg: any) => {
      if (!msg?.from || msg.from === MeshEngine.localId) return;
      const t = String(msg.type || "");
      const d = msg.data || {};
      const now = Date.now();
      if (/HELLO|PRESENCE|ANNOUNCE|AM_|PEER_|FABRIC|SOFT_TOWER|GRIDCALLER_LOCATION/i.test(t)) {
        const id = String(d?.id || msg.from || "").trim();
        if (id) {
          rememberHelloPeer(id, now);
          if (shouldReplyToHello(id, now)) {
            const reply = buildHandshakeReply({
              id: MeshEngine.localId,
              name: meName(),
              handle: String(S.get("global_call_handle", "") || "").replace(/^@/, ""),
              phone: String(S.get("user_phone", "") || "").replace(/\D/g, ""),
              ts: now,
            }, id);
            try {
              MeshEngine.broadcast("AM_HELLO", reply);
            } catch {}
          }
        }
        injectPeer(msg.from, msg.fromName || d.name || msg.from, "proximity", {
          handle: d.handle,
          phone: d.phone,
        });
        emit();
      }
    });
  } catch {}

  console.info(
    "[AutoJoin] PROXIMITY FABRIC · all GridCallers auto-connect · Wi‑Fi·swarm·hop·BT"
  );
  emit();
  return getAutoJoinStatus();
}

export function stopFullAutoJoin() {
  running = false;
  if (wifiTimer) clearInterval(wifiTimer);
  if (bleTimer) clearInterval(bleTimer);
  if (helloTimer) clearInterval(helloTimer);
  wifiTimer = null;
  bleTimer = null;
  helloTimer = null;
}

// Eager boot
try {
  if (typeof window !== "undefined") {
    ensureHubDefaults();
    unifyLocalIdentity();
    setTimeout(() => {
      void startFullAutoJoin();
    }, 400);
  }
} catch {}
