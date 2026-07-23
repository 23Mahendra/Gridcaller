// ═══════════════════════════════════════════════════════
// PLUGIN: GunDB — Decentralized Graph Database
// GitHub: github.com/amark/gun (18k+ stars)
// Enables offline-first, peer-synced data across mesh
// ═══════════════════════════════════════════════════════

import Gun from "gun/gun";
import "gun/sea";
import "gun/lib/radisk";
import { bus } from "../kernel/bus";

export interface GunUser {
  alias: string;
  pub: string;
  epub: string;
  sea: any;
}

class GunStore {
  private gun: any;
  private user: any;
  private _ready = false;

  get ready() { return this._ready; }
  get instance() { return this.gun; }

  /**
   * Initialize Gun — local-first, no cloud required.
   * Optional LAN peer: same-machine/mesh node gun websocket.
   */
  init(peers?: string[]) {
    if (this._ready && this.gun) return this.gun;

    const relays = (peers || []).filter(Boolean);
    // Prefer local mesh node as Gun peer (same LAN, no central cloud)
    const localPeers = [
      // Vite proxies /gun → mesh node when desktop/dev
      typeof location !== "undefined" ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/gun` : "",
      "http://127.0.0.1:8787/gun",
      "http://localhost:8787/gun",
    ].filter(Boolean);

    const peerList = Array.from(new Set([...relays, ...localPeers]));

    this.gun = Gun({
      peers: peerList,
      localStorage: true,
      radisk: true,
      multicast: false,
    });

    this.user = this.gun.user();
    this._ready = true;

    // Presence heartbeat on graph
    try {
      const nodeId =
        (typeof localStorage !== "undefined" && localStorage.getItem("ga_mesh_id")) ||
        `gun_${Date.now().toString(36)}`;
      this.put(`gridalive.gun.presence.${nodeId}`, {
        id: nodeId,
        ts: Date.now(),
        online: true,
        softwareOnly: true,
      });
    } catch {}

    bus.emit("gun:ready", { peers: peerList, localFirst: true });
    console.info("[GunDB] ready · peers:", peerList.length ? peerList.join(", ") : "(local-only radisk)");
    return this.gun;
  }

  /** Status for UI */
  getStatus() {
    return {
      ready: this._ready,
      authenticated: !!(this.user && this.user.is),
      alias: this.user?.is?.alias || null,
      pub: this.user?.is?.pub || null,
    };
  }

  /** Ensure init then put */
  ensure() {
    if (!this._ready) this.init();
    return this;
  }

  /** Create / login a user with SEA crypto */
  async createUser(alias: string, pass: string): Promise<GunUser> {
    return new Promise((resolve, reject) => {
      this.user.create(alias, pass, (ack: any) => {
        if (ack.err) return reject(new Error(ack.err));
        this.user.auth(alias, pass, (auth: any) => {
          if (auth.err) return reject(new Error(auth.err));
          const u: GunUser = { alias, pub: this.user.is.pub, epub: this.user.is.epub, sea: this.user._.sea };
          bus.emit("gun:user-created", u);
          resolve(u);
        });
      });
    });
  }

  /** Auth existing user */
  async login(alias: string, pass: string): Promise<GunUser> {
    return new Promise((resolve, reject) => {
      this.user.auth(alias, pass, (ack: any) => {
        if (ack.err) return reject(new Error(ack.err));
        const u: GunUser = { alias, pub: this.user.is.pub, epub: this.user.is.epub, sea: this.user._.sea };
        bus.emit("gun:user-login", u);
        resolve(u);
      });
    });
  }

  /** Put data to shared graph (public) */
  put(path: string, data: any) {
    const ref = this.navigate(path);
    ref.put(data);
    bus.emit("gun:put", { path, data });
  }

  /** Put data to user's encrypted space */
  putPrivate(path: string, data: any) {
    if (!this.user.is) throw new Error("Not authenticated");
    this.user.get(path).put(data);
  }

  /** Get data with real-time subscription */
  on(path: string, callback: (data: any, key: string) => void): () => void {
    const ref = this.navigate(path);
    ref.on(callback);
    return () => ref.off();
  }

  /** One-time read */
  async once(path: string): Promise<any> {
    return new Promise((resolve) => {
      this.navigate(path).once((data: any) => resolve(data));
    });
  }

  /** Set in a collection (auto-ID) */
  addToSet(path: string, data: any) {
    const ref = this.navigate(path);
    ref.set(data);
  }

  /** Map over collection items */
  map(path: string, callback: (data: any, key: string) => void) {
    const ref = this.navigate(path);
    ref.map().on(callback);
    return () => ref.map().off();
  }

  /** Navigate dot-notation path like "sos.alerts" → gun.get("sos").get("alerts") */
  private navigate(path: string) {
    const parts = path.split(".");
    let ref = this.gun;
    for (const p of parts) ref = ref.get(p);
    return ref;
  }

  // ─── Convenience methods for GridAlive features ───

  /** SOS: Broadcast an emergency alert to the Gun network */
  broadcastSOS(alert: { userId: string; name: string; type: string; lat?: number; lng?: number; message: string }) {
    const entry = { ...alert, ts: Date.now(), id: `sos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    this.addToSet("gridalive.sos.alerts", entry);
    bus.emit("sos:broadcast", entry);
    return entry;
  }

  /** Blood Bank: Register blood availability */
  registerBlood(data: { userId: string; name: string; bloodType: string; available: boolean; lat?: number; lng?: number }) {
    this.put(`gridalive.blood.donors.${data.userId}`, { ...data, ts: Date.now() });
  }

  /** Feed: Post to social feed */
  postToFeed(post: { userId: string; name: string; content: string; media?: string }) {
    const entry = { ...post, ts: Date.now(), id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, likes: 0 };
    this.addToSet("gridalive.feed.posts", entry);
    return entry;
  }

  /** Chat: Send a message between peers */
  sendMessage(roomId: string, msg: { from: string; text: string; encrypted?: boolean }) {
    const entry = { ...msg, ts: Date.now(), id: `msg_${Date.now()}` };
    this.addToSet(`gridalive.chat.rooms.${roomId}`, entry);
    return entry;
  }

  /** Location: Update user position on the mesh map */
  updateLocation(userId: string, lat: number, lng: number, meta?: any) {
    this.put(`gridalive.locations.${userId}`, { lat, lng, ts: Date.now(), ...meta });
  }

  /** Barter: List an item for trade */
  listBarterItem(item: { userId: string; title: string; description: string; category: string; image?: string }) {
    const entry = { ...item, ts: Date.now(), id: `barter_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
    this.addToSet("gridalive.barter.items", entry);
    return entry;
  }

  /** Skills: Register a skill offering */
  registerSkill(skill: { userId: string; name: string; skill: string; level: string; available: boolean }) {
    this.put(`gridalive.skills.${skill.userId}`, { ...skill, ts: Date.now() });
  }
}

export const gunStore = new GunStore();
export default gunStore;
