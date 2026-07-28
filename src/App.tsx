/**
 * Standalone shell — full-screen mobile fit, never cut on any edge.
 */
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import GridCaller from "./GridCaller";
import { S } from "./kernel/storage";
import { requestAllAppPermissions } from "./kernel/nativePermissions";
import { installViewportFit } from "./lib/viewportFit";
import { ensureHubDefaults } from "./kernel/meshHubConfig";
import { startAutoMesh, unifyLocalIdentity } from "./kernel/autoMesh";
import { startOtaWatcher, onOta, applyUpdate, type UpdateInfo } from "./kernel/otaUpdate";
import { startResilientMesh, onPathHealth, type PathHealth } from "./kernel/resilientMesh";
import { APP_VERSION_NAME, APP_VERSION_CODE } from "./kernel/appVersion";
import { getCallState, startCallSession } from "./kernel/callSession";
import { MeshEngine } from "./kernel/mesh";
import { startFullAutoJoin, onAutoJoinStatus } from "./kernel/autoJoin";
import { deriveLifecycleState } from "./kernel/appLifecycle";
import { startWifiMemory } from "./kernel/wifiMemory";
import { bridgeMeshRuntimeEvent, startMeshKeepAlive, startMeshVpn, stopMeshVpn } from "./plugins/meshCallNative";
import { startMeshDirectory } from "./kernel/meshDirectory";
import { startNetworkHandoff } from "./kernel/networkHandoff";
import { ensureMeshIdentity, setDisplayName, setHubHttp, setSignalUrl, syncLocalDeviceIdentity } from "./mesh/identity";
import { ConsentGate } from "./ui/ConsentGate";
import { getConsentState } from "./kernel/consent";
import SetupWizard, { isWizardDone } from "./setup/SetupWizard";
import { isPermsDone } from "./setup/permissions";
import localAiEngine from "./kernel/localAiEngine";

function userFromStorage() {
  return {
    id: S.get("mesh_id") || S.get("user_id") || undefined,
    name: S.get("user_name") || S.get("mesh_name") || "Me",
    phone: S.get("user_phone", "") || "",
  };
}

async function setupNativeChrome() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // WebView sits below system bars — content is never drawn under status bar
    await StatusBar.setOverlaysWebView({ overlay: false });
    const dark = S.get("dark_mode", true) !== false;
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? "#000000" : "#F2F2F7" });
    await StatusBar.show();
  } catch {
    /* web */
  }
}

export default function App() {
  const user = userFromStorage();
  const dark = S.get("dark_mode", true) !== false;
  const [consentReady, setConsentReady] = useState(() => getConsentState().agreed);
  const [wizardDone, setWizardDone] = useState(() => isWizardDone());
  const [permNote, setPermNote] = useState("");
  const [otaNote, setOtaNote] = useState("");
  const [otaInfo, setOtaInfo] = useState<UpdateInfo | null>(null);
  const [pathNote, setPathNote] = useState("");
  const [autoJoinNote, setAutoJoinNote] = useState("Auto-joining mesh");

  // Start background AI monitoring as soon as app is ready
  useEffect(() => {
    if (!consentReady) return;
    localAiEngine.startMonitoring();
    return () => localAiEngine.stopMonitoring();
  }, [consentReady]);

  useEffect(() => {
    if (!consentReady) return;

    const stop = installViewportFit();
    let heartbeatTimer: number | undefined;

    const refreshLifecycle = () => {
      const callState = getCallState();
      const visible = document.visibilityState !== "hidden";
      const lifecycle = deriveLifecycleState({
        visible,
        activeCall: callState.phase === "active",
        incomingCall: callState.phase === "incoming",
        outgoingCall: callState.phase === "outgoing",
      });

      if (lifecycle.shouldReconnect) {
        try {
          void startMeshKeepAlive();
        } catch {}
        try {
          (MeshEngine as any).reconnect?.();
        } catch {}
        try {
          void startFullAutoJoin(S.get("user_name") || S.get("mesh_name") || "GridUser");
        } catch {}
        try {
          void startAutoMesh(S.get("user_name") || S.get("mesh_name") || "GridUser");
        } catch {}
      }

      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      if (lifecycle.heartbeatMs > 0) {
        heartbeatTimer = window.setInterval(() => refreshLifecycle(), lifecycle.heartbeatMs);
      }
    };

    const onVisibility = () => refreshLifecycle();
    const onCallUi = () => refreshLifecycle();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("blur", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    window.addEventListener("pagehide", onVisibility);
    window.addEventListener("gc-call-ui", onCallUi as EventListener);

    // Critical for APK: hub must be PC LAN IP, not localhost
    ensureHubDefaults();
    const identity = ensureMeshIdentity();
    void syncLocalDeviceIdentity({ peerId: identity.peerId }).catch(() => {});
    unifyLocalIdentity();
    try {
      (MeshEngine as any).start?.();
    } catch {}
    startCallSession();
    startWifiMemory(); // remember Wi‑Fi forever + preferred auto-connect
    startMeshDirectory(); // persistent peers + mesh memory
    startNetworkHandoff(); // smooth Wi‑Fi/path switch without killing voice
    void startMeshKeepAlive(); // FG service: mesh listen when app backgrounded/minimized
    void bridgeMeshRuntimeEvent("mesh-start", { localId: identity.peerId, name: user.name });
    void startMeshVpn("gateway", navigator.onLine).catch(() => {});
    // FULL auto-join: Wi‑Fi mesh + swarm + Bluetooth scan — no manual Connect
    void startFullAutoJoin(S.get("user_name") || S.get("mesh_name") || "GridUser");
    void startAutoMesh(S.get("user_name") || S.get("mesh_name") || "GridUser");
    void startResilientMesh();
    startOtaWatcher({ autoInstall: true });
    // Native full-screen incoming → ensure call UI / vibration
    const onNativeIn = () => {
      try {
        navigator.vibrate?.([500, 100, 500, 100, 500, 100, 500]);
      } catch {}
    };
    window.addEventListener("gc-native-incoming", onNativeIn as any);
    const offOta = onOta((info, status) => {
      setOtaInfo(info);
      if (status === "downloading" || status === "installing") {
        setOtaNote(
          `Update ${info?.remoteName || ""} — tap Install if Android asks (v${APP_VERSION_NAME})`
        );
      } else if (status === "available" && info?.available) {
        setOtaNote(`New version ${info.remoteName} on PC hub — installing…`);
      } else if (status === "ok") {
        setOtaNote("");
      }
    });
    const offPath = onPathHealth((h: PathHealth) => {
      if (h.activePaths.length) {
        setPathNote(`${h.note} · ${h.activePaths.join(" + ")}`);
      }
    });
    const offAj = onAutoJoinStatus((s) => {
      setAutoJoinNote(
        s.running
          ? `Auto-connect · ${s.peers} peer(s) · ${(s.paths || []).join("+") || s.note}`
          : "Starting proximity mesh…"
      );
    });
    void (async () => {
      await setupNativeChrome();
      installViewportFit();
      try {
        // Only request permissions if the setup wizard already ran and granted them.
        // If the wizard hasn't run yet, it will request permissions itself — avoid
        // duplicate OS dialogs on first launch.
        if (isPermsDone() && isWizardDone()) {
          const r = await requestAllAppPermissions();
          if (Capacitor.isNativePlatform()) {
            const missing: string[] = [];
            if (!r.microphone) missing.push("Microphone");
            if (!r.camera) missing.push("Camera");
            if (!r.location) missing.push("Location");
            if (!r.bluetooth) missing.push("Bluetooth");
            setPermNote(
              missing.length
                ? `Allow once: ${missing.join(", ")} — then nearby devices connect automatically.`
                : `v${APP_VERSION_NAME} · All permissions granted — mesh always on`
            );
            if (!missing.length) {
              setTimeout(() => setPermNote(""), 5000);
            }
            S.set("gc_perm_summary", r);
          }
        }
        // Always (re-)start auto-join on every launch so devices stay interconnected
        // without requiring any further permission dialogs.
        void startFullAutoJoin(S.get("user_name") || S.get("mesh_name") || "GridUser");
        void startMeshKeepAlive();
        void startMeshVpn("gateway", navigator.onLine).catch(() => {});
      } catch (e: any) {
        setPermNote(e?.message || "");
      }
    })();
    return () => {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("blur", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
      window.removeEventListener("gc-call-ui", onCallUi as EventListener);
      stop();
      try {
        window.removeEventListener("gc-native-incoming", onNativeIn as any);
      } catch {}
      try {
        void stopMeshVpn();
      } catch {}
      try {
        offOta();
      } catch {}
      try {
        offPath();
      } catch {}
      try {
        offAj();
      } catch {}
    };
  }, [consentReady]);

  // After the setup wizard completes: permissions are now granted.
  // Re-trigger full auto-join so BLE / Location / Mic are all active.
  useEffect(() => {
    if (!wizardDone) return;
    void (async () => {
      try {
        // Wizard just granted all permissions — confirm native grants if on device
        if (Capacitor.isNativePlatform()) {
          const r = await requestAllAppPermissions();
          S.set("gc_perm_summary", r);
          const missing: string[] = [];
          if (!r.microphone) missing.push("Microphone");
          if (!r.camera) missing.push("Camera");
          if (!r.location) missing.push("Location");
          if (!r.bluetooth) missing.push("Bluetooth");
          setPermNote(
            missing.length
              ? `Tap Allow for: ${missing.join(", ")} to enable all mesh paths`
              : `v${APP_VERSION_NAME} · All set — devices will auto-connect`
          );
          if (!missing.length) setTimeout(() => setPermNote(""), 5000);
        }
        // Full auto-join now has Location + BLE — pick up all available paths
        void startFullAutoJoin(S.get("user_name") || S.get("mesh_name") || "GridUser");
        void startAutoMesh(S.get("user_name") || S.get("mesh_name") || "GridUser");
        void startMeshKeepAlive();
        void startMeshVpn("gateway", navigator.onLine).catch(() => {});
      } catch {}
    })();
  }, [wizardDone]);

  return (
    <ConsentGate onAccepted={() => setConsentReady(true)}>
      <div
        className="gc-app-shell"
        style={{
          height: "100%",
          width: "100%",
          maxWidth: "100%",
          margin: 0,
          overflow: "hidden",
          position: "relative",
          background: dark ? "#000" : "#F2F2F7",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          minWidth: 0,
          boxSizing: "border-box",
        }}
      >
        {/* First-launch setup wizard */}
        {consentReady && !wizardDone && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 999,
              background: dark ? "#000" : "#F2F2F7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflowY: "auto",
              padding: "env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)",
            }}
          >
            <SetupWizard
              onComplete={({ name, hub, signal }) => {
                // Persist what the wizard collected into kernel storage so the
                // mesh engines, call stack, and directory all see them immediately.
                if (name) {
                  S.set("user_name", name);
                  S.set("mesh_name", name);
                  try { setDisplayName(name); } catch {}
                }
                if (hub) {
                  try { setHubHttp(hub); } catch {}
                  try {
                    localStorage.setItem("gc_hub_http", hub);
                  } catch {}
                }
                if (signal) {
                  try { setSignalUrl(signal); } catch {}
                  try {
                    localStorage.setItem("gc_signal_url", signal);
                  } catch {}
                }
                setWizardDone(true);
              }}
            />
          </div>
        )}

        {permNote ? (
          <div
            style={{
              flexShrink: 0,
              fontSize: 11,
              padding: "6px 12px",
              background: "#FF950022",
              color: dark ? "#ffd60a" : "#9a6700",
              lineHeight: 1.35,
              zIndex: 50,
            }}
          >
            {permNote}
          </div>
        ) : null}
        {otaNote ? (
          <div
            style={{
              flexShrink: 0,
              fontSize: 11,
              padding: "6px 12px",
              background: "#0a84ff22",
              color: dark ? "#64d2ff" : "#0071e3",
              lineHeight: 1.35,
              zIndex: 50,
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ flex: 1 }}>{otaNote}</span>
            {otaInfo?.available ? (
              <button
                type="button"
                onClick={() => void applyUpdate(otaInfo)}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "4px 10px",
                  background: "#0a84ff",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Install
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <GridCaller user={user} />
        </div>
      </div>
    </ConsentGate>
  );
}
