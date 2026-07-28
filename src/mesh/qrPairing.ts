import QRCode from "qrcode";

export type PairingIdentity = {
  nodeId: string;
  handle: string;
};

function encodeBase64Url(input: string): string {
  try {
    if (typeof btoa === "function") {
      return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }
  } catch {}
  const bufferCtor = (globalThis as any).Buffer as any;
  if (bufferCtor) {
    return bufferCtor
      .from(input, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  throw new Error("Base64 encoder unavailable");
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  try {
    if (typeof atob === "function") {
      return atob(padded);
    }
  } catch {}
  const bufferCtor = (globalThis as any).Buffer as any;
  if (bufferCtor) {
    return bufferCtor.from(padded, "base64").toString("utf8");
  }
  throw new Error("Base64 decoder unavailable");
}

export function encodeHandleNodeId(handle: string, nodeId: string): string {
  const safeHandle = String(handle || "").trim();
  const safeNode = String(nodeId || "").trim();
  return `${safeHandle}@${safeNode}`;
}

export function decodeHandleNodeId(value: string): PairingIdentity | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const splitAt = raw.indexOf("@");
  if (splitAt <= 0 || splitAt === raw.length - 1) return null;
  const handle = raw.slice(0, splitAt).trim();
  const nodeId = raw.slice(splitAt + 1).trim();
  if (!handle || !nodeId) return null;
  return { handle, nodeId };
}

export async function generatePairingQr(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: "M",
  });
}

export function encodeInviteCode(nodeId: string, handle: string): string {
  const payload = JSON.stringify({ v: 1, nodeId: String(nodeId || "").trim(), handle: String(handle || "").trim() });
  return encodeBase64Url(payload);
}

export function decodeInviteCode(code: string): PairingIdentity | null {
  try {
    const raw = decodeBase64Url(String(code || "").trim());
    const parsed = JSON.parse(raw) as { nodeId?: string; handle?: string };
    const nodeId = String(parsed?.nodeId || "").trim();
    const handle = String(parsed?.handle || "").trim();
    if (!nodeId || !handle) return null;
    return { nodeId, handle };
  } catch {
    return null;
  }
}

export function decodeAnyPairingCode(input: string): PairingIdentity | null {
  return decodeHandleNodeId(input) || decodeInviteCode(input);
}
