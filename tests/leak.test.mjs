import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findLeaks } from '../scripts/check-leak.mjs';

// The real check runs in `npm run build`; this keeps it honest on the real content when present.
let priv = null;
try {
  priv = JSON.parse(await readFile(new URL('../content/floors.private.json', import.meta.url), 'utf8'));
} catch {}

test('no answers or locked questions in committable files', { skip: !priv && 'no content/floors.private.json' }, async () => {
  assert.deepEqual(await findLeaks(priv.floors, priv.publicWords), []);
});

test('matches whole words, with optional ال, not parts of words', async () => {
  // This file itself is scanned: a needle that only appears inside longer words must not hit.
  // Built at runtime so the needle never appears as a word in this file.
  const inside = ['ق', 'يقت'].join(''); // only occurs inside «دقيقتين» in app code
  const hits = await findLeaks([{ q: 'x', answers: [inside] }]);
  assert.deepEqual(hits, []);
  const hits2 = await findLeaks([{ q: 'x', answers: ['متوسط'] }]); // a real word in the UI
  assert.ok(hits2.length > 0);
});
