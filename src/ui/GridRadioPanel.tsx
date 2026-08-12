import { useEffect, useMemo, useState } from "react";
import { Mic, MicOff, PhoneOff, Radio, Search, Users, Volume2, VolumeX } from "lucide-react";
import radioSession, {
  buildRadioUsers,
  type RadioSessionSnapshot,
} from "../kernel/radioSession";

type Peer = {
  id: string;
  name?: string;
  online?: boolean;
  lastSeen?: number;
  via?: string[];
  transports?: string[];
};

export function GridRadioPanel({ peers, localIds }: { peers: Peer[]; localIds: string[] }) {
  const [snapshot, setSnapshot] = useState<RadioSessionSnapshot>(() => radioSession.snapshot());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"people" | "groups" | "recent">("people");
  const localIdKey = localIds.join("|");
  const users = useMemo(() => buildRadioUsers(peers, localIds), [peers, localIdKey]);

  useEffect(() => radioSession.subscribe(setSnapshot), []);
  useEffect(() => radioSession.setUsers(users), [users]);

  const visible = users.filter((user) => {
    if (tab === "recent" && !user.lastSeen) return false;
    const text = `${user.name} ${user.id}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const active = snapshot.selected;
  const live = ["CONNECTED", "TRANSMITTING", "RECEIVING"].includes(snapshot.state);

  const press = () => {
    try { radioSession.pressToTalk(); } catch {}
  };
  const release = () => radioSession.releaseToTalk();

  return (
    <div className="grid-radio-panel">
      <div className="grid-radio-title"><Radio size={20} /> Grid Radio</div>
      <div className="grid-radio-tabs">
        {(["people", "groups", "recent"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item === "groups" ? <Users size={14} /> : null}{item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "groups" ? (
        <div className="grid-radio-notice">
          Group floor control is defined, but production group WebRTC audio is not yet connected. Direct radio remains available.
        </div>
      ) : (
        <>
          <label className="grid-radio-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Grid users" /></label>
          <div className="grid-radio-users">
            {visible.length ? visible.map((user) => (
              <button key={user.id} className={active?.id === user.id ? "selected" : ""} onClick={() => radioSession.select(user)}>
                <span className="grid-radio-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                <span className="grid-radio-user-copy">
                  <strong>{user.name}</strong>
                  <small>{user.id}</small>
                  <small>{user.online ? "ONLINE" : user.lastSeen ? `Last seen ${new Date(user.lastSeen).toLocaleString()}` : "OFFLINE"}</small>
                </span>
                <span className={`grid-radio-dot ${user.online ? "online" : ""}`} />
              </button>
            )) : <div className="grid-radio-empty">No discovered Grid users.</div>}
          </div>
        </>
      )}

      {active ? (
        <section className={`grid-radio-active state-${snapshot.state.toLowerCase()}`}>
          <small>{snapshot.incoming ? "INCOMING RADIO" : "ACTIVE RADIO"}</small>
          <h3>{active.name}</h3>
          <code>{active.id}</code>
          <div className="grid-radio-state">{snapshot.state}</div>
          {snapshot.error ? <div className="grid-radio-error">{snapshot.error}</div> : null}

          {snapshot.incoming ? (
            <div className="grid-radio-actions">
              <button onClick={() => void radioSession.acceptIncoming()}>Accept / Listen</button>
              <button className="danger" onClick={() => radioSession.rejectIncoming()}>Reject</button>
            </div>
          ) : !live ? (
            <button className="grid-radio-connect" disabled={!active.online || snapshot.state === "CONNECTING"} onClick={() => void radioSession.connect()}>
              {snapshot.state === "CONNECTING" ? "Connecting actual audio…" : active.online ? "Connect radio" : "Peer offline"}
            </button>
          ) : (
            <button
              className={`grid-radio-ptt ${snapshot.state === "TRANSMITTING" ? "transmitting" : ""}`}
              disabled={snapshot.state === "RECEIVING" || !snapshot.microphoneReady || !snapshot.remoteAudioReady}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); press(); }}
              onPointerUp={release}
              onPointerCancel={release}
              onLostPointerCapture={release}
            >
              {snapshot.state === "TRANSMITTING" ? <Mic size={30} /> : snapshot.state === "RECEIVING" ? <Volume2 size={30} /> : <MicOff size={30} />}
              <strong>{snapshot.state === "TRANSMITTING" ? "TRANSMITTING" : snapshot.state === "RECEIVING" ? `RECEIVING ${active.name}` : "HOLD TO TALK"}</strong>
              <span>{snapshot.state === "TRANSMITTING" ? "Release to stop" : ""}</span>
            </button>
          )}

          <div className="grid-radio-controls">
            <button onClick={() => void radioSession.setSpeaker(!snapshot.speakerOn)}>{snapshot.speakerOn ? <Volume2 size={16} /> : <VolumeX size={16} />} Speaker</button>
            <button className="danger" onClick={() => radioSession.disconnect()}><PhoneOff size={16} /> Disconnect</button>
          </div>
          <div className="grid-radio-readiness">
            Mic: {snapshot.microphoneReady ? "READY" : "NOT READY"} · Remote audio: {snapshot.remoteAudioReady ? "READY" : "NOT READY"}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default GridRadioPanel;
