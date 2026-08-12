import {
  acceptCall,
  endCall,
  getCallState,
  hasUsableRadioAudioTransport,
  onCallUi,
  rejectCall,
  setRadioTransmit,
  startOutgoingRadio,
  type CallUiState,
} from "./callSession";
import { setSpeakerphone } from "./realMedia";

export type RadioConnectionState =
  | "OFFLINE"
  | "DISCOVERING"
  | "AVAILABLE"
  | "CONNECTING"
  | "CONNECTED"
  | "TRANSMITTING"
  | "RECEIVING"
  | "DISCONNECTING"
  | "FAILED";

export type RadioUser = {
  id: string;
  name: string;
  online: boolean;
  lastSeen?: number;
  transports: string[];
};

export type RadioSessionSnapshot = {
  state: RadioConnectionState;
  selected: RadioUser | null;
  incoming: boolean;
  microphoneReady: boolean;
  remoteAudioReady: boolean;
  speakerOn: boolean;
  error: string;
};

export interface RadioAudioSessionPort {
  snapshot(): CallUiState;
  subscribe(listener: (state: CallUiState) => void): () => void;
  connect(peerId: string, peerName: string): Promise<void>;
  accept(): Promise<void>;
  reject(): void;
  disconnect(): void;
  usable(): boolean;
  setTransmit(active: boolean): void;
  setSpeaker(active: boolean): Promise<{ ok: boolean; message: string }>;
}

const productionPort: RadioAudioSessionPort = {
  snapshot: getCallState,
  subscribe: onCallUi,
  connect: startOutgoingRadio,
  accept: acceptCall,
  reject: rejectCall,
  disconnect: () => endCall("radio-disconnect"),
  usable: hasUsableRadioAudioTransport,
  setTransmit: setRadioTransmit,
  setSpeaker: setSpeakerphone,
};

export function buildRadioUsers(
  peers: Array<{ id: string; name?: string; online?: boolean; lastSeen?: number; via?: string[]; transports?: string[] }>,
  localIds: Iterable<string>
): RadioUser[] {
  const self = new Set([...localIds].filter(Boolean));
  const byId = new Map<string, RadioUser>();
  for (const peer of peers) {
    if (!peer.id || self.has(peer.id)) continue;
    const prior = byId.get(peer.id);
    byId.set(peer.id, {
      id: peer.id,
      name: peer.name || prior?.name || peer.id.slice(0, 12),
      online: peer.online === true || prior?.online === true,
      lastSeen: Math.max(peer.lastSeen || 0, prior?.lastSeen || 0) || undefined,
      transports: [...new Set([...(prior?.transports || []), ...(peer.via || []), ...(peer.transports || [])])],
    });
  }
  return [...byId.values()].sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeen || 0) - (a.lastSeen || 0));
}

export class RadioSessionController {
  private selected: RadioUser | null = null;
  private state: RadioConnectionState = "DISCOVERING";
  private incoming = false;
  private speakerOn = true;
  private error = "";
  private listeners = new Set<(snapshot: RadioSessionSnapshot) => void>();
  private unsubscribePort: (() => void) | null = null;

  constructor(private readonly port: RadioAudioSessionPort = productionPort) {
    this.unsubscribePort = port.subscribe((call) => this.sync(call));
  }

  snapshot(): RadioSessionSnapshot {
    const call = this.port.snapshot();
    return {
      state: this.state,
      selected: this.selected,
      incoming: this.incoming,
      microphoneReady: call.localAudioReady,
      remoteAudioReady: call.remoteAudioReady,
      speakerOn: this.speakerOn,
      error: this.error || call.error,
    };
  }

  subscribe(listener: (snapshot: RadioSessionSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setUsers(users: RadioUser[]) {
    if (this.selected) {
      this.selected = users.find((user) => user.id === this.selected?.id) || { ...this.selected, online: false };
      if (!this.selected.online && this.state === "AVAILABLE") this.state = "OFFLINE";
    } else {
      this.state = users.length ? "AVAILABLE" : "DISCOVERING";
    }
    this.emit();
  }

  select(user: RadioUser) {
    this.selected = user;
    this.incoming = false;
    this.error = "";
    this.state = user.online ? "AVAILABLE" : "OFFLINE";
    this.emit();
  }

  async connect() {
    if (!this.selected?.online) throw new Error("Selected radio user is offline");
    if (["CONNECTING", "CONNECTED", "TRANSMITTING", "RECEIVING"].includes(this.state)) return;
    this.state = "CONNECTING";
    this.error = "";
    this.emit();
    try {
      await this.port.connect(this.selected.id, this.selected.name);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.state = "FAILED";
      this.emit();
      throw error;
    }
  }

  async acceptIncoming() {
    if (!this.incoming) throw new Error("No authorized incoming radio session");
    this.state = "CONNECTING";
    this.emit();
    try {
      await this.port.accept();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.state = "FAILED";
      this.emit();
      throw error;
    }
  }

  rejectIncoming() {
    this.port.reject();
    this.incoming = false;
    this.state = this.selected?.online ? "AVAILABLE" : "DISCOVERING";
    this.emit();
  }

  pressToTalk() {
    if (this.state !== "CONNECTED") throw new Error("Radio audio transport is not connected");
    try {
      this.port.setTransmit(true);
      this.state = "TRANSMITTING";
      this.emit();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.state = "FAILED";
      this.emit();
      throw error;
    }
  }

  releaseToTalk() {
    if (this.state !== "TRANSMITTING") return;
    this.port.setTransmit(false);
    this.state = this.port.usable() ? "CONNECTED" : "CONNECTING";
    this.emit();
  }

  async setSpeaker(active: boolean) {
    const result = await this.port.setSpeaker(active);
    if (!result.ok) {
      this.error = result.message;
      this.emit();
      throw new Error(result.message);
    }
    this.speakerOn = active;
    this.emit();
  }

  disconnect() {
    this.state = "DISCONNECTING";
    this.emit();
    this.port.disconnect();
  }

  destroy() {
    this.unsubscribePort?.();
    this.unsubscribePort = null;
    this.listeners.clear();
  }

  private sync(call: CallUiState) {
    if (call.mode !== "radio") {
      if (call.phase === "idle" && this.state === "DISCONNECTING") {
        this.state = this.selected?.online ? "AVAILABLE" : "DISCOVERING";
      }
      this.emit();
      return;
    }
    if (call.peerId && (!this.selected || this.selected.id !== call.peerId)) {
      this.selected = { id: call.peerId, name: call.peerName || call.peerId, online: true, transports: ["webrtc"] };
    }
    this.incoming = call.phase === "incoming";
    this.error = call.error;
    if (call.error) this.state = "FAILED";
    else if (call.phase === "incoming" || call.phase === "outgoing") this.state = "CONNECTING";
    else if (call.phase === "active") {
      if (!this.port.usable()) this.state = "CONNECTING";
      else if (call.localTransmitting) this.state = "TRANSMITTING";
      else if (call.remoteTransmitting && call.remoteAudioReady) this.state = "RECEIVING";
      else this.state = "CONNECTED";
    } else if (call.phase === "idle") {
      this.incoming = false;
      this.state = this.selected?.online ? "AVAILABLE" : "DISCOVERING";
    }
    this.emit();
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Signaling-level group floor. Actual group audio requires one WebRTC media session per member. */
export class RadioFloorLock {
  private holder: string | null = null;
  acquire(userId: string) {
    if (this.holder && this.holder !== userId) return false;
    this.holder = userId;
    return true;
  }
  release(userId: string) {
    if (this.holder !== userId) return false;
    this.holder = null;
    return true;
  }
  get currentHolder() { return this.holder; }
}

export const radioSession = new RadioSessionController();
export default radioSession;
