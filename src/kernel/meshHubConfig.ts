/**
 * Hub URL resolution for PC browser + Android APK.
 * APK cannot use window.location (it's localhost) — must use LAN IP.
 */

import { Capacitor } from "@capacitor/core";

const DEFAULT_LAN = "192.168.1.8";
const DEFAULT_PORT = "8765";
const LOCALHOST_FALLBACK = "127.0.0.1";

export function getDefaultHubHttp(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    if (host && !isLocalPreviewHost(host)) {
      return `http://${host}:${DEFAULT_PORT}`;
    }
  }
  return `http://${DEFAULT_LAN}:${DEFAULT_PORT}`;
}

export function getDefaultSignalWs(): string {
  return `ws://${DEFAULT_LAN}:${DEFAULT_PORT}/mesh-ws`;
}

function localMeshFallback(): string {
  return `http://${LOCALHOST_FALLBACK}:${DEFAULT_PORT}`;
}

function isLocalPreviewHost(hostname: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(hostname);
}

/** Resolve hub HTTP for mesh register / publish / share */
export function resolveHubHttp(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    if (isLocalPreviewHost(host)) {
      return localMeshFallback();
    }
    if (host) {
      return `http://${host}:${DEFAULT_PORT}`;
    }
  }

  try {
    const saved =
      localStorage.getItem("gc_hub_http") ||
      localStorage.getItem("gc_hub") ||
      "";
    if (saved && !/localhost|127\.0\.0\.1/i.test(saved)) {
      return saved.replace(/\/$/, "");
    }
  } catch {}

  // Native APK: never use capacitor/localhost origin
  try {
    if (Capacitor.isNativePlatform()) {
      return getDefaultHubHttp();
    }
  } catch {}

  if (typeof window !== "undefined") {
    const host = window.location.hostname || "";
    const port = window.location.port || "";
    // UI served from hub itself
    if (port === "8765" && host && !isLocalPreviewHost(host)) {
      return window.location.origin.replace(/\/$/, "");
    }
    if (host && !isLocalPreviewHost(host)) {
      return `http://${host}:${DEFAULT_PORT}`;
    }
    if (isLocalPreviewHost(host)) {
      return localMeshFallback();
    }
  }

  return localMeshFallback();
}

/** Resolve mesh WebSocket URL */
export function resolveMeshWsUrl(): string {
  try {
    const saved = localStorage.getItem("gc_signal_url") || "";
    if (saved && !/localhost|127\.0\.0\.1/i.test(saved)) {
      let u = saved.trim();
      if (u.startsWith("http://")) u = "ws://" + u.slice(7);
      if (u.startsWith("https://")) u = "wss://" + u.slice(8);
      u = u.replace(/\/$/, "");
      if (!u.includes("/mesh-ws")) {
        u = u.replace(/\/ws$/, "") + "/mesh-ws";
      }
      return u;
    }
  } catch {}

  const http = resolveHubHttp();
  try {
    const u = new URL(http);
    const p = u.protocol === "https:" ? "wss:" : "ws:";
    return `${p}//${u.host}/mesh-ws`;
  } catch {
    return `ws://${LOCALHOST_FALLBACK}:${DEFAULT_PORT}/mesh-ws`;
  }
}

/** Persist defaults so APK keeps working after first launch */
export function ensureHubDefaults(): { hub: string; signal: string } {
  const hub = resolveHubHttp();
  const signal = resolveMeshWsUrl();
  try {
    const curHub = localStorage.getItem("gc_hub_http") || "";
    if (!curHub || /localhost|127\.0\.0\.1/i.test(curHub)) {
      localStorage.setItem("gc_hub_http", hub);
    }
    const curSig = localStorage.getItem("gc_signal_url") || "";
    if (!curSig || /localhost|127\.0\.0\.1/i.test(curSig)) {
      localStorage.setItem("gc_signal_url", signal);
    }
  } catch {}
  return {
    hub: localStorage.getItem("gc_hub_http") || hub,
    signal: localStorage.getItem("gc_signal_url") || signal,
  };
}

/** Probe hub health */
export async function probeHub(
  hub = resolveHubHttp()
): Promise<{ ok: boolean; peers: number; meshWs: number; lan?: string[]; error?: string }> {
  try {
    const r = await fetch(`${hub.replace(/\/$/, "")}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { ok: false, peers: 0, meshWs: 0, error: `HTTP ${r.status}` };
    const j = await r.json();
    const httpN = Array.isArray(j.httpMeshPeers) ? j.httpMeshPeers.length : 0;
    const wsN = Array.isArray(j.meshPeers) ? j.meshPeers.length : 0;
    return {
      ok: !!j.ok,
      // Prefer HTTP peer count (APK path) over WS-only
      peers: Math.max(httpN, wsN, Number(j.meshWsClients || 0)),
      meshWs: Number(j.meshWsClients || 0),
      lan: j.lan,
    };
  } catch (e: any) {
    return { ok: false, peers: 0, meshWs: 0, error: e?.message || "unreachable" };
  }
}

export type HubPeer = {
  id: string;
  name: string;
  handle?: string;
  phone?: string;
  displayNumber?: string;
  lastSeen?: number;
};

/** Fetch live peer list from hub HTTP (works even if WS is reconnecting) */
export async function fetchHubMeshPeers(hub = resolveHubHttp()): Promise<HubPeer[]> {
  try {
    const r = await fetch(`${hub.replace(/\/$/, "")}/api/mesh/peers`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return [];
    const j = await r.json();
    if (Array.isArray(j.details)) {
      return j.details.map((p: any) => ({
        id: String(p.id),
        name: String(p.name || p.handle || p.id),
        handle: p.handle ? String(p.handle) : undefined,
        phone: p.phone ? String(p.phone) : undefined,
        displayNumber: p.displayNumber ? String(p.displayNumber) : undefined,
        lastSeen: p.lastSeen,
      }));
    }
    if (Array.isArray(j.peers)) {
      return j.peers.map((id: string) => ({ id: String(id), name: String(id) }));
    }
    return [];
  } catch {
    return [];
  }
}

/** Resolve dial string (handle / phone / id) → live mesh peer via hub */
export async function resolveMeshTarget(
  query: string,
  hub = resolveHubHttp()
): Promise<HubPeer | null> {
  const q = String(query || "").trim();
  if (!q) return null;
  try {
    const r = await fetch(
      `${hub.replace(/\/$/, "")}/api/mesh/resolve?q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (j.ok && j.peer?.id) {
      return {
        id: String(j.peer.id),
        name: String(j.peer.name || j.peer.handle || j.peer.id),
        handle: j.peer.handle,
        phone: j.peer.phone,
        displayNumber: j.peer.displayNumber,
        lastSeen: j.peer.lastSeen,
      };
    }
  } catch {}
  // Local fallback: scan peers list
  try {
    const dig = q.replace(/\D/g, "");
    const h = q.replace(/^@/, "").toLowerCase();
    const list = await fetchHubMeshPeers(hub);
    for (const p of list) {
      if (p.id === q) return p;
      if (p.handle && p.handle.toLowerCase() === h) return p;
      if (dig.length >= 10 && p.phone && p.phone.slice(-10) === dig.slice(-10)) return p;
      if (
        dig.length >= 10 &&
        p.displayNumber &&
        String(p.displayNumber).replace(/\D/g, "").slice(-10) === dig.slice(-10)
      ) {
        return p;
      }
    }
  } catch {}
  return null;
}
