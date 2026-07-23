// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Theme System
// Extracts theme from App.tsx so any block can import it
// ═══════════════════════════════════════════════════════

import type { Theme } from "./types";

export const DARK_THEME: Theme = {
  // ── PURE BLACK + GREY CARDS ────────────────────────────────────────────
  bg:"#000000",    card:"#1a1a1a",  card2:"#2a2a2a", card3:"#333333",
  // ── Borders (grey) ──────────────────────────────────────────────
  border:"#333333", borderBright:"#444444",
  // ── Primary accents ──────────────────────────────────────────────────
  accent:"#ff7c28",  accent2:"#ff3c50",
  // ── Semantic colors (vivid + stronger dim for contrast) ───────────────
  green:"#22e87a",   greenDim:"#22e87a30",
  blue:"#4fa6ff",    blueDim:"#4fa6ff30",
  teal:"#00dcc8",    tealDim:"#00dcc830",
  purple:"#a78bff",  purpleDim:"#a78bff30",
  gold:"#ffc62a",    goldDim:"#ffc62a30",
  pink:"#ff55cc",    pinkDim:"#ff55cc30",
  cyan:"#00d8f8",    cyanDim:"#00d8f830",
  red:"#ff4455",     redDim:"#ff445530",
  // ── Text (pure white) ────────────────────────────
  text:"#ffffff",  muted:"#aaaaaa",  muted2:"#777777",
  shadow:"rgba(0,0,0,.9)",
};

export const LIGHT_THEME: Theme = {
  // ── Clean white background with subtle grey cards ────────────────────────────
  bg:"#F2F2F7", card:"#ffffff", card2:"#ffffff", card3:"#e5e5ea",
  // ── Borders (visible grey for contrast) ──────────────────────────────────────
  border:"#c7c7cc", borderBright:"#8e8e93",
  // ── Primary accents (darker for visibility on light bg) ──────────────────────
  accent:"#e65c00", accent2:"#cc2233",
  // ── Semantic colors (darker for contrast) ────────────────────────────────────
  green:"#248A3D", greenDim:"#248A3D20",
  blue:"#007AFF", blueDim:"#007AFF20",
  teal:"#0a7a6f", tealDim:"#0a7a6f20",
  purple:"#6b21a8", purpleDim:"#6b21a820",
  gold:"#C93400", goldDim:"#C9340020",
  pink:"#be185d", pinkDim:"#be185d20",
  cyan:"#0e7490", cyanDim:"#0e749020",
  red:"#D70015", redDim:"#D7001520",
  // ── Text — high contrast (not dim grey) ─────────────────────────────────────
  text:"#000000", muted:"#3A3A3C", muted2:"#1C1C1E",
  shadow:"rgba(0,0,0,.08)",
};

/** Mutable live theme — call applyTheme(dark) to switch */
export const C: Theme = { ...DARK_THEME } as any;

export const applyTheme = (dark: boolean) => {
  Object.assign(C, dark ? DARK_THEME : LIGHT_THEME);
  if (typeof document !== "undefined") {
    document.body.style.background = C.bg;
    document.body.style.color = C.text;
    document.documentElement.style.background = C.bg;
    document.documentElement.style.color = C.text;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    // Set data-theme attribute for CSS variable switching
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
};
