import { assert } from "node:assert/strict";
import { createPendingDmEntry, shouldRetryPendingDm } from "./meshCommsReliability";
import { createPendingEnvelopeEntry, shouldRetryPendingEnvelopeEntry } from "./meshReliability";

const pending = createPendingDmEntry({
  id: "dm-1",
  to: "peer-1",
  text: "Hello",
  createdAt: 1000,
});

assert.equal(pending.attempts, 1);
assert.equal(pending.status, "pending");
assert.equal(shouldRetryPendingDm(pending, 2000), true);
assert.equal(shouldRetryPendingDm({ ...pending, attempts: 6 }, 5000), false);

const envelope = createPendingEnvelopeEntry({
  id: "env-1",
  kind: "softtower:msg",
  payload: { text: "hi" },
  createdAt: 1000,
  target: "peer-1",
});

assert.equal(envelope.attempts, 1);
assert.equal(envelope.status, "pending");
assert.equal(shouldRetryPendingEnvelopeEntry(envelope, 2000), true);
assert.equal(shouldRetryPendingEnvelopeEntry({ ...envelope, attempts: 6 }, 5000), false);

console.log("meshCommsReliability tests passed");
