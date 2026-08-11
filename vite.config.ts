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
      "/api/rag": {
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
      // LM Studio (localhost:1234)
      "/api/lmstudio": {
        target: "http://127.0.0.1:1234/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/lmstudio/, ""),
      },
      // Jan.ai (localhost:1337)
      "/api/janai": {
        target: "http://127.0.0.1:1337/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/janai/, ""),
      },
      // llama.cpp server (localhost:8080)
      "/api/llamacpp": {
        target: "http://127.0.0.1:8080/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llamacpp/, ""),
      },
      // text-generation-webui (localhost:5000)
      "/api/textgenui": {
        target: "http://127.0.0.1:5000/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/textgenui/, ""),
      },
      // GPT4All (localhost:4891)
      "/api/gpt4all": {
        target: "http://127.0.0.1:4891/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gpt4all/, ""),
      },
      // AnythingLLM (localhost:3001)
      "/api/anythingllm": {
        target: "http://127.0.0.1:3001/api/v1/openai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anythingllm/, ""),
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
  // Default to relative base for Capacitor/file://; allow override for GitHub Pages.
  base: process.env.VITE_PUBLIC_BASE || "./",
});
