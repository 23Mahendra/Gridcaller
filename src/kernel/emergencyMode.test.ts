import test from "node:test";
import assert from "node:assert/strict";
import { getEmergencyModeSummary } from "./emergencyMode.ts";

test("builds a compact emergency mode summary from the current mesh state", () => {
  const summary = getEmergencyModeSummary({
    localOnly: true,
    privacyOn: true,
    bridgeReady: true,
    radioOn: true,
  });

  assert.equal(summary.title, "Local relay");
  assert.equal(summary.badges.includes("Privacy"), true);
  assert.equal(summary.badges.includes("Bridge live"), true);
  assert.equal(summary.badges.includes("Free radio"), true);
  assert.match(summary.subtitle, /offline|local/i);
});
