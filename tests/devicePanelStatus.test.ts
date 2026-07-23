import test from "node:test";
import assert from "node:assert/strict";
import { getDevicePanelStatus } from "../src/kernel/devicePanelStatus.ts";

test("getDevicePanelStatus summarizes live device state", () => {
  const status = getDevicePanelStatus({
    onlineCount: 3,
    totalCount: 5,
    strengthScore: 84,
    hubConnected: true,
    wifiSaved: 2,
    btLinked: 1,
  });

  assert.match(status.summary, /3 online/i);
  assert.match(status.summary, /5 total/i);
  assert.match(status.summary, /84\/100/i);
  assert.match(status.summary, /mesh hub online/i);
  assert.match(status.summary, /2 saved wifi/i);
  assert.match(status.summary, /1 bluetooth/i);
});
