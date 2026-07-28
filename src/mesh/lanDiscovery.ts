export type LanPresence = {
  type: "presence";
  peerId: string;
  handle: string;
  name: string;
  ts: number;
};

type LanPacket = LanPresence | { type: "presence-request"; from: string; ts: number };

export type LanDiscoveryController = {
  announce: () => void;
  stop: () => void;
};

function canUseBroadcastChannel() {
  return typeof BroadcastChannel !== "undefined";
}

export function startLanDiscovery(input: {
  peerId: string;
  handle: string;
  name: string;
  onPeer: (peer: { id: string; handle: string; name: string }) => void;
}): LanDiscoveryController {
  if (!canUseBroadcastChannel()) {
    return { announce: () => {}, stop: () => {} };
  }

  const channel = new BroadcastChannel("gc_lan_disco");
  let closed = false;

  const announce = () => {
    if (closed) return;
    const packet: LanPresence = {
      type: "presence",
      peerId: input.peerId,
      handle: input.handle,
      name: input.name,
      ts: Date.now(),
    };
    channel.postMessage(packet);
  };

  channel.onmessage = (event: MessageEvent<LanPacket>) => {
    const packet = event.data;
    if (!packet || typeof packet !== "object") return;
    if (packet.type === "presence-request") {
      if (packet.from !== input.peerId) announce();
      return;
    }
    if (packet.type !== "presence") return;
    if (packet.peerId === input.peerId) return;
    input.onPeer({ id: packet.peerId, handle: packet.handle, name: packet.name });
  };

  channel.postMessage({ type: "presence-request", from: input.peerId, ts: Date.now() } satisfies LanPacket);
  announce();

  return {
    announce,
    stop: () => {
      if (closed) return;
      closed = true;
      channel.close();
    },
  };
}
