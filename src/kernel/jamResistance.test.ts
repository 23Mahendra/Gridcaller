import test from "node:test";
import assert from "node:assert/strict";
import { buildAdaptiveRelayPlan, buildChannelSpread } from "./jamResistance.ts";

test("builds a spread of channels so a single jammer cannot block everything", () => {
  const channels = buildChannelSpread("rescue", "secret", 4);
  assert.ok(channels.some((channel) => channel.startsWith("rescue")));
  assert.equal(channels.length, 4);
  assert.ok(channels.every((channel) => typeof channel === "string" && channel.length > 0));
});

test("builds deterministic multi-path relay copies to avoid single-path jams", () => {
  const plan = buildAdaptiveRelayPlan({ id: "pkt-1", hops: 1, ttl: 8 }, ["wifi-lan", "fabric-bc", "bc-tab"], {
    copies: 4,
    seed: "rescue-node",
  });
  assert.equal(plan.length, 4);
  assert.ok(plan.every((copy) => copy.delayMs >= 0));
  assert.ok(plan[1].delayMs >= plan[0].delayMs);
  assert.ok(plan.every((copy) => copy.transportOrder.length > 0));
});

test("adds more redundancy when interference is high and link quality is weak", () => {
  const plan = buildAdaptiveRelayPlan({ id: "pkt-2", hops: 2, ttl: 10 }, ["wifi-lan", "fabric-bc", "bc-tab"], {
    copies: 3,
    seed: "rescue-node-2",
    interferenceScore: 0.9,
    linkQuality: 0.35,
    urgency: "critical",
  });

  assert.ok(plan.length >= 5);
  assert.ok(plan[0].delayMs >= 0);
  assert.ok(plan[plan.length - 1].delayMs >= plan[0].delayMs);
  assert.ok(plan.some((copy) => copy.channel.includes("jam-")));
});
