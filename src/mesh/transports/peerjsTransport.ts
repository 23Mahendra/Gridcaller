import type { Transport, TransportMessageHandler } from "../transport";

type SendableConn = { open?: boolean; send: (data: unknown) => void };

export class PeerJsTransport implements Transport {
  name = "peerjs";
  private callback: TransportMessageHandler = () => {};

  constructor(private readonly getConns: () => Map<string, SendableConn>) {}

  async connect() {}

  send(peerId: string, data: unknown): boolean {
    const conn = this.getConns().get(peerId);
    if (!conn || conn.open === false) return false;
    try {
      conn.send(data);
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
    return [...this.getConns().keys()];
  }

  disconnect() {}
}
