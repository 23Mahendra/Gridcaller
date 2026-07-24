import test from "node:test";
import assert from "node:assert/strict";
import { resolveTowerRelayPolicy } from "../src/kernel/towerRelayPolicy.ts";

test("resolveTowerRelayPolicy defaults to aggressive local relay mode", () => {
  const policy = resolveTowerRelayPolicy({
    get: () => null,
    set: () => {},
  } as any);

  assert.equal(policy.enabled, true);
  assert.equal(policy.aggressive, true);
  assert.equal(policy.localOnly, true);
  assert.equal(policy.beaconMs, 2500);
  assert.equal(policy.maxTtl, 16);
});
