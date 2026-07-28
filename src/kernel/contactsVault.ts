/**
 * GridCaller Contacts Vault — local-first address book (Truecaller-class features)
 * · Persist all contacts in localStorage / IndexedDB-friendly store
 * · Import from device (Contact Picker API)
 * · Add / edit / delete / favourite / spam flag / notes
 * · Search by name, phone, email
 */

import { S } from "./storage";
import { bus } from "./bus";
import { deviceVault } from "./deviceVault";

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
const DB_KEY = "gridcaller.contacts";

function mirrorToDeviceVault(key: string, value: unknown) {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  try {
    void deviceVault.put(key, value).catch(() => {});
  } catch {}
}

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
  private hydrated = false;

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
    mirrorToDeviceVault(DB_KEY, rows);
    bus.emit("contacts:changed", { count: rows.length });
  }

  async initLocalDb() {
    if (this.hydrated) return this.list();
    this.hydrated = true;
    try {
      await deviceVault.init();
    } catch {
      deviceVault.ensure();
    }
    try {
      const stored = await deviceVault.get<GridContact[]>(DB_KEY);
      if (Array.isArray(stored) && stored.length) {
        const current = (S.get(KEY, []) as GridContact[]) || [];
        if (!current.length) {
          S.set(KEY, stored);
          bus.emit("contacts:changed", { count: stored.length });
        }
      }
    } catch {}
    return this.list();
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
      return await this.importFromFileFallback();
    } catch (e: any) {
      if (e?.name === "InvalidStateError" || /cancel/i.test(String(e?.message))) {
        return { ok: false, count: 0, error: "Cancelled" };
      }
      try {
        return await this.importFromFileFallback();
      } catch {
        return { ok: false, count: 0, error: e?.message || "Import failed" };
      }
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

  private async pickImportFile(): Promise<File | null> {
    return await new Promise((resolve) => {
      try {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,.csv,.vcf,.vcard,text/csv,text/vcard,application/json";
        input.onchange = () => resolve(input.files?.[0] || null);
        input.oncancel = () => resolve(null as File | null);
        input.click();
      } catch {
        resolve(null);
      }
    });
  }

  private parseCsv(raw: string) {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return [] as Array<{ name?: string; phones?: string[]; email?: string | string[] }>;
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIndex = headers.findIndex((h) => h === "name" || h === "full name" || h === "displayname");
    const phoneIndex = headers.findIndex((h) => h === "phone" || h === "mobile" || h === "tel" || h === "number");
    const emailIndex = headers.findIndex((h) => h === "email" || h === "e-mail");
    return lines.slice(1).map((line) => {
      const cells = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
      return {
        name: nameIndex >= 0 ? cells[nameIndex] : cells[0],
        phones: phoneIndex >= 0 && cells[phoneIndex] ? [cells[phoneIndex]] : [],
        email: emailIndex >= 0 ? cells[emailIndex] : undefined,
      };
    });
  }

  private parseVcard(raw: string) {
    const cards = raw.split(/END:VCARD/i);
    const rows: Array<{ name?: string; phones?: string[]; email?: string[] }> = [];
    for (const card of cards) {
      const block = card.trim();
      if (!block) continue;
      const lines = block.split(/\r?\n/).map((line) => line.trim());
      let name = "";
      const phones: string[] = [];
      const emails: string[] = [];
      for (const line of lines) {
        if (!name && /^FN[:;]/i.test(line)) {
          name = line.split(":").slice(1).join(":").trim();
          continue;
        }
        if (!name && /^N[:;]/i.test(line)) {
          const parts = line.split(":").slice(1).join(":").split(";").filter(Boolean);
          name = parts.reverse().join(" ").trim();
          continue;
        }
        if (/^TEL/i.test(line)) {
          const value = line.split(":").slice(1).join(":").trim();
          if (value) phones.push(value);
          continue;
        }
        if (/^EMAIL/i.test(line)) {
          const value = line.split(":").slice(1).join(":").trim();
          if (value) emails.push(value);
        }
      }
      if (name || phones.length || emails.length) {
        rows.push({ name: name || "Unknown", phones, email: emails });
      }
    }
    return rows;
  }

  private async importFromFileFallback(): Promise<{ ok: boolean; count: number; error?: string }> {
    const file = await this.pickImportFile();
    if (!file) return { ok: false, count: 0, error: "Cancelled" };
    const raw = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".json")) return this.importJson(raw);
    if (lower.endsWith(".vcf") || lower.endsWith(".vcard")) {
      const count = this.importMany(this.parseVcard(raw), "import");
      return { ok: true, count };
    }
    if (lower.endsWith(".csv")) {
      const count = this.importMany(this.parseCsv(raw), "import");
      return { ok: true, count };
    }
    return { ok: false, count: 0, error: "Unsupported contact file. Use JSON, CSV, or VCF." };
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
