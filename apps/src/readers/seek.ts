/**
 * Going anywhere in the book: a fraction of the way through (the progress
 * bar's handle) as a place to go to, by the same section weights progress is
 * measured with, so the bar and the percentage always agree.
 */

import type { SectionWeights } from "./progress";

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** The section a fraction of the story falls in, and how far through that section. */
export const seekTarget = (weights: SectionWeights, fraction: number) => {
  const { prefix, bytes, lo, hi } = weights;
  const target = prefix[lo] + clamp01(fraction) * (prefix[hi + 1] - prefix[lo]);
  let section = weights.last;
  for (let index = lo; index <= hi; index += 1) {
    if (bytes[index] > 0 && prefix[index + 1] > target) {
      section = index;
      break;
    }
  }
  const size = bytes[section] ?? 0;
  // The very end is the last line, not a blank past it.
  const within = size > 0 ? Math.min(0.995, Math.max(0, (target - prefix[section]) / size)) : 0;
  return { section, within };
};

/** The other way: how far through the story a place in a section is. */
export const fractionAt = (weights: SectionWeights, section: number, within: number) => {
  const { prefix, bytes, lo, hi } = weights;
  const span = prefix[hi + 1] - prefix[lo];
  if (span <= 0) {
    return 0;
  }
  const at = Math.min(Math.max(section, lo), hi);
  const inside = section < lo ? 0 : section > hi ? 1 : clamp01(within);
  return clamp01((prefix[at] - prefix[lo] + inside * (bytes[at] ?? 0)) / span);
};

/** A pointer along the bar as a fraction: 0 at its left end, 1 at its right. */
export const fractionAlong = (x: number, left: number, width: number) => (width > 0 ? clamp01((x - left) / width) : 0);

/** One key press on the bar: arrows a hundredth, Page keys a tenth, Home and End the ends. Null for any other key. */
export const seekByKey = (key: string, fraction: number) => {
  const step = key === "ArrowRight" || key === "ArrowUp" ? 0.01 : key === "ArrowLeft" || key === "ArrowDown" ? -0.01 : key === "PageUp" ? 0.1 : key === "PageDown" ? -0.1 : null;
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return 1;
  }
  // Whole hundredths, so ten presses are ten percent and not 9.99.
  return step === null ? null : clamp01(Math.round((fraction + step) * 100) / 100);
};
