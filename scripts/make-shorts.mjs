// node scripts/make-shorts.mjs [1-3] [--meta]   (--meta: rewrite only the .txt files)
// YouTube Shorts for Burj from content/youtube.private.json (gitignored; not game floors).
// Writes to ~/projects/lab-shorts/ (outside the repo), per Short:
//   burj-short-NN.mp4        1080x1920, 30 fps
//   (music: one track per Short from ~/projects/lab-shorts/music/, rotating, -16 LUFS,
//   faded in/out; silent when that folder has no tracks. Only use tracks you have
//   the rights to.)
//   burj-short-NN-thumb.jpg  1280x720
//   burj-short-NN.txt        title, description, tags
// Frames are drawn by scripts/shorts.html in headless Chrome (over the DevTools
// protocol) and encoded with ffmpeg. Needs Chrome, ffmpeg and network for Google Fonts.
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.SHORTS_OUT || join(homedir(), 'projects/lab-shorts');
const chrome = process.env.CHROME || 'google-chrome';
const FPS = 30;
const LEVEL_NAMES = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };

const src = JSON.parse(await readFile(process.env.SHORTS_SRC || root + 'content/youtube.private.json', 'utf8'));
// Mixed order: easy, medium, hard, repeating.
const by = (l) => src.puzzles.filter((p) => p.level === l);
const groups = ['easy', 'medium', 'hard'].map(by);
const order = [];
for (let i = 0; i < Math.max(...groups.map((g) => g.length)); i++) for (const g of groups) if (g[i]) order.push(g[i]);

// A new batch continues from the last one: when "batch" matches nextBatch.batch,
// numbering carries on after nextBatch.openWith.short and the first Short opens
// with that Short's answer.
const carry = src.nextBatch && src.batch === src.nextBatch.batch ? src.nextBatch.openWith : null;
const first = carry ? carry.short + 1 : 1;
const metaOnly = process.argv.includes('--meta');
const range = process.argv.slice(2).find((a) => !a.startsWith('--'));
const [from, to] = (range || `${first}-${first + order.length - 1}`).split('-').map(Number);
const shorts = order.map((p, i) => ({
  num: first + i,
  level: p.level,
  q: p.q,
  a: p.a,
  prev: i ? { q: order[i - 1].q, a: order[i - 1].a } : carry && { q: carry.q, a: carry.a },
  url: src.url,
  mark: (src.batch ?? 1) > 1, // batch 1 is already scheduled: leave it as rendered
  intro: i || carry ? 2 : 3,
})).map((s) => ({ ...s, duration: (s.prev ? 2 : 0) + s.intro + 10 + 3 }))
  .filter((s) => s.num >= from && s.num <= (to || from));

const pad = (n) => String(n).padStart(2, '0');
const MUSIC = process.env.SHORTS_MUSIC || join(OUT, 'music');
const tracks = (await readdir(MUSIC).catch(() => [])).filter((f) => /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f)).sort();
if (!tracks.length) console.log(`No music in ${MUSIC}: Shorts will be silent.`);
const trackFor = (num) => (tracks.length ? tracks[(num - 1) % tracks.length] : null);

if (metaOnly) {
  for (const s of shorts) {
    s.track = trackFor(s.num);
    await writeFile(join(OUT, `burj-short-${pad(s.num)}.txt`), meta(s));
    console.log(`Short ${s.num}: wrote .txt`);
  }
  process.exit(0);
}

// --- Minimal DevTools protocol client -------------------------------------
const profile = await mkdtemp(join(tmpdir(), 'burj-shorts-'));
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  browser.stderr.on('data', (d) => {
    err += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
    if (m) resolve(m[1]);
  });
  browser.on('exit', () => reject(new Error('Chrome exited:\n' + err)));
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const { targetId } = await send('Target.createTarget', { url: 'file://' + root + 'scripts/shorts.html' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
for (let i = 0; ; i++) {
  try {
    if (await evaluate('window.ready')) break;
  } catch (e) {
    if (i > 100) throw e;
  }
  await new Promise((r) => setTimeout(r, 100));
}
const dataUrl = (d) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');

// --- Render ----------------------------------------------------------------
await mkdir(OUT, { recursive: true });

function run(cmd, args, input) {
  const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((resolve, reject) =>
    p.on('exit', (code) => (code ? reject(new Error(`${cmd} failed:\n${err.slice(-2000)}`)) : resolve())));
  return { p, done };
}

// Music is the only audio and YouTube never turns quiet videos up, so it goes to
// -16 LUFS with true peaks under -2 dBTP (margin for the AAC encoder), using
// loudnorm's two passes: measure the faded clip, then apply one linear gain.
const LOUDNESS = 'I=-16:TP=-2:LRA=11';
async function musicFilter(track, duration) {
  const clip = `atrim=0:${duration},asetpts=N/SR/TB,aresample=48000,aformat=channel_layouts=stereo,` +
    `afade=t=in:d=1,afade=t=out:st=${duration - 1.5}:d=1.5`;
  const { stderr } = await promisify(execFile)('ffmpeg', ['-hide_banner', '-nostats', '-stream_loop', '-1',
    '-i', join(MUSIC, track), '-af', `${clip},loudnorm=${LOUDNESS}:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)[0]);
  return `${clip},loudnorm=${LOUDNESS}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
    `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
}

for (const s of shorts) {
  const base = join(OUT, `burj-short-${pad(s.num)}`);
  s.track = trackFor(s.num);
  // Music: one track per Short in rotation, looped if short, 1 s fade in, 1.5 s fade out.
  const audio = s.track
    ? ['-stream_loop', '-1', '-i', join(MUSIC, s.track), '-filter_complex',
        `[1:a]${await musicFilter(s.track, s.duration)}[a]`, '-map', '0:v', '-map', '[a]']
    : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest'];
  const { p, done } = run('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', ...audio, '-t', String(s.duration),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', base + '.mp4'], true);
  const spec = JSON.stringify(s);
  const frames = Math.round(s.duration * FPS);
  for (let f = 0; f < frames; f++) {
    const png = dataUrl(await evaluate(`frame(${spec}, ${f / FPS})`));
    if (!p.stdin.write(png)) await new Promise((r) => p.stdin.once('drain', r));
  }
  p.stdin.end();
  await done;
  await writeFile(base + '-thumb.jpg', dataUrl(await evaluate(`thumb(${spec})`)));
  await writeFile(base + '.txt', meta(s));
  console.log(`Short ${s.num} (${LEVEL_NAMES[s.level]}, ${s.duration} s, ${s.track ?? 'silent'}) → ${base}.mp4`);
}

function meta(s) {
  const lvl = LEVEL_NAMES[s.level];
  let title = `لغز ${lvl}: ${s.q} #shorts`;
  if (title.length > 100) title = `لغز ${lvl} رقم ${s.num}: هل تعرف الجواب خلال 10 ثوانٍ؟ #shorts`;
  const math = /\d/.test(s.q);
  const tags = ['ألغاز', 'لغز', 'ألغاز وحلول', 'ألغاز ذكاء', 'اختبار ذكاء', 'تحدي', `ألغاز ${lvl}ة`,
    ...(math ? ['ألغاز رياضيات', 'ألغاز أرقام'] : ['ألغاز للأذكياء']), 'ألغاز عربية', 'البرج', 'shorts', 'riddles', 'Arabic riddles'];
  return [
    'TITLE',
    title,
    '',
    'DESCRIPTION',
    `لغز رقم ${s.num} من «البرج» (مستوى: ${lvl}).`,
    s.q,
    '',
    'عندك 10 ثوانٍ! اكتب جوابك في التعليقات، والجواب في الفيديو القادم.',
    ...(s.prev ? ['', `جواب اللغز السابق: ${s.prev.a}`] : []),
    '',
    'العب البرج: 3 ألغاز جديدة كل يوم (سهل، متوسط، صعب)، وكل جواب صحيح يفتح الطابق التالي.',
    'https://lab.novaxmatrix.com/burj',
    '',
    '#ألغاز #لغز #البرج #shorts',
    '',
    'TAGS',
    tags.join(', '),
    '',
    'MUSIC (for your records, not for YouTube)',
    s.track ?? 'none (silent)',
    '',
  ].join('\n');
}

ws.close();
browser.kill();
await new Promise((r) => browser.once('exit', r));
await rm(profile, { recursive: true, force: true });
