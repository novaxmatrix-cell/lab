// Player counter: «صعد البرج 25 لاعباً غيرك، منهم 7 اليوم». Off by default (config.js).
// No cookies and no ID. A device sends one request on its first correct answer of
// each game day, with a random token made fresh that day; the first request ever
// also adds it to the all-time total. The device remembers both locally and never
// resends. Server side: supabase/counter.sql and functions/climb.
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
  let sending = null;

  async function load() {
    try {
      const res = await fetch(`${config.supabaseUrl}/rest/v1/climb_counts?select=players,today,day`, { headers });
      if (res.ok) counts = (await res.json())[0] ?? counts;
    } catch {
      // offline: keep the last numbers, or none
    }
    return counts;
  }

  // Called after every correct answer; only the first one of the day reaches the server.
  async function solved(floor, answer) {
    const st = getState();
    const d = day();
    if (st.climb?.day !== d) {
      st.climb = { day: d, token: uuid(), sent: false };
      save();
    }
    if (st.climb.sent || sending) return sending;
    const first = !st.counted;
    sending = (async () => {
      try {
        const res = await fetch(`${config.supabaseUrl}/functions/v1/climb`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: st.climb.token, first, floor, answer }),
        });
        const body = await res.json().catch(() => ({}));
        // «already»: an earlier try with this token got through but its reply was lost.
        if (body.result === 'counted' || body.result === 'already') {
          st.climb.sent = true;
          if (first) st.counted = true;
          save();
        }
        if (Number.isFinite(body.players)) counts = { players: body.players, today: body.today, day: body.day };
      } catch {
        // offline or blocked: try again on the next correct answer or the next visit today
      }
      sending = null;
    })();
    return sending;
  }

  // A correct answer from earlier today that did not get through.
  function retry() {
    const st = getState();
    if (st.climb && st.climb.day === day() && !st.climb.sent && st.answers.length) {
      return solved(st.answers.length, st.answers.at(-1));
    }
  }

  function text() {
    if (!counts) return '';
    const o = others(counts, getState());
    return climbersText(o.players, o.today);
  }
  return { load, solved, retry, text };
}
