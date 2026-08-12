import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHub(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`hub exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("LAN hub did not become healthy");
}

function startHub(port, peerPort) {
  return spawn(process.execPath, ["server/hub.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), PEER_PORT: String(peerPort) },
    stdio: "ignore",
  });
}

function startNode(nodeId, url, traces) {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/omniLanNode.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, OMNI_NODE_ID: nodeId, OMNI_LAN_URL: url },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const pending = new Map();
  let sequence = 0;
  child.on("message", (message) => {
    if (message?.kind === "trace") traces.push(message.trace);
    if (message?.kind === "response") {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${nodeId} did not connect`)), 20_000);
    const onMessage = (message) => {
      if (message?.kind !== "ready") return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve();
    };
    child.on("message", onMessage);
    child.once("exit", (code) => reject(new Error(`${nodeId} exited with ${code}`)));
  });
  const command = (action, fields = {}) => new Promise((resolve, reject) => {
    const requestId = `${nodeId}-${++sequence}`;
    pending.set(requestId, { resolve, reject });
    child.send({ requestId, action, ...fields });
  });
  return { child, ready, command };
}

async function waitFor(check, message, timeout = 6_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw new Error(message);
}

test("production LAN WebSocket performs real multi-process A-B-C relay, dedup, TTL, ACK, and recovery", async (t) => {
  const port = 21_000 + (process.pid % 1_000);
  const peerPort = 23_000 + (process.pid % 1_000);
  let hub = startHub(port, peerPort);
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/mesh-ws`;
  await waitForHub(baseUrl, hub);

  const traces = [];
  const nodes = [];
  t.after(() => {
    for (const node of nodes) if (node.child.exitCode === null) node.child.kill("SIGTERM");
    if (hub.exitCode === null) hub.kill("SIGTERM");
  });
  for (const nodeId of ["A", "B", "C"]) {
    const node = startNode(nodeId, wsUrl, traces);
    nodes.push(node);
    await node.ready;
  }
  const [a, b, c] = nodes;

  const sent = await a.command("send", {
    type: "LAN_PROOF",
    payload: { actualProductionTransport: true },
    options: { to: "C", nextHop: "B", ttl: 2, forceTransports: ["wifi-lan-ws"] },
  });
  const packetId = sent.packet.id;
  await waitFor(async () => (await a.command("status", { packetId })).state === "acked", "A did not correlate C's ACK");
  assert.equal((await c.command("status", { packetId })).deliveries, 1);

  const required = [
    ["A", "TX"], ["B", "RX"], ["B", "RELAY"],
    ["C", "RX"], ["C", "DELIVER"], ["C", "ACK_TX"], ["A", "ACK_RX"],
  ];
  let cursor = -1;
  for (const [nodeId, event] of required) {
    cursor = traces.findIndex((trace, index) => index > cursor && trace.packetId === packetId && trace.nodeId === nodeId && trace.event === event);
    assert.notEqual(cursor, -1, `missing ordered trace ${nodeId} ${event}`);
  }

  await a.command("raw", { packet: sent.packet });
  await delay(200);
  assert.equal((await c.command("status", { packetId })).deliveries, 1, "duplicate crossed the hub but was not redelivered");

  const exhausted = { ...sent.packet, id: `${packetId}-ttl`, hops: 1, ttl: 1, path: ["A"], nextHop: "B", ts: Date.now(), expiresAt: Date.now() + 5_000 };
  await a.command("raw", { packet: exhausted });
  await delay(200);
  assert.equal((await c.command("status", { packetId: exhausted.id })).deliveries, 0);

  const looped = { ...sent.packet, id: `${packetId}-loop`, hops: 1, ttl: 3, path: ["A", "B"], nextHop: "B", ts: Date.now(), expiresAt: Date.now() + 5_000 };
  await a.command("raw", { packet: looped });
  await delay(200);
  assert.equal((await c.command("status", { packetId: looped.id })).deliveries, 0);

  hub.kill("SIGTERM");
  await new Promise((resolve) => hub.once("exit", resolve));
  const retry = await a.command("send", {
    type: "LAN_RETRY",
    payload: { afterOwnedHubRestart: true },
    options: { to: "C", nextHop: "B", ttl: 2, forceTransports: ["wifi-lan-ws"], expiresInMs: 15_000 },
  });
  assert.equal((await a.command("status", { packetId: retry.packet.id })).queued, true);

  hub = startHub(port, peerPort);
  await waitForHub(baseUrl, hub);
  await delay(1_500);
  await a.command("flush");
  await waitFor(async () => (await a.command("status", { packetId: retry.packet.id })).state === "acked", "queued packet did not recover after hub restart", 8_000);
  assert.equal((await c.command("status", { packetId: retry.packet.id })).deliveries, 1);
});
