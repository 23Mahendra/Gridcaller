// ═══════════════════════════════════════════════════════
// GRIDALIVE KERNEL — Event Bus
// Decoupled cross-block communication via pub/sub
// Blocks talk to each other through events, not imports
// ═══════════════════════════════════════════════════════

import type { BusMessage } from "./types";

type Handler = (msg: BusMessage) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private globalHandlers = new Set<Handler>();

  /** Subscribe to a specific event type */
  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => { this.handlers.get(type)?.delete(handler); };
  }

  /** Subscribe to ALL events (for debugging, logging, etc.) */
  onAll(handler: Handler): () => void {
    this.globalHandlers.add(handler);
    return () => { this.globalHandlers.delete(handler); };
  }

  /** Emit an event to all listeners of that type */
  emit(type: string, payload: any, source: string = "kernel") {
    const msg: BusMessage = { type, payload, source, timestamp: Date.now() };
    this.handlers.get(type)?.forEach(h => { try { h(msg); } catch {} });
    this.globalHandlers.forEach(h => { try { h(msg); } catch {} });
  }
}

/** Global event bus singleton — all blocks share this */
export const bus = new EventBus();
