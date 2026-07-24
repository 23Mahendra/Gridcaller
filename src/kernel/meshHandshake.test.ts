import test from "node:test";
import assert from "node:assert/strict";
import { buildHandshakeReply, shouldSendHandshakeReply } from "./meshHandshake";

test("replies to a fresh hello after a brief silence", () => {
  const now = 1000;
  const payload = { id: "peer-1", name: "Mina", type: "AM_HELLO" };
  assert.equal(shouldSendHandshakeReply("AM_HELLO", payload, 0, now), true);
});

test("does not spam repeated replies within the cooldown window", () => {
  const now = 1000;
  const payload = { id: "peer-2", name: "Ravi", type: "AM_HELLO" };
  assert.equal(shouldSendHandshakeReply("AM_HELLO", payload, 900, now, 800), false);
});

test("builds a reply that carries the peer id and a handshake marker", () => {
  const payload = buildHandshakeReply({ id: "self", name: "You", type: "AM_HELLO" }, "peer-3");
  assert.equal(payload.replyTo, "peer-3");
  assert.equal(payload.handshake, true);
  assert.equal(payload.type, "AM_HELLO");
});
