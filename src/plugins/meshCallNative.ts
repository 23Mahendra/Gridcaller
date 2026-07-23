/**
 * Bridge to native MeshCall plugin (foreground keep-alive + full-screen ring).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface MeshCallPlugin {
  startKeepAlive(): Promise<{ ok: boolean }>;
  stopKeepAlive(): Promise<{ ok: boolean }>;
  showIncomingCall(opts: { name: string; callId: string }): Promise<{ ok: boolean }>;
  cancelIncomingCall(): Promise<{ ok: boolean }>;
}

const MeshCall = registerPlugin<MeshCallPlugin>("MeshCall");

export async function startMeshKeepAlive(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await MeshCall.startKeepAlive();
    return true;
  } catch (e) {
    console.warn("[MeshCall] keepAlive", e);
    return false;
  }
}

export async function stopMeshKeepAlive(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await MeshCall.stopKeepAlive();
  } catch {}
}

export async function nativeIncomingCall(name: string, callId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback
    try {
      navigator.vibrate?.([500, 150, 500, 150, 500, 150, 500]);
    } catch {}
    try {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "granted") {
          new Notification("Incoming GridCaller", { body: name, requireInteraction: true, tag: "gc-in" });
        } else if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
      }
    } catch {}
    return;
  }
  try {
    await MeshCall.showIncomingCall({ name: name || "GridCaller", callId: callId || "" });
  } catch (e) {
    console.warn("[MeshCall] showIncoming", e);
    try {
      navigator.vibrate?.([500, 150, 500, 150, 500]);
    } catch {}
  }
}

export async function nativeCancelIncoming(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await MeshCall.cancelIncomingCall();
  } catch {}
}

export default MeshCall;
