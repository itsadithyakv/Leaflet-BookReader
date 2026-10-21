/**
 * Where Pip may rest on a phone: along the top of the book being read (or the tab bar), but not
 * standing over words. The page scrolls on under that edge, so what is under her changes: once the
 * page is still she steps off a title or an author onto a clear bit (a cover, a gap), if there is
 * one. Pure, so the rule is tested without a page; PipWorld reads the words' boxes.
 */

import { HALF_W } from "./wall";

/** Room kept between her and a word when she picks a spot (a word only grazing her does not move her). */
export const FOOTING_PAD = 4;

/** A stretch of x along her floor, [from, to]. */
export type Span = readonly [number, number];

/**
 * The x's her middle can take in [minX, maxX] with no word within her half-width (plus `pad`):
 * the floor less every word's box, widened by her body.
 */
export const clearSpans = (words: readonly Span[], minX: number, maxX: number, pad = FOOTING_PAD, halfW = HALF_W): Span[] => {
  if (maxX < minX) return [];
  const blocked = words
    .map(([a, b]) => [a - halfW - pad, b + halfW + pad] as const)
    .filter(([a, b]) => b > minX && a < maxX)
    .sort((p, q) => p[0] - q[0]);
  const spans: Span[] = [];
  let from = minX;
  for (const [a, b] of blocked) {
    if (a > from) spans.push([from, a]);
    from = Math.max(from, b);
    if (from >= maxX) break;
  }
  if (from < maxX) spans.push([from, maxX]);
  return spans;
};

/**
 * Where her floor is the top of something narrower than her lane (the book being read, floating in the middle of a
 * phone on its side), the stretches of the lane beside it: there she would stand in the air over the page (a
 * card, a heading), so they count as words. Nothing where the floor is not such a top.
 */
export const besideSurface = (minX: number, maxX: number, surface: Span | null): Span[] => {
  if (!surface) return [];
  const spans: Span[] = [];
  if (surface[0] > minX) spans.push([minX, Math.min(maxX, surface[0])]);
  if (surface[1] < maxX) spans.push([Math.max(minX, surface[1]), maxX]);
  return spans;
};

/** Whether Pip standing at x has a word under her body (no padding: only what she really covers). */
export const standsOnWords = (x: number, words: readonly Span[], halfW = HALF_W) =>
  words.some(([a, b]) => b > x - halfW && a < x + halfW);

/** The clear spot nearest x, or null when the whole floor is words. */
export const nearestClear = (x: number, spans: readonly Span[]): number | null => {
  let best: number | null = null;
  for (const [a, b] of spans) {
    const at = Math.max(a, Math.min(b, x));
    if (best === null || Math.abs(at - x) < Math.abs(best - x)) best = at;
  }
  return best;
};

/** A random clear spot at least `away` from x (a stroll), or null. */
export const strollTarget = (x: number, spans: readonly Span[], away = 50, random = Math.random): number | null => {
  const reachable = spans
    .flatMap(([a, b]) => [
      [a, Math.min(b, x - away)] as const,
      [Math.max(a, x + away), b] as const
    ])
    .filter(([a, b]) => b > a);
  const total = reachable.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (total <= 0) return null;
  let at = random() * total;
  for (const [a, b] of reachable) {
    if (at <= b - a) return a + at;
    at -= b - a;
  }
  return reachable[reachable.length - 1][1];
};

/** The poses with her bed in them (bedtime, tucked in). */
export const BED_POSES: ReadonlySet<string> = new Set(["bedtime", "bedsleep"]);

/**
 * How much of her lane a pose takes, given the sprite's size in CSS px and her standing height:
 * standing, her body (HALF_W either side); in her bed, the bed (15 of the sprite's 32 pixels either
 * side of her middle) and the sprite's whole height (the nightcap and its Zs). The bed used to be
 * kept off words by her body's width, and not at all while she napped in it, so on a phone it lay
 * over a card's ⋯ and its "0%".
 */
export const footprint = (move: string, spriteCss: number, standingTall: number): { halfW: number; tall: number } =>
  BED_POSES.has(move) ? { halfW: Math.round((spriteCss * 15) / 32), tall: Math.max(standingTall, spriteCss) } : { halfW: HALF_W, tall: standingTall };
