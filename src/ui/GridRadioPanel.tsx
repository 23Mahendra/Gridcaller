import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Radio, Volume2, VolumeX, Wifi, Users, Signal, ShieldAlert, ScanLine } from "lucide-react";
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
        <div className="grid-radio-brand">
          <Radio size={24} />
          <span><strong>GridCaller</strong><small>Mesh Radio</small></span>
        </div>
        <div className="grid-radio-mesh-status">
          <span><i className="live-dot" /> LIVE</span>
          <small><Users size={12} /> {members.filter((member) => member.online).length} peers</small>
        </div>
      </header>

      <section className="grid-radio-channel-card">
        <div className="grid-radio-channel-icon"><Radio size={28} /></div>
        <div className="grid-radio-channel-copy">
          <strong>{channel.channelId || CHANNEL_ID}</strong>
          <span>{channel.channelName || "Mesh voice channel"}</span>
        </div>
        <div className="grid-radio-connected">
          <span><i className="live-dot" /> {channel.connection === "connected" ? "Connected" : channel.connection.toUpperCase()}</span>
          <small>{members.filter((member) => member.online).length + 1} nodes</small>
        </div>
      </section>

      {channel.connection !== "connected" ? (
        <button className="grid-radio-connect" disabled={!localId || joining} onClick={() => void join()}>
          {joining || channel.connection === "connecting" ? "Joining mesh…" : "Join channel"}
        </button>
      ) : null}
      {channel.error ? <div className="grid-radio-error">{channel.error}</div> : null}

      <section className={`grid-radio-active state-${audio.state.toLowerCase()}`}>
        <div className="grid-radio-mode-strip">
          <span className="active"><Radio size={16}/> Walkie Talkie</span>
          <span><Volume2 size={16}/> Monitor</span>
        </div>
        <div className="grid-radio-meters">
          <div className="grid-radio-meter">
            <strong>TX</strong>
            <div className="meter-bars">{Array.from({length:8},(_,i)=><i key={i} className={audio.state==="TRANSMITTING" && i<7 ? "on":""}/>)}</div>
            <Mic size={16}/><span>{audio.state==="TRANSMITTING" ? "LIVE" : "READY"}</span>
          </div>
          <button
            className={`grid-radio-ptt ${audio.state === "TRANSMITTING" ? "transmitting" : ""}`}
            disabled={!live || channel.muted || audio.state === "RECEIVING" || !audio.microphoneReady || !audio.remoteAudioReady || channel.pushToTalk === "blocked"}
            aria-label="Hold to talk"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void beginPtt(); }}
            onPointerUp={endPtt} onPointerCancel={endPtt} onLostPointerCapture={endPtt}
          >
            {audio.state === "RECEIVING" ? <Volume2 size={42}/> : <Mic size={42}/>}
            <strong>{audio.state==="TRANSMITTING" ? "TRANSMITTING" : audio.state==="RECEIVING" ? "RECEIVING" : channel.pushToTalk==="requesting" ? "REQUESTING FLOOR" : "HOLD TO TALK"}</strong>
            <span>{audio.state==="TRANSMITTING" ? "Release to stop" : "Press and hold"}</span>
          </button>
          <div className="grid-radio-meter rx">
            <strong>RX</strong>
            <div className="meter-bars">{Array.from({length:8},(_,i)=><i key={i} className={audio.state==="RECEIVING" && i<7 ? "on rx":""}/>)}</div>
            <Volume2 size={16}/><span>{audio.state==="RECEIVING" ? "LIVE" : "LISTEN"}</span>
          </div>
        </div>

        <div className="grid-radio-live-strip">
          <span>Channel <strong>{channel.channelId || CHANNEL_ID}</strong></span>
          <span className="channel-live"><i className="live-dot" /> {currentSpeaker ? currentSpeaker.userName + " speaking" : "Listening"} <Signal size={14}/></span>
        </div>

        <div className="grid-radio-traffic">
          <div className="grid-radio-traffic-head"><strong>Nearby radio nodes</strong><span>{members.length}</span></div>
          {currentSpeaker ? <div className="grid-radio-traffic-row live"><div className="traffic-avatar"><Radio size={17}/></div><div><strong>{currentSpeaker.userName}</strong><span>Speaking on {channel.channelId || CHANNEL_ID}</span></div><Signal size={17}/></div> : null}
          {members.slice(0,5).map(member => (
            <button key={member.id} className={`grid-radio-traffic-row ${active?.id===member.id ? "selected":""}`} onClick={() => ! (member.id===localId) && radioSession.select(member)}>
              <div className="traffic-avatar user"><Users size={16}/></div>
              <div><strong>{member.name}</strong><span>{member.id}</span></div>
              <span className={`grid-radio-dot ${member.online ? "online":""} ${currentSpeaker?.userId===member.id ? "speaking":""}`} />
            </button>
          ))}
          {!members.length ? <div className="grid-radio-empty">Listening for nearby mesh traffic…</div> : null}
        </div>

        <div className="grid-radio-toolbar">
          <button onClick={() => void radioSession.setSpeaker(!audio.speakerOn)}>{audio.speakerOn ? <Volume2 size={18}/> : <VolumeX size={18}/>} Speaker</button>
          <button onClick={() => radioChannelSession.setMuted(!channel.muted)}>{channel.muted ? <MicOff size={18}/> : <Mic size={18}/>} Mute</button>
          <button onClick={() => void radioChannelSession.read(channel.channelId || CHANNEL_ID)}><ScanLine size={18}/> Scan</button>
        </div>

        <div className="grid-radio-bottom-actions">
          <button
            type="button"
            onClick={() => {
              if (!active?.online) return;
              void radioSession.connect();
            }}
            disabled={!active?.online || audio.state === "CONNECTING" || live}
            title={live ? "Radio audio already connected" : active?.online ? "Connect radio audio" : "Select an online peer"}
          >
            <Wifi size={18}/> {live ? "Audio linked" : "Link audio"}
          </button>
          <button className="sos" disabled title="Use Emergency / Mesh for SOS broadcast"><ShieldAlert size={19}/> SOS</button>
        </div>

        <div className="grid-radio-readiness">Mic: {audio.microphoneReady ? "READY" : "NOT READY"} · Remote audio: {audio.remoteAudioReady ? "LIVE" : "WAITING"}</div>

        {audio.incoming ? (
          <div className="grid-radio-actions"><button onClick={() => void radioSession.acceptIncoming()}>Accept / Listen</button><button className="danger" onClick={() => radioSession.rejectIncoming()}>Reject</button></div>
        ) : active && !live ? (
          <button className="grid-radio-connect" disabled={!active.online || audio.state === "CONNECTING"} onClick={() => void radioSession.connect()}>
            {audio.state === "CONNECTING" ? "Establishing WebRTC audio…" : `Connect audio to ${active.name}`}
          </button>
        ) : null}
      </section>
    </div>
  );

}
export default GridRadioPanel;
