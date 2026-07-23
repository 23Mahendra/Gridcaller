/**
 * GridAlive max-compression pipeline — pure software, no cloud.
 * Text device compresses before sandbox write so disk/RAM stay tiny.
 *
 * Layers (best → fallback):
 *  1. Image: canvas resize + WebP/JPEG quality ladder
 *  2. Binary/text: CompressionStream gzip (or deflate)
 *  3. Legacy: raw store with identity codec
 */

export type CompressAlgo = "gzip" | "deflate" | "image-webp" | "image-jpeg" | "none";

export interface CompressResult {
  data: Uint8Array;
  algo: CompressAlgo;
  originalBytes: number;
  compressedBytes: number;
  ratio: number; // compressed / original (lower = better)
  mime?: string;
  width?: number;
  height?: number;
}

const te = new TextEncoder();
const td = new TextDecoder();

function u8FromBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

async function streamCompress(data: Uint8Array, format: "gzip" | "deflate"): Promise<Uint8Array | null> {
  try {
    if (typeof CompressionStream === "undefined") return null;
    const cs = new CompressionStream(format);
    const stream = new Blob([data]).stream().pipeThrough(cs);
    const ab = await new Response(stream).arrayBuffer();
    return u8FromBuffer(ab);
  } catch {
    return null;
  }
}

async function streamDecompress(data: Uint8Array, format: "gzip" | "deflate"): Promise<Uint8Array | null> {
  try {
    if (typeof DecompressionStream === "undefined") return null;
    const ds = new DecompressionStream(format);
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return u8FromBuffer(ab);
  } catch {
    return null;
  }
}

/** Gzip (preferred) → deflate → identity */
export async function compressBytes(input: Uint8Array | string | ArrayBuffer): Promise<CompressResult> {
  const data =
    typeof input === "string"
      ? te.encode(input)
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : input;
  const originalBytes = data.byteLength;

  for (const algo of ["gzip", "deflate"] as const) {
    const out = await streamCompress(data, algo);
    if (out && out.byteLength < originalBytes) {
      return {
        data: out,
        algo,
        originalBytes,
        compressedBytes: out.byteLength,
        ratio: originalBytes ? out.byteLength / originalBytes : 1,
      };
    }
  }

  return {
    data,
    algo: "none",
    originalBytes,
    compressedBytes: originalBytes,
    ratio: 1,
  };
}

export async function decompressBytes(data: Uint8Array, algo: CompressAlgo): Promise<Uint8Array> {
  if (algo === "none" || algo === "image-webp" || algo === "image-jpeg") return data;
  if (algo === "gzip" || algo === "deflate") {
    const out = await streamDecompress(data, algo);
    if (out) return out;
  }
  return data;
}

function isImageMime(m: string) {
  return /^image\/(jpeg|jpg|png|webp|gif|bmp|avif)$/i.test(m);
}

function isVideoMime(m: string) {
  return /^video\//i.test(m);
}

/** Progressive image ladder — shrink until under target or min quality */
export async function compressImageBlob(
  blob: Blob,
  opts?: { maxEdge?: number; targetBytes?: number; minQuality?: number }
): Promise<CompressResult> {
  const maxEdge = opts?.maxEdge ?? 1280;
  const targetBytes = opts?.targetBytes ?? 180_000;
  const minQuality = opts?.minQuality ?? 0.35;
  const originalBytes = blob.size;

  // Prefer createImageBitmap; fallback Image()
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      bmp = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const ow = "width" in bmp ? (bmp as ImageBitmap).width : (bmp as HTMLImageElement).naturalWidth;
  const oh = "height" in bmp ? (bmp as ImageBitmap).height : (bmp as HTMLImageElement).naturalHeight;
  let w = ow;
  let h = oh;
  if (Math.max(w, h) > maxEdge) {
    const scale = maxEdge / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const ab = new Uint8Array(await blob.arrayBuffer());
    const packed = await compressBytes(ab);
    return { ...packed, mime: blob.type || "application/octet-stream" };
  }
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, w, h);
  try {
    (bmp as ImageBitmap).close?.();
  } catch {}

  const tryExport = async (type: string, q: number) => {
    const b = await new Promise<Blob | null>((res) => canvas.toBlob((x) => res(x), type, q));
    return b;
  };

  // WebP first (usually smaller), then JPEG
  let best: Blob | null = null;
  let bestAlgo: CompressAlgo = "image-jpeg";
  let quality = 0.82;
  for (const type of ["image/webp", "image/jpeg"]) {
    quality = 0.82;
    while (quality >= minQuality) {
      const b = await tryExport(type, quality);
      if (b && (!best || b.size < best.size)) {
        best = b;
        bestAlgo = type === "image/webp" ? "image-webp" : "image-jpeg";
      }
      if (b && b.size <= targetBytes) break;
      quality -= 0.08;
    }
    if (best && best.size <= targetBytes) break;
  }

  // If still large, shrink canvas further
  if (best && best.size > targetBytes && Math.max(w, h) > 480) {
    const scale = 0.7;
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    canvas.width = w;
    canvas.height = h;
    // redraw from original blob once more
    try {
      const again = await createImageBitmap(blob);
      ctx.drawImage(again, 0, 0, w, h);
      again.close?.();
      const b = await tryExport(bestAlgo === "image-webp" ? "image/webp" : "image/jpeg", minQuality);
      if (b && b.size < best.size) best = b;
    } catch {}
  }

  if (!best) {
    const ab = new Uint8Array(await blob.arrayBuffer());
    const packed = await compressBytes(ab);
    return { ...packed, mime: blob.type, width: ow, height: oh };
  }

  // Extra gzip on encoded image if it still shrinks (rare but free)
  const raw = new Uint8Array(await best.arrayBuffer());
  const extra = await compressBytes(raw);
  const useExtra = extra.algo !== "none" && extra.compressedBytes < raw.byteLength * 0.97;

  return {
    data: useExtra ? extra.data : raw,
    algo: useExtra ? extra.algo : bestAlgo,
    originalBytes,
    compressedBytes: useExtra ? extra.compressedBytes : raw.byteLength,
    ratio: originalBytes ? (useExtra ? extra.compressedBytes : raw.byteLength) / originalBytes : 1,
    mime: bestAlgo === "image-webp" ? "image/webp" : "image/jpeg",
    width: w,
    height: h,
  };
}

/**
 * Universal file compressor:
 *  - images → canvas ladder + optional gzip
 *  - video/audio/other → gzip/deflate at max level (browser stream)
 *  - text/json → gzip
 */
export async function compressFile(
  file: File | Blob,
  nameHint = "file"
): Promise<CompressResult & { name: string; kind: "image" | "video" | "audio" | "text" | "binary" }> {
  const mime = (file as File).type || "application/octet-stream";
  const name = (file as File).name || nameHint;

  if (isImageMime(mime) && typeof document !== "undefined") {
    const r = await compressImageBlob(file, {
      maxEdge: 1280,
      targetBytes: Math.min(220_000, Math.max(40_000, file.size * 0.15)),
      minQuality: 0.32,
    });
    return { ...r, name, kind: "image" };
  }

  const ab = new Uint8Array(await file.arrayBuffer());
  // Videos are already compressed codecs; still try gzip (often little gain)
  // but we store as compressed chunks for transfer efficiency
  const packed = await compressBytes(ab);
  const kind: "video" | "audio" | "text" | "binary" = isVideoMime(mime)
    ? "video"
    : /^audio\//i.test(mime)
      ? "audio"
      : /^text\/|json|xml|javascript|svg/i.test(mime)
        ? "text"
        : "binary";

  return { ...packed, name, kind, mime: mime || packed.mime };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function bytesToBase64(u8: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  try {
    if (crypto?.subtle) {
      const dig = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {}
  // FNV-1a fallback
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export { te as textEncoder, td as textDecoder };
