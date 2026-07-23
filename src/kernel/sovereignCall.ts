/**
 * GridAlive Sovereign Call — 100% in-app, zero Twilio/SID/cloud tokens
 *
 * Freedom model:
 *  · Virtual numbers issued by GridAlive itself (+91 70… software MSISDN)
 *  · Soft tower = your mesh node + Gun peers YOU choose (self-hostable)
 *  · Media = WebRTC peer-to-peer (no carrier, no Twilio)
 *  · Dial ANY digits → resolve on GridAlive directory only
 *  · If handset has no GridAlive yet: sovereign INVITE (sms:/share/QR/link)
 *    so they open browser → become a cell → free call works
 *
 * What we never depend on:
 *  · Twilio / Telnyx / Plivo account SID
 *  · Central GridAlive cloud keys
 *  · Cellular tower RF (illegal / not software)
 *
 * Physics honesty: a closed phone with only a SIM cannot receive
 * software audio until it runs GridAlive (browser/PWA) once — then
 * it is part of YOUR sovereign network forever.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import softTower, { dialPermutations } from "./softTowerEngine";
import globalCall from "./globalCallEngine";
import meshComms from "./meshCommsEngine";
import gridNumberRegistry from "./gridNumberRegistry";

export type SovereignCallResult = {
  ok: boolean;
  mode: "webrtc" | "invite" | "queued" | "failed";
  toId?: string;
  toName?: string;
  virtualNumber?: string;
  pc?: RTCPeerConnection;
  path?: string;
  inviteUrl?: string;
  inviteSmsUri?: string;
  message: string;
  permutations: string[];
};

function nodeId() {
  return MeshEngine.localId || S.get("omni_node_id") || S.get("mesh_id") || `ga_${Date.now().toString(36)}`;
}

function lanInviteBase(): string {
  // Prefer current origin (PC hosting Vite) so phone on same Wi‑Fi can join
  try {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
  } catch {}
  return "http://127.0.0.1:3001";
}

/** Build join link so handset becomes a GridAlive cell without app store */
export function buildJoinInvite(opts: {
  dialedNumber?: string;
  fromName?: string;
  fromVirtual?: string;
}): { url: string; smsUri: string; text: string } {
  const base = lanInviteBase();
  const params = new URLSearchParams();
  params.set("join", "1");
  params.set("sovereign", "1");
  if (opts.dialedNumber) params.set("bind", opts.dialedNumber.replace(/\D/g, ""));
  if (opts.fromVirtual) params.set("from", opts.fromVirtual);
  if (opts.fromName) params.set("fromName", opts.fromName);
  const url = `${base}/?${params.toString()}`;
  const text =
    `${opts.fromName || "GridAlive"} is calling you on free GridAlive network. ` +
    `Open this link on your phone (Chrome), allow mic, stay on page: ${url}`;
  const smsUri = `sms:${opts.dialedNumber || ""}?body=${encodeURIComponent(text)}`;
  return { url, smsUri, text };
}

class SovereignCallEngine {
  start(user?: { id?: string; name?: string; phone?: string }) {
    softTower.start(user);
    try {
      const cell = softTower.getMyCell(user);
      if (cell) {
        if (!globalCall.ready) {
          globalCall.start(nodeId(), cell.name, cell.handle || cell.virtualNumber.slice(-10));
        }
      }
    } catch {}
    // Auto-accept join links (?join=1&bind=phone)
    this.consumeJoinQuery(user);
    return softTower.getMyCell(user);
  }

  /** If user opened invite link on phone, bind number + start tower */
  consumeJoinQuery(user?: { name?: string; phone?: string }) {
    try {
      if (typeof window === "undefined") return;
      const q = new URLSearchParams(window.location.search);
      if (q.get("join") !== "1" && q.get("sovereign") !== "1") return;
      const bind = q.get("bind") || "";
      softTower.start({ name: user?.name || S.get("user_name"), phone: bind || user?.phone });
      if (bind) softTower.bindSimAlias(bind);
      S.set("user_phone", bind || S.get("user_phone", ""));
      S.set("sovereign_joined_via_invite", true);
      bus.emit("sovereign:joined", { bind });
      // Clean URL without reload
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("join");
        u.searchParams.delete("sovereign");
        window.history.replaceState({}, "", u.pathname + u.search);
      } catch {}
    } catch {}
  }

  myNumberDisplay() {
    return softTower.getMyCell()?.display || gridNumberRegistry.getMyNumber()?.display || "";
  }

  /**
   * Place sovereign call — never requires Twilio.
   * 1) Resolve peer on GridAlive soft tower (all digit permutations)
   * 2) WebRTC free call
   * 3) If offline / no app: queue + invite link (sms/share) so they join YOUR network
   */
  async placeCall(
    dial: string,
    opts?: { fromName?: string; preferLocal?: boolean }
  ): Promise<SovereignCallResult> {
    const fromName = opts?.fromName || S.get("user_name") || "GridAlive User";
    const perms = dialPermutations(dial);
    this.start({ name: fromName, phone: S.get("user_phone", "") });

    const me = softTower.getMyCell();
    const resolved = await softTower.resolve(dial);

    if (resolved.method === "self") {
      // Calling own number from PC → invite that handset to join sovereign network
      const inv = buildJoinInvite({
        dialedNumber: dial,
        fromName,
        fromVirtual: me?.virtualNumber,
      });
      this.queueMissed(dial, fromName, inv.url);
      return {
        ok: true,
        mode: "invite",
        permutations: perms,
        inviteUrl: inv.url,
        inviteSmsUri: inv.smsUri,
        message:
          "Yeh aapka number is PC se bind hai. Free sovereign call ke liye phone pe yeh invite link kholo (Chrome) — GridAlive cell ban jaayega, phir call free lagegi. Koi Twilio/SID nahi.",
      };
    }

    if (resolved.ok && resolved.toId) {
      // Live WebRTC on OUR network only
      try {
        meshComms.hangUpCall?.();
        globalCall.hangup?.();
      } catch {}

      if (!opts?.preferLocal) {
        try {
          if (!globalCall.ready) {
            globalCall.start(nodeId(), fromName, me?.handle);
          }
          const { pc } = await globalCall.placeCall(resolved.toId, resolved.toName);
          bus.emit("sovereign:call", { ...resolved, path: "webrtc-global" });
          return {
            ok: true,
            mode: "webrtc",
            toId: resolved.toId,
            toName: resolved.toName,
            virtualNumber: resolved.virtualNumber,
            pc,
            path: "sovereign-webrtc",
            permutations: perms,
            message: `Sovereign call → ${resolved.toName} (${resolved.method}). Zero carrier / zero Twilio.`,
          };
        } catch (e) {
          console.warn("[SovereignCall] global webrtc", e);
        }
      }

      try {
        const result = await meshComms.callWithFallback?.(resolved.toId, { name: resolved.toName });
        if (result?.pc) {
          return {
            ok: true,
            mode: "webrtc",
            toId: resolved.toId,
            toName: resolved.toName,
            pc: result.pc,
            path: `sovereign-${result.method}`,
            permutations: perms,
            message: `Sovereign mesh call (${result.method}).`,
          };
        }
      } catch (e) {
        console.warn("[SovereignCall] mesh webrtc", e);
      }

      return {
        ok: false,
        mode: "failed",
        permutations: perms,
        message: "Peer mil gaya lekin media path fail — mic allow + same mesh/internet.",
      };
    }

    // No peer online → sovereign invite (freedom path without cloud)
    const inv = buildJoinInvite({
      dialedNumber: dial,
      fromName,
      fromVirtual: me?.virtualNumber,
    });
    this.queueMissed(dial, fromName, inv.url);

    // Broadcast paging on mesh so if they open app later they see missed call
    try {
      MeshEngine.broadcast("SOVEREIGN_PAGE", {
        toDial: dial,
        from: me?.virtualNumber,
        fromName,
        inviteUrl: inv.url,
        ts: Date.now(),
      });
    } catch {}

    return {
      ok: true,
      mode: "invite",
      permutations: perms,
      inviteUrl: inv.url,
      inviteSmsUri: inv.smsUri,
      message:
        "Sovereign network: is number pe abhi GridAlive cell online nahi. " +
        "Invite link phone pe kholo (browser) — app store / Twilio / SID ki zaroorat nahi. " +
        "Ek baar join ke baad free call aapke soft tower se lagegi.",
    };
  }

  private queueMissed(dial: string, fromName: string, inviteUrl: string) {
    const q = (S.get("sovereign_call_queue", []) as any[]) || [];
    q.unshift({
      id: `scq_${Date.now().toString(36)}`,
      dial,
      fromName,
      inviteUrl,
      ts: Date.now(),
      status: "paging",
    });
    S.set("sovereign_call_queue", q.slice(0, 100));
  }

  listQueue() {
    return (S.get("sovereign_call_queue", []) as any[]) || [];
  }

  /** Policy text for UI */
  doctrine() {
    return {
      sovereign: true as const,
      needsTwilio: false as const,
      needsCarrierSid: false as const,
      virtualNumbers: true as const,
      freeCallWhenBothOnGridAlive: true as const,
      inviteWhenOffline: true as const,
      manifestoHi:
        "GridAlive khud ka network hai. Virtual number + soft tower inbuilt. Twilio/SID nahi. " +
        "Jis phone pe ek baar browser se GridAlive khul jaye, woh aapke free network ka hissa hai.",
    };
  }
}

export const sovereignCall = new SovereignCallEngine();
export default sovereignCall;
