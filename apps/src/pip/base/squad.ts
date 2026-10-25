/**
 * A planned raid, before it sets out (the raids plan, 2026-10-24): the squad
 * the reader makes, checked against the hut; the plan a reader who does not
 * think about it would make (everyone down the trail, nobody held back, no
 * orders); and the forecast, honest and coarse, of how a plan will go.
 *
 * A squad is made of room, not heads: a sprout or a slinger takes one place
 * in the hut's party, a mole or a Puffcap two (the plan said three for a
 * Puffcap; at three the hut's third level, which brings it, sent fewer
 * scouts than its second, and the sim showed the level not worth having),
 * so a mix is a real choice. The room is the hut's `capacity` (`rules.ts` `scoutsOf`).
 *
 * The forecast plays the plan out a few times, each shaken a little
 * (`Setup.jitter`: when the perches throw first, how close the scouts walk),
 * and says the stars they mostly came to, with the best and worst of them.
 * It is a guide and not an answer: the orders given in the fight are what
 * make the most of a plan, and it assumes none (a held group goes in at
 * `HELD_LATEST`).
 */
import { BATTLE_TICK, Battle, ROOM, type Result, type ScoutKind, type Setup, type Squad, type SquadGroup, type Structure } from "./battle";
import { FEATS, type Feat } from "./feats";
import type { Order } from "./orders";
import { QUIRKS, type Quirk } from "./quirks";
import type { Approach, Zone } from "./approaches";

/** The room each kind takes in the hut's party (`battle.ts`, where the battle holds a squad to it). */
export { ROOM };
/** The most groups a squad is split into. */
export const GROUPS_MOST = 4;

/** The room a squad takes. */
export const roomOf = (squad: Squad) =>
  squad.groups.reduce((sum, group) => sum + (Object.keys(group.scouts) as ScoutKind[]).reduce((part, kind) => part + Math.max(0, Math.floor(group.scouts[kind] ?? 0)) * ROOM[kind], 0), 0);
/** How many of a kind a squad sends, all groups together. */
export const countOf = (squad: Squad, kind: ScoutKind) => squad.groups.reduce((sum, group) => sum + Math.max(0, Math.floor(group.scouts[kind] ?? 0)), 0);

/** What is wrong with a squad, for the planning screen to say. */
export type SquadProblem =
  /** It takes more room than the hut has. */
  | "room"
  /** It sends a kind the hut has not trained. */
  | "kind"
  /** More Puffcaps than the hut trains for a raid (`Setup.bombers`). */
  | "bombers"
  /** A group goes down an approach the camp does not have. */
  | "approach"
  /** More than one group is held back. */
  | "held"
  /** A group with nobody in it, or no groups at all. */
  | "empty"
  /** More groups than `GROUPS_MOST`. */
  | "groups";

/** Whether a squad can set out against this camp: the problems, none when it can. `approaches`: how many the camp has. */
export const checkSquad = (setup: Pick<Setup, "capacity" | "kinds" | "bombers">, squad: Squad, approaches: number): SquadProblem[] => {
  const problems = new Set<SquadProblem>();
  if (squad.groups.length === 0) problems.add("empty");
  if (squad.groups.length > GROUPS_MOST) problems.add("groups");
  if (roomOf(squad) > setup.capacity) problems.add("room");
  if (squad.groups.filter((group) => group.held).length > 1) problems.add("held");
  if (countOf(squad, "bomber") > Math.max(0, Math.floor(setup.bombers ?? 0))) problems.add("bombers");
  for (const group of squad.groups) {
    const kinds = (Object.keys(group.scouts) as ScoutKind[]).filter((kind) => (group.scouts[kind] ?? 0) > 0);
    if (kinds.length === 0 && !group.hero) problems.add("empty");
    if (kinds.some((kind) => !setup.kinds.includes(kind))) problems.add("kind");
    if (!Number.isInteger(group.approach) || group.approach < 0 || group.approach >= approaches) problems.add("approach");
  }
  return [...problems];
};

/**
 * The mix a reader would send without thinking: what the hut sends a raid
 * by hand (`battle.ts` `autoPilot`), in room: a Puffcap if the hut trains
 * one, a third of the rest in slingers, a mole or two, and sprouts for the
 * rest.
 */
export const plainMix = (setup: Pick<Setup, "capacity" | "kinds" | "bombers">): Partial<Record<ScoutKind, number>> => {
  let free = Math.max(0, Math.floor(setup.capacity));
  const has = (kind: ScoutKind) => setup.kinds.includes(kind);
  const bomber = has("bomber") ? Math.min(1, Math.max(0, Math.floor(setup.bombers ?? 0)), Math.floor(free / (2 * ROOM.bomber))) : 0;
  free -= bomber * ROOM.bomber;
  const mole = has("mole") ? Math.max(1, Math.floor((free * 0.15) / ROOM.mole)) : 0;
  free -= mole * ROOM.mole;
  const slinger = has("slinger") ? Math.floor(free * 0.3) : 0;
  free -= slinger;
  const mix: Partial<Record<ScoutKind, number>> = { sprout: Math.max(0, free) };
  if (slinger > 0) mix.slinger = slinger;
  if (mole > 0) mix.mole = mole;
  if (bomber > 0) mix.bomber = bomber;
  return mix;
};

/** The plan a reader makes without thinking about it: one group, the plain mix, down the first approach (the trail), the hero along. */
export const naiveSquad = (setup: Pick<Setup, "capacity" | "kinds" | "bombers" | "hero">): Squad => ({ groups: [{ scouts: plainMix(setup), approach: 0, ...(setup.hero ? { hero: true } : {}) }] });

/** A setup with a squad (and orders, if any): a planned raid. */
export const planned = (setup: Setup, squad: Squad, orders: Order[] = []): Setup => ({ ...setup, squad, orders });

/** What the scout view shows before a squad is made: the camp as it will be fought, its approaches and their hazards, its quirk and its feat. */
export type Scouted = { structures: Structure[]; approaches: Approach[]; zones: Zone[]; quirk: Quirk | null; feat: Feat; featWords: string; quirkWords: { name: string; does: string; beats: string } | null };
export const scoutOf = (setup: Setup, structures?: Structure[]): Scouted => {
  const battle = new Battle({ ...setup, squad: setup.squad ?? { groups: [] } }, structures);
  const feat = battle.feat ?? "whole";
  return {
    structures: battle.structures,
    approaches: battle.approaches,
    zones: battle.zones,
    quirk: battle.quirk,
    feat,
    featWords: FEATS[feat],
    quirkWords: battle.quirk ? QUIRKS[battle.quirk] : null
  };
};

/** Plays a planned raid out, from its squad and its orders (a raid played again exactly as it went), and hands the battle back. */
export const playOut = (setup: Setup, structures?: Structure[]): Battle => {
  const battle = new Battle(setup, structures);
  while (!battle.over) battle.step(BATTLE_TICK);
  return battle;
};
export const playPlan = (setup: Setup, structures?: Structure[]): Result => playOut(setup, structures).result();

/** The forecast's runs: each shaken a little differently. */
export const FORECAST_RUNS = 3;
export type PlanForecast = {
  /** The stars the runs mostly came to (the middle of them). */
  likely: 0 | 1 | 2 | 3;
  /** The worst and the best of them. */
  low: 0 | 1 | 2 | 3;
  high: 0 | 1 | 2 | 3;
  /** Each star's share of the runs that earned it: the nest, most of it, the feat. */
  earned: [number, number, number];
  /** How much of the camp the runs pulled down, on average (for what the raid would bring). */
  destroyed: number;
};
/** The last few forecasts, by what they were of: a plan looked at again (the screen drawn again) costs nothing. */
const FORECASTS_KEPT = 12;
const forecasts = new Map<string, PlanForecast>();
/** What the runs came to. */
const summarise = (results: readonly Result[]): PlanForecast => {
  const stars = results.map((result) => result.stars).sort((a, b) => a - b);
  const share = (star: 0 | 1 | 2) => results.filter((result) => result.earned?.[star]).length / Math.max(1, results.length);
  return {
    likely: stars[Math.floor((stars.length - 1) / 2)] ?? 0,
    low: stars[0] ?? 0,
    high: stars[stars.length - 1] ?? 0,
    earned: [share(0), share(1), share(2)],
    destroyed: results.reduce((sum, result) => sum + result.destroyed, 0) / Math.max(1, results.length)
  };
};
const keyOf = (setup: Setup, structures: Structure[] | undefined, runs: number) => JSON.stringify([setup, structures ?? null, runs]);
const keep = (key: string, made: PlanForecast) => {
  if (forecasts.size >= FORECASTS_KEPT) forecasts.delete(forecasts.keys().next().value!);
  forecasts.set(key, made);
  return made;
};
/**
 * How a plan will likely go, from a few runs of it shaken a little. Cheap
 * enough to call as a plan changes (about 4 ms for three runs on a desktop,
 * 2026-10-24), and the same plan again is not run again.
 */
export const forecastPlan = (setup: Setup, structures?: Structure[], runs = FORECAST_RUNS): PlanForecast => {
  const key = keyOf(setup, structures, runs);
  const kept = forecasts.get(key);
  if (kept) return kept;
  const results: Result[] = [];
  for (let run = 0; run < runs; run++) results.push(playPlan({ ...setup, jitter: run + 1 }, structures));
  return keep(key, summarise(results));
};
/**
 * The same forecast a run at a time (2026-10-25), for the planning screen:
 * each call of the step it hands back plays one run, and the last says the
 * forecast (null until then). Three runs at once held the page for 50 to 75 ms
 * at a quarter of a desktop's speed, and 240 ms the first time; one at a time,
 * between frames, the page never waits long. The figures are `forecastPlan`'s
 * exactly, and kept with its.
 */
export const forecastInSteps = (setup: Setup, structures?: Structure[], runs = FORECAST_RUNS): (() => PlanForecast | null) => {
  const key = keyOf(setup, structures, runs);
  const results: Result[] = [];
  return () => {
    const kept = forecasts.get(key);
    if (kept) return kept;
    results.push(playPlan({ ...setup, jitter: results.length + 1 }, structures));
    return results.length < runs ? null : keep(key, summarise(results));
  };
};

/** A squad group, for building plans by hand (the sim, tests). */
export const group = (scouts: Partial<Record<ScoutKind, number>>, approach: number, more: Omit<SquadGroup, "scouts" | "approach"> = {}): SquadGroup => ({ scouts, approach, ...more });
