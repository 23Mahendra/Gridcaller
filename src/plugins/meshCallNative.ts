/**
 * Bridge to native MeshCall plugin (foreground keep-alive + full-screen ring).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface MeshCallPlugin {
  startKeepAlive(): Promise<{ ok: boolean }>;
  stopKeepAlive(): Promise<{ ok: boolean }>;
  showIncomingCall(opts: { name: string; callId: string }): Promise<{ ok: boolean }>;
  cancelIncomingCall(): Promise<{ ok: boolean }>;
  startMeshVpn(opts?: { mode?: string; online?: boolean }): Promise<{ ok: boolean; mode?: string }>;
  stopMeshVpn(): Promise<{ ok: boolean }>;
  getMeshVpnStatus(): Promise<{ ok: boolean; mode?: string; online?: boolean }>;
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

export async function startMeshVpn(mode = "gateway", online = true): Promise<{ ok: boolean; mode?: string }> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, mode: "disabled" };
  }
  try {
    return await MeshCall.startMeshVpn({ mode, online });
  } catch (e) {
    console.warn("[MeshCall] meshVpn start", e);
    return { ok: false, mode: "disabled" };
  }
}

export async function stopMeshVpn(): Promise<{ ok: boolean }> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false };
  }
  try {
    return await MeshCall.stopMeshVpn();
  } catch (e) {
    console.warn("[MeshCall] meshVpn stop", e);
    return { ok: false };
  }
}

export async function getMeshVpnStatus(): Promise<{ ok: boolean; mode?: string; online?: boolean }> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, mode: "disabled", online: false };
  }
  try {
    return await MeshCall.getMeshVpnStatus();
  } catch (e) {
    console.warn("[MeshCall] meshVpn status", e);
    return { ok: false, mode: "disabled", online: false };
  }
}

export default MeshCall;
