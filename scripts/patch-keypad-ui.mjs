import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = path.join(root, "src", "GridCaller.tsx");
let s = fs.readFileSync(p, "utf8");

const reps = [
  [
    `onClick={() => setDial((p) => p.slice(0, -1))} style={{ border: "none", background: "none", cursor: "pointer", color: T.label, padding: 8 }}`,
    `type="button" onClick={() => setDial((p) => p.slice(0, -1))} style={{ border: "none", background: "none", cursor: "pointer", color: tokens.text, padding: 8 }}`,
  ],
  [
    `<div style={{ fontSize: 11, fontWeight: 700, color: tokens.label, marginBottom: 8 }}>CALL</div>`,
    `<div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: tokens.secondary, marginBottom: 8 }}>CALL</div>`,
  ],
  [
    `placeholder="Mesh ID / name · ya · 10-digit mobile"`,
    `placeholder="Mesh ID / name or 10-digit mobile"`,
  ],
  [
    `{/* Explicit call paths */}
            <div style={{ marginTop: 12, textAlign: "left", maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>`,
    `{/* Explicit call / message paths — Lucide icons */}
            <div style={{ marginTop: 12, textAlign: "left", maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>`,
  ],
  [`<Delete size={26} />`, `<Delete size={26} strokeWidth={1.75} />`],
];

let n = 0;
for (const [a, b] of reps) {
  if (s.includes(a)) {
    s = s.replace(a, b);
    n++;
    console.log("patched:", a.slice(0, 60).replace(/\n/g, " "));
  } else {
    console.log("skip (not found):", a.slice(0, 60).replace(/\n/g, " "));
  }
}

fs.writeFileSync(p, s);
console.log("done patches", n);
console.log("emoji left:", {
  dish: s.includes("📡"),
  phone: s.includes("📱"),
  chat: s.includes("💬"),
});
