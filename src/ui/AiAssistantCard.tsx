/**
 * AiAssistantCard — in-app offline AI panel
 * Tabs: Chat · Image · Voice
 * Uses localAiEngine — zero API keys, zero cloud.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import localAiEngine, {
  type AiChatMessage,
  type AiPullProgress,
  type AiStatusSnapshot,
} from "../kernel/localAiEngine";
import {
  addRagDoc,
  buildRagContext,
  clearRagDocs,
  listRagDocs,
  removeRagDoc,
  type RagDocMeta,
} from "../kernel/localRag";

// Starter model to pull when Ollama is present but has no models
const STARTER_MODEL = "llama3.2:1b";

type Tab = "chat" | "image" | "voice";

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Props {
  dark?: boolean;
  onClose?: () => void;
}

// ─── Tiny design tokens ────────────────────────────────────────────────────

function tk(dark: boolean) {
  return {
    bg: dark ? "#1c1c1e" : "#ffffff",
    card: dark ? "#2c2c2e" : "#f2f2f7",
    text: dark ? "#ffffff" : "#000000",
    label: dark ? "#ebebf5cc" : "#3c3c4399",
    blue: dark ? "#0a84ff" : "#007aff",
    green: dark ? "#30d158" : "#248a3d",
    red: dark ? "#ff453a" : "#d70015",
    sep: dark ? "rgba(84,84,88,.55)" : "rgba(60,60,67,.18)",
    inputBg: dark ? "#3a3a3c" : "#ffffff",
    border: dark ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.12)",
  };
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function AiAssistantCard({ dark = true, onClose }: Props) {
  const T = tk(dark);
  const [tab, setTab] = useState<Tab>("chat");
  const [status, setStatus] = useState<AiStatusSnapshot>(localAiEngine.getSnapshot());

  // Chat
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatAbort = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [ragDocs, setRagDocs] = useState<RagDocMeta[]>([]);
  const [ragTitle, setRagTitle] = useState("");
  const [ragInput, setRagInput] = useState("");
  const [ragBusy, setRagBusy] = useState(false);
  const [ragError, setRagError] = useState("");

  // Image
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgResult, setImgResult] = useState<string | null>(null);
  const [imgError, setImgError] = useState("");

  // Voice
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [ttsBusy, setTtsBusy] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // Model pull
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<AiPullProgress | null>(null);
  const [pullError, setPullError] = useState("");

  // ─── Subscribe to AI status ────────────────────────────────────────────

  useEffect(() => {
    const off = localAiEngine.subscribeStatus(setStatus);
    return () => {
      off();
      chatAbort.current?.abort();
      try { mediaRecorder.current?.stop(); } catch {}
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const refreshRagDocs = useCallback(async () => {
    try {
      setRagDocs(await listRagDocs());
      setRagError("");
    } catch (err: any) {
      setRagError(err?.message || "Could not load knowledge.");
    }
  }, []);

  useEffect(() => {
    void refreshRagDocs();
  }, [refreshRagDocs]);

  // ─── Chat ──────────────────────────────────────────────────────────────

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    setChatBusy(true);

    const userEntry: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text };
    const assistantId = `a${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userEntry,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    chatAbort.current = new AbortController();
    try {
      const rag = ragEnabled ? await buildRagContext(text).catch(() => null) : null;
      const history: AiChatMessage[] = [
        ...(rag?.context
          ? [
              {
                role: "system" as const,
                content:
                  "Use the local knowledge context below when relevant. If context is not relevant, answer normally.\n\n" +
                  rag.context,
              },
            ]
          : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: text },
      ];
      let full = "";
      await localAiEngine.chatStream(
        history,
        (tok) => {
          full += tok;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: full, streaming: true } : m
            )
          );
        },
        { signal: chatAbort.current.signal }
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: full, streaming: false } : m
        )
      );
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: err?.message || "Error — is Ollama or Off Grid AI running?",
                  streaming: false,
                }
              : m
          )
        );
      }
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, chatBusy, messages, ragEnabled]);

  const stopChat = () => {
    chatAbort.current?.abort();
    setChatBusy(false);
  };

  // ─── Image generation ──────────────────────────────────────────────────

  const generateImage = useCallback(async () => {
    const prompt = imgPrompt.trim();
    if (!prompt || imgBusy) return;
    setImgBusy(true);
    setImgResult(null);
    setImgError("");
    try {
      const result = await localAiEngine.generateImage(prompt);
      setImgResult(result.url ?? null);
    } catch (err: any) {
      setImgError(err?.message || "Image generation failed.");
    } finally {
      setImgBusy(false);
    }
  }, [imgPrompt, imgBusy]);

  // ─── Voice recording + STT ─────────────────────────────────────────────

  const startRecording = async () => {
    setVoiceError("");
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        try {
          const text = await localAiEngine.transcribeAudio(blob);
          setTranscript(text);
          setTtsText(text);
        } catch (err: any) {
          setVoiceError(err?.message || "Transcription failed.");
        }
      };
      mr.start();
      mediaRecorder.current = mr;
      setRecording(true);
    } catch (err: any) {
      setVoiceError(err?.message || "Microphone access denied.");
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setRecording(false);
  };

  const speakText = async () => {
    if (!ttsText.trim() || ttsBusy) return;
    setTtsBusy(true);
    setVoiceError("");
    try {
      const buf = await localAiEngine.textToSpeech(ttsText.trim());
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) throw new Error("AudioContext not supported.");
      const ctx: AudioContext = new AC();
      if (ctx.state === "suspended") await ctx.resume();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.onended = () => { void ctx.close(); };
      src.start();
    } catch (err: any) {
      setVoiceError(err?.message || "TTS failed.");
    } finally {
      setTtsBusy(false);
    }
  };

  // ─── Model pull ────────────────────────────────────────────────────────

  const pullStarterModel = async () => {
    if (pulling) return;
    setPulling(true);
    setPullError("");
    setPullProgress({ status: "Connecting…", percent: 0 });
    try {
      await localAiEngine.pullModel(STARTER_MODEL, (p) => setPullProgress(p));
    } catch (err: any) {
      setPullError(err?.message || "Download failed.");
    } finally {
      setPulling(false);
    }
  };

  const addKnowledge = useCallback(async () => {
    if (ragBusy) return;
    const text = ragInput.trim();
    if (!text) return;
    setRagBusy(true);
    setRagError("");
    try {
      await addRagDoc(ragTitle.trim() || "Knowledge Note", text);
      await refreshRagDocs();
      setRagInput("");
      setRagTitle("");
    } catch (err: any) {
      setRagError(err?.message || "Could not index knowledge.");
    } finally {
      setRagBusy(false);
    }
  }, [ragBusy, ragInput, ragTitle, refreshRagDocs]);

  const clearKnowledge = useCallback(async () => {
    if (ragBusy || ragDocs.length === 0) return;
    setRagBusy(true);
    setRagError("");
    try {
      await clearRagDocs();
      setRagDocs([]);
    } catch (err: any) {
      setRagError(err?.message || "Could not clear knowledge.");
    } finally {
      setRagBusy(false);
    }
  }, [ragBusy, ragDocs.length]);

  const removeKnowledge = useCallback(async (docId: string) => {
    if (ragBusy) return;
    setRagBusy(true);
    setRagError("");
    try {
      await removeRagDoc(docId);
      await refreshRagDocs();
    } catch (err: any) {
      setRagError(err?.message || "Could not remove knowledge.");
    } finally {
      setRagBusy(false);
    }
  }, [ragBusy, refreshRagDocs]);

  // ─── Render helpers ────────────────────────────────────────────────────

  const backendLabel =
    status.chatBackend === "ollama"
      ? "Ollama"
      : status.chatBackend === "openai_compat"
      ? "Off Grid AI"
      : null;

  const noBackend = status.chatBackend === "none";

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        flex: 1,
        border: "none",
        borderRadius: 8,
        padding: "7px 0",
        background: tab === id ? T.blue : "transparent",
        color: tab === id ? "#fff" : T.label,
        fontWeight: tab === id ? 700 : 400,
        fontSize: 13,
        cursor: "pointer",
        transition: "background .15s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        borderRadius: 16,
        border: `1px solid ${T.border}`,
        overflow: "hidden",
        maxHeight: 540,
        fontFamily:
          '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px 8px",
          borderBottom: `1px solid ${T.sep}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: T.text }}>
            AI Assistant
          </span>
          {backendLabel && (
            <span
              style={{
                fontSize: 11,
                background: T.green + "33",
                color: T.green,
                borderRadius: 6,
                padding: "2px 7px",
                fontWeight: 600,
              }}
            >
              {backendLabel} ✓
            </span>
          )}
          {noBackend && (
            <span
              style={{
                fontSize: 11,
                background: T.red + "22",
                color: T.red,
                borderRadius: 6,
                padding: "2px 7px",
              }}
            >
              Offline
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: T.label,
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
              padding: 0,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 10px",
          background: T.card,
          flexShrink: 0,
        }}
      >
        {tabBtn("chat", "💬 Chat")}
        {tabBtn("image", "🖼 Image")}
        {tabBtn("voice", "🎙 Voice")}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* No backend — install prompt */}
        {noBackend && (
          <div
            style={{
              background: T.card,
              borderRadius: 12,
              padding: "14px 16px",
              color: T.text,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Start Ollama to enable AI
            </div>
            <div style={{ color: T.label, marginBottom: 12 }}>
              Download and open Ollama on this PC — GridCaller will detect it
              automatically. No account, no API key.
            </div>
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                background: T.blue,
                color: "#fff",
                borderRadius: 9,
                padding: "8px 18px",
                fontWeight: 700,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              Download Ollama →
            </a>
            <div style={{ marginTop: 10, color: T.label, fontSize: 12 }}>
              Need images or voice?{" "}
              <a
                href="https://github.com/off-grid-ai/desktop/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: T.blue }}
              >
                Get Off Grid AI
              </a>{" "}
              for on-device image generation and Whisper voice.
            </div>
          </div>
        )}

        {/* Ollama available but no models → pull starter */}
        {!noBackend &&
          status.chatBackend === "ollama" &&
          status.chatModels.length === 0 && (
            <div
              style={{
                background: T.card,
                borderRadius: 12,
                padding: "14px 16px",
                color: T.text,
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Download a starter model
              </div>
              <div style={{ color: T.label, marginBottom: 10 }}>
                Ollama is running but has no models yet. Tap to download{" "}
                <b>Llama 3.2 1B</b> (~700 MB) — fast, general-purpose, works
                on any device.
              </div>
              {pullProgress && (
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      background: T.sep,
                      borderRadius: 99,
                      height: 6,
                      overflow: "hidden",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        width: `${pullProgress.percent}%`,
                        height: "100%",
                        background: T.blue,
                        borderRadius: 99,
                        transition: "width .3s",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: T.label }}>
                    {pullProgress.status} {pullProgress.percent > 0 ? `· ${pullProgress.percent}%` : ""}
                  </div>
                </div>
              )}
              {pullError && (
                <div style={{ color: T.red, fontSize: 12, marginBottom: 8 }}>
                  {pullError}
                </div>
              )}
              <button
                type="button"
                onClick={() => void pullStarterModel()}
                disabled={pulling}
                style={{
                  border: "none",
                  borderRadius: 9,
                  padding: "8px 18px",
                  background: pulling ? T.sep : T.blue,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: pulling ? "default" : "pointer",
                }}
              >
                {pulling ? "Downloading…" : "Download Llama 3.2 1B"}
              </button>
            </div>
          )}

        {/* ── CHAT TAB ── */}
        {tab === "chat" && !noBackend && status.chatModels.length > 0 && (
          <>
            <div
              style={{
                background: T.card,
                borderRadius: 10,
                padding: "9px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 7,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 6, color: T.text, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={ragEnabled}
                    onChange={(e) => setRagEnabled(e.target.checked)}
                  />
                  RAG mode
                </label>
                <div style={{ color: T.label, fontSize: 11 }}>
                  {ragDocs.length} docs · hub-backed
                </div>
              </div>
              <input
                value={ragTitle}
                onChange={(e) => setRagTitle(e.target.value)}
                placeholder="Knowledge title"
                style={{
                  background: T.inputBg,
                  color: T.text,
                  border: `1px solid ${T.sep}`,
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  outline: "none",
                }}
              />
              <textarea
                value={ragInput}
                onChange={(e) => setRagInput(e.target.value)}
                placeholder="Paste local SOP, notes, docs for retrieval..."
                rows={2}
                style={{
                  resize: "vertical",
                  background: T.inputBg,
                  color: T.text,
                  border: `1px solid ${T.sep}`,
                  borderRadius: 8,
                  padding: "7px 8px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void addKnowledge()}
                  disabled={ragBusy || !ragInput.trim()}
                  style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 10px",
                    background: ragBusy || !ragInput.trim() ? T.sep : T.blue,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: ragBusy || !ragInput.trim() ? "default" : "pointer",
                  }}
                >
                  {ragBusy ? "Indexing…" : "Add Knowledge"}
                </button>
                <button
                  type="button"
                  onClick={() => void clearKnowledge()}
                  disabled={ragBusy || ragDocs.length === 0}
                  style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 10px",
                    background: ragBusy || ragDocs.length === 0 ? T.sep : T.red + "22",
                    color: ragBusy || ragDocs.length === 0 ? T.label : T.red,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: ragBusy || ragDocs.length === 0 ? "default" : "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
              {ragError && <div style={{ color: T.red, fontSize: 11 }}>{ragError}</div>}
              {ragDocs.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ragDocs.slice(0, 4).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => void removeKnowledge(d.id)}
                      title="Remove document"
                      style={{
                        border: `1px solid ${T.sep}`,
                        background: "transparent",
                        color: T.label,
                        borderRadius: 99,
                        padding: "2px 8px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {d.title} ×
                    </button>
                  ))}
                  {ragDocs.length > 4 && (
                    <div style={{ color: T.label, fontSize: 11, alignSelf: "center" }}>
                      +{ragDocs.length - 4} more
                    </div>
                  )}
                </div>
              )}
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minHeight: 120,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {messages.length === 0 && (
                <div
                  style={{
                    color: T.label,
                    fontSize: 13,
                    textAlign: "center",
                    marginTop: 24,
                  }}
                >
                  Ask anything — runs fully on-device.
                </div>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "82%",
                    background:
                      m.role === "user"
                        ? T.blue
                        : T.card,
                    color: m.role === "user" ? "#fff" : T.text,
                    borderRadius: 14,
                    padding: "9px 13px",
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.content || (m.streaming ? "▍" : "")}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="Type a message…"
                rows={2}
                style={{
                  flex: 1,
                  resize: "none",
                  background: T.inputBg,
                  color: T.text,
                  border: `1px solid ${T.sep}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => void sendChat()}
                  disabled={chatBusy || !chatInput.trim()}
                  style={{
                    border: "none",
                    borderRadius: 9,
                    padding: "8px 14px",
                    background:
                      chatBusy || !chatInput.trim() ? T.sep : T.blue,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor:
                      chatBusy || !chatInput.trim() ? "default" : "pointer",
                    flex: 1,
                  }}
                >
                  Send
                </button>
                {chatBusy && (
                  <button
                    type="button"
                    onClick={stopChat}
                    style={{
                      border: "none",
                      borderRadius: 9,
                      padding: "6px 14px",
                      background: T.red + "22",
                      color: T.red,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── IMAGE TAB ── */}
        {tab === "image" && (
          <>
            {status.imageBackend === "none" ? (
              <div
                style={{
                  color: T.label,
                  fontSize: 13,
                  lineHeight: 1.6,
                  background: T.card,
                  borderRadius: 12,
                  padding: "14px 16px",
                }}
              >
                <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  Image generation not available
                </div>
                Install{" "}
                <a
                  href="https://github.com/off-grid-ai/desktop/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: T.blue }}
                >
                  Off Grid AI
                </a>{" "}
                (free, no key) to get on-device image generation powered by
                Stable Diffusion. It runs at localhost:7878 — GridCaller
                detects it automatically.
              </div>
            ) : (
              <>
                <textarea
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                  placeholder="Describe the image you want…"
                  rows={3}
                  style={{
                    resize: "none",
                    background: T.inputBg,
                    color: T.text,
                    border: `1px solid ${T.sep}`,
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void generateImage()}
                  disabled={imgBusy || !imgPrompt.trim()}
                  style={{
                    border: "none",
                    borderRadius: 9,
                    padding: "9px 0",
                    background:
                      imgBusy || !imgPrompt.trim() ? T.sep : T.blue,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor:
                      imgBusy || !imgPrompt.trim() ? "default" : "pointer",
                  }}
                >
                  {imgBusy ? "Generating…" : "Generate Image"}
                </button>
                {imgError && (
                  <div style={{ color: T.red, fontSize: 12 }}>{imgError}</div>
                )}
                {imgResult && (
                  <img
                    src={imgResult}
                    alt="Generated"
                    style={{
                      width: "100%",
                      borderRadius: 10,
                      display: "block",
                      objectFit: "contain",
                    }}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* ── VOICE TAB ── */}
        {tab === "voice" && (
          <>
            {status.audioBackend === "none" ? (
              <div
                style={{
                  color: T.label,
                  fontSize: 13,
                  lineHeight: 1.6,
                  background: T.card,
                  borderRadius: 12,
                  padding: "14px 16px",
                }}
              >
                <div style={{ fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  Voice features not available
                </div>
                Install{" "}
                <a
                  href="https://github.com/off-grid-ai/desktop/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: T.blue }}
                >
                  Off Grid AI
                </a>{" "}
                to enable on-device speech-to-text (Whisper) and
                text-to-speech (Kokoro). No cloud, no key needed.
              </div>
            ) : (
              <>
                {/* Speech to text */}
                <div
                  style={{
                    background: T.card,
                    borderRadius: 12,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: T.text,
                      marginBottom: 8,
                    }}
                  >
                    🎤 Speech → Text
                  </div>
                  <button
                    type="button"
                    onClick={recording ? stopRecording : () => void startRecording()}
                    style={{
                      border: "none",
                      borderRadius: 9,
                      padding: "9px 20px",
                      background: recording ? T.red : T.green,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {recording ? "⏹ Stop recording" : "⏺ Start recording"}
                  </button>
                  {transcript && (
                    <div
                      style={{
                        marginTop: 10,
                        color: T.text,
                        fontSize: 13,
                        background: T.inputBg,
                        borderRadius: 8,
                        padding: "8px 10px",
                        lineHeight: 1.5,
                      }}
                    >
                      {transcript}
                    </div>
                  )}
                </div>

                {/* Text to speech */}
                <div
                  style={{
                    background: T.card,
                    borderRadius: 12,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: T.text,
                      marginBottom: 8,
                    }}
                  >
                    🔊 Text → Speech
                  </div>
                  <textarea
                    value={ttsText}
                    onChange={(e) => setTtsText(e.target.value)}
                    placeholder="Type something to hear it spoken…"
                    rows={3}
                    style={{
                      width: "100%",
                      resize: "none",
                      background: T.inputBg,
                      color: T.text,
                      border: `1px solid ${T.sep}`,
                      borderRadius: 10,
                      padding: "8px 10px",
                      fontSize: 13,
                      fontFamily: "inherit",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void speakText()}
                    disabled={ttsBusy || !ttsText.trim()}
                    style={{
                      marginTop: 8,
                      border: "none",
                      borderRadius: 9,
                      padding: "9px 20px",
                      background:
                        ttsBusy || !ttsText.trim() ? T.sep : T.blue,
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor:
                        ttsBusy || !ttsText.trim() ? "default" : "pointer",
                    }}
                  >
                    {ttsBusy ? "Speaking…" : "Speak"}
                  </button>
                </div>

                {voiceError && (
                  <div style={{ color: T.red, fontSize: 12 }}>{voiceError}</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
