import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api/mesh": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
      "/api/health": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
      "/mesh-ws": {
        target: "ws://127.0.0.1:8765",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) return;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalized)) return "vendor-react";
          if (normalized.includes("/node_modules/@capacitor/")) return "vendor-capacitor";
          if (normalized.includes("/node_modules/leaflet/")) return "vendor-maps";
          if (normalized.includes("/node_modules/gun/")) return "vendor-gun";
          if (/\/node_modules\/(peerjs|simple-peer|trystero|libp2p|peer|uuid|ws)\//.test(normalized)) {
            return "vendor-mesh";
          }
          if (normalized.includes("/node_modules/@sentry/")) return "vendor-sentry";
          if (normalized.includes("/node_modules/lucide-react/")) return "vendor-icons";
          return "vendor-misc";
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  optimizeDeps: {
    include: ["peerjs", "gun/gun", "trystero", "qrcode"],
  },
  // Capacitor loads from file:// or android assets — relative base
  base: "./",
});
