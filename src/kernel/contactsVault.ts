/**
 * GridCaller Contacts Vault — local-first address book (Truecaller-class features)
 * · Persist all contacts in localStorage / IndexedDB-friendly store
 * · Import from device (Contact Picker API)
 * · Add / edit / delete / favourite / spam flag / notes
 * · Search by name, phone, email
 */

import { S } from "./storage";
import { bus } from "./bus";

export type ContactSource = "manual" | "device" | "mesh" | "import";

export interface GridContact {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  company?: string;
  notes?: string;
  favourite: boolean;
  spam: boolean;
  avatarHue?: string;
  peerId?: string; // linked mesh peer if any
  source: ContactSource;
  createdAt: number;
  updatedAt: number;
}

const KEY = "gridcaller_contacts_v1";

function uid() {
  return `ct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function digits(s: string) {
  return String(s || "").replace(/\D/g, "");
}

function normalizePhone(p: string) {
  const raw = String(p || "").trim();
  if (!raw) return "";

  const d = digits(raw);
  if (!d) return raw;

  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 11 && /^0[6-9]/.test(d)) return `+91${d.slice(1)}`;
  if (d.length === 12 && /^91[6-9]/.test(d)) return `+${d}`;
  if (d.length >= 10) return raw.startsWith("+") ? `+${d}` : `+${d}`;
  return raw;
}

function looksLikeMobileNumber(p: string) {
  const d = digits(p);
  return (
    (d.length === 10 && /^[6-9]/.test(d)) ||
    (d.length === 11 && /^0[6-9]/.test(d)) ||
    (d.length === 12 && /^91[6-9]/.test(d)) ||
    (d.length === 13 && /^\+91[6-9]/.test(`+${d}`))
  );
}

function sortPhones(phones: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const p of phones || []) {
    const n = normalizePhone(p);
    if (!n) continue;
    const key = digits(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(n);
  }

  return normalized.sort((a, b) => {
    const aMobile = looksLikeMobileNumber(a) ? 0 : 1;
    const bMobile = looksLikeMobileNumber(b) ? 0 : 1;
    if (aMobile !== bMobile) return aMobile - bMobile;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

class ContactsVault {
  getPrimaryPhone(contact: GridContact | null | undefined): string {
    if (!contact) return "";
    return sortPhones(contact.phones || [])[0] || "";
  }

  list(): GridContact[] {
    const rows = (S.get(KEY, []) as GridContact[]) || [];
    return rows
      .filter((c) => c && c.id && c.name)
      .sort((a, b) => {
        if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }

  private save(rows: GridContact[]) {
    S.set(KEY, rows);
    bus.emit("contacts:changed", { count: rows.length });
  }

  get(id: string): GridContact | null {
    return this.list().find((c) => c.id === id) || null;
  }

  search(q: string): GridContact[] {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return this.list();
    const dq = digits(s);
    return this.list().filter((c) => {
      if (c.name.toLowerCase().includes(s)) return true;
      if (c.company?.toLowerCase().includes(s)) return true;
      if (c.notes?.toLowerCase().includes(s)) return true;
      if (c.emails.some((e) => e.toLowerCase().includes(s))) return true;
      if (dq && c.phones.some((p) => digits(p).includes(dq))) return true;
      return false;
    });
  }

  upsert(input: Partial<GridContact> & { name: string }): GridContact {
    const rows = this.list();
    const now = Date.now();
    const phones = sortPhones(input.phones || []);
    // de-dupe by primary phone if new
    if (!input.id && phones[0]) {
      const existing = rows.find((c) => c.phones.some((p) => digits(p) === digits(phones[0])));
      if (existing) {
        return this.upsert({
          ...existing,
          ...input,
          id: existing.id,
          phones: Array.from(new Set([...existing.phones, ...phones])),
          emails: Array.from(new Set([...(existing.emails || []), ...(input.emails || [])])),
        });
      }
    }

    if (input.id) {
      const i = rows.findIndex((c) => c.id === input.id);
      if (i >= 0) {
        const next: GridContact = {
          ...rows[i],
          ...input,
          name: String(input.name || rows[i].name).trim(),
          phones: phones.length ? phones : rows[i].phones,
          emails: input.emails !== undefined ? input.emails.filter(Boolean) : rows[i].emails,
          favourite: input.favourite ?? rows[i].favourite,
          spam: input.spam ?? rows[i].spam,
          updatedAt: now,
        };
        rows[i] = next;
        this.save(rows);
        return next;
      }
    }

    const created: GridContact = {
      id: input.id || uid(),
      name: String(input.name).trim() || "Unknown",
      phones,
      emails: (input.emails || []).filter(Boolean),
      company: input.company || "",
      notes: input.notes || "",
      favourite: !!input.favourite,
      spam: !!input.spam,
      peerId: input.peerId,
      source: input.source || "manual",
      createdAt: now,
      updatedAt: now,
    };
    rows.unshift(created);
    this.save(rows);
    return created;
  }

  remove(id: string) {
    this.save(this.list().filter((c) => c.id !== id));
  }

  toggleFavourite(id: string) {
    const c = this.get(id);
    if (!c) return null;
    return this.upsert({ ...c, favourite: !c.favourite });
  }

  toggleSpam(id: string) {
    const c = this.get(id);
    if (!c) return null;
    return this.upsert({ ...c, spam: !c.spam });
  }

  /** Merge array of contacts (device import) into vault */
  importMany(
    items: Array<{ name?: string; tel?: string | string[]; email?: string | string[]; phones?: string[] }>,
    source: ContactSource = "device"
  ): number {
    let n = 0;
    for (const it of items) {
      const name = String(it.name || "").trim() || "Unknown";
      let phones: string[] = [];
      if (Array.isArray(it.phones)) phones = it.phones;
      else if (Array.isArray(it.tel)) phones = it.tel;
      else if (it.tel) phones = [String(it.tel)];
      let emails: string[] = [];
      if (Array.isArray(it.email)) emails = it.email.map(String);
      else if (it.email) emails = [String(it.email)];
      if (!phones.length && !emails.length) continue;
      this.upsert({ name, phones, emails, source });
      n++;
    }
    return n;
  }

  /**
   * Device contact picker (Chrome Android / supported browsers).
   * Desktop: returns empty + reason — user can still add manually / paste CSV.
   */
  async importFromDevice(): Promise<{ ok: boolean; count: number; error?: string }> {
    try {
      const nav = navigator as any;
      if (nav.contacts?.select) {
        const props = ["name", "tel", "email"];
        const selected = await nav.contacts.select(props, { multiple: true });
        const mapped = (selected || []).map((c: any) => ({
          name: Array.isArray(c.name) ? c.name[0] : c.name || "Unknown",
          tel: c.tel || [],
          email: c.email || [],
        }));
        const count = this.importMany(mapped, "device");
        return { ok: true, count };
      }
      return {
        ok: false,
        count: 0,
        error: "Contacts import is unavailable on this browser.",
      };
    } catch (e: any) {
      if (e?.name === "InvalidStateError" || /cancel/i.test(String(e?.message))) {
        return { ok: false, count: 0, error: "Cancelled" };
      }
      return { ok: false, count: 0, error: e?.message || "Import failed" };
    }
  }

  /** Export all contacts as JSON string */
  exportJson(): string {
    return JSON.stringify(this.list(), null, 2);
  }

  importJson(raw: string): { ok: boolean; count: number; error?: string } {
    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : data?.contacts;
      if (!Array.isArray(arr)) return { ok: false, count: 0, error: "Invalid JSON" };
      let n = 0;
      for (const c of arr) {
        if (!c?.name) continue;
        this.upsert({
          name: c.name,
          phones: c.phones || (c.phone ? [c.phone] : []) || (c.tel ? [].concat(c.tel) : []),
          emails: c.emails || (c.email ? [].concat(c.email) : []),
          company: c.company,
          notes: c.notes,
          favourite: !!c.favourite,
          spam: !!c.spam,
          source: "import",
        });
        n++;
      }
      return { ok: true, count: n };
    } catch (e: any) {
      return { ok: false, count: 0, error: e?.message || "Parse error" };
    }
  }

  /** Sync mesh online peers into contacts (non-destructive merge; skip unchanged) */
  syncMeshPeers(peers: Array<{ id: string; name: string; online?: boolean }>) {
    for (const p of peers) {
      if (!p.id || !p.name) continue;
      const rows = this.list();
      const hit = rows.find((c) => c.peerId === p.id);
      if (hit) {
        if (hit.name === p.name) continue;
        this.upsert({ ...hit, name: p.name || hit.name, peerId: p.id });
      } else {
        this.upsert({
          name: p.name,
          phones: [],
          emails: [],
          peerId: p.id,
          source: "mesh",
          notes: "Mesh peer",
        });
      }
    }
  }

  stats() {
    const all = this.list();
    return {
      total: all.length,
      favourites: all.filter((c) => c.favourite).length,
      spam: all.filter((c) => c.spam).length,
      withPhone: all.filter((c) => c.phones.length > 0).length,
    };
  }
}

export const contactsVault = new ContactsVault();
export default contactsVault;
