/**
 * Local LLM Library — ready-to-use model catalog + device capacity planner
 * Models run via Ollama (local). Parallel slots scale with free RAM/disk.
 */

export type LlmRole =
  | "general"
  | "medical"
  | "crisis"
  | "translate"
  | "code"
  | "reasoning"
  | "embed"
  | "fast";

export type LlmCatalogEntry = {
  id: string;
  /** Ollama pull name */
  name: string;
  displayName: string;
  sizeGB: number;
  ramGB: number;
  /** Ideal concurrent load weight (1 = light) */
  parallelWeight: number;
  roles: LlmRole[];
  description: string;
  tier: "micro" | "small" | "medium" | "large";
  tags: string[];
  recommended?: boolean;
};

/** Ready-to-use Ollama library (pull names verified for ollama.com library) */
export const LLM_LIBRARY: LlmCatalogEntry[] = [
  // Micro — phones / low RAM
  {
    id: "tinyllama",
    name: "tinyllama",
    displayName: "TinyLlama 1.1B",
    sizeGB: 0.6,
    ramGB: 2,
    parallelWeight: 1,
    roles: ["fast", "general"],
    description: "Ultra-light chat. Always-on companion on weak devices.",
    tier: "micro",
    tags: ["fast", "mobile"],
    recommended: true,
  },
  {
    id: "llama32-1b",
    name: "llama3.2:1b",
    displayName: "Llama 3.2 1B",
    sizeGB: 0.7,
    ramGB: 2,
    parallelWeight: 1,
    roles: ["general", "fast"],
    description: "Meta tiny general assistant — good default starter.",
    tier: "micro",
    tags: ["meta", "starter"],
    recommended: true,
  },
  {
    id: "gemma3-1b",
    name: "gemma3:1b",
    displayName: "Gemma 3 1B",
    sizeGB: 0.8,
    ramGB: 2,
    parallelWeight: 1,
    roles: ["general", "fast"],
    description: "Google compact model — solid offline Q&A.",
    tier: "micro",
    tags: ["google"],
    recommended: true,
  },
  {
    id: "qwen25-05b",
    name: "qwen2.5:0.5b",
    displayName: "Qwen 2.5 0.5B",
    sizeGB: 0.4,
    ramGB: 1.5,
    parallelWeight: 1,
    roles: ["fast", "translate"],
    description: "Tiny multilingual — Hindi/Arabic/Chinese hints.",
    tier: "micro",
    tags: ["multilingual"],
  },
  {
    id: "deepseek-r1-15b",
    name: "deepseek-r1:1.5b",
    displayName: "DeepSeek R1 1.5B",
    sizeGB: 1.1,
    ramGB: 2.5,
    parallelWeight: 1,
    roles: ["reasoning", "crisis"],
    description: "Compact reasoning for triage steps & planning.",
    tier: "micro",
    tags: ["reasoning"],
    recommended: true,
  },
  {
    id: "nomic-embed",
    name: "nomic-embed-text",
    displayName: "Nomic Embed",
    sizeGB: 0.3,
    ramGB: 1,
    parallelWeight: 1,
    roles: ["embed"],
    description: "Embeddings for local search / RAG (not chat).",
    tier: "micro",
    tags: ["embed", "rag"],
  },

  // Small
  {
    id: "qwen25-15b",
    name: "qwen2.5:1.5b",
    displayName: "Qwen 2.5 1.5B",
    sizeGB: 1.0,
    ramGB: 2.5,
    parallelWeight: 1,
    roles: ["translate", "general"],
    description: "Strong multilingual small model.",
    tier: "small",
    tags: ["multilingual"],
    recommended: true,
  },
  {
    id: "gemma2-2b",
    name: "gemma2:2b",
    displayName: "Gemma 2 2B",
    sizeGB: 1.6,
    ramGB: 3,
    parallelWeight: 1,
    roles: ["general", "medical"],
    description: "Balanced small model for medical notes & help.",
    tier: "small",
    tags: ["google", "medical"],
    recommended: true,
  },
  {
    id: "llama32-3b",
    name: "llama3.2:3b",
    displayName: "Llama 3.2 3B",
    sizeGB: 2.0,
    ramGB: 4,
    parallelWeight: 2,
    roles: ["general", "crisis"],
    description: "Best all-rounder for 4GB+ devices.",
    tier: "small",
    tags: ["meta", "default"],
    recommended: true,
  },
  {
    id: "phi3-mini",
    name: "phi3:mini",
    displayName: "Phi-3 Mini 3.8B",
    sizeGB: 2.3,
    ramGB: 4,
    parallelWeight: 2,
    roles: ["reasoning", "code", "general"],
    description: "Microsoft efficient reasoning + light code.",
    tier: "small",
    tags: ["microsoft"],
    recommended: true,
  },

  // Medium
  {
    id: "mistral-7b",
    name: "mistral",
    displayName: "Mistral 7B",
    sizeGB: 4.1,
    ramGB: 8,
    parallelWeight: 3,
    roles: ["general", "crisis", "medical"],
    description: "High quality crisis assistant (8GB+ RAM).",
    tier: "medium",
    tags: ["quality"],
    recommended: true,
  },
  {
    id: "llama31-8b",
    name: "llama3.1:8b",
    displayName: "Llama 3.1 8B",
    sizeGB: 4.7,
    ramGB: 8,
    parallelWeight: 3,
    roles: ["general", "code", "crisis"],
    description: "Flagship open model — deep answers.",
    tier: "medium",
    tags: ["meta", "quality"],
  },
  {
    id: "qwen25-7b",
    name: "qwen2.5:7b",
    displayName: "Qwen 2.5 7B",
    sizeGB: 4.4,
    ramGB: 8,
    parallelWeight: 3,
    roles: ["translate", "general", "code"],
    description: "Excellent multilingual + coding on mid PCs.",
    tier: "medium",
    tags: ["multilingual", "code"],
  },
  {
    id: "codellama-7b",
    name: "codellama:7b",
    displayName: "CodeLlama 7B",
    sizeGB: 3.8,
    ramGB: 8,
    parallelWeight: 3,
    roles: ["code"],
    description: "Dedicated coding helper for Grid Studio.",
    tier: "medium",
    tags: ["code"],
  },

  // Large — only if device has space
  {
    id: "llama31-8b-q4",
    name: "llama3.1:8b-instruct-q4_0",
    displayName: "Llama 3.1 8B Q4",
    sizeGB: 4.7,
    ramGB: 8,
    parallelWeight: 3,
    roles: ["general"],
    description: "Quantized 8B instruct variant if available.",
    tier: "large",
    tags: ["quality"],
  },
  {
    id: "mixtral",
    name: "mixtral:8x7b",
    displayName: "Mixtral 8x7B",
    sizeGB: 26,
    ramGB: 32,
    parallelWeight: 6,
    roles: ["general", "reasoning"],
    description: "MoE powerhouse — only high-end machines.",
    tier: "large",
    tags: ["heavy"],
  },
];

export type DeviceCapacity = {
  ramGB: number;
  /** Estimated free disk for models (GB) — best effort */
  freeDiskGB: number;
  cores: number;
  /** Max parallel Ollama chat slots */
  maxParallel: number;
  /** Max total parallelWeight that can stay warm */
  maxWeight: number;
  /** Suggested starter pack (pull names) */
  starterPack: string[];
  /** Models that fit RAM */
  fitLibrary: LlmCatalogEntry[];
  label: string;
};

function detectRamGB(): number {
  try {
    const dm = (navigator as any).deviceMemory;
    if (typeof dm === "number" && dm > 0) return dm;
  } catch {}
  return 4;
}

function detectCores(): number {
  try {
    return navigator.hardwareConcurrency || 4;
  } catch {
    return 4;
  }
}

/** Estimate free disk via StorageManager (when available) */
export async function estimateFreeDiskGB(): Promise<number> {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota != null && est.usage != null) {
        const free = (est.quota - est.usage) / (1024 ** 3);
        // Browser quota is not full disk — treat as conservative budget
        return Math.max(1, Math.min(200, free));
      }
    }
  } catch {}
  // Fallback: assume ~half of RAM as “safe install budget” signal only
  return Math.max(4, detectRamGB() * 2);
}

/**
 * Parallel slots:
 *  · 2GB RAM → 1 slot
 *  · 4GB → 2
 *  · 8GB → 3
 *  · 16GB+ → 4–6
 */
export function computeMaxParallel(ramGB: number, cores: number): number {
  let n = 1;
  if (ramGB >= 4) n = 2;
  if (ramGB >= 8) n = 3;
  if (ramGB >= 12) n = 4;
  if (ramGB >= 16) n = 5;
  if (ramGB >= 24) n = 6;
  // Don't exceed ~half cores for parallel generation
  n = Math.min(n, Math.max(1, Math.floor(cores / 2) || 1));
  return n;
}

export function computeMaxWeight(ramGB: number): number {
  // Rough: leave 1.5GB for OS/UI
  const usable = Math.max(1, ramGB - 1.5);
  return Math.max(1, Math.floor(usable));
}

export async function getDeviceCapacity(): Promise<DeviceCapacity> {
  const ramGB = detectRamGB();
  const cores = detectCores();
  const freeDiskGB = await estimateFreeDiskGB();
  const maxParallel = computeMaxParallel(ramGB, cores);
  const maxWeight = computeMaxWeight(ramGB);

  const fitLibrary = LLM_LIBRARY.filter(
    (m) => m.ramGB <= ramGB + 0.5 && m.sizeGB <= freeDiskGB + 2
  );

  // Starter pack: micro + one small + optional embed if space
  const starter: string[] = [];
  const micro = fitLibrary.find((m) => m.recommended && m.tier === "micro" && m.roles.includes("general"));
  if (micro) starter.push(micro.name);
  const small = fitLibrary.find(
    (m) => m.recommended && m.tier === "small" && !starter.includes(m.name)
  );
  if (small && freeDiskGB > small.sizeGB + 1) starter.push(small.name);
  const reason = fitLibrary.find((m) => m.roles.includes("reasoning") && m.tier === "micro");
  if (reason && freeDiskGB > (starter.reduce((s, n) => s + (LLM_LIBRARY.find((x) => x.name === n)?.sizeGB || 0), 0) + reason.sizeGB)) {
    starter.push(reason.name);
  }
  if (maxParallel >= 2 && freeDiskGB > 3) {
    const tr = fitLibrary.find((m) => m.roles.includes("translate") && !starter.includes(m.name));
    if (tr) starter.push(tr.name);
  }

  let label = "Compact device";
  if (ramGB >= 16) label = "High-capacity — multi-model parallel ready";
  else if (ramGB >= 8) label = "Mid-range — 2–3 models in parallel";
  else if (ramGB >= 4) label = "Standard — dual-slot possible";
  else label = "Low RAM — single model focus";

  return {
    ramGB,
    freeDiskGB: Math.round(freeDiskGB * 10) / 10,
    cores,
    maxParallel,
    maxWeight,
    starterPack: starter.length ? starter : ["llama3.2:1b"],
    fitLibrary,
    label,
  };
}

/** Map feature / persona → preferred role */
export const ROLE_FOR_FEATURE: Record<string, LlmRole> = {
  medical: "medical",
  blood: "medical",
  mental: "crisis",
  sos: "crisis",
  translate: "translate",
  codeide: "code",
  jarvis: "general",
  ai: "general",
  llm: "general",
  gridcoding: "code",
  default: "general",
};

export function pickModelForRole(
  role: LlmRole,
  installed: string[],
  catalog = LLM_LIBRARY
): string | null {
  const installedSet = new Set(installed.map((n) => n.toLowerCase()));
  const candidates = catalog.filter((m) =>
    m.roles.includes(role) &&
    installed.some(
      (inst) =>
        inst === m.name ||
        inst.startsWith(m.name.split(":")[0]) ||
        m.name.startsWith(inst.split(":")[0])
    )
  );
  if (candidates.length) {
    // Prefer installed exact match
    for (const c of candidates) {
      if (installedSet.has(c.name.toLowerCase())) return c.name;
      const hit = installed.find((i) => i.startsWith(c.name.split(":")[0]));
      if (hit) return hit;
    }
  }
  return installed[0] || null;
}

export function libraryByTier(cap: DeviceCapacity) {
  return {
    ready: cap.fitLibrary.filter((m) => m.recommended),
    allFit: cap.fitLibrary,
    heavy: LLM_LIBRARY.filter((m) => !cap.fitLibrary.find((f) => f.id === m.id)),
  };
}

export default LLM_LIBRARY;
