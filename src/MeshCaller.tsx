/**
 * Truecaller-style Mesh Caller UI
 * SIM-free calls + messages over software multi-hop mesh.
 * All existing MeshComms / MeshEngine functions stay active.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Video, MessageCircle, Search, Mic, MicOff, Volume2, VolumeX,
  ArrowLeft, Send, MoreVertical, Shield, Wifi, Users, Clock,
  Check, CheckCheck, X,
} from "lucide-react";
import MeshComms from "./lib/meshComms";
import { MeshEngine } from "./lib/meshEngine";

// Truecaller-inspired palette (independent styling — not their assets/branding)
const TC = {
  primary: "#0087cc",
  primaryDark: "#006ba3",
  teal: "#00a884",
  green: "#25d366",
  red: "#e53935",
  bg: "#0b141a",
  surface: "#111b21",
  surface2: "#1f2c34",
  border: "#2a3942",
  text: "#e9edef",
  muted: "#8696a0",
  bubbleOut: "#005c4b",
  bubbleIn: "#202c33",
  gold: "#f7c948",
};

type Tab = "calls" | "messages" | "contacts";

function initials(name: string) {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
}

function avatarColor(id: string) {
  const colors = [
    "#00897B", "#039BE5", "#7B1FA2", "#C2185B", "#F4511E",
    "#43A047", "#5E35B1", "#00ACC1", "#6D4C41", "#546E7A",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 17) % colors.length;
  return colors[h];
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fmtDuration(sec: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function Avatar({ name, id, size = 48, online }: { name: string; id: string; size?: number; online?: boolean }) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: avatarColor(id),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: size * 0.34,
          letterSpacing: 0.5,
        }}
      >
        {initials(name)}
      </div>
      {online != null && (
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: "50%",
            background: online ? TC.green : TC.muted,
            border: `2px solid ${TC.surface}`,
          }}
        />
      )}
    </div>
  );
}

export default function MeshCaller({ user, MeshEngine: ME, S }: any) {
  const engine = ME || MeshEngine;
  const [tab, setTab] = useState<Tab>("calls");
  const [search, setSearch] = useState("");
  const [tick, setTick] = useState(0);
  const [peers, setPeers] = useState(() => engine.getPeerList());
  const [threadPeer, setThreadPeer] = useState<string | null>(null);
  const [profilePeer, setProfilePeer] = useState<string | null>(null);
  const [dmText, setDmText] = useState("");
  const [err, setErr] = useState("");
  const [callSeconds, setCallSeconds] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    MeshComms.start();
    const unsub = MeshComms.subscribe(() => setTick((n) => n + 1));
    const unsubM = engine.onMessage(() => setPeers(engine.getPeerList()));
    const iv = setInterval(() => setPeers(engine.getPeerList()), 2000);
    return () => {
      unsub();
      unsubM();
      clearInterval(iv);
    };
  }, []);

  const call = MeshComms.call;

  useEffect(() => {
    if (!call || call.state === "ended") {
      setCallSeconds(0);
      return;
    }
    const iv = setInterval(() => {
      const base = call.connectedAt || call.startedAt || Date.now();
      setCallSeconds(Math.floor((Date.now() - base) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [call?.callId, call?.state, call?.connectedAt]);

  useEffect(() => {
    MeshComms.attachRemoteAudio(remoteAudioRef.current);
    if (localVideoRef.current && MeshComms.localStream) {
      localVideoRef.current.srcObject = MeshComms.localStream;
    }
    if (remoteVideoRef.current && MeshComms.remoteStream) {
      remoteVideoRef.current.srcObject = MeshComms.remoteStream;
    }
  }, [tick, call?.state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadPeer, tick]);

  const contacts = useMemo(() => {
    const list = MeshComms.getContacts();
    // ensure live peers appear
    for (const p of peers) {
      if (!list.find((c) => c.id === p.id)) {
        list.push({ id: p.id, name: p.name, lastSeen: p.lastSeen, isMesh: true });
      }
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    );
  }, [peers, search, tick]);

  const history = useMemo(() => {
    const q = search.trim().toLowerCase();
    let h = MeshComms.callHistory;
    if (q) h = h.filter((x) => x.peerName.toLowerCase().includes(q) || x.peerId.includes(q));
    return h;
  }, [search, tick]);

  const conversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    let c = MeshComms.getConversations();
    if (q) c = c.filter((x) => x.peerName.toLowerCase().includes(q));
    return c;
  }, [search, tick]);

  const thread = threadPeer ? MeshComms.getThread(threadPeer) : [];
  const threadName =
    contacts.find((c) => c.id === threadPeer)?.name ||
    peers.find((p: any) => p.id === threadPeer)?.name ||
    threadPeer?.slice(0, 12) ||
    "";

  const online = (id: string) => peers.some((p: any) => p.id === id && p.online);
  const meshStatus = engine.getStatus();

  const doCall = async (id: string, name: string, video: boolean) => {
    setErr("");
    try {
      await MeshComms.startCall(id, name, video);
    } catch (e: any) {
      setErr(e?.message || "Call failed");
    }
  };

  const sendMsg = () => {
    if (!threadPeer || !dmText.trim()) return;
    MeshComms.sendDm(threadPeer, dmText.trim(), threadName);
    setDmText("");
  };

  const openChat = (id: string) => {
    setThreadPeer(id);
    MeshComms.markThreadRead(id);
    setProfilePeer(null);
  };

  // ── FULL-SCREEN CALL UI (Truecaller-style) ──
  const showCallUi =
    call &&
    (call.state === "incoming" ||
      call.state === "outgoing" ||
      call.state === "connecting" ||
      call.state === "active");

  if (showCallUi && call) {
    const statusLabel =
      call.state === "incoming"
        ? "Incoming"
        : call.state === "outgoing"
          ? "Calling…"
          : call.state === "connecting"
            ? "Connecting…"
            : "In call";

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "linear-gradient(165deg, #0a3d5c 0%, #0b141a 45%, #062820 100%)",
          color: TC.text,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "48px 24px 40px",
          maxWidth: 520,
          margin: "0 auto",
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
        }}
      >
        <audio ref={remoteAudioRef} autoPlay playsInline />
        <div style={{ textAlign: "center", width: "100%" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(0,168,132,0.2)",
              border: "1px solid rgba(0,168,132,0.4)",
              borderRadius: 20,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: TC.teal,
              marginBottom: 28,
            }}
          >
            <Shield size={14} /> SIM-free · Software mesh
          </div>

          <div style={{ position: "relative", display: "inline-block", marginBottom: 20 }}>
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: "50%",
                background: avatarColor(call.peerId),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 42,
                fontWeight: 800,
                color: "#fff",
                boxShadow: "0 0 0 6px rgba(0,135,204,0.25), 0 12px 40px rgba(0,0,0,0.4)",
                animation: call.state === "incoming" || call.state === "outgoing" ? "pulseRing 1.5s infinite" : "none",
              }}
            >
              {initials(call.peerName)}
            </div>
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 6px", letterSpacing: 0.3 }}>
            {call.peerName}
          </h1>
          <div style={{ fontSize: 12, color: TC.muted, fontFamily: "monospace", marginBottom: 8 }}>
            mesh:{call.peerId.slice(0, 14)}…
          </div>
          <div style={{ fontSize: 15, color: TC.primary, fontWeight: 600 }}>
            {call.state === "active"
              ? `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`
              : statusLabel}
          </div>
          {call.video && (
            <div style={{ fontSize: 12, color: TC.muted, marginTop: 4 }}>Video · WebRTC over mesh</div>
          )}
        </div>

        {call.video && (
          <div
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              maxHeight: 180,
            }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", borderRadius: 16, background: "#000", minHeight: 120, objectFit: "cover" }}
            />
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: "100%", borderRadius: 16, background: "#000", minHeight: 120, objectFit: "cover" }}
            />
          </div>
        )}

        {/* Controls */}
        <div style={{ width: "100%" }}>
          {call.state === "incoming" ? (
            <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => MeshComms.rejectCall()}
                  style={roundBtn(TC.red, 68)}
                >
                  <PhoneOff size={28} />
                </button>
                <div style={{ fontSize: 12, marginTop: 8, color: TC.muted }}>Decline</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => MeshComms.acceptCall()}
                  style={roundBtn(TC.green, 68)}
                >
                  <Phone size={28} />
                </button>
                <div style={{ fontSize: 12, marginTop: 8, color: TC.muted }}>Accept</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 18, justifyContent: "center", alignItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => MeshComms.setMuted(!call.muted)}
                  style={roundBtn(call.muted ? TC.red : TC.surface2, 56)}
                >
                  {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
                </button>
                <div style={{ fontSize: 11, marginTop: 6, color: TC.muted }}>Mute</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => MeshComms.endCall()}
                  style={roundBtn(TC.red, 72)}
                >
                  <PhoneOff size={30} />
                </button>
                <div style={{ fontSize: 11, marginTop: 6, color: TC.muted }}>End</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => MeshComms.setSpeaker(!call.speakerOn)}
                  style={roundBtn(call.speakerOn ? TC.primary : TC.surface2, 56)}
                >
                  {call.speakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
                </button>
                <div style={{ fontSize: 11, marginTop: 6, color: TC.muted }}>Speaker</div>
              </div>
            </div>
          )}
        </div>

        <style>{`
          @keyframes pulseRing {
            0% { box-shadow: 0 0 0 0 rgba(0,135,204,0.5); }
            70% { box-shadow: 0 0 0 18px rgba(0,135,204,0); }
            100% { box-shadow: 0 0 0 0 rgba(0,135,204,0); }
          }
        `}</style>
      </div>
    );
  }

  // ── CHAT THREAD ──
  if (threadPeer) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 110px)", background: TC.bg, color: TC.text }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: TC.surface,
            borderBottom: `1px solid ${TC.border}`,
          }}
        >
          <button onClick={() => setThreadPeer(null)} style={iconBtn()}>
            <ArrowLeft size={20} />
          </button>
          <Avatar name={threadName} id={threadPeer} size={40} online={online(threadPeer)} />
          <div style={{ flex: 1, minWidth: 0 }} onClick={() => setProfilePeer(threadPeer)}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{threadName}</div>
            <div style={{ fontSize: 11, color: online(threadPeer) ? TC.green : TC.muted }}>
              {online(threadPeer) ? "Online" : "Offline"}
            </div>
          </div>
          <button
            onClick={() => doCall(threadPeer, threadName, false)}
            style={iconBtn(TC.primary)}
            title="Audio call"
          >
            <Phone size={18} />
          </button>
          <button
            onClick={() => doCall(threadPeer, threadName, true)}
            style={iconBtn(TC.teal)}
            title="Video call"
          >
            <Video size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12, background: "#0b141a" }}>
          {thread.map((m) => {
            const mine = m.from === engine.localId;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: mine ? "flex-end" : "flex-start",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    maxWidth: "78%",
                    background: mine ? TC.bubbleOut : TC.bubbleIn,
                    borderRadius: mine ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    padding: "8px 10px 6px",
                    fontSize: 14,
                    lineHeight: 1.4,
                    boxShadow: "0 1px 1px rgba(0,0,0,0.2)",
                  }}
                >
                  {m.text}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 4,
                      fontSize: 10,
                      color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    {fmtTime(m.ts)}
                    {m.hops > 0 && <span>· {m.hops}h</span>}
                    {mine &&
                      (m.status === "delivered" ? (
                        <CheckCheck size={12} color="#53bdeb" />
                      ) : (
                        <Check size={12} />
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 10px",
            background: TC.surface,
            borderTop: `1px solid ${TC.border}`,
            alignItems: "flex-end",
          }}
        >
          <textarea
            value={dmText}
            onChange={(e) => setDmText(e.target.value)}
            placeholder="Message on mesh…"
            rows={1}
            style={{
              flex: 1,
              borderRadius: 22,
              border: "none",
              background: TC.surface2,
              color: TC.text,
              padding: "10px 16px",
              fontSize: 14,
              resize: "none",
              fontFamily: "inherit",
              maxHeight: 100,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMsg();
              }
            }}
          />
          <button
            onClick={sendMsg}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "none",
              background: TC.teal,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    );
  }

  // ── CONTACT PROFILE (Truecaller identify card) ──
  if (profilePeer) {
    const c =
      contacts.find((x) => x.id === profilePeer) ||
      ({ id: profilePeer, name: profilePeer.slice(0, 12), isMesh: true } as any);
    const isOn = online(profilePeer);
    return (
      <div style={{ background: TC.bg, color: TC.text, minHeight: "calc(100dvh - 110px)" }}>
        <div style={{ background: `linear-gradient(160deg, ${TC.primaryDark}, ${TC.bg})`, padding: "16px 16px 28px" }}>
          <button onClick={() => setProfilePeer(null)} style={{ ...iconBtn(), marginBottom: 16 }}>
            <ArrowLeft size={20} />
          </button>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <Avatar name={c.name} id={c.id} size={96} online={isOn} />
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{c.name}</h2>
            <div style={{ fontSize: 12, color: TC.muted, marginTop: 4, fontFamily: "monospace" }}>
              {c.id}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 10,
                background: "rgba(0,168,132,0.15)",
                color: TC.teal,
                padding: "4px 12px",
                borderRadius: 16,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {isOn ? "Online" : "Offline"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: -16, padding: "0 16px" }}>
          {[
            { icon: Phone, label: "Call", color: TC.green, fn: () => doCall(c.id, c.name, false) },
            { icon: Video, label: "Video", color: TC.primary, fn: () => doCall(c.id, c.name, true) },
            { icon: MessageCircle, label: "Message", color: TC.teal, fn: () => openChat(c.id) },
          ].map((a, i) => (
            <button
              key={i}
              onClick={a.fn}
              style={{
                flex: 1,
                background: TC.surface,
                border: `1px solid ${TC.border}`,
                borderRadius: 14,
                padding: "14px 8px",
                color: a.color,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              <a.icon size={22} />
              {a.label}
            </button>
          ))}
        </div>

        <div style={{ margin: 16, background: TC.surface, borderRadius: 14, padding: 14, border: `1px solid ${TC.border}` }}>
          <Row label="Status" value={isOn ? "Online" : "Offline"} />
          <Row label="ID" value={c.id.slice(0, 20) + "…"} mono />
        </div>
      </div>
    );
  }

  // ── MAIN TABS ──
  return (
    <div style={{ background: TC.bg, color: TC.text, minHeight: "calc(100dvh - 110px)" }}>
      {/* Header */}
      <div
        style={{
          background: TC.primary,
          padding: "14px 16px 10px",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: 0.3 }}>GridCall</div>
            <div style={{ fontSize: 11, opacity: 0.9, display: "flex", alignItems: "center", gap: 4 }}>
              <Wifi size={12} />
              {peers.filter((p: any) => p.online).length} online
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.15)",
              borderRadius: 20,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {user?.name || engine.localName}
          </div>
        </div>

        {/* Search */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255,255,255,0.95)",
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          <Search size={16} color="#667" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names, mesh IDs…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 14,
              color: "#111",
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ border: "none", background: "none", cursor: "pointer", color: "#667" }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Sub tabs */}
        <div style={{ display: "flex", marginTop: 12, gap: 0 }}>
          {(
            [
              { id: "calls" as Tab, label: "Calls" },
              { id: "messages" as Tab, label: "Messages" },
              { id: "contacts" as Tab, label: "Contacts" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                borderBottom: tab === t.id ? "3px solid #fff" : "3px solid transparent",
                color: "#fff",
                padding: "10px 4px",
                fontWeight: tab === t.id ? 800 : 500,
                fontSize: 13,
                cursor: "pointer",
                opacity: tab === t.id ? 1 : 0.75,
              }}
            >
              {t.label}
              {t.id === "messages" && MeshComms.unreadCount() > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    background: TC.red,
                    borderRadius: 10,
                    padding: "1px 6px",
                    fontSize: 10,
                  }}
                >
                  {MeshComms.unreadCount()}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div style={{ margin: 12, padding: 10, background: "#3d1a1a", color: "#ff8a80", borderRadius: 10, fontSize: 12 }}>
          {err}
          <button onClick={() => setErr("")} style={{ float: "right", border: "none", background: "none", color: "#ff8a80", cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* CALLS TAB */}
      {tab === "calls" && (
        <div>
          {/* Quick dial online peers */}
          {peers.filter((p: any) => p.online).length > 0 && (
            <div style={{ padding: "12px 16px 4px" }}>
              <div style={{ fontSize: 12, color: TC.muted, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Online now
              </div>
              <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
                {peers
                  .filter((p: any) => p.online)
                  .map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => setProfilePeer(p.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: TC.text,
                        cursor: "pointer",
                        textAlign: "center",
                        minWidth: 64,
                      }}
                    >
                      <Avatar name={p.name} id={p.id} size={56} online />
                      <div style={{ fontSize: 11, marginTop: 4, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div style={{ padding: "4px 0" }}>
            {history.length === 0 && (
              <Empty
                icon={<Phone size={36} />}
                title="No calls yet"
                sub="Call any mesh peer without a SIM. Open GridAlive on another device (same Wi‑Fi) or a second tab."
              />
            )}
            {history.map((h) => {
              const Icon =
                h.direction === "missed"
                  ? PhoneMissed
                  : h.direction === "in"
                    ? PhoneIncoming
                    : PhoneOutgoing;
              const color =
                h.direction === "missed" ? TC.red : h.direction === "in" ? TC.green : TC.primary;
              return (
                <div
                  key={h.id + h.ts}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: `1px solid ${TC.border}55`,
                    cursor: "pointer",
                  }}
                  onClick={() => setProfilePeer(h.peerId)}
                >
                  <Avatar name={h.peerName} id={h.peerId} size={48} online={online(h.peerId)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: h.direction === "missed" ? TC.red : TC.text,
                      }}
                    >
                      {h.peerName}
                    </div>
                    <div style={{ fontSize: 12, color: TC.muted, display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon size={12} color={color} />
                      {h.direction === "missed"
                        ? "Missed"
                        : h.direction === "in"
                          ? "Incoming"
                          : "Outgoing"}
                      {h.video ? " · Video" : " · Audio"}
                      {h.durationSec ? ` · ${fmtDuration(h.durationSec)}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: TC.muted }}>{fmtTime(h.ts)}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          doCall(h.peerId, h.peerName, false);
                        }}
                        style={smallRound(TC.green)}
                      >
                        <Phone size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openChat(h.peerId);
                        }}
                        style={smallRound(TC.teal)}
                      >
                        <MessageCircle size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MESSAGES TAB */}
      {tab === "messages" && (
        <div>
          {conversations.length === 0 && (
            <Empty
              icon={<MessageCircle size={36} />}
              title="No messages"
              sub="Open Contacts to start a chat."
            />
          )}
          {conversations.map((c) => (
            <div
              key={c.peerId}
              onClick={() => openChat(c.peerId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: `1px solid ${TC.border}55`,
                cursor: "pointer",
                background: c.unread ? "rgba(0,135,204,0.06)" : "transparent",
              }}
            >
              <Avatar name={c.peerName} id={c.peerId} size={52} online={c.online} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: c.unread ? 800 : 600, fontSize: 15 }}>{c.peerName}</div>
                  <div style={{ fontSize: 11, color: c.unread ? TC.primary : TC.muted }}>{fmtTime(c.ts)}</div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: TC.muted,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                  }}
                >
                  {c.lastText}
                </div>
              </div>
              {c.unread > 0 && (
                <div
                  style={{
                    background: TC.teal,
                    color: "#fff",
                    borderRadius: 12,
                    minWidth: 22,
                    height: 22,
                    fontSize: 11,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 6px",
                  }}
                >
                  {c.unread}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* CONTACTS TAB */}
      {tab === "contacts" && (
        <div>
          <div style={{ padding: "10px 16px", fontSize: 12, color: TC.muted }}>
            <Users size={12} style={{ display: "inline", marginRight: 4 }} />
            Mesh identities · identified without phone numbers
          </div>
          {contacts.length === 0 && (
            <Empty
              icon={<Users size={36} />}
              title="No contacts yet"
              sub="When peers join the mesh they appear here automatically — like caller ID for mesh IDs."
            />
          )}
          {contacts.map((c) => (
            <div
              key={c.id}
              onClick={() => setProfilePeer(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: `1px solid ${TC.border}55`,
                cursor: "pointer",
              }}
            >
              <Avatar name={c.name} id={c.id} size={48} online={online(c.id)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: TC.muted }}>
                  {online(c.id) ? "Online on mesh" : "Mesh contact"} · {c.id.slice(0, 10)}…
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  doCall(c.id, c.name, false);
                }}
                style={smallRound(TC.green)}
              >
                <Phone size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 28px", color: TC.muted }}>
      <div style={{ opacity: 0.4, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color: TC.text, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${TC.border}44` }}>
      <span style={{ fontSize: 12, color: TC.muted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit", textAlign: "right", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function roundBtn(bg: string, size: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: "50%",
    border: "none",
    background: bg,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  };
}

function iconBtn(color = TC.text): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}

function smallRound(bg: string): React.CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "none",
    background: bg + "22",
    color: bg,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}
