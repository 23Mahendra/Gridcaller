/**
 * GridAlive Mesh Communications — SIM-free calls + messages over software mesh
 *
 * No SIM card. No external RF antennas.
 * Signaling: multi-hop mesh. Media: WebRTC.
 */

import { MeshEngine, type MeshMsg } from "./meshEngine";
import S from "./storage";
import { v4 as uuidv4 } from "uuid";
import { createPendingDmEntry, shouldRetryPendingDm, type PendingDmEntry } from "./meshCommsReliability";
import {
  createPendingCallSignal,
  shouldRetryPendingCallSignal,
  type PendingCallSignalEntry,
} from "./meshCallReliability";

export type CallState =
  | "idle"
  | "outgoing"
  | "incoming"
  | "connecting"
  | "active"
  | "ended";

export type MeshDm = {
  id: string;
  from: string;
  fromName: string;
  to: string;
  text: string;
  ts: number;
  hops: number;
  status: "sent" | "delivered" | "failed";
  read?: boolean;
};

export type CallSession = {
  callId: string;
  peerId: string;
  peerName: string;
  state: CallState;
  video: boolean;
  startedAt?: number;
  connectedAt?: number;
  direction: "in" | "out";
  muted?: boolean;
  speakerOn?: boolean;
};

export type CallHistoryItem = {
  id: string;
  peerId: string;
  peerName: string;
  direction: "in" | "out" | "missed";
  video: boolean;
  ts: number;
  durationSec: number;
  reason?: string;
};

type Listener = () => void;

const DM_KEY = "mesh_dms_v1";
const CALL_HIST_KEY = "mesh_call_history_v1";
const CONTACTS_KEY = "mesh_contacts_v1";
const PENDING_DMS_KEY = "mesh_pending_dms_v1";
const PENDING_CALLS_KEY = "mesh_pending_calls_v1";
const PENDING_RETRY_MS = 2500;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export type MeshContact = {
  id: string;
  name: string;
  note?: string;
  color?: string;
  lastSeen?: number;
  isMesh: boolean;
};

class MeshCommsImpl {
  dms: MeshDm[] = [];
  callHistory: CallHistoryItem[] = [];
  contacts: MeshContact[] = [];
  call: CallSession | null = null;
  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private listeners = new Set<Listener>();
  private hooked = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private audioEl: HTMLAudioElement | null = null;
  private pendingDms: PendingDmEntry[] = [];
  private pendingCallSignals: PendingCallSignalEntry[] = [];
  private pendingTimer: number | null = null;

  start() {
    if (this.hooked) return;
    this.hooked = true;
    this.dms = S.getRaw(DM_KEY, []) || [];
    this.callHistory = S.getRaw(CALL_HIST_KEY, []) || [];
    this.contacts = S.getRaw(CONTACTS_KEY, []) || [];
    this.pendingDms = (S.getRaw(PENDING_DMS_KEY, []) || []) as PendingDmEntry[];
    this.pendingCallSignals = (S.getRaw(PENDING_CALLS_KEY, []) || []) as PendingCallSignalEntry[];
    this._schedulePendingDmFlush();
    this._flushPendingDms(Date.now());
    this._flushPendingCallSignals(Date.now());
    MeshEngine.onMessage((msg) => this._onMesh(msg));
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private _emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }

  private _saveDms() {
    try {
      S.setRaw(DM_KEY, this.dms.slice(0, 800));
    } catch {}
  }

  private _saveHistory() {
    try {
      S.setRaw(CALL_HIST_KEY, this.callHistory.slice(0, 200));
    } catch {}
  }

  private _saveContacts() {
    try {
      S.setRaw(CONTACTS_KEY, this.contacts.slice(0, 300));
    } catch {}
  }

  private _savePendingDms() {
    try {
      S.setRaw(PENDING_DMS_KEY, this.pendingDms.slice(0, 200));
    } catch {}
  }

  private _savePendingCallSignals() {
    try {
      S.setRaw(PENDING_CALLS_KEY, this.pendingCallSignals.slice(0, 200));
    } catch {}
  }

  private _schedulePendingDmFlush() {
    if (this.pendingTimer != null || typeof window === "undefined") return;
    this.pendingTimer = window.setInterval(() => {
      this._flushPendingDms(Date.now());
    }, PENDING_RETRY_MS);
  }

  private _queuePendingDm(dm: MeshDm) {
    const existing = this.pendingDms.find((entry) => entry.id === dm.id);
    if (existing) {
      existing.to = dm.to;
      existing.text = dm.text;
      existing.lastAttemptAt = Date.now();
      existing.attempts = Math.max(existing.attempts, 1);
      existing.status = "pending";
    } else {
      this.pendingDms.unshift(
        createPendingDmEntry({
          id: dm.id,
          to: dm.to,
          text: dm.text,
          createdAt: dm.ts,
        })
      );
    }
    this._savePendingDms();
    this._flushPendingDms(Date.now());
  }

  private _flushPendingDms(now = Date.now()) {
    if (!this.pendingDms.length) return;
    for (const entry of [...this.pendingDms]) {
      if (entry.status === "acked" || entry.status === "failed") continue;
      if (!shouldRetryPendingDm(entry, now)) continue;
      const existing = this.dms.find((dm) => dm.id === entry.id);
      if (!existing) {
        this.pendingDms = this.pendingDms.filter((item) => item.id !== entry.id);
        this._savePendingDms();
        continue;
      }
      entry.lastAttemptAt = now;
      entry.attempts += 1;
      this._savePendingDms();
      MeshEngine.sendTo(entry.to, "MESH_DM", {
        id: entry.id,
        text: entry.text,
        fromName: MeshEngine.localName,
      });
      MeshEngine.broadcast(
        "MESH_DM_BROADCAST",
        { hint: "dm", from: MeshEngine.localId, to: entry.to },
        2
      );
      if (entry.attempts >= 6) {
        entry.status = "failed";
        this._savePendingDms();
      }
    }
  }

  private _markPendingDmAcked(id: string) {
    this.pendingDms = this.pendingDms.filter((entry) => entry.id !== id || entry.status === "acked");
    this._savePendingDms();
  }

  private _queuePendingCallSignal(entry: PendingCallSignalEntry) {
    const existing = this.pendingCallSignals.find((item) => item.id === entry.id);
    if (existing) {
      existing.payload = entry.payload;
      existing.lastAttemptAt = Date.now();
      existing.attempts = Math.max(existing.attempts, 1);
      existing.status = "pending";
    } else {
      this.pendingCallSignals.unshift(entry);
    }
    this._savePendingCallSignals();
    this._flushPendingCallSignals(Date.now());
  }

  private _flushPendingCallSignals(now = Date.now()) {
    if (!this.pendingCallSignals.length) return;
    for (const entry of [...this.pendingCallSignals]) {
      if (entry.status === "acked" || entry.status === "failed") continue;
      if (!shouldRetryPendingCallSignal(entry, now)) continue;
      if (!this.call || this.call.callId !== entry.callId || this.call.state === "ended") {
        entry.status = "failed";
        this._savePendingCallSignals();
        continue;
      }
      entry.lastAttemptAt = now;
      entry.attempts += 1;
      this._savePendingCallSignals();
      MeshEngine.sendTo(entry.peerId, entry.kind === "sdp" ? "MESH_CALL_SDP" : entry.kind === "accept" ? "MESH_CALL_ACCEPT" : "MESH_CALL_INVITE", entry.payload);
      if (entry.attempts >= 6) {
        entry.status = "failed";
        this._savePendingCallSignals();
      }
    }
  }

  private _markPendingCallSignalAcked(callId: string, kind: PendingCallSignalKind) {
    const id = `${callId}:${kind}:${this.call?.peerId || ""}`;
    this.pendingCallSignals = this.pendingCallSignals.filter((entry) => entry.id !== id || entry.status === "acked");
    this._savePendingCallSignals();
  }

  /** Upsert contact from peer presence (Truecaller-style identity) */
  rememberContact(id: string, name: string, lastSeen?: number) {
    if (!id || id === MeshEngine.localId) return;
    const existing = this.contacts.find((c) => c.id === id);
    if (existing) {
      existing.name = name || existing.name;
      existing.lastSeen = lastSeen || Date.now();
      existing.isMesh = true;
    } else {
      this.contacts.unshift({
        id,
        name: name || id.slice(0, 10),
        lastSeen: lastSeen || Date.now(),
        isMesh: true,
        color: avatarColor(id),
      });
    }
    this._saveContacts();
    this._emit();
  }

  getContacts(): MeshContact[] {
    // Merge live peers into contacts
    const peers = MeshEngine.getPeerList();
    for (const p of peers) {
      this.rememberContact(p.id, p.name, p.lastSeen);
    }
    return [...this.contacts].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  /** Unread DM count */
  unreadCount(peerId?: string): number {
    return this.dms.filter(
      (m) =>
        m.to === MeshEngine.localId &&
        !m.read &&
        (!peerId || m.from === peerId)
    ).length;
  }

  markThreadRead(peerId: string) {
    this.dms = this.dms.map((m) =>
      m.from === peerId && m.to === MeshEngine.localId ? { ...m, read: true } : m
    );
    this._saveDms();
    this._emit();
  }

  /** Conversations list (Truecaller messages tab) */
  getConversations(): {
    peerId: string;
    peerName: string;
    lastText: string;
    ts: number;
    unread: number;
    online: boolean;
  }[] {
    const map = new Map<
      string,
      { peerId: string; peerName: string; lastText: string; ts: number; unread: number }
    >();
    for (const m of this.dms) {
      const peerId = m.from === MeshEngine.localId ? m.to : m.from;
      const peerName =
        m.from === MeshEngine.localId
          ? this.contacts.find((c) => c.id === peerId)?.name || peerId.slice(0, 10)
          : m.fromName;
      const cur = map.get(peerId);
      if (!cur || m.ts > cur.ts) {
        map.set(peerId, {
          peerId,
          peerName,
          lastText: m.text,
          ts: m.ts,
          unread: 0,
        });
      }
    }
    for (const [peerId, c] of map) {
      c.unread = this.unreadCount(peerId);
    }
    const peers = MeshEngine.getPeerList();
    return [...map.values()]
      .map((c) => ({
        ...c,
        online: peers.some((p) => p.id === c.peerId && p.online),
      }))
      .sort((a, b) => b.ts - a.ts);
  }

  sendDm(toPeerId: string, text: string, toName?: string) {
    const id = uuidv4();
    const dm: MeshDm = {
      id,
      from: MeshEngine.localId,
      fromName: MeshEngine.localName,
      to: toPeerId,
      text: text.trim(),
      ts: Date.now(),
      hops: 0,
      status: "sent",
      read: true,
    };
    this.dms = [dm, ...this.dms].slice(0, 800);
    this._saveDms();
    if (toName) this.rememberContact(toPeerId, toName);
    MeshEngine.sendTo(toPeerId, "MESH_DM", {
      id,
      text: dm.text,
      fromName: MeshEngine.localName,
      toName,
    });
    MeshEngine.broadcast(
      "MESH_DM_BROADCAST",
      { hint: "dm", from: MeshEngine.localId, to: toPeerId },
      2
    );
    this._queuePendingDm(dm);
    this._emit();
    return dm;
  }

  getThread(peerId: string): MeshDm[] {
    return this.dms
      .filter(
        (m) =>
          (m.from === peerId && m.to === MeshEngine.localId) ||
          (m.from === MeshEngine.localId && m.to === peerId)
      )
      .sort((a, b) => a.ts - b.ts);
  }

  private _pushHistory(item: CallHistoryItem) {
    this.callHistory = [item, ...this.callHistory].slice(0, 200);
    this._saveHistory();
  }

  private _finalizeHistory(reason?: string) {
    if (!this.call) return;
    const started = this.call.connectedAt || this.call.startedAt || Date.now();
    const durationSec =
      this.call.state === "active" || this.call.connectedAt
        ? Math.max(0, Math.floor((Date.now() - started) / 1000))
        : 0;
    let direction: CallHistoryItem["direction"] = this.call.direction;
    if (
      this.call.direction === "in" &&
      (this.call.state === "incoming" || reason === "missed" || reason === "no_answer")
    ) {
      direction = "missed";
    }
    if (this.call.direction === "out" && reason === "no_answer") {
      direction = "out";
    }
    this._pushHistory({
      id: this.call.callId,
      peerId: this.call.peerId,
      peerName: this.call.peerName,
      direction,
      video: this.call.video,
      ts: Date.now(),
      durationSec,
      reason,
    });
    this.rememberContact(this.call.peerId, this.call.peerName);
  }

  async startCall(peerId: string, peerName: string, video = false) {
    if (this.call && this.call.state !== "idle" && this.call.state !== "ended") {
      throw new Error("Already in a call");
    }
    const callId = uuidv4();
    this.call = {
      callId,
      peerId,
      peerName,
      state: "outgoing",
      video,
      direction: "out",
      startedAt: Date.now(),
      muted: false,
      speakerOn: true,
    };
    this.rememberContact(peerId, peerName);
    this._emit();

    await this._prepareMedia(video);
    await this._createPc(peerId, callId, true);

    const payload = {
      callId,
      video,
      fromName: MeshEngine.localName,
      fromId: MeshEngine.localId,
    };
    MeshEngine.sendTo(peerId, "MESH_CALL_INVITE", payload);
    this._queuePendingCallSignal(
      createPendingCallSignal({
        callId,
        peerId,
        kind: "invite",
        payload,
        createdAt: Date.now(),
      })
    );

    setTimeout(() => {
      if (this.call?.callId === callId && this.call.state === "outgoing") {
        this.endCall("no_answer");
      }
    }, 45000);
  }

  async acceptCall() {
    if (!this.call || this.call.state !== "incoming") return;
    const { peerId, callId, video } = this.call;
    this.call = { ...this.call, state: "connecting", muted: false, speakerOn: true };
    this._emit();

    await this._prepareMedia(video);
    await this._createPc(peerId, callId, false);

    const payload = {
      callId,
      fromName: MeshEngine.localName,
    };
    MeshEngine.sendTo(peerId, "MESH_CALL_ACCEPT", payload);
    this._queuePendingCallSignal(
      createPendingCallSignal({
        callId,
        peerId,
        kind: "accept",
        payload,
        createdAt: Date.now(),
      })
    );
  }

  rejectCall() {
    if (!this.call) return;
    const { peerId, callId } = this.call;
    MeshEngine.sendTo(peerId, "MESH_CALL_REJECT", { callId });
    this._finalizeHistory("missed");
    this._cleanupMedia();
    this.call = { ...this.call, state: "ended" };
    this._emit();
    setTimeout(() => {
      this.call = null;
      this._emit();
    }, 600);
  }

  endCall(reason = "hangup") {
    if (this.call) {
      MeshEngine.sendTo(this.call.peerId, "MESH_CALL_END", {
        callId: this.call.callId,
        reason,
      });
      this._finalizeHistory(reason);
    }
    this._cleanupMedia();
    if (this.call) {
      this.call = { ...this.call, state: "ended" };
      this._emit();
    }
    setTimeout(() => {
      this.call = null;
      this._emit();
    }, 400);
  }

  setMuted(muted: boolean) {
    if (!this.call) return;
    this.call = { ...this.call, muted };
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    this._emit();
  }

  setSpeaker(on: boolean) {
    if (!this.call) return;
    this.call = { ...this.call, speakerOn: on };
    if (this.audioEl) {
      try {
        this.audioEl.volume = on ? 1 : 0.35;
      } catch {}
    }
    this._emit();
  }

  attachRemoteAudio(el: HTMLAudioElement | null) {
    this.audioEl = el;
    if (el && this.remoteStream) {
      el.srcObject = this.remoteStream;
      el.play().catch(() => {});
    }
  }

  // ── mesh handlers ──

  private async _onMesh(msg: MeshMsg) {
    if (msg.from && msg.fromName) {
      this.rememberContact(msg.from, msg.fromName, msg.ts);
    }

    if (msg.type === "MESH_DM" && msg.data?.text) {
      const dm: MeshDm = {
        id: msg.data.id || msg.id,
        from: msg.from,
        fromName: msg.fromName || msg.data.fromName || msg.from,
        to: MeshEngine.localId,
        text: msg.data.text,
        ts: msg.ts || Date.now(),
        hops: msg.hops || 0,
        status: "delivered",
        read: false,
      };
      if (!this.dms.some((d) => d.id === dm.id)) {
        this.dms = [dm, ...this.dms].slice(0, 800);
        this._saveDms();
        this.rememberContact(msg.from, dm.fromName);
        MeshEngine.sendTo(msg.from, "MESH_DM_ACK", { id: dm.id });
        this._markPendingDmAcked(dm.id);
        this._emit();
      }
      return;
    }

    if (msg.type === "MESH_DM_ACK" && msg.data?.id) {
      this.dms = this.dms.map((d) =>
        d.id === msg.data.id ? { ...d, status: "delivered" as const } : d
      );
      this._markPendingDmAcked(msg.data.id);
      this._saveDms();
      this._emit();
      return;
    }

    if (msg.type === "MESH_CALL_INVITE") {
      if (this.call && this.call.state !== "ended" && this.call.state !== "idle") {
        MeshEngine.sendTo(msg.from, "MESH_CALL_REJECT", {
          callId: msg.data.callId,
          reason: "busy",
        });
        return;
      }
      this.call = {
        callId: msg.data.callId,
        peerId: msg.from,
        peerName: msg.data.fromName || msg.fromName || msg.from,
        state: "incoming",
        video: !!msg.data.video,
        direction: "in",
        startedAt: Date.now(),
        muted: false,
        speakerOn: true,
      };
      this.rememberContact(msg.from, this.call.peerName);
      this._emit();
      try {
        navigator.vibrate?.([300, 120, 300, 120, 300]);
      } catch {}
      return;
    }

    if (msg.type === "MESH_CALL_ACCEPT" && this.call?.callId === msg.data?.callId) {
      this.call = { ...this.call, state: "connecting" };
      this._markPendingCallSignalAcked(this.call.callId, "accept");
      this._emit();
      if (this.call.direction === "out" && this.pc) {
        try {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          const payload = {
            callId: this.call.callId,
            sdp: offer,
            kind: "offer",
          };
          MeshEngine.sendTo(this.call.peerId, "MESH_CALL_SDP", payload);
          this._queuePendingCallSignal(
            createPendingCallSignal({
              callId: this.call.callId,
              peerId: this.call.peerId,
              kind: "sdp",
              payload,
              createdAt: Date.now(),
            })
          );
        } catch (e) {
          console.warn("[MeshCall] offer failed", e);
          this.endCall("offer_failed");
        }
      }
      return;
    }

    if (msg.type === "MESH_CALL_REJECT" && this.call?.callId === msg.data?.callId) {
      this._finalizeHistory("rejected");
      this._cleanupMedia();
      this.call = { ...this.call, state: "ended" };
      this._emit();
      setTimeout(() => {
        this.call = null;
        this._emit();
      }, 600);
      return;
    }

    if (msg.type === "MESH_CALL_SDP" && this.call?.callId === msg.data?.callId) {
      try {
        if (!this.pc) await this._createPc(this.call.peerId, this.call.callId, false);
        const sdp = msg.data.sdp;
        await this.pc!.setRemoteDescription(new RTCSessionDescription(sdp));
        for (const c of this.pendingIce) {
          try {
            await this.pc!.addIceCandidate(c);
          } catch {}
        }
        this.pendingIce = [];

        if (msg.data.kind === "offer") {
          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);
          const payload = {
            callId: this.call.callId,
            sdp: answer,
            kind: "answer",
          };
          MeshEngine.sendTo(this.call.peerId, "MESH_CALL_SDP", payload);
          this._queuePendingCallSignal(
            createPendingCallSignal({
              callId: this.call.callId,
              peerId: this.call.peerId,
              kind: "sdp",
              payload,
              createdAt: Date.now(),
            })
          );
        }
        this.call = { ...this.call, state: "connecting" };
        this._markPendingCallSignalAcked(this.call.callId, "sdp");
        this._emit();
      } catch (e) {
        console.warn("[MeshCall] SDP error", e);
      }
      return;
    }

    if (msg.type === "MESH_CALL_ICE" && this.call?.callId === msg.data?.callId) {
      try {
        const cand = msg.data.candidate;
        if (this.pc && this.pc.remoteDescription) {
          await this.pc.addIceCandidate(cand);
        } else {
          this.pendingIce.push(cand);
        }
      } catch {}
      return;
    }

    if (msg.type === "MESH_CALL_END" && this.call?.callId === msg.data?.callId) {
      this._finalizeHistory(msg.data?.reason || "remote_end");
      this._cleanupMedia();
      this.call = { ...this.call, state: "ended" };
      this._emit();
      setTimeout(() => {
        this.call = null;
        this._emit();
      }, 500);
    }
  }

  private async _prepareMedia(video: boolean) {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: video
          ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
          : false,
      });
      this._emit();
    } catch (e: any) {
      throw new Error(
        "Mic/camera permission needed for mesh calls (no SIM — browser media only). " +
          (e?.message || "")
      );
    }
  }

  private async _createPc(peerId: string, callId: string, _isOfferer: boolean) {
    this._closePc();
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.remoteStream = new MediaStream();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream);
      }
    }

    this.pc.ontrack = (ev) => {
      for (const track of ev.streams[0]?.getTracks() || [ev.track]) {
        this.remoteStream?.addTrack(track);
      }
      if (this.audioEl && this.remoteStream) {
        this.audioEl.srcObject = this.remoteStream;
        this.audioEl.play().catch(() => {});
      }
      this._emit();
    };

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        MeshEngine.sendTo(peerId, "MESH_CALL_ICE", {
          callId,
          candidate: ev.candidate.toJSON(),
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      if (st === "connected" && this.call) {
        this.call = {
          ...this.call,
          state: "active",
          connectedAt: this.call.connectedAt || Date.now(),
        };
        this._emit();
      }
      if (st === "failed") {
        if (this.call && (this.call.state === "active" || this.call.state === "connecting")) {
          this.endCall("connection_failed");
        }
      }
    };
  }

  private _closePc() {
    try {
      this.pc?.close();
    } catch {}
    this.pc = null;
    this.pendingIce = [];
  }

  private _cleanupMedia() {
    this._closePc();
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.localStream = null;
    this.remoteStream = null;
  }
}

function avatarColor(id: string): string {
  const colors = [
    "#00897B", "#039BE5", "#7B1FA2", "#C2185B", "#F4511E",
    "#43A047", "#5E35B1", "#00ACC1", "#6D4C41", "#546E7A",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 17) % colors.length;
  return colors[h];
}

export const MeshComms = new MeshCommsImpl();
export default MeshComms;
