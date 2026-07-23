/**
 * GridAlive connectivity bridge protocol
 * ──────────────────────────────────────
 * Future: full GridAlive modules plug into this app.
 * Now: register transfer manifests, list hub packages, clone via GitHub.
 */
import { getHubHttp, getPeerId, getDisplayName } from "./identity";

export type BridgeManifest = {
  id: string;
  ts: number;
  from: string;
  kind: string;
  name: string;
  files: { path: string; size?: number; url?: string }[];
  note?: string;
  source?: string;
};

export async function listTransfers(hub = getHubHttp()): Promise<BridgeManifest[]> {
  const r = await fetch(`${hub}/api/bridge/list`);
  const j = await r.json();
  return j.transfers || [];
}

export async function registerManifest(partial: {
  name?: string;
  kind?: string;
  note?: string;
  files?: BridgeManifest["files"];
  source?: string;
}) {
  const hub = getHubHttp();
  const r = await fetch(`${hub}/api/bridge/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${getDisplayName()} (${getPeerId()})`,
      name: partial.name || "GridAlive",
      kind: partial.kind || "gridalive-bundle",
      note: partial.note || "Bridge slot for full GridAlive transfer",
      files: partial.files || [],
      source: partial.source || "gridcaller-app",
    }),
  });
  return r.json();
}

/** Capability advertisement — other nodes know this app can host GridAlive later */
export function bridgeCapabilities() {
  return {
    app: "gridcaller",
    version: "2.0.0",
    canCall: true,
    canChat: true,
    canShareApk: true,
    canHostGridAlive: true, // slot ready
    canGitHub: true, // via PC hub gh
    peerId: getPeerId(),
  };
}
