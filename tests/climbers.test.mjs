import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLabel, FLOORS, PLAYERS } from '../docs/burj/js/arabic.js';
import { climbersText, others, createCounter } from '../docs/burj/js/climbers.js';
import { gameDay } from '../docs/burj/js/schedule.js';

test('Arabic counted nouns, including 100+', () => {
  const cases = {
    1: 'لاعب واحد', 2: 'لاعبان', 3: '3 لاعبين', 10: '10 لاعبين', 11: '11 لاعباً', 99: '99 لاعباً',
    100: '100 لاعب', 101: '101 لاعب', 102: '102 لاعب', 103: '103 لاعبين', 110: '110 لاعبين',
    111: '111 لاعباً', 199: '199 لاعباً', 200: '200 لاعب', 1000: '1000 لاعب', 1005: '1005 لاعبين', 2350: '2350 لاعباً',
  };
  for (const [n, s] of Object.entries(cases)) assert.equal(countLabel(+n, PLAYERS), s, n);
  assert.equal(countLabel(103, FLOORS), '103 طوابق');
  assert.equal(countLabel(120, FLOORS), '120 طابقاً');
});

test('the line hides below 5, and the «اليوم» part hides below 5', () => {
  assert.equal(climbersText(0, 0), '');
  assert.equal(climbersText(4, 4), '');
  assert.equal(climbersText(5, 4), 'صعد البرج 5 لاعبين غيرك');
  assert.equal(climbersText(25, 7), 'صعد البرج 25 لاعباً غيرك، منهم 7 اليوم');
  assert.equal(climbersText(300, 120), 'صعد البرج 300 لاعب غيرك، منهم 120 اليوم');
  assert.equal(climbersText(undefined, 9), '');
});

test('«غيرك» leaves out this device', () => {
  const c = { players: 10, today: 6, day: '2026-10-27' };
  assert.deepEqual(others(c, {}), { players: 10, today: 6 });
  assert.deepEqual(others(c, { counted: true }), { players: 9, today: 6 });
  assert.deepEqual(others(c, { counted: true, climb: { day: '2026-10-27', sent: true } }), { players: 9, today: 5 });
  // counted yesterday: today's number does not include this device
  assert.deepEqual(others(c, { counted: true, climb: { day: '2026-10-26', sent: true } }), { players: 9, today: 6 });
});

test('game day turns at 06:00 Hebron, across the DST change', () => {
  assert.equal(gameDay(Date.parse('2026-10-26T03:59:59Z')), '2026-10-25'); // 05:59:59 (+02)
  assert.equal(gameDay(Date.parse('2026-10-26T04:00:00Z')), '2026-10-26');
  assert.equal(gameDay(Date.parse('2026-07-01T02:59:59Z')), '2026-06-30'); // 05:59:59 (+03)
  assert.equal(gameDay(Date.parse('2026-07-01T03:00:00Z')), '2026-07-01');
  assert.equal(gameDay(Date.parse('2026-10-25T21:30:00Z')), '2026-10-25'); // 23:30
});

// A fake server with the same rules as burj_climb (tokens per day, total once).
function fakeServer() {
  const s = { players: 0, days: {}, tokens: new Set(), posts: 0, fail: 0, reply: null };
  s.fetch = async (url, opts = {}) => {
    if (url.endsWith('/climb_counts?select=players,today,day')) {
      return { ok: true, json: async () => [{ players: s.players, today: s.days[s.day] ?? 0, day: s.day }] };
    }
    s.posts++;
    if (s.fail > 0) {
      s.fail--;
      throw new TypeError('network');
    }
    const b = JSON.parse(opts.body);
    let result = s.reply ?? 'counted';
    if (!s.reply) {
      if (s.tokens.has(s.day + b.token)) result = 'already';
      else {
        s.tokens.add(s.day + b.token);
        s.days[s.day] = (s.days[s.day] ?? 0) + 1;
        if (b.first) s.players++;
      }
    }
    if (s.lose) {
      s.lose = false;
      throw new TypeError('reply lost');
    }
    return { ok: true, json: async () => ({ result, players: s.players, today: s.days[s.day] ?? 0, day: s.day }) };
  };
  return s;
}

function setup() {
  const server = fakeServer();
  server.day = '2026-10-27';
  const state = { answers: [], times: [] };
  let saves = 0;
  const counter = createCounter({
    config: { mode: 'live', supabaseUrl: 'https://x.supabase.co', anonKey: 'k' },
    getState: () => state,
    save: () => saves++,
    day: () => server.day,
    fetch: server.fetch,
  });
  return { server, state, counter, saves: () => saves };
}

test('off by default and without keys', () => {
  assert.equal(createCounter({ config: { mode: 'off' }, getState: () => ({}), save() {}, day: () => '' }), null);
  assert.equal(createCounter({ config: { mode: 'live', supabaseUrl: '', anonKey: '' }, getState: () => ({}), save() {}, day: () => '' }), null);
});

test('first answer ever: +1 all-time and today; later answers send nothing', async () => {
  const { server, state, counter } = setup();
  state.answers.push('a');
  await counter.solved(1, 'a');
  assert.equal(server.players, 1);
  assert.equal(server.days['2026-10-27'], 1);
  assert.equal(state.counted, true);
  assert.equal(state.climb.sent, true);
  state.answers.push('b');
  await counter.solved(2, 'b');
  assert.equal(server.posts, 1);
  // the viewer sees only others: 1 - 1 = 0, hidden
  assert.equal(counter.text(), '');
});

test('next day: today only, with a new token; the total never goes down', async () => {
  const { server, state, counter } = setup();
  await counter.solved(1, 'a');
  const token = state.climb.token;
  server.day = '2026-10-28';
  await counter.solved(2, 'b');
  assert.notEqual(state.climb.token, token);
  assert.equal(server.players, 1);
  assert.deepEqual(server.days, { '2026-10-27': 1, '2026-10-28': 1 });
  server.day = '2026-10-29'; // did not play: still in the all-time total
  assert.equal((await counter.load()).players, 1);
});

test('a lost reply is retried with the same token and not counted twice', async () => {
  const { server, state, counter } = setup();
  server.lose = true;
  await counter.solved(1, 'a');
  assert.equal(state.climb.sent, false);
  assert.equal(state.counted, undefined);
  state.answers.push('a');
  await counter.retry();
  assert.equal(server.players, 1);
  assert.equal(server.days['2026-10-27'], 1);
  assert.equal(state.counted, true);
  assert.equal(state.climb.sent, true);
});

test('offline, rate-limited or capped: not marked, tried again later', async () => {
  for (const reply of ['rate', 'capped', 'wrong']) {
    const { server, state, counter } = setup();
    server.reply = reply;
    await counter.solved(1, 'a');
    assert.equal(state.climb.sent, false, reply);
    assert.equal(state.counted, undefined, reply);
    server.reply = null;
    await counter.solved(2, 'b');
    assert.equal(state.counted, true, reply);
  }
  const { server, state, counter } = setup();
  server.fail = 1;
  await counter.solved(1, 'a');
  assert.equal(state.climb.sent, false);
  await counter.solved(2, 'b');
  assert.equal(state.climb.sent, true);
});

test('no retry for a pending answer from an earlier day', async () => {
  const { server, state, counter } = setup();
  server.fail = 1;
  state.answers.push('a');
  await counter.solved(1, 'a');
  server.day = '2026-10-28';
  await counter.retry();
  assert.equal(server.posts, 1);
});

test('shows other players once there are 5', async () => {
  const { server, state, counter } = setup();
  server.players = 6;
  server.days['2026-10-27'] = 3;
  await counter.load();
  assert.equal(counter.text(), 'صعد البرج 6 لاعبين غيرك');
  await counter.solved(1, 'a'); // now 7 and 4, minus me
  assert.equal(counter.text(), 'صعد البرج 6 لاعبين غيرك');
  server.days['2026-10-27'] = 6;
  await counter.load();
  assert.equal(counter.text(), 'صعد البرج 6 لاعبين غيرك، منهم 5 اليوم');
  assert.equal(state.counted, true);
});
