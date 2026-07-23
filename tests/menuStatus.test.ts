import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBridgeStatus } from "../src/kernel/menuStatus.ts";

test("normalizeBridgeStatus preserves successful bridge state and degrades safely", () => {
  const live = normalizeBridgeStatus({ ok: true, message: "Connected" });
  assert.equal(live.ready, true);
  assert.equal(live.text, "GitHub bridge ready");
  assert.equal(live.detail, "Connected");

  const fallback = normalizeBridgeStatus(null);
  assert.equal(fallback.ready, false);
  assert.match(fallback.text, /Bridge/i);
  assert.match(fallback.detail, /hub/i);
});
