// Leaderboard: tabs for players and towns, plus the join form. Loaded on demand.
// mode 'mock' keeps everything on the device with made-up rows; 'live' talks to
// Supabase: reads two public views, writes only through the submit-score Edge Function.
import { normalize } from './normalize.js';
import { TOWNS } from './towns.js';
import { nicknameError, NICK_MAX } from './badwords.js';

const $ = (id) => document.getElementById(id);
const rel = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function ago(iso) {
  const sec = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month']];
  let v = sec;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rel.format(Math.round(v), unit);
    v /= n;
  }
  return rel.format(Math.round(v), 'year');
}

// ---- Mock data: plausible, clearly labelled «بيانات تجريبية» in the UI
function mockRows(total) {
  const names = [
    ['أبو العبد', 'نابلس'], ['لين', 'رام الله'], ['محمود ع', 'الخليل'], ['سما', 'غزة'], ['يزن', 'جنين'],
    ['رهف', 'بيت لحم'], ['قصي', 'طولكرم'], ['جود', 'الناصرة'], ['سليم', 'القدس'], ['ميار', 'حيفا'],
    ['أنس', 'نابلس'], ['تالا', 'رام الله'], ['بشار', 'قلقيلية'], ['هديل', 'الخليل'], ['كرم', 'سلفيت'],
    ['ريم', 'غزة'], ['زيد', 'أريحا'], ['نور', 'يافا'],
  ];
  const now = Date.now();
  return names.map(([nickname, town], i) => ({
    nickname,
    town,
    highest_floor: Math.max(1, total - Math.floor(i / 2.2)),
    reached_at: new Date(now - (i * 17 + 5) * 60000).toISOString(),
  }));
}

// Mock town table, close to the mockup's numbers.
const MOCK_TOWNS = [
  ['نابلس', 412, 8.4], ['الخليل', 530, 8.1], ['رام الله', 298, 7.9], ['جنين', 201, 7.6], ['بيت لحم', 187, 7.2],
  ['طولكرم', 154, 6.9], ['غزة', 340, 6.7], ['قلقيلية', 96, 6.4], ['الناصرة', 120, 6.2], ['أريحا', 41, 5.8],
].map(([town, players, avg_floor]) => ({ town, players, avg_floor }));

function playersLabel(n) {
  if (n === 1) return 'لاعب واحد';
  if (n === 2) return 'لاعبان';
  if (n >= 3 && n <= 10) return `${n} لاعبين`;
  return `${n} لاعباً`;
}

const byRank = (a, b) => b.highest_floor - a.highest_floor || new Date(a.reached_at) - new Date(b.reached_at);
const byTown = (a, b) => b.avg_floor - a.avg_floor || b.players - a.players;
// Live: a town needs a few players before it is ranked, or one player at the top floor wins.
const MIN_TOWN_PLAYERS = 3;

export function createBoard({ mode, config, getState, save, total }) {
  const live = mode === 'live' && config.supabaseUrl && config.anonKey;
  const headers = live ? { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` } : {};
  let mock = null;

  async function fetchPlayers() {
    if (!live) {
      mock ??= mockRows(total());
      const st = getState();
      const rows = mock.filter((r) => !r.me);
      if (st.player) rows.push({ ...st.player, highest_floor: st.answers.length, reached_at: new Date(st.times.at(-1) || Date.now()).toISOString(), me: true });
      return rows.filter((r) => r.highest_floor > 0).sort(byRank).slice(0, 50);
    }
    const res = await fetch(`${config.supabaseUrl}/rest/v1/leaderboard_players?select=*&order=highest_floor.desc,reached_at.asc&limit=50`, { headers });
    if (!res.ok) throw new Error(res.status);
    const st = getState();
    return (await res.json()).map((r) => ({ ...r, me: st.player && r.nickname === st.player.nickname && r.town === st.player.town }));
  }

  async function fetchTowns() {
    if (!live) {
      const st = getState();
      const rows = MOCK_TOWNS.map((t) => ({ ...t }));
      if (st.player) {
        const t = rows.find((r) => r.town === st.player.town) || rows[rows.push({ town: st.player.town, players: 0, avg_floor: 0 }) - 1];
        t.avg_floor = (t.avg_floor * t.players + st.answers.length) / (t.players + 1);
        t.players++;
      }
      return rows.filter((r) => r.players >= MIN_TOWN_PLAYERS).sort(byTown);
    }
    const res = await fetch(`${config.supabaseUrl}/rest/v1/leaderboard_towns?select=*&players=gte.${MIN_TOWN_PLAYERS}&order=avg_floor.desc,players.desc&limit=50`, { headers });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  async function submit(st) {
    if (!st.player || !st.answers.length) return { ok: true };
    if (!live) return { ok: true };
    try {
      const res = await fetch(`${config.supabaseUrl}/functions/v1/submit-score`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: st.device, nickname: st.player.nickname, town: st.player.town, answers: st.answers }),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true } : { ok: false, error: body.error || 'تعذّر الإرسال، حاول لاحقاً' };
    } catch {
      return { ok: false, error: 'لا يوجد اتصال، حاول لاحقاً' };
    }
  }

  // ---- Rendering
  async function renderPlayers() {
    const p = $('p-players');
    p.innerHTML = '<p class="empty">جاري التحميل…</p>';
    try {
      const rows = await fetchPlayers();
      const me = rows.findIndex((r) => r.me);
      setStatus(me >= 0 ? `أنت في المركز <b>${me + 1}</b>. ادعُ أصدقاءك يسبقوك إن قدروا` : '');
      p.innerHTML = rows.length
        ? `<ol class="rows">${rows
            .map(
              (r, i) => `<li${r.me ? ' class="me"' : ''}><span class="rank">${i + 1}</span>
              <span class="who"><b>${esc(r.nickname)}</b><small>${esc(r.town)}</small></span>
              <span class="score">الطابق ${r.highest_floor}<small>${ago(r.reached_at)}</small></span></li>`,
            )
            .join('')}</ol>`
        : '<p class="empty">لا لاعبين بعد. كن الأول!</p>';
    } catch {
      p.innerHTML = '<p class="empty">تعذّر تحميل الترتيب</p>';
    }
  }

  async function renderTowns() {
    const p = $('p-towns');
    p.innerHTML = '<p class="empty">جاري التحميل…</p>';
    try {
      const rows = await fetchTowns();
      const town = getState().player?.town;
      const at = rows.findIndex((r) => r.town === town);
      setStatus(at >= 0 ? `بلدتك في المركز <b>${at + 1}</b>. ادعُ أهل بلدتك يرفعوها` : town ? `تدخل بلدتك الترتيب بعد ${MIN_TOWN_PLAYERS} لاعبين. ادعُ أهل بلدتك` : '');
      p.innerHTML = rows.length
        ? `<ol class="rows">${rows
            .map(
              (r, i) => `<li><span class="rank">${i + 1}</span>
              <span class="who"><b>${esc(r.town)}</b><small>${playersLabel(r.players)}</small></span>
              <span class="score">متوسط ${Number(r.avg_floor).toFixed(1)}</span></li>`,
            )
            .join('')}</ol>`
        : '<p class="empty">لا بلدات بعد</p>';
    } catch {
      p.innerHTML = '<p class="empty">تعذّر تحميل الترتيب</p>';
    }
  }

  function setStatus(html) {
    const st = getState();
    $('board-status').innerHTML = html || (st.player ? '' : st.answers.length ? 'أضف اسمك وارفع بلدتك في الترتيب' : 'حُلّ الطابق الأول لتنضم إلى الترتيب');
  }

  let tab = 'towns';
  function selectTab(which) {
    tab = which;
    for (const t of ['players', 'towns']) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === which));
      $(`p-${t}`).hidden = t !== which;
    }
    which === 'players' ? renderPlayers() : renderTowns();
  }
  $('tab-players').addEventListener('click', () => selectTab('players'));
  $('tab-towns').addEventListener('click', () => selectTab('towns'));

  // ---- Join form with town search
  let town = null;
  const q = $('town-q');
  const list = $('town-list');
  function showTowns() {
    const needle = normalize(q.value);
    const hits = TOWNS.filter(([name, region]) => !needle || normalize(name).includes(needle) || normalize(region).includes(needle)).slice(0, 40);
    list.innerHTML = hits
      .map(([name, region], i) => `<li role="option" id="town-${i}" data-town="${esc(name)}" aria-selected="false">${esc(name)}<small>${esc(region)}</small></li>`)
      .join('');
    list.hidden = !hits.length;
    q.setAttribute('aria-expanded', String(!list.hidden));
  }
  function pick(name) {
    town = name;
    q.value = name;
    list.hidden = true;
    q.setAttribute('aria-expanded', 'false');
  }
  q.addEventListener('input', () => {
    town = null;
    showTowns();
  });
  q.addEventListener('focus', showTowns);
  q.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = list.querySelector('li');
      if (first && !list.hidden) pick(first.dataset.town);
    }
  });
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (li) {
      e.preventDefault();
      pick(li.dataset.town);
    }
  });

  $('nick').maxLength = NICK_MAX;
  $('join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('join-err');
    const nickname = $('nick').value.trim().replace(/\s+/g, ' ');
    const msg = nicknameError(nickname) || (!town && 'اختر بلدتك من القائمة') || (!getState().answers.length && 'حُلّ الطابق الأول أولاً');
    if (msg) {
      err.textContent = msg;
      return;
    }
    const st = getState();
    st.player = { nickname, town };
    const r = await submit(st);
    if (!r.ok) {
      delete st.player;
      err.textContent = r.error;
      return;
    }
    save();
    err.textContent = '';
    $('join').hidden = true;
    selectTab(tab);
  });

  return {
    open() {
      $('mock-tag').hidden = !!live;
      $('join').hidden = !!getState().player || !getState().answers.length;
      selectTab(tab);
    },
    // «ترتيب 143 من 2,180» for the tower status line, or '' if unknown.
    async rankLine() {
      if (!getState().player) return '';
      try {
        const rows = await fetchPlayers();
        const i = rows.findIndex((r) => r.me);
        if (i < 0) return '';
        const of = live ? '' : ` من ${(2180).toLocaleString('en')}`;
        return `ترتيب <b>${i + 1}</b>${of}`;
      } catch {
        return '';
      }
    },
    submit,
  };
}
