import test from "node:test";
import assert from "node:assert/strict";
import { ensureMeshIdentity, getLocalDeviceIdentity, getMeshHandle, getPeerId, setMeshHandle, syncLocalDeviceIdentity } from "../src/mesh/identity.ts";

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

async function withStorageAsync<T>(store: Map<string, string>, fn: () => Promise<T>): Promise<T> {
  const prevWindow = (globalThis as any).window;
  const prevLocalStorage = (globalThis as any).localStorage;
  (globalThis as any).window = { location: { hostname: "localhost", port: "5173", protocol: "http:" } };
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  try {
    return await fn();
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
    assert.match(first.handle, /^\d{10}$/);
    assert.equal(getMeshHandle(), first.handle);

    const second = ensureMeshIdentity();
    assert.equal(second.peerId, first.peerId);
    assert.equal(second.handle, first.handle);
  });
});

test("setMeshHandle does not override the device-locked handle", () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    store.set("user_phone", "7057004015");
    const first = ensureMeshIdentity();
    setMeshHandle("9999999999");
    assert.equal(getMeshHandle(), first.handle);
    assert.equal(getLocalDeviceIdentity().handle, "7057004015");
  });
});

test("syncLocalDeviceIdentity prefers the native SIM number over IMEI", async () => {
  const store = new Map<string, string>();
  const prevNative = (globalThis as any).GridCallerNative;
  try {
    await withStorageAsync(store, async () => {
      (globalThis as any).GridCallerNative = {
        getDeviceIdentity: async () => ({
          phoneNumber: "+91 88888 77777",
          imei: "359123456789012",
        }),
      };
      const snapshot = await syncLocalDeviceIdentity({ peerId: "mesh_testsim" });
      assert.equal(snapshot.handle, "8888877777");
      assert.equal(snapshot.source, "sim");
      assert.equal(snapshot.phone, "918888877777");
    });
  } finally {
    if (prevNative === undefined) delete (globalThis as any).GridCallerNative;
    else (globalThis as any).GridCallerNative = prevNative;
  }
});
