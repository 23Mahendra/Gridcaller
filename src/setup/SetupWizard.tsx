/**
 * First-launch setup wizard — Next → permissions → mesh hub → AI → done.
 * Apple-class polished UI — no emoji, clean SVG icons, professional hierarchy.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  markPermsDone,
  requestBluetoothNearby,
  requestCamera,
  requestClipboard,
  requestMicrophone,
  requestNotifications,
  requestStorage,
  type PermResult,
} from "./permissions";
import localAiEngine from "../kernel/localAiEngine";
import ollamaEngine, { type OllamaModel } from "../kernel/ollamaEngine";
import { LLM_LIBRARY } from "../kernel/llmLibrary";

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
  | "ai_setup"
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
  "ai_setup",
  "finish",
];

// ─── Inline SVG icons (SF Symbols-inspired, no deps) ─────────────────────────

const S: Record<string, (c?: string, size?: number) => ReactNode> = {
  globe:    (c = "#0071e3", n = 20) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  wifi:     (c = "#0071e3", n = 20) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  bluetooth:(c = "#0071e3", n = 20) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>,
  qr:       (c = "#0071e3", n = 20) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
  shield:   (c = "#0071e3", n = 20) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  mic:      (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  bell:     (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  location: (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8z"/></svg>,
  camera:   (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  database: (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  server:   (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>,
  cpu:      (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>,
  person:   (c = "#fff",    n = 24) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  check:    (c = "#fff",    n = 32) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  checkSm:  (c = "#34c759", n = 16) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  xSm:      (c = "#ff453a", n = 16) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  chevR:    (c = "currentColor", n = 15) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  chevD:    (c = "currentColor", n = 15) => <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
};

// ─── Step header icon (72×72 rounded square with gradient) ───────────────────

const STEP_GRADIENTS: Record<StepId, string> = {
  welcome:      "linear-gradient(145deg,#0071e3,#0055b3)",
  profile:      "linear-gradient(145deg,#5856d6,#3634a3)",
  perm_mic:     "linear-gradient(145deg,#ff453a,#c1120a)",
  perm_notify:  "linear-gradient(145deg,#ff9f0a,#b56800)",
  perm_nearby:  "linear-gradient(145deg,#0071e3,#0055b3)",
  perm_camera:  "linear-gradient(145deg,#30d158,#248a3d)",
  perm_storage: "linear-gradient(145deg,#636366,#3a3a3c)",
  hub:          "linear-gradient(145deg,#5ac8fa,#0071e3)",
  ai_setup:     "linear-gradient(145deg,#bf5af2,#8944ab)",
  finish:       "linear-gradient(145deg,#30d158,#248a3d)",
};

const STEP_ICON_FN: Record<StepId, () => ReactNode> = {
  welcome:      () => S.globe("#fff", 26),
  profile:      () => S.person("#fff", 26),
  perm_mic:     () => S.mic("#fff", 26),
  perm_notify:  () => S.bell("#fff", 26),
  perm_nearby:  () => S.location("#fff", 26),
  perm_camera:  () => S.camera("#fff", 26),
  perm_storage: () => S.database("#fff", 26),
  hub:          () => S.server("#fff", 26),
  ai_setup:     () => S.cpu("#fff", 26),
  finish:       () => S.check("#fff", 30),
};

function StepIconBlock({ step }: { step: StepId }) {
  return (
    <div style={{
      width: 68, height: 68, borderRadius: 20,
      background: STEP_GRADIENTS[step],
      display: "flex", alignItems: "center", justifyContent: "center",
      margin: "24px auto 16px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      flexShrink: 0,
    }}>
      {STEP_ICON_FN[step]()}
    </div>
  );
}

// ─── Permission status badge ──────────────────────────────────────────────────

function PermBadge({ result }: { result: PermResult | undefined }) {
  if (!result) return null;
  const ok = result.status === "granted";
  const no = result.status === "denied";
  return (
    <div className={`wz-perm-status${ok ? " wz-perm-granted" : no ? " wz-perm-denied" : ""}`}>
      {ok ? S.checkSm() : no ? S.xSm() : S.checkSm("#636366")}
      <span>
        <strong>{result.label}</strong>: {result.status}
        {result.detail ? ` — ${result.detail}` : ""}
      </span>
    </div>
  );
}

// ─── Feature row (welcome step) ───────────────────────────────────────────────

function Feature({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="wz-feature">
      <div className="wz-feature-icon">{icon}</div>
      <div>
        <div className="wz-feature-title">{title}</div>
        <div className="wz-feature-desc">{desc}</div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SetupWizard({ onComplete }: Props) {
  const [idx, setIdx] = useState(0);
  const [name, setName] = useState(getDisplayName() === "GridUser" ? "" : getDisplayName());
  const [room, setRoomVal] = useState(getRoom());
  const [signal, setSignal] = useState(getSignalUrl());
  const [hub, setHub] = useState(getHubHttp());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, PermResult>>({});
  const [err, setErr] = useState("");

  // AI model management (ai_setup step)
  const [aiPhase, setAiPhase] = useState<"detecting" | "connected" | "offline">("detecting");
  const [detectedInfo, setDetectedInfo] = useState<{ name: string; port: number } | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [activeModelName, setActiveModelName] = useState(() => ollamaEngine.defaultModel || "");
  const [modelPulls, setModelPulls] = useState<Map<string, { status: string; percent: number }>>(new Map());
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [removingModel, setRemovingModel] = useState("");
  const aiPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const step = STEPS[idx];
  const autoAsked = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (step !== "ai_setup") {
      if (aiPollRef.current) { clearInterval(aiPollRef.current); aiPollRef.current = null; }
      return;
    }
    setAiPhase("detecting");
    const detect = async () => {
      // First try Ollama (full model management)
      const ollamaOk = await ollamaEngine.checkAvailability();
      if (ollamaOk) {
        setAiPhase("connected");
        setDetectedInfo({ name: "Ollama", port: 11434 });
        setOllamaModels([...ollamaEngine.models]);
        const def = ollamaEngine.defaultModel;
        if (def) { setActiveModelName(def); localAiEngine.setActiveModel(def); }
        return;
      }
      // Then try all other local AI backends via localAiEngine
      const snap = await localAiEngine.checkAvailability();
      if (snap.chatBackend !== "none") {
        setAiPhase("connected");
        setDetectedInfo(snap.detectedBackend ?? null);
        if (snap.activeModel) { setActiveModelName(snap.activeModel); }
      } else {
        setAiPhase("offline");
        setDetectedInfo(null);
      }
    };
    void detect();
    // Retry every 5 s — if user starts any AI app mid-step, it auto-connects
    aiPollRef.current = setInterval(() => { void detect(); }, 5000);
    return () => {
      if (aiPollRef.current) { clearInterval(aiPollRef.current); aiPollRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
        await runPerm("bluetooth_nearby", requestBluetoothNearby);
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

  const ollamaInfo = useMemo(() => localAiEngine.getOllamaInstallInfo(), []);

  // Recommended models — not installed, chat-capable, sorted smallest first
  const aiRecommended = useMemo(() => {
    if (step !== "ai_setup") return [];
    const installed = new Set(ollamaModels.map((m) => m.name));
    return LLM_LIBRARY.filter(
      (m) =>
        !installed.has(m.name) &&
        !m.roles.every((r) => r === "embed") &&
        (m.recommended === true || m.tier === "micro" || m.tier === "small")
    )
      .sort((a, b) => a.sizeGB - b.sizeGB)
      .slice(0, 7);
  }, [step, ollamaModels]);

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

  async function runPerm(key: string, fn: () => Promise<PermResult>): Promise<PermResult> {
    setBusy(true);
    setErr("");
    try {
      const r = await fn();
      setResults((p) => ({ ...p, [key]: r }));
      return r;
    } catch (e: any) {
      const r: PermResult = { id: key, label: key, status: "error", detail: e?.message || String(e) };
      setResults((p) => ({ ...p, [key]: r }));
      setErr(r.detail || "Permission error");
      return r;
    } finally {
      setBusy(false);
    }
  }

  // ── AI model management helpers ───────────────────────────────────────────

  async function refreshAiModels() {
    const models = await ollamaEngine.listModels();
    setOllamaModels([...models]);
    const def = ollamaEngine.defaultModel;
    if (def) setActiveModelName(def);
  }

  async function pullAiModel(name: string) {
    setModelErrors((e) => { const n = { ...e }; delete n[name]; return n; });
    setModelPulls((m) => new Map(m).set(name, { status: "connecting…", percent: 0 }));
    const ok = await ollamaEngine.pullModel(name, (p) => {
      setModelPulls((m) => new Map(m).set(name, { status: p.status, percent: p.percent }));
    });
    setModelPulls((m) => { const n = new Map(m); n.delete(name); return n; });
    if (ok) {
      await refreshAiModels();
      setAiPhase("connected");
      // Auto-select if nothing is active yet
      if (!activeModelName) selectAiModel(name);
    } else {
      setModelErrors((e) => ({ ...e, [name]: "Download failed — check Ollama is running." }));
    }
  }

  function selectAiModel(name: string) {
    setActiveModelName(name);
    ollamaEngine.setDefaultModel(name);
    localAiEngine.setActiveModel(name);
  }

  async function removeAiModel(name: string) {
    setRemovingModel(name);
    const ok = await ollamaEngine.deleteModel(name);
    setRemovingModel("");
    if (ok) {
      const models = await ollamaEngine.listModels();
      setOllamaModels([...models]);
      if (activeModelName === name) {
        const next = models[0]?.name || "";
        setActiveModelName(next);
        if (next) { ollamaEngine.setDefaultModel(next); localAiEngine.setActiveModel(next); }
      }
    }
  }

  async function onNext() {
    setErr("");
    if (step === "welcome")  { setIdx((i) => i + 1); return; }
    if (step === "profile")  { if (!name.trim()) { setErr("Please enter a display name."); return; } saveProfile(); setIdx((i) => i + 1); return; }
    if (step === "perm_mic") { const r = await runPerm("microphone", requestMicrophone); if (r.status === "denied") setErr("Microphone is required for calls — tap Allow, then Continue."); setIdx((i) => i + 1); return; }
    if (step === "perm_notify")  { await runPerm("notifications", requestNotifications); setIdx((i) => i + 1); return; }
    if (step === "perm_nearby")  { await runPerm("bluetooth_nearby", requestBluetoothNearby); setIdx((i) => i + 1); return; }
    if (step === "perm_camera")  { await runPerm("camera", requestCamera); setIdx((i) => i + 1); return; }
    if (step === "perm_storage") { await runPerm("storage", requestStorage); await runPerm("clipboard", requestClipboard); setIdx((i) => i + 1); return; }
    if (step === "hub")      { if (hub.trim()) saveHub(); setIdx((i) => i + 1); return; }
    if (step === "ai_setup") { setIdx((i) => i + 1); return; }
    if (step === "finish") {
      saveProfile();
      saveHub();
      localStorage.setItem(WIZARD_DONE_KEY, "1");
      localStorage.setItem("gc_configured", "1");
      try { localStorage.setItem("gc_perm_summary", JSON.stringify(results)); } catch {}
      markPermsDone();
      onComplete({ name: (name || "GridUser").trim(), room: room.trim() || "gridcaller", signal: signal.trim(), hub: hub.trim().replace(/\/$/, "") });
    }
  }

  function onBack() { setErr(""); if (idx > 0) setIdx((i) => i - 1); }

  const isSkip    = (step === "ai_setup" && !activeModelName) || (step === "hub" && !hub.trim());
  const nextLabel = busy ? "Please wait…" : step === "finish" ? "Open GridCaller" : isSkip ? "Skip" : "Continue";

  const TITLES: Record<StepId, [string, string]> = {
    welcome:      ["Welcome to GridCaller",  "Serverless peer-to-peer communication"],
    profile:      ["Your Profile",           "How others see you on the mesh network"],
    perm_mic:     ["Microphone Access",      "Required for voice and mesh calls"],
    perm_notify:  ["Notifications",          "Incoming call and message alerts"],
    perm_nearby:  ["Nearby Devices",         "Bluetooth and location for local mesh"],
    perm_camera:  ["Camera",                 "Scan QR codes to join mesh networks"],
    perm_storage: ["Local Storage",          "All data stays on this device"],
    hub:          ["PC Hub",                 "Optional relay for enterprise use"],
    ai_setup:     ["AI Assistant",           "On-device AI — no cloud, no API key"],
    finish:       ["You're All Set",         "GridCaller is ready"],
  };
  const [title, subtitle] = TITLES[step];

  const permBtn = (label: string, icon: ReactNode, fn: () => void) => (
    <button type="button" className="wz-perm-btn" disabled={busy} onClick={fn}>
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <div className="wz-root">

      {/* Step progress dots */}
      <div className="wz-progress">
        {STEPS.map((_, i) => (
          <div key={i} className={`wz-dot${i < idx ? " done" : i === idx ? " active" : ""}`} />
        ))}
      </div>

      {/* Scrollable body */}
      <div className="wz-center">
        <StepIconBlock step={step} />
        <div className="wz-step-label">Step {idx + 1} of {STEPS.length}</div>
        <h1 className="wz-h1">{title}</h1>
        <p className="wz-h1-sub">{subtitle}</p>

        {/* ── WELCOME ── */}
        {step === "welcome" && (
          <div className="wz-card">
            <Feature icon={S.globe()}     title="Internet Swarm"    desc="WebRTC P2P — works globally, no hub needed" />
            <Feature icon={S.wifi()}      title="LAN / Wi-Fi Mesh"  desc="Auto-discovery on the same local network" />
            <Feature icon={S.bluetooth()} title="Bluetooth Nearby"  desc="Auto-connect to devices in range" />
            <Feature icon={S.qr()}        title="QR Invite"         desc="Scan to join mesh networks offline" />
            <Feature icon={S.shield()}    title="Stored Locally"    desc="All data stays on this device only" />
          </div>
        )}

        {/* ── PROFILE ── */}
        {step === "profile" && (
          <div className="wz-card">
            <label className="wz-label">Display Name</label>
            <input className="wz-input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex" autoFocus maxLength={32} />
            <label className="wz-label">Mesh Room</label>
            <input className="wz-input" value={room} onChange={(e) => setRoomVal(e.target.value)}
              placeholder="gridcaller" style={{ marginBottom: 4 }} />
            <p className="wz-hint" style={{ marginTop: 6, marginBottom: 0 }}>
              Devices on the same room name discover each other automatically.
            </p>
          </div>
        )}

        {/* ── MICROPHONE ── */}
        {step === "perm_mic" && (
          <div className="wz-card">
            <p className="wz-hint">
              Your browser will show a system permission prompt. Select{" "}
              <strong style={{ color: "#f5f5f7" }}>Allow</strong> to enable voice calls.
            </p>
            <PermBadge result={results["microphone"]} />
            {permBtn("Request microphone access", S.mic("#f5f5f7", 18), () => void runPerm("microphone", requestMicrophone))}
          </div>
        )}

        {/* ── NOTIFICATIONS ── */}
        {step === "perm_notify" && (
          <div className="wz-card">
            <p className="wz-hint">
              Receive alerts when someone calls you, even when GridCaller is in the background.
            </p>
            <PermBadge result={results["notifications"]} />
            {permBtn("Request notification access", S.bell("#f5f5f7", 18), () => void runPerm("notifications", requestNotifications))}
          </div>
        )}

        {/* ── NEARBY ── */}
        {step === "perm_nearby" && (
          <div className="wz-card">
            <p className="wz-hint">
              Android requires Location permission to scan for nearby Bluetooth devices and activate the local mesh.
            </p>
            <PermBadge result={results["bluetooth_nearby"]} />
            {permBtn("Request location & Bluetooth access", S.location("#f5f5f7", 18), () => void runPerm("bluetooth_nearby", requestBluetoothNearby))}
          </div>
        )}

        {/* ── CAMERA ── */}
        {step === "perm_camera" && (
          <div className="wz-card">
            <p className="wz-hint">
              Camera is used to scan QR invite codes — join mesh networks without internet.
            </p>
            <PermBadge result={results["camera"]} />
            {permBtn("Request camera access", S.camera("#f5f5f7", 18), () => void runPerm("camera", requestCamera))}
          </div>
        )}

        {/* ── STORAGE ── */}
        {step === "perm_storage" && (
          <div className="wz-card">
            <p className="wz-hint">
              GridCaller stores chats, call history, and contacts entirely on this device — never on a server.
            </p>
            <PermBadge result={results["storage"]} />
            <PermBadge result={results["clipboard"]} />
          </div>
        )}

        {/* ── HUB ── */}
        {step === "hub" && (
          <div className="wz-card">
            <p className="wz-hint">
              GridCaller works without a hub via WebRTC swarm, LAN, and Bluetooth.
              Only add a hub URL if you run the optional relay server (
              <code style={{ color: "#aeaeb2", fontFamily: "monospace", fontSize: 12 }}>npm run hub</code>
              ) for private deployments.
            </p>
            <label className="wz-label">Hub HTTP URL <span style={{ textTransform: "none", opacity: 0.5 }}>(optional)</span></label>
            <input className="wz-input" value={hub} onChange={(e) => setHub(e.target.value)}
              placeholder="http://192.168.1.8:8765" />
            <label className="wz-label">Mesh WebSocket <span style={{ textTransform: "none", opacity: 0.5 }}>(optional)</span></label>
            <input className="wz-input" value={signal} onChange={(e) => setSignal(e.target.value)}
              placeholder="ws://192.168.1.8:8765/mesh-ws" style={{ marginBottom: 8 }} />
            <button type="button" className="wz-perm-btn" onClick={() => {
              try {
                const u = new URL(hub);
                setSignal(`${u.protocol === "https:" ? "wss" : "ws"}://${u.host}/mesh-ws`);
              } catch { setErr("Enter a valid Hub HTTP URL first"); }
            }}>
              <span style={{ fontSize: 13 }}>Auto-fill WebSocket from Hub URL</span>
            </button>
          </div>
        )}

        {/* ── AI SETUP — Real model manager ── */}
        {step === "ai_setup" && (
          <div style={{ width: "100%" }}>
            {/* Status badge */}
            <div className={`wz-ai-status ${aiPhase}`}>
              <div className="wz-ai-status-dot" />
              {aiPhase === "detecting" && "Scanning for local AI (Ollama, LM Studio, Jan.ai…)"}
              {aiPhase === "connected" && (() => {
                const backend = detectedInfo?.name ?? "AI";
                const port = detectedInfo?.port;
                const portStr = port ? ` · port ${port}` : "";
                if (ollamaModels.length) {
                  return `${backend} connected${portStr} · ${ollamaModels.length} model${ollamaModels.length > 1 ? "s" : ""} installed`;
                }
                return `${backend} connected${portStr} · ready to use`;
              })()}
              {aiPhase === "offline" && "No local AI detected — install Ollama, LM Studio or Jan.ai"}
            </div>

            {/* Installed models */}
            {ollamaModels.length > 0 && (
              <>
                <div className="wz-section-hdr">Installed Models</div>
                {ollamaModels.map((m) => {
                  const pull = modelPulls.get(m.name);
                  const isActive = m.name === activeModelName;
                  const isRemoving = removingModel === m.name;
                  const meta = LLM_LIBRARY.find((l) => l.name === m.name || m.name.startsWith(l.name.split(":")[0]));
                  return (
                    <div key={m.name} className={`wz-model-row${isActive ? " is-active" : ""}`}>
                      <div className="wz-model-header">
                        <div className="wz-model-active-dot" />
                        <div className="wz-model-name">{meta?.displayName || m.name}</div>
                        <div className="wz-model-badges">
                          {m.size ? (
                            <span className="wz-badge wz-badge-size">{(m.size / 1e9).toFixed(1)} GB</span>
                          ) : null}
                          {meta?.tier && (
                            <span className={`wz-badge wz-badge-${meta.tier}`}>{meta.tier}</span>
                          )}
                          {isActive && <span className="wz-badge wz-badge-active">Active</span>}
                        </div>
                      </div>
                      {meta?.description && (
                        <div className="wz-model-desc">
                          {meta.description}
                          {meta.roles.filter((r) => r !== "general").length > 0 && (
                            <div className="wz-model-roles">
                              {meta.roles.filter((r) => r !== "general").map((r) => (
                                <span key={r} className="wz-model-role-tag">{r}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {pull ? (
                        <div className="wz-pull-bar">
                          <div className="wz-pull-track">
                            <div className="wz-pull-fill" style={{ width: `${Math.max(pull.percent, 2)}%` }} />
                          </div>
                          <div className="wz-pull-info">
                            <span>{pull.status}</span>
                            <span className="wz-pull-pct">{pull.percent}%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="wz-model-actions">
                          {isActive ? (
                            <span className="wz-model-btn wz-model-btn-active">{S.checkSm("#0071e3", 13)} Active</span>
                          ) : (
                            <button type="button" className="wz-model-btn wz-model-btn-primary"
                              onClick={() => selectAiModel(m.name)}>
                              Set Active
                            </button>
                          )}
                          <button type="button" className="wz-model-btn wz-model-btn-ghost"
                            disabled={!!pull || !!removingModel}
                            onClick={() => void pullAiModel(m.name)}>
                            Update
                          </button>
                          <button type="button" className="wz-model-btn wz-model-btn-danger"
                            disabled={!!pull || !!removingModel}
                            onClick={() => void removeAiModel(m.name)}>
                            {isRemoving ? "Removing…" : "Remove"}
                          </button>
                        </div>
                      )}
                      {modelErrors[m.name] && (
                        <div className="wz-model-error">{modelErrors[m.name]}</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Recommended / Add models */}
            {aiRecommended.length > 0 && (
              <>
                <div className="wz-section-hdr">
                  {ollamaModels.length > 0 ? "Add More Models" : "Recommended Models"}
                </div>

                {/* Offline nudge — show above the list when no AI running */}
                {aiPhase === "offline" && (
                  <div className="wz-install-nudge" style={{ marginBottom: 10 }}>
                    <div className="wz-install-nudge-title">No local AI found — install one</div>
                    <div className="wz-install-nudge-text">
                      GridCaller auto-detects <strong>Ollama</strong>, <strong>LM Studio</strong>, <strong>Jan.ai</strong>, <strong>GPT4All</strong>, <strong>llama.cpp</strong> and more.
                      Just install and start any of them — this screen connects automatically.
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <a href={ollamaInfo.downloadUrl} target="_blank" rel="noopener noreferrer"
                        className="wz-install-link">
                        {S.globe("#fff", 14)} Ollama ({ollamaInfo.os})
                      </a>
                      <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer"
                        className="wz-install-link" style={{ background: "#6e3bda" }}>
                        {S.globe("#fff", 14)} LM Studio
                      </a>
                      <a href="https://jan.ai" target="_blank" rel="noopener noreferrer"
                        className="wz-install-link" style={{ background: "#0066ff" }}>
                        {S.globe("#fff", 14)} Jan.ai
                      </a>
                    </div>
                  </div>
                )}

                {aiRecommended.map((m) => {
                  const pull = modelPulls.get(m.name);
                  return (
                    <div key={m.name} className="wz-model-row">
                      <div className="wz-model-header">
                        <div className="wz-model-name">{m.displayName}</div>
                        <div className="wz-model-badges">
                          <span className="wz-badge wz-badge-size">{m.sizeGB} GB</span>
                          <span className={`wz-badge wz-badge-${m.tier}`}>{m.tier}</span>
                        </div>
                      </div>
                      <div className="wz-model-desc">
                        {m.description}
                        {m.roles.filter((r) => r !== "general").length > 0 && (
                          <div className="wz-model-roles">
                            {m.roles.filter((r) => r !== "general").map((r) => (
                              <span key={r} className="wz-model-role-tag">{r}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {pull ? (
                        <div className="wz-pull-bar">
                          <div className="wz-pull-track">
                            <div className="wz-pull-fill" style={{ width: `${Math.max(pull.percent, 2)}%` }} />
                          </div>
                          <div className="wz-pull-info">
                            <span>{pull.status}</span>
                            <span className="wz-pull-pct">{pull.percent > 0 ? `${pull.percent}%` : "…"}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="wz-model-actions">
                          <button type="button" className="wz-model-btn wz-model-btn-primary"
                            disabled={aiPhase === "offline" || !!removingModel}
                            onClick={() => void pullAiModel(m.name)}>
                            Download
                          </button>
                          <span style={{ fontSize: 11, color: "#48484a" }}>{m.ramGB} GB RAM needed</span>
                        </div>
                      )}
                      {modelErrors[m.name] && (
                        <div className="wz-model-error">{modelErrors[m.name]}</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Edge case: offline, no recommended models to show */}
            {aiPhase === "offline" && aiRecommended.length === 0 && (
              <div className="wz-install-nudge">
                <div className="wz-install-nudge-title">Install Ollama</div>
                <div className="wz-install-nudge-text">
                  Ollama is not running. Install and start it — this screen will auto-connect.
                </div>
                <a href={ollamaInfo.downloadUrl} target="_blank" rel="noopener noreferrer"
                  className="wz-install-link">
                  {S.globe("#fff", 14)} Download Ollama ({ollamaInfo.os})
                </a>
              </div>
            )}

            <p className="wz-hint" style={{ textAlign: "center", marginTop: 14 }}>
              AI is optional — tap Skip to continue. Models can be managed anytime from the app.
            </p>
          </div>
        )}

        {/* ── FINISH ── */}
        {step === "finish" && (
          <div className="wz-card">
            <div style={{ textAlign: "center" }}>
              <div className="wz-finish-check">{S.check()}</div>
            </div>
            {[
              ["Name",  name  || "GridUser"],
              ["Room",  room  || "gridcaller"],
              ["Hub",   hub   || "Swarm mesh — no hub"],
            ].map(([k, v]) => (
              <div className="wz-summary-row" key={k}>
                <span className="wz-summary-key">{k}</span>
                <span className="wz-summary-val">{v}</span>
              </div>
            ))}
            {Object.values(results).length > 0 && (
              <div style={{ marginTop: 10 }}>
                {Object.values(results).map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, color: "#636366" }}>
                    {r.status === "granted" ? S.checkSm() : S.xSm()}
                    <span>{r.label}: {r.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {err && <div className="wz-err">{err}</div>}
      </div>

      {/* Footer */}
      <div className="wz-footer">
        {idx > 0 && step !== "finish" ? (
          <button type="button" className="wz-btn-back" onClick={onBack} disabled={busy}>Back</button>
        ) : (
          <div style={{ width: 72 }} />
        )}
        <button
          type="button"
          className={`wz-btn-next${isSkip ? " wz-skip" : ""}`}
          onClick={() => void onNext()}
          disabled={busy}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
