import Dexie, { type Table } from "dexie";

export type EncryptedRecord = {
  id: string;
  cipher: string;
  iv: string;
  ts: number;
  peerId?: string;
};

type KeyMeta = {
  id: "master";
  wrapped?: string;
  iv?: string;
  salt?: string;
  raw?: string;
  updatedAt: number;
};

class EncryptedMeshDb extends Dexie {
  chats!: Table<EncryptedRecord, string>;
  contacts!: Table<EncryptedRecord, string>;
  files!: Table<EncryptedRecord, string>;
  groups!: Table<EncryptedRecord, string>;
  callLogs!: Table<EncryptedRecord, string>;
  syncMeta!: Table<EncryptedRecord, string>;
  keyMeta!: Table<KeyMeta, string>;

  constructor() {
    super("gridcaller_encrypted_mesh_v1");
    this.version(1).stores({
      chats: "id,ts,peerId",
      contacts: "id,ts",
      files: "id,ts",
      groups: "id,ts",
      callLogs: "id,ts,peerId",
      syncMeta: "id,ts",
      keyMeta: "id",
    });
  }
}

const db = new EncryptedMeshDb();
let sessionKey: CryptoKey | null = null;

function toBase64(buf: Uint8Array): string {
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(input: string): Uint8Array {
  const decoded = atob(input);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) out[i] = decoded.charCodeAt(i);
  return out;
}

async function deriveWrappingKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function importRawAes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

async function exportRawAes(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

async function loadKeyFromMeta(): Promise<CryptoKey> {
  if (sessionKey) return sessionKey;
  const meta = await db.keyMeta.get("master");
  if (meta?.raw) {
    sessionKey = await importRawAes(fromBase64(meta.raw));
    return sessionKey;
  }
  if (meta?.wrapped) {
    throw new Error("Encrypted DB locked: call unlockEncryptedDb(pin) first");
  }

  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = await exportRawAes(generated);
  await db.keyMeta.put({ id: "master", raw: toBase64(raw), updatedAt: Date.now() });
  sessionKey = generated;
  return generated;
}

export async function setEncryptedDbPin(pin: string) {
  const current = await loadKeyFromMeta();
  const raw = await exportRawAes(current);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(pin, salt);
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, raw);
  await db.keyMeta.put({
    id: "master",
    wrapped: toBase64(new Uint8Array(wrapped)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    updatedAt: Date.now(),
  });
}

export async function unlockEncryptedDb(pin: string) {
  const meta = await db.keyMeta.get("master");
  if (!meta?.wrapped || !meta.iv || !meta.salt) return loadKeyFromMeta();
  const wrappingKey = await deriveWrappingKey(pin, fromBase64(meta.salt));
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(meta.iv) },
    wrappingKey,
    fromBase64(meta.wrapped)
  );
  sessionKey = await importRawAes(new Uint8Array(raw));
  return sessionKey;
}

async function encryptJson(data: unknown): Promise<{ cipher: string; iv: string }> {
  const key = await loadKeyFromMeta();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return { cipher: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

async function decryptJson<T>(record: EncryptedRecord): Promise<T> {
  const key = await loadKeyFromMeta();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(record.iv) },
    key,
    fromBase64(record.cipher)
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export async function replaceChats(records: { id: string; ts: number; peerId?: string; payload: unknown }[]) {
  const encrypted = await Promise.all(
    records.map(async (row) => {
      const block = await encryptJson(row.payload);
      return { id: row.id, ts: row.ts, peerId: row.peerId, ...block } satisfies EncryptedRecord;
    })
  );
  await db.chats.clear();
  if (encrypted.length) await db.chats.bulkAdd(encrypted);
}

export async function loadChats<T>(): Promise<T[]> {
  const rows = await db.chats.orderBy("ts").toArray();
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(await decryptJson<T>(row));
    } catch {}
  }
  return out;
}

export async function replaceCallLogs(records: { id: string; ts: number; peerId?: string; payload: unknown }[]) {
  const encrypted = await Promise.all(
    records.map(async (row) => {
      const block = await encryptJson(row.payload);
      return { id: row.id, ts: row.ts, peerId: row.peerId, ...block } satisfies EncryptedRecord;
    })
  );
  await db.callLogs.clear();
  if (encrypted.length) await db.callLogs.bulkAdd(encrypted);
}

export async function loadCallLogs<T>(): Promise<T[]> {
  const rows = await db.callLogs.orderBy("ts").toArray();
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(await decryptJson<T>(row));
    } catch {}
  }
  return out;
}
