/**
 * GridAlive Auto-Rent profit policy + network rates
 *
 * Default split:
 *   · Public (capacity provider): 60%
 *   · GridAlive Owner:            20%
 *   · System maintenance:         10%
 *   · Mesh network reserve:       10%
 *
 * Rates + split % are OWNER-ONLY editable (isOwnerUser).
 * Public users only consume published rates.
 */

import { S } from "./storage";
import { bus } from "./bus";
import { isOwnerUser } from "../accessPolicy";

/** Default constants (used until owner overrides) */
export const DEFAULT_RENT_SPLIT = {
  publicPercent: 60,
  ownerPercent: 20,
  maintenancePercent: 10,
  meshReservePercent: 10,
} as const;

/** @deprecated use getActiveSplit() — kept for imports */
export const RENT_SPLIT = DEFAULT_RENT_SPLIT;

export type SplitBucket = "public" | "owner" | "maintenance" | "mesh_reserve";

export interface SplitPolicy {
  publicPercent: number;
  ownerPercent: number;
  maintenancePercent: number;
  meshReservePercent: number;
  updatedAt: number;
  updatedBy: string;
}

/** Network-wide GC rates — owner controlled */
export interface NetworkRates {
  /** GC per MB per day for storage rent */
  rateStoragePerMbDay: number;
  /** GC per MB per hour for RAM share */
  rateRamPerMbHour: number;
  /** GC per GPU/AI inference task */
  rateGpuPerTask: number;
  /** GC per train step */
  rateTrainPerStep: number;
  /** GC per cloud host (base + size factor uses storage rate) */
  rateCloudHostBase: number;
  /** GC per compress job */
  rateCompressJob: number;
  /** GC per online capacity tick (minute-scale, auto-rent) */
  rateOnlineTickBase: number;
  /** Min reward floor */
  minRewardGC: number;
  updatedAt: number;
  updatedBy: string;
}

export const DEFAULT_NETWORK_RATES: NetworkRates = {
  rateStoragePerMbDay: 2,
  rateRamPerMbHour: 1,
  rateGpuPerTask: 10,
  rateTrainPerStep: 15,
  rateCloudHostBase: 1,
  rateCompressJob: 1,
  rateOnlineTickBase: 0.05,
  minRewardGC: 0.01,
  updatedAt: 0,
  updatedBy: "system",
};

export interface SplitResult {
  gross: number;
  public: number;
  owner: number;
  maintenance: number;
  meshReserve: number;
  policy: SplitPolicy;
}

export interface PoolBalances {
  public: number;
  owner: number;
  maintenance: number;
  meshReserve: number;
  lifetimeGross: number;
}

export type RateRow = {
  id: keyof Omit<NetworkRates, "updatedAt" | "updatedBy">;
  label: string;
  unit: string;
  description: string;
};

/** Table of editable rates for owner UI */
export const RATE_TABLE: RateRow[] = [
  {
    id: "rateStoragePerMbDay",
    label: "Storage rent",
    unit: "GC / MB / day",
    description: "Encrypted disk lease on mesh cloud",
  },
  {
    id: "rateRamPerMbHour",
    label: "RAM share",
    unit: "GC / MB / hour",
    description: "Lent memory for mesh compute",
  },
  {
    id: "rateGpuPerTask",
    label: "GPU / AI inference",
    unit: "GC / task",
    description: "Cluster inference job reward",
  },
  {
    id: "rateTrainPerStep",
    label: "Train step",
    unit: "GC / step",
    description: "Local model train contribution",
  },
  {
    id: "rateCloudHostBase",
    label: "Cloud host base",
    unit: "GC / object",
    description: "Base pay for hosting a cloud object",
  },
  {
    id: "rateCompressJob",
    label: "Compress job",
    unit: "GC / job",
    description: "Compression cluster work",
  },
  {
    id: "rateOnlineTickBase",
    label: "Online capacity tick",
    unit: "GC / tick",
    description: "Passive earn while auto-rent online",
  },
  {
    id: "minRewardGC",
    label: "Minimum reward",
    unit: "GC",
    description: "Floor for any single credit",
  },
];

const KEYS = {
  pools: "gridalive_rent_pools_v1",
  autoRent: "gridalive_auto_rent_v1",
  splitLog: "gridalive_rent_split_log_v1",
  policy: "gridalive_rent_split_policy_v1",
  rates: "gridalive_network_rates_v1",
};

export type AutoRentConfig = {
  enabled: boolean;
  ramFraction: number;
  storageFraction: number;
  cpuPercent: number;
  gpuShare: boolean;
  lastAutoAt: number;
};

const DEFAULT_AUTO: AutoRentConfig = {
  enabled: true,
  ramFraction: 0.25,
  storageFraction: 0.2,
  cpuPercent: 25,
  gpuShare: true,
  lastAutoAt: 0,
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function assertOwner(user: any): void {
  if (!isOwnerUser(user)) {
    throw new Error("Owner only — rates & profit split sirf GridAlive owner control kar sakte hain.");
  }
}

export function getActiveSplit(): SplitPolicy {
  const saved = S.get(KEYS.policy, null) as SplitPolicy | null;
  if (saved && typeof saved.publicPercent === "number") {
    return {
      publicPercent: saved.publicPercent,
      ownerPercent: saved.ownerPercent ?? 20,
      maintenancePercent: saved.maintenancePercent ?? 10,
      meshReservePercent: saved.meshReservePercent ?? 10,
      updatedAt: saved.updatedAt || 0,
      updatedBy: saved.updatedBy || "system",
    };
  }
  return {
    ...DEFAULT_RENT_SPLIT,
    updatedAt: 0,
    updatedBy: "system",
  };
}

export function getNetworkRates(): NetworkRates {
  const saved = S.get(KEYS.rates, null) as Partial<NetworkRates> | null;
  return {
    ...DEFAULT_NETWORK_RATES,
    ...(saved || {}),
    updatedAt: saved?.updatedAt || 0,
    updatedBy: saved?.updatedBy || "system",
  };
}

/**
 * Owner-only: update profit split %. Must total 100.
 */
export function setSplitPolicyOwner(
  user: any,
  partial: Partial<Pick<SplitPolicy, "publicPercent" | "ownerPercent" | "maintenancePercent" | "meshReservePercent">>
): SplitPolicy {
  assertOwner(user);
  const cur = getActiveSplit();
  const next: SplitPolicy = {
    ...cur,
    ...partial,
    updatedAt: Date.now(),
    updatedBy: user?.name || user?.id || "owner",
  };
  const sum =
    next.publicPercent + next.ownerPercent + next.maintenancePercent + next.meshReservePercent;
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(`Split must total 100% (now ${sum}%)`);
  }
  if (next.publicPercent < 40 || next.publicPercent > 85) {
    throw new Error("Public share must stay between 40% and 85%");
  }
  if (next.ownerPercent < 5 || next.ownerPercent > 40) {
    throw new Error("Owner share must stay between 5% and 40%");
  }
  S.set(KEYS.policy, next);
  bus.emit("rentSplit:policy", next);
  // Sync meshEconomy if available
  try {
    bus.emit("meshcloud:revenue_updated", {
      userPercent: next.publicPercent,
      ownerPercent: next.ownerPercent,
      maintenancePercent: next.maintenancePercent,
      meshReservePercent: next.meshReservePercent,
      platformPercent: 100 - next.publicPercent,
    });
  } catch {}
  return next;
}

/**
 * Owner-only: add/edit network rates (table).
 */
export function setNetworkRatesOwner(
  user: any,
  partial: Partial<Omit<NetworkRates, "updatedAt" | "updatedBy">>
): NetworkRates {
  assertOwner(user);
  const cur = getNetworkRates();
  for (const [k, v] of Object.entries(partial)) {
    if (typeof v === "number" && (v < 0 || !Number.isFinite(v))) {
      throw new Error(`Invalid rate for ${k}`);
    }
  }
  const next: NetworkRates = {
    ...cur,
    ...partial,
    updatedAt: Date.now(),
    updatedBy: user?.name || user?.id || "owner",
  };
  S.set(KEYS.rates, next);
  bus.emit("rentSplit:rates", next);
  return next;
}

/** Owner-only: set one rate by id */
export function setOneRateOwner(
  user: any,
  id: keyof Omit<NetworkRates, "updatedAt" | "updatedBy">,
  value: number
): NetworkRates {
  return setNetworkRatesOwner(user, { [id]: value } as any);
}

export function splitGross(gross: number): SplitResult {
  const policy = getActiveSplit();
  const g = Math.max(0, gross);
  const publicShare = round2(g * (policy.publicPercent / 100));
  const ownerShare = round2(g * (policy.ownerPercent / 100));
  const maintenanceShare = round2(g * (policy.maintenancePercent / 100));
  const meshReserve = round2(g - publicShare - ownerShare - maintenanceShare);
  return {
    gross: round2(g),
    public: publicShare,
    owner: ownerShare,
    maintenance: maintenanceShare,
    meshReserve,
    policy,
  };
}

export function getPoolBalances(): PoolBalances {
  const p = S.get(KEYS.pools, null) as PoolBalances | null;
  return (
    p || {
      public: 0,
      owner: 0,
      maintenance: 0,
      meshReserve: 0,
      lifetimeGross: 0,
    }
  );
}

function savePools(p: PoolBalances) {
  S.set(KEYS.pools, p);
}

export function applyRentSplit(
  grossGC: number,
  note: string,
  meta?: { kind?: string; nodeId?: string }
): SplitResult & { publicCredited: number } {
  const split = splitGross(grossGC);
  if (split.gross <= 0) return { ...split, publicCredited: 0 };

  const pools = getPoolBalances();
  pools.public = round2(pools.public + split.public);
  pools.owner = round2(pools.owner + split.owner);
  pools.maintenance = round2(pools.maintenance + split.maintenance);
  pools.meshReserve = round2(pools.meshReserve + split.meshReserve);
  pools.lifetimeGross = round2(pools.lifetimeGross + split.gross);
  savePools(pools);

  const log = (S.get(KEYS.splitLog, []) as any[]) || [];
  log.unshift({
    id: `spl_${Date.now().toString(36)}`,
    ...split,
    note,
    kind: meta?.kind || "rent",
    nodeId: meta?.nodeId,
    ts: Date.now(),
  });
  S.set(KEYS.splitLog, log.slice(0, 300));

  bus.emit("rentSplit:applied", { split, note, pools });
  return { ...split, publicCredited: split.public };
}

export function getSplitLog(limit = 40) {
  return ((S.get(KEYS.splitLog, []) as any[]) || []).slice(0, limit);
}

export function getAutoRentConfig(): AutoRentConfig {
  return { ...DEFAULT_AUTO, ...(S.get(KEYS.autoRent, null) || {}) };
}

export function setAutoRentConfig(partial: Partial<AutoRentConfig>) {
  const next = { ...getAutoRentConfig(), ...partial, lastAutoAt: Date.now() };
  S.set(KEYS.autoRent, next);
  bus.emit("rentSplit:autoConfig", next);
  return next;
}

export async function computeAutoOfferFromDevice(): Promise<{
  storageMB: number;
  ramMB: number;
  cpuPercent: number;
  gpuShare: boolean;
}> {
  const cfg = getAutoRentConfig();
  const rates = getNetworkRates();
  const ramGB = (navigator as any).deviceMemory || 4;
  const ramTotalMB = ramGB * 1024;
  const freeRamEstimate = Math.max(256, ramTotalMB * 0.35);
  const ramMB = Math.max(64, Math.floor(freeRamEstimate * cfg.ramFraction));

  let freeDiskMB = 2048;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota != null && est.usage != null) {
        freeDiskMB = Math.max(256, Math.floor((est.quota - est.usage) / (1024 * 1024)));
      }
    }
  } catch {}
  const storageMB = Math.max(
    128,
    Math.min(50 * 1024, Math.floor(freeDiskMB * cfg.storageFraction))
  );

  void rates; // rates used by callers when setting offer prices
  return {
    storageMB,
    ramMB,
    cpuPercent: cfg.cpuPercent,
    gpuShare: cfg.gpuShare && !!(navigator as any).gpu,
  };
}

export function formatSplitPolicyLabel() {
  const p = getActiveSplit();
  return `Public ${p.publicPercent}% · Owner ${p.ownerPercent}% · Maintenance ${p.maintenancePercent}% · Mesh reserve ${p.meshReservePercent}%`;
}

export default {
  DEFAULT_RENT_SPLIT,
  RENT_SPLIT,
  splitGross,
  applyRentSplit,
  getPoolBalances,
  getAutoRentConfig,
  setAutoRentConfig,
  computeAutoOfferFromDevice,
  formatSplitPolicyLabel,
  getActiveSplit,
  getNetworkRates,
  setSplitPolicyOwner,
  setNetworkRatesOwner,
  setOneRateOwner,
  RATE_TABLE,
};
