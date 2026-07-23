/**
 * Environment — LOCAL ONLY
 * No cloud API keys. No Twilio. No OpenRouter.
 * Off-grid style: Ollama/local mesh only.
 */

export interface EnvConfig {
  // Intentionally empty cloud keys — never load secrets from .env for cloud LLMs
  openrouterKey: string;
  anthropicKey: string;
  geminiKey: string;
  openaiKey: string;
  groqKey: string;
  grokKey: string;
  cohereKey: string;
  mistralKey: string;
  togetherKey: string;
  huggingfaceKey: string;
  appName: string;
  appPort: number;
  defaultLang: string;
  defaultDarkMode: boolean;
  apiBridgeBaseUrl: string;
  ollamaBaseUrl: string;
  meshAppId: string;
  meshRoomId: string;
  gunPeers: string;
  peerHost: string;
  peerPort: number;
  peerPath: string;
  peerSecure: boolean;
  peerKey: string;
  iceServersJson: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhone: string;
  emergencyNumber: string;
  sentryDsn: string;
  sentryEnvironment: string;
  appVersion: string;
}

/** Hard local-only config — cloud keys always blank */
export const env: EnvConfig = {
  openrouterKey: "",
  anthropicKey: "",
  geminiKey: "",
  openaiKey: "",
  groqKey: "",
  grokKey: "",
  cohereKey: "",
  mistralKey: "",
  togetherKey: "",
  huggingfaceKey: "",
  appName: import.meta.env.VITE_APP_NAME || "GridAlive Universal",
  appPort: Number(import.meta.env.VITE_APP_PORT) || 3001,
  defaultLang: import.meta.env.VITE_DEFAULT_LANG || "en",
  defaultDarkMode: import.meta.env.VITE_DEFAULT_DARK_MODE !== "false",
  apiBridgeBaseUrl: "",
  ollamaBaseUrl: import.meta.env.VITE_OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  meshAppId: "gridalive-mesh",
  meshRoomId: "gridalive-mesh",
  gunPeers: "", // no central gun relay required
  peerHost: "",
  peerPort: 0,
  peerPath: "/peerjs",
  peerSecure: false,
  peerKey: "peerjs",
  iceServersJson: "",
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioPhone: "",
  emergencyNumber: "112",
  sentryDsn: "",
  sentryEnvironment: "local",
  appVersion: "3.0.0-local",
};

export const DEMO_MODE = false;
export const IS_PRODUCTION = import.meta.env.PROD;
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
