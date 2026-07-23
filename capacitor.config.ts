import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.gridalive.gridcaller",
  appName: "GridCaller",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // cleartext to LAN hub (ws/http to PC IP)
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    StatusBar: {
      style: "DARK",
      backgroundColor: "#000000",
      // Critical: false = WebView below status bar (no top cut-off)
      overlaysWebView: false,
    },
  },
};

export default config;
