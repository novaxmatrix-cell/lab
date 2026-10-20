// npm run check:leak (also runs at the end of every build)
// Fails if a plaintext answer (as a whole word) or a locked question appears in
// any file that could be committed. Numbers ("13", "120") and answers shorter than
// 3 characters are too common in code to search for; only the encryption protects them.
// Words that are public on purpose (the game is called «البرج», town names)
// go in "publicWords" in floors.private.json.

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalize } from '../docs/burj/js/normalize.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', '.out', 'content']);
const SKIP_FILE = /\.private\.|\.(png|jpe?g|webp|ico|woff2?)$/;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(dir + e.name + '/');
    } else if (!SKIP_FILE.test(e.name)) {
      yield dir + e.name;
    }
  }
}

// Strip tashkeel etc. but keep the text intact enough to search.
const flat = (s) => normalize(' ' + s).replace(/\s+/g, ' ');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole words only (with an optional «ال»), so «ليل» does not match «قليل».
const wordRe = (needle) => new RegExp(`(?<![\\p{L}\\p{N}])(?:ال)?${esc(needle)}(?![\\p{L}\\p{N}])`, 'u');

export async function findLeaks(floors, publicWords = []) {
  const allowed = new Set(publicWords.map(normalize));
  const needles = [];
  floors.forEach((f, i) => {
    for (const a of f.answers.map(normalize)) {
      if (a.length >= 3 && !/^[\d\s]+$/.test(a) && !allowed.has(a)) needles.push([`floor ${i + 1} answer`, wordRe(a)]);
    }
    if (i > 0) needles.push([`floor ${i + 1} question`, wordRe(flat(f.q))]);
  });
  const hits = [];
  for await (const file of walk(root)) {
    const text = flat(await readFile(file, 'utf8'));
    for (const [what, needle] of needles) {
      if (needle.test(text)) hits.push(`  ${file.slice(root.length)}: ${what}`);
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = JSON.parse(await readFile(root + 'content/floors.private.json', 'utf8'));
  const hits = await findLeaks(src.floors, src.publicWords);
  if (hits.length) {
    console.error('Plaintext answers found in committable files:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('No plaintext answers or locked questions in committable files.');
}
