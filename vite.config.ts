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
      // Ollama local LLM gateway (localhost:11434)
      "/api/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ollama/, ""),
      },
      // Off Grid AI / any OpenAI-compatible local gateway (localhost:7878/v1)
      "/api/offgrid": {
        target: "http://127.0.0.1:7878/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/offgrid/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ["peerjs", "gun/gun", "trystero", "qrcode"],
  },
  // Capacitor loads from file:// or android assets — relative base
  base: "./",
});
