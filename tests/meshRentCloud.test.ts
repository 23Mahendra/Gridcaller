import test from "node:test";
import assert from "node:assert/strict";
import { meshRentCloud } from "../src/kernel/meshRentCloud.ts";
import { ollamaEngine } from "../src/kernel/ollamaEngine.ts";

async function withStorage(fn: () => void | Promise<void>) {
  const prevLocalStorage = (globalThis as any).localStorage;
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  try {
    await fn();
  } finally {
    if (prevLocalStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = prevLocalStorage;
  }
}

test("meshRentCloud train jobs do not invent random loss values", async () => {
  await withStorage(async () => {
    const prevAvailable = (ollamaEngine as any)._available;
    const prevDefaultModel = (ollamaEngine as any)._defaultModel;
    const prevChat = (ollamaEngine as any).chat;
    try {
      (ollamaEngine as any)._available = true;
      (ollamaEngine as any)._defaultModel = "tinyllama";
      (ollamaEngine as any).chat = async () => ({
        message: { role: "assistant", content: "loss stable" },
        totalDuration: 1,
        evalCount: 8,
      });

      localStorage.setItem("mesh_rent_accepting", JSON.stringify(true));
      const job = {
        id: "job-train-1",
        type: "train_step",
        from: "peer-x",
        payload: { prompt: "step", samples: 4 },
        rewardGC: 6,
        status: "queued",
        ts: Date.now(),
      } as any;

      await (meshRentCloud as any).tryWorkJob(job);
      const log = JSON.parse(localStorage.getItem("mesh_train_log") || "[]");
      assert.equal(log.length > 0, true);
      assert.equal(log[0].loss, undefined);
      assert.equal(log[0].lossSource, undefined);
      assert.equal(job.result.train.reportedLoss, null);
      assert.equal(job.result.train.lossSource, "none");
    } finally {
      (ollamaEngine as any)._available = prevAvailable;
      (ollamaEngine as any)._defaultModel = prevDefaultModel;
      (ollamaEngine as any).chat = prevChat;
    }
  });
});

test("meshRentCloud embed jobs use real embeddings when Ollama is available", async () => {
  await withStorage(async () => {
    const prevAvailable = (ollamaEngine as any)._available;
    const prevEmbed = (ollamaEngine as any).embed;
    try {
      (ollamaEngine as any)._available = true;
      (ollamaEngine as any).embed = async () => [0.11, 0.22, 0.33, 0.44];

      localStorage.setItem("mesh_rent_accepting", JSON.stringify(true));
      const job = {
        id: "job-embed-1",
        type: "embed",
        from: "peer-y",
        model: "nomic-embed-text",
        payload: { text: "find nearby relay" },
        rewardGC: 4,
        status: "queued",
        ts: Date.now(),
      } as any;

      await (meshRentCloud as any).tryWorkJob(job);
      assert.equal(job.status, "done");
      assert.equal(job.result.ok, true);
      assert.equal(job.result.model, "nomic-embed-text");
      assert.equal(job.result.dimensions, 4);
    } finally {
      (ollamaEngine as any)._available = prevAvailable;
      (ollamaEngine as any).embed = prevEmbed;
    }
  });
});