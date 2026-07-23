import test from "node:test";
import assert from "node:assert/strict";
import { tryBeginPeerConnection, endPeerConnection, getPeerConnectionBudgetState } from "./networkGuard.ts";

test("peer-connection budget stops creating new connections after the cap", () => {
  const start = getPeerConnectionBudgetState();
  assert.equal(start.active, 0);

  const first = tryBeginPeerConnection();
  const second = tryBeginPeerConnection();
  const third = tryBeginPeerConnection();
  const fourth = tryBeginPeerConnection();

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(third, true);
  assert.equal(fourth, false);

  const state = getPeerConnectionBudgetState();
  assert.equal(state.active, 3);
  assert.equal(state.available, 0);

  endPeerConnection();
  const afterRelease = getPeerConnectionBudgetState();
  assert.equal(afterRelease.active, 2);
  assert.equal(afterRelease.available, 1);
});
