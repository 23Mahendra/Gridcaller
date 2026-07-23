/**
 * Real permission requests during setup wizard.
 * WebView / APK: getUserMedia, Notification, Geolocation, etc.
 * AndroidManifest must declare them (see scripts/patch-android-permissions.mjs).
 */

export type PermStatus = "unknown" | "granted" | "denied" | "prompt" | "unsupported" | "error";

export type PermResult = {
  id: string;
  label: string;
  status: PermStatus;
  detail?: string;
};

async function queryName(name: PermissionName): Promise<PermStatus> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const r = await navigator.permissions.query({ name });
    if (r.state === "granted") return "granted";
    if (r.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "unknown";
  }
}

/** Microphone — required for mesh voice calls */
export async function requestMicrophone(): Promise<PermResult> {
  const id = "microphone";
  const label = "Microphone";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    // release immediately — only needed for permission grant
    for (const t of stream.getTracks()) t.stop();
    return { id, label, status: "granted", detail: "Mic ready for calls" };
  } catch (e: any) {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { id, label, status: "denied", detail: "Allow Microphone in settings" };
    }
    return { id, label, status: "error", detail: e?.message || String(e) };
  }
}

/** Camera — QR / future scan */
export async function requestCamera(): Promise<PermResult> {
  const id = "camera";
  const label = "Camera";
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { id, label, status: "unsupported" };
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    for (const t of stream.getTracks()) t.stop();
    return { id, label, status: "granted", detail: "Camera ready" };
  } catch (e: any) {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { id, label, status: "denied", detail: "Allow Camera in settings" };
    }
    // some devices have no cam — treat soft
    return { id, label, status: "error", detail: e?.message || String(e) };
  }
}

/** Notifications — incoming call alerts */
export async function requestNotifications(): Promise<PermResult> {
  const id = "notifications";
  const label = "Notifications";
  try {
    if (!("Notification" in window)) {
      return { id, label, status: "unsupported", detail: "Browser has no Notification API" };
    }
    if (Notification.permission === "granted") {
      return { id, label, status: "granted" };
    }
    const p = await Notification.requestPermission();
    if (p === "granted") {
      try {
        new Notification("GridCaller", { body: "Notifications on — you will get call alerts here", silent: true });
      } catch {
        /* Android WebView may block Notification constructor */
      }
      return { id, label, status: "granted" };
    }
    return { id, label, status: "denied", detail: "Notification denied" };
  } catch (e: any) {
    return { id, label, status: "error", detail: e?.message || String(e) };
  }
}

/**
 * Location — Android needs this for Bluetooth scan / Nearby Wi‑Fi on many devices.
 */
export async function requestLocation(): Promise<PermResult> {
  const id = "location";
  const label = "Location (Nearby / Bluetooth / Wi‑Fi)";
  try {
    if (!navigator.geolocation) {
      return { id, label, status: "unsupported" };
    }
    await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30_000,
      });
    });
    return {
      id,
      label,
      status: "granted",
      detail: "Location OK for Bluetooth & Wi‑Fi mesh",
    };
  } catch (e: any) {
    const code = e?.code;
    if (code === 1) {
      return {
        id,
        label,
        status: "denied",
        detail: "Allow Location so Bluetooth and nearby Wi‑Fi can work",
      };
    }
    return { id, label, status: "error", detail: e?.message || "Location failed" };
  }
}

/** Bluetooth + nearby combo (wizard + Devices screen) */
export async function requestBluetoothNearby(): Promise<PermResult> {
  const id = "bluetooth_nearby";
  const label = "Bluetooth / Nearby";
  const loc = await requestLocation();
  const nav = navigator as any;
  if (!nav.bluetooth) {
    return {
      id,
      label,
      status: loc.status === "granted" ? "prompt" : loc.status,
      detail:
        "Location ready. Bluetooth connects when you tap Connect Bluetooth (system picker).",
    };
  }
  return {
    id,
    label,
    status: loc.status === "granted" ? "granted" : loc.status,
    detail: "Ready — use Devices → Connect Bluetooth",
  };
}

/** Persistent storage (offline chats) */
export async function requestStorage(): Promise<PermResult> {
  const id = "storage";
  const label = "Storage / offline data";
  try {
    if (navigator.storage?.persist) {
      const ok = await navigator.storage.persist();
      return {
        id,
        label,
        status: ok ? "granted" : "prompt",
        detail: ok ? "Persistent storage granted" : "Storage not persisted (OK)",
      };
    }
    // always can use localStorage
    localStorage.setItem("gc_storage_probe", "1");
    localStorage.removeItem("gc_storage_probe");
    return { id, label, status: "granted", detail: "localStorage OK" };
  } catch (e: any) {
    return { id, label, status: "error", detail: e?.message || String(e) };
  }
}

/** Clipboard — copy hub link / invite */
export async function requestClipboard(): Promise<PermResult> {
  const id = "clipboard";
  const label = "Clipboard";
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText("GridCaller mesh ready");
      return { id, label, status: "granted" };
    }
    return { id, label, status: "unsupported" };
  } catch {
    return { id, label, status: "denied", detail: "Clipboard blocked (optional)" };
  }
}

export async function checkMicQuery(): Promise<PermStatus> {
  return queryName("microphone" as PermissionName);
}

export function statusEmoji(s: PermStatus) {
  if (s === "granted") return "✅";
  if (s === "denied") return "❌";
  if (s === "unsupported") return "⚪";
  if (s === "error") return "⚠️";
  return "…";
}
