/**
 * Real remote media + WebRTC helpers for Android WebView + desktop.
 */

import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";

export function ensureRemoteAudioEl(): HTMLAudioElement {
  let el = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement("audio");
    el.id = "meshCommsRemoteAudio";
    document.body.appendChild(el);
  }
  el.autoplay = true;
  el.controls = false;
  el.muted = false;
  el.volume = 1;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.style.cssText =
    "position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  return el;
}

/** Attach remote MediaStream and force play (Android needs retries) */
export async function playRemoteStream(stream: MediaStream | null | undefined): Promise<void> {
  if (!stream) return;
  const el = ensureRemoteAudioEl();
  try {
    stream.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length) {
      const aStream = new MediaStream(audioTracks);
      if (el.srcObject !== aStream) el.srcObject = aStream;
    } else if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    el.muted = false;
    el.volume = 1;
    await el.play();
  } catch {
    await new Promise((r) => setTimeout(r, 150));
    try {
      el.muted = false;
      el.volume = 1;
      await el.play();
    } catch (e) {
      console.warn("[realMedia] remote play failed", e);
      // last resort: replay after gesture
      setTimeout(() => {
        el.play().catch(() => {});
      }, 400);
    }
  }
}

export async function setSpeakerphone(on: boolean): Promise<{ ok: boolean; message: string }> {
  const el = ensureRemoteAudioEl() as HTMLAudioElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  el.muted = false;
  el.volume = 1;
  try {
    if (typeof el.setSinkId === "function") {
      if (on && navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outs = devices.filter((d) => d.kind === "audiooutput");
        const speaker =
          outs.find((d) => /speaker|loud/i.test(d.label)) ||
          outs.find((d) => d.deviceId === "default") ||
          outs[0];
        if (speaker?.deviceId) {
          await el.setSinkId(speaker.deviceId);
          return { ok: true, message: "Speaker on" };
        }
      }
      await el.setSinkId("");
      return { ok: true, message: on ? "Speaker (default)" : "Earpiece / default" };
    }
  } catch (e: any) {
    return { ok: false, message: e?.message || "Output switch not supported" };
  }
  try {
    await el.play();
  } catch {}
  return { ok: true, message: on ? "Volume max" : "Default audio" };
}

export function createCallPeerConnection(): RTCPeerConnection {
  if (!tryBeginPeerConnection()) {
    throw new Error("WebRTC budget exhausted; using offline-safe mode");
  }
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
    iceCandidatePoolSize: 8,
    // all = host (same Wi‑Fi) + srflx + relay
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  });
  const originalClose = pc.close.bind(pc);
  pc.close = () => {
    endPeerConnection();
    return originalClose();
  };
  return pc;
}

/** Safe addIceCandidate with queue until remote description is set */
export async function addIceSafe(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit | null | undefined,
  queue: RTCIceCandidateInit[]
): Promise<void> {
  if (!candidate) return;
  if (!pc.remoteDescription) {
    queue.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn("[realMedia] addIce", e);
  }
}

export async function flushIceQueue(
  pc: RTCPeerConnection,
  queue: RTCIceCandidateInit[]
): Promise<void> {
  while (queue.length) {
    const c = queue.shift();
    if (!c) continue;
    try {
      await pc.addIceCandidate(c);
    } catch {}
  }
}

/** Mic stream with fallbacks — never throw just because camera failed */
export async function getMicStream(video = false): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone API not available in this WebView");
  }
  const audioNice = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } as MediaTrackConstraints;

  // 1) Prefer audio-only (stable for voice call)
  if (!video) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioNice, video: false });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  // 2) Video requested — try A/V, fall back to audio-only (no crash)
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: audioNice,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }
}
