/**
 * First-launch setup wizard — Next → permissions → mesh hub connect.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDisplayName,
  getHubHttp,
  getRoom,
  getSignalUrl,
  setDisplayName,
  setHubHttp,
  setRoom,
  setSignalUrl,
} from "../mesh/identity";
import {
  requestCamera,
  requestClipboard,
  requestLocation,
  requestMicrophone,
  requestNotifications,
  requestStorage,
  statusEmoji,
  type PermResult,
} from "./permissions";

const WIZARD_DONE_KEY = "gc_wizard_done";

export function isWizardDone() {
  return localStorage.getItem(WIZARD_DONE_KEY) === "1";
}

export function resetWizard() {
  localStorage.removeItem(WIZARD_DONE_KEY);
}

type Props = {
  onComplete: (opts: { name: string; room: string; signal: string; hub: string }) => void;
};

type StepId =
  | "welcome"
  | "profile"
  | "perm_mic"
  | "perm_notify"
  | "perm_nearby"
  | "perm_camera"
  | "perm_storage"
  | "hub"
  | "finish";

const STEPS: StepId[] = [
  "welcome",
  "profile",
  "perm_mic",
  "perm_notify",
  "perm_nearby",
  "perm_camera",
  "perm_storage",
  "hub",
  "finish",
];

export default function SetupWizard({ onComplete }: Props) {
  const [idx, setIdx] = useState(0);
  const [name, setName] = useState(getDisplayName() === "GridUser" ? "" : getDisplayName());
  const [room, setRoomVal] = useState(getRoom());
  const [signal, setSignal] = useState(getSignalUrl());
  const [hub, setHub] = useState(getHubHttp());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, PermResult>>({});
  const [err, setErr] = useState("");

  const step = STEPS[idx];
  const progress = Math.round(((idx + 1) / STEPS.length) * 100);
  const autoAsked = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (autoAsked.current[step]) return;
    const run = async () => {
      if (step === "perm_mic") {
        autoAsked.current[step] = true;
        await runPerm("microphone", requestMicrophone);
      } else if (step === "perm_notify") {
        autoAsked.current[step] = true;
        await runPerm("notifications", requestNotifications);
      } else if (step === "perm_nearby") {
        autoAsked.current[step] = true;
        await runPerm("location", requestLocation);
      } else if (step === "perm_camera") {
        autoAsked.current[step] = true;
        await runPerm("camera", requestCamera);
      } else if (step === "perm_storage") {
        autoAsked.current[step] = true;
        await runPerm("storage", requestStorage);
        await runPerm("clipboard", requestClipboard);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const title = useMemo(() => {
    switch (step) {
      case "welcome":
        return "GridCaller setup";
      case "profile":
        return "Your profile";
      case "perm_mic":
        return "Microphone";
      case "perm_notify":
        return "Notifications";
      case "perm_nearby":
        return "Nearby / Bluetooth";
      case "perm_camera":
        return "Camera";
      case "perm_storage":
        return "Offline storage";
      case "hub":
        return "Mesh hub (PC)";
      case "finish":
        return "All set!";
      default:
        return "Setup";
    }
  }, [step]);

  function saveProfile() {
    const n = (name || "GridUser").trim().slice(0, 32);
    setDisplayName(n);
    setRoom(room.trim() || "gridcaller");
    setName(n);
  }

  function saveHub() {
    setSignalUrl(signal.trim());
    setHubHttp(hub.trim().replace(/\/$/, ""));
  }

  async function runPerm(
    key: string,
    fn: () => Promise<PermResult>
  ): Promise<PermResult> {
    setBusy(true);
    setErr("");
    try {
      const r = await fn();
      setResults((prev) => ({ ...prev, [key]: r }));
      return r;
    } catch (e: any) {
      const r: PermResult = {
        id: key,
        label: key,
        status: "error",
        detail: e?.message || String(e),
      };
      setResults((prev) => ({ ...prev, [key]: r }));
      setErr(r.detail || "Permission error");
      return r;
    } finally {
      setBusy(false);
    }
  }

  async function onNext() {
    setErr("");

    if (step === "welcome") {
      setIdx((i) => i + 1);
      return;
    }

    if (step === "profile") {
      if (!name.trim()) {
        setErr("Please enter your name");
        return;
      }
      saveProfile();
      setIdx((i) => i + 1);
      return;
    }

    if (step === "perm_mic") {
      const r = await runPerm("microphone", requestMicrophone);
      if (r.status === "denied") {
        setErr("Microphone is required for calls — tap Allow, then Next.");
      }
      setIdx((i) => i + 1);
      return;
    }

    if (step === "perm_notify") {
      await runPerm("notifications", requestNotifications);
      setIdx((i) => i + 1);
      return;
    }

    if (step === "perm_nearby") {
      await runPerm("location", requestLocation);
      setIdx((i) => i + 1);
      return;
    }

    if (step === "perm_camera") {
      await runPerm("camera", requestCamera);
      setIdx((i) => i + 1);
      return;
    }

    if (step === "perm_storage") {
      await runPerm("storage", requestStorage);
      await runPerm("clipboard", requestClipboard);
      setIdx((i) => i + 1);
      return;
    }

    if (step === "hub") {
      if (!hub.trim() || !signal.trim()) {
        setErr("Enter Hub URL and Signal WebSocket (your PC IP)");
        return;
      }
      saveHub();
      setIdx((i) => i + 1);
      return;
    }

    if (step === "finish") {
      saveProfile();
      saveHub();
      localStorage.setItem(WIZARD_DONE_KEY, "1");
      localStorage.setItem("gc_configured", "1");
      try {
        localStorage.setItem("gc_perm_summary", JSON.stringify(results));
      } catch {}
      onComplete({
        name: (name || "GridUser").trim(),
        room: room.trim() || "gridcaller",
        signal: signal.trim(),
        hub: hub.trim().replace(/\/$/, ""),
      });
    }
  }

  function onBack() {
    setErr("");
    if (idx > 0) setIdx((i) => i - 1);
  }

  const perm = (key: string) => results[key];

  return (
    <div className="wizard">
      <div className="wizard-top">
        <div className="wizard-brand">
          <span className="wizard-logo">📞</span>
          <div>
            <div className="wizard-app">GridCaller</div>
            <div className="wizard-sub">
              Setup · step {idx + 1}/{STEPS.length}
            </div>
          </div>
        </div>
        <div className="wizard-bar">
          <div className="wizard-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="wizard-body">
        <h2 className="wizard-title">{title}</h2>

        {step === "welcome" && (
          <div className="wizard-card">
            <p className="wizard-p">
              First-time setup after install — tap <b>Next</b> on each step.
              The system will request required permissions (Microphone, Notifications,
              Nearby, Camera, Storage).
            </p>
            <ul className="wizard-list">
              <li>Mesh call + chat (no SIM required)</li>
              <li>Share APK over Wi‑Fi / Bluetooth</li>
              <li>Optional GitHub hub + GridAlive bridge</li>
            </ul>
            <p className="wizard-hint">
              When a permission dialog appears, choose <b>Allow</b>.
            </p>
          </div>
        )}

        {step === "profile" && (
          <div className="wizard-card">
            <label className="wizard-label">Your name</label>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              autoFocus
            />
            <label className="wizard-label" style={{ marginTop: 14 }}>
              Mesh room (same on both devices)
            </label>
            <input
              className="field"
              value={room}
              onChange={(e) => setRoomVal(e.target.value)}
              placeholder="gridcaller"
            />
          </div>
        )}

        {step === "perm_mic" && (
          <div className="wizard-card">
            <div className="wizard-icon">🎤</div>
            <p className="wizard-p">
              <b>Microphone</b> — required for voice calls. Tapping Next opens the system
              permission dialog.
            </p>
            {perm("microphone") && (
              <div className="wizard-perm-result">
                {statusEmoji(perm("microphone")!.status)} {perm("microphone")!.status}
                {perm("microphone")!.detail ? ` — ${perm("microphone")!.detail}` : ""}
              </div>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ width: "100%", marginTop: 12 }}
              disabled={busy}
              onClick={() => void runPerm("microphone", requestMicrophone)}
            >
              Allow microphone now
            </button>
          </div>
        )}

        {step === "perm_notify" && (
          <div className="wizard-card">
            <div className="wizard-icon">🔔</div>
            <p className="wizard-p">
              <b>Notifications</b> — alerts for incoming mesh calls.
            </p>
            {perm("notifications") && (
              <div className="wizard-perm-result">
                {statusEmoji(perm("notifications")!.status)} {perm("notifications")!.status}
              </div>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ width: "100%", marginTop: 12 }}
              disabled={busy}
              onClick={() => void runPerm("notifications", requestNotifications)}
            >
              Allow notifications
            </button>
          </div>
        )}

        {step === "perm_nearby" && (
          <div className="wizard-card">
            <div className="wizard-icon">📡</div>
            <p className="wizard-p">
              <b>Location / Nearby</b> — Android often requires this for Bluetooth, Nearby
              Share, and Wi‑Fi mesh.
            </p>
            {perm("location") && (
              <div className="wizard-perm-result">
                {statusEmoji(perm("location")!.status)} {perm("location")!.status}
                {perm("location")!.detail ? ` — ${perm("location")!.detail}` : ""}
              </div>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ width: "100%", marginTop: 12 }}
              disabled={busy}
              onClick={() => void runPerm("location", requestLocation)}
            >
              Allow location / nearby
            </button>
          </div>
        )}

        {step === "perm_camera" && (
          <div className="wizard-card">
            <div className="wizard-icon">📷</div>
            <p className="wizard-p">
              <b>Camera</b> — QR invite / scan (optional but recommended).
            </p>
            {perm("camera") && (
              <div className="wizard-perm-result">
                {statusEmoji(perm("camera")!.status)} {perm("camera")!.status}
              </div>
            )}
            <button
              type="button"
              className="btn ghost"
              style={{ width: "100%", marginTop: 12 }}
              disabled={busy}
              onClick={() => void runPerm("camera", requestCamera)}
            >
              Allow camera
            </button>
          </div>
        )}

        {step === "perm_storage" && (
          <div className="wizard-card">
            <div className="wizard-icon">💾</div>
            <p className="wizard-p">
              <b>Storage</b> — saves chats and call history on this device. Next checks offline
              storage and clipboard access.
            </p>
            {perm("storage") && (
              <div className="wizard-perm-result">
                {statusEmoji(perm("storage")!.status)} storage: {perm("storage")!.status}
              </div>
            )}
            {perm("clipboard") && (
              <div className="wizard-perm-result">
                {statusEmoji(perm("clipboard")!.status)} clipboard: {perm("clipboard")!.status}
              </div>
            )}
          </div>
        )}

        {step === "hub" && (
          <div className="wizard-card">
            <p className="wizard-p">
              On your PC run <b>START.bat</b> or <code>npm run hub</code>. Enter the{" "}
              <b>PC LAN IP</b> below (phone on the same Wi‑Fi or hotspot).
            </p>
            <label className="wizard-label">Hub HTTP</label>
            <input
              className="field"
              value={hub}
              onChange={(e) => setHub(e.target.value)}
              placeholder="http://192.168.1.8:8765"
            />
            <label className="wizard-label" style={{ marginTop: 12 }}>
              Mesh WebSocket (/mesh-ws)
            </label>
            <input
              className="field"
              value={signal}
              onChange={(e) => setSignal(e.target.value)}
              placeholder="ws://192.168.1.8:8765/mesh-ws"
            />
            <p className="wizard-hint">
              Mesh bus path: <code>/mesh-ws</code> — example PC IP 192.168.1.8
            </p>
            <button
              type="button"
              className="btn ghost"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => {
                try {
                  const u = new URL(hub);
                  setSignal(`${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/mesh-ws`);
                } catch {
                  setErr("Enter a valid Hub HTTP URL first");
                }
              }}
            >
              Auto-fill /mesh-ws from Hub URL
            </button>
          </div>
        )}

        {step === "finish" && (
          <div className="wizard-card">
            <div className="wizard-icon">✅</div>
            <p className="wizard-p">
              Setup complete. Tap <b>Start GridCaller</b> to connect to the mesh.
            </p>
            <div className="wizard-summary">
              <div>
                <b>Name:</b> {name || "GridUser"}
              </div>
              <div>
                <b>Room:</b> {room || "gridcaller"}
              </div>
              <div>
                <b>Hub:</b> {hub}
              </div>
              <div style={{ marginTop: 8 }}>
                {Object.values(results).map((r) => (
                  <div key={r.id} className="small">
                    {statusEmoji(r.status)} {r.label}: {r.status}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {err ? (
          <div className="err" style={{ margin: "12px 0 0" }}>
            {err}
          </div>
        ) : null}
      </div>

      <div className="wizard-footer">
        {idx > 0 && step !== "finish" ? (
          <button type="button" className="btn ghost wizard-btn" onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : (
          <div style={{ width: 88 }} />
        )}
        <button
          type="button"
          className="btn primary wizard-btn wizard-next"
          onClick={() => void onNext()}
          disabled={busy}
        >
          {busy ? "Please wait…" : step === "finish" ? "Start GridCaller" : "Next →"}
        </button>
      </div>
    </div>
  );
}
