import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opensAtUtc, hebronDate, openCount, nextOpening, countdownText, openLabel, TZ } from '../docs/burj/js/schedule.js';
import { sealChain } from '../scripts/seal.mjs';

const hebronClock = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);

test('opens at 06:00 Hebron time, before and after the DST change', () => {
  // Palestine leaves summer time in late October 2026: 06:00 moves from 03:00Z to 04:00Z.
  assert.equal(new Date(opensAtUtc('2026-10-20')).toISOString(), '2026-10-20T03:00:00.000Z');
  assert.equal(new Date(opensAtUtc('2026-10-26')).toISOString(), '2026-10-26T04:00:00.000Z');
  for (const d of ['2026-01-15', '2026-03-28', '2026-07-01', '2026-10-23', '2026-10-24', '2026-10-25', '2026-12-31']) {
    assert.equal(hebronClock(opensAtUtc(d)), '06:00', d);
    assert.equal(hebronDate(opensAtUtc(d)), d, d);
  }
});

test('rejects malformed dates', () => {
  for (const d of ['2026-10-2', '20/10/2026', '', 'tomorrow']) assert.throws(() => opensAtUtc(d), d);
});

const at = (iso) => Date.parse(iso);
const data = {
  floors: [{}, {}, { opens: '2026-10-20', opensAt: opensAtUtc('2026-10-20') }, { opens: '2026-10-21', opensAt: opensAtUtc('2026-10-21') }, { opens: '2026-10-23', opensAt: opensAtUtc('2026-10-23') }],
};

test('counts open floors by the clock', () => {
  assert.equal(openCount(data, at('2026-10-20T02:59:59Z')), 2); // 05:59:59 Hebron
  assert.equal(openCount(data, at('2026-10-20T03:00:00Z')), 3); // 06:00 Hebron
  assert.equal(openCount(data, at('2026-10-21T12:00:00Z')), 4);
  assert.equal(openCount(data, at('2027-01-01T00:00:00Z')), 5);
});

test('next opening', () => {
  assert.equal(nextOpening(data, at('2026-10-20T01:00:00Z')), opensAtUtc('2026-10-20'));
  assert.equal(nextOpening(data, at('2026-10-20T03:00:00Z')), opensAtUtc('2026-10-21'));
  assert.equal(nextOpening(data, at('2027-01-01T00:00:00Z')), null);
});

test('countdown text', () => {
  assert.equal(countdownText((5 * 60 + 42) * 60000), '5:42 ساعة');
  assert.equal(countdownText((5 * 60 + 41) * 60000 + 1), '5:42 ساعة'); // rounds up, never shows 0 early
  assert.equal(countdownText(60 * 60000), '1:00 ساعة');
  assert.equal(countdownText(42 * 60000), '42 دقيقة');
  assert.equal(countdownText(5 * 60000), '5 دقائق');
  assert.equal(countdownText(2 * 60000), 'دقيقتين');
  assert.equal(countdownText(30000), 'دقيقة');
  assert.equal(countdownText(0), 'أقل من دقيقة');
});

test('labels for floors not open yet', () => {
  const night = at('2026-10-19T22:00:00Z'); // 01:00 on Oct 20 in Hebron
  assert.equal(openLabel(data.floors[2], night), 'يُفتح اليوم');
  assert.equal(openLabel(data.floors[3], night), 'يُفتح غداً');
  assert.equal(openLabel(data.floors[4], night), 'يُفتح 23/10');
  const noon = at('2026-10-20T09:00:00Z');
  assert.equal(openLabel(data.floors[3], noon), 'يُفتح غداً');
});

test('sealed data carries the open time outside the ciphertext', async () => {
  const sealed = await sealChain([{ q: 'أ', answers: ['باب'] }, { q: 'ب', answers: ['شمس'], opens: '2026-10-24' }], { iterations: 1000 });
  assert.equal(sealed.floors[0].opensAt, undefined);
  assert.equal(sealed.floors[1].opens, '2026-10-24');
  assert.equal(sealed.floors[1].opensAt, Date.parse('2026-10-24T04:00:00Z'));
});
