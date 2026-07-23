export type MenuBridgeStatus = {
  ready: boolean;
  text: string;
  detail: string;
};

export function normalizeBridgeStatus(input: any): MenuBridgeStatus {
  if (!input) {
    return {
      ready: false,
      text: "Bridge offline",
      detail: "The local hub is not responding yet.",
    };
  }

  const ok = Boolean(input.ok || input.ready || input.connected || input.status === "ok");
  const detail = String(
    input.message || input.detail || input.status || "Hub bridge available when the desktop hub is running"
  ).trim();

  return {
    ready: ok,
    text: ok ? "GitHub bridge ready" : "Bridge idle",
    detail: detail || (ok ? "Self-hosting bridge available on the local hub" : "Hub bridge pending"),
  };
}
