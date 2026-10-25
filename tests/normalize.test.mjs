import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../docs/burj/js/normalize.js';
import { readFile } from 'node:fs/promises';

// Test words are deliberately not puzzle answers (the leak check scans this file).
test('trims and collapses spaces', () => {
  assert.equal(normalize('   باب    مفتوح  '), 'باب مفتوح');
  assert.equal(normalize('باب\t\nمفتوح'), 'باب مفتوح');
});

test('removes tashkeel and tatweel', () => {
  assert.equal(normalize('كَوْكَبٌ'), 'كوكب');
  assert.equal(normalize('مَدْرَسَةٌ'), 'مدرسه');
  assert.equal(normalize('كـــوكب'), 'كوكب');
  assert.equal(normalize('رحمٰن'), 'رحمن'); // superscript alef
});

test('unifies alef forms, taa marbuta, alef maqsura', () => {
  assert.equal(normalize('أمل'), 'امل');
  assert.equal(normalize('إسراء'), 'اسراء');
  assert.equal(normalize('آمنة'), 'امنه');
  assert.equal(normalize('ٱسم'), 'اسم');
  assert.equal(normalize('شجرة'), normalize('شجره'));
  assert.equal(normalize('مستشفى'), 'مستشفي');
});

test('optional leading ال', () => {
  assert.equal(normalize('الشمس'), 'شمس');
  assert.equal(normalize('الشمس'), normalize('شمس'));
  assert.equal(normalize('الشجرة'), 'شجره');
  assert.equal(normalize('  الكوكب '), 'كوكب');
  assert.equal(normalize('أل'), 'ال'); // too short to strip
  assert.equal(normalize('باب الدار'), 'باب الدار'); // only at the start
});

test('Arabic-Indic and Persian digits become Western', () => {
  assert.equal(normalize('٤٢'), '42');
  assert.equal(normalize('۴۲'), '42');
  assert.equal(normalize('٠١٢٣٤٥٦٧٨٩'), '0123456789');
});

test('ignores punctuation, invisible marks and Latin case', () => {
  assert.equal(normalize('باب!'), 'باب');
  assert.equal(normalize('٧.'), '7');
  assert.equal(normalize('«شمس»؟'), 'شمس');
  assert.equal(normalize('‏قمح‎'), 'قمح');
  assert.equal(normalize('Seven'), 'seven');
});

test('empty and odd input', () => {
  assert.equal(normalize(''), '');
  assert.equal(normalize('   '), '');
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
  assert.equal(normalize(7), '7');
});

test('idempotent', () => {
  for (const s of ['الشَّجَرَةُ', 'أَلف', '  ٣٣ ', 'مستشفى!']) assert.equal(normalize(normalize(s)), normalize(s));
});

test('Edge Function copy is identical to the client module', async () => {
  for (const f of ['normalize.js', 'badwords.js', 'towns.js']) {
    const a = await readFile(new URL(`../docs/burj/js/${f}`, import.meta.url), 'utf8');
    const b = await readFile(new URL(`../supabase/functions/_shared/${f}`, import.meta.url), 'utf8');
    assert.equal(b, a, `${f} out of sync: run npm run build`);
  }
});
