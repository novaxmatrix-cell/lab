// البرج · Burj service worker.
// App shell: cache-first from a versioned cache, so the game starts instantly and
// works offline. VERSION is stamped by `npm run build` from the shell's contents,
// so any change to the shell installs a fresh cache and drops the old one.
// floors.json: network-first, so a new day's floor (and the server clock) arrive
// the same day; offline it falls back to the last copy, marked x-burj-cache.

const VERSION = '5ea7de3a1b6f';
const SHELL = `burj-shell-${VERSION}`;
const DATA = 'burj-data';
const FONTS = 'burj-fonts';
const ASSETS = [
  './', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/normalize.js', 'js/chain.js', 'js/config.js', 'js/schedule.js',
  'js/share.js', 'js/board.js', 'js/towns.js', 'js/badwords.js', 'js/arabic.js', 'js/climbers.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('burj-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function floorsFirstFromNetwork(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put('data/floors.json', res.clone());
    return res;
  } catch {
    const hit = await cache.match('data/floors.json');
    if (!hit) throw new Error('offline and no copy');
    const headers = new Headers(hit.headers);
    headers.set('x-burj-cache', '1');
    return new Response(hit.body, { status: 200, headers });
  }
}

async function shellFirstFromCache(req) {
  const hit = await caches.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: true });
  return hit || fetch(req);
}

async function fontsStaleWhileRevalidate(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => (res.ok && cache.put(req, res.clone()), res)).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    const scope = new URL(self.registration.scope).pathname;
    if (!url.pathname.startsWith(scope)) return;
    if (url.pathname.endsWith('/data/floors.json')) return e.respondWith(floorsFirstFromNetwork(req));
    if (req.mode === 'navigate' || ASSETS.some((a) => url.pathname === scope + (a === './' ? '' : a))) {
      return e.respondWith(shellFirstFromCache(req));
    }
    return; // og.png and anything else: straight to the network
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(fontsStaleWhileRevalidate(req));
  }
});
