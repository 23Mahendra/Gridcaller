import test from "node:test";
import assert from "node:assert/strict";
import { gridNumberRegistry } from "../src/kernel/gridNumberRegistry.ts";

function setGlobal(key: "localStorage" | "navigator" | "screen" | "crypto", value: unknown) {
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, key);
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (prevDesc) {
      Object.defineProperty(globalThis, key, prevDesc);
      return;
    }
    if (hadOwn) return;
    delete (globalThis as any)[key];
  };
}

async function withStorage(fn: () => void | Promise<void>) {
  const prevCrypto = (globalThis as any).crypto;
  const store = new Map<string, string>();
  const restoreLocalStorage = setGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  });
  const restoreNavigator = setGlobal("navigator", {
    userAgent: "node-test",
    language: "en-US",
    hardwareConcurrency: 4,
  });
  const restoreScreen = setGlobal("screen", {
    width: 1280,
    height: 720,
    colorDepth: 24,
  });
  let restoreCrypto: (() => void) | null = null;
  if (prevCrypto === undefined && (globalThis as any).crypto === undefined) {
    restoreCrypto = setGlobal("crypto", {
      subtle: undefined,
    });
  }
  try {
    await fn();
  } finally {
    restoreLocalStorage();
    restoreNavigator();
    restoreScreen();
    if (restoreCrypto) restoreCrypto();
  }
}

test("gridNumberRegistry stores blocked calls only in the local device comm log", { concurrency: false }, async () => {
  await withStorage(() => {
    gridNumberRegistry.start({ id: "u1", name: "Tester" });
    gridNumberRegistry.logCall({
      dir: "blocked",
      peerId: "peer-1",
      peerName: "Blocked Peer",
      method: "gridcaller",
      reason: "user_blocked_contact",
      refId: "call-1",
    });

    const local = gridNumberRegistry.getLocalCommLog(20);
    const ledger = gridNumberRegistry.getLedger(20);
    assert.equal(local.length, 1);
    assert.equal(local[0].kind, "call");
    assert.equal(local[0].direction, "blocked");
    assert.equal(local[0].peerId, "peer-1");
    assert.equal(local[0].reason, "user_blocked_contact");
    assert.equal(ledger.some((row) => row.type === "call_missed" || row.type === "call_placed" || row.type === "call_received"), false);
  });
});

test("gridNumberRegistry stores inbox message details locally and logs sent sms in the safety ledger", { concurrency: false }, async () => {
  await withStorage(() => {
    gridNumberRegistry.start({ id: "u1", name: "Tester" });
    gridNumberRegistry.logMessage({
      direction: "in",
      folder: "inbox",
      peerId: "peer-2",
      peerName: "Inbox Peer",
      text: "hello over mesh",
      method: "mesh-engine",
      refId: "msg-in-1",
    });
    gridNumberRegistry.logMessage({
      direction: "out",
      folder: "sent",
      peerId: "peer-3",
      peerName: "Sent Peer",
      text: "reply from device",
      method: "gridcaller-mesh-sms",
      refId: "msg-out-1",
    });

    const local = gridNumberRegistry.getLocalCommLog(20);
    const inbox = local.find((row) => row.refId === "msg-in-1");
    const sent = local.find((row) => row.refId === "msg-out-1");
    const ledger = gridNumberRegistry.getLedger(20);

    assert.ok(inbox);
    assert.equal(inbox?.folder, "inbox");
    assert.equal(inbox?.textPreview, "hello over mesh");
    assert.ok(sent);
    assert.equal(sent?.folder, "sent");
    assert.equal(ledger.some((row) => row.type === "sms_sent" && row.peerName === "Sent Peer"), true);
  });
});

test("gridNumberRegistry can delete one local log entry and clear the rest", { concurrency: false }, async () => {
  await withStorage(() => {
    gridNumberRegistry.start({ id: "u1", name: "Tester" });
    const first = gridNumberRegistry.logMessage({
      direction: "in",
      folder: "inbox",
      peerId: "peer-a",
      peerName: "Peer A",
      text: "first",
      method: "mesh-engine",
      refId: "log-a",
    });
    gridNumberRegistry.logCall({
      dir: "missed",
      peerId: "peer-b",
      peerName: "Peer B",
      method: "gridcaller",
      refId: "log-b",
    });

    assert.equal(gridNumberRegistry.getLocalCommLog(20).length, 2);
    assert.equal(gridNumberRegistry.deleteLocalCommLogEntry(first.id), true);
    assert.equal(gridNumberRegistry.getLocalCommLog(20).length, 1);
    assert.equal(gridNumberRegistry.clearLocalCommLog(), 1);
    assert.equal(gridNumberRegistry.getLocalCommLog(20).length, 0);
  });
});