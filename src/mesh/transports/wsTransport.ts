import type { Transport, TransportMessageHandler } from "../transport";

export class WsTransport implements Transport {
  name = "ws";
  private callback: TransportMessageHandler = () => {};

  constructor(
    private readonly input: {
      send: (packet: unknown) => boolean;
      peers: () => string[];
      onMessage?: (cb: TransportMessageHandler) => void;
    }
  ) {}

  async connect() {}

  send(peerId: string, data: unknown): boolean {
    return this.input.send({ ...(typeof data === "object" && data ? (data as object) : { data }), to: peerId });
  }

  onMessage(cb: TransportMessageHandler) {
    this.callback = cb;
    this.input.onMessage?.((from, data) => this.callback(from, data));
  }

  peers(): string[] {
    return this.input.peers();
  }

  disconnect() {}
}
