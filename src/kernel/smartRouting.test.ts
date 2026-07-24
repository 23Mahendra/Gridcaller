import test from "node:test";
import assert from "node:assert/strict";
import { scoreRouteCandidate, pickBestRoute } from "./smartRouting.ts";

test("prefers stronger gateway routes over longer ones", () => {
  const direct = { targetId: "a", nextHop: "a", via: "direct", quality: 0.9, cost: 2, hops: 1, path: ["a"], lastSeen: 1000, gateway: true };
  const relay = { targetId: "a", nextHop: "b", via: "relay", quality: 0.7, cost: 4, hops: 3, path: ["b", "a"], lastSeen: 900, gateway: false };

  const scored = pickBestRoute([relay, direct], { battery: 0.8, signal: 0.7, stability: 0.8, transportScore: 0.9 });
  assert.equal(scored?.nextHop, "a");
  assert.ok(scoreRouteCandidate(direct, { battery: 0.8, signal: 0.7, stability: 0.8, transportScore: 0.9 }) > scoreRouteCandidate(relay, { battery: 0.8, signal: 0.7, stability: 0.8, transportScore: 0.9 }));
});

test("penalizes routes with many hops even when quality is acceptable", () => {
  const shortRoute = { targetId: "b", nextHop: "c", via: "relay", quality: 0.65, cost: 3, hops: 1, path: ["c", "b"], lastSeen: 1000, gateway: false };
  const longRoute = { targetId: "b", nextHop: "d", via: "relay", quality: 0.8, cost: 3, hops: 4, path: ["d", "e", "f", "b"], lastSeen: 1000, gateway: false };

  const best = pickBestRoute([longRoute, shortRoute], { battery: 0.4, signal: 0.4, stability: 0.5, transportScore: 0.5 });
  assert.equal(best?.nextHop, "c");
});
