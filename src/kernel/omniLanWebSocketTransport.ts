import type { OmniPacket } from "./omniMeshEngine";

export type OmniLanState = "connecting" | "open" | "closed";

export interface WebSocketLike {
  readyState: number;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface OmniLanTransportOptions {
  url: string;
  nodeId: string;
  nodeName: string;
  createWebSocket?: WebSocketFactory;
  onPacket: (packet: unknown) => void;
  onState?: (state: OmniLanState) => void;
  reconnect?: boolean;
  reconnectBaseMs?: number;
}

/** Production /mesh-ws client shared by browser, Capacitor, and integration workers. */
export class OmniLanWebSocketTransport {
  private socket: WebSocketLike | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly options: OmniLanTransportOptions) {}

  get connected() {
    return this.socket?.readyState === 1;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.stopped = false;
    this.options.onState?.("connecting");
    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocketLike;
      try {
        const factory = this.options.createWebSocket || ((url: string): WebSocketLike => {
          const native = new WebSocket(url);
          const wrapper: WebSocketLike = {
            get readyState() { return native.readyState; },
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            send: (data) => native.send(data),
            close: () => native.close(),
          };
          native.addEventListener("open", () => wrapper.onopen?.());
          native.addEventListener("message", (event) => wrapper.onmessage?.({ data: event.data }));
          native.addEventListener("close", () => wrapper.onclose?.());
          native.addEventListener("error", (event) => wrapper.onerror?.(event));
          return wrapper;
        });
        socket = factory(this.options.url);
      } catch (error) {
        this.connectPromise = null;
        reject(error);
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        settled = true;
        this.connectPromise = null;
        this.reconnectAttempt = 0;
        socket.send(JSON.stringify({
          type: "HELLO",
          id: this.options.nodeId,
          name: this.options.nodeName,
          transport: "omni-lan-ws",
        }));
        this.options.onState?.("open");
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message?.type === "WELCOME" || message?.type === "PEER_ANNOUNCE" || message?.type === "PEER_LEAVE") return;
          this.options.onPacket(message);
        } catch {}
      };
      socket.onerror = (error) => {
        if (!settled) {
          settled = true;
          this.connectPromise = null;
          reject(error instanceof Error ? error : new Error("LAN WebSocket connection failed"));
        }
      };
      socket.onclose = () => {
        this.socket = null;
        this.connectPromise = null;
        this.options.onState?.("closed");
        if (!settled) {
          settled = true;
          reject(new Error("LAN WebSocket closed before opening"));
        }
        this.scheduleReconnect();
      };
    });
    return this.connectPromise;
  }

  send(packet: OmniPacket) {
    if (!this.connected || !this.socket) throw new Error("LAN WebSocket is not connected");
    this.socket.send(JSON.stringify({ ...packet, omni: true, transport: "wifi-lan-ws" }));
  }

  close() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private scheduleReconnect() {
    if (this.stopped || this.options.reconnect === false || this.reconnectTimer) return;
    const base = this.options.reconnectBaseMs ?? 500;
    const delay = Math.min(10_000, base * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }
}
