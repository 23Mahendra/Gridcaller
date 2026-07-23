/**
 * OTA update from PC hub — phones already on mesh get push without reinstall dance.
 *
 * Flow:
 *  1) Poll /api/update/check every 12s
 *  2) Listen MeshEngine GC_PUSH_UPDATE / hub publish
 *  3) If server versionCode > local → open APK install URL
 *
 * Android still needs one tap "Install" (OS security). No USB reinstall needed
 * if the app is already open on the same Wi‑Fi as the hub.
 */

import { Capacitor } from "@capacitor/core";
import { MeshEngine } from "./mesh";
import { resolveHubHttp, ensureHubDefaults } from "./meshHubConfig";
import { APP_VERSION_CODE, APP_VERSION_NAME } from "./appVersion";
import { S } from "./storage";

export type UpdateInfo = {
  available: boolean;
  localCode: number;
  localName: string;
  remoteCode: number;
  remoteName: string;
  apkUrl: string;
  size?: number;
  mtime?: number;
  force?: boolean;
  message: string;
};

type Listener = (info: UpdateInfo | null, status: string) => void;

let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPromptAt = 0;
let lastAppliedCode = 0;
const listeners = new Set<Listener>();

function emit(info: UpdateInfo | null, status: string) {
  for (const fn of listeners) {
    try {
      fn(info, status);
    } catch {}
  }
}

export function onOta(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function checkForUpdate(
  hub = resolveHubHttp()
): Promise<UpdateInfo> {
  ensureHubDefaults();
  const base = hub.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/api/update/check?code=${APP_VERSION_CODE}`, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!r.ok) {
      return {
        available: false,
        localCode: APP_VERSION_CODE,
        localName: APP_VERSION_NAME,
        remoteCode: APP_VERSION_CODE,
        remoteName: APP_VERSION_NAME,
        apkUrl: `${base}/share/GridCaller.apk`,
        message: `Update check HTTP ${r.status}`,
      };
    }
    const j = await r.json();
    const remoteCode = Number(j.versionCode || j.code || 0);
    const apkUrl = String(j.apkUrl || `${base}/share/GridCaller.apk`);
    const available =
      !!j.available ||
      (remoteCode > APP_VERSION_CODE && Number.isFinite(remoteCode));
    return {
      available,
      localCode: APP_VERSION_CODE,
      localName: APP_VERSION_NAME,
      remoteCode: remoteCode || APP_VERSION_CODE,
      remoteName: String(j.versionName || j.name || APP_VERSION_NAME),
      apkUrl,
      size: j.size,
      mtime: j.mtime,
      force: !!j.force,
      message: available
        ? `Update ${j.versionName || remoteCode} ready`
        : "Up to date",
    };
  } catch (e: any) {
    return {
      available: false,
      localCode: APP_VERSION_CODE,
      localName: APP_VERSION_NAME,
      remoteCode: APP_VERSION_CODE,
      remoteName: APP_VERSION_NAME,
      apkUrl: `${base}/share/GridCaller.apk`,
      message: e?.message || "Hub unreachable for update",
    };
  }
}

/** Open APK install — Android package installer / browser download */
export async function applyUpdate(info?: UpdateInfo): Promise<{ ok: boolean; message: string }> {
  const u = info || (await checkForUpdate());
  if (!u.apkUrl) {
    return { ok: false, message: "No APK URL" };
  }
  try {
    S.set("gc_last_ota_code", u.remoteCode);
    S.set("gc_last_ota_at", Date.now());
    lastAppliedCode = u.remoteCode;

    // Prefer full navigation so Android downloads + offers Install
    if (Capacitor.isNativePlatform()) {
      try {
        // Capacitor Browser plugin may not be present — location works in WebView
        window.location.href = u.apkUrl;
      } catch {
        window.open(u.apkUrl, "_system");
      }
    } else {
      const a = document.createElement("a");
      a.href = u.apkUrl;
      a.download = "GridCaller.apk";
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    emit(u, "installing");
    return {
      ok: true,
      message: `Installing ${u.remoteName} — tap Install if Android asks`,
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Install open failed" };
  }
}

async function maybeAutoApply(info: UpdateInfo, force = false) {
  if (!info.available) {
    emit(info, "ok");
    return;
  }
  // Don't spam installer every poll
  const now = Date.now();
  if (!force && now - lastPromptAt < 45000) {
    emit(info, "pending");
    return;
  }
  if (!force && lastAppliedCode === info.remoteCode && now - lastPromptAt < 120000) {
    emit(info, "pending");
    return;
  }
  lastPromptAt = now;
  emit(info, "downloading");
  await applyUpdate(info);
}

export function startOtaWatcher(opts?: { autoInstall?: boolean }) {
  if (started) return;
  started = true;
  const auto = opts?.autoInstall !== false;

  ensureHubDefaults();

  const tick = async (force = false) => {
    const info = await checkForUpdate();
    if (auto && info.available) {
      await maybeAutoApply(info, force);
    } else {
      emit(info, info.available ? "available" : "ok");
    }
  };

  void tick(false);
  pollTimer = setInterval(() => void tick(false), 12000);

  // Hub / mesh push
  try {
    MeshEngine.onMessage((msg: any) => {
      if (
        msg?.type === "GC_PUSH_UPDATE" ||
        msg?.type === "GC_OTA" ||
        msg?.data?.type === "GC_PUSH_UPDATE"
      ) {
        const data = msg.data || msg;
        const remoteCode = Number(data.versionCode || data.code || 0);
        if (remoteCode > APP_VERSION_CODE) {
          void (async () => {
            const info = await checkForUpdate();
            await maybeAutoApply({ ...info, available: true, force: true }, true);
          })();
        } else {
          void tick(true);
        }
      }
    });
  } catch {}

  // Custom event from UI / push
  try {
    window.addEventListener("gc-ota-push", () => {
      void tick(true);
    });
  } catch {}

  console.info(
    "[OTA] watching hub · local",
    APP_VERSION_NAME,
    `(${APP_VERSION_CODE})`
  );
}

export function stopOtaWatcher() {
  started = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function getLocalVersion() {
  return { code: APP_VERSION_CODE, name: APP_VERSION_NAME };
}
