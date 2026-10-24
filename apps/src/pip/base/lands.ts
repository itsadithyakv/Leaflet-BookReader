/**
 * The Magpie Lands (raids rethought, 2026-10-24, docs/design/hollow/raids-plan.md, section 1): the raid key's map.
 *
 * One path from Pip's camp through five regions, named as the strongholds always were (`CAMP_NAMES`), three
 * strongholds to each, the third a lord's keep (`lordOf`). The Magpie King's roost on the peak, lit in the months he
 * can be fought, with every banner won flying there. Past stronghold 15 the path goes on into the Far Rookeries, one
 * numbered stronghold at a time, so the ladder still has no end.
 *
 * Fog follows the chapters, the pacing that already opens raids and the King: a region lies under it until its
 * chapter is reached, the chapter that lets the scouts' hut grow to meet it (`REGION_CHAPTER`). The stronghold that is
 * next is never under fog, so the map never stands in the way of a raid: it only shows how far the reading has
 * carried the camp.
 *
 * Plain functions of the camp and the time: what the map shows (`landsOf`), and what a tap on it starts (`raidOf`).
 */
import { CHAMPIONS } from "./heroes";
import { CHAPTER_OF, chapterNow, opened } from "./chapters";
import { isScouted, starsOf, withScouted } from "./raidMark";
import {
  CAMP_NAMES,
  CAMPS_A_NAME,
  kingClosed,
  lordOf,
  monthOf,
  type BaseState,
  type Now,
  type RaidKind
} from "./rules";

/** The five regions, then the Far Rookeries. */
export const REGIONS = CAMP_NAMES.length;
/** Strongholds on the main path: three to a region. */
export const MAIN_STRONGHOLDS = REGIONS * CAMPS_A_NAME;
/** The Far Rookeries' region number. */
export const FAR = REGIONS;
/** Far strongholds taken that the map still shows behind the next one. */
export const FAR_SHOWN = 2;

/**
 * The chapter that lifts each region's fog: raids open at 2 (the first region), and each region after comes with a
 * chapter that raises the burrow (and so how high the scouts' hut can go): 3, 5, 7 and 9. The King's peak is the
 * King's chapter (10).
 */
export const REGION_CHAPTER: readonly number[] = [CHAPTER_OF.raids, 3, 5, 7, 9];
export const ROOST_CHAPTER = CHAPTER_OF.king;

/** Each region's name on the map: the strongholds' own names, as the plan has them. */
export const REGION_NAMES: readonly string[] = CAMP_NAMES.map((name, region) => `${name}${region === 0 ? " woods" : region === 2 ? " hills" : ""}`);
export const FAR_NAME = "The Far Rookeries";

/** Each main stronghold's own name; the third of each region is its lord's keep. */
const STRONGHOLD_NAMES: readonly (readonly [string, string, string])[] = [
  ["Twig Gate", "Mossy Hollow", "Twig Nest Keep"],
  ["Thorn Patch", "Bramble Watch", "Bramble Keep"],
  ["Button Mound", "Tin Hill", "Tin Hoard Keep"],
  ["Crow's Ford", "Rag Tower", "Crow's Keep"],
  ["Black Elms", "Rook Steps", "Old Rookery Keep"]
];

export const regionOf = (n: number) => (n >= MAIN_STRONGHOLDS ? FAR : Math.floor(Math.max(0, n) / CAMPS_A_NAME));
/** A stronghold's name on the map: its own on the main path, numbered in the Far Rookeries. */
export const strongholdName = (n: number) => (n < MAIN_STRONGHOLDS ? STRONGHOLD_NAMES[regionOf(n)][n % CAMPS_A_NAME] : `Far Rookery ${n + 1}`);

export type LandsNode = {
  /** The stronghold's number on the ladder (0 is the first). */
  n: number;
  kind: "stronghold" | "keep" | "far";
  region: number;
  name: string;
  taken: boolean;
  /** Its best stars: 0 to 3; null for one taken before stars were kept (shown as taken, with no stars). */
  stars: number | null;
  /** The next stronghold: where Pip stands. */
  next: boolean;
  fogged: boolean;
  scouted: boolean;
  /** Its quirk, once scouted (step 3 says what each is); null until then. */
  quirk: string | null;
  /** A keep's lord (`CHAMPIONS`), and whether his pennant flies over it (the keep is taken). */
  lord: number | null;
  lordName: string | null;
  pennant: boolean;
};

export type LandsRegion = {
  index: number;
  name: string;
  /** Under fog, and the chapter that lifts it. */
  fogged: boolean;
  lifts: number;
  taken: number;
  stars: number;
};

export type LandsRoost = {
  /** The King can be raided today. */
  lit: boolean;
  /** Why not, when not (`kingClosed`). */
  closed: ReturnType<typeof kingClosed>;
  fogged: boolean;
  lifts: number;
  /** Every banner won, oldest first (`YYYY-MM`). */
  banners: string[];
};

/** One of the day's three camps on the road, walking near the frontier. */
export type RoadMarker = { slot: number; name: string; done: boolean };

export type LandsTotals = {
  taken: number;
  /** Stars kept for the strongholds taken, of three each. */
  stars: number;
  most: number;
  /** Taken before stars were kept. */
  unknown: number;
  threeStar: number;
  keeps: number;
  banners: number;
  far: number;
};

export type Lands = {
  regions: LandsRegion[];
  /** The fifteen of the main path, then the Far Rookeries' few shown (taken ones behind the next). */
  nodes: LandsNode[];
  /** Whether the path has gone on into the Far Rookeries, and how many of them have fallen. */
  far: { open: boolean; taken: number };
  roost: LandsRoost;
  /**
   * The day's camps on the road. Always none: the road's daily camps stopped
   * being played on 2026-10-15 (three new camps a day is a daily chore, which
   * the Hollow is not). The map's drawing of them is kept, so they could come
   * back as something that waits rather than something daily.
   */
  road: RoadMarker[];
  /** The friends' signpost: shown once the reader has said yes to friends' raids. */
  friends: boolean;
  /** The next stronghold's number. */
  next: number;
  totals: LandsTotals;
  /** "Stronghold 7 · 16★ of 21 · Next: Bramble Keep". */
  progress: string;
};

export type LandsOptions = {
  /** The reader said yes to friends' raids (the server's switch). */
  friends?: boolean;
  /** A stronghold's quirk by its number, from the battle's rules; asked only of one scouted. */
  quirkOf?: (n: number) => string | null;
};

const nodeOf = (state: BaseState, n: number, fogged: boolean, quirkOf?: (n: number) => string | null): LandsNode => {
  const taken = n < state.camps;
  const lord = n < MAIN_STRONGHOLDS ? lordOf(n) : null;
  const kept = starsOf(state.strongholds, n);
  const scouted = isScouted(state.strongholds, n);
  return {
    n,
    kind: n >= MAIN_STRONGHOLDS ? "far" : lord !== null ? "keep" : "stronghold",
    region: regionOf(n),
    name: strongholdName(n),
    taken,
    stars: taken ? (kept > 0 ? kept : null) : 0,
    next: n === state.camps,
    fogged: fogged && n !== state.camps,
    scouted,
    quirk: scouted ? (quirkOf?.(n) ?? null) : null,
    lord,
    lordName: lord === null ? null : (CHAMPIONS[lord] ?? null),
    pennant: lord !== null && taken
  };
};

/** The map as things stand. */
export const landsOf = (state: BaseState, now: Pick<Now, "minutes" | "day">, options: LandsOptions = {}): Lands => {
  const chapter = chapterNow(state, now.minutes);
  const next = state.camps;
  const nextRegion = regionOf(next);
  const regionFogged = (region: number) => !(chapter >= REGION_CHAPTER[region] || nextRegion >= region);
  const regions: LandsRegion[] = REGION_NAMES.map((name, index) => {
    const ns = Array.from({ length: CAMPS_A_NAME }, (_, k) => index * CAMPS_A_NAME + k);
    return {
      index,
      name,
      fogged: regionFogged(index),
      lifts: REGION_CHAPTER[index],
      taken: ns.filter((n) => n < state.camps).length,
      stars: ns.reduce((sum, n) => sum + (n < state.camps ? starsOf(state.strongholds, n) : 0), 0)
    };
  });
  const nodes = Array.from({ length: MAIN_STRONGHOLDS }, (_, n) => nodeOf(state, n, regionFogged(regionOf(n)), options.quirkOf));
  const farTaken = Math.max(0, state.camps - MAIN_STRONGHOLDS);
  if (next >= MAIN_STRONGHOLDS) {
    for (let n = Math.max(MAIN_STRONGHOLDS, next - FAR_SHOWN); n <= next; n++) nodes.push(nodeOf(state, n, false, options.quirkOf));
  }
  const kingOpen = opened(state, now.minutes, "king");
  const closed = kingClosed(state, now.day);
  const roost: LandsRoost = { lit: closed === null, closed, fogged: !kingOpen, lifts: ROOST_CHAPTER, banners: [...state.banners].sort() };
  const road: RoadMarker[] = [];
  const totals = totalsOf(state);
  return {
    regions,
    nodes,
    far: { open: next >= MAIN_STRONGHOLDS, taken: farTaken },
    roost,
    road,
    friends: options.friends === true,
    next,
    totals,
    progress: progressLine(totals, strongholdName(next))
  };
};

/** The figures behind the progress line. */
export const totalsOf = (state: BaseState): LandsTotals => {
  let stars = 0;
  let unknown = 0;
  let threeStar = 0;
  let keeps = 0;
  for (let n = 0; n < state.camps; n++) {
    const kept = starsOf(state.strongholds, n);
    stars += kept;
    if (kept === 0) unknown++;
    if (kept === 3) threeStar++;
    if (n < MAIN_STRONGHOLDS && lordOf(n) !== null) keeps++;
  }
  return { taken: state.camps, stars, most: state.camps * 3, unknown, threeStar, keeps, banners: state.banners.length, far: Math.max(0, state.camps - MAIN_STRONGHOLDS) };
};

/** One line for the top of the map. */
export const progressLine = (totals: LandsTotals, nextName: string) =>
  totals.taken > 0 ? `Stronghold ${totals.taken} · ${totals.stars}★ of ${totals.most} · Next: ${nextName}` : `Next: ${nextName}`;

/** A raid as the map starts it: the kind, and the slot `startRaid` takes (a replay's is its stronghold). */
export type LandsTarget = { kind: RaidKind; slot: number };

/** What a tap on a stronghold starts: the next one taken, or one already taken replayed for stars; nothing under fog. */
export const raidOf = (node: Pick<LandsNode, "n" | "taken" | "next" | "fogged">): LandsTarget | null =>
  node.next ? { kind: "camp", slot: 0 } : node.taken ? { kind: "rematch", slot: node.n } : null;
export const KING_TARGET: LandsTarget = { kind: "king", slot: 0 };
export const roadTarget = (slot: number): LandsTarget => ({ kind: "wild", slot });

/** A stronghold has been scouted (the scout view, step 3): its quirk is known from then on. */
export const markScouted = (state: BaseState, n: number): BaseState => {
  const strongholds = withScouted(state.strongholds, n);
  return strongholds === state.strongholds ? state : { ...state, strongholds };
};

/** The months of the banners won, for the summit: oldest first. */
export const bannerMonths = (state: Pick<BaseState, "banners">) => [...state.banners].sort();
/** Whether this month's banner is won. */
export const bannerWon = (state: Pick<BaseState, "banners">, day: string) => state.banners.includes(monthOf(day));
