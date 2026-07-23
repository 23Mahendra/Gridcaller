// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Ollama Engine
// Real local LLM integration via Ollama HTTP API
// Auto-detects, auto-downloads models, provides chat/generate
// ═══════════════════════════════════════════════════════

import { bus } from "./bus";
import { S } from "./storage";
import { env } from "../env";
import { LLM_LIBRARY } from "./llmLibrary";

export interface OllamaModel {
  name: string;
  size: number;       // bytes
  digest: string;
  modified_at: string;
  details?: { family: string; parameter_size: string; quantization_level: string };
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];  // base64
}

export interface OllamaGenerateOpts {
  model: string;
  prompt: string;
  system?: string;
  images?: string[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    num_ctx?: number;
    stop?: string[];
  };
}

export interface OllamaChatOpts {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  options?: OllamaGenerateOpts["options"];
  signal?: AbortSignal;
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent: number;
}

export interface OllamaStatusSnapshot {
  available: boolean;
  models: OllamaModel[];
  defaultModel: string;
}

/** Recommended models from ready-to-use library (device-filtered in UI) */
export const RECOMMENDED_MODELS = LLM_LIBRARY.map((m) => ({
  name: m.name,
  displayName: m.displayName,
  sizeGB: m.sizeGB,
  ramGB: m.ramGB,
  description: m.description,
  roles: m.roles,
  tier: m.tier,
  recommended: m.recommended,
}));

class OllamaEngine {
  // Use same-origin Vite proxy (/api/ollama) by default to avoid CORS.
  // Only use a direct URL if the user has configured a custom remote Ollama server.
  private baseUrl = (() => {
    const stored = S.get("ollama_base_url", "");
    if (!stored || stored === "http://localhost:11434") return "/api/ollama";
    return stored;
  })();
  private _available = false;
  private _models: OllamaModel[] = [];
  // Restored from localStorage so UI shows cached model immediately on reload
  private _defaultModel: string = S.get("ollama_last_model", "");
  private _pulling = new Map<string, OllamaPullProgress>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimers: Array<ReturnType<typeof setTimeout>> = [];
  private monitorStarted = false;
  private visibilityHandler: (() => void) | null = null;
  private focusHandler: (() => void) | null = null;
  private subscribers = new Set<(status: OllamaStatusSnapshot) => void>();

  get available() { return this._available; }
  get models() { return this._models; }
  get defaultModel() { return this._defaultModel; }
  get pulling() { return new Map(this._pulling); }

  setDefaultModel(model: string) {
    if (!model) return;
    if (this._models.length > 0 && !this._models.some((item) => item.name === model)) return;
    this._defaultModel = model;
    S.set("ollama_last_model", this._defaultModel);
    this.emitStatus();
    void this.warmup(this._defaultModel);
  }

  private pickBestModel(models: OllamaModel[]) {
    const preferred = ["tinyllama", "phi3:mini", "gemma2:2b", "qwen2.5", "llama3.2:1b", "llama3.2:3b", "mistral"];
    const cachedStillInstalled = this._defaultModel && models.some((m) => m.name === this._defaultModel);
    if (cachedStillInstalled) return this._defaultModel;

    for (const preference of preferred) {
      const found = models.find((m) => m.name.startsWith(preference));
      if (found) return found.name;
    }
    return models[0]?.name || "";
  }

  private emitStatus() {
    const snapshot: OllamaStatusSnapshot = {
      available: this._available,
      models: [...this._models],
      defaultModel: this._defaultModel,
    };
    bus.emit("ollama:status", snapshot);
    this.subscribers.forEach((fn) => {
      try { fn(snapshot); } catch {}
    });
  }

  getStatusSnapshot(): OllamaStatusSnapshot {
    return {
      available: this._available,
      models: [...this._models],
      defaultModel: this._defaultModel,
    };
  }

  subscribeStatus(fn: (status: OllamaStatusSnapshot) => void) {
    this.subscribers.add(fn);
    try { fn(this.getStatusSnapshot()); } catch {}
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** Check if Ollama is running on localhost */
  async checkAvailability(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        this._models = data.models || [];
        this._available = true;

        // Always re-select default model after every check (reload-safe)
        if (this._models.length > 0) {
          this._defaultModel = this.pickBestModel(this._models);
          // Always persist so next reload recovers instantly
          S.set("ollama_last_model", this._defaultModel);
        }

        S.set("ollama_available", true);
        S.set("ollama_models", this._models.map(m => m.name));
        bus.emit("ollama:available", { models: this._models });
        this.emitStatus();
        return true;
      }
    } catch {}
    this._available = false;
    S.set("ollama_available", false);
    this.emitStatus();
    return false;
  }

  /** Start universal availability checks with fast retries and focus/visibility recovery */
  startMonitoring() {
    if (this.monitorStarted) return;
    this.monitorStarted = true;

    const runCheck = async () => {
      const available = await this.checkAvailability();
      if (available && this._defaultModel) {
        // Warmup is best-effort and should never block UI
        this.warmup(this._defaultModel);
      }
    };

    runCheck();

    // Fast retries after load so users don't wait 30s when Ollama starts shortly after app boot.
    this.retryTimers.push(setTimeout(() => { runCheck(); }, 5000));
    this.retryTimers.push(setTimeout(() => { runCheck(); }, 15000));

    this.checkInterval = setInterval(() => {
      runCheck();
    }, 30000);

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") runCheck();
    };
    this.focusHandler = () => {
      runCheck();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener("focus", this.focusHandler);
  }

  stopMonitoring() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = null;
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers = [];
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler);
      this.focusHandler = null;
    }
    this.monitorStarted = false;
  }

  /**
   * Warm up model — loads it into RAM so first real message is instant.
   * Fire-and-forget: call without await from useEffect.
   */
  async warmup(model?: string): Promise<void> {
    const m = model || this._defaultModel;
    if (!m) return;
    try {
      await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: m,
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          options: { num_predict: 1, num_ctx: 256 },
        }),
        signal: AbortSignal.timeout(60000),
      });
      bus.emit("ollama:warmed-up", { model: m });
    } catch { /* silent — warmup is best-effort */ }
  }

  /** List installed models */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      const data = await res.json();
      this._models = data.models || [];
      return this._models;
    } catch {
      return [];
    }
  }

  /** Pull (download) a model — with progress tracking */
  async pullModel(modelName: string, onProgress?: (p: OllamaPullProgress) => void): Promise<boolean> {
    this._pulling.set(modelName, { status: "starting", percent: 0 });
    bus.emit("ollama:pull-start", { model: modelName });

    try {
      const res = await fetch(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: true }),
      });

      if (!res.ok || !res.body) {
        this._pulling.delete(modelName);
        return false;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const progress: OllamaPullProgress = {
              status: json.status || "",
              digest: json.digest,
              total: json.total,
              completed: json.completed,
              percent: json.total && json.completed ? Math.round((json.completed / json.total) * 100) : 0,
            };
            this._pulling.set(modelName, progress);
            bus.emit("ollama:pull-progress", { model: modelName, ...progress });
            onProgress?.(progress);
          } catch {}
        }
      }

      this._pulling.delete(modelName);
      await this.listModels(); // Refresh model list
      bus.emit("ollama:pull-complete", { model: modelName });
      return true;
    } catch (err) {
      this._pulling.delete(modelName);
      bus.emit("ollama:pull-error", { model: modelName, error: String(err) });
      return false;
    }
  }

  /** Delete a model */
  async deleteModel(modelName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      });
      if (res.ok) {
        await this.listModels();
        bus.emit("ollama:model-deleted", { model: modelName });
        return true;
      }
    } catch {}
    return false;
  }

  /** Chat completion (non-streaming) */
  async chat(opts: OllamaChatOpts): Promise<{ message: OllamaChatMessage; totalDuration: number; evalCount: number }> {
    const model = opts.model || this._defaultModel;
    if (!model) throw new Error("No model available");

    const startTime = Date.now();

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        stream: false,
        options: opts.options || { temperature: 0.7, num_predict: 512 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama chat failed: ${res.status}`);
    const data = await res.json();

    bus.emit("ollama:chat-complete", {
      model,
      duration: Date.now() - startTime,
      tokens: data.eval_count,
    });

    return {
      message: data.message,
      totalDuration: data.total_duration || (Date.now() - startTime) * 1e6,
      evalCount: data.eval_count || 0,
    };
  }

  /** Streaming chat completion */
  async chatStream(
    opts: OllamaChatOpts,
    onToken: (token: string) => void,
    onDone?: (fullResponse: string) => void
  ): Promise<string> {
    const model = opts.model || this._defaultModel;
    if (!model) throw new Error("No model available");

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        stream: true,
        options: opts.options || { temperature: 0.7, num_predict: 512 },
      }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) throw new Error(`Ollama stream failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";

    while (true) {
      if (opts.signal?.aborted) { reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullResponse += json.message.content;
            onToken(json.message.content);
          }
        } catch {}
      }
    }

    onDone?.(fullResponse);
    return fullResponse;
  }

  /** Generate (single prompt, non-chat) */
  async generate(opts: OllamaGenerateOpts): Promise<string> {
    const model = opts.model || this._defaultModel;
    if (!model) throw new Error("No model available");

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        system: opts.system,
        stream: false,
        options: opts.options || { temperature: 0.7, num_predict: 512 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
    const data = await res.json();
    return data.response;
  }

  /** Get embeddings for text */
  async embed(text: string, model?: string): Promise<number[]> {
    const m = model || "nomic-embed-text";
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, prompt: text }),
    });

    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
    const data = await res.json();
    return data.embedding;
  }

  /** Get recommended models that fit the user's device */
  getRecommendedModels(availableRAMGB: number): typeof RECOMMENDED_MODELS {
    return RECOMMENDED_MODELS.filter(m => m.ramGB <= availableRAMGB);
  }

  /** Auto-install the best model for this device */
  async autoInstall(onProgress?: (model: string, p: OllamaPullProgress) => void): Promise<string | null> {
    const deviceRAM = (navigator as any).deviceMemory || 4; // Default 4GB
    const recommended = this.getRecommendedModels(deviceRAM);

    if (recommended.length === 0) return null;

    // Already have a model?
    if (this._models.length > 0) {
      return this._models[0].name;
    }

    // Pull the best fitting model
    const target = recommended[recommended.length > 2 ? 1 : 0]; // 2nd smallest for balance
    const success = await this.pullModel(target.name, (p) => onProgress?.(target.name, p));
    return success ? target.name : null;
  }

  /** Get Ollama install instructions for the current OS */
  getInstallInstructions(): { os: string; command: string; url: string; steps: string[] } {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) {
      return {
        os: "Windows",
        command: "winget install Ollama.Ollama",
        url: "https://ollama.com/download/windows",
        steps: [
          "Download Ollama from ollama.com/download",
          "Run the installer (OllamaSetup.exe)",
          "Ollama starts automatically in the system tray",
          "Come back here — we'll detect it automatically!",
        ],
      };
    } else if (ua.includes("mac")) {
      return {
        os: "macOS",
        command: "brew install ollama",
        url: "https://ollama.com/download/mac",
        steps: [
          "Download Ollama from ollama.com/download",
          "Drag Ollama to Applications",
          "Launch Ollama — it runs in the menu bar",
          "Come back here — we'll detect it automatically!",
        ],
      };
    } else {
      return {
        os: "Linux",
        command: "curl -fsSL https://ollama.com/install.sh | sh",
        url: "https://ollama.com/download/linux",
        steps: [
          "Open terminal and run: curl -fsSL https://ollama.com/install.sh | sh",
          "Start Ollama: ollama serve",
          "Come back here — we'll detect it automatically!",
        ],
      };
    }
  }

  /** Set a custom base URL (e.g., remote Ollama server) */
  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, "");
    S.set("ollama_base_url", this.baseUrl);
    this.checkAvailability();
  }
}

export const ollamaEngine = new OllamaEngine();
export default ollamaEngine;
