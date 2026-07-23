export type ChatMsg = {
  id: string;
  from: string;
  fromName: string;
  to: string;
  text: string;
  ts: number;
  mine: boolean;
  via?: string;
};

export type CallLog = {
  id: string;
  peerId: string;
  peerName: string;
  dir: "in" | "out" | "missed";
  ts: number;
  durationSec: number;
};

const CHAT_KEY = "gc_chats_v1";
const CALL_KEY = "gc_calls_v1";

export function loadChats(): ChatMsg[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveChats(list: ChatMsg[]) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(list.slice(-500)));
}

export function loadCalls(): CallLog[] {
  try {
    return JSON.parse(localStorage.getItem(CALL_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveCalls(list: CallLog[]) {
  localStorage.setItem(CALL_KEY, JSON.stringify(list.slice(-200)));
}
