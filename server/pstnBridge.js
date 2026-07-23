/**
 * GridAlive PSTN Bridge — call ANY real phone without GridAlive on the handset
 *
 * Uses Twilio REST (or dry-run for PC testing without keys).
 * Infinite dial permutations for India/global numbers.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE          E.164 from-number
 *   TWILIO_VOICE_URL      optional public TwiML URL
 *   PSTN_TEST_MODE=1     force dry-run even with keys
 */

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

/** All E.164 / local permutations for a dialed number */
export function phonePermutations(input) {
  const raw = String(input || "").trim();
  const d = digits(raw);
  const out = new Set();
  if (!d) return [];

  const add = (x) => {
    if (x && x.length >= 8) out.add(x);
  };

  add(d);
  if (d.startsWith("00")) add(d.slice(2));
  if (d.startsWith("0") && d.length >= 11) add(d.slice(1));

  // India
  if (d.length === 10 && /^[6-9]/.test(d)) {
    add("91" + d);
    add("+91" + d);
  }
  if (d.startsWith("91") && d.length === 12) {
    add("+" + d);
    add(d.slice(2));
  }
  if (d.startsWith("919") && d.length === 12) {
    add("+" + d);
  }
  // Already + stripped
  if (raw.startsWith("+")) add(digits(raw));

  // Prefer E.164 list for Twilio
  const e164 = [];
  for (const x of out) {
    if (x.startsWith("91") && x.length === 12) e164.push("+" + x);
    else if (x.length === 10 && /^[6-9]/.test(x)) e164.push("+91" + x);
    else if (x.length >= 11 && !x.startsWith("0")) e164.push(x.startsWith("+") ? x : "+" + x);
  }
  // unique preserve order
  const seen = new Set();
  const ordered = [];
  for (const e of [...e164, ...[...out].map((x) => (x.startsWith("+") ? x : "+" + x))]) {
    const n = e.startsWith("+") ? e : "+" + digits(e);
    if (!seen.has(n) && digits(n).length >= 10) {
      seen.add(n);
      ordered.push(n);
    }
  }
  return ordered.length ? ordered : d.length >= 10 ? ["+" + d] : [];
}

export function getPstnConfig() {
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.VITE_TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.VITE_TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_PHONE || process.env.VITE_TWILIO_PHONE || "";
  const testMode = process.env.PSTN_TEST_MODE === "1" || process.env.PSTN_TEST_MODE === "true";
  const configured = !!(sid && token && from && !testMode);
  return {
    configured,
    testMode: testMode || !configured,
    provider: configured ? "twilio" : "dry-run",
    from: from ? from.slice(0, 4) + "…" + from.slice(-4) : "",
    hasSid: !!sid,
    hasToken: !!token,
    hasFrom: !!from,
    note: configured
      ? "Live PSTN: Twilio will ring real phones without GridAlive on handset."
      : "PC test / dry-run: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE in .env for live any-number calls.",
  };
}

/**
 * Place outbound call to real phone (handset does NOT need GridAlive)
 * Audio path: Twilio cloud → PSTN → handset. Optional Say/message.
 */
export async function placeOutboundCall({ to, message, callerName }) {
  const perms = phonePermutations(to);
  if (!perms.length) {
    return { ok: false, error: "Invalid phone number", permutations: [] };
  }

  const cfg = getPstnConfig();
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.VITE_TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.VITE_TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_PHONE || process.env.VITE_TWILIO_PHONE || "";

  // Dry-run for PC testing without keys
  if (!cfg.configured) {
    return {
      ok: true,
      dryRun: true,
      provider: "dry-run",
      to: perms[0],
      permutations: perms,
      callSid: `dry_${Date.now().toString(36)}`,
      status: "queued-dry-run",
      message:
        "PSTN dry-run OK — number valid. Add Twilio keys to .env to ring the real phone. Without keys, use OS dialer fallback.",
      twimlPreview: buildTwiml(message, callerName),
    };
  }

  // Try each permutation until Twilio accepts
  const errors = [];
  for (const dest of perms) {
    try {
      const body = new URLSearchParams();
      body.set("To", dest);
      body.set("From", from);
      body.set("Twiml", buildTwiml(message, callerName));
      // Ring timeout
      body.set("Timeout", "45");

      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      const data = await r.json();
      if (r.ok && data.sid) {
        return {
          ok: true,
          dryRun: false,
          provider: "twilio",
          to: dest,
          permutations: perms,
          callSid: data.sid,
          status: data.status || "queued",
          message: `Ringing ${dest} via Twilio PSTN (no GridAlive needed on phone).`,
        };
      }
      errors.push({ dest, error: data?.message || data?.code || r.status });
    } catch (e) {
      errors.push({ dest, error: e?.message || String(e) });
    }
  }

  return {
    ok: false,
    error: "All number permutations failed on PSTN",
    permutations: perms,
    errors,
  };
}

function buildTwiml(message, callerName) {
  const say = escapeXml(
    message ||
      `Hello. This is a GridAlive network call${callerName ? " from " + callerName : ""}. Please hold.`
  );
  // Ring + speak — full duplex browser bridge needs Twilio Client; this guarantees handset rings
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-IN">${say}</Say>
  <Pause length="1"/>
  <Say voice="alice" language="en-IN">GridAlive free mesh is also available if you install the app later.</Say>
  <Pause length="30"/>
</Response>`;
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send SMS to any real phone via Twilio (handset does not need GridCaller).
 */
export async function placeOutboundSms({ to, body, fromName }) {
  const perms = phonePermutations(to);
  if (!perms.length) {
    return { ok: false, error: "Invalid phone number", permutations: [] };
  }
  const text = String(body || "").trim();
  if (!text) {
    return { ok: false, error: "Message body required", permutations: perms };
  }

  const cfg = getPstnConfig();
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.VITE_TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.VITE_TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_PHONE || process.env.VITE_TWILIO_PHONE || "";

  if (!cfg.configured) {
    return {
      ok: true,
      dryRun: true,
      provider: "dry-run",
      to: perms[0],
      permutations: perms,
      sid: `dry_sms_${Date.now().toString(36)}`,
      status: "queued-dry-run",
      message:
        "SMS dry-run OK — number valid. Add Twilio keys to .env for live SMS. Without keys, client opens device SMS app.",
    };
  }

  const errors = [];
  const payload = fromName ? `${text}\n— ${fromName} via GridCaller` : text;
  for (const dest of perms) {
    try {
      const form = new URLSearchParams();
      form.set("To", dest);
      form.set("From", from);
      form.set("Body", payload.slice(0, 1500));

      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      const data = await r.json();
      if (r.ok && data.sid) {
        return {
          ok: true,
          dryRun: false,
          provider: "twilio",
          to: dest,
          permutations: perms,
          sid: data.sid,
          status: data.status || "queued",
          message: `SMS sent to ${dest} via Twilio (mobile network).`,
        };
      }
      errors.push({ dest, error: data?.message || data?.code || r.status });
    } catch (e) {
      errors.push({ dest, error: e?.message || String(e) });
    }
  }

  return {
    ok: false,
    error: "All number permutations failed for SMS",
    permutations: perms,
    errors,
  };
}

/**
 * Two-leg connect: call destination, when they answer play message.
 * For browser talk-through later: conference + Twilio Device token.
 */
export function getTwimlConnect(destE164) {
  const to = escapeXml(destE164);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your GridAlive call.</Say>
  <Dial callerId="${escapeXml(process.env.TWILIO_PHONE || "")}" timeout="40">${to}</Dial>
</Response>`;
}
