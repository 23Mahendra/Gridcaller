import test from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_OUTBOUND_MAX_AGE_MS,
  shouldRetryPendingOutboundMessage,
  type PendingOutboundMessage,
} from "./meshReliability";

function outbound(overrides: Partial<PendingOutboundMessage> = {}): PendingOutboundMessage {
  return {
    id: "msg-1",
    type: "PING",
    payload: { ok: true },
    createdAt: 1000,
    attempts: 1,
    status: "pending",
    ...overrides,
  };
}

test("pending outbound messages keep retrying while still fresh", () => {
  const entry = outbound({
    attempts: 8,
    createdAt: 1000,
    lastAttemptAt: 15000,
  });

  assert.equal(shouldRetryPendingOutboundMessage(entry, 32000), true);
});

test("pending outbound messages stop retrying after the max age", () => {
  const entry = outbound({
    attempts: 40,
    createdAt: 1000,
    lastAttemptAt: 590000,
  });

  assert.equal(shouldRetryPendingOutboundMessage(entry, 1000 + PENDING_OUTBOUND_MAX_AGE_MS + 1), false);
});
