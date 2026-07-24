export type MeshVpnMode = "disabled" | "gateway" | "client";

export function resolveMeshVpnRole(mode: MeshVpnMode | string, online: boolean): MeshVpnMode {
  if (mode !== "gateway" && mode !== "client") return "disabled";
  if (!online && mode === "gateway") return "client";
  return mode;
}
