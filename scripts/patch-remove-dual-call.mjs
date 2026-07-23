import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "GridCaller.tsx");
let s = fs.readFileSync(p, "utf8");
const start = s.indexOf("  // Incoming RING + OFFER — fullscreen Accept UI + ringtone + WebRTC answer");
const end = s.indexOf("  const hangup = (reason = \"hangup\") => {");
if (start < 0 || end < 0) {
  console.error("markers", start, end);
  process.exit(1);
}
const rep = `  // Call signaling: kernel/callSession (always-on). UI synced via onCallUi.
  useEffect(() => {
    startCallSession();
  }, []);

`;
s = s.slice(0, start) + rep + s.slice(end);
fs.writeFileSync(p, s);
console.log("dual listener removed");
