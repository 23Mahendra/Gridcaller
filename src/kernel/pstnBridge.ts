/**
 * Client PSTN bridge — call / SMS any real cellular number from GridCaller
 *
 * Flow:
 *  1) Soft tower free mesh (if peer runs GridCaller)
 *  2) PSTN via hub /api/pstn/* (Twilio when TWILIO_* set)
 *  3) OS tel: / sms: fallback
 */

import { bus } from "./bus";
import { S } from "./storage";

export type PstnStatus = {
  configured: boolean;
  testMode: boolean;
  provider: string;
  from?: string;
  note?: string;
  capability?: {
    freeMeshNeedsApp: boolean;
    pstnAnyNumber: boolean;
    handsetNeedsGridAlive: boolean;
    smsAnyNumber?: boolean;
  };
};

export type PstnCallResult = {
  ok: boolean;
  dryRun?: boolean;
  provider?: string;
  to?: string;
  callSid?: string;
  status?: string;
  message?: string;
  error?: string;
  permutations?: string[];
  path?: "pstn" | "tel" | "none";
};

export type PstnSmsResult = {
  ok: boolean;
  dryRun?: boolean;
  provider?: string;
  to?: string;
  sid?: string;
  status?: string;
  message?: string;
  error?: string;
  permutations?: string[];
  path?: "pstn" | "sms" | "none";
};

function digits(s: string) {
  return String(s || "").replace(/\D/g, "");
}

export function clientPhonePerms(input: string): string[] {
  const d = digits(input);
  const out: string[] = [];
  const add = (x: string) => {
    if (x && !out.includes(x)) out.push(x);
  };
  if (d.length === 10 && /^[6-9]/.test(d)) {
    add("+91" + d);
    add("91" + d);
    add(d);
  }
  if (d.startsWith("91") && d.length === 12) {
    add("+" + d);
    add(d);
    add(d.slice(2));
  }
  if (d.length > 10) add("+" + d.replace(/^\+/, ""));
  if (input.trim().startsWith("+")) add("+" + d);
  return out.length ? out : d ? ["+" + d] : [];
}

export function looksLikePhoneNumber(input: string): boolean {
  const d = digits(input);
  return d.length >= 10 && d.length <= 15;
}

function hubBases(): string[] {
  const list: string[] = [];
  try {
    const h = localStorage.getItem("gc_hub_http");
    if (h) list.push(h.replace(/\/$/, ""));
  } catch {}
  if (typeof window !== "undefined") {
    if (window.location?.port === "8765") list.push(window.location.origin);
    list.push(`${window.location.protocol}//${window.location.hostname}:8765`);
  }
  list.push("http://127.0.0.1:8765");
  list.push("");
  return [...new Set(list.filter((x) => x !== undefined))];
}

class PstnBridgeClient {
  private lastStatus: PstnStatus | null = null;

  async getStatus(): Promise<PstnStatus> {
    for (const base of hubBases()) {
      try {
        const r = await fetch(`${base}/api/pstn/status`, { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          this.lastStatus = await r.json();
          return this.lastStatus!;
        }
      } catch {}
    }
    this.lastStatus = {
      configured: false,
      testMode: true,
      provider: "offline",
      note: "Hub PSTN API unreachable — npm run hub. Set TWILIO_* for live cellular.",
      capability: {
        freeMeshNeedsApp: true,
        pstnAnyNumber: false,
        handsetNeedsGridAlive: false,
        smsAnyNumber: false,
      },
    };
    return this.lastStatus;
  }

  /**
   * Call any real cellular number.
   * With Twilio: handset does NOT need GridCaller.
   * Without keys: dry-run + optional tel: dialer.
   */
  async callAnyNumber(
    to: string,
    opts?: { callerName?: string; message?: string; allowTelFallback?: boolean }
  ): Promise<PstnCallResult> {
    const perms = clientPhonePerms(to);
    if (!perms.length) return { ok: false, error: "Invalid number", path: "none" };

    const body = {
      to: perms[0],
      callerName: opts?.callerName || S.get("user_name") || "GridCaller",
      message:
        opts?.message ||
        `Hello, this is a GridCaller virtual-number call from ${opts?.callerName || "a GridCaller user"}.`,
      virtualFrom: S.get("gc_test_display_number", "") || S.get("user_phone", "") || "",
    };

    let lastErr = "";
    for (const base of hubBases()) {
      try {
        const r = await fetch(`${base}/api/pstn/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        const data = (await r.json()) as PstnCallResult;
        if (data.ok) {
          bus.emit("pstn:call", data);
          S.set("pstn_last_call", { ...data, ts: Date.now() });
          return { ...data, path: "pstn", permutations: data.permutations || perms };
        }
        lastErr = data.error || "pstn failed";
      } catch (e: any) {
        lastErr = e?.message || "unreachable";
      }
    }

    if (opts?.allowTelFallback !== false) {
      return this.telFallback(perms[0], lastErr);
    }
    return { ok: false, error: lastErr || "PSTN unreachable", path: "none", permutations: perms };
  }

  /**
   * SMS any real cellular number via hub (Twilio) or OS sms: URI.
   */
  async sendSmsAnyNumber(
    to: string,
    text: string,
    opts?: { fromName?: string; allowSmsFallback?: boolean }
  ): Promise<PstnSmsResult> {
    const perms = clientPhonePerms(to);
    if (!perms.length) return { ok: false, error: "Invalid number", path: "none" };
    const bodyText = String(text || "").trim();
    if (!bodyText) return { ok: false, error: "Message required", path: "none" };

    const body = {
      to: perms[0],
      body: bodyText,
      fromName: opts?.fromName || S.get("user_name") || "GridCaller",
      virtualFrom: S.get("gc_test_display_number", "") || S.get("user_phone", "") || "",
    };

    let lastErr = "";
    for (const base of hubBases()) {
      try {
        const r = await fetch(`${base}/api/pstn/sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        const data = (await r.json()) as PstnSmsResult;
        if (data.ok) {
          bus.emit("pstn:sms", data);
          S.set("pstn_last_sms", { ...data, ts: Date.now() });
          // Dry-run without Twilio: still open device SMS so user can send
          if (data.dryRun && opts?.allowSmsFallback !== false) {
            this.smsUriFallback(perms[0], bodyText);
            return {
              ...data,
              path: "sms",
              message: data.message || `Opened device SMS for ${perms[0]}`,
              permutations: data.permutations || perms,
            };
          }
          return { ...data, path: "pstn", permutations: data.permutations || perms };
        }
        lastErr = data.error || "sms failed";
      } catch (e: any) {
        lastErr = e?.message || "unreachable";
      }
    }

    if (opts?.allowSmsFallback !== false) {
      return this.smsUriFallback(perms[0], bodyText, lastErr);
    }
    return { ok: false, error: lastErr || "SMS unreachable", path: "none", permutations: perms };
  }

  private telFallback(e164: string, reason?: string): PstnCallResult {
    try {
      window.location.href = `tel:${e164}`;
    } catch {}
    return {
      ok: true,
      dryRun: true,
      provider: "tel-uri",
      to: e164,
      status: "opened-os-dialer",
      path: "tel",
      message: `Opened OS dialer for ${e164}. ${reason || ""} Live PSTN: hub env TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE.`.trim(),
    };
  }

  private smsUriFallback(e164: string, text: string, reason?: string): PstnSmsResult {
    try {
      const q = text ? `?body=${encodeURIComponent(text)}` : "";
      window.location.href = `sms:${e164}${q}`;
    } catch {}
    return {
      ok: true,
      dryRun: true,
      provider: "sms-uri",
      to: e164,
      status: "opened-os-sms",
      path: "sms",
      message: `Opened device SMS for ${e164}. ${reason || ""} Live SMS: set TWILIO_* on hub.`.trim(),
    };
  }
}

export const pstnBridge = new PstnBridgeClient();
export default pstnBridge;
