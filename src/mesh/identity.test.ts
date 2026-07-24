import test from "node:test";
import assert from "node:assert/strict";
import { deriveStableMeshHandle } from "./identity.ts";

test("deriveStableMeshHandle prefers the phone number when present", () => {
  const handle = deriveStableMeshHandle({ phone: "+91 7090 276441", imei: "359123456789012", peerId: "mesh_a7376a2d" });
  assert.equal(handle, "7090276441");
});

test("deriveStableMeshHandle falls back to IMEI digits when phone is missing", () => {
  const handle = deriveStableMeshHandle({ imei: "359123456789012", peerId: "mesh_a7376a2d" });
  assert.equal(handle, "123456789012");
});

test("deriveStableMeshHandle uses a stable numeric fallback when no phone or IMEI is present", () => {
  const handle = deriveStableMeshHandle({ peerId: "mesh_a7376a2d" });
  assert.match(handle, /^\d{10}$/);
});
