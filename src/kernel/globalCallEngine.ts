/**
 * Global Call Engine — local-first GridAlive ↔ GridAlive voice
 *
 * Signaling path:
 *  - Presence and call signaling use MeshEngine.
 *  - An explicitly enabled self-hosted LAN hub may bridge MeshEngine.
 *  - WebRTC uses local ICE only until cloud traversal is explicitly enabled.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import { iceServersForMesh, useLocalMeshOnly } from "./offlineMode";
import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";

export type GlobalPresence = {
  id: string;
  name: string;
  handle: string;
  online: true;
  ts: number;
  platform?: string;
  global: true;
};

export type GlobalCallMode = "local-mesh" | "global-internet";

type CachedPresence = GlobalPresence & {
  phone?: string;
  displayNumber?: string;
};

function slug(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "")
    .slice(0, 32);
}

function phoneDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function presenceMatches(record: CachedPresence, raw: string, normalized: string, digits: string) {
  if (!record?.id) return false;
  const id = String(record.id || "").trim();
  const handle = slug(record.handle || "");
  const name = String(record.name || "").trim().toLowerCase();
  const recDigits = phoneDigits(record.phone || record.displayNumber || "");
  if (id === raw || id === normalized || id === digits) return true;
  if (handle && (handle === normalized || handle === raw.replace(/^@/, "").toLowerCase())) return true;
  if (digits && recDigits && (recDigits === digits || recDigits.endsWith(digits))) return true;
  if (name && raw && name.includes(raw.toLowerCase())) return true;
  return false;
}

class GlobalCallEngine {
  private myId = "";
  private myName = "";
  private handle = "";
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private activeCallId = "";
  private incomingHandler: ((from: GlobalPresence & { callId: string }, accept: () => void, reject: () => void) => void) | null =
    null;
  private unsubMesh: (() => void) | null = null;
  private pendingIceByCall = new Map<string, RTCIceCandidateInit[]>();
  private presencePollTimer: ReturnType<typeof setInterval> | null = null;
  private presenceListeners = new Set<(p: GlobalPresence) => void>();
  private presenceCache = new Map<string, CachedPresence>();

  get ready() {
    return this.started;
  }

  get id() {
    return this.myId;
  }

  get callHandle() {
    return this.handle;
  }

  setSignalPeers(_peersCsv: string) {
    // kept for compatibility; MeshEngine is the signaling bus
  }

  start(nodeId: string, name: string, handleHint?: string) {
    this.myId = nodeId || S.get("omni_node_id") || S.get("mesh_id") || `ga_${Date.now().toString(36)}`;
    this.myName = name || S.get("user_name") || "User";
    this.handle = slug(handleHint || S.get("global_call_handle", "") || this.myName || this.myId);
    S.set("global_call_handle", this.handle);
    S.set("global_call_id", this.myId);

    this.started = true;
    this.publishPresence();
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => this.publishPresence(), 8000);

    if (this.unsubMesh) this.unsubMesh();
    this.unsubMesh = MeshEngine.onMessage((msg: any) => {
      void this.onMeshMessage(msg);
    });
    MeshEngine.start?.();

    this.startPresencePolling();

    bus.emit("globalCall:ready", {
      id: this.myId,
      handle: this.handle,
      peers: 0,
      localOnly: useLocalMeshOnly(),
      signaling: useLocalMeshOnly() ? "peer-mesh" : "mesh-bus",
    });
    return true;
  }

  stop() {
    this.started = false;
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    if (this.presencePollTimer) clearInterval(this.presencePollTimer);
    this.presencePollTimer = null;
    if (this.unsubMesh) this.unsubMesh();
    this.unsubMesh = null;
    this.presenceCache.clear();
    this.hangup();
  }

  setHandle(handle: string) {
    this.handle = slug(handle);
    S.set("global_call_handle", this.handle);
    this.publishPresence();
  }

  private async publishPresence() {
    if (!this.started || !this.myId) return;
    const payload = {
      id: this.myId,
      name: this.myName,
      handle: this.handle,
      phone: phoneDigits(String(S.get("user_phone", "") || "")),
      displayNumber:
        String(S.get("gc_test_display_number", "") || "").trim() ||
        this.handle ||
        phoneDigits(String(S.get("user_phone", "") || "")),
      hasLlm: false,
      ts: Date.now(),
    };
    this.rememberPresence({
      id: payload.id,
      name: payload.name,
      handle: payload.handle,
      phone: payload.phone,
      displayNumber: payload.displayNumber,
      online: true,
      ts: payload.ts,
      global: true,
    }, false);
    try {
      MeshEngine.broadcast("GLOBAL_CALL_PRESENCE", payload);
    } catch {}
  }

  async resolvePeer(dial: string): Promise<{ id: string; name: string; handle?: string } | null> {
    const raw = String(dial || "").trim();
    if (!raw) return null;
    const q = slug(raw) || phoneDigits(raw) || raw;
    return this.resolveCachedPeer(q) || this.resolveCachedPeer(raw);
  }

  listenPresence(cb: (p: GlobalPresence) => void): () => void {
    this.presenceListeners.add(cb);
    void this.emitPresenceNow();
    return () => {
      this.presenceListeners.delete(cb);
    };
  }

  private startPresencePolling() {
    if (this.presencePollTimer) clearInterval(this.presencePollTimer);
    this.presencePollTimer = setInterval(() => {
      void this.emitPresenceNow();
    }, 5000);
    void this.emitPresenceNow();
  }

  onIncoming(
    fn: (from: GlobalPresence & { callId: string }, accept: () => void, reject: () => void) => void
  ) {
    this.incomingHandler = fn;
  }

  private async onMeshMessage(msg: any) {
    if (!msg?.type || !this.started) return;
    const t = String(msg.type);
    const d = msg.data || msg;
    if (d?.to && d.to !== this.myId) return;
    if (msg.from === this.myId) return;

    if (t === "GLOBAL_CALL_PRESENCE" && (msg.from || d?.id)) {
      this.rememberPresence({
        id: msg.from || d.id,
        name: msg.fromName || d.name || msg.from || d.id,
        handle: d.handle || "",
        phone: d.phone || "",
        displayNumber: d.displayNumber || "",
        online: true,
        ts: d.ts || Date.now(),
        global: true,
      }, true);
      return;
    }

    if (t === "GLOBAL_CALL_OFFER" && d?.callId && d?.offer) {
      this.onIncomingOffer({
        callId: d.callId,
        from: msg.from || d.from,
        fromName: msg.fromName || d.fromName,
        fromHandle: d.fromHandle || "",
        offer: d.offer,
        ts: d.ts || Date.now(),
      });
      return;
    }

    if (t === "GLOBAL_CALL_ANSWER" && d?.callId === this.activeCallId && d?.answer && this.pc) {
      try {
        if (!this.pc.remoteDescription) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(d.answer));
        }
      } catch (e) {
        console.warn("[GlobalCall] answer", e);
      }
      return;
    }

    if (t === "GLOBAL_CALL_DECLINE" && d?.callId === this.activeCallId) {
      bus.emit("globalCall:state", { state: "declined", peerId: msg.from || d.from, callId: d.callId });
      return;
    }

    if (t === "GLOBAL_CALL_ICE" && d?.callId && d?.candidate) {
      const callId = String(d.callId);
      if (!this.pc || callId !== this.activeCallId) return;
      if (!this.pc.remoteDescription) {
        const q = this.pendingIceByCall.get(callId) || [];
        q.push(d.candidate);
        this.pendingIceByCall.set(callId, q);
        return;
      }
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(d.candidate));
      } catch {}
    }
  }

  private resolveCachedPeer(raw: string) {
    const normalized = slug(raw) || raw;
    const digits = phoneDigits(raw);
    for (const record of this.presenceCache.values()) {
      if (presenceMatches(record, raw, normalized, digits)) {
        return { id: record.id, name: record.name || record.id, handle: record.handle || "" };
      }
    }
    return null;
  }

  private rememberPresence(record: CachedPresence, notify: boolean) {
    if (!record?.id) return;
    const merged: CachedPresence = {
      ...(this.presenceCache.get(record.id) || {}),
      ...record,
      id: record.id,
      name: record.name || record.id,
      handle: record.handle || "",
      online: true,
      global: true,
      ts: Math.max(record.ts || 0, this.presenceCache.get(record.id)?.ts || 0, Date.now()),
    };
    this.presenceCache.set(record.id, merged);
    if (!notify) return;
    for (const fn of this.presenceListeners) {
      try {
        fn(merged);
      } catch {}
    }
  }

  private onIncomingOffer(data: any) {
    if (!this.incomingHandler) return;
    const callId = String(data.callId || "");
    const from = {
      id: data.from,
      name: data.fromName || data.from,
      handle: data.fromHandle || "",
      online: true as const,
      ts: data.ts || Date.now(),
      global: true as const,
      callId,
    };
    this.incomingHandler(
      from,
      () => void this.acceptCall(callId, data),
      () => {
        MeshEngine.broadcast("GLOBAL_CALL_DECLINE", {
          to: data.from,
          callId,
          from: this.myId,
          ts: Date.now(),
        });
      }
    );
  }

  async placeCall(toId: string, toName?: string): Promise<{ pc: RTCPeerConnection; callId: string }> {
    if (!this.started) throw new Error("Global call not ready — signaling offline");
    if (!("RTCPeerConnection" in window)) throw new Error("WebRTC not supported");

    this.hangup();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.localStream = stream;

    if (!tryBeginPeerConnection()) {
      throw new Error("WebRTC budget exhausted; using offline-safe mode");
    }
    const iceServers = iceServersForMesh();
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 8 });
    this.pc = pc;
    const originalClose = pc.close.bind(pc);
    pc.close = () => {
      endPeerConnection();
      return originalClose();
    };
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const callId = `gcall_${this.myId}_${toId}_${Date.now().toString(36)}`;
    this.activeCallId = callId;
    this.pendingIceByCall.set(callId, []);

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      MeshEngine.broadcast("GLOBAL_CALL_ICE", {
        to: toId,
        callId,
        candidate: e.candidate.toJSON(),
        from: this.myId,
        ts: Date.now(),
      });
    };

    pc.ontrack = (ev) => {
      const el = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement | null;
      if (el) {
        el.srcObject = ev.streams[0];
        el.play().catch(() => {});
      }
      bus.emit("globalCall:audio", { from: toId });
    };

    pc.onconnectionstatechange = () => {
      bus.emit("globalCall:state", { state: pc.connectionState, peerId: toId, callId });
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    MeshEngine.broadcast("GLOBAL_CALL_OFFER", {
      to: toId,
      callId,
      from: this.myId,
      fromName: this.myName,
      fromHandle: this.handle,
      offer: pc.localDescription || offer,
      ts: Date.now(),
    });

    bus.emit("globalCall:outgoing", { toId, toName, callId });
    return { pc, callId };
  }

  private async acceptCall(callId: string, offerData: any) {
    this.hangup();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.localStream = stream;
    if (!tryBeginPeerConnection()) {
      throw new Error("WebRTC budget exhausted; using offline-safe mode");
    }
    const iceServers = await getWebRtcIceServers();
    const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 8 });
    this.pc = pc;
    const originalClose = pc.close.bind(pc);
    pc.close = () => {
      endPeerConnection();
      return originalClose();
    };
    this.activeCallId = callId;
    this.pendingIceByCall.set(callId, []);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      MeshEngine.broadcast("GLOBAL_CALL_ICE", {
        to: offerData.from,
        callId,
        candidate: e.candidate.toJSON(),
        from: this.myId,
        ts: Date.now(),
      });
    };

    pc.ontrack = (ev) => {
      const el = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement | null;
      if (el) {
        el.srcObject = ev.streams[0];
        el.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      bus.emit("globalCall:state", { state: pc.connectionState, peerId: offerData.from, callId });
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offerData.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    MeshEngine.broadcast("GLOBAL_CALL_ANSWER", {
      to: offerData.from,
      callId,
      from: this.myId,
      answer: pc.localDescription || answer,
      ts: Date.now(),
    });

    const pending = this.pendingIceByCall.get(callId) || [];
    for (const cand of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {}
    }
    this.pendingIceByCall.set(callId, []);
  }

  hangup() {
    try {
      this.pc?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {}
      });
      this.pc?.close();
    } catch {}
    this.pc = null;
    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.localStream = null;
    this.activeCallId = "";
  }

  getCarrierBridgeStatus() {
    return {
      enabled: false,
      required: false,
      canCallAnySim: false,
      freeGaToGa: true,
      noSimRequired: true,
      noSatelliteRequired: true,
      note:
        "Primary path is GridAlive↔GridAlive software voice via MeshEngine signaling + WebRTC; self-hosted LAN hub is optional.",
      futureProviders: ["Twilio", "Telnyx", "Plivo", "Carrier SIP interconnect"],
      productPosition:
        "Public free calling + public earn (RAM/GPU/storage). Carrier voice interop stays optional.",
    };
  }
}

export const globalCall = new GlobalCallEngine();
export default globalCall;
