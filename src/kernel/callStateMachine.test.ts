import assert from "node:assert/strict";
import test from "node:test";
import { CallStateMachine, createCallId } from "./callStateMachine";

const outgoing = { type: "OUTGOING" as const, callId: "c1", callerId: "A", calleeId: "B", timestamp: 1 };
const incoming = { type: "INCOMING" as const, callId: "c1", callerId: "A", calleeId: "B", timestamp: 1 };

test("call lifecycle covers outgoing, media connection, hangup and cleanup", () => {
  const m = new CallStateMachine();
  assert.equal(m.dispatch(outgoing).state, "OUTGOING_RINGING");
  assert.equal(m.dispatch({ type: "MEDIA_CONNECTED" }).state, "CONNECTED");
  assert.equal(m.dispatch({ type: "HANGUP" }).state, "ENDED");
  assert.equal(m.dispatch({ type: "RESET" }).state, "IDLE");
});

test("incoming calls deduplicate and accept only becomes connected after media", () => {
  const m = new CallStateMachine();
  assert.equal(m.dispatch(incoming).state, "INCOMING_RINGING");
  assert.equal(m.dispatch(incoming).state, "INCOMING_RINGING");
  assert.equal(m.dispatch({ type: "ACCEPT" }).state, "CONNECTING");
  assert.equal(m.dispatch({ type: "MEDIA_CONNECTED" }).state, "CONNECTED");
});

test("decline, timeout, missed, failure and caller-visible reasons are deterministic", () => {
  const declined = new CallStateMachine();
  declined.dispatch(incoming);
  assert.deepEqual([declined.dispatch({ type: "DECLINE" }).state, declined.snapshot().reason], ["DECLINING", "declined"]);
  const missed = new CallStateMachine();
  missed.dispatch(outgoing);
  assert.deepEqual([missed.dispatch({ type: "TIMEOUT" }).state, missed.snapshot().reason], ["MISSED", "timeout"]);
  assert.equal(missed.dispatch({ type: "FAIL", reason: "media failed" }).state, "FAILED");
});

test("call IDs are stable-format and unique", () => {
  const a = createCallId("A", "B", 10, 0.1);
  const b = createCallId("A", "B", 10, 0.2);
  assert.match(a, /^gc_A_B_/);
  assert.notEqual(a, b);
});
