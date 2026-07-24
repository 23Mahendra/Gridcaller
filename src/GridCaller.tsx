/**
 * GridCaller — sovereign free phone (iOS-class UI)
 * Synced with Mesh Comms + meshAppBridge for calls & messages.
 * Light + Dark themes (fixes dim dark-mode colors).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  MessageCircle, MessageSquare, Search, Mic, MicOff, Volume2, ChevronLeft,
  ChevronDown, ChevronUp, CheckCircle2, Circle,
  Delete, Plus, Star, StarOff, Ban, Pencil, Trash2, Download,
  Upload, UserPlus, X, Smartphone, Users, Menu, Map as MapIcon, Settings,
  Share2, Image as ImageIcon, IdCard, Wifi, Bluetooth, Shield, Sun, Moon, Power,
  Network, Radio, Video, VideoOff, SwitchCamera,
} from "lucide-react";
import { bus } from "./kernel/bus";
import { S } from "./kernel/storage";
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
import gridNumberRegistry from "./kernel/gridNumberRegistry";
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
import { getHubHttp, getMeshHandle, rememberDeviceIdentity } from "./mesh/identity";
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

type RecentsItem = {
  id: string;
  peerId: string;
  name: string;
  dir: "in" | "out" | "missed";
  ts: number;
  duration: number;
  method?: string;
};

type MessageFolder = "inbox" | "sent" | "received" | "draft" | "outbox" | "deleted" | "trash";

type SmsRow = {
  id: string;
  peerId: string;
  name: string;
  text: string;
  ts: number;
  mine: boolean;
  folder: MessageFolder;
};

type Tab = "recents" | "contacts" | "keypad" | "sms";

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

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function callLogGroupKey(peerId: string, name: string) {
  const raw = String(peerId || name || "").trim();
  return raw ? raw.toLowerCase() : "unknown";
}

function callLogDirectionLabel(dir: RecentsItem["dir"]) {
  return dir === "missed" ? "Missed" : dir === "in" ? "Incoming" : "Outgoing";
}

function callLogDirMeta(dir: RecentsItem["dir"]) {
  return dir === "missed" ? { label: "Missed", color: "#ff3b30" } : dir === "in" ? { label: "Incoming", color: "#34c759" } : { label: "Outgoing", color: "#007aff" };
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

  const [tab, setTab] = useState<Tab>("recents");
  const [q, setQ] = useState("");
  /** Call log filter: all | missed | incoming | outgoing | blocked */
  const [callLogFilter, setCallLogFilter] = useState<"all" | "missed" | "in" | "out" | "blocked">("all");
  const [peers, setPeers] = useState<
    { id: string; name: string; online: boolean; distance?: number; handle?: string; phone?: string }[]
  >([]);
  const [recents, setRecents] = useState<RecentsItem[]>(() => S.get("gridcaller_recents", []));
  const [sms, setSms] = useState<SmsRow[]>(() => S.get("gridcaller_sms", []));
  const [blocked, setBlocked] = useState<string[]>(() => S.get("gridcaller_blocked", []));
  const [dial, setDial] = useState("");
  const [thread, setThread] = useState<string | null>(null);
  const [smsDraft, setSmsDraft] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [messageFolder, setMessageFolder] = useState<MessageFolder>("inbox");
  const [composeTo, setComposeTo] = useState("");
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
  const [onlineNowCollapsed, setOnlineNowCollapsed] = useState(false);
  const [groupCallOpen, setGroupCallOpen] = useState(false);
  const [groupCallMuted, setGroupCallMuted] = useState(false);
  const [groupCallSilent, setGroupCallSilent] = useState(false);
  const [groupCallSpeaker, setGroupCallSpeaker] = useState(true);

  const [globalHandle, setGlobalHandle] = useState(() => {
    const h = String(S.get("global_call_handle", "") || "").trim();
    if (h) return h;
    const meshHandle = getMeshHandle();
    if (meshHandle) return meshHandle;
    const ph = String(S.get("user_phone", "") || "").replace(/\D/g, "");
    return ph.length >= 10 ? ph.slice(-10) : myName || "";
  });
  const [bridgeStatus, setBridgeStatus] = useState<MenuBridgeStatus>({ ready: false, text: "Checking bridge…", detail: "" });
  const [globalPeers, setGlobalPeers] = useState<{ id: string; name: string; handle?: string; online: boolean }[]>([]);
  /** Number under title — always start from storage (user phone / handle) */
  const [myGridDisplay, setMyGridDisplay] = useState(() => resolveMyPublicNumber());
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
  const [menuView, setMenuView] = useState<
    "home" | "map" | "settings" | "radio" | "profile" | "tower" | "devices" | "share" | "privacy"
  >("home");
  const [towerTick, setTowerTick] = useState(0);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [deviceMsg, setDeviceMsg] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [privacyMsg, setPrivacyMsg] = useState("");
  const [apkInfo, setApkInfo] = useState<{ name: string; url: string; size?: number } | null>(null);
  const [myCard, setMyCard] = useState<ProfileCard>(() => loadMyCard());
  const [cardInbox, setCardInbox] = useState<ProfileCard[]>(() => loadInbox());
  const [cardMsg, setCardMsg] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [radioTick, setRadioTick] = useState(0);
  const [radioChannel, setRadioChannel] = useState(() => freeRadio.channelName);
  const [radioSecret, setRadioSecret] = useState(() => S.get("gc_radio_secret", "gridcaller-free") || "gridcaller-free");
  const [radioText, setRadioText] = useState("");
  const [pttOn, setPttOn] = useState(false);
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
  const [settingsCallerId, setSettingsCallerId] = useState(
    () => S.get("mesh_id") || S.get("ga_mesh_id") || MeshEngine.localId || ""
  );
  const [settingsPhone, setSettingsPhone] = useState(
    () => S.get("user_phone", "") || softTower.getSimAlias?.() || user?.phone || ""
  );
  const [settingsDisplayNum, setSettingsDisplayNum] = useState(
    () => S.get("gc_test_display_number", "") || ""
  );
  const [idSaveMsg, setIdSaveMsg] = useState("");
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);

  // Contacts vault (local memory — Truecaller-class)
  const [contacts, setContacts] = useState<GridContact[]>(() => contactsVault.list());
  const [contactView, setContactView] = useState<GridContact | null>(null);
  const [contactEdit, setContactEdit] = useState<Partial<GridContact> & { name: string } | null>(null);
  const [contactBusy, setContactBusy] = useState("");
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
      else if (ph !== "idle") setErr("");
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

  useEffect(() => S.set("gridcaller_recents", recents.slice(0, 80)), [recents]);
  useEffect(() => S.set("gridcaller_sms", sms.slice(0, 400)), [sms]);
  useEffect(() => S.set("gridcaller_blocked", blocked), [blocked]);
  useEffect(() => {
    S.set("gridcaller_scope", callScope);
  }, [callScope]);

  // Keep local preview in sync when camera turns on mid-call
  useEffect(() => {
    if (!videoOn || phase === "idle") return;
    const el = localVideoRef.current;
    const stream = localStream.current;
    if (!el || !stream) return;
    const vids = stream.getVideoTracks().filter((t) => t.readyState === "live");
    if (!vids.length) return;
    el.srcObject = new MediaStream(vids);
    el.play().catch(() => {});
  }, [videoOn, phase]);

  // Contacts vault: live reload + mesh peer merge
  useEffect(() => {
    const reload = () => setContacts(contactsVault.list());
    reload();
    const off = bus.on("contacts:changed", reload);
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    // Merge mesh peers into local contact memory when peer set changes (non-destructive)
    const meshRows = [
      ...peers.map((p) => ({ id: p.id, name: p.name, online: p.online })),
      ...globalPeers.map((p) => ({ id: p.id, name: p.name, online: p.online })),
    ];
    if (!meshRows.length) return;
    try {
      const before = contactsVault.list().length;
      const known = new Set(contactsVault.list().map((c) => c.peerId).filter(Boolean));
      const fresh = meshRows.filter((p) => p.id && !known.has(p.id));
      if (fresh.length) {
        contactsVault.syncMeshPeers(fresh);
        if (contactsVault.list().length !== before) setContacts(contactsVault.list());
      }
    } catch {}
  }, [peers, globalPeers]);

  // Init: sync GridCaller ↔ Mesh Comms ↔ meshAppBridge ↔ global call
  useEffect(() => {
    try {
      // APK must point at PC LAN hub (not localhost)
      const { hub, signal } = ensureHubDefaults();
      setLanUrl(hub);
      try {
        localStorage.setItem("gc_hub_http", hub);
        localStorage.setItem("gc_signal_url", signal);
      } catch {}

      // One identity + FULL auto-join (Wi‑Fi + BT + swarm) — no manual Connect
      unifyLocalIdentity();
      void startFullAutoJoin(myName);
      void startAutoMesh(myName).then((st) => setAutoMeshStatus(st));
      const offAm = onAutoMeshStatus((st) => setAutoMeshStatus(st));
      (window as any).__gc_off_am = offAm;

      sovereignMesh.start();
      meshAppBridge.start(myName);
      meshAppBridge.registerApp("gridcaller", "GridCaller");
      meshAppBridge.registerApp("meshcomms", "Mesh Comms");

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
      // Do NOT seed header from gidIdentity.display / cell.display (stale auto IDs)
      // Free radio + soft-tower hop fabric: every phone is a cell tower
      try {
        enableFreeRadioMeshDefaults();
        void freeRadio.enable(true);
        freeRadio.setOperatorName(myName);
      } catch {}
      try {
        softTowerHop.start(myName);
        freeMeshFabric.start(myName);
      } catch {}
      if (S.get("gc_force_local_mesh", null) === null) {
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
        // soft end — hangup UI may already run
      }
    });

    // Presence tick — MeshEngine peers + hub HTTP peers (real only)
    const tick = async () => {
      try {
        const mapped: {
          id: string;
          name: string;
          online: boolean;
          distance?: number;
          handle?: string;
          phone?: string;
        }[] = [];
        const seen = new Set<string>();
        const add = (
          id: string,
          name: string,
          online: boolean,
          extra?: { handle?: string; phone?: string }
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
          });
        };

        // From MeshEngine in-memory peers (HTTP poll fills this)
        const mp = (MeshEngine as any).peers || {};
        for (const [id, v] of Object.entries(mp) as any) {
          add(id, v?.name || id.slice(0, 12), Date.now() - (v?.lastSeen || 0) < 90000, {
            handle: v?.handle,
            phone: v?.phone,
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
            add(p.id, p.name, p.online !== false);
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
      if (!text) return;
      const row: SmsRow = {
        id: msg.id || String(Date.now()),
        peerId: from || "mesh",
        name: msg.user || msg.fromName || "Peer",
        text,
        ts: msg.timestamp || msg.ts || Date.now(),
        mine: false,
        folder: "inbox",
      };
      setSms((p) => (p.some((x) => x.id === row.id || (x.mine && x.text === text && Date.now() - x.ts < 3000)) ? p : [...p, row]));
    });

    // Directed mesh SMS only (never treat own send as inbound)
    const offMesh = MeshEngine.onMessage((msg: any) => {
      if (msg?.type === "GRIDCALLER_SMS" && msg.data?.text) {
        if (!msg.from || msg.from === MeshEngine.localId) return;
        if (blocked.includes(msg.from)) return;
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
          text: msg.data.text,
          ts: msg.time || Date.now(),
          mine: false,
          folder: "inbox",
        };
        setSms((p) =>
          p.some((x) => x.id === row.id || (x.mine && x.text === row.text && Date.now() - x.ts < 4000))
            ? p
            : [...p, row]
        );
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
      if (blocked.includes(m.from)) return;
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
      setContactBusy(`Hop msg · ${m.hops} hops · ${m.fromName}`);
      setTimeout(() => setContactBusy(""), 2500);
    });
    const offCall = softTowerHop.onHopCallSignal((sig) => {
      if (!sig || blocked.includes(sig.from)) return;
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
    const iv = setInterval(() => setTowerTick((n) => n + 1), 3000);
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

  // Leaflet map when menu map view open
  useEffect(() => {
    if (!menuOpen || menuView !== "map" || !mapBoxRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        // @ts-expect-error css side-effect
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
          : meshMapPeers[0]
            ? [meshMapPeers[0].lat, meshMapPeers[0].lng]
            : [20.5937, 78.9629]; // India default
        const map = L.map(mapBoxRef.current, { zoomControl: true }).setView(center, myGps || meshMapPeers.length ? 12 : 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        }).addTo(map);
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
            .bindPopup(`You · ${myName}`);
        }
        const bounds: [number, number][] = [];
        if (myGps) bounds.push([myGps.lat, myGps.lng]);
        for (const p of meshMapPeers) {
          L.marker([p.lat, p.lng], { icon: icon(p.online ? "#30d158" : "#98989f") })
            .addTo(map)
            .bindPopup(`${p.name}${p.distance != null ? ` · ${Math.round(p.distance)}m` : ""}`);
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
  }, [menuOpen, menuView, meshMapPeers, myGps, myName]);

  const networkPeopleCount = useMemo(() => {
    // Real connected devices only (no fabric ghosts / self duplicates)
    const { onlineCount } = listConnectedDevices({
      meshPeers: peers,
      globalPeers,
    });
    return onlineCount;
  }, [peers, globalPeers, towerTick]);

  const pushRecent = (item: RecentsItem) => {
    setRecents((p) => [item, ...p].slice(0, 80));
  };

  /**
   * Save handle / number → storage + main header under GridCaller (always).
   */
  const applyHandleSave = (raw: string): { ok: boolean; display?: string; error?: string } => {
    const h = String(raw || "").trim();
    if (h.length < 2) return { ok: false, error: "Handle needs at least 2 characters" };
    const digits = h.replace(/\D/g, "");
    const looksPhone = digits.length >= 8 && digits.length <= 15;

    if (looksPhone) {
      S.set("user_phone", digits);
      setSettingsPhone(digits);
      const derived = rememberDeviceIdentity({ phone: digits, peerId: S.get("mesh_id", "") || S.get("gc_peer_id", "") || undefined });
      S.set("global_call_handle", derived);
      setGlobalHandle(derived);
      const display = formatTestPhone(digits);
      S.set("gc_test_display_number", display);
      setMyGridDisplay(display);
      setSettingsDisplayNum(display);
      try {
        softTower.bindSimAlias(digits);
      } catch {}
      try {
        globalCall.setHandle?.(derived);
      } catch {}
    } else {
      S.set("global_call_handle", h);
      setGlobalHandle(h);
      S.set("gc_test_display_number", h);
      setMyGridDisplay(h);
      setSettingsDisplayNum(h);
      try {
        globalCall.setHandle?.(h);
      } catch {}
    }

    try {
      meshComms.startPresence?.(myName, "user");
    } catch {}
    try {
      softTowerHop.start(myName);
    } catch {}

    const shown = resolveMyPublicNumber();
    setMyGridDisplay(shown);
    return { ok: true, display: shown };
  };

  /** Profile Save: phone field is the number shown on home */
  const applyProfileSave = () => {
    const n = settingsName.trim() || "Me";
    const id = settingsCallerId.trim().replace(/\s+/g, "_");
    if (!id || id.length < 3) {
      setIdSaveMsg("ID needs at least 3 characters");
      return;
    }
    const phoneDigits = String(settingsPhone || "").replace(/\D/g, "");
    S.set("user_name", n);
    S.set("mesh_name", n);
    S.set("mesh_id", id);
    S.set("ga_mesh_id", id);
    S.set("omni_node_id", id);
    try {
      (MeshEngine as any).localId = id;
    } catch {}

    if (phoneDigits.length >= 8) {
      S.set("user_phone", phoneDigits);
      const derived = rememberDeviceIdentity({ phone: phoneDigits, peerId: id });
      S.set("global_call_handle", derived);
      setGlobalHandle(derived);
      const display = formatTestPhone(phoneDigits);
      S.set("gc_test_display_number", display);
      setMyGridDisplay(display);
      setSettingsDisplayNum(display);
      try {
        softTower.bindSimAlias(phoneDigits);
      } catch {}
      try {
        globalCall.setHandle?.(derived);
      } catch {}
    } else {
      S.set("user_phone", "");
      const disp = settingsDisplayNum.trim() || globalHandle.trim();
      if (disp) {
        const d = disp.replace(/\D/g, "");
        if (d.length >= 8) {
          applyHandleSave(d);
        } else {
          S.set("gc_test_display_number", disp);
          setMyGridDisplay(disp);
          S.set("global_call_handle", disp);
          setGlobalHandle(disp);
        }
      } else {
        S.set("gc_test_display_number", "");
        setMyGridDisplay("");
      }
    }

    try {
      MeshEngine.setName?.(n);
    } catch {}
    try {
      meshComms.startPresence?.(n, "user");
    } catch {}

    const shown = resolveMyPublicNumber();
    setMyGridDisplay(shown);
    setIdSaveMsg(`Saved · home shows ${shown || "—"}`);
    setTimeout(() => setIdSaveMsg(""), 3000);
  };

  const clearCallLogs = () => {
    if (recents.length === 0) {
      setContactBusy("No call logs to clear");
      setTimeout(() => setContactBusy(""), 1500);
      return;
    }
    if (!confirm(`Clear all ${recents.length} call log(s)?`)) return;
    setRecents([]);
    S.set("gridcaller_recents", []);
    setContactBusy("All call logs cleared");
    setTimeout(() => setContactBusy(""), 2000);
  };

  const deleteCallLog = (id: string) => {
    if (!id) return;
    if (!confirm("Delete this call log?")) return;
    setRecents((p) => {
      const next = p.filter((r) => r.id !== id);
      S.set("gridcaller_recents", next);
      return next;
    });
    setContactBusy("Call log deleted");
    setTimeout(() => setContactBusy(""), 1500);
  };

  const deleteCallLogGroup = (peerId: string) => {
    if (!peerId) return;
    if (!confirm("Delete this call log group?")) return;
    setRecents((p) => {
      const next = p.filter((r) => r.peerId !== peerId);
      S.set("gridcaller_recents", next);
      return next;
    });
    setContactBusy("Call log group deleted");
    setTimeout(() => setContactBusy(""), 1500);
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
          },
        ]);
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
                ? "OS dialer opened (no Twilio). For free mesh: other phone must run GridCaller + appear ONLINE."
                : `PSTN dry-run → ${r.to}`
              : `PSTN ringing ${r.to} · ${r.provider}`
          );
          if (r.path === "pstn" && !r.dryRun) {
            setPhase("active");
            startedAt.current = Date.now();
          }
          pushRecent({
            id: `r_${Date.now()}`,
            peerId: dialTo,
            name: name || dialTo,
            dir: "out",
            ts: Date.now(),
            duration: 0,
            method: r.provider || "pstn",
          });
          if (r.path === "tel" || r.dryRun) {
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
        gridNumberRegistry.logCall({
          dir: "out",
          peerNumber: sc.virtualNumber || peerId,
          peerName: sc.toName || name,
          peerId: sc.toId || peerId,
          method: "gridalive",
        });
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
      let dir: RecentsItem["dir"] = "out";
      if (reason === "missed" || reason === "reject" || reason === "no-answer" || (ph === "incoming" && dur === 0))
        dir = "missed";
      else if (ph === "incoming" || isIncoming) dir = "in";
      else if (ph === "outgoing" && dur === 0) dir = "out";
      else if (ph === "active") dir = isIncoming ? "in" : "out";
      pushRecent({
        id: String(Date.now()),
        peerId: peer.id,
        name: peer.name,
        dir,
        ts: Date.now(),
        duration: dur,
        method: callMethod || reason,
      });
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

  const sendSms = (peerId: string, name: string, text: string) => {
    const t = text.trim();
    if (!t) return;
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
      if (isSelfPeer(toId) || isSelfPeer(peerId)) {
        setErr("Cannot message yourself — dial the other number (9503154355 ↔ 9284048967)");
        return;
      }
      const id = `sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const row: SmsRow = { id, peerId: toId, name: toName, text: t, ts: Date.now(), mine: true, folder: "sent" };
      setSms((p) => [...p, row]);
      // Single directed path only — no walkie flood (that was self-echo)
      try {
        MeshEngine.broadcast("GRIDCALLER_SMS", {
          id,
          text: t,
          fromName: myName,
          to: toId,
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

  const callLogCounts = useMemo(() => {
    let missed = 0;
    let incoming = 0;
    let outgoing = 0;
    let blockedCount = 0;
    for (const r of recents) {
      if (r.dir === "missed") missed++;
      else if (r.dir === "in") incoming++;
      else outgoing++;
      const isBlockedLog = blockedPeersSet.has(r.peerId) || contacts.some((c) => c.peerId === r.peerId && c.spam);
      if (isBlockedLog) blockedCount++;
    }
    return { all: recents.length, missed, incoming, outgoing, blocked: blockedCount };
  }, [recents, blockedPeersSet, contacts]);

  const groupedCallLogs = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byKey = new Map<string, { key: string; peerId: string; name: string; entries: RecentsItem[] }>();

    for (const entry of recents) {
      const key = callLogGroupKey(entry.peerId, entry.name);
      const existing = byKey.get(key);
      if (existing) existing.entries.push(entry);
      else byKey.set(key, { key, peerId: entry.peerId, name: entry.name, entries: [entry] });
    }

    const groups = Array.from(byKey.values())
      .map((group) => {
        const sortedEntries = [...group.entries].sort((a, b) => b.ts - a.ts);
        const blocked = blockedPeersSet.has(group.peerId) || contacts.some((c) => c.peerId === group.peerId && c.spam);
        const missedCount = sortedEntries.filter((e) => e.dir === "missed").length;
        const incomingCount = sortedEntries.filter((e) => e.dir === "in").length;
        const outgoingCount = sortedEntries.filter((e) => e.dir !== "missed" && e.dir !== "in").length;
        const lastEntry = sortedEntries[0];
        return {
          key: group.key,
          peerId: group.peerId,
          name: group.name,
          displayName: group.name || group.peerId,
          entries: sortedEntries,
          missedCount,
          incomingCount,
          outgoingCount,
          totalCount: sortedEntries.length,
          blocked,
          lastEntry,
        };
      })
      .sort((a, b) => (b.lastEntry?.ts || 0) - (a.lastEntry?.ts || 0));

    return groups.filter((group) => {
      if (callLogFilter === "missed" && group.missedCount === 0) return false;
      if (callLogFilter === "in" && group.incomingCount === 0) return false;
      if (callLogFilter === "out" && group.outgoingCount === 0) return false;
      if (callLogFilter === "blocked" && !group.blocked) return false;

      if (!qq) return true;
      const hay = `${group.displayName} ${group.peerId} ${group.entries.map((e) => e.method).join(" ")} ${group.entries
        .map((e) => callLogDirectionLabel(e.dir))
        .join(" ")}`.toLowerCase();
      return hay.includes(qq) || (qq === "miss" && group.missedCount > 0) || (qq === "in" && group.incomingCount > 0) || (qq === "out" && group.outgoingCount > 0);
    });
  }, [recents, q, callLogFilter, blockedPeersSet, contacts]);

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
      setContactBusy(res.error || "Device import unavailable");
      if (res.error && !/cancel/i.test(res.error)) setErr(res.error);
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
    const name = peers.find((p) => p.id === thread)?.name || recents.find((r) => r.peerId === thread)?.name || sms.find((m) => m.peerId === thread)?.name || thread.slice(0, 10);
    return (
      <ThemeCtx.Provider value={tokens}>
      <Shell>
        <NavBar
          title={name}
          left={<Back onClick={() => setThread(null)} />}
          right={
            <div style={{ display: "flex", gap: 6 }}>
              {threadMsgs.length > 0 && (
                <button
                  type="button"
                  title="Clear conversation"
                  onClick={() => deleteMessageThread(thread)}
                  style={{
                    border: `1px solid ${tokens.red}55`,
                    background: `${tokens.red}14`,
                    color: tokens.red,
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Trash2 size={14} /> Clear chat
                </button>
              )}
            </div>
          }
        />
        {contactBusy ? (
          <div style={{ padding: "6px 16px", fontSize: 12, color: tokens.green, fontWeight: 600 }}>{contactBusy}</div>
        ) : null}
        <div className="gc-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "12px 16px 8px" }}>

          {threadMsgs.length === 0 && (
            <div style={{ textAlign: "center", color: tokens.label, fontSize: 13, padding: 20 }}>
              No messages yet — type below to compose
            </div>
          )}
          {threadMsgs.map((m) => (
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
                style={{
                  maxWidth: "72%",
                  background: m.mine ? tokens.blue : tokens.card,
                  color: m.mine ? "#fff" : tokens.text,
                  borderRadius: 18,
                  padding: "10px 14px",
                  fontSize: 16,
                  lineHeight: 1.35,
                  boxShadow: tokens.shadow,
                  border: m.mine ? "none" : `1px solid ${tokens.sep}`,
                  position: "relative",
                }}
              >
                {m.text}
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
              {m.mine ? null : null}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 12px 16px",
            background: tokens.bar,
            backdropFilter: tokens.blur,
            borderTop: `0.5px solid ${tokens.sep}`,
          }}
        >
          <input
            value={smsDraft}
            onChange={(e) => setSmsDraft(e.target.value)}
            placeholder="Type a message…"
            style={{
              flex: 1,
              border: `1px solid ${tokens.sep}`,
              background: tokens.inputBg,
              color: tokens.text,
              borderRadius: 18,
              padding: "10px 14px",
              fontSize: 16,
              outline: "none",
              boxShadow: tokens.shadow,
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
              sendSms(thread, name, smsDraft);
              setSmsDraft("");
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              border: "none",
              background: tokens.blue,
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ↑
          </button>
        </div>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button
              type="button"
              title="Menu"
              onClick={() => {
                setMenuView("home");
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
              <img src="/logo.png" alt="GridCaller logo" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, color: tokens.text }}>GridCaller</div>
              <div style={{ fontSize: 14, color: tokens.text, marginTop: 3, fontWeight: 700 }}>
                {myGridDisplay ||
                  (globalHandle && String(globalHandle).replace(/\D/g, "").length >= 8
                    ? formatTestPhone(globalHandle)
                    : globalHandle) ||
                  "No number set"}
              </div>
              <div style={{ fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                <span style={{ color: hubStatus.connected || autoMeshStatus?.trysteroOk ? tokens.green : tokens.red }}>
                  {hubStatus.connected
                    ? "● PC + phones mesh ON"
                    : autoMeshStatus?.trysteroOk
                      ? "● Swarm mesh ON"
                      : "○ Connecting mesh…"}
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
                Mesh ready
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
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
        <div style={{ display: "flex", gap: 0, marginBottom: 0 }}>
          {(
            [
              { id: "recents" as Tab, label: "Recents" },
              { id: "contacts" as Tab, label: "Contacts" },
              { id: "keypad" as Tab, label: "Keypad" },
              { id: "sms" as Tab, label: "Messages" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                padding: "10px 4px 12px",
                fontSize: 13,
                fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? tokens.blue : tokens.label,
                borderBottom: tab === t.id ? `2px solid ${tokens.blue}` : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {(tab === "recents" || tab === "contacts") && (
        <div style={{ padding: "10px 16px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: tokens.fill, borderRadius: 10, padding: "8px 12px" }}>
            <Search size={15} color={tokens.label} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                tab === "recents"
                  ? "Search name, number, or ID"
                  : "Search contacts"
              }
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

      {err && (
        <div style={{ margin: "8px 16px", padding: 12, borderRadius: 12, background: "#FF3B3014", color: T.red, fontSize: 13 }}>
          {err}{" "}
          <button onClick={() => setErr("")} style={{ border: "none", background: "none", color: T.blue, cursor: "pointer" }}>
            Dismiss
          </button>
        </div>
      )}

      <div className="gc-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 16, WebkitOverflowScrolling: "touch" as any }}>
        {/* LIVE mesh peers — detailed cards + mesh group calling */}
        {peers.filter((p) => p.online && !isSelfPeer(p.id)).length > 0 && (
          <div style={{ margin: "8px 12px 4px", padding: 12, borderRadius: 14, background: tokens.card, border: `1px solid ${tokens.sep}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: meshPeersCollapsed ? 0 : 8 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: tokens.green }}>
                ONLINE ON MESH ({peers.filter((p) => p.online && !isSelfPeer(p.id)).length})
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
                {selectedGroupPeers.length > 0 && (
                  <button
                    type="button"
                    onClick={startMeshGroupCall}
                    style={{ border: "none", background: tokens.blue, color: "#fff", borderRadius: 999, padding: "6px 10px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
                  >
                    Group ({selectedGroupPeers.length})
                  </button>
                )}
                {groupSelection.length > 0 && (
                  <button
                    type="button"
                    onClick={clearGroupSelection}
                    style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, padding: "6px 10px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMeshPeersCollapsed((v) => !v)}
                  style={{ border: `1px solid ${tokens.sep}`, background: tokens.fill, color: tokens.text, borderRadius: 999, width: 28, height: 28, display: "grid", placeItems: "center", cursor: "pointer" }}
                  title={meshPeersCollapsed ? "Expand peers" : "Collapse peers"}
                >
                  {meshPeersCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </div>
            </div>
            {groupSelection.length > 0 && (
              <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 10, background: `${tokens.blue}14`, color: tokens.blue, fontSize: 12, fontWeight: 700 }}>
                Selected for mesh group: {selectedGroupPeers.map((p) => p.name).join(" · ")}
              </div>
            )}
            {!meshPeersCollapsed && peers
              .filter((p) => p.online && !isSelfPeer(p.id))
              .map((p) => {
                const selected = groupSelection.includes(p.id);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 0",
                      borderBottom: `1px solid ${tokens.sep}`,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        background: selected ? `${tokens.blue}22` : `${tokens.green}18`,
                        color: selected ? tokens.blue : tokens.green,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {initials(p.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: tokens.text }}>
                        {p.name}
                        {p.handle ? (
                          <span style={{ color: tokens.blue, fontWeight: 600 }}> · @{p.handle}</span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: tokens.label, marginTop: 2, wordBreak: "break-all" }}>
                        {p.phone ? `📞 ${p.phone}` : ""}
                        {p.phone && p.id ? " · " : ""}
                        {p.id}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: `${tokens.green}18`, color: tokens.green }}>Online</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: `${tokens.blue}16`, color: tokens.blue }}>Mesh-ready</span>
                        {p.phone ? <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: `${tokens.orange}16`, color: tokens.orange }}>Mobile</span> : null}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => toggleGroupSelection(p.id)}
                        style={{ border: "none", background: selected ? `${tokens.orange}18` : `${tokens.fill}`, color: selected ? tokens.orange : tokens.text, borderRadius: 10, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }}
                        title={selected ? "Remove selection" : "Select peer"}
                      >
                        {selected ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void placeCallLocal(p.id, p.name);
                        }}
                        style={{ border: "none", background: tokens.green, color: "#041510", borderRadius: 10, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }}
                        title="Call"
                      >
                        <Phone size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => msgMeshNetwork(p.id, p.name)}
                        style={{ border: "none", background: tokens.blue, color: "#fff", borderRadius: 10, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }}
                        title="Message"
                      >
                        <MessageCircle size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
        {tab === "recents" && (
          <>
            <div
              style={{
                padding: "8px 12px",
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ flex: 1, minWidth: 100, fontSize: 13, color: tokens.label, fontWeight: 700 }}>
                Call logs ({groupedCallLogs.length}
                {groupedCallLogs.length !== recents.length ? ` of ${recents.length}` : ""})
              </span>
              <button
                type="button"
                onClick={clearCallLogs}
                disabled={recents.length === 0}
                style={{
                  ...contactChipStyle(tokens),
                  opacity: recents.length === 0 ? 0.45 : 1,
                  border: `1px solid ${tokens.red}55`,
                  color: tokens.red,
                  background: `${tokens.red}12`,
                  fontWeight: 700,
                }}
              >
                <Trash2 size={14} /> Clear all
              </button>
            </div>

            {/* Type filter: All / Missed / Incoming / Outgoing */}
            <div
              style={{
                padding: "0 12px 10px",
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              {(
                [
                  { id: "all" as const, label: "All", count: callLogCounts.all, color: tokens.blue },
                  { id: "missed" as const, label: "Missed", count: callLogCounts.missed, color: tokens.red },
                  { id: "in" as const, label: "Incoming", count: callLogCounts.incoming, color: tokens.green },
                  { id: "out" as const, label: "Outgoing", count: callLogCounts.outgoing, color: tokens.blue },
                  { id: "blocked" as const, label: "Blocked", count: callLogCounts.blocked, color: tokens.orange },
                ] as const
              ).map((f) => {
                const active = callLogFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setCallLogFilter(f.id)}
                    style={{
                      border: active ? "none" : `1px solid ${tokens.sep}`,
                      background: active ? f.color : tokens.card,
                      color: active ? "#fff" : tokens.text,
                      borderRadius: 16,
                      padding: "7px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {f.id === "missed" ? (
                      <PhoneMissed size={13} />
                    ) : f.id === "in" ? (
                      <PhoneIncoming size={13} />
                    ) : f.id === "out" ? (
                      <PhoneOutgoing size={13} />
                    ) : null}
                    {f.label}
                    <span style={{ opacity: active ? 0.9 : 0.65, fontWeight: 600 }}>{f.count}</span>
                  </button>
                );
              })}
            </div>

            {contactBusy ? (
              <div style={{ padding: "0 16px 8px", fontSize: 12, color: tokens.green, fontWeight: 600 }}>{contactBusy}</div>
            ) : null}
          <CardList>
            {groupedCallLogs.length === 0 && (
              <EmptyState
                title={
                  recents.length === 0
                    ? "No call logs yet"
                    : callLogFilter !== "all" || q.trim()
                      ? "No matching logs"
                      : "No call logs yet"
                }
                body={
                  recents.length === 0
                    ? "Incoming, outgoing, and missed calls appear here after you place or receive a call."
                    : "Try another filter or search by name, number, or ID."
                }
              />
            )}
            {groupedCallLogs.map((group) => {
              const latest = group.lastEntry;
              const Icon = latest?.dir === "missed" ? PhoneMissed : latest?.dir === "in" ? PhoneIncoming : PhoneOutgoing;
              const isMobile = looksLikePhoneNumber(group.peerId);
              const meta = callLogDirMeta(latest?.dir || "out");
              const dirColor = latest?.dir === "missed" ? tokens.red : latest?.dir === "in" ? tokens.green : tokens.blue;
              const dirBg = latest?.dir === "missed" ? `${tokens.red}18` : latest?.dir === "in" ? `${tokens.green}18` : `${tokens.blue}18`;
              return (
                <div
                  key={group.key}
                  style={{
                    borderBottom: `0.5px solid ${tokens.sep}`,
                    background: tokens.card,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        background: dirBg,
                        color: dirColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 600,
                        fontSize: 15,
                        flexShrink: 0,
                        border: `1px solid ${dirColor}33`,
                      }}
                    >
                      <Icon size={20} strokeWidth={2.25} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: latest?.dir === "missed" ? tokens.red : tokens.text }}>
                          {group.displayName || group.peerId}
                        </div>
                        {group.blocked ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: tokens.orange }}>Blocked</span>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: dirColor, background: dirBg, borderRadius: 999, padding: "3px 8px" }}>
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: tokens.label }}>
                          {group.totalCount} call{group.totalCount === 1 ? "" : "s"}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: tokens.label }}>
                          {group.missedCount > 0 ? `${group.missedCount} missed` : ""}
                          {group.missedCount > 0 && (group.incomingCount > 0 || group.outgoingCount > 0) ? " · " : ""}
                          {group.incomingCount > 0 ? `${group.incomingCount} incoming` : ""}
                          {group.incomingCount > 0 && group.outgoingCount > 0 ? " · " : ""}
                          {group.outgoingCount > 0 ? `${group.outgoingCount} outgoing` : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: tokens.secondary, marginTop: 6, fontWeight: 600 }}>
                        {latest ? fullDateTime(latest.ts) : "—"}
                      </div>
                      <div style={{ fontSize: 11, color: tokens.label, marginTop: 2, wordBreak: "break-all" }}>
                        {group.peerId || "Unknown"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => deleteCallLogGroup(group.peerId)}
                      style={{
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
                      onClick={() => (isMobile ? void callAnyMobile(group.peerId, group.displayName) : callMeshNetwork(group.peerId, group.displayName))}
                      style={{
                        flex: 1,
                        minWidth: 72,
                        border: "none",
                        background: `${tokens.green}22`,
                        color: tokens.green,
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
                      <Phone size={15} /> Call
                    </button>
                    <button
                      type="button"
                      onClick={() => (isMobile ? void msgAnyMobile(group.peerId) : msgMeshNetwork(group.peerId, group.displayName))}
                      style={{
                        flex: 1,
                        minWidth: 72,
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
                      <MessageCircle size={15} /> Msg
                    </button>
                  </div>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {group.entries.slice(0, 4).map((entry) => {
                      const entryIcon = entry.dir === "missed" ? PhoneMissed : entry.dir === "in" ? PhoneIncoming : PhoneOutgoing;
                      const entryMeta = callLogDirMeta(entry.dir);
                      return (
                        <div key={entry.id} style={{ padding: "8px 10px", borderRadius: 10, background: `${tokens.fill}`, border: `1px solid ${tokens.sep}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: entry.dir === "missed" ? tokens.red : entry.dir === "in" ? tokens.green : tokens.blue }}>
                            <entryIcon size={12} />
                            {entryMeta.label}
                          </div>
                          <div style={{ fontSize: 12, color: tokens.label, marginTop: 3 }}>
                            {fullDateTime(entry.ts)}
                            {entry.duration > 0 ? ` · ${fmt(entry.duration)}` : entry.dir === "missed" ? " · No answer" : " · Not connected"}
                            {entry.method ? ` · ${entry.method}` : ""}
                          </div>
                        </div>
                      );
                    })}
                    {group.entries.length > 4 ? <div style={{ fontSize: 11, color: tokens.label }}>+ {group.entries.length - 4} more entries</div> : null}
                  </div>
                </div>
              );
            })}
          </CardList>
          </>
        )}

        {tab === "contacts" && (
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
                accept="application/json,.json"
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
                  title="No contacts"
                  body="Tap Add to create one."
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

        {tab === "keypad" && (
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

        {tab === "sms" && (
          <>
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
                <EmptyState title="No messages" body="This folder is empty. Start a conversation or save a draft." />
              )}
              {smsThreads.map((t) => (
                <div
                  key={t.peerId}
                  style={{
                    borderBottom: `0.5px solid ${tokens.sep}`,
                    background: tokens.card,
                    padding: "12px 14px",
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
                        {t.text}
                      </div>
                      <div style={{ fontSize: 11, color: tokens.label, marginTop: 3 }}>{fullDateTime(t.ts)}</div>
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
              ))}
            </CardList>
          </>
        )}
      </div>

      {/* ═══ Hamburger menu: network people + map + settings ═══ */}
      {menuOpen && (
        <div
          className="gc-overlay"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            boxSizing: "border-box",
          }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(86%, 340px)",
              maxWidth: "100%",
              height: "100%",
              maxHeight: "100%",
              background: tokens.card,
              borderRight: `1px solid ${tokens.sep}`,
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
                onClick={() => (menuView === "home" ? setMenuOpen(false) : setMenuView("home"))}
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
                      <span style={{ fontWeight: 700, color: tokens.text }}>Online</span>
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: tokens.blue }}>{networkPeopleCount}</div>
                    <div style={{ fontSize: 13, color: tokens.label }}>
                      Local {peers.filter((p) => p.online).length} · Global{" "}
                      {globalPeers.filter((p) => p.online).length}
                      {meshMapPeers.length ? ` · Map ${meshMapPeers.length}` : ""}
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
                        </div>
                      );
                    })()}
                  </div>

                  {(
                    [
                      { id: "share" as const, icon: <Share2 size={20} color={tokens.green} />, title: "Share app" },
                      { id: "privacy" as const, icon: <Shield size={20} color={isPrivacyMode() ? tokens.green : tokens.orange} />, title: "Privacy" },
                      { id: "devices" as const, icon: <Wifi size={20} color={tokens.blue} />, title: "Devices" },
                      { id: "tower" as const, icon: <Smartphone size={20} color={tokens.blue} />, title: "Network" },
                      { id: "profile" as const, icon: <IdCard size={20} color={tokens.blue} />, title: "Profile" },
                      { id: "radio" as const, icon: <Volume2 size={20} color={tokens.green} />, title: "Radio" },
                      { id: "map" as const, icon: <MapIcon size={20} color={tokens.blue} />, title: "Map" },
                      { id: "settings" as const, icon: <Settings size={20} color={tokens.orange} />, title: "Settings" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.id === "profile") setMyCard(loadMyCard());
                        if (item.id === "settings") setSettingsName(myName);
                        if (item.id === "share") {
                          void getPrimaryApk().then((a) =>
                            setApkInfo(a ? { name: a.file.name, url: a.url, size: a.file.size } : null)
                          );
                        }
                        setMenuView(item.id);
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
                        if (r.url) setApkInfo((a) => ({ name: a?.name || "GridCaller.apk", url: r.url!, size: a?.size }));
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
                        if (r.url) setApkInfo((a) => ({ name: a?.name || "GridCaller.apk", url: r.url!, size: a?.size }));
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
                        setApkInfo(apk ? { name: apk.file.name, url: apk.url, size: apk.file.size } : null);
                        const list = await listApkFiles();
                        const apks = list.filter((f) => f.isApk || f.name.endsWith(".apk"));
                        setShareMsg(
                          apks.length
                            ? `✅ ${apks.length} APK ready · ${apk?.url || ""}`
                            : `No APK list — try direct: ${apk?.url || "hub /share/GridCaller.apk"}`
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
                    <a
                      href={apkInfo.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, color: tokens.blue, wordBreak: "break-all" }}
                    >
                      {apkInfo.url}
                    </a>
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
                            No nearby peers yet.
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
                          Every nearby GridCaller can act as a relay tower, so calls and texts can hop across the mesh automatically.
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
                    Mesh is automatic. With permissions already granted, nearby GridCaller devices join the shared network by default for calls and texts.
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
                    Wi‑Fi is reused as a shared mesh path, so once devices are in range they can stay interconnected for calling and texting without extra setup.
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
                        <div style={{ fontSize: 13, color: tokens.green, marginTop: 8, fontWeight: 600 }}>
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
                    onClick={() => {
                      void freeRadio.setChannel(radioChannel, radioSecret);
                      void freeRadio.enable(true);
                      freeRadio.setOperatorName(myName);
                      setIdSaveMsg(`Joined ${radioChannel}`);
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
                      marginBottom: 10,
                    }}
                  >
                    Join channel
                  </button>
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
                    {freeRadio.messages.length === 0 ? (
                      <span style={{ color: tokens.label }}>No messages</span>
                    ) : (
                      freeRadio.messages.slice(-30).map((m) => (
                        <div key={m.id} style={{ marginBottom: 6, color: tokens.text }}>
                          <b style={{ color: tokens.blue }}>{m.fromName}</b>: {m.text}
                        </div>
                      ))
                    )}
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
              )}

              {menuView === "map" && (
                <>
                  <div style={{ fontSize: 13, color: tokens.label, marginBottom: 8 }}>
                    {meshMapPeers.length === 0 && !myGps
                      ? "Location permission is required to share your map position with nearby GridCaller phones."
                      : `${meshMapPeers.length} nearby · blue = you · green = others · auto-mesh`}
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
                    {meshMapPeers.length === 0 ? (
                      <div style={{ fontSize: 13, color: tokens.label }}>
                        Waiting for another device.
                      </div>
                    ) : (
                      meshMapPeers.map((p) => (
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
                            <span>
                              {p.online ? "●" : "○"} {p.name}
                              {p.displayNumber || p.phone ? (
                                <span style={{ color: tokens.label }}> · {p.displayNumber || p.phone}</span>
                              ) : null}
                            </span>
                            <span style={{ color: tokens.label, flexShrink: 0 }}>
                              {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                              {p.distance != null ? ` · ${Math.round(p.distance)}m` : ""}
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
                            ? `Ready · ${st.provider}`
                            : `Not live · ${st.provider}`
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
