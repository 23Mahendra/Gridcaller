/**
 * Grid Number Registry — device serial + mobile-style user numbers
 *
 * Purpose (company + public safety / national-security readiness):
 *  · Every device gets a permanent serial (hardware/install bound)
 *  · Every user gets a mobile-like Grid Number (dialable identity)
 *  · VIP / vanity numbers reserved for sale (company revenue, not public drain)
 *  · Append-only safety ledger so misuse can be investigated with due process
 *  · Owner / government roles: lawful lookup · public: own number only
 *
 * Format (India-first, global-ready):
 *  Device serial:  GAD-XXXX-XXXX-XXXX
 *  User number:    +91 70X XXX XXXX  (internal: 9170XXXXXXXX)
 *  GridAlive owns the 70x virtual range — not a real carrier MSISDN
 *
 * Not a secret police tool: transparent policy, role-gated access, local-first ledger.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import { isOwnerUser } from "../accessPolicy";

// ─── Types ───────────────────────────────────────────────────────

export type VipTier = "ultra" | "gold" | "silver" | "pattern" | "standard";
export type NumberStatus =
  | "available"
  | "reserved"
  | "for_sale"
  | "assigned"
  | "sold"
  | "suspended"
  | "retired";

export type SafetyEventType =
  | "device_serial_issued"
  | "user_number_issued"
  | "vip_reserved"
  | "vip_listed_sale"
  | "vip_purchased"
  | "number_reassigned"
  | "number_suspended"
  | "call_placed"
  | "call_received"
  | "call_missed"
  | "sms_sent"
  | "report_flag"
  | "lawful_lookup"
  | "device_bind"
  | "policy_ack";

export interface DeviceSerialRecord {
  serial: string;
  nodeId: string;
  platform: string;
  fingerprint: string;
  issuedAt: number;
  lastSeen: number;
  userNumber?: string;
  userId?: string;
  status: "active" | "revoked";
}

export interface GridNumberRecord {
  number: string; // digits only e.g. 917070012345
  display: string; // +91 70 7001 2345
  shortDial: string; // last 8–10 for keypad
  userId: string;
  userName: string;
  deviceSerial: string;
  nodeId: string;
  status: NumberStatus;
  vipTier: VipTier;
  priceGC: number; // 0 if free standard issue
  priceInr: number;
  issuedAt: number;
  assignedAt?: number;
  soldAt?: number;
  suspendedAt?: number;
  suspendReason?: string;
  country: "IN" | "GLOBAL";
  purpose: "public_identity" | "vip_sale" | "company_reserve" | "gov_reserve";
}

export interface SafetyLedgerEntry {
  id: string;
  type: SafetyEventType;
  ts: number;
  number?: string;
  deviceSerial?: string;
  userId?: string;
  userName?: string;
  peerNumber?: string;
  peerName?: string;
  nodeId?: string;
  meta?: Record<string, any>;
  /** Local integrity hash of previous entry + this payload */
  chainHash: string;
  purposeTag: "public_safety" | "national_security_ready" | "commerce" | "ops";
}

export interface VipListing {
  number: string;
  display: string;
  vipTier: VipTier;
  priceGC: number;
  priceInr: number;
  status: "for_sale" | "reserved" | "sold";
  note: string;
}

export interface GridNumberPolicy {
  version: number;
  freeCallingWithNumber: true;
  vipSaleEnabled: true;
  safetyLedgerEnabled: true;
  lawfulAccessRoles: Array<"owner" | "government" | "super_user">;
  purpose: string;
  purposeHi: string;
  dataRetentionDays: number;
  userConsentRequired: true;
}

const KEYS = {
  serial: "grid_device_serial",
  serialRec: "grid_device_serial_rec",
  myNumber: "grid_user_number",
  myNumberRec: "grid_user_number_rec",
  localDir: "grid_number_directory",
  vipPool: "grid_vip_pool",
  ledger: "grid_safety_ledger",
  policyAck: "grid_number_policy_ack",
  issueCounter: "grid_number_issue_counter",
};

const POLICY: GridNumberPolicy = {
  version: 1,
  freeCallingWithNumber: true,
  vipSaleEnabled: true,
  safetyLedgerEnabled: true,
  lawfulAccessRoles: ["owner", "government", "super_user"],
  purpose:
    "Every device serial + user Grid Number for accountable free mesh identity. VIP numbers reserved for company sale. Safety ledger supports public safety & due-process investigation — not secret mass surveillance.",
  purposeHi:
    "Har device ka permanent serial + har user ko mobile-jaisa Grid Number. VIP numbers company sale ke liye reserve. Safety ledger public safety / national-security readiness ke liye — galat kaam par due process se pehchan. Secret mass spying nahi.",
  dataRetentionDays: 365 * 3,
  userConsentRequired: true,
};

// GridAlive virtual mobile range (not carrier SIM):
// +91 70X XXX XXXX  →  9170XXXXXXXX (12 digits)
const CC = "91";
const GA_PREFIX = "70"; // 70x = GridAlive software numbers

function uid(p = "evt") {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nodeId() {
  return (
    MeshEngine.localId ||
    S.get("omni_node_id") ||
    S.get("mesh_id") ||
    S.get("ga_mesh_id") ||
    "node_local"
  );
}

/** Format 917070012345 → +91 70 7001 2345 */
export function formatGridNumber(digits: string): string {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("91")) {
    // 91 70 XXXX XXXX
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8, 12)}`;
  }
  if (d.length === 10) return `+91 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return d ? `+${d}` : "";
}

export function normalizeGridNumber(input: string): string {
  let d = String(input || "").replace(/\D/g, "");
  if (!d) return "";
  // Allow short dial 8–10 digits → pad with 9170
  if (d.length <= 10 && !d.startsWith("91")) {
    if (d.length === 10 && d.startsWith("70")) d = "91" + d;
    else if (d.length === 8) d = "9170" + d;
    else if (d.length === 9) d = "917" + d; // best effort
  }
  return d;
}

function shortDialOf(digits: string): string {
  const d = normalizeGridNumber(digits);
  if (d.length >= 10) return d.slice(-10);
  return d;
}

async function sha256Hex(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Fallback non-crypto hash
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0") + Date.now().toString(16);
  }
}

function simpleHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Browser/device fingerprint for serial stability */
async function deviceFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent || "",
    navigator.language || "",
    String(screen?.width || 0),
    String(screen?.height || 0),
    String(screen?.colorDepth || 0),
    String((navigator as any).deviceMemory || ""),
    String(navigator.hardwareConcurrency || ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    S.get("omni_node_id", "") || "",
  ];
  const raw = parts.join("|");
  const hex = await sha256Hex(raw);
  return hex.slice(0, 24);
}

function platformLabel(): string {
  const ua = navigator.userAgent || "";
  if (/Electron/i.test(ua)) return "electron";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad/i.test(ua)) return "ios";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "browser";
}

/** VIP detection + pricing */
export function classifyVip(digits: string): { tier: VipTier; priceGC: number; priceInr: number; reason: string } {
  const d = normalizeGridNumber(digits);
  const core = d.startsWith("9170") ? d.slice(4) : d.slice(-8); // 8-digit body

  // Ultra: low numbers 00000001–00000999
  const n = parseInt(core, 10);
  if (!isNaN(n) && n >= 1 && n <= 999) {
    return { tier: "ultra", priceGC: 50000, priceInr: 99999, reason: "Ultra low number (0001–0999)" };
  }
  // Gold: all same digit 11111111, 22222222…
  if (/^(\d)\1{7}$/.test(core)) {
    return { tier: "gold", priceGC: 25000, priceInr: 49999, reason: "Repeating digit vanity" };
  }
  // Gold: pairs 12121212, 13131313
  if (/^(\d{2})\1{3}$/.test(core)) {
    return { tier: "gold", priceGC: 15000, priceInr: 29999, reason: "Pair-repeat vanity" };
  }
  // Silver: sequential 01234567, 12345678
  if (core === "01234567" || core === "12345678" || core === "87654321" || core === "98765432") {
    return { tier: "silver", priceGC: 10000, priceInr: 19999, reason: "Sequential vanity" };
  }
  // Pattern: ends with 0000, 0007, 0786, 9999, 1111
  if (/(0000|0007|0786|9999|1111|0707|7007)$/.test(core)) {
    return { tier: "pattern", priceGC: 5000, priceInr: 9999, reason: "Lucky/pattern ending" };
  }
  // ABA patterns mid
  if (/(\d)\1{3,}/.test(core)) {
    return { tier: "pattern", priceGC: 2000, priceInr: 4999, reason: "Repeated run pattern" };
  }
  return { tier: "standard", priceGC: 0, priceInr: 0, reason: "Standard free issue" };
}

function isVipReservedBody(core8: string): boolean {
  const v = classifyVip("9170" + core8);
  return v.tier !== "standard";
}

// ─── Engine ──────────────────────────────────────────────────────

class GridNumberRegistry {
  private gun: any = null;
  private started = false;

  get policy(): GridNumberPolicy {
    return POLICY;
  }

  start(user?: { id?: string; name?: string; role?: string }) {
    if (this.started) {
      // refresh lastSeen
      this.touchSerial();
      return this.getMyIdentity();
    }
    this.started = true;

    // Ensure VIP seed pool exists once
    this.ensureVipPoolSeeded();

    const serial = this.ensureDeviceSerial();
    const num = this.ensureUserNumber(user);

    this.appendLedger({
      type: "device_bind",
      deviceSerial: serial.serial,
      number: num?.number,
      userId: user?.id || S.get("user_id") || S.get("ga_user_id"),
      userName: user?.name || S.get("user_name"),
      nodeId: nodeId(),
      purposeTag: "ops",
      meta: { platform: serial.platform },
    });

    // Best-effort publish presence with grid number on Gun (async)
    void this.publishDirectory(num, serial);

    bus.emit("gridNumber:ready", this.getMyIdentity());
    console.info(
      "[GridNumber] serial",
      serial.serial,
      "· number",
      num?.display,
      "· VIP pool",
      this.listVipForSale().length
    );
    return this.getMyIdentity();
  }

  acknowledgePolicy(): void {
    S.set(KEYS.policyAck, { at: Date.now(), version: POLICY.version });
    this.appendLedger({
      type: "policy_ack",
      userId: S.get("user_id") || S.get("ga_user_id"),
      userName: S.get("user_name"),
      purposeTag: "public_safety",
      meta: { version: POLICY.version },
    });
  }

  hasPolicyAck(): boolean {
    const a = S.get(KEYS.policyAck, null) as any;
    return !!(a && a.version === POLICY.version);
  }

  // ── Device serial ──

  ensureDeviceSerial(): DeviceSerialRecord {
    const existing = S.get(KEYS.serialRec, null) as DeviceSerialRecord | null;
    if (existing?.serial) {
      existing.lastSeen = Date.now();
      existing.nodeId = nodeId();
      S.set(KEYS.serialRec, existing);
      S.set(KEYS.serial, existing.serial);
      return existing;
    }

    // Sync path: fingerprint may be async — use sync seed first, upgrade hash later
    const seed =
      S.get("omni_node_id") ||
      S.get("mesh_id") ||
      `seed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const h = simpleHash(seed + "|" + navigator.userAgent + "|" + (screen?.width || 0));
    const h2 = simpleHash(h + "|GAD|" + (navigator.language || ""));
    const body = (h + h2).slice(0, 12).toUpperCase();
    const serial = `GAD-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;

    const rec: DeviceSerialRecord = {
      serial,
      nodeId: nodeId(),
      platform: platformLabel(),
      fingerprint: h + h2,
      issuedAt: Date.now(),
      lastSeen: Date.now(),
      status: "active",
    };
    S.set(KEYS.serialRec, rec);
    S.set(KEYS.serial, serial);

    this.appendLedger({
      type: "device_serial_issued",
      deviceSerial: serial,
      nodeId: rec.nodeId,
      purposeTag: "public_safety",
      meta: { platform: rec.platform },
    });

    // Strengthen fingerprint async
    void deviceFingerprint().then((fp) => {
      const cur = S.get(KEYS.serialRec, null) as DeviceSerialRecord | null;
      if (cur && cur.serial === serial) {
        cur.fingerprint = fp;
        S.set(KEYS.serialRec, cur);
      }
    });

    return rec;
  }

  getDeviceSerial(): string {
    return this.ensureDeviceSerial().serial;
  }

  private touchSerial() {
    const rec = S.get(KEYS.serialRec, null) as DeviceSerialRecord | null;
    if (rec) {
      rec.lastSeen = Date.now();
      rec.nodeId = nodeId();
      S.set(KEYS.serialRec, rec);
    }
  }

  // ── User Grid Number ──

  ensureUserNumber(user?: { id?: string; name?: string }): GridNumberRecord {
    const existing = S.get(KEYS.myNumberRec, null) as GridNumberRecord | null;
    if (existing?.number && existing.status === "assigned") {
      // refresh name/id binding
      if (user?.name) existing.userName = user.name;
      if (user?.id) existing.userId = user.id;
      existing.deviceSerial = this.getDeviceSerial();
      existing.nodeId = nodeId();
      S.set(KEYS.myNumberRec, existing);
      S.set(KEYS.myNumber, existing.number);
      this.upsertDirectory(existing);
      return existing;
    }

    // Issue free standard number (skip VIP bodies)
    const issued = this.issueStandardNumber(user);
    return issued;
  }

  private issueStandardNumber(user?: { id?: string; name?: string }): GridNumberRecord {
    const serial = this.getDeviceSerial();
    let body = "";
    let attempts = 0;
    do {
      const counter = (Number(S.get(KEYS.issueCounter, 0)) || 0) + 1;
      S.set(KEYS.issueCounter, counter);
      // Mix counter + serial hash for uniqueness
      const mix = simpleHash(serial + ":" + counter + ":" + Date.now());
      const n = (parseInt(mix.slice(0, 8), 16) % 90_000_000) + 10_000_000; // 8 digits 10000000–99999999
      body = String(n).padStart(8, "0");
      attempts++;
      if (attempts > 40) {
        // force non-vip by flipping last digit
        body = body.slice(0, 7) + String((attempts % 9) + 1);
        break;
      }
    } while (isVipReservedBody(body) || this.isNumberTaken("9170" + body));

    const digits = `${CC}${GA_PREFIX}${body}`;
    const vip = classifyVip(digits);
    const rec: GridNumberRecord = {
      number: digits,
      display: formatGridNumber(digits),
      shortDial: shortDialOf(digits),
      userId: user?.id || S.get("user_id") || S.get("ga_user_id") || "local",
      userName: user?.name || S.get("user_name") || "User",
      deviceSerial: serial,
      nodeId: nodeId(),
      status: "assigned",
      vipTier: "standard",
      priceGC: 0,
      priceInr: 0,
      issuedAt: Date.now(),
      assignedAt: Date.now(),
      country: "IN",
      purpose: "public_identity",
    };

    // If somehow VIP slipped, reclassify but still free for first issue of non-reserved
    if (vip.tier !== "standard") {
      // Should not happen often — re-roll once more
      const mix2 = simpleHash(digits + ":reroll");
      const n2 = (parseInt(mix2.slice(0, 8), 16) % 80_000_000) + 15_000_000;
      const body2 = String(n2).padStart(8, "0");
      if (!isVipReservedBody(body2)) {
        rec.number = `${CC}${GA_PREFIX}${body2}`;
        rec.display = formatGridNumber(rec.number);
        rec.shortDial = shortDialOf(rec.number);
      }
    }

    S.set(KEYS.myNumberRec, rec);
    S.set(KEYS.myNumber, rec.number);
    this.upsertDirectory(rec);

    // Bind serial → number
    const srec = S.get(KEYS.serialRec, null) as DeviceSerialRecord | null;
    if (srec) {
      srec.userNumber = rec.number;
      srec.userId = rec.userId;
      S.set(KEYS.serialRec, srec);
    }

    this.appendLedger({
      type: "user_number_issued",
      number: rec.number,
      deviceSerial: serial,
      userId: rec.userId,
      userName: rec.userName,
      nodeId: rec.nodeId,
      purposeTag: "public_safety",
      meta: { display: rec.display, free: true },
    });

    bus.emit("gridNumber:issued", rec);
    return rec;
  }

  getMyNumber(): GridNumberRecord | null {
    return (S.get(KEYS.myNumberRec, null) as GridNumberRecord | null) || null;
  }

  getMyIdentity() {
    const serial = this.ensureDeviceSerial();
    const number = this.getMyNumber() || this.ensureUserNumber();
    return {
      deviceSerial: serial.serial,
      device: serial,
      gridNumber: number.number,
      display: number.display,
      shortDial: number.shortDial,
      vipTier: number.vipTier,
      policy: POLICY,
      policyAck: this.hasPolicyAck(),
    };
  }

  // ── Directory ──

  private loadDir(): Record<string, GridNumberRecord> {
    return (S.get(KEYS.localDir, {}) as Record<string, GridNumberRecord>) || {};
  }

  private saveDir(dir: Record<string, GridNumberRecord>) {
    S.set(KEYS.localDir, dir);
  }

  private upsertDirectory(rec: GridNumberRecord) {
    const dir = this.loadDir();
    dir[rec.number] = rec;
    this.saveDir(dir);
  }

  private isNumberTaken(digits: string): boolean {
    const d = normalizeGridNumber(digits);
    const dir = this.loadDir();
    if (dir[d]?.status === "assigned" || dir[d]?.status === "sold") return true;
    const vip = this.loadVip();
    if (vip[d] && (vip[d].status === "sold" || vip[d].status === "reserved")) return true;
    const mine = this.getMyNumber();
    if (mine?.number === d) return true;
    return false;
  }

  /** Resolve dial string → directory record or null */
  resolve(dial: string): GridNumberRecord | null {
    const d = normalizeGridNumber(dial);
    if (!d) return null;
    const dir = this.loadDir();
    if (dir[d]) return dir[d];
    // short dial match
    const short = shortDialOf(d);
    for (const rec of Object.values(dir)) {
      if (rec.shortDial === short || rec.number.endsWith(short) || rec.number === d) return rec;
    }
    const mine = this.getMyNumber();
    if (mine && (mine.number === d || mine.shortDial === short)) return mine;
    return null;
  }

  // ── VIP pool ──

  private loadVip(): Record<string, GridNumberRecord> {
    return (S.get(KEYS.vipPool, {}) as Record<string, GridNumberRecord>) || {};
  }

  private saveVip(pool: Record<string, GridNumberRecord>) {
    S.set(KEYS.vipPool, pool);
  }

  /** Seed memorable VIP numbers for sale (once) */
  ensureVipPoolSeeded() {
    const pool = this.loadVip();
    if (Object.keys(pool).length >= 20) return;

    const bodies: string[] = [];
    // Ultra low
    for (let i = 1; i <= 50; i++) bodies.push(String(i).padStart(8, "0"));
    // Repeating
    for (let d = 1; d <= 9; d++) bodies.push(String(d).repeat(8));
    // Patterns
    bodies.push(
      "12345678",
      "87654321",
      "01234567",
      "07070707",
      "70070070",
      "11112222",
      "99990000",
      "00001111",
      "07860786",
      "10000001",
      "20000002",
      "77770000",
      "00000777"
    );

    const now = Date.now();
    for (const body of bodies) {
      const digits = `${CC}${GA_PREFIX}${body}`;
      if (pool[digits]) continue;
      const vip = classifyVip(digits);
      if (vip.tier === "standard") continue;
      pool[digits] = {
        number: digits,
        display: formatGridNumber(digits),
        shortDial: shortDialOf(digits),
        userId: "",
        userName: "",
        deviceSerial: "",
        nodeId: "",
        status: "for_sale",
        vipTier: vip.tier,
        priceGC: vip.priceGC,
        priceInr: vip.priceInr,
        issuedAt: now,
        country: "IN",
        purpose: "vip_sale",
      };
      this.appendLedger({
        type: "vip_reserved",
        number: digits,
        purposeTag: "commerce",
        meta: { tier: vip.tier, priceGC: vip.priceGC, priceInr: vip.priceInr, reason: vip.reason },
      });
    }
    this.saveVip(pool);
  }

  listVipForSale(): VipListing[] {
    const pool = this.loadVip();
    return Object.values(pool)
      .filter((r) => r.status === "for_sale" || r.status === "reserved")
      .map((r): VipListing => ({
        number: r.number,
        display: r.display,
        vipTier: r.vipTier,
        priceGC: r.priceGC,
        priceInr: r.priceInr,
        status: r.status === "reserved" ? ("reserved" as const) : ("for_sale" as const),
        note: classifyVip(r.number).reason,
      }))
      .sort((a, b) => b.priceGC - a.priceGC);
  }

  /** Company: reserve a VIP off market */
  reserveVip(digits: string, reason = "company_reserve"): { ok: boolean; error?: string } {
    if (!this.canLawfulManage()) return { ok: false, error: "Owner/government only" };
    const d = normalizeGridNumber(digits);
    const pool = this.loadVip();
    const rec = pool[d];
    if (!rec) return { ok: false, error: "Not in VIP pool" };
    if (rec.status === "sold" || rec.status === "assigned") return { ok: false, error: "Already sold" };
    rec.status = "reserved";
    rec.purpose = "company_reserve";
    pool[d] = rec;
    this.saveVip(pool);
    this.appendLedger({
      type: "vip_reserved",
      number: d,
      purposeTag: "commerce",
      meta: { reason },
    });
    return { ok: true };
  }

  /** Purchase VIP with GridCoins balance (local ledger) */
  purchaseVip(
    digits: string,
    buyer?: { id?: string; name?: string }
  ): { ok: boolean; error?: string; record?: GridNumberRecord } {
    const d = normalizeGridNumber(digits);
    const pool = this.loadVip();
    const rec = pool[d];
    if (!rec || rec.status !== "for_sale") {
      return { ok: false, error: "Number not for sale" };
    }

    const bal = Number(S.get("mesh_earn_balance_gc", 0)) || 0;
    if (bal < rec.priceGC) {
      return {
        ok: false,
        error: `Need ${rec.priceGC} GC (you have ${bal.toFixed(2)}). Earn via Mesh Earn Cloud or top-up later.`,
      };
    }

    // Debit GC
    S.set("mesh_earn_balance_gc", Math.max(0, bal - rec.priceGC));

    const serial = this.getDeviceSerial();
    const assigned: GridNumberRecord = {
      ...rec,
      status: "assigned",
      userId: buyer?.id || S.get("user_id") || S.get("ga_user_id") || "local",
      userName: buyer?.name || S.get("user_name") || "User",
      deviceSerial: serial,
      nodeId: nodeId(),
      assignedAt: Date.now(),
      soldAt: Date.now(),
      purpose: "vip_sale",
    };

    // Previous free number stays in directory history but my active becomes VIP
    const prev = this.getMyNumber();
    if (prev && prev.number !== assigned.number) {
      prev.status = "retired";
      this.upsertDirectory(prev);
      this.appendLedger({
        type: "number_reassigned",
        number: prev.number,
        userId: prev.userId,
        purposeTag: "commerce",
        meta: { replacedBy: assigned.number },
      });
    }

    pool[d] = { ...assigned, status: "sold" as NumberStatus };
    // Keep sold marker in VIP pool
    this.saveVip(pool);

    S.set(KEYS.myNumberRec, assigned);
    S.set(KEYS.myNumber, assigned.number);
    this.upsertDirectory(assigned);

    this.appendLedger({
      type: "vip_purchased",
      number: assigned.number,
      deviceSerial: serial,
      userId: assigned.userId,
      userName: assigned.userName,
      purposeTag: "commerce",
      meta: { priceGC: rec.priceGC, priceInr: rec.priceInr, tier: rec.vipTier, prev: prev?.number },
    });

    bus.emit("gridNumber:vip_purchased", assigned);
    return { ok: true, record: assigned };
  }

  // ── Safety ledger ──

  private loadLedger(): SafetyLedgerEntry[] {
    return (S.get(KEYS.ledger, []) as SafetyLedgerEntry[]) || [];
  }

  private saveLedger(entries: SafetyLedgerEntry[]) {
    // Cap retention roughly by count (~3 years of events at high volume still bounded)
    const max = 5000;
    S.set(KEYS.ledger, entries.slice(-max));
  }

  appendLedger(
    partial: Omit<SafetyLedgerEntry, "id" | "ts" | "chainHash"> & { ts?: number }
  ): SafetyLedgerEntry {
    const prev = this.loadLedger();
    const lastHash = prev.length ? prev[prev.length - 1].chainHash : "genesis";
    const ts = partial.ts || Date.now();
    const id = uid("saf");
    const payload = JSON.stringify({ ...partial, id, ts, lastHash });
    const chainHash = simpleHash(payload);
    const entry: SafetyLedgerEntry = {
      id,
      type: partial.type,
      ts,
      number: partial.number,
      deviceSerial: partial.deviceSerial,
      userId: partial.userId,
      userName: partial.userName,
      peerNumber: partial.peerNumber,
      peerName: partial.peerName,
      nodeId: partial.nodeId || nodeId(),
      meta: partial.meta,
      chainHash,
      purposeTag: partial.purposeTag || "public_safety",
    };
    prev.push(entry);
    this.saveLedger(prev);
    bus.emit("gridNumber:safety", entry);
    return entry;
  }

  /** Record call for safety trail (called from GridCaller) */
  logCall(opts: {
    dir: "out" | "in" | "missed";
    peerNumber?: string;
    peerName?: string;
    peerId?: string;
    method?: string;
    durationSec?: number;
  }) {
    const me = this.getMyNumber();
    const type: SafetyEventType =
      opts.dir === "missed" ? "call_missed" : opts.dir === "in" ? "call_received" : "call_placed";
    return this.appendLedger({
      type,
      number: me?.number,
      deviceSerial: this.getDeviceSerial(),
      userId: me?.userId,
      userName: me?.userName,
      peerNumber: opts.peerNumber || opts.peerId,
      peerName: opts.peerName,
      purposeTag: "public_safety",
      meta: { method: opts.method, durationSec: opts.durationSec || 0 },
    });
  }

  /** Flag misuse report */
  reportFlag(targetNumber: string, reason: string, reporter?: { id?: string; name?: string }) {
    return this.appendLedger({
      type: "report_flag",
      number: normalizeGridNumber(targetNumber),
      userId: reporter?.id || S.get("user_id"),
      userName: reporter?.name || S.get("user_name"),
      deviceSerial: this.getDeviceSerial(),
      purposeTag: "public_safety",
      meta: { reason: String(reason || "").slice(0, 500) },
    });
  }

  canLawfulManage(user?: { isOwner?: boolean; isSuperUser?: boolean; role?: string }): boolean {
    if (user?.isOwner || user?.isSuperUser || user?.role === "government") return true;
    try {
      if (user && isOwnerUser(user)) return true;
    } catch {}
    // Also allow if S flags owner
    if (S.get("ga_is_owner", false) || S.get("is_owner", false)) return true;
    const stored = S.get("ga_user", null) || S.get("user", null);
    try {
      if (stored && isOwnerUser(stored)) return true;
    } catch {}
    return false;
  }

  /**
   * Lawful safety lookup — owner / government / super_user only.
   * Every lookup is itself logged (accountability on investigators too).
   */
  lawfulLookup(
    query: string,
    actor?: { id?: string; name?: string; role?: string; isOwner?: boolean; isSuperUser?: boolean }
  ): {
    ok: boolean;
    error?: string;
    number?: GridNumberRecord | null;
    serial?: DeviceSerialRecord | null;
    events?: SafetyLedgerEntry[];
  } {
    if (!this.canLawfulManage(actor)) {
      return { ok: false, error: "Lawful access only: Owner / Government / Super User" };
    }
    const q = String(query || "").trim();
    if (!q) return { ok: false, error: "Empty query" };

    this.appendLedger({
      type: "lawful_lookup",
      userId: actor?.id,
      userName: actor?.name,
      purposeTag: "national_security_ready",
      meta: { query: q.slice(0, 64), role: actor?.role || "owner" },
    });

    const digits = normalizeGridNumber(q);
    const dir = this.loadDir();
    const vip = this.loadVip();
    let number: GridNumberRecord | null =
      dir[digits] || vip[digits] || this.resolve(q) || null;

    // Serial lookup
    let serial: DeviceSerialRecord | null = null;
    const mySerial = S.get(KEYS.serialRec, null) as DeviceSerialRecord | null;
    if (q.toUpperCase().startsWith("GAD-") || q.toUpperCase().includes("GAD")) {
      if (mySerial && mySerial.serial.toUpperCase() === q.toUpperCase()) serial = mySerial;
    }
    if (number?.deviceSerial && mySerial?.serial === number.deviceSerial) serial = mySerial;

    const ledger = this.loadLedger().filter(
      (e) =>
        e.number === number?.number ||
        e.deviceSerial === serial?.serial ||
        e.number === digits ||
        (e.peerNumber && e.peerNumber.includes(digits.slice(-8)))
    );

    return { ok: true, number, serial, events: ledger.slice(-100) };
  }

  getLedger(limit = 50, actor?: { isOwner?: boolean; role?: string; isSuperUser?: boolean }): SafetyLedgerEntry[] {
    const all = this.loadLedger();
    if (this.canLawfulManage(actor)) return all.slice(-limit);
    // Public: only own events
    const me = this.getMyNumber()?.number;
    const serial = this.getDeviceSerial();
    return all.filter((e) => e.number === me || e.deviceSerial === serial).slice(-limit);
  }

  suspendNumber(
    digits: string,
    reason: string,
    actor?: { id?: string; name?: string; isOwner?: boolean; role?: string }
  ): { ok: boolean; error?: string } {
    if (!this.canLawfulManage(actor)) return { ok: false, error: "Owner/government only" };
    const d = normalizeGridNumber(digits);
    const dir = this.loadDir();
    const rec = dir[d] || this.getMyNumber();
    if (!rec || rec.number !== d) return { ok: false, error: "Number not found locally" };
    rec.status = "suspended";
    rec.suspendedAt = Date.now();
    rec.suspendReason = reason;
    this.upsertDirectory(rec);
    if (this.getMyNumber()?.number === d) {
      S.set(KEYS.myNumberRec, rec);
    }
    this.appendLedger({
      type: "number_suspended",
      number: d,
      userId: actor?.id,
      userName: actor?.name,
      purposeTag: "national_security_ready",
      meta: { reason },
    });
    return { ok: true };
  }

  // ── Mesh publish (best effort) ──

  private async publishDirectory(num: GridNumberRecord | null, serial: DeviceSerialRecord) {
    if (!num) return;
    try {
      // Reuse global gun peers if gun is available via window / dynamic
      const Gun = (await import("gun/gun")).default;
      const peers = [
        "https://gun-manhattan.herokuapp.com/gun",
        "https://gunjs.herokuapp.com/gun",
      ];
      this.gun = Gun({ peers, localStorage: false, radisk: false, multicast: false });
      const payload = {
        number: num.number,
        display: num.display,
        shortDial: num.shortDial,
        name: num.userName,
        nodeId: num.nodeId,
        serial: serial.serial,
        ts: Date.now(),
        vipTier: num.vipTier,
      };
      this.gun.get("gridalive").get("grid_numbers").get(num.number).put(payload);
      this.gun.get("gridalive").get("grid_serials").get(serial.serial.replace(/-/g, "")).put({
        serial: serial.serial,
        number: num.number,
        nodeId: num.nodeId,
        ts: Date.now(),
      });
    } catch (e) {
      console.warn("[GridNumber] directory publish deferred", e);
    }
  }

  /** Remote resolve via Gun (async) */
  async resolveRemote(dial: string): Promise<{ number: string; name?: string; nodeId?: string } | null> {
    const d = normalizeGridNumber(dial);
    const local = this.resolve(d);
    if (local) return { number: local.number, name: local.userName, nodeId: local.nodeId };
    try {
      if (!this.gun) {
        const Gun = (await import("gun/gun")).default;
        this.gun = Gun({
          peers: ["https://gun-manhattan.herokuapp.com/gun", "https://gunjs.herokuapp.com/gun"],
          localStorage: false,
          radisk: false,
        });
      }
      return await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 4000);
        this.gun
          .get("gridalive")
          .get("grid_numbers")
          .get(d)
          .once((data: any) => {
            clearTimeout(t);
            if (data?.number || data?.nodeId) {
              resolve({
                number: data.number || d,
                name: data.name,
                nodeId: data.nodeId,
              });
            } else resolve(null);
          });
      });
    } catch {
      return null;
    }
  }

  getStats() {
    const vip = Object.values(this.loadVip());
    const dir = Object.values(this.loadDir());
    return {
      myDisplay: this.getMyNumber()?.display || "",
      mySerial: this.getDeviceSerial(),
      directorySize: dir.length,
      vipForSale: vip.filter((v) => v.status === "for_sale").length,
      vipSold: vip.filter((v) => v.status === "sold").length,
      ledgerEvents: this.loadLedger().length,
      policyVersion: POLICY.version,
    };
  }
}

export const gridNumberRegistry = new GridNumberRegistry();
export default gridNumberRegistry;
