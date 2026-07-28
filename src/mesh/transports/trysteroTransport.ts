import type { Transport, TransportMessageHandler } from "../transport";

export class TrysteroTransport implements Transport {
  name = "trystero";
  private callback: TransportMessageHandler = () => {};

  constructor(
    private readonly input: {
      send: (data: unknown, peerId?: string) => void;
      peers: () => string[];
    }
  ) {}

  async connect() {}

  send(peerId: string, data: unknown): boolean {
    try {
      this.input.send(data, peerId);
      return true;
    } catch {
      return false;
    }
  }

  onMessage(cb: TransportMessageHandler) {
    this.callback = cb;
    void this.callback;
  }

  peers(): string[] {
    return this.input.peers();
  }

  disconnect() {}
}
