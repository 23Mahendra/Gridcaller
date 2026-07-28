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

const RAG_BASE = "/api/rag";

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

async function readJson<T>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `RAG request failed: ${res.status}`);
  }
  return data as T;
}

export async function listRagDocs(): Promise<RagDocMeta[]> {
  const data = await readJson<{ ok: true; docs: RagDocMeta[] }>(await fetch(`${RAG_BASE}/docs`));
  return Array.isArray(data.docs) ? data.docs : [];
}

export async function removeRagDoc(docId: string): Promise<void> {
  const id = String(docId || "").trim();
  if (!id) return;
  await readJson(await fetch(`${RAG_BASE}/docs/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function clearRagDocs(): Promise<void> {
  await readJson(await fetch(`${RAG_BASE}/docs`, { method: "DELETE" }));
}

export async function addRagDoc(title: string, content: string): Promise<RagDocMeta> {
  const safeTitle = normalizeText(title) || "Knowledge Note";
  const text = normalizeText(content);
  if (!text) throw new Error("Knowledge text is empty.");
  const data = await readJson<{ ok: true; doc: RagDocMeta }>(
    await fetch(`${RAG_BASE}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: safeTitle, content: text }),
    })
  );
  return data.doc;
}

export async function buildRagContext(
  query: string,
  opts?: { topK?: number; minScore?: number }
): Promise<{ context: string; matches: RagMatch[] } | null> {
  const q = normalizeText(query);
  if (!q) return null;
  const data = await readJson<{ ok: true; result: { context: string; matches: RagMatch[] } | null }>(
    await fetch(`${RAG_BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: q,
        topK: opts?.topK,
        minScore: opts?.minScore,
      }),
    })
  );
  return data.result ?? null;
}
