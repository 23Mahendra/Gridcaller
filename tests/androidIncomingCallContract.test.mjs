import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const servicePath = "android/app/src/main/java/app/gridalive/gridcaller/MeshForegroundService.java";
const receiverPath = "android/app/src/main/java/app/gridalive/gridcaller/CallNotificationReceiver.java";
const manifestPath = "android/app/src/main/AndroidManifest.xml";

test("Android incoming-call notification has Accept, Decline, timeout and duplicate prevention", async () => {
  const [service, receiver, manifest] = await Promise.all([
    readFile(servicePath, "utf8"), readFile(receiverPath, "utf8"), readFile(manifestPath, "utf8"),
  ]);
  assert.match(service, /addAction\([^\n]+"ACCEPT"/);
  assert.match(service, /addAction\([^\n]+"DECLINE"/);
  assert.match(service, /scheduleMissedAlarm/);
  assert.match(service, /callId\.equals\(existing\.getString\("call_id"/);
  assert.match(receiver, /ACTION_ACCEPT/);
  assert.match(receiver, /ACTION_DECLINE/);
  assert.match(receiver, /ACTION_TIMEOUT/);
  assert.match(manifest, /\.CallNotificationReceiver/);
});

test("Android call alerts respect system interruption policy", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /USAGE_NOTIFICATION_RINGTONE/);
  assert.match(service, /setBypassDnd\(false\)/);
  assert.doesNotMatch(service, /setBypassDnd\(true\)/);
  assert.doesNotMatch(service, /VibrationEffect\.createWaveform/);
  assert.match(service, /canUseFullScreenIntent/);
});

test("Android persists background call state and synchronizes notification actions", async () => {
  const service = await readFile(servicePath, "utf8");
  assert.match(service, /INCOMING_RINGING/);
  assert.match(service, /CONNECTING/);
  assert.match(service, /DECLINING/);
  assert.match(service, /MISSED/);
  assert.match(service, /pending_action/);
  assert.match(service, /getCallStateJson/);
});
