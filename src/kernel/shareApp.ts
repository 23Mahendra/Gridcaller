/**
 * Share GridCaller APK — Bluetooth / Wi‑Fi / WhatsApp / Download
 * Always uses resolveHubHttp() (LAN IP on APK, never broken localhost).
 */

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import {
  ensureHubDefaults,
  getDefaultHubHttp,
  resolveHubHttp,
} from "./meshHubConfig";

export type ShareFile = {
  name: string;
  size: number;
  mtime: number;
  url: string;
  isApk: boolean;
};

function hubBase(): string {
  ensureHubDefaults();
  let h = resolveHubHttp().replace(/\/$/, "");
  // APK safety: never leave localhost
  if (/localhost|127\.0\.0\.1/i.test(h)) {
    h = getDefaultHubHttp();
    try {
      localStorage.setItem("gc_hub_http", h);
    } catch {}
  }
  return h;
}

function apkUrlFromHub(hub: string, path = "/share/GridCaller.apk") {
  return `${hub.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
}

export function appInviteText(hub?: string, apkUrl?: string) {
  const h = (hub || hubBase()).replace(/\/$/, "");
  const lines = [
    "GridCaller — install on same Wi‑Fi as PC",
    "",
    "APK download:",
    apkUrl || apkUrlFromHub(h),
    "",
    "Hub:",
    h,
  ];
  return lines.join("\n");
}

/** Try multiple hub candidates until share list works */
async function hubsToTry(): Promise<string[]> {
  const list: string[] = [];
  const add = (u: string) => {
    const x = u.replace(/\/$/, "");
    if (x && !list.includes(x)) list.push(x);
  };
  add(hubBase());
  add(getDefaultHubHttp());
  add("http://192.168.1.8:8765");
  try {
    const s = localStorage.getItem("gc_hub_http");
    if (s) add(s);
  } catch {}
  return list;
}

export async function fetchShareList(hub?: string): Promise<ShareFile[]> {
  const hubs = hub ? [hub.replace(/\/$/, "")] : await hubsToTry();
  let lastErr = "unreachable";
  for (const h of hubs) {
    try {
      const r = await fetch(`${h}/api/share/list`, {
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        continue;
      }
      const j = await r.json();
      const files: ShareFile[] = (j.files || j.share || []).map((f: any) => ({
        name: String(f.name),
        size: Number(f.size || 0),
        mtime: Number(f.mtime || 0),
        url: String(f.url || `/share/${f.name}`),
        isApk: !!(f.isApk || String(f.name).toLowerCase().endsWith(".apk")),
      }));
      // Remember working hub
      try {
        localStorage.setItem("gc_hub_http", h);
      } catch {}
      return files;
    } catch (e: any) {
      lastErr = e?.message || "fail";
    }
  }
  throw new Error(`Share list failed (${lastErr}). PC pe hub chalao: npm run hub`);
}

export function wifiDownloadUrl(file: ShareFile, hub = hubBase()) {
  if (file.url.startsWith("http")) return file.url;
  return `${hub.replace(/\/$/, "")}${file.url.startsWith("/") ? file.url : "/" + file.url}`;
}

export async function listApkFiles(hub?: string): Promise<ShareFile[]> {
  try {
    const files = await fetchShareList(hub);
    return files.filter((f) => f.isApk || f.name.toLowerCase().endsWith(".apk"));
  } catch {
    // Fallback: synthetic entry so buttons still work with direct URL
    const h = hubBase();
    return [
      {
        name: "GridCaller.apk",
        size: 0,
        mtime: Date.now(),
        url: "/share/GridCaller.apk",
        isApk: true,
      },
    ];
  }
}

export async function getPrimaryApk(
  hub?: string
): Promise<{ file: ShareFile; url: string; hub: string } | null> {
  const h = hub || hubBase();
  try {
    const apks = await listApkFiles(h);
    if (!apks.length) {
      // Still return default URL
      const file: ShareFile = {
        name: "GridCaller.apk",
        size: 0,
        mtime: Date.now(),
        url: "/share/GridCaller.apk",
        isApk: true,
      };
      return { file, url: apkUrlFromHub(hubBase()), hub: hubBase() };
    }
    const file = apks.find((f) => /gridcaller/i.test(f.name)) || apks[0];
    const useHub = resolveHubHttp();
    return { file, url: wifiDownloadUrl(file, useHub), hub: useHub };
  } catch {
    const file: ShareFile = {
      name: "GridCaller.apk",
      size: 0,
      mtime: Date.now(),
      url: "/share/GridCaller.apk",
      isApk: true,
    };
    return { file, url: apkUrlFromHub(hubBase()), hub: hubBase() };
  }
}

/** System share sheet — Bluetooth / Nearby / WhatsApp / Files */
export async function shareAppViaSystem(): Promise<{ ok: boolean; mode: string; message: string }> {
  ensureHubDefaults();
  const hub = hubBase();
  try {
    const apk = await getPrimaryApk(hub);
    const url = apk?.url || apkUrlFromHub(hub);
    const text = appInviteText(hub, url);

    // Prefer native share with URL (always works on Capacitor)
    if (Capacitor.isNativePlatform()) {
      // Try file share first
      try {
        const fileShare = await shareApkAsFile(
          apk?.file || {
            name: "GridCaller.apk",
            size: 0,
            mtime: Date.now(),
            url: "/share/GridCaller.apk",
            isApk: true,
          },
          hub
        );
        if (fileShare.ok && fileShare.mode !== "no-file-share") return fileShare;
      } catch {}
      await Share.share({
        title: "GridCaller APK",
        text: text,
        url,
        dialogTitle: "Share APK (Bluetooth / WhatsApp / Nearby)",
      });
      return { ok: true, mode: "capacitor", message: `Share sheet open · ${url}` };
    }

    if (navigator.share) {
      try {
        await navigator.share({ title: "GridCaller APK", text, url });
        return { ok: true, mode: "web-share", message: `Shared · ${url}` };
      } catch (e: any) {
        if (e?.name === "AbortError") return { ok: true, mode: "cancel", message: "Cancelled" };
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      return { ok: true, mode: "clipboard", message: `Link copied: ${url}` };
    } catch {
      return { ok: true, mode: "link", message: url };
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: true, mode: "cancel", message: "Cancelled" };
    const url = apkUrlFromHub(hub);
    return {
      ok: false,
      mode: "fail",
      message: `${e?.message || "Share failed"}. Try open: ${url}`,
    };
  }
}

async function shareApkAsFile(
  file: ShareFile,
  hub: string
): Promise<{ ok: boolean; mode: string; message: string }> {
  const url = wifiDownloadUrl(file, hub);
  let blob: Blob;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
    blob = await res.blob();
  } catch (e: any) {
    // Fall back to link share
    if (Capacitor.isNativePlatform()) {
      await Share.share({
        title: "GridCaller APK",
        text: appInviteText(hub, url),
        url,
        dialogTitle: "Share APK link",
      });
      return { ok: true, mode: "capacitor-link", message: `Link share open · ${url}` };
    }
    throw e;
  }

  const name = file.name.endsWith(".apk") ? file.name : "GridCaller.apk";
  const apkFile = new File([blob], name, {
    type: "application/vnd.android.package-archive",
  });

  if (navigator.share && (navigator as any).canShare) {
    try {
      if ((navigator as any).canShare({ files: [apkFile] })) {
        await navigator.share({
          files: [apkFile],
          title: "GridCaller",
          text: "Install GridCaller",
        });
        return { ok: true, mode: "file-share", message: "APK file shared" };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return { ok: true, mode: "cancel", message: "Cancelled" };
    }
  }

  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title: "GridCaller APK",
      text: appInviteText(hub, url),
      url,
      dialogTitle: "Share APK (Bluetooth / WhatsApp / …)",
    });
    return { ok: true, mode: "capacitor", message: `Share open · ${url}` };
  }

  return { ok: false, mode: "no-file-share", message: "File share not supported" };
}

/** Wi‑Fi link copy + show URL */
export async function shareAppWifiLink(): Promise<{ ok: boolean; message: string; url?: string }> {
  ensureHubDefaults();
  const hub = hubBase();
  const apk = await getPrimaryApk(hub);
  const url = apk?.url || apkUrlFromHub(hub);
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {}
  // Also open so user can verify
  try {
    window.open(url, "_blank");
  } catch {}
  return {
    ok: true,
    url,
    message: copied
      ? `Wi‑Fi link copied + opened:\n${url}`
      : `Wi‑Fi APK link (same network):\n${url}`,
  };
}

/** WhatsApp with APK link */
export async function shareAppWhatsApp(): Promise<{ ok: boolean; message: string }> {
  ensureHubDefaults();
  const hub = hubBase();
  const apk = await getPrimaryApk(hub);
  const url = apk?.url || apkUrlFromHub(hub);
  const text = appInviteText(hub, url);
  const encoded = encodeURIComponent(text);

  // Android intent / web
  const waApp = `whatsapp://send?text=${encoded}`;
  const waWeb = `https://wa.me/?text=${encoded}`;

  try {
    if (Capacitor.isNativePlatform()) {
      // Prefer system share with WhatsApp in sheet
      try {
        await Share.share({
          title: "GridCaller APK",
          text,
          url,
          dialogTitle: "Share to WhatsApp",
        });
        return { ok: true, message: "Share sheet open — pick WhatsApp" };
      } catch {
        window.location.href = waApp;
        return { ok: true, message: "Opening WhatsApp…" };
      }
    }
    window.open(waWeb, "_blank", "noopener,noreferrer");
    return { ok: true, message: "WhatsApp web opened with link" };
  } catch (e: any) {
    return { ok: false, message: e?.message || "WhatsApp open failed" };
  }
}

/** Download / open APK URL (install on Android) */
export async function downloadApkNow(): Promise<{ ok: boolean; message: string; url?: string }> {
  ensureHubDefaults();
  const hub = hubBase();
  const apk = await getPrimaryApk(hub);
  const url = apk?.url || apkUrlFromHub(hub);

  // Probe that file exists
  try {
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (!head.ok) {
      return {
        ok: false,
        message: `APK not on hub (HTTP ${head.status}). PC: hub running + npm run apk:copy. URL: ${url}`,
        url,
      };
    }
  } catch {
    return {
      ok: false,
      message: `Cannot reach hub. Same Wi‑Fi? PC hub on? Try: ${url}`,
      url,
    };
  }

  try {
    // Android WebView: navigating to APK triggers download/install
    if (Capacitor.isNativePlatform()) {
      window.location.href = url;
      return { ok: true, message: `Opening download…\n${url}`, url };
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = apk?.file.name || "GridCaller.apk";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, message: `Downloading ${apk?.file.name || "GridCaller.apk"}`, url };
  } catch (e: any) {
    try {
      window.open(url, "_blank");
    } catch {}
    return { ok: true, message: `Open this link:\n${url}`, url };
  }
}

export async function shareAppInvite() {
  return shareAppViaSystem();
}

export function whatsappShareApp() {
  void shareAppWhatsApp();
}
