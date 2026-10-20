// Build side of the chain: turns authoring floors into public, encrypted data.
// See docs/burj/js/chain.js for the scheme.

import { normalize } from '../docs/burj/js/normalize.js';
import { answerKey, b64, gateAad, floorAad, importContentKey } from '../docs/burj/js/chain.js';
import { opensAtUtc } from '../docs/burj/js/schedule.js';

const subtle = globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// Every gate gets the same number of wraps (real ones plus random filler) so the
// public data does not reveal how many answers a floor accepts.
export const WRAPS_PER_GATE = 8;

// Pad floor plaintext to a multiple of 128 bytes (JSON allows trailing spaces) so
// ciphertext length does not hint at question length.
function pad(json) {
  const bytes = new TextEncoder().encode(json);
  const out = new Uint8Array(Math.ceil((bytes.length + 1) / 128) * 128).fill(0x20);
  out.set(bytes);
  return out;
}

export function acceptedAnswers(floor) {
  const list = [...new Set(floor.answers.map(normalize).filter(Boolean))];
  if (!list.length) throw new Error(`floor ${floor.n ?? '?'}: no usable answers`);
  return list;
}

// floors: [{ q, answers: [...], hint?, opens? }], in order. Returns the public data object.
// The open date stays outside the ciphertext: the browser needs it before it has a key.
export async function sealChain(floors, { iterations, wrapsPerGate = WRAPS_PER_GATE } = {}) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('iterations required');
  const keys = floors.map(() => rand(32));
  keys.push(rand(32)); // key of the floor after the last one

  const out = { v: 1, iterations, total: floors.length, floors: [], gates: [] };

  for (let i = 0; i < floors.length; i++) {
    const n = i + 1;
    const { q, hint } = floors[i];
    const content = hint ? { q, hint } : { q };
    const when = floors[i].opens ? { opens: floors[i].opens, opensAt: opensAtUtc(floors[i].opens) } : {};
    if (n === 1) {
      out.floors.push({ plain: content, ...when });
    } else {
      const iv = rand(12);
      const ct = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: floorAad(n) },
        await importContentKey(keys[i]),
        pad(JSON.stringify(content)),
      );
      out.floors.push({ iv: b64.to(iv), ct: b64.to(ct), ...when });
    }

    const answers = acceptedAnswers({ ...floors[i], n });
    if (answers.length > wrapsPerGate) throw new Error(`floor ${n}: more than ${wrapsPerGate} answers`);
    const salt = rand(16);
    const wraps = [];
    for (const a of answers) {
      const iv = rand(12);
      const ct = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: gateAad(n) },
        await answerKey(a, salt, iterations),
        keys[i + 1],
      );
      wraps.push({ iv: b64.to(iv), ct: b64.to(ct) });
    }
    // 32-byte key + 16-byte tag: filler has the same shape as a real wrap.
    while (wraps.length < wrapsPerGate) wraps.push({ iv: b64.to(rand(12)), ct: b64.to(rand(48)) });
    // Shuffle so the real wraps are not always first.
    for (let j = wraps.length - 1; j > 0; j--) {
      const k = rand(1)[0] % (j + 1);
      [wraps[j], wraps[k]] = [wraps[k], wraps[j]];
    }
    out.gates.push({ salt: b64.to(salt), wraps });
  }
  return out;
}
