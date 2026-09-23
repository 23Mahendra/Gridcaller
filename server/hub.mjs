/**
 * GridCaller REAL mesh hub (fullstack PC side)
 * ─────────────────────────────────────────────
 * - HTTP: UI (dist) + APK download/share + health + bridge API
 * - WebSocket: room signaling (chat/call/file/bridge packets)
 * - PeerJS PeerServer: real WebRTC peer IDs on LAN (no cloud required)
 * - GitHub: real `gh` CLI bridge
 * - GridAlive bridge: receive/list transfer manifests for future full app
 *
 * Phone APK / browser → same WiFi or hotspot → this hub.
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { createHash, randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { WebSocketServer } from "ws";
import { PeerServer } from "peer";
import {
  ghAvailable,
  ghAuthStatus,
  runGh,
  cloneOrPull,
  pushRepo,
  listHubRepos,
  defaultWorkDir,
} from "./gh-bridge.mjs";
import { getPstnConfig, placeOutboundCall, placeOutboundSms, phonePermutations } from "./pstnBridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SHARE = path.join(ROOT, "share");
const TRANSFER = path.join(ROOT, "transfer");
const DATA = path.join(ROOT, "data");
const USAGE_LEDGER_FILE = path.join(DATA, "usage-ledger.json");
const RAG_STORE_FILE = path.join(DATA, "rag-store.json");
const PORT = Number(process.env.PORT || 8765);
const PEER_PORT = Number(process.env.PEER_PORT || 9000);
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OFFGRID_BASE_URL = String(process.env.OFFGRID_BASE_URL || "http://127.0.0.1:7878/v1").replace(/\/$/, "");
const RADIO_MEMBER_TTL_MS = Math.max(100, Number(process.env.RADIO_MEMBER_TTL_MS || 20_000));
const RADIO_FLOOR_TTL_MS = Math.max(100, Number(process.env.RADIO_FLOOR_TTL_MS || 8_000));
const radioChannels = new Map();
const pendingCallOffers = new Map();
const PUSH_WEBHOOK_URL = String(process.env.GRIDCALLER_PUSH_WEBHOOK_URL || "").trim();
const PUSH_WEBHOOK_TOKEN = String(process.env.GRIDCALLER_PUSH_WEBHOOK_TOKEN || "").trim();

for (const d of [SHARE, TRANSFER, DATA, defaultWorkDir()]) {
  fs.mkdirSync(d, { recursive: true });
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const usageLedger = readJsonFile(USAGE_LEDGER_FILE, {
  entries: [],
  balancesByNode: {},
  updatedAt: 0,
});

const ragStore = readJsonFile(RAG_STORE_FILE, {
  docs: [],
  chunks: [],
  updatedAt: 0,
  embedModel: "nomic-embed-text",
});

function hashReceiptPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function validRadioChannelId(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(String(value || ""));
}

function radioChannel(channelId, channelName = channelId) {
  let channel = radioChannels.get(channelId);
  if (!channel) {
    channel = { channelId, channelName: String(channelName || channelId).slice(0, 80), members: new Map(), speaker: null };
    radioChannels.set(channelId, channel);
  }
  return channel;
}

function cleanRadioChannel(channel, now = Date.now()) {
  for (const [id, member] of channel.members) {
    if (now - member.lastSeen > RADIO_MEMBER_TTL_MS) channel.members.delete(id);
  }
  if (channel.speaker && (channel.speaker.expiresAt <= now || !channel.members.has(channel.speaker.userId))) {
    channel.speaker = null;
  }
}

function radioSnapshot(channel, localUserId = "", sessionToken = "") {
  cleanRadioChannel(channel);
  return {
    channelId: channel.channelId,
    channelName: channel.channelName,
    localUserId,
    members: [...channel.members.values()].slice(-256).map((member) => ({
      id: member.id, name: member.name, joinedAt: member.joinedAt,
      lastSeen: member.lastSeen, connection: "online",
    })),
    speaker: channel.speaker
      ? {
          userId: channel.speaker.userId,
          userName: channel.speaker.userName,
          leaseId: channel.speaker.leaseId,
          acquiredAt: channel.speaker.acquiredAt,
          expiresAt: channel.speaker.expiresAt,
        }
      : null,
    connection: "connected",
    pushToTalk: "idle",
    muted: false,
    error: "",
    sessionToken,
  };
}

function appendUsageEntry(entry) {
  usageLedger.entries.unshift(entry);
  if (usageLedger.entries.length > 5000) usageLedger.entries = usageLedger.entries.slice(0, 5000);
  usageLedger.balancesByNode[entry.nodeId] =
    (Number(usageLedger.balancesByNode[entry.nodeId]) || 0) + Number(entry.amountCredited || 0);
  usageLedger.updatedAt = Date.now();
  writeJsonFile(USAGE_LEDGER_FILE, usageLedger);
}

function saveRagStore() {
  ragStore.updatedAt = Date.now();
  writeJsonFile(RAG_STORE_FILE, ragStore);
}

function ragNowId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRagText(input) {
  return String(input || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function splitRagTextChunks(input, chunkSize = 700, overlap = 120) {
  const text = normalizeRagText(input);
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkSize);
    chunks.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

function cosineSimilarity(a, b) {
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

function keywordScore(query, text) {
  const q = normalizeRagText(query).toLowerCase();
  const t = normalizeRagText(text).toLowerCase();
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

async function embedRagText(text, model = ragStore.embedModel || "nomic-embed-text") {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`RAG embedding failed: ${res.status}`);
  const data = await res.json();
  const embedding = data?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) throw new Error("RAG embedding missing");
  return embedding.map((v) => Number(v || 0));
}

function listRagDocs() {
  return [...(ragStore.docs || [])].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function removeRagDoc(docId) {
  const id = String(docId || "").trim();
  if (!id) return;
  ragStore.docs = (ragStore.docs || []).filter((d) => d.id !== id);
  ragStore.chunks = (ragStore.chunks || []).filter((c) => c.docId !== id);
  saveRagStore();
}

function clearRagDocs() {
  ragStore.docs = [];
  ragStore.chunks = [];
  saveRagStore();
}

async function addRagDoc(title, content, model) {
  const safeTitle = normalizeRagText(title) || "Untitled";
  const chunks = splitRagTextChunks(content);
  if (!chunks.length) throw new Error("Knowledge text is empty.");
  const docId = ragNowId("ragdoc");
  const createdAt = Date.now();
  const embedModel = String(model || ragStore.embedModel || "nomic-embed-text");
  const outChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const embedding = await embedRagText(text, embedModel);
    outChunks.push({
      id: `${docId}_${i + 1}`,
      docId,
      title: safeTitle,
      text,
      embedding,
      createdAt,
    });
  }

  const meta = {
    id: docId,
    title: safeTitle,
    createdAt,
    chunkCount: outChunks.length,
  };
  ragStore.embedModel = embedModel;
  ragStore.docs = [meta, ...(ragStore.docs || [])].slice(0, 200);
  ragStore.chunks = [...outChunks, ...(ragStore.chunks || [])].slice(0, 4000);
  saveRagStore();
  return meta;
}

async function buildRagContext(query, opts = {}) {
  const q = normalizeRagText(query);
  const chunks = Array.isArray(ragStore.chunks) ? ragStore.chunks : [];
  if (!q || !chunks.length) return null;
  const topK = Math.max(1, Math.min(8, Number(opts.topK || 4)));
  const minScore = Number.isFinite(opts.minScore) ? Number(opts.minScore) : 0.15;

  let scored = [];
  try {
    const qVec = await embedRagText(q, opts.model || ragStore.embedModel || "nomic-embed-text");
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
  return {
    context: matches.map((m, i) => `[${i + 1}] ${m.title}\n${String(m.text || "").slice(0, 900)}`).join("\n\n"),
    matches,
  };
}

function getWebRtcConfig() {
  const stunCsv = String(process.env.STUN_URLS || "");
  const turnCsv = String(process.env.TURN_URLS || process.env.TURN_URL || "");
  const turnUsername = String(process.env.TURN_USERNAME || "");
  const turnCredential = String(process.env.TURN_CREDENTIAL || "");
  const stun = stunCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const turn = turnCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const iceServers = [];
  for (const urls of stun) iceServers.push({ urls });
  for (const urls of turn) {
    if (!turnUsername || !turnCredential) continue;
    iceServers.push({ urls, username: turnUsername, credential: turnCredential });
  }
  return {
    configuredTurn: !!(turn.length && turnUsername && turnCredential),
    iceServers,
  };
}

/** roomId -> Map(peerId, { ws, name, role, meta }) */
const rooms = new Map();
/** GridAlive /mesh-ws clients (declared early for /api/health) */
const meshClients = new Map();
/** HTTP mesh registry (GridAlive /api/mesh/*) */
const httpMeshPeers = new Map();
/** HTTP message bus — works when WebSocket clients = 0 (Android APK often) */
let meshSeq = 1;
const meshBus = []; // { seq, msg, ts }
const MESH_BUS_MAX = 800;
function meshBusPush(msg) {
  const entry = { seq: meshSeq++, msg, ts: Date.now() };
  meshBus.push(entry);
  if (meshBus.length > MESH_BUS_MAX) meshBus.splice(0, meshBus.length - MESH_BUS_MAX);
  return entry.seq;
}
/** forward declare — set after meshWss */
let meshBroadcast = (_payload, _exceptId = null) => {};
let meshRoute = (_payload, _exceptId = null) => false;

function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const info of ifs[name] || []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return out;
}

function mime(p) {
  const ext = path.extname(p).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".apk": "application/vnd.android.package-archive",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tgz": "application/gzip",
    ".txt": "text/plain; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

function send(res, code, body, type = "text/plain; charset=utf-8", extra = {}) {
  const headers = {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    ...extra,
  };
  res.writeHead(code, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function readBodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function mergeProxyHeaders(upstreamHeaders = {}) {
  const out = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
  for (const [name, value] of Object.entries(upstreamHeaders)) {
    if (typeof value !== "string" || name.toLowerCase() === "transfer-encoding") continue;
    out[name] = value;
  }
  return out;
}

async function proxyLocalApi(req, res, pathname, search, routePrefix, targetBase) {
  const upstreamPath = pathname.startsWith(routePrefix)
    ? pathname.slice(routePrefix.length) || "/"
    : pathname;
  const targetUrl = `${targetBase}${upstreamPath}${search || ""}`;
  const method = String(req.method || "GET").toUpperCase();
  const headers = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (name.toLowerCase() === "host" || name.toLowerCase() === "content-length") continue;
    if (Array.isArray(value)) headers[name] = value.join(", ");
    else if (typeof value === "string") headers[name] = value;
  }
  const body = method === "GET" || method === "HEAD" || method === "OPTIONS"
    ? undefined
    : await readBodyBuffer(req);
  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(300_000),
  });
  res.writeHead(upstream.status, mergeProxyHeaders(Object.fromEntries(upstream.headers.entries())));
  if (!upstream.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(upstream.body);
  stream.on("error", () => {
    try { res.end(); } catch {}
  });
  stream.pipe(res);
}

function listShareFiles() {
  if (!fs.existsSync(SHARE)) return [];
  return fs
    .readdirSync(SHARE)
    .filter((f) => !f.startsWith("."))
    .map((f) => {
      const p = path.join(SHARE, f);
      const st = fs.statSync(p);
      return {
        name: f,
        size: st.size,
        mtime: st.mtimeMs,
        url: `/share/${encodeURIComponent(f)}`,
        isApk: f.toLowerCase().endsWith(".apk"),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** App version for OTA push — written by copy-apk / push-to-devices */
function readAppVersion() {
  const candidates = [
    path.join(SHARE, "version.json"),
    path.join(ROOT, "share", "version.json"),
    path.join(ROOT, "version.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        return {
          versionCode: Number(j.versionCode || j.code || 0),
          versionName: String(j.versionName || j.name || "0"),
          force: !!j.force,
          notes: j.notes || "",
        };
      }
    } catch {}
  }
  // Fallback: APK mtime as weak version signal
  try {
    const apk = path.join(SHARE, "GridCaller.apk");
    if (fs.existsSync(apk)) {
      const st = fs.statSync(apk);
      return {
        versionCode: Math.floor(st.mtimeMs / 1000),
        versionName: "apk-" + new Date(st.mtimeMs).toISOString().slice(0, 16),
        force: false,
        notes: "from apk mtime",
      };
    }
  } catch {}
  return { versionCode: 1, versionName: "1.0", force: false, notes: "" };
}

function primaryApkMeta() {
  const files = listShareFiles().filter((f) => f.isApk);
  const hit =
    files.find((f) => /gridcaller/i.test(f.name)) || files[0] || null;
  return hit;
}

function pushUpdateToMesh(force = true) {
  const ver = readAppVersion();
  const apk = primaryApkMeta();
  const ips = lanIPs();
  const host = ips[0] || "127.0.0.1";
  const apkUrl = apk
    ? `http://${host}:${PORT}${apk.url}`
    : `http://${host}:${PORT}/share/GridCaller.apk`;
  const msg = {
    type: "GC_PUSH_UPDATE",
    from: "hub-pc",
    fromName: "PC Hub",
    time: Date.now(),
    ts: Date.now(),
    data: {
      type: "GC_PUSH_UPDATE",
      versionCode: ver.versionCode,
      versionName: ver.versionName,
      apkUrl,
      size: apk?.size,
      mtime: apk?.mtime,
      force: force || ver.force,
      notes: ver.notes,
    },
  };
  meshBroadcast(msg);
  const seq = meshBusPush(msg);
  return { msg, seq, ver, apkUrl, clients: meshClients.size };
}

function roomPeers(roomId) {
  const m = rooms.get(roomId);
  if (!m) return [];
  return [...m.entries()].map(([id, meta]) => ({
    id,
    name: meta.name || id.slice(0, 8),
    role: meta.role || "node",
    transports: meta.transports || ["ws"],
  }));
}

function broadcast(roomId, exceptId, payload) {
  const m = rooms.get(roomId);
  if (!m) return;
  const raw = JSON.stringify(payload);
  for (const [id, meta] of m) {
    if (id === exceptId) continue;
    if (meta.ws.readyState === 1) meta.ws.send(raw);
  }
}

// PeerJS optional — GridAlive GridCaller uses Gun + /mesh-ws + /api/mesh/*
// Enable with: set ENABLE_PEERJS=1
let peerServer = null;
if (process.env.ENABLE_PEERJS === "1") {
  try {
    peerServer = PeerServer({
      port: PEER_PORT,
      path: "/gridcaller",
      allow_discovery: true,
      proxied: false,
      corsOptions: { origin: true },
    });
    peerServer.on("connection", (client) => {
      console.log("[peerjs] connect", client.getId?.() || client.id || "?");
    });
  } catch (e) {
    console.warn("[peerjs] not started:", e?.message || e);
  }
} else {
  console.log("[peerjs] skipped (GridAlive stack uses /mesh-ws) — set ENABLE_PEERJS=1 to enable");
}

// ─── HTTP + WS ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const { pathname } = url;

  try {
    if (pathname === "/api/ollama" || pathname.startsWith("/api/ollama/")) {
      await proxyLocalApi(req, res, pathname, url.search, "/api/ollama", OLLAMA_BASE_URL);
      return;
    }

    if (pathname === "/api/offgrid" || pathname.startsWith("/api/offgrid/")) {
      await proxyLocalApi(req, res, pathname, url.search, "/api/offgrid", OFFGRID_BASE_URL);
      return;
    }

    if (pathname === "/api/call/push/status" && req.method === "GET") {
      return send(res, 200, JSON.stringify({ available: !!PUSH_WEBHOOK_URL, provider: PUSH_WEBHOOK_URL ? "configured-webhook" : "none" }), "application/json");
    }

    if (pathname === "/api/call/push/invite" && req.method === "POST") {
      const body = await readJson(req);
      if (!body.callId || !body.callerId || !body.calleeId) return send(res, 400, JSON.stringify({ accepted: false, error: "invalid call invite" }), "application/json");
      if (!PUSH_WEBHOOK_URL) return send(res, 503, JSON.stringify({ accepted: false, provider: "none", reason: "push provider unavailable" }), "application/json");
      const upstream = await fetch(PUSH_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...(PUSH_WEBHOOK_TOKEN ? { authorization: `Bearer ${PUSH_WEBHOOK_TOKEN}` } : {}) },
        body: JSON.stringify({ type: "GRIDCALLER_CALL_INVITE", ...body }),
        signal: AbortSignal.timeout(8_000),
      });
      return send(res, upstream.ok ? 202 : 502, JSON.stringify({ accepted: upstream.ok, provider: "configured-webhook", reason: upstream.ok ? undefined : `provider HTTP ${upstream.status}` }), "application/json");
    }

    if ((pathname === "/api/call/push/register" || pathname === "/api/call/push/unregister") && req.method === "POST") {
      const body = await readJson(req);
      if (!body.deviceId || !body.registrationSecret || (pathname.endsWith("/register") && !body.token)) {
        return send(res, 400, JSON.stringify({ accepted: false, error: "invalid push registration" }), "application/json");
      }
      if (!PUSH_WEBHOOK_URL) return send(res, 503, JSON.stringify({ accepted: false, provider: "none", reason: "push provider unavailable" }), "application/json");
      const upstream = await fetch(PUSH_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...(PUSH_WEBHOOK_TOKEN ? { authorization: `Bearer ${PUSH_WEBHOOK_TOKEN}` } : {}) },
        body: JSON.stringify({ type: pathname.endsWith("/register") ? "GRIDCALLER_PUSH_REGISTER" : "GRIDCALLER_PUSH_UNREGISTER", ...body }),
        signal: AbortSignal.timeout(8_000),
      });
      return send(res, upstream.ok ? 202 : 502, JSON.stringify({ accepted: upstream.ok, provider: "configured-webhook", reason: upstream.ok ? undefined : `provider HTTP ${upstream.status}` }), "application/json");
    }

    if (pathname === "/api/call/pending" && req.method === "GET") {
      const calleeId = String(url.searchParams.get("calleeId") || "");
      const now = Date.now();
      for (const [id, row] of pendingCallOffers) if (row.expiresAt <= now) pendingCallOffers.delete(id);
      const offers = [...pendingCallOffers.values()].filter((row) => row.calleeId === calleeId && row.expiresAt > now).map((row) => row.message);
      return send(res, 200, JSON.stringify({ offers }), "application/json");
    }
    if (pathname === "/api/call/pending" && req.method === "POST") {
      const body = await readJson(req);
      const message = body.message;
      if (!message?.data?.callId || !message?.data?.to || !message?.data?.offer || message.type !== "GRIDCALLER_OFFER") {
        return send(res, 400, JSON.stringify({ stored: false, error: "invalid pending offer" }), "application/json");
      }
      pendingCallOffers.set(String(message.data.callId), { calleeId: String(message.data.to), expiresAt: Date.now() + 120_000, message });
      return send(res, 201, JSON.stringify({ stored: true, callId: message.data.callId }), "application/json");
    }

    if (pathname === "/api/radio/channel" && req.method === "GET") {
      const channelId = url.searchParams.get("channelId") || "";
      if (!validRadioChannelId(channelId)) return send(res, 400, JSON.stringify({ error: "invalid channelId" }), "application/json");
      return send(res, 200, JSON.stringify(radioSnapshot(radioChannel(channelId))), "application/json");
    }

    if (pathname.startsWith("/api/radio/") && req.method === "POST") {
      const body = await readJson(req);
      const channelId = String(body.channelId || "");
      const userId = String(body.userId || "").trim().slice(0, 128);
      if (!validRadioChannelId(channelId)) return send(res, 400, JSON.stringify({ error: "invalid channelId" }), "application/json");
      if (!userId) return send(res, 400, JSON.stringify({ error: "userId required" }), "application/json");
      const channel = radioChannel(channelId, body.channelName);
      const now = Date.now();
      cleanRadioChannel(channel, now);

      if (pathname === "/api/radio/join") {
        const prior = channel.members.get(userId);
        if (prior?.sessionToken && prior.sessionToken !== String(body.sessionToken || "")) {
          return send(res, 409, JSON.stringify({ error: "radio identity already has a live session" }), "application/json");
        }
        const sessionToken = prior?.sessionToken || randomUUID();
        channel.members.set(userId, {
          id: userId,
          name: String(body.userName || prior?.name || userId).slice(0, 80),
          joinedAt: prior?.joinedAt || now,
          lastSeen: now,
          sessionToken,
        });
        return send(res, 200, JSON.stringify(radioSnapshot(channel, userId, sessionToken)), "application/json");
      }

      const member = channel.members.get(userId);
      if (!member?.sessionToken || member.sessionToken !== String(body.sessionToken || "")) {
        return send(res, 403, JSON.stringify({ error: "radio session ownership required" }), "application/json");
      }

      if (pathname === "/api/radio/heartbeat") {
        member.name = String(body.userName || member.name || userId).slice(0, 80);
        member.lastSeen = now;
        return send(res, 200, JSON.stringify(radioSnapshot(channel, userId, member.sessionToken)), "application/json");
      }

      if (pathname === "/api/radio/leave") {
        channel.members.delete(userId);
        if (channel.speaker?.userId === userId && body.leaseId === channel.speaker.leaseId) channel.speaker = null;
        if (!channel.members.size && !channel.speaker) radioChannels.delete(channelId);
        return send(res, 200, JSON.stringify({ ok: true }), "application/json");
      }

      if (pathname === "/api/radio/floor/acquire") {
        if (!channel.speaker || channel.speaker.userId === userId) {
          channel.speaker = {
            userId,
            userName: member.name,
            leaseId: channel.speaker?.leaseId || randomUUID(),
            acquiredAt: channel.speaker?.acquiredAt || now,
            expiresAt: now + RADIO_FLOOR_TTL_MS,
          };
          return send(res, 200, JSON.stringify({ granted: true, speaker: channel.speaker }), "application/json");
        }
        return send(res, 200, JSON.stringify({ granted: false, speaker: channel.speaker }), "application/json");
      }

      if (pathname === "/api/radio/floor/release") {
        const authorized = channel.speaker?.userId === userId && channel.speaker?.leaseId === String(body.leaseId || "");
        if (authorized) channel.speaker = null;
        return send(res, 200, JSON.stringify({ released: authorized }), "application/json");
      }
    }

    if (pathname === "/api/rag/docs" && req.method === "GET") {
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          docs: listRagDocs(),
          updatedAt: Number(ragStore.updatedAt || 0),
          embedModel: String(ragStore.embedModel || "nomic-embed-text"),
        }),
        "application/json"
      );
    }

    if (pathname === "/api/rag/docs" && req.method === "POST") {
      const body = await readJson(req);
      const title = String(body.title || "").trim() || "Knowledge Note";
      const content = String(body.content || "");
      if (!normalizeRagText(content)) {
        return send(res, 400, JSON.stringify({ ok: false, error: "Knowledge text is empty." }), "application/json");
      }
      const doc = await addRagDoc(title, content, body.model);
      return send(res, 200, JSON.stringify({ ok: true, doc }), "application/json");
    }

    if (pathname === "/api/rag/docs" && req.method === "DELETE") {
      clearRagDocs();
      return send(res, 200, JSON.stringify({ ok: true }), "application/json");
    }

    if (pathname.startsWith("/api/rag/docs/") && req.method === "DELETE") {
      const docId = decodeURIComponent(pathname.slice("/api/rag/docs/".length));
      if (!docId) {
        return send(res, 400, JSON.stringify({ ok: false, error: "Missing document id." }), "application/json");
      }
      removeRagDoc(docId);
      return send(res, 200, JSON.stringify({ ok: true, docId }), "application/json");
    }

    if (pathname === "/api/rag/query" && req.method === "POST") {
      const body = await readJson(req);
      const query = String(body.query || "");
      if (!normalizeRagText(query)) {
        return send(res, 400, JSON.stringify({ ok: false, error: "Query is required." }), "application/json");
      }
      const result = await buildRagContext(query, {
        topK: body.topK,
        minScore: body.minScore,
        model: body.model,
      });
      return send(res, 200, JSON.stringify({ ok: true, result }), "application/json");
    }

    if (pathname === "/api/webrtc/config") {
      const cfg = getWebRtcConfig();
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          ...cfg,
        }),
        "application/json"
      );
    }

    if (pathname === "/api/accounting/usage/record" && req.method === "POST") {
      const body = await readJson(req);
      const payload = {
        nodeId: String(body.nodeId || "").trim(),
        serviceId: String(body.serviceId || "").trim(),
        units: Number(body.units || 0),
        amountCredited: Number(body.amountCredited || 0),
        currency: String(body.currency || "usage_credits"),
        executed: !!body.executed,
        peerId: String(body.peerId || ""),
        ts: Number(body.ts || Date.now()),
        nonce: String(body.nonce || ""),
      };
      if (!payload.nodeId || !payload.serviceId || !Number.isFinite(payload.units) || payload.units <= 0) {
        return send(res, 400, JSON.stringify({ ok: false, error: "invalid usage payload" }), "application/json");
      }
      const expectedHash = hashReceiptPayload(payload);
      const clientHash = String(body.receiptHash || "");
      const verified = clientHash && clientHash === expectedHash;
      const entry = {
        id: `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        ...payload,
        receiptHash: clientHash || expectedHash,
        verified,
        recordedAt: Date.now(),
      };
      appendUsageEntry(entry);
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          entryId: entry.id,
          verified,
          nodeBalance: Number(usageLedger.balancesByNode[payload.nodeId] || 0),
        }),
        "application/json"
      );
    }

    if (pathname === "/api/accounting/usage/summary") {
      const nodeId = String(url.searchParams.get("nodeId") || "").trim();
      const entries = nodeId
        ? usageLedger.entries.filter((e) => e.nodeId === nodeId).slice(0, 200)
        : usageLedger.entries.slice(0, 200);
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          nodeId: nodeId || null,
          balance: nodeId ? Number(usageLedger.balancesByNode[nodeId] || 0) : null,
          balancesByNode: nodeId ? undefined : usageLedger.balancesByNode,
          totalEntries: usageLedger.entries.length,
          updatedAt: usageLedger.updatedAt || 0,
          entries,
        }),
        "application/json"
      );
    }

    // ── PSTN: virtual GridCaller number → real cellular ──
    if (pathname === "/api/pstn/status") {
      const cfg = getPstnConfig();
      return send(
        res,
        200,
        JSON.stringify({
          ...cfg,
          capability: {
            freeMeshNeedsApp: true,
            pstnAnyNumber: !!cfg.configured,
            handsetNeedsGridAlive: false,
            smsAnyNumber: !!cfg.configured,
          },
        }),
        "application/json"
      );
    }

    if (pathname === "/api/pstn/normalize" && req.method === "POST") {
      const body = await readJson(req);
      return send(
        res,
        200,
        JSON.stringify({ ok: true, permutations: phonePermutations(body.to || body.number || "") }),
        "application/json"
      );
    }

    if (pathname === "/api/pstn/call" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const result = await placeOutboundCall({
          to: body.to,
          message: body.message,
          callerName: body.callerName || body.virtualFrom || "GridCaller",
        });
        return send(res, result.ok ? 200 : 500, JSON.stringify(result), "application/json");
      } catch (e) {
        return send(
          res,
          500,
          JSON.stringify({ ok: false, error: e?.message || "pstn call failed" }),
          "application/json"
        );
      }
    }

    if (pathname === "/api/pstn/sms" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const result = await placeOutboundSms({
          to: body.to,
          body: body.body || body.text || body.message,
          fromName: body.fromName || body.callerName || body.virtualFrom || "GridCaller",
        });
        return send(res, result.ok ? 200 : 500, JSON.stringify(result), "application/json");
      } catch (e) {
        return send(
          res,
          500,
          JSON.stringify({ ok: false, error: e?.message || "pstn sms failed" }),
          "application/json"
        );
      }
    }

    // ── GridAlive mesh HTTP APIs (same as GridAlive server) ──
    function digitsOnly(s) {
      return String(s || "").replace(/\D/g, "");
    }
    function upsertPeer(body) {
      const id = String(body.id || body.from || "").trim();
      if (!id) return null;
      const prev = httpMeshPeers.get(id) || {};
      const name = body.name || body.fromName || prev.name || id;
      let handle = String(body.handle || prev.handle || "")
        .trim()
        .replace(/^@/, "");
      const phone = digitsOnly(body.phone || prev.phone || "");
      // If user saved phone as their number, also index as handle (last 10)
      if (!handle && phone.length >= 10) handle = phone.slice(-10);
      const row = {
        id,
        name,
        handle: handle || undefined,
        phone: phone || undefined,
        displayNumber: body.displayNumber || prev.displayNumber || handle || phone || undefined,
        hasLlm: !!(body.hasLlm ?? prev.hasLlm),
        lastSeen: Date.now(),
      };
      httpMeshPeers.set(id, row);
      // Dedupe: one live identity per phone / handle — drop older ids
      const phone10 = phone.length >= 10 ? phone.slice(-10) : "";
      const handle10 = handle && digitsOnly(handle).length >= 10 ? digitsOnly(handle).slice(-10) : handle;
      for (const [oid, op] of httpMeshPeers) {
        if (oid === id || oid === "hub-pc") continue;
        const oPhone = digitsOnly(op.phone || "").slice(-10);
        const oHandle = String(op.handle || "").replace(/^@/, "");
        const oHandle10 = digitsOnly(oHandle).length >= 10 ? digitsOnly(oHandle).slice(-10) : oHandle;
        const samePhone = phone10 && oPhone && phone10 === oPhone;
        const sameHandle =
          handle &&
          oHandle &&
          (oHandle.toLowerCase() === handle.toLowerCase() ||
            (handle10 && oHandle10 && handle10 === oHandle10));
        if (samePhone || sameHandle) {
          // Keep whichever is fresher; we just wrote id so remove oid
          httpMeshPeers.delete(oid);
        }
      }
      return row;
    }
    function resolvePeerQuery(q) {
      const raw = String(q || "").trim();
      if (!raw) return null;
      const dig = digitsOnly(raw);
      const handle = raw.replace(/^@/, "").toLowerCase();
      const now = Date.now();
      const live = [...httpMeshPeers.values()]
        .filter((p) => now - p.lastSeen < 120000 && p.id !== "hub-pc")
        .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)); // newest first
      // exact id
      let hit = live.find((p) => p.id === raw);
      if (hit) return hit;
      // All candidates matching handle/phone — pick newest
      const candidates = [];
      for (const p of live) {
        const pHandle = String(p.handle || "")
          .replace(/^@/, "")
          .toLowerCase();
        const pPhone = digitsOnly(p.phone || "");
        const pDisp = digitsOnly(p.displayNumber || "");
        if (pHandle && (pHandle === handle || (dig.length >= 10 && pHandle.slice(-10) === dig.slice(-10)))) {
          candidates.push(p);
          continue;
        }
        if (dig.length >= 10) {
          if (pPhone && pPhone.slice(-10) === dig.slice(-10)) {
            candidates.push(p);
            continue;
          }
          if (pDisp && pDisp.slice(-10) === dig.slice(-10)) {
            candidates.push(p);
            continue;
          }
        }
        if (p.name && p.name.toLowerCase() === handle) candidates.push(p);
      }
      if (candidates.length) {
        candidates.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        return candidates[0];
      }
      return null;
    }

    if (pathname === "/api/mesh/register" && req.method === "POST") {
      const body = await readJson(req);
      const id = body.id;
      if (!id) return send(res, 400, JSON.stringify({ error: "id required" }), "application/json");
      const row = upsertPeer(body);
      // Announce so other phones handshake via poll
      meshBusPush({
        type: "PEER_HELLO",
        from: id,
        fromName: row?.name || id,
        time: Date.now(),
        data: {
          id,
          name: row?.name,
          handle: row?.handle,
          phone: row?.phone,
          displayNumber: row?.displayNumber,
        },
      });
      meshBroadcast({
        type: "PEER_ANNOUNCE",
        from: id,
        fromName: row?.name || id,
        data: row,
      });
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          peers: httpMeshPeers.size,
          me: row,
          others: [...httpMeshPeers.values()]
            .filter((p) => p.id !== id && Date.now() - p.lastSeen < 120000)
            .map((p) => ({
              id: p.id,
              name: p.name,
              handle: p.handle,
              phone: p.phone,
              lastSeen: p.lastSeen,
            })),
        }),
        "application/json"
      );
    }

    if (pathname === "/api/mesh/resolve") {
      const q = url.searchParams.get("q") || url.searchParams.get("to") || "";
      const hit = resolvePeerQuery(q);
      return send(
        res,
        200,
        JSON.stringify({
          ok: !!hit,
          peer: hit,
          peers: [...httpMeshPeers.values()].filter((p) => Date.now() - p.lastSeen < 120000),
        }),
        "application/json"
      );
    }

    if (pathname === "/api/mesh/peers") {
      const now = Date.now();
      for (const [id, p] of httpMeshPeers) {
        if (now - p.lastSeen > 120000 && id !== "hub-pc") httpMeshPeers.delete(id);
      }
      // keep hub-pc alive
      httpMeshPeers.set("hub-pc", {
        ...(httpMeshPeers.get("hub-pc") || {}),
        id: "hub-pc",
        name: "PC Hub",
        hasLlm: true,
        lastSeen: now,
      });
      return send(
        res,
        200,
        JSON.stringify({
          peers: [...httpMeshPeers.keys()],
          details: [...httpMeshPeers.values()],
          meshWsClients: meshClients.size,
        }),
        "application/json"
      );
    }

    if (pathname === "/api/mesh/publish" && req.method === "POST") {
      const msg = await readJson(req);
      if (!msg || !msg.type) {
        return send(res, 400, JSON.stringify({ error: "invalid message" }), "application/json");
      }
      // Fan-out on WebSocket bus + durable HTTP bus (for APK without WS)
      meshRoute(msg);
      const seq = meshBusPush(msg);
      if (msg.from) {
        upsertPeer({
          id: msg.from,
          name: msg.fromName || msg.from,
          handle: msg.data?.handle,
          phone: msg.data?.phone,
          displayNumber: msg.data?.displayNumber,
        });
      }
      return send(
        res,
        200,
        JSON.stringify({ ok: true, clients: meshClients.size, seq, busLen: meshBus.length }),
        "application/json"
      );
    }

    // Long-poll style fetch: GET /api/mesh/poll?after=SEQ&id=MY_ID
    // PRIORITY: call signals never buried under GPS/beacon spam
    if (pathname === "/api/mesh/poll") {
      const after = Number(url.searchParams.get("after") || "0") || 0;
      const myId = String(url.searchParams.get("id") || "");
      const myHandle = String(url.searchParams.get("handle") || "").replace(/^@/, "");
      const myPhone = digitsOnly(url.searchParams.get("phone") || "");
      const isPrio = (t) =>
        /OFFER|ANSWER|ICE|RING|HANGUP|RENEGOTIATE|CALL|PEER_HELLO|PEER_ANNOUNCE|GRIDCALLER_SMS|AM_HELLO/i.test(
          String(t || "")
        );
      // CRITICAL: call signals (RING/OFFER/ANSWER/ICE/HANGUP) go to ALL peers
      // except sender. Client filters "to" — hub must NEVER drop offers (stale to = silent fail).
      const pending = [];
      for (const e of meshBus) {
        if (e.seq <= after) continue;
        if (myId && e.msg?.from === myId) continue;
        pending.push(e);
      }
      const isCallSig = (t) =>
        /GRIDCALLER_OFFER|GRIDCALLER_ANSWER|GRIDCALLER_ICE|GRIDCALLER_RING|GRIDCALLER_HANGUP|RENEGOTIATE/i.test(
          String(t || "")
        );
      const callMsgs = pending.filter((e) => isCallSig(e.msg?.type));
      const hi = pending.filter((e) => isPrio(e.msg?.type) && !isCallSig(e.msg?.type));
      const lo = pending.filter((e) => !isPrio(e.msg?.type));
      const loNewest = lo.slice(-20);
      // Call signals ALWAYS first and complete — never truncated
      const batch = [...callMsgs, ...hi, ...loNewest].sort((a, b) => a.seq - b.seq);
      // touch presence (keep handle/phone)
      if (myId) {
        const prev = httpMeshPeers.get(myId) || {};
        upsertPeer({
          id: myId,
          name: prev.name || myId,
          handle: myHandle || prev.handle,
          phone: myPhone || prev.phone,
          displayNumber: prev.displayNumber,
          hasLlm: prev.hasLlm,
        });
      }
      const latest = meshSeq - 1;
      const maxBatchSeq = batch.length ? Math.max(...batch.map((e) => e.seq)) : after;
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          after,
          latest,
          // Only advance past what we actually sent (never skip undelivered OFFER)
          advanceTo: Math.max(after, maxBatchSeq),
          messages: batch.map((e) => ({ seq: e.seq, msg: e.msg, ts: e.ts })),
          peers: [...httpMeshPeers.values()]
            .filter((p) => Date.now() - p.lastSeen < 120000)
            .map((p) => ({
              id: p.id,
              name: p.name,
              handle: p.handle,
              phone: p.phone,
              displayNumber: p.displayNumber,
              lastSeen: p.lastSeen,
            })),
        }),
        "application/json"
      );
    }

    // Health / mesh status
    if (pathname === "/api/health") {
      const gh = await ghAvailable();
      const rtc = getWebRtcConfig();
      const ver = readAppVersion();
      const apk = primaryApkMeta();
      // PC hub counts as a mesh node
      const now = Date.now();
      httpMeshPeers.set("hub-pc", {
        id: "hub-pc",
        name: "PC Hub",
        hasLlm: true,
        lastSeen: now,
      });
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          app: "gridcaller-hub",
          real: true,
          port: PORT,
          peerPort: PEER_PORT,
          peerPath: "/gridcaller",
          lan: lanIPs(),
          version: ver,
          apk,
          rooms: [...rooms.entries()].map(([id, m]) => ({
            room: id,
            peers: m.size,
            list: roomPeers(id),
          })),
          share: listShareFiles(),
          gh,
          workDir: defaultWorkDir(),
          meshWs: "/mesh-ws",
          meshPeers: [...meshClients.entries()].map(([id, c]) => ({
            id,
            name: c.name,
          })),
          httpMeshPeers: [...httpMeshPeers.values()],
          meshBusLen: meshBus.length,
          webrtc: {
            configuredTurn: rtc.configuredTurn,
            iceServers: rtc.iceServers.map((s) => ({ urls: s.urls })),
          },
          usageLedger: {
            entries: usageLedger.entries.length,
            updatedAt: usageLedger.updatedAt || 0,
          },
          stack: [
            "gridalive-mesh-ws",
            "websocket-signal",
            "peerjs",
            "trystero-client",
            "gun-client",
            "gh-bridge",
            "ota-push",
            "resilient-mesh",
          ],
        }),
        "application/json"
      );
    }

    // ── OTA: phones poll this; PC can force push ──
    if (pathname === "/api/update/check") {
      const ver = readAppVersion();
      const apk = primaryApkMeta();
      const clientCode = Number(url.searchParams.get("code") || 0);
      const ips = lanIPs();
      const host = ips[0] || "127.0.0.1";
      const apkUrl = apk
        ? `http://${host}:${PORT}${apk.url}`
        : `http://${host}:${PORT}/share/GridCaller.apk`;
      const available = ver.versionCode > clientCode;
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          available,
          versionCode: ver.versionCode,
          versionName: ver.versionName,
          force: ver.force,
          notes: ver.notes,
          apkUrl,
          size: apk?.size,
          mtime: apk?.mtime,
          localCode: clientCode,
        }),
        "application/json"
      );
    }

    if (pathname === "/api/update/push" && req.method === "POST") {
      let body = {};
      try {
        body = await readJson(req);
      } catch {}
      const r = pushUpdateToMesh(body?.force !== false);
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          pushed: true,
          seq: r.seq,
          version: r.ver,
          apkUrl: r.apkUrl,
          meshWsClients: r.clients,
          httpPeers: httpMeshPeers.size,
          note: "Phones on mesh will open Install if version is newer",
        }),
        "application/json"
      );
    }

    if (pathname === "/api/update/version" && req.method === "POST") {
      const body = await readJson(req);
      const out = {
        versionCode: Number(body.versionCode || body.code || 0),
        versionName: String(body.versionName || body.name || "0"),
        force: !!body.force,
        notes: body.notes || "",
        updatedAt: Date.now(),
      };
      fs.writeFileSync(path.join(SHARE, "version.json"), JSON.stringify(out, null, 2));
      return send(res, 200, JSON.stringify({ ok: true, version: out }), "application/json");
    }

    // Share catalog (APK / files for BT-style WiFi transfer)
    if (pathname === "/api/share/list") {
      return send(res, 200, JSON.stringify({ ok: true, files: listShareFiles() }), "application/json");
    }

    // Download shared file (WiFi share)
    if (pathname.startsWith("/share/")) {
      const name = decodeURIComponent(pathname.slice("/share/".length));
      const file = path.join(SHARE, path.basename(name));
      if (!file.startsWith(SHARE) || !fs.existsSync(file)) {
        return send(res, 404, "File not found");
      }
      const data = fs.readFileSync(file);
      return send(res, 200, data, mime(file), {
        "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
        "Content-Length": String(data.length),
      });
    }

    // Upload file into share/ (from PC or bridge)
    if (pathname === "/api/share/upload" && req.method === "POST") {
      const name = path.basename(url.searchParams.get("name") || `file-${Date.now()}.bin`);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      const dest = path.join(SHARE, name);
      fs.writeFileSync(dest, buf);
      return send(
        res,
        200,
        JSON.stringify({ ok: true, name, size: buf.length, url: `/share/${encodeURIComponent(name)}` }),
        "application/json"
      );
    }

    // GitHub
    if (process.env.ENABLE_GH_BRIDGE === "1") {
          if (pathname === "/api/gh/status") {
            const avail = await ghAvailable();
            const auth = avail.ok ? await ghAuthStatus() : { ok: false, out: "gh missing" };
            return send(res, 200, JSON.stringify({ ok: true, avail, auth, workDir: defaultWorkDir() }), "application/json");
          }
      
          if (pathname === "/api/gh/run" && req.method === "POST") {
            const body = await readJson(req);
            const args = body.args;
            if (!Array.isArray(args)) return send(res, 400, JSON.stringify({ ok: false, error: "args[] required" }), "application/json");
            // whitelist first token
            const allowed = new Set([
              "auth", "repo", "pr", "issue", "release", "api", "browse", "status", "gist", "run", "workflow", "label", "search",
            ]);
            if (!allowed.has(String(args[0]))) {
              return send(res, 400, JSON.stringify({ ok: false, error: "gh subcommand not allowed" }), "application/json");
            }
            try {
              const r = await runGh(args, { cwd: body.cwd, timeout: body.timeout });
              return send(res, 200, JSON.stringify(r), "application/json");
            } catch (e) {
              return send(
                res,
                500,
                JSON.stringify({ ok: false, error: e?.message, stderr: String(e?.stderr || "") }),
                "application/json"
              );
            }
          }
      
          if (pathname === "/api/gh/clone" && req.method === "POST") {
            const body = await readJson(req);
            if (!body.repo) return send(res, 400, JSON.stringify({ ok: false, error: "repo required" }), "application/json");
            try {
              const r = await cloneOrPull(body.repo, body.name);
              return send(res, 200, JSON.stringify(r), "application/json");
            } catch (e) {
              return send(res, 500, JSON.stringify({ ok: false, error: e?.message }), "application/json");
            }
          }
      
          if (pathname === "/api/gh/push" && req.method === "POST") {
            const body = await readJson(req);
            const r = await pushRepo(body.cwd || defaultWorkDir(), body.message);
            return send(res, r.ok ? 200 : 500, JSON.stringify(r), "application/json");
          }
      
          if (pathname === "/api/gh/repos") {
            const list = await listHubRepos();
            return send(res, 200, JSON.stringify({ ok: true, workDir: defaultWorkDir(), repos: list }), "application/json");
          }
      
      
    }

    // GridAlive bridge — register package / list transfers
    if (pathname === "/api/bridge/manifest" && req.method === "POST") {
      const body = await readJson(req);
      const id = `xfer_${Date.now()}`;
      const manifest = {
        id,
        ts: Date.now(),
        from: body.from || "unknown",
        kind: body.kind || "gridalive-bundle",
        name: body.name || "GridAlive",
        files: body.files || [],
        note: body.note || "",
        source: body.source || "mesh",
      };
      fs.writeFileSync(path.join(TRANSFER, `${id}.json`), JSON.stringify(manifest, null, 2));
      // notify all rooms
      for (const roomId of rooms.keys()) {
        broadcast(roomId, null, { type: "bridge", action: "manifest", manifest });
      }
      return send(res, 200, JSON.stringify({ ok: true, manifest }), "application/json");
    }

    if (pathname === "/api/bridge/list") {
      const files = fs
        .readdirSync(TRANSFER)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(TRANSFER, f), "utf8")))
        .sort((a, b) => b.ts - a.ts);
      return send(res, 200, JSON.stringify({ ok: true, transfers: files }), "application/json");
    }

    // Config for clients (PeerJS host etc)
    if (pathname === "/api/config") {
      const ips = lanIPs();
      const host = ips[0] || "127.0.0.1";
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          signalWs: `ws://${host}:${PORT}/ws`,
          peer: {
            host,
            port: PEER_PORT,
            path: "/gridcaller",
            secure: false,
            key: "peerjs",
          },
          http: `http://${host}:${PORT}`,
          roomDefault: "gridcaller",
          appId: "gridcaller-mesh-v2",
        }),
        "application/json"
      );
    }

    // Static UI
    let rel = pathname === "/" ? "/index.html" : pathname;
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const file = path.join(DIST, rel);
    if (fs.existsSync(DIST) && file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), mime(file));
    }

    if (pathname === "/" || pathname === "/index.html") {
      return send(
        res,
        200,
        `<!doctype html><html><body style="font-family:system-ui;background:#0b141a;color:#e9edef;padding:24px">
        <h1>GridCaller REAL Hub</h1>
        <p>Build UI: <code>npm run build</code></p>
        <pre>${JSON.stringify({ lan: lanIPs(), port: PORT, peerPort: PEER_PORT }, null, 2)}</pre>
        </body></html>`,
        "text/html; charset=utf-8"
      );
    }

    send(res, 404, "Not found");
  } catch (e) {
    send(res, 500, JSON.stringify({ ok: false, error: e?.message || String(e) }), "application/json");
  }
});

// ── Legacy room /ws (kept) ─────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

// ── GridAlive REAL mesh bus: /mesh-ws (same protocol as GridAlive server) ──
const meshWss = new WebSocketServer({ noServer: true });

// A single HTTP server cannot safely use multiple path-bound ws servers: each
// upgrade listener can reject another server's path with HTTP 400. Route once.
server.on("upgrade", (request, socket, head) => {
  let pathname = "";
  try {
    pathname = new URL(request.url || "/", "http://localhost").pathname;
  } catch {}
  const target = pathname === "/mesh-ws" ? meshWss : pathname === "/ws" ? wss : null;
  if (!target) {
    socket.destroy();
    return;
  }
  target.handleUpgrade(request, socket, head, (ws) => {
    target.emit("connection", ws, request);
  });
});

meshBroadcast = function meshBroadcastImpl(payload, exceptId = null) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const [id, client] of meshClients) {
    if (id === exceptId) continue;
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(raw);
      } catch {}
    }
  }
};

meshRoute = function meshRouteImpl(payload, exceptId = null) {
  const targetId = payload?.nextHop || payload?.to;
  if (targetId && meshClients.has(targetId)) {
    const target = meshClients.get(targetId);
    if (targetId !== exceptId && target?.ws?.readyState === 1) {
      try {
        target.ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
        return true;
      } catch {}
    }
  }
  if (targetId) return false;
  meshBroadcast(payload, exceptId);
  return true;
};

meshWss.on("connection", (ws) => {
  let peerId = null;

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }

    if (msg.type === "HELLO" || msg.type === "REGISTER") {
      peerId = msg.id || msg.data?.id || peerId;
      if (!peerId) return;
      const name = msg.name || msg.data?.name || peerId;
      const hasLlm = !!(msg.hasLlm ?? msg.data?.hasLlm);
      meshClients.set(peerId, { ws, name, hasLlm, lastSeen: Date.now() });
      try {
        ws.send(
          JSON.stringify({
            type: "WELCOME",
            id: "server",
            data: {
              peers: [...meshClients.entries()]
                .filter(([id]) => id !== peerId)
                .map(([id, c]) => ({ id, name: c.name, hasLlm: c.hasLlm })),
            },
            ts: Date.now(),
          })
        );
      } catch {}
      meshBroadcast(
        {
          type: "PEER_ANNOUNCE",
          id: `ann_${Date.now()}`,
          from: peerId,
          fromName: name,
          data: { id: peerId, name, hasLlm },
          ts: Date.now(),
          hops: 0,
          ttl: 8,
        },
        peerId
      );
      return;
    }

    if (msg.from) {
      peerId = peerId || msg.from;
      const existing = meshClients.get(peerId);
      if (existing) {
        existing.lastSeen = Date.now();
        existing.name = msg.fromName || existing.name;
        existing.ws = ws;
      } else if (peerId) {
        meshClients.set(peerId, {
          ws,
          name: msg.fromName || peerId,
          hasLlm: false,
          lastSeen: Date.now(),
        });
      }
    }

    meshRoute(msg, peerId);
  });

  ws.on("close", () => {
    if (peerId) {
      meshClients.delete(peerId);
      meshBroadcast({
        type: "PEER_LEAVE",
        id: `leave_${Date.now()}`,
        from: peerId,
        data: { id: peerId },
        ts: Date.now(),
        hops: 0,
        ttl: 4,
      });
    }
  });
});

wss.on("connection", (ws) => {
  let roomId = null;
  let peerId = null;

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }

    if (msg.type === "join") {
      roomId = String(msg.room || "gridcaller").slice(0, 64);
      peerId = String(msg.peerId || `p_${Date.now()}`).slice(0, 80);
      const name = String(msg.name || "Peer").slice(0, 40);
      const role = String(msg.role || "node").slice(0, 20);
      const transports = Array.isArray(msg.transports) ? msg.transports : ["ws"];

      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      const m = rooms.get(roomId);
      const prev = m.get(peerId);
      if (prev?.ws && prev.ws !== ws) {
        try {
          prev.ws.close();
        } catch {}
      }
      m.set(peerId, { ws, name, role, transports, joinedAt: Date.now() });

      ws.send(
        JSON.stringify({
          type: "joined",
          room: roomId,
          peerId,
          peers: roomPeers(roomId).filter((p) => p.id !== peerId),
          hub: {
            peerPort: PEER_PORT,
            peerPath: "/gridcaller",
            share: listShareFiles().slice(0, 20),
          },
        })
      );
      broadcast(roomId, peerId, {
        type: "peer-join",
        peer: { id: peerId, name, role, transports },
      });
      return;
    }

    if (!roomId || !peerId) return;

    // Relay: signal / chat / call / bridge / file-chunk / presence
    const relayTypes = new Set(["signal", "chat", "call", "presence", "bridge", "file", "peer-hello"]);
    if (relayTypes.has(msg.type)) {
      const target = msg.to;
      const packet = { ...msg, from: peerId, ts: Date.now() };
      const m = rooms.get(roomId);
      if (!m) return;
      if (target && m.has(target)) {
        const t = m.get(target);
        if (t.ws.readyState === 1) t.ws.send(JSON.stringify(packet));
      } else if (!target) {
        broadcast(roomId, peerId, packet);
      }
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
    }
  });

  ws.on("close", () => {
    if (!roomId || !peerId) return;
    const m = rooms.get(roomId);
    if (!m) return;
    const cur = m.get(peerId);
    if (cur?.ws === ws) {
      m.delete(peerId);
      broadcast(roomId, peerId, { type: "peer-leave", peerId });
      if (m.size === 0) rooms.delete(roomId);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanIPs();
  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("  GridCaller REAL Mesh Hub");
  console.log("══════════════════════════════════════════════════");
  console.log(`  HTTP/WS : ${PORT}`);
  console.log(`  MeshWS  : /mesh-ws  (GridAlive real MeshEngine protocol)`);
  console.log(`  PeerJS  : ${PEER_PORT}  path /gridcaller`);
  console.log(`  Share   : ${SHARE}  (drop APK here)`);
  console.log(`  Hub work: ${defaultWorkDir()}`);
  console.log(`  Health  : http://127.0.0.1:${PORT}/api/health`);
  if (ips.length) {
    console.log("  Phone / mesh:");
    for (const ip of ips) {
      console.log(`    UI      http://${ip}:${PORT}/`);
      console.log(`    MeshWS  ws://${ip}:${PORT}/mesh-ws`);
      console.log(`    PeerJS  ${ip}:${PEER_PORT}`);
      console.log(`    APK     http://${ip}:${PORT}/api/share/list`);
    }
  }
  console.log("══════════════════════════════════════════════════");
  console.log("");
});
