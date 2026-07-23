import test from "node:test";
import assert from "node:assert/strict";
import { deriveLifecycleState } from "../src/kernel/appLifecycle.ts";

test("deriveLifecycleState keeps mesh activity alive while hidden with an active or incoming call", () => {
  const state = deriveLifecycleState({
    visible: false,
    activeCall: true,
    incomingCall: true,
    outgoingCall: false,
  });

  assert.equal(state.mode, "background");
  assert.equal(state.shouldReconnect, true);
  assert.equal(state.shouldRing, true);
  assert.equal(state.heartbeatMs, 5000);
});

test("deriveLifecycleState stays quiet for visible idle sessions", () => {
  const state = deriveLifecycleState({
    visible: true,
    activeCall: false,
    incomingCall: false,
    outgoingCall: false,
  });

  assert.equal(state.mode, "active");
  assert.equal(state.shouldReconnect, false);
  assert.equal(state.shouldRing, false);
  assert.equal(state.heartbeatMs, 0);
});
