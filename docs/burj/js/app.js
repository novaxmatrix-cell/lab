// البرج · Burj: game screens and progress.
import { normalize } from './normalize.js';
import { openGate, openFloor, b64 } from './chain.js';
import { CONFIG } from './config.js';
import { openCount, nextOpening, countdownText, openLabel } from './schedule.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Progress (localStorage can throw or be empty: private mode, blocked storage)
const STORE = 'burj:v1';
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.answers)) return s;
  } catch {}
  return { answers: [], times: [] };
}
const state = loadState();
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {}
}
if (!state.device) {
  state.device = crypto.randomUUID ? crypto.randomUUID() : b64.to(crypto.getRandomValues(new Uint8Array(16)));
  save();
}

let data = null; // public encrypted floors
let currentKey = null; // raw content key of the floor the player is on
const contents = new Map(); // n -> decrypted { q, hint }
const solved = () => state.answers.length;

// Server time minus device time, from the HTTP Date header of floors.json, so a
// wrong (or moved) phone clock does not open tomorrow's floor early.
let clockOffset = 0;
const now = () => Date.now() + clockOffset;
const openTotal = () => (data ? openCount(data, now()) : 0); // floors open right now
const atSummit = () => data && solved() >= openTotal();
const nextText = () => {
  const next = data && nextOpening(data, now());
  return next ? `الطابق القادم بعد ${countdownText(next - now())}` : 'طابق جديد قريباً';
};

const params = new URLSearchParams(location.search);
const boardMode = ['off', 'mock', 'live'].includes(params.get('lb')) ? params.get('lb') : CONFIG.leaderboard.mode;

// ---- Arabic counting
function floorsLabel(n) {
  if (n === 1) return 'طابق واحد';
  if (n === 2) return 'طابقان';
  if (n >= 3 && n <= 10) return `${n} طوابق`;
  return `${n} طابقاً`;
}

function minutesLabel(n) {
  if (n === 1) return 'دقيقة';
  if (n === 2) return 'دقيقتين';
  if (n >= 3 && n <= 10) return `${n} دقائق`;
  return `${n} دقيقة`;
}

// ---- Startup
async function loadData() {
  const res = await fetch('data/floors.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status);
  const fresh = await res.json();
  // The service worker marks an offline copy: its Date is stale, keep the last offset.
  const date = Date.parse(res.headers.get('date'));
  if (!res.headers.get('x-burj-cache') && !Number.isNaN(date)) clockOffset = date - Date.now();
  return fresh;
}

async function init() {
  try {
    data = await loadData();
  } catch {
    $('status').textContent = 'تعذّر تحميل البرج. تحقق من الاتصال وأعد المحاولة.';
    return;
  }
  if (solved() > data.total) {
    state.answers.length = data.total;
    state.times.length = data.total;
  }
  await restoreKey();
  if (boardMode !== 'off') {
    await loadBoard();
    $('btn-board').hidden = $('btn-board2').hidden = false;
  }
  buildTower();
  document.body.dataset.view = 'v-tower';
  update(false);
  $('btn-go').disabled = false;
  if (location.hash === '#board' && board) showBoard(false);
  else if (atSummit() && location.hash !== '#tower') {
    showView('v-summit');
    renderSummit();
  }
}

// Called when the countdown reaches zero and when the app comes back to the
// foreground: re-read the server clock and pick up a new deploy if there is one.
let refreshing = false;
async function refresh() {
  if (!data || refreshing) return;
  refreshing = true;
  try {
    const fresh = await loadData();
    if (fresh.build !== data.build) {
      data = fresh;
      contents.clear();
      await restoreKey();
      buildTower();
    }
  } catch {
    // offline: keep going with what we have
  }
  refreshing = false;
  shownOpen = openTotal(); // even if the tower is not redrawn (puzzle screen), so this runs once
  const view = document.body.dataset.view;
  if (view === 'v-summit' && !atSummit()) showView('v-tower');
  if (view !== 'v-floor') update(false);
  if (view === 'v-summit') renderSummit();
}

// Live countdown on the summit screen and the tower status line. When a floor
// opens, the open count changes: compare with what is on screen, not with the
// next opening (that moves on to tomorrow's floor the moment today's opens).
let shownOpen = 0;
setInterval(() => {
  if (!data) return;
  if (openTotal() !== shownOpen) return refresh();
  if (!atSummit()) return;
  $('summit-sub').textContent = nextText();
  const st = $('status').querySelector('.next');
  if (st) st.textContent = nextText();
}, 1000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

// Recover the key of the current floor: from cache if the data did not change,
// otherwise by re-opening the last gate with the stored answer. If the author
// changed an answer since, step back until a stored answer still works.
async function restoreKey() {
  const c = state.cache;
  if (c && c.build === data.build && c.n === solved() + 1) {
    currentKey = b64.from(c.key);
    return;
  }
  while (solved() > 0) {
    const key = await openGate(data, solved(), state.answers[solved() - 1]);
    if (key) return setKey(key);
    state.answers.pop();
    state.times.pop();
  }
  currentKey = null;
  delete state.cache;
  save();
}
function setKey(key) {
  currentKey = key;
  state.cache = { build: data.build, n: solved() + 1, key: b64.to(key) };
  save();
}

// ---- Tower
let floorEls = [];
function buildTower() {
  const tower = $('tower');
  tower.textContent = '';
  floorEls = [];
  for (let n = 1; n <= data.total; n++) {
    const el = document.createElement('div');
    el.className = 'fl';
    el.innerHTML = `<span class="name">الطابق ${n}</span><span class="st"></span>`;
    el.addEventListener('click', () => {
      if (n <= solved() + 1 && n <= openTotal()) openFloorView(n);
    });
    tower.append(el);
    floorEls.push(el);
  }
  const roof = document.createElement('div');
  roof.className = 'roof';
  roof.id = 'roof';
  const ring = document.createElement('div');
  ring.className = 'ring';
  ring.id = 'ring';
  ring.setAttribute('aria-hidden', 'true');
  tower.append(roof, ring);
}

// «وصلت الطابق N» counts the floor you are standing on, as in the mockup.
const reached = (s = solved()) => Math.min(s + 1, openTotal());

// Draw the tower with `s` floors solved (normally the real progress; one less just before a climb).
function update(animate = true, s = solved()) {
  const open = openTotal();
  shownOpen = open;
  const top = s >= open;
  floorEls.forEach((el, i) => {
    const n = i + 1;
    const cls = n > open ? 'locked future' : n <= s ? 'solved' : n === s + 1 ? 'current' : 'locked';
    const label = n > open ? openLabel(data.floors[i], now()) : cls === 'solved' ? '✓' : cls === 'current' ? 'أنت هنا' : 'مقفل';
    el.className = 'fl ' + cls;
    el.querySelector('.st').textContent = label;
    el.setAttribute('role', cls.startsWith('locked') ? 'presentation' : 'button');
    el.setAttribute('aria-label', `الطابق ${n}، ${cls === 'solved' ? 'محلول' : label}`);
    if (!cls.startsWith('locked')) el.tabIndex = 0;
    else el.removeAttribute('tabindex');
  });
  $('roof').classList.toggle('lit', top);

  const ring = $('ring');
  if (!animate) ring.style.transition = 'none';
  ring.style.setProperty('--at', Math.min(s, open));
  ring.classList.toggle('done', top);
  if (!animate) requestAnimationFrame(() => (ring.style.transition = ''));

  const status = $('status');
  const go = $('btn-go');
  if (top) {
    status.innerHTML = `وصلت <b>القمة</b>. <span class="next">${nextText()}</span>`;
    go.textContent = 'القمة';
  } else if (s === 0) {
    status.textContent = `${floorsLabel(open)} تنتظرك. كل جواب يفتح الطابق التالي.`;
    go.textContent = 'ابدأ الصعود';
  } else {
    status.innerHTML = `وصلت <b>الطابق ${reached(s)}</b>`;
    go.textContent = 'تابع الصعود';
    board?.rankLine().then((r) => r && solved() === s && (status.innerHTML += ` · ${r}`));
  }
  scrollToCurrent(animate, s);
}

function scrollToCurrent(smooth, s = solved()) {
  if (!data || $('v-tower').hidden) return;
  const scroller = $('tower-scroll');
  // At today's summit, center on the next floor to open (or the roof if none).
  const el = floorEls[Math.min(s, openTotal())] ?? $('roof');
  if (!el) return;
  const top = el.offsetTop + $('tower').offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
  scroller.scrollTo({ top, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
}

// ---- Views. Floor and leaderboard push a history entry so the phone's back button returns to the tower.
const VIEWS = ['v-tower', 'v-floor', 'v-summit', 'v-board'];
function showView(id) {
  for (const v of VIEWS) $(v).hidden = v !== id;
  document.body.dataset.view = id;
  const el = $(id);
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
  if (id === 'v-tower') scrollToCurrent(false);
}
function home() {
  if (atSummit() && location.hash !== '#tower') {
    showView('v-summit');
    renderSummit();
  } else {
    showView('v-tower');
  }
}
addEventListener('popstate', () => (location.hash === '#board' && board ? showBoard(false) : home()));

async function openFloorView(n) {
  const card = $('card');
  const current = n === solved() + 1;
  card.classList.remove('win', 'shake');
  $('floor-title').textContent = `الطابق ${n} من ${openTotal()}`;
  $('progress-bar').style.width = `${(solved() / openTotal()) * 100}%`;
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';
  $('answer').value = '';
  $('form').hidden = !current;
  $('btn-up').hidden = !current;
  $('solved-note').hidden = current;
  $('question').textContent = '…';
  $('hint').hidden = true;
  if (!history.state || history.state.floor !== n) history.pushState({ floor: n }, '', '#floor');
  showView('v-floor');

  try {
    let content = contents.get(n);
    if (!content) {
      let key = null;
      if (n > 1) key = current ? currentKey : await openGate(data, n - 1, state.answers[n - 2]);
      content = await openFloor(data, n, key);
      contents.set(n, content);
    }
    $('question').textContent = content.q;
    if (content.hint) {
      $('hint').textContent = content.hint;
      $('hint').hidden = false;
    }
  } catch {
    $('question').textContent = 'تعذّر فتح هذا الطابق.';
    return;
  }
  if (current) {
    // Focus only when there is a keyboard to spare: on phones the keyboard would cover the question.
    if (matchMedia('(hover: hover)').matches) $('answer').focus();
  } else {
    $('solved-note').textContent = `جوابك: ${state.answers[n - 1]}`;
  }
}

const WRONG = ['ليس هذا. حاول من جديد', 'فكّر بطريقة أخرى', 'قريب؟ ربما لا. حاول مجدداً', 'ليس بعد. اقرأ السؤال من جديد'];
let wrongCount = 0;

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = solved() + 1;
  const input = $('answer');
  const fb = $('feedback');
  const btn = $('btn-up');
  const card = $('card');
  if (!normalize(input.value)) {
    fb.textContent = 'اكتب جوابك أولاً';
    input.focus();
    return;
  }
  btn.classList.add('busy');
  btn.disabled = true;
  fb.textContent = '';
  const key = await openGate(data, n, input.value).catch(() => null);
  btn.classList.remove('busy');
  btn.disabled = false;

  if (!key) {
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    fb.textContent = WRONG[wrongCount++ % WRONG.length];
    navigator.vibrate?.(60);
    input.select();
    return;
  }

  state.answers.push(normalize(input.value));
  state.times.push(Date.now());
  setKey(key);
  wrongCount = 0;
  card.classList.add('win');
  fb.className = 'feedback ok';
  fb.textContent = 'صحيح!';
  $('progress-bar').style.width = `${(solved() / openTotal()) * 100}%`;
  input.blur();
  board?.submit(state);
  await sleep(600);
  await climb();
});

// Back to the tower in the old position, then the «أنت هنا» frame rides up one floor.
async function climb() {
  history.replaceState({}, '', location.pathname + location.search);
  showView('v-tower');
  update(false, solved() - 1);
  await sleep(reduceMotion ? 0 : 250);
  update(true);
  if (atSummit()) {
    await sleep(reduceMotion ? 0 : 1500);
    showView('v-summit');
    renderSummit();
  }
}

function renderSummit() {
  $('summit-sub').textContent = nextText();
  const t = state.times;
  let line = `صعدت ${floorsLabel(openTotal())}`;
  if (t.length >= 2) {
    const mins = Math.max(1, Math.round((t[t.length - 1] - t[0]) / 60000));
    if (mins < 180) line += ` في ${minutesLabel(mins)}`;
  }
  $('summit-stat').textContent = line;
}

// ---- Sharing
function shareText() {
  if (atSummit()) return 'وصلت قمة البرج. هل تقدر تسبقني؟';
  return solved() > 0 ? `وصلت الطابق ${reached()} في البرج. هل تقدر تسبقني؟` : 'جرّب البرج: لغز عربي يومي. هل تقدر تصل إلى القمة؟';
}
function whatsapp() {
  const url = 'https://wa.me/?text=' + encodeURIComponent(shareText() + '\n' + CONFIG.url);
  window.open(url, '_blank', 'noopener');
}
async function shareImage() {
  if (!data) return;
  const dlg = $('d-share');
  const img = $('share-img');
  img.removeAttribute('src');
  dlg.showModal();
  const { makeShareImage } = await import('./share.js');
  const blob = await makeShareImage({ solved: solved(), reached: reached(), total: openTotal(), url: CONFIG.url });
  const href = URL.createObjectURL(blob);
  img.src = href;
  $('btn-save').href = href;
  const file = new File([blob], 'burj.png', { type: 'image/png' });
  const btn = $('btn-share-file');
  btn.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  btn.onclick = () => navigator.share({ files: [file], text: shareText() + '\n' + CONFIG.url }).catch(() => {});
}

// ---- Leaderboard (loaded on demand)
let board = null;
async function loadBoard() {
  if (boardMode === 'off') return null;
  if (!board) {
    const m = await import('./board.js');
    board = m.createBoard({ mode: boardMode, config: CONFIG.leaderboard, getState: () => state, save, total: openTotal });
  }
  return board;
}
async function showBoard(push = true) {
  if (!(await loadBoard())) return;
  if (push) history.pushState({ board: true }, '', '#board');
  showView('v-board');
  board.open();
}

// ---- Wiring
$('btn-go').addEventListener('click', () => (atSummit() ? (showView('v-summit'), renderSummit()) : openFloorView(solved() + 1)));
const back = () => (history.state?.floor || history.state?.board ? history.back() : home());
$('btn-back').addEventListener('click', back);
$('btn-board-back').addEventListener('click', back);
$('btn-view-tower').addEventListener('click', () => {
  history.pushState({}, '', '#tower');
  showView('v-tower');
});
for (const id of ['btn-wa', 'btn-wa2', 'btn-wa3', 'btn-share-burj']) $(id).addEventListener('click', whatsapp);
$('btn-image').addEventListener('click', shareImage);
$('btn-image2').addEventListener('click', shareImage);
$('btn-board').addEventListener('click', () => showBoard());
$('btn-board2').addEventListener('click', () => showBoard());
$('tower').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fl')) {
    e.preventDefault();
    e.target.click();
  }
});
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
}
// Keep the player's floor centered whenever the tower area changes size: window
// resize, or the install button / iPhone tip appearing under it.
new ResizeObserver(() => scrollToCurrent(false)).observe($('tower-scroll'));

// ---- Install as an app
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // show our own button instead of the browser's mini bar
  installPrompt = e;
  if (!standalone()) $('btn-install').hidden = false;
});
addEventListener('appinstalled', () => {
  installPrompt = null;
  $('btn-install').hidden = true;
});
$('btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null; // a prompt can only be used once
  $('btn-install').hidden = true;
});
// iPhone Safari has no install prompt: show the manual steps once.
const ua = navigator.userAgent;
const iosSafari = (/iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !/CriOS|FxiOS|EdgiOS/.test(ua);
if (iosSafari && !standalone() && !state.iosTip) {
  $('ios-tip').hidden = false;
  state.iosTip = 1;
  save();
}
$('ios-tip-close').addEventListener('click', () => ($('ios-tip').hidden = true));

// ---- Service worker: instant start and offline play. A new version takes over
// in the background; reload into it unless the player is typing an answer.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && document.body.dataset.view !== 'v-floor') location.reload();
  });
}

init();
