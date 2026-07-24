export type PendingCallSignalKind = "invite" | "accept" | "sdp";

export type PendingCallSignalEntry = {
  id: string;
  callId: string;
  peerId: string;
  kind: PendingCallSignalKind;
  payload: any;
  createdAt: number;
  lastAttemptAt?: number;
  attempts: number;
  status: "pending" | "acked" | "failed";
};

export function createPendingCallSignal(input: {
  callId: string;
  peerId: string;
  kind: PendingCallSignalKind;
  payload: any;
  createdAt: number;
}): PendingCallSignalEntry {
  return {
    id: `${input.callId}:${input.kind}:${input.peerId}`,
    callId: input.callId,
    peerId: input.peerId,
    kind: input.kind,
    payload: input.payload,
    createdAt: input.createdAt,
    attempts: 1,
    status: "pending",
  };
}

export function shouldRetryPendingCallSignal(entry: PendingCallSignalEntry, now: number): boolean {
  if (entry.status === "acked" || entry.status === "failed") return false;
  if (entry.attempts >= 6) return false;
  const sinceLast = now - (entry.lastAttemptAt ?? entry.createdAt);
  return sinceLast >= 2000;
}
