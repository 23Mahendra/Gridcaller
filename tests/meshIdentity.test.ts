import test from "node:test";
import assert from "node:assert/strict";
import { ensureMeshIdentity, getMeshHandle, getPeerId } from "../src/mesh/identity.ts";

function withStorage<T>(store: Map<string, string>, fn: () => T): T {
  const prevWindow = (globalThis as any).window;
  const prevLocalStorage = (globalThis as any).localStorage;
  (globalThis as any).window = { location: { hostname: "localhost", port: "5173", protocol: "http:" } };
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  try {
    return fn();
  } finally {
    if (prevWindow === undefined) delete (globalThis as any).window; else (globalThis as any).window = prevWindow;
    if (prevLocalStorage === undefined) delete (globalThis as any).localStorage; else (globalThis as any).localStorage = prevLocalStorage;
  }
}

test("ensureMeshIdentity creates a stable local peer id and handle", () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    const first = ensureMeshIdentity();
    assert.match(first.peerId, /^mesh_/);
    assert.equal(first.peerId, getPeerId());
    assert.match(first.handle, /^mesh-/);
    assert.equal(getMeshHandle(), first.handle);

    const second = ensureMeshIdentity();
    assert.equal(second.peerId, first.peerId);
    assert.equal(second.handle, first.handle);
  });
});
