/**
 * The diary's dice. Nothing here is random: every pick is worked out from the
 * date, so a day's entry reads the same on every device and every time it is
 * opened.
 *
 * Pure: no clock, no storage.
 */

/** A small, fixed hash (FNV-1a, then stirred so that neighbouring dates land apart). */
export const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** A local calendar day ("2026-10-04") as a count of days, so days can be stepped and compared. */
export const dayNumber = (dateKey: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return Number.NaN;
  }
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
};

/** The day a count stands for. */
export const dayKey = (day: number): string => new Date(day * 86_400_000).toISOString().slice(0, 10);

const mod = (value: number, by: number) => ((value % by) + by) % by;

/** The numbers 0..n-1 in an order fixed by the seed. */
const shuffled = (n: number, seed: string): number[] => {
  const order = Array.from({ length: n }, (_, index) => index);
  for (let index = n - 1; index > 0; index -= 1) {
    const other = hash(`${seed}/${index}`) % (index + 1);
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
};

/**
 * Which of a pool's `n` lines a day gets.
 *
 * The days are dealt out like a pack of cards: every `n` days the pool is
 * shuffled afresh (by the pool's name and which deal it is) and handed out
 * one a day, so no line comes round again until the others have had a turn,
 * and never on two days running. Where one deal ends and the next begins the
 * same line could meet itself; the new deal then swaps its first two, which
 * leaves the last card of every deal where it was, so the rule needs nothing
 * from any day but the two deals either side of it.
 */
export const dealt = (pool: string, n: number, day: number): number => {
  if (n <= 1 || !Number.isFinite(day)) {
    return 0;
  }
  if (n === 2) {
    return mod(day + hash(pool), 2);
  }
  const deal = Math.floor(day / n);
  const order = shuffled(n, `${pool}#${deal}`);
  const before = shuffled(n, `${pool}#${deal - 1}`);
  if (order[0] === before[n - 1]) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order[mod(day, n)];
};
