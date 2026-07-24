export type TrafficKind = "voice" | "message" | "data" | "video" | "control";

export type GatewayCandidate = {
  id: string;
  speed?: number;
  hops?: number;
  battery?: number;
  stability?: number;
  signal?: number;
  online?: boolean;
};

export type MeshTrafficPacket = {
  kind: TrafficKind;
  payload?: unknown;
  priority?: number;
};

export function selectBestGateway(candidates: GatewayCandidate[], preferredId?: string): GatewayCandidate | null {
  if (!candidates.length) return null;
  const onlineCandidates = candidates.filter((candidate) => candidate.online !== false);
  const preferred = preferredId
    ? onlineCandidates.find((candidate) => candidate.id === preferredId)
    : null;
  if (preferred) return preferred;
  return onlineCandidates.reduce((best, current) => {
    if (!best) return current;
    const a = scoreGateway(current);
    const b = scoreGateway(best);
    return a > b ? current : best;
  });
}

export function scoreGateway(candidate: GatewayCandidate): number {
  const speed = clamp(candidate.speed ?? 0.5, 0, 1);
  const hops = clamp(1 / Math.max(1, candidate.hops ?? 1), 0, 1);
  const battery = clamp(candidate.battery ?? 0.7, 0, 1);
  const stability = clamp(candidate.stability ?? 0.7, 0, 1);
  const signal = clamp(candidate.signal ?? 0.7, 0, 1);
  const online = candidate.online === false ? 0 : 1;
  return speed * 0.35 + hops * 0.25 + battery * 0.15 + stability * 0.15 + signal * 0.1 + online * 0.05;
}

export function getTrafficPriority(kind: TrafficKind): number {
  switch (kind) {
    case "voice":
    case "video":
      return 3;
    case "message":
    case "control":
      return 2;
    default:
      return 1;
  }
}

export function prioritizeTraffic(packet: MeshTrafficPacket) {
  const base = getTrafficPriority(packet.kind);
  return {
    ...packet,
    priority: packet.priority ?? base,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
