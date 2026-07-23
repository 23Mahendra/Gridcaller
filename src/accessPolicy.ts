export type GridAliveRole = "member" | "government" | "media" | "commercial" | "super_user";
export type SubscriptionTier = "freemium" | "premium";
export type SubscriptionState = "trial" | "pending_payment" | "active" | "paused" | "expired" | "under_review";
export type ComplianceState = "clear" | "under_review" | "suspended";
export type PaymentVerificationMode = "manual_review" | "webhook" | "not_configured";
export type PaymentMethodKind = "upi" | "gateway" | "wallet" | "bank";

export interface GridAliveSubscription {
  tier: SubscriptionTier;
  planId: string;
  status: SubscriptionState;
  startedAt: number;
  trialEndsAt: number;
  paidUntil: number;
  lastPaymentAt: number;
  paymentPending: boolean;
  joiningFeePaid: boolean;
  launchOfferEligible: boolean;
  launchOfferClaimed: boolean;
}

export interface GridAliveCompliance {
  status: ComplianceState;
  reason: string;
  strikes: number;
  flaggedAt: number;
  suspendedUntil: number;
}

export interface GridAliveOwnerClaim {
  token: string;
  verifiedAt: number;
  expiresAt: number;
  source: "server" | "local";
}

export interface GridAliveUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  authType?: string;
  joined: number;
  role: GridAliveRole;
  organizationName: string;
  isOwner: boolean;
  isSuperUser: boolean;
  ownerClaim: GridAliveOwnerClaim | null;
  subscription: GridAliveSubscription;
  compliance: GridAliveCompliance;
}

export interface BillingPlan {
  id: string;
  name: string;
  tier: SubscriptionTier;
  audience: "all" | "member" | "organization";
  monthlyInr: number;
  monthlyUsd: number;
  joiningFeeInr: number;
  joiningFeeUsd: number;
  description: string;
  includes: string[];
}

export interface BillingPaymentMethod {
  id: string;
  label: string;
  kind: PaymentMethodKind;
  enabled: boolean;
  verificationMode: PaymentVerificationMode;
  publicTarget: string;
  checkoutUrl: string;
  note: string;
}

export interface BillingCatalog {
  updatedAt: string;
  trialDays: number;
  supportEmail: string;
  joiningFeeLabel: string;
  launchOffer: {
    enabled: boolean;
    firstUsers: number;
    memberMonthlyInr: number;
    memberMonthlyUsd: number;
    organizationMonthlyInr: number;
    organizationMonthlyUsd: number;
    note: string;
  };
  plans: BillingPlan[];
  paymentMethods: BillingPaymentMethod[];
}

export interface FeatureAccess {
  visible: boolean;
  enabled: boolean;
  isPreview?: boolean;
  badge: "Free" | "Trial" | "Preview" | "Premium" | "Owner";
  reason: string;
}

export interface PromotionalReview {
  id: string;
  userId: string;
  role: GridAliveRole;
  surface: string;
  score: number;
  preview: string;
  status: ComplianceState;
  reason: string;
  createdAt: number;
}

export const ROLE_OPTIONS: Array<{ id: GridAliveRole; label: string; description: string }> = [
  { id: "member", label: "Member", description: "Individual people using GridAlive for safety, help, and coordination." },
  { id: "government", label: "Government", description: "Public departments and civic teams managing verified updates and services." },
  { id: "media", label: "Media", description: "Newsrooms and reporters publishing verified public-interest updates." },
  { id: "commercial", label: "Commercial", description: "Businesses, service providers, and managed supply partners." },
];

export const FEATURE_BADGES = {
  free: "Free",
  trial: "Trial",
  preview: "Preview",
  premium: "Premium",
  owner: "Owner",
} as const;

export const OWNER_ONLY_FEATURE_IDS = ["blocks", "owner"];
/** Crisis mesh OS: every public feature is LIVE free — no Preview / paywall for core survival tools */
export const ALWAYS_FREE_FEATURE_IDS = [
  "profile", "feed", "sos", "settings", "verify",
  "kids", "lost", "elderly", "translate", "routes", "barter", "child",
  "gridacaller", "omnimesh", "gun", "devicevault", "stackaudit", "commanddeck",
  "ai", "radio", "map", "chat", "social", "nodes",
  "blood", "medical", "mental", "skills", "docs", "wallet", "llm",
  "network", "transport", "supermesh", "energy", "codeide", "jarvis",
  "applaunch", "gridcoding", "mesh", "secrets", "apis", "meshearn", "meshcloud", "gridnumbers",
  "paywallet", "livenews", "adsmarket",
];
export const TRIAL_FEATURE_IDS: string[] = []; // none — all live free
export const PREMIUM_FEATURE_IDS: string[] = []; // none — all live free

const ORGANIZATION_ROLES: GridAliveRole[] = ["government", "media", "commercial"];
const TRIAL_DAY_MS = 24 * 60 * 60 * 1000;

function safeNow(now?: number) {
  return typeof now === "number" && Number.isFinite(now) ? now : Date.now();
}

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

export function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhone(value: string) {
  return String(value || "").replace(/[^\d+]/g, "");
}

export function generateGridAliveUserId(seed?: string) {
  const cleaned = String(seed || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  if (cleaned) return `ga_${cleaned}_${Math.random().toString(36).slice(2, 7)}`;
  return randomId("ga");
}

/** All users are free forever — no paid plans in product */
export function createDefaultSubscription(role: GridAliveRole = "member", now?: number): GridAliveSubscription {
  const startedAt = safeNow(now);
  const forever = startedAt + 100 * 365 * TRIAL_DAY_MS;
  return {
    tier: "freemium",
    planId: "free-forever",
    status: "active",
    startedAt,
    trialEndsAt: forever,
    paidUntil: forever,
    lastPaymentAt: startedAt,
    paymentPending: false,
    joiningFeePaid: true,
    launchOfferEligible: false,
    launchOfferClaimed: false,
  };
}

export function createDefaultCompliance(): GridAliveCompliance {
  return {
    status: "clear",
    reason: "",
    strikes: 0,
    flaggedAt: 0,
    suspendedUntil: 0,
  };
}

function normalizeRole(value: any): GridAliveRole {
  const role = String(value || "member").trim().toLowerCase();
  if (role === "government" || role === "media" || role === "commercial" || role === "super_user") return role;
  return "member";
}

export function normalizeGridAliveUser(raw: any, now?: number): GridAliveUser {
  const current = safeNow(now);
  const role = normalizeRole(raw?.isSuperUser ? "super_user" : raw?.role);
  const fallbackSeed = normalizeEmail(raw?.email) || normalizePhone(raw?.phone) || raw?.name;
  // Always free forever — ignore legacy paid/trial/premium fields from storage
  const subscription = createDefaultSubscription(role, current);
  const compliance = {
    ...createDefaultCompliance(),
    ...(raw?.compliance || {}),
  } as GridAliveCompliance;
  const ownerClaim = raw?.ownerClaim && raw.ownerClaim.token ? {
    token: String(raw.ownerClaim.token),
    verifiedAt: Number(raw.ownerClaim.verifiedAt || current),
    expiresAt: Number(raw.ownerClaim.expiresAt || current),
    source: (raw.ownerClaim.source === "local" ? "local" : "server") as "local" | "server",
  } : null;

  return {
    id: String(raw?.id || generateGridAliveUserId(fallbackSeed)),
    name: String(raw?.name || "GridAlive User"),
    email: normalizeEmail(raw?.email),
    phone: normalizePhone(raw?.phone),
    authType: raw?.authType ? String(raw.authType) : "local",
    joined: Number(raw?.joined || current),
    role,
    organizationName: String(raw?.organizationName || raw?.organization || ""),
    isOwner: Boolean(raw?.isOwner || role === "super_user"),
    isSuperUser: Boolean(raw?.isSuperUser || role === "super_user"),
    ownerClaim,
    subscription,
    compliance,
  };
}

export function mergeResolvedAccess(user: any, resolved: any): GridAliveUser {
  const base = normalizeGridAliveUser(user);
  if (!resolved) return base;
  return normalizeGridAliveUser({
    ...base,
    ...resolved,
    // subscription always free-forever via normalizeGridAliveUser
    compliance: {
      ...base.compliance,
      ...(resolved.compliance || {}),
    },
    ownerClaim: resolved.ownerClaim || base.ownerClaim,
  });
}

export function isOwnerUser(user: any) {
  const normalized = normalizeGridAliveUser(user);
  return normalized.isOwner || normalized.isSuperUser || normalized.role === "super_user";
}

/** Local-first owner unlock codes (no cloud required) */
export const LOCAL_OWNER_CODES = ["gridalive-owner", "GRIDALIVE-OWNER", "GA-OWNER-2026"];

/**
 * Claim owner on this device (local). Use access code from LOCAL_OWNER_CODES
 * or custom code stored as gridalive_owner_code.
 */
export function claimLocalOwner(user: any, accessCode = ""): GridAliveUser {
  const normalized = normalizeGridAliveUser(user);
  let custom = "";
  try {
    custom = String(localStorage.getItem("gridalive_owner_code") || "").trim();
  } catch {}
  const code = String(accessCode || "").trim();
  const matchDefault = LOCAL_OWNER_CODES.some((c) => c.toLowerCase() === code.toLowerCase());
  const matchCustom = !!(custom && custom.toLowerCase() === code.toLowerCase());
  let firstDevice = false;
  try {
    firstDevice = localStorage.getItem("gridalive_owner_claimed") !== "1";
  } catch {}

  const ok = matchDefault || matchCustom || (firstDevice && code.length >= 6);
  if (!ok) return normalized;

  const t = Date.now();
  const claimed: GridAliveUser = {
    ...normalized,
    isOwner: true,
    isSuperUser: true,
    role: "super_user",
    ownerClaim: {
      token: `local_owner_${t.toString(36)}`,
      verifiedAt: t,
      expiresAt: t + 365 * 24 * 60 * 60 * 1000,
      source: "local",
    },
  };
  try {
    localStorage.setItem("gridalive_owner_claimed", "1");
    if (code.length >= 6) localStorage.setItem("gridalive_owner_code", code);
  } catch {}
  return claimed;
}

/** Apply access code during login — promotes to owner when code matches */
export function applyAccessCode(user: any, accessCode = ""): GridAliveUser {
  const normalized = normalizeGridAliveUser(user);
  if (!accessCode?.trim()) return normalized;
  if (isOwnerUser(normalized)) return normalized;
  return claimLocalOwner(normalized, accessCode);
}

/** Subscription product removed — full access for everyone */
export function hasActivePaidSubscription(_user?: any, _now?: number) {
  return true;
}

export function hasLiveTrial(_user?: any, _now?: number) {
  return true;
}

export function hasLaunchOfferAccess(_user?: any) {
  return false;
}

export function canManageInstitutionPages(user: any) {
  const normalized = normalizeGridAliveUser(user);
  return isOwnerUser(normalized) || ORGANIZATION_ROLES.includes(normalized.role);
}

/** No premium paywall — marketing not gated by subscription */
export function canPublishMarketing(_user?: any) {
  return true;
}

export function getFeatureAccess(featureId: string, user: any, now?: number): FeatureAccess {
  const normalized = normalizeGridAliveUser(user, now);

  if (OWNER_ONLY_FEATURE_IDS.includes(featureId)) {
    return isOwnerUser(normalized)
      ? { visible: true, enabled: true, isPreview: false, badge: FEATURE_BADGES.owner, reason: "Owner controls — verified owner only." }
      : { visible: false, enabled: false, isPreview: false, badge: FEATURE_BADGES.owner, reason: "Owner-only feature." };
  }

  return {
    visible: true,
    enabled: true,
    isPreview: false,
    badge: FEATURE_BADGES.free,
    reason: "",
  };
}

/** Billing product retired — free forever (API shape kept for compatibility) */
export function getDefaultBillingCatalog(): BillingCatalog {
  return {
    updatedAt: new Date().toISOString(),
    trialDays: 0,
    supportEmail: "support@gridalive.app",
    joiningFeeLabel: "",
    launchOffer: {
      enabled: false,
      firstUsers: 0,
      memberMonthlyInr: 0,
      memberMonthlyUsd: 0,
      organizationMonthlyInr: 0,
      organizationMonthlyUsd: 0,
      note: "",
    },
    plans: [
      {
        id: "free-forever",
        name: "Free",
        tier: "freemium",
        audience: "all",
        monthlyInr: 0,
        monthlyUsd: 0,
        joiningFeeInr: 0,
        joiningFeeUsd: 0,
        description: "Full access",
        includes: ["All modules"],
      },
    ],
    paymentMethods: [],
  };
}

export function preferredCurrency() {
  if (typeof navigator !== "undefined" && /-IN$/i.test(navigator.language || "")) return "INR";
  if (typeof Intl !== "undefined") {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/kolkata|calcutta|india/i.test(zone)) return "INR";
  }
  return "USD";
}

export function quotePlanForUser(catalog: BillingCatalog, user: any, requestedPlanId?: string) {
  const normalized = normalizeGridAliveUser(user);
  const currency = preferredCurrency();
  const defaultPlanId = ORGANIZATION_ROLES.includes(normalized.role) ? "premium-organization" : "premium-member";
  const plan = catalog.plans.find((entry) => entry.id === (requestedPlanId || defaultPlanId)) || catalog.plans.find((entry) => entry.id === defaultPlanId) || catalog.plans[0];
  const useLaunchPrice = Boolean(
    catalog.launchOffer.enabled &&
    normalized.subscription.launchOfferEligible &&
    plan.tier === "premium" &&
    !normalized.subscription.launchOfferClaimed
  );
  const monthlyAmount = currency === "INR" ? plan.monthlyInr : plan.monthlyUsd;
  const joiningFee = currency === "INR" ? plan.joiningFeeInr : plan.joiningFeeUsd;
  const discountedMonthlyAmount = useLaunchPrice
    ? ORGANIZATION_ROLES.includes(normalized.role)
      ? (currency === "INR" ? catalog.launchOffer.organizationMonthlyInr : catalog.launchOffer.organizationMonthlyUsd)
      : (currency === "INR" ? catalog.launchOffer.memberMonthlyInr : catalog.launchOffer.memberMonthlyUsd)
    : monthlyAmount;
  return {
    plan,
    currency,
    joiningFee,
    monthlyAmount,
    discountedMonthlyAmount,
    totalDueNow: discountedMonthlyAmount + (normalized.subscription.joiningFeePaid ? 0 : joiningFee),
    useLaunchPrice,
  };
}

function buildUpiLink(vpa: string, amount: number, note: string) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: "GridAlive",
    am: amount.toFixed(2),
    cu: "INR",
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}

export function buildPublicPaymentLink(method: BillingPaymentMethod, amount: number, currency: string, user: any, planName: string) {
  const normalized = normalizeGridAliveUser(user);
  const note = `GridAlive ${planName} ${normalized.id}`;
  if (method.checkoutUrl) return method.checkoutUrl;
  if (!method.publicTarget) return "";

  if (method.kind === "upi") {
    return buildUpiLink(method.publicTarget, amount, note);
  }

  if (method.id === "paypal") {
    if (/^https?:\/\//i.test(method.publicTarget)) return method.publicTarget;
    return `https://www.paypal.com/paypalme/${method.publicTarget}/${amount.toFixed(2)}`;
  }

  if (method.kind === "gateway" || method.kind === "wallet") {
    return method.publicTarget;
  }

  return "";
}

export function inspectMarketingContent(text: string) {
  const source = String(text || "").toLowerCase();
  const patterns = [
    /subscribe\b/g,
    /sale\b/g,
    /discount\b/g,
    /offer\b/g,
    /sponsored\b/g,
    /promotion\b/g,
    /buy now\b/g,
    /limited time\b/g,
    /contact us\b/g,
    /book now\b/g,
    /advert/i,
    /https?:\/\//g,
    /www\./g,
    /\bupi\b/g,
    /\bpaypal\b/g,
    /\bstripe\b/g,
    /\bwhatsapp\b/g,
    /@\w{3,}/g,
  ];

  let score = 0;
  const hits: string[] = [];
  for (const pattern of patterns) {
    const matchCount = source.match(pattern)?.length || 0;
    if (matchCount > 0) {
      score += matchCount;
      hits.push(pattern.toString());
    }
  }

  return {
    promotional: score >= 2,
    score,
    hits,
  };
}

/** Subscription gates removed — content always allowed (owner can still review abuse separately) */
export function evaluatePromotionalAction(user: any, _text: string, _surface: string) {
  const normalized = normalizeGridAliveUser(user);
  return {
    allowed: true,
    updatedUser: normalized,
    review: null as PromotionalReview | null,
    reason: "",
  };
}

