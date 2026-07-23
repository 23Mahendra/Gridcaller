/**
 * GridCaller visiting-card profile — free form, photo, share mesh / WhatsApp / anywhere
 * Stored on device; optional broadcast on Grid network (FREE_RADIO / mesh bus).
 */

import { S } from "./storage";
import { MeshEngine } from "./mesh";
import { bus } from "./bus";

const KEY = "gc_profile_card_v1";
const INBOX_KEY = "gc_profile_cards_inbox_v1";

export type ProfileCard = {
  id: string;
  name: string;
  title?: string; // role / designation
  company?: string;
  phone?: string;
  email?: string;
  website?: string;
  bio?: string;
  /** data URL image/jpeg|png — compressed */
  photoDataUrl?: string;
  gridCallerId?: string;
  displayNumber?: string;
  updatedAt: number;
};

function uid() {
  return `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function loadMyCard(): ProfileCard {
  const raw = (S.get(KEY, null) as ProfileCard | null) || null;
  if (raw && raw.id) return raw;
  const seed: ProfileCard = {
    id: uid(),
    name: S.get("user_name", "GridCaller User") || "GridCaller User",
    phone: S.get("user_phone", "") || "",
    gridCallerId: S.get("mesh_id", "") || "",
    displayNumber: S.get("gc_test_display_number", "") || "",
    updatedAt: Date.now(),
  };
  S.set(KEY, seed);
  return seed;
}

export function saveMyCard(partial: Partial<ProfileCard>): ProfileCard {
  const prev = loadMyCard();
  const next: ProfileCard = {
    ...prev,
    ...partial,
    id: prev.id,
    name: String(partial.name ?? prev.name).trim() || prev.name,
    updatedAt: Date.now(),
  };
  S.set(KEY, next);
  // mirror common fields
  if (next.name) {
    S.set("user_name", next.name);
    S.set("mesh_name", next.name);
  }
  if (next.phone) S.set("user_phone", String(next.phone).replace(/\D/g, "") || next.phone);
  if (next.displayNumber) S.set("gc_test_display_number", next.displayNumber);
  if (next.gridCallerId) {
    S.set("mesh_id", next.gridCallerId);
    S.set("ga_mesh_id", next.gridCallerId);
  }
  bus.emit("profileCard:saved", next);
  return next;
}

/** Compress image file → data URL (max edge 480, jpeg ~0.72) for card size */
export function compressImageFile(file: File, maxEdge = 480, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("image decode"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function cardShareText(card: ProfileCard): string {
  const lines = [
    "📇 GridCaller Card",
    card.name,
    card.title ? card.title : "",
    card.company ? card.company : "",
    card.displayNumber || card.phone ? `📞 ${card.displayNumber || card.phone}` : "",
    card.email ? `✉ ${card.email}` : "",
    card.website ? `🔗 ${card.website}` : "",
    card.gridCallerId ? `GridCaller ID: ${card.gridCallerId}` : "",
    card.bio ? `\n${card.bio}` : "",
    "",
    "— Shared via GridCaller (mesh · no SIM required)",
  ].filter((l) => l !== "");
  return lines.join("\n");
}

/** WhatsApp share (opens app / web with prefilled text) */
export function shareCardWhatsApp(card: ProfileCard) {
  const text = encodeURIComponent(cardShareText(card));
  const url = `https://wa.me/?text=${text}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/** System share sheet / clipboard / custom */
export async function shareCardAnywhere(card: ProfileCard): Promise<"share" | "clipboard" | "download"> {
  const text = cardShareText(card);
  try {
    if (navigator.share) {
      const files: File[] = [];
      if (card.photoDataUrl?.startsWith("data:image")) {
        try {
          const blob = await (await fetch(card.photoDataUrl)).blob();
          files.push(new File([blob], `${card.name.replace(/\s+/g, "_")}_card.jpg`, { type: blob.type || "image/jpeg" }));
        } catch {}
      }
      if (files.length && (navigator as any).canShare?.({ files })) {
        await navigator.share({ title: `${card.name} — GridCaller`, text, files });
      } else {
        await navigator.share({ title: `${card.name} — GridCaller`, text });
      }
      return "share";
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return "share";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "clipboard";
  } catch {}
  // last resort download .txt card
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${card.name.replace(/\s+/g, "_")}_gridcaller_card.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  return "download";
}

/** Publish card on GridCaller mesh (other devices can save) */
export function shareCardOnGridNetwork(card: ProfileCard) {
  // strip huge photo if over ~120KB for mesh friendliness
  let photo = card.photoDataUrl;
  if (photo && photo.length > 160_000) {
    photo = undefined; // text card only on mesh if image too big
  }
  const payload = { ...card, photoDataUrl: photo, sharedAt: Date.now() };
  try {
    MeshEngine.broadcast("GRIDCALLER_CARD", payload);
  } catch (e) {
    console.warn("[ProfileCard] mesh share failed", e);
  }
  bus.emit("profileCard:meshShare", payload);
  return payload;
}

export function loadInbox(): ProfileCard[] {
  return (S.get(INBOX_KEY, []) as ProfileCard[]) || [];
}

export function receiveCard(card: Partial<ProfileCard> & { name?: string; id?: string }) {
  if (!card || !(card.name || card.phone || card.gridCallerId)) return null;
  const row: ProfileCard = {
    id: card.id || uid(),
    name: card.name || "Contact",
    title: card.title,
    company: card.company,
    phone: card.phone,
    email: card.email,
    website: card.website,
    bio: card.bio,
    photoDataUrl: card.photoDataUrl,
    gridCallerId: card.gridCallerId,
    displayNumber: card.displayNumber,
    updatedAt: card.updatedAt || Date.now(),
  };
  const inbox = loadInbox().filter((c) => c.id !== row.id);
  inbox.unshift(row);
  S.set(INBOX_KEY, inbox.slice(0, 100));
  bus.emit("profileCard:received", row);
  return row;
}

export function clearInbox() {
  S.set(INBOX_KEY, []);
}
