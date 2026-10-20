# NovaX Lab

Static site for **lab.novaxmatrix.com**, served by GitHub Pages from `docs/`.

- `/` NovaX Lab landing page (`docs/index.html`)
- `/burj/` **البرج · Burj**, a daily Arabic puzzle tower (`docs/burj/`)

Plain HTML, CSS and vanilla JS. No framework, no tracking, no CDN except Google Fonts.

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

The game installs as an app (PWA): `docs/burj/manifest.webmanifest` and
`docs/burj/sw.js`. The service worker serves the app shell from a cache whose
version `npm run build` stamps from the shell's contents, so every deploy that
changes the shell is picked up; `floors.json` is always fetched from the network
first.

## Leaderboard (phase 2)

Off by default (`docs/burj/js/config.js`). Preview the UI with mock data at
`/burj/?lb=mock`. Going live is in `supabase/README.md`.
