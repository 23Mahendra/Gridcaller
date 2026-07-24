const encoder = new TextEncoder();
const decoder = new TextDecoder();

function deriveKey(secret: string): Uint8Array {
  const salt = encoder.encode('gridcaller-mesh-v1');
  const password = encoder.encode(secret);
  let hash = 0;
  for (const byte of password) hash = (hash * 31 + byte) >>> 0;
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = (salt[i % salt.length] + hash + i) & 0xff;
  }
  return key;
}

export function encryptText(text: string, secret: string) {
  const key = deriveKey(secret);
  const data = encoder.encode(text);
  const output = new Uint8Array(data.length + 1);
  output[0] = data.length & 0xff;
  for (let i = 0; i < data.length; i++) output[i + 1] = (data[i] ^ key[i % key.length]) & 0xff;
  return btoa(String.fromCharCode(...output));
}

export function decryptText(cipher: string, secret: string) {
  const key = deriveKey(secret);
  const bytes = Uint8Array.from(atob(cipher), (c) => c.charCodeAt(0));
  const len = bytes[0] || 0;
  const data = new Uint8Array(len);
  for (let i = 0; i < len; i++) data[i] = (bytes[i + 1] ^ key[i % key.length]) & 0xff;
  return decoder.decode(data);
}

export function createLocalMeshEnvelope(payload: any, secret: string) {
  return {
    kind: 'mesh-envelope',
    cipher: encryptText(JSON.stringify(payload), secret),
    ts: Date.now(),
  };
}

export function readLocalMeshEnvelope(envelope: any, secret: string) {
  if (!envelope || typeof envelope.cipher !== 'string') return null;
  try {
    return JSON.parse(decryptText(envelope.cipher, secret));
  } catch {
    return null;
  }
}
