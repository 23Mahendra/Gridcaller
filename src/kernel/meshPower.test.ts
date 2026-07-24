import test from "node:test";
import assert from "node:assert/strict";
import { selectBestGateway, getTrafficPriority } from "./meshPower.ts";

test("selects the fastest gateway with low hops and good battery", () => {
  const gateways = [
    { id: "gw-a", speed: 0.4, hops: 2, battery: 0.3, stability: 0.7, score: 0 },
    { id: "gw-b", speed: 0.9, hops: 1, battery: 0.9, stability: 0.95, score: 0 },
  ];
  const best = selectBestGateway(gateways as any);
  assert.equal(best?.id, "gw-b");
});

test("prioritizes voice traffic above messages and browsing", () => {
  assert.equal(getTrafficPriority("voice"), 3);
  assert.equal(getTrafficPriority("message"), 2);
  assert.equal(getTrafficPriority("data"), 1);
});

test("falls back to another gateway when the preferred one is offline", () => {
  const preferred = { id: "gw-a", speed: 0.3, hops: 3, battery: 0.4, stability: 0.4, signal: 0.4, online: false };
  const fallback = { id: "gw-b", speed: 0.9, hops: 1, battery: 0.9, stability: 0.95, signal: 0.95, online: true };
  const best = selectBestGateway([preferred, fallback] as any, "gw-a");
  assert.equal(best?.id, "gw-b");
});

test("avoids overloaded gateways when a lighter one is available", () => {
  const overloaded = { id: "gw-a", speed: 0.9, hops: 1, battery: 0.9, stability: 0.95, signal: 0.95, online: true, load: 0.95, capacity: 1 };
  const lighter = { id: "gw-b", speed: 0.9, hops: 1, battery: 0.9, stability: 0.95, signal: 0.95, online: true, load: 0.2, capacity: 1 };
  const best = selectBestGateway([overloaded, lighter] as any);
  assert.equal(best?.id, "gw-b");
});
