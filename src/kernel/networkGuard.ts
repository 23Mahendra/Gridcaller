let activePeerConnections = 0;
let lastBudgetWarningAt = 0;
const MAX_PEER_CONNECTIONS = 3;

export function getPeerConnectionBudgetState() {
  return {
    active: activePeerConnections,
    max: MAX_PEER_CONNECTIONS,
    available: Math.max(0, MAX_PEER_CONNECTIONS - activePeerConnections),
  };
}

export function tryBeginPeerConnection(): boolean {
  if (activePeerConnections >= MAX_PEER_CONNECTIONS) {
    const now = Date.now();
    if (now - lastBudgetWarningAt > 5000) {
      lastBudgetWarningAt = now;
      console.warn("[networkGuard] PeerConnection budget exhausted; skipping new connection");
    }
    return false;
  }
  activePeerConnections += 1;
  return true;
}

export function endPeerConnection() {
  activePeerConnections = Math.max(0, activePeerConnections - 1);
}

export function resetPeerConnectionBudget() {
  activePeerConnections = 0;
  lastBudgetWarningAt = 0;
}
