export type PendingDmStatus = "pending" | "acked" | "failed";

export type PendingDmEntry = {
  id: string;
  to: string;
  text: string;
  createdAt: number;
  lastAttemptAt?: number;
  attempts: number;
  status: PendingDmStatus;
};

export function createPendingDmEntry(input: {
  id: string;
  to: string;
  text: string;
  createdAt: number;
}): PendingDmEntry {
  return {
    id: input.id,
    to: input.to,
    text: input.text,
    createdAt: input.createdAt,
    attempts: 1,
    status: "pending",
  };
}

export function shouldRetryPendingDm(entry: PendingDmEntry, now: number): boolean {
  if (entry.status === "acked" || entry.status === "failed") return false;
  if (entry.attempts >= 6) return false;
  const sinceLast = now - (entry.lastAttemptAt ?? entry.createdAt);
  return sinceLast >= 2000;
}
