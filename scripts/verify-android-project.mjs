import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "android/gradlew",
  "android/gradle/wrapper/gradle-wrapper.jar",
  "android/gradle/wrapper/gradle-wrapper.properties",
  "android/settings.gradle",
  "android/capacitor.settings.gradle",
  "android/build.gradle",
  "android/app/build.gradle",
  "android/app/capacitor.build.gradle",
  "android/app/src/main/AndroidManifest.xml",
];

const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error("Android project validation failed. Missing:");
  for (const rel of missing) console.error(` - ${rel}`);
  process.exit(1);
}

const props = fs.readFileSync(path.join(root, "android/gradle/wrapper/gradle-wrapper.properties"), "utf8");
if (!/distributionUrl=.*gradle-[0-9.]+-(?:all|bin)\.zip/.test(props)) {
  console.error("Android project validation failed: invalid Gradle wrapper distribution URL.");
  process.exit(1);
}

const settings = fs.readFileSync(path.join(root, "android/settings.gradle"), "utf8");
if (!/:app\b/.test(settings) || !/capacitor\.settings\.gradle/.test(settings)) {
  console.error("Android project validation failed: Capacitor Android settings are incomplete.");
  process.exit(1);
}

const appGradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
if (!/applicationId\s+"app\.gridalive\.gridcaller"/.test(appGradle)) {
  console.error("Android project validation failed: unexpected applicationId.");
  process.exit(1);
}

console.log("Android project validation passed.");
