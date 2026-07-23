/**
 * GridAlive — UNIVERSAL platform layer
 * One app for: Desktop · Android · iOS · Web/PWA · embedded shells
 * OmniMesh uses whatever radios/transports each device can open.
 */

export type PlatformKind =
  | "desktop-windows"
  | "desktop-mac"
  | "desktop-linux"
  | "mobile-android"
  | "mobile-ios"
  | "web-pwa"
  | "web-browser"
  | "unknown";

export type ShellKind =
  | "electron"
  | "capacitor"
  | "pwa"
  | "browser"
  | "unknown";

export type UniversalInfo = {
  /** Always true for GridAlive product positioning */
  universal: true;
  platform: PlatformKind;
  shell: ShellKind;
  os: string;
  /** Running inside an installed / native host (Electron, Capacitor, installed PWA) */
  isInstalledShell: boolean;
  /** Best-effort hardware capability flags (runtime) */
  caps: {
    wifiLan: boolean;
    webrtc: boolean;
    bluetooth: boolean;
    serialUsb: boolean;
    geolocation: boolean;
    notifications: boolean;
    serviceWorker: boolean;
    offlineStorage: boolean;
  };
  /** Human label for UI */
  label: string;
  /** Short guidance for radio features on this device */
  radioHint: string;
};

declare global {
  interface Window {
    gridAliveNative?: {
      isStandalone?: boolean;
      shell?: string;
      platform?: string;
      hasWebBluetooth?: boolean;
      hasWebSerial?: boolean;
      getShellInfo?: () => Promise<any>;
      log?: (msg: string) => void;
    };
    __GRIDALIVE_STANDALONE__?: boolean;
    __GRIDALIVE_SHELL__?: string;
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    glideAliveDeviceTools?: unknown;
  }
}

function detectOS(): string {
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  if (/Windows/i.test(ua) || /Win/i.test(plat)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua) || /Mac/i.test(plat)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return plat || "Unknown";
}

function isPwaInstalled(): boolean {
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    // iOS Safari
    if ((navigator as any).standalone === true) return true;
  } catch {}
  return false;
}

export function getUniversalInfo(): UniversalInfo {
  if (typeof window === "undefined") {
    return {
      universal: true,
      platform: "unknown",
      shell: "unknown",
      os: "server",
      isInstalledShell: false,
      caps: {
        wifiLan: false,
        webrtc: false,
        bluetooth: false,
        serialUsb: false,
        geolocation: false,
        notifications: false,
        serviceWorker: false,
        offlineStorage: false,
      },
      label: "GridAlive Universal",
      radioHint: "Runtime not in UI process",
    };
  }

  const os = detectOS();
  const ua = navigator.userAgent || "";
  const native = window.gridAliveNative;
  const caps = {
    wifiLan: true, // app always tries LAN mesh node
    webrtc: typeof RTCPeerConnection !== "undefined",
    bluetooth: !!(navigator as any).bluetooth || native?.hasWebBluetooth === true,
    serialUsb: !!(navigator as any).serial || native?.hasWebSerial === true,
    geolocation: "geolocation" in navigator,
    notifications: "Notification" in window,
    serviceWorker: "serviceWorker" in navigator,
    offlineStorage: !!(window.indexedDB || window.localStorage),
  };

  // Electron desktop (Windows / Mac / Linux)
  if (native?.isStandalone || window.__GRIDALIVE_STANDALONE__ || /Electron/i.test(ua)) {
    const platform: PlatformKind =
      os === "Windows"
        ? "desktop-windows"
        : os === "macOS"
          ? "desktop-mac"
          : os === "Linux"
            ? "desktop-linux"
            : "desktop-windows";
    return {
      universal: true,
      platform,
      shell: "electron",
      os,
      isInstalledShell: true,
      caps: {
        ...caps,
        bluetooth: caps.bluetooth || native?.hasWebBluetooth !== false,
        serialUsb: caps.serialUsb || native?.hasWebSerial !== false,
      },
      label: `GridAlive Desktop · ${os}`,
      radioHint:
        "Full stack: Wi‑Fi/LAN mesh + WebRTC + BLE + USB LoRa dongles (Meshtastic). Native session grants radio access.",
    };
  }

  // Capacitor mobile (Android / iOS)
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const p = window.Capacitor.getPlatform?.() || "";
      const platform: PlatformKind =
        p === "ios" ? "mobile-ios" : p === "android" ? "mobile-android" : "mobile-android";
      return {
        universal: true,
        platform,
        shell: "capacitor",
        os: p === "ios" ? "iOS" : p === "android" ? "Android" : os,
        isInstalledShell: true,
        caps,
        label: `GridAlive Mobile · ${p || os}`,
        radioHint:
          p === "ios"
            ? "Wi‑Fi/LAN + WebRTC + multi-hop. BLE/LoRa via plugins / companion hardware where OS allows."
            : "Wi‑Fi/LAN + WebRTC + BLE (Web Bluetooth / plugins) + optional USB-OTG LoRa on supported devices.",
      };
    }
  } catch {}

  // Installed PWA
  if (isPwaInstalled()) {
    return {
      universal: true,
      platform: "web-pwa",
      shell: "pwa",
      os,
      isInstalledShell: true,
      caps,
      label: `GridAlive PWA · ${os}`,
      radioHint:
        "Installable on any OS. Wi‑Fi/LAN mesh + WebRTC always. BLE/Serial when the host browser engine exposes them.",
    };
  }

  // Any browser tab — still the same universal app (dev or progressive use)
  return {
    universal: true,
    platform: "web-browser",
    shell: "browser",
    os,
    isInstalledShell: false,
    caps,
    label: `GridAlive Universal · ${os}`,
    radioHint:
      "Same app core. Wi‑Fi/LAN + WebRTC mesh work now. For system radio (BLE/USB LoRa), open the Desktop or Mobile install — same OmniMesh engine.",
  };
}

/** @deprecated use getUniversalInfo — kept for older imports */
export function getShellInfo() {
  const u = getUniversalInfo();
  return {
    isStandalone: u.isInstalledShell || u.shell === "electron" || u.shell === "capacitor",
    shell:
      u.shell === "electron"
        ? ("electron-desktop" as const)
        : u.shell === "capacitor"
          ? ("capacitor-mobile" as const)
          : u.shell === "browser"
            ? ("web-dev" as const)
            : ("unknown" as const),
    hasWebBluetooth: u.caps.bluetooth,
    hasWebSerial: u.caps.serialUsb,
    platform: u.os,
    universal: true as const,
    label: u.label,
    radioHint: u.radioHint,
  };
}

export function isStandaloneApp(): boolean {
  const u = getUniversalInfo();
  return u.isInstalledShell || u.shell === "electron" || u.shell === "capacitor";
}

export function isUniversalApp(): boolean {
  return true;
}
