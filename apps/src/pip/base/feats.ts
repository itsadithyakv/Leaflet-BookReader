/**
 * A planned raid's stars (the raids plan, 2026-10-24), each for something a
 * reader can see they did:
 *
 * - ★ the nest taken;
 * - ★★ most of the camp pulled down (the share a star always asked for);
 * - ★★★ the stronghold's feat, which goes with its quirk (`quirks.ts`): the
 *   watch-crow silenced before it calls, the nest taken before the bell, the
 *   gate left standing. A camp with no quirk (a friend's) asks for all of it.
 *
 * The feat counts only with the nest taken: "leave the gate standing" is not
 * done by staying at home. For each star missed the result says why, as a key
 * the end card turns into a line (`MISSED`).
 */

export type Feat = "crow" | "thorns" | "bell" | "perches" | "gate" | "pits" | "whole";

/** Each feat, as the end card and the scout view say it. */
export const FEATS: Readonly<Record<Feat, string>> = {
  crow: "Silence the watch-crow before it calls",
  thorns: "Lose no more than two who went through the thorns",
  bell: "Take the nest before the bell",
  perches: "Pull down every perch",
  gate: "Leave the stout gate standing",
  pits: "Lose nobody to the pits",
  whole: "Pull all of it down"
};

/** Why a star was missed: one key a star. */
export type Missed =
  | "nest"
  | "most"
  | "crowCalled"
  | "crowStood"
  | "thorns"
  | "bell"
  | "perches"
  | "gate"
  | "pits"
  | "whole"
  /** The feat was done, but the nest was not taken, and it counts only with the nest. */
  | "featNest";

/** The missed star's line, for the end card. */
export const MISSED: Readonly<Record<Missed, string>> = {
  nest: "The nest stood",
  most: "Too little of it came down",
  crowCalled: "The watch-crow called its second flight",
  crowStood: "The watch-crow's perch still stands",
  thorns: "More than two who went through the thorns fell",
  bell: "The bell rang before the nest fell",
  perches: "A perch still stands",
  gate: "The stout gate came down",
  pits: "The pits took somebody",
  whole: "Some of it still stands",
  featNest: "The feat counts only with the nest taken"
};

/** The share of a camp pulled down that is "most of it". */
export const MOST_SHARE = 0.5;
/** The bell: seconds into the raid by which the nest has to fall, for that feat. */
export const BELL_SECONDS = 30;
/** How many who went through a stronghold's thorns may fall, for the feat. */
export const FEAT_LOSSES = 2;

/** What the battle saw that the stars are counted from. */
export type Tally = {
  nestDown: boolean;
  /** Seconds in when the nest fell; null while it stands. */
  nestAt: number | null;
  destroyed: number;
  /** The watch-crow: whether it called, and whether its perch is down (silenced before the call is the feat). */
  crowCalled: boolean;
  crowDown: boolean;
  /** Its perch fell before it called. */
  crowFirst: boolean;
  /** Scouts who went through the thorns and fell, there or after. */
  lostToThorns: number;
  /** Scouts the pits took (a sprout scrambles out of one: it is what is sent to spring them). */
  lostToPits: number;
  perchesStanding: number;
  /** The stout gate, where there is one. */
  gateStanding: boolean;
};

export type Stars = {
  stars: 0 | 1 | 2 | 3;
  /** Each star: the nest, most of it, the feat. */
  earned: [boolean, boolean, boolean];
  feat: Feat;
  /** One key for each star missed, in the stars' order. */
  missed: Missed[];
};

/** Whether the feat's own condition was met, nest or not; and the key if not. */
const featDone = (feat: Feat, tally: Tally): Missed | null => {
  switch (feat) {
    case "crow":
      return tally.crowFirst ? null : tally.crowCalled ? "crowCalled" : "crowStood";
    case "thorns":
      return tally.lostToThorns <= FEAT_LOSSES ? null : "thorns";
    case "bell":
      return tally.nestAt !== null && tally.nestAt <= BELL_SECONDS ? null : "bell";
    case "perches":
      return tally.perchesStanding === 0 ? null : "perches";
    case "gate":
      return tally.gateStanding ? null : "gate";
    case "pits":
      return tally.lostToPits === 0 ? null : "pits";
    case "whole":
      return tally.destroyed >= 0.999 ? null : "whole";
  }
};

/**
 * What a raid's end card is told about its stars, from a planned raid's
 * result: each star, the feat, and why any was missed. Nothing for a raid
 * fought by hand (its result has none of it), so a `RaidEnd` from one is as
 * it always was.
 */
export const endStars = (result: { earned?: Stars["earned"]; feat?: Feat; missed?: Missed[] }): Partial<Pick<Stars, "earned" | "feat" | "missed">> =>
  result.earned && result.feat ? { earned: result.earned, feat: result.feat, missed: result.missed ?? [] } : {};

export const starsOf = (feat: Feat, tally: Tally): Stars => {
  const missed: Missed[] = [];
  const nest = tally.nestDown;
  if (!nest) missed.push("nest");
  const most = tally.destroyed >= MOST_SHARE;
  if (!most) missed.push("most");
  const undone = featDone(feat, tally);
  const done = nest && undone === null;
  if (!done) missed.push(undone ?? "featNest");
  const earned: [boolean, boolean, boolean] = [nest, most, done];
  return { stars: earned.filter(Boolean).length as Stars["stars"], earned, feat, missed };
};
