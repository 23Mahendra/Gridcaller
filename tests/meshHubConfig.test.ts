import test from "node:test";
import assert from "node:assert/strict";
import { probeHub, resolveHubHttp, resolveMeshWsUrl } from "../src/kernel/meshHubConfig.ts";

async function withWindowAndStorage(hostname: string, store: Map<string, string>, fn: () => void | Promise<void>) {
  const prevWindow = (globalThis as any).window;
  const prevLocalStorage = (globalThis as any).localStorage;

  (globalThis as any).window = {
    location: {
      hostname,
      port: "5173",
      protocol: "http:",
      host: `${hostname}:5173`,
    },
  };
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };

  try {
    await fn();
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = prevWindow;
    }
    if (prevLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = prevLocalStorage;
    }
  }
}

test("resolveHubHttp prefers the local hub when the app runs on localhost", () => {
  return withWindowAndStorage("localhost", new Map<string, string>(), () => {
    assert.equal(resolveHubHttp(), "http://127.0.0.1:8765");
    assert.equal(resolveMeshWsUrl(), "ws://127.0.0.1:8765/mesh-ws");
  });
});

test("resolveHubHttp ignores stale LAN hub values on localhost preview", () => {
  const store = new Map<string, string>([["gc_hub_http", "http://192.168.1.8:8765"]]);
  return withWindowAndStorage("localhost", store, () => {
    assert.equal(resolveHubHttp(), "http://127.0.0.1:8765");
    assert.equal(resolveMeshWsUrl(), "ws://127.0.0.1:8765/mesh-ws");
  });
});

test("probeHub caches recent failures to avoid localhost retry spam", async () => {
  const prevFetch = (globalThis as any).fetch;
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls += 1;
    throw new Error("offline");
  };

  try {
    await withWindowAndStorage("localhost", new Map<string, string>(), async () => {
      const first = await probeHub("http://127.0.0.1:8765");
      const second = await probeHub("http://127.0.0.1:8765");
      assert.equal(first.ok, false);
      assert.equal(second.ok, false);
      assert.equal(calls, 1);
    });
  } finally {
    if (prevFetch === undefined) {
      delete (globalThis as any).fetch;
    } else {
      (globalThis as any).fetch = prevFetch;
    }
  }
});
