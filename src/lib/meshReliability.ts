export type PendingOutboundStatus = "pending" | "sent";

export type PendingOutboundMessage = {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
  lastAttemptAt?: number;
  attempts: number;
  status: PendingOutboundStatus;
};

export type PendingEnvelopeEntry = {
  id: string;
  kind: string;
  payload: any;
  createdAt: number;
  target?: string;
  lastAttemptAt?: number;
  attempts: number;
  status: "pending" | "sent" | "acked";
};

export function createPendingOutboundMessage(input: {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
}): PendingOutboundMessage {
  return {
    id: input.id,
    type: input.type,
    payload: input.payload,
    createdAt: input.createdAt,
    attempts: 1,
    status: "pending",
  };
}

export function createPendingEnvelopeEntry(input: {
  id: string;
  kind: string;
  payload: any;
  createdAt: number;
  target?: string;
}): PendingEnvelopeEntry {
  return {
    id: input.id,
    kind: input.kind,
    payload: input.payload,
    createdAt: input.createdAt,
    target: input.target,
    attempts: 1,
    status: "pending",
  };
}

export function shouldRetryPendingOutboundMessage(
  entry: PendingOutboundMessage,
  now: number,
  minGapMs = 2000
): boolean {
  if (entry.status === "sent") return false;
  if (entry.attempts >= 6) return false;
  const sinceLast = now - (entry.lastAttemptAt ?? entry.createdAt);
  return sinceLast >= minGapMs;
}

export function shouldRetryPendingEnvelopeEntry(
  entry: PendingEnvelopeEntry,
  now: number,
  minGapMs = 2000
): boolean {
  if (entry.status === "sent" || entry.status === "acked") return false;
  if (entry.attempts >= 6) return false;
  const sinceLast = now - (entry.lastAttemptAt ?? entry.createdAt);
  return sinceLast >= minGapMs;
}
