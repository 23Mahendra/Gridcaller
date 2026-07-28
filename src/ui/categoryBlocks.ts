export type GridCallerTab = "mesh" | "contacts" | "keypad" | "sms" | "groups" | "logs";

export type GridCallerMenuView =
  | "map"
  | "settings"
  | "radio"
  | "profile"
  | "tower"
  | "devices"
  | "share"
  | "privacy"
  | "emergency"
  | "logs";

export type GridCallerQuickActionFeature = "online" | "groupchat" | GridCallerMenuView;

export type CategoryBlockDefinition<T extends string> = {
  id: T;
  title: string;
  description: string;
  destination: "tab" | "menu" | "action";
};

export const GRIDCALLER_TAB_BLOCKS: readonly CategoryBlockDefinition<GridCallerTab>[] = [
  { id: "mesh", title: "Mesh", description: "Connected peers and devices.", destination: "tab" },
  { id: "contacts", title: "Contacts", description: "Saved contacts.", destination: "tab" },
  { id: "sms", title: "Messages", description: "Direct messages.", destination: "tab" },
  { id: "groups", title: "Gridchat", description: "Group chats.", destination: "tab" },
  { id: "logs", title: "Logs", description: "Communication history.", destination: "tab" },
] as const;

export const GRIDCALLER_MENU_BLOCKS: readonly CategoryBlockDefinition<GridCallerQuickActionFeature>[] = [
  { id: "online", title: "Online", description: "Connected devices.", destination: "action" },
  { id: "emergency", title: "Emergency", description: "SOS and emergency controls.", destination: "menu" },
  { id: "groupchat", title: "Gridchat", description: "Chats and groups.", destination: "action" },
  { id: "logs", title: "Logs", description: "Event history.", destination: "menu" },
  { id: "radio", title: "Radio", description: "Radio channels.", destination: "menu" },
  { id: "share", title: "Share App", description: "Share app.", destination: "menu" },
  { id: "devices", title: "Devices", description: "Connected devices.", destination: "menu" },
  { id: "tower", title: "Network", description: "Network status.", destination: "menu" },
  { id: "profile", title: "Profile", description: "User profile.", destination: "menu" },
  { id: "map", title: "Map", description: "Live map.", destination: "menu" },
  { id: "settings", title: "Settings", description: "Settings.", destination: "menu" },
] as const;

export const GRIDCALLER_MENU_QUICK_HINTS: Readonly<Record<GridCallerMenuView, { title: string; subtitle: string }>> = {
  emergency: {
    title: "Emergency quick actions",
    subtitle: "Long-press to jump into SOS, disaster, relay, and radio controls.",
  },
  logs: {
    title: "Log quick actions",
    subtitle: "Long-press to refresh, filter, or clear logs fast.",
  },
  share: {
    title: "Share quick actions",
    subtitle: "Long-press to share APK, create Wi-Fi link, or refresh APK inventory.",
  },
  privacy: {
    title: "Privacy quick actions",
    subtitle: "Long-press for privacy toggle, radio identity, and emergency shortcuts.",
  },
  devices: {
    title: "Device quick actions",
    subtitle: "Long-press for device, network, map, and sharing shortcuts.",
  },
  tower: {
    title: "Network quick actions",
    subtitle: "Long-press for network, map, device, and privacy shortcuts.",
  },
  radio: {
    title: "Radio quick actions",
    subtitle: "Long-press for radio power, privacy, and network shortcuts.",
  },
  profile: {
    title: "Profile quick actions",
    subtitle: "Long-press for profile, contacts, settings, and logs.",
  },
  map: {
    title: "Map quick actions",
    subtitle: "Long-press for map, network, devices, and emergency jumps.",
  },
  settings: {
    title: "Settings quick actions",
    subtitle: "Long-press for settings, profile, privacy, and log shortcuts.",
  },
};

const SUPPORTED_TAB_IDS = new Set<GridCallerTab>(["mesh", "contacts", "keypad", "sms", "groups", "logs"]);

export function normalizeGridCallerTab(raw: string, fallback: GridCallerTab = "groups"): GridCallerTab {
  return SUPPORTED_TAB_IDS.has(raw as GridCallerTab) ? (raw as GridCallerTab) : fallback;
}

export function getMenuQuickHint(view: GridCallerMenuView) {
  return GRIDCALLER_MENU_QUICK_HINTS[view];
}
