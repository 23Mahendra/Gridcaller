import {
  bumpAttempts,
  queuedForPeer,
  queueOutboxMessage,
  removeQueued,
  type OutboxMessage,
} from "./peerCache";

export async function enqueueOfflineMessage(input: {
  to: string;
  toHandle?: string;
  text: string;
  envelope?: unknown;
  id?: string;
}) {
  await queueOutboxMessage({ ...input, attempts: 0, ts: Date.now() });
}

export async function readPendingMessages(peerId: string, limit = 80): Promise<OutboxMessage[]> {
  return queuedForPeer(peerId, limit);
}

export async function markPendingDelivered(ids: string[]) {
  await removeQueued(ids);
}

export async function markPendingRetry(ids: string[]) {
  await bumpAttempts(ids);
}
