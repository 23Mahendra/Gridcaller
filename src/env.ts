/**
 * Environment — LOCAL ONLY
 * No cloud API keys. No Twilio. No OpenRouter.
 * Off-grid style: Ollama/local mesh only.
 */

export interface EnvConfig {
  // Intentionally empty cloud keys — never load secrets from .env for cloud LLMs
  appName: string;
  appPort: number;
  defaultLang: string;
  defaultDarkMode: boolean;
  ollamaBaseUrl: string;
  meshAppId: string;
  meshRoomId: string;
  gunPeers: string;
  iceServersJson: string;
  emergencyNumber: string;
  appVersion: string;
  peerPath: string;
  sentryDsn: string;
}

/** Hard local-only config — cloud keys always blank */
const viteEnv = ((import.meta as any)?.env || {}) as Record<string, any>;

export const env: EnvConfig = {
  appName: viteEnv.VITE_APP_NAME || "GridAlive Universal",
  appPort: Number(viteEnv.VITE_APP_PORT) || 3001,
  defaultLang: viteEnv.VITE_DEFAULT_LANG || "en",
  defaultDarkMode: viteEnv.VITE_DEFAULT_DARK_MODE !== "false",
  ollamaBaseUrl: viteEnv.VITE_OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  meshAppId: "gridalive-mesh",
  meshRoomId: "gridalive-mesh",
  gunPeers: "", // no central gun relay required
  peerPath: "/peerjs",
  iceServersJson: "",
  emergencyNumber: "112",
  appVersion: "3.0.0-local",
  sentryDsn: viteEnv.VITE_SENTRY_DSN || "",
};

export const DEMO_MODE = false;
export const IS_PRODUCTION = Boolean(viteEnv.PROD);
/** App runs fully offline-capable — no cloud keys expected */
export const LOCAL_ONLY = true;

export function getEnvKey(_provider: string): string {
  return "";
}

export function getEnvApis(): Array<{
  id: number;
  name: string;
  key: string;
  provider: string;
  model: string;
  active: boolean;
  isDefault: boolean;
}> {
  // Only advertise local Ollama — never cloud providers from env
  return [
    {
      id: 1,
      name: "Ollama (local)",
      key: "local",
      provider: "Ollama",
      model: "auto",
      active: true,
      isDefault: true,
    },
  ];
}

export default env;
