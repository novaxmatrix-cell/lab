# NovaX Lab

Static site for **lab.novaxmatrix.com**, served by GitHub Pages from `docs/`.

- `/` NovaX Lab landing page (`docs/index.html`)
- `/burj/` **البرج · Burj**, a daily Arabic puzzle tower (`docs/burj/`)

Plain HTML, CSS and vanilla JS. No framework, no cookies, no analytics, no CDN except
Google Fonts. One anonymous player counter, off by default (see below).

## Burj: how the floors are protected

Floors are solved in order and every check happens in the browser. Each floor's
text is AES-GCM encrypted with its own random key, and that key is wrapped
under the previous floor's normalized answer(s) with PBKDF2-SHA256 (600,000
iterations). A correct answer unwraps the next key; a wrong one fails the GCM tag.
Floor 1 is plaintext. Details: `docs/burj/js/chain.js`.

Short answers (numbers, three-letter words) can still be brute-forced offline
by someone determined; the iteration count only slows that down. The
leaderboard re-checks answers on the server for that reason.

## Authoring

Plaintext answers **never** go in the repo.

```sh
cp content/floors.example.json content/floors.private.json   # gitignored
# edit floors, then:
npm run build   # writes docs/burj/data/floors.json (encrypted)
                # and supabase/seed.private.sql (gitignored)
npm test
npm run serve   # http://localhost:8080/burj/
```

Floors can be scheduled ahead: give a floor `"opens": "YYYY-MM-DD"` and it
unlocks at 06:00 Asia/Hebron that day (the build handles DST). Undated floors
are open now and must come first. Add a week of floors, build, commit
`docs/burj/data/floors.json`, push once; no daily pushes. Players keep their progress.

The browser decides what is open using the server time from the `Date` header
of `floors.json`, so moving the phone clock does not help. It is still a static
site: tomorrow's floor is in the public data, encrypted under today's answer, so
a technical player who solves today's floor could decrypt tomorrow's early with
the dev tools. The leaderboard (server) rejects floors before their release time.

`npm run build` ends with a leak check (also `npm run check:leak`) that fails if an
answer of 3+ letters or a locked question appears in any committable file. Words
that are public on purpose (the game name, town names) go in `publicWords`.

Answer normalization (`docs/burj/js/normalize.js`): trim, strip tashkeel, tatweel,
invisible marks and punctuation, أ/إ/آ/ٱ→ا, ة→ه, ى→ي, Arabic-Indic digits→0-9,
collapse spaces, optional leading «ال».

`npm run og` re-renders `docs/burj/og.png` and the app icons with headless Chrome.

YouTube Shorts (separate puzzles, not game floors): `node scripts/make-shorts.mjs [1-12]`
reads `content/youtube.private.json` (gitignored) and writes videos, thumbnails and
titles/descriptions to `~/projects/lab-shorts/`, with music from its `music/` folder if present.

The game installs as an app (PWA): `docs/burj/manifest.webmanifest` and
`docs/burj/sw.js`. The service worker serves the app shell from a cache whose
version `npm run build` stamps from the shell's contents, so every deploy that
changes the shell is picked up; `floors.json` is always fetched from the network
first.

## Player counter

Switched by `counter` in `docs/burj/js/config.js` (Supabase project novax-lab). When on, the tower and the
summit show «صعد البرج X لاعباً غيرك، منهم Y اليوم»: X is every device that ever
solved a floor, Y those that solved one this game day (06:00 to 06:00 Hebron time).
Both leave out the viewer's own device. The line is hidden while X is under 5, and
the «اليوم» part while Y is under 5. No starting numbers: both begin at zero.

- A device sends one request on its first correct answer of each game day: a
  random token made fresh that day, and the floor and answer it just solved. The
  very first request also adds it to X. It remembers this locally
  (`counted`, `climb` in `burj:v1`) and does not send again that day.
- A device that solved floors before the counter went live is added to X as soon
  as it comes back: on page load it proves its last solved floor with the answer
  it already keeps (`answers` in `burj:v1`), checked by the server like any other.
  This adds to X only, not to Y; Y needs a floor solved that day.
- The server keeps only the two totals: X, and Y per day. The day's tokens stop a
  retried request being counted twice and are deleted at the next 06:00. No
  cookies, no account, no device ID.
- Limits against inflating the count: the answer must be right (released floors
  only); per network, 60 attempts per 10 minutes and 500 devices a day; 20,000
  devices a day in all. The network key is SHA-256 of a random salt made for the
  day and the IP, computed in the function; the IP is not stored, and the salt and
  keys are deleted at the next 06:00. Supabase's own platform logs may still
  record request metadata for their retention period.
- Honest limits: X counts devices and browsers, not people. Clearing browser data,
  a private window or a new phone counts the same person again. A device that
  cleared its progress before the counter went live is only counted once it
  solves a floor again. Someone who knows an answer can still add up to the
  per-network limit each day.

Going live is in `supabase/README.md`.

## Leaderboard (phase 2)

Off by default (`docs/burj/js/config.js`). Preview the UI with mock data at
`/burj/?lb=mock`. Going live is in `supabase/README.md`.
