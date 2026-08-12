import { resolveHubHttp } from "./meshHubConfig";

export type RadioMemberPresence = {
  id: string;
  name: string;
  joinedAt: number;
  lastSeen: number;
  connection: "online" | "offline";
};

export type RadioSpeakerLease = {
  userId: string;
  userName: string;
  leaseId: string;
  acquiredAt: number;
  expiresAt: number;
};

export type RadioChannelSnapshot = {
  channelId: string;
  channelName: string;
  localUserId: string;
  members: RadioMemberPresence[];
  speaker: RadioSpeakerLease | null;
  connection: "offline" | "connecting" | "connected" | "failed";
  pushToTalk: "idle" | "requesting" | "granted" | "blocked";
  muted: boolean;
  error: string;
  /** Internal ownership nonce issued automatically by the hub; never rendered. */
  sessionToken?: string;
};

export interface RadioChannelTransport {
  join(channelId: string, channelName: string, userId: string, userName: string): Promise<RadioChannelSnapshot>;
  heartbeat(channelId: string, userId: string, userName: string, sessionToken: string): Promise<RadioChannelSnapshot>;
  leave(channelId: string, userId: string, sessionToken: string, leaseId?: string): Promise<void>;
  acquire(channelId: string, userId: string, userName: string, sessionToken: string): Promise<{ granted: boolean; speaker: RadioSpeakerLease | null }>;
  release(channelId: string, userId: string, sessionToken: string, leaseId: string): Promise<boolean>;
  read(channelId: string): Promise<RadioChannelSnapshot>;
}

function validChannelId(channelId: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(channelId);
}

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(`${resolveHubHttp()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Radio hub request failed: ${response.status}`);
  return body;
}

function tokenKey(channelId: string, userId: string) { return `gc_radio_session:${channelId}:${userId}`; }
function loadSessionToken(channelId: string, userId: string) {
  try { return sessionStorage.getItem(tokenKey(channelId, userId)) || ""; } catch { return ""; }
}
function saveSessionToken(channelId: string, userId: string, token: string) {
  try { if (token) sessionStorage.setItem(tokenKey(channelId, userId), token); } catch {}
}
function forgetSessionToken(channelId: string, userId: string) {
  try { sessionStorage.removeItem(tokenKey(channelId, userId)); } catch {}
}

export const lanRadioChannelTransport: RadioChannelTransport = {
  join: async (channelId, channelName, userId, userName) => {
    const result = await requestJson("/api/radio/join", {
      method: "POST", body: JSON.stringify({ channelId, channelName, userId, userName, sessionToken: loadSessionToken(channelId, userId) }),
    });
    saveSessionToken(channelId, userId, result.sessionToken || "");
    return result;
  },
  heartbeat: (channelId, userId, userName, sessionToken) => requestJson("/api/radio/heartbeat", {
    method: "POST", body: JSON.stringify({ channelId, userId, userName, sessionToken }),
  }),
  leave: async (channelId, userId, sessionToken, leaseId) => {
    await requestJson("/api/radio/leave", {
      method: "POST", body: JSON.stringify({ channelId, userId, sessionToken, leaseId }),
    });
    forgetSessionToken(channelId, userId);
  },
  acquire: (channelId, userId, userName, sessionToken) => requestJson("/api/radio/floor/acquire", {
    method: "POST", body: JSON.stringify({ channelId, userId, userName, sessionToken }),
  }),
  release: async (channelId, userId, sessionToken, leaseId) => {
    const result = await requestJson("/api/radio/floor/release", {
      method: "POST", body: JSON.stringify({ channelId, userId, sessionToken, leaseId }),
    });
    return result.released === true;
  },
  read: (channelId) => requestJson(`/api/radio/channel?channelId=${encodeURIComponent(channelId)}`),
};

export class RadioChannelSession {
  private state: RadioChannelSnapshot;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(snapshot: RadioChannelSnapshot) => void>();
  private floorEpoch = 0;

  constructor(
    private readonly transport: RadioChannelTransport = lanRadioChannelTransport,
    private readonly heartbeatMs = 5_000,
  ) {
    this.state = {
      channelId: "",
      channelName: "",
      localUserId: "",
      members: [],
      speaker: null,
      connection: "offline",
      pushToTalk: "idle",
      muted: false,
      error: "",
    };
  }

  snapshot() { return { ...this.state, members: this.state.members.map((member) => ({ ...member })) }; }
  subscribe(listener: (snapshot: RadioChannelSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  async join(channelId: string, channelName: string, userId: string, userName: string) {
    if (!validChannelId(channelId)) throw new Error("Invalid radio channel ID");
    if (!userId.trim()) throw new Error("Radio identity is required");
    if (this.state.connection !== "offline") await this.leave();
    this.state = { ...this.state, channelId, channelName: channelName || channelId, localUserId: userId,
      connection: "connecting", error: "", pushToTalk: "idle" };
    this.emit();
    try {
      this.apply(await this.transport.join(channelId, channelName || channelId, userId, userName || userId));
      this.state.connection = "connected";
      this.startHeartbeat(userName || userId);
      this.emit();
    } catch (error) {
      this.state.connection = "failed";
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }
  }

  async acquireFloor(userName: string) {
    if (this.state.connection !== "connected") throw new Error("Radio channel is not connected");
    this.state.pushToTalk = "requesting";
    this.emit();
    try {
      const result = await this.transport.acquire(this.state.channelId, this.state.localUserId, userName, this.state.sessionToken || "");
      this.state.speaker = result.speaker;
      this.state.pushToTalk = result.granted ? "granted" : "blocked";
      this.state.error = "";
      this.emit();
      return result.granted;
    } catch (error) {
      this.state.pushToTalk = "idle";
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }
  }

  async releaseFloor() {
    this.floorEpoch += 1;
    const lease = this.state.speaker;
    if (!lease || lease.userId !== this.state.localUserId) {
      this.state.pushToTalk = "idle";
      this.emit();
      return false;
    }
    const released = await this.transport.release(this.state.channelId, this.state.localUserId, this.state.sessionToken || "", lease.leaseId);
    if (released) this.state.speaker = null;
    this.state.pushToTalk = "idle";
    this.emit();
    return released;
  }

  setMuted(muted: boolean) { this.state.muted = muted; this.emit(); }

  async leave() {
    this.stopHeartbeat();
    const { channelId, localUserId, speaker } = this.state;
    if (channelId && localUserId) {
      await this.transport.leave(channelId, localUserId, this.state.sessionToken || "", speaker?.userId === localUserId ? speaker.leaseId : undefined).catch(() => {});
    }
    this.state = { ...this.state, members: [], speaker: null, connection: "offline", pushToTalk: "idle", error: "" };
    this.emit();
  }

  destroy() { void this.leave(); this.listeners.clear(); }

  private startHeartbeat(userName: string) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const renewFloor = this.state.pushToTalk === "granted" && this.state.speaker?.userId === this.state.localUserId;
      const floorEpoch = this.floorEpoch;
      void this.transport.heartbeat(this.state.channelId, this.state.localUserId, userName, this.state.sessionToken || "")
        .then(async (snapshot) => {
          this.apply(snapshot);
          if (renewFloor && floorEpoch === this.floorEpoch && this.state.pushToTalk === "granted") {
            const result = await this.transport.acquire(this.state.channelId, this.state.localUserId, userName, this.state.sessionToken || "");
            if (floorEpoch !== this.floorEpoch) {
              if (result.granted && result.speaker?.userId === this.state.localUserId) {
                await this.transport.release(this.state.channelId, this.state.localUserId, this.state.sessionToken || "", result.speaker.leaseId);
              }
              return;
            }
            this.state.speaker = result.speaker;
            this.state.pushToTalk = result.granted ? "granted" : "blocked";
          }
          this.state.connection = "connected";
          this.state.error = "";
          this.emit();
        })
        .catch((error) => { this.state.connection = "failed"; this.state.error = String(error); this.emit(); });
    }, this.heartbeatMs);
  }
  private stopHeartbeat() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  private apply(snapshot: RadioChannelSnapshot) {
    this.state.members = snapshot.members.slice(0, 256);
    this.state.speaker = snapshot.speaker;
    this.state.channelName = snapshot.channelName || this.state.channelName;
    if (snapshot.sessionToken) this.state.sessionToken = snapshot.sessionToken;
  }
  private emit() { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot); }
}

export const radioChannelSession = new RadioChannelSession();
