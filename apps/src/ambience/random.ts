/**
 * Chance, from a seed: the radio's rain never falls the same way twice, yet
 * the tests (and a measured render) can ask for the same shower again. One
 * small generator and the few shapes of chance the scenes use.
 */

/** A number from 0 up to (not including) 1, like `Math.random`. */
export type Random = () => number;

/** mulberry32: small, fast, and even enough for where a raindrop lands. */
export const seeded = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A seed for one part of a scene, from the scene's seed and the part's number:
 * each part draws from its own source, so switching the thunder off does not
 * move a single raindrop.
 */
export const forkSeed = (seed: number, part: number) => {
  let mixed = (seed ^ Math.imul(part + 1, 0x9e3779b1)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

/** A seed nobody chose, for the radio itself. */
export const freshSeed = () => (Math.floor(Math.random() * 4294967296) ^ Date.now()) >>> 0;

export type Span = readonly [number, number];

/** Somewhere between the two, evenly. */
export const between = (random: Random, [low, high]: Span) => low + (high - low) * random();

/** Somewhere between the two, evenly by ratio: right for pitches and for rates. */
export const betweenRatio = (random: Random, [low, high]: Span) => low * Math.pow(high / low, random());

/**
 * Somewhere between the two, mostly near the low end: `skew` 1 is even, 3
 * leaves only a few near the top (most crackles are small, a pop is rare).
 */
export const mostlyLow = (random: Random, [low, high]: Span, skew: number) => low + (high - low) * Math.pow(random(), skew);

/** A whole number from low to high, both included. */
export const wholeBetween = (random: Random, [low, high]: Span) => Math.min(high, Math.floor(low + (high - low + 1) * random()));

/**
 * The wait until the next of things that happen `perSecond` on average, each
 * regardless of the last (drops, crackles): short waits are common, long
 * ones happen.
 */
export const waitFor = (random: Random, perSecond: number) => -Math.log(1 - random()) / perSecond;
