import test from "node:test";
import assert from "node:assert/strict";
import { getPrimaryApk, listApkFiles } from "./shareApp";

function setGlobal(key: "localStorage" | "window" | "fetch", value: unknown) {
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

test("shareApp does not pretend an APK exists when the hub share list is unreachable", async () => {
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
      hostname: "localhost",
      port: "5173",
      protocol: "http:",
      host: "localhost:5173",
      origin: "http://localhost:5173",
    },
  });
  const restoreFetch = setGlobal("fetch", async () => {
    throw new Error("offline");
  });

  try {
    const apks = await listApkFiles();
    assert.deepEqual(apks, []);

    const apk = await getPrimaryApk();
    assert.ok(apk);
    assert.equal(apk?.verified, false);
    assert.match(String(apk?.error || ""), /hub|apk/i);
  } finally {
    restoreStorage();
    restoreWindow();
    restoreFetch();
  }
});

