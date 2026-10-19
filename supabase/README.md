# Burj leaderboard on Supabase

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
