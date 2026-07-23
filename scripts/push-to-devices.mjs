/**
 * Build → copy APK → ADB install (if USB) → hub OTA push (Wi‑Fi mesh phones).
 * Usage: node scripts/push-to-devices.mjs
 *        npm run push
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ADB =
  process.env.ADB ||
  path.join(
    process.env.LOCALAPPDATA || "",
    "Android",
    "Sdk",
    "platform-tools",
    "adb.exe"
  );
const HUB = process.env.GRIDCALLER_HUB || "http://127.0.0.1:8765";

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    ...opts,
  });
  return r.status === 0;
}

function httpJson(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, HUB);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 8765,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
          } catch (e) {
            resolve({ ok: false, raw: Buffer.concat(chunks).toString("utf8") });
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

console.log("══════════════════════════════════════════════");
console.log(" GridCaller PUSH → mesh phones + ADB");
console.log("══════════════════════════════════════════════");

// 1) Web build + cap sync
if (!run("npm", ["run", "build"])) {
  console.error("[push] build failed");
  process.exit(1);
}
run("npx", ["cap", "sync", "android"]);
run("node", ["scripts/patch-android-permissions.mjs"]);

// 2) Gradle APK
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
if (!run(gradlew, ["assembleDebug"], { cwd: path.join(ROOT, "android") })) {
  console.error("[push] assembleDebug failed");
  process.exit(1);
}

// 3) Copy to share + version.json
if (!run("node", ["server/copy-apk.mjs"])) {
  console.error("[push] apk copy failed");
  process.exit(1);
}

const apk = path.join(ROOT, "share", "GridCaller.apk");
if (!fs.existsSync(apk)) {
  console.error("[push] missing", apk);
  process.exit(1);
}

// 4) ADB install if devices present
let adbInstalled = 0;
if (fs.existsSync(ADB)) {
  const list = spawnSync(ADB, ["devices"], { encoding: "utf8" });
  const lines = String(list.stdout || "")
    .split(/\r?\n/)
    .filter((l) => /\tdevice$/.test(l));
  console.log(`[push] ADB devices: ${lines.length}`);
  for (const line of lines) {
    const serial = line.split(/\s+/)[0];
    console.log(`[push] adb install -r → ${serial}`);
    const r = spawnSync(ADB, ["-s", serial, "install", "-r", apk], {
      stdio: "inherit",
    });
    if (r.status === 0) adbInstalled++;
  }
} else {
  console.log("[push] adb not found — OTA mesh push only");
}

// 5) Hub OTA push (phones already running old APK on same Wi‑Fi)
try {
  const health = await httpJson("GET", "/api/health");
  console.log(
    `[push] hub ok · meshPeers=${(health.meshPeers || []).length} httpPeers=${(health.httpMeshPeers || []).length}`
  );
  const pushed = await httpJson("POST", "/api/update/push", { force: true });
  console.log("[push] OTA:", JSON.stringify(pushed));
} catch (e) {
  console.warn("[push] hub push failed (is hub running?):", e?.message || e);
  console.warn("  Start: npm run hub");
}

console.log("\n══════════════════════════════════════════════");
console.log(` ADB installs: ${adbInstalled}`);
console.log(` APK: ${apk}`);
console.log(` WiFi: http://192.168.1.8:8765/share/GridCaller.apk`);
console.log(" Phones with GridCaller OPEN on same Wi‑Fi:");
console.log("   → auto OTA Install prompt (tap Install once)");
console.log("══════════════════════════════════════════════");
