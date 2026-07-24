import test from "node:test";
import assert from "node:assert/strict";
import { SoftTowerHopNet } from "./softTowerHopNet.ts";
import { createRuntimeDiagnosticsState, updateNativeBridgeDiagnostics } from "./softTowerDiagnostics.ts";

test("runtime diagnostics track peer sightings and relay activity", () => {
  const hop = new SoftTowerHopNet();
  const before = hop.getRuntimeDiagnostics();
  assert.equal(before.peerSightings, 0);

  (hop as any).touchPeer("peer-1", "Test peer", 2, "wifi-lan", {});
  (hop as any).relay(
    {
      id: "pkt-1",
      kind: "msg",
      from: "peer-1",
      fromName: "Test peer",
      to: "peer-2",
      hops: 1,
      ttl: 8,
      path: ["peer-1"],
      transportsTried: [],
      ts: Date.now(),
      payload: { text: "hello" },
    },
    "wifi-lan"
  );

  const after = hop.getRuntimeDiagnostics();
  assert.equal(after.peerSightings, 1);
  assert.equal(after.relayEvents, 1);
  assert.equal(after.peerCount, 1);
  assert.ok(after.lastPeerSeenAt! > 0);
  assert.ok(after.lastRelayAt! > 0);
});

test("native bridge diagnostics expose explicit unavailable state", () => {
  const state = createRuntimeDiagnosticsState();
  updateNativeBridgeDiagnostics(state, "unavailable", "native plugin missing");

  assert.equal(state.nativeBridgeStatus, "unavailable");
  assert.equal(state.nativeBridgeDetail, "native plugin missing");
});
