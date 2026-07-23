/**
 * DeviceVault — sandboxed, max-compressed local storage on EVERY device.
 * No central server. Each user's data lives only in their device sandbox.
 *
 * Storage stack:
 *  · IndexedDB (Dexie) for structured + chunked blobs
 *  · gzip/deflate + image ladder compression (see compress.ts)
 *  · Namespace isolation: sandbox:{deviceId}:{userId}
 *  · Quota-aware eviction of cold cache (never deletes user-owned vault files without flag)
 */

import Dexie, { type Table } from "dexie";
import {
  compressBytes,
  compressFile,
  decompressBytes,
  formatBytes,
  sha256Hex,
  type CompressAlgo,
} from "./compress";
import { bus } from "./bus";
import { S } from "./storage";

const CHUNK = 256 * 1024; // 256KB compressed chunks

export interface VaultMeta {
  id: string;
  sandbox: string;
  name: string;
  mime: string;
  kind: string;
  algo: CompressAlgo;
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
  chunks: number;
  sha256: string;
  width?: number;
  height?: number;
  tags: string[];
  owned: boolean; // user data vs mesh-cache
  ts: number;
  lastAccess: number;
  meshShared?: boolean;
}

export interface VaultChunk {
  id: string; // `${vaultId}:${index}`
  vaultId: string;
  sandbox: string;
  index: number;
  data: ArrayBuffer;
}

export interface VaultKv {
  key: string; // `${sandbox}::${logicalKey}`
  sandbox: string;
  logicalKey: string;
  algo: CompressAlgo;
  originalBytes: number;
  compressedBytes: number;
  data: ArrayBuffer;
  ts: number;
}

export interface VaultQuota {
  sandbox: string;
  usedBytes: number;
  fileCount: number;
  kvCount: number;
  maxBytes: number;
  savedBytes: number; // original - compressed cumulative
  updatedAt: number;
}

class DeviceVaultDB extends Dexie {
  meta!: Table<VaultMeta, string>;
  chunks!: Table<VaultChunk, string>;
  kv!: Table<VaultKv, string>;
  quota!: Table<VaultQuota, string>;

  constructor() {
    super("GridAliveDeviceVault");
    this.version(1).stores({
      meta: "id, sandbox, name, kind, ts, lastAccess, owned, meshShared",
      chunks: "id, vaultId, sandbox, index",
      kv: "key, sandbox, logicalKey, ts",
      quota: "sandbox, updatedAt",
    });
  }
}

const vdb = new DeviceVaultDB();

function deviceId(): string {
  let id = S.get("omni_node_id") || S.get("ga_mesh_id") || "";
  if (!id) {
    id = "dev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    S.set("omni_node_id", id);
  }
  return id;
}

function sandboxId(userId?: string): string {
  const u = userId || S.get("user_id") || S.get("ga_user_id") || "local";
  return `sbx:${deviceId()}:${u}`;
}

/** Detect storage budget — use ~8% of deviceMemory or estimate */
function detectMaxBytes(): number {
  try {
    const dm = (navigator as any).deviceMemory; // GB
    if (typeof dm === "number" && dm > 0) {
      // ~48MB per GB of RAM, clamp 64MB–1.5GB
      return Math.max(64 * 1024 * 1024, Math.min(1536 * 1024 * 1024, Math.round(dm * 48 * 1024 * 1024)));
    }
  } catch {}
  return 256 * 1024 * 1024; // 256MB default
}

class DeviceVault {
  private _ready = false;
  private maxBytes = detectMaxBytes();

  get ready() {
    return this._ready;
  }

  get sandbox() {
    return sandboxId();
  }

  async init(userId?: string) {
    this.maxBytes = detectMaxBytes();
    const sb = sandboxId(userId);
    const q = await vdb.quota.get(sb);
    if (!q) {
      await vdb.quota.put({
        sandbox: sb,
        usedBytes: 0,
        fileCount: 0,
        kvCount: 0,
        maxBytes: this.maxBytes,
        savedBytes: 0,
        updatedAt: Date.now(),
      });
    } else if (q.maxBytes !== this.maxBytes) {
      await vdb.quota.update(sb, { maxBytes: this.maxBytes, updatedAt: Date.now() });
    }
    this._ready = true;
    bus.emit("vault:ready", { sandbox: sb, maxBytes: this.maxBytes });
    console.info(
      "[DeviceVault] sandbox",
      sb,
      "· max",
      formatBytes(this.maxBytes),
      "· compressed local-only"
    );
    return this;
  }

  ensure(userId?: string) {
    if (!this._ready) void this.init(userId);
    return this;
  }

  // ─── KV (JSON / small data) ─────────────────────────────────

  async put(logicalKey: string, value: unknown, userId?: string): Promise<VaultKv> {
    this.ensure(userId);
    const sandbox = sandboxId(userId);
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const packed = await compressBytes(raw);
    const key = `${sandbox}::${logicalKey}`;
    const prev = await vdb.kv.get(key);
    const row: VaultKv = {
      key,
      sandbox,
      logicalKey,
      algo: packed.algo,
      originalBytes: packed.originalBytes,
      compressedBytes: packed.compressedBytes,
      data: packed.data.buffer.slice(
        packed.data.byteOffset,
        packed.data.byteOffset + packed.data.byteLength
      ) as ArrayBuffer,
      ts: Date.now(),
    };
    await vdb.kv.put(row);
    await this.recalcQuota(sandbox, {
      delta:
        packed.compressedBytes - (prev?.compressedBytes || 0) + (prev ? 0 : 0),
      kvDelta: prev ? 0 : 1,
      savedDelta:
        packed.originalBytes -
        packed.compressedBytes -
        ((prev?.originalBytes || 0) - (prev?.compressedBytes || 0)),
    });
    bus.emit("vault:put", { key: logicalKey, compressed: packed.compressedBytes });
    return row;
  }

  async get<T = unknown>(logicalKey: string, userId?: string): Promise<T | null> {
    this.ensure(userId);
    const sandbox = sandboxId(userId);
    const row = await vdb.kv.get(`${sandbox}::${logicalKey}`);
    if (!row) return null;
    const u8 = new Uint8Array(row.data);
    const plain = await decompressBytes(u8, row.algo);
    const text = new TextDecoder().decode(plain);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async deleteKey(logicalKey: string, userId?: string) {
    const sandbox = sandboxId(userId);
    const key = `${sandbox}::${logicalKey}`;
    const prev = await vdb.kv.get(key);
    if (!prev) return;
    await vdb.kv.delete(key);
    await this.recalcQuota(sandbox, {
      delta: -prev.compressedBytes,
      kvDelta: -1,
      savedDelta: -(prev.originalBytes - prev.compressedBytes),
    });
  }

  // ─── Files (images / video / any blob) ──────────────────────

  async putFile(
    file: File | Blob,
    opts?: { name?: string; tags?: string[]; userId?: string; owned?: boolean }
  ): Promise<VaultMeta> {
    this.ensure(opts?.userId);
    const sandbox = sandboxId(opts?.userId);
    const q = await this.getQuota(opts?.userId);
    if (q.usedBytes > q.maxBytes * 0.95) {
      await this.evictCache(sandbox, Math.floor(q.maxBytes * 0.1));
    }

    const packed = await compressFile(file, opts?.name || (file as File).name || "file");
    const id =
      "vf_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8);
    const hash = await sha256Hex(packed.data);

    // Space check after compression
    if (q.usedBytes + packed.compressedBytes > q.maxBytes) {
      await this.evictCache(sandbox, packed.compressedBytes + 1024 * 1024);
      const q2 = await this.getQuota(opts?.userId);
      if (q2.usedBytes + packed.compressedBytes > q2.maxBytes) {
        throw new Error(
          `Vault full: need ${formatBytes(packed.compressedBytes)}, free ${formatBytes(Math.max(0, q2.maxBytes - q2.usedBytes))}`
        );
      }
    }

    const nChunks = Math.max(1, Math.ceil(packed.data.byteLength / CHUNK));
    const chunkRows: VaultChunk[] = [];
    for (let i = 0; i < nChunks; i++) {
      const slice = packed.data.subarray(i * CHUNK, (i + 1) * CHUNK);
      const copy = new Uint8Array(slice.byteLength);
      copy.set(slice);
      chunkRows.push({
        id: `${id}:${i}`,
        vaultId: id,
        sandbox,
        index: i,
        data: copy.buffer,
      });
    }
    await vdb.chunks.bulkPut(chunkRows);

    const meta: VaultMeta = {
      id,
      sandbox,
      name: packed.name || opts?.name || "file",
      mime: packed.mime || (file as File).type || "application/octet-stream",
      kind: packed.kind,
      algo: packed.algo,
      originalBytes: packed.originalBytes,
      compressedBytes: packed.compressedBytes,
      ratio: packed.ratio,
      chunks: nChunks,
      sha256: hash,
      width: packed.width,
      height: packed.height,
      tags: opts?.tags || [],
      owned: opts?.owned !== false,
      ts: Date.now(),
      lastAccess: Date.now(),
      meshShared: false,
    };
    await vdb.meta.put(meta);
    await this.recalcQuota(sandbox, {
      delta: packed.compressedBytes,
      fileDelta: 1,
      savedDelta: packed.originalBytes - packed.compressedBytes,
    });
    bus.emit("vault:file", {
      id,
      name: meta.name,
      original: meta.originalBytes,
      compressed: meta.compressedBytes,
      ratio: meta.ratio,
    });
    return meta;
  }

  async getFile(id: string, userId?: string): Promise<{ meta: VaultMeta; blob: Blob } | null> {
    const sandbox = sandboxId(userId);
    const meta = await vdb.meta.get(id);
    if (!meta || meta.sandbox !== sandbox) {
      // allow same-device other sandboxes only if explicit mesh cache owned by us
      if (!meta || !meta.sandbox.startsWith(`sbx:${deviceId()}:`)) return null;
    }
    const parts = await vdb.chunks.where("vaultId").equals(id).sortBy("index");
    if (!parts.length) return null;
    const total = parts.reduce((s, p) => s + p.data.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      const u = new Uint8Array(p.data);
      merged.set(u, off);
      off += u.byteLength;
    }

    let plain = merged;
    if (meta.algo === "gzip" || meta.algo === "deflate") {
      plain = await decompressBytes(merged, meta.algo);
    }
    // image-webp/jpeg/none stored as-is
    const blob = new Blob([plain], { type: meta.mime || "application/octet-stream" });
    await vdb.meta.update(id, { lastAccess: Date.now() });
    return { meta, blob };
  }

  async listFiles(userId?: string, limit = 200): Promise<VaultMeta[]> {
    const sandbox = sandboxId(userId);
    const rows = await vdb.meta.where("sandbox").equals(sandbox).toArray();
    return rows.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  async deleteFile(id: string, userId?: string) {
    const sandbox = sandboxId(userId);
    const meta = await vdb.meta.get(id);
    if (!meta || meta.sandbox !== sandbox) return;
    await vdb.chunks.where("vaultId").equals(id).delete();
    await vdb.meta.delete(id);
    await this.recalcQuota(sandbox, {
      delta: -meta.compressedBytes,
      fileDelta: -1,
      savedDelta: -(meta.originalBytes - meta.compressedBytes),
    });
    bus.emit("vault:delete", { id });
  }

  async getQuota(userId?: string): Promise<VaultQuota> {
    const sandbox = sandboxId(userId);
    const q = await vdb.quota.get(sandbox);
    if (q) return { ...q, maxBytes: this.maxBytes };
    return {
      sandbox,
      usedBytes: 0,
      fileCount: 0,
      kvCount: 0,
      maxBytes: this.maxBytes,
      savedBytes: 0,
      updatedAt: Date.now(),
    };
  }

  async stats(userId?: string) {
    const q = await this.getQuota(userId);
    const files = await this.listFiles(userId, 5000);
    const orig = files.reduce((s, f) => s + f.originalBytes, 0);
    const comp = files.reduce((s, f) => s + f.compressedBytes, 0);
    return {
      sandbox: q.sandbox,
      deviceId: deviceId(),
      usedBytes: q.usedBytes,
      maxBytes: q.maxBytes,
      freeBytes: Math.max(0, q.maxBytes - q.usedBytes),
      fileCount: q.fileCount,
      kvCount: q.kvCount,
      savedBytes: q.savedBytes,
      avgRatio: orig ? comp / orig : 1,
      usedLabel: formatBytes(q.usedBytes),
      maxLabel: formatBytes(q.maxBytes),
      freeLabel: formatBytes(Math.max(0, q.maxBytes - q.usedBytes)),
      savedLabel: formatBytes(q.savedBytes),
      compressionPct: orig ? Math.round((1 - comp / orig) * 100) : 0,
      localOnly: true,
      noCentralServer: true,
    };
  }

  /** Export compressed meta for mesh advertise (not full file) */
  async advertiseMeta(id: string): Promise<Partial<VaultMeta> | null> {
    const m = await vdb.meta.get(id);
    if (!m) return null;
    await vdb.meta.update(id, { meshShared: true });
    return {
      id: m.id,
      name: m.name,
      mime: m.mime,
      kind: m.kind,
      algo: m.algo,
      originalBytes: m.originalBytes,
      compressedBytes: m.compressedBytes,
      ratio: m.ratio,
      sha256: m.sha256,
      chunks: m.chunks,
      ts: m.ts,
    };
  }

  /** Import a compressed file received over mesh into local sandbox (as cache) */
  async importCompressed(
    meta: {
      id?: string;
      name: string;
      mime: string;
      kind: string;
      algo: CompressAlgo;
      originalBytes: number;
      compressedBytes: number;
      ratio: number;
      sha256: string;
    },
    compressed: Uint8Array,
    userId?: string
  ): Promise<VaultMeta> {
    this.ensure(userId);
    const sandbox = sandboxId(userId);
    const id = meta.id || "mesh_" + Date.now().toString(36);
    const existing = await vdb.meta.get(id);
    if (existing) return existing;

    const nChunks = Math.max(1, Math.ceil(compressed.byteLength / CHUNK));
    const chunkRows: VaultChunk[] = [];
    for (let i = 0; i < nChunks; i++) {
      const slice = compressed.subarray(i * CHUNK, (i + 1) * CHUNK);
      const copy = new Uint8Array(slice.byteLength);
      copy.set(slice);
      chunkRows.push({
        id: `${id}:${i}`,
        vaultId: id,
        sandbox,
        index: i,
        data: copy.buffer,
      });
    }
    await vdb.chunks.bulkPut(chunkRows);
    const row: VaultMeta = {
      id,
      sandbox,
      name: meta.name,
      mime: meta.mime,
      kind: meta.kind,
      algo: meta.algo,
      originalBytes: meta.originalBytes,
      compressedBytes: compressed.byteLength,
      ratio: meta.ratio,
      chunks: nChunks,
      sha256: meta.sha256,
      tags: ["mesh-cache"],
      owned: false,
      ts: Date.now(),
      lastAccess: Date.now(),
      meshShared: true,
    };
    await vdb.meta.put(row);
    await this.recalcQuota(sandbox, {
      delta: compressed.byteLength,
      fileDelta: 1,
      savedDelta: Math.max(0, meta.originalBytes - compressed.byteLength),
    });
    return row;
  }

  /** Read raw compressed bytes for mesh transfer */
  async readCompressed(id: string): Promise<Uint8Array | null> {
    const parts = await vdb.chunks.where("vaultId").equals(id).sortBy("index");
    if (!parts.length) return null;
    const total = parts.reduce((s, p) => s + p.data.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      const u = new Uint8Array(p.data);
      merged.set(u, off);
      off += u.byteLength;
    }
    return merged;
  }

  private async recalcQuota(
    sandbox: string,
    d: { delta?: number; fileDelta?: number; kvDelta?: number; savedDelta?: number }
  ) {
    const q = (await vdb.quota.get(sandbox)) || {
      sandbox,
      usedBytes: 0,
      fileCount: 0,
      kvCount: 0,
      maxBytes: this.maxBytes,
      savedBytes: 0,
      updatedAt: Date.now(),
    };
    q.usedBytes = Math.max(0, q.usedBytes + (d.delta || 0));
    q.fileCount = Math.max(0, q.fileCount + (d.fileDelta || 0));
    q.kvCount = Math.max(0, q.kvCount + (d.kvDelta || 0));
    q.savedBytes = Math.max(0, q.savedBytes + (d.savedDelta || 0));
    q.maxBytes = this.maxBytes;
    q.updatedAt = Date.now();
    await vdb.quota.put(q);
  }

  /** Evict oldest non-owned mesh cache to free space */
  private async evictCache(sandbox: string, needBytes: number) {
    const rows = await vdb.meta
      .where("sandbox")
      .equals(sandbox)
      .filter((m) => !m.owned)
      .sortBy("lastAccess");
    let freed = 0;
    for (const m of rows) {
      if (freed >= needBytes) break;
      await vdb.chunks.where("vaultId").equals(m.id).delete();
      await vdb.meta.delete(m.id);
      freed += m.compressedBytes;
      await this.recalcQuota(sandbox, {
        delta: -m.compressedBytes,
        fileDelta: -1,
        savedDelta: -(m.originalBytes - m.compressedBytes),
      });
    }
    if (freed) bus.emit("vault:evict", { freed, sandbox });
  }
}

export const deviceVault = new DeviceVault();
export default deviceVault;
