import { S } from "./storage";

export interface RagDocMeta {
  id: string;
  title: string;
  createdAt: number;
  chunkCount: number;
}

export interface RagChunk {
  id: string;
  docId: string;
  title: string;
  text: string;
  embedding: number[];
  createdAt: number;
}

export interface RagMatch {
  docId: string;
  title: string;
  text: string;
  score: number;
}

const KEYS = {
  docs: "gc_local_rag_docs_v1",
  chunks: "gc_local_rag_chunks_v1",
  embedModel: "gc_local_rag_embed_model",
};

const DEFAULT_EMBED_MODEL = "nomic-embed-text";

function nowId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(input: string): string {
  return String(input || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function splitTextChunks(input: string, chunkSize = 700, overlap = 120): string[] {
  const text = normalizeText(input);
  if (!text) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkSize);
    chunks.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function keywordScore(query: string, text: string): number {
  const q = normalizeText(query).toLowerCase();
  const t = normalizeText(text).toLowerCase();
  if (!q || !t) return 0;
  const words = q
    .split(/[^a-z0-9]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  if (!words.length) return 0;
  let hits = 0;
  for (const w of words) if (t.includes(w)) hits++;
  return hits / words.length;
}

async function embedText(text: string, model?: string): Promise<number[]> {
  const targetModel = String(model || S.get(KEYS.embedModel, DEFAULT_EMBED_MODEL) || DEFAULT_EMBED_MODEL);
  const res = await fetch("/api/ollama/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: targetModel, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`RAG embedding failed: ${res.status}`);
  const data = await res.json();
  const embedding = data?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("RAG embedding missing");
  }
  return embedding.map((v: any) => Number(v || 0));
}

function readDocs(): RagDocMeta[] {
  return S.get(KEYS.docs, []) as RagDocMeta[];
}

function writeDocs(rows: RagDocMeta[]) {
  S.set(KEYS.docs, rows.slice(0, 200));
}

function readChunks(): RagChunk[] {
  return S.get(KEYS.chunks, []) as RagChunk[];
}

function writeChunks(rows: RagChunk[]) {
  S.set(KEYS.chunks, rows.slice(0, 4000));
}

export function listRagDocs(): RagDocMeta[] {
  return readDocs().sort((a, b) => b.createdAt - a.createdAt);
}

export function removeRagDoc(docId: string) {
  const id = String(docId || "").trim();
  if (!id) return;
  writeDocs(readDocs().filter((d) => d.id !== id));
  writeChunks(readChunks().filter((c) => c.docId !== id));
}

export function clearRagDocs() {
  writeDocs([]);
  writeChunks([]);
}

export async function addRagDoc(title: string, content: string): Promise<RagDocMeta> {
  const safeTitle = normalizeText(title) || "Untitled";
  const chunks = splitTextChunks(content);
  if (!chunks.length) throw new Error("Knowledge text is empty.");
  const docId = nowId("ragdoc");
  const createdAt = Date.now();

  const outChunks: RagChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const embedding = await embedText(text);
    outChunks.push({
      id: `${docId}_${i + 1}`,
      docId,
      title: safeTitle,
      text,
      embedding,
      createdAt,
    });
  }

  const meta: RagDocMeta = {
    id: docId,
    title: safeTitle,
    createdAt,
    chunkCount: outChunks.length,
  };
  writeDocs([meta, ...readDocs()]);
  writeChunks([...outChunks, ...readChunks()]);
  return meta;
}

export async function buildRagContext(
  query: string,
  opts?: { topK?: number; minScore?: number }
): Promise<{ context: string; matches: RagMatch[] } | null> {
  const q = normalizeText(query);
  const chunks = readChunks();
  if (!q || !chunks.length) return null;
  const topK = Math.max(1, Math.min(8, Number(opts?.topK || 4)));
  const minScore = Number.isFinite(opts?.minScore as number) ? Number(opts?.minScore) : 0.15;

  let scored: RagMatch[] = [];
  try {
    const qVec = await embedText(q);
    scored = chunks
      .map((c) => ({
        docId: c.docId,
        title: c.title,
        text: c.text,
        score: cosineSimilarity(qVec, c.embedding),
      }))
      .filter((m) => m.score >= minScore);
  } catch {
    scored = chunks
      .map((c) => ({
        docId: c.docId,
        title: c.title,
        text: c.text,
        score: keywordScore(q, c.text),
      }))
      .filter((m) => m.score > 0);
  }

  if (!scored.length) return null;
  const matches = scored.sort((a, b) => b.score - a.score).slice(0, topK);
  const context = matches
    .map((m, i) => `[${i + 1}] ${m.title}\n${m.text.slice(0, 900)}`)
    .join("\n\n");
  return { context, matches };
}
