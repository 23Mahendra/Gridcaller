import test from "node:test";
import assert from "node:assert/strict";
import { getPrimaryApk } from "../src/kernel/shareApp.ts";
import { fetchHubMeshPeers, probeHub } from "../src/kernel/meshHubConfig.ts";
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

test("release interop covers hub health, APK discovery, and hub-backed peer resolution", async () => {
  const store = new Map<string, string>();
  const registrations: any[] = [];
  const peers = [
    {
      id: "peer-hub-1",
      name: "Field Relay",
      handle: "relayfield",
      phone: "91705550001",
      displayNumber: "+91 70 5550 0001",
      lastSeen: Date.now(),
    },
  ];
  const baseUrl = "http://hub-fixture:8765";
  const nativeFetch = globalThis.fetch.bind(globalThis);
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
      origin: "http://gridcaller-device:5173",
    },
  });
  const restoreNavigator = setGlobal("navigator", {
    onLine: true,
    userAgent: "node-test",
    mediaDevices: {},
  });

  const prevBroadcast = MeshEngine.broadcast;
  const prevOnMessage = MeshEngine.onMessage;
  const prevStart = (MeshEngine as any).start;
  (MeshEngine as any).broadcast = () => {};
  (MeshEngine as any).start = () => {};
  (MeshEngine as any).onMessage = () => () => {};
  const restoreFetch = setGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw.replace("http://gridcaller-device:8765", baseUrl));
    if (url.origin !== baseUrl) {
      return nativeFetch(input as any, init);
    }
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ ok: true, httpMeshPeers: peers, meshWsClients: 1, lan: ["192.168.1.8"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/share/list") {
      return new Response(
        JSON.stringify({
          files: [
            {
              name: "GridCaller-release.apk",
              size: 123456,
              mtime: Date.now(),
              url: "/share/GridCaller-release.apk",
              isApk: true,
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    if (url.pathname === "/api/mesh/peers") {
      return new Response(JSON.stringify({ details: peers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/mesh/resolve") {
      const q = url.searchParams.get("q") || "";
      const peer = q === "relayfield" ? peers[0] : null;
      return new Response(JSON.stringify({ ok: !!peer, peer }), {
        status: peer ? 200 : 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/api/mesh/register" && (init?.method || "GET").toUpperCase() === "POST") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      registrations.push(body);
      return new Response(JSON.stringify({ ok: true, others: peers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/share/GridCaller-release.apk") {
      return new Response(null, {
        status: init?.method === "HEAD" ? 200 : 200,
        headers: { "Content-Type": "application/vnd.android.package-archive" },
      });
    }
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    localStorage.setItem("gc_allow_cloud_gun", JSON.stringify(true));
    localStorage.setItem("gc_mesh_path_mode", JSON.stringify("allow-cloud"));
    const health = await probeHub(baseUrl);
    assert.equal(health.ok, true);
    assert.equal(health.peers, 1);

    const peers = await fetchHubMeshPeers(baseUrl);
    assert.equal(peers.length, 1);
    assert.equal(peers[0]?.handle, "relayfield");

    const apk = await getPrimaryApk(baseUrl);
    assert.ok(apk);
    assert.equal(apk?.verified, true);
    assert.match(String(apk?.url || ""), /GridCaller-release\.apk$/);

    globalCall.start("node-release", "Release Tester", "release");
    const deadline = Date.now() + 500;
    while (!registrations.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(registrations.length > 0, true);
    assert.equal(registrations[0]?.id, "node-release");

    const resolved = await globalCall.resolvePeer("relayfield");
    assert.deepEqual(resolved, {
      id: "peer-hub-1",
      name: "Field Relay",
      handle: "relayfield",
    });
  } finally {
    globalCall.stop();
    (MeshEngine as any).broadcast = prevBroadcast;
    (MeshEngine as any).onMessage = prevOnMessage;
    (MeshEngine as any).start = prevStart;
    restoreFetch();
    restoreStorage();
    restoreWindow();
    restoreNavigator();
  }
});
