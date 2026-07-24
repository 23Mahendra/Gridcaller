export type JamRelayCopy = {
  id: string;
  delayMs: number;
  channel: string;
  transport: string;
  transportOrder: string[];
};

export type JamPlanOptions = {
  copies?: number;
  seed?: string;
  interferenceScore?: number;
  linkQuality?: number;
  urgency?: "normal" | "critical";
  batteryBudget?: number;
};

export function buildChannelSpread(baseChannel: string, secret: string, count = 4): string[] {
  const channels = new Set<string>();
  const safeBase = (baseChannel || "gridcaller").trim().slice(0, 24);
  const safeSecret = (secret || "free").trim().slice(0, 12);
  const variants = Math.max(2, Math.min(8, count));
  while (channels.size < variants) {
    const suffix = channels.size.toString(16);
    channels.add(`${safeBase === "rescue" ? "rescue" : "jam"}-${safeBase}-${safeSecret}-${suffix}`);
  }
  return [...channels];
}

export function buildRelaySchedule(packet: { id: string; hops: number; ttl: number }, options?: { copies?: number }) {
  const copies = Math.max(1, Math.min(8, options?.copies ?? 3));
  const baseDelay = Math.max(30, 120 - packet.hops * 20);
  return Array.from({ length: copies }, (_, index) => ({
    id: `${packet.id}:copy:${index + 1}`,
    delayMs: baseDelay + index * 65 + (packet.ttl % 3) * 10,
    channel: `jam-${index + 1}`,
    transport: `relay-${index + 1}`,
    transportOrder: [],
  }));
}

export function buildAdaptiveRelayPlan(
  packet: { id: string; hops: number; ttl: number },
  transports: string[],
  options?: JamPlanOptions
): JamRelayCopy[] {
  const interference = clamp(options?.interferenceScore ?? 0.2, 0, 1);
  const linkQuality = clamp(options?.linkQuality ?? 0.8, 0, 1);
  const urgency = options?.urgency ?? "normal";
  const batteryBudget = clamp(options?.batteryBudget ?? 0.9, 0.2, 1);

  let copies = Math.max(1, Math.min(8, options?.copies ?? 4));
  if (urgency === "critical") copies += 1;
  if (interference > 0.75) copies += 1;
  if (linkQuality < 0.45) copies += 1;
  if (batteryBudget < 0.4) copies = Math.max(2, copies - 1);
  copies = Math.max(1, Math.min(8, copies));

  const seed = options?.seed || `${packet.id}:${packet.hops}:${packet.ttl}`;
  const baseDelay = Math.max(20, 140 - packet.hops * 16 - (urgency === "critical" ? 20 : 0));
  const channelSpread = buildChannelSpread(packet.id, seed, Math.max(2, Math.min(8, copies)));
  const uniqueTransports = (transports || []).filter(Boolean);
  const plan: JamRelayCopy[] = [];

  for (let index = 0; index < copies; index++) {
    const order = buildTransportPermutation(uniqueTransports, seed, index);
    const jitter = hashString(`${seed}:${index}`) % 35;
    const stagger = urgency === "critical" ? index * 90 : index * 55;
    const qualityPenalty = Math.round((1 - linkQuality) * 55);
    const interferencePenalty = Math.round(interference * 45);
    const delay = baseDelay + stagger + jitter + qualityPenalty + interferencePenalty;
    plan.push({
      id: `${packet.id}:copy:${index + 1}`,
      delayMs: delay,
      channel: channelSpread[index % channelSpread.length],
      transport: order[0] || `relay-${index + 1}`,
      transportOrder: order,
    });
  }

  if (urgency === "critical") {
    plan.sort((a, b) => a.delayMs - b.delayMs);
  }

  return plan;
}

function buildTransportPermutation(transports: string[], seed: string, index: number): string[] {
  if (!transports.length) return [];
  const order = [...transports];
  const salt = hashString(`${seed}:${index}`);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.abs(salt + i) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
