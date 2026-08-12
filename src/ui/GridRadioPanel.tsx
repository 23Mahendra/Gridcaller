import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Radio, Volume2, VolumeX } from "lucide-react";
import radioSession, { buildRadioUsers, type RadioSessionSnapshot } from "../kernel/radioSession";
import { radioChannelSession, type RadioChannelSnapshot } from "../kernel/radioChannelSession";

type Peer = { id: string; name?: string; online?: boolean; lastSeen?: number; via?: string[]; transports?: string[] };

const CHANNEL_ID = "grid-ch-1";

export function GridRadioPanel({ peers, localIds, localName }: { peers: Peer[]; localIds: string[]; localName: string }) {
  const [audio, setAudio] = useState<RadioSessionSnapshot>(() => radioSession.snapshot());
  const [channel, setChannel] = useState<RadioChannelSnapshot>(() => radioChannelSession.snapshot());
  const [joining, setJoining] = useState(false);
  const pressed = useRef(false);
  const localId = localIds.find(Boolean) || "";
  const localIdKey = localIds.join("|");
  const discovered = useMemo(() => buildRadioUsers(peers, localIds), [peers, localIdKey]);
  const members = useMemo(() => {
    const merged = new Map(discovered.map((peer) => [peer.id, peer]));
    for (const member of channel.members) {
      const peer = merged.get(member.id);
      merged.set(member.id, {
        id: member.id,
        name: member.name || peer?.name || member.id,
        online: member.connection === "online" || peer?.online === true,
        lastSeen: Math.max(member.lastSeen || 0, peer?.lastSeen || 0) || undefined,
        transports: peer?.transports || [],
      });
    }
    return [...merged.values()];
  }, [channel.members, discovered]);

  useEffect(() => radioSession.subscribe(setAudio), []);
  useEffect(() => radioChannelSession.subscribe(setChannel), []);
  useEffect(() => radioSession.setUsers(members.filter((member) => member.id !== localId)), [members, localId]);
  useEffect(() => () => {
    pressed.current = false;
    radioSession.disconnect();
    void radioChannelSession.leave();
  }, []);

  const join = async () => {
    if (!localId || joining) return;
    setJoining(true);
    try { await radioChannelSession.join(CHANNEL_ID, CHANNEL_ID, localId, localName); }
    catch { /* Session exposes the real unavailable state and error in its snapshot. */ }
    finally { setJoining(false); }
  };

  useEffect(() => { if (localId && channel.connection === "offline") void join(); }, [localId]);

  const beginPtt = async () => {
    if (audio.state !== "CONNECTED") return;
    pressed.current = true;
    try {
      if (channel.connection === "connected") {
        const granted = await radioChannelSession.acquireFloor(localName);
        if (!granted || !pressed.current) {
          if (granted) await radioChannelSession.releaseFloor();
          return;
        }
      }
      radioSession.pressToTalk();
    } catch {
      await radioChannelSession.releaseFloor().catch(() => false);
    }
  };

  const endPtt = () => {
    pressed.current = false;
    radioSession.releaseToTalk();
    if (channel.connection === "connected") void radioChannelSession.releaseFloor();
  };

  const leave = async () => {
    pressed.current = false;
    radioSession.disconnect();
    await radioChannelSession.leave();
  };

  const active = audio.selected;
  const live = ["CONNECTED", "TRANSMITTING", "RECEIVING"].includes(audio.state);
  const currentSpeaker = channel.speaker;

  return (
    <div className="grid-radio-panel">
      <header className="grid-radio-channel-head">
        <div><Radio size={22} /><span><strong>Radio</strong><small>{CHANNEL_ID}</small></span></div>
        <span className={`grid-radio-state-pill ${channel.connection}`}>{channel.connection.toUpperCase()}</span>
      </header>

      {channel.connection !== "connected" ? (
        <button className="grid-radio-connect" disabled={!localId || joining} onClick={() => void join()}>
          {joining || channel.connection === "connecting" ? "Joining local LAN channel…" : "Join channel"}
        </button>
      ) : null}
      {channel.error ? <div className="grid-radio-error">{channel.error}</div> : null}

      <section className="grid-radio-members">
        <div className="grid-radio-section-title"><span>Available users</span><strong>{members.filter((member) => member.online).length}</strong></div>
        <div className="grid-radio-users">
          {members.map((member) => {
            const self = member.id === localId;
            const speaking = currentSpeaker?.userId === member.id;
            return (
              <button key={member.id} disabled={self} className={active?.id === member.id ? "selected" : ""}
                onClick={() => !self && radioSession.select(member)}>
                <span className="grid-radio-avatar">{member.name.slice(0, 1).toUpperCase()}</span>
                <span className="grid-radio-user-copy"><strong>{member.name}{self ? " (you)" : ""}</strong><small>{member.id}</small>
                  <small>{speaking ? "Speaking…" : self && channel.connection === "connected" ? "Channel presence active" : active?.id === member.id && live ? "WebRTC audio connected" : member.transports.length ? `Discovered via ${member.transports.join(", ")}` : "Online in channel"}</small>
                </span>
                <span className={`grid-radio-dot online ${speaking ? "speaking" : ""}`} />
              </button>
            );
          })}
          {!members.length ? <div className="grid-radio-empty">No live channel members.</div> : null}
        </div>
      </section>

      <section className={`grid-radio-active state-${audio.state.toLowerCase()}`}>
        <small>Current speaker</small>
        <div className="grid-radio-current-speaker">
          <span className="grid-radio-avatar">{currentSpeaker?.userName?.slice(0, 1).toUpperCase() || "–"}</span>
          <h3>{currentSpeaker?.userName || "Floor available"}</h3>
          <div>{currentSpeaker ? "Speaking lease active" : active ? `${active.name} · ${audio.state}` : "Select an online user to establish WebRTC audio"}</div>
        </div>
        {audio.error ? <div className="grid-radio-error">{audio.error}</div> : null}
        {audio.incoming ? (
          <div className="grid-radio-actions"><button onClick={() => void radioSession.acceptIncoming()}>Accept / Listen</button>
            <button className="danger" onClick={() => radioSession.rejectIncoming()}>Reject</button></div>
        ) : active && !live ? (
          <button className="grid-radio-connect" disabled={!active.online || audio.state === "CONNECTING"} onClick={() => void radioSession.connect()}>
            {audio.state === "CONNECTING" ? "Establishing WebRTC audio…" : "Connect audio to selected user"}
          </button>
        ) : null}

        <button className={`grid-radio-ptt ${audio.state === "TRANSMITTING" ? "transmitting" : ""}`}
          disabled={!live || channel.muted || audio.state === "RECEIVING" || !audio.microphoneReady || !audio.remoteAudioReady || channel.pushToTalk === "blocked"}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void beginPtt(); }}
          onPointerUp={endPtt} onPointerCancel={endPtt} onLostPointerCapture={endPtt}>
          {audio.state === "TRANSMITTING" ? <Mic size={34} /> : audio.state === "RECEIVING" ? <Volume2 size={34} /> : <MicOff size={34} />}
          <strong>{audio.state === "TRANSMITTING" ? "TRANSMITTING" : audio.state === "RECEIVING" ? `RECEIVING ${active?.name || ""}` : channel.pushToTalk === "requesting" ? "REQUESTING FLOOR" : "HOLD TO TALK"}</strong>
          <span>{audio.state === "TRANSMITTING" ? "Release to stop" : channel.connection === "connected" ? "WebRTC audio with shared floor control" : "Direct WebRTC audio"}</span>
        </button>

        <div className="grid-radio-controls">
          <button onClick={() => void radioSession.setSpeaker(!audio.speakerOn)}>{audio.speakerOn ? <Volume2 size={16} /> : <VolumeX size={16} />} Speaker</button>
          <button onClick={() => radioChannelSession.setMuted(!channel.muted)}>{channel.muted ? <MicOff size={16} /> : <Mic size={16} />} Mute</button>
          <button className="danger" onClick={() => void leave()}><PhoneOff size={16} /> Leave channel</button>
        </div>
        <div className="grid-radio-readiness">Mic: {audio.microphoneReady ? "READY" : "NOT READY"} · Remote track: {audio.remoteAudioReady ? "LIVE" : "NOT RECEIVED"}</div>
      </section>
    </div>
  );
}

export default GridRadioPanel;
