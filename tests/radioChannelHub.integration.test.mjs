import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHub(baseUrl, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`hub exited with ${child.exitCode}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await delay(50);
  }
  throw new Error("radio hub did not start");
}

async function post(baseUrl, path, body, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
  return result;
}

test("real radio hub arbitrates floor ownership, tokens, renewal, release and expiry", async (t) => {
  const port = 24_000 + (process.pid % 1_000);
  const peerPort = 25_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const hub = spawn(process.execPath, ["server/hub.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), PEER_PORT: String(peerPort), RADIO_FLOOR_TTL_MS: "250", RADIO_MEMBER_TTL_MS: "1500" },
    stdio: "ignore",
  });
  t.after(() => { if (hub.exitCode === null) hub.kill("SIGTERM"); });
  await waitForHub(baseUrl, hub);

  const channelId = "integration-radio";
  const alice = await post(baseUrl, "/api/radio/join", { channelId, userId: "A", userName: "Alice" });
  const bob = await post(baseUrl, "/api/radio/join", { channelId, userId: "B", userName: "Bob" });
  const carol = await post(baseUrl, "/api/radio/join", { channelId, userId: "C", userName: "Carol" });
  assert.ok(alice.sessionToken && bob.sessionToken && carol.sessionToken, "join did not issue internal tokens");
  assert.equal(new Set(alice.members.map((member) => member.id)).has("A"), true);

  const aFloor = await post(baseUrl, "/api/radio/floor/acquire", { channelId, userId: "A", sessionToken: alice.sessionToken });
  assert.equal(aFloor.granted, true);
  await post(baseUrl, "/api/radio/join", { channelId, userId: "A", userName: "Impersonator" }, 409);
  const resumedAlice = await post(baseUrl, "/api/radio/join", {
    channelId, userId: "A", userName: "Alice", sessionToken: alice.sessionToken,
  });
  assert.equal(resumedAlice.sessionToken, alice.sessionToken);
  const seenByC = await fetch(`${baseUrl}/api/radio/channel?channelId=${channelId}`).then((r) => r.json());
  assert.equal(seenByC.speaker.userId, "A");
  assert.equal("sessionToken" in seenByC.members.find((member) => member.id === "A"), false, "private token leaked in user list");

  const bBlocked = await post(baseUrl, "/api/radio/floor/acquire", { channelId, userId: "B", sessionToken: bob.sessionToken });
  assert.equal(bBlocked.granted, false);
  assert.equal(bBlocked.speaker.userId, "A");

  await post(baseUrl, "/api/radio/heartbeat", { channelId, userId: "A", userName: "Alice", sessionToken: alice.sessionToken });
  const renewed = await post(baseUrl, "/api/radio/floor/acquire", { channelId, userId: "A", sessionToken: alice.sessionToken });
  assert.equal(renewed.granted, true);
  assert.equal(renewed.speaker.leaseId, aFloor.speaker.leaseId);
  assert.ok(renewed.speaker.expiresAt > aFloor.speaker.expiresAt);

  await post(baseUrl, "/api/radio/floor/release", {
    channelId, userId: "A", sessionToken: bob.sessionToken, leaseId: renewed.speaker.leaseId,
  }, 403);
  await post(baseUrl, "/api/radio/floor/release", {
    channelId, userId: "A", sessionToken: "stale-token", leaseId: renewed.speaker.leaseId,
  }, 403);
  const released = await post(baseUrl, "/api/radio/floor/release", {
    channelId, userId: "A", sessionToken: alice.sessionToken, leaseId: renewed.speaker.leaseId,
  });
  assert.equal(released.released, true);

  const bFloor = await post(baseUrl, "/api/radio/floor/acquire", { channelId, userId: "B", sessionToken: bob.sessionToken });
  assert.equal(bFloor.granted, true);
  await delay(300);
  const aAfterExpiry = await post(baseUrl, "/api/radio/floor/acquire", { channelId, userId: "A", sessionToken: alice.sessionToken });
  assert.equal(aAfterExpiry.granted, true);
  assert.notEqual(aAfterExpiry.speaker.leaseId, bFloor.speaker.leaseId);
});
