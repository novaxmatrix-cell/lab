// Arabic counted nouns written with digits. The noun follows the last two digits:
// 1 «طابق واحد», 2 «طابقان», 3–10 «طوابق», 11–99 «طابقاً», and a round hundred
// or hundred-and-one/two takes the singular: «100 طابق», «102 طابق», «103 طوابق», «111 طابقاً».
export function countLabel(n, f) {
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  const r = n % 100;
  if (r <= 2) return `${n} ${f.single}`;
  if (r <= 10) return `${n} ${f.few}`;
  return `${n} ${f.many}`;
}

export const FLOORS = { one: 'طابق واحد', two: 'طابقان', few: 'طوابق', many: 'طابقاً', single: 'طابق' };
export const MINUTES = { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة', single: 'دقيقة' };
export const PLAYERS = { one: 'لاعب واحد', two: 'لاعبان', few: 'لاعبين', many: 'لاعباً', single: 'لاعب' };
