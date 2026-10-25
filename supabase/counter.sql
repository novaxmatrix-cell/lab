-- البرج · Burj player counter: «صعد البرج X لاعباً غيرك، منهم Y اليوم».
-- Run in the Supabase SQL editor after schema.sql (it needs floor_answers).
--
-- What is kept:
--   * climb_total : one number, every device that ever solved a floor. No IDs.
--   * climb_days  : one number per game day (06:00 to 06:00 Hebron time).
-- What lives only until the next 06:00 Hebron, then is deleted:
--   * climb_tokens: random tokens a device makes fresh each day, so a retried
--                   request is not counted twice. Not linked to anything else.
--   * climb_salts : the day's random salt for the network key.
--   * climb_nets  : per network key (SHA-256 of salt + IP, made in the climb
--                   function; the IP itself is never stored), attempts in the
--                   last 10 minutes and devices counted today, for the limits.
--
-- Access: RLS on, no policies, so the anon key cannot touch the tables. The
-- public reads one view (climb_counts). Writes go only through the climb Edge
-- Function, which calls burj_climb() with the service-role key.

-- Game day: the date whose 06:00 Hebron has passed (05:59 still counts as yesterday).
create or replace function public.burj_day() returns date
language sql stable as $$
  select ((now() at time zone 'Asia/Hebron') - interval '6 hours')::date
$$;

create table if not exists public.climb_total (
  id      int primary key default 1 check (id = 1),
  players bigint not null default 0 check (players >= 0)
);
insert into public.climb_total (id) values (1) on conflict do nothing;

create table if not exists public.climb_days (
  day     date primary key,
  players int not null default 0 check (players >= 0)
);

create table if not exists public.climb_tokens (
  day   date not null,
  token uuid not null,
  primary key (day, token)
);

create table if not exists public.climb_salts (
  day  date primary key,
  salt text not null
);

create table if not exists public.climb_nets (
  day          date not null,
  net          text not null,
  window_start timestamptz not null default now(),
  attempts     int not null default 0, -- in the current 10-minute window
  counted      int not null default 0, -- devices counted today from this network
  primary key (day, net)
);

alter table public.climb_total  enable row level security;
alter table public.climb_days   enable row level security;
alter table public.climb_tokens enable row level security;
alter table public.climb_salts  enable row level security;
alter table public.climb_nets   enable row level security;
revoke all on public.climb_total, public.climb_days, public.climb_tokens, public.climb_salts, public.climb_nets
  from anon, authenticated;

-- Delete everything that is only needed for the current day.
create or replace function public.burj_climb_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from climb_tokens where day < burj_day();
  delete from climb_salts  where day < burj_day();
  delete from climb_nets   where day < burj_day();
$$;

-- Today's salt, made on first use. Random, never derived from a secret, and
-- deleted with the day, so yesterday's network keys cannot be recomputed.
create or replace function public.burj_salt() returns text
language plpgsql security definer set search_path = public as $$
declare
  d date := burj_day();
  s text;
begin
  perform burj_climb_cleanup();
  insert into climb_salts (day, salt) values (d, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    on conflict do nothing;
  select salt into s from climb_salts where day = d;
  return s;
end $$;

-- One attempt from the climb function. p_ok: the answer was right.
-- p_first: the device has never been counted, so it also adds to climb_total.
-- Limits (every attempt counts towards the rate, right or wrong):
--   60 attempts per network per 10 minutes, 500 devices per network per day
--   (mobile carriers put many players behind one IP), 20000 devices per day overall.
create or replace function public.burj_climb(p_net text, p_token uuid, p_first boolean, p_ok boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d date := burj_day();
  n climb_nets%rowtype;
  result text;
begin
  perform burj_climb_cleanup();

  insert into climb_nets (day, net) values (d, p_net) on conflict do nothing;
  select * into n from climb_nets where day = d and net = p_net for update;
  if n.window_start < now() - interval '10 minutes' then
    n.window_start := now();
    n.attempts := 0;
  end if;
  n.attempts := n.attempts + 1;
  update climb_nets set window_start = n.window_start, attempts = n.attempts where day = d and net = p_net;

  insert into climb_days (day) values (d) on conflict do nothing;
  perform 1 from climb_days where day = d for update;

  if n.attempts > 60 then
    result := 'rate';
  elsif not p_ok then
    result := 'wrong';
  elsif exists (select 1 from climb_tokens where day = d and token = p_token) then
    result := 'already';
  elsif n.counted >= 500 or (select players from climb_days where day = d) >= 20000 then
    result := 'capped';
  else
    insert into climb_tokens (day, token) values (d, p_token);
    update climb_days set players = players + 1 where day = d;
    update climb_nets set counted = counted + 1 where day = d and net = p_net;
    if p_first then
      update climb_total set players = players + 1 where id = 1;
    end if;
    result := 'counted';
  end if;

  return jsonb_build_object(
    'result', result,
    'day', d,
    'players', (select players from climb_total where id = 1),
    'today', (select players from climb_days where day = d)
  );
end $$;

revoke all on function public.burj_climb_cleanup(), public.burj_salt(), public.burj_climb(text, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.burj_salt(), public.burj_climb(text, uuid, boolean, boolean) to service_role;

-- The only thing the public can read: the two numbers and the current game day.
create or replace view public.climb_counts
with (security_invoker = false) as
  select (select players from public.climb_total where id = 1)                              as players,
         coalesce((select players from public.climb_days where day = public.burj_day()), 0) as today,
         public.burj_day()                                                                as day;

revoke all on public.climb_counts from anon, authenticated;
grant select on public.climb_counts to anon, authenticated;

-- Recommended (needs the pg_cron extension): clear yesterday's tokens, salt and
-- network keys soon after 06:00 Hebron even if nobody plays. Every climb also
-- runs the cleanup, so this only matters on quiet mornings.
-- select cron.schedule('burj-climb-cleanup', '5 * * * *', $$select public.burj_climb_cleanup()$$);
