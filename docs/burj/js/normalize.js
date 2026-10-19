// Answer normalization. Shared by the browser, the build script, the tests and
// (as a copy made by the build) the Supabase Edge Function, so a typed answer and
// a stored answer always reduce to the same string.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;
// Zero-width and direction marks that phone keyboards like to insert.
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
// Punctuation people add without thinking: «قلم!» or «7.»
const PUNCT = /[.,!?;:'"«»()\[\]{}\-_،؛؟٫٬…]/g;

export function normalize(input) {
  let s = String(input ?? '').normalize('NFC');
  s = s.replace(INVISIBLE, '').replace(TASHKEEL, '').replace(TATWEEL, '');
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  s = s.replace(PUNCT, ' ').toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  // Optional leading «ال»: «البرج» and «برج» are the same answer.
  if (s.startsWith('ال') && s.length > 3) s = s.slice(2);
  return s;
}
