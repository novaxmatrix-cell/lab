// Daily floors. A dated floor opens at 06:00 Asia/Hebron on its date.
// The build turns each "opens" date into an exact instant (opensAt, ms UTC), so
// the browser only compares numbers; the clock it compares against comes from the
// server's HTTP Date header (see app.js), not just the device.

export const TZ = 'Asia/Hebron';
export const OPEN_HOUR = 6;

// Three floors a day: easy, medium, hard.
export const LEVELS = ['easy', 'medium', 'hard'];
export const LEVEL_NAMES = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// Wall-clock time in Hebron at instant t, read back as if it were UTC.
function wallAsUtc(t) {
  const p = Object.fromEntries(parts.formatToParts(t).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

// 'YYYY-MM-DD' → the instant it is 06:00 in Hebron that day (DST-aware).
export function opensAtUtc(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`bad date "${date}", expected YYYY-MM-DD`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], OPEN_HOUR);
  let t = guess - (wallAsUtc(guess) - guess);
  t = guess - (wallAsUtc(t) - t); // second pass in case the offset changed in between
  return t;
}

// Hebron calendar date of instant t, 'YYYY-MM-DD'.
export function hebronDate(t) {
  return new Date(wallAsUtc(t)).toISOString().slice(0, 10);
}

// Floors open at `now`: floors are in date order, so count until the first closed one.
export function openCount(data, now) {
  let n = 0;
  for (const f of data.floors) {
    if (f.opensAt && f.opensAt > now) break;
    n++;
  }
  return n;
}

// Instant the next floor opens, or null if no future floor exists yet.
export function nextOpening(data, now) {
  const f = data.floors[openCount(data, now)];
  return f?.opensAt ?? null;
}

// Summit line: «طوابق الغد بعد 5:42 ساعة» (or اليوم before 06:00), «الطابق القادم بعد …»
// when a single floor is next, or «طابق جديد قريباً».
export function nextText(data, now) {
  const at = nextOpening(data, now);
  if (!at) return 'طابق جديد قريباً';
  const count = data.floors.filter((f) => f.opensAt === at).length;
  const day = hebronDate(at);
  const today = hebronDate(now);
  const tomorrow = hebronDate(opensAtUtc(today) + 24 * 3600e3);
  const what = count === 1 ? 'الطابق القادم' : day === tomorrow ? 'طوابق الغد' : day === today ? 'طوابق اليوم' : 'الطوابق القادمة';
  return `${what} بعد ${countdownText(at - now)}`;
}

// «5:42 ساعة», «12 دقيقة», «أقل من دقيقة»
export function countdownText(ms) {
  const min = Math.ceil(Math.max(0, ms) / 60000);
  if (ms <= 0 || min < 1) return 'أقل من دقيقة';
  if (min >= 60) return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} ساعة`;
  if (min === 1) return 'دقيقة';
  if (min === 2) return 'دقيقتين';
  if (min <= 10) return `${min} دقائق`;
  return `${min} دقيقة`;
}

// Label for a floor that has not opened: «يُفتح اليوم», «يُفتح غداً», «يُفتح 23/10».
export function openLabel(floor, now) {
  const today = hebronDate(now);
  if (floor.opens === today) return 'يُفتح اليوم';
  if (floor.opens === hebronDate(opensAtUtc(today) + 24 * 3600e3)) return 'يُفتح غداً';
  const [, mo, d] = floor.opens.split('-');
  return `يُفتح ${+d}/${+mo}`;
}
