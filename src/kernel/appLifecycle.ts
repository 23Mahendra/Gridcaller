export type LifecycleMode = "active" | "background";

export type LifecycleState = {
  mode: LifecycleMode;
  shouldReconnect: boolean;
  shouldRing: boolean;
  heartbeatMs: number;
};

export function deriveLifecycleState(opts: {
  visible: boolean;
  activeCall: boolean;
  incomingCall: boolean;
  outgoingCall: boolean;
}): LifecycleState {
  const hasCallActivity = opts.activeCall || opts.incomingCall || opts.outgoingCall;
  if (!opts.visible && hasCallActivity) {
    return {
      mode: "background",
      shouldReconnect: true,
      shouldRing: opts.incomingCall,
      heartbeatMs: 5000,
    };
  }

  return {
    mode: "active",
    shouldReconnect: false,
    shouldRing: false,
    heartbeatMs: 0,
  };
}
