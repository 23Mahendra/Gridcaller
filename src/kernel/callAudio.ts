/**
 * Call sounds — ringtone (incoming) + ringback (outgoing) via Web Audio.
 * No asset files needed; works in Capacitor WebView after user gesture / autoplay policy.
 */

type Mode = "none" | "ring" | "ringback";

let ctx: AudioContext | null = null;
let mode: Mode = "none";
let loopTimer: ReturnType<typeof setInterval> | null = null;
let oscNodes: OscillatorNode[] = [];
let gainNode: GainNode | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function stopOsc() {
  for (const o of oscNodes) {
    try {
      o.stop();
      o.disconnect();
    } catch {}
  }
  oscNodes = [];
  try {
    gainNode?.disconnect();
  } catch {}
  gainNode = null;
}

export function stopCallSounds() {
  mode = "none";
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  stopOsc();
}

function toneBurst(
  freqs: number[],
  durationMs: number,
  volume = 0.22
): void {
  const c = getCtx();
  if (!c) return;
  stopOsc();
  const g = c.createGain();
  g.gain.value = volume;
  g.connect(c.destination);
  gainNode = g;
  const now = c.currentTime;
  for (const f of freqs) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g);
    o.start(now);
    o.stop(now + durationMs / 1000);
    oscNodes.push(o);
  }
  // fade out
  try {
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
  } catch {}
}

/** Incoming phone-style double ring */
export function startRingtone() {
  if (mode === "ring") return;
  stopCallSounds();
  mode = "ring";
  const beat = () => {
    if (mode !== "ring") return;
    toneBurst([480, 620], 400, 0.28);
    setTimeout(() => {
      if (mode !== "ring") return;
      toneBurst([480, 620], 400, 0.28);
    }, 500);
    try {
      navigator.vibrate?.([400, 120, 400, 600]);
    } catch {}
  };
  beat();
  loopTimer = setInterval(beat, 2800);
}

/** Outgoing ringback (network ringing) */
export function startRingback() {
  if (mode === "ringback") return;
  stopCallSounds();
  mode = "ringback";
  const beat = () => {
    if (mode !== "ringback") return;
    toneBurst([440, 480], 1800, 0.14);
  };
  beat();
  loopTimer = setInterval(beat, 4000);
}

/** Short connect beep */
export function playConnectTone() {
  stopCallSounds();
  toneBurst([880], 120, 0.12);
  setTimeout(() => stopOsc(), 150);
}

/** Busy / fail tone */
export function playFailTone() {
  stopCallSounds();
  toneBurst([480, 620], 500, 0.18);
  setTimeout(() => {
    toneBurst([480, 620], 500, 0.18);
  }, 600);
}

export function resumeAudioContext() {
  getCtx();
}
