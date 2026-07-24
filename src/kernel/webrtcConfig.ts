import { resolveHubHttp } from "./meshHubConfig";
import { env } from "../env";
import { iceServersForMesh, useLocalMeshOnly } from "./offlineMode";

type HubWebRtcConfig = {
  iceServers?: RTCIceServer[];
};

let cache: { ts: number; servers: RTCIceServer[] } | null = null;

const CACHE_MS = 60_000;

function sanitizeIceServers(list: unknown): RTCIceServer[] {
  if (!Array.isArray(list)) return [];
  const out: RTCIceServer[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const urls = (row as any).urls;
    if (!urls) continue;
    const entry: RTCIceServer = { urls };
    if (typeof (row as any).username === "string") entry.username = (row as any).username;
    if (typeof (row as any).credential === "string") entry.credential = (row as any).credential;
    out.push(entry);
  }
  return out;
}

function fallbackServers(): RTCIceServer[] {
  if (useLocalMeshOnly()) return iceServersForMesh();
  try {
    if (env.iceServersJson) {
      const parsed = JSON.parse(env.iceServersJson);
      const fromEnv = sanitizeIceServers(parsed);
      if (fromEnv.length) return fromEnv;
    }
  } catch {}
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
}

export async function getWebRtcIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
  if (useLocalMeshOnly()) return iceServersForMesh();
  if (!forceRefresh && cache && Date.now() - cache.ts < CACHE_MS) return cache.servers;
  const fallback = fallbackServers();
  try {
    const hub = resolveHubHttp().replace(/\/$/, "");
    const r = await fetch(`${hub}/api/webrtc/config`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) {
      cache = { ts: Date.now(), servers: fallback };
      return fallback;
    }
    const j = (await r.json()) as HubWebRtcConfig;
    const servers = sanitizeIceServers(j.iceServers);
    const out = servers.length ? servers : fallback;
    cache = { ts: Date.now(), servers: out };
    return out;
  } catch {
    cache = { ts: Date.now(), servers: fallback };
    return fallback;
  }
}
