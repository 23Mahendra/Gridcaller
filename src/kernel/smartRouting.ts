export type RouteContext = {
  battery?: number;
  signal?: number;
  stability?: number;
  transportScore?: number;
  hopPenalty?: number;
};

export type SmartRouteCandidate = {
  targetId: string;
  nextHop: string;
  via: string;
  quality: number;
  cost: number;
  hops: number;
  path: string[];
  lastSeen: number;
  gateway?: boolean;
};

export function scoreRouteCandidate(candidate: SmartRouteCandidate, context: RouteContext = {}): number {
  const battery = clamp(context.battery ?? 0.7, 0, 1);
  const signal = clamp(context.signal ?? 0.7, 0, 1);
  const stability = clamp(context.stability ?? 0.7, 0, 1);
  const transport = clamp(context.transportScore ?? 0.7, 0, 1);
  const hopPenalty = clamp(context.hopPenalty ?? 0.18, 0, 0.5);

  const gatewayBonus = candidate.gateway ? 0.2 : 0;
  const qualityScore = clamp(candidate.quality ?? 0.5, 0, 1) * 0.5;
  const costScore = Math.max(0, 1 - (candidate.cost - 1) * 0.08) * 0.2;
  const hopScore = Math.max(0, 1 - (candidate.hops || 0) * hopPenalty) * 0.2;
  const freshnessScore = Math.max(0, 1 - Math.max(0, Date.now() - (candidate.lastSeen || Date.now())) / 90000) * 0.1;
  const contextScore = (battery * 0.15 + signal * 0.15 + stability * 0.15 + transport * 0.15 + gatewayBonus) * 1;

  return qualityScore + costScore + hopScore + freshnessScore + contextScore;
}

export function pickBestRoute(candidates: SmartRouteCandidate[], context: RouteContext = {}): SmartRouteCandidate | null {
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => {
    if (!best) return candidate;
    return scoreRouteCandidate(candidate, context) > scoreRouteCandidate(best, context) ? candidate : best;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
