/**
 * Privacy / anti-track test mode for GridCaller
 *
 * NOT a full OS VPN (that needs native VPN APIs / separate VPN app).
 * This mode makes GridCaller traffic hard to track by:
 *  · Force local mesh only (no cloud Gun / no public STUN when offline policy)
 *  · Disable cloud Gun flag
 *  · Free Radio AES channels preferred
 *  · Soft-tower hop local only
 *  · Optional: rotate radio ID
 *
 * For stronger anonymity: use a system VPN (WireGuard/OpenVPN) on the device
 * alongside this mode — app does not replace OS VPN, it avoids cloud mesh trackers.
 */

import { S } from "./storage";
import { bus } from "./bus";
import { enableFreeRadioMeshDefaults, setForceLocalMesh, getForceLocalMesh } from "./offlineMode";
import freeRadio from "./radioMesh";
import softTowerHop from "./softTowerHopNet";

const KEY = "gc_privacy_mode_v1";
const BACKUP_KEY = "gc_privacy_mode_prev_state_v1";

type PrivacyPreviousState = {
  forceLocalMesh: boolean;
  allowCloudGun: boolean;
  radioOn: boolean;
  softTowerRunning: boolean;
};

export type PrivacyStatus = {
  on: boolean;
  localMesh: boolean;
  cloudGun: boolean;
  radioOn: boolean;
  radioChannel: string;
  softTowers: number;
  note: string;
  osVpnHint: string;
};

export function isPrivacyMode(): boolean {
  return S.get(KEY, false) === true;
}

function readPreviousState(): PrivacyPreviousState | null {
  const raw = S.get(BACKUP_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  return {
    forceLocalMesh: raw.forceLocalMesh === true,
    allowCloudGun: raw.allowCloudGun === true,
    radioOn: raw.radioOn === true,
    softTowerRunning: raw.softTowerRunning === true,
  };
}

function savePreviousState(): PrivacyPreviousState {
  const prev: PrivacyPreviousState = {
    forceLocalMesh: getForceLocalMesh(),
    allowCloudGun: S.get("gc_allow_cloud_gun", false) === true,
    radioOn: freeRadio.enabled,
    softTowerRunning: softTowerHop.ready,
  };
  S.set(BACKUP_KEY, prev);
  return prev;
}

function clearPreviousState() {
  S.set(BACKUP_KEY, null);
}

export async function setPrivacyMode(on: boolean, operatorName = "Operator"): Promise<PrivacyStatus> {
  const wasOn = isPrivacyMode();
  if (on) {
    if (!wasOn) {
      savePreviousState();
    }
    S.set(KEY, true);
    enableFreeRadioMeshDefaults();
    setForceLocalMesh(true);
    S.set("gc_allow_cloud_gun", false);
    try {
      await freeRadio.enable(true);
      freeRadio.setOperatorName(operatorName);
    } catch {}
    try {
      softTowerHop.start(operatorName);
    } catch {}
    bus.emit("privacy:on", {});
  } else {
    if (!wasOn) {
      clearPreviousState();
      return getPrivacyStatus();
    }
    const prev = readPreviousState();
    if (prev) {
      setForceLocalMesh(prev.forceLocalMesh);
      S.set("gc_allow_cloud_gun", prev.allowCloudGun);
      try {
        await freeRadio.enable(prev.radioOn);
      } catch {}
      try {
        if (prev.softTowerRunning) softTowerHop.start(operatorName);
        else softTowerHop.stop();
      } catch {}
      clearPreviousState();
    } else {
      try {
        await freeRadio.enable(false);
      } catch {}
      try {
        softTowerHop.stop();
      } catch {}
      setForceLocalMesh(false);
    }
    S.set(KEY, false);
    bus.emit("privacy:off", {});
  }
  return getPrivacyStatus();
}

export function getPrivacyStatus(): PrivacyStatus {
  const on = isPrivacyMode();
  let towers = 1;
  try {
    towers = softTowerHop.getNetworkHealth().softTowers;
  } catch {}
  return {
    on,
    localMesh: getForceLocalMesh() || on,
    cloudGun: S.get("gc_allow_cloud_gun", false) === true && !on,
    radioOn: freeRadio.enabled,
    radioChannel: freeRadio.channelName,
    softTowers: towers,
    note: on
      ? "Privacy ON: GridCaller local mesh only · no cloud Gun · radio AES. Carrier/OS track still needs system VPN if you want full device tunnel."
      : "Privacy OFF: auto path may use cloud when online.",
    osVpnHint:
      "Full ‘VPN hide everything’ = install WireGuard/OpenVPN on phone + this Privacy mode together for testing.",
  };
}
