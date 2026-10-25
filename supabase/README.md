# Burj on Supabase: leaderboard and player counter

Prepared, not deployed.

1. Create a Supabase project (free tier).
2. SQL editor: run `schema.sql`, then `seed.private.sql` (made by `npm run build`,
   gitignored). Re-run the seed after every build that adds a floor. To hold a
   floor back until a date: `update floor_answers set released_at = '…' where floor = N;`
3. Deploy the function (needs the Supabase CLI):
   ```sh
   supabase link --project-ref <ref>
   supabase secrets set IP_HASH_SALT=<random string> ALLOWED_ORIGINS=https://lab.novaxmatrix.com
   supabase functions deploy submit-score --no-verify-jwt
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Never
   put the service-role key in this repo or in client code.
4. In `docs/burj/js/config.js` set `mode: 'live'`, `supabaseUrl` and `anonKey`
   (the anon or publishable key is public by design).

## What the function checks

- CORS origin, rate limits (30/hour per device, 200/hour per hashed IP)
- nickname (max 20, bad-word filter) and town (must be in the list)
- every answer from floor 1 up to the claimed floor, against `floor_answers`
- only released floors
- impossible jumps: since the last submission, at most one floor per 15 seconds

`_shared/*.js` are copies of `docs/burj/js/` made by `npm run build`; a test
fails if they drift.

Limits: a device id is just a random UUID in localStorage, so a determined
person can create new "devices"; the IP limit and answer checks bound the damage.

## Player counter

Prepared, not deployed. Needs the project and `seed.private.sql` from above
(the answer check reads `floor_answers`).

1. SQL editor: run `counter.sql`. Optionally enable pg_cron and run the
   `cron.schedule` line at the end of it, so yesterday's tokens, salt and network
   keys are deleted soon after 06:00 even on a quiet morning.
2. Deploy: `supabase functions deploy climb --no-verify-jwt` (it needs no secrets;
   it makes a fresh random salt each day in `climb_salts`).
3. In `docs/burj/js/config.js` set `counter.mode: 'live'`, `supabaseUrl` and `anonKey`.

The public can read only the `climb_counts` view (two numbers and the day). The
anon key cannot read the tables or call the functions; only the climb function,
with the injected service-role key, writes. Limits are in `burj_climb()`.
