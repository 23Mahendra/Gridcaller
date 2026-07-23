/**
 * Persistent storage helper used by all feature modules as `S`.
 * Backed by localStorage with safe JSON parse/stringify.
 */
const PREFIX = "ga_";

function keyOf(key: string) {
  return key.startsWith(PREFIX) ? key : PREFIX + key;
}

export const S = {
  get<T = any>(key: string, def?: T): T {
    try {
      const raw = localStorage.getItem(keyOf(key));
      if (raw == null) return def as T;
      return JSON.parse(raw) as T;
    } catch {
      try {
        const raw = localStorage.getItem(keyOf(key));
        return (raw as unknown as T) ?? (def as T);
      } catch {
        return def as T;
      }
    }
  },

  set(key: string, val: any): void {
    try {
      localStorage.setItem(keyOf(key), JSON.stringify(val));
    } catch (e) {
      console.warn("[S] storage full or blocked", e);
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(keyOf(key));
    } catch {}
  },

  /** Raw localStorage without prefix (legacy keys) */
  getRaw(key: string, def?: any) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return def;
      return JSON.parse(raw);
    } catch {
      return def;
    }
  },

  setRaw(key: string, val: any) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  },
};

export default S;
