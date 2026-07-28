export type TransportMessageHandler = (from: string, data: unknown) => void;

export interface Transport {
  name: string;
  connect(): Promise<void>;
  send(peerId: string, data: unknown): boolean;
  onMessage(cb: TransportMessageHandler): void;
  peers(): string[];
  disconnect(): void;
}

export class TransportRegistry {
  private transports = new Map<string, Transport>();

  register(transport: Transport) {
    this.transports.set(transport.name, transport);
  }

  unregister(name: string) {
    const existing = this.transports.get(name);
    if (!existing) return;
    existing.disconnect();
    this.transports.delete(name);
  }

  async connectAll() {
    await Promise.all(
      [...this.transports.values()].map(async (transport) => {
        try {
          await transport.connect();
        } catch {}
      })
    );
  }

  disconnectAll() {
    for (const transport of this.transports.values()) {
      try {
        transport.disconnect();
      } catch {}
    }
  }

  send(peerId: string, data: unknown): boolean {
    const transports = [...this.transports.values()];
    const direct = transports.filter((transport) => transport.peers().includes(peerId));
    const candidates = direct.length ? direct : transports;
    for (const transport of candidates) {
      if (transport.send(peerId, data)) return true;
    }
    return false;
  }

  onMessage(cb: TransportMessageHandler) {
    for (const transport of this.transports.values()) {
      transport.onMessage(cb);
    }
  }

  activeNames(): string[] {
    return [...this.transports.keys()];
  }
}
