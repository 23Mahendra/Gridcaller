import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Android manifest not found: ${manifestPath}`);
}

const requiredPermissions = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.CHANGE_WIFI_MULTICAST_STATE",
  "android.permission.NEARBY_WIFI_DEVICES",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_ADVERTISE",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
];

let manifest = fs.readFileSync(manifestPath, "utf8");
const missing = requiredPermissions.filter((permission) => !manifest.includes(`android:name="${permission}"`));
if (missing.length) {
  const declarations = missing.map((permission) => `    <uses-permission android:name="${permission}" />`).join("\n");
  manifest = manifest.replace(/(<application\b)/, `${declarations}\n    $1`);
}

if (!/android:usesCleartextTraffic="true"/.test(manifest)) {
  manifest = manifest.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
}

fs.writeFileSync(manifestPath, manifest);
console.log(`[android-permissions] verified ${requiredPermissions.length} required permissions${missing.length ? `; added ${missing.length}` : ""}`);
