import { S } from "../kernel/storage";

const RELAY_KEY = "gc_relay_enabled";
const SYNC_KEY = "gc_sync_enabled";
const RETENTION_KEY = "gc_sync_retention_ms";

type HeldEnvelope = {
  recipientId: string;
  envelope: unknown;
  ts: number;
};

export type NodeCapabilities = {
  relay: boolean;
  storage: boolean;
};

export function setRelayMode(enabled: boolean) {
  S.set(RELAY_KEY, !!enabled);
}

export function setSyncNode(enabled: boolean) {
  S.set(SYNC_KEY, !!enabled);
}

export function getNodeCapabilities(): NodeCapabilities {
  return {
    relay: S.get(RELAY_KEY, false) === true,
    storage: S.get(SYNC_KEY, false) === true,
  };
}

export function syncRetentionMs(): number {
  const value = Number(S.get(RETENTION_KEY, 24 * 60 * 60 * 1000));
  return Number.isFinite(value) && value > 0 ? value : 24 * 60 * 60 * 1000;
}

export class RelayService {
  isEnabled() {
    return getNodeCapabilities().relay;
  }

  shouldForward(ttl: number) {
    return this.isEnabled() && ttl > 0;
  }
}

export class SyncNodeService {
  private held = new Map<string, HeldEnvelope[]>();

  isEnabled() {
    return getNodeCapabilities().storage;
  }

  hold(recipientId: string, envelope: unknown) {
    if (!this.isEnabled() || !recipientId) return;
    const next = this.held.get(recipientId) || [];
    next.push({ recipientId, envelope, ts: Date.now() });
    this.held.set(recipientId, next);
    this.prune();
  }

  take(recipientId: string): HeldEnvelope[] {
    this.prune();
    const rows = this.held.get(recipientId) || [];
    this.held.delete(recipientId);
    return rows;
  }

  private prune() {
    const cutoff = Date.now() - syncRetentionMs();
    for (const [recipient, rows] of this.held) {
      const fresh = rows.filter((row) => row.ts >= cutoff);
      if (!fresh.length) this.held.delete(recipient);
      else this.held.set(recipient, fresh);
    }
  }
}
