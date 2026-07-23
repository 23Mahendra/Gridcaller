// ═══════════════════════════════════════════════════════════════════
// GRIDALIVE — Adaptive Bitrate Controller for WebRTC Audio (Opus)
// ═══════════════════════════════════════════════════════════════════
//
// Monitors RTCStatsReport every POLL_INTERVAL_MS and adjusts the
// Opus encoder's maxBitrate via RTCRtpSender.setParameters().
//
// Bitrate tiers (Opus):
//   "voice_nb"  — 8 kbps   : narrow-band, works on GPRS (< 50 Kbps)
//   "voice_wb"  — 16 kbps  : wideband HD voice (50–200 Kbps)
//   "voice_swb" — 32 kbps  : super-wideband (> 200 Kbps)
//   "music"     — 64 kbps  : near-lossless (> 500 Kbps)
//
// Selection is based on:
//   - Available downlink bandwidth reported by RTCStatsReport
//   - Current packet loss ratio
//   - Current round-trip time
//
// Usage:
//   const abr = new AdaptiveBitrateController(peerConnection);
//   abr.start();
//   // later:
//   abr.stop();
// ═══════════════════════════════════════════════════════════════════

import { bus } from "./bus";

export type AudioQualityTier = "voice_nb" | "voice_wb" | "voice_swb" | "music";

interface TierConfig {
  maxBitrateBps: number;
  label: string;
  minBwKbps: number;   // minimum downlink to use this tier
  maxLossRatio: number; // maximum tolerated packet loss
  maxRttMs: number;    // maximum tolerated RTT
}

const TIERS: Record<AudioQualityTier, TierConfig> = {
  voice_nb: {
    maxBitrateBps: 8_000,
    label: "8 kbps (Narrow-band)",
    minBwKbps: 10,
    maxLossRatio: 1.0,
    maxRttMs: 5000,
  },
  voice_wb: {
    maxBitrateBps: 16_000,
    label: "16 kbps (Wideband)",
    minBwKbps: 50,
    maxLossRatio: 0.10,
    maxRttMs: 800,
  },
  voice_swb: {
    maxBitrateBps: 32_000,
    label: "32 kbps (Super-wideband)",
    minBwKbps: 200,
    maxLossRatio: 0.05,
    maxRttMs: 400,
  },
  music: {
    maxBitrateBps: 64_000,
    label: "64 kbps (Full-band)",
    minBwKbps: 500,
    maxLossRatio: 0.01,
    maxRttMs: 150,
  },
};

const POLL_INTERVAL_MS = 3000;
// Number of consecutive polls a tier must be stable before upgrading
const UPGRADE_STABILITY_COUNT = 2;

export class AdaptiveBitrateController {
  private _pc: RTCPeerConnection;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _currentTier: AudioQualityTier = "voice_wb";
  private _stableCount = 0;
  private _lastPacketsLost = 0;
  private _lastPacketsSent = 0;
  private _listeners: ((tier: AudioQualityTier, bps: number) => void)[] = [];

  constructor(pc: RTCPeerConnection) {
    this._pc = pc;
  }

  get currentTier(): AudioQualityTier { return this._currentTier; }

  onTierChange(fn: (tier: AudioQualityTier, bps: number) => void): () => void {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  private async _poll() {
    try {
      const stats = await this._pc.getStats();
      let bwKbps = 0;
      let rttMs = 0;
      let lossRatio = 0;
      let packetsSentDelta = 0;
      let packetsLostDelta = 0;

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          // availableOutgoingBitrate is in bps
          if (report.availableOutgoingBitrate) {
            bwKbps = Math.max(bwKbps, report.availableOutgoingBitrate / 1000);
          }
          if (report.currentRoundTripTime) {
            rttMs = Math.max(rttMs, report.currentRoundTripTime * 1000);
          }
        }
        if (report.type === "outbound-rtp" && report.kind === "audio") {
          const sentNow = report.packetsSent ?? 0;
          const lostNow = (report as any).packetsLost ?? 0;
          packetsSentDelta = Math.max(0, sentNow - this._lastPacketsSent);
          packetsLostDelta = Math.max(0, lostNow - this._lastPacketsLost);
          this._lastPacketsSent = sentNow;
          this._lastPacketsLost = lostNow;
        }
      });

      if (packetsSentDelta > 0) {
        lossRatio = packetsLostDelta / (packetsSentDelta + packetsLostDelta);
      }

      // Also factor in navigator.connection.downlink if RTCStats has no data yet
      if (bwKbps === 0) {
        const conn = (navigator as any).connection;
        if (conn?.downlink) bwKbps = conn.downlink * 1000; // downlink is in Mbps
      }

      this._selectTier(bwKbps, rttMs, lossRatio);
    } catch (e) {
      // Stats not yet available — keep current tier
    }
  }

  private _selectTier(bwKbps: number, rttMs: number, lossRatio: number) {
    // Pick the highest quality tier we can afford
    const candidates: AudioQualityTier[] = ["music", "voice_swb", "voice_wb", "voice_nb"];
    let target: AudioQualityTier = "voice_nb";

    for (const tier of candidates) {
      const cfg = TIERS[tier];
      if (
        (bwKbps === 0 || bwKbps >= cfg.minBwKbps) &&
        lossRatio <= cfg.maxLossRatio &&
        (rttMs === 0 || rttMs <= cfg.maxRttMs)
      ) {
        target = tier;
        break;
      }
    }

    if (target === this._currentTier) {
      this._stableCount++;
      return;
    }

    const isUpgrade = TIERS[target].maxBitrateBps > TIERS[this._currentTier].maxBitrateBps;
    if (isUpgrade && this._stableCount < UPGRADE_STABILITY_COUNT) {
      // Wait for stable conditions before upgrading
      this._stableCount++;
      return;
    }

    this._stableCount = 0;
    this._currentTier = target;
    this._applyTier(target);
  }

  private async _applyTier(tier: AudioQualityTier) {
    const cfg = TIERS[tier];
    const sender = this._pc.getSenders().find(s => s.track?.kind === "audio");
    if (!sender) return;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = cfg.maxBitrateBps;
      await sender.setParameters(params);
      this._listeners.forEach(fn => fn(tier, cfg.maxBitrateBps));
      bus.emit("adaptiveBitrate:tierChange", {
        tier,
        maxBitrateBps: cfg.maxBitrateBps,
        label: cfg.label,
      });
      console.info(`[ABR] Audio tier → ${cfg.label}`);
    } catch (e) {
      // setParameters not supported on this browser/version — silently ignore
      console.warn("[ABR] setParameters failed:", e);
    }
  }

  /** Force a specific tier (for manual override / testing) */
  async forceTier(tier: AudioQualityTier) {
    this._currentTier = tier;
    this._stableCount = 0;
    await this._applyTier(tier);
  }
}

/** Convenience: create and start an ABR controller on a PeerConnection */
export function attachAdaptiveBitrate(pc: RTCPeerConnection): AdaptiveBitrateController {
  const abr = new AdaptiveBitrateController(pc);
  // Start after ICE completes
  const onState = () => {
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      abr.start();
      pc.removeEventListener("iceconnectionstatechange", onState);
    }
    if (pc.iceConnectionState === "closed" || pc.iceConnectionState === "failed") {
      abr.stop();
      pc.removeEventListener("iceconnectionstatechange", onState);
    }
  };
  pc.addEventListener("iceconnectionstatechange", onState);
  return abr;
}

export default AdaptiveBitrateController;
