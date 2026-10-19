// npm run check:leak (also runs at the end of every build)
// Fails if a plaintext answer or a locked question appears in any file that
// could be committed. Answers shorter than 3 characters (digits like "13") are
// too common to search for; they are protected only by the encryption.
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

// Strip tashkeel etc. but keep the text intact enough for substring search.
const flat = (s) => normalize(' ' + s).replace(/\s+/g, ' ');

export async function findLeaks(floors, publicWords = []) {
  const allowed = new Set(publicWords.map(normalize));
  const needles = [];
  floors.forEach((f, i) => {
    for (const a of f.answers.map(normalize)) {
      if (a.length >= 3 && !allowed.has(a)) needles.push([`floor ${i + 1} answer`, a]);
    }
    if (i > 0) needles.push([`floor ${i + 1} question`, flat(f.q)]);
  });
  const hits = [];
  for await (const file of walk(root)) {
    const text = flat(await readFile(file, 'utf8'));
    for (const [what, needle] of needles) {
      if (text.includes(needle)) hits.push(`  ${file.slice(root.length)}: ${what}`);
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
