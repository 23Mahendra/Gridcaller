import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, splitTextChunks } from "./localRag.ts";

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
