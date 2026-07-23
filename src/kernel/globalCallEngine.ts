/**
 * Global Call Engine — sovereign software voice (GridAlive ↔ GridAlive)
 *
 * Product law (see sovereignMesh.ts):
 *  · FREE calling — no SIM, no carrier voice bill, no satellite sub
 *  · Cross-network / cross-company: any dumb IP path (Jio data, Airtel Wi‑Fi, abroad)
 *  · Same-network NOT required
 *  · Decentralized Gun signaling → hard for one company to ban (Telegram-class)
 *  · PC · laptop · mobile · browser — all first-class
 *
 * How it works:
 *  1. Presence + WebRTC signaling on public Gun peers (or self-hosted)
 *  2. Media via WebRTC STUN + free TURN (NAT/cellular-data friendly)
 *  3. Dial by GridAlive handle / node id — not by carrier MSISDN
 *
 * Honest limits:
 *  · Callee must run GridAlive (or later PWA wake)
 *  · Bits need SOME path (any IP or local multi-hop fabric) — physics
 *  · Raw SIM without app = optional future PSTN (carriers become partners, not masters)
 *  · We do NOT hijack towers — we make tower-voice obsolete for our users
 */

import Gun from "gun/gun";
import "gun/sea";
import { bus } from "./bus";
import { S } from "./storage";
import { env } from "../env";
import { gunPeersForMesh, iceServersForMesh, useLocalMeshOnly } from "./offlineMode";
import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";

export type GlobalPresence = {
  id: string;
  name: string;
  handle: string; // searchable: name slug or +phone digits
  online: true;
  ts: number;
  platform?: string;
  global: true;
};

export type GlobalCallMode = "local-mesh" | "global-internet";

const DEFAULT_GLOBAL_GUN_PEERS = [
  // Community Gun relays — used only for lightweight signaling/presence (not media)
  "https://gun-manhattan.herokuapp.com/gun",
  "https://gunjs.herokuapp.com/gun",
];

function defaultIceServers(): RTCIceServer[] {
  // Flight / no SIM: host-only ICE (same Wi‑Fi or hotspot) — no STUN/TURN
  if (useLocalMeshOnly()) return iceServersForMesh();
  try {
    if (env.iceServersJson) return JSON.parse(env.iceServersJson);
  } catch {}
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    // TURN only when some internet exists (not flight-only)
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ];
}

function slug(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "")
    .slice(0, 32);
}

class GlobalCallEngine {
  private gun: any = null;
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

  get ready() {
    return this.started && !!this.gun;
  }

  get id() {
    return this.myId;
  }

  get callHandle() {
    return this.handle;
  }

  /** Owner/user can add extra Gun signal peers (self-hosted / partner) */
  getSignalPeers(): string[] {
    // Airplane / offline: local Gun only (works without SIM / cloud)
    if (useLocalMeshOnly()) return gunPeersForMesh([]);
    const custom = S.get("global_gun_peers", "") as string;
    const extra = String(custom || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Prefer custom first, then defaults — empty if force-local
    return gunPeersForMesh(Array.from(new Set([...extra, ...DEFAULT_GLOBAL_GUN_PEERS])));
  }

  setSignalPeers(peersCsv: string) {
    S.set("global_gun_peers", peersCsv);
    // Restart gun with new peers
    this.stop();
    if (this.myId) this.start(this.myId, this.myName, this.handle);
  }

  start(nodeId: string, name: string, handleHint?: string) {
    this.myId = nodeId || S.get("omni_node_id") || S.get("mesh_id") || `ga_${Date.now().toString(36)}`;
    this.myName = name || S.get("user_name") || "User";
    this.handle = slug(handleHint || S.get("global_call_handle", "") || this.myName || this.myId);
    S.set("global_call_handle", this.handle);
    S.set("global_call_id", this.myId);

    const peers = this.getSignalPeers();
    try {
      this.gun = Gun({
        peers,
        localStorage: true,
        radisk: false,
        multicast: false,
      });
    } catch (e) {
      console.warn("[GlobalCall] Gun init failed", e);
      return false;
    }

    this.started = true;
    this.publishPresence();
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => this.publishPresence(), 8000);

    // Incoming offers
    this.gun
      .get("gridalive")
      .get("global")
      .get("webrtc")
      .get("offer")
      .map()
      .on((data: any, key: string) => {
        if (!data || data.to !== this.myId) return;
        if (Date.now() - (data.ts || 0) > 90000) return;
        this.onIncomingOffer(data, key);
      });

    bus.emit("globalCall:ready", {
      id: this.myId,
      handle: this.handle,
      peers: peers.length,
      localOnly: useLocalMeshOnly(),
    });
    console.info(
      "[GlobalCall] ready · handle:",
      this.handle,
      useLocalMeshOnly() ? "· LOCAL/flight (no cloud, no SIM)" : `· peers: ${peers.length}`
    );
    return true;
  }

  stop() {
    this.started = false;
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.hangup();
    try {
      this.gun
        ?.get("gridalive")
        .get("global")
        .get("presence")
        .get(this.myId)
        .put({ online: false, ts: Date.now() });
    } catch {}
  }

  setHandle(handle: string) {
    this.handle = slug(handle);
    S.set("global_call_handle", this.handle);
    this.publishPresence();
  }

  private publishPresence() {
    if (!this.gun || !this.myId) return;
    const p: GlobalPresence = {
      id: this.myId,
      name: this.myName,
      handle: this.handle,
      online: true,
      ts: Date.now(),
      platform: navigator.userAgent.slice(0, 40),
      global: true,
    };
    try {
      this.gun.get("gridalive").get("global").get("presence").get(this.myId).put(p);
      // Index by handle for dial-by-name/phone
      if (this.handle) {
        this.gun.get("gridalive").get("global").get("handles").get(this.handle).put({
          id: this.myId,
          name: this.myName,
          ts: Date.now(),
        });
      }
    } catch {}
  }

  /** Lookup online peer by handle, Grid Number digits, or exact id */
  async resolvePeer(dial: string): Promise<{ id: string; name: string; handle?: string } | null> {
    if (!this.gun) return null;
    const raw = dial.trim();
    const q = slug(dial) || raw.replace(/\D/g, "") || raw;
    if (!q) return null;

    // Direct id match pattern
    if (q.startsWith("ga_") || q.startsWith("omni_") || q.startsWith("user_") || q.startsWith("node_")) {
      return { id: dial.trim(), name: dial.trim() };
    }

    // Grid Number digits → try handles index (short dial published as handle)
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 8) {
      const short = digits.slice(-10);
      const short8 = digits.slice(-8);
      for (const candidate of [short, short8, digits, slug(digits)]) {
        if (!candidate) continue;
        try {
          const hit = await new Promise<{ id: string; name: string; handle?: string } | null>((resolve) => {
            const t = setTimeout(() => resolve(null), 2500);
            try {
              this.gun
                .get("gridalive")
                .get("global")
                .get("handles")
                .get(candidate)
                .once((data: any) => {
                  clearTimeout(t);
                  if (data?.id) resolve({ id: data.id, name: data.name || candidate, handle: candidate });
                  else resolve(null);
                });
            } catch {
              clearTimeout(t);
              resolve(null);
            }
          });
          if (hit) return hit;
        } catch {}
      }
    }

    return new Promise((resolve) => {
      let done = false;
      const finish = (v: any) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const t = setTimeout(() => finish(null), 4000);
      try {
        this.gun
          .get("gridalive")
          .get("global")
          .get("handles")
          .get(q)
          .once((data: any) => {
            clearTimeout(t);
            if (data?.id) finish({ id: data.id, name: data.name || q, handle: q });
            else finish(null);
          });
      } catch {
        clearTimeout(t);
        finish(null);
      }
    });
  }

  /** List recent global presence (best-effort map) */
  listenPresence(cb: (p: GlobalPresence) => void): () => void {
    if (!this.gun) return () => {};
    const handler = (data: any) => {
      if (!data || !data.id || !data.online) return;
      if (Date.now() - (data.ts || 0) > 45000) return;
      if (data.id === this.myId) return;
      cb(data as GlobalPresence);
    };
    this.gun.get("gridalive").get("global").get("presence").map().on(handler);
    return () => {
      try {
        this.gun.get("gridalive").get("global").get("presence").map().off();
      } catch {}
    };
  }

  onIncoming(
    fn: (from: GlobalPresence & { callId: string }, accept: () => void, reject: () => void) => void
  ) {
    this.incomingHandler = fn;
  }

  private onIncomingOffer(data: any, callId: string) {
    if (!this.incomingHandler) return;
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
        try {
          this.gun
            ?.get("gridalive")
            .get("global")
            .get("webrtc")
            .get("answer")
            .get(callId)
            .put({ declined: true, from: this.myId, ts: Date.now() });
        } catch {}
      }
    );
  }

  async placeCall(toId: string, toName?: string): Promise<{ pc: RTCPeerConnection; callId: string }> {
    if (!this.gun) throw new Error("Global call not ready — check internet");
    if (!("RTCPeerConnection" in window)) throw new Error("WebRTC not supported");

    this.hangup();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.localStream = stream;

    if (!tryBeginPeerConnection()) {
      throw new Error("WebRTC budget exhausted; using offline-safe mode");
    }
    const pc = new RTCPeerConnection({ iceServers: defaultIceServers(), iceCandidatePoolSize: 8 });
    this.pc = pc;
    const originalClose = pc.close.bind(pc);
    pc.close = () => {
      endPeerConnection();
      return originalClose();
    };
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const callId = `gcall_${this.myId}_${toId}_${Date.now().toString(36)}`;
    this.activeCallId = callId;

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      try {
        this.gun
          .get("gridalive")
          .get("global")
          .get("webrtc")
          .get("ice")
          .get(callId)
          .get(String(Date.now()))
          .put(JSON.stringify(e.candidate));
      } catch {}
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

    this.gun
      .get("gridalive")
      .get("global")
      .get("webrtc")
      .get("offer")
      .get(callId)
      .put({
        from: this.myId,
        fromName: this.myName,
        fromHandle: this.handle,
        to: toId,
        toName: toName || toId,
        offer: JSON.stringify(offer),
        ts: Date.now(),
      });

    // Answer
    this.gun
      .get("gridalive")
      .get("global")
      .get("webrtc")
      .get("answer")
      .get(callId)
      .on(async (data: any) => {
        if (!data) return;
        if (data.declined) {
          bus.emit("globalCall:state", { state: "declined", peerId: toId, callId });
          return;
        }
        if (!data.answer || pc.remoteDescription) return;
        try {
          await pc.setRemoteDescription(JSON.parse(data.answer));
        } catch (e) {
          console.warn("[GlobalCall] answer", e);
        }
      });

    // Remote ICE
    this.gun
      .get("gridalive")
      .get("global")
      .get("webrtc")
      .get("ice_remote")
      .get(callId)
      .map()
      .on(async (data: any) => {
        if (!data || !pc) return;
        try {
          await pc.addIceCandidate(JSON.parse(data));
        } catch {}
      });

    bus.emit("globalCall:outgoing", { toId, toName, callId });
    return { pc, callId };
  }

  private async acceptCall(callId: string, offerData: any) {
    if (!this.gun) return;
    this.hangup();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.localStream = stream;
    if (!tryBeginPeerConnection()) {
      throw new Error("WebRTC budget exhausted; using offline-safe mode");
    }
    const pc = new RTCPeerConnection({ iceServers: defaultIceServers(), iceCandidatePoolSize: 8 });
    this.pc = pc;
    const originalClose = pc.close.bind(pc);
    pc.close = () => {
      endPeerConnection();
      return originalClose();
    };
    this.activeCallId = callId;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      try {
        this.gun
          .get("gridalive")
          .get("global")
          .get("webrtc")
          .get("ice_remote")
          .get(callId)
          .get(String(Date.now()))
          .put(JSON.stringify(e.candidate));
      } catch {}
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

    await pc.setRemoteDescription(JSON.parse(offerData.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.gun
      .get("gridalive")
      .get("global")
      .get("webrtc")
      .get("answer")
      .get(callId)
      .put({
        from: this.myId,
        answer: JSON.stringify(answer),
        ts: Date.now(),
      });

    this.gun
      .get("gridalive")
      .get("global")
      .get("webrtc")
      .get("ice")
      .get(callId)
      .map()
      .on(async (data: any) => {
        if (!data) return;
        try {
          await pc.addIceCandidate(JSON.parse(data));
        } catch {}
      });
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

  /**
   * Doctrine: GridAlive does NOT depend on carriers.
   * PSTN bridge is optional only for people who never install the app.
   */
  getCarrierBridgeStatus() {
    return {
      enabled: false,
      required: false,
      canCallAnySim: false,
      freeGaToGa: true,
      noSimRequired: true,
      noSatelliteRequired: true,
      note:
        "REAL path: GridAlive↔GridAlive free software call on any device/network. No SIM voice. No tower identity. No satellite bill. Optional PSTN later only for non-app numbers — then telcos tie-up as partners.",
      futureProviders: ["Twilio", "Telnyx", "Plivo", "Carrier SIP interconnect"],
      productPosition:
        "Public free calling + public earn (RAM/GPU/storage). Telco voice becomes optional legacy; we cannot be killed by one cellular company.",
    };
  }
}

export const globalCall = new GlobalCallEngine();
export default globalCall;
