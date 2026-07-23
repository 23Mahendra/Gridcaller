/**
 * REAL multi-transport mesh engine (no mocks)
 * ───────────────────────────────────────────
 * 1) WebSocket → local GridCaller hub (LAN / hotspot) — always
 * 2) PeerJS → real WebRTC DataConnection + MediaConnection (hub PeerServer)
 * 3) Trystero → swarm discovery when internet/trackers available
 * 4) Gun.js → presence graph (offline-first local + optional peers)
 *
 * Calls: WebRTC audio via PeerJS media OR raw RTCPeerConnection over WS signal
 * Chat: WS + PeerJS data (redundant real paths)
 */
import Peer, { type DataConnection, type MediaConnection } from "peerjs";
import { joinRoom, type Room } from "trystero";
import Gun from "gun/gun";
import {
  APP_ID,
  getDisplayName,
  getHubHttp,
  getPeerId,
  getRoom,
  getSignalUrl,
} from "./identity";
import { loadCalls, loadChats, saveCalls, saveChats, type CallLog, type ChatMsg } from "./store";
import { bridgeCapabilities } from "./bridge";

export type PeerInfo = {
  id: string;
  name: string;
  lastSeen: number;
  via: string[];
  role?: string;
};

export type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

export type ActiveCall = {
  peerId: string;
  peerName: string;
  state: CallState;
  direction: "in" | "out";
  startedAt: number;
  connectedAt?: number;
  muted: boolean;
  transport?: string;
};

type Listener = () => void;

const ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

class MeshEngine {
  peerId = getPeerId();
  name = getDisplayName();
  room = getRoom();
  signalUrl = getSignalUrl();
  hubHttp = getHubHttp();

  status: "offline" | "connecting" | "online" = "offline";
  transports = {
    ws: false,
    peerjs: false,
    trystero: false,
    gun: false,
  };
  peers = new Map<string, PeerInfo>();
  chats: ChatMsg[] = loadChats();
  callLogs: CallLog[] = loadCalls();
  call: ActiveCall | null = null;
  lastError = "";
  hubInfo: any = null;

  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;

  private ws: WebSocket | null = null;
  private peer: Peer | null = null;
  private dataConns = new Map<string, DataConnection>();
  private mediaCall: MediaConnection | null = null;
  private trystero: Room | null = null;
  private trySend: ((data: any, peerId?: string) => void) | null = null;
  private gun: any = null;
  private pc: RTCPeerConnection | null = null; // WS-signaled fallback
  private pendingIce: RTCIceCandidateInit[] = [];
  private listeners = new Set<Listener>();
  private reconnectTimer: number | null = null;
  private intentionalClose = false;
  private audioEl: HTMLAudioElement | null = null;

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

  refreshIdentity() {
    this.peerId = getPeerId();
    this.name = getDisplayName();
    this.room = getRoom();
    this.signalUrl = getSignalUrl();
    this.hubHttp = getHubHttp();
    this.emit();
  }

  attachRemoteAudio(el: HTMLAudioElement | null) {
    this.audioEl = el;
    if (el && this.remoteStream) {
      el.srcObject = this.remoteStream;
      el.play().catch(() => {});
    }
  }

  async connect() {
    this.refreshIdentity();
    this.intentionalClose = false;
    this.lastError = "";
    this.status = "connecting";
    this.emit();

    // Pull hub config (PeerJS host/port) if possible
    try {
      const r = await fetch(`${this.hubHttp}/api/config`);
      if (r.ok) this.hubInfo = await r.json();
    } catch {
      /* LAN may still work with defaults */
    }

    this.connectWs();
    void this.connectPeerJs();
    void this.connectTrystero();
    this.connectGun();
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {}
    try {
      this.peer?.destroy();
    } catch {}
    try {
      this.trystero?.leave();
    } catch {}
    this.ws = null;
    this.peer = null;
    this.trystero = null;
    this.dataConns.clear();
    this.transports = { ws: false, peerjs: false, trystero: false, gun: false };
    this.status = "offline";
    this.peers.clear();
    this.emit();
  }

  private setOnlineIfAny() {
    const any =
      this.transports.ws || this.transports.peerjs || this.transports.trystero || this.transports.gun;
    this.status = any ? "online" : this.intentionalClose ? "offline" : "connecting";
    this.emit();
  }

  // ─── WebSocket hub ───────────────────────────────────────────
  private connectWs() {
    try {
      this.ws?.close();
    } catch {}
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.signalUrl);
    } catch (e: any) {
      this.lastError = e?.message || "WS failed";
      this.scheduleReconnect();
      this.emit();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.transports.ws = true;
      this.setOnlineIfAny();
      ws.send(
        JSON.stringify({
          type: "join",
          room: this.room,
          peerId: this.peerId,
          name: this.name,
          role: "gridcaller",
          transports: ["ws", "peerjs", "trystero", "gun"],
          caps: bridgeCapabilities(),
        })
      );
    };

    ws.onmessage = (ev) => {
      try {
        this.onHubMessage(JSON.parse(String(ev.data)));
      } catch {}
    };

    ws.onerror = () => {
      this.lastError = "Hub WS error — PC pe `npm run hub` + same WiFi/hotspot?";
      this.emit();
    };

    ws.onclose = () => {
      this.transports.ws = false;
      this.setOnlineIfAny();
      if (!this.intentionalClose) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.intentionalClose) this.connectWs();
    }, 2500);
  }

  private wsSend(packet: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(packet));
      return true;
    }
    return false;
  }

  // ─── PeerJS ──────────────────────────────────────────────────
  private async connectPeerJs() {
    try {
      this.peer?.destroy();
    } catch {}

    const host =
      this.hubInfo?.peer?.host ||
      (() => {
        try {
          return new URL(this.hubHttp).hostname;
        } catch {
          return "127.0.0.1";
        }
      })();
    const port = this.hubInfo?.peer?.port || 9000;
    const path = this.hubInfo?.peer?.path || "/gridcaller";

    const peer = new Peer(this.peerId, {
      host,
      port,
      path,
      secure: false,
      debug: 1,
      config: { iceServers: ICE },
    });
    this.peer = peer;

    peer.on("open", () => {
      this.transports.peerjs = true;
      this.setOnlineIfAny();
      // announce via WS
      this.wsSend({
        type: "presence",
        peerjsId: peer.id,
        name: this.name,
      });
    });

    peer.on("connection", (conn) => this.hookDataConn(conn));

    peer.on("call", (media) => {
      // incoming PeerJS media call
      const from = media.peer;
      this.mediaCall = media;
      this.call = {
        peerId: from,
        peerName: this.peers.get(from)?.name || from.slice(0, 8),
        state: "incoming",
        direction: "in",
        startedAt: Date.now(),
        muted: false,
        transport: "peerjs-media",
      };
      this.emit();
      media.on("stream", (stream) => this.attachRemote(stream));
      media.on("close", () => this.endCall("media close"));
    });

    peer.on("error", (err) => {
      console.warn("[PeerJS]", err);
      // keep other transports; LAN PeerServer may be blocked
      if (!this.transports.ws) {
        this.lastError = `PeerJS: ${err.type || err.message || err}`;
      }
      this.emit();
    });
  }

  private hookDataConn(conn: DataConnection) {
    conn.on("open", () => {
      this.dataConns.set(conn.peer, conn);
      this.upsertPeer(conn.peer, conn.peer.slice(0, 8), "peerjs");
      conn.send({
        type: "hello",
        name: this.name,
        peerId: this.peerId,
        caps: bridgeCapabilities(),
      });
      this.emit();
    });
    conn.on("data", (data: any) => this.onPeerData(conn.peer, data));
    conn.on("close", () => {
      this.dataConns.delete(conn.peer);
      this.emit();
    });
  }

  private ensureDataConn(peerId: string): Promise<DataConnection | null> {
    return new Promise((resolve) => {
      if (!this.peer) return resolve(null);
      const existing = this.dataConns.get(peerId);
      if (existing?.open) return resolve(existing);
      try {
        const conn = this.peer.connect(peerId, { reliable: true });
        conn.on("open", () => {
          this.hookDataConn(conn);
          resolve(conn);
        });
        conn.on("error", () => resolve(null));
        setTimeout(() => resolve(this.dataConns.get(peerId) || null), 4000);
      } catch {
        resolve(null);
      }
    });
  }

  // ─── Trystero swarm ──────────────────────────────────────────
  private async connectTrystero() {
    try {
      const room = joinRoom({ appId: APP_ID }, this.room);
      this.trystero = room;
      const [send, get] = room.makeAction("gc");
      this.trySend = send as any;

      get((data: any, id: string) => {
        this.upsertPeer(id, data?.name || id.slice(0, 8), "trystero");
        this.onPeerData(id, data);
      });

      room.onPeerJoin((id) => {
        this.upsertPeer(id, id.slice(0, 8), "trystero");
        send({ type: "hello", name: this.name, peerId: this.peerId }, id);
        this.emit();
      });
      room.onPeerLeave((id) => {
        // only remove if no other transport knows them — keep soft
        const p = this.peers.get(id);
        if (p) {
          p.via = p.via.filter((v) => v !== "trystero");
          if (!p.via.length) this.peers.delete(id);
        }
        this.emit();
      });

      this.transports.trystero = true;
      this.setOnlineIfAny();
    } catch (e) {
      console.warn("[Trystero] unavailable (needs network for trackers)", e);
    }
  }

  // ─── Gun presence ────────────────────────────────────────────
  private connectGun() {
    try {
      const gun = Gun({
        localStorage: true,
        peers: [], // pure local graph; hub can add gun relay later
      });
      this.gun = gun;
      const node = gun.get(`gridcaller/room/${this.room}`);
      node.get(this.peerId).put({
        name: this.name,
        ts: Date.now(),
        online: true,
        caps: bridgeCapabilities(),
      });
      node.map().on((data: any, key: string) => {
        if (!data || key === this.peerId) return;
        if (data.online && data.name) {
          this.upsertPeer(key, data.name, "gun");
          this.emit();
        }
      });
      this.transports.gun = true;
      this.setOnlineIfAny();
    } catch (e) {
      console.warn("[Gun]", e);
    }
  }

  private upsertPeer(id: string, name: string, via: string) {
    if (!id || id === this.peerId) return;
    const prev = this.peers.get(id);
    if (prev) {
      prev.name = name || prev.name;
      prev.lastSeen = Date.now();
      if (!prev.via.includes(via)) prev.via.push(via);
    } else {
      this.peers.set(id, { id, name, lastSeen: Date.now(), via: [via] });
    }
  }

  private onHubMessage(msg: any) {
    switch (msg.type) {
      case "joined":
        for (const p of msg.peers || []) {
          this.upsertPeer(p.id, p.name, "ws");
        }
        if (msg.hub) this.hubInfo = { ...(this.hubInfo || {}), ...msg.hub };
        this.emit();
        break;
      case "peer-join":
        if (msg.peer?.id) this.upsertPeer(msg.peer.id, msg.peer.name, "ws");
        this.emit();
        break;
      case "peer-leave":
        if (msg.peerId) {
          this.peers.delete(msg.peerId);
          if (this.call?.peerId === msg.peerId) this.endCall("peer left");
          this.emit();
        }
        break;
      case "chat":
        this.ingestChat(msg, "ws");
        break;
      case "call":
      case "signal":
        void this.onCallSignal(msg);
        break;
      case "bridge":
        // UI can listen via subscribe + last bridge event
        (this as any).lastBridge = msg;
        this.emit();
        break;
      case "presence":
        if (msg.from) this.upsertPeer(msg.from, msg.name || msg.from.slice(0, 8), "ws");
        this.emit();
        break;
    }
  }

  private onPeerData(from: string, data: any) {
    if (!data) return;
    if (data.type === "hello") {
      this.upsertPeer(from, data.name || from.slice(0, 8), "peerjs");
      this.emit();
      return;
    }
    if (data.type === "chat") {
      this.ingestChat({ ...data, from }, data.via || "peerjs");
      return;
    }
    if (data.type === "call" || data.action) {
      void this.onCallSignal({ ...data, from, type: "call" });
    }
  }

  private ingestChat(msg: any, via: string) {
    if (msg.to && msg.to !== this.peerId) return;
    if (msg.from === this.peerId) return;
    const row: ChatMsg = {
      id: msg.id || `m_${Date.now()}`,
      from: msg.from,
      fromName: msg.fromName || this.peers.get(msg.from)?.name || "Peer",
      to: msg.to || this.peerId,
      text: String(msg.text || ""),
      ts: msg.ts || Date.now(),
      mine: false,
      via,
    };
    // de-dupe
    if (this.chats.some((c) => c.id === row.id)) return;
    this.chats = [...this.chats, row];
    saveChats(this.chats);
    this.upsertPeer(msg.from, row.fromName, via);
    this.emit();
  }

  async sendChat(to: string, text: string) {
    const t = text.trim();
    if (!t || !to) return;
    const row: ChatMsg = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from: this.peerId,
      fromName: this.name,
      to,
      text: t,
      ts: Date.now(),
      mine: true,
      via: "multi",
    };
    this.chats = [...this.chats, row];
    saveChats(this.chats);

    const packet = {
      type: "chat",
      to,
      id: row.id,
      text: t,
      fromName: this.name,
      from: this.peerId,
    };

    this.wsSend(packet);
    const conn = await this.ensureDataConn(to);
    if (conn?.open) conn.send(packet);
    try {
      this.trySend?.(packet, to);
    } catch {}

    this.emit();
  }

  private async ensureLocalAudio() {
    if (this.localStream) return this.localStream;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    return this.localStream;
  }

  private attachRemote(stream: MediaStream) {
    this.remoteStream = stream;
    if (this.audioEl) {
      this.audioEl.srcObject = stream;
      this.audioEl.play().catch(() => {});
    }
    this.emit();
  }

  async startCall(peerId: string) {
    if (this.call && !["idle", "ended"].includes(this.call.state)) {
      this.lastError = "Already in a call";
      this.emit();
      return;
    }
    const peerName = this.peers.get(peerId)?.name || peerId.slice(0, 8);

    try {
      const stream = await this.ensureLocalAudio();

      // Prefer PeerJS media if both use PeerServer
      if (this.peer && this.transports.peerjs) {
        this.call = {
          peerId,
          peerName,
          state: "outgoing",
          direction: "out",
          startedAt: Date.now(),
          muted: false,
          transport: "peerjs-media",
        };
        this.emit();
        const media = this.peer.call(peerId, stream);
        this.mediaCall = media;
        media.on("stream", (remote) => {
          this.attachRemote(remote);
          if (this.call) {
            this.call.state = "active";
            this.call.connectedAt = Date.now();
          }
          this.emit();
        });
        media.on("close", () => this.endCall("media close"));
        media.on("error", () => {
          // fallback to WS WebRTC
          void this.startCallWs(peerId, peerName, stream);
        });
        // also ring via WS
        this.wsSend({ type: "call", to: peerId, action: "invite", fromName: this.name });
        return;
      }

      await this.startCallWs(peerId, peerName, stream);
    } catch (e: any) {
      this.lastError = e?.message || "Mic / call failed";
      this.call = null;
      this.emit();
    }
  }

  private async startCallWs(peerId: string, peerName: string, stream: MediaStream) {
    this.call = {
      peerId,
      peerName,
      state: "outgoing",
      direction: "out",
      startedAt: Date.now(),
      muted: false,
      transport: "webrtc-ws",
    };
    this.emit();
    this.wsSend({ type: "call", to: peerId, action: "invite", fromName: this.name });

    const pc = this.createPc(peerId);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    this.call.state = "connecting";
    this.emit();
    this.wsSend({
      type: "call",
      to: peerId,
      action: "offer",
      sdp: pc.localDescription,
      fromName: this.name,
    });
  }

  private createPc(peerId: string) {
    this.pc?.close();
    this.pendingIce = [];
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.wsSend({
          type: "call",
          to: peerId,
          action: "ice",
          candidate: ev.candidate.toJSON(),
        });
      }
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      this.attachRemote(stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && this.call) {
        this.call.state = "active";
        this.call.connectedAt = Date.now();
        this.emit();
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (this.call) this.endCall(pc.connectionState);
      }
    };
    return pc;
  }

  async acceptCall() {
    if (!this.call || this.call.state !== "incoming") return;
    const peerId = this.call.peerId;
    try {
      const stream = await this.ensureLocalAudio();

      if (this.mediaCall) {
        this.mediaCall.answer(stream);
        this.call.state = "connecting";
        this.call.transport = "peerjs-media";
        this.emit();
        this.wsSend({ type: "call", to: peerId, action: "accept" });
        return;
      }

      let pc = this.pc;
      if (!pc) pc = this.createPc(peerId);
      for (const track of stream.getTracks()) {
        if (!pc.getSenders().some((s) => s.track?.kind === track.kind)) {
          pc.addTrack(track, stream);
        }
      }
      this.call.state = "connecting";
      this.emit();
      if (pc.signalingState === "have-remote-offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.wsSend({ type: "call", to: peerId, action: "answer", sdp: pc.localDescription });
      }
      this.wsSend({ type: "call", to: peerId, action: "accept" });
    } catch (e: any) {
      this.lastError = e?.message || "Accept failed";
      this.rejectCall();
    }
  }

  rejectCall() {
    if (!this.call) return;
    this.wsSend({ type: "call", to: this.call.peerId, action: "reject" });
    try {
      this.mediaCall?.close();
    } catch {}
    this.logCall("missed");
    this.cleanupMedia();
    this.call = null;
    this.emit();
  }

  endCall(_reason?: string) {
    if (this.call) {
      this.wsSend({ type: "call", to: this.call.peerId, action: "hangup" });
      try {
        this.mediaCall?.close();
      } catch {}
      if (this.call.connectedAt) this.logCall(this.call.direction === "in" ? "in" : "out");
      else if (this.call.direction === "out") this.logCall("out");
      else this.logCall("missed");
    }
    this.cleanupMedia();
    this.call = null;
    this.emit();
  }

  toggleMute() {
    if (!this.call || !this.localStream) return;
    this.call.muted = !this.call.muted;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !this.call.muted;
    this.emit();
  }

  private logCall(dir: CallLog["dir"]) {
    if (!this.call) return;
    const durationSec = this.call.connectedAt
      ? Math.floor((Date.now() - this.call.connectedAt) / 1000)
      : 0;
    const row: CallLog = {
      id: `c_${Date.now()}`,
      peerId: this.call.peerId,
      peerName: this.call.peerName,
      dir,
      ts: Date.now(),
      durationSec,
    };
    this.callLogs = [row, ...this.callLogs].slice(0, 200);
    saveCalls(this.callLogs);
  }

  private cleanupMedia() {
    try {
      this.pc?.close();
    } catch {}
    this.pc = null;
    this.mediaCall = null;
    this.pendingIce = [];
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    this.remoteStream = null;
    if (this.audioEl) this.audioEl.srcObject = null;
  }

  private async onCallSignal(msg: any) {
    const from = msg.from as string;
    if (!from || from === this.peerId) return;
    const action = msg.action as string;
    const name = msg.fromName || this.peers.get(from)?.name || from.slice(0, 8);

    if (action === "invite") {
      if (this.call && !["idle", "ended"].includes(this.call.state)) {
        this.wsSend({ type: "call", to: from, action: "busy" });
        return;
      }
      // PeerJS media may also arrive; set incoming if not already
      if (!this.call || this.call.state === "ended") {
        this.call = {
          peerId: from,
          peerName: name,
          state: "incoming",
          direction: "in",
          startedAt: Date.now(),
          muted: false,
          transport: "webrtc-ws",
        };
        this.emit();
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {}
      }
      return;
    }

    if (action === "offer" && msg.sdp) {
      if (!this.call) {
        this.call = {
          peerId: from,
          peerName: name,
          state: "incoming",
          direction: "in",
          startedAt: Date.now(),
          muted: false,
          transport: "webrtc-ws",
        };
      }
      const pc = this.pc || this.createPc(from);
      await pc.setRemoteDescription(msg.sdp);
      for (const c of this.pendingIce) {
        try {
          await pc.addIceCandidate(c);
        } catch {}
      }
      this.pendingIce = [];
      this.emit();
      return;
    }

    if (action === "answer" && msg.sdp) {
      if (!this.pc) return;
      await this.pc.setRemoteDescription(msg.sdp);
      for (const c of this.pendingIce) {
        try {
          await this.pc.addIceCandidate(c);
        } catch {}
      }
      this.pendingIce = [];
      if (this.call) {
        this.call.state = "active";
        this.call.connectedAt = Date.now();
      }
      this.emit();
      return;
    }

    if (action === "ice" && msg.candidate) {
      if (this.pc?.remoteDescription) {
        try {
          await this.pc.addIceCandidate(msg.candidate);
        } catch {}
      } else {
        this.pendingIce.push(msg.candidate);
      }
      return;
    }

    if (action === "reject" || action === "busy" || action === "hangup") {
      if (this.call?.peerId === from) {
        if (action === "reject" || action === "busy") this.logCall("missed");
        else if (this.call.connectedAt) this.logCall(this.call.direction === "in" ? "in" : "out");
        this.cleanupMedia();
        this.call = null;
        this.emit();
      }
      return;
    }

    if (action === "accept" && this.call?.peerId === from) {
      this.call.state = "connecting";
      this.emit();
    }
  }

  threadWith(peerId: string) {
    return this.chats.filter((m) => m.from === peerId || m.to === peerId);
  }

  peerList() {
    return [...this.peers.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  transportLabel() {
    const on = Object.entries(this.transports)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return on.length ? on.join("+") : "none";
  }
}

export const mesh = new MeshEngine();
