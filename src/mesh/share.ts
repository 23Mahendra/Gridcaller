/**
 * Real file / APK share:
 * - WiFi: download from hub /share/*
 * - Bluetooth / Nearby / Android share sheet: Capacitor Share + system intents
 */
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { ensureHubDefaults, getDefaultHubHttp, resolveHubHttp } from "../kernel/meshHubConfig";

export type ShareFile = {
  name: string;
  size: number;
  mtime: number;
  url: string;
  isApk: boolean;
};

function hubHttp() {
  ensureHubDefaults();
  let h = resolveHubHttp().replace(/\/$/, "");
  if (/localhost|127\.0\.0\.1/i.test(h)) h = getDefaultHubHttp();
  return h;
}

export async function fetchShareList(hub = hubHttp()): Promise<ShareFile[]> {
  const h = (hub || hubHttp()).replace(/\/$/, "");
  const r = await fetch(`${h}/api/share/list`, {
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  const j = await r.json();
  if (!j.ok && !j.files && !j.share) throw new Error(j.error || "share list failed");
  return j.files || j.share || [];
}

export function wifiDownloadUrl(file: ShareFile, hub = hubHttp()) {
  if (file.url.startsWith("http")) return file.url;
  const h = (hub || hubHttp()).replace(/\/$/, "");
  return `${h}${file.url.startsWith("/") ? file.url : "/" + file.url}`;
}

/** Open system share sheet — user picks Bluetooth / Nearby Share / WiFi Direct apps */
export async function shareApkViaSystem(file: ShareFile, hub = getHubHttp()) {
  const url = wifiDownloadUrl(file, hub);
  const title = file.isApk ? "GridCaller APK" : file.name;
  const text = `Install / open ${file.name} via GridCaller mesh.\n${url}`;

  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title,
      text,
      url,
      dialogTitle: "Share via Bluetooth / Nearby / WiFi",
    });
    return { ok: true, mode: "capacitor-share", url };
  }

  // Browser: Web Share API if available
  if (navigator.share) {
    await navigator.share({ title, text, url });
    return { ok: true, mode: "web-share", url };
  }

  // Fallback: copy link
  try {
    await navigator.clipboard.writeText(url);
    return { ok: true, mode: "clipboard", url };
  } catch {
    return { ok: true, mode: "link", url };
  }
}

export async function shareTextViaSystem(title: string, text: string, url?: string) {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title, text, url, dialogTitle: "Share mesh invite" });
    return;
  }
  if (navigator.share) {
    await navigator.share({ title, text, url });
    return;
  }
  await navigator.clipboard.writeText([text, url].filter(Boolean).join("\n"));
}
