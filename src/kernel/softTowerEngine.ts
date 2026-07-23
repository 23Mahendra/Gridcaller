/**
 * GridAlive Soft Tower — software cellular metaphor
 *
 * Every GridAlive device is a "cell":
 *  · Virtual number (Grid Number +91 70…) = MSISDN-like identity
 *  · Optional SIM phone digits bound as ALIAS (so dialing 98xxx finds GridAlive peer)
 *  · Soft tower registry on Gun + local mesh = HLR/VLR style presence
 *  · Call path = WebRTC over mesh / any internet (not RF tower hijack)
 *
 * Permutations when user dials ANY digits:
 *  1) Exact Grid Number / short dial / handle
 *  2) Bound SIM alias of online GridAlive users
 *  3) Presence map by handle = digits / last-10 / last-8
 *  4) Local mesh peers by name/id/phone field
 *  5) Soft-tower directory (Gun global)
 *  6) If still no peer: ring soft-tower "paging" + clear miss (never dead-end block)
 *
 * Honest physics: we do not emit licensed cellular RF. We ARE the network for
 * anyone running GridAlive — virtual number + software tower + free calls.
 */

import { bus } from "./bus";
import { S } from "./storage";
import { MeshEngine } from "./mesh";
import gridNumberRegistry, { normalizeGridNumber, formatGridNumber } from "./gridNumberRegistry";
import globalCall from "./globalCallEngine";
import meshComms from "./meshCommsEngine";

export type SoftTowerResolve = {
  ok: boolean;
  toId: string;
  toName: string;
  virtualNumber?: string;
  method: "grid-number" | "sim-alias" | "handle" | "mesh-peer" | "soft-tower" | "self" | "unresolved";
  permutationsTried: string[];
  note?: string;
};

export type SoftCell = {
  nodeId: string;
  virtualNumber: string; // 9170…
  display: string;
  handle: string;
  /** Optional real SIM digits bound as dial alias only (not carrier interconnect) */
  simAlias?: string;
  name: string;
  online: true;
  ts: number;
  tower: "gridalive-soft";
};

const KEYS = {
  simAlias: "soft_tower_sim_alias",
  cells: "soft_tower_local_cells",
};

function digitsOnly(s: string) {
  return String(s || "").replace(/\D/g, "");
}

function nodeId() {
  return (
    MeshEngine.localId ||
    S.get("omni_node_id") ||
    S.get("mesh_id") ||
    S.get("ga_mesh_id") ||
    `ga_${Date.now().toString(36)}`
  );
}

/** All dial permutations for a user-entered string */
export function dialPermutations(input: string): string[] {
  const raw = String(input || "").trim();
  const d = digitsOnly(raw);
  const set = new Set<string>();
  if (raw) set.add(raw.toLowerCase());
  if (d) {
    set.add(d);
    if (d.length >= 8) set.add(d.slice(-8));
    if (d.length >= 10) set.add(d.slice(-10));
    // India variants
    if (d.length === 10) {
      set.add("91" + d);
      set.add("9170" + d.slice(-8)); // if someone confuses ranges
      set.add("+91" + d);
    }
    if (d.startsWith("91") && d.length >= 12) {
      set.add(d.slice(2)); // without country
      set.add(d.slice(-10));
    }
    if (d.startsWith("0") && d.length === 11) set.add(d.slice(1));
    // GridAlive virtual range normalize
    const gn = normalizeGridNumber(d);
    if (gn) set.add(gn);
    if (gn.length >= 10) set.add(gn.slice(-10));
    if (gn.length >= 8) set.add(gn.slice(-8));
  }
  // slug-like handle
  const slug = raw.toLowerCase().replace(/[^a-z0-9+]/g, "");
  if (slug) set.add(slug);
  return [...set].filter(Boolean);
}

class SoftTowerEngine {
  private gun: any = null;
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start(user?: { id?: string; name?: string; phone?: string }) {
    if (this.started) {
      this.publishCell(user);
      return this.getMyCell(user);
    }
    this.started = true;

    // Ensure virtual number exists
    try {
      gridNumberRegistry.start(user);
    } catch {}

    // Auto-bind profile phone as SIM alias (dialable → this GridAlive cell)
    const phone = digitsOnly(user?.phone || S.get("user_phone", "") || "");
    if (phone.length >= 10) this.bindSimAlias(phone);

    void this.initGun();
    this.publishCell(user);
    if (this.publishTimer) clearInterval(this.publishTimer);
    this.publishTimer = setInterval(() => this.publishCell(user), 10000);

    bus.emit("softTower:ready", this.getMyCell(user));
    console.info("[SoftTower] cell online ·", this.getMyCell(user)?.display);
    return this.getMyCell(user);
  }

  private async initGun() {
    try {
      const { gunPeersForMesh, useLocalMeshOnly } = await import("./offlineMode");
      const Gun = (await import("gun/gun")).default;
      // Flight mode: no public Gun — local graph only (SIM not required)
      const peers = gunPeersForMesh(
        useLocalMeshOnly()
          ? []
          : ["https://gun-manhattan.herokuapp.com/gun", "https://gunjs.herokuapp.com/gun"]
      );
      this.gun = Gun({
        peers,
        localStorage: true,
        radisk: false,
        multicast: false,
      });
    } catch (e) {
      console.warn("[SoftTower] Gun deferred", e);
    }
  }

  /** Bind real SIM digits so others can dial that number and reach THIS GridAlive */
  bindSimAlias(phoneDigits: string) {
    const d = digitsOnly(phoneDigits);
    if (d.length < 10) return false;
    S.set(KEYS.simAlias, d);
    // Also index on grid number registry handle-style
    try {
      const me = gridNumberRegistry.getMyNumber();
      if (me) {
        // store alias map locally
        const aliases = (S.get("soft_tower_aliases", {}) as Record<string, string>) || {};
        aliases[d] = me.number;
        aliases[d.slice(-10)] = me.number;
        S.set("soft_tower_aliases", aliases);
      }
    } catch {}
    this.publishCell();
    return true;
  }

  getSimAlias(): string {
    return digitsOnly(S.get(KEYS.simAlias, "") || "");
  }

  getMyCell(user?: { name?: string; phone?: string }): SoftCell | null {
    const num = gridNumberRegistry.getMyNumber();
    if (!num) return null;
    const id = nodeId();
    const sim = this.getSimAlias() || digitsOnly(user?.phone || "");
    return {
      nodeId: id,
      virtualNumber: num.number,
      display: num.display,
      handle: globalCall.callHandle || num.shortDial || num.number.slice(-10),
      simAlias: sim || undefined,
      name: user?.name || S.get("user_name") || num.userName || "User",
      online: true,
      ts: Date.now(),
      tower: "gridalive-soft",
    };
  }

  private publishCell(user?: { name?: string; phone?: string }) {
    const cell = this.getMyCell(user);
    if (!cell) return;
    // Local cache
    const cells = (S.get(KEYS.cells, {}) as Record<string, SoftCell>) || {};
    cells[cell.nodeId] = cell;
    S.set(KEYS.cells, cells);

    // Publish on all indexes: virtual number, short, sim alias, handle
    const put = (key: string) => {
      try {
        this.gun?.get("gridalive").get("soft_tower").get("cells").get(key).put(cell);
      } catch {}
    };
    put(cell.virtualNumber);
    put(cell.virtualNumber.slice(-10));
    put(cell.virtualNumber.slice(-8));
    put(cell.handle);
    put(cell.nodeId);
    if (cell.simAlias) {
      put(cell.simAlias);
      put(cell.simAlias.slice(-10));
    }

    // Also register sim alias as globalCall handle so existing path works
    try {
      if (cell.simAlias) {
        // don't overwrite custom handle permanently — dual-index only on soft tower
      }
      if (cell.handle) globalCall.setHandle?.(cell.handle);
    } catch {}

    try {
      MeshEngine.broadcast("SOFT_TOWER_CELL", cell);
    } catch {}
    bus.emit("softTower:publish", cell);
  }

  private loadLocalCells(): SoftCell[] {
    const cells = (S.get(KEYS.cells, {}) as Record<string, SoftCell>) || {};
    const now = Date.now();
    return Object.values(cells).filter((c) => c && now - (c.ts || 0) < 120000);
  }

  private async gunLookup(key: string): Promise<SoftCell | null> {
    if (!this.gun || !key) return null;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 2800);
      try {
        this.gun
          .get("gridalive")
          .get("soft_tower")
          .get("cells")
          .get(key)
          .once((data: any) => {
            clearTimeout(t);
            if (data?.nodeId && data?.virtualNumber) resolve(data as SoftCell);
            else resolve(null);
          });
      } catch {
        clearTimeout(t);
        resolve(null);
      }
    });
  }

  /**
   * Resolve dial input through all permutations → online GridAlive cell
   */
  async resolve(dial: string): Promise<SoftTowerResolve> {
    const perms = dialPermutations(dial);
    const my = this.getMyCell();
    const myId = my?.nodeId || nodeId();

    // Self-dial guard
    for (const p of perms) {
      if (
        my &&
        (p === my.virtualNumber ||
          p === my.virtualNumber.slice(-10) ||
          p === my.simAlias ||
          p === my.simAlias?.slice(-10) ||
          p === my.handle ||
          p === myId)
      ) {
        return {
          ok: false,
          toId: myId,
          toName: my.name,
          method: "self",
          permutationsTried: perms,
          note: "Cannot call your own cell — open GridAlive on the other device.",
        };
      }
    }

    // 1) Local soft-tower cache
    for (const cell of this.loadLocalCells()) {
      for (const p of perms) {
        if (
          cell.nodeId === p ||
          cell.virtualNumber === p ||
          cell.virtualNumber.endsWith(p) ||
          cell.handle === p ||
          (cell.simAlias && (cell.simAlias === p || cell.simAlias.endsWith(p)))
        ) {
          if (cell.nodeId !== myId) {
            return {
              ok: true,
              toId: cell.nodeId,
              toName: cell.name,
              virtualNumber: cell.virtualNumber,
              method: cell.simAlias && perms.some((x) => cell.simAlias!.endsWith(x) || cell.simAlias === x)
                ? "sim-alias"
                : "soft-tower",
              permutationsTried: perms,
            };
          }
        }
      }
    }

    // 2) Grid number registry
    for (const p of perms) {
      const rec = gridNumberRegistry.resolve(p);
      if (rec?.nodeId && rec.nodeId !== myId) {
        return {
          ok: true,
          toId: rec.nodeId,
          toName: rec.userName || rec.display,
          virtualNumber: rec.number,
          method: "grid-number",
          permutationsTried: perms,
        };
      }
    }

    // 3) Mesh peers (local)
    try {
      const list = meshComms.getPeers?.() || meshComms.nearbyPeers || [];
      for (const peer of list) {
        const pid = peer.peerId || peer.id;
        const phone = digitsOnly(peer.phone || peer.userPhone || "");
        for (const p of perms) {
          if (
            pid === p ||
            (peer.name && String(peer.name).toLowerCase() === p) ||
            (phone && (phone === p || phone.endsWith(p)))
          ) {
            return {
              ok: true,
              toId: pid,
              toName: peer.name || pid,
              method: "mesh-peer",
              permutationsTried: perms,
            };
          }
        }
      }
    } catch {}

    // 4) Global call handle resolve
    for (const p of perms) {
      try {
        const hit = await globalCall.resolvePeer(p);
        if (hit?.id && hit.id !== myId) {
          return {
            ok: true,
            toId: hit.id,
            toName: hit.name || p,
            method: "handle",
            permutationsTried: perms,
          };
        }
      } catch {}
    }

    // 5) Soft tower Gun directory (all perms)
    for (const p of perms) {
      const cell = await this.gunLookup(p);
      if (cell?.nodeId && cell.nodeId !== myId) {
        // cache
        const cells = (S.get(KEYS.cells, {}) as Record<string, SoftCell>) || {};
        cells[cell.nodeId] = { ...cell, ts: Date.now() };
        S.set(KEYS.cells, cells);
        return {
          ok: true,
          toId: cell.nodeId,
          toName: cell.name,
          virtualNumber: cell.virtualNumber,
          method: cell.simAlias && perms.some((x) => cell.simAlias!.includes(x)) ? "sim-alias" : "soft-tower",
          permutationsTried: perms,
        };
      }
    }

    // 6) Remote grid number resolve
    for (const p of perms.slice(0, 6)) {
      try {
        const remote = await gridNumberRegistry.resolveRemote(p);
        if (remote?.nodeId && remote.nodeId !== myId) {
          return {
            ok: true,
            toId: remote.nodeId,
            toName: remote.name || p,
            virtualNumber: remote.number,
            method: "grid-number",
            permutationsTried: perms,
          };
        }
      } catch {}
    }

    return {
      ok: false,
      toId: "",
      toName: dial,
      method: "unresolved",
      permutationsTried: perms,
      note:
        "No GridAlive cell online for this number yet. Other person must open GridAlive once (registers soft-tower + virtual number). Your virtual number works like a phone number inside GridAlive network.",
    };
  }

  /**
   * Place call through soft tower: resolve → global WebRTC (any network) → mesh fallback
   */
  async placeCall(
    dial: string,
    opts?: { preferLocal?: boolean }
  ): Promise<{
    ok: boolean;
    error?: string;
    resolve?: SoftTowerResolve;
    pc?: RTCPeerConnection;
    path?: string;
  }> {
    this.start();
    const resolved = await this.resolve(dial);
    if (resolved.method === "self") {
      return { ok: false, error: resolved.note, resolve: resolved };
    }
    if (!resolved.ok || !resolved.toId) {
      return {
        ok: false,
        error:
          resolved.note ||
          "Soft tower: number not registered on GridAlive yet. Ask them to open GridAlive — they get a virtual number automatically.",
        resolve: resolved,
      };
    }

    // Ensure global path ready (this device's id, not callee)
    try {
      const cell = this.getMyCell();
      if (!globalCall.ready) {
        globalCall.start(nodeId(), cell?.name || "User", cell?.handle || cell?.virtualNumber?.slice(-10));
      }
    } catch {}

    // Prefer global internet (works PC Wi‑Fi ↔ phone data) unless preferLocal
    if (!opts?.preferLocal) {
      try {
        const { pc } = await globalCall.placeCall(resolved.toId, resolved.toName);
        bus.emit("softTower:call", { ...resolved, path: "global-webrtc" });
        return { ok: true, resolve: resolved, pc, path: "soft-tower-global" };
      } catch (e: any) {
        console.warn("[SoftTower] global path", e);
      }
    }

    // Mesh / TURN fallback
    try {
      meshComms.hangUpCall?.();
      const result = await meshComms.callWithFallback?.(resolved.toId, { name: resolved.toName });
      if (result?.pc) {
        bus.emit("softTower:call", { ...resolved, path: result.method });
        return { ok: true, resolve: resolved, pc: result.pc, path: `soft-tower-${result.method}` };
      }
    } catch (e: any) {
      console.warn("[SoftTower] mesh path", e);
    }

    return {
      ok: false,
      error: `Soft tower found ${resolved.toName} (${resolved.method}) but media path failed — both devices need mic + internet/mesh.`,
      resolve: resolved,
    };
  }

  statusLine() {
    const c = this.getMyCell();
    if (!c) return "Soft tower offline";
    return `Tower cell ${c.display}${c.simAlias ? ` · alias …${c.simAlias.slice(-4)}` : ""} · online`;
  }
}

export const softTower = new SoftTowerEngine();
export default softTower;
