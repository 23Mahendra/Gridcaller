import test from "node:test";
import assert from "node:assert/strict";
import { addRagDoc, buildRagContext, cosineSimilarity, listRagDocs, splitTextChunks } from "./localRag.ts";

test("splitTextChunks chunks text with overlap", () => {
  const text = "A".repeat(1000);
  const chunks = splitTextChunks(text, 300, 50);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].length, 300);
  assert.ok(chunks[1].startsWith("A"));
});

test("cosineSimilarity returns 1 for identical vectors", () => {
  const sim = cosineSimilarity([1, 2, 3], [1, 2, 3]);
  assert.ok(sim > 0.9999);
});

test("cosineSimilarity returns 0 for empty vectors", () => {
  assert.equal(cosineSimilarity([], [1, 2]), 0);
  assert.equal(cosineSimilarity([1, 2], []), 0);
});

test("listRagDocs loads docs from the hub API", async () => {
  const prevFetch = globalThis.fetch;
  const docs = [{ id: "doc1", title: "Runbook", createdAt: 1, chunkCount: 2 }];
  globalThis.fetch = async (input: any) => {
    assert.equal(String(input), "/api/rag/docs");
    return new Response(JSON.stringify({ ok: true, docs }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.deepEqual(await listRagDocs(), docs);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("buildRagContext sends the query to the hub API", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    assert.equal(String(input), "/api/rag/query");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.query, "how to recover mesh");
    assert.equal(body.topK, 3);
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          context: "[1] Runbook\nRestart mesh services",
          matches: [{ docId: "doc1", title: "Runbook", text: "Restart mesh services", score: 0.9 }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await buildRagContext("how to recover mesh", { topK: 3 });
    assert.equal(result?.matches[0]?.docId, "doc1");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("addRagDoc rejects blank knowledge before calling the hub API", async () => {
  await assert.rejects(() => addRagDoc("Blank", "   "), /Knowledge text is empty/);
});
