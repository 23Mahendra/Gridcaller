/**
 * Global call session — stable mesh calling (no instant cut).
 *
 * Fixes:
 *  · Mic: audio-first fallbacks (no crash if camera denied)
 *  · ICE "failed" while still ringing no longer kills the call
 *  · Fail tone only on real errors, not during ring wait
 *  · HANGUP only if callId matches
 *  · Keep UI in "Calling…" until answer / 55s / user End
 */
import { MeshEngine } from "./mesh";
import { S } from "./storage";
import {
  addIceSafe,
  createCallPeerConnection,
  ensureRemoteAudioEl,
  flushIceQueue,
  getMicStream,
  playRemoteStream,
  setSpeakerphone,
} from "./realMedia";
import {
  playConnectTone,
  playFailTone,
  resumeAudioContext,
  startRingback,
  startRingtone,
  stopCallSounds,
} from "./callAudio";
import { nativeCancelIncoming, nativeIncomingCall } from "../plugins/meshCallNative";
import { registerIceRestart, registerInCallProbe } from "./networkHandoff";
import { logMeshEvent, rememberPeer } from "./meshDirectory";
import { deriveLifecycleState } from "./appLifecycle";

export type CallPhase = "idle" | "outgoing" | "incoming" | "active";

export type CallUiState = {
  phase: CallPhase;
  peerId: string;
  peerName: string;
  callId: string;
  method: string;
  error: string;
  video: boolean;
  secs: number;
};

type Listener = (s: CallUiState) => void;

const listeners = new Set<Listener>();
let started = false;
let unsubMesh: (() => void) | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let pendingOffer: any = null;
let pendingIce: RTCIceCandidateInit[] = [];
let tickTimer: ReturnType<typeof setInterval> | null = null;
let ringTimeout: ReturnType<typeof setTimeout> | null = null;
let connectedAt = 0;
let hasRemoteDesc = false;
let callGen = 0; // ignore stale async from previous call
let lifecycleListenerRegistered = false;

let state: CallUiState = {
  phase: "idle",
  peerId: "",
  peerName: "",
  callId: "",
  method: "",
  error: "",
  video: false,
  secs: 0,
};

function emit() {
  for (const fn of listeners) {
    try {
      fn({ ...state });
    } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent("gc-call-ui", { detail: { ...state } }));
  } catch {}
}

function setState(partial: Partial<CallUiState>) {
  state = { ...state, ...partial };
  emit();
}

function refreshLifecycleState() {
  const visible = typeof document !== "undefined" ? document.visibilityState !== "hidden" : true;
  const lifecycle = deriveLifecycleState({
    visible,
    activeCall: state.phase === "active",
    incomingCall: state.phase === "incoming",
    outgoingCall: state.phase === "outgoing",
  });

  if (lifecycle.shouldRing && state.phase === "incoming") {
    try {
      startRingtone();
    } catch {}
  }

  if (lifecycle.shouldReconnect) {
    try {
      (MeshEngine as any).reconnect?.();
    } catch {}
  }
}

function registerLifecycleHooks() {
  if (lifecycleListenerRegistered || typeof window === "undefined") return;
  lifecycleListenerRegistered = true;
  const onVisibility = () => {
    refreshLifecycleState();
    if (document.visibilityState === "visible" && state.phase === "incoming") {
      try {
        resumeAudioContext();
      } catch {}
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisibility);
  window.addEventListener("pageshow", onVisibility);
  window.addEventListener("pagehide", onVisibility);
}

function myIds(): Set<string> {
  const s = new Set<string>();
  const add = (x: any) => {
    const v = String(x || "").trim();
    if (v) s.add(v);
  };
  try {
    add(MeshEngine.localId);
  } catch {}
  add(S.get("mesh_id", ""));
  add(S.get("ga_mesh_id", ""));
  add(S.get("omni_node_id", ""));
  add(S.get("user_id", ""));
  const h = String(S.get("global_call_handle", "") || "").replace(/^@/, "");
  const p = String(S.get("user_phone", "") || "").replace(/\D/g, "");
  const d = String(S.get("gc_test_display_number", "") || "").replace(/\D/g, "");
  if (h) {
    s.add(h);
    const hd = h.replace(/\D/g, "");
    if (hd.length >= 10) s.add(hd.slice(-10));
  }
  if (p.length >= 10) {
    s.add(p);
    s.add(p.slice(-10));
  }
  if (d.length >= 10) {
    s.add(d);
    s.add(d.slice(-10));
  }
  return s;
}

export function isForMe(to: string): boolean {
  if (!to) return false;
  const ids = myIds();
  const raw = String(to).replace(/^@/, "").trim();
  if (!raw) return false;
  const dig = raw.replace(/\D/g, "");
  if (ids.has(raw)) return true;
  if (dig.length >= 10) {
    for (const id of ids) {
      const idDig = String(id).replace(/\D/g, "");
      if (idDig.length >= 10 && idDig.slice(-10) === dig.slice(-10)) return true;
    }
  }
  return false;
}

function cleanupMedia() {
  try {
    pc?.close();
  } catch {}
  pc = null;
  try {
    localStream?.getTracks().forEach((t) => t.stop());
  } catch {}
  localStream = null;
  remoteStream = null;
  pendingOffer = null;
  pendingIce = [];
  hasRemoteDesc = false;
  if (ringTimeout) {
    clearTimeout(ringTimeout);
    ringTimeout = null;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  stopCallSounds();
  try {
    const el = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement | null;
    if (el) el.srcObject = null;
  } catch {}
}

function startSecs() {
  if (tickTimer) clearInterval(tickTimer);
  connectedAt = Date.now();
  tickTimer = setInterval(() => {
    if (state.phase === "active") {
      setState({ secs: Math.floor((Date.now() - connectedAt) / 1000) });
    }
  }, 500);
}

function onRemoteTrack(ev: RTCTrackEvent) {
  try {
    const stream0 = ev.streams[0] || new MediaStream([ev.track]);
    if (!remoteStream) remoteStream = new MediaStream();
    if (ev.track && !remoteStream.getTracks().some((t) => t.id === ev.track.id)) {
      remoteStream.addTrack(ev.track);
    }
    void playRemoteStream(remoteStream);
    void setSpeakerphone(true);
    void playRemoteStream(stream0);
  } catch (e) {
    console.warn("[CallSession] ontrack", e);
  }
}

function wirePc(peer: RTCPeerConnection, role: "caller" | "callee", gen: number) {
  peer.ontrack = onRemoteTrack;
  // Smooth handoff: networkHandoff can restart ICE without killing call
  registerIceRestart(() => {
    if (gen !== callGen || !pc) return;
    try {
      pc.restartIce();
      setState({ method: state.phase === "active" ? "Network switch… keeping call" : state.method });
    } catch {}
  });
  peer.onconnectionstatechange = () => {
    if (gen !== callGen) return; // stale PC
    const st = peer.connectionState;
    if (st === "connected") {
      stopCallSounds();
      try {
        playConnectTone();
      } catch {}
      setState({
        phase: "active",
        method: "Connected — speak now",
        error: "",
      });
      startSecs();
      void playRemoteStream(remoteStream);
      void setSpeakerphone(true);
      logMeshEvent("call-connected", `with ${state.peerName}`, state.peerId);
      rememberPeer(state.peerId, { name: state.peerName, via: "call" });
      return;
    }
    if (st === "disconnected") {
      // Brief path switch (Wi‑Fi roam) — wait, ICE restart, do NOT end
      setState({
        method:
          state.phase === "active"
            ? "Reconnecting audio… hold on"
            : state.method,
      });
      try {
        peer.restartIce?.();
      } catch {}
      return;
    }
    // CRITICAL: do NOT kill call on "failed" while still ringing (no answer yet)
    if (st === "failed") {
      if (state.phase === "active" || hasRemoteDesc) {
        // One soft recovery attempt before fail
        try {
          peer.restartIce?.();
          setState({ method: "Recovering call path…" });
          setTimeout(() => {
            if (gen !== callGen) return;
            if (peer.connectionState === "failed" || peer.connectionState === "closed") {
              try {
                playFailTone();
              } catch {}
              setState({ error: "Call path lost", method: "Failed" });
              endCall("failed");
            }
          }, 4000);
        } catch {
          try {
            playFailTone();
          } catch {}
          endCall("failed");
        }
      } else {
        try {
          peer.restartIce?.();
        } catch {}
        setState({ method: "Ringing… (waiting for other phone)" });
      }
    }
  };
  peer.oniceconnectionstatechange = () => {
    if (gen !== callGen) return;
    const ice = peer.iceConnectionState;
    if (ice === "connected" || ice === "completed") {
      if (state.phase !== "active" && hasRemoteDesc) {
        setState({ phase: "active", method: "Connected — speak now", error: "" });
        startSecs();
        stopCallSounds();
        void playRemoteStream(remoteStream);
        void setSpeakerphone(true);
      }
    }
    if (ice === "disconnected" || ice === "checking") {
      try {
        peer.restartIce?.();
      } catch {}
    }
    // ignore ice "failed" during ring
  };
  peer.onicecandidate = (e) => {
    if (!e.candidate || !state.peerId || !state.callId) return;
    if (gen !== callGen) return;
    try {
      MeshEngine.broadcast("GRIDCALLER_ICE", {
        callId: state.callId,
        to: state.peerId,
        candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
        role,
      });
    } catch {}
  };
}

export function startCallSession() {
  if (started) return;
  registerLifecycleHooks();
  started = true;
  try {
    (MeshEngine as any).start?.();
  } catch {}
  registerInCallProbe(
    () => state.phase === "active" || state.phase === "outgoing" || state.phase === "incoming"
  );
  unsubMesh = MeshEngine.onMessage((msg: any) => {
    void handleSignal(msg);
  });
  console.info("[CallSession] ready");
}

async function handleSignal(msg: any) {
  if (!msg || !msg.type) return;
  if (msg.from && msg.from === MeshEngine.localId) return;

  const t = msg.type;

  if (t === "GRIDCALLER_ICE" && msg.data?.candidate) {
    if (msg.data.callId && state.callId && msg.data.callId !== state.callId) return;
    if (pc) await addIceSafe(pc, msg.data.candidate, pendingIce);
    else pendingIce.push(msg.data.candidate);
    return;
  }

  // Only hang up if callId matches current call (prevents random cut)
  if (t === "GRIDCALLER_HANGUP") {
    if (!state.callId || state.phase === "idle") return;
    if (msg.data?.callId && msg.data.callId !== state.callId) return;
    endCall("remote-hangup");
    return;
  }

  if (t === "GRIDCALLER_RING" && msg.data?.to) {
    if (!isForMe(String(msg.data.to))) return;
    if (state.phase === "active" || state.phase === "outgoing") return;
    showIncoming(
      msg.from,
      msg.data.fromName || msg.fromName || msg.from,
      msg.data.callId || "",
      !!msg.data.video
    );
    return;
  }

  if (t === "GRIDCALLER_OFFER" && msg.data?.to && msg.data?.offer) {
    if (!isForMe(String(msg.data.to))) return;
    if (state.phase === "active") return;
    // If we are outgoing and somehow get offer for us, switch to incoming only if not our call
    if (state.phase === "outgoing" && state.callId && msg.data.callId !== state.callId) {
      /* ignore other */
      return;
    }
    if (state.phase === "outgoing") return; // we are caller
    pendingOffer = msg;
    pendingIce = [];
    showIncoming(
      msg.from,
      msg.data.fromName || msg.fromName || msg.from,
      msg.data.callId || "",
      !!msg.data.video
    );
    return;
  }

  if (t === "GRIDCALLER_ANSWER" && msg.data?.callId === state.callId && msg.data?.answer) {
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.data.answer));
      hasRemoteDesc = true;
      await flushIceQueue(pc, pendingIce);
      setState({ method: "Connecting audio…" });
    } catch (e) {
      console.warn("[CallSession] answer apply", e);
      // don't end call — ICE may still recover
      setState({ method: "Answer received — connecting…" });
    }
  }
}

function showIncoming(peerId: string, peerName: string, callId: string, video: boolean) {
  registerLifecycleHooks();
  resumeAudioContext();
  const cid = callId || state.callId || `in_${Date.now()}`;
  const who = peerName || peerId || "GridCaller";
  try {
    startRingtone();
  } catch {}
  try {
    navigator.vibrate?.([500, 120, 500, 120, 500, 120, 500]);
  } catch {}
  // Full-screen + notification + vibrate even when app background / screen off
  void nativeIncomingCall(who, cid);
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Incoming GridCaller", {
        body: who,
        tag: "gc-call",
        requireInteraction: true,
      });
    } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {}
  try {
    document.title = "📞 Incoming — " + who;
  } catch {}
  setState({
    phase: "incoming",
    peerId,
    peerName: who,
    callId: cid,
    method: "Incoming call — tap Accept",
    error: "",
    video,
    secs: 0,
  });
}

/** Place outbound mesh call — stays on Calling UI until answer */
export async function startOutgoingCall(peerId: string, peerName: string, video = false) {
  if (!peerId) {
    setState({ error: "No peer id", phase: "idle" });
    return;
  }
  if (isForMe(peerId)) {
    setState({ error: "Cannot call yourself — pick the other phone", phase: "idle" });
    return;
  }

  startCallSession();
  callGen += 1;
  const gen = callGen;
  cleanupMedia();
  resumeAudioContext();

  const callId = `gc_${MeshEngine.localId || "me"}_${peerId}_${Date.now()}`;
  setState({
    phase: "outgoing",
    peerId,
    peerName: peerName || peerId,
    callId,
    method: "Calling…",
    error: "",
    video: false, // force audio-first for stability
    secs: 0,
  });

  try {
    startRingback();
  } catch {}

  try {
    (MeshEngine as any).reconnect?.();
  } catch {}

  try {
    ensureRemoteAudioEl();
    // Audio only for first hop — camera optional mid-call (prevents mic+cam deny crash)
    localStream = await getMicStream(false);
    if (gen !== callGen) return;

    pc = createCallPeerConnection();
    wirePc(pc, "caller", gen);
    localStream.getTracks().forEach((t) => {
      try {
        pc!.addTrack(t, localStream!);
      } catch {}
    });

    let offer: RTCSessionDescriptionInit;
    try {
      offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
    } catch {
      offer = await pc.createOffer();
    }
    await pc.setLocalDescription(offer);
    if (gen !== callGen) return;

    const me = S.get("user_name") || S.get("mesh_name") || "GridUser";
    // Fire signals even if SDP is still gathering
    MeshEngine.broadcast("GRIDCALLER_RING", {
      callId,
      to: peerId,
      fromName: me,
      video: false,
    });
    MeshEngine.broadcast("GRIDCALLER_OFFER", {
      callId,
      to: peerId,
      offer: pc.localDescription || offer,
      fromName: me,
      video: false,
      handle: S.get("global_call_handle", "") || "",
      phone: S.get("user_phone", "") || "",
    });

    setState({ method: "Ringing… wait for Accept on other phone" });

    ringTimeout = setTimeout(() => {
      if (gen !== callGen) return;
      if (state.phase === "outgoing" && state.callId === callId) {
        try {
          playFailTone();
        } catch {}
        setState({ error: "No answer — other phone: open GridCaller + Accept" });
        endCall("no-answer");
      }
    }, 55000);
  } catch (e: any) {
    if (gen !== callGen) return;
    console.warn("[CallSession] outgoing failed", e);
    try {
      playFailTone();
    } catch {}
    const msg = String(e?.message || e || "Call failed");
    const mic =
      /Permission|NotAllowed|NotFound|Could not start|getUserMedia|secure/i.test(msg)
        ? "Allow Microphone in app settings, then try again"
        : msg;
    setState({ error: mic, phase: "idle", method: "" });
    cleanupMedia();
  }
}

export async function acceptCall() {
  if (state.phase !== "incoming") return;
  startCallSession();
  callGen += 1;
  const gen = callGen;
  stopCallSounds();
  resumeAudioContext();
  setState({ method: "Answering…", phase: "outgoing" });

  try {
    ensureRemoteAudioEl();
    localStream = await getMicStream(false);
    if (gen !== callGen) return;

    pc = createCallPeerConnection();
    wirePc(pc, "callee", gen);
    localStream.getTracks().forEach((t) => {
      try {
        pc!.addTrack(t, localStream!);
      } catch {}
    });

    const msg = pendingOffer;
    if (!msg?.data?.offer) {
      throw new Error("Call signal incomplete — ask them to call again");
    }
    await pc.setRemoteDescription(new RTCSessionDescription(msg.data.offer));
    hasRemoteDesc = true;
    await flushIceQueue(pc, pendingIce);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    MeshEngine.broadcast("GRIDCALLER_ANSWER", {
      callId: state.callId || msg.data.callId,
      to: state.peerId || msg.from,
      answer: pc.localDescription || answer,
    });
    setState({ method: "Answered — connecting audio…" });
  } catch (e: any) {
    if (gen !== callGen) return;
    console.warn("[CallSession] accept failed", e);
    try {
      playFailTone();
    } catch {}
    const msg = String(e?.message || e || "Accept failed");
    setState({
      error: /Permission|NotAllowed|getUserMedia/i.test(msg)
        ? "Allow Microphone, then Accept again"
        : msg,
    });
    endCall("failed");
  }
}

export function rejectCall() {
  if (state.peerId && state.callId) {
    try {
      MeshEngine.broadcast("GRIDCALLER_HANGUP", {
        callId: state.callId,
        to: state.peerId,
        reason: "reject",
      });
    } catch {}
  }
  endCall("reject");
}

export function endCall(reason = "hangup") {
  callGen += 1; // invalidate in-flight
  if (state.peerId && state.callId && reason !== "remote-hangup" && reason !== "failed") {
    try {
      MeshEngine.broadcast("GRIDCALLER_HANGUP", {
        callId: state.callId,
        to: state.peerId,
        reason,
      });
    } catch {}
  }
  void nativeCancelIncoming();
  const keepErr =
    reason === "no-answer" || reason === "failed" ? state.error : reason === "reject" ? "" : "";
  cleanupMedia();
  try {
    document.title = "GridCaller";
  } catch {}
  setState({
    phase: "idle",
    peerId: "",
    peerName: "",
    callId: "",
    method: "",
    error: keepErr || (reason === "no-answer" ? "No answer" : ""),
    video: false,
    secs: 0,
  });
}

export function getCallState(): CallUiState {
  return { ...state };
}

export function onCallUi(fn: Listener) {
  listeners.add(fn);
  try {
    fn({ ...state });
  } catch {}
  return () => listeners.delete(fn);
}

export function toggleMute(muted: boolean) {
  localStream?.getAudioTracks().forEach((t) => {
    t.enabled = !muted;
  });
}

try {
  if (typeof window !== "undefined") {
    setTimeout(() => startCallSession(), 500);
  }
} catch {}
