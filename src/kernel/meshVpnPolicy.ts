export type MeshVpnMode = "disabled" | "gateway" | "client";

export function resolveMeshVpnRole(mode: MeshVpnMode | string, online: boolean): MeshVpnMode {
  if (mode !== "gateway" && mode !== "client") return "disabled";
  if (!online && mode === "gateway") return "client";
  return mode;
}

export function describeMeshVpnPreview(mode: MeshVpnMode | string, online: boolean): string {
  const resolved = resolveMeshVpnRole(mode, online);
  if (resolved === "gateway") {
    return "Gateway preview: local traffic can be routed through the mesh when a real internet path is available.";
  }
  if (resolved === "client") {
    return "Client preview: this device will use the mesh for shared internet when a gateway is reachable.";
  }
  return "Mesh VPN preview disabled. The app will continue to run the local mesh without tunneling traffic.";
}
