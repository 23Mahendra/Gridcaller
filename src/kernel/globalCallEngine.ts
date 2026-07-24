/**
 * Global Call Engine — hub-signaled sovereign voice (GridAlive ↔ GridAlive)
 *
 * Signaling path:
 *  - Presence/lookup via hub /api/mesh/*
 *  - Offer/answer/ice via MeshEngine (hub-backed ws/http bus)
 *  - Optional Gun can still be used by other modules, but this call path is hub-first
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import { useLocalMeshOnly } from "./offlineMode";
import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";
import { fetchHubMeshPeers, resolveHubHttp, resolveMeshTarget } from "./meshHubConfig";
import { getWebRtcIceServers } from "./webrtcConfig";

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

function slug(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "")
    .slice(0, 32);
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
    // kept for compatibility; signaling is now hub-backed
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
      signaling: "hub-mesh",
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
      phone: String(S.get("user_phone", "") || "").replace(/\D/g, ""),
      displayNumber:
        String(S.get("gc_test_display_number", "") || "").trim() ||
        this.handle ||
        String(S.get("user_phone", "") || "").replace(/\D/g, ""),
      hasLlm: false,
      ts: Date.now(),
    };
    try {
      const hub = resolveHubHttp().replace(/\/$/, "");
      await fetch(`${hub}/api/mesh/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
    } catch {}
  }

  async resolvePeer(dial: string): Promise<{ id: string; name: string; handle?: string } | null> {
    const raw = String(dial || "").trim();
    if (!raw) return null;
    const q = slug(raw) || raw.replace(/\D/g, "") || raw;
    if (!q) return null;
    if (q.startsWith("ga_") || q.startsWith("omni_") || q.startsWith("user_") || q.startsWith("node_")) {
      return { id: raw, name: raw };
    }
    const hit = await resolveMeshTarget(raw);
    if (hit?.id) {
      return { id: hit.id, name: hit.name || hit.id, handle: hit.handle };
    }
    return null;
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

  private async emitPresenceNow() {
    if (!this.started) return;
    try {
      const peers = await fetchHubMeshPeers();
      const now = Date.now();
      for (const p of peers) {
        if (!p?.id || p.id === this.myId || p.id === "hub-pc") continue;
        const gp: GlobalPresence = {
          id: p.id,
          name: p.name || p.id,
          handle: p.handle || "",
          online: true,
          ts: p.lastSeen || now,
          global: true,
        };
        for (const fn of this.presenceListeners) {
          try {
            fn(gp);
          } catch {}
        }
      }
    } catch {}
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
    const iceServers = await getWebRtcIceServers();
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
        "Primary path is GridAlive↔GridAlive software voice via self-hosted hub signaling + WebRTC.",
      futureProviders: ["Twilio", "Telnyx", "Plivo", "Carrier SIP interconnect"],
      productPosition:
        "Public free calling + public earn (RAM/GPU/storage). Carrier voice interop stays optional.",
    };
  }
}

export const globalCall = new GlobalCallEngine();
export default globalCall;
