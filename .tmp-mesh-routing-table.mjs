export class MeshRoutingTable {
    localId = "local";
    routes = new Map();
    directNeighbors = new Map();
    setLocalId(localId) {
        this.localId = localId || this.localId;
    }
    observeDirectLink(targetId, obs) {
        if (!targetId || targetId === this.localId)
            return null;
        const now = Date.now();
        const route = {
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
    observeRoute(targetId, nextHop, obs) {
        if (!targetId || !nextHop || targetId === this.localId || nextHop === this.localId)
            return null;
        const now = Date.now();
        const route = {
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
    getBestRoute(targetId) {
        if (!targetId)
            return null;
        const candidates = this.routes.get(targetId);
        if (!candidates || !candidates.size) {
            const direct = this.directNeighbors.get(targetId);
            return direct || null;
        }
        let best = null;
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
    getBestGateway() {
        const gatewayCandidates = [];
        for (const routesForTarget of this.routes.values()) {
            for (const route of routesForTarget.values()) {
                if (route.gateway)
                    gatewayCandidates.push(route);
            }
        }
        for (const route of this.directNeighbors.values()) {
            if (route.gateway)
                gatewayCandidates.push(route);
        }
        if (!gatewayCandidates.length)
            return null;
        return gatewayCandidates.reduce((best, current) => (this.isBetterRoute(current, best) ? current : best));
    }
    snapshot() {
        const result = [];
        for (const route of this.directNeighbors.values())
            result.push(route);
        for (const routesForTarget of this.routes.values()) {
            for (const route of routesForTarget.values())
                result.push(route);
        }
        return result;
    }
    storeRoute(targetId, nextHop, route) {
        if (!this.routes.has(targetId))
            this.routes.set(targetId, new Map());
        const bucket = this.routes.get(targetId);
        bucket.set(nextHop, route);
    }
    isBetterRoute(candidate, current) {
        if (candidate.cost !== current.cost)
            return candidate.cost < current.cost;
        if (candidate.hops !== current.hops)
            return candidate.hops < current.hops;
        if (candidate.quality !== current.quality)
            return candidate.quality > current.quality;
        return candidate.lastSeen > current.lastSeen;
    }
}
export default MeshRoutingTable;
