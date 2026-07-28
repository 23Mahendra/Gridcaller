/**
 * Flight mode / no-SIM / offline mesh policy for GridCaller testing.
 *
 * Physics: bits need SOME path between devices.
 * In airplane mode SIM is off, but Wi-Fi / Hotspot can still be ON.
 * Then LAN mesh (same hotspot / same Wi-Fi) works WITHOUT SIM or mobile data.
 *
 * Cloud relays are intentionally opt-in. The app defaults to sovereign local
 * mesh unless the operator explicitly enables cloud bridging.
 */

import { S } from "./storage";

export type MeshPathMode = "auto" | "force-local" | "allow-cloud";

export function isFlightOrOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  if (S.get("gc_force_local_mesh", false) === true) return true;
  if (navigator.onLine === false) return true;
  return false;
}

export function allowCloudMesh(): boolean {
  const mode = (S.get("gc_mesh_path_mode", "auto") as MeshPathMode) || "auto";
  if (mode === "force-local") return false;
  if (mode === "allow-cloud") return !isFlightOrOffline();
  return S.get("gc_allow_cloud_gun", false) === true && !isFlightOrOffline();
}

export function useLocalMeshOnly(): boolean {
  return !allowCloudMesh();
}

export function setForceLocalMesh(on: boolean) {
  S.set("gc_force_local_mesh", !!on);
  S.set("gc_mesh_path_mode", on ? "force-local" : "auto");
  if (on) S.set("gc_allow_cloud_gun", false);
}

export function getForceLocalMesh(): boolean {
  return S.get("gc_force_local_mesh", false) === true || S.get("gc_mesh_path_mode") === "force-local";
}

/**
 * ICE for WebRTC:
 * - Local/flight: empty servers -> host candidates only (same LAN / hotspot)
 * - Online cloud mode: STUN (+ optional TURN) for NAT
 */
export function iceServersForMesh(): RTCIceServer[] {
  if (!allowCloudMesh()) {
    return [];
  }
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
}

/** Gun peer list: empty = localStorage-only graph (works offline) */
export function gunPeersForMesh(cloudPeers: string[] = []): string[] {
  if (!allowCloudMesh()) return [];
  return cloudPeers.filter(Boolean);
}

export function meshModeLabel(): string {
  if (S.get("gc_radio_mode", true) === true || getForceLocalMesh()) {
    return "Free radio mesh · no SIM · no cloud track";
  }
  if (!allowCloudMesh()) return "Sovereign local mesh · peer relays only";
  if (isFlightOrOffline()) return "Offline / flight · LAN mesh only";
  return "Cloud-bridged mesh · explicit opt-in";
}

/** Free-radio doctrine: never use carrier identity or public trackers */
export function enableFreeRadioMeshDefaults() {
  setForceLocalMesh(true);
  S.set("gc_allow_cloud_gun", false);
  S.set("gc_radio_mode", true);
}
