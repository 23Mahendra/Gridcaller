import test from "node:test";
import assert from "node:assert/strict";
import { isHapticFeedbackEnabled, triggerHapticFeedback } from "./feedback.ts";

test("haptic feedback is disabled by default", () => {
  const calls: number[][] = [];
  const originalNavigator = globalThis.navigator;

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      vibrate: (pattern: number | number[]) => {
        calls.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    },
  });

  try {
    assert.equal(isHapticFeedbackEnabled(), false);
    const result = triggerHapticFeedback([200, 100, 200]);
    assert.equal(result, false);
    assert.equal(calls.length, 0);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});
