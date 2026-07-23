import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "src", "GridCaller.tsx");
let s = fs.readFileSync(p, "utf8");

const startMark = "  // Answer local offers (LAN) + mid-call renegotiate (voice ↔ video)";
const endMark = "  const hangup = (reason = \"hangup\") => {";
const start = s.indexOf(startMark);
const end = s.indexOf(endMark);
if (start < 0 || end < 0) {
  console.error("markers", start, end);
  process.exit(1);
}

const replacement = `  // Incoming RING + OFFER — fullscreen Accept UI + ringtone + WebRTC answer
  useEffect(() => {
    const unsub = MeshEngine.onMessage(async (msg: any) => {
      if (msg.from && msg.from === MeshEngine.localId) return;

      // Early ring (before SDP) — open UI immediately
      if (msg.type === "GRIDCALLER_RING" && msg.data?.to) {
        if (!isCallAddressedToMe(String(msg.data.to))) return;
        if (blocked.includes(msg.from)) return;
        if (phaseRef.current === "active" || phaseRef.current === "outgoing") return;
        const peer = {
          id: msg.from,
          name: msg.data.fromName || msg.fromName || msg.from,
        };
        setCallPeer(peer);
        callPeerRef.current = peer;
        setPhase("incoming");
        phaseRef.current = "incoming";
        setCallMethod("Incoming call — tap Accept");
        activePeerIdRef.current = msg.from;
        activeCallIdRef.current = msg.data.callId || activeCallIdRef.current;
        resumeAudioContext();
        startRingtone();
        try {
          navigator.vibrate?.([400, 100, 400, 100, 400]);
        } catch {}
        return;
      }

      // ICE for current call (caller or callee)
      if (msg.type === "GRIDCALLER_ICE" && msg.data?.candidate) {
        const cid = msg.data.callId;
        if (cid && activeCallIdRef.current && cid !== activeCallIdRef.current) return;
        const pc = pcRef.current;
        if (pc) await addIceSafe(pc, msg.data.candidate, pendingIceRef.current);
        return;
      }

      if (msg.type === "GRIDCALLER_HANGUP") {
        if (msg.data?.callId && activeCallIdRef.current && msg.data.callId !== activeCallIdRef.current) return;
        hangup("missed");
        return;
      }

      if (msg.type === "GRIDCALLER_RENEGOTIATE" && msg.data?.offer) {
        if (!isCallAddressedToMe(String(msg.data.to || ""))) return;
        const pc = pcRef.current;
        if (pc && pc.signalingState !== "closed") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            MeshEngine.broadcast("GRIDCALLER_ANSWER", {
              callId: msg.data.callId || activeCallIdRef.current,
              to: msg.from,
              answer,
            });
            if (msg.data.video) setRemoteHasVideo(true);
          } catch {}
        }
        return;
      }

      if (msg.type !== "GRIDCALLER_OFFER" || !msg.data?.to) return;
      if (!isCallAddressedToMe(String(msg.data.to))) return;
      if (blocked.includes(msg.from)) return;

      // Store full offer for Accept (user gesture)
      pendingOfferRef.current = msg;
      pendingIceRef.current = [];
      const peer = {
        id: msg.from,
        name: msg.data.fromName || msg.fromName || msg.from,
      };
      setCallPeer(peer);
      callPeerRef.current = peer;
      setPhase("incoming");
      phaseRef.current = "incoming";
      setCallMethod("Incoming call — tap green Accept");
      activePeerIdRef.current = msg.from;
      activeCallIdRef.current = msg.data.callId || "";
      resumeAudioContext();
      startRingtone();
      try {
        navigator.vibrate?.([500, 120, 500, 120, 500]);
      } catch {}

      const offerWantsVideo = !!msg.data.video;
      acceptRef.current = async () => {
        try {
          stopCallSounds();
          resumeAudioContext();
          ensureRemoteAudioEl();
          setCallMethod("Connecting…");
          setPhase("outgoing"); // connecting
          phaseRef.current = "outgoing";

          const stream = await getMicStream(offerWantsVideo);
          localStream.current = stream;
          setVideoOn(offerWantsVideo);
          if (offerWantsVideo && localVideoRef.current) {
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
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === "connected") {
              stopCallSounds();
              setPhase("active");
              phaseRef.current = "active";
              startedAt.current = Date.now();
              setCallMethod(offerWantsVideo ? "Video call · live" : "Connected · speak now");
              void playRemoteStream(remoteStreamRef.current);
              void setSpeakerphone(true);
            } else if (pc.connectionState === "failed") {
              playFailTone();
              setErr("Audio connect failed");
              hangup("failed");
            }
          };
          pc.onicecandidate = (e) => {
            if (e.candidate) {
              MeshEngine.broadcast("GRIDCALLER_ICE", {
                callId: msg.data.callId,
                to: msg.from,
                candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
              });
            }
          };
          const offer = pendingOfferRef.current?.data?.offer || msg.data.offer;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          await flushIceQueue(pc, pendingIceRef.current);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          MeshEngine.broadcast("GRIDCALLER_ANSWER", {
            callId: msg.data.callId,
            to: msg.from,
            answer: pc.localDescription,
          });
          setCallMethod("Answered — connecting audio…");
        } catch (e: any) {
          playFailTone();
          setErr(e?.message || "Accept failed — allow Microphone");
          hangup("failed");
        }
      };
      rejectRef.current = () => {
        try {
          MeshEngine.broadcast("GRIDCALLER_HANGUP", {
            callId: msg.data.callId,
            to: msg.from,
          });
        } catch {}
        hangup("missed");
      };
    });
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [blocked]);

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log("[patch] incoming answer handler replaced");
