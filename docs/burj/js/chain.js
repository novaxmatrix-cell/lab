// The floor chain, browser side (also imported by the build script and tests).
//
// Every floor n has a random content key K[n]. Floor n's text is AES-GCM sealed
// with K[n]. Gate n holds K[n+1] wrapped once per accepted answer of floor n,
// each wrap under a key derived from that normalized answer with PBKDF2.
// A correct answer unwraps K[n+1]; a wrong one fails the GCM tag. Floor 1 is
// plaintext. Gate n of the last floor wraps the key of a floor that does not
// exist yet, so solving it still has to unwrap something.

import { normalize } from './normalize.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  to(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s);
  },
  from(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export const gateAad = (n) => enc.encode(`burj:v1:gate:${n}`);
export const floorAad = (n) => enc.encode(`burj:v1:floor:${n}`);

// Key derived from an already-normalized answer.
export async function answerKey(normalized, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(normalized), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export const importContentKey = (raw) =>
  subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

// Try an answer against gate n. Returns the raw key of floor n+1, or null.
export async function openGate(data, n, answer) {
  const gate = data.gates[n - 1];
  const norm = normalize(answer);
  if (!gate || !norm) return null;
  const kek = await answerKey(norm, b64.from(gate.salt), data.iterations);
  for (const w of gate.wraps) {
    try {
      const raw = await subtle.decrypt(
        { name: 'AES-GCM', iv: b64.from(w.iv), additionalData: gateAad(n) },
        kek,
        b64.from(w.ct),
      );
      return new Uint8Array(raw);
    } catch {
      // not this wrap
    }
  }
  return null;
}

// Decrypt floor n with its raw content key. Floor 1 needs no key.
export async function openFloor(data, n, rawKey) {
  const floor = data.floors[n - 1];
  if (!floor) return null;
  if (floor.plain) return floor.plain;
  const key = await importContentKey(rawKey);
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64.from(floor.iv), additionalData: floorAad(n) },
    key,
    b64.from(floor.ct),
  );
  return JSON.parse(dec.decode(pt));
}
