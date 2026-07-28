// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Local AI Engine
// Unified offline AI: chat, image generation, voice STT/TTS
//
// Supported backends (auto-detected, zero API keys):
//   • Ollama   — http://localhost:11434  (chat + model pull)
//   • OpenAI-compatible local gateway   (chat + images + audio)
//     e.g. Off Grid AI running at http://localhost:7878/v1
//
// All inference runs on-device. Nothing leaves the machine.
// ═══════════════════════════════════════════════════════

import { bus } from "./bus";
import { S } from "./storage";

// Vite dev-server proxy paths (avoids CORS for local backends)
const OLLAMA_BASE = "/api/ollama";
const OFFGRID_BASE = "/api/offgrid";

// ─── Public types ───────────────────────────────────────────────────────────

export type AiBackend = "ollama" | "openai_compat" | "none";

export interface AiModel {
  id: string;
  name: string;
  ownedBy?: string;
  sizeGB?: number;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiImageResult {
  /** data-URL or remote URL */
  url?: string;
  /** raw base-64 JPEG/PNG */
  b64_json?: string;
}

export interface AiPullProgress {
  status: string;
  percent: number;
  total?: number;
  completed?: number;
}

export interface AiStatusSnapshot {
  chatBackend: AiBackend;
  imageBackend: AiBackend;
  audioBackend: AiBackend;
  chatModels: AiModel[];
  activeModel: string;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

class LocalAiEngine {
  private _chatBackend: AiBackend = "none";
  private _imageBackend: AiBackend = "none";
  private _audioBackend: AiBackend = "none";
  private _chatModels: AiModel[] = [];
  private _activeModel: string = S.get("local_ai_model", "");
  private _monitorStarted = false;
  private _checkInterval: ReturnType<typeof setInterval> | null = null;
  private _retryTimers: Array<ReturnType<typeof setTimeout>> = [];
  private _visibilityHandler: (() => void) | null = null;
  private _focusHandler: (() => void) | null = null;
  private _subscribers = new Set<(s: AiStatusSnapshot) => void>();
  private _pulling = new Map<string, AiPullProgress>();

  // ─── Accessors ────────────────────────────────────────────────────────────

  get chatBackend(): AiBackend { return this._chatBackend; }
  get imageBackend(): AiBackend { return this._imageBackend; }
  get audioBackend(): AiBackend { return this._audioBackend; }
  get chatModels(): AiModel[] { return [...this._chatModels]; }
  get activeModel(): string { return this._activeModel; }
  get available(): boolean { return this._chatBackend !== "none"; }
  get imageAvailable(): boolean { return this._imageBackend !== "none"; }
  get audioAvailable(): boolean { return this._audioBackend !== "none"; }
  get pulling(): Map<string, AiPullProgress> { return new Map(this._pulling); }

  // ─── Backend detection ────────────────────────────────────────────────────

  private async probeOllama(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const models: AiModel[] = (data.models ?? []).map((m: any) => ({
        id: m.name,
        name: m.name,
        ownedBy: "ollama",
        sizeGB: m.size ? +(m.size / 1e9).toFixed(1) : undefined,
      }));
      // Ollama handles chat; merge models without overwriting an OpenAI-compat list
      if (this._chatBackend === "none") {
        this._chatModels = models;
        this._chatBackend = "ollama";
        if (models.length && !this._activeModel) {
          this._activeModel = models[0].id;
          S.set("local_ai_model", this._activeModel);
        }
      } else {
        // Already have openai_compat — keep that for chat; expose Ollama models too
        const existing = new Set(this._chatModels.map((m) => m.id));
        for (const m of models) {
          if (!existing.has(m.id)) this._chatModels.push(m);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private async probeOpenAiCompat(): Promise<boolean> {
    try {
      const res = await fetch(`${OFFGRID_BASE}/models`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const models: AiModel[] = (data.data ?? []).map((m: any) => ({
        id: m.id,
        name: m.id,
        ownedBy: m.owned_by ?? "local",
      }));

      const gatewayModels: AiModel[] = models.length
        ? models
        : [{ id: "local", name: "local", ownedBy: "local" }];

      // OpenAI-compat gateway becomes the preferred chat backend
      this._chatModels = [
        ...gatewayModels,
        ...this._chatModels.filter(
          (existing) => !gatewayModels.some((m) => m.id === existing.id)
        ),
      ];
      this._chatBackend = "openai_compat";

      const activeOk = this._activeModel && gatewayModels.some((m) => m.id === this._activeModel);
      if (!activeOk) {
        this._activeModel = gatewayModels[0].id;
        S.set("local_ai_model", this._activeModel);
      }

      // Assume gateway supports images and audio if reachable
      this._imageBackend = "openai_compat";
      this._audioBackend = "openai_compat";
      return true;
    } catch {
      return false;
    }
  }

  async checkAvailability(): Promise<AiStatusSnapshot> {
    // Reset before probing both backends simultaneously
    this._chatBackend = "none";
    this._imageBackend = "none";
    this._audioBackend = "none";
    this._chatModels = [];

    await Promise.all([this.probeOllama(), this.probeOpenAiCompat()]);

    S.set("local_ai_available", this._chatBackend !== "none");
    this._emitStatus();
    return this.getSnapshot();
  }

  /** Start background availability monitoring (idempotent). */
  startMonitoring() {
    if (this._monitorStarted) return;
    this._monitorStarted = true;
    void this.checkAvailability();
    this._retryTimers.push(setTimeout(() => { void this.checkAvailability(); }, 5000));
    this._retryTimers.push(setTimeout(() => { void this.checkAvailability(); }, 15000));
    this._checkInterval = setInterval(() => { void this.checkAvailability(); }, 30000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.checkAvailability();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  }

  stopMonitoring() {
    if (this._checkInterval) { clearInterval(this._checkInterval); this._checkInterval = null; }
    this._retryTimers.forEach(clearTimeout);
    this._retryTimers = [];
    this._monitorStarted = false;
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  async chat(
    messages: AiChatMessage[],
    opts?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const model = opts?.model ?? this._activeModel;

    if (this._chatBackend === "ollama") {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: opts?.temperature ?? 0.7,
            num_predict: opts?.maxTokens ?? 512,
          },
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
      const data = await res.json();
      return (data.message?.content as string) ?? "";
    }

    if (this._chatBackend === "openai_compat") {
      const res = await fetch(`${OFFGRID_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "local",
          messages,
          temperature: opts?.temperature ?? 0.7,
          max_tokens: opts?.maxTokens ?? 512,
          stream: false,
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
      const data = await res.json();
      return (data.choices?.[0]?.message?.content as string) ?? "";
    }

    throw new Error("No local AI backend is running. Start Ollama or Off Grid AI.");
  }

  /** Streaming chat — calls onToken for each incremental piece. */
  async chatStream(
    messages: AiChatMessage[],
    onToken: (token: string) => void,
    opts?: {
      model?: string;
      temperature?: number;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const model = opts?.model ?? this._activeModel;
    let full = "";

    if (this._chatBackend === "ollama") {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: { temperature: opts?.temperature ?? 0.7, num_predict: 512 },
        }),
        signal: opts?.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        if (opts?.signal?.aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            const tok: string = j.message?.content ?? "";
            if (tok) { full += tok; onToken(tok); }
          } catch { /* partial JSON — skip */ }
        }
      }
      return full;
    }

    if (this._chatBackend === "openai_compat") {
      const res = await fetch(`${OFFGRID_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "local",
          messages,
          temperature: opts?.temperature ?? 0.7,
          stream: true,
        }),
        signal: opts?.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        if (opts?.signal?.aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const j = JSON.parse(payload);
            const tok: string = j.choices?.[0]?.delta?.content ?? "";
            if (tok) { full += tok; onToken(tok); }
          } catch { /* partial JSON — skip */ }
        }
      }
      return full;
    }

    throw new Error("No local AI backend is running.");
  }

  // ─── Image generation ─────────────────────────────────────────────────────

  /**
   * Text-to-image. Requires an OpenAI-compatible local gateway with image
   * support (e.g. Off Grid AI). Returns a base-64 result or URL.
   */
  async generateImage(
    prompt: string,
    opts?: { width?: number; height?: number; signal?: AbortSignal }
  ): Promise<AiImageResult> {
    if (this._imageBackend !== "openai_compat") {
      throw new Error(
        "Image generation requires Off Grid AI (localhost:7878) or a compatible gateway."
      );
    }
    const res = await fetch(`${OFFGRID_BASE}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        n: 1,
        size: `${opts?.width ?? 512}x${opts?.height ?? 512}`,
        response_format: "b64_json",
      }),
      signal: opts?.signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Image generation failed: ${res.status}`);
    const data = await res.json();
    const item = data.data?.[0] ?? {};
    if (item.b64_json) {
      return { b64_json: item.b64_json, url: `data:image/png;base64,${item.b64_json}` };
    }
    return { url: item.url };
  }

  // ─── Audio ────────────────────────────────────────────────────────────────

  /**
   * Speech-to-text. Requires an OpenAI-compatible gateway with Whisper support.
   */
  async transcribeAudio(audioBlob: Blob, opts?: { language?: string }): Promise<string> {
    if (this._audioBackend !== "openai_compat") {
      throw new Error(
        "Speech-to-text requires Off Grid AI (localhost:7878) or a Whisper-compatible gateway."
      );
    }
    const form = new FormData();
    form.append("file", audioBlob, "audio.webm");
    form.append("model", "whisper");
    if (opts?.language) form.append("language", opts.language);
    const res = await fetch(`${OFFGRID_BASE}/audio/transcriptions`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
    const data = await res.json();
    return (data.text as string) ?? "";
  }

  /**
   * Text-to-speech. Returns raw audio bytes (play with Web Audio API).
   * Requires an OpenAI-compatible gateway with TTS support.
   */
  async textToSpeech(text: string, opts?: { voice?: string }): Promise<ArrayBuffer> {
    if (this._audioBackend !== "openai_compat") {
      throw new Error(
        "Text-to-speech requires Off Grid AI (localhost:7878) or a TTS-compatible gateway."
      );
    }
    const res = await fetch(`${OFFGRID_BASE}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts",
        input: text,
        voice: opts?.voice ?? "alloy",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    return res.arrayBuffer();
  }

  // ─── Model management (Ollama) ────────────────────────────────────────────

  /** Pull (download) a model from the Ollama registry with progress tracking. */
  async pullModel(
    modelName: string,
    onProgress?: (p: AiPullProgress) => void
  ): Promise<boolean> {
    this._pulling.set(modelName, { status: "starting", percent: 0 });
    bus.emit("local-ai:pull-start", { model: modelName });
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: true }),
      });
      if (!res.ok || !res.body) {
        this._pulling.delete(modelName);
        bus.emit("local-ai:pull-error", { model: modelName, error: `HTTP ${res.status}` });
        return false;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            const p: AiPullProgress = {
              status: j.status ?? "",
              total: j.total,
              completed: j.completed,
              percent:
                j.total && j.completed
                  ? Math.round((j.completed / j.total) * 100)
                  : 0,
            };
            this._pulling.set(modelName, p);
            bus.emit("local-ai:pull-progress", { model: modelName, ...p });
            onProgress?.(p);
          } catch { /* partial JSON — skip */ }
        }
      }
      this._pulling.delete(modelName);
      await this.checkAvailability();
      bus.emit("local-ai:pull-complete", { model: modelName });
      return true;
    } catch (err) {
      this._pulling.delete(modelName);
      bus.emit("local-ai:pull-error", { model: modelName, error: String(err) });
      return false;
    }
  }

  setActiveModel(id: string) {
    this._activeModel = id;
    S.set("local_ai_model", id);
    this._emitStatus();
  }

  // ─── Install info (zero terminal commands) ────────────────────────────────

  /** Plain-language Ollama install steps (no terminal commands). */
  getOllamaInstallInfo(): { os: string; downloadUrl: string; steps: string[] } {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) {
      return {
        os: "Windows",
        downloadUrl: "https://ollama.com/download/windows",
        steps: [
          "Tap Download and open the Ollama installer.",
          "Click through the setup — it installs in one step.",
          "Ollama starts automatically in the system tray.",
          "Come back here — we'll detect it for you.",
        ],
      };
    }
    if (ua.includes("mac")) {
      return {
        os: "macOS",
        downloadUrl: "https://ollama.com/download/mac",
        steps: [
          "Tap Download to get the Ollama app.",
          "Drag Ollama to your Applications folder.",
          "Open Ollama — it runs in the menu bar.",
          "Come back here — we'll detect it for you.",
        ],
      };
    }
    return {
      os: "Linux",
      downloadUrl: "https://ollama.com/download/linux",
      steps: [
        "Tap Download to get the Ollama package.",
        "Install using your package manager.",
        "Open Ollama from your applications list.",
        "Come back here — we'll detect it for you.",
      ],
    };
  }

  /** Plain-language Off Grid AI install steps for image gen + voice. */
  getOffGridInstallInfo(): { downloadUrl: string; steps: string[] } {
    return {
      downloadUrl: "https://github.com/off-grid-ai/desktop/releases/latest",
      steps: [
        "Tap Download to get the Off Grid AI app.",
        "Install and open it — no account or key needed.",
        "Download a model from its built-in catalog.",
        "Come back here — we'll detect it for you.",
      ],
    };
  }

  // ─── Status subscription ──────────────────────────────────────────────────

  getSnapshot(): AiStatusSnapshot {
    return {
      chatBackend: this._chatBackend,
      imageBackend: this._imageBackend,
      audioBackend: this._audioBackend,
      chatModels: [...this._chatModels],
      activeModel: this._activeModel,
    };
  }

  subscribeStatus(fn: (s: AiStatusSnapshot) => void): () => void {
    this._subscribers.add(fn);
    try { fn(this.getSnapshot()); } catch { /* ignore */ }
    return () => { this._subscribers.delete(fn); };
  }

  private _emitStatus() {
    const snap = this.getSnapshot();
    bus.emit("local-ai:status", snap);
    this._subscribers.forEach((fn) => { try { fn(snap); } catch { /* ignore */ } });
  }
}

export const localAiEngine = new LocalAiEngine();
export default localAiEngine;
