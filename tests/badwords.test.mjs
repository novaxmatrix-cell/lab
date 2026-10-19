import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nicknameError, isBadNickname } from '../docs/burj/js/badwords.js';

test('accepts normal names', () => {
  for (const n of ['لين', 'أبو العبد', 'Nova', 'زبيدة', 'كسرى', 'دخول', 'محمود ع', 'Kostas']) assert.equal(nicknameError(n), '', n);
});

test('rejects obvious insults, also with tashkeel, spacing and repeated letters', () => {
  for (const n of ['شرموط', 'شَرْمُوط', 'شررموط', 'ش ر م و ط', 'كلب', 'يا حمار', 'fuck', 'FUCKK']) assert.ok(isBadNickname(n), n);
});

test('length and empty', () => {
  assert.equal(nicknameError(''), 'اكتب اسماً مستعاراً');
  assert.equal(nicknameError('   '), 'اكتب اسماً مستعاراً');
  assert.equal(nicknameError('ا'.repeat(20)), '');
  assert.ok(nicknameError('ا'.repeat(21)));
});
