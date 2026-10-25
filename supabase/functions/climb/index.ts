// climb: the only way to add to the Burj player counter (supabase/counter.sql).
//
// POST { token, first, floor, answer }
//   token  random UUID the device makes fresh each game day (not the device id)
//   first  true until this device has been counted once, ever
//   floor  a floor the player just solved, answer its (normalized) answer
//
// The answer is checked against floor_answers (released floors only). The IP is
// turned into a network key, SHA-256(today's random salt + IP), here in memory;
// only that key reaches the database, and it is deleted at the next 06:00 Hebron.
// Limits and counting happen in burj_climb(), in one transaction.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase at runtime.
// Never copy the service-role key into the repo or the client.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { normalize } from '../_shared/normalize.js';

const MAX_ANSWER_LEN = 60;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://lab.novaxmatrix.com').split(',').map((s) => s.trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    Vary: 'Origin',
  };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: 'origin not allowed' });

  let body: { token?: unknown; first?: unknown; floor?: unknown; answer?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'bad request' });
  }
  const { token, first, floor, answer } = body;
  if (typeof token !== 'string' || !UUID.test(token) || typeof first !== 'boolean' ||
      !Number.isInteger(floor) || (floor as number) < 1 || (floor as number) > 100_000 ||
      typeof answer !== 'string' || answer.length > MAX_ANSWER_LEN) {
    return reply(400, { error: 'bad request' });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  if (!ip) return reply(400, { error: 'bad request' });
  const { data: salt, error: sErr } = await db.rpc('burj_salt');
  if (sErr || !salt) return reply(500, { error: 'server error' });
  const net = await sha256(salt + ip);

  const { data: row, error: fErr } = await db
    .from('floor_answers')
    .select('answers')
    .eq('floor', floor)
    .lte('released_at', new Date().toISOString())
    .maybeSingle();
  if (fErr) return reply(500, { error: 'server error' });
  const ok = !!row && row.answers.includes(normalize(answer));

  // Every attempt goes through burj_climb so wrong answers count towards the rate limit.
  const { data: res, error: cErr } = await db.rpc('burj_climb', { p_net: net, p_token: token, p_first: first, p_ok: ok });
  if (cErr || !res) return reply(500, { error: 'server error' });
  const status = res.result === 'rate' ? 429 : res.result === 'wrong' ? 400 : 200;
  return reply(status, res);
});
