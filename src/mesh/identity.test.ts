import test from "node:test";
import assert from "node:assert/strict";
import { deriveStableMeshHandle } from "./identity";

test("deriveStableMeshHandle is stable for the same identity seed", () => {
  const first = deriveStableMeshHandle({ phone: "917090276441", imei: "359123456789012", peerId: "mesh_a7376a2d" });
  const second = deriveStableMeshHandle({ phone: "917090276441", imei: "359123456789012", peerId: "mesh_a7376a2d" });
  assert.equal(first, second);
  assert.match(first, /^mesh-[a-z0-9]+$/);
});

test("deriveStableMeshHandle differs when IMEI changes", () => {
  const a = deriveStableMeshHandle({ phone: "917090276441", imei: "359123456789012", peerId: "mesh_a7376a2d" });
  const b = deriveStableMeshHandle({ phone: "917090276441", imei: "359123456789013", peerId: "mesh_a7376a2d" });
  assert.notEqual(a, b);
});

test("deriveStableMeshHandle falls back to phone and peer id when IMEI is missing", () => {
  const handle = deriveStableMeshHandle({ phone: "917090276441", peerId: "mesh_a7376a2d" });
  assert.match(handle, /^mesh-[a-z0-9]+$/);
  assert.ok(handle.length >= 10);
});
