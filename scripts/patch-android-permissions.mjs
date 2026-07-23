/**
 * After cap sync, ensure AndroidManifest has full BT / Wi‑Fi / nearby permissions.
 * Does not wipe custom MainActivity / tools attrs — only adds missing permission names.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml");

const REQUIRED = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.CHANGE_WIFI_STATE",
  "android.permission.CHANGE_NETWORK_STATE",
  "android.permission.CHANGE_WIFI_MULTICAST_STATE",
  "android.permission.NEARBY_WIFI_DEVICES",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_ADVERTISE",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
];

if (!fs.existsSync(MANIFEST)) {
  console.log("[patch-android] No android project yet. Run: npx cap add android");
  process.exit(0);
}

let xml = fs.readFileSync(MANIFEST, "utf8");
let added = 0;

// Ensure tools namespace for usesPermissionFlags
if (!xml.includes("xmlns:tools=") && xml.includes("<manifest")) {
  xml = xml.replace(
    "<manifest",
    '<manifest xmlns:tools="http://schemas.android.com/tools"'
  );
}

for (const p of REQUIRED) {
  if (xml.includes(p)) continue;
  const tag = `    <uses-permission android:name="${p}" />\n`;
  if (xml.includes("<application")) {
    xml = xml.replace("<application", `${tag}<application`);
    added++;
  }
}

// cleartext for LAN hub
if (xml.includes("<application") && !xml.includes("usesCleartextTraffic")) {
  xml = xml.replace(
    /<application([^>]*)>/,
    '<application$1 android:usesCleartextTraffic="true">'
  );
  if (!xml.includes("usesCleartextTraffic")) {
    // already self-closing style? skip
  } else {
    added++;
  }
}

const features = [
  'android.hardware.microphone',
  'android.hardware.camera',
  'android.hardware.bluetooth',
  'android.hardware.bluetooth_le',
  'android.hardware.wifi',
];
for (const f of features) {
  if (xml.includes(f)) continue;
  const tag = `    <uses-feature android:name="${f}" android:required="false" />\n`;
  if (xml.includes("<application")) {
    xml = xml.replace("<application", `${tag}<application`);
    added++;
  }
}

fs.writeFileSync(MANIFEST, xml);
console.log(`[patch-android] OK — ensured BT/Wi‑Fi permissions (added ~${added})`);
