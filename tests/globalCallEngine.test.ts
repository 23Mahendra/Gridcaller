import test from "node:test";
import assert from "node:assert/strict";
import globalCall from "../src/kernel/globalCallEngine.ts";
import { MeshEngine } from "../src/kernel/mesh.ts";

function setGlobal(key: "localStorage" | "window" | "navigator" | "fetch", value: unknown) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (prev) Object.defineProperty(globalThis, key, prev);
    else delete (globalThis as any)[key];
  };
}

test("globalCall learns and resolves peer presence from local mesh broadcasts", async () => {
  const store = new Map<string, string>();
  const restoreStorage = setGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  });
  const restoreWindow = setGlobal("window", {
    location: {
      hostname: "gridcaller-device",
      port: "5173",
      protocol: "http:",
      host: "gridcaller-device:5173",
    },
  });
  const restoreNavigator = setGlobal("navigator", {
    onLine: false,
    userAgent: "node-test",
    mediaDevices: {},
  });
  const restoreFetch = setGlobal("fetch", async () => ({ ok: false }));

  const prevBroadcast = MeshEngine.broadcast;
  const prevOnMessage = MeshEngine.onMessage;
  const prevStart = (MeshEngine as any).start;
  let meshHandler: ((msg: any) => void) | null = null;
  (MeshEngine as any).broadcast = () => {};
  (MeshEngine as any).start = () => {};
  (MeshEngine as any).onMessage = (fn: (msg: any) => void) => {
    meshHandler = fn;
    return () => {
      meshHandler = null;
    };
  };

  try {
    globalCall.start("node-local", "Mahendra", "mahendra");
    meshHandler?.({
      type: "GLOBAL_CALL_PRESENCE",
      from: "peer-22",
      fromName: "Relay Node",
      data: {
        id: "peer-22",
        name: "Relay Node",
        handle: "relay22",
        phone: "91705551234",
        displayNumber: "+91 70 5551 234",
        ts: Date.now(),
      },
    });

    const byHandle = await globalCall.resolvePeer("relay22");
    const byDigits = await globalCall.resolvePeer("705551234");
    assert.deepEqual(byHandle, { id: "peer-22", name: "Relay Node", handle: "relay22" });
    assert.deepEqual(byDigits, { id: "peer-22", name: "Relay Node", handle: "relay22" });
  } finally {
    globalCall.stop();
    (MeshEngine as any).broadcast = prevBroadcast;
    (MeshEngine as any).onMessage = prevOnMessage;
    (MeshEngine as any).start = prevStart;
    restoreStorage();
    restoreWindow();
    restoreNavigator();
    restoreFetch();
  }
});
