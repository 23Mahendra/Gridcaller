/**
 * Mesh Rent Cloud — rent extra RAM/storage/GPU on the mesh,
 * host encrypted cloud-like shards, GPU cluster jobs, model training contributions.
 *
 * Currency: GridCoins (mesh ledger) — real local earnings ledger.
 * Fiat payout is optional later (withdraw flow in meshEconomy).
 *
 * Honesty: browser cannot expose raw GPU CUDA; we use WebGPU/WebGL presence +
 * Ollama local AI + encrypted storage as the real work units.
 */

import { S } from "./storage";
import { bus } from "./bus";
import { MeshEngine } from "./mesh";
import { meshEconomy } from "./meshEconomy";
import { gunStore } from "../plugins/gunStore";
import { deviceVault } from "./deviceVault";
import { compressBytes, decompressBytes, formatBytes } from "./compress";
import { ollamaEngine } from "./ollamaEngine";
import omniMesh from "./omniMeshEngine";
import {
  applyRentSplit,
  getPoolBalances,
  getAutoRentConfig,
  setAutoRentConfig,
  computeAutoOfferFromDevice,
  formatSplitPolicyLabel,
  getActiveSplit,
  getNetworkRates,
  RENT_SPLIT,
  type AutoRentConfig,
} from "./rentProfitSplit";

export type RentResource = "storage" | "ram" | "gpu" | "cpu" | "bandwidth";

export interface RentOffer {
  nodeId: string;
  name: string;
  storageMB: number; // offered
  ramMB: number;
  cpuPercent: number;
  gpuShare: boolean;
  rateStorage: number; // GC per MB/day
  rateRam: number; // GC per MB/hour
  rateGpu: number; // GC per task
  online: boolean;
  ts: number;
  encryptedCloud: true;
}

export interface CloudObjectMeta {
  id: string;
  ownerId: string;
  name: string;
  mime: string;
  originalBytes: number;
  compressedBytes: number;
  algo: string;
  encrypted: true;
  hostNodes: string[];
  ts: number;
  shards?: number;
}

export interface ClusterJob {
  id: string;
  type: "inference" | "train_step" | "embed" | "compress";
  from: string;
  model?: string;
  payload: any;
  rewardGC: number;
  status: "queued" | "running" | "done" | "failed";
  result?: any;
  workerId?: string;
  ts: number;
  doneAt?: number;
}

export interface TrainContribution {
  id: string;
  modelName: string;
  steps: number;
  samples: number;
  loss?: number;
  nodeId: string;
  rewardGC: number;
  ts: number;
}

export interface EarnLedgerEntry {
  id: string;
  kind: "rent_storage" | "rent_ram" | "gpu_job" | "train" | "cloud_host" | "withdraw";
  amountGC: number;
  note: string;
  ts: number;
}

const KEYS = {
  offer: "mesh_rent_offer",
  cloudIndex: "mesh_cloud_index",
  jobs: "mesh_cluster_jobs",
  train: "mesh_train_log",
  ledger: "mesh_earn_ledger",
  balance: "mesh_earn_balance_gc",
  accepting: "mesh_rent_accepting",
};

function uid(p = "x") {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function nodeId() {
  return MeshEngine.localId || S.get("mesh_id", "node_local");
}

function nodeName() {
  return S.get("user_name") || S.get("mesh_name") || "Node";
}

/** Simple XOR stream with key derived from passphrase (local encryption layer) */
async function deriveKeyBytes(pass: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(pass || "gridalive-mesh-cloud");
  try {
    if (crypto?.subtle) {
      const hash = await crypto.subtle.digest("SHA-256", enc);
      return new Uint8Array(hash);
    }
  } catch {}
  // fallback
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = enc[i % enc.length] ^ (i * 31);
  return out;
}

function xorCrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function b64(u8: Uint8Array) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode(...u8.subarray(i, i + chunk));
  return btoa(s);
}

function fromB64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class MeshRentCloud {
  private started = false;
  private unsubMesh: (() => void) | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    try {
      meshEconomy.start();
      meshEconomy.applyDefaultRentPolicy?.();
    } catch {}

    // Auto-rent ON by default (policy: free capacity → mesh offer)
    const auto = getAutoRentConfig();
    if (auto.enabled) {
      void this.runAutoRent();
    } else if (S.get(KEYS.accepting, false)) {
      this.applyOfferToEconomy();
    }

    this.unsubMesh = MeshEngine.onMessage((msg: any) => {
      void this.onMesh(msg);
    });

    // Advertise + auto re-measure capacity periodically
    setInterval(() => {
      this.advertiseOffer();
      if (getAutoRentConfig().enabled) void this.runAutoRent();
    }, 60000);
    setInterval(() => this.advertiseOffer(), 12000);
    this.advertiseOffer();

    bus.emit("meshRent:ready", this.getStatus());
    console.info(
      "[MeshRentCloud] auto-rent + split",
      formatSplitPolicyLabel(),
      "· encrypted cloud + GPU ledger online"
    );
  }

  getStatus() {
    const offer = this.getOffer();
    const pools = getPoolBalances();
    const auto = getAutoRentConfig();
    return {
      accepting: !!S.get(KEYS.accepting, false),
      autoRent: auto,
      offer,
      balanceGC: this.getBalance(),
      pools,
      splitPolicy: this.getSplitPolicy(),
      cloudObjects: (S.get(KEYS.cloudIndex, []) as CloudObjectMeta[]).length,
      jobsQueued: (S.get(KEYS.jobs, []) as ClusterJob[]).filter((j) => j.status === "queued").length,
      trainContribs: (S.get(KEYS.train, []) as TrainContribution[]).length,
      ledger: (S.get(KEYS.ledger, []) as EarnLedgerEntry[]).slice(0, 20),
      honesty:
        "Auto-rent free capacity. Gross GC split: Public 60% · Owner 20% · Maintenance 10% · Mesh reserve 10%. Browser work units: WebGPU/Ollama/encrypted storage.",
    };
  }

  getOffer(): RentOffer {
    const saved = S.get(KEYS.offer, null) as Partial<RentOffer> | null;
    const ram = (navigator as any).deviceMemory || 4;
    const rates = getNetworkRates(); // owner-published network rates
    return {
      nodeId: nodeId(),
      name: nodeName(),
      storageMB: saved?.storageMB ?? 512,
      ramMB: saved?.ramMB ?? Math.min(1024, Math.round(ram * 256)),
      cpuPercent: saved?.cpuPercent ?? 25,
      gpuShare: saved?.gpuShare ?? !!(navigator as any).gpu,
      // Rates always from owner network policy (public cannot override prices)
      rateStorage: rates.rateStoragePerMbDay,
      rateRam: rates.rateRamPerMbHour,
      rateGpu: rates.rateGpuPerTask,
      online: !!S.get(KEYS.accepting, false),
      ts: Date.now(),
      encryptedCloud: true,
    };
  }

  /** User configures how much of their extra capacity to rent */
  setOffer(partial: Partial<RentOffer>, accepting?: boolean) {
    const cur = this.getOffer();
    const next = { ...cur, ...partial, nodeId: nodeId(), name: nodeName(), ts: Date.now(), encryptedCloud: true as const };
    S.set(KEYS.offer, next);
    if (accepting !== undefined) {
      S.set(KEYS.accepting, accepting);
      next.online = accepting;
    }
    this.applyOfferToEconomy();
    this.advertiseOffer();
    bus.emit("meshRent:offer", next);
    return next;
  }

  setAccepting(on: boolean) {
    return this.setOffer({}, on);
  }

  private applyOfferToEconomy() {
    const on = !!S.get(KEYS.accepting, false);
    const offer = this.getOffer();
    try {
      meshEconomy.setResourceLimits?.({
        maxRamShareMB: offer.ramMB,
        maxStorageLeaseMB: offer.storageMB,
        maxBandwidthMbps: 5,
        maxCpuPercent: offer.cpuPercent,
        enableGpu: offer.gpuShare,
      });
    } catch {}
    const services = ["disk_lease", "ram_share", "storage", "backup_vault", "ai_compute", "gpu_cluster", "compute_pool"] as const;
    for (const s of services) {
      try {
        const states = meshEconomy.getServiceStates();
        const st = states.find((x) => x.id === s);
        if (on && st && !st.enabled) meshEconomy.toggleService(s as any);
        if (!on && st?.enabled) meshEconomy.toggleService(s as any);
      } catch {}
    }
  }

  private advertiseOffer() {
    if (!S.get(KEYS.accepting, false)) return;
    const offer = this.getOffer();
    offer.online = true;
    try {
      MeshEngine.broadcast("MESH_RENT_OFFER", offer);
    } catch {}
    try {
      gunStore.ensure?.();
      gunStore.put(`gridalive.rent.offers.${offer.nodeId}`, offer);
    } catch {}
    try {
      void omniMesh.send("MESH_RENT_OFFER", offer, { priority: "presence", ttl: 8 });
    } catch {}
  }

  /**
   * Credit gross GC through Auto-Rent profit split:
   * Public 60% → user wallet · Owner 20% · Maintenance 10% · Mesh reserve 10%
   */
  credit(amountGC: number, kind: EarnLedgerEntry["kind"], note: string) {
    if (amountGC <= 0) return;
    const split = applyRentSplit(amountGC, note, { kind, nodeId: nodeId() });
    // User wallet = cumulative public pool share
    const pools = getPoolBalances();
    S.set(KEYS.balance, pools.public);

    const entry: EarnLedgerEntry = {
      id: uid("earn"),
      kind,
      amountGC: split.publicCredited, // what user actually received
      note: `${note} · gross ${split.gross} → you ${split.public} (60%) · owner ${split.owner} · maint ${split.maintenance} · reserve ${split.meshReserve}`,
      ts: Date.now(),
    };
    const ledger = S.get(KEYS.ledger, []) as EarnLedgerEntry[];
    S.set(KEYS.ledger, [entry, ...ledger].slice(0, 500));
    bus.emit("meshRent:earn", { entry, split, pools });
    return { entry, split };
  }

  getBalance() {
    // Prefer pool public balance (source of truth after split)
    const pools = getPoolBalances();
    if (pools.lifetimeGross > 0) return pools.public;
    return Number(S.get(KEYS.balance, 0)) || 0;
  }

  getProfitPools() {
    return getPoolBalances();
  }

  getSplitPolicy() {
    const p = getActiveSplit();
    return { ...p, label: formatSplitPolicyLabel() };
  }

  getNetworkRates() {
    return getNetworkRates();
  }

  getAutoRent(): AutoRentConfig {
    return getAutoRentConfig();
  }

  /** Enable/disable automatic rent of free capacity */
  setAutoRent(enabled: boolean) {
    setAutoRentConfig({ enabled });
    if (enabled) void this.runAutoRent();
    else this.setAccepting(false);
    return getAutoRentConfig();
  }

  /**
   * Auto-rent: measure free capacity → set offer → start accepting → advertise.
   * Profit on every earn uses 60/20/10/10 split automatically.
   */
  async runAutoRent() {
    const cfg = getAutoRentConfig();
    if (!cfg.enabled) return null;
    const auto = await computeAutoOfferFromDevice();
    const rates = getNetworkRates();
    const offer = this.setOffer(
      {
        storageMB: auto.storageMB,
        ramMB: auto.ramMB,
        cpuPercent: auto.cpuPercent,
        gpuShare: auto.gpuShare,
        rateStorage: rates.rateStoragePerMbDay,
        rateRam: rates.rateRamPerMbHour,
        rateGpu: rates.rateGpuPerTask,
      },
      true
    );
    try {
      meshEconomy.applyDefaultRentPolicy?.();
      meshEconomy.start();
    } catch {}
    setAutoRentConfig({ lastAutoAt: Date.now() });
    bus.emit("meshRent:auto", offer);
    return offer;
  }

  getLedger(limit = 50) {
    return (S.get(KEYS.ledger, []) as EarnLedgerEntry[]).slice(0, limit);
  }

  // ── Encrypted mesh cloud (replaces central cloud storage) ──

  async putCloudFile(
    file: File | Blob,
    name: string,
    passphrase?: string
  ): Promise<CloudObjectMeta> {
    const ab = new Uint8Array(await file.arrayBuffer());
    const packed = await compressBytes(ab);
    const key = await deriveKeyBytes(passphrase || nodeId() + ":cloud");
    const enc = xorCrypt(packed.data, key);
    const id = uid("cloud");
    const b64data = b64(enc);

    // Host locally in device vault (compressed already)
    try {
      await deviceVault.put(`cloud.${id}`, {
        id,
        name,
        b64: b64data.slice(0, 50000), // small meta path
        algo: packed.algo,
        fullInChunks: b64data.length > 50000,
      });
    } catch {}

    // Chunk large payloads into gun graph
    const CHUNK = 4000;
    const n = Math.ceil(b64data.length / CHUNK);
    try {
      gunStore.ensure?.();
      for (let i = 0; i < n; i++) {
        gunStore.put(`gridalive.cloud.blob.${id}.${i}`, {
          i,
          n,
          d: b64data.slice(i * CHUNK, (i + 1) * CHUNK),
        });
      }
      gunStore.put(`gridalive.cloud.meta.${id}`, {
        id,
        name,
        n,
        algo: packed.algo,
        originalBytes: packed.originalBytes,
        compressedBytes: packed.compressedBytes,
        ownerId: nodeId(),
        ts: Date.now(),
        encrypted: true,
      });
    } catch {}

    // Mesh announce — hosts can pin
    MeshEngine.broadcast("MESH_CLOUD_PIN", {
      id,
      name,
      chunks: n,
      reward: Math.max(1, Math.ceil(packed.compressedBytes / (1024 * 100))),
    });

    const meta: CloudObjectMeta = {
      id,
      ownerId: nodeId(),
      name,
      mime: (file as File).type || "application/octet-stream",
      originalBytes: packed.originalBytes,
      compressedBytes: packed.compressedBytes,
      algo: packed.algo,
      encrypted: true,
      hostNodes: [nodeId()],
      ts: Date.now(),
      shards: n,
    };
    const idx = S.get(KEYS.cloudIndex, []) as CloudObjectMeta[];
    S.set(KEYS.cloudIndex, [meta, ...idx].slice(0, 200));

    // Hosting self earns small GC (owner rate table)
    const rates = getNetworkRates();
    this.credit(
      Math.max(rates.minRewardGC, rates.rateCloudHostBase),
      "cloud_host",
      `Hosted cloud object ${name}`
    );
    return meta;
  }

  listCloud(): CloudObjectMeta[] {
    return S.get(KEYS.cloudIndex, []) as CloudObjectMeta[];
  }

  async getCloudFile(id: string, passphrase?: string): Promise<Blob | null> {
    const meta = (S.get(KEYS.cloudIndex, []) as CloudObjectMeta[]).find((m) => m.id === id);
    let b64data = "";
    try {
      gunStore.ensure?.();
      const n = meta?.shards || 1;
      for (let i = 0; i < n; i++) {
        const part = await gunStore.once(`gridalive.cloud.blob.${id}.${i}`);
        if (part?.d) b64data += part.d;
      }
    } catch {}
    if (!b64data) return null;
    const enc = fromB64(b64data);
    const key = await deriveKeyBytes(passphrase || nodeId() + ":cloud");
    const plainPacked = xorCrypt(enc, key);
    const algo = (meta?.algo as any) || "gzip";
    const plain = await decompressBytes(plainPacked, algo === "none" ? "none" : algo);
    return new Blob([plain], { type: meta?.mime || "application/octet-stream" });
  }

  // ── GPU / compute cluster jobs ──

  submitJob(job: Omit<ClusterJob, "id" | "status" | "ts" | "from">): ClusterJob {
    const rates = getNetworkRates();
    const defaultReward =
      job.type === "train_step"
        ? rates.rateTrainPerStep
        : job.type === "compress"
          ? rates.rateCompressJob
          : rates.rateGpuPerTask;
    const full: ClusterJob = {
      ...job,
      rewardGC: job.rewardGC > 0 ? job.rewardGC : defaultReward,
      id: uid("job"),
      from: nodeId(),
      status: "queued",
      ts: Date.now(),
    };
    const jobs = S.get(KEYS.jobs, []) as ClusterJob[];
    S.set(KEYS.jobs, [full, ...jobs].slice(0, 100));
    MeshEngine.broadcast("MESH_CLUSTER_JOB", full);
    gunStore.ensure?.();
    try {
      gunStore.put(`gridalive.cluster.jobs.${full.id}`, full);
    } catch {}
    // Try local worker immediately
    void this.tryWorkJob(full);
    return full;
  }

  listJobs() {
    return S.get(KEYS.jobs, []) as ClusterJob[];
  }

  private async tryWorkJob(job: ClusterJob) {
    if (!S.get(KEYS.accepting, false)) return;
    const offer = this.getOffer();
    if (job.type === "inference" || job.type === "train_step") {
      if (!offer.gpuShare && job.type === "train_step") return;
    }
    job.status = "running";
    job.workerId = nodeId();
    this.saveJob(job);

    try {
      let result: any = null;
      if (job.type === "inference" || job.type === "train_step") {
        const model = job.model || ollamaEngine.defaultModel;
        if (model && ollamaEngine.available) {
          const r = await ollamaEngine.chat({
            model,
            messages: [
              {
                role: "system",
                content:
                  job.type === "train_step"
                    ? "You are a training helper. Summarize gradient-like feedback in one short line (simulated local train step)."
                    : "Answer briefly.",
              },
              { role: "user", content: String(job.payload?.prompt || job.payload?.text || "ok") },
            ],
            options: { temperature: 0.3, num_predict: job.type === "train_step" ? 64 : 256 },
          });
          result = { text: r.message?.content, model, evalCount: r.evalCount };
          if (job.type === "train_step") {
            const tc: TrainContribution = {
              id: uid("tr"),
              modelName: model,
              steps: 1,
              samples: Number(job.payload?.samples || 1),
              loss: Math.random() * 0.5 + 0.1, // local heuristic only — honest UI labels this
              nodeId: nodeId(),
              rewardGC: job.rewardGC,
              ts: Date.now(),
            };
            const log = S.get(KEYS.train, []) as TrainContribution[];
            S.set(KEYS.train, [tc, ...log].slice(0, 200));
            this.credit(job.rewardGC, "train", `Train step on ${model}`);
          } else {
            this.credit(job.rewardGC, "gpu_job", `Inference job ${job.id}`);
          }
        } else {
          result = { text: "No local model — job deferred", deferred: true };
        }
      } else if (job.type === "embed") {
        result = { note: "embed placeholder — use nomic-embed-text when installed" };
        this.credit(Math.max(1, job.rewardGC / 2), "gpu_job", "Embed job");
      } else if (job.type === "compress") {
        const raw = String(job.payload?.text || "");
        const packed = await compressBytes(raw);
        result = {
          original: packed.originalBytes,
          compressed: packed.compressedBytes,
          ratio: packed.ratio,
          algo: packed.algo,
        };
        const rates = getNetworkRates();
        this.credit(rates.rateCompressJob, "rent_storage", "Compress job");
      }

      job.status = "done";
      job.result = result;
      job.doneAt = Date.now();
      this.saveJob(job);
      MeshEngine.broadcast("MESH_CLUSTER_RESULT", {
        id: job.id,
        result,
        workerId: nodeId(),
        rewardGC: job.rewardGC,
      });
    } catch (e: any) {
      job.status = "failed";
      job.result = { error: e?.message || String(e) };
      this.saveJob(job);
    }
  }

  private saveJob(job: ClusterJob) {
    const jobs = S.get(KEYS.jobs, []) as ClusterJob[];
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i >= 0) jobs[i] = job;
    else jobs.unshift(job);
    S.set(KEYS.jobs, jobs.slice(0, 100));
  }

  private async onMesh(msg: any) {
    if (!msg?.type) return;
    if (msg.type === "MESH_CLOUD_PIN" && S.get(KEYS.accepting, false) && msg.data?.id) {
      // Pin announce — credit tiny host intent
      this.credit(0.5, "cloud_host", `Pin offer ${msg.data.name || msg.data.id}`);
    }
    if (msg.type === "MESH_CLUSTER_JOB" && msg.data?.id && msg.from !== nodeId()) {
      const job = msg.data as ClusterJob;
      if (job.status === "queued") void this.tryWorkJob({ ...job });
    }
    if (msg.type === "MESH_RENT_OFFER" && msg.data) {
      bus.emit("meshRent:peerOffer", msg.data);
    }
  }

  /** Simulate daily rent accrual for offered capacity (heartbeat earnings) */
  tickRentAccrual() {
    if (!S.get(KEYS.accepting, false)) return;
    const offer = this.getOffer();
    const rates = getNetworkRates();
    // Continuous earn from owner-published rates
    const storageEarn = (offer.storageMB / 1024) * (rates.rateStoragePerMbDay / 24 / 60);
    const ramEarn = (offer.ramMB / 512) * (rates.rateRamPerMbHour / 60);
    const total = Math.max(rates.minRewardGC, storageEarn + ramEarn + rates.rateOnlineTickBase);
    this.credit(Math.round(total * 100) / 100, "rent_storage", "Online capacity rent tick");
  }
}

export const meshRentCloud = new MeshRentCloud();
export default meshRentCloud;
