// npm run og: renders docs/burj/og.png (1200x630) and the app icons with headless Chrome.
// Needs Chrome/Chromium installed (CHROME=/path/to/chrome to override) and network for Google Fonts.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME || 'google-chrome';
function shot(src, out, w, h, transparent = false) {
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--window-size=${w},${h}`, '--virtual-time-budget=4000', `--screenshot=${out}`, src], { stdio: 'ignore' });
  console.log('wrote', out.slice(root.length));
}
shot('file://' + root + 'scripts/og.html', root + 'docs/burj/og.png', 1200, 630);
// An SVG without width/height fills the window.
// "any" icons keep the rounded corners on a transparent background; the
// maskable and Apple icons are full-bleed (the OS applies its own mask).
shot('file://' + root + 'docs/burj/icon.svg', root + 'docs/burj/icon-192.png', 192, 192, true);
shot('file://' + root + 'docs/burj/icon.svg', root + 'docs/burj/icon-512.png', 512, 512, true);
shot('file://' + root + 'docs/burj/icon-maskable.svg', root + 'docs/burj/icon-maskable-512.png', 512, 512);
shot('file://' + root + 'docs/burj/icon-maskable.svg', root + 'docs/burj/icon-180.png', 180, 180);
