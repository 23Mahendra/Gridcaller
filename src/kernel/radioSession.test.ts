import assert from "node:assert/strict";
import test from "node:test";
import {
  RadioFloorLock,
  RadioSessionController,
  buildRadioUsers,
  type RadioAudioSessionPort,
} from "./radioSession";
import type { CallUiState } from "./callSession";

const idle = (): CallUiState => ({
  phase: "idle",
  peerId: "",
  peerName: "",
  callId: "",
  method: "",
  error: "",
  video: false,
  secs: 0,
  mode: "call",
  localAudioReady: false,
  remoteAudioReady: false,
  localTransmitting: false,
  remoteTransmitting: false,
});

class DeterministicAudioPort implements RadioAudioSessionPort {
  state = idle();
  listeners = new Set<(state: CallUiState) => void>();
  connectCount = 0;
  disconnectCount = 0;
  transmit: boolean[] = [];
  failConnect = "";

  snapshot() { return { ...this.state }; }
  subscribe(listener: (state: CallUiState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }
  emit(update: Partial<CallUiState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener(this.snapshot());
  }
  async connect(peerId: string, peerName: string) {
    this.connectCount++;
    if (this.failConnect) {
      this.emit({ mode: "radio", phase: "idle", error: this.failConnect });
      throw new Error(this.failConnect);
    }
    this.emit({ mode: "radio", phase: "outgoing", peerId, peerName, callId: "radio-1" });
  }
  async accept() { this.emit({ phase: "outgoing" }); }
  reject() { this.emit({ phase: "idle", mode: "call" }); }
  disconnect() {
    this.disconnectCount++;
    this.emit({ phase: "idle", mode: "call", localAudioReady: false, remoteAudioReady: false });
  }
  usable() {
    return this.state.mode === "radio" && this.state.phase === "active" &&
      this.state.localAudioReady && this.state.remoteAudioReady;
  }
  setTransmit(active: boolean) {
    if (!this.usable()) throw new Error("audio unavailable");
    this.transmit.push(active);
    this.emit({ localTransmitting: active });
  }
  async setSpeaker() { return { ok: true, message: "ok" }; }
}

const user = { id: "peer-b", name: "B", online: true, transports: ["webrtc"] };

test("radio discovery uses real peer records, merges transports, and excludes this device", () => {
  const users = buildRadioUsers([
    { id: "self", name: "Me", online: true },
    { id: "peer-b", name: "B", online: false, via: ["lan"] },
    { id: "peer-b", name: "B", online: true, transports: ["webrtc"], lastSeen: 10 },
  ], ["self"]);
  assert.deepEqual(users, [{ ...user, lastSeen: 10, transports: ["lan", "webrtc"] }]);
});

test("radio only reaches CONNECTED after a usable audio session and prevents duplicate connects", async () => {
  const port = new DeterministicAudioPort();
  const radio = new RadioSessionController(port);
  radio.select(user);
  await radio.connect();
  await radio.connect();
  assert.equal(port.connectCount, 1);
  assert.equal(radio.snapshot().state, "CONNECTING");
  port.emit({ phase: "active", localAudioReady: true, remoteAudioReady: true });
  assert.equal(radio.snapshot().state, "CONNECTED");
  radio.destroy();
});

test("PTT toggles the established microphone track and receiving follows remote media state", () => {
  const port = new DeterministicAudioPort();
  const radio = new RadioSessionController(port);
  radio.select(user);
  port.emit({ mode: "radio", phase: "active", peerId: user.id, peerName: user.name,
    localAudioReady: true, remoteAudioReady: true });
  radio.pressToTalk();
  assert.equal(radio.snapshot().state, "TRANSMITTING");
  radio.releaseToTalk();
  assert.deepEqual(port.transmit, [true, false]);
  port.emit({ localTransmitting: false, remoteTransmitting: true });
  assert.equal(radio.snapshot().state, "RECEIVING");
  port.emit({ remoteAudioReady: false });
  assert.equal(radio.snapshot().state, "CONNECTING");
  radio.destroy();
});

test("offline, permission failure, incoming authorization, disconnect and reconnect states are explicit", async () => {
  const port = new DeterministicAudioPort();
  const radio = new RadioSessionController(port);
  radio.select({ ...user, online: false });
  await assert.rejects(() => radio.connect(), /offline/);
  await assert.rejects(() => radio.acceptIncoming(), /authorized/);

  radio.select(user);
  port.failConnect = "Microphone permission denied";
  await assert.rejects(() => radio.connect(), /permission denied/);
  assert.equal(radio.snapshot().state, "FAILED");
  port.failConnect = "";
  port.emit({ error: "", phase: "idle", mode: "call" });
  await radio.connect();
  assert.equal(port.connectCount, 2);
  radio.disconnect();
  assert.equal(port.disconnectCount, 1);
  assert.equal(radio.snapshot().state, "AVAILABLE");
  radio.destroy();
});

test("group floor permits one speaker and releases only for its holder", () => {
  const floor = new RadioFloorLock();
  assert.equal(floor.acquire("A"), true);
  assert.equal(floor.acquire("B"), false);
  assert.equal(floor.release("B"), false);
  assert.equal(floor.release("A"), true);
  assert.equal(floor.acquire("B"), true);
});
