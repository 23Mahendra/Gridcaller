/**
 * Copy built APK into share/ so hub can serve WiFi download + Share sheet.
 * Also writes version.json for OTA push to phones already on mesh.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SHARE = path.join(ROOT, "share");
fs.mkdirSync(SHARE, { recursive: true });

const candidates = [
  path.join(ROOT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  path.join(ROOT, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
  path.join(ROOT, "android", "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk"),
];

let found = null;
for (const c of candidates) {
  if (fs.existsSync(c)) {
    found = c;
    break;
  }
}

if (!found) {
  console.log("[apk:copy] No APK found yet. Build in Android Studio first.");
  console.log("  Expected:", candidates[0]);
  process.exit(0);
}

const dest = path.join(SHARE, "GridCaller.apk");
fs.copyFileSync(found, dest);
const st = fs.statSync(dest);

// Read version from build.gradle or appVersion.ts
function readVersion() {
  try {
    const gradle = fs.readFileSync(
      path.join(ROOT, "android", "app", "build.gradle"),
      "utf8"
    );
    const code = /versionCode\s+(\d+)/.exec(gradle);
    const name = /versionName\s+"([^"]+)"/.exec(gradle);
    if (code) {
      return {
        versionCode: Number(code[1]),
        versionName: name ? name[1] : String(code[1]),
      };
    }
  } catch {}
  try {
    const ts = fs.readFileSync(path.join(ROOT, "src", "kernel", "appVersion.ts"), "utf8");
    const code = /APP_VERSION_CODE\s*=\s*(\d+)/.exec(ts);
    const name = /APP_VERSION_NAME\s*=\s*"([^"]+)"/.exec(ts);
    if (code) {
      return {
        versionCode: Number(code[1]),
        versionName: name ? name[1] : String(code[1]),
      };
    }
  } catch {}
  return { versionCode: Math.floor(st.mtimeMs / 1000), versionName: "build" };
}

const ver = {
  ...readVersion(),
  force: true,
  notes: "PC push — multi-path mesh + auto OTA",
  apk: "GridCaller.apk",
  size: st.size,
  mtime: st.mtimeMs,
  updatedAt: Date.now(),
};
fs.writeFileSync(path.join(SHARE, "version.json"), JSON.stringify(ver, null, 2));

console.log(`[apk:copy] OK → ${dest} (${Math.round(st.size / 1024)} KB)`);
console.log(`[apk:copy] version ${ver.versionName} (code ${ver.versionCode})`);
console.log("  WiFi: http://192.168.1.8:8765/share/GridCaller.apk");
console.log("  OTA:  POST /api/update/push  (phones auto-open Install)");
