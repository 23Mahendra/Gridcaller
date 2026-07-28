import type { Transport, TransportMessageHandler } from "../transport";

type BroadcastPacket = { from: string; to?: string; data: unknown; ts: number };

export class BroadcastTransport implements Transport {
  name = "broadcast";
  private channel: BroadcastChannel | null = null;
  private callback: TransportMessageHandler = () => {};
  private seen = new Set<string>();

  constructor(private readonly localId: string, private readonly channelName = "gc_transport_bc") {}

  async connect() {
    if (typeof BroadcastChannel === "undefined" || this.channel) return;
    this.channel = new BroadcastChannel(this.channelName);
    this.channel.onmessage = (event: MessageEvent<BroadcastPacket>) => {
      const packet = event.data;
      if (!packet?.from || packet.from === this.localId) return;
      if (packet.to && packet.to !== this.localId) return;
      this.seen.add(packet.from);
      this.callback(packet.from, packet.data);
    };
  }

  send(peerId: string, data: unknown): boolean {
    if (!this.channel) return false;
    this.channel.postMessage({ from: this.localId, to: peerId, data, ts: Date.now() } satisfies BroadcastPacket);
    return true;
  }

  onMessage(cb: TransportMessageHandler) {
    this.callback = cb;
  }

  peers(): string[] {
    return [...this.seen.values()];
  }

  disconnect() {
    this.channel?.close();
    this.channel = null;
  }
}
