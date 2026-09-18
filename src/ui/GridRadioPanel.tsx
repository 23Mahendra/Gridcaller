import { useEffect, useMemo, useState } from "react";
import { Mic, MicOff, Radio, Volume2, VolumeX, WifiOff, Users, Signal } from "lucide-react";
import freeRadio, { type RadioPeer } from "../kernel/radioMesh";

type Peer = { id: string; name?: string; online?: boolean; lastSeen?: number; via?: string[]; transports?: string[] };
const CHANNEL_ID = "grid-ch-1";

function mergePeers(discovered: Peer[], radioPeers: RadioPeer[]) {
  const map = new Map<string, { id: string; name: string; online: boolean; lastSeen?: number }>();
  for (const p of radioPeers) map.set(p.id, { id: p.id, name: p.name, online: p.live === true, lastSeen: p.ts });
  for (const p of discovered) {
    const e = map.get(p.id);
    map.set(p.id, { id: p.id, name: p.name || e?.name || p.id.slice(0, 12), online: p.online === true || e?.online === true, lastSeen: Math.max(p.lastSeen || 0, e?.lastSeen || 0) || undefined });
  }
  return [...map.values()].sort((a,b) => Number(b.online)-Number(a.online) || (b.lastSeen||0)-(a.lastSeen||0));
}

export function GridRadioPanel({ peers, localName }: { peers: Peer[]; localIds: string[]; localName: string }) {
  const [, render] = useState(0);
  const [muted, setMuted] = useState(false);
  const [tx, setTx] = useState(false);
  useEffect(() => {
    void freeRadio.enable(true).catch(() => {});
    freeRadio.setOperatorName(localName);
    const unsub = freeRadio.subscribe(() => render(v => v + 1));
    const timer = window.setInterval(() => render(v => v + 1), 1000);
    return () => { unsub(); window.clearInterval(timer); void freeRadio.pttStop().catch(() => {}); };
  }, [localName]);
  const status = freeRadio.status();
  const members = useMemo(() => mergePeers(peers, freeRadio.peerList), [peers, status.peers, freeRadio.peerList.length]);
  const beginPtt = async () => { if (tx || muted || !status.on) return; try { await freeRadio.pttStart(); setTx(true); } catch (e) { console.warn("[GridRadio] mic", e); } };
  const endPtt = async () => { if (!tx) return; setTx(false); await freeRadio.pttStop().catch(() => {}); };
  return (
    <div className="grid-radio-panel">
      <header className="grid-radio-channel-head">
        <div className="grid-radio-brand"><Radio size={24}/><span><strong>GridCaller</strong><small>Free Mesh Radio</small></span></div>
        <div className="grid-radio-mesh-status"><span><i className="live-dot" /> {status.on ? "READY" : "OFF"}</span><small><Users size={12}/> {status.peers} nodes</small></div>
      </header>
      <section className="grid-radio-channel-card">
        <div className="grid-radio-channel-icon"><Radio size={28}/></div>
        <div className="grid-radio-channel-copy"><strong>{status.channel || CHANNEL_ID}</strong><span>Encrypted device-to-device voice burst</span></div>
        <div className="grid-radio-connected"><span><i className="live-dot" /> {tx ? "TRANSMIT" : "LISTEN"}</span><small>AES-GCM</small></div>
      </section>
      <section className="grid-radio-active">
        <div className="grid-radio-mode-strip"><span className="active"><Radio size={16}/> Walkie Talkie</span><span><WifiOff size={16}/> Local Mesh</span></div>
        <div className="grid-radio-meters">
          <div className="grid-radio-meter"><strong>TX</strong><div className="meter-bars">{Array.from({length:8},(_,i)=><i key={i} className={tx && i<7 ? "on" : ""}/>)}</div><Mic size={16}/><span>{tx ? "LIVE" : "READY"}</span></div>
          <button className={"grid-radio-ptt " + (tx ? "transmitting" : "")} disabled={!status.on || muted} aria-label="Hold to talk" onPointerDown={(e)=>{e.currentTarget.setPointerCapture(e.pointerId); void beginPtt();}} onPointerUp={()=>{void endPtt();}} onPointerCancel={()=>{void endPtt();}} onLostPointerCapture={()=>{void endPtt();}}><Mic size={42}/><strong>{tx ? "TRANSMITTING" : "HOLD TO TALK"}</strong><span>{tx ? "Release to send" : "Encrypted mesh burst"}</span></button>
          <div className="grid-radio-meter rx"><strong>RX</strong><div className="meter-bars">{Array.from({length:8},(_,i)=><i key={i} className={!tx && i<Math.min(6,status.peers+1) ? "on rx" : ""}/>)}</div><Volume2 size={16}/><span>{tx ? "TX" : "LISTEN"}</span></div>
        </div>
        <div className="grid-radio-live-strip"><span>Node <strong>{status.radioId}</strong></span><span className="channel-live"><i className="live-dot" /> {tx ? "Sending over mesh" : "Listening"} <Signal size={14}/></span></div>
        <div className="grid-radio-traffic"><div className="grid-radio-traffic-head"><strong>Nearby mesh radio nodes</strong><span>{members.length}</span></div>
          {members.slice(0,8).map(m=><div key={m.id} className="grid-radio-traffic-row"><div className="traffic-avatar user"><Users size={16}/></div><div><strong>{m.name}</strong><span>{m.online ? "Reachable · mesh" : "Seen recently"} · {m.id}</span></div><span className={"grid-radio-dot " + (m.online ? "online" : "")}/></div>)}
          {!members.length ? <div className="grid-radio-empty">No radio peers discovered yet. Keep both devices on the same local mesh / hotspot and leave Radio open.</div> : null}
        </div>
        <div className="grid-radio-toolbar">
          <button onClick={()=>setMuted(v=>!v)}>{muted ? <MicOff size={18}/> : <Mic size={18}/>} {muted ? "Unmute" : "Mute"}</button>
          <button onClick={()=>void freeRadio.enable(!freeRadio.enabled)}><Radio size={18}/> {freeRadio.enabled ? "Radio on" : "Radio off"}</button>
          <button onClick={()=>{freeRadio.setOperatorName(localName); render(v=>v+1);}}><Users size={18}/> Refresh</button>
        </div>
        <div className="grid-radio-readiness">Transport: local mesh · encrypted: yes · SIM: no · carrier: no · cloud: no</div>
      </section>
    </div>
  );
}
export default GridRadioPanel;