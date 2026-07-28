/**
 * GridCaller — sovereign free phone (iOS-class UI)
 * Synced with Mesh Comms + meshAppBridge for calls & messages.
 * Light + Dark themes (fixes dim dark-mode colors).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  MessageCircle, MessageSquare, Search, Mic, MicOff, Volume2, ChevronLeft,
  ChevronDown, ChevronUp, CheckCircle2, Circle,
  Delete, Plus, Star, StarOff, Ban, Pencil, Trash2, Download,
  Upload, UserPlus, X, Smartphone, Users, Menu, Map as MapIcon, Settings,
  Share2, Image as ImageIcon, IdCard, Wifi, Bluetooth, Shield, Sun, Moon, Power,
  Network, Radio, Video, VideoOff, SwitchCamera, Camera, BellOff, EllipsisVertical,
  CalendarDays, Sparkles, Home, Grid3X3,
} from "lucide-react";
import { bus } from "./kernel/bus";
import { removeStorageValue, S } from "./kernel/storage";
import { C as liveTheme } from "./kernel/theme";
import meshComms from "./kernel/meshCommsEngine";
import { MeshEngine } from "./kernel/mesh";
import omniMesh from "./kernel/omniMeshEngine";
import {
  ensureHubDefaults,
  fetchHubMeshPeers,
  probeHub,
  resolveHubHttp,
  resolveMeshTarget,
} from "./kernel/meshHubConfig";
import {
  addIceSafe,
  createCallPeerConnection,
  ensureRemoteAudioEl,
  flushIceQueue,
  getMicStream,
  playRemoteStream,
  setSpeakerphone,
} from "./kernel/realMedia";
import {
  playConnectTone,
  playFailTone,
  resumeAudioContext,
  startRingback,
  startRingtone,
  stopCallSounds,
} from "./kernel/callAudio";
import {
  acceptCall,
  endCall,
  onCallUi,
  rejectCall,
  startCallSession,
  startOutgoingCall,
  toggleMute,
  type CallUiState,
} from "./kernel/callSession";
import globalCall from "./kernel/globalCallEngine";
import sovereignMesh from "./kernel/sovereignMesh";
import gridNumberRegistry, { type LocalCommLogEntry } from "./kernel/gridNumberRegistry";
import meshAppBridge from "./kernel/meshAppBridge";
import softTower from "./kernel/softTowerEngine";
import sovereignCall from "./kernel/sovereignCall";
import contactsVault, { type GridContact } from "./kernel/contactsVault";
import {
  enableFreeRadioMeshDefaults,
  getForceLocalMesh,
  meshModeLabel,
  setForceLocalMesh,
} from "./kernel/offlineMode";
import freeRadio from "./kernel/radioMesh";
import softTowerHop from "./kernel/softTowerHopNet";
import freeMeshFabric from "./kernel/freeMeshFabric";
import pstnBridge, { looksLikePhoneNumber } from "./kernel/pstnBridge";
import { deviceVault } from "./kernel/deviceVault";
import {
  connectBluetoothWithPermission,
  connectWifiWithPassword,
  listBt,
  listWifi,
  networkStrengthReport,
  removeBt,
  removeWifi,
} from "./kernel/deviceConnect";
import { getDevicePanelStatus } from "./kernel/devicePanelStatus";
import { listConnectedDevices } from "./kernel/connectedDevices";
import {
  startAutoMesh,
  setAutoMeshGps,
  getPeers as getAutoMeshPeers,
  onPeers as onAutoMeshPeers,
  onPeerLocation,
  onStatus as onAutoMeshStatus,
  unifyLocalIdentity,
  type AutoMeshStatus,
} from "./kernel/autoMesh";
import { startFullAutoJoin } from "./kernel/autoJoin";
import { resolveFromDirectory } from "./kernel/meshDirectory";
import {
  appInviteText,
  downloadApkNow,
  getPrimaryApk,
  listApkFiles,
  shareAppViaSystem,
  shareAppWhatsApp,
  shareAppWifiLink,
} from "./kernel/shareApp";
import { getPrivacyStatus, isPrivacyMode, setPrivacyMode } from "./kernel/privacyMode";
import {
  getDisasterModeState,
  getEmergencyModeSummary,
  sendEmergencyBroadcast,
  sendSosBeacon,
  setDisasterMode,
  toggleDisasterBeaconing,
  toggleDisasterBroadcast,
  toggleLowBandwidthMode,
} from "./kernel/emergencyMode";
import {
  getHubHttp,
  getImmutableDisplayNumber,
  getLocalDeviceIdentity,
  getMeshHandle,
  rememberDeviceIdentity,
  syncLocalDeviceIdentity,
} from "./mesh/identity";
import { ghStatus } from "./github/ghClient";
import { normalizeBridgeStatus, type MenuBridgeStatus } from "./kernel/menuStatus";
import {
  cardShareText,
  clearInbox,
  compressImageFile,
  loadInbox,
  loadMyCard,
  receiveCard,
  saveMyCard,
  shareCardAnywhere,
  shareCardOnGridNetwork,
  shareCardWhatsApp,
  type ProfileCard,
} from "./kernel/userProfileCard";
import {
  loadPersistedRuntimeDiagnostics,
  persistRuntimeDiagnostics,
} from "./kernel/softTowerDiagnostics";
import gridCallerLogo from "../logo.png";

type Tokens = {
  bg: string;
  card: string;
  sep: string;
  label: string;
  text: string;
  secondary: string;
  blue: string;
  green: string;
  red: string;
  orange: string;
  fill: string;
  fill2: string;
  shadow: string;
  blur: string;
  bar: string;
  inputBg: string;
  dark: boolean;
};

function makeTokens(dark: boolean, C?: any): Tokens {
  if (dark) {
    return {
      bg: C?.bg || "#000000",
      card: C?.card || "#1c1c1e",
      sep: "rgba(84,84,88,0.55)",
      // Bright enough secondary labels on black (not muddy grey)
      label: "#C7C7CC",
      text: C?.text || "#FFFFFF",
      secondary: "#EBEBF0",
      blue: C?.blue || "#0A84FF",
      green: C?.green || "#30D158",
      red: C?.red || "#FF453A",
      orange: C?.gold || "#FF9F0A",
      fill: "rgba(120,120,128,0.36)",
      fill2: "rgba(120,120,128,0.28)",
      shadow: "0 1px 3px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.35)",
      blur: "saturate(180%) blur(20px)",
      bar: "rgba(28,28,30,0.94)",
      inputBg: C?.card2 || "#2c2c2e",
      dark: true,
    };
  }
  // Light: high contrast — body text pure black, labels readable grey (not dim #8E8E93)
  return {
    bg: "#F2F2F7",
    card: "#FFFFFF",
    sep: "rgba(60,60,67,0.18)",
    label: "#3A3A3C",
    text: "#000000",
    secondary: "#1C1C1E",
    blue: "#007AFF",
    green: "#248A3D",
    red: "#D70015",
    orange: "#C93400",
    fill: "rgba(120,120,128,0.16)",
    fill2: "rgba(120,120,128,0.12)",
    shadow: "0 1px 2px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)",
    blur: "saturate(180%) blur(20px)",
    bar: "rgba(255,255,255,0.92)",
    inputBg: "#FFFFFF",
    dark: false,
  };
}

const ThemeCtx = createContext<Tokens>(makeTokens(false));
function useT() {
  return useContext(ThemeCtx);
}

// Legacy alias used in module-level helpers — updated when component mounts via ThemeCtx
let T = makeTokens(false);

export type CallType = "audio" | "video";

type MessageFolder = "inbox" | "sent" | "received" | "draft" | "outbox" | "deleted" | "trash";

type SmsRow = {
  id: string;
  peerId: string;
  name: string;
  text: string;
  ts: number;
  mine: boolean;
  folder: MessageFolder;
  attachment?: GroupAttachment;
};

type GroupAttachmentKind = "image" | "audio" | "video" | "document" | "file" | "location";

type GroupAttachment = {
  kind: GroupAttachmentKind;
  name: string;
  mime?: string;
  size?: number;
  dataUrl?: string;
  lat?: number;
  lng?: number;
};

type GroupChat = {
  id: string;
  name: string;
  members: string[];
  createdAt: number;
  updatedAt: number;
};

type GroupMessage = {
  id: string;
  groupId: string;
  fromId: string;
  fromName: string;
  text: string;
  ts: number;
  mine: boolean;
  attachment?: GroupAttachment;
  system?: boolean;
};

type StatusPost = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  ts: number;
};

type StatusComment = {
  id: string;
  postId: string;
  fromId: string;
  fromName: string;
  text: string;
  ts: number;
};

type StatusReactionKind = "like" | "heart";

type StatusReaction = {
  postId: string;
  userId: string;
  kind: StatusReactionKind;
  ts: number;
};

type StatusViewLog = {
  postId: string;
  viewerId: string;
  viewerName: string;
  ts: number;
};

type ActionComposerMode = "contact" | "poll" | "event" | "schedule-call";

type ActionComposerTarget =
  | { kind: "direct"; peerId: string; peerName: string }
  | { kind: "group"; groupId: string; groupName: string };

type ActionComposerState = {
  mode: ActionComposerMode;
  target: ActionComposerTarget;
};

type Tab = "mesh" | "contacts" | "keypad" | "sms" | "groups" | "logs";

type GridchatFilter = "all" | "unread" | "favourites";

type MeshVisibleUser = {
  id: string;
  name: string;
  online: boolean;
  distance?: number;
  handle?: string;
  phone?: string;
  displayNumber?: string;
  lat?: number;
  lng?: number;
};

type MeshGraphNode = MeshVisibleUser & {
  xPct: number;
  yPct: number;
  hasLiveLocation: boolean;
};

function initials(n: string) {
  const p = (n || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
}

function hue(id: string) {
  const palette = ["#5856D6", "#007AFF", "#34C759", "#FF9500", "#AF52DE", "#FF2D55", "#5AC8FA", "#FF3B30"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 13) % palette.length;
  return palette[h];
}

function gridchatAlias(name: string, seed: string) {
  const clean = String(name || "User").trim() || "User";
  const suffix = ["Prime", "Link", "Node", "Wave", "Pulse", "Orbit", "Spark", "Core"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * 17) % suffix.length;
  const base = clean.replace(/\s+/g, " ").slice(0, 22);
  return `${base} ${suffix[h]}`;
}

function summarizeGroupAttachment(a?: GroupAttachment) {
  if (!a) return "";
  if (a.kind === "location") return "Shared location";
  if (a.kind === "image") return "Photo";
  if (a.kind === "audio") return "Audio";
  if (a.kind === "video") return "Video";
  if (a.kind === "document") return `Document: ${a.name}`;
  return `File: ${a.name}`;
}

function compactActionBtn(tokens: any) {
  return {
    border: `1px solid ${tokens.sep}`,
    background: tokens.fill,
    color: tokens.text,
    borderRadius: 10,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } as const;
}

function timeLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${time}`;
}

/** Full date + time for call log details */
function fullDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

type LogTopFilter = "all" | "calls" | "messages" | "blocked";
type LogSourceFilter = "all" | "local-device" | "mesh-network";
type CallDirectionFilter = "in" | "out" | "missed" | "blocked";
type MessageDirectionFilter = "inbox" | "sent" | "blocked";

const DEFAULT_CALL_LOG_FILTERS: CallDirectionFilter[] = ["in", "out", "missed", "blocked"];
const DEFAULT_MESSAGE_LOG_FILTERS: MessageDirectionFilter[] = ["inbox", "sent", "blocked"];

function logLooksLikeMeshId(value?: string) {
  return /^user_|^node_|^gc_|^web/i.test(String(value || "").trim());
}

function classifyLogSource(row: LocalCommLogEntry): LogSourceFilter {
  const method = String(row.method || "").toLowerCase();
  const peerId = String(row.peerId || "").trim();
  const peerNumber = String(row.peerNumber || "").trim();
  if (
    /mesh|gridcaller|webrtc|soft[- ]?tower|omni|walkie|bridge|sovereign|free[- ]?radio|network/.test(method) ||
    logLooksLikeMeshId(peerId)
  ) {
    return "mesh-network";
  }
  if (
    /pstn|tel|carrier|sim|cellular|sms-uri|device sms|phone call|text message/.test(method) ||
    (!peerId && looksLikePhoneNumber(peerNumber))
  ) {
    return "local-device";
  }
  return row.kind === "message" ? (peerId ? "mesh-network" : "local-device") : looksLikePhoneNumber(peerId || peerNumber) ? "local-device" : "mesh-network";
}

function getCallDirectionFilter(row: LocalCommLogEntry): CallDirectionFilter {
  if (row.direction === "blocked") return "blocked";
  if (row.direction === "missed") return "missed";
  if (row.direction === "in") return "in";
  return "out";
}

function getMessageDirectionFilter(row: LocalCommLogEntry): MessageDirectionFilter {
  if (row.direction === "blocked" || row.folder === "blocked" || row.kind === "block") return "blocked";
  if (row.direction === "out" || row.folder === "sent" || row.folder === "outbox" || row.folder === "draft") return "sent";
  return "inbox";
}

function sourceLabelForLog(row: LocalCommLogEntry) {
  return classifyLogSource(row) === "mesh-network" ? "Mesh network" : "Local device";
}

function logDirectionCopy(row: LocalCommLogEntry) {
  if (row.kind === "call") {
    if (row.direction === "in") return "Incoming call";
    if (row.direction === "out") return "Outgoing call";
    if (row.direction === "missed") return "Missed call";
    return "Blocked call";
  }
  if (row.kind === "block") return "Blocked contact";
  if (row.direction === "out") return "Sent message";
  if (row.direction === "blocked") return "Blocked message";
  return "Inbox message";
}

function logIconForRow(row: LocalCommLogEntry, color: string) {
  if (row.kind === "call") {
    if (row.direction === "in") return <PhoneIncoming size={15} color={color} />;
    if (row.direction === "out") return <PhoneOutgoing size={15} color={color} />;
    if (row.direction === "missed") return <PhoneMissed size={15} color={color} />;
    return <PhoneOff size={15} color={color} />;
  }
  if (row.kind === "block") return <Ban size={15} color={color} />;
  return <MessageSquare size={15} color={color} />;
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════
export default function GridCaller({
  user,
  C: themeProp,
  onClose,
  initialPeerId,
  initialPeerName,
  isVideo,
  isIncoming,
}: {
  user?: any;
  C?: any;
  S?: any;
  onClose?: () => void;
  initialCall?: any;
  initialPeerId?: string;
  initialPeerName?: string;
  isVideo?: boolean;
  isIncoming?: boolean;
}) {
  const myName = user?.name || S.get("user_name") || "Me";
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light") {
      return false;
    }
    if (S.get("dark_mode", null) === false || S.get("dark_mode", null) === "false") return false;
    if (S.get("dark_mode", null) === true || S.get("dark_mode", null) === "true") return true;
    return true; // default dark
  });
  /** Master switch: OFF = stop mesh/radio/calls UI (standby) */
  const [appEnabled, setAppEnabled] = useState(() => S.get("gc_app_enabled", true) !== false);
  const tokens = useMemo(() => makeTokens(!!darkMode, themeProp || liveTheme), [darkMode, themeProp]);
  T = tokens; // keep module helpers in sync

  useEffect(() => {
    S.set("dark_mode", darkMode);
    try {
      document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
      document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
      document.body.style.background = tokens.bg;
      document.body.style.color = tokens.text;
      document.documentElement.style.background = tokens.bg;
      document.documentElement.style.color = tokens.text;
    } catch {}
  }, [darkMode, tokens.bg, tokens.text]);

  useEffect(() => {
    S.set("gc_app_enabled", appEnabled);
    if (!appEnabled) {
      try {
        softTowerHop.stop();
      } catch {}
      try {
        void freeRadio.enable(false);
      } catch {}
      try {
        meshComms.stopPresence?.();
      } catch {}
      try {
        freeMeshFabric.stop?.();
      } catch {}
    } else {
      try {
        softTowerHop.start(myName);
        freeMeshFabric.start(myName);
        void freeRadio.enable(true);
        meshComms.startPresence?.(myName, "user");
      } catch {}
    }
  }, [appEnabled, myName]);

  useEffect(() => {
    deviceVault.ensure();
    void contactsVault
      .initLocalDb()
      .then(() => {
        setContacts(contactsVault.list());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const refreshLogs = () => setLocalCommLog(gridNumberRegistry.getLocalCommLog(300));
    refreshLogs();
    const offLocal = bus.on("gridNumber:local_comm_log", refreshLogs);
    const offSafety = bus.on("gridNumber:safety", refreshLogs);
    return () => {
      try { offLocal?.(); } catch {}
      try { offSafety?.(); } catch {}
    };
  }, []);

  const [tab, setTab] = useState<Tab>(() => {
    const raw = String(S.get("gridcaller_active_tab", "logs") || "logs").trim().toLowerCase();
    return raw === "mesh" || raw === "contacts" || raw === "keypad" || raw === "sms" || raw === "groups" || raw === "logs"
      ? (raw as Tab)
      : "logs";
  });
  const [q, setQ] = useState("");
  const [peers, setPeers] = useState<
    {
      id: string;
      name: string;
      online: boolean;
      distance?: number;
      handle?: string;
      phone?: string;
      displayNumber?: string;
    }[]
  >([]);
  const [sms, setSms] = useState<SmsRow[]>(() => S.get("gridcaller_sms", []));
  const [blocked, setBlocked] = useState<string[]>(() => S.get("gridcaller_blocked", []));
  const [dial, setDial] = useState("");
  const [thread, setThread] = useState<string | null>(null);
  const [smsDraft, setSmsDraft] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [messageFolder, setMessageFolder] = useState<MessageFolder>("inbox");
  const [composeTo, setComposeTo] = useState("");
  const [groupChats, setGroupChats] = useState<GroupChat[]>(() => S.get("gridcaller_group_chats", []));
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>(() => S.get("gridcaller_group_messages", []));
  const [groupViewId, setGroupViewId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");
  const [gridchatSearch, setGridchatSearch] = useState("");
  const [gridchatFilter, setGridchatFilter] = useState<GridchatFilter>("all");
  const [gridchatFavourites, setGridchatFavourites] = useState<string[]>(() => S.get("gridcaller_gridchat_favourites", []));
  const [gridchatMuted, setGridchatMuted] = useState<string[]>(() => S.get("gridcaller_gridchat_muted", []));
  const [gridchatLastSeen, setGridchatLastSeen] = useState<Record<string, number>>(() => S.get("gridcaller_gridchat_last_seen", {}));
  const [gridchatMyStatusText, setGridchatMyStatusText] = useState<string>(() => String(S.get("gridcaller_my_status_text", "") || ""));
  const [gridchatMyStatusAt, setGridchatMyStatusAt] = useState<number>(() => Number(S.get("gridcaller_my_status_at", 0) || 0));
  const [gridchatStatusPrivacy, setGridchatStatusPrivacy] = useState<"everyone" | "contacts" | "nobody">(() => {
    const raw = String(S.get("gridcaller_status_privacy", "everyone") || "everyone").toLowerCase();
    return raw === "contacts" || raw === "nobody" ? raw : "everyone";
  });
  const [gridchatStatusAutoClearHours, setGridchatStatusAutoClearHours] = useState<number>(() => {
    const raw = Number(S.get("gridcaller_status_auto_clear_h", 24) || 24);
    return Number.isFinite(raw) && raw >= 0 ? raw : 24;
  });
  const [gridchatStatusRingColor, setGridchatStatusRingColor] = useState<"blue" | "green" | "orange" | "red">(() => {
    const raw = String(S.get("gridcaller_status_ring_color", "blue") || "blue").toLowerCase();
    return raw === "green" || raw === "orange" || raw === "red" ? raw : "blue";
  });
  const [gridchatStatusStealthMode, setGridchatStatusStealthMode] = useState<boolean>(() => !!S.get("gridcaller_status_stealth", false));
  const [gridchatStatusArchive, setGridchatStatusArchive] = useState<{ text: string; at: number }[]>(() => {
    const rows = S.get("gridcaller_status_archive", []);
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.text === "string" && typeof r.at === "number").slice(0, 24) : [];
  });
  const [gridchatStatusSettingsOpen, setGridchatStatusSettingsOpen] = useState(false);
  const [statusPosts, setStatusPosts] = useState<StatusPost[]>(() => S.get("gridcaller_status_posts", []));
  const [statusComments, setStatusComments] = useState<StatusComment[]>(() => S.get("gridcaller_status_comments", []));
  const [statusReactions, setStatusReactions] = useState<StatusReaction[]>(() => S.get("gridcaller_status_reactions", []));
  const [statusViews, setStatusViews] = useState<StatusViewLog[]>(() => S.get("gridcaller_status_views", []));
  const [statusViewerPostId, setStatusViewerPostId] = useState<string | null>(null);
  const [statusCommentDraft, setStatusCommentDraft] = useState("");
  const [statusViewerUserId, setStatusViewerUserId] = useState<string | null>(null);
  const [actionComposer, setActionComposer] = useState<ActionComposerState | null>(null);
  const [actionComposerName, setActionComposerName] = useState("");
  const [actionComposerNumber, setActionComposerNumber] = useState("");
  const [actionComposerQuestion, setActionComposerQuestion] = useState("");
  const [actionComposerOptions, setActionComposerOptions] = useState("Yes\nNo");
  const [actionComposerTitle, setActionComposerTitle] = useState("");
  const [actionComposerWhen, setActionComposerWhen] = useState("");
  const [actionComposerPlace, setActionComposerPlace] = useState("");
  const [gridchatCreateMenuOpen, setGridchatCreateMenuOpen] = useState(false);
  const [gridchatMoreMenuOpen, setGridchatMoreMenuOpen] = useState(false);
  const [gridchatSubTab, setGridchatSubTab] = useState<"chats" | "updates" | "communities" | "calls">("chats");
  const [gridchatShowCreateForm, setGridchatShowCreateForm] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [groupSearchOpen, setGroupSearchOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupChatMenuOpen, setGroupChatMenuOpen] = useState(false);
  const [chatProfileView, setChatProfileView] = useState<{ peerId: string; name: string; source: "direct" | "group"; groupId?: string } | null>(null);
  const [chatProfileMetaVer, setChatProfileMetaVer] = useState(0);
  const [starredMessageIds, setStarredMessageIds] = useState<string[]>(() => {
    const rows = S.get("gridcaller_starred_messages", []);
    return Array.isArray(rows) ? rows.map((x) => String(x || "")).filter(Boolean).slice(0, 3000) : [];
  });
  const [directSelectMode, setDirectSelectMode] = useState(false);
  const [directSelectedMessageIds, setDirectSelectedMessageIds] = useState<string[]>([]);
  const [groupSelectMode, setGroupSelectMode] = useState(false);
  const [groupSelectedMessageIds, setGroupSelectedMessageIds] = useState<string[]>([]);
  const [smsThreadSelectMode, setSmsThreadSelectMode] = useState(false);
  const [selectedSmsThreadIds, setSelectedSmsThreadIds] = useState<string[]>([]);
  const [gridchatListSelectMode, setGridchatListSelectMode] = useState(false);
  const [selectedGridchatRowIds, setSelectedGridchatRowIds] = useState<string[]>([]);
  const [logsSelectMode, setLogsSelectMode] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [logSeenState, setLogSeenState] = useState<Record<string, boolean>>(() => S.get("gridcaller_log_seen_state", {}));
  const [threadShowStarredOnly, setThreadShowStarredOnly] = useState(false);
  const [groupShowStarredOnly, setGroupShowStarredOnly] = useState(false);
  const [gridchatReportLog, setGridchatReportLog] = useState<{ peerId: string; name: string; source: "direct" | "group"; ts: number }[]>(() => {
    const rows = S.get("gridcaller_report_log", []);
    return Array.isArray(rows)
      ? rows
        .filter((r) => r && typeof r.peerId === "string" && typeof r.name === "string" && typeof r.ts === "number")
        .slice(0, 500)
      : [];
  });
  const [directChatMenuOpen, setDirectChatMenuOpen] = useState(false);
  const [directAttachMenuOpen, setDirectAttachMenuOpen] = useState(false);
  const directMediaInputRef = useRef<HTMLInputElement>(null);
  const directDocumentInputRef = useRef<HTMLInputElement>(null);
  const directCameraInputRef = useRef<HTMLInputElement>(null);
  const directAudioInputRef = useRef<HTMLInputElement>(null);
  const groupMediaInputRef = useRef<HTMLInputElement>(null);
  const groupDocumentInputRef = useRef<HTMLInputElement>(null);
  const groupCameraInputRef = useRef<HTMLInputElement>(null);
  const groupAudioInputRef = useRef<HTMLInputElement>(null);
  const [groupAttachMenuOpen, setGroupAttachMenuOpen] = useState(false);
  const gridchatHeaderRef = useRef<HTMLDivElement>(null);
  const gridchatCreatePanelRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const [callScope, setCallScope] = useState<"auto" | "local" | "global">(() => {
    const saved = String(S.get("gridcaller_scope", "auto") || "auto").trim().toLowerCase();
    if (saved === "local" || saved === "global") {
      S.set("gridcaller_scope", "auto");
      return "auto";
    }
    return saved === "auto" ? "auto" : "auto";
  });
  const [groupSelection, setGroupSelection] = useState<string[]>([]);
  const [meshPeersCollapsed, setMeshPeersCollapsed] = useState(false);
  const [meshShareNote, setMeshShareNote] = useState("");
  const [meshTabFilter, setMeshTabFilter] = useState<"all" | "calls" | "messages">("all");
  const [meshSubView, setMeshSubView] = useState<"recents" | "people" | "keypad">("recents");
  const [onlineNowCollapsed, setOnlineNowCollapsed] = useState(false);
  const [groupCallOpen, setGroupCallOpen] = useState(false);
  const [groupCallMuted, setGroupCallMuted] = useState(false);
  const [groupCallSilent, setGroupCallSilent] = useState(false);
  const [groupCallSpeaker, setGroupCallSpeaker] = useState(true);

  const [globalHandle, setGlobalHandle] = useState(() => getLocalDeviceIdentity().handle || getMeshHandle() || myName || "");
  const [bridgeStatus, setBridgeStatus] = useState<MenuBridgeStatus>({ ready: false, text: "Checking bridge…", detail: "" });
  const [globalPeers, setGlobalPeers] = useState<{ id: string; name: string; handle?: string; online: boolean }[]>([]);
  /** Number under title — always start from storage (user phone / handle) */
  const [myGridDisplay, setMyGridDisplay] = useState(() => getImmutableDisplayNumber() || resolveMyPublicNumber());
  const [mySerial, setMySerial] = useState("");
  const [lanUrl, setLanUrl] = useState("");
  /** Real hub status — not decorative */
  const [hubStatus, setHubStatus] = useState<{
    connected: boolean;
    hub: string;
    peers: number;
    error?: string;
  }>(() => ({ connected: false, hub: resolveHubHttp(), peers: 0 }));

  // Hamburger: network count + map + GridCaller settings
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFullscreen, setMenuFullscreen] = useState(false);
  const [menuView, setMenuView] = useState<
    "home" | "map" | "settings" | "radio" | "profile" | "tower" | "devices" | "share" | "privacy" | "emergency" | "logs"
  >("home");
  const [logFilter, setLogFilter] = useState<LogTopFilter>("all");
  const [logFiltersOpen, setLogFiltersOpen] = useState(false);
  const [filterPanelCollapsed, setFilterPanelCollapsed] = useState(false);
  const [logsSubView, setLogsSubView] = useState<"recents" | "keypad" | "contacts">("recents");
  const [callLogSourceFilter, setCallLogSourceFilter] = useState<LogSourceFilter>("all");
  const [messageLogSourceFilter, setMessageLogSourceFilter] = useState<LogSourceFilter>("all");
  const [callDirectionFilters, setCallDirectionFilters] = useState<CallDirectionFilter[]>(DEFAULT_CALL_LOG_FILTERS);
  const [messageDirectionFilters, setMessageDirectionFilters] = useState<MessageDirectionFilter[]>(DEFAULT_MESSAGE_LOG_FILTERS);
  const [localCommLog, setLocalCommLog] = useState<LocalCommLogEntry[]>(() => gridNumberRegistry.getLocalCommLog(300));
  const [towerTick, setTowerTick] = useState(0);
  const [hopDiagnostics, setHopDiagnostics] = useState(() => {
    const persisted = loadPersistedRuntimeDiagnostics();
    return persisted.peerSightings > 0 || persisted.recentEvents.length > 0 || Object.keys(persisted.peerRoutes).length > 0
      ? persisted
      : softTowerHop.getRuntimeDiagnostics();
  });
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [deviceMsg, setDeviceMsg] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [privacyMsg, setPrivacyMsg] = useState("");
  const [disasterState, setDisasterState] = useState(() => getDisasterModeState());
  const [apkInfo, setApkInfo] = useState<{ name: string; url: string; size?: number; verified?: boolean; error?: string } | null>(null);
  const [myCard, setMyCard] = useState<ProfileCard>(() => loadMyCard());
  const [cardInbox, setCardInbox] = useState<ProfileCard[]>(() => loadInbox());
  const [cardMsg, setCardMsg] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [radioTick, setRadioTick] = useState(0);
  const [radioChannel, setRadioChannel] = useState(() => freeRadio.channelName);
  const [radioSecret, setRadioSecret] = useState(() => S.get("gc_radio_secret", "gridcaller-free") || "gridcaller-free");
  const [radioChannels, setRadioChannels] = useState<string[]>(() =>
    loadRadioChannelList(freeRadio.channelName || "grid-ch-1")
  );
  const [radioPanelTab, setRadioPanelTab] = useState<"channels" | "groups">("channels");
  const [radioGroups, setRadioGroups] = useState<
    { id: string; name: string; channels: string[]; createdAt: number; updatedAt: number }[]
  >(() => loadRadioGroups(loadRadioChannelList(freeRadio.channelName || "grid-ch-1")));
  const [radioGroupName, setRadioGroupName] = useState("");
  const [radioGroupChannelInput, setRadioGroupChannelInput] = useState("");
  const [selectedRadioGroupId, setSelectedRadioGroupId] = useState("");
  const [radioText, setRadioText] = useState("");
  const [radioSelectMode, setRadioSelectMode] = useState(false);
  const [selectedRadioMessageIds, setSelectedRadioMessageIds] = useState<string[]>([]);
  const [radioMessageReadState, setRadioMessageReadState] = useState<Record<string, boolean>>(() => S.get("gridcaller_radio_msg_read_state", {}));
  const [hiddenRadioMessageIds, setHiddenRadioMessageIds] = useState<string[]>(() => S.get("gridcaller_hidden_radio_msg_ids", []));
  const [radioSideTab, setRadioSideTab] = useState<"radio" | "radar">("radio");
  const [pttOn, setPttOn] = useState(false);
  const radarMotionRef = useRef<
    Map<string, { lat: number; lng: number; at: number; speedMps: number; movedMeters: number; bearingDeg: number }>
  >(new Map());
  const [meshMapPeers, setMeshMapPeers] = useState<
    {
      id: string;
      name: string;
      lat: number;
      lng: number;
      online: boolean;
      distance?: number;
      phone?: string;
      displayNumber?: string;
    }[]
  >([]);
  const [saveNumName, setSaveNumName] = useState("");
  const [saveNumPhone, setSaveNumPhone] = useState("");
  const [saveNumId, setSaveNumId] = useState("");
  const [myGps, setMyGps] = useState<{ lat: number; lng: number } | null>(null);
  /** Auto-mesh: all APKs join same network without per-device Connect */
  const [autoMeshStatus, setAutoMeshStatus] = useState<AutoMeshStatus | null>(null);
  const [settingsName, setSettingsName] = useState(myName);

  useEffect(() => {
    persistRuntimeDiagnostics(hopDiagnostics);
  }, [hopDiagnostics]);

  /** All IDs that mean "this phone" — never call/msg these */
  const isSelfPeer = (peerId: string) => {
    if (!peerId) return true;
    const ids = new Set<string>();
    try {
      ids.add(MeshEngine.localId);
    } catch {}
    ids.add(String(S.get("mesh_id", "") || ""));
    ids.add(String(S.get("ga_mesh_id", "") || ""));
    ids.add(String(S.get("omni_node_id", "") || ""));
    ids.add(String(S.get("user_id", "") || ""));
    if (ids.has(peerId)) return true;
    // same number as me
    const myPhone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
    const dig = peerId.replace(/\D/g, "");
    if (myPhone.length >= 10 && dig.length >= 10 && myPhone.slice(-10) === dig.slice(-10)) {
      return true;
    }
    return false;
  };

  const selectedGroupPeers = useMemo(() => {
    const map = new Map(peers.map((p) => [p.id, p]));
    return groupSelection
      .map((id) => map.get(id))
      .filter((p): p is (typeof peers)[number] => Boolean(p));
  }, [groupSelection, peers]);

  const toggleGroupSelection = (peerId: string) => {
    setGroupSelection((prev) => (prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]));
  };

  const clearGroupSelection = () => setGroupSelection([]);

  const startMeshGroupCall = () => {
    if (selectedGroupPeers.length < 2) {
      setErr("Pick at least 2 mesh peers to start a group call");
      return;
    }
    setGroupCallOpen(true);
    setGroupCallMuted(false);
    setGroupCallSilent(false);
    setGroupCallSpeaker(true);
    setContactBusy(`Mesh group call ready for ${selectedGroupPeers.length} peers`);
    setTimeout(() => setContactBusy(""), 2200);
    setErr("");
  };

  const meshStatusSummary = useMemo(() => {
    const onlinePeers = peers.filter((p) => p.online && !isSelfPeer(p.id)).length;
    const connected = Boolean(hubStatus.connected || autoMeshStatus?.trysteroOk);
    return {
      connected,
      text: connected ? "Mesh active" : "Mesh standby",
      peerLabel: `${onlinePeers} peer${onlinePeers === 1 ? "" : "s"}`,
    };
  }, [hubStatus.connected, autoMeshStatus?.trysteroOk, peers]);
  /** Testing: free custom ID + phone (limited device installs) */
  const [settingsCallerId, setSettingsCallerId] = useState(() => getLocalDeviceIdentity().peerId || S.get("mesh_id") || S.get("ga_mesh_id") || MeshEngine.localId || "");
  const [settingsPhone, setSettingsPhone] = useState(() => getLocalDeviceIdentity().phone || S.get("user_phone", "") || softTower.getSimAlias?.() || user?.phone || "");
  const [settingsDisplayNum, setSettingsDisplayNum] = useState(() => getLocalDeviceIdentity().displayNumber || getImmutableDisplayNumber() || "");
  const [identityStatus, setIdentityStatus] = useState(() => getLocalDeviceIdentity());
  const [identityBusy, setIdentityBusy] = useState(false);
  const [idSaveMsg, setIdSaveMsg] = useState("");
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);

  const rememberRadioChannel = (name: string) => {
    const cleaned = sanitizeRadioChannel(name);
    if (!cleaned) return;
    setRadioChannels((prev) => {
      const next = [cleaned, ...prev.filter((c) => c !== cleaned)].slice(0, 12);
      S.set("gc_radio_channels", next);
      return next;
    });
  };

  const persistRadioGroups = (
    updater: (prev: { id: string; name: string; channels: string[]; createdAt: number; updatedAt: number }[]) =>
      { id: string; name: string; channels: string[]; createdAt: number; updatedAt: number }[]
  ) => {
    setRadioGroups((prev) => {
      const next = updater(prev).slice(0, 30);
      S.set("gc_radio_groups", next);
      return next;
    });
  };

  const createRadioGroup = () => {
    const name = sanitizeRadioGroupName(radioGroupName);
    if (!name) {
      setErr("Group name is required");
      return;
    }
    if (radioGroups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      setErr("Group already exists");
      return;
    }
    const row = {
      id: `rg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      channels: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    persistRadioGroups((prev) => [row, ...prev]);
    setSelectedRadioGroupId(row.id);
    setRadioGroupName("");
    setIdSaveMsg(`Group created: ${name}`);
  };

  const addChannelToGroup = (groupId: string, channelName: string) => {
    const cleaned = sanitizeRadioChannel(channelName);
    if (!cleaned) {
      setErr("Enter a valid channel");
      return;
    }
    persistRadioGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        if (g.channels.includes(cleaned)) return g;
        return {
          ...g,
          channels: [...g.channels, cleaned].slice(0, 60),
          updatedAt: Date.now(),
        };
      })
    );
    rememberRadioChannel(cleaned);
    setRadioGroupChannelInput("");
    setIdSaveMsg(`Added ${cleaned}`);
  };

  const removeChannelFromGroup = (groupId: string, channelName: string) => {
    persistRadioGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              channels: g.channels.filter((c) => c !== channelName),
              updatedAt: Date.now(),
            }
      )
    );
  };

  const deleteRadioGroup = (groupId: string) => {
    const deleting = radioGroups.find((g) => g.id === groupId);
    persistRadioGroups((prev) => prev.filter((g) => g.id !== groupId));
    if (deleting) setIdSaveMsg(`Deleted group: ${deleting.name}`);
  };

  const joinRadioChannel = (name: string, secret: string) => {
    const cleaned = sanitizeRadioChannel(name);
    if (!cleaned) {
      setErr("Enter a valid channel name");
      return;
    }
    setRadioChannel(cleaned);
    rememberRadioChannel(cleaned);
    void freeRadio.setChannel(cleaned, secret);
    void freeRadio.enable(true);
    freeRadio.setOperatorName(myName);
    setIdSaveMsg(`Joined ${cleaned}`);
  };

  const openMenuFeature = (
    view: "map" | "settings" | "radio" | "profile" | "tower" | "devices" | "share" | "privacy" | "emergency" | "logs"
  ) => {
    setMenuView(view);
    setMenuFullscreen(true);
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!radioGroups.length) {
      setSelectedRadioGroupId("");
      return;
    }
    if (!radioGroups.some((g) => g.id === selectedRadioGroupId)) {
      setSelectedRadioGroupId(radioGroups[0].id);
    }
  }, [radioGroups, selectedRadioGroupId]);

  // Contacts vault (local memory — Truecaller-class)
  const [contacts, setContacts] = useState<GridContact[]>(() => contactsVault.list());
  const [contactView, setContactView] = useState<GridContact | null>(null);
  const [contactEdit, setContactEdit] = useState<Partial<GridContact> & { name: string } | null>(null);
  const [contactBusy, setContactBusy] = useState("");
  const visibleLocalCommLog = useMemo(() => {
    return localCommLog.filter((row) => {
      const isBlocked = row.direction === "blocked" || row.kind === "block";
      if (logFilter === "calls" && row.kind !== "call") return false;
      if (logFilter === "messages" && row.kind !== "message") return false;
      if (logFilter === "blocked" && !isBlocked) return false;

      if (row.kind === "call") {
        const source = classifyLogSource(row);
        const callDir = getCallDirectionFilter(row);
        return (callLogSourceFilter === "all" || source === callLogSourceFilter) && callDirectionFilters.includes(callDir);
      }

      if (row.kind === "message") {
        const source = classifyLogSource(row);
        const msgDir = getMessageDirectionFilter(row);
        return (messageLogSourceFilter === "all" || source === messageLogSourceFilter) && messageDirectionFilters.includes(msgDir);
      }

      return true;
    });
  }, [callDirectionFilters, callLogSourceFilter, localCommLog, logFilter, messageDirectionFilters, messageLogSourceFilter]);

  const latestLocalCommLog = useMemo(() => visibleLocalCommLog.slice().reverse(), [visibleLocalCommLog]);
  const visibleMeshCommLog = useMemo(() => {
    const meshLog = localCommLog.filter((e) => classifyLogSource(e) === "mesh-network");
    return meshLog.filter((e) => {
      const isBlocked = e.direction === "blocked" || e.kind === "block";
      if (logFilter === "calls" && e.kind !== "call") return false;
      if (logFilter === "messages" && e.kind !== "message") return false;
      if (logFilter === "blocked" && !isBlocked) return false;
      if (q.trim()) {
        const sq = q.toLowerCase();
        if (!((e.peerName || "").toLowerCase().includes(sq) || (e.peerNumber || "").toLowerCase().includes(sq) || (e.peerId || "").toLowerCase().includes(sq))) return false;
      }
      if (e.kind === "call") return callDirectionFilters.includes(getCallDirectionFilter(e));
      if (e.kind === "message") return messageDirectionFilters.includes(getMessageDirectionFilter(e));
      return true;
    });
  }, [callDirectionFilters, localCommLog, logFilter, messageDirectionFilters, q]);

  const logStats = useMemo(() => {
    const calls = localCommLog.filter((row) => row.kind === "call").length;
    const messages = localCommLog.filter((row) => row.kind === "message").length;
    const blocked = localCommLog.filter((row) => row.direction === "blocked" || row.kind === "block").length;
    return { calls, messages, blocked };
  }, [localCommLog]);

  const callLogSourceStats = useMemo(() => {
    const rows = localCommLog.filter((row) => row.kind === "call");
    return {
      all: rows.length,
      "local-device": rows.filter((row) => classifyLogSource(row) === "local-device").length,
      "mesh-network": rows.filter((row) => classifyLogSource(row) === "mesh-network").length,
    } as const;
  }, [localCommLog]);

  const messageLogSourceStats = useMemo(() => {
    const rows = localCommLog.filter((row) => row.kind === "message");
    return {
      all: rows.length,
      "local-device": rows.filter((row) => classifyLogSource(row) === "local-device").length,
      "mesh-network": rows.filter((row) => classifyLogSource(row) === "mesh-network").length,
    } as const;
  }, [localCommLog]);

  const refreshLocalLogs = () => setLocalCommLog(gridNumberRegistry.getLocalCommLog(300));

  const deleteLocalLogEntry = (id: string) => {
    if (!id) return;
    const ok = gridNumberRegistry.deleteLocalCommLogEntry(id);
    if (!ok) return;
    refreshLocalLogs();
    setContactBusy("Log entry deleted");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const clearLocalLogs = () => {
    if (!latestLocalCommLog.length) {
      setContactBusy("No logs to clear");
      setTimeout(() => setContactBusy(""), 1500);
      return;
    }
    if (!confirm("Clear all local device logs?")) return;
    const removed = gridNumberRegistry.clearLocalCommLog();
    refreshLocalLogs();
    setContactBusy(`Cleared ${removed} log${removed === 1 ? "" : "s"}`);
    setTimeout(() => setContactBusy(""), 1800);
  };

  const toggleCallDirectionFilter = (value: CallDirectionFilter) => {
    setCallDirectionFilters((prev) => {
      const next = prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value];
      return next.length ? next : DEFAULT_CALL_LOG_FILTERS;
    });
  };

  const toggleMessageDirectionFilter = (value: MessageDirectionFilter) => {
    setMessageDirectionFilters((prev) => {
      const next = prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value];
      return next.length ? next : DEFAULT_MESSAGE_LOG_FILTERS;
    });
  };

  const selectAllLogFilters = () => {
    setCallLogSourceFilter("all");
    setMessageLogSourceFilter("all");
    setCallDirectionFilters(DEFAULT_CALL_LOG_FILTERS);
    setMessageDirectionFilters(DEFAULT_MESSAGE_LOG_FILTERS);
  };

  const renderFilterChip = (
    active: boolean,
    label: string,
    onClick: () => void,
    icon?: ReactNode
  ) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: active ? "none" : `1px solid ${tokens.sep}`,
        background: active ? tokens.blue : tokens.card,
        color: active ? "#fff" : tokens.text,
        borderRadius: 999,
        padding: "7px 11px",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {icon}
      {label}
    </button>
  );

  const renderLogFilterPanel = (compact = false) => (
    <div
      style={{
        marginBottom: compact ? 10 : 12,
        padding: compact ? 10 : 12,
        borderRadius: 14,
        border: `1px solid ${tokens.sep}`,
        background: tokens.card,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: filterPanelCollapsed ? 0 : 10 }}>
        <button
          type="button"
          onClick={() => setFilterPanelCollapsed((p) => !p)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, flex: 1, textAlign: "left" }}
          title={filterPanelCollapsed ? "Expand filter panel" : "Collapse filter panel"}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: tokens.text }}>Filter logs</div>
            {!filterPanelCollapsed && (
              <div style={{ fontSize: 11, color: tokens.label, marginTop: 2 }}>
                Tick the items you want to see together.
              </div>
            )}
          </div>
          {filterPanelCollapsed
            ? <ChevronDown size={16} color={tokens.label} style={{ marginLeft: "auto", flexShrink: 0 }} />
            : <ChevronUp size={16} color={tokens.label} style={{ marginLeft: "auto", flexShrink: 0 }} />
          }
        </button>
        {!filterPanelCollapsed && (
          <button
            type="button"
            onClick={selectAllLogFilters}
            style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, padding: "7px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
          >
            Select all
          </button>
        )}
      </div>

      {!filterPanelCollapsed && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, color: tokens.secondary, marginBottom: 8, letterSpacing: 0.4 }}>
            CALL LOGS
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {([
              { id: "all", label: `All ${callLogSourceStats.all}` },
              { id: "local-device", label: `Local device ${callLogSourceStats["local-device"]}` },
              { id: "mesh-network", label: `Mesh network ${callLogSourceStats["mesh-network"]}` },
            ] as const).map((item) =>
              renderFilterChip(callLogSourceFilter === item.id, item.label, () => setCallLogSourceFilter(item.id))
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {([
              { id: "in", label: "Incoming", icon: <PhoneIncoming size={13} /> },
              { id: "out", label: "Outgoing", icon: <PhoneOutgoing size={13} /> },
              { id: "missed", label: "Missed", icon: <PhoneMissed size={13} /> },
              { id: "blocked", label: "Blocked", icon: <PhoneOff size={13} /> },
            ] as const).map((item) =>
              renderFilterChip(callDirectionFilters.includes(item.id), item.label, () => toggleCallDirectionFilter(item.id), item.icon)
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 800, color: tokens.secondary, marginBottom: 8, letterSpacing: 0.4 }}>
            MESSAGE LOGS
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {([
              { id: "all", label: `All ${messageLogSourceStats.all}` },
              { id: "local-device", label: `Local device ${messageLogSourceStats["local-device"]}` },
              { id: "mesh-network", label: `Mesh network ${messageLogSourceStats["mesh-network"]}` },
            ] as const).map((item) =>
              renderFilterChip(messageLogSourceFilter === item.id, item.label, () => setMessageLogSourceFilter(item.id))
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([
              { id: "inbox", label: "Inbox", icon: <MessageSquare size={13} /> },
              { id: "sent", label: "Sent", icon: <MessageCircle size={13} /> },
              { id: "blocked", label: "Blocked", icon: <Ban size={13} /> },
            ] as const).map((item) =>
              renderFilterChip(messageDirectionFilters.includes(item.id), item.label, () => toggleMessageDirectionFilter(item.id), item.icon)
            )}
          </div>
        </>
      )}
    </div>
  );

  const renderLogRow = (row: LocalCommLogEntry, compact = false) => {
    const accent = row.direction === "blocked" ? tokens.red : classifyLogSource(row) === "mesh-network" ? tokens.green : tokens.blue;
    const isSelected = selectedLogIds.includes(row.id);
    const isSeen = !!logSeenState[row.id];
    return (
      <div
        key={row.id}
        onContextMenu={(e) => {
          e.preventDefault();
          runLogLongPressAction(row.id);
        }}
        onClick={() => {
          if (logsSelectMode) toggleLogSelection(row.id);
        }}
        style={{
          margin: compact ? "8px 12px 0" : "0 0 8px",
          padding: 12,
          borderRadius: 14,
          background: tokens.card,
          border: logsSelectMode && isSelected ? `2px solid ${tokens.blue}` : `1px solid ${tokens.sep}`,
          cursor: logsSelectMode ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: tokens.text, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {logIconForRow(row, accent)}
                <span>{row.peerName || row.peerNumber || row.peerId || "Unknown"}</span>
              </span>
              <span style={{ color: accent, fontSize: 11 }}>{logDirectionCopy(row)}</span>
              <span style={{ color: isSeen ? tokens.label : tokens.orange, fontSize: 11, fontWeight: 700 }}>{isSeen ? "Read" : "Unread"}</span>
            </div>
            <div style={{ fontSize: 11, color: tokens.label, marginTop: 3 }}>
              {fullDateTime(row.ts)} {row.folder ? `· ${row.folder}` : ""} {row.method ? `· ${row.method}` : ""}
            </div>
            <div style={{ fontSize: 11, color: accent, marginTop: 5, fontWeight: 700 }}>{sourceLabelForLog(row)}</div>
            {row.kind === "call" ? (
              <div style={{ fontSize: 12, color: tokens.secondary, marginTop: 6, lineHeight: 1.45 }}>
                {logDirectionCopy(row)}
                {typeof row.durationSec === "number" && row.durationSec > 0 ? ` · ${row.durationSec}s talk time` : ""}
              </div>
            ) : null}
            {row.textPreview ? <div style={{ fontSize: 13, color: tokens.text, marginTop: 8, lineHeight: 1.45 }}>{row.textPreview}</div> : null}
            <div style={{ fontSize: 11, color: tokens.label, marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {row.peerId ? <span>ID: {row.peerId}</span> : null}
              {row.peerNumber ? <span>Number: {row.peerNumber}</span> : null}
              {typeof row.durationSec === "number" && row.durationSec > 0 ? <span>Duration: {row.durationSec}s</span> : null}
              {row.attachmentName ? <span>Attachment: {row.attachmentName}</span> : null}
              {row.reason ? <span>Reason: {row.reason}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => deleteLocalLogEntry(row.id)}
            style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 10, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}
            title="Delete this log entry"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  /** Renders a list of log rows with date-separator headers between different calendar days */
  const renderLogsWithDateSeparators = (rows: LocalCommLogEntry[], compact = false) => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    const items: ReactNode[] = [];
    let lastDateKey = "";
    rows.forEach((row) => {
      const d = new Date(row.ts);
      const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        let label: string;
        if (dateKey === todayKey) {
          label = "Today";
        } else if (dateKey === yesterdayKey) {
          label = "Yesterday";
        } else {
          label = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        }
        items.push(
          <div
            key={`sep-${dateKey}`}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: tokens.label,
              padding: compact ? "8px 12px 4px" : "8px 0 4px",
              letterSpacing: 0.3,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ flex: 1, height: 1, background: tokens.sep }} />
            <span>{label}</span>
            <span style={{ flex: 1, height: 1, background: tokens.sep }} />
          </div>
        );
      }
      items.push(<div key={row.id}>{renderLogRow(row, compact)}</div>);
    });
    return items;
  };

  const [contactFilter, setContactFilter] = useState<"all" | "fav" | "spam">("all");
  const fileImportRef = useRef<HTMLInputElement>(null);

  // Call UI
  type Phase = "idle" | "outgoing" | "incoming" | "active" | "ending";
  const [phase, setPhase] = useState<Phase>("idle");
  const [callPeer, setCallPeer] = useState<{ id: string; name: string } | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [secs, setSecs] = useState(0);
  const [callMethod, setCallMethod] = useState("");
  /** Live switch: voice ↔ video during an active call */
  const [videoOn, setVideoOn] = useState(!!isVideo);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingUser, setFacingUser] = useState(true);
  const localStream = useRef<MediaStream | null>(null);
  const remoteEl = useRef<HTMLAudioElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const acceptRef = useRef<(() => void) | null>(null);
  const rejectRef = useRef<(() => void) | null>(null);
  const startedAt = useRef(0);
  const activeCallIdRef = useRef("");
  const activePeerIdRef = useRef("");
  const pendingOfferRef = useRef<any>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const callPeerRef = useRef<{ id: string; name: string } | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync for hangup/async handlers
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    callPeerRef.current = callPeer;
  }, [callPeer]);

  // Always-on call session → drives fullscreen UI (incoming ring + accept + audio)
  useEffect(() => {
    startCallSession();
    const off = onCallUi((s: CallUiState) => {
      if (s.phase === "idle") {
        // Keep error visible but don't thrash UI if already idle
        if (s.error) setErr(s.error);
        if (phaseRef.current !== "idle") {
          setPhase("idle");
          phaseRef.current = "idle";
          setCallPeer(null);
          callPeerRef.current = null;
          setCallMethod("");
          setSecs(0);
        }
        return;
      }
      if (!s.peerId) return;
      const peer = { id: s.peerId, name: s.peerName || s.peerId };
      setCallPeer(peer);
      callPeerRef.current = peer;
      const ph =
        s.phase === "active" ? "active" : s.phase === "incoming" ? "incoming" : "outgoing";
      setPhase(ph);
      phaseRef.current = ph;
      setCallMethod(s.method || (ph === "outgoing" ? "Calling…" : ""));
      setSecs(s.secs || 0);
      if (s.error) setErr(s.error);
      else setErr("");
      activeCallIdRef.current = s.callId || "";
      activePeerIdRef.current = s.peerId || "";
      if (ph === "active") startedAt.current = Date.now() - (s.secs || 0) * 1000;
    });
    return () => {
      try {
        off();
      } catch {}
    };
  }, []);

  // Persist
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const status = await ghStatus(resolveHubHttp());
        if (cancelled) return;
        setBridgeStatus(normalizeBridgeStatus(status));
      } catch {
        if (!cancelled) {
          setBridgeStatus(normalizeBridgeStatus(null));
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    removeStorageValue("gridcaller_recents");
  }, []);

  useEffect(() => S.set("gridcaller_sms", sms.slice(0, 400)), [sms]);
  useEffect(() => S.set("gridcaller_group_chats", groupChats.slice(0, 80)), [groupChats]);
  useEffect(() => S.set("gridcaller_group_messages", groupMessages.slice(-1200)), [groupMessages]);
  useEffect(() => S.set("gridcaller_active_tab", tab), [tab]);
  useEffect(() => S.set("gridcaller_gridchat_favourites", gridchatFavourites.slice(0, 300)), [gridchatFavourites]);
  useEffect(() => S.set("gridcaller_gridchat_muted", gridchatMuted.slice(0, 300)), [gridchatMuted]);
  useEffect(() => S.set("gridcaller_gridchat_last_seen", gridchatLastSeen), [gridchatLastSeen]);
  useEffect(() => S.set("gridcaller_my_status_text", gridchatMyStatusText.trim()), [gridchatMyStatusText]);
  useEffect(() => S.set("gridcaller_my_status_at", gridchatMyStatusAt), [gridchatMyStatusAt]);
  useEffect(() => S.set("gridcaller_status_privacy", gridchatStatusPrivacy), [gridchatStatusPrivacy]);
  useEffect(() => S.set("gridcaller_status_auto_clear_h", gridchatStatusAutoClearHours), [gridchatStatusAutoClearHours]);
  useEffect(() => S.set("gridcaller_status_ring_color", gridchatStatusRingColor), [gridchatStatusRingColor]);
  useEffect(() => S.set("gridcaller_status_stealth", !!gridchatStatusStealthMode), [gridchatStatusStealthMode]);
  useEffect(() => S.set("gridcaller_status_archive", gridchatStatusArchive.slice(0, 24)), [gridchatStatusArchive]);
  useEffect(() => S.set("gridcaller_status_posts", statusPosts.slice(-400)), [statusPosts]);
  useEffect(() => S.set("gridcaller_status_comments", statusComments.slice(-1200)), [statusComments]);
  useEffect(() => S.set("gridcaller_status_reactions", statusReactions.slice(-2500)), [statusReactions]);
  useEffect(() => S.set("gridcaller_status_views", statusViews.slice(-4000)), [statusViews]);
  useEffect(() => S.set("gridcaller_starred_messages", starredMessageIds.slice(0, 3000)), [starredMessageIds]);
  useEffect(() => S.set("gridcaller_report_log", gridchatReportLog.slice(0, 500)), [gridchatReportLog]);
  useEffect(() => S.set("gridcaller_log_seen_state", logSeenState), [logSeenState]);
  useEffect(() => S.set("gridcaller_radio_msg_read_state", radioMessageReadState), [radioMessageReadState]);
  useEffect(() => S.set("gridcaller_hidden_radio_msg_ids", hiddenRadioMessageIds.slice(-500)), [hiddenRadioMessageIds]);
  useEffect(() => S.set("gridcaller_blocked", blocked), [blocked]);
  useEffect(() => {
    void deviceVault.put("gridcaller.sms", sms.slice(0, 400)).catch(() => {});
  }, [sms]);
  useEffect(() => {
    void deviceVault.put("gridcaller.group_chats", groupChats.slice(0, 80)).catch(() => {});
  }, [groupChats]);
  useEffect(() => {
    void deviceVault.put("gridcaller.group_messages", groupMessages.slice(-1200)).catch(() => {});
  }, [groupMessages]);
  useEffect(() => {
    void deviceVault.put("gridcaller.blocked", blocked).catch(() => {});
  }, [blocked]);
  useEffect(() => {
    S.set("gridcaller_scope", callScope);
  }, [callScope]);

  useEffect(() => {
    if (!gridchatMyStatusText || !gridchatMyStatusAt || gridchatStatusAutoClearHours <= 0) return;
    const ms = gridchatStatusAutoClearHours * 60 * 60 * 1000;
    const expiresIn = gridchatMyStatusAt + ms - Date.now();
    if (expiresIn <= 0) {
      setGridchatMyStatusText("");
      setGridchatMyStatusAt(0);
      return;
    }
    const t = setTimeout(() => {
      setGridchatMyStatusText("");
      setGridchatMyStatusAt(0);
    }, expiresIn);
    return () => clearTimeout(t);
  }, [gridchatMyStatusText, gridchatMyStatusAt, gridchatStatusAutoClearHours]);

  // Init: sync GridCaller <-> Mesh Comms <-> meshAppBridge <-> global call
  useEffect(() => {
    try {
      // APK must point at PC LAN hub (not localhost)
      const { hub, signal } = ensureHubDefaults();
      setLanUrl(hub);
      try {
        localStorage.setItem("gc_hub_http", hub);
        localStorage.setItem("gc_signal_url", signal);
      } catch {}

      // One identity + FULL auto-join (Wi-Fi + BT + swarm) - no manual Connect
      unifyLocalIdentity();
      void startFullAutoJoin(myName);
      void startAutoMesh(myName).then((st) => setAutoMeshStatus(st));
      const offAm = onAutoMeshStatus((st) => setAutoMeshStatus(st));
      (window as any).__gc_off_am = offAm;

      sovereignMesh.start();
      meshAppBridge.start(myName);
      meshAppBridge.registerApp("gridcaller", "GridCaller");
      meshAppBridge.registerApp("meshcomms", "Mesh Comms");
      setMeshShareNote(meshAppBridge.getStatus().note || "");
      const shareTimer = window.setInterval(() => {
        try {
          setMeshShareNote(meshAppBridge.getStatus().note || "");
        } catch {}
      }, 10000);
      (window as any).__gc_share_timer = shareTimer;

      const gidIdentity = gridNumberRegistry.start({ id: user?.id, name: myName });
      // Soft tower: virtual number + optional SIM alias (dial like phone)
      const cell = softTower.start({
        id: user?.id,
        name: myName,
        phone: user?.phone || S.get("user_phone", ""),
      });
      // Header number = ONLY what user saved (phone/handle). Never registry auto number.
      const displayNow = resolveMyPublicNumber();
      setMyGridDisplay(displayNow);
      setSettingsDisplayNum(displayNow);
      const savedHandle = String(S.get("global_call_handle", "") || "").trim();
      const testPhone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
      if (savedHandle) setGlobalHandle(savedHandle);
      else if (testPhone.length >= 10) setGlobalHandle(testPhone.slice(-10));
      setSettingsPhone(testPhone || S.get("user_phone", "") || "");
      setMySerial(gidIdentity.deviceSerial || "");
      if (testPhone) softTower.bindSimAlias(testPhone);
      else if (user?.phone) softTower.bindSimAlias(String(user.phone));
      if (savedHandle || testPhone) {
        try {
          globalCall.setHandle(savedHandle || testPhone.slice(-10));
        } catch {}
      }
      // Keep user-saved display intact instead of auto IDs.
      void cell;

      // Free radio + soft-tower hop fabric: every phone is a cell tower
      try {
        const savedRadioMode = S.get("gc_radio_mode", null);
        const savedMeshMode = S.get("gc_mesh_path_mode", null);
        const savedForceLocal = S.get("gc_force_local_mesh", null);
        if (savedRadioMode === null && savedMeshMode === null && savedForceLocal === null) {
          enableFreeRadioMeshDefaults();
        }
        void freeRadio.enable(S.get("gc_radio_mode", false) === true);
        freeRadio.setOperatorName(myName);
      } catch {}
      try {
        softTowerHop.start(myName);
        freeMeshFabric.start(myName);
      } catch {}
      if (S.get("gc_force_local_mesh", null) === null && S.get("gc_mesh_path_mode", null) === null) {
        try {
          setForceLocalMesh(true);
        } catch {}
      }
      meshComms.init(undefined, myName);
      try {
        meshComms.startPresence?.(myName, "user");
        meshComms.startNetworkMonitor?.();
        meshComms.joinWalkieChannel?.("gridcaller_sms", () => {});
        meshComms.joinWalkieChannel?.("mesh_comms_global", () => {});
      } catch {}
      S.set("mesh_name", myName);
      S.set("user_name", myName);
      omniMesh.start(myName);
      try {
        MeshEngine.start?.();
        (MeshEngine as any).reconnect?.();
      } catch {}
      // Real hub probe
      void (async () => {
        const p = await probeHub(hub);
        setHubStatus({
          connected: p.ok,
          hub,
          peers: p.meshWs || p.peers,
          error: p.error,
        });
      })();
      const onMeshSt = (ev: any) => {
        const d = ev?.detail || {};
        setHubStatus((s) => ({
          ...s,
          connected: !!d.connected,
          hub: resolveHubHttp(),
          error: d.connected ? undefined : s.error,
        }));
      };
      window.addEventListener("gc-mesh-status", onMeshSt as any);
      (window as any).__gc_mesh_st = onMeshSt;

      const gid = S.get("mesh_id") || MeshEngine.localId;
      const handleSeed =
        String(S.get("global_call_handle", "") || "").trim() ||
        globalHandle ||
        gidIdentity.shortDial ||
        myName;
      globalCall.start(gid, myName, handleSeed);
      // Keep user-saved handle; do not replace with engine default
      const keepHandle = String(S.get("global_call_handle", "") || "").trim();
      if (keepHandle) setGlobalHandle(keepHandle);
      else setGlobalHandle(globalCall.callHandle || handleSeed);
      try {
        if (window.location.hostname && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
          setLanUrl(window.location.origin);
        } else {
          setLanUrl("http://192.168.1.8:3001");
        }
      } catch {}
    } catch (e) {
      console.warn("[GridCaller] mesh init", e);
    }

    const offPres = globalCall.listenPresence((p) => {
      setGlobalPeers((prev) => {
        const rest = prev.filter((x) => x.id !== p.id);
        return [{ id: p.id, name: p.name, handle: p.handle, online: true }, ...rest].slice(0, 40);
      });
    });

    globalCall.onIncoming((from, accept, reject) => {
      if (blocked.includes(from.id)) {
        try {
          gridNumberRegistry.logCall({
            dir: "blocked",
            peerId: from.id,
            peerName: from.name || from.handle || from.id,
            method: "global-call",
            reason: "blocked_incoming_call",
          });
        } catch {}
        reject();
        return;
      }
      setCallPeer({ id: from.id, name: from.name || from.handle || from.id });
      setPhase("incoming");
      setCallMethod("Incoming");
      acceptRef.current = () => {
        accept();
        setPhase("active");
        startedAt.current = Date.now();
        setCallMethod("Connected");
      };
      rejectRef.current = reject;
      try {
        navigator.vibrate?.([200, 80, 200, 80, 200]);
      } catch {}
    });

    const offGState = bus.on("globalCall:state", (m: any) => {
      const st = m?.payload?.state || m?.state;
      if (st === "connected") {
        setPhase("active");
        startedAt.current = Date.now();
        setCallMethod("Connected");
      }
      if (st === "declined") {
        setErr("Call declined");
        setPhase("idle");
        setCallPeer(null);
      }
      if (st === "failed" || st === "disconnected" || st === "closed") {
        // soft end - hangup UI may already run
      }
    });

    // Presence tick - MeshEngine peers + hub HTTP peers (real only)
    const tick = async () => {
      try {
        const mapped: {
          id: string;
          name: string;
          online: boolean;
          distance?: number;
          handle?: string;
          phone?: string;
          displayNumber?: string;
        }[] = [];
        const seen = new Set<string>();
        const add = (
          id: string,
          name: string,
          online: boolean,
          extra?: { handle?: string; phone?: string; displayNumber?: string }
        ) => {
          if (!id || blocked.includes(id) || seen.has(id)) return;
          if (id === "hub-pc") return; // not a call target
          // Never list this phone as a peer
          if (
            id === MeshEngine.localId ||
            id === S.get("mesh_id", "") ||
            id === S.get("omni_node_id", "") ||
            id === S.get("ga_mesh_id", "")
          ) {
            return;
          }
          seen.add(id);
          const label =
            name ||
            extra?.handle ||
            (extra?.phone ? extra.phone.slice(-10) : "") ||
            id.slice(0, 12);
          mapped.push({
            id,
            name: label,
            online,
            handle: extra?.handle,
            phone: extra?.phone,
            displayNumber: extra?.displayNumber,
          });
        };

        // From MeshEngine in-memory peers (HTTP poll fills this)
        const mp = (MeshEngine as any).peers || {};
        for (const [id, v] of Object.entries(mp) as any) {
          add(id, v?.name || id.slice(0, 12), Date.now() - (v?.lastSeen || 0) < 90000, {
            handle: v?.handle,
            phone: v?.phone,
            displayNumber: v?.displayNumber,
          });
        }

        // Hub HTTP peers — source of truth for APK mesh
        try {
          const hubPeers = await fetchHubMeshPeers();
          for (const p of hubPeers) {
            const online = !p.lastSeen || Date.now() - p.lastSeen < 120000;
            add(p.id, p.name || p.handle || p.id, online, {
              handle: p.handle,
              phone: p.phone,
              displayNumber: p.displayNumber,
            });
          }
        } catch {}

        // Force reconnect signal if we see others
        try {
          const hp = await probeHub();
          if (hp.ok) {
            setHubStatus((s) => ({
              ...s,
              connected: true,
              hub: resolveHubHttp(),
              peers: Math.max(hp.peers, mapped.length),
              error: undefined,
            }));
          }
        } catch {}

        try {
          for (const p of getAutoMeshPeers()) {
            add(p.id, p.name, p.online !== false, {
              phone: p.phone,
              displayNumber: p.displayNumber,
            });
          }
        } catch {}

        try {
          for (const p of softTowerHop.getPeers()) {
            add(p.id, p.name, true);
          }
        } catch {}

        // Show online peers; if none online but we have ids, still show recent
        const live = mapped.filter((p) => p.online);
        setPeers(live.length ? live : mapped);
      } catch {}
    };
    void tick();
    const iv = setInterval(() => void tick(), 1500);
    const offAutoPeers = onAutoMeshPeers(() => {
      void tick();
    });

    // Incoming WebRTC via local mesh Gun
    try {
      meshComms.listenForIncomingCalls?.((from, accept, reject) => {
        if (blocked.includes(from)) {
          try {
            gridNumberRegistry.logCall({
              dir: "blocked",
              peerId: from,
              peerName: peers.find((p) => p.id === from)?.name || from.slice(0, 12),
              method: "mesh-comms",
              reason: "blocked_incoming_call",
            });
          } catch {}
          reject();
          return;
        }
        const name = peers.find((p) => p.id === from)?.name || from.slice(0, 12);
        setCallPeer({ id: from, name });
        setPhase("incoming");
        setCallMethod("Incoming");
        acceptRef.current = accept;
        rejectRef.current = reject;
        try {
          navigator.vibrate?.([200, 80, 200, 80, 200]);
        } catch {}
      });
    } catch (e) {
      console.warn("[GridCaller] listenForIncomingCalls", e);
    }

    // OmniMesh SMS / call packets
    const offOmni = omniMesh.onPacket((pkt) => {
      if (pkt.from === omniMesh.id) return;
      if (pkt.from === MeshEngine.localId) return;
      // Directed SMS only via MeshEngine — ignore omni flood (self-echo source)
      if (pkt.type === "OMNI_SMS" || pkt.type === "GRIDCALLER_SMS") {
        return;
      }
    });

    // Walkie / mesh SMS channel (shared with Mesh Comms)
    // Walkie is broadcast flood — skip for SMS UI (causes self-echo). Use GRIDCALLER_SMS only.
    const offWalkie = meshComms.onWalkieMessage?.((_msg: any) => {
      /* intentional no-op: directed SMS uses MeshEngine only */
    });

    const offAppSms = bus.on("meshApp:sms", (m: any) => {
      const msg = m?.payload || m;
      if (!msg) return;
      const from = msg.peerId || msg.from || "";
      if (from && (from === MeshEngine.localId || isSelfPeer(from))) return;
      const text = msg.message || msg.text || "";
      const attachment = msg.attachment || msg.data?.attachment;
      if (!text && !attachment) return;
      if (from && blocked.includes(from)) {
        try {
          gridNumberRegistry.logMessage({
            direction: "blocked",
            folder: "blocked",
            peerId: from,
            peerName: msg.user || msg.fromName || "Peer",
            text,
            attachment,
            method: "mesh-app-bridge",
            reason: "blocked_incoming_message",
            refId: msg.id || undefined,
            ts: msg.timestamp || msg.ts || Date.now(),
          });
        } catch {}
        return;
      }
      const row: SmsRow = {
        id: msg.id || String(Date.now()),
        peerId: from || "mesh",
        name: msg.user || msg.fromName || "Peer",
        text,
        ts: msg.timestamp || msg.ts || Date.now(),
        mine: false,
        folder: "inbox",
        attachment,
      };
      setSms((p) => (p.some((x) => x.id === row.id || (x.mine && x.text === text && Date.now() - x.ts < 3000)) ? p : [...p, row]));
      try {
        gridNumberRegistry.logMessage({
          direction: "in",
          folder: "inbox",
          peerId: row.peerId,
          peerName: row.name,
          text: row.text,
          attachment: row.attachment,
          method: "mesh-app-bridge",
          refId: row.id,
          ts: row.ts,
        });
      } catch {}
    });

    // Directed mesh SMS only (never treat own send as inbound)
    const offMesh = MeshEngine.onMessage((msg: any) => {
      if (msg?.type === "GRID_GROUP_SYNC" && msg.data?.group) {
        const g = msg.data.group;
        const members = normalizeGroupMembers(g.members || []);
        if (!members.some((m) => isCallAddressedToMe(m))) return;
        const row: GroupChat = {
          id: String(g.id || ""),
          name: String(g.name || "Group").slice(0, 40),
          members,
          createdAt: Number(g.createdAt || Date.now()),
          updatedAt: Number(g.updatedAt || Date.now()),
        };
        if (!row.id) return;
        setGroupChats((prev) => {
          const i = prev.findIndex((x) => x.id === row.id);
          if (i < 0) return [row, ...prev].slice(0, 80);
          const next = prev.slice();
          next[i] = { ...next[i], ...row };
          return next;
        });
      }

      if (msg?.type === "GRID_GROUP_MESSAGE" && msg.data?.groupId) {
        if (!msg.from || msg.from === MeshEngine.localId) return;
        const members = normalizeGroupMembers(msg.data.members || []);
        if (members.length && !members.some((m: string) => isCallAddressedToMe(m))) return;
        const row: GroupMessage = {
          id: String(msg.data.id || `${msg.time || Date.now()}_${msg.from}`),
          groupId: String(msg.data.groupId),
          fromId: String(msg.from),
          fromName: String(msg.data.fromName || msg.fromName || msg.from),
          text: String(msg.data.text || ""),
          ts: Number(msg.data.ts || msg.time || Date.now()),
          mine: false,
          attachment: msg.data.attachment || undefined,
          system: !!msg.data.system,
        };
        setGroupMessages((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row].slice(-1200)));
        if (!row.system) {
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(row.fromName, {
                body: row.text || (row.attachment ? "📎 Attachment" : "New group message"),
                tag: `gc-grp-${row.groupId}`,
                silent: false,
              });
            }
          } catch {}
        }
      }

      if (msg?.type === "GRID_GROUP_CALL_INVITE" && msg.data?.groupId) {
        if (!msg.from || msg.from === MeshEngine.localId) return;
        const members = normalizeGroupMembers(msg.data.members || []);
        if (!members.some((m: string) => isCallAddressedToMe(m))) return;
        const sys: GroupMessage = {
          id: `sys_${msg.time || Date.now()}_${msg.from}`,
          groupId: String(msg.data.groupId),
          fromId: String(msg.from),
          fromName: String(msg.data.fromName || msg.fromName || msg.from),
          text: `${msg.data.mode === "video" ? "Video" : "Voice"} call invite`,
          ts: Number(msg.time || Date.now()),
          mine: false,
          system: true,
        };
        setGroupMessages((prev) => [...prev, sys].slice(-1200));
      }

      if (msg?.type === "GRIDCALLER_SMS" && (msg.data?.text || msg.data?.attachment)) {
        if (!msg.from || msg.from === MeshEngine.localId) return;
        if (blocked.includes(msg.from)) {
          try {
            gridNumberRegistry.logMessage({
              direction: "blocked",
              folder: "blocked",
              peerId: msg.from,
              peerName: msg.fromName || msg.data?.fromName || msg.from,
              text: String(msg.data.text || ""),
              attachment: msg.data.attachment || undefined,
              method: "mesh-engine",
              reason: "blocked_incoming_message",
              refId: msg.data.id || msg.time || undefined,
              ts: msg.time || Date.now(),
            });
          } catch {}
          return;
        }
        // If targeted, only accept when we are the recipient
        const to = msg.data?.to;
        if (to) {
          const myId = MeshEngine.localId;
          const myHandle = String(S.get("global_call_handle", "") || "").replace(/^@/, "");
          const myPhone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
          const toDig = String(to).replace(/\D/g, "");
          const mine =
            to === myId ||
            (myHandle && String(to).replace(/^@/, "") === myHandle) ||
            (myPhone.length >= 10 && toDig.length >= 10 && myPhone.slice(-10) === toDig.slice(-10));
          if (!mine) return;
        }
        const row: SmsRow = {
          id: msg.data.id || msg.time || String(Date.now()),
          peerId: msg.from,
          name: msg.fromName || msg.data.fromName || msg.from,
          text: String(msg.data.text || ""),
          ts: msg.time || Date.now(),
          mine: false,
          folder: "inbox",
          attachment: msg.data.attachment || undefined,
        };
        setSms((p) =>
          p.some((x) => x.id === row.id || (x.mine && x.text === row.text && Date.now() - x.ts < 4000))
            ? p
            : [...p, row]
        );
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(row.name, {
              body: row.text || (row.attachment ? "📎 Attachment" : "New message"),
              tag: `gc-msg-${row.peerId}`,
              silent: false,
            });
          }
        } catch {}
        try {
          gridNumberRegistry.logMessage({
            direction: "in",
            folder: "inbox",
            peerId: row.peerId,
            peerName: row.name,
            text: row.text,
            attachment: row.attachment,
            method: "mesh-engine",
            refId: row.id,
            ts: row.ts,
          });
        } catch {}
      }
    });

    // Call state from local engine
    const offState = bus.on("mesh_comms:call_state", (m: any) => {
      const st = m?.payload?.state || m?.state;
      if (st === "connected") {
        setPhase("active");
        startedAt.current = Date.now();
        setCallMethod("Connected");
      }
    });

    const offBus = bus.on("call:initiate", (m: any) => {
      const p = m?.payload || m || {};
      if (p.peerId) void placeCall(p.peerId, p.userName || p.peerName || p.peerId);
    });

    if (initialPeerId && !isIncoming) {
      void placeCall(initialPeerId, initialPeerName || initialPeerId);
    }

    return () => {
      clearInterval(iv);
      try { offAutoPeers?.(); } catch {}
      try {
        (window as any).__gc_off_am?.();
      } catch {}
      try {
        window.removeEventListener("gc-mesh-status", (window as any).__gc_mesh_st as any);
      } catch {}
      try { offPres?.(); } catch {}
      try { offGState?.(); } catch {}
      try { offAppSms?.(); } catch {}
      offOmni?.();
      offWalkie?.();
      offMesh?.();
      offState?.();
      offBus?.();
      try { clearInterval((window as any).__gc_share_timer); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myName]);

  // Duration clock
  useEffect(() => {
    if (phase !== "active") return;
    const iv = setInterval(() => {
      setSecs(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 500);
    return () => clearInterval(iv);
  }, [phase]);

  // Real remote audio element (required for WebRTC voice on Android WebView)
  useEffect(() => {
    remoteEl.current = ensureRemoteAudioEl();
  }, []);

  // Free Radio mesh UI refresh
  useEffect(() => {
    const off = freeRadio.subscribe(() => setRadioTick((n) => n + 1));
    return () => {
      off();
    };
  }, []);

  // Soft tower hop: multi-path call/msg + UI stats
  useEffect(() => {
    try {
      softTowerHop.start(myName);
    } catch {}
    const offMsg = softTowerHop.onHopMessage((m) => {
      if (blocked.includes(m.from)) {
        try {
          gridNumberRegistry.logMessage({
            direction: "blocked",
            folder: "blocked",
            peerId: m.from,
            peerName: m.fromName || m.from,
            text: m.text,
            method: "soft-tower-hop",
            reason: "blocked_incoming_message",
            refId: m.id,
          });
        } catch {}
        return;
      }
      const row: SmsRow = {
        id: m.id,
        peerId: m.from,
        name: m.fromName || m.from,
        text: m.text,
        ts: Date.now(),
        mine: false,
        folder: "inbox",
      };
      setSms((p) => (p.some((x) => x.id === row.id) ? p : [...p, row]));
      try {
        gridNumberRegistry.logMessage({
          direction: "in",
          folder: "inbox",
          peerId: row.peerId,
          peerName: row.name,
          text: row.text,
          method: "soft-tower-hop",
          refId: row.id,
          ts: row.ts,
        });
      } catch {}
      setContactBusy(`Hop msg · ${m.hops} hops · ${m.fromName}`);
      setTimeout(() => setContactBusy(""), 2500);
    });
    const offCall = softTowerHop.onHopCallSignal((sig) => {
      if (!sig) return;
      if (blocked.includes(sig.from)) {
        try {
          gridNumberRegistry.logCall({
            dir: "blocked",
            peerId: sig.from,
            peerName: sig.fromName || sig.from,
            method: "soft-tower-hop",
            reason: "blocked_incoming_call",
            refId: sig.callId,
          });
        } catch {}
        return;
      }
      // Feed into local call path when invite arrives via hop fabric
      if (sig.action === "invite" || sig.type === "MESH_CALL_INVITE") {
        setCallPeer({ id: sig.from, name: sig.fromName || sig.from });
        setPhase("incoming");
        setCallMethod(`Soft tower · ${sig.hops || 0} hops`);
        acceptRef.current = () => {
          softTowerHop.sendCallSignal(sig.from, { action: "accept", callId: sig.callId });
          setPhase("active");
          startedAt.current = Date.now();
        };
        rejectRef.current = () => {
          softTowerHop.sendCallSignal(sig.from, { action: "reject", callId: sig.callId });
          setPhase("idle");
          setCallPeer(null);
        };
      }
    });
    const iv = setInterval(() => {
      setTowerTick((n) => n + 1);
      setHopDiagnostics(softTowerHop.getRuntimeDiagnostics());
    }, 3000);
    return () => {
      offMsg();
      offCall();
      clearInterval(iv);
    };
  }, [myName, blocked]);

  // Visiting cards received on mesh
  useEffect(() => {
    const off = MeshEngine.onMessage((msg: any) => {
      if (msg?.type === "GRIDCALLER_CARD" && msg.data) {
        const card = receiveCard({
          ...msg.data,
          name: msg.data.name || msg.fromName,
          gridCallerId: msg.data.gridCallerId || msg.from,
        });
        if (card) {
          setCardInbox(loadInbox());
          setCardMsg(`Card received: ${card.name}`);
          setTimeout(() => setCardMsg(""), 3000);
        }
      }
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, []);

  // Live GPS + auto-broadcast so map shows ALL mesh phones (no manual share)
  useEffect(() => {
    try {
      meshComms.startPresence?.(myName, "user");
    } catch {}
    void startAutoMesh(myName);
    let watchId: number | null = null;
    const mergePeer = (raw: any) => {
      if (!raw) return;
      const id = raw.peerId || raw.id || raw.from;
      if (!id || isSelfPeer(id) || blocked.includes(id)) return;
      const lat = Number(raw.lat ?? raw.data?.lat);
      const lng = Number(raw.lng ?? raw.data?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setMeshMapPeers((prev) => {
        const rest = prev.filter((p) => p.id !== id);
        return [
          {
            id,
            name: raw.name || raw.fromName || raw.data?.name || id.slice(0, 10),
            lat,
            lng,
            online: raw.online !== false,
            distance: raw.distance,
            phone: raw.phone || raw.data?.phone,
            displayNumber: raw.displayNumber || raw.data?.displayNumber,
          },
          ...rest,
        ].slice(0, 80);
      });
    };

    const shareMyGps = (lat: number, lng: number) => {
      setMyGps({ lat, lng });
      // AutoMesh multi-path (hub + Trystero) so both phones see each other on map
      try {
        setAutoMeshGps(lat, lng);
      } catch {}
      const payload = {
        lat,
        lng,
        name: myName,
        phone: S.get("user_phone", "") || "",
        displayNumber: myGridDisplay || S.get("gc_test_display_number", "") || "",
        peerId: MeshEngine.localId || unifyLocalIdentity(),
      };
      try {
        MeshEngine.broadcast("GRIDCALLER_LOCATION", payload);
      } catch {}
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => shareMyGps(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
      watchId = navigator.geolocation.watchPosition(
        (pos) => shareMyGps(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
      );
    }

    const pull = () => {
      try {
        const list = (meshComms.getPeers?.() || []) as any[];
        for (const p of list) {
          if (p.lat != null && p.lng != null) {
            mergePeer({
              ...p,
              peerId: p.peerId || p.id,
              online: p.online !== false,
            });
          }
        }
        // AutoMesh peers with GPS
        for (const p of getAutoMeshPeers()) {
          if (p.lat != null && p.lng != null) {
            mergePeer({
              peerId: p.id,
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              online: p.online,
              phone: p.phone,
              displayNumber: p.displayNumber,
            });
          }
        }
        setMeshMapPeers((prev) =>
          prev.filter((p) => !blocked.includes(p.id) && !isSelfPeer(p.id))
        );
      } catch {}
    };
    pull();
    const offPeers = meshComms.onPeers?.(() => pull());
    const offMesh = MeshEngine.onMessage((msg: any) => {
      if (msg?.type === "GRIDCALLER_LOCATION" || msg?.type === "AM_LOCATION" || msg?.type === "AM_PRESENCE") {
        mergePeer({ ...(msg.data || {}), from: msg.from, fromName: msg.fromName, id: msg.data?.peerId || msg.data?.id || msg.from });
      }
    });
    const offLoc = onPeerLocation((p) => {
      mergePeer({
        peerId: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        online: true,
        phone: p.phone,
        displayNumber: p.displayNumber,
      });
    });
    // Re-broadcast location every 12s (less bus spam so call signals stay fast)
    const ivShare = setInterval(() => {
      if (myGps) shareMyGps(myGps.lat, myGps.lng);
    }, 12000);
    const iv = setInterval(pull, 2500);
    return () => {
      try {
        offPeers?.();
      } catch {}
      try {
        offMesh?.();
      } catch {}
      try {
        offLoc?.();
      } catch {}
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {}
      }
      clearInterval(iv);
      clearInterval(ivShare);
    };
  }, [myName, blocked, myGridDisplay]);

  // Track movement speed/heading between peer location updates for radar UI.
  useEffect(() => {
    const now = Date.now();
    const next = new Map(radarMotionRef.current);
    const alive = new Set<string>();
    for (const p of meshMapPeers) {
      alive.add(p.id);
      const prev = next.get(p.id);
      let speedMps = 0;
      let movedMeters = 0;
      let bearingDeg = 0;
      if (prev) {
        movedMeters = calcDistanceMeters(prev, p);
        const dt = Math.max(1, now - prev.at);
        speedMps = (movedMeters * 1000) / dt;
        bearingDeg = calcBearingDeg(prev, p);
      }
      next.set(p.id, {
        lat: p.lat,
        lng: p.lng,
        at: now,
        speedMps,
        movedMeters,
        bearingDeg,
      });
    }
    for (const id of Array.from(next.keys())) {
      if (!alive.has(id)) next.delete(id);
    }
    radarMotionRef.current = next;
  }, [meshMapPeers]);

  // Leaflet map when menu map view open
  useEffect(() => {
    if (!menuOpen || menuView !== "map" || !mapBoxRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore css side-effect
        await import("leaflet/dist/leaflet.css");
        if (cancelled || !mapBoxRef.current) return;
        if (mapObjRef.current) {
          try {
            mapObjRef.current.remove();
          } catch {}
          mapObjRef.current = null;
        }
        const center: [number, number] = myGps
          ? [myGps.lat, myGps.lng]
          : radarPeers[0]
            ? [radarPeers[0].lat, radarPeers[0].lng]
            : [20.5937, 78.9629]; // India default
        const map = L.map(mapBoxRef.current, { zoomControl: true }).setView(center, myGps || radarPeers.length ? 12 : 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        }).addTo(map);
        const popupNode = (title: string, lines: string[]) => {
          const root = document.createElement("div");
          const head = document.createElement("div");
          head.textContent = title;
          head.style.fontWeight = "700";
          head.style.marginBottom = "4px";
          root.appendChild(head);
          for (const line of lines.filter(Boolean)) {
            const row = document.createElement("div");
            row.textContent = line;
            row.style.fontSize = "12px";
            root.appendChild(row);
          }
          return root;
        };
        const icon = (color: string) =>
          L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
        if (myGps) {
          L.marker([myGps.lat, myGps.lng], { icon: icon("#0a84ff") })
            .addTo(map)
            .bindPopup(
              popupNode(`You · ${myName}`, [
                `ID: ${String(MeshEngine.localId || S.get("mesh_id", "") || "").trim() || "local-device"}`,
                `Number: ${myGridDisplay || resolveMyPublicNumber() || "Unavailable"}`,
              ])
            );
        }
        const bounds: [number, number][] = [];
        if (myGps) bounds.push([myGps.lat, myGps.lng]);
        for (const p of radarPeers) {
          L.marker([p.lat, p.lng], { icon: icon(p.online ? "#30d158" : "#98989f") })
            .addTo(map)
            .bindPopup(
              popupNode(p.name, [
                `ID: ${p.id}`,
                `User: ${formatMeshUserId(p)}`,
                p.distance != null ? `Distance: ${Math.round(p.distance)}m` : "",
              ])
            );
          bounds.push([p.lat, p.lng]);
        }
        if (bounds.length > 1) {
          try {
            map.fitBounds(bounds as any, { padding: [28, 28], maxZoom: 14 });
          } catch {}
        }
        mapObjRef.current = map;
        setTimeout(() => map.invalidateSize(), 200);
      } catch (e) {
        console.warn("[GridCaller] map", e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        mapObjRef.current?.remove();
      } catch {}
      mapObjRef.current = null;
    };
  }, [menuOpen, menuView, radarPeers, myGps, myName, myGridDisplay]);

  const networkPeopleCount = useMemo(() => {
    // Real connected devices only (no fabric ghosts / self duplicates)
    const { onlineCount } = listConnectedDevices({
      meshPeers: peers,
      globalPeers,
    });
    return onlineCount;
  }, [peers, globalPeers, towerTick]);

  const meshVisibleUsers = useMemo<MeshVisibleUser[]>(() => {
    const merged = new Map<string, MeshVisibleUser>();
    const add = (entry: Partial<MeshVisibleUser> & { id?: string }) => {
      const id = String(entry.id || "").trim();
      if (!id || blocked.includes(id) || isSelfPeer(id)) return;
      const prev = merged.get(id);
      merged.set(id, {
        id,
        name: String(entry.name || prev?.name || id.slice(0, 12)).trim() || id.slice(0, 12),
        online: entry.online ?? prev?.online ?? true,
        distance: entry.distance ?? prev?.distance,
        handle: entry.handle ?? prev?.handle,
        phone: entry.phone ?? prev?.phone,
        displayNumber: entry.displayNumber ?? prev?.displayNumber,
        lat: entry.lat ?? prev?.lat,
        lng: entry.lng ?? prev?.lng,
      });
    };

    for (const peer of peers) add(peer);
    for (const peer of meshMapPeers) add(peer);

    return Array.from(merged.values()).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [blocked, meshMapPeers, peers]);

  const radarPeers = useMemo(
    () =>
      meshVisibleUsers.filter(
        (peer): peer is MeshVisibleUser & { lat: number; lng: number } =>
          typeof peer.lat === "number" &&
          typeof peer.lng === "number" &&
          Number.isFinite(peer.lat) &&
          Number.isFinite(peer.lng)
      ),
    [meshVisibleUsers]
  );

  const refreshIdentityUi = (snapshot = getLocalDeviceIdentity()) => {
    setIdentityStatus(snapshot);
    setGlobalHandle(snapshot.handle);
    setMyGridDisplay(snapshot.displayNumber || resolveMyPublicNumber());
    setSettingsPhone(snapshot.phone);
    setSettingsDisplayNum(snapshot.displayNumber);
    setSettingsCallerId(snapshot.peerId || S.get("mesh_id") || S.get("ga_mesh_id") || MeshEngine.localId || "");
  };

  const syncIdentityFromDevice = async () => {
    setIdentityBusy(true);
    try {
      const peerId = String(S.get("mesh_id", "") || S.get("ga_mesh_id", "") || S.get("gc_peer_id", "") || identityStatus.peerId || "").trim();
      const snapshot = await syncLocalDeviceIdentity({ peerId });
      if (peerId) {
        S.set("mesh_id", peerId);
        S.set("ga_mesh_id", peerId);
        S.set("omni_node_id", peerId);
      }
      refreshIdentityUi(snapshot);
      try {
        if (snapshot.phone) softTower.bindSimAlias(snapshot.phone);
      } catch {}
      try {
        globalCall.setHandle?.(snapshot.handle);
      } catch {}
      try {
        meshComms.startPresence?.(myName, "user");
      } catch {}
      setIdSaveMsg(snapshot.note);
      setTimeout(() => setIdSaveMsg(""), 3200);
      return { ok: true, display: snapshot.displayNumber, note: snapshot.note };
    } catch (error: any) {
      const message = error?.message || "Could not sync local device identity";
      setIdSaveMsg(message);
      setTimeout(() => setIdSaveMsg(""), 3200);
      return { ok: false, error: message };
    } finally {
      setIdentityBusy(false);
    }
  };

  /** Profile Save: only local profile/name is editable. Identity is device-locked. */
  const applyProfileSave = () => {
    const n = settingsName.trim() || "Me";
    S.set("user_name", n);
    S.set("mesh_name", n);

    try {
      MeshEngine.setName?.(n);
    } catch {}
    try {
      meshComms.startPresence?.(n, "user");
    } catch {}

    const shown = getImmutableDisplayNumber() || resolveMyPublicNumber();
    refreshIdentityUi();
    setIdSaveMsg(`Saved · device identity stays ${shown || "—"}`);
    setTimeout(() => setIdSaveMsg(""), 3000);
  };

  /** Save a global call handle (phone/alias) and persist to identity storage. */
  const applyHandleSave = (handle: string): { ok: boolean; display?: string; error?: string } => {
    const h = String(handle || "").trim().replace(/^@/, "");
    if (!h) return { ok: false, error: "Handle cannot be empty" };
    S.set("global_call_handle", h);
    try {
      (globalCall as any).callHandle = h;
    } catch {}
    try {
      rememberDeviceIdentity({ phone: h.replace(/\D/g, "") || undefined });
    } catch {}
    refreshIdentityUi?.();
    return { ok: true, display: h };
  };

  const clearAllMessages = () => {
    if (sms.length === 0) {
      setContactBusy("No messages to clear");
      setTimeout(() => setContactBusy(""), 1500);
      return;
    }
    if (!confirm(`Clear all ${sms.length} message(s)?`)) return;
    setSms([]);
    S.set("gridcaller_sms", []);
    setThread(null);
    setComposeOpen(false);
    setContactBusy("All messages cleared");
    setTimeout(() => setContactBusy(""), 2000);
  };

  const clearTrashBin = () => {
    if (!sms.some((m) => m.folder === "trash")) {
      setContactBusy("Trash bin is empty");
      setTimeout(() => setContactBusy(""), 1500);
      return;
    }
    if (!confirm("Empty the trash bin permanently?")) return;
    setSms((p) => {
      const next = p.filter((m) => m.folder !== "trash");
      S.set("gridcaller_sms", next);
      return next;
    });
    setContactBusy("Trash bin cleared");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const moveSmsThreadToFolder = (peerId: string, folder: MessageFolder) => {
    if (!peerId) return;
    if (!confirm(folder === "trash" ? "Move this conversation to trash?" : "Delete this conversation?")) return;
    setSms((p) => {
      const next = p.map((m) => (m.peerId === peerId ? { ...m, folder } : m));
      S.set("gridcaller_sms", next);
      return next;
    });
    if (thread === peerId) setThread(null);
    setContactBusy(folder === "trash" ? "Conversation moved to trash" : "Conversation moved to deleted");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const deleteMessageThread = (peerId: string) => {
    moveSmsThreadToFolder(peerId, "deleted");
  };

  /** Delete one SMS bubble */
  const deleteSmsMessage = (id: string, folder: MessageFolder = "deleted") => {
    if (!id) return;
    if (!confirm(folder === "trash" ? "Move this message to trash?" : "Delete this message?")) return;
    setSms((p) => {
      const next = p.map((m) => (m.id === id ? { ...m, folder } : m));
      S.set("gridcaller_sms", next);
      return next;
    });
    setContactBusy(folder === "trash" ? "Message moved to trash" : "Message deleted");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const parseGroupMemberTokens = (raw: string) =>
    Array.from(new Set(raw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))).slice(0, 63);

  const normalizeGroupMembers = (tokens: string[]): string[] =>
    tokens.map((t) => String(t).trim()).filter(Boolean);

  const createGroupChat = () => {
    const name = String(groupNameInput || "").trim();
    if (!name) {
      setErr("Group name required");
      return;
    }
    const members = normalizeGroupMembers(parseGroupMemberTokens(groupMembersInput));
    if (members.length < 2) {
      setErr("Add at least one member ID/number/handle");
      return;
    }
    const row: GroupChat = {
      id: `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.slice(0, 40),
      members,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setGroupChats((prev) => [row, ...prev.filter((g) => g.id !== row.id)].slice(0, 80));
    setGroupViewId(row.id);
    setGroupNameInput("");
    setGroupMembersInput("");
    setContactBusy(`Group created: ${row.name}`);
    setTimeout(() => setContactBusy(""), 1800);
    try {
      MeshEngine.broadcast("GRID_GROUP_SYNC", { group: row });
    } catch {}
  };

  const sendGroupMessage = (
    groupId: string,
    text: string,
    attachment?: GroupAttachment,
    system = false
  ) => {
    const g = groupChats.find((x) => x.id === groupId);
    if (!g) return;
    const body = String(text || "").trim();
    if (!body && !attachment) return;
    const row: GroupMessage = {
      id: `gmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      groupId,
      fromId: MeshEngine.localId,
      fromName: myName,
      text: body,
      ts: Date.now(),
      mine: true,
      attachment,
      system,
    };
    setGroupMessages((prev) => [...prev, row].slice(-1200));
    setGroupDraft("");
    try {
      MeshEngine.broadcast("GRID_GROUP_MESSAGE", {
        id: row.id,
        groupId,
        fromName: myName,
        text: row.text,
        ts: row.ts,
        members: g.members,
        attachment: row.attachment,
        system,
      });
    } catch {}
  };

  const shareGroupLocation = (groupId: string) => {
    if (!myGps) {
      setErr("Location not ready yet");
      return;
    }
    sendGroupMessage(groupId, `Shared location: ${myGps.lat.toFixed(5)}, ${myGps.lng.toFixed(5)}`, {
      kind: "location",
      name: "Live location",
      lat: myGps.lat,
      lng: myGps.lng,
    });
  };

  const shareGroupFile = (groupId: string, file: File) => {
    const maxBytes = 2.5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setErr("File too large. Max 2.5MB for mesh share.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      const mime = file.type || "application/octet-stream";
      const kind: GroupAttachmentKind = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("audio/")
          ? "audio"
          : mime.startsWith("video/")
            ? "video"
            : /pdf|word|excel|sheet|text|json|xml|zip/.test(mime)
              ? "document"
              : "file";
      sendGroupMessage(groupId, `Shared ${file.name}`, {
        kind,
        name: file.name,
        mime,
        size: file.size,
        dataUrl,
      });
    };
    reader.readAsDataURL(file);
  };

  const closeActionComposer = () => {
    setActionComposer(null);
  };

  const openActionComposer = (mode: ActionComposerMode, target: ActionComposerTarget) => {
    setDirectAttachMenuOpen(false);
    setGroupAttachMenuOpen(false);
    setDirectChatMenuOpen(false);
    if (mode === "contact") {
      setActionComposerName("");
      setActionComposerNumber("");
    } else if (mode === "poll") {
      setActionComposerQuestion("");
      setActionComposerOptions("Yes\nNo");
    } else if (mode === "event") {
      setActionComposerTitle("");
      setActionComposerWhen(new Date().toLocaleString());
      setActionComposerPlace("");
    } else if (mode === "schedule-call") {
      setActionComposerWhen(new Date().toLocaleString());
    }
    setActionComposer({ mode, target });
  };

  const dispatchComposerMessage = (payload: string) => {
    if (!actionComposer) return;
    if (actionComposer.target.kind === "direct") {
      sendDirectQuickText(actionComposer.target.peerId, actionComposer.target.peerName, payload);
      return;
    }
    sendGroupMessage(actionComposer.target.groupId, payload);
  };

  const submitActionComposer = () => {
    if (!actionComposer) return;
    if (actionComposer.mode === "contact") {
      const contactName = String(actionComposerName || "").trim();
      const contactNumber = String(actionComposerNumber || "").trim();
      if (!contactName || !contactNumber) {
        setErr("Add both contact name and handle/number");
        return;
      }
      dispatchComposerMessage(`Contact shared\nName: ${contactName}\nID/Phone: ${contactNumber}`);
      closeActionComposer();
      return;
    }
    if (actionComposer.mode === "poll") {
      const question = String(actionComposerQuestion || "").trim();
      if (!question) {
        setErr("Add a poll question");
        return;
      }
      const options = String(actionComposerOptions || "")
        .split(/\n|,/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 6);
      const lines = options.length ? options.map((op, i) => `${i + 1}. ${op}`).join("\n") : "1. Yes\n2. No";
      dispatchComposerMessage(`Poll\n${question}\n${lines}`);
      closeActionComposer();
      return;
    }
    if (actionComposer.mode === "event") {
      const title = String(actionComposerTitle || "").trim();
      if (!title) {
        setErr("Add an event title");
        return;
      }
      const when = String(actionComposerWhen || "").trim();
      const place = String(actionComposerPlace || "").trim();
      dispatchComposerMessage(`Event\n${title}${when ? `\nWhen: ${when}` : ""}${place ? `\nWhere: ${place}` : ""}`);
      closeActionComposer();
      return;
    }
    const when = String(actionComposerWhen || "").trim();
    if (!when || actionComposer.target.kind !== "direct") {
      setErr("Add a schedule time");
      return;
    }
    sendSms(actionComposer.target.peerId, actionComposer.target.peerName, `Scheduled call at ${when}`);
    closeActionComposer();
  };

  const sendGridchatContactCard = (groupId: string) => {
    const groupName = groupChats.find((g) => g.id === groupId)?.name || "Group";
    openActionComposer("contact", { kind: "group", groupId, groupName });
  };

  const sendGridchatPoll = (groupId: string) => {
    const groupName = groupChats.find((g) => g.id === groupId)?.name || "Group";
    openActionComposer("poll", { kind: "group", groupId, groupName });
  };

  const sendGridchatEvent = (groupId: string) => {
    const groupName = groupChats.find((g) => g.id === groupId)?.name || "Group";
    openActionComposer("event", { kind: "group", groupId, groupName });
  };

  const sendGridchatSticker = (groupId: string) => {
    const stickers = ["😀", "🔥", "💚", "🎉", "👍", "🙏", "⚡", "🚀", "📶", "🛰️"];
    const pick = stickers[Math.floor(Math.random() * stickers.length)] || "😀";
    sendGroupMessage(groupId, `Sticker ${pick}`);
  };

  const runGridchatAttachAction = (groupId: string, action: "document" | "photos" | "camera" | "audio" | "contact" | "poll" | "event" | "sticker") => {
    setGroupAttachMenuOpen(false);
    if (action === "document") {
      groupDocumentInputRef.current?.click();
      return;
    }
    if (action === "photos") {
      groupMediaInputRef.current?.click();
      return;
    }
    if (action === "camera") {
      groupCameraInputRef.current?.click();
      return;
    }
    if (action === "audio") {
      groupAudioInputRef.current?.click();
      return;
    }
    if (action === "contact") {
      sendGridchatContactCard(groupId);
      return;
    }
    if (action === "poll") {
      sendGridchatPoll(groupId);
      return;
    }
    if (action === "event") {
      sendGridchatEvent(groupId);
      return;
    }
    sendGridchatSticker(groupId);
  };

  const startGroupCall = async (groupId: string, mode: "audio" | "video") => {
    const g = groupChats.find((x) => x.id === groupId);
    if (!g) return;
    const targets = g.members.filter((m) => !isCallAddressedToMe(m) && !blocked.includes(m));
    if (!targets.length) {
      setErr("No valid members to call");
      return;
    }
    const primary = targets[0];
    await placeCall(primary, primary);
    if (mode === "video") {
      setTimeout(() => {
        void toggleVideoCall().catch(() => {});
      }, 900);
    }
    const note = `${mode === "video" ? "Video" : "Voice"} group call started by ${myName}`;
    sendGroupMessage(groupId, note, undefined, true);
    try {
      MeshEngine.broadcast("GRID_GROUP_CALL_INVITE", {
        groupId,
        mode,
        fromName: myName,
        members: g.members,
        ts: Date.now(),
      });
    } catch {}
  };

  /** Resolve handle / phone / id → mesh peer id (critical for handshake calls) */
  const resolveDialTarget = async (
    raw: string
  ): Promise<{ id: string; name: string } | null> => {
    const q = String(raw || "").trim();
    if (!q) return null;
    // Local ONLINE list first
    const dig = q.replace(/\D/g, "");
    const h = q.replace(/^@/, "").toLowerCase();
    for (const p of peers) {
      if (p.id === q) return { id: p.id, name: p.name };
      if (p.handle && p.handle.toLowerCase() === h) return { id: p.id, name: p.name };
      if (dig.length >= 10 && p.phone && p.phone.slice(-10) === dig.slice(-10)) {
        return { id: p.id, name: p.name };
      }
      if (p.name && p.name.toLowerCase() === h) return { id: p.id, name: p.name };
    }
    // Hub directory
    try {
      const hit = await resolveMeshTarget(q);
      if (hit?.id && !isSelfPeer(hit.id)) {
        return { id: hit.id, name: hit.name || hit.handle || hit.id };
      }
    } catch {}
    // MeshEngine peers map
    try {
      const mp = (MeshEngine as any).peers || {};
      for (const [id, v] of Object.entries(mp) as any) {
        if (id === q) return { id, name: v?.name || id };
        if (v?.handle && String(v.handle).toLowerCase() === h) {
          return { id, name: v.name || id };
        }
        if (dig.length >= 10 && v?.phone && String(v.phone).slice(-10) === dig.slice(-10)) {
          return { id, name: v.name || id };
        }
      }
    } catch {}
    // Persistent mesh memory (even if peer briefly offline)
    try {
      const mem = resolveFromDirectory(q);
      if (mem && !isSelfPeer(mem.id)) {
        return { id: mem.id, name: mem.name || mem.handle || mem.id };
      }
    } catch {}
    // Already a mesh id shape
    if (/^user_|^node_|^gc_|^web/i.test(q)) return { id: q, name: q };
    return null;
  };

  /** Explicit mesh call (GridCaller network) — accepts handle, phone, or peer id */
  const callMeshNetwork = (peerId: string, name: string) => {
    if (!peerId.trim()) {
      setErr("Enter the other phone's handle / number, or tap Call on ONLINE list");
      return;
    }
    void (async () => {
      setErr("");
      setCallMethod("Finding peer on mesh…");
      try {
        (MeshEngine as any).reconnect?.();
      } catch {}
      const target = await resolveDialTarget(peerId.trim());
      if (!target) {
        setErr(
          "Peer not found on mesh. Both phones: same Wi‑Fi, GridCaller open, handle saved. Wait 5s, check ONLINE list."
        );
        setCallMethod("");
        return;
      }
      if (isSelfPeer(target.id)) {
        setErr("That is your own handle/number. Dial the other phone's handle.");
        setCallMethod("");
        return;
      }
      setCallMethod(`Calling ${target.name}…`);
      void placeCallLocal(target.id, name.trim() || target.name);
    })();
  };

  /** Explicit any-mobile / cellular path (mesh hub → PSTN / dialer) */
  const callAnyMobile = async (number: string, name?: string) => {
    const n = number.trim();
    if (!n) {
      setErr("Enter a mobile number");
      return;
    }
    if (!looksLikePhoneNumber(n)) {
      setErr("Enter a valid mobile number (10+ digits)");
      return;
    }
    await placeCall(n, name || n);
  };

  /** Mesh message */
  const msgMeshNetwork = (peerId: string, name?: string) => {
    const id = peerId.trim();
    if (!id) {
      setErr("Enter a peer ID from the online list");
      return;
    }
    if (isSelfPeer(id)) {
      setErr("Cannot message yourself. Choose another mesh peer.");
      return;
    }
    setThread(id);
    setTab("sms");
    if (name) {
      /* thread uses peerId */
    }
  };

  /**
   * SMS to any mobile: hub PSTN (Twilio when configured) → OS SMS app fallback.
   * Path: GridCaller → mesh hub → mobile network (or device SMS).
   */
  const msgAnyMobile = async (number: string, text?: string) => {
    const n = number.trim().replace(/\s/g, "");
    if (!looksLikePhoneNumber(n)) {
      setErr("Enter a valid mobile number for SMS");
      return;
    }
    const bodyText = (text || "").trim();
    try {
      const r = await pstnBridge.sendSmsAnyNumber(n, bodyText || "Hello from GridCaller", {
        fromName: myName,
      });
      if (r.ok) {
        const id = `sms_${Date.now().toString(36)}`;
        setSms((p) => [
          ...p,
          {
            id,
            peerId: n,
            name: n,
            text: bodyText || r.message || "SMS",
            ts: Date.now(),
            mine: true,
            folder: "sent",
          },
        ]);
        try {
          gridNumberRegistry.logMessage({
            direction: "out",
            folder: "sent",
            peerNumber: n,
            peerName: n,
            text: bodyText || r.message || "SMS",
            method: r.provider || r.path || "pstn-sms",
            refId: id,
          });
        } catch {}
        setContactBusy(
          r.path === "pstn" && !r.dryRun
            ? `SMS sent via network → ${r.to}`
            : r.path === "sms"
              ? "Opened device SMS"
              : `SMS ready · ${r.provider || "network"}`
        );
        setTimeout(() => setContactBusy(""), 3500);
        if (r.path === "sms" || r.dryRun) {
          /* OS SMS or dry-run handled in bridge */
        }
        setErr("");
        return;
      }
      setErr(r.error || "SMS failed");
    } catch (e: any) {
      setErr(e?.message || "SMS error");
    }
  };

  const blockCaller = (peerId: string, name?: string) => {
    if (!peerId) return;
    setBlocked((b) => (b.includes(peerId) ? b : [...b, peerId]));
    try {
      gridNumberRegistry.logBlock({ peerId, peerName: name, action: "blocked", reason: "user_blocked_contact" });
    } catch {}
    try {
      contactsVault.upsert({
        name: name || peerId.slice(0, 12),
        peerId,
        phones: [],
        spam: true,
        source: "mesh",
        notes: "Blocked on GridCaller",
      });
      refreshContacts();
    } catch {}
    setMeshMapPeers((prev) => prev.filter((p) => p.id !== peerId));
    setContactBusy(`Blocked ${name || peerId.slice(0, 10)}`);
    setTimeout(() => setContactBusy(""), 2500);
  };

  const unblockCaller = (peerId: string) => {
    setBlocked((b) => b.filter((x) => x !== peerId));
    try {
      gridNumberRegistry.logBlock({ peerId, action: "unblocked", reason: "user_unblocked_contact" });
    } catch {}
    setContactBusy("Unblocked");
    setTimeout(() => setContactBusy(""), 2000);
  };

  /** Save GridCaller number / ID on this device */
  const saveGridNumberToDevice = (opts: {
    name: string;
    phone?: string;
    peerId?: string;
    displayNumber?: string;
  }) => {
    const name = opts.name.trim();
    if (!name) {
      setErr("Name required to save number");
      return null;
    }
    const phones: string[] = [];
    if (opts.phone) phones.push(opts.phone);
    if (opts.displayNumber && opts.displayNumber !== opts.phone) phones.push(opts.displayNumber);
    const saved = contactsVault.upsert({
      name,
      phones: Array.from(new Set(phones.map((p) => String(p).trim()).filter(Boolean))),
      peerId: opts.peerId || undefined,
      source: opts.peerId ? "mesh" : "manual",
      notes: opts.peerId ? `GridCaller ID: ${opts.peerId}` : "Saved GridCaller number",
      favourite: false,
      spam: false,
    });
    refreshContacts();
    setContactBusy(`Saved ${saved.name} on device`);
    setTimeout(() => setContactBusy(""), 2500);
    return saved;
  };

  const placeCall = async (peerId: string, name: string) => {
    if (blocked.includes(peerId)) {
      try {
        gridNumberRegistry.logCall({
          dir: "blocked",
          peerId,
          peerName: name,
          method: "gridcaller",
          reason: "user_blocked_contact",
        });
      } catch {}
      setErr("This contact is blocked");
      return;
    }

    try {
      meshComms.hangUpCall?.();
      globalCall.hangup();
      pcRef.current?.close();
      (pcRef.current as any)?._unsub?.();
    } catch {}
    pcRef.current = null;

    void sovereignMesh.callCostGC(peerId);
    setErr("");
    setCallPeer({ id: peerId, name });
    setPhase("outgoing");
    setSecs(0);

    // ═══ Path 0: mesh peer (id / handle / number on ONLINE) → stable CallSession ═══
    try {
      // Direct mesh id from ONLINE list
      if (/^user_|^web|^node_|^gc_/i.test(peerId) && !isSelfPeer(peerId)) {
        await placeCallLocal(peerId, name || peerId);
        return;
      }
      const meshHit = await resolveDialTarget(peerId);
      if (meshHit && !isSelfPeer(meshHit.id)) {
        setCallMethod(`Mesh call → ${meshHit.name}`);
        await placeCallLocal(meshHit.id, name || meshHit.name);
        return;
      }
    } catch (e: any) {
      setErr(e?.message || "Mesh call failed");
      setPhase("idle");
      return;
    }

    // ═══ Path A: real cellular number → PSTN (Twilio) or OS dialer ═══
    if (looksLikePhoneNumber(peerId) || looksLikePhoneNumber(name)) {
      const dialTo = looksLikePhoneNumber(peerId) ? peerId : name;
      setCallMethod("Cellular / virtual number…");
      try {
        const r = await pstnBridge.callAnyNumber(dialTo, {
          callerName: myName,
          message: `GridCaller virtual call from ${myName}${myGridDisplay ? " (" + myGridDisplay + ")" : ""}.`,
          allowTelFallback: true,
        });
        if (r.ok) {
          setCallMethod(
            r.dryRun
              ? r.path === "tel"
                ? "Phone call · OS dialer opened (no Twilio). For free mesh: other phone must run GridCaller + appear ONLINE."
                : `Phone call · PSTN dry-run → ${r.to}`
              : `Phone call · PSTN ringing ${r.to} · ${r.provider}`
          );
          if (r.path === "pstn" && !r.dryRun) {
            setPhase("active");
            startedAt.current = Date.now();
          }
          if (r.path === "tel" || r.dryRun) {
            try {
              gridNumberRegistry.logCall({
                dir: "out",
                peerId: dialTo,
                peerNumber: dialTo,
                peerName: name || dialTo,
                method: r.path === "tel" ? "phone call · tel" : `phone call · ${r.provider || r.path || "pstn-dry-run"}`,
                reason: r.dryRun ? "dry-run" : "opened-os-dialer",
              });
            } catch {}
            setTimeout(() => {
              setPhase("idle");
              setCallPeer(null);
            }, 3500);
          }
          return;
        } else {
          setErr(r.error || "Cellular call failed");
        }
      } catch (e: any) {
        setErr(e?.message || "PSTN error");
      }
    }

    setCallMethod("Soft tower hop…");

    // Multi-hop soft-tower invite (every phone = relay tower)
    try {
      softTowerHop.start(myName);
      softTowerHop.sendCallSignal(peerId, {
        action: "invite",
        type: "MESH_CALL_INVITE",
        callId: `c_${Date.now()}`,
        fromName: myName,
        video: false,
      });
    } catch {}

    // Free mesh path: soft-tower + WebRTC
    try {
      sovereignCall.start({ id: user?.id, name: myName, phone: user?.phone || S.get("user_phone", "") });
      softTower.start({ id: user?.id, name: myName, phone: user?.phone || S.get("user_phone", "") });
      if (user?.phone) softTower.bindSimAlias(String(user.phone));

      const sc = await sovereignCall.placeCall(peerId, {
        fromName: myName,
        preferLocal: callScope !== "global",
      });

      if (sc.mode === "webrtc" && sc.pc) {
        setCallPeer({ id: sc.toId || peerId, name: sc.toName || name });
        pcRef.current = sc.pc;
        setCallMethod("Connected");
        setErr("");
        setTimeout(() => {
          if (pcRef.current?.connectionState === "connected") {
            setPhase("active");
            startedAt.current = Date.now();
            setCallMethod("In call");
          }
        }, 1200);
        return;
      }

      // Peer offline — still try mesh id direct once
      try {
        const result = await meshComms.callWithFallback?.(peerId, { name });
        if (result?.pc) {
          pcRef.current = result.pc;
          setPhase("active");
          startedAt.current = Date.now();
          setCallMethod("Connected");
          return;
        }
      } catch {}

      setPhase("idle");
      setCallPeer(null);
      setCallMethod("");
      setErr("Unable to connect");
    } catch (e: any) {
      setPhase("idle");
      setCallPeer(null);
      setErr(e?.message || "Call failed");
    }
  };

  /** Attach remote audio + video from WebRTC track events — REAL playback */
  const isCallAddressedToMe = (to: string) => {
    if (!to) return false;
    const myId = MeshEngine.localId;
    const myHandle = String(S.get("global_call_handle", "") || "").replace(/^@/, "");
    const myPhone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
    const myDisp = String(S.get("gc_test_display_number", "") || "").replace(/\D/g, "");
    const toRaw = String(to).replace(/^@/, "");
    const toDig = toRaw.replace(/\D/g, "");
    if (toRaw === myId) return true;
    if (myHandle && toRaw === myHandle) return true;
    if (myPhone.length >= 10 && toDig.length >= 10 && myPhone.slice(-10) === toDig.slice(-10)) return true;
    if (myDisp.length >= 10 && toDig.length >= 10 && myDisp.slice(-10) === toDig.slice(-10)) return true;
    if (myHandle && toDig.length >= 10 && myHandle.replace(/\D/g, "").slice(-10) === toDig.slice(-10)) return true;
    return false;
  };

  const bindRemoteMedia = (stream: MediaStream) => {
    remoteStreamRef.current = stream;
    void playRemoteStream(stream);
    void setSpeakerphone(true);
    const hasVid = stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);
    setRemoteHasVideo(hasVid);
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.play().catch(() => {});
    }
    stream.getAudioTracks().forEach((t) => {
      t.enabled = true;
      t.onunmute = () => void playRemoteStream(stream);
    });
    stream.getVideoTracks().forEach((t) => {
      t.onended = () => {
        const still = stream.getVideoTracks().some((x) => x.readyState === "live" && x.enabled);
        setRemoteHasVideo(still);
      };
      t.onmute = () => setRemoteHasVideo(false);
      t.onunmute = () => setRemoteHasVideo(true);
    });
  };

  /** Renegotiate after adding/removing video mid-call */
  const renegotiateCall = async (pc: RTCPeerConnection, withVideo: boolean) => {
    const peerId = activePeerIdRef.current || callPeer?.id || "";
    const callId = activeCallIdRef.current || `gc_reneg_${Date.now()}`;
    activeCallIdRef.current = callId;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    MeshEngine.broadcast("GRIDCALLER_RENEGOTIATE", {
      callId,
      to: peerId,
      offer,
      video: withVideo,
      fromName: myName,
    });
  };

  /**
   * Voice ↔ video switch during active call.
   * Camera on → add video track + renegotiate. Camera off → remove video track.
   */
  const toggleVideoCall = async () => {
    const pc = pcRef.current;
    if (!pc || phase === "idle") {
      setErr("Start a call first, then switch to video");
      return;
    }
    if (cameraBusy) return;
    setCameraBusy(true);
    setErr("");
    try {
      if (videoOn) {
        // Switch to voice only
        localStream.current?.getVideoTracks().forEach((t) => {
          t.stop();
          try {
            localStream.current?.removeTrack(t);
          } catch {}
        });
        const sender = pc.getSenders().find((s) => s.track?.kind === "video" || s.track === null);
        const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (videoSender) {
          try {
            await videoSender.replaceTrack(null);
          } catch {
            try {
              pc.removeTrack(videoSender);
            } catch {}
          }
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        setVideoOn(false);
        setCallMethod("Voice call");
        await renegotiateCall(pc, false);
      } else {
        // Switch voice → video
        const cam = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingUser ? "user" : "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        const vTrack = cam.getVideoTracks()[0];
        if (!vTrack) throw new Error("Camera not available");
        if (!localStream.current) {
          localStream.current = new MediaStream();
        }
        localStream.current.addTrack(vTrack);
        const existing = pc.getSenders().find((s) => s.track?.kind === "video");
        if (existing) {
          await existing.replaceTrack(vTrack);
        } else {
          pc.addTrack(vTrack, localStream.current);
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([vTrack]);
          localVideoRef.current.play().catch(() => {});
        }
        setVideoOn(true);
        setCallMethod("Video call");
        await renegotiateCall(pc, true);
      }
    } catch (e: any) {
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setErr("Camera permission denied. Allow camera in settings.");
      } else if (name === "NotFoundError") {
        setErr("No camera found on this device.");
      } else {
        setErr(e?.message || "Could not switch camera");
      }
    } finally {
      setCameraBusy(false);
    }
  };

  /** Flip front/back camera while video is on */
  const flipCamera = async () => {
    if (!videoOn || !pcRef.current) return;
    setCameraBusy(true);
    try {
      const nextFacing = !facingUser;
      localStream.current?.getVideoTracks().forEach((t) => {
        t.stop();
        try {
          localStream.current?.removeTrack(t);
        } catch {}
      });
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing ? "user" : "environment" },
        audio: false,
      });
      const vTrack = cam.getVideoTracks()[0];
      localStream.current?.addTrack(vTrack);
      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(vTrack);
      else if (localStream.current) pcRef.current.addTrack(vTrack, localStream.current);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = new MediaStream([vTrack]);
        localVideoRef.current.play().catch(() => {});
      }
      setFacingUser(nextFacing);
    } catch (e: any) {
      setErr(e?.message || "Could not flip camera");
    } finally {
      setCameraBusy(false);
    }
  };

  /** Mesh call via always-on CallSession (ring + answer + real audio) */
  const placeCallLocal = async (peerId: string, name: string) => {
    if (!peerId || isSelfPeer(peerId)) {
      setErr("Cannot call yourself — use the other phone's number / ONLINE peer");
      return;
    }
    setErr("");
    setCallPeer({ id: peerId, name: name || peerId });
    callPeerRef.current = { id: peerId, name: name || peerId };
    setPhase("outgoing");
    phaseRef.current = "outgoing";
    setCallMethod("Calling…");
    setSecs(0);
    startCallSession();
    try {
      // Always voice-first (video mid-call) — stops cam-deny crash on tap
      await startOutgoingCall(peerId, name || peerId, false);
    } catch (e: any) {
      setErr(e?.message || "Call failed — allow Microphone");
      setPhase("idle");
      phaseRef.current = "idle";
    }
  };

  const startDirectHeaderCall = async (peerId: string, name: string, mode: "audio" | "video") => {
    await placeCall(peerId, name || peerId);
    if (mode === "video") {
      setTimeout(() => {
        void toggleVideoCall().catch(() => {});
      }, 900);
    }
  };

  // Call signaling: kernel/callSession (always-on). UI synced via onCallUi.
  useEffect(() => {
    startCallSession();
  }, []);

  const hangup = (reason = "hangup") => {
    const peer = callPeerRef.current || callPeer;
    const ph = phaseRef.current || phase;
    const dur = ph === "active" ? Math.floor((Date.now() - startedAt.current) / 1000) : secs;
    endCall(reason);
    stopCallSounds();
    try {
      meshComms.hangUpCall?.(peer?.id);
    } catch {}
    try {
      globalCall.hangup();
    } catch {}
    if (peer) {
      let dir: "in" | "out" | "missed" = "out";
      if (reason === "missed" || reason === "reject" || reason === "no-answer" || (ph === "incoming" && dur === 0))
        dir = "missed";
      else if (ph === "incoming" || isIncoming) dir = "in";
      else if (ph === "outgoing" && dur === 0) dir = "out";
      else if (ph === "active") dir = isIncoming ? "in" : "out";
      try {
        gridNumberRegistry.logCall({
          dir: dir === "missed" ? "missed" : dir === "in" ? "in" : "out",
          peerId: peer.id,
          peerName: peer.name,
          method: callMethod || reason,
          durationSec: dur,
        });
      } catch {}
    }
    setPhase("idle");
    phaseRef.current = "idle";
    setCallPeer(null);
    callPeerRef.current = null;
    setSecs(0);
    if (onClose && initialPeerId) onClose();
  };

  const acceptIncoming = () => {
    resumeAudioContext();
    setCallMethod("Answering…");
    void acceptCall().catch((e: any) => {
      setErr(e?.message || "Accept failed — allow Microphone");
    });
  };

  const sendSms = (peerId: string, name: string, text: string, attachment?: GroupAttachment) => {
    const t = text.trim();
    if (!t && !attachment) return;
    void (async () => {
      // Resolve handle/phone → mesh id (same as call)
      let toId = peerId.trim();
      let toName = name;
      try {
        const hit = await resolveDialTarget(peerId);
        if (hit) {
          toId = hit.id;
          toName = name || hit.name;
        }
      } catch {}
      if (blocked.includes(toId) || blocked.includes(peerId)) {
        try {
          gridNumberRegistry.logMessage({
            direction: "blocked",
            folder: "blocked",
            peerId: toId || peerId,
            peerName: toName || name,
            text: t,
            attachment,
            method: "gridcaller-mesh-sms",
            reason: "user_blocked_contact",
          });
        } catch {}
        setErr("This contact is blocked");
        return;
      }
      if (isSelfPeer(toId) || isSelfPeer(peerId)) {
        setErr("Cannot message yourself — dial the other number (9503154355 ↔ 9284048967)");
        return;
      }
      const id = `sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const row: SmsRow = { id, peerId: toId, name: toName, text: t, ts: Date.now(), mine: true, folder: "sent", attachment };
      setSms((p) => [...p, row]);
      try {
        gridNumberRegistry.logMessage({
          direction: "out",
          folder: "sent",
          peerId: row.peerId,
          peerName: row.name,
          text: row.text,
          attachment: row.attachment,
          method: "gridcaller-mesh-sms",
          refId: row.id,
          ts: row.ts,
        });
      } catch {}
      // Single directed path only — no walkie flood (that was self-echo)
      try {
        MeshEngine.broadcast("GRIDCALLER_SMS", {
          id,
          text: t,
          fromName: myName,
          to: toId,
          attachment,
          handle: S.get("global_call_handle", "") || "",
          phone: S.get("user_phone", "") || "",
        });
      } catch (e: any) {
        setErr(e?.message || "Send failed — check hub Wi‑Fi");
      }
      bus.emit("gridcaller:sms_sent", row);
    })();
  };

  const blockedPeersSet = useMemo(() => new Set(blocked), [blocked]);

  const filteredPeers = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return peers;
    return peers.filter((p) => p.name.toLowerCase().includes(qq) || p.id.includes(qq));
  }, [peers, q]);

  const filteredContacts = useMemo(() => {
    let list = q.trim() ? contactsVault.search(q) : contacts;
    if (contactFilter === "fav") return list.filter((c) => c.favourite && !c.spam);
    if (contactFilter === "spam") return list.filter((c) => c.spam);
    // All: hide spam from main list (Truecaller-style) unless user is searching
    if (!q.trim()) return list.filter((c) => !c.spam);
    return list;
  }, [contacts, q, contactFilter]);

  const contactStats = useMemo(() => contactsVault.stats(), [contacts]);

  const refreshContacts = () => setContacts(contactsVault.list());

  const openNewContact = (prefill?: Partial<GridContact>) => {
    setContactEdit({
      name: prefill?.name || "",
      phones: prefill?.phones || (prefill as any)?.phone ? [(prefill as any).phone] : [],
      emails: prefill?.emails || [],
      company: prefill?.company || "",
      notes: prefill?.notes || "",
      favourite: false,
      spam: false,
      source: "manual",
    });
  };

  const openEditContact = (c: GridContact) => {
    setContactEdit({ ...c });
    setContactView(null);
  };

  const saveContactForm = () => {
    if (!contactEdit?.name?.trim()) {
      setErr("Name is required");
      return;
    }
    const phones = (contactEdit.phones || [])
      .map((p) => String(p || "").trim())
      .filter(Boolean);
    const emails = (contactEdit.emails || [])
      .map((e) => String(e || "").trim())
      .filter(Boolean);
    const peerId = String((contactEdit as any).peerId || "").trim() || undefined;
    const saved = contactsVault.upsert({
      ...contactEdit,
      name: contactEdit.name.trim(),
      phones,
      emails,
      peerId,
      notes:
        contactEdit.notes ||
        (peerId ? `GridCaller ID: ${peerId}` : undefined),
      source: contactEdit.source || (peerId ? "mesh" : "manual"),
    });
    refreshContacts();
    setContactEdit(null);
    setContactView(saved);
    setContactBusy("Saved on this device");
    setTimeout(() => setContactBusy(""), 2000);
  };

  const deleteContact = (id: string) => {
    if (!confirm("Delete this contact?")) return;
    contactsVault.remove(id);
    refreshContacts();
    setContactView(null);
    setContactEdit(null);
  };

  const callContact = (c: GridContact) => {
    const target = c.peerId || contactsVault.getPrimaryPhone(c) || c.phones[0] || c.name;
    if (!target) {
      setErr("No phone or mesh ID on this contact");
      return;
    }
    void placeCall(target, c.name);
  };

  const messageContact = (c: GridContact) => {
    const target = c.peerId || contactsVault.getPrimaryPhone(c) || c.phones[0];
    if (!target) {
      setErr("No phone or mesh ID to message");
      return;
    }
    setThread(target);
  };

  const importDeviceContacts = async () => {
    setContactBusy("Opening device contacts…");
    const res = await contactsVault.importFromDevice();
    refreshContacts();
    if (res.ok) {
      setContactBusy(`Imported ${res.count} contact${res.count === 1 ? "" : "s"} from device`);
    } else {
      setContactBusy(res.error || "Import cancelled");
    }
    setTimeout(() => setContactBusy(""), 3500);
  };

  const exportContacts = () => {
    const json = contactsVault.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gridcaller-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setContactBusy(`Exported ${contacts.length} contacts`);
    setTimeout(() => setContactBusy(""), 2500);
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = contactsVault.importJson(String(reader.result || ""));
      refreshContacts();
      if (res.ok) setContactBusy(`Imported ${res.count} contacts`);
      else setErr(res.error || "Import failed");
      setTimeout(() => setContactBusy(""), 3000);
    };
    reader.readAsText(file);
  };

  const syncMeshToContacts = () => {
    const meshRows = [
      ...peers.map((p) => ({ id: p.id, name: p.name, online: p.online })),
      ...globalPeers.map((p) => ({ id: p.id, name: p.name, online: p.online })),
    ];
    contactsVault.syncMeshPeers(meshRows);
    refreshContacts();
    setContactBusy(`Synced ${meshRows.length} mesh peer${meshRows.length === 1 ? "" : "s"}`);
    setTimeout(() => setContactBusy(""), 2500);
  };

  const folderMatches = (m: SmsRow, folder: MessageFolder) => {
    if (folder === "inbox") return !m.mine && (m.folder === "inbox" || m.folder === "received");
    if (folder === "received") return !m.mine;
    if (folder === "sent") return m.mine && (m.folder === "sent" || m.folder === "outbox");
    if (folder === "draft") return m.folder === "draft";
    if (folder === "outbox") return m.folder === "outbox";
    if (folder === "deleted") return m.folder === "deleted";
    return m.folder === "trash";
  };

  const smsThreads = useMemo(() => {
    const map = new Map<string, SmsRow>();
    for (const m of sms) {
      if (!folderMatches(m, messageFolder)) continue;
      const prev = map.get(m.peerId);
      if (!prev || m.ts > prev.ts) map.set(m.peerId, m);
    }
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }, [sms, messageFolder]);

  const threadMsgs = useMemo(() => {
    if (!thread) return [];
    return sms.filter((m) => m.peerId === thread && folderMatches(m, messageFolder)).sort((a, b) => a.ts - b.ts);
  }, [sms, thread, messageFolder]);

  const activeGroup = useMemo(() => groupChats.find((g) => g.id === groupViewId) || null, [groupChats, groupViewId]);
  const activeGroupMsgs = useMemo(
    () => (groupViewId ? groupMessages.filter((m) => m.groupId === groupViewId).sort((a, b) => a.ts - b.ts) : []),
    [groupMessages, groupViewId]
  );
  const visibleGroupMsgs = useMemo(() => {
    let rows = activeGroupMsgs;
    if (groupShowStarredOnly) rows = rows.filter((m) => starredMessageIds.includes(m.id));
    const qx = groupSearchQuery.trim().toLowerCase();
    if (qx) rows = rows.filter((m) => `${m.fromName} ${m.text} ${m.attachment?.name || ""}`.toLowerCase().includes(qx));
    return rows;
  }, [activeGroupMsgs, groupSearchQuery, groupShowStarredOnly, starredMessageIds]);

  const gridchatItems = useMemo(() => {
    const peerNameById = new Map<string, { name: string; online: boolean }>();
    for (const p of [...peers, ...globalPeers]) {
      const prev = peerNameById.get(p.id);
      if (!prev) peerNameById.set(p.id, { name: p.name || p.id, online: !!p.online });
      else if (p.online) peerNameById.set(p.id, { name: prev.name || p.name || p.id, online: true });
    }

    const directLatest = new Map<string, SmsRow>();
    const directUnread = new Map<string, number>();
    for (const row of sms) {
      if (row.folder === "trash" || row.folder === "deleted") continue;
      const key = `d:${row.peerId}`;
      const prev = directLatest.get(row.peerId);
      if (!prev || row.ts > prev.ts) directLatest.set(row.peerId, row);
      if (!row.mine && row.ts > Number(gridchatLastSeen[key] || 0)) {
        directUnread.set(row.peerId, (directUnread.get(row.peerId) || 0) + 1);
      }
    }

    const groupLatest = new Map<string, GroupMessage>();
    const groupUnread = new Map<string, number>();
    for (const row of groupMessages) {
      const key = `g:${row.groupId}`;
      const prev = groupLatest.get(row.groupId);
      if (!prev || row.ts > prev.ts) groupLatest.set(row.groupId, row);
      if (!row.mine && row.ts > Number(gridchatLastSeen[key] || 0)) {
        groupUnread.set(row.groupId, (groupUnread.get(row.groupId) || 0) + 1);
      }
    }

    const out: {
      id: string;
      kind: "group" | "direct";
      name: string;
      alias: string;
      preview: string;
      ts: number;
      unread: number;
      favourite: boolean;
      muted: boolean;
      online: boolean;
      peerId?: string;
      groupId?: string;
      memberInfo: string;
      mediaIcon: "text" | "photo" | "audio" | "video" | "doc" | "location";
    }[] = [];

    for (const g of groupChats) {
      const last = groupLatest.get(g.id);
      const preview = last?.text?.trim() || summarizeGroupAttachment(last?.attachment) || "Group created";
      let mediaIcon: "text" | "photo" | "audio" | "video" | "doc" | "location" = "text";
      if (last?.attachment?.kind === "image") mediaIcon = "photo";
      else if (last?.attachment?.kind === "audio") mediaIcon = "audio";
      else if (last?.attachment?.kind === "video") mediaIcon = "video";
      else if (last?.attachment?.kind === "location") mediaIcon = "location";
      else if (last?.attachment) mediaIcon = "doc";
      const unread = groupUnread.get(g.id) || 0;
      const rowId = `g:${g.id}`;
      out.push({
        id: rowId,
        kind: "group",
        name: g.name,
        alias: gridchatAlias(g.name, g.id),
        preview,
        ts: Math.max(last?.ts || 0, g.updatedAt || g.createdAt || 0),
        unread,
        favourite: gridchatFavourites.includes(rowId),
        muted: gridchatMuted.includes(rowId),
        online: g.members.some((m) => peerNameById.get(m)?.online),
        groupId: g.id,
        memberInfo: `${g.members.length} members`,
        mediaIcon,
      });
    }

    const knownDirectIds = new Set<string>([...directLatest.keys(), ...peerNameById.keys()]);
    for (const pid of knownDirectIds) {
      const last = directLatest.get(pid);
      const fallback = peerNameById.get(pid);
      const name = last?.name || fallback?.name || pid;
      const preview = last?.text?.trim() || "Tap to start Gridchat";
      const rowId = `d:${pid}`;
      out.push({
        id: rowId,
        kind: "direct",
        name,
        alias: gridchatAlias(name, pid),
        preview,
        ts: last?.ts || 0,
        unread: directUnread.get(pid) || 0,
        favourite: gridchatFavourites.includes(rowId),
        muted: gridchatMuted.includes(rowId),
        online: !!fallback?.online,
        peerId: pid,
        memberInfo: fallback?.online ? "online on mesh" : "offline",
        mediaIcon: "text",
      });
    }

    const qx = gridchatSearch.trim().toLowerCase();
    return out
      .filter((row) => {
        if (gridchatFilter === "unread" && row.unread === 0) return false;
        if (gridchatFilter === "favourites" && !row.favourite) return false;
        if (!qx) return true;
        const hay = `${row.alias} ${row.name} ${row.preview}`.toLowerCase();
        return hay.includes(qx);
      })
      .sort((a, b) => {
        const fav = Number(b.favourite) - Number(a.favourite);
        if (fav) return fav;
        if (b.ts !== a.ts) return b.ts - a.ts;
        return a.alias.localeCompare(b.alias);
      });
  }, [groupChats, groupMessages, globalPeers, gridchatFavourites, gridchatFilter, gridchatLastSeen, gridchatMuted, gridchatSearch, peers, sms]);

  const gridchatUnreadTotal = useMemo(() => gridchatItems.reduce((acc, row) => acc + row.unread, 0), [gridchatItems]);
  const visibleSmsThreadIds = useMemo(() => smsThreads.map((row) => row.peerId), [smsThreads]);
  const visibleGridchatRowIds = useMemo(() => gridchatItems.map((row) => row.id), [gridchatItems]);
  const visibleLogIds = useMemo(() => {
    if (tab === "mesh" && meshSubView === "recents") return visibleMeshCommLog.map((row) => row.id);
    if (tab === "logs" && logsSubView === "recents") return latestLocalCommLog.map((row) => row.id);
    if (menuOpen && menuView === "logs") return latestLocalCommLog.map((row) => row.id);
    return [];
  }, [latestLocalCommLog, logsSubView, menuOpen, menuView, meshSubView, tab, visibleMeshCommLog]);

  const gridchatStatusUsers = useMemo(() => {
    const activityById = new Map<string, number>();
    for (const m of sms) {
      const prev = activityById.get(m.peerId) || 0;
      if (m.ts > prev) activityById.set(m.peerId, m.ts);
    }
    for (const gm of groupMessages) {
      if (!gm.fromId) continue;
      const prev = activityById.get(gm.fromId) || 0;
      if (gm.ts > prev) activityById.set(gm.fromId, gm.ts);
    }

    const byId = new Map<string, { id: string; name: string; alias: string; online: boolean; lastTs: number }>();
    for (const p of [...peers, ...globalPeers]) {
      const id = String(p.id || "").trim();
      if (!id) continue;
      const prev = byId.get(id);
      const name = p.name || id;
      const alias = gridchatAlias(name, id);
      const lastTs = activityById.get(id) || Number(gridchatLastSeen[`d:${id}`] || 0);
      if (!prev) {
        byId.set(id, { id, name, alias, online: !!p.online, lastTs });
      } else {
        byId.set(id, {
          id,
          name: prev.name || name,
          alias: prev.alias || alias,
          online: prev.online || !!p.online,
          lastTs: Math.max(prev.lastTs, lastTs),
        });
      }
    }

    return Array.from(byId.values())
      .sort((a, b) => {
        const on = Number(b.online) - Number(a.online);
        if (on) return on;
        if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
        return a.alias.localeCompare(b.alias);
      })
      .slice(0, 30);
  }, [globalPeers, gridchatLastSeen, groupMessages, peers, sms]);

  const toggleGridchatFavourite = (rowId: string) => {
    setGridchatFavourites((prev) => (prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [rowId, ...prev].slice(0, 300)));
  };

  const toggleGridchatMuted = (rowId: string) => {
    setGridchatMuted((prev) => (prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [rowId, ...prev].slice(0, 300)));
  };

  const setMyGridchatStatus = () => {
    const current = String(gridchatMyStatusText || "").trim();
    const next = String(prompt("Set your status", current || "Available on mesh") || "").trim();
    if (!next) return;
    setGridchatMyStatusText(next.slice(0, 120));
    setGridchatMyStatusAt(Date.now());
    setStatusPosts((prev) => {
      const post: StatusPost = {
        id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        userId: MeshEngine.localId,
        userName: myName || "Me",
        text: next.slice(0, 120),
        ts: Date.now(),
      };
      const withoutMine = prev.filter((row) => row.userId !== post.userId);
      return [...withoutMine, post].slice(-400);
    });
    setGridchatStatusSettingsOpen(false);
    setContactBusy("Status updated");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const clearMyGridchatStatus = () => {
    setGridchatMyStatusText("");
    setGridchatMyStatusAt(0);
    setGridchatStatusSettingsOpen(false);
  };

  const setGridchatPrivacySetting = () => {
    const current = gridchatStatusPrivacy;
    const next = String(prompt("Status privacy: everyone / contacts / nobody", current) || "").trim().toLowerCase();
    if (next === "everyone" || next === "contacts" || next === "nobody") {
      setGridchatStatusPrivacy(next);
      setGridchatStatusSettingsOpen(false);
      return;
    }
    setErr("Use: everyone, contacts, or nobody");
  };

  const applyGridchatStatusTemplate = () => {
    const templates = [
      "Available on mesh",
      "In call, text me",
      "Patrol mode active",
      "Low battery, async only",
      "Signal weak, keep brief",
      "On route, will reply",
    ];
    const choose = String(prompt(`Status template:\n${templates.join("\n")}`, templates[0]) || "").trim();
    if (!choose) return;
    setGridchatMyStatusText(choose.slice(0, 120));
    setGridchatMyStatusAt(Date.now());
    setGridchatStatusSettingsOpen(false);
    setContactBusy("Template applied");
    setTimeout(() => setContactBusy(""), 1200);
  };

  const setGridchatStatusAutoClear = () => {
    const current = gridchatStatusAutoClearHours;
    const raw = String(prompt("Auto-clear status (hours): 0, 4, 8, 12, 24, 48", String(current)) || "").trim();
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 0 || next > 168) {
      setErr("Use 0-168 hours");
      return;
    }
    setGridchatStatusAutoClearHours(Math.floor(next));
    setGridchatStatusSettingsOpen(false);
  };

  const setGridchatStatusRing = () => {
    const current = gridchatStatusRingColor;
    const next = String(prompt("Status ring color: blue / green / orange / red", current) || "").trim().toLowerCase();
    if (next === "blue" || next === "green" || next === "orange" || next === "red") {
      setGridchatStatusRingColor(next);
      setGridchatStatusSettingsOpen(false);
      return;
    }
    setErr("Use: blue, green, orange, red");
  };

  const toggleGridchatStatusStealth = () => {
    setGridchatStatusStealthMode((prev) => !prev);
    setGridchatStatusSettingsOpen(false);
  };

  const archiveMyGridchatStatus = () => {
    const text = String(gridchatMyStatusText || "").trim();
    if (!text) {
      setErr("No status to archive");
      return;
    }
    setGridchatStatusArchive((prev) => [{ text: text.slice(0, 120), at: gridchatMyStatusAt || Date.now() }, ...prev].slice(0, 24));
    setGridchatStatusSettingsOpen(false);
  };

  const restoreLastArchivedGridchatStatus = () => {
    const last = gridchatStatusArchive[0];
    if (!last) {
      setErr("Archive empty");
      return;
    }
    setGridchatMyStatusText(String(last.text || "").slice(0, 120));
    setGridchatMyStatusAt(Date.now());
    setGridchatStatusSettingsOpen(false);
  };

  const copyMyGridchatStatusLine = () => {
    const line = `${myName || "Me"} status: ${gridchatMyStatusText || "Available on mesh"}`;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(line).then(
        () => {
          setContactBusy("Status line copied");
          setTimeout(() => setContactBusy(""), 1200);
        },
        () => {
          setErr("Copy failed");
        },
      );
    } else {
      setErr("Clipboard unavailable");
    }
    setGridchatStatusSettingsOpen(false);
  };

  const statusPostsByUser = useMemo(() => {
    const byUser = new Map<string, StatusPost>();
    for (const post of statusPosts) {
      const prev = byUser.get(post.userId);
      if (!prev || post.ts > prev.ts) byUser.set(post.userId, post);
    }
    return byUser;
  }, [statusPosts]);

  const activeStatusPost = useMemo(
    () => (statusViewerPostId ? statusPosts.find((row) => row.id === statusViewerPostId) || null : null),
    [statusPosts, statusViewerPostId]
  );

  const activeStatusComments = useMemo(
    () => (activeStatusPost ? statusComments.filter((row) => row.postId === activeStatusPost.id).sort((a, b) => a.ts - b.ts) : []),
    [statusComments, activeStatusPost]
  );

  const statusPostsTimeline = useMemo(() => {
    const rows = statusPosts.slice().sort((a, b) => b.ts - a.ts);
    if (!rows.length) return rows;
    if (!statusViewerUserId) return rows;
    const start = rows.findIndex((row) => row.userId === statusViewerUserId);
    if (start <= 0) return rows;
    return [...rows.slice(start), ...rows.slice(0, start)];
  }, [statusPosts, statusViewerUserId]);

  const activeStatusIndex = useMemo(() => {
    if (!activeStatusPost) return -1;
    return statusPostsTimeline.findIndex((row) => row.id === activeStatusPost.id);
  }, [activeStatusPost, statusPostsTimeline]);

  const activeStatusViews = useMemo(() => {
    if (!activeStatusPost) return [] as StatusViewLog[];
    return statusViews
      .filter((row) => row.postId === activeStatusPost.id)
      .sort((a, b) => b.ts - a.ts);
  }, [statusViews, activeStatusPost]);

  const activeStatusReactions = useMemo(() => {
    if (!activeStatusPost) {
      return { like: 0, heart: 0, my: null as StatusReactionKind | null };
    }
    let like = 0;
    let heart = 0;
    let my: StatusReactionKind | null = null;
    for (const row of statusReactions) {
      if (row.postId !== activeStatusPost.id) continue;
      if (row.kind === "like") like += 1;
      if (row.kind === "heart") heart += 1;
      if (row.userId === MeshEngine.localId) my = row.kind;
    }
    return { like, heart, my };
  }, [statusReactions, activeStatusPost]);

  const openStatusViewer = (userId: string, fallbackName: string) => {
    if (!userId) return;
    const known = statusPostsByUser.get(userId);
    if (known) {
      setStatusViewerPostId(known.id);
      setStatusViewerUserId(userId);
      setStatusCommentDraft("");
      return;
    }
    const fallback: StatusPost = {
      id: `st_fallback_${userId}`,
      userId,
      userName: fallbackName || userId,
      text: "No status post yet.",
      ts: Date.now(),
    };
    setStatusPosts((prev) => [...prev, fallback].slice(-400));
    setStatusViewerPostId(fallback.id);
    setStatusViewerUserId(userId);
    setStatusCommentDraft("");
  };

  const markStatusViewed = (post: StatusPost) => {
    if (!post) return;
    if (post.userId === MeshEngine.localId) return;
    const viewerId = MeshEngine.localId;
    setStatusViews((prev) => {
      const without = prev.filter((row) => !(row.postId === post.id && row.viewerId === viewerId));
      const entry: StatusViewLog = {
        postId: post.id,
        viewerId,
        viewerName: myName || "Me",
        ts: Date.now(),
      };
      return [...without, entry].slice(-4000);
    });
  };

  const setStatusReaction = (kind: StatusReactionKind) => {
    if (!activeStatusPost) return;
    const postId = activeStatusPost.id;
    const userId = MeshEngine.localId;
    setStatusReactions((prev) => {
      const withoutMine = prev.filter((row) => !(row.postId === postId && row.userId === userId));
      const row: StatusReaction = {
        postId,
        userId,
        kind,
        ts: Date.now(),
      };
      return [...withoutMine, row].slice(-2500);
    });
  };

  const openNextStatusPost = () => {
    if (!statusPostsTimeline.length || activeStatusIndex < 0) return;
    const nextIndex = (activeStatusIndex + 1) % statusPostsTimeline.length;
    const next = statusPostsTimeline[nextIndex];
    setStatusViewerPostId(next.id);
    setStatusViewerUserId(next.userId);
    setStatusCommentDraft("");
  };

  useEffect(() => {
    if (!activeStatusPost) return;
    markStatusViewed(activeStatusPost);
  }, [activeStatusPost?.id]);

  const addStatusComment = (mode: "comment" | "chat") => {
    if (!activeStatusPost) return;
    const text = String(statusCommentDraft || "").trim();
    if (!text) return;
    const row: StatusComment = {
      id: `stc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      postId: activeStatusPost.id,
      fromId: MeshEngine.localId,
      fromName: myName || "Me",
      text,
      ts: Date.now(),
    };
    setStatusComments((prev) => [...prev, row].slice(-1200));
    setStatusCommentDraft("");
    if (mode === "chat") {
      setStatusViewerPostId(null);
      setStatusViewerUserId(null);
      setComposeTo(activeStatusPost.userId);
      setThread(activeStatusPost.userId);
      setTab("sms");
      sendSms(activeStatusPost.userId, activeStatusPost.userName, text);
    }
  };

  const runThreadLongPressAction = (peerId: string, label: string) => {
    setSmsThreadSelectMode(true);
    setSelectedSmsThreadIds((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
    setContactBusy(`${label} selected`);
    setTimeout(() => setContactBusy(""), 1000);
  };

  const runLogLongPressAction = (id: string) => {
    setLogsSelectMode(true);
    setSelectedLogIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setContactBusy("Log selected");
    setTimeout(() => setContactBusy(""), 1000);
  };

  const sendDirectQuickText = (peerId: string, peerName: string, text: string) => {
    const body = String(text || "").trim();
    if (!body) return;
    sendSms(peerId, peerName, body);
    setSmsDraft("");
    setDirectAttachMenuOpen(false);
  };

  const shareDirectFile = (peerId: string, peerName: string, file: File) => {
    if (!file) return;
    const maxBytes = 2.5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setErr("File too large. Max 2.5MB for mesh share.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      const mime = file.type || "application/octet-stream";
      const kind: GroupAttachmentKind = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("audio/")
          ? "audio"
          : mime.startsWith("video/")
            ? "video"
            : /pdf|word|excel|sheet|text|json|xml|zip/.test(mime)
              ? "document"
              : "file";
      sendSms(peerId, peerName, `Shared ${file.name}`, {
        kind,
        name: file.name,
        mime,
        size: file.size,
        dataUrl,
      });
    };
    reader.readAsDataURL(file);
  };

  const runDirectAttachAction = (peerId: string, peerName: string, action: "document" | "photos" | "camera" | "audio" | "contact" | "poll" | "event" | "sticker") => {
    if (action === "document") {
      setDirectAttachMenuOpen(false);
      directDocumentInputRef.current?.click();
      return;
    }
    if (action === "photos") {
      setDirectAttachMenuOpen(false);
      directMediaInputRef.current?.click();
      return;
    }
    if (action === "camera") {
      setDirectAttachMenuOpen(false);
      directCameraInputRef.current?.click();
      return;
    }
    if (action === "audio") {
      setDirectAttachMenuOpen(false);
      directAudioInputRef.current?.click();
      return;
    }
    if (action === "contact") {
      openActionComposer("contact", { kind: "direct", peerId, peerName });
      return;
    }
    if (action === "poll") {
      openActionComposer("poll", { kind: "direct", peerId, peerName });
      return;
    }
    if (action === "event") {
      openActionComposer("event", { kind: "direct", peerId, peerName });
      return;
    }
    const stickers = ["😀", "🔥", "💚", "🎉", "👍", "🙏", "⚡", "🚀", "📶", "🛰️"];
    const pick = stickers[Math.floor(Math.random() * stickers.length)] || "😀";
    sendDirectQuickText(peerId, peerName, `Sticker ${pick}`);
  };

  const runDirectChatMenuAction = (action: string, peerId: string, peerName: string) => {
    setDirectChatMenuOpen(false);
    if (action === "contact-info") {
      openChatProfile(peerId, peerName, "direct");
      return;
    }
    if (action === "business-details") {
      openChatProfile(peerId, peerName, "direct");
      return;
    }
    if (action === "search") {
      setThreadSearchOpen(true);
      return;
    }
    if (action === "select-messages") {
      setDirectSelectMode(true);
      setDirectSelectedMessageIds([]);
      return;
    }
    if (action === "mute-notifications") {
      toggleGridchatMuted(`d:${peerId}`);
      return;
    }
    if (action === "add-favourites") {
      toggleGridchatFavourite(`d:${peerId}`);
      return;
    }
    if (action === "add-to-list") {
      contactsVault.upsert({
        name: peerName,
        peerId,
        phones: [],
        source: "mesh",
      });
      refreshContacts();
      setContactBusy(`${peerName} added to contacts list`);
      setTimeout(() => setContactBusy(""), 2000);
      return;
    }
    if (action === "close-chat") {
      setThread(null);
      return;
    }
    if (action === "send-call-link") {
      sendSms(peerId, peerName, `Join call: mesh://${MeshEngine.localId}/${Date.now().toString(36)}`);
      return;
    }
    if (action === "schedule-call") {
      openActionComposer("schedule-call", { kind: "direct", peerId, peerName });
      return;
    }
    if (action === "new-group-call") {
      setGroupSelection((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
      setGroupCallOpen(true);
      return;
    }
    if (action === "report") {
      setGridchatReportLog((prev) => [{ peerId, name: peerName, source: "direct" as const, ts: Date.now() }, ...prev].slice(0, 500));
      setContactBusy(`${peerName} reported`);
      setTimeout(() => setContactBusy(""), 1500);
      return;
    }
    if (action === "block") {
      blockCaller(peerId, peerName);
      setThread(null);
      return;
    }
    if (action === "clear-chat") {
      deleteMessageThread(peerId);
      return;
    }
    if (action === "delete-chat") {
      moveSmsThreadToFolder(peerId, "deleted");
      setThread(null);
    }
  };

  const toggleStarMessage = (messageId: string) => {
    const id = String(messageId || "");
    if (!id) return;
    setStarredMessageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev].slice(0, 3000)));
  };

  const toggleDirectMessageSelection = (messageId: string) => {
    const id = String(messageId || "");
    if (!id) return;
    setDirectSelectedMessageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleGroupMessageSelection = (messageId: string) => {
    const id = String(messageId || "");
    if (!id) return;
    setGroupSelectedMessageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const deleteSelectedDirectMessages = () => {
    if (!directSelectedMessageIds.length) return;
    setSms((prev) => prev.filter((m) => !directSelectedMessageIds.includes(m.id)));
    setDirectSelectedMessageIds([]);
    setDirectSelectMode(false);
  };

  const deleteSelectedGroupMessages = () => {
    if (!groupSelectedMessageIds.length) return;
    setGroupMessages((prev) => prev.filter((m) => !groupSelectedMessageIds.includes(m.id)));
    setGroupSelectedMessageIds([]);
    setGroupSelectMode(false);
  };

  const copyTextToClipboard = (text: string, label = "Copied") => {
    if (!text.trim()) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { setContactBusy(label); setTimeout(() => setContactBusy(""), 1400); },
        () => { setErr("Copy failed — clipboard blocked"); },
      );
    } else {
      try {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.cssText = "position:fixed;opacity:0;top:-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setContactBusy(label);
        setTimeout(() => setContactBusy(""), 1400);
      } catch {
        setErr("Copy unavailable");
      }
    }
  };

  const copySelectedDirectMessages = () => {
    if (!directSelectedMessageIds.length) return;
    const texts = sms.filter((m) => directSelectedMessageIds.includes(m.id) && m.text).map((m) => m.text);
    copyTextToClipboard(texts.join("\n"), `${texts.length} message${texts.length !== 1 ? "s" : ""} copied`);
    setDirectSelectedMessageIds([]);
    setDirectSelectMode(false);
  };

  const copySelectedGroupMessages = () => {
    if (!groupSelectedMessageIds.length) return;
    const texts = groupMessages.filter((m) => groupSelectedMessageIds.includes(m.id) && m.text).map((m) => `${m.fromName}: ${m.text}`);
    copyTextToClipboard(texts.join("\n"), `${texts.length} message${texts.length !== 1 ? "s" : ""} copied`);
    setGroupSelectedMessageIds([]);
    setGroupSelectMode(false);
  };

  const toggleSmsThreadSelection = (peerId: string) => {
    if (!peerId) return;
    setSelectedSmsThreadIds((prev) => (prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]));
  };

  const markSmsThreadsReadState = (peerIds: string[], read: boolean) => {
    if (!peerIds.length) return;
    const at = read ? Date.now() : 0;
    setGridchatLastSeen((prev) => {
      const next = { ...prev };
      for (const id of peerIds) next[`d:${id}`] = at;
      return next;
    });
  };

  const deleteSelectedSmsThreads = () => {
    if (!selectedSmsThreadIds.length) return;
    if (!confirm(`Delete ${selectedSmsThreadIds.length} selected conversation(s)?`)) return;
    setSms((prev) => {
      const pick = new Set(selectedSmsThreadIds);
      const next = prev.map((m) => (pick.has(m.peerId) ? { ...m, folder: "deleted" as MessageFolder } : m));
      S.set("gridcaller_sms", next);
      return next;
    });
    if (thread && selectedSmsThreadIds.includes(thread)) setThread(null);
    setSelectedSmsThreadIds([]);
    setSmsThreadSelectMode(false);
    setContactBusy("Selected conversations deleted");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const toggleGridchatRowSelection = (rowId: string) => {
    if (!rowId) return;
    setSelectedGridchatRowIds((prev) => (prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]));
  };

  const markGridchatRowsReadState = (rowIds: string[], read: boolean) => {
    if (!rowIds.length) return;
    const at = read ? Date.now() : 0;
    setGridchatLastSeen((prev) => {
      const next = { ...prev };
      for (const id of rowIds) next[id] = at;
      return next;
    });
  };

  const deleteSelectedGridchatRows = () => {
    if (!selectedGridchatRowIds.length) return;
    if (!confirm(`Delete ${selectedGridchatRowIds.length} selected chat(s)?`)) return;
    const selected = new Set(selectedGridchatRowIds);
    const directPeerIds = gridchatItems.filter((row) => selected.has(row.id) && row.kind === "direct" && row.peerId).map((row) => row.peerId as string);
    const groupIds = gridchatItems.filter((row) => selected.has(row.id) && row.kind === "group" && row.groupId).map((row) => row.groupId as string);
    if (directPeerIds.length) {
      const directSet = new Set(directPeerIds);
      setSms((prev) => {
        const next = prev.map((m) => (directSet.has(m.peerId) ? { ...m, folder: "deleted" as MessageFolder } : m));
        S.set("gridcaller_sms", next);
        return next;
      });
    }
    if (groupIds.length) {
      const groupSet = new Set(groupIds);
      setGroupMessages((prev) => prev.filter((m) => !groupSet.has(m.groupId)));
      setGroupChats((prev) => prev.filter((g) => !groupSet.has(g.id)));
      if (groupViewId && groupSet.has(groupViewId)) setGroupViewId(null);
    }
    setSelectedGridchatRowIds([]);
    setGridchatListSelectMode(false);
    setContactBusy("Selected chats deleted");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const toggleLogSelection = (logId: string) => {
    if (!logId) return;
    setSelectedLogIds((prev) => (prev.includes(logId) ? prev.filter((id) => id !== logId) : [...prev, logId]));
  };

  const markLogSeenState = (logIds: string[], seen: boolean) => {
    if (!logIds.length) return;
    setLogSeenState((prev) => {
      const next = { ...prev };
      for (const id of logIds) next[id] = seen;
      return next;
    });
  };

  const deleteSelectedLogs = () => {
    if (!selectedLogIds.length) return;
    if (!confirm(`Delete ${selectedLogIds.length} selected log entr${selectedLogIds.length === 1 ? "y" : "ies"}?`)) return;
    let removed = 0;
    for (const id of selectedLogIds) {
      if (gridNumberRegistry.deleteLocalCommLogEntry(id)) removed += 1;
    }
    refreshLocalLogs();
    setSelectedLogIds([]);
    setLogsSelectMode(false);
    setContactBusy(`Deleted ${removed} log${removed === 1 ? "" : "s"}`);
    setTimeout(() => setContactBusy(""), 1500);
  };

  const toggleRadioMessageSelection = (id: string) => {
    if (!id) return;
    setSelectedRadioMessageIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const markRadioMessagesReadState = (ids: string[], read: boolean) => {
    if (!ids.length) return;
    setRadioMessageReadState((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = read;
      return next;
    });
  };

  const hideSelectedRadioMessages = () => {
    if (!selectedRadioMessageIds.length) return;
    setHiddenRadioMessageIds((prev) => Array.from(new Set([...prev, ...selectedRadioMessageIds])).slice(-500));
    setSelectedRadioMessageIds([]);
    setRadioSelectMode(false);
  };

  const runGroupChatMenuAction = (action: string, groupId: string, groupName: string) => {
    setGroupChatMenuOpen(false);
    if (action === "group-info") {
      openChatProfile(groupId, groupName, "group", groupId);
      return;
    }
    if (action === "search") {
      setGroupSearchOpen(true);
      return;
    }
    if (action === "select-messages") {
      setGroupSelectMode(true);
      setGroupSelectedMessageIds([]);
      return;
    }
    if (action === "mute") {
      toggleGridchatMuted(`g:${groupId}`);
      return;
    }
    if (action === "favourite") {
      toggleGridchatFavourite(`g:${groupId}`);
      return;
    }
    if (action === "share-invite") {
      sendGroupMessage(groupId, `Join group: mesh-group://${groupId}`);
      return;
    }
    if (action === "clear-chat") {
      setGroupMessages((prev) => prev.filter((m) => m.groupId !== groupId));
      return;
    }
    if (action === "exit-group") {
      const me = MeshEngine.localId;
      setGroupChats((prev) => prev.map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, members: g.members.filter((m) => m !== me), updatedAt: Date.now() };
      }));
      setGroupViewId(null);
      return;
    }
    if (action === "close") {
      setGroupViewId(null);
    }
  };

  const openChatProfile = (peerId: string, name: string, source: "direct" | "group", groupId?: string) => {
    const id = String(peerId || "").trim();
    if (!id) return;
    setDirectChatMenuOpen(false);
    setGroupChatMenuOpen(false);
    setDirectAttachMenuOpen(false);
    setGroupAttachMenuOpen(false);
    setChatProfileView({ peerId: id, name: String(name || id), source, groupId });
  };

  const renderChatProfileOverlay = () => {
    if (!chatProfileView) return null;
    const peerId = chatProfileView.peerId;
    const peerName = chatProfileView.name;
    const source = chatProfileView.source;
    const inGroupId = chatProfileView.groupId;
    const knownContact = contacts.find((c) => c.peerId === peerId || (Array.isArray(c.phones) && c.phones.some((p) => String(p || "").trim() === peerId)));
    const displayId = String(knownContact?.phones?.[0] || peerId);
    const aboutText = String(knownContact?.notes || `Reachable on mesh as ${peerName}`).trim();
    const peerMedia = (source === "group" && inGroupId
      ? groupMessages.filter((m) => m.groupId === inGroupId && (m.fromId === peerId || m.fromName === peerName) && !!m.attachment?.dataUrl)
      : sms.filter((m) => m.peerId === peerId && !!m.attachment?.dataUrl)
    ).slice(-24);
    const previewMedia = peerMedia
      .filter((m) => m.attachment?.kind === "image" || m.attachment?.kind === "video")
      .slice(-2);
    const routingKey = source === "group" && inGroupId && peerId === inGroupId ? `g:${inGroupId}` : `d:${peerId}`;
    const isFav = gridchatFavourites.includes(routingKey);
    const isMuted = gridchatMuted.includes(routingKey);
    const disappearHours = Number(S.get(`gridcaller_disappear_h_${peerId}`, 0) || 0);
    const privacyOn = !!S.get(`gridcaller_adv_priv_${peerId}`, false);
    const reportCount = gridchatReportLog.filter((x) => x.peerId === peerId).length;

    return (
      <div
        className="gc-overlay"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 650,
          background: tokens.bg,
          color: tokens.text,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.bar }}>
          <button type="button" onClick={() => setChatProfileView(null)} style={{ border: "none", background: "transparent", color: tokens.text, cursor: "pointer", display: "grid", placeItems: "center" }}>
            <X size={20} />
          </button>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Contact info</div>
        </div>

        <div className="gc-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 14px 26px" }}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ width: 118, height: 118, borderRadius: 999, margin: "0 auto 10px", background: hue(peerId), color: "#fff", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 800 }}>
              {initials(peerName)}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{displayId}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => copyTextToClipboard(peerName, "Name copied")}
                style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.blue, borderRadius: 999, padding: "4px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Copy name
              </button>
              <button
                type="button"
                onClick={() => copyTextToClipboard(displayId, "ID copied")}
                style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.label, borderRadius: 999, padding: "4px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Copy ID
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, marginBottom: 16 }}>
            {[
              {
                id: "voice",
                label: "Voice",
                icon: <Phone size={18} />,
                onTap: async () => {
                  setChatProfileView(null);
                  await placeCall(peerId, peerName);
                },
              },
              {
                id: "video",
                label: "Video",
                icon: <Video size={18} />,
                onTap: async () => {
                  setChatProfileView(null);
                  await startDirectHeaderCall(peerId, peerName, "video");
                },
              },
              {
                id: "add",
                label: "Add",
                icon: <UserPlus size={18} />,
                onTap: () => {
                  contactsVault.upsert({ name: peerName, peerId, phones: knownContact?.phones || [], source: "mesh" });
                  refreshContacts();
                  setContactBusy(`${peerName} added to contacts`);
                  setTimeout(() => setContactBusy(""), 1400);
                },
              },
              {
                id: "search",
                label: "Search",
                icon: <Search size={18} />,
                onTap: () => {
                  if (source === "group" && inGroupId) {
                    setGroupSearchOpen(true);
                    setGroupSearchQuery(peerName);
                  } else {
                    setThreadSearchOpen(true);
                    setThreadSearchQuery(peerName);
                  }
                  setChatProfileView(null);
                },
              },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => void btn.onTap()}
                style={{ border: "none", background: "transparent", color: tokens.text, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ width: 52, height: 52, borderRadius: 999, border: `1px solid ${tokens.sep}`, background: tokens.fill, display: "grid", placeItems: "center" }}>
                  {btn.icon}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{btn.label}</span>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 13, color: tokens.label, marginBottom: 4, fontWeight: 700 }}>About</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>{aboutText}</div>

          <div style={{ borderTop: `1px solid ${tokens.sep}`, paddingTop: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>Media, links and docs</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{peerMedia.length}</div>
            </div>
            {previewMedia.length ? (
              <div style={{ display: "flex", gap: 8 }}>
                {previewMedia.map((m) => (
                  <div key={m.id} style={{ width: 170, height: 122, borderRadius: 12, overflow: "hidden", border: `1px solid ${tokens.sep}`, background: tokens.fill }}>
                    {m.attachment?.kind === "video" ? (
                      <video src={m.attachment?.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <img src={m.attachment?.dataUrl} alt={m.attachment?.name || "media"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: tokens.label }}>No media shared yet</div>
            )}
          </div>

          {[
            { id: "star", title: "Starred messages", subtitle: source === "group" ? "Open starred in this group" : "Open starred in this chat", danger: false },
            { id: "notif", title: "Notification settings", subtitle: isMuted ? "Muted" : "On", danger: false },
            { id: "disappear", title: "Disappearing messages", subtitle: disappearHours > 0 ? `${disappearHours}h` : "Off", danger: false },
            { id: "privacy", title: "Advanced chat privacy", subtitle: privacyOn ? "On" : "Off", danger: false },
            { id: "encryption", title: "Encryption", subtitle: "Messages are end-to-end encrypted. Click to verify.", danger: false },
            { id: "fav", title: "Add to favourites", subtitle: isFav ? "Already favourite" : "Tap to favourite", danger: false },
            { id: "list", title: "Add to list", subtitle: "Save in contacts list", danger: false },
            { id: "clear", title: "Clear chat", subtitle: "", danger: true },
            { id: "block", title: `Block ${displayId}`, subtitle: "", danger: true },
            { id: "report", title: `Report ${displayId}`, subtitle: reportCount ? `Reported ${reportCount} time(s)` : "", danger: true },
            { id: "delete", title: "Delete chat", subtitle: "", danger: true },
          ].map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                if (row.id === "star") {
                  if (source === "group") {
                    setGroupShowStarredOnly(true);
                  } else {
                    setThreadShowStarredOnly(true);
                  }
                  setChatProfileView(null);
                  return;
                }
                if (row.id === "notif") {
                  toggleGridchatMuted(routingKey);
                  return;
                }
                if (row.id === "disappear") {
                  const raw = String(prompt("Disappearing messages hours (0, 24, 72, 168)", String(disappearHours || 0)) || "").trim();
                  const next = Number(raw);
                  if (!Number.isFinite(next) || next < 0 || next > 168) {
                    setErr("Use 0-168 hours");
                    return;
                  }
                  S.set(`gridcaller_disappear_h_${peerId}`, Math.floor(next));
                  setChatProfileMetaVer((v) => v + 1);
                  return;
                }
                if (row.id === "privacy") {
                  S.set(`gridcaller_adv_priv_${peerId}`, !privacyOn);
                  setChatProfileMetaVer((v) => v + 1);
                  return;
                }
                if (row.id === "encryption") {
                  setContactBusy("Encryption verified on mesh channel");
                  setTimeout(() => setContactBusy(""), 1400);
                  return;
                }
                if (row.id === "fav") {
                  toggleGridchatFavourite(routingKey);
                  return;
                }
                if (row.id === "list") {
                  contactsVault.upsert({ name: peerName, peerId, phones: knownContact?.phones || [], source: "mesh" });
                  refreshContacts();
                  return;
                }
                if (row.id === "clear") {
                  if (source === "group" && inGroupId) {
                    setGroupMessages((prev) => prev.filter((m) => !(m.groupId === inGroupId && m.fromId === peerId)));
                  } else {
                    deleteMessageThread(peerId);
                  }
                  setChatProfileView(null);
                  return;
                }
                if (row.id === "block") {
                  blockCaller(peerId, peerName);
                  setChatProfileView(null);
                  return;
                }
                if (row.id === "report") {
                  setGridchatReportLog((prev) => [{ peerId, name: peerName, source, ts: Date.now() }, ...prev].slice(0, 500));
                  setContactBusy(`${peerName} reported`);
                  setTimeout(() => setContactBusy(""), 1400);
                  return;
                }
                if (source === "group" && inGroupId) {
                  setGroupMessages((prev) => prev.filter((m) => !(m.groupId === inGroupId && m.fromId === peerId)));
                } else {
                  moveSmsThreadToFolder(peerId, "deleted");
                }
                setChatProfileView(null);
              }}
              style={{
                width: "100%",
                border: "none",
                borderTop: `1px solid ${tokens.sep}`,
                background: "transparent",
                color: row.danger ? tokens.red : tokens.text,
                textAlign: "left",
                padding: "12px 2px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>{row.title}</span>
              {row.subtitle ? <span style={{ fontSize: 13, color: tokens.label }}>{row.subtitle}</span> : null}
            </button>
          ))}
          <div style={{ display: "none" }}>{chatProfileMetaVer}</div>
        </div>
      </div>
    );
  };

  const renderStatusViewerOverlay = () => {
    if (!activeStatusPost) return null;
    const isMine = activeStatusPost.userId === MeshEngine.localId;
    return (
      <div
        className="gc-overlay"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 700,
          background: tokens.bg,
          color: tokens.text,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.bar }}>
          <button type="button" onClick={() => setStatusViewerPostId(null)} style={{ border: "none", background: "transparent", color: tokens.text, cursor: "pointer", display: "grid", placeItems: "center" }}>
            <X size={20} />
          </button>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Status post</div>
        </div>
        <div className="gc-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 12px 20px" }}>
          <div style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 800, color: tokens.text }}>{activeStatusPost.userName}</div>
              <div style={{ fontSize: 11, color: tokens.label, fontWeight: 700 }}>{fullDateTime(activeStatusPost.ts)}</div>
            </div>
            <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.5, color: tokens.text }}>{activeStatusPost.text}</div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setStatusReaction("like")}
                style={{ border: activeStatusReactions.my === "like" ? "none" : `1px solid ${tokens.sep}`, background: activeStatusReactions.my === "like" ? `${tokens.blue}22` : tokens.fill, color: tokens.text, borderRadius: 999, padding: "6px 10px", fontWeight: 700, cursor: "pointer" }}
              >
                👍 {activeStatusReactions.like}
              </button>
              <button
                type="button"
                onClick={() => setStatusReaction("heart")}
                style={{ border: activeStatusReactions.my === "heart" ? "none" : `1px solid ${tokens.sep}`, background: activeStatusReactions.my === "heart" ? `${tokens.red}20` : tokens.fill, color: tokens.text, borderRadius: 999, padding: "6px 10px", fontWeight: 700, cursor: "pointer" }}
              >
                ❤️ {activeStatusReactions.heart}
              </button>
              <button
                type="button"
                onClick={openNextStatusPost}
                style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, borderRadius: 999, padding: "6px 10px", fontWeight: 700, cursor: "pointer" }}
              >
                Next status
              </button>
            </div>
          </div>

          <div style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: tokens.label, marginBottom: 8 }}>
              Views ({activeStatusViews.length})
            </div>
            {activeStatusViews.length === 0 ? (
              <div style={{ fontSize: 12, color: tokens.label }}>No views yet</div>
            ) : (
              activeStatusViews.slice(0, 40).map((v) => (
                <div key={`${v.postId}_${v.viewerId}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: tokens.text, padding: "4px 0" }}>
                  <span>{v.viewerName || v.viewerId}</span>
                  <span style={{ color: tokens.label }}>{fullDateTime(v.ts)}</span>
                </div>
              ))
            )}
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: tokens.label, marginBottom: 8 }}>COMMENTS / CHATS</div>
          {activeStatusComments.length === 0 ? (
            <div style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, borderRadius: 12, padding: 12, fontSize: 13, color: tokens.label }}>
              No comments yet. Add first comment or chat from below.
            </div>
          ) : (
            activeStatusComments.map((row) => (
              <div key={row.id} style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, borderRadius: 12, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{row.fromName}</div>
                  <div style={{ fontSize: 10, color: tokens.label }}>{timeLabel(row.ts)}</div>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: tokens.text, lineHeight: 1.45 }}>{row.text}</div>
              </div>
            ))
          )}
        </div>
        <div style={{ borderTop: `1px solid ${tokens.sep}`, background: tokens.card, padding: 10 }}>
          <textarea
            value={statusCommentDraft}
            onChange={(e) => setStatusCommentDraft(e.target.value)}
            placeholder="Write comment or chat on this status..."
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${tokens.sep}`, background: tokens.inputBg, color: tokens.text, borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => addStatusComment("comment")} style={{ flex: 1, border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 10, padding: "9px 10px", fontWeight: 700, cursor: "pointer" }}>
              Comment
            </button>
            <button
              type="button"
              disabled={isMine}
              onClick={() => addStatusComment("chat")}
              style={{
                flex: 1,
                border: "none",
                background: isMine ? tokens.fill : tokens.blue,
                color: isMine ? tokens.label : "#fff",
                borderRadius: 10,
                padding: "9px 10px",
                fontWeight: 700,
                cursor: isMine ? "default" : "pointer",
                opacity: isMine ? 0.6 : 1,
              }}
            >
              Chat now
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderActionComposerOverlay = () => {
    if (!actionComposer) return null;
    const title =
      actionComposer.mode === "contact"
        ? "Share Contact"
        : actionComposer.mode === "poll"
          ? "Create Poll"
          : actionComposer.mode === "event"
            ? "Create Event"
            : "Schedule Call";
    const targetLabel =
      actionComposer.target.kind === "direct"
        ? actionComposer.target.peerName
        : actionComposer.target.groupName;
    return (
      <ContactSheet onClose={closeActionComposer} title={title}>
        <div style={{ fontSize: 12, color: tokens.label, marginBottom: 12 }}>
          Send to {targetLabel}
        </div>
        {actionComposer.mode === "contact" ? (
          <>
            <ContactField label="Contact name" value={actionComposerName} onChange={setActionComposerName} placeholder="e.g. Relay medic" />
            <ContactField label="Handle or number" value={actionComposerNumber} onChange={setActionComposerNumber} placeholder="e.g. relay22 or +91..." />
          </>
        ) : null}
        {actionComposer.mode === "poll" ? (
          <>
            <ContactField label="Poll question" value={actionComposerQuestion} onChange={setActionComposerQuestion} placeholder="Ask the group something clear" />
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.label, marginBottom: 6 }}>Options</div>
              <textarea
                value={actionComposerOptions}
                onChange={(e) => setActionComposerOptions(e.target.value)}
                placeholder={"One option per line\nYes\nNo"}
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: `1px solid ${tokens.sep}`,
                  background: tokens.inputBg,
                  color: tokens.text,
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 15,
                  outline: "none",
                  resize: "vertical",
                }}
              />
            </div>
          </>
        ) : null}
        {actionComposer.mode === "event" ? (
          <>
            <ContactField label="Event title" value={actionComposerTitle} onChange={setActionComposerTitle} placeholder="e.g. Mesh drill" />
            <ContactField label="When" value={actionComposerWhen} onChange={setActionComposerWhen} placeholder="Date & time" />
            <ContactField label="Where" value={actionComposerPlace} onChange={setActionComposerPlace} placeholder="Optional place" />
          </>
        ) : null}
        {actionComposer.mode === "schedule-call" ? (
          <ContactField label="Call time" value={actionComposerWhen} onChange={setActionComposerWhen} placeholder="Date & time" />
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={closeActionComposer}
            style={{ flex: 1, border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 12, padding: "12px 14px", fontWeight: 700, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submitActionComposer}
            style={{ flex: 1, border: "none", background: tokens.blue, color: "#fff", borderRadius: 12, padding: "12px 14px", fontWeight: 700, cursor: "pointer" }}
          >
            Send
          </button>
        </div>
      </ContactSheet>
    );
  };

  const openGridchatRow = (row: { kind: "group" | "direct"; groupId?: string; peerId?: string; id: string }) => {
    setGridchatLastSeen((prev) => ({ ...prev, [row.id]: Date.now() }));
    if (row.kind === "group" && row.groupId) {
      setGroupViewId(row.groupId);
      setTab("groups");
      return;
    }
    if (row.kind === "direct" && row.peerId) {
      const match = peers.find((p) => p.id === row.peerId) || globalPeers.find((p) => p.id === row.peerId);
      setComposeTo(match?.id || row.peerId);
      setThread(row.peerId);
      setTab("sms");
    }
  };

  const openGridchatCreatePanel = () => {
    setGroupViewId(null);
    setGroupNameInput("");
    setGroupMembersInput("");
    setGridchatCreateMenuOpen(false);
    setGridchatMoreMenuOpen(false);
    setGridchatShowCreateForm(true);
    window.setTimeout(() => {
      try {
        gridchatCreatePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}
    }, 0);
  };

  useEffect(() => {
    if (!groupViewId) return;
    setGridchatLastSeen((prev) => ({ ...prev, [`g:${groupViewId}`]: Date.now() }));
    setChatProfileView(null);
    setGroupSelectMode(false);
    setGroupSelectedMessageIds([]);
    setGroupShowStarredOnly(false);
  }, [groupViewId]);

  useEffect(() => {
    if (!thread) return;
    setGridchatLastSeen((prev) => ({ ...prev, [`d:${thread}`]: Date.now() }));
    setChatProfileView(null);
    setDirectSelectMode(false);
    setDirectSelectedMessageIds([]);
    setThreadShowStarredOnly(false);
  }, [thread]);

  useEffect(() => {
    setDirectChatMenuOpen(false);
    setDirectAttachMenuOpen(false);
    setThreadSearchOpen(false);
    setThreadSearchQuery("");
    setGridchatCreateMenuOpen(false);
    setGridchatMoreMenuOpen(false);
  }, [thread]);

  useEffect(() => {
    setGroupChatMenuOpen(false);
    setGroupAttachMenuOpen(false);
    setGroupSearchOpen(false);
    setGroupSearchQuery("");
  }, [groupViewId]);

  useEffect(() => {
    setLogsSelectMode(false);
    setSelectedLogIds([]);
    setSmsThreadSelectMode(false);
    setSelectedSmsThreadIds([]);
    setGridchatListSelectMode(false);
    setSelectedGridchatRowIds([]);
    setRadioSelectMode(false);
    setSelectedRadioMessageIds([]);
  }, [tab]);

  useEffect(() => {
    const closeHeaderMenus = (event: MouseEvent | TouchEvent) => {
      if (!gridchatHeaderRef.current) return;
      const target = event.target as Node | null;
      if (target && gridchatHeaderRef.current.contains(target)) return;
      setGridchatCreateMenuOpen(false);
      setGridchatMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", closeHeaderMenus);
    document.addEventListener("touchstart", closeHeaderMenus);
    return () => {
      document.removeEventListener("mousedown", closeHeaderMenus);
      document.removeEventListener("touchstart", closeHeaderMenus);
    };
  }, []);

  if (groupCallOpen) {
    return (
      <ThemeCtx.Provider value={tokens}>
        <Shell>
          <div
            className="gc-overlay"
            style={{
              position: onClose ? "absolute" : "relative",
              inset: onClose ? 0 : undefined,
              zIndex: 400,
              width: "100%",
              height: onClose ? "100%" : "100%",
              minHeight: 0,
              maxHeight: "100%",
              background: "linear-gradient(135deg, #0a84ff 0%, #001a2e 100%)",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "24px 16px 20px",
              boxSizing: "border-box",
              overflowY: "auto",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, opacity: 0.8, textTransform: "uppercase" }}>
                Mesh conference
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>Group call</div>
              <div style={{ fontSize: 13, opacity: 0.84, marginTop: 8 }}>
                Mesh-only voice room for your selected peers · mute, silent, or speak controls
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              {selectedGroupPeers.length > 0 ? (
                selectedGroupPeers.map((peer) => (
                  <div key={peer.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.22)" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{peer.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{peer.handle ? `@${peer.handle}` : peer.phone || peer.id}</div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 999, background: "rgba(48,209,88,0.26)" }}>Ready</div>
                  </div>
                ))
              ) : (
                <div style={{ padding: "12px", borderRadius: 12, background: "rgba(255,255,255,0.14)", textAlign: "center", fontSize: 13 }}>
                  Select at least 2 online peers from the mesh list to start a group room.
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setGroupCallMuted((m) => !m)}
                style={{ border: "none", borderRadius: 999, padding: "10px 14px", fontWeight: 800, cursor: "pointer", background: groupCallMuted ? "#ffffff" : "rgba(255,255,255,0.16)", color: groupCallMuted ? "#001a2e" : "#fff" }}
              >
                {groupCallMuted ? "Unmute all" : "Mute all"}
              </button>
              <button
                type="button"
                onClick={() => setGroupCallSilent((s) => !s)}
                style={{ border: "none", borderRadius: 999, padding: "10px 14px", fontWeight: 800, cursor: "pointer", background: groupCallSilent ? "#ffffff" : "rgba(255,255,255,0.16)", color: groupCallSilent ? "#001a2e" : "#fff" }}
              >
                {groupCallSilent ? "Speak" : "Silent"}
              </button>
              <button
                type="button"
                onClick={() => setGroupCallSpeaker((s) => !s)}
                style={{ border: "none", borderRadius: 999, padding: "10px 14px", fontWeight: 800, cursor: "pointer", background: groupCallSpeaker ? "rgba(48,209,88,0.26)" : "rgba(255,255,255,0.16)", color: "#fff" }}
              >
                {groupCallSpeaker ? "Speaker on" : "Speaker off"}
              </button>
            </div>

            <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.86, textAlign: "center", marginTop: 8 }}>
              {groupCallMuted ? "Your mic is muted for the mesh room." : "Your mic is live for the mesh room."}
              <br />
              {groupCallSilent ? "Room is silent for now." : "Peers are listening to your voice."}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 6 }}>
              <button
                type="button"
                onClick={() => setGroupCallOpen(false)}
                style={{ border: "none", borderRadius: 999, padding: "10px 16px", fontWeight: 800, cursor: "pointer", background: "rgba(255,255,255,0.16)", color: "#fff" }}
              >
                Close room
              </button>
            </div>
          </div>
        </Shell>
      </ThemeCtx.Provider>
    );
  }

  // ═══════════ IN-CALL (Apple Phone style — voice ↔ video switch) ═══════════
  if (phase !== "idle" && callPeer) {
    const title =
      phase === "incoming"
        ? "Incoming call"
        : phase === "active"
          ? fmt(secs)
          : phase === "outgoing"
            ? "Calling…"
            : "GridCaller";
    const showVideoLayout = videoOn || remoteHasVideo;
    return (
      <div
        className="gc-overlay"
        style={{
          position: onClose ? "absolute" : "relative",
          inset: onClose ? 0 : undefined,
          zIndex: 400,
          width: "100%",
          height: onClose ? "100%" : "100%",
          minHeight: 0,
          maxHeight: "100%",
          background: "#000",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: showVideoLayout ? "12px 16px 20px" : "36px 20px 24px",
          fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <audio id="meshCommsRemoteAudio" ref={remoteEl} autoPlay playsInline style={{ display: "none" }} />

        {/* Remote video (full screen when video active) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            background: "#000",
            display: remoteHasVideo ? "block" : "none",
            zIndex: 0,
          }}
        />

        {/* Local PiP when camera on */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: "absolute",
            top: 56,
            right: 16,
            width: showVideoLayout ? 112 : 0,
            height: showVideoLayout ? 150 : 0,
            borderRadius: 14,
            objectFit: "cover",
            border: "2px solid rgba(255,255,255,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            zIndex: 2,
            background: "#1c1c1e",
            display: videoOn ? "block" : "none",
            transform: facingUser ? "scaleX(-1)" : undefined,
          }}
        />

        {/* Top status */}
        <div
          style={{
            position: "relative",
            zIndex: 3,
            width: "100%",
            textAlign: "center",
            padding: showVideoLayout
              ? "max(48px, calc(env(safe-area-inset-top, 0px) + 28px)) 20px 0"
              : "0",
            background: showVideoLayout
              ? "linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)"
              : "transparent",
          }}
        >
          <div style={{ fontSize: 13, letterSpacing: 0.4, opacity: 0.75, fontWeight: 600, marginBottom: 8 }}>
            {callMethod || (videoOn ? "Video call" : "Voice call")}
          </div>
          {!showVideoLayout && (
            <>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  margin: "20px auto 20px",
                  background: hue(callPeer.id),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 34,
                  fontWeight: 600,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                }}
              >
                {initials(callPeer.name)}
              </div>
            </>
          )}
          <div style={{ fontSize: showVideoLayout ? 22 : 32, fontWeight: 300, letterSpacing: 0.3 }}>
            {callPeer.name}
          </div>
          <div style={{ marginTop: 8, fontSize: 16, fontWeight: 400, opacity: 0.75 }}>{title}</div>
          {err && <div style={{ marginTop: 12, fontSize: 13, color: "#ff453a" }}>{err}</div>}
        </div>

        {/* Spacer for voice layout */}
        {!showVideoLayout && <div style={{ flex: 1 }} />}

        {/* Controls */}
        <div
          style={{
            position: "relative",
            zIndex: 3,
            width: "100%",
            padding: showVideoLayout ? "28px 20px 40px" : "0",
            background: showVideoLayout
              ? "linear-gradient(to top, rgba(0,0,0,0.7), transparent)"
              : "transparent",
          }}
        >
          {phase === "incoming" ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%" }}>
              <div style={{ fontSize: 15, opacity: 0.9, marginBottom: 4, fontWeight: 600 }}>
                🔔 Ringing — tap Accept to talk
              </div>
              <div style={{ display: "flex", gap: 36, width: "100%", justifyContent: "center", flexWrap: "wrap" }}>
                <CallBtn
                  label="Decline"
                  color={T.red}
                  onClick={() => {
                    rejectCall();
                    hangup("reject");
                  }}
                >
                  <PhoneOff size={28} />
                </CallBtn>
                <CallBtn label="Accept" color={T.green} big onClick={acceptIncoming}>
                  <Phone size={32} />
                </CallBtn>
                <CallBtn
                  label="Block"
                  color="rgba(255,69,58,0.85)"
                  onClick={() => {
                    blockCaller(callPeer.id, callPeer.name);
                    rejectCall();
                    hangup("reject");
                  }}
                >
                  <Ban size={26} />
                </CallBtn>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 22, alignItems: "flex-end", justifyContent: "center", flexWrap: "wrap" }}>
              <CallBtn
                label={muted ? "Unmute" : "Mute"}
                color="rgba(255,255,255,0.14)"
                onClick={() => {
                  setMuted((m) => {
                    toggleMute(!m);
                    localStream.current?.getAudioTracks().forEach((t) => (t.enabled = m));
                    return !m;
                  });
                }}
              >
                {muted ? <MicOff size={24} /> : <Mic size={24} />}
              </CallBtn>

              <CallBtn
                label={cameraBusy ? "…" : videoOn ? "Video on" : "Camera"}
                color={videoOn ? "rgba(48,209,88,0.35)" : "rgba(255,255,255,0.14)"}
                onClick={() => void toggleVideoCall()}
              >
                {videoOn ? <Video size={24} /> : <VideoOff size={24} />}
              </CallBtn>

              <CallBtn label="End" color={T.red} big onClick={() => hangup("hangup")}>
                <PhoneOff size={30} />
              </CallBtn>

              {videoOn ? (
                <CallBtn label="Flip" color="rgba(255,255,255,0.14)" onClick={() => void flipCamera()}>
                  <SwitchCamera size={24} />
                </CallBtn>
              ) : (
                <CallBtn
                  label={speakerOn ? "Speaker" : "Earpiece"}
                  color={speakerOn ? "rgba(48,209,88,0.35)" : "rgba(255,255,255,0.14)"}
                  onClick={() => {
                    const next = !speakerOn;
                    setSpeakerOn(next);
                    void setSpeakerphone(next).then((r) => {
                      if (!r.ok) setErr(r.message);
                    });
                    void playRemoteStream(
                      (document.getElementById("meshCommsRemoteAudio") as HTMLAudioElement)
                        ?.srcObject as MediaStream
                    );
                  }}
                >
                  <Volume2 size={24} />
                </CallBtn>
              )}
            </div>
          )}
          {phase !== "incoming" && (
            <div
              style={{
                textAlign: "center",
                marginTop: 14,
                fontSize: 12,
                opacity: 0.55,
                fontWeight: 500,
              }}
            >
              {videoOn
                ? "Camera = video on/off · live WebRTC"
                : "Speaker toggles output · live WebRTC voice"}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════ SMS THREAD ═══════════
  if (thread) {
    const name = peers.find((p) => p.id === thread)?.name || sms.find((m) => m.peerId === thread)?.name || thread.slice(0, 10);
    const directPeerOnline = !!(peers.find((p) => p.id === thread)?.online || globalPeers.find((p) => p.id === thread)?.online);
    const directStatusText = directPeerOnline ? "online" : "last seen recently";
    const threadSearch = threadSearchQuery.trim().toLowerCase();
    const threadBaseMsgs = threadShowStarredOnly ? threadMsgs.filter((m) => starredMessageIds.includes(m.id)) : threadMsgs;
    const visibleThreadMsgs = threadSearch
      ? threadBaseMsgs.filter((m) => (`${m.text} ${m.attachment?.name || ""}`.toLowerCase().includes(threadSearch)))
      : threadBaseMsgs;
    return (
      <ThemeCtx.Provider value={tokens}>
      <Shell>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: tokens.bar,
            borderBottom: `1px solid ${tokens.sep}`,
            flexShrink: 0,
          }}
        >
          <Back onClick={() => setThread(null)} />
          <button
            type="button"
            onClick={() => openChatProfile(thread, name, "direct")}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              background: hue(thread),
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 800,
              flexShrink: 0,
              border: "none",
              cursor: "pointer",
            }}
            title="Open contact info"
          >
            {initials(name)}
          </button>
          <button
            type="button"
            onClick={() => openChatProfile(thread, name, "direct")}
            style={{ minWidth: 0, flex: 1, border: "none", background: "transparent", textAlign: "left", cursor: "pointer", padding: 0 }}
            title="Open contact info"
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
            <div style={{ fontSize: 11, color: directPeerOnline ? tokens.green : tokens.label, fontWeight: 700 }}>{directStatusText}</div>
          </button>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 2 }}>
            <button
              type="button"
              title="Video call"
              onClick={() => void startDirectHeaderCall(thread, name, "video")}
              style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <Video size={18} />
            </button>
            <button
              type="button"
              title="Voice call"
              onClick={() => void startDirectHeaderCall(thread, name, "audio")}
              style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <Phone size={18} />
            </button>
            <button
              type="button"
              title="Search"
              onClick={() => {
                setDirectChatMenuOpen(false);
                setThreadSearchOpen((v) => !v);
              }}
              style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              title="More"
              onClick={() => setDirectChatMenuOpen((v) => !v)}
              style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <EllipsisVertical size={18} />
            </button>
            {directChatMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 38,
                  width: "min(84vw, 230px)",
                  borderRadius: 12,
                  border: `1px solid ${tokens.sep}`,
                  background: tokens.card,
                  boxShadow: tokens.shadow,
                  zIndex: 7,
                  overflow: "hidden",
                }}
              >
                {[
                  { id: "contact-info", label: "Contact info" },
                  { id: "business-details", label: "Business details" },
                  { id: "search", label: "Search" },
                  { id: "select-messages", label: "Select messages" },
                  { id: "mute-notifications", label: "Mute notifications" },
                  { id: "add-favourites", label: "Add to favourites" },
                  { id: "add-to-list", label: "Add to list" },
                  { id: "close-chat", label: "Close chat" },
                  { id: "send-call-link", label: "Send call link" },
                  { id: "schedule-call", label: "Schedule call" },
                  { id: "new-group-call", label: "New group call" },
                  { id: "report", label: "Report" },
                  { id: "block", label: "Block" },
                  { id: "clear-chat", label: "Clear chat" },
                  { id: "delete-chat", label: "Delete chat" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => runDirectChatMenuAction(item.id, thread, name)}
                    style={{
                      width: "100%",
                      border: "none",
                      borderBottom: `1px solid ${tokens.sep}`,
                      background: tokens.card,
                      color: item.id === "block" || item.id === "delete-chat" ? tokens.red : tokens.text,
                      textAlign: "left",
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {threadSearchOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.fill }}>
            <Search size={14} color={tokens.label} />
            <input
              value={threadSearchQuery}
              onChange={(e) => setThreadSearchQuery(e.target.value)}
              placeholder="Search in this chat"
              style={{ flex: 1, border: "none", background: "transparent", color: tokens.text, outline: "none", fontSize: 13 }}
            />
            <button
              type="button"
              onClick={() => {
                setThreadSearchQuery("");
                setThreadSearchOpen(false);
              }}
              style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
            >
              Close
            </button>
          </div>
        )}
        {threadShowStarredOnly && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.fill }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>Showing starred messages</div>
            <button
              type="button"
              onClick={() => setThreadShowStarredOnly(false)}
              style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
            >
              Show all
            </button>
          </div>
        )}
        {directSelectMode && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.fill }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{directSelectedMessageIds.length} selected</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setDirectSelectedMessageIds(visibleThreadMsgs.map((m) => m.id))}
                style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirectSelectMode(false);
                  setDirectSelectedMessageIds([]);
                }}
                style={{ border: "none", background: "transparent", color: tokens.label, fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={copySelectedDirectMessages}
                style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={deleteSelectedDirectMessages}
                style={{ border: "none", background: "transparent", color: tokens.red, fontWeight: 700, cursor: "pointer" }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
        {contactBusy ? (
          <div style={{ padding: "6px 16px", fontSize: 12, color: tokens.green, fontWeight: 600 }}>{contactBusy}</div>
        ) : null}
        <div
          className="gc-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "12px 16px 10px",
            backgroundColor: tokens.dark ? "#0e0e10" : "#efeae2",
            backgroundImage:
              "radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), radial-gradient(rgba(0,0,0,0.02) 1px, transparent 1px)",
            backgroundSize: "22px 22px, 44px 44px",
            backgroundPosition: "0 0, 11px 11px",
          }}
        >

          {visibleThreadMsgs.length === 0 && (
            <div style={{ textAlign: "center", color: tokens.label, fontSize: 13, padding: 20 }}>
              {threadSearch ? "No matching messages" : "No messages yet — type below to compose"}
            </div>
          )}
          {visibleThreadMsgs.map((m) => {
            const isStarred = starredMessageIds.includes(m.id);
            const isSelected = directSelectedMessageIds.includes(m.id);
            return (
            <div key={m.id} style={{ display: "flex", justifyContent: m.mine ? "flex-end" : "flex-start", marginBottom: 8, alignItems: "flex-end", gap: 6 }}>
              {!m.mine && (
                <button
                  type="button"
                  title="Delete message"
                  onClick={() => deleteSmsMessage(m.id)}
                  style={{
                    border: "none",
                    background: tokens.fill,
                    color: tokens.red,
                    borderRadius: 14,
                    width: 28,
                    height: 28,
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <div
                onContextMenu={(e) => {
                  e.preventDefault();
                  setDirectSelectMode(true);
                  toggleDirectMessageSelection(m.id);
                }}
                onClick={() => {
                  if (directSelectMode) toggleDirectMessageSelection(m.id);
                }}
                style={{
                  maxWidth: "72%",
                  background: m.mine ? (tokens.dark ? "#144d37" : "#dcf8c6") : tokens.card,
                  color: m.mine ? (tokens.dark ? "#e8fff4" : "#111") : tokens.text,
                  borderRadius: 18,
                  padding: "10px 14px",
                  fontSize: 16,
                  lineHeight: 1.35,
                  boxShadow: tokens.shadow,
                  border: directSelectMode && isSelected ? `2px solid ${tokens.blue}` : m.mine ? "none" : `1px solid ${tokens.sep}`,
                  position: "relative",
                  cursor: directSelectMode ? "pointer" : "default",
                }}
              >
                {m.text ? <div>{m.text}</div> : null}
                {m.attachment?.kind === "location" && m.attachment.lat != null && m.attachment.lng != null ? (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Location: {m.attachment.lat.toFixed(5)}, {m.attachment.lng.toFixed(5)}
                  </div>
                ) : null}
                {m.attachment?.dataUrl ? (
                  <div style={{ marginTop: 6 }}>
                    {m.attachment.kind === "image" ? (
                      <img src={m.attachment.dataUrl} alt={m.attachment.name} style={{ maxWidth: "100%", borderRadius: 10 }} />
                    ) : m.attachment.kind === "audio" ? (
                      <audio controls src={m.attachment.dataUrl} style={{ width: "100%" }} />
                    ) : m.attachment.kind === "video" ? (
                      <video controls src={m.attachment.dataUrl} style={{ width: "100%", borderRadius: 10 }} />
                    ) : (
                      <a
                        href={m.attachment.dataUrl}
                        download={m.attachment.name}
                        style={{ color: m.mine ? "#fff" : tokens.blue, fontWeight: 700 }}
                      >
                        Download {m.attachment.name}
                      </a>
                    )}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.55,
                    marginTop: 4,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span>{fullDateTime(m.ts)}</span>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      title={isStarred ? "Unstar" : "Star"}
                      onClick={() => toggleStarMessage(m.id)}
                      style={{ border: "none", background: "rgba(0,0,0,0.15)", color: isStarred ? "#ffd54a" : "#fff", borderRadius: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                    >
                      {isStarred ? <Star size={12} fill="#ffd54a" color="#ffd54a" /> : <StarOff size={12} />}
                    </button>
                   {m.text ? (
                      <button
                        type="button"
                       title="Copy message"
                       onClick={() => copyTextToClipboard(m.text, "Message copied")}
                       style={{ border: "none", background: "rgba(0,0,0,0.15)", color: "#fff", borderRadius: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700 }}
                      >
                       Copy
                      </button>
                    ) : null}
                   {directSelectMode ? (
                      <button
                        type="button"
                       title={isSelected ? "Unselect" : "Select"}
                       onClick={() => toggleDirectMessageSelection(m.id)}
                       style={{ border: "none", background: "rgba(0,0,0,0.15)", color: "#fff", borderRadius: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                     >
                       {isSelected ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                     </button>
                   ) : null}
                   {m.mine && (
                     <button
                       type="button"
                       title="Delete message"
                       onClick={() => deleteSmsMessage(m.id)}
                       style={{
                         border: "none",
                         background: "rgba(0,0,0,0.15)",
                         color: "#fff",
                         borderRadius: 10,
                         padding: "2px 6px",
                         cursor: "pointer",
                         display: "inline-flex",
                         alignItems: "center",
                       }}
                     >
                       <Trash2 size={12} />
                     </button>
                   )}
                  </div>
                </div>
              </div>
              {m.mine ? null : null}
            </div>
          );})}
        </div>
        <div
          style={{
            padding: "10px 12px 16px",
            background: tokens.dark ? "#1b1b1f" : "#f0f2f5",
            backdropFilter: tokens.blur,
            borderTop: `0.5px solid ${tokens.sep}`,
            position: "relative",
          }}
        >
          {directAttachMenuOpen && (
            <div
              style={{
                position: "absolute",
                left: 12,
                bottom: 64,
                width: "min(92vw, 280px)",
                borderRadius: 14,
                border: `1px solid ${tokens.sep}`,
                background: tokens.card,
                boxShadow: tokens.shadow,
                zIndex: 4,
                overflow: "hidden",
              }}
            >
              {[
                { id: "document" as const, label: "Document", icon: <Download size={16} color={tokens.blue} /> },
                { id: "photos" as const, label: "Photos & videos", icon: <ImageIcon size={16} color={tokens.green} /> },
                { id: "camera" as const, label: "Camera", icon: <Camera size={16} color={tokens.red} /> },
                { id: "audio" as const, label: "Audio", icon: <Mic size={16} color={tokens.orange} /> },
                { id: "contact" as const, label: "Contact", icon: <IdCard size={16} color={tokens.blue} /> },
                { id: "poll" as const, label: "Poll", icon: <CheckCircle2 size={16} color={tokens.green} /> },
                { id: "event" as const, label: "Event", icon: <CalendarDays size={16} color={tokens.orange} /> },
                { id: "sticker" as const, label: "Sticker", icon: <Sparkles size={16} color={tokens.red} /> },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => runDirectAttachAction(thread, name, item.id)}
                  style={{
                    width: "100%",
                    border: "none",
                    borderBottom: `1px solid ${tokens.sep}`,
                    background: tokens.card,
                    color: tokens.text,
                    padding: "11px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => {
                setDirectChatMenuOpen(false);
                setDirectAttachMenuOpen((v) => !v);
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                border: "none",
                background: tokens.dark ? "#38383d" : "#ffffff",
                color: tokens.text,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
              title="Attach"
            >
              <Plus size={16} />
            </button>
            <input
              value={smsDraft}
              onChange={(e) => setSmsDraft(e.target.value)}
              placeholder="Type a message..."
              style={{
                flex: 1,
                border: `1px solid ${tokens.sep}`,
                background: tokens.dark ? "#2f2f32" : "#ffffff",
                color: tokens.text,
                borderRadius: 999,
                padding: "10px 14px",
                fontSize: 16,
                outline: "none",
                boxShadow: "none",
              }}
              onFocus={() => {
                setDirectAttachMenuOpen(false);
                setDirectChatMenuOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  sendSms(thread, name, smsDraft);
                  setSmsDraft("");
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!smsDraft.trim()) {
                  setErr("Type a message or use + to attach");
                  return;
                }
                sendSms(thread, name, smsDraft);
                setSmsDraft("");
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                border: "none",
                background: tokens.blue,
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 16,
                flexShrink: 0,
              }}
              title={smsDraft.trim() ? "Send" : "Voice"}
            >
              {smsDraft.trim() ? "↑" : <Mic size={16} />}
            </button>
          </div>

          <input
            ref={directMediaInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) shareDirectFile(thread, name, f);
              e.target.value = "";
            }}
          />
          <input
            ref={directDocumentInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.json,.xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) shareDirectFile(thread, name, f);
              e.target.value = "";
            }}
          />
          <input
            ref={directCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) shareDirectFile(thread, name, f);
              e.target.value = "";
            }}
          />
          <input
            ref={directAudioInputRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) shareDirectFile(thread, name, f);
              e.target.value = "";
            }}
          />
        </div>
        {renderChatProfileOverlay()}
        {renderStatusViewerOverlay()}
        {renderActionComposerOverlay()}
      </Shell>
      </ThemeCtx.Provider>
    );
  }

  // ═══════════ APP STANDBY ═══════════
  if (!appEnabled) {
    return (
      <ThemeCtx.Provider value={tokens}>
        <div
          className="gc-shell"
          style={{
            height: "100%",
            width: "100%",
            minHeight: 0,
            maxHeight: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: tokens.bg,
            color: tokens.text,
            fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif",
            textAlign: "center",
            boxSizing: "border-box",
            overflow: "auto",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              background: tokens.fill,
              display: "grid",
              placeItems: "center",
              marginBottom: 16,
              color: tokens.label,
            }}
          >
            <Power size={32} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>GridCaller OFF</div>
          <div style={{ fontSize: 14, color: tokens.label, lineHeight: 1.5, marginBottom: 24, maxWidth: 280 }}>
            Mesh, radio, soft towers, and calls are on standby. Your data stays on this device — turn ON to resume.
          </div>
          <button
            type="button"
            onClick={() => setAppEnabled(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 28px",
              borderRadius: 14,
              border: "none",
              background: tokens.green,
              color: "#041510",
              fontWeight: 800,
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            <Power size={20} /> Turn ON GridCaller
          </button>
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            style={{
              marginTop: 16,
              border: `1px solid ${tokens.sep}`,
              background: tokens.fill,
              color: tokens.text,
              borderRadius: 10,
              padding: "10px 16px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </ThemeCtx.Provider>
    );
  }

  // ═══════════ MAIN ═══════════
  return (
    <ThemeCtx.Provider value={tokens}>
    <Shell>
      <div
        style={{
          background: tokens.bar,
          backdropFilter: tokens.blur,
          borderBottom: `0.5px solid ${tokens.sep}`,
          /* Root already applies safe-area; keep compact header padding only */
          paddingTop: 10,
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: 0,
          flexShrink: 0,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginBottom: 10, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 260px" }}>
            <button
              type="button"
              title="Menu"
              onClick={() => {
                setMenuView("home");
                setMenuFullscreen(false);
                setMenuOpen(true);
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: `1px solid ${tokens.sep}`,
                background: tokens.fill,
                color: tokens.text,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Menu size={20} />
            </button>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                border: `1px solid ${tokens.sep}`,
                background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
                display: "grid",
                placeItems: "center",
                padding: 4,
                flexShrink: 0,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              <img src={gridCallerLogo} alt="GridCaller logo" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 700, letterSpacing: -0.5, color: tokens.text, lineHeight: 1.15 }}>GridCaller</div>
              <div style={{ fontSize: "clamp(13px, 2.8vw, 14px)", color: tokens.text, marginTop: 3, fontWeight: 700 }}>
                {myGridDisplay ||
                  (globalHandle && String(globalHandle).replace(/\D/g, "").length >= 8
                    ? formatTestPhone(globalHandle)
                    : globalHandle) ||
                  "No number set"}
              </div>
              <div style={{ fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                <span style={{ color: hubStatus.connected || autoMeshStatus?.trysteroOk ? tokens.green : tokens.orange }}>
                  {hubStatus.connected
                    ? "● Hub + swarm mesh ON"
                    : autoMeshStatus?.trysteroOk
                      ? "● Swarm mesh ON — no server needed"
                      : autoMeshStatus?.started
                        ? "◌ Joining swarm mesh…"
                        : "◌ Starting mesh…"}
                </span>
                <span style={{ color: tokens.label }}>
                  {" · "}
                  {peers.filter((p) => p.online && !isSelfPeer(p.id)).length} peer
                  {peers.filter((p) => p.online && !isSelfPeer(p.id)).length === 1 ? "" : "s"}
                </span>
              </div>
              <div style={{ fontSize: 10, color: tokens.label, marginTop: 2 }}>
                Handle: <b style={{ color: tokens.text }}>@{getMeshHandle()}</b>
              </div>
              <div style={{ fontSize: 10, color: tokens.label, marginTop: 2 }}>
                My ID: <b style={{ color: tokens.text }}>{MeshEngine.localId}</b>
              </div>
              <div style={{ fontSize: 10, color: tokens.green, marginTop: 2, lineHeight: 1.3 }}>
                {autoMeshStatus?.trysteroOk || hubStatus.connected
                  ? "This device is a mesh node · ready to call & relay"
                  : "Searching for nearby nodes…"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", marginLeft: "auto" }}>
            <button
              type="button"
              title={darkMode ? "Light mode" : "Dark mode"}
              onClick={() => setDarkMode((d) => !d)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                border: `1px solid ${tokens.sep}`,
                background: tokens.fill,
                color: tokens.text,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              title="Turn OFF GridCaller"
              onClick={() => {
                if (confirm("Turn GridCaller OFF? Mesh and calls will go to standby.")) {
                  setAppEnabled(false);
                  setMenuOpen(false);
                }
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                border: `1px solid ${tokens.sep}`,
                background: tokens.fill,
                color: tokens.red,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <Power size={18} />
            </button>
            <div
              style={{
                display: "flex",
                background: tokens.fill,
                borderRadius: 10,
                padding: 2,
                gap: 2,
              }}
            >
              <div
                style={{
                  border: `1px solid ${tokens.sep}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: tokens.blue,
                  background: `${tokens.blue}14`,
                }}
                title="Auto routing: local first, global fallback"
              >
                Auto
              </div>
            </div>
          </div>
        </div>
      </div>

      {(tab === "contacts" || (tab === "logs" && logsSubView === "contacts")) && (
        <div style={{ padding: "10px 16px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: tokens.fill, borderRadius: 10, padding: "8px 12px" }}>
            <Search size={15} color={tokens.label} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts"
              style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 16, color: tokens.text }}
            />
            {q.trim() ? (
              <button
                type="button"
                onClick={() => setQ("")}
                style={{ border: "none", background: "none", color: tokens.label, cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}
                title="Clear search"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div>
          {/* TrueCaller-style top: search + menu — hidden when in contacts sub-view (contacts has its own search) */}
          <div style={{ padding: "8px 16px 4px", display: logsSubView === "contacts" ? "none" : "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: tokens.fill, borderRadius: 24, padding: "8px 14px" }}>
              <Search size={15} color={tokens.label} />
              <input
                placeholder="Search names &amp; numbers"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: tokens.text, fontSize: 14 }}
              />
              {q ? <button type="button" onClick={() => setQ("")} style={{ border: "none", background: "none", color: tokens.label, cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}><X size={14} /></button> : null}
            </div>
            <button type="button" onClick={refreshLocalLogs} style={{ border: "none", background: tokens.fill, color: tokens.text, borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" }} title="Refresh"><Radio size={16} /></button>
            <button type="button" onClick={() => setLogFiltersOpen((p) => !p)} style={{ border: "none", background: tokens.fill, color: tokens.text, borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" }} title="Filters"><EllipsisVertical size={16} /></button>
          </div>
          {/* Recent callers horizontal strip - TrueCaller style */}
          {logsSubView === "recents" && (() => {
            const seen = new Set<string>();
            const recents = latestLocalCommLog
              .filter((e) => e.kind === "call")
              .filter((e) => {
                const key = e.peerId || e.peerNumber || e.peerName || "";
                if (!key || seen.has(key)) return false;
                seen.add(key); return true;
              })
              .slice(0, 8);
            if (!recents.length) return null;
            return (
              <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "8px 16px 6px", borderBottom: `1px solid ${tokens.sep}` }}>
                {recents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => e.peerId ? void placeCallLocal(e.peerId, e.peerName || "") : undefined}
                    style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer" }}
                  >
                    <div style={{ position: "relative" }}>
                      <div style={{ width: 50, height: 50, borderRadius: 25, background: hue(e.peerId || e.peerName || e.id), color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>
                        {initials(e.peerName || e.peerNumber || "?")}
                      </div>
                      <span style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)", background: e.direction === "missed" ? tokens.red : tokens.label, color: "#fff", borderRadius: 999, fontSize: 9, fontWeight: 700, padding: "1px 5px", whiteSpace: "nowrap" }}>
                        {timeLabel(e.ts)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: tokens.text, fontWeight: 600, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 6 }}>
                      {(e.peerName || e.peerNumber || "Unknown").split(" ")[0]}
                    </div>
                    <div style={{ fontSize: 10, color: tokens.label }}>Mobile</div>
                  </button>
                ))}
              </div>
            );
          })()}
          {/* Filter chips + People chip + keypad FAB row */}
          {logsSubView !== "keypad" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px 4px", flexWrap: "wrap" }}>
              {logsSubView === "recents" && [
                { id: "all" as const, label: `All ${localCommLog.length}` },
                { id: "calls" as const, label: `Calls ${logStats.calls}` },
                { id: "messages" as const, label: `Messages ${logStats.messages}` },
                { id: "blocked" as const, label: `Blocked ${logStats.blocked}` },
              ].map((item) => {
                const active = logFilter === item.id;
                return (
                  <button key={item.id} type="button" onClick={() => setLogFilter(item.id)} style={{ border: active ? "none" : `1px solid ${tokens.sep}`, background: active ? tokens.blue : tokens.card, color: active ? "#fff" : tokens.text, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    {item.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setLogsSubView(logsSubView === "contacts" ? "recents" : "contacts")}
                style={{ border: logsSubView === "contacts" ? "none" : `1px solid ${tokens.sep}`, background: logsSubView === "contacts" ? tokens.blue : tokens.card, color: logsSubView === "contacts" ? "#fff" : tokens.text, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
              >
                <Users size={12} /> People
              </button>
              <button
                type="button"
                onClick={() => setLogsSubView(logsSubView === "keypad" ? "recents" : "keypad")}
                style={{ marginLeft: "auto", border: "none", background: tokens.fill, color: tokens.text, borderRadius: 12, width: 44, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s" }}
                title="Keypad"
              >
                <span style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2.5px", width: 16, height: 18 }}>
                  {[...Array(6)].map((_, i) => <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor", display: "block" }} />)}
                  <span style={{ gridColumn: "2", width: 4, height: 4, borderRadius: "50%", background: "currentColor", display: "block" }} />
                </span>
              </button>
            </div>
          )}
          {logsSubView === "keypad" && (
            <div style={{ padding: "6px 16px 0", display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" onClick={() => setLogsSubView("recents")} style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Phone size={12} /> Back to Recents</button>
            </div>
          )}
          {logsSubView === "recents" && logFiltersOpen ? renderLogFilterPanel(true) : null}
        </div>
      )}

      {err && (
        <div style={{ margin: "8px 16px", padding: 12, borderRadius: 12, background: "#FF3B3014", color: T.red, fontSize: 13 }}>
          {err}{" "}
          <button onClick={() => setErr("")} style={{ border: "none", background: "none", color: T.blue, cursor: "pointer" }}>
            Dismiss
          </button>
        </div>
      )}

      {/* ═══ MESH TAB header — search + filters (mirrors Calls tab) ═══ */}
      {tab === "mesh" && (
        <div>
          {/* Search + refresh + filter toggle */}
          <div style={{ padding: "8px 16px 4px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: tokens.fill, borderRadius: 24, padding: "8px 14px" }}>
              <Search size={15} color={tokens.label} />
              <input
                placeholder="Search mesh calls &amp; messages"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: tokens.text, fontSize: 14 }}
              />
              {q ? <button type="button" onClick={() => setQ("")} style={{ border: "none", background: "none", color: tokens.label, cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}><X size={14} /></button> : null}
            </div>
            <button type="button" onClick={refreshLocalLogs} style={{ border: "none", background: tokens.fill, color: tokens.text, borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" }} title="Refresh"><Radio size={16} /></button>
            <button type="button" onClick={() => setLogFiltersOpen((p) => !p)} style={{ border: "none", background: tokens.fill, color: tokens.text, borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" }} title="Filters"><EllipsisVertical size={16} /></button>
            <button type="button" onClick={() => setMeshSubView(meshSubView === "keypad" ? "recents" : "keypad")} style={{ border: "none", background: meshSubView === "keypad" ? tokens.blue : tokens.fill, color: meshSubView === "keypad" ? "#fff" : tokens.text, borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer" }} title="Dialpad"><Grid3X3 size={16} /></button>
          </div>
          {/* Filter chips */}
          {meshSubView !== "people" && (() => {
            const ml = localCommLog.filter((e) => classifyLogSource(e) === "mesh-network");
            const mlCalls = ml.filter((e) => e.kind === "call").length;
            const mlMsgs = ml.filter((e) => e.kind === "message").length;
            const mlBlocked = ml.filter((e) => e.direction === "blocked" || e.kind === "block").length;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px 4px", flexWrap: "wrap" }}>
                {([
                  { id: "all" as const, label: `All ${ml.length}` },
                  { id: "calls" as const, label: `Calls ${mlCalls}` },
                  { id: "messages" as const, label: `Messages ${mlMsgs}` },
                  { id: "blocked" as const, label: `Blocked ${mlBlocked}` },
                ]).map((item) => {
                  const active = logFilter === item.id;
                  return (
                    <button key={item.id} type="button" onClick={() => setLogFilter(item.id)} style={{ border: active ? "none" : `1px solid ${tokens.sep}`, background: active ? tokens.blue : tokens.card, color: active ? "#fff" : tokens.text, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {item.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setMeshSubView(meshSubView === "people" ? "recents" : "people")}
                  style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                >
                  <Users size={12} /> People
                </button>
              </div>
            );
          })()}
          {(meshSubView === "people" || meshSubView === "keypad") && (
            <div style={{ padding: "6px 16px 0", display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" onClick={() => setMeshSubView("recents")} style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Wifi size={12} /> Back to Recents</button>
            </div>
          )}
          {meshSubView === "recents" && logFiltersOpen ? renderLogFilterPanel(true) : null}
        </div>
      )}

      <div className="gc-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 16, WebkitOverflowScrolling: "touch" as any }}>
        {logsSelectMode && visibleLogIds.length > 0 ? (
          <div style={{ margin: "8px 12px", padding: "8px 10px", borderRadius: 12, border: `1px solid ${tokens.sep}`, background: tokens.fill, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{selectedLogIds.length} selected</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSelectedLogIds(visibleLogIds)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Select all</button>
              <button type="button" onClick={() => markLogSeenState(visibleLogIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read all</button>
              <button type="button" onClick={() => markLogSeenState(visibleLogIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread all</button>
              <button type="button" onClick={() => markLogSeenState(selectedLogIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read selected</button>
              <button type="button" onClick={() => markLogSeenState(selectedLogIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread selected</button>
              <button type="button" onClick={deleteSelectedLogs} style={{ ...compactActionBtn(tokens), padding: "5px 9px", color: tokens.red }}>Delete</button>
              <button type="button" onClick={() => { setLogsSelectMode(false); setSelectedLogIds([]); }} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Cancel</button>
            </div>
          </div>
        ) : null}
        {/* ═══ MESH TAB — Calls-style UI for mesh network calls + messages ═══ */}
        {tab === "mesh" && (() => {
          const onlinePeers = peers.filter((p) => p.online && !isSelfPeer(p.id));
          const meshLog = localCommLog.filter((e) => classifyLogSource(e) === "mesh-network");

          // Apply full filter stack (same as Calls tab) but always pre-filtered to mesh-network
          const filteredMeshLog = meshLog.filter((e) => {
            const isBlocked = e.direction === "blocked" || e.kind === "block";
            if (logFilter === "calls" && e.kind !== "call") return false;
            if (logFilter === "messages" && e.kind !== "message") return false;
            if (logFilter === "blocked" && !isBlocked) return false;
            if (q.trim()) {
              const sq = q.toLowerCase();
              if (!((e.peerName || "").toLowerCase().includes(sq) || (e.peerNumber || "").toLowerCase().includes(sq) || (e.peerId || "").toLowerCase().includes(sq))) return false;
            }
            if (e.kind === "call") return callDirectionFilters.includes(getCallDirectionFilter(e));
            if (e.kind === "message") return messageDirectionFilters.includes(getMessageDirectionFilter(e));
            return true;
          });

          // People sub-view — full mesh peer list with call/msg buttons
          if (meshSubView === "people") {
            return (
              <>
                {onlinePeers.length === 0 ? (
                  <CardList>
                    <EmptyState title="Searching for mesh peers…" body="Broadcasting identity on swarm, LAN, and Bluetooth. When another GridCaller node enters range it will appear here automatically — no server needed." />
                  </CardList>
                ) : (
                  <div style={{ padding: "4px 0 16px" }}>
                    {onlinePeers.map((p) => {
                      const selected = groupSelection.includes(p.id);
                      return (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${tokens.sep}` }}>
                          <div style={{ width: 44, height: 44, borderRadius: 22, background: selected ? `${tokens.blue}22` : `${tokens.green}18`, color: selected ? tokens.blue : tokens.green, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                            {initials(p.name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: tokens.text, fontSize: 14 }}>{p.name}{p.handle ? <span style={{ color: tokens.blue, fontWeight: 600 }}> · @{p.handle}</span> : null}</div>
                            <div style={{ fontSize: 11, color: tokens.label, marginTop: 2 }}>{p.phone ? `📞 ${p.phone} · ` : ""}{p.id?.slice(0, 14)}</div>
                            <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${tokens.green}18`, color: tokens.green }}>Online</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${tokens.blue}16`, color: tokens.blue }}>Mesh</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" onClick={() => toggleGroupSelection(p.id)} style={{ border: "none", background: selected ? `${tokens.orange}18` : tokens.fill, color: selected ? tokens.orange : tokens.text, borderRadius: 10, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }} title={selected ? "Deselect" : "Select"}>{selected ? <CheckCircle2 size={15} /> : <Circle size={15} />}</button>
                            <button type="button" onClick={() => void placeCallLocal(p.id, p.name)} style={{ border: "none", background: tokens.green, color: "#041510", borderRadius: 10, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }} title="Call"><Phone size={14} /></button>
                            <button type="button" onClick={() => msgMeshNetwork(p.id, p.name)} style={{ border: "none", background: tokens.blue, color: "#fff", borderRadius: 10, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }} title="Message"><MessageCircle size={14} /></button>
                          </div>
                        </div>
                      );
                    })}
                    {selectedGroupPeers.length > 0 && (
                      <div style={{ padding: "10px 16px 0", display: "flex", gap: 8 }}>
                        <button type="button" onClick={startMeshGroupCall} style={{ border: "none", background: tokens.blue, color: "#fff", borderRadius: 999, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Group call ({selectedGroupPeers.length})</button>
                        <button type="button" onClick={clearGroupSelection} style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Clear selection</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          }

          // Recents sub-view — recent callers strip + log entries
          return (
            <>
              {/* Online now — horizontal strip */}
              {onlinePeers.length > 0 && (
                <div style={{ padding: "12px 16px 6px", borderBottom: `1px solid ${tokens.sep}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: tokens.green, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Online now · {onlinePeers.length}</div>
                  <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
                    {onlinePeers.slice(0, 10).map((p) => (
                      <button key={p.id} type="button" onClick={() => void placeCallLocal(p.id, p.name)} style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer" }}>
                        <div style={{ position: "relative" }}>
                          <div style={{ width: 50, height: 50, borderRadius: 25, background: hue(p.id), color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>{initials(p.name)}</div>
                          <span style={{ position: "absolute", bottom: -3, right: -3, width: 13, height: 13, borderRadius: 999, background: tokens.green, border: `2px solid ${tokens.bg}` }} />
                        </div>
                        <div style={{ fontSize: 11, color: tokens.text, fontWeight: 600, maxWidth: 54, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name.split(" ")[0]}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent mesh callers strip */}
              {(() => {
                const seen = new Set<string>();
                const recents = meshLog.filter((e) => e.kind === "call").filter((e) => {
                  const key = e.peerId || e.peerName || "";
                  if (!key || seen.has(key)) return false;
                  seen.add(key); return true;
                }).slice(0, 8);
                if (!recents.length) return null;
                return (
                  <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "8px 16px 6px", borderBottom: `1px solid ${tokens.sep}` }}>
                    {recents.map((e) => (
                      <button key={e.id} type="button" onClick={() => e.peerId ? void placeCallLocal(e.peerId, e.peerName || "") : undefined} style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer" }}>
                        <div style={{ position: "relative" }}>
                          <div style={{ width: 50, height: 50, borderRadius: 25, background: hue(e.peerId || e.peerName || e.id), color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>{initials(e.peerName || "?")}</div>
                          <span style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)", background: e.direction === "missed" ? tokens.red : tokens.green, color: "#fff", borderRadius: 999, fontSize: 9, fontWeight: 700, padding: "1px 5px", whiteSpace: "nowrap" }}>{timeLabel(e.ts)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: tokens.text, fontWeight: 600, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 6 }}>{(e.peerName || "Unknown").split(" ")[0]}</div>
                        <div style={{ fontSize: 10, color: tokens.green }}>Mesh</div>
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* Log entries */}
              {filteredMeshLog.length === 0 ? (
                <CardList>
                  <EmptyState
                    title={meshLog.length === 0 ? "No mesh activity yet" : "No entries match the filter"}
                    body={meshLog.length === 0 ? "Mesh calls and messages appear here after your first peer-to-peer session. Swarm is active — waiting for nodes." : "Try changing the filter or search query."}
                  />
                </CardList>
              ) : (
                <div style={{ padding: "4px 0 16px" }}>
                  {renderLogsWithDateSeparators(filteredMeshLog, true)}
                </div>
              )}
            </>
          );
        })()}
        {tab === "logs" && logsSubView === "recents" && (
          <CardList>
            {latestLocalCommLog.length === 0 ? (
              <EmptyState title="No local logs yet" body="Calls, messages, and mesh events will appear here. All stored locally on this device — no server required." />
            ) : (
              renderLogsWithDateSeparators(latestLocalCommLog, true)
            )}
          </CardList>
        )}
        {(tab === "contacts" || (tab === "logs" && logsSubView === "contacts")) && (
          <>
            {/* Toolbar — Truecaller-style actions */}
            <div style={{ padding: "4px 12px 8px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <button type="button" onClick={() => openNewContact()} style={contactChipStyle(tokens, true)}>
                <UserPlus size={14} /> Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaveNumName("");
                  setSaveNumPhone("");
                  setSaveNumId("");
                  openNewContact({ name: "", phones: [] });
                }}
                style={contactChipStyle(tokens, true)}
              >
                <Plus size={14} /> Save number
              </button>
              <button type="button" onClick={() => void importDeviceContacts()} style={contactChipStyle(tokens)}>
                <Smartphone size={14} /> Device
              </button>
              <button type="button" onClick={syncMeshToContacts} style={contactChipStyle(tokens)}>
                <Users size={14} /> Mesh
              </button>
              <button type="button" onClick={exportContacts} style={contactChipStyle(tokens)}>
                <Download size={14} /> Export
              </button>
              <button type="button" onClick={() => fileImportRef.current?.click()} style={contactChipStyle(tokens)}>
                <Upload size={14} /> Import
              </button>
              <input
                ref={fileImportRef}
                type="file"
                accept="application/json,.json,.csv,.vcf,.vcard,text/csv,text/vcard"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            <div style={{ padding: "0 12px 8px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {(
                [
                  { id: "all" as const, label: `All (${contactStats.total})` },
                  { id: "fav" as const, label: `★ ${contactStats.favourites}` },
                  { id: "spam" as const, label: `Spam ${contactStats.spam}` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setContactFilter(f.id)}
                  style={{
                    border: "none",
                    borderRadius: 14,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: contactFilter === f.id ? tokens.blue : tokens.fill,
                    color: contactFilter === f.id ? "#fff" : tokens.label,
                  }}
                >
                  {f.label}
                </button>
              ))}
              {contactBusy && (
                <span style={{ fontSize: 12, color: tokens.green, marginLeft: 4 }}>{contactBusy}</span>
              )}
            </div>

            {/* Saved contacts from local memory */}
            <CardList>
              {filteredContacts.length === 0 && (
                <EmptyState
                  title="No contacts yet"
                  body="Contacts are saved locally on this device. Tap Add to create one, or mesh peers you call/message are auto-saved."
                />
              )}
              {filteredContacts.map((c) => {
                const isBlocked = !!(c.peerId && blocked.includes(c.peerId));
                const primaryPhone = contactsVault.getPrimaryPhone(c);
                const bits = [
                  c.favourite ? "★" : "",
                  c.spam || isBlocked ? "Blocked" : "",
                  primaryPhone || c.emails[0] || (c.peerId ? `ID · ${c.peerId.slice(0, 10)}` : "") || c.company || c.source,
                ].filter(Boolean);
                return (
                  <Row
                    key={c.id}
                    avatar={c.name}
                    id={c.id}
                    title={c.name}
                    titleColor={c.spam || isBlocked ? tokens.red : tokens.text}
                    subtitle={bits.join(" · ")}
                    onClick={() => setContactView(c)}
                    actions={
                      <>
                        {!isBlocked && (
                          <IconCircle onClick={() => callContact(c)} color={tokens.green}>
                            <Phone size={16} />
                          </IconCircle>
                        )}
                        <IconCircle onClick={() => messageContact(c)} color={tokens.blue}>
                          <MessageCircle size={16} />
                        </IconCircle>
                        {c.peerId ? (
                          <IconCircle
                            onClick={() =>
                              isBlocked
                                ? unblockCaller(c.peerId!)
                                : blockCaller(c.peerId!, c.name)
                            }
                            color={tokens.red}
                          >
                            <Ban size={16} />
                          </IconCircle>
                        ) : null}
                      </>
                    }
                  />
                );
              })}
            </CardList>

            {/* Live mesh presence (also auto-merged into vault) */}
            {(filteredPeers.length > 0 || (callScope === "global" && globalPeers.length > 0)) && (
              <>
                <div style={{ padding: "14px 16px 6px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: tokens.label }}>
                    Online now
                  </div>
                  <button
                    type="button"
                    onClick={() => setOnlineNowCollapsed((v) => !v)}
                    style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, width: 28, height: 28, display: "grid", placeItems: "center", cursor: "pointer" }}
                    title={onlineNowCollapsed ? "Expand online list" : "Collapse online list"}
                  >
                    {onlineNowCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                </div>
                {!onlineNowCollapsed && (
                  <CardList>
                    {callScope === "global" &&
                      globalPeers.map((p) => (
                        <Row
                          key={`g_${p.id}`}
                          avatar={p.name}
                          id={p.id}
                          title={p.name}
                          subtitle={p.handle ? `@${p.handle}` : "Global · Online"}
                          actions={
                            <>
                              <IconCircle
                                onClick={() => {
                                  saveGridNumberToDevice({ name: p.name, peerId: p.id });
                                  placeCall(p.id, p.name);
                                }}
                                color={tokens.green}
                              >
                                <Phone size={16} />
                              </IconCircle>
                              <IconCircle
                                onClick={() => {
                                  saveGridNumberToDevice({ name: p.name, peerId: p.id });
                                  setThread(p.id);
                                }}
                                color={tokens.blue}
                              >
                                <MessageCircle size={16} />
                              </IconCircle>
                              <IconCircle
                                onClick={() => saveGridNumberToDevice({ name: p.name, peerId: p.id })}
                                color={tokens.orange}
                              >
                                <UserPlus size={16} />
                              </IconCircle>
                              <IconCircle onClick={() => blockCaller(p.id, p.name)} color={tokens.red}>
                                <Ban size={16} />
                              </IconCircle>
                            </>
                          }
                        />
                      ))}
                    {filteredPeers.map((p) => (
                      <Row
                        key={p.id}
                        avatar={p.name}
                        id={p.id}
                        title={p.name}
                        subtitle={p.online ? "Local mesh · Online" : "Offline"}
                        actions={
                          <>
                            <IconCircle
                              onClick={() => {
                                saveGridNumberToDevice({ name: p.name, peerId: p.id });
                                placeCall(p.id, p.name);
                              }}
                              color={tokens.green}
                            >
                              <Phone size={16} />
                            </IconCircle>
                            <IconCircle
                              onClick={() => {
                                saveGridNumberToDevice({ name: p.name, peerId: p.id });
                                setThread(p.id);
                              }}
                              color={tokens.blue}
                            >
                              <MessageCircle size={16} />
                            </IconCircle>
                            <IconCircle
                              onClick={() => saveGridNumberToDevice({ name: p.name, peerId: p.id })}
                              color={tokens.orange}
                            >
                              <UserPlus size={16} />
                            </IconCircle>
                            <IconCircle onClick={() => blockCaller(p.id, p.name)} color={tokens.red}>
                              <Ban size={16} />
                            </IconCircle>
                          </>
                        }
                      />
                    ))}
                  </CardList>
                )}
              </>
            )}
          </>
        )}

        {(tab === "keypad" || (tab === "logs" && logsSubView === "keypad") || (tab === "mesh" && meshSubView === "keypad")) && (
          <div style={{ padding: "20px 16px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: tokens.secondary, marginBottom: 8, fontWeight: 600 }}>
              Enter number or ID
            </div>
            <div style={{ minHeight: 48, fontSize: 32, fontWeight: 300, letterSpacing: 2, marginBottom: 8, wordBreak: "break-all", color: tokens.text }}>
              {dial || (
                <span style={{ color: tokens.label, fontSize: 15, fontWeight: 500 }}>
                  Type a phone number or user ID
                </span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                title="Paste from clipboard"
                onClick={() => {
                  if (navigator.clipboard?.readText) {
                    navigator.clipboard.readText().then(
                      (text) => { const t = (text || "").trim(); if (t) setDial((p) => p + t); },
                      () => setErr("Clipboard read blocked"),
                    );
                  } else {
                    setErr("Clipboard paste not available in this browser");
                  }
                }}
                style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.blue, borderRadius: 999, padding: "5px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Paste
              </button>
              {dial && (
                <button
                  type="button"
                  title="Copy dialled number"
                  onClick={() => copyTextToClipboard(dial, "Number copied")}
                  style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.label, borderRadius: 999, padding: "5px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  Copy
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, maxWidth: 280, margin: "0 auto" }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                <button key={d} type="button" onClick={() => setDial((p) => p + d)} style={keyStyleOf(tokens)}>
                  {d}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 14 }}>
              {"abcdef_+-".split("").map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDial((p) => p + c)}
                  style={{ ...keyStyleOf(tokens), width: 40, height: 40, fontSize: 15, borderRadius: 20 }}
                >
                  {c}
                </button>
              ))}
            </div>
            {dial.trim() && (
              <button
                type="button"
                onClick={() => openNewContact({ name: dial.trim(), phones: looksLikePhoneNumber(dial) ? [dial.trim()] : [], peerId: !looksLikePhoneNumber(dial) ? dial.trim() : undefined, source: "manual" } as any)}
                style={{ ...contactChipStyle(tokens), marginTop: 12 }}
              >
                <UserPlus size={14} /> Save to contacts
              </button>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setDial((p) => p.slice(0, -1))}
                style={{ border: "none", background: "none", cursor: "pointer", color: tokens.text, padding: 8 }}
              >
                <Delete size={26} strokeWidth={1.75} />
              </button>
            </div>

            <div style={{ marginTop: 12, textAlign: "left", maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: tokens.secondary, marginBottom: 8 }}>
                CALL
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a number or ID");
                    callMeshNetwork(raw, raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: "none",
                    background: tokens.green,
                    color: "#FFFFFF",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Network size={18} strokeWidth={2} />
                  Network call
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a phone number");
                    void callAnyMobile(raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: "none",
                    background: tokens.blue,
                    color: "#FFFFFF",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Phone size={18} strokeWidth={2} />
                  Phone call
                </button>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: tokens.secondary, marginBottom: 8 }}>
                MESSAGE
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a number or ID");
                    msgMeshNetwork(raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: `1px solid ${tokens.sep}`,
                    background: tokens.card,
                    color: tokens.text,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: tokens.shadow,
                  }}
                >
                  <MessageCircle size={18} strokeWidth={2} color={tokens.blue} />
                  Network message
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const raw = dial.trim();
                    if (!raw) return setErr("Enter a phone number");
                    void msgAnyMobile(raw);
                  }}
                  style={{
                    flex: 1,
                    padding: "13px 10px",
                    borderRadius: 14,
                    border: `1px solid ${tokens.sep}`,
                    background: tokens.card,
                    color: tokens.text,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    boxShadow: tokens.shadow,
                  }}
                >
                  <MessageSquare size={18} strokeWidth={2} color={tokens.blue} />
                  Text message
                </button>
              </div>
            </div>

            {/* ─── Contacts & Mesh peers quick-dial ─── */}
            <div style={{ marginTop: 20, textAlign: "left", maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: tokens.label, marginBottom: 10 }}>
                {dial.trim() ? "MATCHING CONTACTS & PEERS" : "QUICK DIAL — ONLINE PEERS"}
              </div>

              {/* Online mesh peers */}
              {peers
                .filter((p) => p.online && !isSelfPeer(p.id) && (
                  !dial.trim() ||
                  (p.name || "").toLowerCase().includes(dial.toLowerCase()) ||
                  (p.phone || "").includes(dial) ||
                  (p.id || "").includes(dial)
                ))
                .slice(0, 6)
                .map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: `0.5px solid ${tokens.sep}` }}>
                    <div style={{ width: 40, height: 40, borderRadius: 20, background: `${tokens.green}20`, color: tokens.green, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                      {initials(p.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: tokens.green, marginTop: 1 }}>● Mesh · Online</div>
                    </div>
                    <button type="button" onClick={() => { setDial(p.id); void placeCallLocal(p.id, p.name); }} style={{ border: "none", background: tokens.green, color: "#041510", borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }} title={`Call ${p.name}`}>
                      <Phone size={16} />
                    </button>
                  </div>
                ))}

              {/* Saved contacts */}
              {filteredContacts
                .filter((c) =>
                  dial.trim()
                    ? (c.name || "").toLowerCase().includes(dial.toLowerCase()) ||
                      (c.phones || []).some((ph) => ph.replace(/\D/g, "").includes(dial.replace(/\D/g, ""))) ||
                      (c.peerId || "").includes(dial)
                    : c.favourite
                )
                .slice(0, dial.trim() ? 8 : 5)
                .map((c) => {
                  const phone = c.phones[0] || c.peerId || "";
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: `0.5px solid ${tokens.sep}` }}>
                      <div style={{ width: 40, height: 40, borderRadius: 20, background: hue(c.id), color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                        {initials(c.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: tokens.label, marginTop: 1 }}>{phone}</div>
                      </div>
                      <button type="button" onClick={() => { if (phone) { setDial(phone); callContact(c); } }} style={{ border: "none", background: tokens.blue, color: "#fff", borderRadius: 999, width: 36, height: 36, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }} title={`Call ${c.name}`}>
                        <Phone size={16} />
                      </button>
                    </div>
                  );
                })}

              {peers.filter((p) => p.online && !isSelfPeer(p.id)).length === 0 &&
                filteredContacts.filter((c) => dial.trim() ? true : c.favourite).length === 0 && (
                <div style={{ fontSize: 13, color: tokens.label, textAlign: "center", padding: "16px 0" }}>
                  {dial.trim() ? "No matching contacts or peers" : "Searching mesh for nearby nodes… Add favourite contacts to see them here"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Contact detail sheet */}
        {contactView && !contactEdit && (
          <ContactSheet onClose={() => setContactView(null)}>
            <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  margin: "0 auto 12px",
                  background: hue(contactView.id),
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  fontWeight: 600,
                }}
              >
                {initials(contactView.name)}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: tokens.text }}>{contactView.name}</div>
              {contactView.company && (
                <div style={{ fontSize: 14, color: tokens.label, marginTop: 4 }}>{contactView.company}</div>
              )}
              <div style={{ fontSize: 12, color: tokens.label, marginTop: 6 }}>
                {[
                  contactView.favourite ? "Favourite" : "",
                  contactView.spam ? "Spam" : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Contact"}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
              <CallBtn label="Call" color={tokens.green} onClick={() => callContact(contactView)}>
                <Phone size={22} />
              </CallBtn>
              <CallBtn label="Message" color={tokens.blue} onClick={() => messageContact(contactView)}>
                <MessageCircle size={22} />
              </CallBtn>
              <CallBtn
                label={contactView.favourite ? "Unstar" : "Star"}
                color={tokens.orange}
                onClick={() => {
                  contactsVault.toggleFavourite(contactView.id);
                  refreshContacts();
                  setContactView(contactsVault.get(contactView.id));
                }}
              >
                {contactView.favourite ? <StarOff size={22} /> : <Star size={22} />}
              </CallBtn>
              {contactView.peerId ? (
                <CallBtn
                  label={blocked.includes(contactView.peerId) ? "Unblock" : "Block"}
                  color={tokens.red}
                  onClick={() => {
                    if (blocked.includes(contactView.peerId!)) unblockCaller(contactView.peerId!);
                    else blockCaller(contactView.peerId!, contactView.name);
                    setContactView(contactsVault.get(contactView.id));
                  }}
                >
                  <Ban size={22} />
                </CallBtn>
              ) : null}
            </div>
            <CardList>
              {contactView.phones.map((p) => (
                <Row
                  key={p}
                  avatar="Ph"
                  id={p}
                  title={p}
                  subtitle="Phone · tap to call"
                  onClick={() => placeCall(p, contactView.name)}
                  actions={
                    <IconCircle onClick={() => placeCall(p, contactView.name)} color={tokens.green}>
                      <Phone size={16} />
                    </IconCircle>
                  }
                />
              ))}
              {contactView.emails.map((e) => (
                <Row key={e} avatar="Em" id={e} title={e} subtitle="Email" />
              ))}
              {contactView.peerId && (
                <Row
                  avatar="Me"
                  id={contactView.peerId}
                  title={contactView.peerId}
                  subtitle="Mesh peer ID"
                  onClick={() => placeCall(contactView.peerId!, contactView.name)}
                />
              )}
              {contactView.notes && (
                <div style={{ padding: "12px 14px", fontSize: 14, color: tokens.secondary }}>
                  <div style={{ fontSize: 12, color: tokens.label, marginBottom: 4 }}>Notes</div>
                  {contactView.notes}
                </div>
              )}
            </CardList>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "16px 4px 8px", justifyContent: "center" }}>
              <button type="button" onClick={() => openEditContact(contactView)} style={contactChipStyle(tokens, true)}>
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  contactsVault.toggleSpam(contactView.id);
                  refreshContacts();
                  setContactView(contactsVault.get(contactView.id));
                }}
                style={contactChipStyle(tokens)}
              >
                <Ban size={14} /> {contactView.spam ? "Not spam" : "Mark spam"}
              </button>
              <button type="button" onClick={() => deleteContact(contactView.id)} style={{ ...contactChipStyle(tokens), color: tokens.red }}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </ContactSheet>
        )}

        {/* Add / Edit contact form */}
        {contactEdit && (
          <ContactSheet onClose={() => setContactEdit(null)} title={contactEdit.id ? "Edit contact" : "New contact"}>
            <ContactField
              label="Name *"
              value={contactEdit.name || ""}
              onChange={(v) => setContactEdit({ ...contactEdit, name: v })}
              placeholder="Full name"
            />
            <ContactField
              label="Phone / GridCaller number"
              value={(contactEdit.phones || [])[0] || ""}
              onChange={(v) =>
                setContactEdit({
                  ...contactEdit,
                  phones: [v, ...((contactEdit.phones || []).slice(1))].filter((x, i) => i === 0 || x),
                })
              }
              placeholder="e.g. 9876543210 (saves on this device)"
            />
            <ContactField
              label="Phone 2"
              value={(contactEdit.phones || [])[1] || ""}
              onChange={(v) => {
                const p0 = (contactEdit.phones || [])[0] || "";
                setContactEdit({ ...contactEdit, phones: [p0, v].filter(Boolean) });
              }}
              placeholder="Optional second number"
            />
            <ContactField
              label="GridCaller ID (mesh id)"
              value={(contactEdit as any).peerId || ""}
              onChange={(v) => setContactEdit({ ...contactEdit, peerId: v } as any)}
              placeholder="user_xxxx — for call, message, and map"
            />
            <ContactField
              label="Email"
              value={(contactEdit.emails || [])[0] || ""}
              onChange={(v) => setContactEdit({ ...contactEdit, emails: v ? [v] : [] })}
              placeholder="name@email.com"
            />
            <ContactField
              label="Company"
              value={contactEdit.company || ""}
              onChange={(v) => setContactEdit({ ...contactEdit, company: v })}
              placeholder="Company"
            />
            <ContactField
              label="Notes"
              value={contactEdit.notes || ""}
              onChange={(v) => setContactEdit({ ...contactEdit, notes: v })}
              placeholder="Notes"
            />
            <ContactField
              label="Mesh peer ID"
              value={contactEdit.peerId || ""}
              onChange={(v) => setContactEdit({ ...contactEdit, peerId: v || undefined })}
              placeholder="Optional mesh ID"
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", fontSize: 14, color: tokens.text, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!contactEdit.favourite}
                onChange={(e) => setContactEdit({ ...contactEdit, favourite: e.target.checked })}
              />
              Favourite
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 12px", fontSize: 14, color: tokens.text, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!contactEdit.spam}
                onChange={(e) => setContactEdit({ ...contactEdit, spam: e.target.checked })}
              />
              Mark as spam
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setContactEdit(null)}
                style={{
                  flex: 1,
                  border: `1px solid ${tokens.sep}`,
                  background: tokens.fill,
                  color: tokens.text,
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveContactForm}
                style={{
                  flex: 1,
                  border: "none",
                  background: tokens.blue,
                  color: "#fff",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          </ContactSheet>
        )}

        {(tab === "sms" || tab === "groups") && (
          <>
            <div style={{ display: tab === "sms" ? "block" : "none" }}>
            <div style={{ padding: "10px 16px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true);
                  setComposeTo("");
                  setSmsDraft("");
                }}
                style={{
                  flex: 1,
                  minWidth: 120,
                  border: `1px solid ${tokens.blue}55`,
                  background: tokens.blue + "18",
                  color: tokens.blue,
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Plus size={16} /> Compose
              </button>
              <button
                type="button"
                onClick={clearAllMessages}
                disabled={sms.length === 0}
                style={{
                  flex: 1,
                  minWidth: 120,
                  border: `1px solid ${tokens.red}55`,
                  background: `${tokens.red}12`,
                  color: tokens.red,
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: sms.length === 0 ? "default" : "pointer",
                  opacity: sms.length === 0 ? 0.45 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Trash2 size={16} /> Clear all
              </button>
            </div>
            <div style={{ padding: "8px 16px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { id: "inbox" as MessageFolder, label: "Inbox" },
                { id: "sent" as MessageFolder, label: "Sent" },
                { id: "received" as MessageFolder, label: "Received" },
                { id: "draft" as MessageFolder, label: "Draft" },
                { id: "outbox" as MessageFolder, label: "Outbox" },
                { id: "deleted" as MessageFolder, label: "Deleted" },
                { id: "trash" as MessageFolder, label: "Trash" },
              ].map((f) => {
                const active = messageFolder === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMessageFolder(f.id)}
                    style={{
                      border: active ? "none" : `1px solid ${tokens.sep}`,
                      background: active ? tokens.blue : tokens.card,
                      color: active ? "#fff" : tokens.text,
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={clearTrashBin}
                style={{
                  border: `1px solid ${tokens.red}55`,
                  background: `${tokens.red}12`,
                  color: tokens.red,
                  borderRadius: 999,
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Empty trash
              </button>
            </div>
            {contactBusy ? (
              <div style={{ padding: "6px 16px 0", fontSize: 12, color: tokens.green, fontWeight: 600 }}>{contactBusy}</div>
            ) : null}
            {smsThreadSelectMode && (
              <div style={{ margin: "8px 12px 0", padding: "8px 10px", borderRadius: 12, border: `1px solid ${tokens.sep}`, background: tokens.fill, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{selectedSmsThreadIds.length} selected</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setSelectedSmsThreadIds(visibleSmsThreadIds)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Select all</button>
                  <button type="button" onClick={() => markSmsThreadsReadState(visibleSmsThreadIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read all</button>
                  <button type="button" onClick={() => markSmsThreadsReadState(visibleSmsThreadIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread all</button>
                  <button type="button" onClick={() => markSmsThreadsReadState(selectedSmsThreadIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read selected</button>
                  <button type="button" onClick={() => markSmsThreadsReadState(selectedSmsThreadIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread selected</button>
                  <button type="button" onClick={deleteSelectedSmsThreads} style={{ ...compactActionBtn(tokens), padding: "5px 9px", color: tokens.red }}>Delete</button>
                  <button type="button" onClick={() => { setSmsThreadSelectMode(false); setSelectedSmsThreadIds([]); }} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Cancel</button>
                </div>
              </div>
            )}
            {composeOpen && (
              <div
                style={{
                  margin: "10px 12px",
                  padding: 14,
                  borderRadius: 14,
                  background: tokens.card,
                  border: `1px solid ${tokens.sep}`,
                  boxShadow: tokens.shadow,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.label, marginBottom: 8 }}>
                  NEW MESSAGE — mesh ID ya mobile number
                </div>
                <input
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="Number, name, or user ID"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border: `1px solid ${tokens.sep}`,
                    background: tokens.inputBg,
                    color: tokens.text,
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    outline: "none",
                    marginBottom: 8,
                  }}
                />
                <textarea
                  value={smsDraft}
                  onChange={(e) => setSmsDraft(e.target.value)}
                  placeholder="Write your message…"
                  rows={3}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    border: `1px solid ${tokens.sep}`,
                    background: tokens.inputBg,
                    color: tokens.text,
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    style={{
                      flex: 1,
                      minWidth: 80,
                      border: `1px solid ${tokens.sep}`,
                      background: "transparent",
                      color: tokens.label,
                      borderRadius: 10,
                      padding: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const to = composeTo.trim();
                      if (!to || !smsDraft.trim()) {
                        setErr("Recipient + message required");
                        return;
                      }
                      const hit =
                        peers.find((p) => p.id === to || p.name.toLowerCase() === to.toLowerCase() || p.id.includes(to)) ||
                        globalPeers.find((p) => p.id === to || p.handle === to || p.name.toLowerCase().includes(to.toLowerCase()));
                      const pid = hit?.id || to;
                      const pname = hit?.name || to;
                      const id = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
                      const draftRow: SmsRow = { id, peerId: pid, name: pname, text: smsDraft.trim(), ts: Date.now(), mine: true, folder: "draft" };
                      setSms((p) => [...p, draftRow]);
                      setMessageFolder("draft");
                      setComposeOpen(false);
                      setSmsDraft("");
                      setComposeTo("");
                      setContactBusy("Draft saved");
                      setTimeout(() => setContactBusy(""), 1500);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 100,
                      border: "none",
                      background: tokens.orange,
                      color: "#fff",
                      borderRadius: 10,
                      padding: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const to = composeTo.trim();
                      if (!to || !smsDraft.trim()) {
                        setErr("Recipient + message required");
                        return;
                      }
                      const hit =
                        peers.find((p) => p.id === to || p.name.toLowerCase() === to.toLowerCase() || p.id.includes(to)) ||
                        globalPeers.find((p) => p.id === to || p.handle === to || p.name.toLowerCase().includes(to.toLowerCase()));
                      const pid = hit?.id || to;
                      const pname = hit?.name || to;
                      sendSms(pid, pname, smsDraft);
                      setThread(pid);
                      setComposeOpen(false);
                      setSmsDraft("");
                      setComposeTo("");
                    }}
                    style={{
                      flex: 1,
                      minWidth: 100,
                      border: "none",
                      background: tokens.green,
                      color: "#041510",
                      borderRadius: 10,
                      padding: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Send mesh
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const to = composeTo.trim();
                      if (!to || !smsDraft.trim()) {
                        setErr("Number + message required");
                        return;
                      }
                      void msgAnyMobile(to, smsDraft.trim());
                      const id = `outbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
                      const outboxRow: SmsRow = { id, peerId: to, name: to, text: smsDraft.trim(), ts: Date.now(), mine: true, folder: "outbox" };
                      setSms((p) => [...p, outboxRow]);
                      setMessageFolder("outbox");
                      setComposeOpen(false);
                      setSmsDraft("");
                      setComposeTo("");
                    }}
                    style={{
                      flex: 1,
                      minWidth: 100,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      borderRadius: 10,
                      padding: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    SMS mobile
                  </button>
                </div>
              </div>
            )}
            <CardList>
              {smsThreads.length === 0 && !composeOpen && (
                <EmptyState title="No messages yet" body="Messages sync over the mesh — stored locally on this device. Tap compose to start a conversation with any mesh peer or phone number." />
              )}
              {smsThreads.map((t) => {
                const threadSelected = selectedSmsThreadIds.includes(t.peerId);
                const threadUnread = sms.some((m) => m.peerId === t.peerId && !m.mine && m.ts > Number(gridchatLastSeen[`d:${t.peerId}`] || 0));
                return (
                <div
                  key={t.peerId}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    runThreadLongPressAction(t.peerId, t.name || t.peerId);
                  }}
                  onClick={() => {
                    if (smsThreadSelectMode) toggleSmsThreadSelection(t.peerId);
                  }}
                  style={{
                    borderBottom: `0.5px solid ${tokens.sep}`,
                    background: smsThreadSelectMode && threadSelected ? `${tokens.blue}14` : tokens.card,
                    padding: "12px 14px",
                    border: smsThreadSelectMode && threadSelected ? `1px solid ${tokens.blue}` : "none",
                    cursor: smsThreadSelectMode ? "pointer" : "default",
                  }}
                >
                  <div
                    onClick={() => setThread(t.peerId)}
                    style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        background: hue(t.peerId || t.name),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 600,
                        fontSize: 15,
                        flexShrink: 0,
                      }}
                    >
                      {initials(t.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text }}>{t.name}</div>
                      <div
                        style={{
                          fontSize: 13,
                          color: tokens.label,
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.text || summarizeGroupAttachment(t.attachment) || "Attachment"}
                      </div>
                      <div style={{ fontSize: 11, color: tokens.label, marginTop: 3, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{fullDateTime(t.ts)}</span>
                        <span style={{ color: threadUnread ? tokens.green : tokens.label, fontWeight: 700 }}>{threadUnread ? "Unread" : "Read"}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setThread(t.peerId)}
                      style={{
                        flex: 1,
                        border: "none",
                        background: `${tokens.blue}18`,
                        color: tokens.blue,
                        borderRadius: 10,
                        padding: "10px 8px",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <MessageCircle size={15} /> Open
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMessageThread(t.peerId)}
                      style={{
                        flex: 1,
                        border: `1px solid ${tokens.red}55`,
                        background: `${tokens.red}12`,
                        color: tokens.red,
                        borderRadius: 10,
                        padding: "10px 8px",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSmsThreadToFolder(t.peerId, "trash")}
                      style={{
                        flex: 1,
                        border: `1px solid ${tokens.orange}55`,
                        background: `${tokens.orange}12`,
                        color: tokens.orange,
                        borderRadius: 10,
                        padding: "10px 8px",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <Trash2 size={15} /> Trash
                    </button>
                  </div>
                </div>
              );})}
            </CardList>
            </div>

            <div style={{ display: tab === "groups" ? "block" : "none" }}>
              <div style={{ background: tokens.bg }}>
                {/* WhatsApp-style top header */}
                <div ref={gridchatHeaderRef} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 6px", position: "relative" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: tokens.green }}>Gridchat</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setGridchatMoreMenuOpen(false);
                        setGridchatCreateMenuOpen((v) => !v);
                      }}
                      style={{
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        display: "grid",
                        placeItems: "center",
                        cursor: "pointer",
                      }}
                      title="New group"
                    >
                      <Plus size={16} />
                    </button>
                    {gridchatCreateMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          right: 44,
                          top: 38,
                          width: "min(86vw, 220px)",
                          border: `1px solid ${tokens.sep}`,
                          background: tokens.card,
                          borderRadius: 10,
                          boxShadow: tokens.shadow,
                          zIndex: 9,
                          overflow: "hidden",
                        }}
                      >
                        {[
                          { id: "new-group", label: "New group chat" },
                          { id: "new-direct", label: "New direct message" },
                          { id: "new-broadcast", label: "New broadcast" },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              if (item.id === "new-group") {
                                openGridchatCreatePanel();
                                return;
                              }
                              setGridchatCreateMenuOpen(false);
                              setGridchatMoreMenuOpen(false);
                              setTab("sms");
                              setThread(null);
                              setComposeTo("");
                              setComposeOpen(true);
                            }}
                            style={{
                              width: "100%",
                              border: "none",
                              borderBottom: `1px solid ${tokens.sep}`,
                              background: tokens.card,
                              color: tokens.text,
                              textAlign: "left",
                              padding: "10px 12px",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setGridchatCreateMenuOpen(false);
                        setGridchatMoreMenuOpen((v) => !v);
                      }}
                      style={{
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        display: "grid",
                        placeItems: "center",
                        cursor: "pointer",
                      }}
                      title="More"
                    >
                      <EllipsisVertical size={16} />
                    </button>
                    {gridchatMoreMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          right: 0,
                          top: 38,
                          width: "min(86vw, 230px)",
                          border: `1px solid ${tokens.sep}`,
                          background: tokens.card,
                          borderRadius: 10,
                          boxShadow: tokens.shadow,
                          zIndex: 9,
                          overflow: "hidden",
                        }}
                      >
                        {[
                          { id: "new-group", label: "Create group" },
                          { id: "status", label: "Status settings" },
                          { id: "mark-read", label: "Mark all as read" },
                          { id: "logs", label: "Open local logs" },
                          { id: "menu", label: "Open main menu" },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setGridchatMoreMenuOpen(false);
                              if (item.id === "new-group") {
                                openGridchatCreatePanel();
                                return;
                              }
                              if (item.id === "status") {
                                setGridchatStatusSettingsOpen(true);
                                return;
                              }
                              if (item.id === "mark-read") {
                                const now = Date.now();
                                setGridchatLastSeen((prev) => {
                                  const next = { ...prev };
                                  for (const row of gridchatItems) next[row.id] = now;
                                  return next;
                                });
                                return;
                              }
                              if (item.id === "logs") {
                                setTab("logs");
                                return;
                              }
                              setMenuView("home");
                              setMenuFullscreen(false);
                              setMenuOpen(true);
                            }}
                            style={{
                              width: "100%",
                              border: "none",
                              borderBottom: `1px solid ${tokens.sep}`,
                              background: tokens.card,
                              color: tokens.text,
                              textAlign: "left",
                              padding: "10px 12px",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, background: tokens.fill, borderRadius: 24, padding: "9px 14px", margin: "4px 16px 2px" }}>
                  <Search size={15} color={tokens.label} />
                  <input
                    value={gridchatSearch}
                    onChange={(e) => setGridchatSearch(e.target.value)}
                    placeholder="Ask Meta AI or Search"
                    style={{ flex: 1, border: "none", background: "transparent", outline: "none", color: tokens.text, fontSize: 14 }}
                  />
                  {gridchatSearch ? <button type="button" onClick={() => setGridchatSearch("")} style={{ border: "none", background: "none", color: tokens.label, cursor: "pointer", padding: 0 }}><X size={14} /></button> : null}
                </div>

                {gridchatSubTab === "chats" && <div style={{ display: "flex", gap: 8, padding: "6px 16px 8px", overflowX: "auto" }}>
                  {[
                    { id: "all" as GridchatFilter, label: "All" },
                    { id: "unread" as GridchatFilter, label: `Unread ${gridchatUnreadTotal > 0 ? gridchatUnreadTotal : ""}`.trim() },
                    { id: "favourites" as GridchatFilter, label: "Favourites" },
                  ].map((chip) => {
                    const active = gridchatFilter === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setGridchatFilter(chip.id)}
                        style={{
                          border: active ? "none" : `1px solid ${tokens.sep}`,
                          background: active ? tokens.green : tokens.card,
                          color: active ? "#fff" : tokens.text,
                          borderRadius: 999,
                          padding: "5px 14px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                  <button type="button" style={{ border: `1px solid ${tokens.sep}`, background: gridchatShowCreateForm ? tokens.green : tokens.card, color: gridchatShowCreateForm ? "#fff" : tokens.text, borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }} onClick={() => setGridchatShowCreateForm(v => !v)}>Groups {gridchatItems.filter(r => r.kind === "group").length}</button>
                  <button type="button" onClick={openGridchatCreatePanel} style={{ border: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, borderRadius: 999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}><Plus size={14} /></button>
                </div>}

                {gridchatSubTab === "updates" && <div style={{ marginTop: 10, position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700 }}>Status</div>
                    <button
                      type="button"
                      onClick={() => setGridchatStatusSettingsOpen((v) => !v)}
                      style={{
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        display: "grid",
                        placeItems: "center",
                        cursor: "pointer",
                      }}
                      title="Status settings"
                    >
                      <EllipsisVertical size={13} />
                    </button>
                  </div>
                  {gridchatStatusSettingsOpen && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 28,
                        width: 236,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.card,
                        borderRadius: 10,
                        boxShadow: tokens.shadow,
                        zIndex: 5,
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={setMyGridchatStatus}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Set my status
                      </button>
                      <button
                        type="button"
                        onClick={applyGridchatStatusTemplate}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Apply template
                      </button>
                      <button
                        type="button"
                        onClick={setGridchatPrivacySetting}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Privacy: {gridchatStatusPrivacy}
                      </button>
                      <button
                        type="button"
                        onClick={setGridchatStatusAutoClear}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Auto-clear: {gridchatStatusAutoClearHours <= 0 ? "off" : `${gridchatStatusAutoClearHours}h`}
                      </button>
                      <button
                        type="button"
                        onClick={setGridchatStatusRing}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Ring color: {gridchatStatusRingColor}
                      </button>
                      <button
                        type="button"
                        onClick={toggleGridchatStatusStealth}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Stealth mode: {gridchatStatusStealthMode ? "on" : "off"}
                      </button>
                      <button
                        type="button"
                        onClick={archiveMyGridchatStatus}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Archive current status
                      </button>
                      <button
                        type="button"
                        onClick={restoreLastArchivedGridchatStatus}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Restore archived ({gridchatStatusArchive.length})
                      </button>
                      <button
                        type="button"
                        onClick={copyMyGridchatStatusLine}
                        style={{ width: "100%", border: "none", borderBottom: `1px solid ${tokens.sep}`, background: tokens.card, color: tokens.text, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Copy status line
                      </button>
                      <button
                        type="button"
                        onClick={clearMyGridchatStatus}
                        style={{ width: "100%", border: "none", background: tokens.card, color: tokens.red, textAlign: "left", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Clear my status
                      </button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                    <button
                      type="button"
                      onClick={setMyGridchatStatus}
                      style={{
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.bg,
                        color: tokens.text,
                        borderRadius: 12,
                        minWidth: 106,
                        maxWidth: 122,
                        padding: "8px 8px 9px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                      }}
                      title={gridchatMyStatusText ? `My status: ${gridchatMyStatusText}` : "Set my status"}
                    >
                      <div style={{ position: "relative" }}>
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            background: gridchatStatusRingColor === "green" ? tokens.green : gridchatStatusRingColor === "orange" ? tokens.orange : gridchatStatusRingColor === "red" ? tokens.red : tokens.blue,
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          <div
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: 21,
                              background: tokens.blue,
                              color: "#fff",
                              display: "grid",
                              placeItems: "center",
                              fontWeight: 800,
                              fontSize: 14,
                            }}
                          >
                            {initials(myName || "Me")}
                          </div>
                        </div>
                        <span
                          style={{
                            position: "absolute",
                            right: -1,
                            bottom: -1,
                            width: 11,
                            height: 11,
                            borderRadius: 999,
                            background: gridchatMyStatusText ? tokens.blue : tokens.label,
                            border: `2px solid ${tokens.card}`,
                          }}
                        />
                      </div>
                      <div style={{ width: "100%", textAlign: "center", fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        My status
                      </div>
                      <div style={{ fontSize: 10, color: tokens.label, fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {gridchatMyStatusText || "Tap to add"}
                      </div>
                    </button>
                    {gridchatStatusUsers.length === 0 ? (
                      <div style={{ fontSize: 12, color: tokens.label }}>No user status yet</div>
                    ) : (
                      gridchatStatusUsers.map((u) => (
                        <button
                          key={`st_${u.id}`}
                          type="button"
                          onClick={() => openStatusViewer(u.id, u.alias)}
                          style={{
                            border: `1px solid ${tokens.sep}`,
                            background: tokens.bg,
                            color: tokens.text,
                            borderRadius: 12,
                            minWidth: 94,
                            maxWidth: 110,
                            padding: "8px 8px 9px",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 5,
                          }}
                          title={u.online ? "Online" : u.lastTs ? `Last active ${timeLabel(u.lastTs)}` : "No activity"}
                        >
                          <div style={{ position: "relative" }}>
                            <div
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: 21,
                                background: hue(u.id),
                                color: "#fff",
                                display: "grid",
                                placeItems: "center",
                                fontWeight: 800,
                                fontSize: 14,
                              }}
                            >
                              {initials(u.alias)}
                            </div>
                            <span
                              style={{
                                position: "absolute",
                                right: -1,
                                bottom: -1,
                                width: 11,
                                height: 11,
                                borderRadius: 999,
                                background: u.online ? tokens.green : tokens.label,
                                border: `2px solid ${tokens.card}`,
                              }}
                            />
                          </div>
                          <div style={{ width: "100%", textAlign: "center", fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.alias}
                          </div>
                          <div style={{ fontSize: 10, color: u.online ? tokens.green : tokens.label, fontWeight: 700 }}>
                            {u.online ? "online" : gridchatStatusStealthMode ? "hidden" : u.lastTs ? "last seen" : "offline"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>}
              </div>

              {gridchatSubTab === "chats" && <>
              {gridchatListSelectMode && (
                <div style={{ margin: "6px 12px 8px", padding: "8px 10px", borderRadius: 12, border: `1px solid ${tokens.sep}`, background: tokens.fill, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{selectedGridchatRowIds.length} selected</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => setSelectedGridchatRowIds(visibleGridchatRowIds)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Select all</button>
                    <button type="button" onClick={() => markGridchatRowsReadState(visibleGridchatRowIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read all</button>
                    <button type="button" onClick={() => markGridchatRowsReadState(visibleGridchatRowIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread all</button>
                    <button type="button" onClick={() => markGridchatRowsReadState(selectedGridchatRowIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read selected</button>
                    <button type="button" onClick={() => markGridchatRowsReadState(selectedGridchatRowIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread selected</button>
                    <button type="button" onClick={deleteSelectedGridchatRows} style={{ ...compactActionBtn(tokens), padding: "5px 9px", color: tokens.red }}>Delete</button>
                    <button type="button" onClick={() => { setGridchatListSelectMode(false); setSelectedGridchatRowIds([]); }} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Cancel</button>
                  </div>
                </div>
              )}
              {/* Archived row - WhatsApp style */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `0.5px solid ${tokens.sep}`, cursor: "pointer" }} onClick={() => {}}>
                <div style={{ width: 46, height: 46, borderRadius: 23, background: tokens.fill, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Download size={18} color={tokens.label} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, color: tokens.text }}>Archived</div>
              </div>
              {/* Floating + FAB */}
              <div style={{ position: "relative" }}>
              <CardList>
                {gridchatItems.length === 0 ? (
                  <EmptyState title="No Gridchat groups yet" body="Groups sync over the mesh with no central server. Create a group to start — members join as they come online." />
                ) : (
                  gridchatItems.map((row) => {
                    const rowSelected = selectedGridchatRowIds.includes(row.id);
                    return (
                    <div
                      key={row.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setGridchatListSelectMode(true);
                        toggleGridchatRowSelection(row.id);
                      }}
                      style={{
                        padding: "12px 14px",
                        borderBottom: `0.5px solid ${tokens.sep}`,
                        background: gridchatListSelectMode && rowSelected ? `${tokens.green}16` : "transparent",
                        borderLeft: gridchatListSelectMode && rowSelected ? `3px solid ${tokens.green}` : "3px solid transparent",
                      }}
                    >
                      <div onClick={() => (gridchatListSelectMode ? toggleGridchatRowSelection(row.id) : openGridchatRow(row))} style={{ display: "flex", gap: 10, cursor: "pointer" }}>
                        <div
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 23,
                            background: row.kind === "group" ? `${tokens.green}28` : hue(row.peerId || row.id),
                            color: row.kind === "group" ? tokens.green : "#fff",
                            fontWeight: 800,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          {row.kind === "group" ? <Users size={18} /> : initials(row.alias)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row.alias}
                            </div>
                            <div style={{ fontSize: 11, color: row.unread ? tokens.green : tokens.label, whiteSpace: "nowrap", fontWeight: row.unread ? 700 : 500 }}>
                              {row.ts ? fullDateTime(row.ts) : "new"}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                            {row.mediaIcon === "photo" ? <ImageIcon size={13} color={tokens.label} /> : null}
                            {row.mediaIcon === "audio" ? <Mic size={13} color={tokens.label} /> : null}
                            {row.mediaIcon === "video" ? <Video size={13} color={tokens.label} /> : null}
                            {row.mediaIcon === "doc" ? <Download size={13} color={tokens.label} /> : null}
                            {row.mediaIcon === "location" ? <MapIcon size={13} color={tokens.label} /> : null}
                            <div style={{ fontSize: 13, color: tokens.label, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row.preview}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 5 }}>
                            <div style={{ fontSize: 11, color: row.online ? tokens.green : tokens.label, fontWeight: 700 }}>
                              {row.memberInfo}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {row.muted ? <BellOff size={13} color={tokens.label} /> : null}
                              {row.unread > 0 ? (
                                <span
                                  style={{
                                    minWidth: 18,
                                    height: 18,
                                    borderRadius: 999,
                                    background: tokens.green,
                                    color: "#032112",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 10,
                                    fontWeight: 800,
                                    padding: "0 6px",
                                  }}
                                >
                                  {row.unread > 99 ? "99+" : row.unread}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={() => openGridchatRow(row)}
                          style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                        >
                          <MessageCircle size={13} /> Open
                        </button>
                        {row.kind === "group" && row.groupId ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void startGroupCall(row.groupId!, "audio")}
                              style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                            >
                              <Phone size={13} /> Call
                            </button>
                            <button
                              type="button"
                              onClick={() => void startGroupCall(row.groupId!, "video")}
                              style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                            >
                              <Video size={13} /> Video
                            </button>
                            <button
                              type="button"
                              onClick={() => shareGroupLocation(row.groupId!)}
                              style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                            >
                              <MapIcon size={13} /> Location
                            </button>
                          </>
                        ) : row.peerId ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void placeCallLocal(row.peerId!, row.name)}
                              style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                            >
                              <Phone size={13} /> Voice
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setComposeOpen(true);
                                setComposeTo(row.peerId!);
                                setTab("sms");
                              }}
                              style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                            >
                              <Pencil size={13} /> Message
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => toggleGridchatFavourite(row.id)}
                          style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                        >
                          {row.favourite ? <Star size={13} fill={tokens.orange} color={tokens.orange} /> : <StarOff size={13} />} {row.favourite ? "Fav" : "Favourite"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleGridchatMuted(row.id)}
                          style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                        >
                          <BellOff size={13} /> {row.muted ? "Unmute" : "Mute"}
                        </button>
                      </div>
                    </div>
                  );})
                )}
              </CardList>

              </div>
              </>}
              {gridchatSubTab === "communities" && (
                <div style={{ padding: "40px 24px", textAlign: "center", color: tokens.label }}>
                  <div style={{ width: 72, height: 72, borderRadius: 36, background: tokens.fill, display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                    <Users size={36} color={tokens.label} />
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: tokens.text }}>No communities yet</div>
                  <div style={{ fontSize: 13, maxWidth: 260, margin: "0 auto 20px" }}>Communities let you organize group chats together. Create one to get started.</div>
                  <button type="button" onClick={openGridchatCreatePanel} style={{ padding: "10px 28px", background: tokens.green, color: "#041510", border: "none", borderRadius: 999, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Create community</button>
                </div>
              )}
              {/* Green floating + FAB */}
              <button
                type="button"
                onClick={openGridchatCreatePanel}
                style={{ position: "absolute", bottom: 16, right: 16, width: 54, height: 54, borderRadius: 14, border: "none", background: tokens.green, color: "#041510", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: `0 4px 16px ${tokens.green}66`, zIndex: 5 }}
                title="New chat"
              >
                <Plus size={22} />
              </button>
              {gridchatShowCreateForm && <div
                ref={gridchatCreatePanelRef}
                style={{
                  margin: "10px 12px",
                  padding: 12,
                  borderRadius: 12,
                  background: tokens.card,
                  border: `1px solid ${tokens.sep}`,
                }}
              >
                <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 8 }}>
                  Create Gridchat group (full stack sync)
                </div>
                <input
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                  placeholder="Group name"
                  style={{ ...settingsInputStyle(tokens), margin: "0 0 8px" }}
                />
                <input
                  value={groupMembersInput}
                  onChange={(e) => setGroupMembersInput(e.target.value)}
                  placeholder="Member IDs / numbers / handles (comma separated)"
                  style={{ ...settingsInputStyle(tokens), margin: 0 }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {peers.slice(0, 10).map((p) => (
                    <button
                      key={`gpick_${p.id}`}
                      type="button"
                      onClick={() => {
                        setGroupMembersInput((prev) => {
                          const add = p.id;
                          const parts = Array.from(new Set(prev.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)));
                          if (!parts.includes(add)) parts.push(add);
                          return parts.join(", ");
                        });
                      }}
                      style={{
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        borderRadius: 999,
                        padding: "5px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      + {gridchatAlias(p.name, p.id)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={createGroupChat}
                  style={{
                    width: "100%",
                    marginTop: 10,
                    border: "none",
                    background: tokens.green,
                    color: "#041510",
                    borderRadius: 10,
                    padding: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Create Gridchat
                </button>
              </div>}

              {activeGroup && (
                <div
                  style={{
                    margin: "10px 12px",
                    padding: 0,
                    borderRadius: 12,
                    background: tokens.card,
                    border: `1px solid ${tokens.sep}`,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.bar, position: "relative" }}>
                    <div>
                      <div style={{ fontWeight: 800, color: tokens.text }}>{activeGroup.name}</div>
                      <div style={{ fontSize: 11, color: tokens.label, marginTop: 2 }}>{activeGroup.members.length} participants</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <button
                        type="button"
                        onClick={() => void startGroupCall(activeGroup.id, "video")}
                        title="Video call"
                        style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <Video size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void startGroupCall(activeGroup.id, "audio")}
                        title="Voice call"
                        style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <Phone size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGroupChatMenuOpen(false);
                          setGroupSearchOpen((v) => !v);
                        }}
                        title="Search"
                        style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <Search size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupChatMenuOpen((v) => !v)}
                        title="More"
                        style={{ border: "none", background: "transparent", color: tokens.text, width: 32, height: 32, borderRadius: 999, display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <EllipsisVertical size={18} />
                      </button>
                      {groupChatMenuOpen && (
                        <div
                          style={{
                            position: "absolute",
                            right: 10,
                            top: 42,
                            width: "min(84vw, 230px)",
                            borderRadius: 12,
                            border: `1px solid ${tokens.sep}`,
                            background: tokens.card,
                            boxShadow: tokens.shadow,
                            zIndex: 8,
                            overflow: "hidden",
                          }}
                        >
                          {[
                            { id: "group-info", label: "Group info" },
                            { id: "search", label: "Search" },
                            { id: "mute", label: "Mute notifications" },
                            { id: "favourite", label: "Add to favourites" },
                            { id: "share-invite", label: "Share invite" },
                            { id: "clear-chat", label: "Clear chat" },
                            { id: "exit-group", label: "Exit group" },
                            { id: "close", label: "Close" },
                          ].map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => runGroupChatMenuAction(item.id, activeGroup.id, activeGroup.name)}
                              style={{
                                width: "100%",
                                border: "none",
                                borderBottom: `1px solid ${tokens.sep}`,
                                background: tokens.card,
                                color: item.id === "exit-group" ? tokens.red : tokens.text,
                                textAlign: "left",
                                padding: "10px 12px",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {groupSearchOpen && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.fill }}>
                      <Search size={14} color={tokens.label} />
                      <input
                        value={groupSearchQuery}
                        onChange={(e) => setGroupSearchQuery(e.target.value)}
                        placeholder="Search in this group"
                        style={{ flex: 1, border: "none", background: "transparent", color: tokens.text, outline: "none", fontSize: 13 }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setGroupSearchQuery("");
                          setGroupSearchOpen(false);
                        }}
                        style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
                      >
                        Close
                      </button>
                    </div>
                  )}
                  {groupShowStarredOnly && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.fill }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>Showing starred in this group</div>
                      <button
                        type="button"
                        onClick={() => setGroupShowStarredOnly(false)}
                        style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
                      >
                        Show all
                      </button>
                    </div>
                  )}
                  {groupSelectMode && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${tokens.sep}`, background: tokens.fill }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text }}>{groupSelectedMessageIds.length} selected</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setGroupSelectedMessageIds(visibleGroupMsgs.map((m) => m.id))}
                          style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setGroupSelectMode(false);
                            setGroupSelectedMessageIds([]);
                          }}
                          style={{ border: "none", background: "transparent", color: tokens.label, fontWeight: 700, cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={copySelectedGroupMessages}
                          style={{ border: "none", background: "transparent", color: tokens.blue, fontWeight: 700, cursor: "pointer" }}
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={deleteSelectedGroupMessages}
                          style={{ border: "none", background: "transparent", color: tokens.red, fontWeight: 700, cursor: "pointer" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      maxHeight: 280,
                      overflowY: "auto",
                      padding: "12px 10px",
                      backgroundColor: tokens.dark ? "#0e0e10" : "#efeae2",
                      backgroundImage:
                        "radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px), radial-gradient(rgba(0,0,0,0.02) 1px, transparent 1px)",
                      backgroundSize: "22px 22px, 44px 44px",
                      backgroundPosition: "0 0, 11px 11px",
                    }}
                  >
                    {visibleGroupMsgs.length === 0 ? (
                      <div style={{ color: tokens.label, fontSize: 12 }}>{groupSearchQuery.trim() || groupShowStarredOnly ? "No matching group messages" : "No group messages yet"}</div>
                    ) : (
                      visibleGroupMsgs.slice(-80).map((m) => {
                        const isStarred = starredMessageIds.includes(m.id);
                        const isSelected = groupSelectedMessageIds.includes(m.id);
                        return (
                        <div key={m.id} style={{ marginBottom: 8, display: "flex", justifyContent: m.mine ? "flex-end" : "flex-start" }}>
                          <div
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setGroupSelectMode(true);
                              toggleGroupMessageSelection(m.id);
                            }}
                            onClick={() => {
                              if (groupSelectMode) toggleGroupMessageSelection(m.id);
                            }}
                            style={{
                              maxWidth: "75%",
                              color: m.mine ? (tokens.dark ? "#e8fff4" : "#111") : tokens.text,
                              fontSize: 13,
                              background: m.mine ? (tokens.dark ? "#144d37" : "#dcf8c6") : tokens.card,
                              border: groupSelectMode && isSelected ? `2px solid ${tokens.blue}` : m.mine ? "none" : `1px solid ${tokens.sep}`,
                              borderRadius: 15,
                              padding: "8px 10px",
                              cursor: groupSelectMode ? "pointer" : "default",
                            }}
                          >
                            <div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!m.system) openChatProfile(m.fromId, m.fromName, "group", activeGroup.id);
                                }}
                                style={{ border: "none", background: "transparent", color: m.mine ? tokens.blue : tokens.green, fontWeight: 800, padding: 0, margin: 0, cursor: m.system ? "default" : "pointer" }}
                                title={m.system ? "System message" : "Open contact info"}
                              >
                                {m.fromName}
                              </button>
                              {m.system ? <span style={{ color: tokens.orange }}> · system</span> : null}: {m.text}
                            </div>
                            {m.attachment?.kind === "location" && m.attachment.lat != null && m.attachment.lng != null ? (
                              <div style={{ fontSize: 12, marginTop: 2 }}>
                                Location: {m.attachment.lat.toFixed(5)}, {m.attachment.lng.toFixed(5)}
                              </div>
                            ) : null}
                            {m.attachment?.dataUrl ? (
                              <div style={{ marginTop: 4 }}>
                                {m.attachment.kind === "image" ? (
                                  <img src={m.attachment.dataUrl} alt={m.attachment.name} style={{ maxWidth: "100%", borderRadius: 8 }} />
                                ) : m.attachment.kind === "audio" ? (
                                  <audio controls src={m.attachment.dataUrl} style={{ width: "100%" }} />
                                ) : m.attachment.kind === "video" ? (
                                  <video controls src={m.attachment.dataUrl} style={{ width: "100%", borderRadius: 8 }} />
                                ) : (
                                  <a href={m.attachment.dataUrl} download={m.attachment.name} style={{ color: m.mine ? "#fff" : tokens.blue, fontWeight: 700 }}>
                                    Download {m.attachment.name}
                                  </a>
                                )}
                              </div>
                            ) : null}
                            <div style={{ fontSize: 10, color: m.mine ? "rgba(255,255,255,0.8)" : tokens.label, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <span>{fullDateTime(m.ts)}</span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <button
                                  type="button"
                                  title={isStarred ? "Unstar" : "Star"}
                                  onClick={() => toggleStarMessage(m.id)}
                                  style={{ border: "none", background: "rgba(0,0,0,0.12)", color: isStarred ? "#ffd54a" : tokens.text, borderRadius: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                                >
                                  {isStarred ? <Star size={12} fill="#ffd54a" color="#ffd54a" /> : <StarOff size={12} />}
                                </button>
                                {m.text ? (
                                  <button
                                    type="button"
                                    title="Copy message"
                                    onClick={() => copyTextToClipboard(m.text, "Message copied")}
                                    style={{ border: "none", background: "rgba(0,0,0,0.12)", color: tokens.text, borderRadius: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700 }}
                                  >
                                    Copy
                                  </button>
                                ) : null}
                                {groupSelectMode ? (
                                  <button
                                    type="button"
                                    title={isSelected ? "Unselect" : "Select"}
                                    onClick={() => toggleGroupMessageSelection(m.id)}
                                    style={{ border: "none", background: "rgba(0,0,0,0.12)", color: tokens.text, borderRadius: 10, padding: "2px 6px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                                  >
                                    {isSelected ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                  </button>
                                ) : null}
                              </span>
                            </div>
                          </div>
                        </div>
                      );})
                    )}
                  </div>
                  <div style={{ position: "relative", padding: "10px 10px 12px", background: tokens.dark ? "#1b1b1f" : "#f0f2f5", borderTop: `1px solid ${tokens.sep}` }}>
                    {groupAttachMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          bottom: 56,
                          width: "min(92vw, 280px)",
                          borderRadius: 14,
                          border: `1px solid ${tokens.sep}`,
                          background: tokens.card,
                          boxShadow: tokens.shadow,
                          zIndex: 3,
                          overflow: "hidden",
                        }}
                      >
                        {[
                          { id: "document" as const, label: "Document", icon: <Download size={16} color={tokens.blue} /> },
                          { id: "photos" as const, label: "Photos & videos", icon: <ImageIcon size={16} color={tokens.green} /> },
                          { id: "camera" as const, label: "Camera", icon: <Camera size={16} color={tokens.red} /> },
                          { id: "audio" as const, label: "Audio", icon: <Mic size={16} color={tokens.orange} /> },
                          { id: "contact" as const, label: "Contact", icon: <IdCard size={16} color={tokens.blue} /> },
                          { id: "poll" as const, label: "Poll", icon: <CheckCircle2 size={16} color={tokens.green} /> },
                          { id: "event" as const, label: "Event", icon: <CalendarDays size={16} color={tokens.orange} /> },
                          { id: "sticker" as const, label: "Sticker", icon: <Sparkles size={16} color={tokens.red} /> },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => runGridchatAttachAction(activeGroup.id, item.id)}
                            style={{
                              width: "100%",
                              border: "none",
                              borderBottom: `1px solid ${tokens.sep}`,
                              background: tokens.card,
                              color: tokens.text,
                              padding: "11px 12px",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              fontWeight: 700,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            {item.icon}
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setGroupChatMenuOpen(false);
                          setGroupAttachMenuOpen((v) => !v);
                        }}
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 999,
                          border: "none",
                          background: tokens.dark ? "#38383d" : "#ffffff",
                          color: tokens.text,
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                        title="Attach"
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => sendGridchatSticker(activeGroup.id)}
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 999,
                          border: "none",
                          background: tokens.dark ? "#38383d" : "#ffffff",
                          color: tokens.text,
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                        title="Sticker"
                      >
                        <Sparkles size={16} />
                      </button>
                      <input
                        value={groupDraft}
                        onChange={(e) => setGroupDraft(e.target.value)}
                        placeholder="Type a message"
                        style={{ ...settingsInputStyle(tokens), margin: 0, flex: 1, borderRadius: 999, boxShadow: "none", background: tokens.dark ? "#2f2f32" : "#ffffff" }}
                        onFocus={() => {
                          setGroupAttachMenuOpen(false);
                          setGroupChatMenuOpen(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && groupDraft.trim()) {
                            sendGroupMessage(activeGroup.id, groupDraft);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (groupDraft.trim()) {
                            sendGroupMessage(activeGroup.id, groupDraft);
                            return;
                          }
                          setErr("Type a message or use + to attach");
                        }}
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 999,
                          border: "none",
                          background: tokens.blue,
                          color: "#fff",
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                        title={groupDraft.trim() ? "Send" : "Voice"}
                      >
                        {groupDraft.trim() ? <MessageCircle size={17} /> : <Mic size={17} />}
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => shareGroupLocation(activeGroup.id)}
                        style={{ ...compactActionBtn(tokens), borderRadius: 999, padding: "6px 10px" }}
                      >
                        <MapIcon size={13} /> Share location
                      </button>
                    </div>
                  </div>

                  <input
                    ref={groupMediaInputRef}
                    type="file"
                    accept="image/*,video/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) shareGroupFile(activeGroup.id, f);
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={groupDocumentInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.json,.xml"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) shareGroupFile(activeGroup.id, f);
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={groupCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) shareGroupFile(activeGroup.id, f);
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={groupAudioInputRef}
                    type="file"
                    accept="audio/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) shareGroupFile(activeGroup.id, f);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom navigation */}
      <div style={{ display: "flex", background: tokens.card, borderTop: `1px solid ${tokens.sep}`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)", position: "relative", zIndex: 150 }}>
        {tab === "groups" ? (
          // WhatsApp-style nav for Gridchat tab
          [{ id: "chats", label: "Chats", icon: <MessageCircle size={22} />, badge: gridchatUnreadTotal > 0 ? gridchatUnreadTotal : 0 },
           { id: "updates", label: "Updates", icon: <Camera size={22} />, dot: true },
           { id: "communities", label: "Communities", icon: <Users size={22} />, badge: 0 },
           { id: "calls", label: "Calls", icon: <Phone size={22} />, badge: 0 }].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "calls") { setMenuOpen(false); setMenuFullscreen(false); setTab("logs"); return; }
                setGridchatSubTab(item.id as any);
              }}
              style={{ flex: 1, border: "none", background: "transparent", padding: "10px 4px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: gridchatSubTab === item.id ? tokens.green : tokens.label, cursor: "pointer", position: "relative" }}
            >
              {item.icon}
              {(item as any).badge > 0 && <span style={{ position: "absolute", top: 6, right: "calc(50% - 18px)", background: tokens.green, color: "#041510", borderRadius: 999, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>{(item as any).badge}</span>}
              {(item as any).dot && gridchatSubTab !== "updates" && <span style={{ position: "absolute", top: 8, right: "calc(50% - 14px)", width: 8, height: 8, borderRadius: 999, background: tokens.green }} />}
              <span style={{ fontSize: 10, fontWeight: gridchatSubTab === item.id ? 700 : 500 }}>{item.label}</span>
            </button>
          ))
        ) : (
          // Regular TrueCaller nav for other tabs
          ([
            { id: "logs" as Tab, label: "Calls", icon: <Phone size={22} /> },
            { id: "sms" as Tab, label: "Messages", icon: <MessageCircle size={22} /> },
            { id: "keypad" as Tab, label: "Dialpad", icon: <Grid3X3 size={22} /> },
            { id: "groups" as Tab, label: "Gridchat", icon: <MessageSquare size={22} /> },
            { id: "mesh" as Tab, label: "Mesh", icon: <Wifi size={22} /> },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (t.id === "radio") { openMenuFeature("radio"); return; }
                setMenuOpen(false);
                setMenuFullscreen(false);
                setTab(t.id as Tab);
                if (t.id === "logs") setLogsSubView("recents");
              }}
              style={{ flex: 1, border: "none", background: "transparent", padding: "10px 4px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: (tab === t.id || (t.id === "radio" && menuOpen && menuView === "radio")) ? tokens.blue : tokens.label, cursor: "pointer" }}
            >
              {t.icon}
              <span style={{ fontSize: 10, fontWeight: (tab === t.id || (t.id === "radio" && menuOpen && menuView === "radio")) ? 700 : 500 }}>{t.label}</span>
            </button>
          ))
        )}
      </div>

      {renderChatProfileOverlay()}
      {renderStatusViewerOverlay()}
      {renderActionComposerOverlay()}

      {/* ═══ Hamburger menu: network people + map + settings ═══ */}
      {menuOpen && (
        <div
          className="gc-overlay"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            background: menuFullscreen ? tokens.bg : "rgba(0,0,0,.45)",
            display: "flex",
            boxSizing: "border-box",
          }}
          onClick={() => {
            if (!menuFullscreen) setMenuOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: menuFullscreen ? "100%" : "min(86%, 340px)",
              maxWidth: "100%",
              height: "100%",
              maxHeight: "100%",
              background: tokens.card,
              borderRight: menuFullscreen ? "none" : `1px solid ${tokens.sep}`,
              display: "flex",
              flexDirection: "column",
              boxShadow: tokens.shadow,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingTop: 14,
                paddingBottom: 12,
                paddingLeft: 14,
                paddingRight: 14,
                flexShrink: 0,
                borderBottom: `1px solid ${tokens.sep}`,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (menuView === "home") {
                    setMenuOpen(false);
                    setMenuFullscreen(false);
                  } else {
                    setMenuView("home");
                    setMenuFullscreen(false);
                  }
                }}
                style={{ border: "none", background: "transparent", color: tokens.blue, cursor: "pointer", padding: 4 }}
              >
                {menuView === "home" ? <X size={22} /> : <ChevronLeft size={22} />}
              </button>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 17, color: tokens.text }}>
                {menuView === "home"
                  ? "Menu"
                  : menuView === "map"
                    ? "Map"
                    : menuView === "radio"
                      ? "Radio"
                      : menuView === "profile"
                        ? "Profile"
                        : menuView === "tower"
                          ? "Network"
                          : menuView === "devices"
                            ? "Devices"
                            : menuView === "share"
                              ? "Share"
                              : menuView === "privacy"
                                ? "Privacy"
                                : menuView === "emergency"
                                  ? "Emergency / Mesh"
                                  : menuView === "logs"
                                    ? "Logs"
                                    : "Settings"}
              </div>
            </div>

            <div className="gc-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: 14 }}>
              {menuView === "home" && (
                <>
                  <div
                    style={{
                      background: tokens.fill,
                      borderRadius: 14,
                      padding: 14,
                      marginBottom: 14,
                      border: `1px solid ${tokens.sep}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <Users size={18} color={tokens.green} />
                      <span style={{ fontWeight: 700, color: tokens.text }}>Mesh nodes online</span>
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: tokens.blue }}>{networkPeopleCount}</div>
                    <div style={{ fontSize: 13, color: tokens.label }}>
                      Local {peers.filter((p) => p.online).length} · Global{" "}
                      {globalPeers.filter((p) => p.online).length}
                      {meshMapPeers.length ? ` · Map ${meshMapPeers.length}` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: networkPeopleCount > 1 ? tokens.green : tokens.orange, marginTop: 6, fontWeight: 700 }}>
                      {networkPeopleCount > 1
                        ? `${networkPeopleCount} nodes in range — call, message, relay`
                        : autoMeshStatus?.trysteroOk || hubStatus.connected
                          ? "Broadcasting identity · listening for peers…"
                          : "Joining swarm mesh · no server needed…"}
                    </div>
                    {(() => {
                      const cd = listConnectedDevices({
                        meshPeers: peers,
                        globalPeers: globalPeers,
                      });
                      return (
                        <div style={{ fontSize: 11, color: tokens.label, marginTop: 6 }}>
                          Devices: {cd.onlineCount} online / {cd.count} total
                          {isPrivacyMode() ? " · Privacy on" : ""}
                          {autoMeshStatus?.trysteroOk ? " · Swarm active" : ""}
                          {hubStatus.connected ? " · Hub active" : ""}
                        </div>
                      );
                    })()}
                    {/* Mesh path indicators */}
                    <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                      {(autoMeshStatus?.trysteroOk || hubStatus.connected) && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${tokens.blue}18`, color: tokens.blue }}>🌐 WebRTC swarm</span>
                      )}
                      {peers.filter((p) => p.online).length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${tokens.green}18`, color: tokens.green }}>📶 LAN mesh</span>
                      )}
                      {hubStatus.connected && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${tokens.orange}18`, color: tokens.orange }}>🖥 Hub relay</span>
                      )}
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: `${tokens.fill}`, color: tokens.label }}>📲 This device = node</span>
                    </div>
                  </div>

                  {(
                    [
                      { id: "home" as const, icon: <Home size={20} color={tokens.blue} />, title: "Home" },
                      {
                        id: "emergency" as const,
                        icon: <Shield size={20} color={isPrivacyMode() ? tokens.green : tokens.orange} />,
                        title: "Emergency / Mesh",
                      },
                      { id: "groupchat" as const, icon: <MessageSquare size={20} color={tokens.blue} />, title: "Gridchat" },
                      { id: "logs" as const, icon: <MessageCircle size={20} color={tokens.orange} />, title: "Logs" },
                      { id: "radio" as const, icon: <Radio size={20} color={tokens.blue} />, title: "Radio" },
                      { id: "share" as const, icon: <Share2 size={20} color={tokens.green} />, title: "Share app" },
                      { id: "devices" as const, icon: <Wifi size={20} color={tokens.blue} />, title: "Devices" },
                      { id: "tower" as const, icon: <Smartphone size={20} color={tokens.blue} />, title: "Network" },
                      { id: "profile" as const, icon: <IdCard size={20} color={tokens.blue} />, title: "Profile" },
                      { id: "map" as const, icon: <MapIcon size={20} color={tokens.blue} />, title: "Map" },
                      { id: "settings" as const, icon: <Settings size={20} color={tokens.orange} />, title: "Settings" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.id === "home") {
                          setTab("logs");
                          setLogsSubView("recents");
                          setMenuOpen(false);
                          setMenuFullscreen(false);
                          return;
                        }
                        if (item.id === "profile") setMyCard(loadMyCard());
                        if (item.id === "settings") setSettingsName(myName);
                        if (item.id === "share") {
                          void getPrimaryApk().then((a) =>
                            setApkInfo(
                              a
                                ? { name: a.file.name, url: a.url, size: a.file.size, verified: a.verified, error: a.error }
                                : null
                            )
                          );
                        }
                        if (item.id === "groupchat") {
                          setTab("groups");
                          setMenuOpen(false);
                          setMenuFullscreen(false);
                          return;
                        }
                        if (item.id === "logs") {
                          setTab("logs");
                          setMenuOpen(false);
                          setMenuFullscreen(false);
                          return;
                        }
                        openMenuFeature(item.id);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "14px 12px",
                        borderRadius: 12,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.bg,
                        color: tokens.text,
                        cursor: "pointer",
                        marginBottom: 8,
                        textAlign: "left",
                      }}
                    >
                      {item.icon}
                      <div style={{ fontWeight: 700 }}>{item.title}</div>
                    </button>
                  ))}

                  <div style={{ marginTop: 16, fontSize: 12, color: tokens.label, lineHeight: 1.45 }}>
                    {myGridDisplay && <div>Number: {myGridDisplay}</div>}
                    {mySerial && <div>Device: {mySerial}</div>}
                    {lanUrl && <div>LAN: {lanUrl}</div>}
                  </div>
                </>
              )}

              {menuView === "emergency" && (
                <>
                  {(() => {
                    const emergencySummary = getEmergencyModeSummary({
                      localOnly: getForceLocalMesh(),
                      privacyOn: isPrivacyMode(),
                      bridgeReady: bridgeStatus.ready,
                      radioOn: freeRadio.enabled,
                      disasterActive: disasterState.active,
                    });
                    return (
                      <div
                        style={{
                          background: `${tokens.blue}14`,
                          border: `1px solid ${tokens.blue}44`,
                          borderRadius: 14,
                          padding: 12,
                          marginBottom: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <Shield size={18} color={tokens.blue} />
                          <b style={{ color: tokens.text }}>{emergencySummary.title}</b>
                        </div>
                        <div style={{ fontSize: 13, color: tokens.secondary, marginBottom: 8 }}>{emergencySummary.subtitle}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {emergencySummary.badges.map((badge) => (
                            <span
                              key={badge}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 999,
                                background: tokens.fill,
                                color: tokens.label,
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              {badge}
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: 12, color: tokens.secondary, lineHeight: 1.5 }}>
                          {emergencySummary.guidance.map((item) => (
                            <div key={item} style={{ marginBottom: 4 }}>
                              • {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div
                    style={{
                      background: tokens.fill,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 12,
                      border: `1px solid ${tokens.sep}`,
                      fontSize: 12,
                      color: tokens.label,
                      lineHeight: 1.45,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: tokens.text, marginBottom: 4 }}>Mode details</div>
                    <div>Mode: {meshModeLabel()}</div>
                    <div>Bridge: {bridgeStatus.text}</div>
                    <div>Radio channel: {freeRadio.channelName}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const next = !getForceLocalMesh();
                      setForceLocalMesh(next);
                      setPrivacyMsg(next ? "Local relay on" : "Local relay off");
                      setTowerTick((n) => n + 1);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: getForceLocalMesh() ? tokens.green : tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {getForceLocalMesh() ? "Disable local relay" : "Enable local relay"}
                  </button>

                  <div
                    style={{
                      background: disasterState.active ? `${tokens.red}22` : tokens.fill,
                      border: `1px solid ${disasterState.active ? tokens.red : tokens.sep}`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800, color: tokens.text, marginBottom: 6 }}>Disaster mode</div>
                    <div style={{ fontSize: 12, color: tokens.secondary, marginBottom: 8 }}>
                      Emergency broadcast, store-and-forward, SOS beacons, and low-bandwidth relay work offline-first.
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = setDisasterMode(!disasterState.active);
                        setDisasterState(next);
                        setPrivacyMsg(next.active ? "Disaster mode on" : "Disaster mode off");
                      }}
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 10,
                        border: "none",
                        background: disasterState.active ? tokens.red : tokens.green,
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                        marginBottom: 8,
                      }}
                    >
                      {disasterState.active ? "Exit disaster mode" : "Enter disaster mode"}
                    </button>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = toggleDisasterBroadcast();
                          setDisasterState((prev) => ({ ...prev, broadcastMode: next }));
                        }}
                        style={{
                          flex: 1,
                          padding: 8,
                          borderRadius: 8,
                          border: `1px solid ${tokens.sep}`,
                          background: disasterState.broadcastMode ? tokens.blue : tokens.fill,
                          color: disasterState.broadcastMode ? "#fff" : tokens.text,
                          fontWeight: 600,
                        }}
                      >
                        {disasterState.broadcastMode ? "Broadcast on" : "Broadcast off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = toggleLowBandwidthMode();
                          setDisasterState((prev) => ({ ...prev, lowBandwidth: next }));
                        }}
                        style={{
                          flex: 1,
                          padding: 8,
                          borderRadius: 8,
                          border: `1px solid ${tokens.sep}`,
                          background: disasterState.lowBandwidth ? tokens.orange : tokens.fill,
                          color: disasterState.lowBandwidth ? "#fff" : tokens.text,
                          fontWeight: 600,
                        }}
                      >
                        {disasterState.lowBandwidth ? "Low-bandwidth on" : "Low-bandwidth off"}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = toggleDisasterBeaconing();
                          setDisasterState((prev) => ({ ...prev, beaconing: next }));
                        }}
                        style={{
                          flex: 1,
                          padding: 8,
                          borderRadius: 8,
                          border: `1px solid ${tokens.sep}`,
                          background: disasterState.beaconing ? tokens.green : tokens.fill,
                          color: disasterState.beaconing ? "#fff" : tokens.text,
                          fontWeight: 600,
                        }}
                      >
                        {disasterState.beaconing ? "SOS beacon on" : "SOS beacon off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const location = myGps ? { lat: myGps.lat, lng: myGps.lng } : null;
                          sendEmergencyBroadcast(`Emergency alert from ${myName}`, location);
                          setPrivacyMsg("Emergency broadcast sent");
                        }}
                        style={{
                          flex: 1,
                          padding: 8,
                          borderRadius: 8,
                          border: "none",
                          background: tokens.red,
                          color: "#fff",
                          fontWeight: 700,
                        }}
                      >
                        Emergency alert
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const location = myGps ? { lat: myGps.lat, lng: myGps.lng } : null;
                        sendSosBeacon(location);
                        setPrivacyMsg("SOS beacon sent");
                      }}
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 8,
                        border: "none",
                        background: tokens.orange,
                        color: "#fff",
                        fontWeight: 700,
                      }}
                    >
                      Send SOS beacon
                    </button>
                    <div style={{ fontSize: 11, color: tokens.label, marginTop: 8 }}>
                      Queue: {disasterState.queueDepth} · Beacon: {disasterState.beaconing ? "on" : "off"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      const next = !isPrivacyMode();
                      await setPrivacyMode(next, myName);
                      setPrivacyMsg(next ? "Privacy on" : "Privacy off");
                      setTowerTick((n) => n + 1);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: isPrivacyMode() ? tokens.green : tokens.orange,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {isPrivacyMode() ? "Turn privacy off" : "Turn privacy on"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void freeRadio.enable(!freeRadio.enabled);
                      setPrivacyMsg(freeRadio.enabled ? "Free radio on" : "Free radio off");
                      setRadioTick((n) => n + 1);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: freeRadio.enabled ? tokens.green : tokens.fill,
                      color: freeRadio.enabled ? "#fff" : tokens.text,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {freeRadio.enabled ? "Free radio on" : "Free radio off"}
                  </button>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => openMenuFeature("radio")}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Open radio
                    </button>
                    <button
                      type="button"
                      onClick={() => openMenuFeature("tower")}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Open network
                    </button>
                  </div>

                  {privacyMsg ? (
                    <div style={{ marginTop: 10, fontSize: 12, color: tokens.green }}>{privacyMsg}</div>
                  ) : null}
                </>
              )}

              {menuView === "logs" && (
                <>
                  <div style={{ marginBottom: 12, padding: 12, borderRadius: 14, background: `${tokens.orange}12`, border: `1px solid ${tokens.orange}44` }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: tokens.text }}>Private device log</div>
                    <div style={{ fontSize: 12, color: tokens.label, marginTop: 4 }}>
                      Stored on this device only. No server required.
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={() => setLogFiltersOpen((prev) => !prev)}
                      style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 12, width: 40, height: 40, display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}
                      title={logFiltersOpen ? "Hide log filters" : "Show log filters"}
                    >
                      <Menu size={18} />
                    </button>
                    <div style={{ fontSize: 12, color: tokens.label }}>
                      Open filters to switch between local device and mesh network call/message logs.
                    </div>
                  </div>
                  {logFiltersOpen ? renderLogFilterPanel() : null}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={refreshLocalLogs}
                      style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={clearLocalLogs}
                      style={{ border: `1px solid ${tokens.red}55`, background: `${tokens.red}12`, color: tokens.red, borderRadius: 999, padding: "8px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      Clear log
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    {[
                      { id: "all" as const, label: `All ${localCommLog.length}` },
                      { id: "calls" as const, label: `Calls ${logStats.calls}` },
                      { id: "messages" as const, label: `Messages ${logStats.messages}` },
                      { id: "blocked" as const, label: `Blocked ${logStats.blocked}` },
                    ].map((item) => {
                      const active = logFilter === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setLogFilter(item.id)}
                          style={{ border: active ? "none" : `1px solid ${tokens.sep}`, background: active ? tokens.blue : tokens.card, color: active ? "#fff" : tokens.text, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  {logsSelectMode ? (
                    <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 10, border: `1px solid ${tokens.sep}`, background: tokens.fill, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: tokens.text, marginRight: 6 }}>{selectedLogIds.length} selected</div>
                      <button type="button" onClick={() => setSelectedLogIds(visibleLogIds)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Select all</button>
                      <button type="button" onClick={() => markLogSeenState(visibleLogIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read all</button>
                      <button type="button" onClick={() => markLogSeenState(visibleLogIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread all</button>
                      <button type="button" onClick={() => markLogSeenState(selectedLogIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read selected</button>
                      <button type="button" onClick={() => markLogSeenState(selectedLogIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread selected</button>
                      <button type="button" onClick={deleteSelectedLogs} style={{ ...compactActionBtn(tokens), padding: "5px 9px", color: tokens.red }}>Delete</button>
                      <button type="button" onClick={() => { setLogsSelectMode(false); setSelectedLogIds([]); }} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Cancel</button>
                    </div>
                  ) : null}
                  {latestLocalCommLog.length === 0 ? (
                    <div style={{ fontSize: 13, color: tokens.label }}>No local logs yet.</div>
                  ) : (
                    renderLogsWithDateSeparators(latestLocalCommLog)
                  )}
                </>
              )}

              {menuView === "share" && (
                <>
                  <div
                    style={{
                      background: tokens.fill,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 12,
                      border: `1px solid ${tokens.sep}`,
                      fontSize: 12,
                      color: tokens.secondary,
                      lineHeight: 1.45,
                    }}
                  >
                    Link: <code style={{ color: tokens.blue }}>{getHubHttp()}</code>
                    <br />
                    {apkInfo ? (
                      <>
                        APK: <b style={{ color: tokens.text }}>{apkInfo.name}</b>
                        {apkInfo.size ? ` · ${Math.round(apkInfo.size / 1024)} KB` : ""}
                        {!apkInfo.verified ? " · unverified" : ""}
                      </>
                    ) : (
                      <>No APK yet. PC: build APK → npm run apk:copy</>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setShareMsg("Opening share…");
                      try {
                        const r = await shareAppViaSystem();
                        setShareMsg(r.ok ? r.message : `❌ ${r.message}`);
                      } catch (e: any) {
                        setShareMsg(`❌ ${e?.message || "Share failed"}`);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 14,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Share APK (Bluetooth / any app)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setShareMsg("Getting Wi‑Fi link…");
                      try {
                        const r = await shareAppWifiLink();
                        setShareMsg(r.message);
                        if (r.url) setApkInfo((a) => ({ name: a?.name || "GridCaller.apk", url: r.url!, size: a?.size, verified: a?.verified, error: a?.error }));
                      } catch (e: any) {
                        setShareMsg(`❌ ${e?.message || "Wi‑Fi link failed"}`);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.green,
                      color: "#041510",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Share via Wi‑Fi (link)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setShareMsg("Opening WhatsApp…");
                      try {
                        const r = await shareAppWhatsApp();
                        setShareMsg(r.message);
                      } catch (e: any) {
                        setShareMsg(`❌ ${e?.message || "WhatsApp failed"}`);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: "#25D366",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setShareMsg("Downloading…");
                      try {
                        const r = await downloadApkNow();
                        setShareMsg(r.ok ? r.message : `❌ ${r.message}`);
                        if (r.url) setApkInfo((a) => ({ name: a?.name || "GridCaller.apk", url: r.url!, size: a?.size, verified: a?.verified, error: a?.error }));
                      } catch (e: any) {
                        setShareMsg(`❌ ${e?.message || "Download failed"}`);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.fill,
                      color: tokens.text,
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Download APK
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                        setShareMsg("Refreshing…");
                      try {
                        const apk = await getPrimaryApk();
                        setApkInfo(apk ? { name: apk.file.name, url: apk.url, size: apk.file.size, verified: apk.verified, error: apk.error } : null);
                        const list = await listApkFiles();
                        const apks = list.filter((f) => f.isApk || f.name.endsWith(".apk"));
                        setShareMsg(
                          apk?.verified && apks.length
                            ? `✅ ${apks.length} APK ready · ${apk?.url || ""}`
                            : `❌ ${apk?.error || `No verified APK on hub yet · ${apk?.url || "hub /share/GridCaller.apk"}`}`
                        );
                      } catch (e: any) {
                        setShareMsg(`❌ ${e?.message || "Refresh failed"}`);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: "transparent",
                      color: tokens.label,
                      fontWeight: 600,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Refresh APK list
                  </button>
                  {shareMsg ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: shareMsg.startsWith("❌") ? tokens.red : tokens.green,
                        marginBottom: 8,
                        lineHeight: 1.45,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {shareMsg}
                    </div>
                  ) : null}
                  {apkInfo?.url ? (
                    <>
                      <a
                        href={apkInfo.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: tokens.blue, wordBreak: "break-all" }}
                      >
                        {apkInfo.url}
                      </a>
                      {!apkInfo.verified && apkInfo.error ? (
                        <div style={{ fontSize: 12, color: tokens.orange, marginTop: 6, lineHeight: 1.4 }}>
                          {apkInfo.error}
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {(() => {
                    const cd = listConnectedDevices({ meshPeers: peers, globalPeers });
                    return (
                      <>
                        <div style={{ fontWeight: 700, marginTop: 16, marginBottom: 8, color: tokens.text }}>
                          Connected ({cd.onlineCount} online)
                        </div>
                        {cd.devices.length <= 1 ? (
                          <div style={{ fontSize: 13, color: tokens.label, lineHeight: 1.45 }}>
                            Only this device for now. When another phone joins the same mesh, it appears here.
                          </div>
                        ) : (
                          cd.devices.map((d) => (
                            <div
                              key={d.kind + d.id}
                              style={{
                                padding: "8px 0",
                                borderBottom: `1px solid ${tokens.sep}`,
                                fontSize: 13,
                                color: tokens.text,
                              }}
                            >
                              {d.online ? "●" : "○"} <b>{d.name}</b>
                              <div style={{ fontSize: 11, color: tokens.label }}>
                                {d.kind}
                                {d.hops != null ? ` · ${d.hops} hop` : ""} · {d.detail}
                              </div>
                            </div>
                          ))
                        )}
                      </>
                    );
                  })()}
                </>
              )}

              {menuView === "privacy" && (
                <>
                  <div
                    style={{
                      background: `${tokens.orange}14`,
                      border: `1px solid ${tokens.orange}44`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 12,
                      fontSize: 12,
                      color: tokens.secondary,
                      lineHeight: 1.5,
                    }}
                  >
                    Status:{" "}
                    <b style={{ color: isPrivacyMode() ? tokens.green : tokens.orange }}>
                      {isPrivacyMode() ? "On" : "Off"}
                    </b>
                    <br />
                    Local only when on. Optional system VPN for full device privacy.
                  </div>
                  {(() => {
                    const st = getPrivacyStatus();
                    return (
                      <div
                        style={{
                          background: tokens.fill,
                          borderRadius: 12,
                          padding: 12,
                          marginBottom: 12,
                          border: `1px solid ${tokens.sep}`,
                          fontSize: 12,
                          color: tokens.label,
                          lineHeight: 1.45,
                        }}
                      >
                        Local: {st.localMesh ? "yes" : "no"} · Cloud: {st.cloudGun ? "yes" : "no"}
                        <br />
                        Radio: {st.radioOn ? st.radioChannel : "off"} · Neighbors: {st.softTowers}
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !isPrivacyMode();
                      await setPrivacyMode(next, myName);
                      setPrivacyMsg(next ? "Privacy on" : "Privacy off");
                      setTowerTick((n) => n + 1);
                    }}
                    style={{
                      width: "100%",
                      padding: 14,
                      borderRadius: 10,
                      border: "none",
                      background: isPrivacyMode() ? tokens.green : tokens.blue,
                      color: "#fff",
                      fontWeight: 800,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    {isPrivacyMode() ? "Turn privacy off" : "Turn privacy on"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      freeRadio.rotateRadioId();
                      setPrivacyMsg(`New ID: ${freeRadio.radioNodeId}`);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.fill,
                      color: tokens.text,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    New radio ID
                  </button>
                  {privacyMsg ? (
                    <div style={{ marginTop: 10, fontSize: 12, color: tokens.green }}>{privacyMsg}</div>
                  ) : null}
                </>
              )}

              {menuView === "devices" && (
                <>
                  {(() => {
                    const cd = listConnectedDevices({
                      meshPeers: peers,
                      globalPeers,
                      includeSavedWifi: true,
                    });
                    const status = getDevicePanelStatus({
                      onlineCount: cd.onlineCount,
                      totalCount: cd.count,
                      strengthScore: networkStrengthReport().score,
                      hubConnected: hubStatus.connected,
                      wifiSaved: listWifi().length,
                      btLinked: listBt().length,
                    });
                    return (
                      <>
                        <div
                          style={{
                            background: `${tokens.green}14`,
                            border: `1px solid ${tokens.green}44`,
                            borderRadius: 12,
                            padding: 12,
                            marginBottom: 12,
                            fontSize: 12,
                            color: tokens.secondary,
                            lineHeight: 1.5,
                          }}
                        >
                          {status.summary}
                        </div>
                        <div style={{ fontWeight: 700, marginBottom: 8, color: tokens.text }}>
                          Connected devices
                        </div>
                        {cd.devices.length <= 1 ? (
                          <div style={{ fontSize: 13, color: tokens.label, marginBottom: 12, lineHeight: 1.45 }}>
                            {autoMeshStatus?.trysteroOk || hubStatus.connected
                              ? "Broadcasting identity · listening for nearby nodes via swarm, LAN, and Bluetooth…"
                              : "Starting mesh discovery · no server needed · searching for nodes…"}
                          </div>
                        ) : (
                          cd.devices.map((d) => (
                            <div
                              key={d.kind + ":" + d.id}
                              style={{
                                padding: "8px 0",
                                borderBottom: `1px solid ${tokens.sep}`,
                                fontSize: 13,
                                color: tokens.text,
                              }}
                            >
                              {d.online ? "●" : "○"} {d.name}
                              <div style={{ fontSize: 11, color: tokens.label }}>
                                {d.kind}
                                {d.hops != null ? ` · hop ${d.hops}` : ""} · {d.detail}
                              </div>
                            </div>
                          ))
                        )}
                        <div style={{ height: 12 }} />
                      </>
                    );
                  })()}

                  {(() => {
                    const r = networkStrengthReport();
                    return (
                      <div
                        style={{
                          background: tokens.fill,
                          borderRadius: 12,
                          padding: 12,
                          marginBottom: 12,
                          border: `1px solid ${tokens.sep}`,
                        }}
                      >
                        <div style={{ fontSize: 12, color: tokens.label }}>Strength</div>
                        <div style={{ fontSize: 32, fontWeight: 800, color: tokens.green }}>{r.score}/100</div>
                        <div style={{ fontSize: 12, color: tokens.secondary, lineHeight: 1.45 }}>
                          Nearby devices are available.
                          <br />
                          Neighbors: {r.softTowers} · {r.hopRange}
                          <br />
                          Peers: {r.fabricPeers} · {(r.fabricLinks || []).join(", ") || "—"}
                          <br />
                          Wi‑Fi saved: {r.wifiSaved} · Bluetooth: {r.btLinked}
                          {r.downlinkMbps != null ? ` · ${r.downlinkMbps} Mbps` : ""}
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ fontWeight: 700, color: tokens.text, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <Bluetooth size={18} color={tokens.blue} /> Bluetooth
                  </div>
                  <button
                    type="button"
                    disabled={deviceBusy}
                    onClick={async () => {
                      setDeviceBusy(true);
                      setDeviceMsg("Waiting for permission…");
                      const r = await connectBluetoothWithPermission();
                      setDeviceBusy(false);
                      setDeviceMsg(
                        r.ok
                          ? `Linked: ${r.name}`
                          : r.error || "Bluetooth connection failed."
                      );
                      setTowerTick((n) => n + 1);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 10,
                    }}
                  >
                    {deviceBusy ? "Scanning…" : "BT accessory (optional)"}
                  </button>
                  <div style={{ fontSize: 11, color: tokens.green, marginBottom: 10, lineHeight: 1.4 }}>
                    Nearby devices can join automatically when permissions are on.
                  </div>
                  {listBt().length === 0 ? (
                    <div style={{ fontSize: 12, color: tokens.label, marginBottom: 12 }}>
                      Optional: link headphones / car kit here. Mesh peers appear under ONLINE automatically.
                    </div>
                  ) : (
                    listBt().map((b) => (
                      <div
                        key={b.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 0",
                          borderBottom: `1px solid ${tokens.sep}`,
                          fontSize: 13,
                        }}
                      >
                        <span style={{ flex: 1, color: tokens.text }}>
                          {b.name}
                          <div style={{ fontSize: 11, color: tokens.label }}>{b.id.slice(0, 16)}</div>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            removeBt(b.id);
                            setTowerTick((n) => n + 1);
                          }}
                          style={{
                            border: "none",
                            background: tokens.fill,
                            color: tokens.red,
                            borderRadius: 8,
                            padding: "6px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}

                  <div
                    style={{
                      fontWeight: 700,
                      color: tokens.text,
                      margin: "16px 0 8px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Wifi size={18} color={tokens.green} /> Wi‑Fi
                  </div>
                  <label style={{ fontSize: 12, color: tokens.label }}>Network name</label>
                  <input
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    placeholder="Wi‑Fi name"
                    style={settingsInputStyle(tokens)}
                  />
                  <label style={{ fontSize: 12, color: tokens.label }}>Password</label>
                  <input
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                    type="password"
                    placeholder="Password"
                    style={settingsInputStyle(tokens)}
                  />
                  <button
                    type="button"
                    disabled={deviceBusy}
                    onClick={async () => {
                      setDeviceBusy(true);
                      const r = await connectWifiWithPassword(wifiSsid, wifiPass);
                      setDeviceBusy(false);
                      setDeviceMsg(r.message);
                      setTowerTick((n) => n + 1);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.green,
                      color: "#041510",
                      fontWeight: 800,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Save and connect
                  </button>
                  <div style={{ fontSize: 11, color: tokens.label, marginBottom: 12, lineHeight: 1.4 }}>
                    Wi‑Fi can be reused for nearby connection and calling.
                  </div>

                  {listWifi().map((w) => (
                    <div
                      key={w.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 0",
                        borderBottom: `1px solid ${tokens.sep}`,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ flex: 1, color: tokens.text }}>
                        {w.ssid} {w.home ? "· home" : ""}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await connectWifiWithPassword(w.ssid, w.password);
                          setDeviceMsg(r.message);
                        }}
                        style={{
                          border: "none",
                          background: tokens.fill,
                          color: tokens.blue,
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeWifi(w.id);
                          setTowerTick((n) => n + 1);
                        }}
                        style={{
                          border: "none",
                          background: tokens.fill,
                          color: tokens.red,
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Del
                      </button>
                    </div>
                  ))}

                  {deviceMsg ? (
                    <div style={{ marginTop: 12, fontSize: 12, color: tokens.green, lineHeight: 1.45 }}>{deviceMsg}</div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => {
                      softTowerHop.start(myName);
                      freeMeshFabric.start(myName);
                      setTowerTick((n) => n + 1);
                      setDeviceMsg("Handshake refreshed — strength score updated.");
                    }}
                    style={{
                      width: "100%",
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.fill,
                      color: tokens.text,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Refresh
                  </button>
                </>
              )}

              {menuView === "tower" && (
                <>
                  {(() => {
                    const h = softTowerHop.getNetworkHealth();
                    let fab: any = null;
                    try {
                      fab = freeMeshFabric.getStats();
                    } catch {}
                    return (
                      <div
                        style={{
                          background: tokens.fill,
                          borderRadius: 12,
                          padding: 12,
                          marginBottom: 12,
                          border: `1px solid ${tokens.sep}`,
                        }}
                      >
                        <div style={{ fontSize: 28, fontWeight: 800, color: tokens.blue }}>{h.softTowers}</div>
                        <div style={{ fontSize: 13, color: tokens.label }}>Devices (you + nearby)</div>
                        <div style={{ fontSize: 12, color: h.softTowers > 1 ? tokens.green : tokens.orange, marginTop: 8, fontWeight: 700 }}>
                          {h.softTowers > 1 ? "Peers in range — relaying mesh traffic" : "This device is a mesh node · searching for peers…"}
                        </div>
                        <div style={{ fontSize: 13, color: tokens.green, marginTop: 6, fontWeight: 600 }}>
                          {h.estimatedRangeLabel}
                        </div>
                        <div style={{ fontSize: 12, color: tokens.label, marginTop: 6 }}>
                          Relayed {h.relayed} · Delivered {h.delivered}
                          {fab ? (
                            <>
                              <br />
                              Links: {(fab.bonded || []).join(", ") || "—"} · Peers {fab.onlinePeers}
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()}
                  <div
                    style={{
                      background: tokens.fill,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 12,
                      border: `1px solid ${tokens.sep}`,
                    }}
                  >
                    <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 6 }}>
                      Mesh proof panel
                    </div>
                    <div style={{ fontSize: 12, color: tokens.text, lineHeight: 1.45 }}>
                      Live peers: {Object.keys(hopDiagnostics.peerRoutes || {}).length}
                      <br />
                      Native bridge: {hopDiagnostics.nativeBridgeStatus || "idle"}
                      {hopDiagnostics.nativeBridgeDetail ? ` · ${hopDiagnostics.nativeBridgeDetail}` : ""}
                      <br />
                      Handshake state: {hopDiagnostics.lastHandshakePeerId ? (hopDiagnostics.lastHandshakePeerName || hopDiagnostics.lastHandshakePeerId) : "none"}
                      <br />
                      Last self-test: {hopDiagnostics.lastSelfTestStatus || "pending"}
                      <br />
                      Last detail: {hopDiagnostics.lastSelfTestDetail || "—"}
                    </div>
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tokens.sep}` }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Peer route history</div>
                      {Object.entries(hopDiagnostics.peerRoutes || {}).length === 0 ? (
                        <div style={{ color: tokens.label }}>No peer routes yet · broadcasting identity on swarm…</div>
                      ) : (
                        Object.entries(hopDiagnostics.peerRoutes || {}).slice(0, 6).map(([peerId, route]) => (
                          <div key={peerId} style={{ color: tokens.label, marginTop: 2 }}>
                            {route.peerName || peerId} · {route.handshakeState} · hops {route.hops} · {route.lastTransport || "—"}
                          </div>
                        ))
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          softTowerHop.probeRelay();
                          const next = softTowerHop.getRuntimeDiagnostics();
                          setHopDiagnostics(next);
                          setContactBusy("Probe broadcast sent");
                          setTimeout(() => setContactBusy(""), 1800);
                        }}
                        style={{
                          flex: 1,
                          padding: 10,
                          borderRadius: 10,
                          border: `1px solid ${tokens.sep}`,
                          background: tokens.blue,
                          color: "#fff",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Probe relay
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const probeId = softTowerHop.probeRelay();
                          const next = softTowerHop.getRuntimeDiagnostics();
                          const status = next.probeReceipts > 0 || next.probeCount > 0 ? "pass" : "fail";
                          softTowerHop.markSelfTestResult(status, `probe ${probeId} emitted`);
                          setHopDiagnostics(softTowerHop.getRuntimeDiagnostics());
                          setContactBusy(status === "pass" ? "Mesh self-test passed" : "Mesh self-test failed");
                          setTimeout(() => setContactBusy(""), 1800);
                        }}
                        style={{
                          flex: 1,
                          padding: 10,
                          borderRadius: 10,
                          border: `1px solid ${tokens.sep}`,
                          background: tokens.green,
                          color: "#041510",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Run mesh self-test
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(hopDiagnostics, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `gridcaller-mesh-proof-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        setContactBusy("Diagnostics exported");
                        setTimeout(() => setContactBusy(""), 1600);
                      }}
                      style={{
                        width: "100%",
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill2,
                        color: tokens.text,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Export diagnostics JSON
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: tokens.label, fontWeight: 600, marginBottom: 6 }}>
                    Nearby
                  </div>
                  {softTowerHop.getPeers().length === 0 ? (
                    <div style={{ fontSize: 13, color: tokens.label }}>
                      No nearby devices.
                    </div>
                  ) : (
                    softTowerHop.getPeers().map((p) => (
                      <div
                        key={p.id}
                        style={{
                          padding: "10px 0",
                          borderBottom: `1px solid ${tokens.sep}`,
                          fontSize: 13,
                          color: tokens.text,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          <Network size={14} strokeWidth={2} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                          {p.name}{" "}
                          <span style={{ fontWeight: 500, color: tokens.label }}>· {p.hops} hop</span>
                        </div>
                        <div style={{ fontSize: 11, color: tokens.label }}>
                          {p.id.slice(0, 18)} · {(p.links || []).join(",")}
                          {p.phone ? ` · ${p.phone}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button
                            type="button"
                            onClick={() => placeCall(p.id, p.name)}
                            style={{
                              border: "none",
                              borderRadius: 8,
                              padding: "5px 10px",
                              fontSize: 11,
                              fontWeight: 700,
                              background: tokens.green,
                              color: "#041510",
                              cursor: "pointer",
                            }}
                          >
                            Call
                          </button>
                          <button
                            type="button"
                            onClick={() => setThread(p.id)}
                            style={{
                              border: "none",
                              borderRadius: 8,
                              padding: "5px 10px",
                              fontSize: 11,
                              fontWeight: 700,
                              background: tokens.blue,
                              color: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            Msg
                          </button>
                          <button
                            type="button"
                            onClick={() => saveGridNumberToDevice({ name: p.name, peerId: p.id, phone: p.phone })}
                            style={{
                              border: "none",
                              borderRadius: 8,
                              padding: "5px 10px",
                              fontSize: 11,
                              fontWeight: 700,
                              background: tokens.fill,
                              color: tokens.text,
                              cursor: "pointer",
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      softTowerHop.start(myName);
                      freeMeshFabric.start(myName);
                      setTowerTick((n) => n + 1);
                      setContactBusy("Towers re-handshake…");
                      setTimeout(() => setContactBusy(""), 2000);
                    }}
                    style={{
                      width: "100%",
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Refresh connections
                  </button>
                </>
              )}

              {menuView === "profile" && (
                <>
                  <div
                    style={{
                      textAlign: "center",
                      padding: 16,
                      borderRadius: 16,
                      background: tokens.fill,
                      border: `1px solid ${tokens.sep}`,
                      marginBottom: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 96,
                        height: 96,
                        borderRadius: 48,
                        margin: "0 auto 12px",
                        background: myCard.photoDataUrl
                          ? `url(${myCard.photoDataUrl}) center/cover`
                          : hue(myCard.gridCallerId || myCard.id),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 32,
                        fontWeight: 700,
                        boxShadow: tokens.shadow,
                      }}
                    >
                      {!myCard.photoDataUrl ? initials(myCard.name) : null}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: tokens.text }}>{myCard.name || "Your name"}</div>
                    {myCard.title ? (
                      <div style={{ fontSize: 14, color: tokens.label, marginTop: 4 }}>{myCard.title}</div>
                    ) : null}
                    {myCard.company ? (
                      <div style={{ fontSize: 13, color: tokens.secondary, marginTop: 2 }}>{myCard.company}</div>
                    ) : null}
                    {(myCard.displayNumber || myCard.phone) && (
                      <div style={{ fontSize: 15, color: tokens.blue, marginTop: 8, fontWeight: 600 }}>
                        {myCard.displayNumber || myCard.phone}
                      </div>
                    )}
                    {myCard.gridCallerId ? (
                      <div style={{ fontSize: 11, color: tokens.label, marginTop: 6 }}>
                        ID: {myCard.gridCallerId}
                      </div>
                    ) : null}
                    {myCard.bio ? (
                      <div style={{ fontSize: 13, color: tokens.secondary, marginTop: 10, lineHeight: 1.4 }}>
                        {myCard.bio}
                      </div>
                    ) : null}
                  </div>

                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void compressImageFile(f)
                        .then((dataUrl) => {
                          const next = saveMyCard({ ...myCard, photoDataUrl: dataUrl });
                          setMyCard(next);
                          setCardMsg("Photo saved on card");
                          setTimeout(() => setCardMsg(""), 2000);
                        })
                        .catch(() => setErr("Photo compress failed"));
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.fill,
                      color: tokens.text,
                      fontWeight: 600,
                      cursor: "pointer",
                      marginBottom: 12,
                    }}
                  >
                    <ImageIcon size={18} /> {myCard.photoDataUrl ? "Change photo" : "Add photo"}
                  </button>

                  <ContactField
                    label="Full name"
                    value={myCard.name}
                    onChange={(v) => setMyCard({ ...myCard, name: v })}
                    placeholder="Your name"
                  />
                  <ContactField
                    label="Title / role"
                    value={myCard.title || ""}
                    onChange={(v) => setMyCard({ ...myCard, title: v })}
                    placeholder="e.g. Founder · Doctor · Volunteer"
                  />
                  <ContactField
                    label="Company / org"
                    value={myCard.company || ""}
                    onChange={(v) => setMyCard({ ...myCard, company: v })}
                    placeholder="Optional"
                  />
                  <ContactField
                    label="Phone"
                    value={myCard.phone || ""}
                    onChange={(v) => setMyCard({ ...myCard, phone: v })}
                    placeholder="Your number"
                  />
                  <ContactField
                    label="Display number on card"
                    value={myCard.displayNumber || ""}
                    onChange={(v) => setMyCard({ ...myCard, displayNumber: v })}
                    placeholder="+91 …"
                  />
                  <ContactField
                    label="Email"
                    value={myCard.email || ""}
                    onChange={(v) => setMyCard({ ...myCard, email: v })}
                    placeholder="you@email.com"
                  />
                  <ContactField
                    label="Website"
                    value={myCard.website || ""}
                    onChange={(v) => setMyCard({ ...myCard, website: v })}
                    placeholder="https://"
                  />
                  <ContactField
                    label="GridCaller ID"
                    value={myCard.gridCallerId || ""}
                    onChange={(v) => setMyCard({ ...myCard, gridCallerId: v })}
                    placeholder="mesh id"
                  />
                  <ContactField
                    label="Bio / note"
                    value={myCard.bio || ""}
                    onChange={(v) => setMyCard({ ...myCard, bio: v })}
                    placeholder="Short about you…"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      const next = saveMyCard({
                        ...myCard,
                        gridCallerId: myCard.gridCallerId || MeshEngine.localId,
                      });
                      setMyCard(next);
                      setCardMsg("Card saved on this device");
                      setTimeout(() => setCardMsg(""), 2000);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 10,
                    }}
                  >
                    Save my card
                  </button>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const card = saveMyCard(myCard);
                        setMyCard(card);
                        shareCardOnGridNetwork(card);
                        setCardMsg("Shared on GridCaller network");
                        setTimeout(() => setCardMsg(""), 2500);
                      }}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        border: "none",
                        background: tokens.green,
                        color: "#041510",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <Share2 size={16} /> Share on Grid network
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const card = saveMyCard(myCard);
                        setMyCard(card);
                        shareCardWhatsApp(card);
                      }}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: "#25D366",
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Share on WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const card = saveMyCard(myCard);
                        setMyCard(card);
                        const how = await shareCardAnywhere(card);
                        setCardMsg(
                          how === "share"
                            ? "Opened system share"
                            : how === "clipboard"
                              ? "Card text copied"
                              : "Card file downloaded"
                        );
                        setTimeout(() => setCardMsg(""), 2500);
                      }}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Share anywhere (BT / apps / copy)
                    </button>
                  </div>
                  {cardMsg ? (
                    <div style={{ fontSize: 12, color: tokens.green, marginBottom: 10 }}>{cardMsg}</div>
                  ) : null}

                  <div style={{ fontSize: 12, color: tokens.label, fontWeight: 600, marginBottom: 6 }}>
                    Cards received ({cardInbox.length})
                  </div>
                  {cardInbox.length === 0 ? (
                    <div style={{ fontSize: 13, color: tokens.label }}>Cards received over mesh will appear here to save.</div>
                  ) : (
                    <>
                      {cardInbox.slice(0, 20).map((c) => (
                        <div
                          key={c.id + String(c.updatedAt)}
                          style={{
                            display: "flex",
                            gap: 10,
                            padding: "10px 0",
                            borderBottom: `1px solid ${tokens.sep}`,
                            alignItems: "center",
                          }}
                        >
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 22,
                              flexShrink: 0,
                              background: c.photoDataUrl
                                ? `url(${c.photoDataUrl}) center/cover`
                                : hue(c.id),
                              color: "#fff",
                              display: "grid",
                              placeItems: "center",
                              fontWeight: 700,
                              fontSize: 14,
                            }}
                          >
                            {!c.photoDataUrl ? initials(c.name) : null}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: tokens.text }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: tokens.label }}>
                              {c.phone || c.displayNumber || c.gridCallerId || c.title || "Card"}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              contactsVault.upsert({
                                name: c.name,
                                phones: [c.phone, c.displayNumber].filter(Boolean) as string[],
                                emails: c.email ? [c.email] : [],
                                company: c.company,
                                notes: [c.title, c.bio, c.website].filter(Boolean).join(" · "),
                                peerId: c.gridCallerId,
                                source: "mesh",
                              });
                              refreshContacts();
                              setCardMsg(`Saved ${c.name} to contacts`);
                              setTimeout(() => setCardMsg(""), 2000);
                            }}
                            style={{
                              border: "none",
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 11,
                              fontWeight: 700,
                              background: tokens.blue,
                              color: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            Save
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          clearInbox();
                          setCardInbox([]);
                        }}
                        style={{
                          marginTop: 8,
                          width: "100%",
                          padding: 10,
                          borderRadius: 10,
                          border: `1px solid ${tokens.sep}`,
                          background: "transparent",
                          color: tokens.label,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        Clear received cards
                      </button>
                    </>
                  )}
                </>
              )}

              {menuView === "radio" && (
                <>
                  <div
                    style={{
                      background: `${tokens.green}14`,
                      border: `1px solid ${tokens.green}44`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 12,
                      fontSize: 12,
                      color: tokens.secondary,
                      lineHeight: 1.5,
                    }}
                  >
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setRadioSideTab("radio")}
                      style={{
                        flex: 1,
                        padding: "9px 10px",
                        borderRadius: 999,
                        border: `1px solid ${tokens.sep}`,
                        background: radioSideTab === "radio" ? tokens.blue : tokens.fill,
                        color: radioSideTab === "radio" ? "#fff" : tokens.text,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Radio
                    </button>
                    <button
                      type="button"
                      onClick={() => setRadioSideTab("radar")}
                      style={{
                        flex: 1,
                        padding: "9px 10px",
                        borderRadius: 999,
                        border: `1px solid ${tokens.sep}`,
                        background: radioSideTab === "radar" ? tokens.green : tokens.fill,
                        color: radioSideTab === "radar" ? "#04200f" : tokens.text,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Nearby radar
                    </button>
                  </div>

                  {radioSideTab === "radio" ? (
                    <>

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => setRadioPanelTab("channels")}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: `1px solid ${tokens.sep}`,
                        background: radioPanelTab === "channels" ? tokens.blue : tokens.fill,
                        color: radioPanelTab === "channels" ? "#fff" : tokens.text,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Channel list
                    </button>
                    <button
                      type="button"
                      onClick={() => setRadioPanelTab("groups")}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 999,
                        border: `1px solid ${tokens.sep}`,
                        background: radioPanelTab === "groups" ? tokens.green : tokens.fill,
                        color: radioPanelTab === "groups" ? "#04200f" : tokens.text,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Channel groups
                    </button>
                  </div>

                  {radioPanelTab === "channels" ? (
                    <>
                      <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>Channel</label>
                      <input
                        value={radioChannel}
                        onChange={(e) => setRadioChannel(e.target.value)}
                        placeholder="Channel name"
                        style={settingsInputStyle(tokens)}
                      />
                      <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>
                        Password
                      </label>
                      <input
                        value={radioSecret}
                        onChange={(e) => setRadioSecret(e.target.value)}
                        placeholder="Channel password"
                        type="password"
                        style={settingsInputStyle(tokens)}
                      />
                      <button
                        type="button"
                        onClick={() => joinRadioChannel(radioChannel, radioSecret)}
                        style={{
                          width: "100%",
                          padding: 12,
                          borderRadius: 10,
                          border: "none",
                          background: tokens.green,
                          color: "#041510",
                          fontWeight: 800,
                          cursor: "pointer",
                          marginBottom: 10,
                        }}
                      >
                        Join channel
                      </button>
                      {idSaveMsg ? (
                        <div style={{ fontSize: 12, color: tokens.green, marginBottom: 10 }}>{idSaveMsg}</div>
                      ) : null}

                      <div
                        style={{
                          border: `1px solid ${tokens.sep}`,
                          borderRadius: 12,
                          padding: 10,
                          marginBottom: 12,
                          background: tokens.fill,
                        }}
                      >
                        <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 8 }}>
                          Serial channel list (tap to join)
                        </div>
                        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                          {radioChannels.map((ch, idx) => {
                            const active = ch === freeRadio.channelName && freeRadio.enabled;
                            return (
                              <button
                                key={ch}
                                type="button"
                                onClick={() => joinRadioChannel(ch, radioSecret)}
                                style={{
                                  border: `1px solid ${tokens.sep}`,
                                  borderRadius: 10,
                                  padding: "8px 10px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  background: active ? tokens.green : tokens.bg,
                                  color: active ? "#041510" : tokens.text,
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                              >
                                {idx + 1}. {ch}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              void freeRadio.enable(false);
                              setIdSaveMsg("Channel exited");
                            }}
                            style={{
                              flex: 1,
                              padding: 9,
                              borderRadius: 10,
                              border: `1px solid ${tokens.sep}`,
                              background: tokens.bg,
                              color: tokens.red,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Exit channel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuView("home");
                              setMenuFullscreen(false);
                              setRadioSideTab("radio");
                            }}
                            style={{
                              flex: 1,
                              padding: 9,
                              borderRadius: 10,
                              border: `1px solid ${tokens.sep}`,
                              background: tokens.bg,
                              color: tokens.text,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Back to menu
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          border: `1px solid ${tokens.sep}`,
                          borderRadius: 12,
                          padding: 10,
                          marginBottom: 12,
                          background: tokens.fill,
                        }}
                      >
                        <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 8 }}>
                          Create new group
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            value={radioGroupName}
                            onChange={(e) => setRadioGroupName(e.target.value)}
                            placeholder="Group name"
                            style={{ ...settingsInputStyle(tokens), margin: 0, flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={createRadioGroup}
                            style={{
                              padding: "0 12px",
                              borderRadius: 10,
                              border: "none",
                              background: tokens.green,
                              color: "#041510",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          border: `1px solid ${tokens.sep}`,
                          borderRadius: 12,
                          padding: 10,
                          marginBottom: 12,
                          background: tokens.fill,
                        }}
                      >
                        <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 8 }}>
                          Add channel to selected group
                        </div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                          {radioGroups.map((g, idx) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => setSelectedRadioGroupId(g.id)}
                              style={{
                                border: `1px solid ${tokens.sep}`,
                                borderRadius: 999,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: 700,
                                background: selectedRadioGroupId === g.id ? tokens.blue : tokens.bg,
                                color: selectedRadioGroupId === g.id ? "#fff" : tokens.text,
                                cursor: "pointer",
                              }}
                            >
                              {idx + 1}. {g.name}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input
                            value={radioGroupChannelInput}
                            onChange={(e) => setRadioGroupChannelInput(e.target.value)}
                            placeholder="Channel name"
                            style={{ ...settingsInputStyle(tokens), margin: 0, flex: 1 }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!selectedRadioGroupId) {
                                setErr("Select a group first");
                                return;
                              }
                              addChannelToGroup(selectedRadioGroupId, radioGroupChannelInput || radioChannel);
                            }}
                            style={{
                              padding: "0 12px",
                              borderRadius: 10,
                              border: "none",
                              background: tokens.blue,
                              color: "#fff",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Add channel
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 8 }}>
                        Grouped channel workflow
                      </div>
                      {radioGroups.map((g, gIdx) => (
                        <div
                          key={g.id}
                          style={{
                            border: `1px solid ${tokens.sep}`,
                            borderRadius: 12,
                            padding: 10,
                            marginBottom: 10,
                            background: tokens.fill,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                            <div style={{ fontSize: 13, color: tokens.text, fontWeight: 800 }}>
                              {gIdx + 1}. {g.name}
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteRadioGroup(g.id)}
                              style={{
                                border: `1px solid ${tokens.sep}`,
                                borderRadius: 8,
                                background: tokens.bg,
                                color: tokens.red,
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "4px 8px",
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                          {g.channels.length === 0 ? (
                            <div style={{ fontSize: 12, color: tokens.label }}>No channels in this group.</div>
                          ) : (
                            g.channels.map((ch, chIdx) => {
                              const active = freeRadio.enabled && freeRadio.channelName === ch;
                              return (
                                <div
                                  key={`${g.id}_${ch}`}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    padding: "6px 0",
                                    borderTop: `1px solid ${tokens.sep}`,
                                  }}
                                >
                                  <div style={{ fontSize: 12, color: tokens.text }}>
                                    {chIdx + 1}. {ch}
                                  </div>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      type="button"
                                      onClick={() => joinRadioChannel(ch, radioSecret)}
                                      style={{
                                        border: "none",
                                        borderRadius: 8,
                                        background: active ? tokens.green : tokens.blue,
                                        color: active ? "#041510" : "#fff",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: "5px 8px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      {active ? "Joined" : "Join"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeChannelFromGroup(g.id, ch)}
                                      style={{
                                        border: `1px solid ${tokens.sep}`,
                                        borderRadius: 8,
                                        background: tokens.bg,
                                        color: tokens.red,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: "5px 8px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const id = freeRadio.rotateRadioId();
                        setIdSaveMsg(`New ID: ${id}`);
                      }}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      New ID
                    </button>
                    <button
                      type="button"
                      onClick={() => void freeRadio.enable(!freeRadio.enabled)}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: "none",
                        background: freeRadio.enabled ? tokens.blue : tokens.fill,
                        color: freeRadio.enabled ? "#fff" : tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      {freeRadio.enabled ? "Radio on" : "Radio off"}
                    </button>
                  </div>

                  <div style={{ fontSize: 12, color: tokens.label, marginBottom: 6 }}>
                    On channel · {freeRadio.peerList.filter((p) => p.live).length}
                  </div>
                  {freeRadio.peerList.slice(0, 12).map((p) => (
                    <div
                      key={p.id}
                      style={{
                        fontSize: 13,
                        padding: "6px 0",
                        borderBottom: `1px solid ${tokens.sep}`,
                        color: tokens.text,
                      }}
                    >
                      {p.live ? "●" : "○"} {p.name}{" "}
                      <span style={{ color: tokens.label, fontSize: 11 }}>{p.id.slice(0, 14)}</span>
                    </div>
                  ))}

                  <div style={{ marginTop: 14, fontSize: 12, color: tokens.label, fontWeight: 600 }}>
                    Messages
                  </div>
                  <div
                    style={{
                      maxHeight: 120,
                      overflowY: "auto",
                      margin: "6px 0 8px",
                      padding: 8,
                      background: tokens.fill,
                      borderRadius: 10,
                      fontSize: 13,
                    }}
                  >
                    {(() => {
                      const radioVisibleMessages = freeRadio.messages.filter((m) => !hiddenRadioMessageIds.includes(m.id)).slice(-30);
                      if (!radioVisibleMessages.length) return <span style={{ color: tokens.label }}>No messages</span>;
                      return (
                        <>
                          {radioSelectMode ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                              <button type="button" onClick={() => setSelectedRadioMessageIds(radioVisibleMessages.map((m) => m.id))} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Select all</button>
                              <button type="button" onClick={() => markRadioMessagesReadState(radioVisibleMessages.map((m) => m.id), true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read all</button>
                              <button type="button" onClick={() => markRadioMessagesReadState(radioVisibleMessages.map((m) => m.id), false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread all</button>
                              <button type="button" onClick={() => markRadioMessagesReadState(selectedRadioMessageIds, true)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Read selected</button>
                              <button type="button" onClick={() => markRadioMessagesReadState(selectedRadioMessageIds, false)} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Unread selected</button>
                              <button type="button" onClick={hideSelectedRadioMessages} style={{ ...compactActionBtn(tokens), padding: "5px 9px", color: tokens.red }}>Delete</button>
                              <button type="button" onClick={() => { setRadioSelectMode(false); setSelectedRadioMessageIds([]); }} style={{ ...compactActionBtn(tokens), padding: "5px 9px" }}>Cancel</button>
                            </div>
                          ) : null}
                          {radioVisibleMessages.map((m) => {
                            const isSelected = selectedRadioMessageIds.includes(m.id);
                            const isRead = !!radioMessageReadState[m.id];
                            return (
                              <div
                                key={m.id}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setRadioSelectMode(true);
                                  toggleRadioMessageSelection(m.id);
                                }}
                                onClick={() => {
                                  if (radioSelectMode) toggleRadioMessageSelection(m.id);
                                }}
                                style={{ marginBottom: 6, color: tokens.text, padding: "4px 6px", borderRadius: 8, border: radioSelectMode && isSelected ? `1px solid ${tokens.blue}` : "1px solid transparent", background: radioSelectMode && isSelected ? `${tokens.blue}14` : "transparent", cursor: radioSelectMode ? "pointer" : "default" }}
                              >
                                <b style={{ color: tokens.blue }}>{m.fromName}</b>: {m.text}
                                <div style={{ fontSize: 10, color: tokens.label, display: "flex", alignItems: "center", gap: 8 }}>
                                  <span>{fullDateTime(m.ts)}</span>
                                  <span style={{ color: isRead ? tokens.label : tokens.orange, fontWeight: 700 }}>{isRead ? "Read" : "Unread"}</span>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={radioText}
                      onChange={(e) => setRadioText(e.target.value)}
                      placeholder="Radio message…"
                      style={{ ...settingsInputStyle(tokens), margin: 0, flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && radioText.trim()) {
                          void freeRadio.sendText(radioText);
                          setRadioText("");
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void freeRadio.sendText(radioText);
                        setRadioText("");
                      }}
                      style={{
                        padding: "0 14px",
                        borderRadius: 10,
                        border: "none",
                        background: tokens.blue,
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Send
                    </button>
                  </div>

                  <button
                    type="button"
                    onMouseDown={() => {
                      setPttOn(true);
                      void freeRadio.pttStart().catch((e) => {
                        setErr(e?.message || "Microphone access is required for push-to-talk.");
                        setPttOn(false);
                      });
                    }}
                    onMouseUp={() => {
                      setPttOn(false);
                      void freeRadio.pttStop();
                    }}
                    onMouseLeave={() => {
                      if (pttOn) {
                        setPttOn(false);
                        void freeRadio.pttStop();
                      }
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      setPttOn(true);
                      void freeRadio.pttStart().catch((err) => {
                        setErr(err?.message || "Microphone access is required for push-to-talk.");
                        setPttOn(false);
                      });
                    }}
                    onTouchEnd={() => {
                      setPttOn(false);
                      void freeRadio.pttStop();
                    }}
                    style={{
                      width: "100%",
                      marginTop: 14,
                      padding: 18,
                      borderRadius: 14,
                      border: "none",
                      background: pttOn ? tokens.red : tokens.green,
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 16,
                      cursor: "pointer",
                    }}
                  >
                    {pttOn ? "Talking… release" : "Hold to talk"}
                  </button>
                  <div style={{ fontSize: 11, color: tokens.label, marginTop: 8, lineHeight: 1.4 }}>
                    ID: <code>{freeRadio.radioNodeId}</code>
                  </div>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const graphUsers = meshVisibleUsers.slice(0, 24);
                        const graphNodes = buildMeshGraphNodes(graphUsers);
                        const liveRadarPeers = radarPeers.slice(0, 40);
                        const farthest = myGps
                          ? liveRadarPeers.reduce((max, p) => Math.max(max, calcDistanceMeters(myGps, p)), 0)
                          : 0;
                        const radarRange = Math.max(200, Math.min(5000, Math.ceil(farthest / 100) * 100 || 300));
                        return (
                          <>
                            <div
                              style={{
                                fontSize: 12,
                                color: tokens.label,
                                marginBottom: 8,
                                lineHeight: 1.45,
                              }}
                            >
                              {myGps
                                ? `Mesh users visible: ${meshVisibleUsers.length} · live GPS: ${liveRadarPeers.length} · range ${radarRange}m`
                                : `Mesh users visible: ${meshVisibleUsers.length} · enable location for live movement radar.`}
                            </div>

                            <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 6 }}>
                              Mesh contact graph
                            </div>

                            <div
                              style={{
                                position: "relative",
                                width: "100%",
                                aspectRatio: "1 / 1",
                                maxHeight: 280,
                                borderRadius: 14,
                                border: `1px solid ${tokens.sep}`,
                                background: `radial-gradient(circle at center, ${tokens.fill}, ${tokens.bg})`,
                                overflow: "hidden",
                                marginBottom: 12,
                              }}
                            >
                              <svg
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                              >
                                {graphNodes.map((node) => (
                                  <line
                                    key={`graph-link-${node.id}`}
                                    x1="50"
                                    y1="50"
                                    x2={node.xPct}
                                    y2={node.yPct}
                                    stroke={node.online ? tokens.green : tokens.label}
                                    strokeOpacity={node.online ? 0.45 : 0.2}
                                    strokeDasharray={node.hasLiveLocation ? "0" : "3 2"}
                                    strokeWidth="0.7"
                                  />
                                ))}
                              </svg>

                              <div
                                style={{
                                  position: "absolute",
                                  left: "50%",
                                  top: "50%",
                                  transform: "translate(-50%, -50%)",
                                  padding: "8px 10px",
                                  borderRadius: 12,
                                  background: `${tokens.blue}22`,
                                  border: `1px solid ${tokens.blue}55`,
                                  textAlign: "center",
                                  minWidth: 92,
                                }}
                              >
                                <div style={{ fontSize: 12, fontWeight: 800, color: tokens.text }}>You</div>
                                <div style={{ fontSize: 11, color: tokens.blue, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {String(MeshEngine.localId || S.get("mesh_id", "") || "local-device")}
                                </div>
                              </div>

                              {graphNodes.map((node) => {
                                const userId = formatMeshUserId(node);
                                return (
                                  <div
                                    key={`graph-node-${node.id}`}
                                    title={`${node.name} · ${node.id}`}
                                    style={{
                                      position: "absolute",
                                      left: `${node.xPct}%`,
                                      top: `${node.yPct}%`,
                                      transform: "translate(-50%, -50%)",
                                      minWidth: 92,
                                      maxWidth: 128,
                                      padding: "6px 8px",
                                      borderRadius: 12,
                                      background: tokens.card,
                                      border: `1px solid ${node.online ? tokens.green : tokens.sep}`,
                                      boxShadow: tokens.shadow,
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                      <span
                                        style={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: "50%",
                                          background: node.online ? tokens.green : tokens.label,
                                          flexShrink: 0,
                                        }}
                                      />
                                      <span style={{ fontSize: 12, fontWeight: 700, color: tokens.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {node.name}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 10, color: tokens.label, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      ID: {node.id}
                                    </div>
                                    <div style={{ fontSize: 10, color: node.hasLiveLocation ? tokens.green : tokens.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {node.hasLiveLocation ? userId : `${userId} · GPS pending`}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 6 }}>
                              Live movement radar
                            </div>

                            <div
                              style={{
                                position: "relative",
                                width: "100%",
                                aspectRatio: "1 / 1",
                                maxHeight: 280,
                                borderRadius: 14,
                                border: `1px solid ${tokens.sep}`,
                                background: `radial-gradient(circle at center, ${tokens.fill}, ${tokens.bg})`,
                                overflow: "hidden",
                                marginBottom: 12,
                              }}
                            >
                              {[80, 56, 32].map((r) => (
                                <div
                                  key={r}
                                  style={{
                                    position: "absolute",
                                    width: `${r}%`,
                                    height: `${r}%`,
                                    left: `${(100 - r) / 2}%`,
                                    top: `${(100 - r) / 2}%`,
                                    borderRadius: "50%",
                                    border: `1px solid ${tokens.sep}`,
                                  }}
                                />
                              ))}

                              <svg
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                              >
                                {myGps &&
                                  liveRadarPeers.map((p) => {
                                    const offset = projectRadarOffset(myGps, p, radarRange);
                                    return (
                                      <line
                                        key={`radar-link-${p.id}`}
                                        x1="50"
                                        y1="50"
                                        x2={offset.xPct}
                                        y2={offset.yPct}
                                        stroke={p.online ? tokens.green : tokens.label}
                                        strokeOpacity={0.35}
                                        strokeWidth="0.7"
                                      />
                                    );
                                  })}
                              </svg>

                              <div
                                style={{
                                  position: "absolute",
                                  left: "50%",
                                  top: "50%",
                                  width: 12,
                                  height: 12,
                                  transform: "translate(-50%, -50%)",
                                  borderRadius: "50%",
                                  background: tokens.blue,
                                  boxShadow: `0 0 0 5px ${tokens.blue}22`,
                                }}
                                title="You"
                              />

                              {myGps &&
                                liveRadarPeers.map((p) => {
                                  const offset = projectRadarOffset(myGps, p, radarRange);
                                  const motion = radarMotionRef.current.get(p.id);
                                  const moving = (motion?.speedMps || 0) > 0.7;
                                  const userId = formatMeshUserId(p);
                                  return (
                                    <div
                                      key={p.id}
                                      title={`${p.name} · ${p.id}`}
                                      style={{
                                        position: "absolute",
                                        left: `${offset.xPct}%`,
                                        top: `${offset.yPct}%`,
                                        transform: "translate(-50%, -50%)",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: moving ? 12 : 9,
                                          height: moving ? 12 : 9,
                                          borderRadius: "50%",
                                          background: moving ? tokens.green : tokens.orange,
                                          boxShadow: moving ? `0 0 0 4px ${tokens.green}22` : "none",
                                        }}
                                      />
                                      <div
                                        style={{
                                          marginTop: 6,
                                          padding: "3px 6px",
                                          borderRadius: 999,
                                          background: `${tokens.card}ee`,
                                          border: `1px solid ${tokens.sep}`,
                                          textAlign: "center",
                                          minWidth: 72,
                                          maxWidth: 112,
                                        }}
                                      >
                                        <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {p.name}
                                        </div>
                                        <div style={{ fontSize: 9, color: tokens.label, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {userId}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>

                            {myGps && (
                              <div style={{ fontSize: 11, color: tokens.label, marginBottom: 8 }}>
                                You: {myGps.lat.toFixed(4)}, {myGps.lng.toFixed(4)}
                              </div>
                            )}

                            <div style={{ fontSize: 12, color: tokens.label, fontWeight: 700, marginBottom: 6 }}>
                              Visible mesh users
                            </div>
                            {meshVisibleUsers.length === 0 ? (
                              <div style={{ fontSize: 13, color: tokens.label }}>Waiting for live GridCaller users.</div>
                            ) : (
                              meshVisibleUsers.map((p) => {
                                const hasLiveLocation =
                                  typeof p.lat === "number" &&
                                  typeof p.lng === "number" &&
                                  Number.isFinite(p.lat) &&
                                  Number.isFinite(p.lng);
                                const dist = myGps && hasLiveLocation ? calcDistanceMeters(myGps, p as { lat: number; lng: number }) : p.distance ?? null;
                                const motion = radarMotionRef.current.get(p.id);
                                const speedMps = motion?.speedMps || 0;
                                const moving = speedMps > 0.7;
                                const userId = formatMeshUserId(p);
                                return (
                                  <div
                                    key={p.id}
                                    style={{
                                      padding: "10px 0",
                                      borderBottom: `1px solid ${tokens.sep}`,
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      fontSize: 13,
                                    }}
                                  >
                                    <div style={{ color: tokens.text, minWidth: 0 }}>
                                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {p.online ? "●" : "○"} {p.name}
                                      </div>
                                      <div style={{ color: tokens.label, fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        ID: {p.id}
                                      </div>
                                      <div style={{ color: tokens.label, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {userId}
                                      </div>
                                      <div style={{ color: tokens.label, fontSize: 11 }}>
                                        {hasLiveLocation
                                          ? moving
                                            ? `Moving · ${(speedMps * 3.6).toFixed(1)} km/h`
                                            : "Live location · stable"
                                          : "Online on mesh · live GPS unavailable"}
                                      </div>
                                    </div>
                                    <div style={{ color: tokens.label, fontSize: 12, flexShrink: 0 }}>
                                      {hasLiveLocation ? (dist != null ? `${Math.round(dist)}m` : "GPS") : "mesh"}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}
                </>
              )}

              {menuView === "map" && (
                <>
                  <div style={{ fontSize: 13, color: tokens.label, marginBottom: 8 }}>
                    {radarPeers.length === 0 && !myGps
                      ? "Location permission is required to share your map position with nearby GridCaller phones."
                      : `${meshVisibleUsers.length} mesh users · ${radarPeers.length} with live GPS · blue = you · green = others`}
                  </div>
                  <div
                    ref={mapBoxRef}
                    style={{
                      height: 280,
                      borderRadius: 14,
                      overflow: "hidden",
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.fill,
                    }}
                  />
                  <div style={{ marginTop: 10 }}>
                    {myGps && (
                      <div style={{ fontSize: 12, color: tokens.blue, marginBottom: 6 }}>
                        You: {myGps.lat.toFixed(4)}, {myGps.lng.toFixed(4)}
                      </div>
                    )}
                    {meshVisibleUsers.length === 0 ? (
                      <div style={{ fontSize: 13, color: tokens.label }}>
                        Waiting for another GridCaller user.
                      </div>
                    ) : (
                      meshVisibleUsers.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            padding: "10px 0",
                            borderBottom: `1px solid ${tokens.sep}`,
                            fontSize: 13,
                            color: tokens.text,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {p.online ? "●" : "○"} {p.name}
                              </span>
                              <span style={{ display: "block", color: tokens.label, fontSize: 11, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                ID: {p.id}
                              </span>
                              <span style={{ display: "block", color: tokens.label, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {formatMeshUserId(p)}
                              </span>
                            </span>
                            <span style={{ color: tokens.label, flexShrink: 0 }}>
                              {typeof p.lat === "number" && typeof p.lng === "number"
                                ? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}${p.distance != null ? ` · ${Math.round(p.distance)}m` : ""}`
                                : "No live GPS"}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button
                              type="button"
                              onClick={() =>
                                saveGridNumberToDevice({
                                  name: p.name,
                                  peerId: p.id,
                                  phone: p.phone,
                                  displayNumber: p.displayNumber,
                                })
                              }
                              style={{
                                border: "none",
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                background: tokens.fill,
                                color: tokens.blue,
                                cursor: "pointer",
                              }}
                            >
                              Save number
                            </button>
                            <button
                              type="button"
                              onClick={() => placeCall(p.id, p.name)}
                              style={{
                                border: "none",
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                background: tokens.fill,
                                color: tokens.green,
                                cursor: "pointer",
                              }}
                            >
                              Call
                            </button>
                            <button
                              type="button"
                              onClick={() => blockCaller(p.id, p.name)}
                              style={{
                                border: "none",
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 11,
                                fontWeight: 600,
                                background: tokens.fill,
                                color: tokens.red,
                                cursor: "pointer",
                              }}
                            >
                              Block
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {menuView === "settings" && (
                <>
                  <div
                    style={{
                      background: `${tokens.blue}12`,
                      border: `1px solid ${tokens.blue}44`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: tokens.text, marginBottom: 8 }}>Mesh identity</div>
                    <div style={{ fontSize: 12, color: tokens.label, lineHeight: 1.45, marginBottom: 6 }}>
                      Handle: <b style={{ color: tokens.text }}>@{getMeshHandle()}</b>
                    </div>
                    <div style={{ fontSize: 12, color: tokens.label, lineHeight: 1.45, marginBottom: 6 }}>
                      Peer ID: <b style={{ color: tokens.text }}>{MeshEngine.localId || S.get("mesh_id", "") || "—"}</b>
                    </div>
                    <div style={{ fontSize: 12, color: bridgeStatus.ready ? tokens.green : tokens.orange, lineHeight: 1.45, marginBottom: 6 }}>
                      {bridgeStatus.text}
                    </div>
                    {bridgeStatus.detail ? (
                      <div style={{ fontSize: 11, color: tokens.secondary, lineHeight: 1.4, marginBottom: 8 }}>
                        {bridgeStatus.detail}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            const status = await ghStatus(resolveHubHttp());
                            setBridgeStatus(normalizeBridgeStatus(status));
                          } catch {
                            setBridgeStatus(normalizeBridgeStatus(null));
                          }
                        })();
                      }}
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Refresh bridge status
                    </button>
                  </div>

                  <div
                    style={{
                      background: tokens.fill,
                      border: `1px solid ${tokens.sep}`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: tokens.text, marginBottom: 10 }}>Appearance</div>
                    <button
                      type="button"
                      onClick={() => setDarkMode((d) => !d)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.bg,
                        color: tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {darkMode ? <Moon size={18} /> : <Sun size={18} />}
                        {darkMode ? "Dark mode" : "Light mode"}
                      </span>
                      <span style={{ fontSize: 12, color: tokens.label }}>Tap to switch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Turn GridCaller OFF? Mesh and calls will go to standby.")) setAppEnabled(false);
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `1px solid ${tokens.red}44`,
                        background: `${tokens.red}12`,
                        color: tokens.red,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Power size={18} /> Turn OFF GridCaller
                      </span>
                      <span style={{ fontSize: 12 }}>Standby</span>
                    </button>
                  </div>

                  <div
                    style={{
                      background: `${tokens.orange}18`,
                      border: `1px solid ${tokens.orange}44`,
                      borderRadius: 12,
                      padding: 10,
                      marginBottom: 14,
                      fontSize: 12,
                      color: tokens.secondary,
                      lineHeight: 1.45,
                    }}
                  >
                  </div>

                  <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>Name</label>
                  <input
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    placeholder="e.g. Mahendra Test"
                    style={settingsInputStyle(tokens)}
                  />

                  <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>
                    My ID
                  </label>
                  <input
                    value={settingsCallerId}
                    onChange={(e) => setSettingsCallerId(e.target.value)}
                    placeholder="Your ID"
                    style={settingsInputStyle(tokens)}
                  />
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      type="button"
                      onClick={() => {
                        const id =
                          "user_" +
                          Math.random().toString(36).slice(2, 8) +
                          Date.now().toString(36).slice(-3);
                        setSettingsCallerId(id);
                      }}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${tokens.sep}`,
                        background: tokens.fill,
                        color: tokens.text,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      Random ID
                    </button>
                  </div>

                  <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>
                    Phone number
                  </label>
                  <input
                    value={settingsPhone}
                    onChange={(e) => setSettingsPhone(e.target.value)}
                    placeholder="Phone number"
                    inputMode="tel"
                    style={settingsInputStyle(tokens)}
                  />

                  <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>
                    Display number
                  </label>
                  <input
                    value={settingsDisplayNum}
                    onChange={(e) => setSettingsDisplayNum(e.target.value)}
                    placeholder="Optional"
                    style={settingsInputStyle(tokens)}
                  />

                  <button
                    type="button"
                    onClick={() => applyProfileSave()}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Save
                  </button>
                  {idSaveMsg ? (
                    <div style={{ fontSize: 12, color: tokens.green, marginBottom: 12, fontWeight: 600 }}>{idSaveMsg}</div>
                  ) : null}

                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.label,
                      marginBottom: 14,
                      padding: 8,
                      background: tokens.fill,
                      borderRadius: 8,
                    }}
                  >
                    Home screen shows:{" "}
                    <code style={{ color: tokens.text }}>{myGridDisplay || "—"}</code>
                    <br />
                    Current ID: <code style={{ color: tokens.text }}>{MeshEngine.localId}</code>
                    <br />
                    Phone: <code style={{ color: tokens.text }}>{S.get("user_phone", "") || "—"}</code>
                  </div>

                  <div
                    style={{
                      background: `${tokens.blue}12`,
                      border: `1px solid ${tokens.blue}44`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 14,
                      fontSize: 12,
                      color: tokens.secondary,
                      lineHeight: 1.45,
                    }}
                  >
                    To call a phone number: open Keypad → Call mobile.
                    <button
                      type="button"
                      onClick={async () => {
                        const st = await pstnBridge.getStatus();
                        setIdSaveMsg(
                          st.configured
                            ? `Live mobile calling ready via ${st.provider}`
                            : `Dry-run only (${st.provider}) · add TWILIO_* on hub for real cellular` 
                        );
                      }}
                      style={{
                        marginTop: 8,
                        width: "100%",
                        padding: 10,
                        borderRadius: 8,
                        border: "none",
                        background: tokens.blue,
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Check mobile call
                    </button>
                  </div>

                  <div
                    style={{
                      background: tokens.fill,
                      border: `1px solid ${tokens.sep}`,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: tokens.text, marginBottom: 6 }}>
                      Local only
                    </div>
                    <div style={{ fontSize: 12, color: tokens.label, lineHeight: 1.45, marginBottom: 10 }}>
                      Same Wi‑Fi or hotspot. {meshModeLabel()}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !getForceLocalMesh();
                        setForceLocalMesh(next);
                        if (next) setCallScope("local");
                        setIdSaveMsg(next ? "Local only on" : "Auto on");
                      }}
                      style={{
                        width: "100%",
                        padding: 12,
                        borderRadius: 10,
                        border: "none",
                        background: getForceLocalMesh() ? tokens.green : tokens.blue,
                        color: "#fff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {getForceLocalMesh() ? "Local only: on" : "Local only: off"}
                    </button>
                  </div>

                  <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>Call type</label>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.fill,
                      color: tokens.text,
                      margin: "6px 0 14px",
                      lineHeight: 1.45,
                    }}
                  >
                    Auto route is on. The app will try local mesh first and smoothly fall back to global when needed.
                  </div>

                  <label style={{ fontSize: 12, color: tokens.label, fontWeight: 600 }}>Handle</label>
                  <div style={{ fontSize: 11, color: tokens.label, marginTop: 4, marginBottom: 6, lineHeight: 1.4 }}>
                    Set a public name or number people can use to reach you on this mesh. Saving it updates the label shown on the home screen.
                  </div>
                  <input
                    value={globalHandle}
                    onChange={(e) => setGlobalHandle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const r = applyHandleSave(globalHandle);
                        setIdSaveMsg(r.ok ? `Handle saved: ${r.display}` : r.error || "Save failed");
                        setTimeout(() => setIdSaveMsg(""), 2500);
                      }
                    }}
                    placeholder="e.g. alex or 9876543210"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      margin: "0 0 8px",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid ${tokens.sep}`,
                      background: tokens.inputBg,
                      color: tokens.text,
                      fontSize: 15,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const r = applyHandleSave(globalHandle);
                      setIdSaveMsg(r.ok ? `Handle saved: ${r.display}` : r.error || "Save failed");
                      setTimeout(() => setIdSaveMsg(""), 2500);
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 10,
                      border: "none",
                      background: tokens.blue,
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                      marginBottom: 8,
                    }}
                  >
                    Save handle
                  </button>
                  {idSaveMsg ? (
                    <div style={{ fontSize: 12, color: tokens.green, marginBottom: 12, fontWeight: 600 }}>
                      {idSaveMsg}
                    </div>
                  ) : (
                    <div style={{ marginBottom: 6 }} />
                  )}

                  <div style={{ fontSize: 12, color: tokens.label, fontWeight: 600, marginBottom: 6 }}>
                    Blocked callers ({blocked.length})
                  </div>
                  {blocked.length === 0 ? (
                    <div style={{ fontSize: 13, color: tokens.label }}>
                      No blocked callers. Use Block on an incoming call, or from Contacts / Map.
                    </div>
                  ) : (
                    blocked.map((id) => {
                      const c = contacts.find((x) => x.peerId === id);
                      return (
                        <div
                          key={id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 0",
                            borderBottom: `1px solid ${tokens.sep}`,
                          }}
                        >
                          <span style={{ flex: 1, fontSize: 13, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {c?.name || id}
                            {c ? ` · ${contactsVault.getPrimaryPhone(c) || c.phones?.[0] || ""}` : ""}
                            <div style={{ fontSize: 11, color: tokens.label }}>{id}</div>
                          </span>
                          <button
                            type="button"
                            onClick={() => unblockCaller(id)}
                            style={{
                              border: "none",
                              background: tokens.fill,
                              color: tokens.blue,
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Unblock
                          </button>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
    </ThemeCtx.Provider>
  );
}

function formatTestPhone(raw: string) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("0")) return formatTestPhone(d.slice(1));
  if (d.length > 10 && d.startsWith("91")) return `+${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length > 6) return `+${d}`;
  return raw || "";
}

/**
 * Single source of truth for the number shown under "GridCaller" on home.
 * Priority: saved phone → handle → custom display. Never silent registry defaults when user saved a phone.
 */
function resolveMyPublicNumber(): string {
  const phone = String(S.get("user_phone", "") || "").replace(/\D/g, "");
  if (phone.length >= 8) return formatTestPhone(phone);

  const handle = String(S.get("global_call_handle", "") || "").trim();
  if (handle) {
    const hd = handle.replace(/\D/g, "");
    if (hd.length >= 8 && hd.length <= 15) return formatTestPhone(hd);
    return handle;
  }

  const custom = String(S.get("gc_test_display_number", "") || "").trim();
  if (custom) return custom;

  return "";
}

function sanitizeRadioChannel(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function sanitizeRadioGroupName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .slice(0, 28);
}

function loadRadioChannelList(currentChannel: string): string[] {
  const defaults = ["grid-ch-1", "gridcaller-free", "emergency-mesh", "rescue-ops", "community-net"];
  const stored = S.get("gc_radio_channels", []);
  const list = Array.isArray(stored) ? stored : [];
  const merged = [currentChannel, ...list, ...defaults].map(sanitizeRadioChannel).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, 12);
}

function loadRadioGroups(defaultChannels: string[]) {
  const now = Date.now();
  const fallback = [
    {
      id: "rg_primary",
      name: "Primary",
      channels: defaultChannels.slice(0, 4),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "rg_emergency",
      name: "Emergency",
      channels: defaultChannels.filter((c) => /emergency|rescue|grid/i.test(c)).slice(0, 4),
      createdAt: now,
      updatedAt: now,
    },
  ].filter((g) => g.channels.length > 0);
  const raw = S.get("gc_radio_groups", []);
  if (!Array.isArray(raw) || raw.length === 0) return fallback;

  const normalized = raw
    .map((row: any) => {
      const name = sanitizeRadioGroupName(row?.name || "");
      const channels = Array.isArray(row?.channels)
        ? Array.from(new Set(row.channels.map((c: string) => sanitizeRadioChannel(c)).filter(Boolean))).slice(0, 60)
        : [];
      if (!name) return null;
      return {
        id: String(row?.id || `rg_${Math.random().toString(36).slice(2, 8)}`),
        name,
        channels,
        createdAt: Number(row?.createdAt || now),
        updatedAt: Number(row?.updatedAt || now),
      };
    })
    .filter(Boolean) as { id: string; name: string; channels: string[]; createdAt: number; updatedAt: number }[];

  return normalized.length ? normalized : fallback;
}

function calcDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function calcBearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function projectRadarOffset(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number },
  rangeMeters: number
): { xPct: number; yPct: number } {
  const latRad = (origin.lat * Math.PI) / 180;
  const dx = (target.lng - origin.lng) * 111320 * Math.cos(latRad);
  const dy = (target.lat - origin.lat) * 110540;
  const normX = dx / Math.max(1, rangeMeters);
  const normY = dy / Math.max(1, rangeMeters);
  const r = Math.sqrt(normX * normX + normY * normY);
  const scale = r > 1 ? 1 / r : 1;
  return {
    xPct: 50 + normX * scale * 44,
    yPct: 50 - normY * scale * 44,
  };
}

function formatMeshUserId(peer: Pick<MeshVisibleUser, "id" | "displayNumber" | "handle" | "phone">): string {
  const display = String(peer.displayNumber || "").trim();
  if (display) return display;
  const handle = String(peer.handle || "").trim();
  if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
  const phone = String(peer.phone || "").trim();
  if (phone) return phone;
  return peer.id;
}

function meshNodeSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildMeshGraphNodes(peers: MeshVisibleUser[]): MeshGraphNode[] {
  const total = peers.length;
  if (!total) return [];
  const ringRadius = total <= 6 ? 31 : total <= 12 ? 35 : total <= 18 ? 39 : 42;
  return peers.map((peer, index) => {
    const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
    const jitter = ((meshNodeSeed(peer.id) % 9) - 4) * 0.45;
    const radius = Math.max(26, Math.min(44, ringRadius + jitter));
    return {
      ...peer,
      xPct: 50 + Math.cos(angle) * radius,
      yPct: 50 + Math.sin(angle) * radius,
      hasLiveLocation:
        typeof peer.lat === "number" &&
        typeof peer.lng === "number" &&
        Number.isFinite(peer.lat) &&
        Number.isFinite(peer.lng),
    };
  });
}

function settingsInputStyle(tokens: Tokens): Record<string, string | number> {
  return {
    width: "100%",
    boxSizing: "border-box",
    margin: "6px 0 12px",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${tokens.sep}`,
    background: tokens.inputBg,
    color: tokens.text,
    fontSize: 15,
  };
}

// ── UI atoms ───────────────────────────────────────────────────
function Shell({ children }: { children: any }) {
  const t = useT();
  return (
    <div
      className="gc-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        minHeight: 0,
        minWidth: 0,
        flex: 1,
        background: t.bg,
        color: t.text,
        fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif",
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}

function NavBar({ title, left, right }: { title: string; left?: any; right?: any }) {
  const t = useT();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        background: t.bar,
        backdropFilter: t.blur,
        borderBottom: `0.5px solid ${t.sep}`,
        color: t.text,
        flexShrink: 0,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {left}
      <div style={{ flex: 1, fontSize: 17, fontWeight: 600, color: t.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      {right || null}
    </div>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button onClick={onClick} style={{ border: "none", background: "none", color: t.blue, cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}>
      <ChevronLeft size={28} />
    </button>
  );
}

function CardList({ children }: { children: any }) {
  const t = useT();
  return <div style={{ margin: "8px 12px", background: t.card, borderRadius: 14, overflow: "hidden", boxShadow: t.shadow, border: `1px solid ${t.sep}` }}>{children}</div>;
}

function Row({
  avatar,
  id,
  title,
  titleColor,
  subtitle,
  trailing,
  onClick,
  actions,
}: any) {
  const t = useT();
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderBottom: `0.5px solid ${t.sep}`,
        cursor: onClick ? "pointer" : "default",
        background: t.card,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: hue(id || title),
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {initials(title)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: titleColor || t.text }}>{title}</div>
        <div style={{ fontSize: 13, color: t.label, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
      </div>
      {trailing && <div style={{ fontSize: 13, color: t.label, marginRight: 4, flexShrink: 0 }}>{trailing}</div>}
      {actions && (
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

function IconCircle({ children, onClick, color }: any) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        border: "none",
        background: t.fill2,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  const t = useT();
  return (
    <div style={{ padding: "40px 28px", textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: t.text }}>{title}</div>
      <div style={{ fontSize: 14, color: t.label, lineHeight: 1.45 }}>{body}</div>
    </div>
  );
}

function Pill({ children }: { children: any }) {
  const t = useT();
  return (
    <div style={{ textAlign: "center", fontSize: 12, color: t.label, background: t.fill, borderRadius: 10, padding: "8px 12px", marginBottom: 14 }}>
      {children}
    </div>
  );
}

function CallBtn({ label, color, onClick, children, big }: any) {
  return (
    <div style={{ textAlign: "center" }}>
      <button
        onClick={onClick}
        style={{
          width: big ? 72 : 64,
          height: big ? 72 : 64,
          borderRadius: 999,
          border: "none",
          background: color,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {children}
      </button>
      <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>{label}</div>
    </div>
  );
}

function keyStyleOf(t: Tokens): React.CSSProperties {
  return {
    width: 72,
    height: 72,
    borderRadius: 36,
    border: `1px solid ${t.sep}`,
    background: t.card,
    color: t.text,
    boxShadow: t.shadow,
    fontSize: 28,
    fontWeight: 500,
    cursor: "pointer",
    justifySelf: "center",
    // Prevent washed-out / opacity inheritance on light theme
    opacity: 1,
    WebkitTextFillColor: t.text as any,
  };
}

function contactChipStyle(t: Tokens, primary?: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    border: primary ? "none" : `1px solid ${t.sep}`,
    background: primary ? t.blue : t.card,
    color: primary ? "#fff" : t.text,
    borderRadius: 16,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

function ContactSheet({
  children,
  onClose,
  title,
}: {
  children: any;
  onClose: () => void;
  title?: string;
}) {
  const t = useT();
  return (
    <div
      className="gc-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 500,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
      onClick={onClose}
    >
      <div
        className="gc-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "100%",
          maxHeight: "90%",
          overflowY: "auto",
          overflowX: "hidden",
          background: t.bg,
          borderRadius: "18px 18px 0 0",
          padding: "12px 16px 24px",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.25)",
          boxSizing: "border-box",
          WebkitOverflowScrolling: "touch" as any,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ width: 36 }} />
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: t.fill,
            }}
          />
          <button
            type="button"
            onClick={onClose}
            style={{ border: "none", background: t.fill, borderRadius: 16, width: 32, height: 32, cursor: "pointer", color: t.label, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={16} />
          </button>
        </div>
        {title && (
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: t.text, textAlign: "center" }}>
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function ContactField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useT();
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.label, marginBottom: 6 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1px solid ${t.sep}`,
          background: t.inputBg,
          color: t.text,
          borderRadius: 12,
          padding: "12px 14px",
          fontSize: 16,
          outline: "none",
        }}
      />
    </div>
  );
}

export function initiateCall(peerId: string, type: CallType, userName: string) {
  bus.emit("call:initiate", { peerId, type, userName });
}

export type { CallType as GridCallType };
