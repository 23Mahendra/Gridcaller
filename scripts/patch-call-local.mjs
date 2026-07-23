import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "src", "GridCaller.tsx");
let s = fs.readFileSync(p, "utf8");

const startMark = "  /** Local path: signaling via MeshEngine hub bus (WS + HTTP poll) */";
const endMark = "  // Answer local offers (LAN) + mid-call renegotiate (voice ↔ video)";
const start = s.indexOf(startMark);
const end = s.indexOf(endMark);
if (start < 0 || end < 0) {
  console.error("markers not found", start, end);
  process.exit(1);
}

const replacement = `  /** Mesh call: ringback + OFFER/ANSWER/ICE + remote audio */
  const placeCallLocal = async (peerId: string, name: string) => {
    if (isSelfPeer(peerId)) {
      setErr("Cannot call yourself");
      return;
    }
    setErr("");
    resumeAudioContext();
    setCallPeer({ id: peerId, name: name || peerId });
    callPeerRef.current = { id: peerId, name: name || peerId };
    setPhase("outgoing");
    phaseRef.current = "outgoing";
    setSecs(0);
    setVideoOn(!!isVideo);
    setRemoteHasVideo(false);
    setCallMethod("Calling… ringing");
    activePeerIdRef.current = peerId;
    pendingIceRef.current = [];
    remoteStreamRef.current = null;
    try {
      (MeshEngine as any).reconnect?.();
    } catch {}
    try {
      pcRef.current?.close();
      (pcRef.current as any)?._unsub?.();
    } catch {}
    pcRef.current = null;
    try {
      const wantVideo = !!isVideo;
      ensureRemoteAudioEl();
      const stream = await getMicStream(wantVideo);
      localStream.current = stream;
      if (wantVideo && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      const pc = createCallPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      } catch {}
      pc.ontrack = (ev) => {
        const stream0 = ev.streams[0] || new MediaStream([ev.track]);
        bindRemoteMedia(stream0);
      };
      const callStarted = Date.now();
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          stopCallSounds();
          setPhase("active");
          phaseRef.current = "active";
          startedAt.current = Date.now();
          setCallMethod(wantVideo ? "Video call · live" : "Connected · speak now");
          void playRemoteStream(remoteStreamRef.current);
          void setSpeakerphone(true);
        } else if (pc.connectionState === "failed") {
          playFailTone();
          setErr("Call failed — other phone open + Mic allowed?");
          hangup("failed");
        } else if (pc.connectionState === "disconnected") {
          if (Date.now() - callStarted > 12000) hangup("failed");
        }
      };
      const callId = \`gc_\${MeshEngine.localId}_\${peerId}_\${Date.now()}\`;
      activeCallIdRef.current = callId;
      setTimeout(() => {
        if (activeCallIdRef.current === callId && phaseRef.current === "outgoing") {
          setCallMethod("Ringing… waiting for Accept");
        }
      }, 1500);
      setTimeout(() => {
        if (
          activeCallIdRef.current === callId &&
          phaseRef.current !== "active" &&
          pc.connectionState !== "connected"
        ) {
          playFailTone();
          setErr("No answer — other phone must tap green Accept");
          try {
            pc.close();
          } catch {}
          hangup("missed");
        }
      }, 50000);
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          MeshEngine.broadcast("GRIDCALLER_ICE", {
            callId,
            to: peerId,
            candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
          });
        }
      };
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: !!wantVideo,
      });
      await pc.setLocalDescription(offer);
      MeshEngine.broadcast("GRIDCALLER_RING", {
        callId,
        to: peerId,
        fromName: myName,
        video: wantVideo,
      });
      MeshEngine.broadcast("GRIDCALLER_OFFER", {
        callId,
        to: peerId,
        offer: pc.localDescription,
        fromName: myName,
        video: wantVideo,
        handle: S.get("global_call_handle", "") || "",
        phone: S.get("user_phone", "") || "",
      });
      try {
        softTowerHop.start(myName);
        softTowerHop.sendCallSignal(peerId, {
          action: "invite",
          type: "MESH_CALL_INVITE",
          callId,
          fromName: myName,
          video: wantVideo,
        });
      } catch {}

      const unsub = MeshEngine.onMessage(async (msg: any) => {
        if (msg.from === MeshEngine.localId) return;
        if (msg.type === "GRIDCALLER_ANSWER" && msg.data?.callId === callId) {
          try {
            if (msg.data.answer) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.data.answer));
              await flushIceQueue(pc, pendingIceRef.current);
              setCallMethod("Connecting audio…");
            }
          } catch {}
        }
        if (msg.type === "GRIDCALLER_ICE" && msg.data?.callId === callId && msg.data?.candidate) {
          await addIceSafe(pc, msg.data.candidate, pendingIceRef.current);
        }
        if (msg.type === "GRIDCALLER_HANGUP" && msg.data?.callId === callId) {
          hangup("missed");
        }
      });
      (pc as any)._unsub = unsub;
    } catch (e: any) {
      playFailTone();
      setPhase("idle");
      phaseRef.current = "idle";
      setCallPeer(null);
      setErr(e?.message || "Allow Microphone for calls");
    }
  };

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log("[patch] placeCallLocal replaced");
