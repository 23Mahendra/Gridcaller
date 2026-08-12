import assert from "node:assert/strict";
import test from "node:test";
import {
  OmniMeshEngine,
  type OmniPacket,
  type OmniTransport,
  type OmniTransportSender,
} from "./omniMeshEngine";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function packet(overrides: Partial<OmniPacket> = {}): OmniPacket {
  return {
    id: "packet-1",
    type: "DATA",
    payload: { text: "hello" },
    from: "A",
    to: "C",
    ts: 1_000,
    hops: 0,
    ttl: 2,
    path: ["A"],
    via: ["wifi-lan-ws"],
    priority: "data",
    expiresAt: 61_000,
    ...overrides,
  };
}

function engine(
  id: string,
  senders: Partial<Record<OmniTransport, OmniTransportSender>> = {},
  now: () => number = () => 1_000,
) {
  return new OmniMeshEngine({ nodeId: id, nodeName: id, manualStart: true, transportSenders: senders, now });
}

test("packet creation preserves explicit TTL zero and creates independent expiry", async () => {
  const node = engine("A", { "wifi-lan-ws": () => assert.fail("ttl=0 must not transmit") });
  const created = await node.send("DATA", { ok: true }, { to: "B", ttl: 0, expiresInMs: 500 });
  assert.equal(created.ttl, 0);
  assert.equal(created.hops, 0);
  assert.equal(created.expiresAt, 1_500);
  assert.deepEqual(created.path, ["A"]);
  assert.equal(node.getDeliveryState(created.id), "failed");
  await assert.rejects(() => node.send("DATA", {}, { ttl: -1 }), /non-negative integer/);
});

test("same logical packet arriving twice is delivered exactly once", () => {
  const node = engine("B");
  const delivered: string[] = [];
  node.onPacket((pkt) => delivered.push(pkt.id));
  const incoming = packet({ to: "B" });
  node.receive(incoming, "wifi-lan-ws");
  node.receive(structuredClone(incoming), "gun-graph");
  assert.deepEqual(delivered, ["packet-1"]);
});

test("multi-transport copies retain one ID and produce one delivery", async () => {
  const copies: OmniPacket[] = [];
  const receiver = engine("B");
  let deliveries = 0;
  receiver.onPacket((pkt) => { if (pkt.type === "DATA") deliveries++; });
  const sender = engine("A", {
    "wifi-lan-ws": (pkt) => { copies.push(pkt); },
    "gun-graph": (pkt) => { copies.push(pkt); },
  });
  const sent = await sender.send("DATA", { value: 1 }, {
    to: "B", ttl: 1, forceTransports: ["wifi-lan-ws", "gun-graph"],
  });
  assert.ok(copies.length >= 2);
  assert.ok(copies.every((copy) => copy.id === sent.id));
  for (const copy of copies) receiver.receive(copy, copy.via[0]);
  assert.equal(deliveries, 1);
});

test("A to B to C relays once, consumes one hop, appends B, and ACKs A", async () => {
  const wire: Array<{ from: string; to: string; packet: OmniPacket }> = [];
  let a!: OmniMeshEngine;
  let b!: OmniMeshEngine;
  let c!: OmniMeshEngine;
  const link = (from: string, targets: () => OmniMeshEngine[]): OmniTransportSender => (pkt) => {
    for (const target of targets()) {
      wire.push({ from, to: target.id, packet: structuredClone(pkt) });
      target.receive(structuredClone(pkt), "wifi-lan-ws");
    }
  };
  a = engine("A", { "wifi-lan-ws": link("A", () => [b]) });
  b = engine("B", { "wifi-lan-ws": link("B", () => [a, c]) });
  c = engine("C", { "wifi-lan-ws": link("C", () => [b]) });
  const atB: OmniPacket[] = [];
  const atC: OmniPacket[] = [];
  b.onPacket((pkt) => atB.push(pkt));
  c.onPacket((pkt) => { if (pkt.type === "DATA") atC.push(pkt); });

  const sent = await a.send("DATA", { proof: true }, { to: "C", ttl: 2 });
  await tick();
  await tick();

  assert.equal(atB.some((pkt) => pkt.id === sent.id), false, "transit packet must not be locally delivered");
  assert.equal(atC.length, 1);
  assert.equal(atC[0].id, sent.id);
  assert.equal(atC[0].hops, 1);
  assert.deepEqual(atC[0].path, ["A", "B"]);
  assert.equal(a.getDeliveryState(sent.id), "acked");
  assert.ok(wire.some((entry) => entry.from === "C" && entry.packet.ackFor === sent.id));
});

test("TTL one permits one relay; exhausted and expired packets never relay", async () => {
  const forwarded: OmniPacket[] = [];
  const b = engine("B", { "wifi-lan-ws": (pkt) => { forwarded.push(pkt); } });
  b.receive(packet({ ttl: 1, hops: 0 }), "wifi-lan-ws");
  await tick();
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].hops, 1);

  b.receive(packet({ id: "exhausted", ttl: 1, hops: 1 }), "wifi-lan-ws");
  b.receive(packet({ id: "expired", expiresAt: 999 }), "wifi-lan-ws");
  b.receive(packet({ id: "invalid", ttl: -1 }), "wifi-lan-ws");
  await tick();
  assert.equal(forwarded.length, 1);
});

test("TTL two supports A-B-C-D with exactly two relay hops", async () => {
  let b!: OmniMeshEngine;
  let c!: OmniMeshEngine;
  let d!: OmniMeshEngine;
  const a = engine("A", { "wifi-lan-ws": (pkt) => b.receive(pkt, "wifi-lan-ws") });
  b = engine("B", { "wifi-lan-ws": (pkt) => c.receive(pkt, "wifi-lan-ws") });
  c = engine("C", { "wifi-lan-ws": (pkt) => d.receive(pkt, "wifi-lan-ws") });
  d = engine("D");
  const delivered: OmniPacket[] = [];
  d.onPacket((pkt) => { if (pkt.type === "DATA") delivered.push(pkt); });
  await a.send("DATA", { chain: true }, { to: "D", ttl: 2 });
  await tick();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].hops, 2);
  assert.deepEqual(delivered[0].path, ["A", "B", "C"]);
});

test("duplicate received by relay is transmitted only once", async () => {
  const forwarded: OmniPacket[] = [];
  const b = engine("B", { "wifi-lan-ws": (pkt) => { forwarded.push(pkt); } });
  const incoming = packet({ id: "relay-duplicate" });
  b.receive(incoming, "wifi-lan-ws");
  b.receive(structuredClone(incoming), "gun-graph");
  await tick();
  assert.equal(forwarded.filter((pkt) => pkt.id === incoming.id).length, 1);
});

test("path loop prevention rejects A-B-A and A-B-C-B", async () => {
  const forwarded: OmniPacket[] = [];
  const b = engine("B", { "wifi-lan-ws": (pkt) => { forwarded.push(pkt); } });
  b.receive(packet({ id: "aba", path: ["A", "B", "A"], hops: 2, ttl: 4 }), "wifi-lan-ws");
  b.receive(packet({ id: "abcb", path: ["A", "B", "C"], hops: 2, ttl: 4 }), "wifi-lan-ws");
  b.receive(packet({ id: "bad-path", path: ["A", 4 as unknown as string] }), "wifi-lan-ws");
  await tick();
  assert.equal(forwarded.length, 0);
});

test("directed destination, transit, broadcast, and unknown destination are distinct", async () => {
  const forwarded: OmniPacket[] = [];
  const delivered: string[] = [];
  const b = engine("B", { "wifi-lan-ws": (pkt) => { forwarded.push(pkt); } });
  b.onPacket((pkt) => { if (pkt.type !== "OMNI_ACK") delivered.push(pkt.id); });
  b.receive(packet({ id: "for-b", to: "B" }), "wifi-lan-ws");
  b.receive(packet({ id: "for-c", to: "C" }), "wifi-lan-ws");
  b.receive(packet({ id: "broadcast", to: undefined }), "wifi-lan-ws");
  b.receive(packet({ id: "unknown", to: "unknown-node" }), "wifi-lan-ws");
  await tick();
  assert.deepEqual(delivered.sort(), ["broadcast", "for-b"]);
  assert.ok(forwarded.some((pkt) => pkt.id === "for-c"));
  assert.ok(forwarded.some((pkt) => pkt.id === "unknown"));
  assert.ok(forwarded.some((pkt) => pkt.id === "broadcast"));
  assert.ok(!forwarded.some((pkt) => pkt.id === "for-b" && pkt.type !== "OMNI_ACK"));
});

test("partial dispatch records only successful transport evidence", async () => {
  const node = engine("A", {
    "wifi-lan-ws": () => {},
    "gun-graph": () => { throw new Error("down"); },
  });
  const sent = await node.send("DATA", {}, {
    to: "B", ttl: 1, forceTransports: ["wifi-lan-ws", "gun-graph"],
  });
  assert.equal(node.getDeliveryState(sent.id), "transport-sent");
  assert.equal(node.getStats().pathsLearned, 1);
  assert.ok(node.getTransports().find((t) => t.id === "wifi-lan-ws")!.tx > 0);
  assert.ok(node.getTransports().find((t) => t.id === "gun-graph")!.lastErr > 0);
});

test("total dispatch failure is queued and does not learn a route", async () => {
  const node = engine("A", { "wifi-lan-ws": () => { throw new Error("down"); } });
  const sent = await node.send("DATA", {}, { to: "B", ttl: 1 });
  assert.equal(node.getDeliveryState(sent.id), "queued");
  assert.deepEqual(node.getQueuedPacketIds(), [sent.id]);
  assert.equal(node.getStats().pathsLearned, 0);
});

test("temporary failure retries with backoff and ACK removes RAM entry", async () => {
  let now = 1_000;
  let attempts = 0;
  const node = engine("A", {
    "wifi-lan-ws": () => {
      attempts++;
      if (attempts < 2) throw new Error("temporary");
    },
  }, () => now);
  const sent = await node.send("DATA", {}, { to: "B", ttl: 2, expiresInMs: 20_000 });
  assert.equal(attempts, 1);
  now += 1_000;
  await (node as any).flushStoreForward();
  assert.equal(attempts, 2);
  node.receive(packet({
    id: "ack-1", type: "OMNI_ACK", payload: { packetId: sent.id }, from: "B", to: "A",
    ackFor: sent.id, path: ["B"], ttl: 2, expiresAt: 20_000,
  }), "wifi-lan-ws");
  assert.equal(node.getDeliveryState(sent.id), "acked");
  assert.deepEqual(node.getQueuedPacketIds(), []);
  now += 2_000;
  await (node as any).flushStoreForward();
  assert.equal(attempts, 2);
});

test("permanent failure has bounded retries and expiry/final failure", async () => {
  let now = 1_000;
  let attempts = 0;
  const node = engine("A", { "wifi-lan-ws": () => { attempts++; throw new Error("down"); } }, () => now);
  const sent = await node.send("DATA", {}, { to: "B", ttl: 2, expiresInMs: 60_000 });
  for (const advance of [0, 1_000, 2_000, 4_000, 8_000, 16_000]) {
    now += advance;
    await (node as any).flushStoreForward();
  }
  assert.equal(attempts, 1 + 4);
  assert.equal(node.getDeliveryState(sent.id), "failed");
  assert.deepEqual(node.getQueuedPacketIds(), []);

  const expiring = await node.send("DATA", {}, { to: "C", ttl: 2, expiresInMs: 1 });
  now += 2;
  await (node as any).flushStoreForward();
  assert.equal(node.getDeliveryState(expiring.id), "failed");
});

test("non-destination with no cross-device link is held in bounded RAM store-forward", async () => {
  const node = engine("B");
  node.receive(packet({ id: "held" }), "wifi-lan-ws");
  await tick();
  assert.deepEqual(node.getQueuedPacketIds(), ["held"]);
});
