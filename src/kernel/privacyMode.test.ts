import test from "node:test";
import assert from "node:assert/strict";
import { S } from "./storage";
import freeRadio from "./radioMesh";
import softTowerHop from "./softTowerHopNet";
import { getForceLocalMesh, setForceLocalMesh } from "./offlineMode";
import { isPrivacyMode, setPrivacyMode } from "./privacyMode";

function setGlobal(key: "localStorage", value: unknown) {
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

test("privacy mode restores the prior mesh and radio state when turned off", async () => {
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
  const prevForceLocalMesh = getForceLocalMesh();
  const prevCloudGun = S.get("gc_allow_cloud_gun", false);
  const prevRadioOn = freeRadio.enabled;
  const prevTowerReady = softTowerHop.ready;

  try {
    setForceLocalMesh(false);
    S.set("gc_allow_cloud_gun", true);
    await freeRadio.enable(false);
    softTowerHop.stop();

    await setPrivacyMode(true, "Tester");
    assert.equal(isPrivacyMode(), true);
    assert.equal(getForceLocalMesh(), true);
    assert.equal(S.get("gc_allow_cloud_gun", false), false);
    assert.equal(freeRadio.enabled, true);
    assert.equal(softTowerHop.ready, true);

    await setPrivacyMode(false, "Tester");
    assert.equal(isPrivacyMode(), false);
    assert.equal(getForceLocalMesh(), false);
    assert.equal(S.get("gc_allow_cloud_gun", false), true);
    assert.equal(freeRadio.enabled, false);
    assert.equal(softTowerHop.ready, false);
  } finally {
    setForceLocalMesh(prevForceLocalMesh);
    S.set("gc_allow_cloud_gun", prevCloudGun);
    await freeRadio.enable(prevRadioOn);
    if (prevTowerReady) softTowerHop.start(S.get("user_name", "Operator"));
    else softTowerHop.stop();
    await setPrivacyMode(false, "Tester");
    restoreStorage();
  }
});

test("free radio restores the prior mesh path policy when turned off", async () => {
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
  const prevForceLocalMesh = getForceLocalMesh();
  const prevCloudGun = S.get("gc_allow_cloud_gun", false);
  const prevRadioOn = freeRadio.enabled;

  try {
    setForceLocalMesh(false);
    S.set("gc_allow_cloud_gun", true);
    await freeRadio.enable(false);

    await freeRadio.enable(true);
    assert.equal(getForceLocalMesh(), true);
    assert.equal(S.get("gc_allow_cloud_gun", false), false);

    await freeRadio.enable(false);
    assert.equal(getForceLocalMesh(), false);
    assert.equal(S.get("gc_allow_cloud_gun", false), true);
  } finally {
    setForceLocalMesh(prevForceLocalMesh);
    S.set("gc_allow_cloud_gun", prevCloudGun);
    await freeRadio.enable(prevRadioOn);
    restoreStorage();
  }
});

test("privacy mode keeps the original restore snapshot across repeated enable calls", async () => {
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
  const prevForceLocalMesh = getForceLocalMesh();
  const prevCloudGun = S.get("gc_allow_cloud_gun", false);
  const prevRadioOn = freeRadio.enabled;
  const prevTowerReady = softTowerHop.ready;

  try {
    setForceLocalMesh(false);
    S.set("gc_allow_cloud_gun", true);
    await freeRadio.enable(false);
    softTowerHop.stop();

    await setPrivacyMode(true, "Tester");
    await setPrivacyMode(true, "Tester");
    await setPrivacyMode(false, "Tester");

    assert.equal(getForceLocalMesh(), false);
    assert.equal(S.get("gc_allow_cloud_gun", false), true);
    assert.equal(freeRadio.enabled, false);
    assert.equal(softTowerHop.ready, false);
  } finally {
    setForceLocalMesh(prevForceLocalMesh);
    S.set("gc_allow_cloud_gun", prevCloudGun);
    await freeRadio.enable(prevRadioOn);
    if (prevTowerReady) softTowerHop.start(S.get("user_name", "Operator"));
    else softTowerHop.stop();
    await setPrivacyMode(false, "Tester");
    restoreStorage();
  }
});

test("privacy mode shutdown ignores stale radio backup state", async () => {
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
  const prevForceLocalMesh = getForceLocalMesh();
  const prevCloudGun = S.get("gc_allow_cloud_gun", false);
  const prevRadioOn = freeRadio.enabled;
  const prevTowerReady = softTowerHop.ready;

  try {
    setForceLocalMesh(false);
    S.set("gc_allow_cloud_gun", true);
    await freeRadio.enable(false);
    softTowerHop.stop();
    S.set("gc_radio_prev_mesh_mode_v1", {
      forceLocalMesh: true,
      allowCloudGun: false,
    });

    await setPrivacyMode(true, "Tester");
    await setPrivacyMode(false, "Tester");

    assert.equal(getForceLocalMesh(), false);
    assert.equal(S.get("gc_allow_cloud_gun", false), true);
    assert.equal(freeRadio.enabled, false);
  } finally {
    setForceLocalMesh(prevForceLocalMesh);
    S.set("gc_allow_cloud_gun", prevCloudGun);
    await freeRadio.enable(prevRadioOn);
    if (prevTowerReady) softTowerHop.start(S.get("user_name", "Operator"));
    else softTowerHop.stop();
    await setPrivacyMode(false, "Tester");
    restoreStorage();
  }
});
