export type CallLifecycleState =
  | "IDLE" | "OUTGOING_RINGING" | "INCOMING_RINGING" | "CONNECTING"
  | "CONNECTED" | "DECLINING" | "ENDED" | "MISSED" | "FAILED";

export type CallType = "voice" | "radio";

export type AuthoritativeCall = {
  callId: string;
  callerId: string;
  calleeId: string;
  timestamp: number;
  type: CallType;
  state: CallLifecycleState;
  reason: string;
};

export type CallEvent =
  | { type: "OUTGOING"; callId: string; callerId: string; calleeId: string; timestamp: number; callType?: CallType }
  | { type: "INCOMING"; callId: string; callerId: string; calleeId: string; timestamp: number; callType?: CallType }
  | { type: "ACCEPT" } | { type: "MEDIA_CONNECTED" } | { type: "DECLINE" }
  | { type: "TIMEOUT" } | { type: "HANGUP"; reason?: string } | { type: "FAIL"; reason: string }
  | { type: "RESET" };

export const idleCall = (): AuthoritativeCall => ({
  callId: "", callerId: "", calleeId: "", timestamp: 0, type: "voice", state: "IDLE", reason: "",
});

export function transitionCall(current: AuthoritativeCall, event: CallEvent): AuthoritativeCall {
  if (event.type === "RESET") return idleCall();
  if (event.type === "OUTGOING" || event.type === "INCOMING") {
    if (current.callId === event.callId && current.state !== "IDLE") return current;
    if (!event.callId || !event.callerId || !event.calleeId) return { ...current, state: "FAILED", reason: "incomplete call identity" };
    return {
      callId: event.callId, callerId: event.callerId, calleeId: event.calleeId,
      timestamp: event.timestamp, type: event.callType || "voice",
      state: event.type === "OUTGOING" ? "OUTGOING_RINGING" : "INCOMING_RINGING", reason: "",
    };
  }
  if (event.type === "ACCEPT" && current.state === "INCOMING_RINGING") return { ...current, state: "CONNECTING" };
  if (event.type === "MEDIA_CONNECTED" && ["CONNECTING", "OUTGOING_RINGING"].includes(current.state)) return { ...current, state: "CONNECTED" };
  if (event.type === "DECLINE" && current.state === "INCOMING_RINGING") return { ...current, state: "DECLINING", reason: "declined" };
  if (event.type === "TIMEOUT" && ["INCOMING_RINGING", "OUTGOING_RINGING"].includes(current.state)) return { ...current, state: "MISSED", reason: "timeout" };
  if (event.type === "HANGUP" && current.state !== "IDLE") {
    if (current.state === "MISSED" || current.state === "FAILED") return current;
    return { ...current, state: "ENDED", reason: event.reason || "hangup" };
  }
  if (event.type === "FAIL") return { ...current, state: "FAILED", reason: event.reason };
  return current;
}

export function createCallId(callerId: string, calleeId: string, now = Date.now(), random = Math.random()) {
  return `gc_${callerId}_${calleeId}_${now.toString(36)}_${Math.floor(random * 0x1000000).toString(36)}`;
}

export class CallStateMachine {
  private current = idleCall();
  private seenIncoming = new Set<string>();
  snapshot() { return { ...this.current }; }
  dispatch(event: CallEvent) {
    if (event.type === "INCOMING") {
      if (this.seenIncoming.has(event.callId)) return this.snapshot();
      this.seenIncoming.add(event.callId);
    }
    this.current = transitionCall(this.current, event);
    return this.snapshot();
  }
}
