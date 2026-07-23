// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Type definitions for Lego Block Architecture
// ═══════════════════════════════════════════════════════

import type { ReactNode, ComponentType } from "react";

/** Category of a Lego block */
export type BlockCategory = "core" | "medical" | "people" | "tools" | "ai" | "studio" | "settings";

/** Lifecycle hook */
export type LifecycleHook = () => void | (() => void);

/** Block manifest — the "label on the Lego box" */
export interface BlockManifest {
  /** Unique block ID — must be URL-safe, e.g. "blood", "ai", "radio" */
  id: string;
  /** Human-visible label */
  label: string;
  /** Category for sidebar grouping */
  category: BlockCategory;
  /** Lucide icon name or custom icon element */
  icon?: string;
  /** Block description (shown in settings/store) */
  description?: string;
  /** Semver string */
  version?: string;
  /** Author / source repo */
  author?: string;
  /** Other block IDs this block depends on */
  dependencies?: string[];
  /** If true, block appears in bottom nav */
  pinToBottom?: boolean;
  /** Priority for ordering (lower = earlier) */
  order?: number;
  /** If true, block is enabled by default. Defaults to true */
  enabled?: boolean;
  /** Minimum kernel version required */
  minKernelVersion?: string;
  /** Tags for search/filtering */
  tags?: string[];
  /** GitHub repo source (for plug-and-play installs) */
  source?: string;
}

/** Props injected into every block component by the kernel */
export interface BlockProps {
  user: any;
  C: Theme;
  MeshEngine: MeshEngineAPI;
  S: StorageAPI;
  lang?: string;
  setTab?: (id: string) => void;
  setUser?: (u: any) => void;
  apis?: any[];
  setApis?: (a: any[]) => void;
  isOnline?: boolean;
  darkMode?: boolean;
  setDarkMode?: (v: boolean) => void;
  setLang?: (v: string) => void;
  /** Feature flags/state */
  features?: Record<string, any>;
  /** Render a named feature */
  renderFeature?: (featureId: string) => any;
  /** Access other blocks' exposed APIs */
  getBlockAPI?: <T = any>(blockId: string) => T | undefined;
  /** All GitHub-sourced plugin services */
  plugins?: {
    /** PeerJS + Trystero mesh networking */
    mesh: any;
    /** GunDB decentralized database */
    gun: any;
    /** TweetNaCl encryption */
    crypto: any;
    /** Toast notifications */
    notify: any;
    /** QR scanner */
    qr: any;
    /** Dexie offline database collections */
    db: any;
    /** i18next translation */
    i18n: any;
    /** LocalForage stores */
    store: any;
    /** Event bus */
    bus: any;
  };
}

/** A registered Lego Block (plugin) */
export interface LegoBlock {
  manifest: BlockManifest;
  /** React component for the block's main view */
  component: ComponentType<BlockProps>;
  /** Optional: API surface this block exposes to other blocks */
  api?: Record<string, (...args: any[]) => any>;
  /** Optional: Lifecycle — called when block is activated */
  onMount?: LifecycleHook;
  /** Optional: Lifecycle — called when block is deactivated */
  onUnmount?: LifecycleHook;
  /** Optional: Toolbar items this block injects into bottom/quick bar */
  toolbarItems?: ToolbarItem[];
  /** Optional: Quick actions contributed to action bar */
  quickActions?: QuickAction[];
  /** Optional: Background service (runs even when block tab isn't active) */
  backgroundService?: () => (() => void);
}

/** Theme color palette */
export interface Theme {
  bg: string; card: string; card2: string; card3: string;
  border: string; borderBright: string;
  accent: string; accent2: string;
  green: string; greenDim: string;
  blue: string; blueDim: string;
  teal: string; tealDim: string;
  purple: string; purpleDim: string;
  gold: string; goldDim: string;
  pink: string; pinkDim: string;
  cyan: string; cyanDim: string;
  red: string; redDim: string;
  text: string; muted: string; muted2: string;
  shadow: string;
  [key: string]: string;
}

/** Storage interface */
export interface StorageAPI {
  get: (key: string, defaultValue?: any) => any;
  set: (key: string, value: any) => void;
}

/** MeshEngine interface */
export interface MeshEngineAPI {
  broadcast: (type: string, data: any) => void;
  onMessage: (fn: (msg: any) => void) => () => void;
  localId: string;
  peers: Record<string, any>;
  initWebRTC?: () => RTCPeerConnection | null;
}

/** Toolbar/bottom nav item */
export interface ToolbarItem {
  id: string;
  icon: ReactNode;
  label: string;
}

/** Quick action bar item */
export interface QuickAction {
  id: string;
  icon: ReactNode;
  label: string;
  color: string;
  action: () => void;
  category?: string;
}

/** Category metadata */
export interface CategoryMeta {
  label: string;
  color: string;
  icon?: ReactNode;
}

/** Block store entry (for future GitHub-based block install) */
export interface BlockStoreEntry {
  manifest: BlockManifest;
  repoUrl: string;
  stars?: number;
  downloads?: number;
  lastUpdate?: string;
  readme?: string;
  installed?: boolean;
}

/** Event bus message */
export interface BusMessage {
  type: string;
  payload: any;
  source: string;
  timestamp: number;
}
