/**
 * Free Radio Mesh — software "radio call" channel (no SIM · no carrier · no cloud track)
 *
 * Honest physics:
 *  · True VHF/UHF/LoRa free-spectrum RF needs radio hardware (future plug-in).
 *  · This mode uses your devices as the radio path: Wi‑Fi / Hotspot / LAN mesh-ws
 *    — same idea as a walkie network, but over free local mesh fabric.
 *  · No public Gun, no STUN/TURN cloud, no phone-company identity.
 *  · Channel passphrase encrypts frames (AES-GCM) so mesh hops / logs can't read.
 *  · Ephemeral radio IDs — not your carrier MSISDN.
 */

import { S } from "./storage";
import { MeshEngine } from "./mesh";
import { setForceLocalMesh } from "./offlineMode";
import { bus } from "./bus";

const CH_KEY = "gc_radio_channel";
const SECRET_KEY = "gc_radio_secret";
const RADIO_ON_KEY = "gc_radio_mode";
const RADIO_ID_KEY = "gc_radio_id";

export type RadioPeer = {
  id: string;
  name: string;
  ts: number;
  live?: boolean;
};

export type RadioTextMsg = {
  id: string;
  from: string;
  fromName: string;
  channel: string;
  text: string;
  ts: number;
};

type Listener = () => void;

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string, channel: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(secret || "gridcaller-radio"), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(`gridcaller-radio-v1:${channel}`),
      iterations: 100000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

class FreeRadioMesh {
  private channel = S.get(CH_KEY, "grid-ch-1") || "grid-ch-1";
  private secret = S.get(SECRET_KEY, "gridcaller-free") || "gridcaller-free";
  private on = S.get(RADIO_ON_KEY, true) === true;
  private radioId =
    S.get(RADIO_ID_KEY, "") ||
    (() => {
      const id = `radio_${Math.random().toString(36).slice(2, 10)}`;
      S.set(RADIO_ID_KEY, id);
      return id;
    })();
  private name = S.get("user_name", "Operator") || "Operator";
  private cryptoKey: CryptoKey | null = null;
  private peers = new Map<string, RadioPeer>();
  private texts: RadioTextMsg[] = [];
  private listeners = new Set<Listener>();
  private hooked = false;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private pttRecorder: MediaRecorder | null = null;
  private pttChunks: Blob[] = [];

  get enabled() {
    return this.on;
  }
  get channelName() {
    return this.channel;
  }
  get radioNodeId() {
    return this.radioId;
  }
  get messages() {
    return this.texts.slice(-200);
  }
  get peerList(): RadioPeer[] {
    const now = Date.now();
    return [...this.peers.values()]
      .map((p) => ({ ...p, live: now - p.ts < 25000 }))
      .sort((a, b) => b.ts - a.ts);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }

  async enable(on: boolean) {
    this.on = on;
    S.set(RADIO_ON_KEY, on);
    if (on) {
      // Radio doctrine: never cloud track
      setForceLocalMesh(true);
      await this.ensureKey();
      this.hookMesh();
      this.startBeacon();
      this.beacon();
    } else {
      this.stopBeacon();
    }
    bus.emit("radioMesh:mode", { on });
    this.emit();
  }

  async setChannel(channel: string, secret?: string) {
    this.channel = (channel || "grid-ch-1").trim().slice(0, 48);
    S.set(CH_KEY, this.channel);
    if (secret !== undefined) {
      this.secret = secret || "gridcaller-free";
      S.set(SECRET_KEY, this.secret);
    }
    this.cryptoKey = null;
    await this.ensureKey();
    this.peers.clear();
    this.beacon();
    this.emit();
  }

  setOperatorName(name: string) {
    this.name = (name || "Operator").trim().slice(0, 32);
    this.beacon();
    this.emit();
  }

  /** New ephemeral radio identity (harder to long-term track) */
  rotateRadioId() {
    this.radioId = `radio_${Math.random().toString(36).slice(2, 10)}`;
    S.set(RADIO_ID_KEY, this.radioId);
    this.beacon();
    this.emit();
    return this.radioId;
  }

  private async ensureKey() {
    if (!this.cryptoKey) {
      this.cryptoKey = await deriveKey(this.secret, this.channel);
    }
    return this.cryptoKey;
  }

  private async seal(payload: object): Promise<string> {
    const key = await this.ensureKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload))
    );
    // iv + ciphertext
    const combined = new Uint8Array(iv.length + enc.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(enc), iv.length);
    return b64(combined.buffer);
  }

  private async open(blob: string): Promise<any | null> {
    try {
      const key = await this.ensureKey();
      const raw = unb64(blob);
      const iv = raw.slice(0, 12);
      const data = raw.slice(12);
      const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
      return JSON.parse(new TextDecoder().decode(dec));
    } catch {
      return null; // wrong channel secret
    }
  }

  private hookMesh() {
    if (this.hooked) return;
    this.hooked = true;
    MeshEngine.onMessage((msg: any) => {
      if (!this.on) return;
      if (msg?.type !== "FREE_RADIO_FRAME") return;
      if (msg.from === this.radioId || msg.from === MeshEngine.localId) return;
      void this.onFrame(msg);
    });
    try {
      MeshEngine.start?.();
    } catch {}
  }

  private async onFrame(msg: any) {
    const sealed = msg.data?.sealed || msg.data?.cipher;
    if (!sealed) return;
    const body = await this.open(String(sealed));
    if (!body || body.channel !== this.channel) return;

    if (body.kind === "beacon") {
      this.peers.set(body.radioId, {
        id: body.radioId,
        name: body.name || body.radioId.slice(0, 8),
        ts: Date.now(),
      });
      this.emit();
      return;
    }

    if (body.kind === "text") {
      const row: RadioTextMsg = {
        id: body.id || `rt_${Date.now()}`,
        from: body.radioId,
        fromName: body.name || "Radio",
        channel: this.channel,
        text: String(body.text || ""),
        ts: body.ts || Date.now(),
      };
      if (!this.texts.some((t) => t.id === row.id)) {
        this.texts = [...this.texts, row].slice(-200);
        this.emit();
        bus.emit("radioMesh:text", row);
      }
      return;
    }

    if (body.kind === "voice" && body.audioB64) {
      bus.emit("radioMesh:voice", {
        from: body.radioId,
        name: body.name,
        mime: body.mime || "audio/webm",
        audioB64: body.audioB64,
        ts: body.ts || Date.now(),
      });
      // auto-play short PTT burst
      try {
        const bin = unb64(body.audioB64);
        const blob = new Blob([bin], { type: body.mime || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.play().catch(() => {});
        a.onended = () => URL.revokeObjectURL(url);
      } catch {}
      this.peers.set(body.radioId, {
        id: body.radioId,
        name: body.name || body.radioId.slice(0, 8),
        ts: Date.now(),
      });
      this.emit();
    }
  }

  private async sendFrame(inner: object) {
    if (!this.on) return false;
    const sealed = await this.seal({
      ...inner,
      channel: this.channel,
      radioId: this.radioId,
      name: this.name,
      ts: Date.now(),
    });
    MeshEngine.broadcast("FREE_RADIO_FRAME", {
      channel: this.channel,
      sealed,
      // no plaintext identity fields outside seal
    });
    return true;
  }

  private beacon() {
    void this.sendFrame({ kind: "beacon" });
  }

  private startBeacon() {
    this.stopBeacon();
    this.beaconTimer = setInterval(() => this.beacon(), 7000);
  }

  private stopBeacon() {
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    this.beaconTimer = null;
  }

  async sendText(text: string) {
    const t = text.trim();
    if (!t) return;
    const id = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await this.sendFrame({ kind: "text", id, text: t });
    const row: RadioTextMsg = {
      id,
      from: this.radioId,
      fromName: this.name,
      channel: this.channel,
      text: t,
      ts: Date.now(),
    };
    this.texts = [...this.texts, row].slice(-200);
    this.emit();
  }

  /** Push-to-talk start */
  async pttStart() {
    if (!this.on) throw new Error("Radio mode off");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.pttChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    this.pttRecorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) this.pttChunks.push(e.data);
    };
    rec.start(100);
  }

  /** Push-to-talk end → encrypt + mesh broadcast (radio burst) */
  async pttStop() {
    const rec = this.pttRecorder;
    if (!rec) return;
    const stream = rec.stream;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    this.pttRecorder = null;
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.pttChunks, { type: rec.mimeType || "audio/webm" });
    this.pttChunks = [];
    if (blob.size < 200) return;
    const buf = await blob.arrayBuffer();
    const audioB64 = b64(buf);
    await this.sendFrame({
      kind: "voice",
      mime: blob.type,
      audioB64,
    });
  }

  status() {
    return {
      on: this.on,
      channel: this.channel,
      radioId: this.radioId,
      peers: this.peerList.filter((p) => p.live).length,
      encrypted: true,
      cloud: false,
      sim: false,
      carrier: false,
      trackableByTelco: false,
      note: "Local free-mesh radio · AES channel · Wi‑Fi/hotspot path (no licensed RF hardware yet)",
    };
  }
}

export const freeRadio = new FreeRadioMesh();
export default freeRadio;
