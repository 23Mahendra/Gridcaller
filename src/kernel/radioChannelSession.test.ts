import assert from "node:assert/strict";
import test from "node:test";
import {
  RadioChannelSession,
  type RadioChannelSnapshot,
  type RadioChannelTransport,
  type RadioSpeakerLease,
} from "./radioChannelSession";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot(userId = "A", speaker: RadioSpeakerLease | null = null): RadioChannelSnapshot {
  return {
    channelId: "grid-ch-1",
    channelName: "Grid",
    localUserId: userId,
    members: [{ id: userId, name: userId, joinedAt: 1, lastSeen: Date.now(), connection: "online" }],
    speaker,
    connection: "connected",
    pushToTalk: "idle",
    muted: false,
    error: "",
    sessionToken: "token-A",
  };
}

test("radio channel stays explicitly failed when its optional LAN transport is unavailable", async () => {
  const unavailable: RadioChannelTransport = {
    join: async () => { throw new Error("hub unavailable"); },
    heartbeat: async () => snapshot(),
    leave: async () => {},
    acquire: async () => ({ granted: false, speaker: null }),
    release: async () => false,
    read: async () => snapshot(),
  };
  const session = new RadioChannelSession(unavailable, 10);
  await assert.rejects(session.join("grid-ch-1", "Grid", "A", "Alice"), /hub unavailable/);
  assert.equal(session.snapshot().connection, "failed");
  assert.match(session.snapshot().error, /hub unavailable/);
  session.destroy();
});

test("radio channel renews an owned floor lease and releases the real lease", async () => {
  let acquireCount = 0;
  let releasedLease = "";
  const transport: RadioChannelTransport = {
    join: async () => snapshot(),
    heartbeat: async () => snapshot(),
    leave: async () => {},
    acquire: async () => {
      acquireCount += 1;
      return { granted: true, speaker: { userId: "A", userName: "Alice", leaseId: "lease-A", acquiredAt: 1, expiresAt: Date.now() + 20 } };
    },
    release: async (_channelId, _userId, _sessionToken, leaseId) => { releasedLease = leaseId; return true; },
    read: async () => snapshot(),
  };
  const session = new RadioChannelSession(transport, 5);
  await session.join("grid-ch-1", "Grid", "A", "Alice");
  assert.equal(session.snapshot().sessionToken, "token-A", "join did not carry the token automatically");
  assert.equal(await session.acquireFloor("Alice"), true);
  await wait(14);
  assert.ok(acquireCount >= 2, "heartbeat did not renew the active floor lease");
  assert.equal(await session.releaseFloor(), true);
  assert.equal(releasedLease, "lease-A");
  await session.leave();
});

test("radio channel reports a competing speaker and does not grant PTT", async () => {
  const other = { userId: "B", userName: "Bob", leaseId: "lease-B", acquiredAt: 1, expiresAt: Date.now() + 1000 };
  const transport: RadioChannelTransport = {
    join: async () => snapshot("A", other),
    heartbeat: async () => snapshot("A", other),
    leave: async () => {},
    acquire: async () => ({ granted: false, speaker: other }),
    release: async () => false,
    read: async () => snapshot("A", other),
  };
  const session = new RadioChannelSession(transport, 1000);
  await session.join("grid-ch-1", "Grid", "A", "Alice");
  assert.equal(await session.acquireFloor("Alice"), false);
  assert.equal(session.snapshot().pushToTalk, "blocked");
  assert.equal(session.snapshot().speaker?.userId, "B");
  await session.leave();
});
