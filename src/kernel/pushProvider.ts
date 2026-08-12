export type CallPushInvite = {
  callId: string;
  callerId: string;
  calleeId: string;
  callerName: string;
  timestamp: number;
  callType: "voice" | "radio";
};

export type PushResult = { accepted: boolean; provider: string; reason?: string };

export interface PushProvider {
  isAvailable(): Promise<boolean>;
  registerDevice(deviceId: string, token: string, registrationSecret: string): Promise<PushResult>;
  unregisterDevice(deviceId: string, registrationSecret: string): Promise<PushResult>;
  sendCallInvite(invite: CallPushInvite): Promise<PushResult>;
}

export class UnavailablePushProvider implements PushProvider {
  async isAvailable() { return false; }
  async registerDevice(_deviceId: string, _token: string, _registrationSecret: string) {
    return { accepted: false, provider: "none", reason: "push provider unavailable" };
  }
  async unregisterDevice(_deviceId: string, _registrationSecret: string) {
    return { accepted: false, provider: "none", reason: "push provider unavailable" };
  }
  async sendCallInvite(_invite: CallPushInvite) {
    return { accepted: false, provider: "none", reason: "push provider unavailable" };
  }
}

export class HubPushProvider implements PushProvider {
  constructor(private readonly hubUrl: string) {}
  private url(path: string) { return `${this.hubUrl.replace(/\/$/, "")}${path}`; }
  async isAvailable() {
    try { const r = await fetch(this.url("/api/call/push/status")); return r.ok && (await r.json()).available === true; }
    catch { return false; }
  }
  async registerDevice(deviceId: string, token: string, registrationSecret: string) {
    return this.post("/api/call/push/register", { deviceId, token, registrationSecret });
  }
  async unregisterDevice(deviceId: string, registrationSecret: string) {
    return this.post("/api/call/push/unregister", { deviceId, registrationSecret });
  }
  async sendCallInvite(invite: CallPushInvite) { return this.post("/api/call/push/invite", invite); }
  private async post(path: string, body: unknown): Promise<PushResult> {
    try {
      const r = await fetch(this.url(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await r.json().catch(() => ({}));
      return { accepted: r.ok && result.accepted === true, provider: result.provider || "none", reason: result.reason || result.error };
    } catch (error) { return { accepted: false, provider: "none", reason: String(error) }; }
  }
}
