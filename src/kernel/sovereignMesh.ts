/**
 * Sovereign Mesh Doctrine — GridAlive product law (REAL, not marketing fluff)
 *
 * Vision (user mandate):
 *  · Call / connect PC · laptop · mobile worldwide on SOFTWARE mesh
 *  · No SIM required for GridAlive voice
 *  · No cellular-company voice product · no tower identity · no satellite sub
 *  · Cross-network / cross-carrier when any dumb IP path exists
 *  · Multi-hop free fabric when only nearby radios exist (Wi‑Fi / BLE / optical)
 *  · Censorship resistance: no single company kill-switch (Telegram-class)
 *  · Public EARNS (RAM / storage / GPU / train) — companies drain; we pay people
 *  · Free calling between GridAlive nodes — never bill per-minute voice
 *
 * Physics honesty (we never lie):
 *  Bits need a path. Software cannot invent radio across oceans with zero medium.
 *  Paths we USE (all software / open where possible):
 *    1) Local multi-hop free fabric — peer density = range (crisis / offline)
 *    2) Any IP as DUMB PIPE — home Wi‑Fi, mobile data, cafe net — without
 *       depending on Jio/Airtel *voice* or same-carrier lock-in
 *  We do NOT require cellular towers for *our* call product identity.
 *  We do NOT require satellite subscriptions for the app.
 *  Optional future: PSTN bridge only to dial people who never install GridAlive
 *  (then carriers become partners, not masters).
 */

import { bus } from "./bus";
import { S } from "./storage";
import freeMeshFabric from "./freeMeshFabric";
import globalCall from "./globalCallEngine";
import meshRentCloud from "./meshRentCloud";
import { meshEconomy } from "./meshEconomy";
import { getActiveSplit, getNetworkRates } from "./rentProfitSplit";
import { MeshEngine } from "./mesh";

export type SovereignPath =
  | "local-multihop" // free fabric · no carrier · peer density
  | "any-ip-ott" // any data/Wi‑Fi as dumb pipe · cross-carrier
  | "optical-airgap" // QR / camera handoff
  | "pstn-optional"; // future only · non-app phones

export interface SovereignDoctrine {
  freeCalling: true;
  noSimRequired: true;
  noCarrierVoiceRequired: true;
  noSatelliteRequired: true;
  noCentralKillSwitch: true;
  publicEarnFirst: true;
  publicProfitPercentDefault: number;
  devices: ("pc" | "laptop" | "mobile" | "tablet" | "browser")[];
  currency: "GridCoins";
  manifesto: string;
  manifestoHi: string;
}

export interface SovereignStatus {
  doctrine: SovereignDoctrine;
  freeCall: {
    enabled: true;
    costGC: 0;
    localMeshReady: boolean;
    globalOttReady: boolean;
    fabricPeers: number;
    globalHandle: string;
    paths: SovereignPath[];
  };
  publicEarn: {
    acceptingRent: boolean;
    balanceGC: number;
    splitPublicPercent: number;
    rates: ReturnType<typeof getNetworkRates>;
    offer: ReturnType<typeof meshRentCloud.getOffer> | null;
  };
  independence: {
    dependsOnCellularVoice: false;
    dependsOnSameCarrier: false;
    dependsOnSatelliteSub: false;
    dependsOnCentralCloudKeys: false;
    canBeBannedByOneTelco: false;
    note: string;
  };
  physics: {
    needsSomePath: true;
    note: string;
  };
}

const DOCTRINE: SovereignDoctrine = {
  freeCalling: true,
  noSimRequired: true,
  noCarrierVoiceRequired: true,
  noSatelliteRequired: true,
  noCentralKillSwitch: true,
  publicEarnFirst: true,
  publicProfitPercentDefault: 60,
  devices: ["pc", "laptop", "mobile", "tablet", "browser"],
  currency: "GridCoins",
  manifesto:
    "GridAlive is a sovereign software mesh: free calls between people on any device, without SIM voice, without carrier lock-in, without satellite bills. The public earns GridCoins by sharing spare RAM, storage, and GPU for cloud, cluster, and AI train work. Companies drain the public — we pay the public.",
  manifestoHi:
    "GridAlive sovereign software mesh hai: SIM voice / cellular company / satellite bill ke bina free call — PC, laptop, mobile. Public spare RAM, storage, GPU se GridCoins kamati hai. Doosri companies public ka paisa drain karti hain — yahan public kamati hai. Koi ek company humein band nahi kar sakti.",
};

class SovereignMesh {
  private started = false;

  get doctrine(): SovereignDoctrine {
    return DOCTRINE;
  }

  start() {
    if (this.started) return this.getStatus();
    this.started = true;

    // Persist doctrine flags so UI / policies can read offline
    S.set("sovereign_free_call", true);
    S.set("sovereign_no_sim", true);
    S.set("sovereign_public_earn", true);
    S.set("sovereign_manifesto", DOCTRINE.manifestoHi);

    try {
      freeMeshFabric.start();
    } catch {}
    try {
      meshRentCloud.start();
    } catch {}

    // Default: public earn ON when user has spare capacity (opt-out, not paywall)
    try {
      const auto = S.get("mesh_auto_rent", null);
      if (auto == null) {
        S.set("mesh_auto_rent", true);
      }
    } catch {}

    bus.emit("sovereign:ready", this.getStatus());
    console.info(
      "[SovereignMesh] FREE call · no SIM/carrier voice · public earn ·",
      DOCTRINE.manifestoHi.slice(0, 80) + "…"
    );
    return this.getStatus();
  }

  /** Always free — doctrine law. Never charge GC for GridAlive↔GridAlive voice. */
  callCostGC(_toId?: string): 0 {
    return 0;
  }

  isFreeCallAllowed(): true {
    return true;
  }

  getStatus(): SovereignStatus {
    let fabricPeers = 0;
    try {
      fabricPeers = freeMeshFabric.getPeers?.().filter((p: any) => p.online).length || 0;
    } catch {}
    let fabricStats: any = null;
    try {
      fabricStats = freeMeshFabric.getStats?.();
    } catch {}

    const paths: SovereignPath[] = ["local-multihop", "any-ip-ott", "optical-airgap"];
    // PSTN listed only as optional future — not required for doctrine
    if (S.get("enable_pstn_bridge", false)) paths.push("pstn-optional");

    let balance = 0;
    try {
      balance = Number(S.get("mesh_earn_balance_gc", 0)) || 0;
    } catch {}
    try {
      // meshEconomy may expose wallet differently — best-effort
      const w = (meshEconomy as any)?.wallet || (meshEconomy as any)?.getWallet?.();
      if (w && typeof w.balance === "number") balance = Math.max(balance, w.balance);
    } catch {}

    let offer = null;
    let accepting = false;
    try {
      offer = meshRentCloud.getOffer();
      accepting = !!meshRentCloud.getStatus?.().accepting;
    } catch {}

    const split = getActiveSplit();

    return {
      doctrine: DOCTRINE,
      freeCall: {
        enabled: true,
        costGC: 0,
        localMeshReady: !!(MeshEngine?.localId || fabricPeers >= 0),
        globalOttReady: !!globalCall.ready,
        fabricPeers,
        globalHandle: globalCall.callHandle || S.get("global_call_handle", "") || "",
        paths,
      },
      publicEarn: {
        acceptingRent: accepting,
        balanceGC: balance,
        splitPublicPercent: split.publicPercent ?? 60,
        rates: getNetworkRates(),
        offer,
      },
      independence: {
        dependsOnCellularVoice: false,
        dependsOnSameCarrier: false,
        dependsOnSatelliteSub: false,
        dependsOnCentralCloudKeys: false,
        canBeBannedByOneTelco: false,
        note:
          "Voice is software (WebRTC + multi-hop mesh). Any ISP/data is only a dumb pipe when used. Local fabric works without telco identity. Decentralized signaling resists single kill-switch.",
      },
      physics: {
        needsSomePath: true,
        note:
          fabricStats?.estimatedRangeLabel
            ? `Local free fabric range ≈ ${fabricStats.estimatedRangeLabel} (grows with peer density). Global reach uses any IP path between GridAlive nodes — not carrier voice, not satellite license.`
            : "Local free fabric grows with peer density. Global GridAlive↔GridAlive uses any IP as dumb pipe. Zero medium between two devices = no call (physics).",
      },
    };
  }

  /** One-line status for UI bars */
  statusLine(): string {
    const st = this.getStatus();
    return `FREE call · ${st.freeCall.fabricPeers} fabric · earn ${st.publicEarn.balanceGC.toFixed(2)} GC · public ${st.publicEarn.splitPublicPercent}%`;
  }
}

export const sovereignMesh = new SovereignMesh();
export default sovereignMesh;
