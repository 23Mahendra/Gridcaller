import test from "node:test";
import assert from "node:assert/strict";
import {
  appendRecentEvent,
  createRuntimeDiagnosticsState,
  loadPersistedRuntimeDiagnostics,
  persistRuntimeDiagnostics,
  recordHandshake,
  recordPeerSighting,
  recordProbe,
  recordProbeReceipt,
  recordRelay,
  recordSelfTestResult,
  syncPeerCount,
} from "./softTowerDiagnostics.ts";

test("runtime diagnostics aggregate peer sightings and relay activity", () => {
  const state = createRuntimeDiagnosticsState();
  recordPeerSighting(state);
  recordRelay(state);
  syncPeerCount(state, 1);

  assert.equal(state.peerSightings, 1);
  assert.equal(state.relayEvents, 1);
  assert.equal(state.peerCount, 1);
  assert.ok(state.lastPeerSeenAt > 0);
  assert.ok(state.lastRelayAt > 0);
});

test("relay probes track both send and receipt", () => {
  const state = createRuntimeDiagnosticsState();
  recordProbe(state);
  recordProbeReceipt(state);

  assert.equal(state.probeCount, 1);
  assert.equal(state.probeReceipts, 1);
  assert.ok(state.lastProbeAt > 0);
  assert.ok(state.lastProbeReceiptAt > 0);
});

test("handshake evidence keeps the latest peer and timestamp", () => {
  const state = createRuntimeDiagnosticsState();
  recordHandshake(state, "peer-7", "Mina");

  assert.equal(state.handshakeEvents, 1);
  assert.equal(state.lastHandshakePeerId, "peer-7");
  assert.equal(state.lastHandshakePeerName, "Mina");
  assert.ok(state.lastHandshakeAt > 0);
});

test("recent events keep a compact timeline", () => {
  const state = createRuntimeDiagnosticsState();
  appendRecentEvent(state, { kind: "peer", at: 1, peerId: "peer-a", detail: "sighted" });
  appendRecentEvent(state, { kind: "relay", at: 2, peerId: "peer-b", detail: "relayed" });

  assert.equal(state.recentEvents.length, 2);
  assert.equal(state.recentEvents[0].kind, "relay");
  assert.equal(state.recentEvents[1].kind, "peer");
});

test("peer and relay sightings record richer evidence", () => {
  const state = createRuntimeDiagnosticsState();
  recordPeerSighting(state, "peer-1", "Mina", "sighted via bc-tab");
  recordRelay(state, "peer-2", "Rafi", "forwarded 2 hops");

  assert.equal(state.recentEvents.length, 2);
  assert.equal(state.recentEvents[0].peerId, "peer-2");
  assert.equal(state.recentEvents[0].peerName, "Rafi");
  assert.equal(state.recentEvents[0].detail, "forwarded 2 hops");
  assert.equal(state.recentEvents[1].peerId, "peer-1");
  assert.equal(state.recentEvents[1].detail, "sighted via bc-tab");
});

test("persists route history and self-test state", () => {
  const state = createRuntimeDiagnosticsState();
  recordPeerSighting(state, "peer-9", "Nia", "sighted via wifi-lan", "wifi-lan", 1, ["peer-9"]);
  recordHandshake(state, "peer-9", "Nia");
  recordSelfTestResult(state, "pass", "probe and echo ok");
  persistRuntimeDiagnostics(state);

  const restored = loadPersistedRuntimeDiagnostics();
  const route = restored.peerRoutes["peer-9"];

  assert.ok(route);
  assert.equal(route?.handshakeState, "handshaken");
  assert.equal(route?.lastTransport, "wifi-lan");
  assert.equal(restored.lastSelfTestStatus, "pass");
  assert.equal(restored.lastSelfTestDetail, "probe and echo ok");
});
