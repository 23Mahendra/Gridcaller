/**
 * Full native mobile permissions for standalone GridCaller APK.
 * WebView does NOT have Web Bluetooth — use BLE plugin + runtime grants.
 */
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { Network } from "@capacitor/network";

export type NativePermSummary = {
  platform: string;
  native: boolean;
  location: boolean;
  network: boolean;
  bluetooth: boolean;
  microphone: boolean;
  camera: boolean;
  detail: string[];
};

/** Request every permission the app needs to work on a real phone */
export async function requestAllAppPermissions(): Promise<NativePermSummary> {
  const detail: string[] = [];
  const native = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  let location = false;
  let network = false;
  let bluetooth = false;
  let microphone = false;
  let camera = false;

  // Location (map + BT scan on Android)
  try {
    if (native) {
      const st = await Geolocation.checkPermissions();
      if (st.location !== "granted" && st.coarseLocation !== "granted") {
        const r = await Geolocation.requestPermissions();
        location = r.location === "granted" || r.coarseLocation === "granted";
      } else {
        location = true;
      }
      if (location) {
        try {
          await Geolocation.getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 10000,
          });
        } catch {
          /* granted but GPS cold — OK */
        }
      }
    } else if (navigator.geolocation) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => {
            location = true;
            resolve();
          },
          () => resolve(),
          { timeout: 8000, maximumAge: 60000 }
        );
      });
    }
    detail.push(location ? "Location granted" : "Location not granted");
  } catch (e: any) {
    detail.push(`Location: ${e?.message || "failed"}`);
  }

  // Network status (Wi‑Fi / cellular awareness)
  try {
    if (native) {
      const s = await Network.getStatus();
      network = !!s.connected;
      detail.push(
        s.connected
          ? `Network online (${s.connectionType || "unknown"})`
          : "Network offline"
      );
    } else {
      network = navigator.onLine;
      detail.push(network ? "Network online" : "Network offline");
    }
  } catch {
    network = navigator.onLine;
  }

  // Microphone (voice / video calls)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    stream.getTracks().forEach((t) => t.stop());
    microphone = true;
    detail.push("Microphone granted");
  } catch {
    detail.push("Microphone not granted");
  }

  // Camera (video calls)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    stream.getTracks().forEach((t) => t.stop());
    camera = true;
    detail.push("Camera granted");
  } catch {
    detail.push("Camera not granted");
  }

  // Bluetooth — initialize native BLE if available
  try {
    if (native) {
      const { BleClient } = await import("@capacitor-community/bluetooth-le");
      await BleClient.initialize({ androidNeverForLocation: false });
      // Request Android 12+ BT permissions via plugin
      try {
        await BleClient.requestLEScan({ allowDuplicates: false }, () => {});
        await BleClient.stopLEScan();
        bluetooth = true;
        detail.push("Bluetooth ready (native)");
      } catch (e: any) {
        // initialize may succeed even if scan needs user enable
        bluetooth = true;
        detail.push(`Bluetooth initialized (${e?.message || "scan later"})`);
      }
    } else if ((navigator as any).bluetooth) {
      bluetooth = true;
      detail.push("Web Bluetooth available");
    } else {
      detail.push("Bluetooth needs native APK");
    }
  } catch (e: any) {
    detail.push(`Bluetooth: ${e?.message || "unavailable"}`);
  }

  // Notifications
  try {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {}

  return { platform, native, location, network, bluetooth, microphone, camera, detail };
}

export async function ensureLocationPermission(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const st = await Geolocation.checkPermissions();
      if (st.location === "granted" || st.coarseLocation === "granted") return true;
      const r = await Geolocation.requestPermissions();
      return r.location === "granted" || r.coarseLocation === "granted";
    }
    return await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(false);
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { timeout: 8000 }
      );
    });
  } catch {
    return false;
  }
}
