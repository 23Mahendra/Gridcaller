import Dexie, { type Table } from "dexie";

export type CachedPeer = {
  peerId: string;
  handle: string;
  name: string;
  lastSeen: number;
};

export type OutboxMessage = {
  id: string;
  to: string;
  toHandle: string;
  text: string;
  ts: number;
  attempts: number;
  envelope?: unknown;
};

class PeerCacheDb extends Dexie {
  peers!: Table<CachedPeer, string>;
  outbox!: Table<OutboxMessage, string>;

  constructor() {
    super("gridcaller_peer_cache_v1");
    this.version(1).stores({
      peers: "peerId,lastSeen,handle,name",
      outbox: "id,to,ts,attempts",
    });
  }
}

const db = new PeerCacheDb();

function createId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return `${prefix}_${cryptoObj.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function rememberPeer(input: Omit<CachedPeer, "lastSeen"> & { lastSeen?: number }) {
  const row: CachedPeer = {
    peerId: input.peerId,
    handle: input.handle,
    name: input.name,
    lastSeen: input.lastSeen ?? Date.now(),
  };
  if (!row.peerId) return;
  await db.peers.put(row);
}

export async function recentPeers(limit = 32): Promise<CachedPeer[]> {
  return db.peers.orderBy("lastSeen").reverse().limit(limit).toArray();
}

export async function findPeer(peerId: string): Promise<CachedPeer | undefined> {
  if (!peerId) return undefined;
  return db.peers.get(peerId);
}

export async function queueOutboxMessage(input: {
  to: string;
  toHandle?: string;
  text: string;
  ts?: number;
  attempts?: number;
  envelope?: unknown;
  id?: string;
}) {
  if (!input.to || !String(input.text || "").trim()) return;
  const row: OutboxMessage = {
    id: input.id || createId("outbox"),
    to: input.to,
    toHandle: input.toHandle || input.to,
    text: String(input.text),
    ts: input.ts ?? Date.now(),
    attempts: input.attempts ?? 0,
    envelope: input.envelope,
  };
  await db.outbox.put(row);
}

export async function queuedForPeer(peerId: string, limit = 80): Promise<OutboxMessage[]> {
  if (!peerId) return [];
  return db.outbox.where("to").equals(peerId).sortBy("ts").then((rows) => rows.slice(-limit));
}

export async function removeQueued(ids: string[]) {
  if (!ids.length) return;
  await db.outbox.bulkDelete(ids);
}

export async function bumpAttempts(ids: string[]) {
  if (!ids.length) return;
  const rows = await db.outbox.bulkGet(ids);
  const updates = rows
    .filter((row): row is OutboxMessage => Boolean(row))
    .map((row) => ({ ...row, attempts: (row.attempts || 0) + 1, ts: Date.now() }));
  await db.outbox.bulkPut(updates);
}
