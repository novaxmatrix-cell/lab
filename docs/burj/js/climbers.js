// Player counter: «صعد البرج 25 لاعباً غيرك، منهم 7 اليوم». Off by default (config.js).
// No cookies and no ID. A device sends one request on its first correct answer of
// each game day, with a random token made fresh that day; the first request ever
// also adds it to the all-time total. A device with progress from before the
// counter went live is added to the all-time total on its next visit. The device
// remembers this locally and never resends. Server side: supabase/counter.sql and
// functions/climb.
import { countLabel, PLAYERS } from './arabic.js';

export const MIN_SHOWN = 5; // below this, hide the line (or the «اليوم» part)

export function climbersText(players, today) {
  if (!(players >= MIN_SHOWN)) return '';
  let s = `صعد البرج ${countLabel(players, PLAYERS)} غيرك`;
  if (today >= MIN_SHOWN) s += `، منهم ${today} اليوم`;
  return s;
}

// The server's numbers minus this device, so «غيرك» never includes the viewer.
export function others(counts, st) {
  const today = counts.today - (st.climb?.sent && st.climb.day === counts.day ? 1 : 0);
  return { players: Math.max(0, counts.players - (st.counted ? 1 : 0)), today: Math.max(0, today) };
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// day(): the current game day, 'YYYY-MM-DD' (schedule.js gameDay on the server clock).
export function createCounter({ config, getState, save, day, fetch = globalThis.fetch }) {
  if (config.mode !== 'live' || !config.supabaseUrl || !config.anonKey) return null;
  const headers = { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` };
  let counts = null;
  let sending = null; // one request at a time, so «first» is never sent twice

  async function load() {
    try {
      const res = await fetch(`${config.supabaseUrl}/rest/v1/climb_counts?select=players,today,day`, { headers });
      if (res.ok) counts = (await res.json())[0] ?? counts;
    } catch {
      // offline: keep the last numbers, or none
    }
    return counts;
  }

  // POST to the climb function; true when the server counted this token (now or
  // on an earlier try whose reply was lost: «already»).
  async function post(body) {
    try {
      const res = await fetch(`${config.supabaseUrl}/functions/v1/climb`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = await res.json().catch(() => ({}));
      if (Number.isFinite(r.players)) counts = { players: r.players, today: r.today, day: r.day };
      return r.result === 'counted' || r.result === 'already';
    } catch {
      return false; // offline or blocked: tried again later
    }
  }

  async function queue(job) {
    while (sending) await sending;
    sending = job().finally(() => (sending = null));
    return sending;
  }

  // Called after every correct answer; only the first one of the day reaches the server.
  function solved(floor, answer) {
    return queue(async () => {
      const st = getState();
      const d = day();
      if (st.climb?.day !== d) {
        st.climb = { day: d, token: uuid(), sent: false };
        save();
      }
      if (st.climb.sent) return;
      const first = !st.counted;
      if (await post({ token: st.climb.token, first, floor, answer })) {
        st.climb.sent = true;
        if (first) {
          st.counted = true;
          delete st.backfill;
        }
        save();
      }
    });
  }

  // On page load. A correct answer from earlier today that did not get through is
  // sent again. Otherwise a player with progress who has never been counted (they
  // played before the counter went live) is added to the all-time total, proving
  // their last solved floor; not to today's number, which needs a solve today.
  function start() {
    const st = getState();
    if (!st.answers.length) return;
    if (st.climb && st.climb.day === day() && !st.climb.sent) return solved(st.answers.length, st.answers.at(-1));
    if (st.counted) return;
    return queue(async () => {
      if (getState().counted) return;
      st.backfill ??= uuid();
      save();
      if (await post({ token: st.backfill, first: true, today: false, floor: st.answers.length, answer: st.answers.at(-1) })) {
        st.counted = true;
        delete st.backfill;
        save();
      }
    });
  }

  function text() {
    if (!counts) return '';
    const o = others(counts, getState());
    return climbersText(o.players, o.today);
  }
  return { load, solved, start, text };
}
