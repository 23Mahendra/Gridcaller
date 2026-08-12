import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { WebSocket } from "ws";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHub(baseUrl, child) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`hub exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("hub did not become healthy");
}

function connect(url, id) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("error", reject);
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "HELLO", id, name: id }));
      resolve(ws);
    });
  });
}

test("real hub routes /mesh-ws separately and fans HTTP packets to another client", async (t) => {
  const port = 18_000 + (process.pid % 1_000);
  const peerPort = 20_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, ["server/hub.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), PEER_PORT: String(peerPort) },
    stdio: "ignore",
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHub(baseUrl, child);
  const localAiProbe = await fetch(`${baseUrl}/api/ollama/api/tags`);
  const localAiBody = await localAiProbe.text();
  assert.doesNotMatch(localAiBody, /proxyLocalApi is not defined/);
  const a = await connect(`ws://127.0.0.1:${port}/mesh-ws`, "hub-A");
  const b = await connect(`ws://127.0.0.1:${port}/mesh-ws`, "hub-B");
  t.after(() => { a.close(); b.close(); });

  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("packet fan-out timed out")), 3_000);
    b.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id !== "hub-packet-1") return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  const response = await fetch(`${baseUrl}/api/mesh/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "hub-packet-1", type: "OMNI_DATA", from: "hub-A", to: "hub-B",
      ttl: 2, hops: 0, path: ["hub-A"], expiresAt: Date.now() + 10_000,
      data: { proof: true },
    }),
  });
  assert.equal(response.status, 200);
  const message = await received;
  assert.equal(message.id, "hub-packet-1");
  assert.equal(message.to, "hub-B");
  assert.equal(message.ttl, 2);
  assert.deepEqual(message.path, ["hub-A"]);
  assert.deepEqual(message.data, { proof: true });
});
