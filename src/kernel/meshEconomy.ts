// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Mesh Cloud Economy Engine v2
// Every device = cloud server + bandwidth seller + GPU node
// Revenue split: configurable by super-user (default 60/40)
// Users sell: Internet, RAM, Storage, CPU, GPU, Bandwidth
// ═══════════════════════════════════════════════════════

import { S } from "./storage";
import { bus } from "./bus";
import { MeshEngine } from "./mesh";
import { applyRentSplit, RENT_SPLIT, getActiveSplit } from "./rentProfitSplit";
import { resolveHubHttp } from "./meshHubConfig";

// ─── Types ───────────────────────────────────

/** Monetizable services a mesh node can provide */
export type MeshService =
  | "storage"          // Store encrypted data shards for others
  | "relay"            // Relay messages between disconnected nodes
  | "ai_compute"       // Run local AI models for other users
  | "translation"      // Translate text for non-local language users
  | "backup_vault"     // Host encrypted account backups for others
  | "cdn"              // Cache + serve popular content nearby
  | "emergency_relay"  // Priority SOS message relaying (premium)
  | "location_beacon"  // Provide GPS data to indoor/no-GPS devices
  | "connectivity"     // Share internet with mesh-only devices
  | "compute_pool"     // Distributed data processing tasks
  | "bandwidth_sell"   // Sell unused internet bandwidth to mesh
  | "ram_share"        // Lend unused RAM for mesh computation
  | "gpu_cluster"      // Contribute GPU for AI/rendering cluster
  | "disk_lease";      // Lease free disk space as mesh cloud storage

export interface ServiceConfig {
  id: MeshService;
  name: string;
  description: string;
  icon: string;
  ratePerUnit: number;      // GridCoins per unit of work
  unit: string;             // "MB", "relay", "query", "minute", etc.
  minBattery: number;       // Minimum battery % to offer this
  minStorageMB: number;     // Minimum free storage needed
  requiresInternet: boolean;
  premium: boolean;         // Premium services pay more
  resourceType: ResourceType; // Which device resource this uses
}

/** Device resource categories */
export type ResourceType = "network" | "storage" | "compute" | "memory" | "gpu" | "sensor" | "general";

/** Live device resource snapshot */
export interface DeviceResources {
  // RAM
  ramTotalMB: number;
  ramUsedMB: number;
  ramAvailableMB: number;
  ramSharedMB: number;        // How much RAM lent to mesh

  // Storage
  storageTotalMB: number;
  storageUsedMB: number;
  storageAvailableMB: number;
  storageLeasedMB: number;    // Leased to mesh

  // CPU
  cpuCores: number;
  cpuUsagePercent: number;
  cpuSharedPercent: number;   // % donated to mesh compute

  // GPU (WebGPU / WebGL estimate)
  gpuAvailable: boolean;
  gpuRenderer: string;
  gpuShared: boolean;         // Contributing to GPU cluster

  // Bandwidth
  bandwidthDownMbps: number;
  bandwidthUpMbps: number;
  bandwidthSoldMB: number;    // Bandwidth sold to mesh
  bandwidthEarned: number;    // GC earned from bandwidth

  // Battery
  batteryPercent: number;
  charging: boolean;

  // Network
  connectionType: string;     // wifi, cellular, ethernet, none
  isOnline: boolean;

  lastUpdated: number;
}

export interface ContributionRecord {
  serviceId: MeshService;
  units: number;
  coinsEarned: number;
  timestamp: number;
  peerId: string;
  resourceType: ResourceType;
}

export interface EarningsSummary {
  totalCoins: number;
  todayCoins: number;
  weekCoins: number;
  monthCoins: number;
  lifetimeCoins: number;
  userShare: number;
  platformShare: number;
  userSharePercent: number;
  platformSharePercent: number;
  serviceBreakdown: Record<MeshService, number>;
  resourceBreakdown: Record<ResourceType, number>;
  contributionCount: number;
}

export interface NodeStats {
  nodeId: string;
  uptime: number;
  storageShardsHosted: number;
  messagesRelayed: number;
  aiQueriesServed: number;
  backupsHosted: number;
  dataServedMB: number;
  bandwidthSoldMB: number;
  ramSharedMB: number;
  gpuTasksCompleted: number;
  diskLeasedMB: number;
  reputationScore: number;
  tier: NodeTier;
  activeServices: MeshService[];
  lastHeartbeat: number;
  resourcesContributed: Record<ResourceType, number>;
}

export type NodeTier = "seed" | "sprout" | "tree" | "forest" | "mountain";

export interface StorageShard {
  shardId: string;
  ownerId: string;
  encryptedData: string;
  sizeMB: number;
  createdAt: number;
  expiresAt: number;
  replicaCount: number;
}

export interface MeshServiceRequest {
  requestId: string;
  service: MeshService;
  fromPeer: string;
  payload: any;
  priority: "normal" | "high" | "emergency";
  offeredCoins: number;
  timestamp: number;
}

export interface MeshServiceResponse {
  requestId: string;
  service: MeshService;
  fromNode: string;
  result: any;
  coinsCharged: number;
  latencyMs: number;
  timestamp: number;
}

export interface WithdrawalRequest {
  id: string;
  nodeId: string;
  amount: number;
  method: "upi" | "bank" | "crypto" | "mobile_money" | "voucher";
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
}

/** Revenue split config — GridAlive policy + optional super-user override */
export interface RevenueConfig {
  /** Public / capacity provider share (default 60) */
  userPercent: number;
  /** GridAlive owner profit (default 20) */
  ownerPercent: number;
  /** System maintenance savings (default 10) */
  maintenancePercent: number;
  /** Mesh network reserve (default 10) */
  meshReservePercent: number;
  /** @deprecated use owner+maintenance+meshReserve; kept for UI compat (= 100 - user) */
  platformPercent: number;
  changedBy: string;
  changedAt: number;
  history: { userPct: number; platformPct: number; at: number; by: string }[];
}

/** Resource pool — aggregated mesh network resources */
export interface ResourcePool {
  totalNodes: number;
  totalStorageMB: number;
  totalRamMB: number;
  totalBandwidthMbps: number;
  totalCpuCores: number;
  gpuNodes: number;
  onlineNodes: number;
  lastUpdated: number;
}

/** Resource limits (user-configurable) */
export interface ResourceLimits {
  maxRamShareMB: number;     // Max RAM to lend (default 256)
  maxStorageLeaseMB: number; // Max disk to lease (default 1024)
  maxBandwidthMbps: number;  // Max bandwidth to sell (default 5)
  maxCpuPercent: number;     // Max CPU to share (default 30%)
  enableGpu: boolean;        // Allow GPU cluster (default false)
}

// ─── Service Catalog ─────────────────────────────

export const SERVICE_CATALOG: ServiceConfig[] = [
  {
    id: "storage",
    name: "Cloud Storage",
    description: "Store encrypted data shards for other users. Your device becomes a distributed hard drive.",
    icon: "💾",
    ratePerUnit: 2,
    unit: "MB/day",
    minBattery: 20,
    minStorageMB: 100,
    requiresInternet: false,
    premium: false,
    resourceType: "storage",
  },
  {
    id: "relay",
    name: "Message Relay",
    description: "Forward messages between disconnected users. You're a bridge in the mesh.",
    icon: "📡",
    ratePerUnit: 1,
    unit: "message",
    minBattery: 15,
    minStorageMB: 10,
    requiresInternet: false,
    premium: false,
    resourceType: "network",
  },
  {
    id: "ai_compute",
    name: "AI Processing",
    description: "Run local AI models (Ollama) for users who don't have them. Earn premium coins.",
    icon: "🧠",
    ratePerUnit: 10,
    unit: "query",
    minBattery: 40,
    minStorageMB: 500,
    requiresInternet: false,
    premium: true,
    resourceType: "compute",
  },
  {
    id: "translation",
    name: "Translation Service",
    description: "Translate text between languages for other users in real-time.",
    icon: "🌐",
    ratePerUnit: 3,
    unit: "translation",
    minBattery: 25,
    minStorageMB: 50,
    requiresInternet: false,
    premium: false,
    resourceType: "compute",
  },
  {
    id: "backup_vault",
    name: "Backup Vault",
    description: "Host encrypted account backups for other users. Their safety, your earnings.",
    icon: "🔐",
    ratePerUnit: 5,
    unit: "backup/month",
    minBattery: 20,
    minStorageMB: 200,
    requiresInternet: false,
    premium: false,
    resourceType: "storage",
  },
  {
    id: "cdn",
    name: "Content Delivery",
    description: "Cache and serve popular content to nearby users faster.",
    icon: "⚡",
    ratePerUnit: 1,
    unit: "MB served",
    minBattery: 25,
    minStorageMB: 100,
    requiresInternet: false,
    premium: false,
    resourceType: "network",
  },
  {
    id: "emergency_relay",
    name: "Emergency Relay",
    description: "Priority SOS message relaying. Lives depend on your node. Premium rates.",
    icon: "🚨",
    ratePerUnit: 15,
    unit: "SOS relay",
    minBattery: 10,
    minStorageMB: 5,
    requiresInternet: false,
    premium: true,
    resourceType: "network",
  },
  {
    id: "location_beacon",
    name: "Location Beacon",
    description: "Provide GPS coordinates to indoor/no-GPS devices near you.",
    icon: "📍",
    ratePerUnit: 2,
    unit: "location share",
    minBattery: 20,
    minStorageMB: 5,
    requiresInternet: false,
    premium: false,
    resourceType: "sensor",
  },
  {
    id: "connectivity",
    name: "Internet Bridge",
    description: "Share your internet connection with mesh-only devices. Essential during outages.",
    icon: "🌉",
    ratePerUnit: 5,
    unit: "MB bridged",
    minBattery: 30,
    minStorageMB: 10,
    requiresInternet: true,
    premium: true,
    resourceType: "network",
  },
  {
    id: "compute_pool",
    name: "Compute Pool",
    description: "Contribute CPU for distributed data processing, aggregation, and analytics tasks.",
    icon: "⚙️",
    ratePerUnit: 8,
    unit: "task",
    minBattery: 35,
    minStorageMB: 50,
    requiresInternet: false,
    premium: true,
    resourceType: "compute",
  },
  // ─── NEW v2: Resource-selling services ───
  {
    id: "bandwidth_sell",
    name: "Sell Bandwidth",
    description: "Sell your unused internet bandwidth. Other devices route through your connection and you earn per MB.",
    icon: "📶",
    ratePerUnit: 3,
    unit: "MB sold",
    minBattery: 25,
    minStorageMB: 5,
    requiresInternet: true,
    premium: true,
    resourceType: "network",
  },
  {
    id: "ram_share",
    name: "RAM Sharing",
    description: "Lend unused device RAM for mesh distributed computing. Apps running on mesh use your memory.",
    icon: "🧩",
    ratePerUnit: 6,
    unit: "MB·hour",
    minBattery: 30,
    minStorageMB: 10,
    requiresInternet: false,
    premium: true,
    resourceType: "memory",
  },
  {
    id: "gpu_cluster",
    name: "GPU Cluster",
    description: "Contribute your GPU (WebGPU/WebGL) for AI training, image rendering, and heavy computation across the mesh.",
    icon: "🎮",
    ratePerUnit: 12,
    unit: "GPU·minute",
    minBattery: 40,
    minStorageMB: 100,
    requiresInternet: false,
    premium: true,
    resourceType: "gpu",
  },
  {
    id: "disk_lease",
    name: "Disk Lease",
    description: "Lease your free disk space as persistent mesh cloud storage. Longer leases earn more.",
    icon: "💿",
    ratePerUnit: 4,
    unit: "GB/month",
    minBattery: 15,
    minStorageMB: 500,
    requiresInternet: false,
    premium: false,
    resourceType: "storage",
  },
];

// ─── Tier Thresholds ─────────────────────────────

const TIER_THRESHOLDS: Record<NodeTier, { minCoins: number; minUptime: number; label: string; badge: string }> = {
  seed:     { minCoins: 0,      minUptime: 0,        label: "Seed Node",     badge: "🌱" },
  sprout:   { minCoins: 100,    minUptime: 3600,     label: "Sprout Node",   badge: "🌿" },
  tree:     { minCoins: 1000,   minUptime: 86400,    label: "Tree Node",     badge: "🌳" },
  forest:   { minCoins: 10000,  minUptime: 604800,   label: "Forest Node",   badge: "🌲" },
  mountain: { minCoins: 100000, minUptime: 2592000,  label: "Mountain Node", badge: "🏔️" },
};

// ─── Default Revenue Split (GridAlive Auto-Rent policy) ──
// Public 60% · Owner 20% · Maintenance 10% · Mesh reserve 10%
const DEFAULT_USER_PERCENT = 60;
const DEFAULT_OWNER_PERCENT = 20;
const DEFAULT_MAINTENANCE_PERCENT = 10;
const DEFAULT_MESH_RESERVE_PERCENT = 10;
const DEFAULT_PLATFORM_PERCENT =
  DEFAULT_OWNER_PERCENT + DEFAULT_MAINTENANCE_PERCENT + DEFAULT_MESH_RESERVE_PERCENT; // 40

const DEFAULT_LIMITS: ResourceLimits = {
  maxRamShareMB: 256,
  maxStorageLeaseMB: 1024,
  maxBandwidthMbps: 5,
  maxCpuPercent: 30,
  enableGpu: false,
};

// ─── Storage Keys ────────────────────────────────

const KEYS = {
  nodeStats:       "meshcloud_node_stats",
  contributions:   "meshcloud_contributions",
  earnings:        "meshcloud_earnings",
  activeServices:  "meshcloud_active_services",
  shards:          "meshcloud_shards",
  pendingPayouts:  "meshcloud_pending_payouts",
  withdrawals:     "meshcloud_withdrawals",
  startedAt:       "meshcloud_started_at",
  reputation:      "meshcloud_reputation",
  revenueConfig:   "meshcloud_revenue_config",
  deviceResources: "meshcloud_device_resources",
  resourcePool:    "meshcloud_resource_pool",
  superUserKey:    "meshcloud_superuser_key",
  resourceLimits:  "meshcloud_resource_limits",
};

// ─── Mesh Economy Engine ─────────────────────────

class MeshEconomyEngine {
  private nodeStats: NodeStats;
  private contributions: ContributionRecord[] = [];
  private activeServices: Set<MeshService> = new Set();
  private shards: StorageShard[] = [];
  private heartbeatTimer: any = null;
  private uptimeTimer: any = null;
  private resourceTimer: any = null;
  private uptimeStart: number = 0;
  private _deviceResources: DeviceResources;
  private _revenueConfig: RevenueConfig;
  private _resourceLimits: ResourceLimits;
  private _resourcePool: ResourcePool;
  private usageAccountingEnabled = true;

  constructor() {
    // Load persisted state
    const saved = S.get(KEYS.nodeStats, null);
    this.contributions = S.get(KEYS.contributions, []);
    this.shards = S.get(KEYS.shards, []);
    const savedServices: MeshService[] = S.get(KEYS.activeServices, []);
    this.activeServices = new Set(savedServices);

    // Revenue config — auto-rent policy (public 60 / owner 20 / maint 10 / reserve 10)
    const savedRev = S.get(KEYS.revenueConfig, null) as RevenueConfig | null;
    this._revenueConfig = savedRev
      ? {
          userPercent: savedRev.userPercent ?? DEFAULT_USER_PERCENT,
          ownerPercent: savedRev.ownerPercent ?? DEFAULT_OWNER_PERCENT,
          maintenancePercent: savedRev.maintenancePercent ?? DEFAULT_MAINTENANCE_PERCENT,
          meshReservePercent: savedRev.meshReservePercent ?? DEFAULT_MESH_RESERVE_PERCENT,
          platformPercent:
            savedRev.platformPercent ??
            (100 - (savedRev.userPercent ?? DEFAULT_USER_PERCENT)),
          changedBy: savedRev.changedBy || "system",
          changedAt: savedRev.changedAt || Date.now(),
          history: savedRev.history || [],
        }
      : {
          userPercent: DEFAULT_USER_PERCENT,
          ownerPercent: DEFAULT_OWNER_PERCENT,
          maintenancePercent: DEFAULT_MAINTENANCE_PERCENT,
          meshReservePercent: DEFAULT_MESH_RESERVE_PERCENT,
          platformPercent: DEFAULT_PLATFORM_PERCENT,
          changedBy: "system",
          changedAt: Date.now(),
          history: [],
        };
    // Persist normalized policy so all nodes see same split
    S.set(KEYS.revenueConfig, this._revenueConfig);

    // Resource limits
    this._resourceLimits = S.get(KEYS.resourceLimits, null) || { ...DEFAULT_LIMITS };

    // Device resources (live snapshot)
    this._deviceResources = S.get(KEYS.deviceResources, null) || this._createDefaultResources();

    // Resource pool
    this._resourcePool = S.get(KEYS.resourcePool, null) || {
      totalNodes: 1, totalStorageMB: 0, totalRamMB: 0,
      totalBandwidthMbps: 0, totalCpuCores: 0, gpuNodes: 0,
      onlineNodes: 1, lastUpdated: Date.now(),
    };

    this.nodeStats = saved || {
      nodeId: MeshEngine.localId,
      uptime: 0,
      storageShardsHosted: 0,
      messagesRelayed: 0,
      aiQueriesServed: 0,
      backupsHosted: 0,
      dataServedMB: 0,
      bandwidthSoldMB: 0,
      ramSharedMB: 0,
      gpuTasksCompleted: 0,
      diskLeasedMB: 0,
      reputationScore: 50,
      tier: "seed" as NodeTier,
      activeServices: [],
      lastHeartbeat: Date.now(),
      resourcesContributed: { network: 0, storage: 0, compute: 0, memory: 0, gpu: 0, sensor: 0, general: 0 },
    };
    this.nodeStats.nodeId = MeshEngine.localId;
    this.nodeStats.activeServices = [...this.activeServices];
    // Ensure new fields exist on old persisted data
    if (!this.nodeStats.bandwidthSoldMB) this.nodeStats.bandwidthSoldMB = 0;
    if (!this.nodeStats.ramSharedMB) this.nodeStats.ramSharedMB = 0;
    if (!this.nodeStats.gpuTasksCompleted) this.nodeStats.gpuTasksCompleted = 0;
    if (!this.nodeStats.diskLeasedMB) this.nodeStats.diskLeasedMB = 0;
    if (!this.nodeStats.resourcesContributed) {
      this.nodeStats.resourcesContributed = { network: 0, storage: 0, compute: 0, memory: 0, gpu: 0, sensor: 0, general: 0 };
    }
  }

  private _createDefaultResources(): DeviceResources {
    return {
      ramTotalMB: 0, ramUsedMB: 0, ramAvailableMB: 0, ramSharedMB: 0,
      storageTotalMB: 0, storageUsedMB: 0, storageAvailableMB: 0, storageLeasedMB: 0,
      cpuCores: navigator.hardwareConcurrency || 4, cpuUsagePercent: 0, cpuSharedPercent: 0,
      gpuAvailable: false, gpuRenderer: "unknown", gpuShared: false,
      bandwidthDownMbps: 0, bandwidthUpMbps: 0, bandwidthSoldMB: 0, bandwidthEarned: 0,
      batteryPercent: 80, charging: false,
      connectionType: "unknown", isOnline: navigator.onLine,
      lastUpdated: Date.now(),
    };
  }

  // ─── Lifecycle ───────────────────────────────

  /** Start the economy engine — begin earning */
  start() {
    this.uptimeStart = Date.now();
    S.set(KEYS.startedAt, this.uptimeStart);

    // Heartbeat: announce presence and services every 30s
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);

    // Uptime tracker: every 60s
    this.uptimeTimer = setInterval(() => {
      this.nodeStats.uptime += 60;
      this.updateTier();
      this.persist();
    }, 60_000);

    // Resource monitor: every 10s
    this.resourceTimer = setInterval(() => this.probeDeviceResources(), 10_000);

    // Listen for mesh service requests
    MeshEngine.onMessage((msg: any) => {
      if (msg.type === "service_request") this.handleServiceRequest(msg.data);
      if (msg.type === "service_response") this.handleServiceResponse(msg.data);
      if (msg.type === "shard_store") this.handleShardStore(msg.data);
      if (msg.type === "shard_retrieve") this.handleShardRetrieve(msg.data);
      if (msg.type === "node_heartbeat") this.handlePeerHeartbeat(msg.data);
      if (msg.type === "resource_request") this.handleResourceRequest(msg.data);
      if (msg.type === "revenue_config_update") this.handleRevenueUpdate(msg.data);
    });

    // Initial probe + heartbeat
    this.probeDeviceResources();
    this.heartbeat();

    bus.emit("meshcloud:started", {
      nodeId: this.nodeStats.nodeId,
      services: [...this.activeServices],
    }, "meshEconomy");
  }

  /** Stop the economy engine */
  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
    if (this.resourceTimer) clearInterval(this.resourceTimer);
    this.persist();
    bus.emit("meshcloud:stopped", { nodeId: this.nodeStats.nodeId }, "meshEconomy");
  }

  // ─── Device Resource Probing ────────────────

  /** Probe real device resources via browser APIs */
  async probeDeviceResources() {
    const res = this._deviceResources;
    res.lastUpdated = Date.now();
    res.isOnline = navigator.onLine;
    res.cpuCores = navigator.hardwareConcurrency || 4;

    // ── Battery
    try {
      const batteryInfo = S.get("device_battery", null);
      if (batteryInfo?.level != null) {
        res.batteryPercent = Math.round(batteryInfo.level * 100);
        res.charging = !!batteryInfo.charging;
      } else if ("getBattery" in navigator) {
        const batt: any = await (navigator as any).getBattery();
        res.batteryPercent = Math.round(batt.level * 100);
        res.charging = batt.charging;
      }
    } catch { /* battery API not available */ }

    // ── RAM via performance.memory (Chrome) or deviceMemory
    try {
      const perf = performance as any;
      if (perf.memory) {
        res.ramTotalMB = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
        res.ramUsedMB = Math.round(perf.memory.usedJSHeapSize / 1048576);
        res.ramAvailableMB = res.ramTotalMB - res.ramUsedMB;
      } else if ((navigator as any).deviceMemory) {
        res.ramTotalMB = (navigator as any).deviceMemory * 1024;
        res.ramUsedMB = Math.round(res.ramTotalMB * 0.4); // estimated
        res.ramAvailableMB = res.ramTotalMB - res.ramUsedMB;
      }
    } catch { /* memory API not available */ }

    // ── Storage via StorageManager
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        res.storageTotalMB = Math.round((est.quota || 0) / 1048576);
        res.storageUsedMB = Math.round((est.usage || 0) / 1048576);
        res.storageAvailableMB = res.storageTotalMB - res.storageUsedMB;
      }
    } catch { /* storage API not available */ }

    // ── GPU detection via WebGL
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        res.gpuAvailable = true;
        res.gpuRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "WebGL Capable";
      }
    } catch { /* WebGL not available */ }

    // ── Connection type + bandwidth
    try {
      const conn = (navigator as any).connection;
      if (conn) {
        res.connectionType = conn.effectiveType || conn.type || "unknown";
        res.bandwidthDownMbps = conn.downlink || 0;
      }
    } catch { /* Network Info API not available */ }

    // ── Track shared resources based on active services
    if (this.activeServices.has("ram_share")) {
      res.ramSharedMB = Math.min(this._resourceLimits.maxRamShareMB, Math.max(0, res.ramAvailableMB * 0.5));
    } else {
      res.ramSharedMB = 0;
    }

    if (this.activeServices.has("disk_lease")) {
      res.storageLeasedMB = Math.min(this._resourceLimits.maxStorageLeaseMB, Math.max(0, res.storageAvailableMB * 0.3));
    } else {
      res.storageLeasedMB = 0;
    }

    if (this.activeServices.has("gpu_cluster")) {
      res.gpuShared = res.gpuAvailable && this._resourceLimits.enableGpu;
    } else {
      res.gpuShared = false;
    }

    if (this.activeServices.has("bandwidth_sell")) {
      res.bandwidthUpMbps = Math.min(this._resourceLimits.maxBandwidthMbps, Math.max(0, res.bandwidthDownMbps * 0.4));
    }

    if (this.activeServices.has("compute_pool") || this.activeServices.has("ai_compute")) {
      res.cpuSharedPercent = this._resourceLimits.maxCpuPercent;
    } else {
      res.cpuSharedPercent = 0;
    }

    this._deviceResources = res;
    S.set(KEYS.deviceResources, res);
    bus.emit("meshcloud:resources_updated", res, "meshEconomy");
  }

  /** Get current device resources */
  getDeviceResources(): DeviceResources {
    return { ...this._deviceResources };
  }

  // ─── Passive Earnings (per-minute tick) ──────

  /** Passive synthetic accrual is disabled; only executed work can earn. */
  private tickPassiveEarnings() {
    return;
  }

  private async hashUsagePayload(payload: any): Promise<string> {
    const txt = JSON.stringify(payload);
    try {
      if (crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
        return Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
    } catch {}
    let h = 0;
    for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) >>> 0;
    return `fallback_${h.toString(16)}`;
  }

  private async pushUsageReceipt(serviceId: MeshService, units: number, peerId: string, amountCredited: number) {
    if (!this.usageAccountingEnabled || units <= 0 || amountCredited <= 0) return;
    const payload = {
      nodeId: this.nodeStats.nodeId,
      serviceId,
      units: Math.round(units * 1000000) / 1000000,
      amountCredited: Math.round(amountCredited * 1000000) / 1000000,
      currency: "usage_credits",
      executed: true,
      peerId,
      ts: Date.now(),
      nonce: crypto.randomUUID(),
    };
    const receiptHash = await this.hashUsagePayload(payload);
    try {
      const hub = resolveHubHttp().replace(/\/$/, "");
      await fetch(`${hub}/api/accounting/usage/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, receiptHash }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }

  // ─── Service Management ──────────────────────

  /** Enable a service on this node */
  enableService(serviceId: MeshService): boolean {
    const config = SERVICE_CATALOG.find(s => s.id === serviceId);
    if (!config) return false;

    const battery = this.getBatteryLevel();
    if (battery < config.minBattery) return false;

    // GPU cluster needs GPU hardware + user opt-in
    if (serviceId === "gpu_cluster" && (!this._deviceResources.gpuAvailable || !this._resourceLimits.enableGpu)) {
      return false;
    }

    this.activeServices.add(serviceId);
    this.nodeStats.activeServices = [...this.activeServices];
    this.persist();

    bus.emit("meshcloud:service_enabled", { serviceId, config }, "meshEconomy");
    MeshEngine.broadcast("node_service_update", {
      nodeId: this.nodeStats.nodeId,
      services: [...this.activeServices],
      resources: this._getResourceAdvertisement(),
    });
    return true;
  }

  /** Disable a service on this node */
  disableService(serviceId: MeshService) {
    this.activeServices.delete(serviceId);
    this.nodeStats.activeServices = [...this.activeServices];
    this.persist();
    bus.emit("meshcloud:service_disabled", { serviceId }, "meshEconomy");
  }

  /** Toggle a service */
  toggleService(serviceId: MeshService): boolean {
    if (this.activeServices.has(serviceId)) {
      this.disableService(serviceId);
      return false;
    } else {
      return this.enableService(serviceId);
    }
  }

  /** Get all services with their enabled state */
  getServiceStates(): (ServiceConfig & { enabled: boolean; eligible: boolean })[] {
    const battery = this.getBatteryLevel();
    return SERVICE_CATALOG.map(s => ({
      ...s,
      enabled: this.activeServices.has(s.id),
      eligible: battery >= s.minBattery &&
        (s.id !== "gpu_cluster" || (this._deviceResources.gpuAvailable && this._resourceLimits.enableGpu)),
    }));
  }

  /** Get resource advertisement for mesh */
  private _getResourceAdvertisement() {
    const res = this._deviceResources;
    return {
      ramAvailMB: res.ramSharedMB,
      storageMB: res.storageLeasedMB,
      bandwidthMbps: res.bandwidthUpMbps,
      cpuCores: res.cpuCores,
      cpuSharedPct: res.cpuSharedPercent,
      gpuAvailable: res.gpuShared,
      gpuRenderer: res.gpuRenderer,
    };
  }

  // ─── Revenue Split (Super-User Configurable) ──

  /** Get current revenue split */
  getRevenueConfig(): RevenueConfig {
    return { ...this._revenueConfig };
  }

  /** Get user share as decimal (0-1) */
  getUserShare(): number {
    return this._revenueConfig.userPercent / 100;
  }

  /** Get platform share as decimal (0-1) */
  getPlatformShare(): number {
    return this._revenueConfig.platformPercent / 100;
  }

  /**
   * Super-user: update public share (rest auto-splits owner 20 / maint 10 / reserve 10 of platform side).
   * Preferred fixed policy is RENT_SPLIT (60/20/10/10) — call applyDefaultRentPolicy() to reset.
   */
  setRevenueSplit(userPercent: number, superUserKey: string): boolean {
    const storedKey = S.get(KEYS.superUserKey, "gridalive_super_2026");
    if (superUserKey !== storedKey) return false;
    if (userPercent < 50 || userPercent > 80) return false; // public always majority
    const platformPercent = 100 - userPercent;
    // Keep owner:maint:reserve = 2:1:1 of platform side
    const ownerPercent = Math.round(platformPercent * 0.5);
    const maintenancePercent = Math.round(platformPercent * 0.25);
    const meshReservePercent = platformPercent - ownerPercent - maintenancePercent;

    this._revenueConfig.history.push({
      userPct: this._revenueConfig.userPercent,
      platformPct: this._revenueConfig.platformPercent,
      at: Date.now(),
      by: this._revenueConfig.changedBy,
    });

    this._revenueConfig.userPercent = userPercent;
    this._revenueConfig.ownerPercent = ownerPercent;
    this._revenueConfig.maintenancePercent = maintenancePercent;
    this._revenueConfig.meshReservePercent = meshReservePercent;
    this._revenueConfig.platformPercent = platformPercent;
    this._revenueConfig.changedBy = superUserKey;
    this._revenueConfig.changedAt = Date.now();

    S.set(KEYS.revenueConfig, this._revenueConfig);
    MeshEngine.broadcast("revenue_config_update", {
      userPercent,
      ownerPercent,
      maintenancePercent,
      meshReservePercent,
      platformPercent,
      changedAt: Date.now(),
    });
    bus.emit("meshcloud:revenue_updated", this._revenueConfig, "meshEconomy");
    return true;
  }

  /** Reset / sync to active rent policy (owner-editable via rentProfitSplit) */
  applyDefaultRentPolicy() {
    const p = getActiveSplit();
    this._revenueConfig = {
      userPercent: p.publicPercent,
      ownerPercent: p.ownerPercent,
      maintenancePercent: p.maintenancePercent,
      meshReservePercent: p.meshReservePercent,
      platformPercent: 100 - p.publicPercent,
      changedBy: p.updatedBy || "system",
      changedAt: Date.now(),
      history: this._revenueConfig.history || [],
    };
    S.set(KEYS.revenueConfig, this._revenueConfig);
    bus.emit("meshcloud:revenue_updated", this._revenueConfig, "meshEconomy");
    return this._revenueConfig;
  }

  /** Set the super-user key (requires current key) */
  setSuperUserKey(newKey: string, currentKey: string): boolean {
    const storedKey = S.get(KEYS.superUserKey, "gridalive_super_2026");
    if (currentKey !== storedKey) return false;
    S.set(KEYS.superUserKey, newKey);
    return true;
  }

  /** Verify super-user key */
  verifySuperUser(key: string): boolean {
    const storedKey = S.get(KEYS.superUserKey, "gridalive_super_2026");
    return key === storedKey;
  }

  /** Handle revenue update from mesh broadcast */
  private handleRevenueUpdate(data: any) {
    if (data.userPercent != null) {
      this._revenueConfig.userPercent = data.userPercent;
      if (data.ownerPercent != null) this._revenueConfig.ownerPercent = data.ownerPercent;
      if (data.maintenancePercent != null) this._revenueConfig.maintenancePercent = data.maintenancePercent;
      if (data.meshReservePercent != null) this._revenueConfig.meshReservePercent = data.meshReservePercent;
      this._revenueConfig.platformPercent =
        data.platformPercent ??
        100 - data.userPercent;
      this._revenueConfig.changedAt = data.changedAt || Date.now();
      S.set(KEYS.revenueConfig, this._revenueConfig);
      bus.emit("meshcloud:revenue_updated", this._revenueConfig, "meshEconomy");
    }
  }

  // ─── Resource Limits (user-configurable) ─────

  /** Get current resource limits */
  getResourceLimits(): ResourceLimits {
    return { ...this._resourceLimits };
  }

  /** Update resource limits */
  setResourceLimits(limits: Partial<ResourceLimits>) {
    this._resourceLimits = { ...this._resourceLimits, ...limits };
    S.set(KEYS.resourceLimits, this._resourceLimits);
    bus.emit("meshcloud:limits_updated", this._resourceLimits, "meshEconomy");
  }

  // ─── Resource Pool ──────────────────────────

  /** Get aggregated mesh resource pool */
  getResourcePool(): ResourcePool {
    return { ...this._resourcePool };
  }

  /** Handle resource request from another node */
  private handleResourceRequest(data: any) {
    if (data.type === "ram" && this.activeServices.has("ram_share")) {
      const available = Math.min(data.requestedMB || 0, this._deviceResources.ramSharedMB);
      if (available > 0) {
        MeshEngine.broadcast("resource_response", {
          requestId: data.requestId,
          type: "ram",
          availableMB: available,
          fromNode: MeshEngine.localId,
        });
        this.recordContribution("ram_share", available, data.fromPeer || "unknown");
      }
    }
    if (data.type === "bandwidth" && this.activeServices.has("bandwidth_sell")) {
      MeshEngine.broadcast("resource_response", {
        requestId: data.requestId,
        type: "bandwidth",
        availableMbps: this._deviceResources.bandwidthUpMbps,
        fromNode: MeshEngine.localId,
      });
    }
    if (data.type === "gpu" && this.activeServices.has("gpu_cluster") && this._deviceResources.gpuShared) {
      MeshEngine.broadcast("resource_response", {
        requestId: data.requestId,
        type: "gpu",
        renderer: this._deviceResources.gpuRenderer,
        fromNode: MeshEngine.localId,
      });
    }
  }

  // ─── Earnings & Revenue ──────────────────────

  /** Record a contribution and earn coins (Auto-Rent split: 60/20/10/10) */
  recordContribution(serviceId: MeshService, units: number, peerId: string): number {
    const config = SERVICE_CATALOG.find(s => s.id === serviceId);
    if (!config) return 0;

    const grossCoins = config.ratePerUnit * units;
    const split = applyRentSplit(grossCoins, `meshEconomy:${serviceId}`, {
      kind: serviceId,
      nodeId: peerId,
    });
    const userCoins = split.publicCredited;
    const platformCoins = split.owner + split.maintenance + split.meshReserve;

    const record: ContributionRecord = {
      serviceId,
      units,
      coinsEarned: userCoins,
      timestamp: Date.now(),
      peerId,
      resourceType: config.resourceType,
    };

    this.contributions.push(record);
    if (this.contributions.length > 1000) {
      this.contributions = this.contributions.slice(-1000);
    }

    // Update node stats
    switch (serviceId) {
      case "storage":
      case "disk_lease": this.nodeStats.storageShardsHosted += units; break;
      case "relay":
      case "emergency_relay": this.nodeStats.messagesRelayed += units; break;
      case "ai_compute": this.nodeStats.aiQueriesServed += units; break;
      case "backup_vault": this.nodeStats.backupsHosted += units; break;
      case "cdn":
      case "connectivity":
      case "bandwidth_sell": this.nodeStats.dataServedMB += units; break;
      case "ram_share": break; // tracked in tickPassiveEarnings
      case "gpu_cluster": break; // tracked in tickPassiveEarnings
    }

    // Track resource contributions by type
    if (this.nodeStats.resourcesContributed[config.resourceType] != null) {
      this.nodeStats.resourcesContributed[config.resourceType] += userCoins;
    }

    // Boost reputation
    this.nodeStats.reputationScore = Math.min(100,
      this.nodeStats.reputationScore + (config.premium ? 0.5 : 0.1)
    );

    this.updateTier();
    this.persist();

    bus.emit("meshcloud:contribution", {
      record,
      platformCoins,
      totalEarnings: this.getTotalEarnings(),
    }, "meshEconomy");

    void this.pushUsageReceipt(serviceId, units, peerId, userCoins);

    return userCoins;
  }

  /** Get earnings summary */
  getEarnings(): EarningsSummary {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 86400_000;
    const monthStart = now - 30 * 86400_000;

    const breakdown: Record<MeshService, number> = {} as any;
    SERVICE_CATALOG.forEach(s => breakdown[s.id] = 0);

    const resourceBreakdown: Record<ResourceType, number> = {
      network: 0, storage: 0, compute: 0, memory: 0, gpu: 0, sensor: 0, general: 0,
    };

    let total = 0, today = 0, week = 0, month = 0;

    for (const c of this.contributions) {
      total += c.coinsEarned;
      breakdown[c.serviceId] = (breakdown[c.serviceId] || 0) + c.coinsEarned;
      resourceBreakdown[c.resourceType] = (resourceBreakdown[c.resourceType] || 0) + c.coinsEarned;
      if (c.timestamp >= todayStart) today += c.coinsEarned;
      if (c.timestamp >= weekStart) week += c.coinsEarned;
      if (c.timestamp >= monthStart) month += c.coinsEarned;
    }

    const userPct = this._revenueConfig.userPercent;
    const platPct = this._revenueConfig.platformPercent;
    const grossTotal = userPct > 0 ? total / (userPct / 100) : 0;

    return {
      totalCoins: total,
      todayCoins: today,
      weekCoins: week,
      monthCoins: month,
      lifetimeCoins: total,
      userShare: total,
      platformShare: Math.floor((grossTotal * (platPct / 100)) * 100) / 100,
      userSharePercent: userPct,
      platformSharePercent: platPct,
      serviceBreakdown: breakdown,
      resourceBreakdown,
      contributionCount: this.contributions.length,
    };
  }

  /** Get total coins earned */
  getTotalEarnings(): number {
    return this.contributions.reduce((sum, c) => sum + c.coinsEarned, 0);
  }

  // ─── Node Stats ──────────────────────────────

  getNodeStats(): NodeStats {
    return { ...this.nodeStats };
  }

  getTierInfo(): { tier: NodeTier; label: string; badge: string; nextTier: NodeTier | null; progress: number } {
    const current = TIER_THRESHOLDS[this.nodeStats.tier];
    const tiers: NodeTier[] = ["seed", "sprout", "tree", "forest", "mountain"];
    const idx = tiers.indexOf(this.nodeStats.tier);
    const nextTier = idx < tiers.length - 1 ? tiers[idx + 1] : null;

    let progress = 100;
    if (nextTier) {
      const next = TIER_THRESHOLDS[nextTier];
      const totalCoins = this.getTotalEarnings();
      const coinProgress = Math.min(1, (totalCoins - current.minCoins) / (next.minCoins - current.minCoins));
      const uptimeProgress = Math.min(1, (this.nodeStats.uptime - current.minUptime) / (next.minUptime - current.minUptime));
      progress = Math.floor(((coinProgress + uptimeProgress) / 2) * 100);
    }

    return { tier: this.nodeStats.tier, label: current.label, badge: current.badge, nextTier, progress };
  }

  private updateTier() {
    const totalCoins = this.getTotalEarnings();
    const uptime = this.nodeStats.uptime;
    const tiers: NodeTier[] = ["mountain", "forest", "tree", "sprout", "seed"];

    for (const tier of tiers) {
      const req = TIER_THRESHOLDS[tier];
      if (totalCoins >= req.minCoins && uptime >= req.minUptime) {
        if (this.nodeStats.tier !== tier) {
          const old = this.nodeStats.tier;
          this.nodeStats.tier = tier;
          bus.emit("meshcloud:tier_up", { from: old, to: tier }, "meshEconomy");
        }
        return;
      }
    }
  }

  // ─── Distributed Storage (Shard System) ──────

  storeShard(shard: StorageShard): boolean {
    if (!this.activeServices.has("storage") && !this.activeServices.has("disk_lease")) return false;

    this.shards.push(shard);
    if (this.shards.length > 100) {
      const now = Date.now();
      this.shards = this.shards.filter(s => s.expiresAt > now);
      if (this.shards.length > 100) this.shards = this.shards.slice(-100);
    }

    this.recordContribution("storage", shard.sizeMB, shard.ownerId);
    this.persist();
    return true;
  }

  retrieveShard(shardId: string): StorageShard | null {
    return this.shards.find(s => s.shardId === shardId) || null;
  }

  getHostedShards(): StorageShard[] {
    const now = Date.now();
    this.shards = this.shards.filter(s => s.expiresAt > now);
    return [...this.shards];
  }

  // ─── Mesh Service Request/Response ───────────

  requestService(service: MeshService, payload: any, priority: "normal" | "high" | "emergency" = "normal"): string {
    const requestId = crypto.randomUUID();
    const config = SERVICE_CATALOG.find(s => s.id === service);
    const offeredCoins = config ? config.ratePerUnit : 1;

    const request: MeshServiceRequest = {
      requestId, service, fromPeer: MeshEngine.localId, payload,
      priority, offeredCoins, timestamp: Date.now(),
    };

    MeshEngine.broadcast("service_request", request);
    bus.emit("meshcloud:request_sent", request, "meshEconomy");
    return requestId;
  }

  private handleServiceRequest(req: MeshServiceRequest) {
    if (req.fromPeer === MeshEngine.localId) return;
    if (!this.activeServices.has(req.service)) return;

    let result: any = null;
    let coinsCharged = 0;
    const start = Date.now();

    try {
      switch (req.service) {
        case "relay":
        case "emergency_relay":
          MeshEngine.broadcast("mesh_relay", {
            original: req.payload, relayedBy: MeshEngine.localId,
            hops: (req.payload?.hops || 0) + 1,
          });
          result = { relayed: true, hops: (req.payload?.hops || 0) + 1 };
          coinsCharged = this.recordContribution(req.service, 1, req.fromPeer);
          break;

        case "location_beacon":
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              pos => {
                const response: MeshServiceResponse = {
                  requestId: req.requestId, service: req.service,
                  fromNode: MeshEngine.localId,
                  result: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
                  coinsCharged: 2, latencyMs: Date.now() - start, timestamp: Date.now(),
                };
                MeshEngine.broadcast("service_response", response);
                this.recordContribution("location_beacon", 1, req.fromPeer);
              },
              () => {}
            );
            return;
          }
          break;

        case "storage":
          if (req.payload?.shardId) {
            const shard = this.retrieveShard(req.payload.shardId);
            result = shard || { error: "shard_not_found" };
            if (shard) coinsCharged = this.recordContribution("storage", 0.1, req.fromPeer);
          }
          break;

        case "cdn":
          result = { served: true, nodeId: MeshEngine.localId };
          coinsCharged = this.recordContribution("cdn", 1, req.fromPeer);
          break;

        case "bandwidth_sell":
          result = { bandwidthMbps: this._deviceResources.bandwidthUpMbps, nodeId: MeshEngine.localId };
          coinsCharged = this.recordContribution("bandwidth_sell", req.payload?.mb || 1, req.fromPeer);
          break;

        case "ram_share":
          result = { ramAvailMB: this._deviceResources.ramSharedMB, nodeId: MeshEngine.localId };
          coinsCharged = this.recordContribution("ram_share", req.payload?.mb || 1, req.fromPeer);
          break;

        case "gpu_cluster":
          if (this._deviceResources.gpuShared) {
            result = { gpuRenderer: this._deviceResources.gpuRenderer, nodeId: MeshEngine.localId };
            coinsCharged = this.recordContribution("gpu_cluster", 1, req.fromPeer);
          }
          break;

        default:
          result = { acknowledged: true, service: req.service };
          coinsCharged = this.recordContribution(req.service, 1, req.fromPeer);
      }
    } catch {
      result = { error: "service_failed" };
    }

    const response: MeshServiceResponse = {
      requestId: req.requestId, service: req.service, fromNode: MeshEngine.localId,
      result, coinsCharged, latencyMs: Date.now() - start, timestamp: Date.now(),
    };
    MeshEngine.broadcast("service_response", response);
  }

  private handleServiceResponse(resp: MeshServiceResponse) {
    if (resp.fromNode === MeshEngine.localId) return;
    bus.emit("meshcloud:response_received", resp, "meshEconomy");
  }

  private handleShardStore(data: any) {
    if (!this.activeServices.has("storage") && !this.activeServices.has("disk_lease")) return;
    if (data.targetNode && data.targetNode !== MeshEngine.localId) return;

    const shard: StorageShard = {
      shardId: data.shardId || crypto.randomUUID(),
      ownerId: data.ownerId,
      encryptedData: data.encryptedData,
      sizeMB: data.sizeMB || 0.01,
      createdAt: Date.now(),
      expiresAt: Date.now() + (data.ttlDays || 30) * 86400_000,
      replicaCount: data.replicaCount || 1,
    };

    this.storeShard(shard);
    MeshEngine.broadcast("shard_stored", {
      shardId: shard.shardId, storedBy: MeshEngine.localId, ownerId: shard.ownerId,
    });
  }

  private handleShardRetrieve(data: any) {
    if (!data.shardId) return;
    const shard = this.retrieveShard(data.shardId);
    if (shard) {
      MeshEngine.broadcast("shard_data", {
        shardId: shard.shardId, encryptedData: shard.encryptedData,
        fromNode: MeshEngine.localId, requestedBy: data.requestedBy,
      });
      this.recordContribution("storage", shard.sizeMB, data.requestedBy || "unknown");
    }
  }

  // ─── Network Heartbeat ──────────────────────

  private heartbeat() {
    this.nodeStats.lastHeartbeat = Date.now();
    MeshEngine.broadcast("node_heartbeat", {
      nodeId: this.nodeStats.nodeId,
      tier: this.nodeStats.tier,
      services: [...this.activeServices],
      reputation: this.nodeStats.reputationScore,
      shardCount: this.shards.length,
      uptime: this.nodeStats.uptime,
      resources: this._getResourceAdvertisement(),
    });
  }

  private handlePeerHeartbeat(data: any) {
    if (data.nodeId === MeshEngine.localId) return;

    // Update resource pool from peer data
    if (data.resources) {
      this._resourcePool.onlineNodes = Object.keys(MeshEngine.peers || {}).length + 1;
      this._resourcePool.totalNodes = Math.max(this._resourcePool.totalNodes, this._resourcePool.onlineNodes);
      this._resourcePool.lastUpdated = Date.now();
      S.set(KEYS.resourcePool, this._resourcePool);
    }

    bus.emit("meshcloud:peer_seen", data, "meshEconomy");
  }

  // ─── Withdrawals ────────────────────────────

  requestWithdrawal(
    amount: number,
    method: "upi" | "bank" | "crypto" | "mobile_money" | "voucher"
  ): WithdrawalRequest | null {
    const totalEarnings = this.getTotalEarnings();
    const withdrawals: WithdrawalRequest[] = S.get(KEYS.withdrawals, []);
    const withdrawn = withdrawals
      .filter(w => w.status === "completed" || w.status === "processing")
      .reduce((sum, w) => sum + w.amount, 0);

    const available = totalEarnings - withdrawn;
    if (amount > available || amount <= 0) return null;

    const request: WithdrawalRequest = {
      id: crypto.randomUUID(), nodeId: this.nodeStats.nodeId,
      amount, method, status: "pending", createdAt: Date.now(),
    };

    withdrawals.push(request);
    S.set(KEYS.withdrawals, withdrawals);
    bus.emit("meshcloud:withdrawal_requested", request, "meshEconomy");
    return request;
  }

  getWithdrawals(): WithdrawalRequest[] { return S.get(KEYS.withdrawals, []); }

  getAvailableBalance(): number {
    const totalEarnings = this.getTotalEarnings();
    const withdrawals: WithdrawalRequest[] = S.get(KEYS.withdrawals, []);
    const withdrawn = withdrawals
      .filter(w => w.status === "completed" || w.status === "processing")
      .reduce((sum, w) => sum + w.amount, 0);
    return Math.max(0, totalEarnings - withdrawn);
  }

  // ─── Utilities ──────────────────────────────

  getContributions(limit = 50): ContributionRecord[] { return this.contributions.slice(-limit); }

  getDashboardData() {
    const earnings = this.getEarnings();
    const tier = this.getTierInfo();
    const stats = this.getNodeStats();
    const services = this.getServiceStates();
    const balance = this.getAvailableBalance();
    const resources = this.getDeviceResources();
    const revenueConfig = this.getRevenueConfig();
    const resourceLimits = this.getResourceLimits();
    const resourcePool = this.getResourcePool();

    return { earnings, tier, stats, services, balance, resources, revenueConfig, resourceLimits, resourcePool };
  }

  estimateDailyEarnings(): number {
    let estimate = 0;
    const userShare = this.getUserShare();
    for (const serviceId of this.activeServices) {
      const config = SERVICE_CATALOG.find(s => s.id === serviceId);
      if (!config) continue;
      const typicalUnits: Record<MeshService, number> = {
        storage: 10, relay: 50, ai_compute: 5, translation: 10,
        backup_vault: 2, cdn: 20, emergency_relay: 3, location_beacon: 15,
        connectivity: 5, compute_pool: 3, bandwidth_sell: 100, ram_share: 50,
        gpu_cluster: 30, disk_lease: 5,
      };
      estimate += config.ratePerUnit * (typicalUnits[serviceId] || 5) * userShare;
    }
    return Math.floor(estimate * 100) / 100;
  }

  private getBatteryLevel(): number {
    try {
      if (this._deviceResources.batteryPercent > 0) return this._deviceResources.batteryPercent;
      const batteryInfo = S.get("device_battery", null);
      if (batteryInfo?.level != null) return Math.round(batteryInfo.level * 100);
    } catch { /* ignore */ }
    return 80;
  }

  private persist() {
    S.set(KEYS.nodeStats, this.nodeStats);
    S.set(KEYS.contributions, this.contributions);
    S.set(KEYS.shards, this.shards);
    S.set(KEYS.activeServices, [...this.activeServices]);
  }

  reset() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    this.contributions = [];
    this.shards = [];
    this.activeServices.clear();
    this.nodeStats.uptime = 0;
    this.nodeStats.storageShardsHosted = 0;
    this.nodeStats.messagesRelayed = 0;
    this.nodeStats.aiQueriesServed = 0;
    this.nodeStats.backupsHosted = 0;
    this.nodeStats.dataServedMB = 0;
    this.nodeStats.bandwidthSoldMB = 0;
    this.nodeStats.ramSharedMB = 0;
    this.nodeStats.gpuTasksCompleted = 0;
    this.nodeStats.diskLeasedMB = 0;
    this.nodeStats.reputationScore = 50;
    this.nodeStats.tier = "seed";
    this.nodeStats.activeServices = [];
    this.nodeStats.resourcesContributed = { network: 0, storage: 0, compute: 0, memory: 0, gpu: 0, sensor: 0, general: 0 };
  }
}

// ─── Singleton Export ────────────────────────────

export const meshEconomy = new MeshEconomyEngine();
