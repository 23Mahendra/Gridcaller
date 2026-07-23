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

export async function setPrivacyMode(on: boolean, operatorName = "Operator"): Promise<PrivacyStatus> {
  S.set(KEY, on);
  if (on) {
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
    // leave local mesh as user had it — only clear privacy flag
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
