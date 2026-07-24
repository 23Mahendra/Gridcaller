export function resolveMeshVpnRole(mode, online) {
  if (mode !== "gateway" && mode !== "client") return "disabled";
  if (!online && mode === "gateway") return "client";
  return mode;
}
