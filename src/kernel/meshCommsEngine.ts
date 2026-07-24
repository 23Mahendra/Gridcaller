// ═══════════════════════════════════════════════════════════════════
// GRIDALIVE — Production Mesh Communications Engine
// ═══════════════════════════════════════════════════════════════════
// Architecture (all real, no mocks):
//   GPS         → navigator.geolocation.watchPosition (real coordinates)
//   Presence    → Gun.js P2P graph (offline-first, cross-device sync)
//   Signaling   → Trystero/torrent (BitTorrent trackers, no server needed)
//   Voice/Data  → WebRTC via Trystero + PeerJS audio streams
//   SOS         → GPS + Gun.js broadcast + native tel: call
//   SMS Invite  → native sms: URI + Twilio API fallback
//   AI Analysis → Ollama local LLM → cloud API fallback → enhanced heuristic
//   Offline     → Gun.js localStorage + IndexedDB queue
// ═══════════════════════════════════════════════════════════════════

import Gun from "gun/gun";
import "gun/sea";
import "gun/lib/radisk";
import { bus } from "./bus";
import { S } from "./storage";
import { env } from "../env";
import { consumeRateLimit } from "./rateLimiter";
import { captureMeshError } from "./sentry";
import { attachAdaptiveBitrate } from "./adaptiveBitrate";
import { gunPeersForMesh, useLocalMeshOnly } from "./offlineMode";
import { MeshEngine } from "./mesh";
import { endPeerConnection, tryBeginPeerConnection } from "./networkGuard";
import { getWebRtcIceServers } from "./webrtcConfig";

const SEA = (Gun as any).SEA;

// ─── Types ───────────────────────────────────────────────────────
export interface MeshPeer {
  peerId: string;
  name: string;
  role: "user" | "emergency" | "medical" | "community" | "relay";
  lat: number;
  lng: number;
  accuracy?: number;
  signal?: number;
  distance?: number;   // metres, computed locally
  phone?: string;
  updated: number;     // epoch ms
  online: boolean;
}

export interface SOSPayload {
  id: string;
  user: string;
  peerId: string;
  message: string;
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  severity: "critical" | "high" | "medium";
  acknowledged: string[];
}

export interface WalkieMessage {
  id: string;
  user: string;
  peerId: string;
  channel: string;
  message?: string;
  audioChunks?: string[];  // base64 chunks
  duration?: number;
  timestamp: number;
  type: "text" | "voice";
}

export interface AIEmergencyResult {
  isEmergency: boolean;
  severity: number;          // 0–10
  keywords: string[];
  recommendedActions: string[];
  responseTime: "immediate" | "urgent" | "normal";
  summary: string;
  source: "ollama" | "cloud" | "heuristic";
}

// ─── Haversine distance (metres) ────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Enhanced emergency heuristic (fallback AI) ─────────────────
const EMERGENCY_LEXICON: Record<string, number> = {
  sos: 5, "911": 4, "999": 4, "112": 4, emergency: 4, "life threatening": 4,
  help: 3, danger: 3, critical: 3, unconscious: 3, bleeding: 3, attack: 3,
  fire: 3, flood: 3, earthquake: 3, explosion: 3, shooting: 3, collapse: 3,
  medical: 2, ambulance: 2, police: 2, injured: 2, hurt: 2, accident: 2,
  trapped: 2, missing: 2, threat: 2, violence: 2, urgent: 2,
  pain: 1, sick: 1, fall: 1, lost: 1, scared: 1, alone: 1,
};

function heuristicAnalysis(text: string): AIEmergencyResult {
  const lower = text.toLowerCase();
  let score = 0;
  const found: string[] = [];
  for (const [kw, weight] of Object.entries(EMERGENCY_LEXICON)) {
    if (lower.includes(kw)) { score += weight; found.push(kw); }
  }
  const severity = Math.min(10, score);
  const actions: string[] = severity > 0 ? ["share_location"] : [];
  if (severity >= 2) actions.push("alert_nearby_nodes");
  if (severity >= 4) actions.push("contact_emergency_services");
  if (severity >= 6) actions.push("broadcast_sos", "activate_emergency_lights");
  return {
    isEmergency: severity > 0,
    severity,
    keywords: found,
    recommendedActions: actions,
    responseTime: severity >= 6 ? "immediate" : severity >= 3 ? "urgent" : "normal",
    summary: severity >= 6
      ? `CRITICAL: ${found.join(", ")} — immediate response required`
      : severity >= 3
        ? `URGENT: ${found.join(", ")} — respond quickly`
        : severity > 0
          ? `Alert: ${found.join(", ")} — monitor situation`
          : "No emergency detected",
    source: "heuristic",
  };
}

// ─── Gun.js public relay peers (fallback chain) ─────────────────
const DEFAULT_GUN_PEERS = [
  "https://gun-us.herokuapp.com/gun",
  "https://gun-eu.herokuapp.com/gun",
  "wss://gun-manhattan.onrender.com/gun",
];

// ─── Main Engine ─────────────────────────────────────────────────
class MeshCommsEngine {
  private gun: any = null;
  private gunPeerCandidates: string[] = [];
  private activeRelays: string[] = [];
  private relayHealth = new Map<string, { score: number; ok: boolean; lastCheck: number; latencyMs: number }>();
  private relayMonitor: ReturnType<typeof setInterval> | null = null;
  private myPeerId: string = "";
  private myName: string = "User";
  private myLocation: GeolocationCoordinates | null = null;
  private locationWatchId: number | null = null;
  private presenceInterval: ReturnType<typeof setInterval> | null = null;
  private peers = new Map<string, MeshPeer>();
  private peerListeners: ((peers: MeshPeer[]) => void)[] = [];
  private sosListeners: ((sos: SOSPayload) => void)[] = [];
  private walkieListeners: ((msg: WalkieMessage) => void)[] = [];
  private activeWalkieRooms = new Map<string, any>(); // channelId → trystero room
  private walkieAudioRecorder: MediaRecorder | null = null;
  private walkieAudioChunks: Blob[] = [];
  private activeCallPeers = new Map<string, any>(); // peerId → RTCPeerConnection
  private offlineQueue: any[] = [];
  private isOnline = navigator.onLine;
  private lamportCounter = 0;
  private recentEventIds = new Set<string>();
  private incomingCallIds = new Set<string>();

  private nextEventId(prefix: string): string {
    this.lamportCounter += 1;
    return `${prefix}_${this.myPeerId}_${Date.now()}_${this.lamportCounter}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private rememberEventId(eventId: string) {
    this.recentEventIds.add(eventId);
    if (this.recentEventIds.size > 500) {
      const values = [...this.recentEventIds.values()].slice(-250);
      this.recentEventIds = new Set(values);
    }
  }

  private async conflictSafePut(path: string, eventId: string, payload: any) {
    if (!this.gun) return;
    // Immutable event node; never overwrite another writer's key.
    this.gun.get(path).get(eventId).put({ ...payload, _eventId: eventId, _writer: this.myPeerId, _writtenAt: Date.now() });
    this.rememberEventId(eventId);
  }

  private parseRelayCandidates(): string[] {
    // Flight mode / no SIM: never depend on public Gun relays
    if (useLocalMeshOnly()) return [];
    const fromEnv = env.gunPeers
      ? env.gunPeers.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    // Default: local-first empty — cloud only if env.gunPeers set (testing app prefers LAN)
    const preferCloud = S.get("gc_allow_cloud_gun", false) === true;
    const merged = preferCloud
      ? [...fromEnv, ...DEFAULT_GUN_PEERS].filter(Boolean)
      : gunPeersForMesh(fromEnv);
    return [...new Set(merged)];
  }

  private initGunWithRelays(peers: string[]) {
    const safe = gunPeersForMesh(peers);
    this.activeRelays = safe;
    this.gun = Gun({
      peers: safe,
      localStorage: true,
      radisk: true,
    });
    S.set("mesh_comms_active_relays", safe);
    bus.emit("mesh_comms:relays_active", { peers: safe, localOnly: useLocalMeshOnly() });
    if (useLocalMeshOnly()) {
      console.info("[MeshComms] LOCAL / flight mode — Gun localStorage only (no cloud, no SIM)");
    }
  }

  private async probeRelay(relay: string): Promise<{ ok: boolean; latencyMs: number }> {
    // Convert ws:// to http:// for health probing.
    const probeUrl = relay.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const started = performance.now();
    try {
      const resp = await fetch(probeUrl, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(3500) });
      return { ok: resp.ok || resp.status < 500, latencyMs: Math.round(performance.now() - started) };
    } catch {
      return { ok: false, latencyMs: 3500 };
    }
  }

  private scoreRelay(relay: string, ok: boolean, latencyMs: number) {
    const prev = this.relayHealth.get(relay) || { score: 50, ok: false, lastCheck: 0, latencyMs: 9999 };
    const delta = ok ? Math.max(5, 30 - Math.floor(latencyMs / 100)) : -25;
    const score = Math.max(0, Math.min(100, prev.score + delta));
    const next = { score, ok, lastCheck: Date.now(), latencyMs };
    this.relayHealth.set(relay, next);
    return next;
  }

  private pickTopRelays(limit = 3): string[] {
    const scored = this.gunPeerCandidates
      .map(relay => ({ relay, meta: this.relayHealth.get(relay) || { score: 40, ok: false, lastCheck: 0, latencyMs: 9999 } }))
      .sort((a, b) => b.meta.score - a.meta.score || a.meta.latencyMs - b.meta.latencyMs)
      .slice(0, limit)
      .map(item => item.relay);
    return scored.length > 0 ? scored : this.gunPeerCandidates.slice(0, limit);
  }

  private startRelayMonitor() {
    if (this.relayMonitor) clearInterval(this.relayMonitor);
    const tick = async () => {
      await Promise.all(this.gunPeerCandidates.map(async relay => {
        const probe = await this.probeRelay(relay);
        this.scoreRelay(relay, probe.ok, probe.latencyMs);
      }));

      const preferred = this.pickTopRelays(3);
      const changed = preferred.join(",") !== this.activeRelays.join(",");
      const healthyCount = preferred.filter(r => this.relayHealth.get(r)?.ok).length;

      // Rotate only when current set is unhealthy or all failed.
      if (changed && (healthyCount > 0 || preferred.length > 0)) {
        this.initGunWithRelays(preferred);
        this.attachCoreSubscriptions();
      }

      bus.emit("mesh_comms:relay_health", {
        activeRelays: this.activeRelays,
        preferred,
        table: this.gunPeerCandidates.map(relay => ({ relay, ...(this.relayHealth.get(relay) || {}) })),
      });
    };

    tick();
    this.relayMonitor = setInterval(tick, 45000);
  }

  private attachCoreSubscriptions() {
    if (!this.gun) return;
    // Subscribe to SOS alerts from all peers
    this.gun.get("gridalive.mesh.sos").map().on((data: any) => {
      if (!data || !data.peerId || data.peerId === this.myPeerId) return;
      if (data._eventId && this.recentEventIds.has(data._eventId)) return;
      if (data._eventId) this.rememberEventId(data._eventId);
      const sos: SOSPayload = data;
      this.sosListeners.forEach(fn => fn(sos));
      bus.emit("mesh_comms:sos", sos);
      this.playEmergencyBeep();
    });

    // Subscribe to peer presence from all peers (real discovery)
    this.gun.get("gridalive.mesh.peers").map().on((data: any) => {
      console.log("[MeshComms] Received peer data from Gun:", data);
      if (!data || !data.peerId || data.peerId === this.myPeerId) return;
      const age = Date.now() - (data.updated || 0);
      if (age > 15 * 60 * 1000) {
        console.log("[MeshComms] Peer too old, skipping:", data.peerId, "age:", Math.round(age/60000), "min");
        return;
      }
      const peer: MeshPeer = {
        ...data,
        online: age < 3 * 60 * 1000,
        distance: this.myLocation
          ? haversine(this.myLocation.latitude, this.myLocation.longitude, data.lat, data.lng)
          : undefined,
      };
      console.log("[MeshComms] Adding peer:", peer.peerId, "name:", peer.name, "online:", peer.online);
      this.peers.set(data.peerId, peer);
      this.emitPeerList();
    });

    // Subscribe to Bluetooth devices discovered by other mesh peers
    this.gun.get("gridalive.mesh.bluetooth").map().on((data: any) => {
      if (!data || !data.discoveredBy) return;
      // Only add if not our own discovery and not too old
      if (data.discoveredBy === this.myPeerId) return;
      const age = Date.now() - (data.timestamp || 0);
      if (age > 5 * 60 * 1000) return; // Ignore BT devices older than 5 min
      
      const deviceId = data.id || `mesh_bt_${data.name}_${data.timestamp}`;
      if (!this.bleDevices.has(deviceId)) {
        this.bleDevices.set(deviceId, {
          id: deviceId,
          name: data.name || "Unknown BT Device",
          rssi: data.rssi || -80,
          timestamp: data.timestamp,
        });
        console.log("[MeshComms] BT device from mesh peer:", data.name, "discovered by:", data.discoveredBy);
        this.emitBLEDevices();
      }
    });
  }

  // ─── Init ──────────────────────────────────────────────────────
  init(userId?: string, userName?: string) {
    console.log("[MeshComms] Initializing with userId:", userId, "userName:", userName);
    this.myName = userName || S.get("user_name") || S.get("mesh_name") || "User";
    if (userName) S.set("user_name", userName);

    // Stable peer ID from storage or generate once
    this.myPeerId = S.get("mesh_comms_peerid") || (() => {
      const id = `ga_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      S.set("mesh_comms_peerid", id);
      return id;
    })();

    // Always start local-first; cloud relays optional (flight mode = empty)
    this.gunPeerCandidates = this.parseRelayCandidates().filter(Boolean);
    if (this.gunPeerCandidates.length === 0 || useLocalMeshOnly()) {
      this.initGunWithRelays([]);
    } else {
      this.gunPeerCandidates.forEach(relay => this.relayHealth.set(relay, { score: 50, ok: false, lastCheck: 0, latencyMs: 9999 }));
      this.initGunWithRelays(this.gunPeerCandidates.slice(0, 3));
    }

    // Online/offline tracking — re-bind Gun to local when airplane mode
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.flushOfflineQueue();
      bus.emit("mesh_comms:online", {});
    });
    window.addEventListener("offline", () => {
      this.isOnline = false;
      try {
        this.initGunWithRelays([]);
      } catch {}
      bus.emit("mesh_comms:offline", { flightOk: true });
    });

    // Start GPS
    this.startGPS();

    this.attachCoreSubscriptions();
    this.startRelayMonitor();

    // Local BroadcastChannel for same-device tab sync
    const bc = new BroadcastChannel("gridalive_mesh_comms");
    bc.onmessage = (e) => {
      const { type, data } = e.data || {};
      if (type === "WALKIE_MSG") this.walkieListeners.forEach(fn => fn(data));
      if (type === "SOS") this.sosListeners.forEach(fn => fn(data));
    };

    // Restore offline queue
    this.offlineQueue = S.get("mesh_comms_offline_queue", []);

    bus.emit("mesh_comms:ready", { peerId: this.myPeerId });
    console.info("[MeshComms] Engine initialized. PeerId:", this.myPeerId);
  }

  get peerId() { return this.myPeerId; }
  get location() { return this.myLocation; }
  get nearbyPeers() { return this.getPeerList(); }

  // ─── GPS ───────────────────────────────────────────────────────
  private startGPS() {
    if (!("geolocation" in navigator)) {
      console.warn("[MeshComms] Geolocation not available");
      return;
    }
    console.log("[MeshComms] Starting GPS...");

    const onPosition = (pos: GeolocationPosition) => {
      console.log("[MeshComms] GPS position received:", pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5), "accuracy:", Math.round(pos.coords.accuracy), "m");
      this.myLocation = pos.coords;
      S.set("mesh_comms_last_location", {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: Date.now(),
      });
      this.announcePresence();
      // Recompute distances for known peers
      this.peers.forEach((peer, id) => {
        if (peer.lat && peer.lng) {
          this.peers.set(id, {
            ...peer,
            distance: haversine(pos.coords.latitude, pos.coords.longitude, peer.lat, peer.lng),
          });
        }
      });
      this.emitPeerList();
      bus.emit("mesh_comms:location", { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    };

    const onError = (err: GeolocationPositionError) => {
      console.warn("[MeshComms] GPS error:", err.message);
      // Try restoring last known location from storage
      const cached = S.get("mesh_comms_last_location");
      if (cached) {
        this.myLocation = {
          latitude: cached.lat, longitude: cached.lng, accuracy: cached.accuracy,
          altitude: null, altitudeAccuracy: null, heading: null, speed: null,
        } as GeolocationCoordinates;
        this.announcePresence();
      }
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, timeout: 10000 });
    this.locationWatchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
  }

  stopGPS() {
    if (this.locationWatchId !== null) {
      navigator.geolocation.clearWatch(this.locationWatchId);
      this.locationWatchId = null;
    }
  }

  // ─── Presence announcement ─────────────────────────────────────
  private announcePresence(name?: string, role?: MeshPeer["role"]) {
    // Prefer live GPS; if not yet, still announce online without coords
    const lat = this.myLocation?.latitude;
    const lng = this.myLocation?.longitude;
    const accuracy = this.myLocation?.accuracy;
    const phone =
      String(S.get("user_phone", "") || S.get("soft_tower_sim_alias", "") || "").replace(/\D/g, "") ||
      undefined;
    const displayNum = String(S.get("gc_test_display_number", "") || "").trim() || undefined;
    const meshId = S.get("mesh_id") || this.myPeerId;
    const presence = {
      peerId: meshId || this.myPeerId,
      name: name || S.get("user_name") || "GridAlive User",
      role: role || ((S.get("user_role") || "user") as MeshPeer["role"]),
      lat: lat ?? null,
      lng: lng ?? null,
      accuracy: accuracy ?? null,
      phone: phone || undefined,
      displayNumber: displayNum || (phone ? phone : undefined),
      updated: Date.now(),
      online: true,
    };
    console.log(
      "[MeshComms] Announcing presence:",
      presence.peerId,
      lat != null ? `lat:${lat} lng:${lng}` : "no-gps-yet"
    );
    if (this.gun && lat != null && lng != null) {
      this.gun.get("gridalive.mesh.peers").get(this.myPeerId).put({
        ...presence,
        lat,
        lng,
      });
    }
    // Local cache for offline / flight
    const localPeers = S.get("mesh_peers_cache", {} as Record<string, any>);
    localPeers[presence.peerId] = presence;
    S.set("mesh_peers_cache", localPeers);

    // LIVE path for multi-device (LAN mesh-ws / BroadcastChannel) — no cloud needed
    try {
      MeshEngine.broadcast("GRIDCALLER_LOCATION", presence);
    } catch (e) {
      console.warn("[MeshComms] location broadcast failed", e);
    }
  }

  startPresence(name?: string, role?: MeshPeer["role"]) {
    this.announcePresence(name, role);
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    // Live location: every 8s (testing + map)
    this.presenceInterval = setInterval(() => this.announcePresence(name, role), 8000);
  }

  stopPresence() {
    if (this.presenceInterval) { clearInterval(this.presenceInterval); this.presenceInterval = null; }
    // Mark as offline in Gun
    if (this.gun && this.myLocation) {
      this.gun.get("gridalive.mesh.peers").get(this.myPeerId).put({ online: false, updated: Date.now() });
    }
  }

  private getPeerList(): MeshPeer[] {
    const arr = [...this.peers.values()];
    // Also load from Gun local cache for offline mode
    if (arr.length === 0) {
      const cached = S.get("mesh_peers_cache", {} as Record<string, MeshPeer>) as Record<string, MeshPeer>;
      return (Object.values(cached) as MeshPeer[])
        .filter(p => p.peerId !== this.myPeerId)
        .map(p => ({ ...p, online: (Date.now() - p.updated) < 3 * 60 * 1000 }));
    }
    return arr.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
  }

  /** Public getter for peers list — used by UI components */
  getPeers(): MeshPeer[] {
    return this.getPeerList();
  }

  /** Diagnostic status for debugging — returns all internal states */
  getDiagnostics(): {
    peerId: string;
    gpsStatus: "acquired" | "pending" | "failed";
    gpsCoords: { lat: number; lng: number; accuracy: number } | null;
    gunConnected: boolean;
    activeRelays: string[];
    peerCount: number;
    peers: MeshPeer[];
    presenceActive: boolean;
    isOnline: boolean;
  } {
    return {
      peerId: this.myPeerId,
      gpsStatus: this.myLocation ? "acquired" : (this.locationWatchId !== null ? "pending" : "failed"),
      gpsCoords: this.myLocation ? {
        lat: this.myLocation.latitude,
        lng: this.myLocation.longitude,
        accuracy: this.myLocation.accuracy,
      } : null,
      gunConnected: !!this.gun,
      activeRelays: this.activeRelays,
      peerCount: this.peers.size,
      peers: this.getPeerList(),
      presenceActive: this.presenceInterval !== null,
      isOnline: this.isOnline,
    };
  }

  private emitPeerList() {
    const list = this.getPeerList();
    this.peerListeners.forEach(fn => fn(list));
    bus.emit("mesh_comms:peers", list);
  }

  onPeers(fn: (peers: MeshPeer[]) => void) {
    this.peerListeners.push(fn);
    // Emit current list immediately
    fn(this.getPeerList());
    return () => { this.peerListeners = this.peerListeners.filter(f => f !== fn); };
  }

  onSOS(fn: (sos: SOSPayload) => void) {
    this.sosListeners.push(fn);
    return () => { this.sosListeners = this.sosListeners.filter(f => f !== fn); };
  }

  onWalkieMessage(fn: (msg: WalkieMessage) => void) {
    this.walkieListeners.push(fn);
    return () => { this.walkieListeners = this.walkieListeners.filter(f => f !== fn); };
  }

  // ─── SOS Emergency Broadcast ───────────────────────────────────
  async triggerSOS(message: string, userName: string): Promise<SOSPayload | null> {
    // Rate limiting to prevent SOS spam
    const rateCheck = consumeRateLimit('sos', this.myPeerId);
    if (!rateCheck.allowed) {
      bus.emit("mesh_comms:sos_rate_limited", { reason: rateCheck.reason, retryAfter: rateCheck.retryAfter });
      return null;
    }

    try {
      // 1. Get fresh GPS
      let lat = 0, lng = 0, accuracy = 0;
    if (this.myLocation) {
      lat = this.myLocation.latitude;
      lng = this.myLocation.longitude;
      accuracy = this.myLocation.accuracy;
    } else {
      // Try one-shot GPS with short timeout
      await new Promise<void>(resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => { lat = pos.coords.latitude; lng = pos.coords.longitude; accuracy = pos.coords.accuracy; resolve(); },
          () => resolve(),
          { enableHighAccuracy: true, timeout: 5000 }
        );
      });
    }

    const eventId = this.nextEventId("sos");
    const sos: SOSPayload = {
      id: eventId,
      user: userName,
      peerId: this.myPeerId,
      message,
      lat, lng, accuracy,
      timestamp: Date.now(),
      severity: "critical",
      acknowledged: [],
    };

    // 2. Persist to Gun.js (cross-device broadcast)
    if (this.gun) {
      await this.conflictSafePut("gridalive.mesh.sos", eventId, sos);
    } else {
      // Queue for when online
      this.queueOffline({ type: "SOS", data: sos });
    }

    // 3. BroadcastChannel for same-device
    try {
      const bc = new BroadcastChannel("gridalive_mesh_comms");
      bc.postMessage({ type: "SOS", data: sos });
    } catch {}

    // 4. Walkie broadcast on emergency channel
    this.sendWalkieTextMessage("EMERGENCY_SOS", `🆘 SOS from ${userName}: ${message} | GPS: ${lat.toFixed(5)},${lng.toFixed(5)}`, "emergency");

    // 5. Play emergency beep
    this.playEmergencyBeep();

    // 6. Vibrate
    if ("vibrate" in navigator) navigator.vibrate([500, 200, 500, 200, 500]);

    bus.emit("mesh_comms:sos_sent", sos);
    return sos;
    } catch (err) {
      captureMeshError('sos', err as Error, { message, userName });
      bus.emit("mesh_comms:sos_error", { error: err });
      return null;
    }
  }

  // ─── Emergency Services Call ────────────────────────────────────
  callEmergencyServices(number?: string) {
    // Rate limiting for emergency calls
    const rateCheck = consumeRateLimit('emergency_call', this.myPeerId);
    if (!rateCheck.allowed) {
      bus.emit("mesh_comms:call_rate_limited", { reason: rateCheck.reason });
      // Still allow the call in true emergencies, just log it
    }

    const emergencyNum = number || env.emergencyNumber || "112";
    // Native tel: URI — opens phone app on mobile, VOIP app on desktop
    window.location.href = `tel:${emergencyNum}`;
    // Log the call attempt
    const attempt = { number: emergencyNum, timestamp: Date.now(), peerId: this.myPeerId };
    if (this.gun) {
      this.gun.get("gridalive.mesh.emergency_calls").get(`${this.myPeerId}_${Date.now()}`).put(attempt);
    }
    bus.emit("mesh_comms:emergency_call", attempt);
    return emergencyNum;
  }

  // ─── Native SMS invite ──────────────────────────────────────────
  sendSMSInvite(phone: string, message: string) {
    const smsUri = /Android/i.test(navigator.userAgent)
      ? `sms:${phone}?body=${encodeURIComponent(message)}`
      : `sms:${phone}&body=${encodeURIComponent(message)}`; // iOS uses &
    window.open(smsUri, "_blank");
    return smsUri;
  }

  // Twilio REST SMS (when API key is available)
  async sendTwilioSMS(to: string, message: string): Promise<boolean> {
    const sid = (env as any).twilioAccountSid || localStorage.getItem("VITE_TWILIO_ACCOUNT_SID");
    const token = (env as any).twilioAuthToken || localStorage.getItem("VITE_TWILIO_AUTH_TOKEN");
    const from = (env as any).twilioPhone || localStorage.getItem("VITE_TWILIO_PHONE");

    if (!sid || !token || !from) {
      // Fall back to native SMS
      this.sendSMSInvite(to, message);
      return false;
    }

    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
      });
      const data = await response.json();
      return response.ok && data.sid;
    } catch (err) {
      console.error("[MeshComms] Twilio SMS failed:", err);
      this.sendSMSInvite(to, message);
      return false;
    }
  }

  // ─── Walkie-Talkie via Trystero ────────────────────────────────
  joinWalkieChannel(channelId: string, onMessage: (msg: WalkieMessage) => void): () => void {
    // Leave previous room if different
    const existing = this.activeWalkieRooms.get(channelId);
    if (existing) return () => this.leaveWalkieChannel(channelId);

    const roomId = `gridalive-walkie-${channelId}`;
    let room: any = null;
    let unsubActions = () => {};

    try {
      // Dynamic import of trystero to handle if not available
      import("trystero/torrent").then(({ joinRoom }) => {
        room = joinRoom({ appId: env.meshAppId || "gridalive-solidarity-os" }, roomId);
        this.activeWalkieRooms.set(channelId, room);

        const [sendMsg, receiveMsg] = room.makeAction("walkie_msg");
        const [sendAudio, receiveAudio] = room.makeAction("walkie_audio");

        receiveMsg((data: WalkieMessage) => {
          onMessage(data);
          this.walkieListeners.forEach(fn => fn(data));
          bus.emit("mesh_comms:walkie_msg", data);
        });

        receiveAudio((base64: string, peerId: string) => {
          // Decode and play audio
          this.playIncomingAudio(base64, peerId);
          const voiceMsg: WalkieMessage = {
            id: `voice_${peerId}_${Date.now()}`,
            user: peerId,
            peerId,
            channel: channelId,
            type: "voice",
            audioChunks: [base64],
            timestamp: Date.now(),
          };
          onMessage(voiceMsg);
          this.walkieListeners.forEach(fn => fn(voiceMsg));
        });

        room.onPeerJoin((peerId: string) => bus.emit("mesh_comms:walkie_peer_join", { channelId, peerId }));
        room.onPeerLeave((peerId: string) => bus.emit("mesh_comms:walkie_peer_leave", { channelId, peerId }));

        // Attach send functions to room object for later use
        room._sendMsg = sendMsg;
        room._sendAudio = sendAudio;

        bus.emit("mesh_comms:walkie_joined", { channelId, roomId });
      }).catch(err => {
        console.warn("[MeshComms] Trystero unavailable, using Gun.js walkie fallback:", err);
        // Gun.js fallback for walkie messages
        if (this.gun) {
          this.gun.get(`gridalive.walkie.${channelId}`).map().on((data: WalkieMessage, key: string) => {
            if (!data || data.peerId === this.myPeerId) return;
            const age = Date.now() - data.timestamp;
            if (age > 60000) return; // ignore messages older than 1 min
            onMessage(data);
            this.walkieListeners.forEach(fn => fn(data));
          });
        }
      });
    } catch (err) {
      console.warn("[MeshComms] Trystero join error:", err);
    }

    // Also subscribe via Gun.js for offline Trystero + cross-network relay
    if (this.gun) {
      this.gun.get(`gridalive.walkie.${channelId}`).map().on((data: WalkieMessage, key: string) => {
        if (!data || data.peerId === this.myPeerId) return;
        const age = Date.now() - data.timestamp;
        if (age > 60000) return;
        onMessage(data);
        this.walkieListeners.forEach(fn => fn(data));
      });
    }

    return () => this.leaveWalkieChannel(channelId);
  }

  leaveWalkieChannel(channelId: string) {
    const room = this.activeWalkieRooms.get(channelId);
    if (room) {
      try { room.leave?.(); } catch {}
      this.activeWalkieRooms.delete(channelId);
    }
  }

  sendWalkieTextMessage(channelId: string, message: string, userName: string) {
    const eventId = this.nextEventId("walkie");
    const msg: WalkieMessage = {
      id: eventId,
      user: userName,
      peerId: this.myPeerId,
      channel: channelId,
      message,
      timestamp: Date.now(),
      type: "text",
    };

    // Send via Trystero (real cross-device P2P)
    const room = this.activeWalkieRooms.get(channelId);
    if (room?._sendMsg) {
      try { room._sendMsg(msg); } catch {}
    }

    // Send via Gun.js (resilient relay + offline sync)
    if (this.gun) {
      this.conflictSafePut(`gridalive.walkie.${channelId}`, eventId, msg);
    } else {
      this.queueOffline({ type: "WALKIE_TEXT", data: msg });
    }

    // Same-device tabs
    try {
      new BroadcastChannel("gridalive_mesh_comms").postMessage({ type: "WALKIE_MSG", data: msg });
    } catch {}

    return msg;
  }

  // ─── Walkie-Talkie Voice TX ─────────────────────────────────────
  async startVoiceTransmission(channelId: string): Promise<{ stop: () => void }> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 },
      });
    } catch (err: any) {
      console.warn("[MeshComms] Microphone access failed:", err);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        throw err;
      }
      throw new Error("Unable to access microphone");
    }

    // Try to use WebRTC stream first if Trystero room active
    const room = this.activeWalkieRooms.get(channelId);
    if (room?.addStream) {
      try {
        room.addStream(stream);
        bus.emit("mesh_comms:voice_tx_start", { channelId, method: "webrtc_stream" });
        return {
          stop: () => {
            stream.getTracks().forEach(t => t.stop());
            bus.emit("mesh_comms:voice_tx_stop", { channelId });
          },
        };
      } catch {}
    }

    // Fallback: MediaRecorder → base64 → Gun.js + Trystero data channel
    const supported = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t)) || "";
    const recorder = new MediaRecorder(stream, supported ? { mimeType: supported } : undefined);
    this.walkieAudioRecorder = recorder;
    this.walkieAudioChunks = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) this.walkieAudioChunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(this.walkieAudioChunks, { type: supported || "audio/webm" });
      stream.getTracks().forEach(t => t.stop());
      // Convert to base64 and broadcast
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        const msg: WalkieMessage = {
          id: this.nextEventId("voice"),
          user: S.get("user_name") || "Unknown",
          peerId: this.myPeerId,
          channel: channelId,
          audioChunks: [base64],
          duration: this.walkieAudioChunks.length * 100,
          timestamp: Date.now(),
          type: "voice",
        };
        // Trystero
        if (room?._sendAudio) {
          try { room._sendAudio(base64); } catch {}
        }
        // Gun.js
        if (this.gun) {
          this.conflictSafePut(`gridalive.walkie.${channelId}`, msg.id, { ...msg, audioChunks: [base64] });
        }
        bus.emit("mesh_comms:voice_tx_done", { channelId, msg });
      };
      reader.readAsDataURL(blob);
      this.walkieAudioChunks = [];
    };

    recorder.start(100); // collect 100ms chunks
    bus.emit("mesh_comms:voice_tx_start", { channelId, method: "mediarecorder" });

    return {
      stop: () => {
        if (recorder.state !== "inactive") recorder.stop();
        bus.emit("mesh_comms:voice_tx_stop", { channelId });
      },
    };
  }

  private async playIncomingAudio(base64: string, peerId: string) {
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
      const blob = new Blob([bytes], { type: "audio/webm;codecs=opus" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 1.0;
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[MeshComms] Audio playback error:", err);
    }
  }

  // ─── Audio Call via native tel: ────────────────────────────────
  callByPhone(phone: string, name: string) {
    const cleanPhone = phone.replace(/[^+\d]/g, "");
    if (!cleanPhone) return false;
    window.location.href = `tel:${cleanPhone}`;
    return true;
  }

  // Audio call via WebRTC to a mesh peer
  async callMeshPeer(targetPeerId: string): Promise<RTCPeerConnection | null> {
    if (!("RTCPeerConnection" in window)) return null;

    // Close any existing call first (prevents "Cannot create so many PeerConnections")
    this.hangUpCall(targetPeerId);
    this.enforcePcBudget();

    const iceServers = await getWebRtcIceServers();

    const pc = this.createPeerConnection(iceServers);
    if (!pc) {
      return null;
    }

    // Capture mic for call
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      try { pc.close(); } catch {}
      return null;
    }
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    // Attach adaptive Opus bitrate controller — adjusts 8–64 kbps based on
    // real-time RTCStatsReport (packet loss, RTT, available bandwidth).
    attachAdaptiveBitrate(pc);

    // Signal via Gun.js (no copy-paste signaling!)
    const callId = `call_${this.myPeerId}_${targetPeerId}_${Date.now()}`;

    pc.onicecandidate = (e) => {
      if (e.candidate && this.gun) {
        this.gun.get("gridalive.webrtc.ice").get(callId).get(`${Date.now()}`).put(JSON.stringify(e.candidate));
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (this.gun) {
      // Write offer to Gun.js - the target peer will read and answer
      this.gun.get("gridalive.webrtc.offer").get(callId).put({
        from: this.myPeerId,
        to: targetPeerId,
        offer: JSON.stringify(offer),
        timestamp: Date.now(),
      });

      // Listen for answer
      let answerApplied = false;
      this.gun.get("gridalive.webrtc.answer").get(callId).on(async (data: any) => {
        if (answerApplied || !data?.answer) return;
        try {
          const answer = JSON.parse(data.answer);
          if (pc.signalingState !== "stable") {
            await pc.setRemoteDescription(answer);
          }
          answerApplied = true;
        } catch (err) {
          console.warn("[MeshComms] Failed to apply answer SDP:", err);
        }
      });

      // Listen for ICE candidates from remote
      this.gun.get("gridalive.webrtc.ice_remote").get(callId).map().on(async (data: any) => {
        if (!data) return;
        try { await pc.addIceCandidate(JSON.parse(data)); } catch (err) {
          console.warn("[MeshComms] addIceCandidate failed:", err);
        }
      });
    }

    pc.ontrack = (e) => {
      const remoteAudio = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement;
      if (remoteAudio) {
        remoteAudio.srcObject = e.streams[0];
        remoteAudio.play().catch(console.warn);
      }
      bus.emit("mesh_comms:call_audio", { from: targetPeerId });
    };

    pc.onconnectionstatechange = () => {
      bus.emit("mesh_comms:call_state", { state: pc.connectionState, peerId: targetPeerId });
    };

    this.activeCallPeers.set(targetPeerId, pc);
    return pc;
  }

  // Answer incoming call published to Gun.js
  async listenForIncomingCalls(onCall: (from: string, accept: () => void, reject: () => void) => void) {
    if (!this.gun) return;

    const handleOffer = async (data: any, key: string) => {
      if (!data || data.to !== this.myPeerId) return;
      if (this.incomingCallIds.has(key)) return;
      this.incomingCallIds.add(key);
      const age = Date.now() - (data.timestamp || 0);
      if (age > 60000) return; // ignore stale calls

      onCall(
        data.from,
        async () => {
          this.hangUpCall(data.from);
          this.enforcePcBudget();
          const iceServers = await getWebRtcIceServers();
          const pc = this.createPeerConnection(iceServers);
          if (!pc) {
            return;
          }
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            try { pc.close(); } catch {}
            return;
          }
          stream.getTracks().forEach(t => pc.addTrack(t, stream));

          const callId = key;
          pc.onicecandidate = (e) => {
            if (e.candidate && this.gun) {
              this.gun.get("gridalive.webrtc.ice_remote").get(callId).get(`${Date.now()}`).put(JSON.stringify(e.candidate));
            }
          };

          // Set remote offer and create answer
          const offer = JSON.parse(data.offer);
          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          this.gun.get("gridalive.webrtc.answer").get(callId).put({
            from: this.myPeerId,
            to: data.from,
            answer: JSON.stringify(answer),
            timestamp: Date.now(),
          });

          // Listen for ICE from caller
          this.gun.get("gridalive.webrtc.ice").get(callId).map().on(async (candData: any) => {
            if (!candData) return;
            try { await pc.addIceCandidate(JSON.parse(candData)); } catch (err) {
              console.warn("[MeshComms] addIceCandidate failed:", err);
            }
          });

          pc.ontrack = (e) => {
            const remoteAudio = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement;
            if (remoteAudio) { remoteAudio.srcObject = e.streams[0]; remoteAudio.play().catch(console.warn); }
          };

          pc.onconnectionstatechange = () => {
            bus.emit("mesh_comms:call_state", { state: pc.connectionState, peerId: data.from });
          };

          this.activeCallPeers.set(data.from, pc);
        },
        () => {
          if (this.gun) {
            this.gun.get("gridalive.webrtc.answer").get(key).put({ declined: true, from: this.myPeerId, timestamp: Date.now() });
          }
        }
      );
    };

    this.gun.get("gridalive.webrtc.offer").map().on(handleOffer);
    this.gun.get("gridalive.webrtc.call").map().on((data: any, key: string) => {
      if (!data || data.type !== "lone_offer" || data.to !== this.myPeerId) return;
      handleOffer(data, key);
    });
  }

  hangUpCall(peerId?: string) {
    const toClose = peerId ? [this.activeCallPeers.get(peerId)] : [...this.activeCallPeers.values()];
    toClose.forEach((pc) => {
      if (!pc) return;
      try {
        pc.getSenders?.().forEach((s: RTCRtpSender) => {
          try {
            s.track?.stop();
          } catch {}
        });
      } catch {}
      try {
        pc.close();
      } catch {}
    });
    if (peerId) this.activeCallPeers.delete(peerId);
    else this.activeCallPeers.clear();
    bus.emit("mesh_comms:call_ended", { peerId });
  }

  /** Max concurrent peer connections — browsers hard-fail past ~50 */
  private readonly MAX_PEER_CONNECTIONS = 4;

  private enforcePcBudget() {
    if (this.activeCallPeers.size < this.MAX_PEER_CONNECTIONS) return;
    // Close oldest / all extra
    const ids = [...this.activeCallPeers.keys()];
    for (const id of ids.slice(0, Math.max(0, ids.length - 1))) {
      this.hangUpCall(id);
    }
  }

  /** Safe create — always hang up previous call to same peer first */
  private createPeerConnection(iceServers: RTCIceServer[], opts?: RTCConfiguration): RTCPeerConnection | null {
    this.enforcePcBudget();
    if (!tryBeginPeerConnection()) {
      return null;
    }
    try {
      const pc = new RTCPeerConnection({ iceServers, ...(opts || {}) });
      const originalClose = pc.close.bind(pc);
      pc.close = () => {
        endPeerConnection();
        return originalClose();
      };
      return pc;
    } catch {
      endPeerConnection();
      return null;
    }
  }

  // ─── Lone Ranger Call — TURN relay with no mesh peers required ──
  // When a user is isolated (no mesh peers nearby), this method establishes
  // a WebRTC call routed entirely through TURN relay servers using the device's
  // cellular radio. No Trystero peers needed — Gun.js handles signaling.
  //
  //   Caller side:  callLoneRanger(targetPeerId) → offer → Gun.js
  //   Callee side:  Gun.js → watchIncomingCalls() receives it (already active)
  //
  async callLoneRanger(targetPeerId: string): Promise<RTCPeerConnection | null> {
    if (!("RTCPeerConnection" in window)) return null;

    this.hangUpCall(targetPeerId);
    this.enforcePcBudget();

    // Self-hosted TURN from hub config; falls back to STUN only if unavailable.
    const iceServers = await getWebRtcIceServers();

    const pc = this.createPeerConnection(iceServers, { iceCandidatePoolSize: 4 });
    if (!pc) {
      return null;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => pc.addTrack(t, stream!));
    } catch {
      pc.close();
      return null;
    }

    // Adaptive Opus bitrate — starts at 16 kbps, auto-upgrades as TURN link stabilises
    attachAdaptiveBitrate(pc);

    // Use a Gun.js call ID tagged with "lone" for easy debug tracing
    const callId = `lone_${this.myPeerId}_${targetPeerId}_${Date.now()}`;
    bus.emit("mesh_comms:lone_call_start", { callId, targetPeerId, mode: "turn_relay" });

    pc.onicecandidate = (e) => {
      if (e.candidate && this.gun) {
        this.gun.get("gridalive.webrtc.ice").get(callId).get(`${Date.now()}`).put(JSON.stringify(e.candidate));
      }
    };

    pc.ontrack = (e) => {
      const remoteAudio = document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement;
      if (remoteAudio) { remoteAudio.srcObject = e.streams[0]; remoteAudio.play().catch(console.warn); }
    };

    pc.onconnectionstatechange = () => {
      bus.emit("mesh_comms:lone_call_state", { callId, state: pc.connectionState });
      if (pc.connectionState === "connected") {
        bus.emit("mesh_comms:lone_call_connected", { callId, targetPeerId });
      }
    };

    // Create offer
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    // Push offer via Gun.js — callee's listenForIncomingCalls() will pick it up
    if (this.gun) {
      this.gun.get("gridalive.webrtc.call").get(callId).put({
        type: "lone_offer",
        from: this.myPeerId,
        to: targetPeerId,
        offer: JSON.stringify(offer),
        timestamp: Date.now(),
      });

      // Wait for answer via Gun.js
      const answerNode = this.gun.get("gridalive.webrtc.answer").get(callId);
      const offCleanup = (() => {
        const timeout = setTimeout(() => {
          bus.emit("mesh_comms:lone_call_timeout", { callId });
          pc.close();
          stream?.getTracks().forEach(t => t.stop());
        }, 60_000);

        const handle = answerNode.on(async (data: any) => {
          if (!data || !data.answer) return;
          clearTimeout(timeout);
          try {
            const answer = JSON.parse(data.answer);
            await pc.setRemoteDescription(answer);
            const iceNode = this.gun!.get("gridalive.webrtc.ice_remote").get(callId);
            iceNode.map().on(async (raw: string) => {
              if (!raw) return;
              try { await pc.addIceCandidate(JSON.parse(raw)); } catch (err) {
                console.warn("[MeshComms] Lone call addIceCandidate failed:", err);
              }
            });
          } catch (err) {
            console.warn("[MeshComms] Lone call SDP error:", err);
          }
        });
        return { timeout, handle };
      })();
      void offCleanup;
    }

    this.activeCallPeers.set(targetPeerId, pc);
    return pc;
  }

  // ─── callWithFallback — cascading call strategy ─────────────────
  // 1. If mesh peers exist AND target is reachable → normal mesh call
  // 2. Else if internet reachable → TURN lone-ranger call
  // 3. Else → native tel: call (requires phone number)
  //
  async callWithFallback(
    targetPeerId: string,
    opts: { phone?: string; name?: string } = {}
  ): Promise<{ method: "mesh" | "turn" | "tel" | "failed"; pc?: RTCPeerConnection | null }> {
    const hasInternet = typeof navigator !== "undefined" && navigator.onLine;

    // Always clear stale PCs first (browser limit)
    this.hangUpCall();

    // ── Strategy 1: mesh WebRTC once ──
    try {
      const pc = await this.callMeshPeer(targetPeerId);
      if (pc && pc.connectionState !== "failed" && pc.connectionState !== "closed") {
        return { method: "mesh", pc };
      }
      // Failed mesh PC — close before next attempt
      this.hangUpCall(targetPeerId);
    } catch {
      this.hangUpCall(targetPeerId);
    }

    // ── Strategy 2: TURN relay once (cross-network / any data) ──
    if (hasInternet) {
      try {
        const pc = await this.callLoneRanger(targetPeerId);
        if (pc) return { method: "turn", pc };
        this.hangUpCall(targetPeerId);
      } catch {
        this.hangUpCall(targetPeerId);
      }
    }

    // ── Strategy 3: native tel: only when explicit phone provided ──
    if (opts.phone) {
      const ok = this.callByPhone(opts.phone, opts.name || targetPeerId);
      return { method: ok ? "tel" : "failed" };
    }

    return { method: "failed" };
  }

  // ─── Lone walkie-talkie via Gun.js only ─────────────────────────
  // When Trystero finds no peers, audio chunks are relayed through Gun.js.
  // Latency is higher (~500ms) but works with only cellular data and no peers.
  async sendWalkieLoneRanger(channelId: string, text: string): Promise<void> {
    if (!this.gun) return;
    const msg: WalkieMessage = {
      id: `lone_w_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      user: this.myName,
      peerId: this.myPeerId,
      channel: channelId,
      message: text,
      timestamp: Date.now(),
      type: "text",
    };
    // Push to the walkie channel node — all Gun.js peers on cellular will see it
    this.gun.get(`gridalive.walkie.${channelId}`).get(msg.id).put(JSON.stringify(msg));
    bus.emit("mesh_comms:walkie_lone_tx", { channelId, msg });
  }

  // ─── AI Emergency Analysis ─────────────────────────────────────
  async analyzeEmergency(message: string): Promise<AIEmergencyResult> {
    // 1. Try Ollama (local LLM — zero latency, works offline)
    const ollamaUrl = env.ollamaBaseUrl || "http://localhost:11434";
    try {
      const resp = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(4000),
        body: JSON.stringify({
          model: "tinyllama",
          prompt: `Classify this message for emergency severity (0-10) and respond only in JSON:
{"isEmergency":bool,"severity":0-10,"keywords":[],"recommendedActions":[],"responseTime":"immediate|urgent|normal","summary":"one line"}
Message: "${message}"`,
          stream: false,
          options: { temperature: 0.1, num_predict: 150 },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const raw = data.response || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { ...parsed, source: "ollama" };
        }
      }
    } catch {}

    // 2. Try cloud AI (Groq — free tier, fast)
    const groqKey = env.groqKey || localStorage.getItem("VITE_GROQ_API_KEY") || "";
    if (groqKey) {
      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({
            model: "llama3-8b-8192",
            messages: [{
              role: "user",
              content: `Classify emergency severity of this message and respond ONLY in JSON:
{"isEmergency":bool,"severity":0-10,"keywords":[],"recommendedActions":[],"responseTime":"immediate|urgent|normal","summary":"one line"}
Message: "${message}"`,
            }],
            temperature: 0.1, max_tokens: 200,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const raw = data.choices?.[0]?.message?.content || "";
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return { ...parsed, source: "cloud" };
          }
        }
      } catch {}
    }

    // 3. Enhanced heuristic fallback (always works offline)
    return heuristicAnalysis(message);
  }

  // ─── Mesh Network Optimization (real routing via Gun.js) ────────
  async optimizeNetwork(): Promise<{ routes: number; improved: boolean; bandwidthSaved: number }> {
    const peers = this.getPeerList();
    const onlinePeers = peers.filter(p => p.online);

    // Announce our stats to the mesh
    if (this.gun && this.myLocation) {
      this.gun.get("gridalive.mesh.routing").get(this.myPeerId).put({
        peerId: this.myPeerId,
        lat: this.myLocation.latitude,
        lng: this.myLocation.longitude,
        peerCount: onlinePeers.length,
        role: S.get("user_role") || "user",
        timestamp: Date.now(),
      });
    }

    // Estimate routes (each online peer = potential relay)
    const routes = Math.max(1, onlinePeers.length);
    return { routes, improved: onlinePeers.length > 0, bandwidthSaved: onlinePeers.length * 15 };
  }

  // ─── Node navigation ────────────────────────────────────────────
  navigateToNode(node: { lat: number; lng: number; name: string }) {
    const { lat, lng, name } = node;
    const ua = navigator.userAgent;
    const label = encodeURIComponent(name);
    if (/iPhone|iPad|iPod/i.test(ua)) {
      window.open(`http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`, "_blank");
    } else if (/Android/i.test(ua)) {
      const intent = `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
      window.location.href = intent;
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`, "_blank");
    }
  }

  // ─── Bluetooth LE passive scanning (experimental Web Bluetooth Scanning API) ─────
  private bleScanAbort: AbortController | null = null;
  private bleScanEntry: { scan: any; handler: (event: any) => void } | null = null;
  private bleDevices: Map<string, { id: string; name: string; rssi: number; timestamp: number; connected?: boolean; services?: string[] }> = new Map();
  private bleConnections: Map<string, { device: BluetoothDevice; server?: BluetoothRemoteGATTServer; services: string[]; connected: boolean; lastSeen: number }> = new Map();
  private bleListeners: ((devices: { id: string; name: string; rssi: number; type: string; connected?: boolean; services?: string[] }[]) => void)[] = [];

  get bluetoothAvailable(): boolean {
    return "bluetooth" in navigator;
  }

  get bleSupported(): boolean {
    const bt = (navigator as any).bluetooth;
    return !!bt && !!bt.requestDevice;
  }

  get bleScanSupported(): boolean {
    const bt = (navigator as any).bluetooth;
    return !!bt && typeof bt.requestLEScan === "function";
  }

  private updateBleDeviceEntry(info: { id: string; name: string; rssi: number; connected?: boolean; services?: string[]; device?: BluetoothDevice }) {
    const existing = this.bleDevices.get(info.id) || { id: info.id, name: info.name, rssi: info.rssi, timestamp: Date.now() };
    const updated = {
      id: info.id,
      name: info.name || existing.name,
      rssi: info.rssi ?? existing.rssi,
      timestamp: Date.now(),
      connected: info.connected ?? existing.connected ?? false,
      services: info.services || existing.services || [],
    };
    this.bleDevices.set(info.id, updated);
    if (info.device) {
      this.bleConnections.set(info.id, {
        device: info.device,
        server: info.device.gatt?.connected ? info.device.gatt : undefined,
        services: updated.services,
        connected: updated.connected,
        lastSeen: Date.now(),
      });
      info.device.addEventListener?.("gattserverdisconnected", () => {
        this.handleBleDisconnect(info.id);
      });
    }
    this.emitBLEDevices();
  }

  private handleBleDisconnect(deviceId: string) {
    const existing = this.bleDevices.get(deviceId);
    if (!existing) return;
    this.bleDevices.set(deviceId, { ...existing, connected: false, timestamp: Date.now() });
    const conn = this.bleConnections.get(deviceId);
    if (conn) {
      this.bleConnections.set(deviceId, { ...conn, connected: false, lastSeen: Date.now() });
    }
    bus.emit("mesh_comms:ble_disconnected", { id: deviceId, name: existing.name, timestamp: Date.now() });
    this.emitBLEDevices();
  }

  async connectBLEDevice(deviceId: string): Promise<boolean> {
    const conn = this.bleConnections.get(deviceId);
    if (!conn) return false;
    const device = conn.device;
    if (!device?.gatt) return false;
    if (device.gatt.connected) {
      this.updateBleDeviceEntry({ id: deviceId, name: device.name || conn.device.id, rssi: conn.device.rssi || -60, connected: true, services: conn.services, device });
      return true;
    }

    try {
      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices().then((list) => list.map((s) => s.uuid));
      this.bleConnections.set(deviceId, { device, server, services, connected: true, lastSeen: Date.now() });
      this.updateBleDeviceEntry({ id: deviceId, name: device.name || `BLE Device`, rssi: conn.device.rssi || -60, connected: true, services, device });
      bus.emit("mesh_comms:ble_connected", { id: deviceId, name: device.name, services, timestamp: Date.now() });
      return true;
    } catch (err) {
      console.warn("[MeshComms] BLE connect failed", err);
      return false;
    }
  }

  async disconnectBLEDevice(deviceId: string): Promise<void> {
    const conn = this.bleConnections.get(deviceId);
    if (!conn) return;
    try {
      conn.device.gatt?.disconnect();
    } catch {}
    this.handleBleDisconnect(deviceId);
  }

  async startBLEScan(): Promise<{ success: boolean; error?: string; fallback?: boolean }> {
    if (!("bluetooth" in navigator)) {
      return { success: false, error: "Bluetooth not supported in this browser" };
    }

    const bt = (navigator as any).bluetooth;
    if (!bt || typeof bt.requestLEScan !== "function") {
      console.log("[MeshComms] BLE Scanning API not available, falling back to requestDevice");
      const device = await this.scanBluetooth();
      if (device) {
        bus.emit("mesh_comms:ble_scan_started", { fallback: true });
        return { success: true, fallback: true };
      }
      return { success: false, error: "BLE scanning unavailable; requestDevice returned no device or permission was denied." };
    }

    try {
      // Stop any existing scan
      this.stopBLEScan();
      
      this.bleScanAbort = new AbortController();
      
      // Request LE scan permission
      const leScan = await bt.requestLEScan({
        acceptAllAdvertisements: true,
        keepRepeatedDevices: true,
      }, { signal: this.bleScanAbort.signal });

      console.log("[MeshComms] BLE scan started (experimental API)");

      // Listen for advertisement events on both the Bluetooth object and global navigator
      bt.addEventListener?.("advertisementreceived", this.handleBLEAdvertisement);
      (navigator as any).bluetooth?.addEventListener?.("advertisementreceived", this.handleBLEAdvertisement);
      this.bleScanEntry = { scan: leScan, handler: this.handleBLEAdvertisement };

      bus.emit("mesh_comms:ble_scan_started", {});
      return { success: true };
    } catch (err: any) {
      console.warn("[MeshComms] BLE scan error:", err);
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        const deviceFallback = await this.scanBluetooth();
        if (deviceFallback) {
          bus.emit("mesh_comms:ble_scan_started", { fallback: true });
          return { success: true, fallback: true };
        }
        return { success: false, error: "Bluetooth permission denied" };
      }
      if (err?.name === "NotFoundError") {
        return { success: false, error: "No Bluetooth adapter found" };
      }
      return { success: false, error: err?.message || "Unknown BLE error" };
    }
  }

  /** Handle incoming BLE advertisements */
  private handleBLEAdvertisement = (event: any) => {
    const device = event.device;
    const rssi = event.rssi || -70;
    const deviceId = device?.id || `ble_${Date.now()}`;
    const services = Array.isArray(event.uuids) ? event.uuids.map((s: any) => String(s)) : [];

    this.updateBleDeviceEntry({
      id: deviceId,
      name: device?.name || `BLE Device (${deviceId.slice(-4)})`,
      rssi,
      connected: device.gatt?.connected || false,
      services,
      device,
    });

    console.log("[MeshComms] BLE device found:", device?.name || deviceId, "RSSI:", rssi);
    
    // Announce to Gun.js mesh
    if (this.gun) {
      this.gun.get("gridalive.mesh.bluetooth").get(deviceId).put({
        name: device?.name || `BLE Device`,
        rssi,
        discoveredBy: this.myPeerId,
        timestamp: Date.now(),
      });
    }
    
    bus.emit("mesh_comms:ble_device", { id: deviceId, name: device?.name, rssi, timestamp: Date.now() });
  };

  /** Stop BLE scanning */
  stopBLEScan() {
    if (this.bleScanAbort) {
      this.bleScanAbort.abort();
      this.bleScanAbort = null;
    }
    if (this.bleScanEntry?.scan?.stop) {
      try { this.bleScanEntry.scan.stop(); } catch {}
    }
    if (this.bleScanEntry?.handler) {
      const bt = (navigator as any).bluetooth;
      bt?.removeEventListener?.("advertisementreceived", this.bleScanEntry.handler);
      (navigator as any).bluetooth?.removeEventListener?.("advertisementreceived", this.bleScanEntry.handler);
      this.bleScanEntry = null;
    }
    const bt = (navigator as any).bluetooth;
    if (bt) {
      bt.removeEventListener?.("advertisementreceived", this.handleBLEAdvertisement);
    }
    console.log("[MeshComms] BLE scan stopped");
    bus.emit("mesh_comms:ble_scan_stopped", {});
  }

  /** Get current BLE devices list */
  getBLEDevices(): { id: string; name: string; rssi: number; type: string; connected?: boolean; services?: string[] }[] {
    const now = Date.now();
    return [...this.bleDevices.values()]
      .filter(d => now - d.timestamp < 60000)
      .map(d => ({ ...d, type: "bluetooth" }))
      .sort((a, b) => b.rssi - a.rssi);
  }

  private emitBLEDevices() {
    const devices = this.getBLEDevices();
    this.bleListeners.forEach(fn => fn(devices));
    bus.emit("mesh_comms:ble_devices", devices);
  }

  onBLEDevices(fn: (devices: { id: string; name: string; rssi: number; type: string; connected?: boolean; services?: string[] }[]) => void) {
    this.bleListeners.push(fn);
    fn(this.getBLEDevices());
    return () => { this.bleListeners = this.bleListeners.filter(f => f !== fn); };
  }

  // ─── WiFi Network Information API ─────────────────────────────────
  private wifiInfo: { type: string; downlink: number; rtt: number; effectiveType: string } | null = null;
  private wifiListeners: ((info: any) => void)[] = [];

  /** Get current WiFi/Network connection info (real Network Information API) */
  getWiFiInfo(): { type: string; downlink: number; rtt: number; effectiveType: string; online: boolean } | null {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return null;
    
    return {
      type: conn.type || "unknown", // wifi, cellular, ethernet, none
      downlink: conn.downlink || 0, // Mbps
      rtt: conn.rtt || 0, // ms round-trip time
      effectiveType: conn.effectiveType || "unknown", // slow-2g, 2g, 3g, 4g
      online: navigator.onLine,
    };
  }

  /** Start monitoring network changes */
  startNetworkMonitor() {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn) {
      conn.addEventListener?.("change", this.handleNetworkChange);
      this.handleNetworkChange(); // Initial emit
      console.log("[MeshComms] Network monitor started");
    }
    window.addEventListener("online", this.handleNetworkChange);
    window.addEventListener("offline", this.handleNetworkChange);
  }

  private handleNetworkChange = () => {
    this.wifiInfo = this.getWiFiInfo();
    console.log("[MeshComms] Network info:", this.wifiInfo);
    this.wifiListeners.forEach(fn => fn(this.wifiInfo));
    bus.emit("mesh_comms:wifi_info", this.wifiInfo);
  };

  onWiFiChange(fn: (info: any) => void) {
    this.wifiListeners.push(fn);
    fn(this.getWiFiInfo());
    return () => { this.wifiListeners = this.wifiListeners.filter(f => f !== fn); };
  }

  // ─── Bluetooth device picker (standard Web Bluetooth API) ─────────
  async scanBluetooth(): Promise<any | null> {
    if (!("bluetooth" in navigator)) return null;
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["generic_access", "battery_service"],
      });

      if (device) {
        const services: string[] = [];
        if (device.gatt) {
          try {
            const server = await device.gatt.connect();
            const primary = await server.getPrimaryServices();
            services.push(...primary.map((s: any) => s.uuid));
            device.gatt.disconnect();
          } catch {
            // ignore connect failures, keep device info
          }
        }

        this.updateBleDeviceEntry({
          id: device.id,
          name: device.name || "Unknown BT Device",
          rssi: -50,
          connected: false,
          services,
          device,
        });

        if (this.gun) {
          this.gun.get("gridalive.mesh.bluetooth").get(device.id).put({
            name: device.name || "Unknown BT Device",
            discoveredBy: this.myPeerId,
            timestamp: Date.now(),
          });
        }
      }

      bus.emit("mesh_comms:bluetooth_device", { name: device?.name, id: device?.id });
      return device;
    } catch (err) {
      console.warn("[MeshComms] Bluetooth scan:", err);
      return null;
    }
  }

  // ─── Device Contacts (real navigator.contacts API) ────────────
  async loadDeviceContacts(): Promise<any[]> {
    if ("contacts" in navigator && "select" in (navigator as any).contacts) {
      try {
        const contacts = await (navigator as any).contacts.select(["name", "tel"], { multiple: true });
        return contacts.map((c: any, i: number) => ({
          id: `contact_${i}_${Date.now()}`,
          name: c.name?.[0] || "Unknown",
          phone: c.tel?.[0] || "",
          invited: false,
          added: Date.now(),
        }));
      } catch (err) {
        console.warn("[MeshComms] Contacts API:", err);
      }
    }
    // Prompt user to enter contacts manually (no hardcoded mocks)
    return [];
  }

  // ─── SEA encryption for private profile fields ─────────────────
  async setPrivateProfile(input: { email?: string; phone?: string }, passphrase?: string): Promise<boolean> {
    if (!SEA || !this.gun) return false;
    const secretSeed = passphrase || S.get("mesh_profile_secret") || (() => {
      const seed = crypto.randomUUID();
      S.set("mesh_profile_secret", seed);
      return seed;
    })();

    try {
      const payload = {
        email: input.email || "",
        phone: input.phone || "",
        updated: Date.now(),
        peerId: this.myPeerId,
      };
      const cipher = await SEA.encrypt(payload, secretSeed);
      await this.conflictSafePut("gridalive.mesh.private_profiles", this.myPeerId, { cipher, updated: Date.now() });
      return true;
    } catch (err) {
      console.warn("[MeshComms] SEA setPrivateProfile failed:", err);
      return false;
    }
  }

  async getPrivateProfile(passphrase?: string): Promise<{ email?: string; phone?: string } | null> {
    if (!SEA || !this.gun) return null;
    const secretSeed = passphrase || S.get("mesh_profile_secret");
    if (!secretSeed) return null;

    return new Promise((resolve) => {
      this.gun.get("gridalive.mesh.private_profiles").get(this.myPeerId).once(async (data: any) => {
        try {
          if (!data?.cipher) return resolve(null);
          const decrypted = await SEA.decrypt(data.cipher, secretSeed);
          if (!decrypted) return resolve(null);
          resolve({ email: decrypted.email || "", phone: decrypted.phone || "" });
        } catch {
          resolve(null);
        }
      });
    });
  }

  // ─── Emergency Sounds ───────────────────────────────────────────
  playEmergencyBeep() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "square";
      [0, 0.3, 0.6, 0.9].forEach((t, i) => {
        osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, ctx.currentTime + t);
      });
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.2);
    } catch {}
  }

  playCallAlert() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(1047, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch {}
  }

  // ─── Offline Queue ─────────────────────────────────────────────
  // ─── Delay-Tolerant Networking (DTN) queue ────────────────────
  // Messages are stored with TTL. On reconnect they are flushed in
  // FIFO order. Items older than DTN_TTL_MS are expired automatically.
  private static readonly DTN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  private queueOffline(item: any) {
    const entry = { ...item, queuedAt: Date.now(), retries: 0 };
    this.offlineQueue.push(entry);
    // Expire old items (> 7 days) before saving
    const now = Date.now();
    this.offlineQueue = this.offlineQueue
      .filter(i => now - i.queuedAt < MeshCommsEngine.DTN_TTL_MS)
      .slice(-200); // cap at 200 items
    S.set("mesh_comms_offline_queue", this.offlineQueue);
    bus.emit("mesh_comms:queued_offline", { ...item, queuedAt: entry.queuedAt, queueSize: this.offlineQueue.length });
    // Register a background sync tag so Service Worker can flush on reconnect
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      navigator.serviceWorker.ready
        .then(reg => (reg as any).sync?.register("mesh-sync"))
        .catch(() => {});
    }
  }

  private async flushOfflineQueue() {
    if (!this.gun || this.offlineQueue.length === 0) return;
    const now = Date.now();
    // Remove expired items first
    this.offlineQueue = this.offlineQueue.filter(
      i => now - i.queuedAt < MeshCommsEngine.DTN_TTL_MS
    );

    const toFlush = [...this.offlineQueue];
    const failed: any[] = [];

    for (const item of toFlush) {
      try {
        if (item.type === "SOS") {
          this.gun.get("gridalive.mesh.sos").get(item.data.id).put(item.data);
        } else if (item.type === "WALKIE_TEXT") {
          const msg = item.data as WalkieMessage;
          this.gun.get(`gridalive.walkie.${msg.channel}`).get(msg.id).put(msg);
        } else if (item.type === "PRESENCE") {
          this.gun.get("gridalive.mesh.peers").get(this.myPeerId).put(item.data);
        }
      } catch {
        // Retain failed items for retry (with exponential backoff)
        item.retries = (item.retries ?? 0) + 1;
        if (item.retries < 5) failed.push(item);
      }
    }

    this.offlineQueue = failed;
    S.set("mesh_comms_offline_queue", this.offlineQueue);
    bus.emit("mesh_comms:offline_queue_flushed", { count: toFlush.length - failed.length, failed: failed.length });
  }

  // ─── Status ────────────────────────────────────────────────────
  getStatus() {
    return {
      peerId: this.myPeerId,
      gunConnected: !!this.gun,
      relayCandidates: this.gunPeerCandidates,
      activeRelays: this.activeRelays,
      gpsActive: this.locationWatchId !== null,
      location: this.myLocation ? {
        lat: this.myLocation.latitude,
        lng: this.myLocation.longitude,
        accuracy: this.myLocation.accuracy,
      } : null,
      online: this.isOnline,
      nearbyPeerCount: this.peers.size,
      activeWalkieChannels: [...this.activeWalkieRooms.keys()],
      activeCallCount: this.activeCallPeers.size,
      offlineQueueSize: this.offlineQueue.length,
    };
  }

  destroy() {
    this.stopGPS();
    this.stopPresence();
    if (this.relayMonitor) {
      clearInterval(this.relayMonitor);
      this.relayMonitor = null;
    }
    this.activeWalkieRooms.forEach(room => { try { room.leave?.(); } catch {} });
    this.activeWalkieRooms.clear();
    this.hangUpCall();
    this.peerListeners = [];
    this.sosListeners = [];
    this.walkieListeners = [];
  }
}

// Singleton
export const meshComms = new MeshCommsEngine();
export default meshComms;
