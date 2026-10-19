// Basic nickname filter. Not meant to be complete, only to stop the obvious.
// Copied into supabase/functions/_shared by the build so the server applies the same rule.

import { normalize } from './normalize.js';

// Matched anywhere in the name (spaces and repeated letters removed first).
const ANYWHERE = [
  'شرموط', 'منيوك', 'منيك', 'متناك', 'قحبه', 'عرص', 'طيز', 'سكس', 'نيك', 'نياك',
  'كسمك', 'كساختك', 'ابنالكلب', 'ابنالحرام', 'يلعن', 'لعنه',
  'fuck', 'shit', 'bitch', 'porn', 'sex', 'nigg', 'whore', 'dick', 'pussy', 'sharmout',
];
// Matched only as a whole word (too short to match inside other words).
const WORDS = ['كس', 'زب', 'زبي', 'كلب', 'حمار', 'حيوان', 'واطي', 'خول', 'ass', 'kos'];

export const NICK_MAX = 20;

export function isBadNickname(name) {
  const n = normalize(name);
  const squashed = n.replace(/\s+/g, '').replace(/(.)\1+/g, '$1');
  if (ANYWHERE.some((w) => squashed.includes(w.replace(/(.)\1+/g, '$1')))) return true;
  return n.split(' ').some((w) => WORDS.includes(w) || WORDS.includes(normalize(w)));
}

// Returns an error message in Arabic, or '' if the nickname is fine.
export function nicknameError(name) {
  const s = String(name ?? '').trim();
  if (!s) return 'اكتب اسماً مستعاراً';
  if ([...s].length > NICK_MAX) return `الاسم أطول من ${NICK_MAX} حرفاً`;
  if (isBadNickname(s)) return 'اختر اسماً آخر';
  return '';
}
