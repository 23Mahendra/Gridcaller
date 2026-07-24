export type MeshRouteMetric = {
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

export type MeshRouteObservation = {
  via: string;
  quality: number;
  cost?: number;
  hops?: number;
  path?: string[];
  lastSeen?: number;
  gateway?: boolean;
};

export class MeshRoutingTable {
  private localId = "local";
  private routes = new Map<string, Map<string, MeshRouteMetric>>();
  private directNeighbors = new Map<string, MeshRouteMetric>();

  setLocalId(localId: string) {
    this.localId = localId || this.localId;
  }

  observeDirectLink(targetId: string, obs: MeshRouteObservation): MeshRouteMetric | null {
    if (!targetId || targetId === this.localId) return null;
    const now = Date.now();
    const route: MeshRouteMetric = {
      targetId,
      nextHop: targetId,
      via: obs.via || "direct",
      quality: Number.isFinite(obs.quality) ? obs.quality : 0.5,
      cost: typeof obs.cost === "number" ? obs.cost : Math.max(1, (obs.hops || 1) + 1),
      hops: typeof obs.hops === "number" ? obs.hops : 1,
      path: Array.isArray(obs.path) && obs.path.length ? obs.path : [targetId],
      lastSeen: typeof obs.lastSeen === "number" ? obs.lastSeen : now,
      gateway: Boolean(obs.gateway),
    };
    this.directNeighbors.set(targetId, route);
    this.storeRoute(targetId, targetId, route);
    return route;
  }

  observeRoute(targetId: string, nextHop: string, obs: MeshRouteObservation): MeshRouteMetric | null {
    if (!targetId || !nextHop || targetId === this.localId || nextHop === this.localId) return null;
    const now = Date.now();
    const route: MeshRouteMetric = {
      targetId,
      nextHop,
      via: obs.via || nextHop,
      quality: Number.isFinite(obs.quality) ? obs.quality : 0.5,
      cost: typeof obs.cost === "number" ? obs.cost : Math.max(1, (obs.hops || 1) + 1),
      hops: typeof obs.hops === "number" ? obs.hops : 1,
      path: Array.isArray(obs.path) && obs.path.length ? obs.path : [nextHop, targetId],
      lastSeen: typeof obs.lastSeen === "number" ? obs.lastSeen : now,
      gateway: Boolean(obs.gateway),
    };
    this.storeRoute(targetId, nextHop, route);
    return route;
  }

  getBestRoute(targetId: string): MeshRouteMetric | null {
    if (!targetId) return null;
    const candidates = this.routes.get(targetId);
    if (!candidates || !candidates.size) {
      const direct = this.directNeighbors.get(targetId);
      return direct || null;
    }

    let best: MeshRouteMetric | null = null;
    for (const route of candidates.values()) {
      if (!best) {
        best = route;
        continue;
      }
      if (this.isBetterRoute(route, best)) {
        best = route;
      }
    }

    const direct = this.directNeighbors.get(targetId);
    if (direct && (!best || this.isBetterRoute(direct, best))) {
      return direct;
    }
    return best;
  }

  getBestGateway(): MeshRouteMetric | null {
    const gatewayCandidates: MeshRouteMetric[] = [];
    for (const routesForTarget of this.routes.values()) {
      for (const route of routesForTarget.values()) {
        if (route.gateway) gatewayCandidates.push(route);
      }
    }
    for (const route of this.directNeighbors.values()) {
      if (route.gateway) gatewayCandidates.push(route);
    }
    if (!gatewayCandidates.length) return null;
    return gatewayCandidates.reduce((best, current) => (this.isBetterRoute(current, best) ? current : best));
  }

  snapshot(): MeshRouteMetric[] {
    const result: MeshRouteMetric[] = [];
    for (const route of this.directNeighbors.values()) result.push(route);
    for (const routesForTarget of this.routes.values()) {
      for (const route of routesForTarget.values()) result.push(route);
    }
    return result;
  }

  private storeRoute(targetId: string, nextHop: string, route: MeshRouteMetric) {
    if (!this.routes.has(targetId)) this.routes.set(targetId, new Map());
    const bucket = this.routes.get(targetId)!;
    bucket.set(nextHop, route);
  }

  private isBetterRoute(candidate: MeshRouteMetric, current: MeshRouteMetric): boolean {
    if (candidate.cost !== current.cost) return candidate.cost < current.cost;
    if (candidate.hops !== current.hops) return candidate.hops < current.hops;
    if (candidate.quality !== current.quality) return candidate.quality > current.quality;
    return candidate.lastSeen > current.lastSeen;
  }
}

export default MeshRoutingTable;
