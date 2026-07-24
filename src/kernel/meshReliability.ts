export type PendingPacket = {
  id: string;
  to?: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  payload: any;
  packet?: any;
};

export function shouldStoreForReplay(packet: { kind?: string; to?: string; from?: string }, localNodeId: string) {
  if (!packet || typeof packet !== "object") return false;
  if (packet.kind === "tower-beacon" || packet.kind === "hello") return false;
  if (!packet.to) return false;
  if (packet.to === localNodeId) return false;
  if (packet.from === localNodeId) return false;
  return true;
}

export function enqueuePendingPacket(queue: PendingPacket[], entry: PendingPacket) {
  const next = [...queue, entry];
  return next.slice(-24);
}

export function prunePendingPackets(queue: PendingPacket[], now: number) {
  return queue.filter((entry) => (entry.expiresAt ?? now + 1) > now);
}

export async function buildReplayEnvelope(payload: any, localNodeId: string, secret?: string) {
  if (!payload || typeof payload !== "object") return payload;
  const text = new TextEncoder();
  const secretText = String(secret || localNodeId || "gridcaller-mesh");
  const keyMaterial = await crypto.subtle.digest("SHA-256", text.encode(secretText));
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = text.encode(JSON.stringify(payload));
  const cipherBytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    __encrypted: true,
    __cipher: btoa(String.fromCharCode(...new Uint8Array(cipherBytes))),
    __iv: btoa(String.fromCharCode(...iv)),
    __body: payload,
  };
}

export async function decryptReplayEnvelope(envelope: any, localNodeId: string, secret?: string) {
  if (!envelope || !envelope.__encrypted || !envelope.__cipher || !envelope.__iv) return envelope;
  try {
    const text = new TextEncoder();
    const secretText = String(secret || localNodeId || "gridcaller-mesh");
    const keyMaterial = await crypto.subtle.digest("SHA-256", text.encode(secretText));
    const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
    const ivBytes = Uint8Array.from(atob(envelope.__iv).split("").map((c) => c.charCodeAt(0)));
    const cipherBytes = Uint8Array.from(atob(envelope.__cipher).split("").map((c) => c.charCodeAt(0)));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, cipherBytes);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    return envelope.__body || {};
  }
}
