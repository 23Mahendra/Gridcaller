/**
 * Smooth network handoff during active mesh calls.
 * Wi‑Fi ↔ mobile data / brief disconnect must NOT kill voice.
 *
 * Strategy:
 *  · Never endCall on network blip
 *  · ICE restart on RTCPeerConnection when active
 *  · Quiet mesh re-register (hub / autoJoin) without UI thrash
 *  · Debounce path switch so audio path stays warm
 */

import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { MeshEngine } from "./mesh";
import { resolveHubHttp, probeHub, ensureHubDefaults } from "./meshHubConfig";
import { startAutoMesh } from "./autoMesh";
import { startFullAutoJoin } from "./autoJoin";
import { logMeshEvent } from "./meshDirectory";
import { bus } from "./bus";
import { S } from "./storage";

let started = false;
let lastType = "";
let handoffTimer: ReturnType<typeof setTimeout> | null = null;
let iceRestartFn: (() => void) | null = null;
let inCallProbe: (() => boolean) | null = null;

/** callSession registers ICE restart hook for active PC */
export function registerIceRestart(fn: (() => void) | null) {
  iceRestartFn = fn;
}

/** Avoid circular import with callSession — probe if call active */
export function registerInCallProbe(fn: (() => boolean) | null) {
  inCallProbe = fn;
}

async function quietMeshRejoin() {
  ensureHubDefaults();
  try {
    (MeshEngine as any).reconnect?.();
  } catch {}
  try {
    await startAutoMesh(S.get("user_name") || S.get("mesh_name") || "GridUser");
  } catch {}
  try {
    await startFullAutoJoin(S.get("user_name") || S.get("mesh_name") || "GridUser");
  } catch {}
  try {
    await probeHub(resolveHubHttp());
  } catch {}
}

/**
 * Called on network change — smooth handoff, no call drop.
 */
export function onNetworkPathChange(connectionType: string, connected: boolean) {
  const inCall = !!inCallProbe?.();

  logMeshEvent(
    "network",
    `${connected ? "up" : "down"} · ${connectionType || "none"}${inCall ? " · in-call handoff" : ""}`
  );

  if (handoffTimer) clearTimeout(handoffTimer);

  // Debounce — rapid flaps (Wi‑Fi roaming) only rejoin once
  handoffTimer = setTimeout(() => {
    void (async () => {
      await quietMeshRejoin();
      if (inCall) {
        // Soft ICE restart — keep media tracks, re-path candidates
        try {
          iceRestartFn?.();
        } catch {}
        bus.emit("networkHandoff:ice-restart", { type: connectionType });
        logMeshEvent("handoff", "ICE restart / signal rejoin during call");
      }
    })();
  }, connected ? 400 : 1200);

  lastType = connectionType || lastType;
}

export function startNetworkHandoff() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const st = await Network.getStatus();
      const t = st.connectionType || (st.connected ? "unknown" : "none");
      if (t !== lastType) {
        const prev = lastType;
        lastType = t;
        if (prev) onNetworkPathChange(t, !!st.connected);
      } else if (!st.connected) {
        onNetworkPathChange(t, false);
      }
    } catch {}
  };

  void tick();
  try {
    Network.addListener("networkStatusChange", (st) => {
      onNetworkPathChange(st.connectionType || "unknown", !!st.connected);
    });
  } catch {}

  // Heartbeat rejoin even without Network events (OEM quirks)
  setInterval(() => {
    if (inCallProbe?.()) {
      try {
        (MeshEngine as any).reconnect?.();
      } catch {}
    }
  }, 15000);

  console.info("[NetworkHandoff] smooth path switch · protect voice");
}
