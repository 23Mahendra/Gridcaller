import test from "node:test";
import assert from "node:assert/strict";
import { enqueuePendingPacket, prunePendingPackets, shouldStoreForReplay } from "./meshReliability.ts";

test("queues packets addressed to another node for later replay", () => {
  const queue = [];
  const next = enqueuePendingPacket(queue, {
    id: "msg-1",
    to: "peer-2",
    createdAt: 1000,
    expiresAt: 2000,
    attempts: 0,
    payload: { text: "hello" },
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].id, "msg-1");
  assert.equal(next[0].to, "peer-2");
});

test("drops expired queued packets so the store-and-forward cache stays bounded", () => {
  const queue = [
    {
      id: "old",
      to: "peer-2",
      createdAt: 1000,
      expiresAt: 1500,
      attempts: 0,
      payload: { text: "old" },
    },
    {
      id: "fresh",
      to: "peer-3",
      createdAt: 1000,
      expiresAt: 4000,
      attempts: 0,
      payload: { text: "fresh" },
    },
  ];

  const next = prunePendingPackets(queue, 3000);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "fresh");
});

test("only stores packets for other peers, not packets meant for the local node", () => {
  assert.equal(shouldStoreForReplay({ kind: "msg", to: "peer-2", from: "peer-1" } as any, "self"), true);
  assert.equal(shouldStoreForReplay({ kind: "msg", to: "self", from: "peer-1" } as any, "self"), false);
  assert.equal(shouldStoreForReplay({ kind: "tower-beacon", to: "peer-2", from: "peer-1" } as any, "self"), false);
});
