export type MeshHandshakeReply = {
  type: "AM_HELLO";
  id: string;
  name: string;
  phone?: string;
  displayNumber?: string;
  lat?: number;
  lng?: number;
  hops?: number;
  ts: number;
  handshake: true;
  replyTo: string;
};

const HELLO_COOLDOWN_MS = 4000;
const HELLO_TTL_MS = 120000;

type HelloState = {
  lastSeenAt: number;
  lastReplyAt: number;
};

const helloState = new Map<string, HelloState>();

export function shouldSendHandshakeReply(
  type: string,
  payload: { id?: string; type?: string; ts?: number } | null | undefined,
  now: number,
  receivedAt = now,
  lastReplyAt = Number.NEGATIVE_INFINITY
): boolean {
  if (type !== "AM_HELLO" && type !== "PEER_HELLO" && type !== "AM_PRESENCE") return false;
  const id = String(payload?.id || "").trim();
  if (!id) return false;
  if (payload?.ts && now - payload.ts > HELLO_TTL_MS) return false;
  if (!Number.isFinite(receivedAt)) return false;
  const nextReplyAt = lastReplyAt + HELLO_COOLDOWN_MS;
  return now >= nextReplyAt;
}

export function buildHandshakeReply(
  payload: { id?: string; name?: string; phone?: string; displayNumber?: string; lat?: number; lng?: number; hops?: number; ts?: number; type?: string },
  replyTo: string
): MeshHandshakeReply {
  const now = Date.now();
  return {
    type: "AM_HELLO",
    id: String(payload?.id || ""),
    name: String(payload?.name || "GridUser"),
    phone: payload?.phone,
    displayNumber: payload?.displayNumber,
    lat: payload?.lat,
    lng: payload?.lng,
    hops: payload?.hops ?? 0,
    ts: payload?.ts ?? now,
    handshake: true,
    replyTo,
  };
}

export function rememberHelloPeer(id: string, now = Date.now()) {
  const entry = helloState.get(id) || { lastSeenAt: 0, lastReplyAt: 0 };
  entry.lastSeenAt = now;
  helloState.set(id, entry);
  return entry;
}

export function shouldReplyToHello(id: string, now = Date.now()) {
  const entry = helloState.get(id) || { lastSeenAt: 0, lastReplyAt: 0 };
  const should = now - entry.lastReplyAt >= HELLO_COOLDOWN_MS;
  if (should) {
    entry.lastReplyAt = now;
    helloState.set(id, entry);
  }
  return should;
}
