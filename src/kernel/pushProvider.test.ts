import assert from "node:assert/strict";
import test from "node:test";
import { UnavailablePushProvider } from "./pushProvider";

test("unconfigured push provider is explicitly unavailable and never fabricates delivery", async () => {
  const provider = new UnavailablePushProvider();
  assert.equal(await provider.isAvailable(), false);
  assert.equal((await provider.sendCallInvite({ callId: "c", callerId: "A", calleeId: "B", callerName: "A", timestamp: 1, callType: "voice" })).accepted, false);
  assert.equal((await provider.registerDevice("B", "token", "secret")).accepted, false);
  assert.equal((await provider.unregisterDevice("B", "secret")).accepted, false);
});
