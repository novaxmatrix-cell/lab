// submit-score: the only way to write to the Burj leaderboard.
//
// POST { device_id, nickname, town, answers: string[] }
//   answers[i] is the player's answer to floor i+1, so answers.length is the floor claimed.
//
// Checks, in order: CORS origin, rate limit (device and IP), input shape, nickname
// filter, town list, every answer against floor_answers, released floors only, and
// impossible jumps (more floors since the last submission than time allows).
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase at runtime.
// Never copy the service-role key into the repo or the client.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { normalize } from '../_shared/normalize.js';
import { nicknameError } from '../_shared/badwords.js';
import { TOWNS } from '../_shared/towns.js';

const MIN_SECONDS_PER_FLOOR = 15; // faster than this between submissions is not a human
const MAX_PER_HOUR_DEVICE = 30;
const MAX_PER_HOUR_IP = 200; // many players can share one mobile carrier IP
const MAX_ANSWER_LEN = 60;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://lab.novaxmatrix.com').split(',').map((s) => s.trim());
const IP_SALT = Deno.env.get('IP_HASH_SALT') ?? 'burj';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOWN_NAMES = new Set(TOWNS.map(([name]) => name));

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

  let body: { device_id?: unknown; nickname?: unknown; town?: unknown; answers?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'طلب غير صالح' });
  }

  const deviceId = typeof body.device_id === 'string' && UUID.test(body.device_id) ? body.device_id : null;
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const ipHash = ip ? await sha256(IP_SALT + ip) : null;

  const log = (ok: boolean, reason: string | null) =>
    db.from('submissions').insert({ device_id: deviceId, ip_hash: ipHash, ok, reason });

  // ---- Rate limit (counts every attempt, good or bad)
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  if (deviceId) {
    const { count } = await db.from('submissions').select('id', { count: 'exact', head: true }).eq('device_id', deviceId).gte('created_at', hourAgo);
    if ((count ?? 0) >= MAX_PER_HOUR_DEVICE) return reply(429, { error: 'محاولات كثيرة، حاول بعد قليل' });
  }
  if (ipHash) {
    const { count } = await db.from('submissions').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', hourAgo);
    if ((count ?? 0) >= MAX_PER_HOUR_IP) return reply(429, { error: 'محاولات كثيرة، حاول بعد قليل' });
  }

  const reject = async (status: number, reason: string, error: string) => {
    await log(false, reason);
    return reply(status, { error });
  };

  // ---- Input
  if (!deviceId) return reject(400, 'bad device', 'طلب غير صالح');
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim().replace(/\s+/g, ' ') : '';
  const nickErr = nicknameError(nickname);
  if (nickErr) return reject(400, 'nickname', nickErr);
  const town = typeof body.town === 'string' ? body.town : '';
  if (!TOWN_NAMES.has(town)) return reject(400, 'town', 'اختر بلدتك من القائمة');
  const answers = body.answers;
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > 1000 || answers.some((a) => typeof a !== 'string' || a.length > MAX_ANSWER_LEN)) {
    return reject(400, 'answers shape', 'طلب غير صالح');
  }
  const claimed = answers.length;

  // ---- Re-validate every answer against the server-side table
  const { data: floors, error: fErr } = await db
    .from('floor_answers')
    .select('floor, answers')
    .lte('floor', claimed)
    .lte('released_at', new Date().toISOString())
    .order('floor');
  if (fErr) return reply(500, { error: 'خطأ في الخادم' });
  if (!floors || floors.length < claimed) return reject(400, 'unreleased floor', 'هذا الطابق لم يُفتح بعد');
  for (let i = 0; i < claimed; i++) {
    if (floors[i].floor !== i + 1 || !floors[i].answers.includes(normalize(answers[i] as string))) {
      return reject(400, `wrong answer floor ${i + 1}`, 'لم نتمكن من التحقق من تقدّمك');
    }
  }

  // ---- Impossible jumps
  const now = new Date();
  const { data: existing } = await db.from('players').select('*').eq('device_id', deviceId).maybeSingle();
  if (existing && claimed > existing.highest_floor) {
    const elapsed = (now.getTime() - new Date(existing.last_submit_at).getTime()) / 1000;
    const allowed = existing.highest_floor + Math.max(1, Math.floor(elapsed / MIN_SECONDS_PER_FLOOR));
    if (claimed > allowed) return reject(400, `jump ${existing.highest_floor}->${claimed} in ${Math.round(elapsed)}s`, 'تقدّم أسرع من المعقول، حاول بعد قليل');
  }

  // ---- Save
  const improved = !existing || claimed > existing.highest_floor;
  const row = {
    device_id: deviceId,
    nickname,
    town,
    highest_floor: improved ? claimed : existing!.highest_floor,
    reached_at: improved ? now.toISOString() : existing!.reached_at,
    last_submit_at: now.toISOString(),
  };
  const { error: uErr } = await db.from('players').upsert(row, { onConflict: 'device_id' });
  if (uErr) return reply(500, { error: 'خطأ في الخادم' });
  await log(true, null);
  return reply(200, { ok: true, highest_floor: row.highest_floor });
});
