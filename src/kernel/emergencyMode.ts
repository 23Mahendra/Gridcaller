import { bus } from "./bus.ts";
import { S } from "./storage.ts";

export type EmergencyModeSummary = {
  title: string;
  subtitle: string;
  badges: string[];
  guidance: string[];
};

export type DisasterModeState = {
  active: boolean;
  broadcastMode: boolean;
  lowBandwidth: boolean;
  beaconing: boolean;
  queueDepth: number;
  lastBeaconAt?: number;
  lastBroadcastAt?: number;
};

type QueueItem = {
  id: string;
  text: string;
  createdAt: number;
  emergency: boolean;
  urgency: "normal" | "critical";
  lowBandwidth: boolean;
  location?: { lat: number; lng: number } | null;
};

const STORAGE_KEY = "gridcaller_disaster_queue";
let beaconTimer: ReturnType<typeof setInterval> | null = null;

function readLastLocation() {
  const loc = S.get("gridcaller_last_location", null);
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
  return { lat: loc.lat, lng: loc.lng } as { lat: number; lng: number };
}

function ensureBeaconLoop() {
  const active = S.get("gridcaller_disaster_active", false) === true;
  const enabled = S.get("gridcaller_disaster_beaconing", true) === true;
  if (!active || !enabled) {
    if (beaconTimer) {
      clearInterval(beaconTimer);
      beaconTimer = null;
    }
    return;
  }
  if (beaconTimer) return;
  beaconTimer = setInterval(() => {
    if (S.get("gridcaller_disaster_active", false) !== true) return;
    if (S.get("gridcaller_disaster_beaconing", true) !== true) return;
    sendSosBeacon(readLastLocation());
  }, 60000);
}

export function getEmergencyModeSummary(input: {
  localOnly?: boolean;
  privacyOn?: boolean;
  bridgeReady?: boolean;
  radioOn?: boolean;
  disasterActive?: boolean;
}): EmergencyModeSummary {
  const localOnly = input.localOnly ?? false;
  const privacyOn = input.privacyOn ?? false;
  const bridgeReady = input.bridgeReady ?? false;
  const radioOn = input.radioOn ?? false;
  const disasterActive = input.disasterActive ?? false;

  const badges: string[] = [];
  if (privacyOn) badges.push("Privacy");
  if (bridgeReady) badges.push("Bridge live");
  if (radioOn) badges.push("Free radio");
  if (disasterActive) badges.push("Disaster mode");

  const title = disasterActive ? "Disaster mode" : localOnly ? "Local relay" : "Mesh ready";
  const subtitle = disasterActive
    ? "Emergency broadcast, store-and-forward, SOS beacons, and low-bandwidth relay are active."
    : localOnly
      ? "Offline-first relay and privacy controls stay active for local emergencies."
      : "Relay, gateway, and radio features are available for short-range coordination.";

  if (!badges.length) {
    badges.push(localOnly ? "Offline-first" : "Ready");
  }

  const guidance = [
    "Emergency traffic uses maximum redundancy and staggered retries.",
    "Store-and-forward keeps critical texts until a peer appears.",
    "Low bandwidth mode prefers short text and voice notes when links are weak.",
    "Preinstall the app and share the APK before a disaster so it works even when stores are down.",
  ];

  return { title, subtitle, badges, guidance };
}

export function getDisasterModeState(): DisasterModeState {
  const active = S.get("gridcaller_disaster_active", false) === true;
  const lowBandwidth = S.get("gridcaller_disaster_low_bandwidth", false) === true;
  const broadcastMode = S.get("gridcaller_disaster_broadcast_mode", false) === true;
  const beaconing = S.get("gridcaller_disaster_beaconing", true) === true;
  const queue = getDisasterQueue();
  return {
    active,
    broadcastMode,
    lowBandwidth,
    beaconing,
    queueDepth: queue.length,
    lastBeaconAt: S.get("gridcaller_disaster_last_beacon", undefined),
    lastBroadcastAt: S.get("gridcaller_disaster_last_broadcast", undefined),
  };
}

export function setDisasterMode(active: boolean) {
  S.set("gridcaller_disaster_active", active);
  if (!active) {
    S.set("gridcaller_disaster_broadcast_mode", false);
    S.set("gridcaller_disaster_low_bandwidth", false);
  }
  ensureBeaconLoop();
  bus.emit("disaster:mode", { active });
  return getDisasterModeState();
}

export function toggleDisasterBroadcast() {
  const next = !(S.get("gridcaller_disaster_broadcast_mode", false) === true);
  S.set("gridcaller_disaster_broadcast_mode", next);
  bus.emit("disaster:broadcast", { active: next });
  return next;
}

export function toggleLowBandwidthMode() {
  const next = !(S.get("gridcaller_disaster_low_bandwidth", false) === true);
  S.set("gridcaller_disaster_low_bandwidth", next);
  bus.emit("disaster:low-bandwidth", { active: next });
  return next;
}

export function toggleDisasterBeaconing() {
  const next = !(S.get("gridcaller_disaster_beaconing", true) === true);
  S.set("gridcaller_disaster_beaconing", next);
  ensureBeaconLoop();
  bus.emit("disaster:beacon", { active: next });
  return next;
}

export function queueDisasterMessage(input: {
  text: string;
  emergency?: boolean;
  urgency?: "normal" | "critical";
  lowBandwidth?: boolean;
  location?: { lat: number; lng: number } | null;
}) {
  const safeText = String(input.text || "").trim();
  if (!safeText) return null;
  const item: QueueItem = {
    id: `queue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    text: safeText,
    createdAt: Date.now(),
    emergency: Boolean(input.emergency),
    urgency: input.urgency === "critical" ? "critical" : "normal",
    lowBandwidth: Boolean(input.lowBandwidth),
    location: input.location || undefined,
  };
  const queue = getDisasterQueue();
  queue.push(item);
  S.set(STORAGE_KEY, queue);
  bus.emit("disaster:queued", { item });
  return item;
}

export function getDisasterQueue(): QueueItem[] {
  const raw = S.get(STORAGE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export function drainDisasterQueue() {
  const queue = getDisasterQueue();
  if (!queue.length) return [];
  const drained = queue.slice();
  S.set(STORAGE_KEY, []);
  bus.emit("disaster:drained", { items: drained });
  return drained;
}

export function sendEmergencyBroadcast(text: string, location?: { lat: number; lng: number } | null) {
  const active = S.get("gridcaller_disaster_active", false) === true;
  const lowBandwidth = S.get("gridcaller_disaster_low_bandwidth", false) === true;
  const item = queueDisasterMessage({
    text,
    emergency: true,
    urgency: "critical",
    lowBandwidth,
    location,
  });
  if (!item) return null;
  const payload = {
    text: item.text,
    emergency: true,
    urgency: "critical",
    lowBandwidth,
    location: location || readLastLocation(),
    broadcast: true,
  };
  S.set("gridcaller_disaster_last_broadcast", Date.now());
  bus.emit("disaster:broadcast-send", payload);

  if (active) {
    const msg = String(item.text || "").trim();
    void import("./softTowerHopNet.ts")
      .then(({ default: softTowerHop }) => {
        softTowerHop.sendMessage("", msg, "All reachable devices", {
          emergency: true,
          urgency: "critical",
          lowBandwidth,
          kind: "broadcast",
          location,
        });
      })
      .catch(() => {});
  }
  return item;
}

export function sendSosBeacon(location?: { lat: number; lng: number } | null) {
  if (S.get("gridcaller_disaster_active", false) !== true) return null;
  const beaconText = `SOS ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const item = queueDisasterMessage({
    text: beaconText,
    emergency: true,
    urgency: "critical",
    lowBandwidth: true,
    location: location || readLastLocation(),
  });
  if (!item) return null;
  S.set("gridcaller_disaster_last_beacon", Date.now());
  void import("./softTowerHopNet.ts")
    .then(({ default: softTowerHop }) => {
      softTowerHop.sendMessage("", beaconText, "SOS beacon", {
        emergency: true,
        urgency: "critical",
        lowBandwidth: true,
        kind: "sos",
        location: location || readLastLocation(),
      });
    })
    .catch(() => {});
  return item;
}

export function setDisasterBeaconing(active: boolean) {
  S.set("gridcaller_disaster_beaconing", active);
  return active;
}

export function handleIncomingDisasterPacket(packet: { text?: string; emergency?: boolean; disaster?: any; resilience?: any }) {
  const text = String(packet.text || "").trim();
  if (!text) return null;
  const queueItem = queueDisasterMessage({
    text,
    emergency: Boolean(packet.emergency || packet.disaster),
    urgency: packet.resilience?.urgency === "critical" ? "critical" : "normal",
    lowBandwidth: Boolean(packet.resilience?.lowBandwidth),
  });
  return queueItem;
}

export function maybeFlushDisasterQueue() {
  const queue = getDisasterQueue();
  if (!queue.length) return [];
  const drained = drainDisasterQueue();
  return drained;
}
