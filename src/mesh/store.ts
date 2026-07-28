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

import {
  loadCallLogs as loadEncryptedCallLogs,
  loadChats as loadEncryptedChats,
  replaceCallLogs,
  replaceChats,
} from "./encryptedDb";

let chatCache: ChatMsg[] | null = null;
let callCache: CallLog[] | null = null;
let encryptedBootstrapped = false;

function readLocalChats(): ChatMsg[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
  } catch {
    return [];
  }
}

function readLocalCalls(): CallLog[] {
  try {
    return JSON.parse(localStorage.getItem(CALL_KEY) || "[]");
  } catch {
    return [];
  }
}

function bootstrapEncryptedStore() {
  if (encryptedBootstrapped || typeof window === "undefined") return;
  encryptedBootstrapped = true;
  void (async () => {
    try {
      const encChats = await loadEncryptedChats<ChatMsg>();
      if (encChats.length) {
        chatCache = encChats;
        localStorage.setItem(CHAT_KEY, JSON.stringify(encChats.slice(-500)));
      }
      const encCalls = await loadEncryptedCallLogs<CallLog>();
      if (encCalls.length) {
        callCache = encCalls;
        localStorage.setItem(CALL_KEY, JSON.stringify(encCalls.slice(-200)));
      }
    } catch {
      /* keep local fallback */
    }
  })();
}

export function loadChats(): ChatMsg[] {
  bootstrapEncryptedStore();
  if (chatCache) return chatCache;
  chatCache = readLocalChats();
  return chatCache;
}

export function saveChats(list: ChatMsg[]) {
  const clipped = list.slice(-500);
  chatCache = clipped;
  localStorage.setItem(CHAT_KEY, JSON.stringify(clipped));
  void replaceChats(
    clipped.map((item) => ({
      id: item.id,
      ts: item.ts,
      peerId: item.mine ? item.to : item.from,
      payload: item,
    }))
  ).catch(() => {});
}

export function loadCalls(): CallLog[] {
  bootstrapEncryptedStore();
  if (callCache) return callCache;
  callCache = readLocalCalls();
  return callCache;
}

export function saveCalls(list: CallLog[]) {
  const clipped = list.slice(-200);
  callCache = clipped;
  localStorage.setItem(CALL_KEY, JSON.stringify(clipped));
  void replaceCallLogs(
    clipped.map((item) => ({
      id: item.id,
      ts: item.ts,
      peerId: item.peerId,
      payload: item,
    }))
  ).catch(() => {});
}

export async function loadChatsAsync() {
  try {
    return await loadEncryptedChats<ChatMsg>();
  } catch {
    return loadChats();
  }
}

export async function loadCallsAsync() {
  try {
    return await loadEncryptedCallLogs<CallLog>();
  } catch {
    return loadCalls();
  }
}
