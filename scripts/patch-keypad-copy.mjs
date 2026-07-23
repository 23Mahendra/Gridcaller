import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "GridCaller.tsx");
let s = fs.readFileSync(p, "utf8");

const start = s.indexOf('{tab === "keypad" && (');
if (start < 0) {
  console.error("keypad block start not found");
  process.exit(1);
}
// Find matching close of this tab block: `\n        )}\n\n        {/* Contact detail`
const endMarker = "\n        )}\n\n        {/* Contact detail sheet */}";
const end = s.indexOf(endMarker, start);
if (end < 0) {
  console.error("keypad block end not found");
  process.exit(1);
}

const keypadBlock = `{tab === "keypad" && (
          <div style={{ padding: "20px 16px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: tokens.secondary, marginBottom: 8, fontWeight: 600 }}>
              Enter number or ID
            </div>
            <div style={{ minHeight: 48, fontSize: 32, fontWeight: 300, letterSpacing: 2, marginBottom: 8, wordBreak: "break-all", color: tokens.text }}>
              {dial || (
                <span style={{ color: tokens.label, fontSize: 15, fontWeight: 500 }}>
                  Type a phone number or user ID
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, maxWidth: 280, margin: "0 auto" }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                <button key={d} type="button" onClick={() => setDial((p) => p + d)} style={keyStyleOf(tokens)}>
                  {d}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 14 }}>
              {"abcdef_+-".split("").map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDial((p) => p + c)}
                  style={{ ...keyStyleOf(tokens), width: 40, height: 40, fontSize: 15, borderRadius: 20 }}
                >
                  {c}
                </button>
              ))}
            </div>
            {dial.trim() && (
              <button
                type="button"
                onClick={() => openNewContact({ name: dial.trim(), phones: looksLikePhoneNumber(dial) ? [dial.trim()] : [], peerId: !looksLikePhoneNumber(dial) ? dial.trim() : undefined, source: "manual" } as any)}
                style={{ ...contactChipStyle(tokens), marginTop: 12 }}
              >
                <UserPlus size={14} /> Save to contacts
              </button>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setDial((p) => p.slice(0, -1))}
                style={{ border: "none", background: "none", cursor: "pointer", color: tokens.text, padding: 8 }}
              >
                <Delete size={26} strokeWidth={1.75} />
              </button>
            </div>

            <div style={{ marginTop: 12, textAlign: "left", maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: tokens.secondary, marginBottom: 8 }}>
                CALL
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a number or ID");
                    callMeshNetwork(raw, raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: "none",
                    background: tokens.green,
                    color: "#FFFFFF",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Network size={18} strokeWidth={2} />
                  Network call
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a phone number");
                    void callAnyMobile(raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: "none",
                    background: tokens.blue,
                    color: "#FFFFFF",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Phone size={18} strokeWidth={2} />
                  Phone call
                </button>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: tokens.secondary, marginBottom: 8 }}>
                MESSAGE
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a number or ID");
                    msgMeshNetwork(raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: \`1px solid \${tokens.sep}\`,
                    background: tokens.card,
                    color: tokens.text,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: tokens.shadow,
                  }}
                >
                  <MessageCircle size={18} strokeWidth={2} color={tokens.blue} />
                  Network message
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a phone number");
                    void msgAnyMobile(raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: \`1px solid \${tokens.sep}\`,
                    background: tokens.card,
                    color: tokens.text,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: tokens.shadow,
                  }}
                >
                  <MessageSquare size={18} strokeWidth={2} color={tokens.blue} />
                  Text message
                </button>
              </div>
            </div>
          </div>
        )}`;

s = s.slice(0, start) + keypadBlock + s.slice(end);

// Extra cleanups
const extras = [
  ['placeholder="Mesh ID / name or 10-digit mobile"', 'placeholder="Number, name, or user ID"'],
  ['placeholder="Mesh ID / name · ya · 10-digit mobile"', 'placeholder="Number, name, or user ID"'],
  ['setErr("Enter mesh ID")', 'setErr("Enter a number or ID")'],
  ['setErr("Mesh ID / peer likho")', 'setErr("Enter a number or ID")'],
  ['setErr("Enter Mesh ID")', 'setErr("Enter a number or ID")'],
];
for (const [a, b] of extras) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    console.log("extra:", a.slice(0, 40));
  }
}

fs.writeFileSync(p, s);
console.log("keypad block replaced OK");
console.log("has Call mesh:", s.includes("Call mesh"));
console.log("has Network call:", s.includes("Network call"));
console.log("has ya ·:", s.includes("ya ·"));
console.log("has Hinglish help:", s.includes("reach any phone"));
