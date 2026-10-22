/**
 * Arriving at the camp after reading (1.5.11, "Your reading, made visible"):
 * the reading done since the last visit is seen coming up the parcel path as
 * a few pages, which fly to the oak and become its waiting acorn; one peels
 * off to the Raid key when the scouts got more rest, one to the meadow arrow
 * when your next bloom grew; and one goes from the oak to the chapter bar,
 * whose fill steps up to where the reading has it now (filling, emptying and
 * going on, where a chapter was crossed). About two seconds in all. The
 * numbers are behind a tap: the chapter card says what came since.
 *
 * Pure: what an arrival is made of, and when each thing of it happens. The
 * screen plays it (`BaseScreen.tsx`, `collect.tsx` `PageTrails`).
 */
import { chapterProgress } from "../../../../pip/base/chapters";
import { budStage } from "../../../../pip/base/trophies";
import { oakHolds, oakReady, raidsReady, restIn, trophyBudget, trophyWaits, type BaseState } from "../../../../pip/base/rules";
import { fillOf } from "./chapterWords";

/** When each thing of an arrival happens, in milliseconds from its start. */
export const ARRIVAL_MS = {
  /** Between one page setting off and the next. */
  gap: 75,
  /** A page's flight from the path to the oak. */
  fly: 700,
  /** Landed on the oak, a page is its acorn for so long. */
  acorn: 150,
  /** The peel-offs set out from so long in, and fly as a page does. */
  peel: 300,
  /** The page from the oak to the chapter bar. */
  bar: 1100,
  /** The bar's fill stepping up, once that page lands. */
  fill: 500,
  /** And once more where a chapter was crossed: the fill goes up, empties, and goes on. */
  cross: 600
} as const;
/** Pages flutter: two frames, eight a second. */
export const PAGE_FPS = 8;
/** Less than so much reading since the last visit, and nothing flies: the bar just stands at its new fill. */
export const ARRIVAL_LEAST = 5;
/** The most pages, by the device's tier. */
export const PAGES_MOST = { full: 6, lite: 3, minimal: 0 } as const;
export type Tier = keyof typeof PAGES_MOST;

/** How many pages come up the path for so many minutes read since the last visit. */
export const pagesFor = (delta: number, tier: Tier, still = false): number => {
  if (!Number.isFinite(delta) || delta < ARRIVAL_LEAST || still) return 0;
  return Math.min(PAGES_MOST[tier], 1 + Math.floor(delta / 15));
};

/** What the camp has to show for the reading, at a moment of it. */
export type ArrivalFigures = {
  /** Acorns waiting on the oak. */
  oak: number;
  /** Raids the scouts are rested for. */
  raids: number;
  /** The chapter, and how far through it (0 to 1). */
  chapter: number;
  part: number;
  /** Your next bloom's stage (0 to 3). */
  bud: number;
};
export type Arrival = {
  /** Minutes read since the last visit. */
  delta: number;
  pages: number;
  before: ArrivalFigures;
  after: ArrivalFigures;
  /** A page peels off to the Raid key, to the meadow arrow. */
  toRaid: boolean;
  toMeadow: boolean;
  /** A chapter was crossed: the chapter card waits for the arrival. */
  crossed: boolean;
  /** What the chapter card says came since: rested raids and when the next, the reading to the next chapter and the next bloom. */
  since: { minutes: number; oak: number; oakFull: boolean; raids: number; restIn: number; toChapter: number; toBloom: number };
  /** When it is all over, in ms from the start. */
  ends: number;
};

/** The camp's figures at a moment of the reading, as the rules have them. */
export const figuresAt = (state: BaseState, minutes: number): ArrivalFigures => {
  const progress = chapterProgress(null, minutes);
  return {
    oak: oakReady(state, Math.max(minutes, state.oakFrom)),
    raids: raidsReady(state, minutes),
    chapter: progress.chapter,
    part: progress.fraction,
    bud: budStage(trophyBudget(state, minutes))
  };
};

/**
 * The arrival for a camp seen now, after reading: null where too little has been read since it was last arrived at
 * (`seenAt`). `pages` 0 (the minimal tier, or motion kept still) is still an arrival: the bar steps up, the card
 * says what came, and the camp is marked as arrived at.
 */
export const arrivalOf = (state: BaseState, minutes: number, tier: Tier, still: boolean, meadowOpen: boolean): Arrival | null => {
  const seenAt = Math.min(Math.floor(minutes), Math.max(0, Math.floor(state.seenAt ?? minutes)));
  const delta = Math.floor(minutes) - seenAt;
  if (delta < ARRIVAL_LEAST) return null;
  const before = figuresAt(state, seenAt);
  const after = figuresAt(state, minutes);
  const pages = pagesFor(delta, tier, still);
  const crossed = after.chapter > before.chapter;
  const flying = pages > 0;
  const ends = flying ? ARRIVAL_MS.bar + ARRIVAL_MS.fly + ARRIVAL_MS.fill + (crossed ? ARRIVAL_MS.cross : 0) : 0;
  return {
    delta,
    pages,
    before,
    after,
    toRaid: flying && after.raids > before.raids,
    toMeadow: flying && meadowOpen && after.bud > before.bud,
    crossed,
    since: {
      minutes: delta,
      // Never more than the oak looks to hold: after a long time away, it is just full (the oak itself has no cap
      // since 1.5.10, and a figure of thousands said nothing).
      oak: Math.max(0, Math.min(after.oak - before.oak, oakHolds(state))),
      oakFull: oakHolds(state) > 0 && after.oak >= oakHolds(state),
      raids: Math.max(0, after.raids - before.raids),
      restIn: restIn(state, minutes),
      toChapter: chapterProgress(null, minutes).toGo,
      toBloom: trophyWaits(state, minutes)
    },
    ends
  };
};

/** When each page of an arrival sets out, and when the first lands (ms from the start). */
export const pageStarts = (pages: number): number[] => Array.from({ length: Math.max(0, pages) }, (_, index) => index * ARRIVAL_MS.gap);
export const firstLands = (pages: number): number => (pages > 0 ? ARRIVAL_MS.fly : 0);

/**
 * The chapter bar's fill at `t` ms into the arrival, in whole CSS pixels of a track `width` wide: where it stood until
 * the bar's page lands, then stepping up to where it is now; through a crossing, up to the end, empty, and on.
 */
export const barFillAt = (arrival: Pick<Arrival, "before" | "after" | "crossed" | "pages">, t: number, width = 44): number => {
  const from = fillOf(arrival.before.part, width);
  const to = fillOf(arrival.after.part, width);
  if (arrival.pages === 0) return to;
  const start = ARRIVAL_MS.bar + ARRIVAL_MS.fly;
  if (t <= start) return from;
  const along = t - start;
  if (!arrival.crossed) return along >= ARRIVAL_MS.fill ? to : Math.round(from + ((to - from) * along) / ARRIVAL_MS.fill);
  // Up to the end of the chapter that was, empty, then on into the new one.
  if (along < ARRIVAL_MS.fill) return Math.round(from + ((width - from) * along) / ARRIVAL_MS.fill);
  const on = along - ARRIVAL_MS.fill - ARRIVAL_MS.cross / 2;
  if (on < 0) return width;
  return on >= ARRIVAL_MS.cross / 2 ? to : Math.round((to * on) / (ARRIVAL_MS.cross / 2));
};
