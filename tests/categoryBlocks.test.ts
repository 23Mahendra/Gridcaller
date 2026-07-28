import test from "node:test";
import assert from "node:assert/strict";
import {
  GRIDCALLER_MENU_BLOCKS,
  GRIDCALLER_TAB_BLOCKS,
  GRIDCALLER_MENU_QUICK_HINTS,
  getMenuQuickHint,
  normalizeGridCallerTab,
} from "../src/ui/categoryBlocks.ts";

test("category block registries cover every tab and menu category exactly once", () => {
  assert.deepEqual(
    GRIDCALLER_TAB_BLOCKS.map((block) => block.id),
    ["mesh", "contacts", "sms", "groups", "logs"],
  );
  assert.deepEqual(
    GRIDCALLER_MENU_BLOCKS.map((block) => block.id),
    ["online", "emergency", "groupchat", "logs", "radio", "share", "devices", "tower", "profile", "map", "settings"],
  );
  assert.equal(new Set(GRIDCALLER_TAB_BLOCKS.map((block) => block.id)).size, GRIDCALLER_TAB_BLOCKS.length);
  assert.equal(new Set(GRIDCALLER_MENU_BLOCKS.map((block) => block.id)).size, GRIDCALLER_MENU_BLOCKS.length);
});

test("normalizeGridCallerTab keeps supported tabs and falls back safely", () => {
  assert.equal(normalizeGridCallerTab("sms"), "sms");
  assert.equal(normalizeGridCallerTab("keypad"), "keypad");
  assert.equal(normalizeGridCallerTab("unknown"), "groups");
  assert.equal(normalizeGridCallerTab("unknown", "mesh"), "mesh");
});

test("every menu view exposes a quick-action hint", () => {
  const menuViews = GRIDCALLER_MENU_BLOCKS
    .filter((block) => block.destination === "menu")
    .map((block) => block.id)
    .filter((id): id is keyof typeof GRIDCALLER_MENU_QUICK_HINTS => id !== "online" && id !== "groupchat");

  for (const view of menuViews) {
    const hint = getMenuQuickHint(view);
    assert.ok(hint.title.length > 0);
    assert.ok(hint.subtitle.length > 0);
  }
});
