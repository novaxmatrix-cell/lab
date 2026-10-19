import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sealChain } from '../scripts/seal.mjs';
import { openGate, openFloor } from '../docs/burj/js/chain.js';

// Fixture floors (not the real puzzles), low iteration count to keep tests fast.
const FLOORS = [
  { q: 'سؤال 1', answers: ['شمس'] },
  { q: 'سؤال 2', answers: ['قمر', 'هلال'] },
  { q: 'سؤال 3', answers: ['42', 'اثنان واربعون'], hint: 'رقم' },
  { q: 'سؤال 4', answers: ['مدرسة'] },
];
const data = await sealChain(FLOORS, { iterations: 1000 });

test('public data has no plaintext beyond floor 1', () => {
  const json = JSON.stringify(data);
  assert.ok(json.includes('سؤال 1'));
  for (const s of ['سؤال 2', 'سؤال 3', 'سؤال 4', 'شمس', 'قمر', 'هلال', 'مدرسه', 'مدرسة', 'رقم']) assert.ok(!json.includes(s), s);
  assert.equal(data.floors[0].ct, undefined);
});

test('every gate has the same number of wraps', () => {
  const counts = new Set(data.gates.map((g) => g.wraps.length));
  assert.equal(counts.size, 1);
});

test('correct answers walk the whole chain', async () => {
  let key = null;
  for (let n = 1; n <= FLOORS.length; n++) {
    const floor = await openFloor(data, n, key);
    assert.equal(floor.q, FLOORS[n - 1].q);
    assert.equal(floor.hint, FLOORS[n - 1].hint);
    key = await openGate(data, n, FLOORS[n - 1].answers[0]);
    assert.ok(key, `floor ${n} answer should open the gate`);
    assert.equal(key.length, 32);
  }
});

test('every accepted answer, in messy spellings, opens its gate to the same key', async () => {
  const variants = {
    1: ['الشمس', ' شَمْس ', 'شمس!'],
    2: ['القمر', 'هلال', 'الهلال'],
    3: ['٤٢', '42', 'اثنان وأربعون'],
    4: ['المدرسة', 'مدرسه', 'مَدرَسة'],
  };
  for (const [n, list] of Object.entries(variants)) {
    const keys = [];
    for (const a of list) {
      const k = await openGate(data, Number(n), a);
      assert.ok(k, `floor ${n}: "${a}" should be accepted`);
      keys.push(Buffer.from(k).toString('hex'));
    }
    assert.equal(new Set(keys).size, 1, `floor ${n}: all answers unwrap the same key`);
  }
});

test('wrong answers never open a gate', async () => {
  const wrong = ['', ' ', 'لا', 'شم', 'شمسس', 'قمرر', '41', '420', 'مدارس', 'x', 'null', 'undefined', '0'];
  for (let n = 1; n <= FLOORS.length; n++) {
    // Other floors' answers are wrong here too.
    const others = FLOORS.flatMap((f, i) => (i === n - 1 ? [] : f.answers));
    for (const a of [...wrong, ...others]) {
      assert.equal(await openGate(data, n, a), null, `floor ${n}: "${a}" must not open`);
    }
  }
});

test('a wrong key never decrypts the next floor', async () => {
  const bogus = new Uint8Array(32).fill(7);
  for (let n = 2; n <= FLOORS.length; n++) await assert.rejects(openFloor(data, n, bogus));
  // The key for floor 3 does not open floor 2 or 4 (keys are per floor, AAD binds the floor number).
  const k2 = await openGate(data, 1, 'شمس');
  const k3 = await openGate(data, 2, 'قمر');
  await assert.rejects(openFloor(data, 2, k3));
  await assert.rejects(openFloor(data, 4, k3));
  await openFloor(data, 2, k2);
});

test('tampered ciphertext is rejected', async () => {
  const copy = structuredClone(data);
  const ct = Buffer.from(copy.floors[1].ct, 'base64');
  ct[0] ^= 1;
  copy.floors[1].ct = ct.toString('base64');
  const k2 = await openGate(data, 1, 'شمس');
  await assert.rejects(openFloor(copy, 2, k2));
});

test('the last gate still checks the answer (summit)', async () => {
  assert.ok(await openGate(data, 4, 'مدرسة'));
  assert.equal(await openGate(data, 4, 'قمر'), null);
  assert.equal(await openGate(data, 5, 'مدرسة'), null); // no gate beyond the last floor
});

// The real build, if the private authoring file is present (never in CI).
let priv = null;
try {
  priv = JSON.parse(await readFile(new URL('../content/floors.private.json', import.meta.url), 'utf8'));
} catch {}

test('built docs/burj/data/floors.json matches the private content', { skip: !priv && 'no content/floors.private.json' }, async () => {
  const built = JSON.parse(await readFile(new URL('../docs/burj/data/floors.json', import.meta.url), 'utf8'));
  assert.equal(built.total, priv.floors.length);
  assert.ok(built.iterations >= 300000);
  let key = null;
  for (let n = 1; n <= built.total; n++) {
    const f = priv.floors[n - 1];
    assert.equal((await openFloor(built, n, key)).q, f.q);
    for (const a of f.answers) assert.ok(await openGate(built, n, a), `floor ${n}: "${a}"`);
    const others = priv.floors.flatMap((g, i) => (i === n - 1 ? [] : g.answers)).filter((a) => !f.answers.includes(a));
    for (const a of [...new Set(others), 'خطأ', '']) assert.equal(await openGate(built, n, a), null, `floor ${n}: "${a}" must not open`);
    key = await openGate(built, n, f.answers[0]);
  }
});
