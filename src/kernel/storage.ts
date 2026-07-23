// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Storage Abstraction
// localStorage wrapper used by all blocks
// ═══════════════════════════════════════════════════════

import type { StorageAPI } from "./types";

export const BRAND_STORAGE_PREFIX = "gridalive_";
export const LEGACY_STORAGE_PREFIX = "madadnet_";

export function primaryStorageKey(key: string): string {
  if (key.startsWith(LEGACY_STORAGE_PREFIX)) {
    return `${BRAND_STORAGE_PREFIX}${key.slice(LEGACY_STORAGE_PREFIX.length)}`;
  }
  return key;
}

export function legacyStorageKey(key: string): string | null {
  const primary = primaryStorageKey(key);
  if (!primary.startsWith(BRAND_STORAGE_PREFIX)) return null;
  return `${LEGACY_STORAGE_PREFIX}${primary.slice(BRAND_STORAGE_PREFIX.length)}`;
}

export function storageKeyCandidates(key: string): string[] {
  const primary = primaryStorageKey(key);
  const legacy = legacyStorageKey(primary);
  return legacy && legacy !== primary ? [primary, legacy] : [primary];
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function promoteLegacyValue(key: string) {
  const primary = primaryStorageKey(key);
  const legacy = legacyStorageKey(primary);
  if (!legacy || primary === legacy) return;
  const primaryRaw = readRaw(primary);
  const legacyRaw = readRaw(legacy);
  if (primaryRaw === null && legacyRaw !== null) {
    try {
      localStorage.setItem(primary, legacyRaw);
    } catch {}
  }
}

export function removeStorageValue(key: string) {
  for (const candidate of storageKeyCandidates(key)) {
    try {
      localStorage.removeItem(candidate);
    } catch {}
  }
}

export function migrateLegacyBrandStorage() {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  const legacyKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LEGACY_STORAGE_PREFIX)) {
      legacyKeys.push(key);
    }
  }

  for (const legacyKey of legacyKeys) {
    const primary = primaryStorageKey(legacyKey);
    if (readRaw(primary) === null) {
      const legacyRaw = readRaw(legacyKey);
      if (legacyRaw !== null) {
        try {
          localStorage.setItem(primary, legacyRaw);
        } catch {}
      }
    }
  }
}

/** localStorage-backed storage with GridAlive branding + legacy fallback */
export const S: StorageAPI = {
  get: (k: string, d: any = null) => {
    try {
      promoteLegacyValue(k);
      for (const key of storageKeyCandidates(k)) {
        const raw = readRaw(key);
        if (!raw) continue;
        return JSON.parse(raw);
      }
      return d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: any) => {
    try {
      const primary = primaryStorageKey(k);
      localStorage.setItem(primary, JSON.stringify(v));
      const legacy = legacyStorageKey(primary);
      if (legacy && legacy !== primary) {
        localStorage.removeItem(legacy);
      }
    } catch {}
  },
};
