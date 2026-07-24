const MAX_TTL = 16;
const BEACON_MS = 2500;

export type TowerRelayPolicy = {
  enabled: boolean;
  aggressive: boolean;
  localOnly: boolean;
  beaconMs: number;
  maxTtl: number;
};

export function resolveTowerRelayPolicy(storage: { get: (k: string, d?: any) => any; set?: (k: string, v: any) => void }): TowerRelayPolicy {
  const saved = storage.get?.("gc_tower_relay_policy", null);
  if (saved && typeof saved === "object") {
    return {
      enabled: saved.enabled !== false,
      aggressive: saved.aggressive !== false,
      localOnly: saved.localOnly !== false,
      beaconMs: Number(saved.beaconMs) || BEACON_MS,
      maxTtl: Number(saved.maxTtl) || MAX_TTL,
    };
  }
  return {
    enabled: true,
    aggressive: true,
    localOnly: true,
    beaconMs: BEACON_MS,
    maxTtl: MAX_TTL,
  };
}
