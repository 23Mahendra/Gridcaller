import { WebSocket } from "ws";
import {
  OmniMeshEngine,
  type OmniPacket,
  type OmniTraceEvent,
} from "../../src/kernel/omniMeshEngine";
import type { WebSocketFactory, WebSocketLike } from "../../src/kernel/omniLanWebSocketTransport";

const nodeId = process.env.OMNI_NODE_ID || "node";
const url = process.env.OMNI_LAN_URL || "ws://127.0.0.1:8765/mesh-ws";

const createWebSocket: WebSocketFactory = (target) => {
  const socket = new WebSocket(target);
  const wrapper: WebSocketLike = {
    get readyState() { return socket.readyState; },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => socket.send(data),
    close: () => socket.close(),
  };
  socket.on("open", () => wrapper.onopen?.());
  socket.on("message", (data) => wrapper.onmessage?.({ data: String(data) }));
  socket.on("close", () => wrapper.onclose?.());
  socket.on("error", (error) => wrapper.onerror?.(error));
  return wrapper;
};

const engine = new OmniMeshEngine({ nodeId, nodeName: nodeId, manualStart: true });
const deliveries = new Map<string, number>();
engine.onPacket((packet) => {
  if (packet.type !== "OMNI_ACK") {
    deliveries.set(packet.id, (deliveries.get(packet.id) || 0) + 1);
  }
});
engine.onTrace((trace: OmniTraceEvent) => process.send?.({ kind: "trace", trace }));

type Command =
  | { requestId: string; action: "send"; type: string; payload: unknown; options: Parameters<OmniMeshEngine["send"]>[2] }
  | { requestId: string; action: "raw"; packet: OmniPacket }
  | { requestId: string; action: "flush" }
  | { requestId: string; action: "status"; packetId: string }
  | { requestId: string; action: "close" };

process.on("message", async (command: Command) => {
  try {
    let result: unknown;
    if (command.action === "send") {
      const packet = await engine.send(command.type, command.payload, command.options);
      result = { packet, state: engine.getDeliveryState(packet.id) };
    } else if (command.action === "raw") {
      engine.transmitExistingPacket(command.packet);
      result = { sent: true };
    } else if (command.action === "flush") {
      await engine.flushRetries();
      result = { queued: engine.getQueuedPacketIds() };
    } else if (command.action === "status") {
      result = {
        state: engine.getDeliveryState(command.packetId),
        deliveries: deliveries.get(command.packetId) || 0,
        queued: engine.getQueuedPacketIds().includes(command.packetId),
      };
    } else {
      engine.stop();
      result = { closed: true };
      process.send?.({ kind: "response", requestId: command.requestId, result });
      process.exit(0);
      return;
    }
    process.send?.({ kind: "response", requestId: command.requestId, result });
  } catch (error) {
    process.send?.({
      kind: "response",
      requestId: command.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

await engine.connectLan(url, createWebSocket, true);
process.send?.({ kind: "ready", nodeId });
