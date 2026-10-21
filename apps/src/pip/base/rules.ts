/**
 * The Hollow: Pip's camp in the clearing, the arcade's building game.
 *
 * Its money is acorns, and they are its own: never seeds (those come only
 * from reading, and buy Pip's things), never anything a server
 * counts. The camp is built by reading, through acorns: the oak drops acorns
 * for every ten minutes read, and a chapter read sends a parcel up the path.
 * Acorns are the one thing a building costs, and it stands the moment it is
 * paid for.
 *
 * (Until 1.5.8 a building was paid for in acorns and then finished by so
 * many minutes of reading after it was begun, and a guardian trained the
 * same way: two things to count. Since then the minutes are part of the
 * price, at `ACORNS_A_MINUTE` (`workOf`), and whatever was still going up in
 * a camp kept from before is finished at once when the camp is next brought
 * up to now (`settle`), on whichever device that happens: a plain function of
 * the camp, so every device does the same, and nothing paid for is lost.)
 * Nothing here is finished by waiting, and nothing is lost by being away.
 *
 * The point of it is a camp to show: your reading, built into a place your
 * friends see on your card. One thing is always next (`nextStep`), Pip's
 * tips teach the rest (`tips.ts`), and what a level brings appears when it
 * comes. From the second level prowlers come out of the wood while the
 * camp is on screen (`scene.ts`): what throws, the fence, the constructs
 * and the guardians at their signposts see them off, and one who gets
 * through knocks a building about or makes off with a few acorns, a little
 * and at most so much a day.
 *
 * Simplified on 2026-10-15. The calendar night fought out of sight, the
 * hedgehog's daily offers, Pip's wish and the heroes' wants, her walks,
 * the dew, the paths at level 3, the road's daily camps, the arcade's
 * wagers and the quiz's tips are no longer played. Their fields are still
 * read and written back as they were, and most of their rules are still
 * here, unused, so that any of them could be brought back.
 *
 * Every rule is a plain function of the state and of what is handed in (the
 * minutes read in all, the day, whether the goal was met), so none of it
 * needs a clock or a place to keep things, and all of it is tested.
 */

import { DROP_STRONGHOLD, SIDES, autoBest, autoBestLane, layout, runAuto, type Result, type Setup, type Side, type Structure, type UnitKind } from "./battle";
import {
  ANIMALS,
  BLADES,
  BLADE_AT_BOND,
  FOES,
  FOX_MORE,
  GOAT_PIECES,
  GUARDIANS,
  GUARD_COSTS,
  GUARD_GIVES,
  GUARD_MINUTES,
  GUARD_MOST,
  HEDGE_CUTS,
  CALTROP_CUTS,
  NEST_THROWS,
  STONE_THROWS,
  TOTEM_DAUNTS,
  BELL_QUICKER,
  HORNET_STINGS,
  PIT_TAKES,
  TANGLE_SLOWS,
  HEN_LAYS,
  LAND_MOST,
  SCENERY,
  TORTOISE_MORE,
  WORKS,
  type Guardian
} from "./guards";
import { CHAMPIONS, HEROES, KING_CHAMPION, heroOpen, heroTraits } from "./heroes";
import {
  CHAPTER_OF,
  GOALS,
  LEGACY_FROM,
  NEW_WORKS,
  WELCOME_CHEST,
  burrowOfChapter,
  chapterOf,
  chapterOfBurrow,
  chapterBrings,
  chapterStartsAt,
  hoursWords,
  goalNow,
  opened,
  type Unlock
} from "./chapters";
import {
  BELL,
  COUNTER,
  ROLES,
  ROLE_DOES,
  ROLE_FROM,
  ROLE_NAMES,
  FRONT_MARK,
  FRONT_WORKS,
  GATE_TOUGHER,
  GOAT_TOUGHER,
  LINE_DEFAULT,
  TRAIL_Y,
  WORK_CHAPTER,
  bellSpot,
  clampLine,
  darkWood,
  freshFront,
  frontMark,
  isTower,
  isTrap,
  lineRange,
  mostOf,
  nightBounty,
  ownCount,
  padsOpen,
  readFrontMark,
  sectionsAt,
  seatOld,
  wallXAt,
  spotsOpen,
  towerPads,
  trapSpots,
  type Front,
  type Role
} from "./front";

export const BUILDINGS = ["burrow", "oak", "store", "fence", "tower", "hut"] as const;
export type BuildingId = (typeof BUILDINGS)[number];
export const MAX_LEVEL = 5;

/** The yard: two plots, and four things to put on them. Choosing two is the point. */
export const YARD_KINDS = ["workshop", "hive", "well", "stall"] as const;
export type YardKind = (typeof YARD_KINDS)[number];
export const YARD_MAX = 3;
export type Yard = { kind: YardKind | null; level: number };
export type Site = BuildingId | "yard0" | "yard1";
export const SITES: readonly Site[] = [...BUILDINGS, "yard0", "yard1"];

/** The three buildings that take one of two paths at level 3. */
export const FORKED = ["oak", "tower", "hut"] as const;
export type Forked = (typeof FORKED)[number];
export type ForkId = "a" | "b";

/** The arcade's games the camp plays. */
export type PayingGame = "dash" | "catch" | "flap";
export const PAYING_GAMES: readonly PayingGame[] = ["dash", "catch", "flap"];

export type Job = {
  site: Site;
  /** What is going up on an empty yard plot. */
  kind?: YardKind;
  /** The level it will be. */
  to: number;
  /** Minutes read in all when it was begun, and how many more finish it. */
  from: number;
  needs: number;
};

/**
 * The raids: a camp met on the road (new ones every day; not offered since 2026-10-15), the next stronghold on the
 * ladder, the month's King, and (1.5.10) a rematch of the last stronghold taken.
 */
export type RaidKind = "wild" | "camp" | "king" | "rematch";

/** Something set down in the clearing for its own sake: which thing, and where its foot is. */
export type Decor = { kind: number; x: number; y: number };

/** How the last night went, until it has been looked at. */
export type NightReport = {
  day: string;
  held: boolean;
  count: number;
  lit: boolean;
  side: Side;
  /** Who came: which of the kinds of raider. */
  foe: number;
  /** Pieces of fence knocked down, to be put up again; and the thing they carried off, if they got that far. */
  felled: number;
  stolen: number | null;
};

/** The buildings that stand somewhere (the fence does not: it is its pieces). */
export const PLACED = ["burrow", "oak", "store", "tower", "hut", "yard0", "yard1"] as const;
export type Placed = (typeof PLACED)[number];
/** A place in the clearing: the middle of a thing's foot. */
export type Spot = [number, number];

export type BaseEvent = { day: string; text: string };

export type BaseState = {
  v: 2;
  acorns: number;
  levels: Record<BuildingId, number>;
  yard: [Yard, Yard];
  forks: Partial<Record<Forked, ForkId>>;
  /** What is being built: one thing, or two with a workshop. */
  jobs: Job[];
  /** Minutes read in all when the oak was last gathered. */
  oakFrom: number;
  /** Magpie camps beaten: which camp is next. */
  camps: number;
  /** Minutes read in all at which the scouts were last rested: a raid for every quarter hour since. */
  raidFrom: number;
  /** The same for the arcade's paid runs: one for every ten minutes read. */
  purseFrom: number;
  /** The last day whose night has been through. */
  night: string | null;
  /** Tips about the magpies: each is two more scouts on one raid. */
  intel: number;
  /** The day lamp oil was bought for: that night the lantern is lit whatever was read. */
  oil: string | null;
  /** A sturdy pack: the next raid won brings half as much again. */
  pack: boolean;
  /** The day whose visitor has been dealt with. */
  visitor: string | null;
  /** The last day the word quiz gave a tip, and the last day the King was tried. */
  quizDay: string | null;
  kingDay: string | null;
  /** The camps on the road today that have been raided. */
  wild: { day: string; done: number[] };
  /** The day whose wish from Pip has been granted. */
  wishDay: string | null;
  /** What the reader has put about the clearing, where they put it. */
  decor: Decor[];
  /** Wagers placed today. */
  purse: { day: string; wagers: number };
  /** A wager waiting on the next finished run of its game. */
  wager: { game: PayingGame; stake: number; target: number } | null;
  /** The last few scores in each game: what "your usual" is made of. */
  scores: Record<PayingGame, number[]>;
  /** How far down Pip's list the camp is. */
  quest: number;
  /** `seenOff`: prowlers seen off while the camp was watched (1.5.10; absent before, read as none). */
  stats: { gathered: number; raids: number; stars: number; nights: number; wagers: number; seenOff?: number };
  /** Where each building stands. */
  spots: Record<Placed, Spot>;
  /** The pieces of fence put down, each where it is. */
  walls: Spot[];
  /** The piece of fence that is the gate, if one has been made of one (see `gateOf`). */
  gate: Spot | null;
  /** The book being read, and how far the camp has had word of it: the stretch last heard of, and the reading done by then (see `storyRead`). */
  story: { book: string; mark: number; from: number } | null;
  /** Parcels come up the path from the reading, waiting to be opened. */
  parcels: number;
  /** What prowlers have done on the day it is: knocks landed and thefts made (see `KNOCKS_A_DAY`). */
  prowled: { day: string; knocks: number; thefts: number };
  /** Pip's tips that have been seen to (see `tips.ts`), by their names. */
  taught: string[];
  /** The hero who goes on raids, if one has been chosen. */
  hero: number | null;
  /** Trophies raised, by kind: what brings the heroes. */
  shelf: number[];
  /** Finished books whose trophy stands in the camp (short keys, newest last). */
  raised: string[];
  /** The books finished before the camp was made have been given their trophies. */
  adopted: boolean;
  /** Minutes of reading that already stand behind a trophy (see `TROPHY_MINUTES`); below nothing until it has been reckoned for a camp kept before there was such a thing. */
  claimed: number;
  /** Months whose Magpie King fell. */
  banners: string[];
  /** Club bosses this camp has had its share of. */
  clubWins: string[];
  report: NightReport | null;
  /** What happened lately, newest first. */
  events: BaseEvent[];
  /** The day whose first acorns have been gathered: the first of a day come with a little more. */
  dewDay: string | null;
  /** How well each hero knows the camp, by the hero's number: 0 to `BOND_MOST`. */
  bonds: number[];
  /** Today's wants: the heroes whose want has been seen to, the ones who came home from a raid won, and the kinds of thing set down. */
  wants: { day: string; done: number[]; won: number[]; set: number[] };
  /** Pip, out for a walk: since which minute read, and for how many. */
  trip: { from: number; needs: number } | null;
  /** The tales she has brought back, by number. */
  tales: number[];
  /** Each guardian's rank, by the guardian's number: 0 not here, to `GUARD_MOST`. */
  guards: number[];
  /** A guardian in training: which, since which minute read, and for how many. */
  drill: { guard: number; from: number; needs: number } | null;
  /** The animals that have come to stay, by number. */
  animals: number[];
  /** What is set about the meadow, the camp's second clearing. */
  meadow: Decor[];
  /** The day the hen last laid. */
  eggDay: string | null;
  /** Landscape set about the camp, and about the meadow: ponds, a knoll, trees. */
  land: Decor[];
  meadowLand: Decor[];
  /** The defensive constructs set down: one of each kind at most. */
  works: Decor[];
  /** The blade each hero carries, by the hero's number; -1 for none. */
  arms: number[];
  /** Minutes read in all when the last night was through: raiders come only to a camp that has been read for since. */
  nightAt: number;
  /** How worn each of the camp's fighters is (a guardian's number, or a hero's plus a hundred): the knocks taken, when the last was, and until when they sleep it off. */
  tired: Partial<Record<number, { wounds: number; since: number; until: number }>>;
  /** Where each guardian's signpost stands, for those the reader has moved: a guardian keeps to the ground about theirs. */
  posts: Partial<Record<number, Spot>>;
  /** Knocks each building has taken from prowlers who got to it with nobody to stop them: fixed for acorns. */
  harm: Partial<Record<Placed, number>>;
  /** Friends' camps raided: on which day, and whose (their handles), so that each is raided once a day. */
  rivals: { day: string; raided: string[] };
  /** A friend's raid the camp is still mending after: whose, how many stars, and the reading that mends it. */
  wreck: { by: string; stars: number; from: number; needs: number } | null;
  /** A thing carried off on a lost night (when there were nights), and where it stood: brought home by the next raid won. */
  stolen: Decor | null;
  /** Pip's welcome basket and the guided first session (see `welcome.ts`). */
  welcome: CampWelcome;
  /**
   * Chapters (1.5.10, `chapters.ts`). The minutes read in all, the most the
   * camp has been told of (`settle` raises it, never lowers it): the chapter
   * is worked out from it, so the rules that are not handed the minutes know
   * the chapter too.
   */
  minutes: number;
  /** The burrow's level when the camp was brought onto chapters (null for a camp begun on them): what it had opened stays open. */
  legacy: { burrow: number } | null;
  /** The last chapter whose card was shown (0: the "now counted in chapters" card is still to show; -1: not yet brought onto chapters). */
  chapterSeen: number;
  /** The last chapter whose chest is in the larder. */
  chapterPaid: number;
  /** The chapter goals ticked off, by id: paid, or marked done unpaid when the camp was brought onto chapters. */
  goals: string[];
  /** Friends' raids on this camp not yet looked at, newest first (`NEWS_KEPT` at most). */
  news: RaidNews[];
  /** The pieces of fence friends' raids knocked down, where they stood: `putBack` lays them again. */
  downed: Spot[];
  /**
   * The front (1.5.11, `front.ts`): where the wall across the trail stands, the traps on their spots and the towers
   * on their pads, the shed, and the nights. `walls`, `gate` and `works` are kept from it (`fronted`), so that what
   * reads them (and an older build) sees the wall and the constructs where they are.
   */
  front: Front;
};

/** A friend's raid on this camp, for the card that tells of it: who, how it went, the fence it cost, and the day. */
export type RaidNews = {
  by: string;
  /** 0: the camp held, and `prize` acorns came of it. */
  stars: number;
  /** Pieces of fence knocked down. */
  down: number;
  prize: number;
  day: string;
};
export const NEWS_KEPT = 5;

/**
 * Pip's welcome to a new camp (1.5.5): the oak shaken, a basket by the
 * door, two helping paws, and one parcel after the first reading. Kept with
 * the camp, so it syncs with it: a second device or a reinstall with sync
 * gets the camp back with all of this already spent, and never a second
 * gift. None of it is reading: no minute, no trophy, nothing a server counts.
 */
export type CampWelcome = {
  /** The basket and the oak's shake were given (once a camp). */
  given: boolean;
  /** Helping paws left: each finishes a build at once (`welcome.ts` `pawFinish`). */
  paws: number;
  /** The basket by the door was opened. */
  basketOpened: boolean;
  /**
   * The one parcel the first reading after the welcome sends: "waiting" for
   * those minutes, "sent" up the path (one of `parcels`, the next opened),
   * "opened"; null where there is none to come (a camp from before 1.5.5, or
   * before the welcome).
   */
  firstReadParcel: "waiting" | "sent" | "opened" | null;
  /** The guided first session: how far it got, and how it ended. */
  tutorial: { step: number; done: boolean; skipped: boolean };
  /** Prowlers are held off until the reader has read after the welcome. */
  prowlersAfterRead: boolean;
  /** Acorns Pip shook onto the oak, still on it: gathered with the oak's own, and no reading behind them. */
  windfall: number;
  /** Minutes read in all when the welcome was given, or when its session ended: the parcel and the prowlers count from here. */
  from: number;
};

/** What the rules are told that they cannot know. */
export type Now = {
  /** Minutes read in focus, in all. */
  minutes: number;
  /** The reader's day, `YYYY-MM-DD`. */
  day: string;
  /** Whether the day before this one met its reading goal: the lantern, for the night just gone. */
  lit: boolean;
  /** The reading streak, in days; minutes read today; and whether today's goal is met. Absent, they are none. */
  streak?: number;
  today?: number;
  goalMet?: boolean;
  /** How Pip is, at home: her mood in the house, 0 to 100. Absent, she is as she is on any day. */
  mood?: number;
  /** The time by the wall clock, in milliseconds: for who is asleep. Absent, nobody is. */
  at?: number;
};

const EVENTS_KEPT = 8;
const SCORES_KEPT = 7;
const RAISED_KEPT = 400;
const WINS_KEPT = 24;
export const INTEL_MOST = 3;

// ---- the figures --------------------------------------------------------------

const BASE_COST: Record<BuildingId, number> = { burrow: 40, oak: 20, store: 25, fence: 15, tower: 30, hut: 30 };
/** What a level costs, as so many times the building's first. */
const COST_TIMES = [0, 1, 2.5, 5, 9, 15];
/** Minutes of reading that finish a level. */
const BUILD_MINUTES = [0, 5, 20, 40, 70, 100];

const YARD_COST = [0, 60, 150, 300];
const YARD_MINUTES = [0, 15, 35, 60];
/**
 * Acorns a minute of building work costs. A level of a building used to want
 * so many minutes of reading after it was paid for (`BUILD_MINUTES`); those
 * minutes are paid in acorns instead, at this rate, and it stands at once.
 * Half an acorn a minute, not the oak's own rate (8 to 40 every ten minutes):
 * the minutes used to run while the reader saved for the next thing, so
 * paying for them in full would have slowed the camp by a fifth. At a half
 * it is about a tenth more acorns over the whole camp, and no wait for a
 * builder between one thing and the next.
 */
export const ACORNS_A_MINUTE = 0.5;
/** A yard building of level n wants a burrow of n + 1. */
const yardBurrow = (to: number) => to + 1;
/**
 * Since 1.5.10 the camp's level is its chapter (`chapters.ts`): what opens
 * when is `CHAPTER_OF`, and every gate asks `opened`. The burrow's level
 * follows the chapter, so a plot of the yard still comes with a level of the
 * burrow, for a camp begun on chapters: the first at level 3 (chapter 5),
 * the second at level 5 (chapter 9). A camp from before keeps the plots its
 * level had opened then (`LEGACY_FROM`: level 2 and 3). Before its level
 * there is no plot, in the clearing or on any list.
 */
export const PLOT_FROM: Record<"yard0" | "yard1", number> = { yard0: 3, yard1: 5 };
/**
 * The burrow levels at which these came before chapters. Kept for the
 * screens that still say a level (`opened` is the rule, and says a chapter):
 * @deprecated ask `opened(state, minutes, thing)` and `CHAPTER_OF`.
 */
export const DECOR_FROM = 3;
export const PROWLERS_FROM = 2;
export const FENCE_FROM = 2;
export const POSTCARD_FROM = 2;

/**
 * How many of the camp's acorns the larder keeps from prowlers, by its
 * level. It used to hold only so many as well (60 to 1400); since 1.5.10 it
 * holds everything, and this is all a larder's level is: the camp's safe.
 */
const STORE_HIDES = [10, 40, 90, 160, 260, 400];
/**
 * The most acorns a camp kept by 1.5.9 could have, which it cuts a camp down
 * to when it reads one: what is saved never has more in `acorns` than this,
 * and the rest in `bank` (`keptForm`), so an older build that reads a camp
 * from this one cuts nothing.
 */
export const ACORNS_KEPT_MOST = 1400;
/** The most acorns a camp is read with, all told: far more than a lifetime of reading drops. */
const ACORNS_MOST = 1_000_000_000;

/**
 * Acorns the oak drops for every ten minutes read, and how full the tree is
 * drawn: at this many it looks laden. It used to hold no more than that, and
 * what the reading dropped past it was lost; since 1.5.10 it keeps everything
 * (`oakLooks`).
 */
const OAK_DROPS = [0, 8, 13, 20, 28, 40];
const OAK_HOLDS = [0, 50, 80, 130, 200, 300];
const OAK_EVERY = 10;

/**
 * By level: how much less a workshop makes everything cost to build, what the bees leave a day, what a well adds to the
 * oak, what a stall adds to a game's pay. (The workshop was a second builder and quicker building, while buildings
 * took reading to finish; since they stand at once, it makes them cheaper.)
 */
const WORKSHOP_OFF = [0, 0.05, 0.1, 0.15];
const HIVE_HONEY = [0, 6, 12, 20];
const WELL_MORE = [0, 0.15, 0.3, 0.45];
const STALL_MORE = [0, 0.25, 0.5, 0.75];

/** The burrow has to be this level before the magpies bother with the camp. */
const MAGPIES_FROM = 2;
/** The most of a camp's acorns one night can cost: this share, if the larder is pulled right down. */
const TAKEN_AT_MOST = 0.2;
/** How much further and harder a lookout throws with its lantern lit, and with the lamp path. */
const LIT_ADDS = 0.25;
const LIT_ADDS_LAMP = 0.5;
/** How much oftener a lookout with slings throws. */
const SLINGS_QUICKER = 0.7;
/** How long the magpies have before the camp wakes: a night, as a battle. */
export const NIGHT_SECONDS = 40;
const SHELF_KINDS = 11;

/** Where buildings may stand: on the grass, with room on every side for the magpies to come in. */
export const LAND = { left: 22, right: 218, top: 62, bottom: 110 };
/** Where fence may go: nearer the edges than a building may. */
export const WALL_LAND = { left: 10, right: 230, top: 54, bottom: 116 };
/** How far each building's foot reaches, in a fight: what a raider has to get to, and what throws from it. */
const REACH: Record<Placed, number> = { burrow: 13, oak: 9, store: 9, tower: 6, hut: 9, yard0: 9, yard1: 9 };
/**
 * The ground a building takes up when it is set down is less than that:
 * buildings are drawn at three quarters of their pictures' size, so that
 * there is room for more, and may stand as near one another as they look
 * as if they could.
 */
const FOOT = 0.64;
/** The ground a building takes up, as a ring about the middle of its foot: nothing else is built within it. */
export const footOf = (site: Placed) => REACH[site] * FOOT;
/**
 * Where each building is first set down: close about the burrow, in the little ground a new camp has. Since 1.5.11
 * the lookout stands by the gate, over the trail, and the oak and the hut keep clear of the ground just behind the
 * wall (where the towers' pads are); until then they stood at 76, 80 (the oak), 172, 106 (the lookout) and 80, 108.
 */
export const DEFAULT_SPOTS: Record<Placed, Spot> = {
  oak: [96, 64],
  burrow: [120, 86],
  store: [164, 82],
  tower: [88, 76],
  hut: [112, 110],
  yard0: [140, 108],
  yard1: [196, 108]
};
/**
 * The clearing grows with the camp. A new camp is a small one: the wood
 * stands close on either side, and there is room for what a new camp has.
 * Each level of the burrow, the trees are cleared further back, until at
 * the fifth the whole clearing is open. This is how much wood still
 * stands at each side, in the picture's pixels, by the camp's level:
 * nothing can be built, fenced or set down in it. So a level is seen, and
 * is room: more ground for more of everything.
 */
export const WOOD = [38, 38, 26, 14, 6, 0];
export const woodAt = (burrow: number) => WOOD[Math.max(0, Math.min(WOOD.length - 1, Math.round(burrow)))];
/** A stretch of the clearing, less the wood that still stands at each side of it for a camp of that level. */
/**
 * The wood still standing at each side of this camp's clearing. It follows the burrow, but its last widening (the
 * whole clearing, `WOOD[5]`) waits for chapter 10 (`opened(.., "clearing")`; a camp from before chapters at level 5
 * keeps it): until then a level-5 camp has a level-4 camp's ground, as the picture draws it. What already stands
 * beyond it is never moved or taken away.
 */
export const woodOf = (state: Pick<BaseState, "levels" | "legacy" | "camps" | "minutes">) =>
  woodAt(opened(state, undefined, "clearing") ? state.levels.burrow : Math.min(state.levels.burrow, MAX_LEVEL - 1));
/** The wood on the left of this camp's clearing: the Dark Wood never clears (`front.ts`). */
export const leftWoodOf = (state: Pick<BaseState, "levels" | "legacy" | "camps" | "minutes">) => darkWood(woodOf(state));
const cleared = <T extends { left: number; right: number }>(land: T, state: BaseState): T => ({ ...land, left: land.left + leftWoodOf(state), right: land.right - woodOf(state) });

/** Reading that rests the scouts for one raid, and how many raids' rest they can have in hand (3 until 1.5.10). */
export const RAID_EVERY = 15;
export const RAIDS_IN_HAND = 10;
/** Reading that earns one paid run at the arcade, and how many can be in hand (5 until 1.5.10). */
export const PURSE_EVERY = 10;
export const PURSE_IN_HAND = 10;
/** What a camp brought onto chapters is held to from before, so that it is not paid at once for reading the old rules let go. */
const OLD_RAIDS_IN_HAND = 3;
const OLD_PURSE_IN_HAND = 5;
/** The most a paid run pays; points of score to the acorn. */
export const PURSE_MOST = 8;
const POINTS_PER_ACORN: Record<PayingGame, number> = { dash: 15, catch: 5, flap: 1 };
/** What may be wagered, how often a day, and the least "your usual" is taken to be. */
export const STAKES = [5, 10, 20] as const;
export const WAGERS_A_DAY = 3;
const USUAL_LEAST: Record<PayingGame, number> = { dash: 20, catch: 6, flap: 2 };
const USUAL_FROM = 3;

/** Scouts a hut of no level would send, and how many more each level sends; and what a tip adds. */
const SCOUTS_FIRST = 5;
const SCOUTS_A_LEVEL = 2;
const TIP_SCOUTS = 2;
/** The hut level that trains each kind of scout. */
const TRAINED_AT: Record<Exclude<UnitKind, "hero">, number> = { sprout: 1, slinger: 2, bomber: 3, mole: 4 };
/** Puffcaps the hut sends on a raid (1.5.11): one from its third level, two at its fifth. */
export const bombersOf = (state: Pick<BaseState, "levels">) => (state.levels.hut >= 5 ? 2 : state.levels.hut >= TRAINED_AT.bomber ? 1 : 0);
/** Where a friend's scouts come in on this camp: the trail's end of the field, before the traps (1.5.11). */
const DROP_FRIEND = 20;
/** Sent without the reader, a raid brings this much of the loot (0.6 until 1.5.10). */
const SENT_BRINGS = 0.75;
/** A stronghold taken with all three stars brings this much more of its loot (it used to empty the next one instead). */
export const THREE_STAR_BONUS = 0.25;
/** A rematch of the last stronghold taken brings this share of what that stronghold was worth. */
const REMATCH_LOOT = 0.4;
/** The King is not shown until this many strongholds have fallen (it was 3; 10 since 2026-10-15, so a new camp has one ladder to climb). */
const KING_FROM_CAMPS = 10;

const TROPHY_GIFT = 15;
const FORK_AGAIN = 60;

/** What a reading streak adds to what the oak gives, by how many days it has run. */
const STREAK_ADDS: ReadonlyArray<[number, number]> = [
  [30, 0.5],
  [14, 0.3],
  [7, 0.2],
  [3, 0.1]
];

/** Things to set about the clearing: a name, a price, and how much charm each lends the camp. */
export const DECOR: ReadonlyArray<{ name: string; cost: number; charm: number }> = [
  { name: "Flower bed", cost: 15, charm: 2 },
  { name: "Lantern post", cost: 25, charm: 3 },
  { name: "Bench", cost: 30, charm: 3 },
  { name: "Pond", cost: 60, charm: 6 },
  { name: "Scarecrow", cost: 35, charm: 4 },
  { name: "Mushroom ring", cost: 20, charm: 2 },
  { name: "Bird bath", cost: 40, charm: 4 },
  { name: "Log pile", cost: 15, charm: 1 },
  { name: "Signpost", cost: 20, charm: 2 },
  { name: "Picnic blanket", cost: 30, charm: 3 },
  { name: "Campfire", cost: 45, charm: 4 },
  { name: "Hammock", cost: 50, charm: 5 },
  { name: "Birdhouse", cost: 35, charm: 3 },
  { name: "Wishing well", cost: 90, charm: 8 },
  { name: "Swing", cost: 70, charm: 6 },
  { name: "Book nook", cost: 80, charm: 7 },
  { name: "Flower arch", cost: 100, charm: 8 },
  { name: "Tiny windmill", cost: 120, charm: 10 }
];
export const DECOR_MOST = 24;
/** Where in the clearing a thing may be set down: on the grass, clear of the edges. */
export const DECOR_LAND = { left: 8, right: 232, top: 52, bottom: 116 };
/** Where landscape can go: further back than anything else, so a knoll can stand against the trees. */
export const LAND_LAND = { left: 6, right: 234, top: 46, bottom: 118 };

// ---- a new camp, and one read back ---------------------------------------------

const defaultSpots = (): Record<Placed, Spot> => Object.fromEntries(PLACED.map((site) => [site, [...DEFAULT_SPOTS[site]] as Spot])) as Record<Placed, Spot>;

const noYard = (): [Yard, Yard] => [
  { kind: null, level: 0 },
  { kind: null, level: 0 }
];

/**
 * A camp starts with its oak already standing. Without it a reader who spent
 * the first twenty acorns on anything else, and does not play the arcade, had
 * nothing coming in and no way to ever build again: reading always has to pay.
 */
export const newBase = (minutesRead: number, day: string): BaseState => ({
  v: 2,
  acorns: 20,
  levels: { burrow: 1, oak: 1, store: 0, fence: 0, tower: 0, hut: 0 },
  yard: noYard(),
  forks: {},
  jobs: [],
  oakFrom: Math.max(0, Math.floor(minutesRead)),
  camps: 0,
  // A new camp's scouts are rested for one raid, once there is a hut for them, and two runs are on the house.
  raidFrom: Math.max(0, Math.floor(minutesRead)) - RAID_EVERY,
  purseFrom: Math.max(0, Math.floor(minutesRead)) - PURSE_EVERY * 2,
  night: day,
  intel: 0,
  oil: null,
  pack: false,
  visitor: null,
  quizDay: null,
  kingDay: null,
  wild: { day, done: [] },
  wishDay: null,
  decor: [],
  purse: { day, wagers: 0 },
  wager: null,
  scores: { dash: [], catch: [], flap: [] },
  quest: 0,
  stats: { gathered: 0, raids: 0, stars: 0, nights: 0, wagers: 0, seenOff: 0 },
  spots: defaultSpots(),
  walls: [],
  gate: null,
  story: null,
  parcels: 0,
  prowled: { day: "", knocks: 0, thefts: 0 },
  // A new camp begins on the list as it is now (see `LIST_MARK`).
  taught: [LIST_MARK],
  hero: null,
  shelf: Array.from({ length: SHELF_KINDS }, () => 0),
  raised: [],
  adopted: false,
  claimed: 0,
  banners: [],
  clubWins: [],
  report: null,
  events: [],
  dewDay: null,
  bonds: Array.from({ length: HEROES.length }, () => 0),
  wants: { day, done: [], won: [], set: [] },
  trip: null,
  tales: [],
  guards: Array.from({ length: GUARDIANS.length }, () => 0),
  drill: null,
  animals: [],
  meadow: [],
  eggDay: null,
  land: [],
  meadowLand: [],
  works: [],
  arms: Array.from({ length: HEROES.length }, () => -1),
  nightAt: Math.max(0, Math.floor(minutesRead)),
  tired: {},
  posts: {},
  harm: {},
  rivals: { day: "", raided: [] },
  wreck: null,
  stolen: null,
  welcome: freshWelcome(minutesRead),
  // Begun on chapters: at the first, whatever has been read; the chests of any chapters the reading has already
  // reached come with the first `settle`.
  minutes: Math.max(0, Math.floor(minutesRead)),
  legacy: null,
  chapterSeen: 1,
  chapterPaid: 1,
  goals: [],
  news: [],
  downed: [],
  front: freshFront(minutesRead)
});

/** The welcome as a new camp has it: nothing given yet (`welcome.ts` `giveWelcome`). */
export const freshWelcome = (minutesRead: number): CampWelcome => ({
  given: false,
  paws: 0,
  basketOpened: false,
  firstReadParcel: null,
  tutorial: { step: 0, done: false, skipped: false },
  prowlersAfterRead: false,
  windfall: 0,
  from: Math.max(0, Math.floor(minutesRead))
});

/** A camp from before the welcome: welcomed already, with nothing to give and no session to sit through. */
export const WELCOMED: CampWelcome = {
  given: true,
  paws: 0,
  basketOpened: true,
  firstReadParcel: null,
  tutorial: { step: 0, done: true, skipped: false },
  prowlersAfterRead: false,
  windfall: 0,
  from: 0
};

/** What the welcome gives: acorns shaken onto the oak, the basket, the paws; and the first reading's parcel, after so many minutes. */
export const WELCOME_WINDFALL = 20;
export const WELCOME_BASKET = 80;
/** Helping paws the welcome gives: none since 1.5.10 (buildings stand at once since 1.5.8, so they had nothing to do). */
export const WELCOME_PAWS = 0;
/** The most a camp kept from before is read with (it was given two). */
const PAWS_KEPT = 2;
export const FIRST_READ_PARCEL = 40;
export const FIRST_READ_MINUTES = 5;
const TUTORIAL_STEPS_MOST = 20;

/** The welcome as kept: anything missing is a camp from before it (`WELCOMED`); what is there is held to what it can be. */
const readWelcome = (raw: unknown): CampWelcome => {
  if (typeof raw !== "object" || raw === null) return { ...WELCOMED, tutorial: { ...WELCOMED.tutorial } };
  const kept = record(raw);
  const tutorial = record(kept.tutorial);
  const parcel = kept.firstReadParcel;
  return {
    given: kept.given === true,
    paws: wholeOr(kept.paws, 0, PAWS_KEPT, 0),
    basketOpened: kept.basketOpened === true,
    firstReadParcel: parcel === "waiting" || parcel === "sent" || parcel === "opened" ? parcel : null,
    tutorial: { step: wholeOr(tutorial.step, 0, TUTORIAL_STEPS_MOST, 0), done: tutorial.done === true, skipped: tutorial.skipped === true },
    prowlersAfterRead: kept.prowlersAfterRead === true,
    windfall: wholeOr(kept.windfall, 0, WELCOME_WINDFALL, 0),
    from: wholeOr(kept.from, 0, Number.MAX_SAFE_INTEGER, 0)
  };
};

const whole = (value: unknown, least: number, most: number): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(most, Math.max(least, Math.floor(value))) : null;
const wholeOr = (value: unknown, least: number, most: number, otherwise: number) => whole(value, least, most) ?? otherwise;
const text = (value: unknown): string | null => (typeof value === "string" && value.length <= 80 ? value : null);
const texts = (value: unknown, most: number): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 80).slice(-most) : [];
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

const readJob = (raw: unknown, levels: Record<BuildingId, number>, yard: [Yard, Yard]): Job | null => {
  const kept = record(raw);
  const site = SITES.find((entry) => entry === kept.site);
  const from = whole(kept.from, 0, Number.MAX_SAFE_INTEGER);
  if (!site || from === null) return null;
  const needs = whole(kept.needs, 0, 600);
  if (site === "yard0" || site === "yard1") {
    const slot = yard[site === "yard0" ? 0 : 1];
    const kind = slot.kind ?? YARD_KINDS.find((entry) => entry === kept.kind) ?? null;
    if (!kind || slot.level >= YARD_MAX || kept.to !== slot.level + 1) return null;
    return { site, kind, to: slot.level + 1, from, needs: needs ?? YARD_MINUTES[slot.level + 1] };
  }
  // Only the next level of a real building is a job; anything else is dropped.
  if (levels[site] >= MAX_LEVEL || kept.to !== levels[site] + 1) return null;
  return { site, to: levels[site] + 1, from, needs: needs ?? BUILD_MINUTES[levels[site] + 1] };
};

/**
 * A kept camp, checked: null for anything that is not one, so a damaged or
 * hand-edited record starts a new camp instead of breaking the game. A camp
 * of the first version is carried over as it stands.
 */
export const readBase = (raw: unknown): BaseState | null => {
  const from = record(raw);
  if ((from.v !== 1 && from.v !== 2) || typeof from.levels !== "object" || from.levels === null) return null;
  const levels = {} as Record<BuildingId, number>;
  for (const building of BUILDINGS) {
    const level = whole(record(from.levels)[building], 0, MAX_LEVEL);
    if (level === null) return null;
    levels[building] = level;
  }
  levels.burrow = Math.max(1, levels.burrow);
  // What 1.5.10 keeps beside the acorns where an older build keeps whatever it does not know (`keptForm`).
  const allTaught = texts(from.taught, 60);
  const mark = readKeptMark(allTaught);
  const kept = whole(from.acorns, 0, ACORNS_MOST);
  const oakFrom = whole(from.oakFrom, 0, Number.MAX_SAFE_INTEGER);
  const camps = whole(from.camps, 0, 100_000);
  if (kept === null || oakFrom === null || camps === null) return null;
  // Acorns past what a 1.5.9 build could keep are in the bank: the camp has them all.
  const acorns = Math.min(ACORNS_MOST, kept + (whole(from.bank, 0, ACORNS_MOST) ?? mark?.bank ?? 0));

  const yard = noYard();
  (Array.isArray(from.yard) ? from.yard : []).slice(0, 2).forEach((entry, index) => {
    const slot = record(entry);
    const kind = YARD_KINDS.find((name) => name === slot.kind) ?? null;
    // One of each kind at most.
    if (kind && !(index === 1 && yard[0].kind === kind)) yard[index] = { kind, level: wholeOr(slot.level, 0, YARD_MAX, 0) };
  });
  const forks: Partial<Record<Forked, ForkId>> = {};
  for (const building of FORKED) {
    const chosen = record(from.forks)[building];
    if ((chosen === "a" || chosen === "b") && levels[building] >= 3) forks[building] = chosen;
  }
  // The first version had one job, under another name.
  const rawJobs = Array.isArray(from.jobs) ? from.jobs : from.job ? [{ ...record(from.job), site: record(from.job).building }] : [];
  const jobs: Job[] = [];
  for (const entry of rawJobs.slice(0, 2)) {
    const job = readJob(entry, levels, yard);
    if (job && !jobs.some((other) => other.site === job.site)) jobs.push(job);
  }
  // A yard plot with nothing on it and nothing going up has no kind.
  yard.forEach((slot, index) => {
    if (slot.level === 0 && !jobs.some((job) => job.site === `yard${index}`)) yard[index] = { kind: null, level: 0 };
  });

  const purse = record(from.purse);
  const keptWager = record(from.wager);
  const wagerGame = PAYING_GAMES.find((game) => game === keptWager.game);
  const scores = { dash: [], catch: [], flap: [] } as Record<PayingGame, number[]>;
  for (const game of PAYING_GAMES) {
    const kept = record(from.scores)[game];
    scores[game] = (Array.isArray(kept) ? kept : [])
      .map((entry) => whole(entry, 0, 1_000_000))
      .filter((entry): entry is number => entry !== null)
      .slice(-SCORES_KEPT);
  }
  const stats = record(from.stats);
  const report = record(from.report);
  const events: BaseEvent[] = (Array.isArray(from.events) ? from.events : [])
    .map((entry) => record(entry))
    .filter((entry) => typeof entry.day === "string" && typeof entry.text === "string" && (entry.text as string).length <= 160)
    .map((entry) => ({ day: entry.day as string, text: entry.text as string }))
    .slice(0, EVENTS_KEPT);

  const animals = [...new Set((Array.isArray(from.animals) ? from.animals : []).map((animal) => whole(animal, 0, ANIMALS.length - 1)).filter((animal): animal is number => animal !== null))];
  const read: BaseState = {
    v: 2,
    acorns,
    levels,
    yard,
    forks,
    jobs,
    oakFrom,
    camps,
    // A camp kept before raids were rested by reading starts with one raid's rest from where its oak stands.
    raidFrom: wholeOr(from.raidFrom, -RAID_EVERY * RAIDS_IN_HAND, Number.MAX_SAFE_INTEGER, oakFrom - RAID_EVERY),
    purseFrom: wholeOr(from.purseFrom, -PURSE_EVERY * PURSE_IN_HAND, Number.MAX_SAFE_INTEGER, oakFrom - PURSE_EVERY * 2),
    night: text(from.night),
    intel: wholeOr(from.intel, 0, INTEL_MOST, 0),
    oil: text(from.oil),
    pack: from.pack === true,
    visitor: text(from.visitor),
    quizDay: text(from.quizDay),
    kingDay: text(from.kingDay),
    wild: {
      day: text(record(from.wild).day) ?? "",
      done: (Array.isArray(record(from.wild).done) ? (record(from.wild).done as unknown[]) : []).filter((slot): slot is number => slot === 0 || slot === 1 || slot === 2)
    },
    wishDay: text(from.wishDay),
    decor: readDecor(from.decor),
    purse: { day: text(purse.day) ?? "", wagers: wholeOr(purse.wagers, 0, 100, 0) },
    wager: wagerGame ? { game: wagerGame, stake: wholeOr(keptWager.stake, 1, 20, 5), target: wholeOr(keptWager.target, 1, 1_000_000, 1) } : null,
    scores,
    // Kept as it was, past the end of the list too: a camp from before the list was rewritten points into the old one (see `LIST_MARK`).
    quest: wholeOr(from.quest, 0, 100, 0),
    stats: {
      gathered: wholeOr(stats.gathered, 0, 1e9, 0),
      raids: wholeOr(stats.raids, 0, 1e9, 0),
      stars: wholeOr(stats.stars, 0, 1e9, 0),
      nights: wholeOr(stats.nights, 0, 1e9, 0),
      wagers: wholeOr(stats.wagers, 0, 1e9, 0),
      seenOff: wholeOr(stats.seenOff, 0, 1e9, 0)
    },
    spots: readSpots(from.spots),
    // (Made again from the fence's level by `readFront`: what pieces were laid where no longer matters.)
    walls: readWalls(from.walls, 40),
    gate: spotOf(from.gate, WALL_LAND),
    story: (() => {
      const story = record(from.story);
      const book = text(story.book);
      const mark = whole(story.mark, 0, 100_000);
      const since = whole(story.from, 0, 100_000_000);
      return book && mark !== null && since !== null ? { book, mark, from: since } : null;
    })(),
    parcels: wholeOr(from.parcels, 0, PARCELS_MOST, 0),
    taught: allTaught.filter((entry) => !entry.startsWith(KEPT_MARK) && !entry.startsWith(FRONT_MARK)),
    prowled: (() => {
      const had = record(from.prowled);
      return { day: text(had.day) ?? "", knocks: wholeOr(had.knocks, 0, 1000, 0), thefts: wholeOr(had.thefts, 0, 1000, 0) };
    })(),
    hero: whole(from.hero, 0, HEROES.length - 1),
    shelf: Array.from({ length: SHELF_KINDS }, (_, kind) => wholeOr((Array.isArray(from.shelf) ? from.shelf : [])[kind], 0, 100_000, 0)),
    raised: texts(from.raised, RAISED_KEPT),
    // A camp of the first version had no trophies: the books already finished are still to be given theirs.
    adopted: from.adopted === true,
    claimed: wholeOr(from.claimed, -1, 100_000_000, -1),
    banners: texts(from.banners, 1200),
    clubWins: texts(from.clubWins, WINS_KEPT),
    report:
      typeof report.day === "string" && typeof report.held === "boolean"
        ? {
            day: report.day,
            held: report.held,
            count: wholeOr(report.count, 0, 10_000, 0),
            lit: report.lit === true,
            side: SIDES.find((side) => side === report.side) ?? "left",
            foe: wholeOr(report.foe, 0, FOES.length - 1, 0),
            felled: wholeOr(report.felled, 0, 100, 0),
            stolen: whole(report.stolen, 0, DECOR.length - 1)
          }
        : null,
    events,
    // A camp kept before these were thought of has none of them, and reads as a camp that never used them.
    dewDay: text(from.dewDay),
    bonds: Array.from({ length: HEROES.length }, (_, hero) => wholeOr((Array.isArray(from.bonds) ? from.bonds : [])[hero], 0, BOND_MOST, 0)),
    wants: {
      day: text(record(from.wants).day) ?? "",
      done: heroList(record(from.wants).done),
      won: heroList(record(from.wants).won),
      set: [...new Set((Array.isArray(record(from.wants).set) ? (record(from.wants).set as unknown[]) : []).map((kind) => whole(kind, 0, DECOR.length - 1)).filter((kind): kind is number => kind !== null))]
    },
    trip: whole(record(from.trip).from, 0, 1e9) !== null && TRIPS.some((needs) => needs === record(from.trip).needs) ? { from: whole(record(from.trip).from, 0, 1e9)!, needs: record(from.trip).needs as number } : null,
    tales: [...new Set((Array.isArray(from.tales) ? from.tales : []).map((tale) => whole(tale, 0, TALES.length - 1)).filter((tale): tale is number => tale !== null))],
    guards: Array.from({ length: GUARDIANS.length }, (_, guard) => wholeOr((Array.isArray(from.guards) ? from.guards : [])[guard], 0, GUARD_MOST, 0)),
    drill:
      whole(record(from.drill).guard, 0, GUARDIANS.length - 1) !== null && whole(record(from.drill).from, 0, 1e9) !== null && whole(record(from.drill).needs, 1, 600) !== null
        ? { guard: whole(record(from.drill).guard, 0, GUARDIANS.length - 1)!, from: whole(record(from.drill).from, 0, 1e9)!, needs: whole(record(from.drill).needs, 1, 600)! }
        : null,
    animals,
    meadow: readDecor(from.meadow),
    eggDay: text(from.eggDay),
    land: readThings(from.land, SCENERY.length, LAND_MOST, LAND_LAND),
    meadowLand: readThings(from.meadowLand, SCENERY.length, LAND_MOST, LAND_LAND),
    // One of each construct: a second of a kind is not kept.
    works: readThings(from.works, WORKS.length, WORKS.length * 2, DECOR_LAND).filter((entry, index, all) => all.findIndex((other) => other.kind === entry.kind) === index),
    arms: readArms(from.arms),
    // A camp kept before this was counted: its next night is like any other since.
    nightAt: wholeOr(from.nightAt, 0, 1e9, 0),
    tired: Object.fromEntries(
      Object.entries(record(from.tired))
        .map(([who, kept]) => [Number(who), record(kept)] as const)
        .filter(([who, kept]) => Number.isInteger(who) && who >= 0 && who < 200 && whole(kept.wounds, 1, WOUNDS_MOST) !== null && typeof kept.since === "number" && typeof kept.until === "number")
        .map(([who, kept]) => [who, { wounds: whole(kept.wounds, 1, WOUNDS_MOST)!, since: Math.max(0, kept.since as number), until: Math.max(0, kept.until as number) }])
    ) as BaseState["tired"],
    posts: Object.fromEntries(
      GUARDIANS.map((_, guard) => [guard, spotOf(record(from.posts)[guard], DECOR_LAND)] as const).filter((entry) => entry[1] !== null)
    ) as Partial<Record<number, Spot>>,
    harm: Object.fromEntries(PLACED.map((site) => [site, whole(record(from.harm)[site], 1, HARM_MOST)] as const).filter((entry) => entry[1] !== null)) as Partial<Record<Placed, number>>,
    rivals: {
      day: typeof record(from.rivals).day === "string" ? (record(from.rivals).day as string).slice(0, 10) : "",
      raided: Array.isArray(record(from.rivals).raided)
        ? (record(from.rivals).raided as unknown[]).filter((handle): handle is string => typeof handle === "string" && handle.length > 0 && handle.length <= 64).slice(0, 60)
        : []
    },
    wreck:
      typeof record(from.wreck).by === "string" && whole(record(from.wreck).stars, 1, 3) !== null && whole(record(from.wreck).from, 0, 1e9) !== null && whole(record(from.wreck).needs, 1, MEND_MOST) !== null
        ? { by: (record(from.wreck).by as string).slice(0, 40), stars: whole(record(from.wreck).stars, 1, 3)!, from: whole(record(from.wreck).from, 0, 1e9)!, needs: whole(record(from.wreck).needs, 1, MEND_MOST)! }
        : null,
    stolen: readDecor([from.stolen])[0] ?? null,
    welcome: readWelcome(from.welcome),
    ...readChapters(from, levels.burrow, oakFrom, mark),
    front: freshFront(0)
  };
  return readFront(read, from.front, allTaught, from.works);
};

/**
 * What 1.5.10 keeps that an older build would drop when it saves the camp:
 * the bank, the burrow the camp was brought onto chapters with, the chapter
 * last shown and paid, and the goals ticked. Kept as one entry of `taught`
 * too (`KEPT_MARK`), since every build keeps the names there it does not
 * know: so a camp saved by 1.5.9 and read here again has lost none of it
 * (and its goals and chests are not paid twice). The fields win where both
 * are there.
 */
const KEPT_MARK = "kept:";
type KeptMark = { bank: number; legacy: number; seen: number; paid: number; goals: number };
const readKeptMark = (taught: readonly string[]): KeptMark | null => {
  const entry = taught.find((name) => name.startsWith(KEPT_MARK));
  if (!entry) return null;
  try {
    const raw = record(JSON.parse(entry.slice(KEPT_MARK.length)));
    return { bank: wholeOr(raw.b, 0, ACORNS_MOST, 0), legacy: wholeOr(raw.l, 0, MAX_LEVEL, 0), seen: wholeOr(raw.s, -1, 100_000, -1), paid: wholeOr(raw.p, 0, 100_000, 0), goals: wholeOr(raw.g, 0, 2 ** 30, 0) };
  } catch {
    return null;
  }
};
const goalBits = (goals: readonly string[]) => GOALS.reduce((bits, goal, index) => (goals.includes(goal.id) && index < 30 ? bits + 2 ** index : bits), 0);
const goalsOfBits = (bits: number) => GOALS.filter((_, index) => index < 30 && Math.floor(bits / 2 ** index) % 2 === 1).map((goal) => goal.id);

/**
 * The chapters' part of a kept camp. One with no word of chapters at all is
 * from before them: its burrow is what stays open (`legacy`), and it is
 * brought onto them at the next `settle` (`chapterSeen` -1).
 */
const readChapters = (from: Record<string, unknown>, burrow: number, oakFrom: number, mark: KeptMark | null): Pick<BaseState, "minutes" | "legacy" | "chapterSeen" | "chapterPaid" | "goals" | "news" | "downed"> => {
  const before = from.legacy === undefined && mark === null;
  const legacyBurrow = whole(record(from.legacy).burrow, 1, MAX_LEVEL);
  const legacy = from.legacy === null ? null : legacyBurrow !== null ? { burrow: legacyBurrow } : mark ? (mark.legacy > 0 ? { burrow: mark.legacy } : null) : { burrow };
  const goals = Array.isArray(from.goals) ? texts(from.goals, 100).filter((id) => GOALS.some((goal) => goal.id === id)) : mark ? goalsOfBits(mark.goals) : [];
  return {
    minutes: wholeOr(from.minutes, 0, 1e9, oakFrom),
    legacy,
    chapterSeen: before ? -1 : wholeOr(from.chapterSeen, -1, 100_000, mark?.seen ?? 1),
    chapterPaid: before ? 0 : wholeOr(from.chapterPaid, 0, 100_000, mark?.paid ?? 1),
    goals: [...new Set(goals)],
    news: (Array.isArray(from.news) ? from.news : [])
      .map((entry) => record(entry))
      .filter((entry) => typeof entry.by === "string" && typeof entry.day === "string")
      .map((entry) => ({
        by: (entry.by as string).slice(0, 40),
        stars: wholeOr(entry.stars, 0, 3, 0),
        down: wholeOr(entry.down, 0, 100, 0),
        prize: wholeOr(entry.prize, 0, 1000, 0),
        day: (entry.day as string).slice(0, 10)
      }))
      .slice(0, NEWS_KEPT),
    downed: readWalls(from.downed, 60)
  };
};

/**
 * The camp as it is saved: everything as it is, but no more than
 * `ACORNS_KEPT_MOST` in `acorns` and the rest in `bank`, with the same
 * written into `taught` as well (`KEPT_MARK`). A 1.5.9 build reads it and
 * cuts nothing; `readBase` puts it back together.
 */
export const keptForm = (state: BaseState): BaseState & { bank: number } => {
  const acorns = Math.max(0, Math.floor(state.acorns));
  const bank = Math.max(0, acorns - ACORNS_KEPT_MOST);
  const mark = `${KEPT_MARK}${JSON.stringify({ b: bank, l: state.legacy?.burrow ?? 0, s: state.chapterSeen, p: state.chapterPaid, g: goalBits(state.goals) })}`;
  return { ...state, acorns: acorns - bank, bank, taught: [...state.taught.filter((entry) => !entry.startsWith(KEPT_MARK) && !entry.startsWith(FRONT_MARK)), mark, frontMark(state.front)] };
};

/** Things set down, of so many kinds, so many at most, inside a part of the clearing. */
const readThings = (raw: unknown, kinds: number, most: number, land: typeof LAND_LAND): Decor[] =>
  (Array.isArray(raw) ? raw : [])
    .map((entry) => record(entry))
    .map((entry) => ({ kind: whole(entry.kind, 0, kinds - 1), x: whole(entry.x, land.left, land.right), y: whole(entry.y, land.top, land.bottom) }))
    .filter((entry): entry is Decor => entry.kind !== null && entry.x !== null && entry.y !== null)
    .slice(0, most);

/** Who carries which blade, as kept: a blade there is, and in one hand only. */
const readArms = (raw: unknown): number[] => {
  const held = new Set<number>();
  return Array.from({ length: HEROES.length }, (_, hero) => {
    const blade = whole((Array.isArray(raw) ? raw : [])[hero], -1, BLADES.length - 1) ?? -1;
    if (blade < 0 || held.has(blade)) return -1;
    held.add(blade);
    return blade;
  });
};

/** Things set down, as kept: each of a kind there is, inside the clearing, and no more than a clearing takes. */
const readDecor = (raw: unknown): Decor[] =>
  (Array.isArray(raw) ? raw : [])
    .map((entry) => record(entry))
    .map((entry) => ({ kind: whole(entry.kind, 0, DECOR.length - 1), x: whole(entry.x, DECOR_LAND.left, DECOR_LAND.right), y: whole(entry.y, DECOR_LAND.top, DECOR_LAND.bottom) }))
    .filter((entry): entry is Decor => entry.kind !== null && entry.x !== null && entry.y !== null)
    .slice(0, DECOR_MOST);

/** A kept list of heroes: each a hero's number, each once. */
const heroList = (raw: unknown): number[] => [...new Set((Array.isArray(raw) ? raw : []).map((hero) => whole(hero, 0, HEROES.length - 1)).filter((hero): hero is number => hero !== null))];

const spotOf = (raw: unknown, land: typeof LAND): Spot | null => {
  if (!Array.isArray(raw)) return null;
  const x = whole(raw[0], land.left, land.right);
  const y = whole(raw[1], land.top, land.bottom);
  return x === null || y === null ? null : [x, y];
};
/** Where the buildings stand, as kept: any that is missing, or would stand on another, goes back where it began. */
const readSpots = (raw: unknown): Record<Placed, Spot> => {
  const spots = defaultSpots();
  const kept = record(raw);
  for (const site of PLACED) {
    const spot = spotOf(kept[site], LAND);
    if (spot && PLACED.every((other) => other === site || Math.hypot(spot[0] - spots[other][0], spot[1] - spots[other][1]) >= (REACH[site] + REACH[other]) * FOOT)) spots[site] = spot;
  }
  return spots;
};
const readWalls = (raw: unknown, most: number): Spot[] => {
  const walls: Spot[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const spot = spotOf(entry, WALL_LAND);
    if (spot && walls.length < most && !walls.some((other) => other[0] === spot[0] && other[1] === spot[1])) walls.push(spot);
  }
  return walls;
};

const noted = (state: BaseState, day: string, line: string): BaseEvent[] => [{ day, text: line }, ...state.events].slice(0, EVENTS_KEPT);

// ---- what the camp comes to -----------------------------------------------------

/** The level of a yard building, 0 when the camp has none. */
export const yardLevel = (state: BaseState, kind: YardKind) => {
  const plot = state.yard.findIndex((slot) => slot.kind === kind);
  // A yard building the prowlers have broken does nothing for the camp until it is put right.
  return plot < 0 || (state.harm[plot === 0 ? "yard0" : "yard1"] ?? 0) >= 4 ? 0 : state.yard[plot].level;
};
const yardIndex = (site: Site): number => (site === "yard0" ? 0 : site === "yard1" ? 1 : -1);

/**
 * Acorns the camp can hold: all of them, since 1.5.10 (the larder used to
 * hold 60 to 1400, and what did not fit waited). Kept for the screens that
 * asked; nothing in the rules waits for room any more.
 * @deprecated nothing caps the acorns: there is no figure to show.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const holds = (_state: BaseState) => Number.POSITIVE_INFINITY;
/** Acorns the larder keeps from prowlers: what a prowler at the larder cannot take. The tortoise makes it a tenth more. */
export const hides = (state: BaseState) =>
  isBroken(state, "store")
    ? 0
    : Math.round(STORE_HIDES[state.levels.store] * GUARD_GIVES.yard[guardOf(state, 5)] * (hasAnimal(state, 5) ? TORTOISE_MORE : 1) * (1 - harmOf(state, "store") * WEAR_A_KNOCK));
/** What the larder hides at a level (for its card). */
export const hidesAt = (level: number) => STORE_HIDES[Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)))];
/** Acorns in: all of them (since 1.5.10 there is always room). */
const give = (_state: BaseState, acorns: number) => Math.max(0, Math.round(acorns));

/** Scouts the hut sends on a raid, and the kinds it has trained. */
export const scoutsOf = (state: BaseState) => (state.levels.hut === 0 ? 0 : SCOUTS_FIRST + state.levels.hut * SCOUTS_A_LEVEL);
export const trained = (state: BaseState): UnitKind[] => (Object.keys(TRAINED_AT) as Array<keyof typeof TRAINED_AT>).filter((kind) => state.levels.hut >= TRAINED_AT[kind]);
/** How many things can go up at once. */
export const builders = (state: BaseState) => (yardLevel(state, "workshop") > 0 ? 2 : 1);

/** Acorns the oak drops for every ten minutes read, and how many it holds. */
export const oakDrops = (state: BaseState) =>
  OAK_DROPS[state.levels.oak] * (1 + (state.forks.oak === "b" ? 0.25 : 0) + WELL_MORE[yardLevel(state, "well")]) * ((state.harm.oak ?? 0) >= 4 ? BROKEN_OAK : 1 - (state.harm.oak ?? 0) * WEAR_A_KNOCK);
/**
 * What a knock costs, left unmended, short of broken. It was a tenth of what
 * the building does for each knock; nobody could see it happen, so since
 * 2026-10-15 (the simplifying) it is nothing: a knocked building looks
 * knocked, and only broken (four knocks, `BROKEN_DOES`) stops it working.
 * Set this back to 0.1 to bring the wear back.
 */
export const WEAR_A_KNOCK = 0;
/** The share of its acorns a broken oak still drops: half. Never none, so that a camp with nothing can still get the acorns to mend it. */
export const BROKEN_OAK = 0.5;
/** How many acorns on the oak make it look laden (it keeps more than that: everything, since 1.5.10). */
export const oakHolds = (state: BaseState) => Math.round(OAK_HOLDS[state.levels.oak] * (state.forks.oak === "a" ? 1.5 : 1));
/** How full the oak looks, 0 to 1: for drawing it, and nothing else. */
export const oakLooks = (state: BaseState, minutesRead: number) => (oakHolds(state) <= 0 ? 0 : Math.min(1, oakReady(state, minutesRead) / oakHolds(state)));

// ---- words for the buildings --------------------------------------------------------

export const BUILDING_NAMES: Record<BuildingId, string> = {
  burrow: "Burrow",
  oak: "Acorn oak",
  store: "Larder",
  fence: "Fence",
  tower: "Lookout",
  hut: "Scouts' hut"
};
export const YARD_NAMES: Record<YardKind, string> = { workshop: "Workshop", hive: "Beehives", well: "Well", stall: "Market stall" };

/** What the lookout does at each level, in words (its reach and its throw grow with every level). */
const TOWER_SAYS = ["", "Throws at prowlers close by", "Throws further", "Throws further and harder", "Throws far and hard", "Throws farthest and hardest"];

/** What each level of a building does, in a few words: for the building's own card. */
export const does = (building: BuildingId, level: number): string => {
  switch (building) {
    case "burrow":
      return level >= MAX_LEVEL ? "Everything can reach its top level" : `Everything else can reach level ${level}`;
    case "oak":
      return level === 0 ? "Drops acorns as you read" : `${OAK_DROPS[level]} acorns every ${OAK_EVERY} minutes read`;
    case "store":
      return level === 0 ? "Keeps acorns safe from prowlers" : `Keeps ${STORE_HIDES[level]} acorns safe from prowlers`;
    case "fence":
      return level === 0
        ? "A wall across the prowlers' trail"
        : `${sectionsAt(level).length} sections across the trail${level >= GATE_FROM ? ", with a gate" : ""}${level >= 5 ? ": the whole way across, in stone, with battlements" : level >= 4 ? ": the whole way across, in stone" : level === 1 ? "" : ", sturdier than before"}`;
    case "tower":
      return level === 0 ? "Keeps watch, and throws at prowlers" : `${TOWER_SAYS[level]}; brighter on a day your reading goal is met`;
    case "hut":
      return level === 0
        ? "Scouts to raid with"
        : `${SCOUTS_FIRST + level * SCOUTS_A_LEVEL} scouts${level >= TRAINED_AT.mole ? ", slingers and moles" : level >= TRAINED_AT.slinger ? " and slingers" : ""} to raid with; they throw at prowlers from the roof`;
  }
};

export const yardDoes = (kind: YardKind, level: number): string => {
  const at = Math.max(1, level);
  switch (kind) {
    case "workshop":
      return `Everything costs ${Math.round(WORKSHOP_OFF[at] * 100)}% less to build`;
    case "hive":
      return at === 1 ? "A parcel of honey each day" : `${at} parcels of honey each day`;
    case "well":
      return `The oak drops ${Math.round(WELL_MORE[at] * 100)}% more`;
    case "stall":
      return `Games pay ${Math.round(STALL_MORE[at] * 100)}% more`;
  }
};

/** The two paths of each forked building: a name, and what it does. */
export const FORKS: Record<Forked, Record<ForkId, { name: string; does: string }>> = {
  oak: { a: { name: "Wide crown", does: "Looks fuller, half as much again" }, b: { name: "Deep roots", does: "Drops a quarter more" } },
  tower: { a: { name: "The White Spire", does: "A lit lantern counts double" }, b: { name: "The Dark Watch", does: "Throws a third oftener, lit or not" } },
  hut: { a: { name: "Runners", does: "Scouts move a quarter faster" }, b: { name: "Packs", does: "Raids bring a quarter more" } }
};

export const isForked = (site: Site): site is Forked => (FORKED as readonly string[]).includes(site);

/** Whether a building has a path to choose and has not chosen one. */
export const forkOpen = (state: BaseState, site: Site): site is Forked => isForked(site) && state.levels[site] >= 3 && !state.forks[site];

/** What it costs to change a path once chosen. */
export const PATH_AGAIN_COSTS = FORK_AGAIN;

/** Chooses a building's path: free the first time, a price to change it. */
export const choosePath = (state: BaseState, building: Forked, path: ForkId): BaseState => {
  if (state.levels[building] < 3 || state.forks[building] === path) return state;
  const again = state.forks[building] !== undefined;
  if (again && state.acorns < FORK_AGAIN) return state;
  return { ...state, acorns: state.acorns - (again ? FORK_AGAIN : 0), forks: { ...state.forks, [building]: path } };
};

// ---- the camp's level, and what each one opens ----------------------------------------

/** What kind of thing a level opens: for the screen to draw it by. */
export type OpenKind = "ground" | "plot" | "decor" | "meadow" | "guards" | "paths" | "work" | "foe" | "top" | "fence" | "postcard";
export type Opened = { kind: OpenKind; name: string; says: string; which?: number };

/**
 * What a level of the burrow brings, for a camp on chapters (1.5.10): the
 * things of the two chapters of that level (level 2 is chapters 3 and 4,
 * level 3 is 5 and 6, and so on: `burrowOfChapter`), read off `CHAPTERS`
 * and the gates themselves, so that the list cannot say one thing and the
 * camp do another. Chapter 2's hut and raids come at level 1, and the King
 * (chapter 10) is not a thing of the clearing: neither is listed. A level
 * brings trouble as well as room, and that is said too.
 */
export const campOpens = (level: number): Opened[] => {
  const opens: Opened[] = [];
  if (level < 2 || level > MAX_LEVEL) return opens;
  const things = new Set<Unlock>([chapterOfBurrow(level), chapterOfBurrow(level) + 1].flatMap((chapter) => chapterBrings(chapter).things));
  if (woodAt(level) < woodAt(level - 1)) opens.push({ kind: "ground", name: woodAt(level) === 0 ? "The whole clearing" : "A wider clearing", says: "The trees are cleared further back: more ground to build on, fence and set things down in" });
  if (things.has("yard0")) opens.push({ kind: "plot", name: "A plot in the yard", says: "Room for a workshop, a hive, a well or a stall: one of each at most" });
  if (things.has("yard1")) opens.push({ kind: "plot", name: "A second plot", says: "Room for a workshop, a hive, a well or a stall: one of each at most" });
  if (things.has("decor")) opens.push({ kind: "decor", name: "Things to set down", says: "Decorations, and ponds, knolls and trees to shape the ground with" });
  if (things.has("meadow")) opens.push({ kind: "meadow", name: "The meadow", says: "A second clearing, where the animals live" });
  if (things.has("guards")) opens.push({ kind: "guards", name: "Guardians", says: "One for each building, posted and trained by reading" });
  if (things.has("fence")) opens.push({ kind: "fence", name: "The fence", says: "A wall across the prowlers' trail, with a trap on the trail before it" });
  if (things.has("postcard")) opens.push({ kind: "postcard", name: "A postcard", says: "A picture of your camp, to save or send" });
  // The constructs come a chapter at a time since 1.5.11 (`front.ts` `WORK_CHAPTER`): those of this level's two chapters.
  const chapters = [chapterOfBurrow(level), chapterOfBurrow(level) + 1];
  for (const which of FRONT_WORKS.filter((kind) => chapters.includes(WORK_CHAPTER[kind]))) opens.push({ kind: "work", name: WORKS[which].name, says: WORKS[which].does, which });
  // Who comes down the trail (`front.ts` `ROLES`): creepers first, and one more kind a chapter from the fourth.
  if (things.has("prowlers")) opens.push({ kind: "foe", name: "Prowlers", says: "They come down a trail out of the Dark Wood: creepers first, and more kinds as the chapters go on" });
  for (const role of ROLES.filter((entry) => entry !== "creeper" && chapters.includes(ROLE_FROM[entry]))) opens.push({ kind: "foe", name: `${ROLE_NAMES[role].many[0].toUpperCase()}${ROLE_NAMES[role].many.slice(1)}`, says: ROLE_DOES[role] });
  if (level === yardBurrow(YARD_MAX)) opens.push({ kind: "top", name: "The yard at its best", says: `What stands on a plot can reach level ${YARD_MAX}` });
  return opens;
};

// ---- building ---------------------------------------------------------------------

/**
 * Whether a plot of the yard is there yet, for a camp of that burrow level with that on the plot: a plot once built on
 * stays. `legacy` is the burrow a camp from before chapters was brought onto them with (`state.legacy?.burrow`): the
 * plots it had then stay too. (The burrow follows the chapter, so for a camp begun on chapters this is the chapter's
 * own gate: `opened(state, minutes, "yard0")`.)
 */
export const plotOpenAt = (burrow: number, slot: Yard | undefined, site: Placed | Site, legacy = 0) =>
  (site !== "yard0" && site !== "yard1") || burrow >= PLOT_FROM[site] || legacy >= LEGACY_FROM[site] || Boolean(slot && (slot.kind !== null || slot.level > 0));
/** Whether a site is there to be built on: every building is, and a plot of the yard once its chapter has come. */
export const plotOpen = (state: BaseState, site: Placed | Site) =>
  (site !== "yard0" && site !== "yard1") || opened(state, undefined, site) || plotOpenAt(state.levels.burrow, state.yard[yardIndex(site as Site)], site, state.legacy?.burrow ?? 0);
/** The buildings and plots that stand in the clearing now. */
export const standing = (state: BaseState): Placed[] => PLACED.filter((site) => plotOpen(state, site));
/** Whether decorations and landscape can be set down: from chapter 5. */
export const decorOpen = (state: BaseState) => opened(state, undefined, "decor");

/** The level a site is at. */
export const levelOf = (state: BaseState, site: Site) => (yardIndex(site) >= 0 ? state.yard[yardIndex(site)].level : state.levels[site as BuildingId]);
export const topOf = (site: Site) => (yardIndex(site) >= 0 ? YARD_MAX : MAX_LEVEL);

/** The materials of a level: what it cost before its work was paid in acorns too (`priceOf` is what it costs). */
export const costOf = (site: Site, to: number) => (yardIndex(site) >= 0 ? YARD_COST[to] : Math.round(BASE_COST[site as BuildingId] * COST_TIMES[to]));
/** How much less Pip's work costs when she is happy at home: her mood there, 0 to 100, is what she brings to the camp. */
export const moodQuicker = (mood: number | undefined) => (mood === undefined ? 0 : mood >= 90 ? 0.2 : mood >= 75 ? 0.1 : 0);

/** The minutes of work in a level (what reading it used to take to finish), less what a happy Pip saves. */
export const minutesOf = (_state: BaseState, site: Site, to: number, mood?: number) =>
  Math.max(1, Math.round((yardIndex(site) >= 0 ? YARD_MINUTES[to] : BUILD_MINUTES[to]) * (1 - moodQuicker(mood))));
/** The work in a level, in acorns: its minutes at `ACORNS_A_MINUTE`. */
export const workOf = (state: BaseState, site: Site, to: number, mood?: number) => Math.max(1, Math.round(minutesOf(state, site, to, mood) * ACORNS_A_MINUTE));
/** A workshop's discount, as a share. */
export const workshopOff = (state: BaseState) => WORKSHOP_OFF[yardLevel(state, "workshop")] ?? 0;
/**
 * What the next level of a site costs, all told: its materials and its work, less what a workshop takes off. The one
 * figure a building costs; it stands as soon as it is paid.
 */
export const priceOf = (state: BaseState, site: Site, to: number, mood?: number) =>
  Math.max(1, Math.round((costOf(site, to) + workOf(state, site, to, mood)) * (1 - workshopOff(state))));

/**
 * Why a site cannot go up a level now, or null when it can. "chapter": it waits for a chapter (`chapterFor` says
 * which): the burrow always does, since it follows the chapter and is never bought. (1.5.10: "room", a larder too
 * small, is gone with the larder's cap, and "burrow" became "chapter".)
 */
export type Blocked = "top" | "busy" | "mend" | "harm" | "chapter" | "taken" | "acorns";

/** The thing a site's first level waits for, if its chapter opens it. */
const SITE_OPENS: Partial<Record<Site, Unlock>> = { hut: "hut", tower: "lookout", fence: "fence", yard0: "yard0", yard1: "yard1" };

export const blocked = (state: BaseState, site: Site, kind?: YardKind, mood?: number): Blocked | null => {
  const to = levelOf(state, site) + 1;
  if (to > topOf(site)) return "top";
  // The burrow is the camp's chapter: it goes up by reading, by itself.
  if (site === "burrow") return "chapter";
  // (After a friend's raid the fence used to wait to be mended by reading. Since 1.5.8 a raid knocks pieces down and
  // that is all, and a camp kept from before is mended when it is next brought up to now: `wreck` is not there to see.)
  if (state.wreck && site === "fence") return "mend";
  // What a prowler has knocked about is put right before it is built on.
  if (harmOf(state, site) > 0) return "harm";
  if (state.jobs.some((job) => job.site === site) || state.jobs.length >= builders(state)) return "busy";
  const slot = yardIndex(site);
  const opens = SITE_OPENS[site];
  // A building whose chapter has not come is not there to build (one already standing stays, and goes up as the rest do).
  if (to === 1 && opens && !opened(state, undefined, opens) && !(slot >= 0 && plotOpen(state, site))) return "chapter";
  if (slot >= 0) {
    // The burrow leads the yard by a level, and a plot is not there at all until its chapter has come.
    if (!plotOpen(state, site) || yardBurrow(to) > state.levels.burrow) return "chapter";
    const wanted = state.yard[slot].kind ?? kind;
    if (!wanted || state.yard.some((other, index) => index !== slot && other.kind === wanted)) return "taken";
  } else if (to > state.levels.burrow) {
    // The burrow leads: nothing else is built past it, and it goes up with the chapters.
    return "chapter";
  }
  const price = priceOf(state, site, to, mood);
  if (state.acorns < price) return "acorns";
  return null;
};

/** The burrow level a site's next level wants (the burrow's own: the next). */
export const burrowFor = (state: BaseState, site: Site) =>
  yardIndex(site) >= 0 ? Math.max(yardBurrow(levelOf(state, site) + 1), plotOpen(state, site) ? 0 : PLOT_FROM[site as "yard0" | "yard1"]) : levelOf(state, site) + 1;

/**
 * The chapter a site's next level waits for: the chapter that opens the building (for its first level) and the one
 * that raises the burrow far enough. At or below the camp's chapter when it is not waiting for one.
 */
export const chapterFor = (state: BaseState, site: Site): number => {
  const to = levelOf(state, site) + 1;
  const opens = SITE_OPENS[site];
  const first = to === 1 && opens && !opened(state, undefined, opens) && !(yardIndex(site) >= 0 && plotOpen(state, site)) ? CHAPTER_OF[opens] : 1;
  const need = site === "burrow" ? to : burrowFor(state, site);
  return Math.max(first, need > state.levels.burrow ? chapterOfBurrow(need) : 1);
};

/** Pays for the next level of a site and begins it; the state unchanged when it cannot be. */
/**
 * Pays for the next level of a site, and it stands: the state unchanged when it cannot be. It goes through a job that
 * wants no more (`needs: 0`), finished here with `day` for the camp's news; without a day the job is left for the next
 * `settle`, which finishes it the same way.
 */
export const build = (state: BaseState, site: Site, minutesRead: number, kind?: YardKind, mood?: number, day?: string): BaseState => {
  if (blocked(state, site, kind, mood)) return state;
  const to = levelOf(state, site) + 1;
  const slot = yardIndex(site);
  const job: Job = { site, to, from: Math.floor(minutesRead), needs: 0 };
  let yard = state.yard;
  if (slot >= 0) {
    job.kind = state.yard[slot].kind ?? kind;
    // The plot is spoken for from the moment the first stake goes in.
    yard = state.yard.map((entry, index) => (index === slot ? { kind: job.kind ?? null, level: entry.level } : entry)) as [Yard, Yard];
  }
  const paid = { ...state, acorns: state.acorns - priceOf(state, site, to, mood), yard, jobs: [...state.jobs, job] };
  return day === undefined ? paid : finishJobs(paid, minutesRead, day);
};

/**
 * Everything going up is finished. Since 1.5.8 a building stands as soon as it is paid for, so a job is only ever
 * there between paying and this, or in a camp kept from before, where it was waiting on reading: that one is finished
 * too, whatever reading it still wanted (it was paid for). It hangs on the camp alone, so every device does the same.
 */
export const finishJobs = (state: BaseState, minutesRead: number, day: string): BaseState => {
  const read = Math.floor(minutesRead);
  let next = state;
  for (const job of state.jobs) {
    const slot = yardIndex(job.site);
    next =
      slot >= 0
        ? { ...next, yard: next.yard.map((entry, index) => (index === slot ? { kind: job.kind ?? entry.kind, level: Math.max(entry.level, job.to) } : entry)) as [Yard, Yard] }
        : { ...next, levels: { ...next.levels, [job.site]: Math.max(next.levels[job.site as BuildingId], job.to) } };
    const opened = job.site === "burrow" ? campOpens(job.to).map((entry) => entry.name.toLowerCase()) : [];
    next = {
      ...next,
      jobs: next.jobs.filter((entry) => entry !== job),
      events: noted(next, day, job.site === "burrow" ? `The camp is level ${job.to}${opened.length > 0 ? `. New: ${opened.join(", ")}` : ""}.` : `${siteName(next, job.site)} reached level ${job.to}.`)
    };
    // A level of the camp may bring a plot: it is given ground of its own.
    if (job.site === "burrow") next = seatPlots(next);
    // A new oak starts dropping from the day it stands, not from the reading that built it.
    if (job.site === "oak" && job.to === 1) next = { ...next, oakFrom: read };
  }
  // A fence level is a longer, sturdier wall; a building may have been the leftmost (`fronted`).
  return state.jobs.length > 0 ? fronted(next) : next;
};

/** Clears a yard plot, for something else. Nothing comes back for it. */
export const clearPlot = (state: BaseState, site: Site): BaseState => {
  const slot = yardIndex(site);
  if (slot < 0 || state.yard[slot].kind === null || state.jobs.some((job) => job.site === site)) return state;
  return { ...state, yard: state.yard.map((entry, index) => (index === slot ? { kind: null, level: 0 } : entry)) as [Yard, Yard] };
};

/** Minutes of reading a job still wants. */
export const jobLeft = (job: Job, minutesRead: number) => Math.max(0, job.needs - Math.max(0, Math.floor(minutesRead) - job.from));
export const jobOn = (state: BaseState, site: Site) => state.jobs.find((job) => job.site === site) ?? null;
/** What a site is called, with whatever is on it. */
export const siteName = (state: BaseState, site: Site) => {
  const slot = yardIndex(site);
  if (slot < 0) return BUILDING_NAMES[site as BuildingId];
  const kind = state.yard[slot].kind;
  return kind ? YARD_NAMES[kind] : "Empty plot";
};

// ---- the oak ----------------------------------------------------------------------

/** Acorns on the oak to gather now: everything the reading dropped since it was last gathered (it holds it all), and Pip's shake. */
export const oakReady = (state: BaseState, minutesRead: number) => oakRead(state, minutesRead) + windfallOf(state);
/** What the reading has put on the oak, without what Pip shook onto it. */
const oakRead = (state: BaseState, minutesRead: number) => {
  const read = Math.max(0, Math.floor(minutesRead) - state.oakFrom);
  return Math.floor((read / OAK_EVERY) * oakDrops(state));
};
/** The welcome's shake still on the oak (a camp read before there was a welcome has none). */
export const windfallOf = (state: BaseState) => state.welcome?.windfall ?? 0;

/** Gathers everything on the oak (since 1.5.10 there is always room for it), with the streak's and the season's more. */
export const gather = (state: BaseState, minutesRead: number, streak = 0, day: string | null = null): BaseState => {
  // What Pip shook onto the oak comes first, and as it is: no streak or season on it, and the oak's clock untouched,
  // since no reading stands behind it.
  const shaken = windfallOf(state);
  if (shaken > 0) {
    const shook = { ...state, acorns: state.acorns + shaken, stats: { ...state.stats, gathered: state.stats.gathered + shaken }, welcome: { ...state.welcome, windfall: state.welcome.windfall - shaken } };
    return oakRead(shook, minutesRead) > 0 ? gatherRead(shook, minutesRead, streak, day) : shook;
  }
  return gatherRead(state, minutesRead, streak, day);
};
const gatherRead = (state: BaseState, minutesRead: number, streak: number, day: string | null): BaseState => {
  const taken = oakRead(state, minutesRead);
  if (taken <= 0) return state;
  // The clock goes on from what is left over of the last ten minutes, so no minute's acorns are lost to the rounding.
  const now = Math.floor(minutesRead);
  const drops = oakDrops(state);
  const spent = drops > 0 ? Math.ceil((taken * OAK_EVERY) / drops) : now - state.oakFrom;
  const oakFrom = Math.min(now, state.oakFrom + spent);
  const gathered = { ...state, acorns: state.acorns + taken, oakFrom, stats: { ...state.stats, gathered: state.stats.gathered + taken } };
  // A streak makes the gathering richer: more for the same acorns off the tree.
  const streaked = { ...gathered, acorns: gathered.acorns + give(gathered, taken * streakAdds(streak)) };
  // And in autumn the oak is heavy.
  // (The first gathering of a day used to come with dew on it, a little more. It was a bonus nobody could see coming,
  // and it made the oak say one figure and give another; since 2026-10-15 it is gone, and `dewDay` is kept as it was.)
  return day !== null && seasonOf(day) === 1 ? { ...streaked, acorns: streaked.acorns + give(streaked, taken * AUTUMN_OAK) } : streaked;
};

/** What a gathering would bring in now, every bonus counted: what the screen says before the tap. */
export const gatherBrings = (state: BaseState, minutesRead: number, streak = 0, day: string | null = null) => gather(state, minutesRead, streak, day).acorns - state.acorns;

/**
 * Acorns the larder has room for: always all of them, since 1.5.10.
 * @deprecated there is always room.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const larderRoom = (_state: BaseState) => Number.POSITIVE_INFINITY;

/**
 * How the oak stands for a tap, so that the picture never says one thing
 * and a tap does another (the owner, 2026-10-19: "the acorn does not
 * disappear even when I collect it"): "ready", a tap takes acorns in;
 * "bare", nothing on it yet. Read off `gather` itself, so the two cannot
 * drift apart. (There was a "full", acorns on it and no room in the larder:
 * since 1.5.10 there is always room.)
 */
export type OakStatus = "ready" | "bare";
export const oakStatus = (state: BaseState, minutesRead: number): OakStatus => (gather(state, minutesRead).acorns > state.acorns ? "ready" : "bare");

/** What a reading streak of so many days adds to what is gathered from the oak, as a share. */
export const streakAdds = (streak: number) => STREAK_ADDS.find(([days]) => streak >= days)?.[1] ?? 0;
/** The streak, in days, at which the oak next gives more; null past the last. */
export const streakNext = (streak: number) => [...STREAK_ADDS].reverse().find(([days]) => days > streak)?.[0] ?? null;

// ---- where things stand ---------------------------------------------------------------

/** The wall's sections, all told: as many as the fence's level gives (`front.ts`). (Until 1.5.11 it was pieces to lay by hand: six a level, and two for the goat.) */
export const fencePieces = (state: BaseState) => sectionsAt(state.levels.fence).length;

const snap = (value: number, to: number) => Math.round(value / to) * to;
const apart = (a: Spot, b: Spot) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Why a building cannot stand at a spot, or null when it can. "fence": in the wall's way, or on the trail's side of it. */
export const spotBlocked = (state: BaseState, site: Placed, x: number, y: number): "edge" | "building" | "fence" | null => {
  const at: Spot = [snap(x, 2), snap(y, 2)];
  const land = cleared(LAND, state);
  if (at[0] < land.left || at[0] > land.right || at[1] < land.top || at[1] > land.bottom) return "edge";
  // A plot that is not there yet is in nobody's way.
  if (standing(state).some((other) => other !== site && apart(at, state.spots[other]) < (REACH[site] + REACH[other]) * FOOT)) return "building";
  // Once there is a trail, the ground in front of the wall is the prowlers': nothing is built there.
  if (opened(state, undefined, "prowlers") && at[0] - REACH[site] * FOOT - 4 < wallXAt(state.front.x, at[1])) return "fence";
  return state.walls.some((wall) => apart(at, wall) < REACH[site] * FOOT + 4) ? "fence" : null;
};

/**
 * A plot just staked out is seated on free ground. While it was not there,
 * a building or a piece of fence may have been put where it would have
 * been; it goes to the nearest place it can stand, and stays where it was
 * if the clearing has no room at all.
 */
const seatPlots = (state: BaseState): BaseState => {
  let next = state;
  for (const site of ["yard0", "yard1"] as const) {
    const [x, y] = next.spots[site];
    if (!plotOpen(next, site) || !spotBlocked(next, site, x, y)) continue;
    let best: Spot | null = null;
    const land = cleared(LAND, next);
    for (let cy = land.top; cy <= land.bottom; cy += 2) {
      for (let cx = land.left; cx <= land.right; cx += 2) {
        if (spotBlocked(next, site, cx, cy)) continue;
        if (!best || apart([cx, cy], [x, y]) < apart(best, [x, y])) best = [cx, cy];
      }
    }
    if (best) next = { ...next, spots: { ...next.spots, [site]: best } };
  }
  return next;
};

/** Moves a building: as often as the reader likes, for nothing. Unchanged where it cannot stand. */
export const moveSite = (state: BaseState, site: Placed, x: number, y: number): BaseState =>
  spotBlocked(state, site, x, y) ? state : fronted({ ...state, spots: { ...state.spots, [site]: [snap(x, 2), snap(y, 2)] } });

/**
 * The fence is not laid by hand since 1.5.11: it is a wall across the trail, raised with the fence's level
 * (`fronted`). These are kept for the screens and tests that still ask, and do nothing.
 * @deprecated the wall is `fronted`; it is slid with `slideWall`.
 */
export const wallBlocked = (_state: BaseState, _x: number, _y: number): "none" | "edge" | "building" | "fence" | null => "none";
/** @deprecated see `wallBlocked`. */
export const placeWall = (state: BaseState, _x: number, _y: number): BaseState => state;
/** The piece of the wall at a point (a section), or -1: what is taken hold of to slide the wall. */
export const wallAt = (state: Pick<BaseState, "walls">, x: number, y: number) => state.walls.findIndex((wall) => Math.abs(wall[0] - x) <= 6 && y >= wall[1] - 14 && y <= wall[1] + 5);
/** @deprecated see `wallBlocked`. */
export const removeWall = (state: BaseState, _index: number): BaseState => state;
/** @deprecated see `wallBlocked`. */
export const wallMoveBlocked = (_state: BaseState, _index: number, _x: number, _y: number) => "none" as const;
/** @deprecated see `wallBlocked`. */
export const moveWall = (state: BaseState, _index: number, _x: number, _y: number): BaseState => state;

/**
 * The gate: where the trail meets the wall, from the fence's second level. Whoever comes on foot batters at it (or
 * goes round a wall too short to stop them), and the camp's own walk through it.
 */
export const GATE_FROM = 2;
export const gateOf = (state: Pick<BaseState, "gate" | "walls" | "levels">): Spot | null =>
  state.gate && state.levels.fence >= GATE_FROM && state.walls.some((wall) => wall[0] === state.gate![0] && wall[1] === state.gate![1]) ? state.gate : null;
/** @deprecated the gate is always where the trail meets the wall. */
export const setGate = (state: BaseState, _x: number, _y: number): BaseState => state;

// ---- the front: the wall across the trail, its traps and towers (1.5.11, `front.ts`) ----------------------------

/** The buildings that stand in the clearing with something built on them (a plot with nothing on it is ground). */
const builtSites = (state: BaseState): Placed[] =>
  standing(state).filter((site) => site === "burrow" || (yardIndex(site) >= 0 ? state.yard[yardIndex(site)].kind !== null || state.yard[yardIndex(site)].level > 0 : state.levels[site as BuildingId] > 0));
/** Just left of the leftmost building: where a wall stands with nothing outside it. */
const leftmostEdge = (state: BaseState) =>
  Math.floor(Math.min(...builtSites(state).map((site) => state.spots[site][0] - REACH[site] * FOOT - 6 - Math.max(0, wallXAt(0, state.spots[site][1])))) / 2) * 2;
/** The chapter the front goes by: the camp's, or for a camp from before chapters, what its burrow had then. */
export const frontChapter = (state: Pick<BaseState, "minutes" | "legacy">) => Math.max(chapterOf(state.minutes), state.legacy ? chapterOfBurrow(state.legacy.burrow) + 1 : 0);
/** Whether a point behind the wall is clear for a tower: off the buildings' ground. */
const padFree = (state: BaseState) => (x: number, y: number) =>
  x <= DECOR_LAND.right - woodOf(state) && y >= DECOR_LAND.top + 4 && y <= DECOR_LAND.bottom && builtSites(state).every((site) => apart([x, y], state.spots[site]) >= REACH[site] * FOOT + 7);
/** Where the trap spots and the tower pads are just now, open or not. */
export const frontPlaces = (state: BaseState): { spots: Spot[]; pads: Spot[]; bell: Spot } => ({
  spots: trapSpots(leftWoodOf(state), state.front.x),
  pads: towerPads(state.front.x, padFree(state)),
  bell: bellSpot(state.front.x)
});
/** How many trap spots and tower pads are open. */
export const frontOpen = (state: Pick<BaseState, "minutes" | "legacy">) => ({ spots: spotsOpen(frontChapter(state)), pads: padsOpen(frontChapter(state)) });

/**
 * The camp's wall, traps and towers put where they are: the wall's line (following the camp until a fence is raised
 * or the reader slides it), its sections at the fence's level (less any a friend knocked down: `downed`), the gate,
 * and every construct on its spot or pad (one on a slot that is not open yet goes to the shed). `walls`, `gate` and
 * `works` are made from it, so everything that reads them sees the front as it is.
 */
export const fronted = (state: BaseState): BaseState => {
  const had = state.front;
  const leftWood = leftWoodOf(state);
  const x = had.set || state.levels.fence > 0 ? clampLine(had.x, leftWood) : clampLine(Math.min(LINE_DEFAULT, leftmostEdge(state)), leftWood);
  const ys = sectionsAt(state.levels.fence);
  const down = new Set(state.downed.map(([, y]) => y));
  const open = frontOpen(state);
  const shed = [...had.shed];
  const fit = (list: readonly number[], most: number, ok: (kind: number) => boolean) =>
    [0, 1, 2].map((index) => {
      const kind = list[index] ?? -1;
      if (kind < 0) return -1;
      if (index >= most || !ok(kind)) {
        shed.push(kind);
        return -1;
      }
      return kind;
    });
  const spots = fit(had.spots, open.spots, isTrap);
  const pads = fit(had.pads, open.pads, isTower);
  const front: Front = { ...had, x, spots, pads, shed };
  const places = frontPlaces({ ...state, front });
  const works: Decor[] = [
    ...spots.flatMap((kind, index) => (kind >= 0 ? [{ kind, x: places.spots[index][0], y: places.spots[index][1] }] : [])),
    ...pads.flatMap((kind, index) => (kind >= 0 ? [{ kind, x: places.pads[index][0], y: places.pads[index][1] }] : [])),
    ...(had.bell ? [{ kind: BELL, x: places.bell[0], y: places.bell[1] }] : [])
  ];
  const next = {
    walls: ys.filter((y) => !down.has(y)).map((y): Spot => [wallXAt(x, y), y]),
    downed: ys.filter((y) => down.has(y)).map((y): Spot => [wallXAt(x, y), y]),
    gate: state.levels.fence >= GATE_FROM ? ([x, TRAIL_Y] as Spot) : null,
    works,
    front
  };
  // Nothing moved: the camp as it was (so that what keeps it, and the tests, can tell nothing changed).
  const same = JSON.stringify([next.walls, next.downed, next.gate, next.works, next.front]) === JSON.stringify([state.walls, state.downed, state.gate, state.works, state.front]);
  return same ? state : { ...state, ...next };
};

/** No more of a kind than a camp may have. */
const trimOwned = (front: Front): Front => {
  const count = new Map<number, number>();
  const keep = (kind: number) => {
    if (kind < 0) return -1;
    const had = count.get(kind) ?? 0;
    if (had >= mostOf(kind)) return -1;
    count.set(kind, had + 1);
    return kind;
  };
  const spots = front.spots.map(keep);
  const pads = front.pads.map(keep);
  const shed = front.shed.map(keep).filter((kind) => kind >= 0);
  return { ...front, spots, pads, shed };
};

/** The camp's front as it was kept; or, for a camp saved by a build that knows nothing of it, from its mark; or, for a camp from before it, brought onto it. */
const readFront = (state: BaseState, raw: unknown, taught: readonly string[], rawWorks: unknown): BaseState => {
  const kept = record(raw);
  const slots = (value: unknown) => [0, 1, 2].map((index) => (Array.isArray(value) ? (whole(value[index], -1, 15) ?? -1) : -1)).map((kind) => (FRONT_WORKS.includes(kind) ? kind : -1));
  const works = readThings(rawWorks, WORKS.length, WORKS.length * 2, DECOR_LAND);
  if (typeof kept.x === "number") {
    const front: Front = {
      x: wholeOr(kept.x, 0, 240, LINE_DEFAULT),
      set: kept.set === true,
      spots: slots(kept.spots),
      pads: slots(kept.pads),
      shed: (Array.isArray(kept.shed) ? kept.shed : []).map((kind) => whole(kind, 0, 15)).filter((kind): kind is number => kind !== null && FRONT_WORKS.includes(kind)).slice(0, 12),
      bell: kept.bell === true,
      watchedAt: wholeOr(kept.watchedAt, 0, 1e9, state.minutes),
      held: wholeOr(kept.held, 0, 1e9, 0),
      through: texts(kept.through, 12).filter((role) => role in COUNTER),
      moved: kept.moved === true,
      ...(kept.seat === true ? { seat: true } : {})
    };
    return fronted({ ...state, front: trimOwned(front) });
  }
  const mark = readFrontMark(taught);
  if (mark) {
    // Saved by a build that does not know the front. What it bought meanwhile (old kinds and all) goes to the shed.
    let front: Front = trimOwned({ ...freshFront(state.minutes), ...mark });
    let refund = 0;
    const seen = new Map<number, number>();
    for (const work of works) {
      const kind = becomesNow(work.kind);
      const counted = (seen.get(kind ?? -1) ?? 0) + 1;
      seen.set(kind ?? -1, counted);
      if (kind === null) continue;
      if (counted <= ownCount(front, kind)) continue;
      if (ownCount(front, kind) < mostOf(kind)) front = { ...front, shed: [...front.shed, kind] };
      else refund += WORKS[work.kind]?.cost ?? 0;
    }
    return fronted({ ...state, acorns: state.acorns + refund, front });
  }
  return fronted(ontoFront(state, works));
};
/** What an old kind of construct is now: itself, what it became, or null for one that is no more. */
const becomesNow = (kind: number): number | null => (kind === 0 || kind === 5 ? 10 : kind === 1 ? 8 : kind === 3 || kind === 11 ? null : FRONT_WORKS.includes(kind) ? kind : null);

/**
 * A camp from before the front, brought onto it: the wall goes just left of its leftmost building (so nothing it
 * built is left outside), at the fence level it had, complete (what pieces it had laid, and where, no longer matter);
 * pieces a friend had knocked down are that many sections down, beside the gate; and its constructs are what they
 * became (`front.ts` `BECAME`), seated on the spots and pads nearest the trail first, the rest in the shed. A kind
 * that is no more, or one too many of a kind, is paid back in full. Buildings and everything set about stay put.
 */
const ontoFront = (state: BaseState, works: readonly Decor[]): BaseState => {
  const leftWood = leftWoodOf(state);
  const edge = leftmostEdge(state);
  const x = clampLine(state.levels.fence > 0 ? edge : Math.min(LINE_DEFAULT, edge), leftWood);
  const chapter = frontChapter(state);
  const seat = seatOld(works, (kind) => WORKS[kind]?.cost ?? 0, { spots: spotsOpen(chapter), pads: padsOpen(chapter) }, (wx, wy) => Math.hypot(wx - x, wy - TRAIL_Y));
  const ys = sectionsAt(state.levels.fence).sort((a, b) => Math.abs(a - TRAIL_Y) - Math.abs(b - TRAIL_Y) || a - b);
  const downed = ys.slice(0, Math.min(state.downed.length, ys.length)).map((y): Spot => [wallXAt(x, y), y]);
  const names = [...new Set(seat.refunded.map((kind) => WORKS[kind]?.name.toLowerCase() ?? "a construct"))];
  return {
    ...state,
    acorns: state.acorns + seat.refund,
    downed,
    front: {
      ...freshFront(state.minutes),
      x,
      spots: seat.spots,
      pads: seat.pads,
      shed: seat.shed,
      bell: seat.bell,
      // Pip has a word to say about it, where there was anything to move.
      moved: state.levels.fence > 0 || works.length > 0,
      // Seated on the slots when the camp is next brought up to now (and its chapter is known): `seatShed`.
      seat: true
    },
    events: seat.refund > 0 ? noted(state, state.night ?? "", `The ${names.join(" and the ")} ${names.length === 1 ? "is" : "are"} no more: ${seat.refund} acorns back.`) : state.events
  };
};

/** How far the wall may slide: the trees on one side, and on the other the leftmost building (nothing is left outside it). */
export const wallRange = (state: BaseState): [number, number] => {
  const [least, most] = lineRange(leftWoodOf(state));
  return [least, Math.max(least, Math.min(most, leftmostEdge(state)))];
};
/** Slides the wall along the trail, with its gate and its towers: for nothing, as often as the reader likes. */
export const slideWall = (state: BaseState, x: number): BaseState => {
  const [least, most] = wallRange(state);
  const to = Math.round(Math.min(most, Math.max(least, x)));
  return to === state.front.x && state.front.set ? state : fronted({ ...state, front: { ...state.front, x: to, set: true } });
};

/** A slot on the front: a trap spot or a tower pad, by its place. */
export type FrontSlot = { at: "spot" | "pad"; index: number };
/** What is on a slot just now, or -1. */
export const onSlot = (state: BaseState, slot: FrontSlot) => (slot.at === "spot" ? state.front.spots : state.front.pads)[slot.index] ?? -1;
/**
 * Puts a construct on a slot: one from the shed (or from another slot), or one bought for it. Whatever was on the
 * slot goes to the shed. `kind` -1 takes what is there off, to the shed. Unchanged where it cannot be: a trap on a pad,
 * a slot not open, or one not owned that cannot be bought.
 */
export const seatWork = (state: BaseState, slot: FrontSlot, kind: number): BaseState => {
  const open = frontOpen(state);
  if (slot.index < 0 || slot.index >= (slot.at === "spot" ? open.spots : open.pads)) return state;
  const list = slot.at === "spot" ? [...state.front.spots] : [...state.front.pads];
  const had = list[slot.index] ?? -1;
  if (kind === had) return state;
  let next = state;
  let shed = [...state.front.shed];
  if (kind >= 0) {
    if (slot.at === "spot" ? !isTrap(kind) : !isTower(kind)) return state;
    const inShed = shed.indexOf(kind);
    if (inShed >= 0) shed.splice(inShed, 1);
    else {
      // On another slot of the same sort: it moves here (and what was here goes to the shed).
      const other = list.findIndex((entry, index) => index !== slot.index && entry === kind);
      if (other >= 0) list[other] = -1;
      else {
        if (workBlocked(state, kind)) return state;
        next = { ...next, acorns: next.acorns - WORKS[kind].cost };
      }
    }
  }
  if (had >= 0) shed = [...shed, had];
  list[slot.index] = kind;
  const front = slot.at === "spot" ? { ...next.front, spots: list, shed } : { ...next.front, pads: list, shed };
  return fronted({ ...next, front });
};
/** Buys a construct and puts it to use: on the first free slot of its sort that is open, on the gate for the bell, else in the shed. */
export const buyWork = (state: BaseState, kind: number): BaseState => {
  if (workBlocked(state, kind)) return state;
  const paid = { ...state, acorns: state.acorns - WORKS[kind].cost };
  if (kind === BELL) return fronted({ ...paid, front: { ...paid.front, bell: true } });
  const open = frontOpen(state);
  const list = isTrap(kind) ? paid.front.spots : paid.front.pads;
  const free = list.findIndex((entry, index) => entry < 0 && index < (isTrap(kind) ? open.spots : open.pads));
  if (free < 0) return fronted({ ...paid, front: { ...paid.front, shed: [...paid.front.shed, kind] } });
  const placed = [...list];
  placed[free] = kind;
  return fronted({ ...paid, front: isTrap(kind) ? { ...paid.front, spots: placed } : { ...paid.front, pads: placed } });
};

/** Whether a night is owed: prowlers come, and there has been reading since the last night that counted. */
export const nightDue = (state: BaseState, minutesRead: number) => prowlersCome(state) && Math.floor(minutesRead) > state.front.watchedAt;
/**
 * A night has been watched to its end. The first after some reading counts: held, it is one more night held and a
 * few acorns (`nightBounty`). Any other is for the show, and changes nothing. What got through was dealt with as it
 * did (`harmSite`, `robSite`).
 */
export const nightOver = (state: BaseState, held: boolean, minutesRead: number, day: string): { state: BaseState; bounty: number } => {
  if (!nightDue(state, minutesRead)) return { state, bounty: 0 };
  const bounty = held ? give(state, nightBounty(frontChapter(state))) : 0;
  return {
    state: {
      ...state,
      acorns: state.acorns + bounty,
      front: { ...state.front, watchedAt: Math.floor(minutesRead), held: state.front.held + (held ? 1 : 0) },
      events: noted(state, day, held ? `The night held: ${bounty} acorns.` : "Something got through in the night.")
    },
    bounty
  };
};
/** A kind of prowler got through: Pip says a word about what beats it, the first time. */
export const gotThrough = (state: BaseState, role: Role): BaseState =>
  state.front.through.includes(role) ? state : { ...state, front: { ...state.front, through: [...state.front.through, role] } };

// ---- the nights ---------------------------------------------------------------------

/** How strong tonight's magpies are; 0 while the camp is too small for them to bother. */
export const magpies = (state: BaseState) => (state.levels.burrow < MAGPIES_FROM ? 0 : 3 + state.levels.burrow * 3 + Math.min(state.camps, 20));

/** The side a day's magpies come from: the same all day, and not the same every day. */
export const nightSide = (day: string): Side => SIDES[hashOf(`night|${day}`) % SIDES.length];
const SIDE_WORDS: Record<Side, string> = { left: "the west", top: "the north", right: "the east", bottom: "the south" };
export const sideWord = (side: Side) => SIDE_WORDS[side];

/** How far and how hard a lookout of a level throws. */
const towerThrows = (level: number) => ({ range: 30 + level * 4, hit: 4 + level * 2, every: 0.8 });

/**
 * The reader's camp as the magpies meet it: every building where it stands,
 * with what it can take and what it throws. The burrow is its heart, the
 * larder is the loot, the lookout is its sentry (further and harder with the
 * lantern lit), the scouts throw from their hut's roof, and each piece of
 * fence is a piece of wall.
 */
export const campStructures = (state: BaseState, lit: boolean, at?: number): Structure[] => {
  const made: Structure[] = [];
  const { levels, spots } = state;
  const rank = (guard: number) => guardOf(state, guard);
  // A guardian is drawn where they stand, at their signpost (below): only the dragon is still on her building.
  const posted = (_guard: number): Pick<Structure, "guard"> => ({});
  // The archer drills the camp: everything that throws, throws faster.
  const quicker = GUARD_GIVES.hut[rank(6)];
  const add = (
    kind: Structure["kind"],
    spot: Spot,
    r: number,
    hp: number,
    look: Structure["look"],
    throws: { range: number; hit: number; every: number } | null = null,
    more: Pick<Structure, "first" | "guard" | "grounds" | "cuts" | "lures" | "hides" | "burns" | "zone" | "slows" | "stings" | "traps" | "rouses" | "flat" | "daunts"> = {}
  ) => {
    const every = throws ? throws.every * quicker : 0;
    made.push({ id: made.length, kind, x: spot[0], y: spot[1], r, hp: Math.round(hp), max: Math.round(hp), range: throws?.range ?? 0, hit: throws?.hit ?? 0, every, cool: every, look, ...more });
  };
  add("nest", spots.burrow, REACH.burrow, 120 + levels.burrow * 40, { name: "burrow", variant: levels.burrow }, levels.burrow >= 2 ? { range: 26, hit: 2 + levels.burrow, every: 1.1 } : null, posted(3));
  // The larder: the knight stands before it, and the dragon sits on its roof and goes for the ones on the wing first.
  if (levels.store > 0) {
    add(
      "hoard",
      spots.store,
      REACH.store,
      (50 + levels.store * 30) * GUARD_GIVES.burrow[rank(3)],
      { name: "store", variant: levels.store },
      rank(4) > 0 ? { range: GUARD_GIVES.store.range, hit: GUARD_GIVES.store.hit[rank(4)], every: GUARD_GIVES.store.every } : null,
      // Fire is what the dead and the frozen fear.
      rank(4) > 0 ? { first: "mole", guard: 4, burns: 2 } : {}
    );
  }
  if (levels.tower > 0) {
    const throws = towerThrows(levels.tower);
    const more = lit ? 1 + (state.forks.tower === "a" ? LIT_ADDS_LAMP : LIT_ADDS) : 1;
    add(
      "perch",
      spots.tower,
      REACH.tower,
      50 + levels.tower * 20,
      { name: "tower", variant: levels.tower },
      {
        // The ranger sees further than the lookout does by itself.
        range: Math.round(throws.range * more * GUARD_GIVES.tower[rank(0)]),
        hit: throws.hit * more,
        every: throws.every * (state.forks.tower === "b" ? SLINGS_QUICKER : 1)
      },
      posted(0)
    );
  }
  if (levels.hut > 0) add("other", spots.hut, REACH.hut, 60 + levels.hut * 20, { name: "hut", variant: levels.hut }, { range: 26, hit: 2 + levels.hut, every: 1 }, posted(6));
  if (levels.oak > 0) add("other", spots.oak, REACH.oak, 60 + levels.oak * 20, { name: "oak", variant: levels.oak }, null, posted(2));
  let gardener = rank(5) > 0;
  state.yard.forEach((slot, index) => {
    if (!slot.kind || slot.level === 0) return;
    // The gardener stands by whichever plot was built first.
    add("other", spots[index === 0 ? "yard0" : "yard1"], REACH.yard0, 50 + slot.level * 20, { name: slot.kind, variant: slot.level }, null, gardener ? { guard: 5 } : {});
    gardener = false;
  });
  // The constructs: a ward that grounds the ones on the wing, a hedge that cuts, a thumper that draws the ones on foot.
  for (const work of state.works) {
    const made = WORKS[work.kind];
    if (!made) continue;
    const does: Parameters<typeof add>[6] =
      work.kind === 0
        ? { grounds: made.reach }
        : work.kind === 1
          ? { cuts: HEDGE_CUTS }
          : work.kind === 2
            ? { lures: true }
            : work.kind === 3
              ? { hides: true }
              : work.kind === 4
                ? { slows: TANGLE_SLOWS, zone: made.reach, flat: true }
                : work.kind === 5
                  ? { stings: HORNET_STINGS, zone: made.reach }
                  : work.kind === 6
                    ? { traps: PIT_TAKES, flat: true }
                    : work.kind === 7
                      ? { rouses: BELL_QUICKER, zone: made.reach }
                      : work.kind === 8
                        ? { cuts: CALTROP_CUTS, flat: true }
                        : work.kind === 11
                          ? { daunts: TOTEM_DAUNTS, zone: made.reach }
                          : {};
    // The two that throw: the stone thrower far and hard and slow, the nest quick and light.
    const throws = work.kind === 9 ? { range: made.reach, ...STONE_THROWS } : work.kind === 10 ? { range: made.reach, ...NEST_THROWS } : null;
    // What lies on the ground is a small thing to step on; the rest take the ground a thing of their size takes.
    add("other", [work.x, work.y], work.kind === 6 ? 4 : work.kind === 8 ? 3 : 6, made.hp, { name: "work", variant: work.kind }, throws, does);
  }
  // The wall, with the watchman on it, stands longer; the gate longer again, and the goat leans on all of it.
  const gate = gateOf(state);
  state.walls.forEach((wall, index) =>
    add(
      "wall",
      wall,
      5,
      (30 + levels.fence * 14) * GUARD_GIVES.fence[rank(1)] * (gate && gate[0] === wall[0] && gate[1] === wall[1] ? GATE_TOUGHER : 1) * (hasAnimal(state, 2) ? GOAT_TOUGHER : 1),
      { name: "fencepiece", variant: levels.fence },
      null,
      index === 0 ? posted(1) : {}
    )
  );
  // A building a prowler has broken throws at nobody until it is put right.
  for (const entry of made) {
    const name = entry.look?.name;
    const site: Placed | null = !name ? null : (PLACED as readonly string[]).includes(name) ? (name as Placed) : state.yard[0].kind === name ? "yard0" : state.yard[1].kind === name ? "yard1" : null;
    if (site && isBroken(state, site)) {
      entry.range = 0;
      entry.hit = 0;
    } else if (site && entry.hit > 0) {
      // Knocked about, it throws less hard: a tenth less for each knock.
      entry.hit = entry.hit * (1 - harmOf(state, site) * WEAR_A_KNOCK);
    }
  }
  // The guardians, each at their signpost: what comes within reach of it is thrown at, harder for every rank. A post
  // set where the raiders pass is a post that does something; one behind the burrow is a guardian with nothing to do.
  GUARDIANS.forEach((_, guard) => {
    // One who is worn out and asleep is not at their post.
    const spot = rank(guard) > 0 && !isAsleep(state, guard, at) ? postSpotOf(state, guard) : null;
    if (spot) add("other", spot, 3, 40 + rank(guard) * 20, { name: "guardian", variant: guard }, { range: POST_REACH - 3, hit: 1 + rank(guard), every: 1.2 });
  });
  return made;
};

/**
 * Who comes on a day's night: the same all day. Magpies as often as all the
 * others together; the others each from the burrow's level at which a camp
 * is worth their while.
 */
export const nightFoe = (state: BaseState, day: string): number => {
  const others = FOES.filter((foe) => foe.id > 0 && state.levels.burrow >= foe.from);
  const roll = hashOf(`who|${day}`);
  return others.length === 0 || roll % 2 === 0 ? 0 : others[(roll >>> 1) % others.length].id;
};

/** Tonight's raiders, as a raid: who they are, how many, whether any fly, and how strong each is. */
export const nightRaiders = (state: BaseState, day?: string): Setup => {
  const strength = magpies(state);
  const faction = day === undefined ? 0 : nightFoe(state, day);
  // The cat sees one of them off before it comes to anything.
  const flock = Math.max(1, 3 + Math.floor(strength / 4) - (hasAnimal(state, 1) ? 1 : 0));
  // A rabble is a great many; the Gilded are few; the Stumbling are more than enough; frostwights keep their number down.
  const capacity = faction === 1 ? Math.ceil(flock * 1.5) : faction === 2 ? Math.max(2, Math.round(flock * 0.4)) : faction === 3 ? Math.ceil(flock * 1.3) : faction === 4 ? Math.max(2, Math.round(flock * 0.75)) : flock;
  return {
    n: 0,
    king: false,
    capacity,
    level: Math.min(5, 1 + Math.floor(strength / 8)),
    // Magpies on foot are stopped by a fence, and from a bolder flock some fly straight for the larder. Nobody else flies.
    kinds: faction === 0 && strength >= 14 ? ["sprout", "mole"] : ["sprout"],
    fast: false,
    raiders: true,
    seconds: NIGHT_SECONDS,
    // The shepherd of trees has the roots catch at their feet.
    slowed: GUARD_GIVES.oak[guardOf(state, 2)],
    faction
  };
};

export type Night = {
  side: Side;
  held: boolean;
  taken: number;
  lit: boolean;
  /** Who came. */
  foe: number;
  /** Which pieces of fence came down in it, by their place in the camp's list; and whether the larder was emptied. */
  broken: number[];
  emptied: boolean;
};
/** How far into the larder the magpies may get and the camp still be said to have held. */
const HELD_UNDER = 0.2;

/**
 * How a night goes as the camp stands: fought, by rule, on the camp as it is
 * laid out. What the magpies take is by how far they got with the larder
 * (the burrow, for a camp with none): untouched, the camp held. Never more
 * than a fifth of what the camp has, and never what the larder hides.
 * Nothing is broken by it: a building pulled about in the night is whole
 * again by morning.
 */
export const nightOutcome = (state: BaseState, day: string, lit: boolean, at?: number): Night | null => {
  if (magpies(state) === 0) return null;
  const side = nightSide(day);
  const shining = lit && state.levels.tower > 0;
  const battle = runAuto(nightRaiders(state, day), side, campStructures(state, shining, at));
  const prize = battle.structures.find((entry) => entry.kind === "hoard") ?? battle.structures[0];
  // A peck at the door is not a larder got into: seen off before they are a fifth of the way in, the camp held.
  const reached = 1 - prize.hp / prize.max;
  const got = reached < HELD_UNDER ? 0 : reached;
  const taken = Math.round(Math.min(Math.max(0, state.acorns - hides(state)), Math.ceil(state.acorns * TAKEN_AT_MOST)) * got);
  // The fence is the last thing laid out, a piece after a piece: which of them came down.
  const pieces = battle.structures.filter((entry) => entry.kind === "wall");
  const broken = pieces.map((piece, index) => (piece.hp <= 0 ? index : -1)).filter((index) => index >= 0);
  return { side, held: got === 0, taken, lit: shining, foe: nightFoe(state, day), broken, emptied: reached >= 0.999 };
};

/** What the magpies would take on a night as things stand; 0 when the camp holds. */
export const atRisk = (state: BaseState, day: string, lit: boolean) => nightOutcome(state, day, lit)?.taken ?? 0;

// ---- the day turning, and reading done ------------------------------------------------

/**
 * Brings the camp up to now: a finished building goes up, and if the day has
 * changed since the camp was last looked at, the night in between is played
 * and the bees have been busy. One night however long the reader was away:
 * the magpies are a nudge to come back, not a bill for having been gone.
 */
export const settle = (state: BaseState, now: Now): BaseState => {
  const read = Math.floor(now.minutes);
  const day = now.day;
  // The chapters first (1.5.10): what the reading has the camp on, a camp from before brought onto them, the chests.
  let next = settleChapters(state, read, day);
  // A camp kept before trophies stood on reading: what was read until now stands behind the trophies it has, with
  // enough over for one more (whoever is half way through a book is not made to begin again). And a library
  // restored from an older day cannot have more behind its trophies than has been read.
  if (next.claimed < 0 || next.claimed > read) next = { ...next, claimed: next.claimed < 0 ? Math.max(0, read - TROPHY_MINUTES) : read };
  if (next.story && next.story.from > read) next = { ...next, story: { ...next.story, from: read } };
  // A library restored from before the training began: it starts from here.
  if (next.drill && next.drill.from > read) next = { ...next, drill: { ...next.drill, from: read } };
  // A guardian whose training has been read through takes up their post, or is surer of it.
  // A friend's raid no longer leaves reading to be done (1.5.8): a camp still mending after one from before is mended.
  if (next.wreck) {
    next = { ...next, wreck: null, events: noted(next, day, "The camp is mended.") };
  }
  // And a guardian trains at once, paid for in acorns (`trainGuard`): one still training from before has done.
  if (next.drill) {
    const guard = next.drill.guard;
    const rank = Math.min(GUARD_MOST, guardOf(next, guard) + 1);
    next = {
      ...next,
      drill: null,
      guards: next.guards.map((had, at) => (at === guard ? rank : had)),
      events: noted(next, day, rank === 1 ? `${GUARDIANS[guard].name} has taken up a post at the camp.` : `${GUARDIANS[guard].short} is surer of the post: rank ${rank}.`)
    };
  }
  // An animal comes to a camp that has grown charming enough for it, and stays: once the meadow has come.
  for (const animal of opened(next, read, "animals") ? ANIMALS : []) {
    if (!next.animals.includes(animal.id) && charm(next) >= animal.charm) {
      next = { ...next, animals: [...next.animals, animal.id], events: noted(next, day, `${/^[AEIOU]/.test(animal.name) ? "An" : "A"} ${animal.name.toLowerCase()} has wandered into the meadow, and means to stay.`) };
    }
  }
  // The hen lays most mornings: the egg comes as a parcel, like everything else that arrives.
  if (next.animals.includes(0) && next.eggDay !== day && next.parcels < PARCELS_MOST) next = { ...next, eggDay: day, parcels: next.parcels + 1 };
  // Pip's walk, from a camp kept while walks were still sent (they are not since 2026-10-15): read through, she is
  // back, and what she found is a parcel.
  if (next.trip && read - next.trip.from >= next.trip.needs && next.parcels < PARCELS_MOST) next = { ...next, trip: null, parcels: next.parcels + 1 };
  // A day's reading goal met sends a parcel, once a day. (`wishDay`, which was the day Pip's wish was granted, is the
  // day this one came: the wish and the heroes' wants became this one parcel on 2026-10-15.)
  if (now.goalMet === true && next.wishDay !== day && next.parcels < PARCELS_MOST) {
    next = { ...next, wishDay: day, parcels: next.parcels + 1, events: noted(next, day, "Your reading goal was met: a parcel came up the path.") };
    // And everyone who lives in the camp is a step fonder of it. Friendship grew from the heroes' wants until they were
    // put away; without this, the three blades a hero gives as a friend (`BLADE_AT_BOND`) could no longer be had.
    const before = bladesWon(next);
    next = { ...next, bonds: next.bonds.map((had, hero) => (heroHere(next, hero) ? Math.min(BOND_MOST, had + 1) : had)) };
    for (const blade of bladesWon(next).filter((owned) => !before.includes(owned))) {
      next = { ...next, events: noted(next, day, `${HEROES[BLADES[blade].hero ?? 0].short} is a friend now, and gives the camp ${BLADES[blade].name}.`) };
    }
  }
  // (The heroes' daily wants were reset here each day. They are not asked since 2026-10-15, and `wants` is left as it was.)
  // A library restored from before she set out: the walk starts from here.
  if (next.trip && next.trip.from > read) next = { ...next, trip: { ...next.trip, from: read } };
  // A library restored from before the camp: the counts start again from here.
  if (next.oakFrom > read || next.raidFrom > read || next.purseFrom > read || next.jobs.some((job) => job.from > read)) {
    next = {
      ...next,
      oakFrom: Math.min(next.oakFrom, read),
      raidFrom: Math.min(next.raidFrom, read),
      purseFrom: Math.min(next.purseFrom, read),
      jobs: next.jobs.map((job) => ({ ...job, from: Math.min(job.from, read) })),
      wreck: next.wreck ? { ...next.wreck, from: Math.min(next.wreck.from, read) } : null
    };
  }
  // Whatever is going up stands (`finishJobs`): kept from before 1.5.8, it was waiting on reading.
  next = finishJobs(next, read, day);
  next = settleWelcome(next, read, day);
  if (next.night !== day) {
    // A day has turned. The calendar night used to be fought here, out of sight (`nightOutcome`): since 2026-10-15
    // it is not, and the prowlers the picture shows are the only thing that comes at the camp. The night is still
    // marked as through, so that bringing the battle back would not play every night since.
    if (next.night !== null) {
      // The bees have been busy: a parcel of honey for every level of the hives.
      const honey = Math.min(PARCELS_MOST - next.parcels, yardLevel(next, "hive"));
      if (honey > 0) next = { ...next, parcels: next.parcels + honey };
    }
    next = { ...next, night: day, nightAt: read };
  }
  // A chapter may have opened a trap spot or a tower pad; a camp just brought onto the front has its constructs seated.
  return seatShed(fronted(advanceList(next, day)));
};
/** A camp just brought onto the front: what is in its shed goes onto the free spots and pads that are open, in the order it was sorted (the nearest the trail first). */
const seatShed = (state: BaseState): BaseState => {
  if (!state.front.seat) return state;
  const open = frontOpen(state);
  const spots = [...state.front.spots];
  const pads = [...state.front.pads];
  const shed: number[] = [];
  for (const kind of state.front.shed) {
    const list = isTrap(kind) ? spots : isTower(kind) ? pads : null;
    const free = list ? list.findIndex((entry, index) => entry < 0 && index < (isTrap(kind) ? open.spots : open.pads)) : -1;
    if (list && free >= 0) list[free] = kind;
    else shed.push(kind);
  }
  const { seat: _seated, ...front } = state.front;
  return fronted({ ...state, front: { ...front, spots, pads, shed } });
};

/**
 * The welcome, brought up to now: the first reading after it sends its one
 * parcel up the path (as one of the parcels, the first opened, with
 * `FIRST_READ_PARCEL` in it), and once the session is over and the reader
 * has read since, the prowlers come. Only real reading moves either.
 */
const settleWelcome = (state: BaseState, read: number, day: string): BaseState => {
  let welcome = state.welcome;
  if (!welcome?.given) return state;
  let next = state;
  // A library restored from before the welcome: it counts from here.
  if (welcome.from > read) welcome = { ...welcome, from: read };
  if (welcome.firstReadParcel === "waiting" && read - welcome.from >= FIRST_READ_MINUTES && next.parcels < PARCELS_MOST) {
    welcome = { ...welcome, firstReadParcel: "sent" };
    next = { ...next, parcels: next.parcels + 1, events: noted(next, day, "A big parcel came up the path, from your first reading.") };
  }
  if (welcome.prowlersAfterRead && read > welcome.from && (welcome.tutorial.done || welcome.firstReadParcel !== "waiting")) welcome = { ...welcome, prowlersAfterRead: false };
  return welcome === state.welcome ? next : { ...next, welcome };
};

/** Whether prowlers come out of the wood at this camp: from chapter 3, once a new camp's reader has read after the welcome. */
export const prowlersCome = (state: BaseState) => opened(state, undefined, "prowlers") && !state.welcome?.prowlersAfterRead;

/** A prowler was seen off, while the camp was watched: counted, for the chapter's goal. */
export const seenOff = (state: BaseState): BaseState => ({ ...state, stats: { ...state.stats, seenOff: (state.stats.seenOff ?? 0) + 1 } });

/**
 * The chapters, brought up to now (1.5.10): the minutes read are kept (the
 * most the camp has been told of), a camp from before chapters is brought
 * onto them once, a chapter newly reached pays its chest, and the burrow
 * goes up with the chapter (never down).
 *
 * Brought onto chapters, a camp from before keeps everything (`legacy`), is
 * paid one chest (`WELCOME_CHEST`) and none for the chapters its reading had
 * already reached, has the goals it has already done ticked off without pay,
 * and is held to what the oak, the scouts' rest and the arcade's runs could
 * hold before: what the old rules let go is not paid out all at once.
 */
const settleChapters = (state: BaseState, read: number, day: string): BaseState => {
  let next = read > state.minutes ? { ...state, minutes: read } : state;
  const chapter = chapterOf(next.minutes);
  if (next.chapterSeen < 0) {
    const drops = oakDrops(next);
    const oakMost = oakHolds(next);
    const oakFrom = drops > 0 && oakRead(next, read) > oakMost ? read - Math.ceil((oakMost * OAK_EVERY) / drops) : next.oakFrom;
    next = {
      ...next,
      legacy: next.legacy ?? { burrow: next.levels.burrow },
      oakFrom: Math.min(read, Math.max(next.oakFrom, oakFrom)),
      raidFrom: Math.max(next.raidFrom, read - RAID_EVERY * OLD_RAIDS_IN_HAND),
      purseFrom: Math.max(next.purseFrom, read - PURSE_EVERY * OLD_PURSE_IN_HAND),
      chapterSeen: 0,
      chapterPaid: chapter,
      goals: [...new Set([...next.goals, ...GOALS.filter((goal) => goal.done(next)).map((goal) => goal.id)])],
      acorns: next.acorns + WELCOME_CHEST
    };
    next = { ...next, events: noted(next, day, `Your camp is counted in chapters now: chapter ${chapter}, ${hoursWords(next.minutes)} read. A chest of ${WELCOME_CHEST} acorns.`) };
  }
  for (let ch = next.chapterPaid + 1; ch <= chapter; ch++) {
    const brings = chapterBrings(ch);
    next = { ...next, chapterPaid: ch, acorns: next.acorns + brings.chest };
    next = { ...next, events: noted(next, day, `${brings.title}. ${brings.says}.${brings.chest > 0 ? ` A chest of ${brings.chest} acorns.` : ""}`) };
  }
  const burrow = Math.max(next.levels.burrow, burrowOfChapter(chapter));
  if (burrow > next.levels.burrow) next = seatPlots({ ...next, levels: { ...next.levels, burrow } });
  return next;
};

/** The night has been looked at. */
export const seenReport = (state: BaseState): BaseState => (state.report ? { ...state, report: null } : state);

// ---- raids ---------------------------------------------------------------------------

/** The camps' names, by how far along they are; the last one's serves every camp after it. */
const CAMP_NAMES = ["The Twig Nest", "Bramble Roost", "The Tin Hoard", "Crow's Corner", "The Old Rookery"];
/** Camps to a name: three of each, growing, before the next kind. */
const CAMPS_A_NAME = 3;

export type RaidPlan = {
  kind: RaidKind;
  /** How hard it is: a stronghold's place on the ladder, or the camp the others are as hard as. */
  n: number;
  /** Which of the day's camps on the road it is. */
  slot?: number;
  /** Which camp of its size: 0 for a stronghold, which is always the same one. */
  seed: number;
  name: string;
  /** Which picture: 0 to 4 for a camp. */
  tier: number;
  cost: number;
  /** What a camp pulled down whole gives up. */
  loot: number;
  /** Stars that count as winning it. */
  need: number;
  /** The villain who guards it, if one does: which one. */
  champion: number | null;
};

/** `YYYY-MM` of a day. */
export const monthOf = (day: string) => day.slice(0, 7);
/** The season a day falls in: 0 summer, 1 autumn, 2 winter, 3 spring (the northern year). */
export const seasonOf = (day: string) => {
  const month = Number(day.slice(5, 7));
  return month >= 6 && month <= 8 ? 0 : month >= 9 && month <= 11 ? 1 : month === 12 || month <= 2 ? 2 : 3;
};
/**
 * What the season does. The clearing has always been drawn in its season;
 * this is the season telling in the game as well, and lightly: one thing
 * each, three of them a small good and winter a harder night with a warmer
 * fire. They follow the calendar (the northern year's), so nothing is
 * stored for them and nothing has to be kept in step between devices.
 */
export const SEASONS = [
  { name: "Summer", does: "Long days: raids bring a tenth more" },
  { name: "Autumn", does: "The oak is heavy: a fifth more from every gathering" },
  { name: "Winter", does: "Long nights: more prowlers about, and a campfire has the worn out up in a third of the time" },
  { name: "Spring", does: "Everything mends: putting a building right costs a quarter less" }
] as const;
export const SUMMER_RAIDS = 1.1;
export const AUTUMN_OAK = 0.2;
export const WINTER_FIRE = 3;
export const SPRING_MENDS = 0.75;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;

const lootTimes = (state: BaseState) => (state.forks.hut === "b" ? 1.25 : 1) * (state.pack ? 1.5 : 1) * (hasAnimal(state, 4) ? FOX_MORE : 1);
const tierOf = (n: number) => Math.min(CAMP_NAMES.length - 1, Math.floor(n / CAMPS_A_NAME));

/** The next stronghold on the ladder: taking it moves the camp on, and makes the road richer. */
export const nextCamp = (state: BaseState): RaidPlan => {
  const n = state.camps;
  // The last stronghold of each name is its lord's own.
  const champion = lordOf(n);
  // Supplies are free since 1.5.10 (they were 5 + 3 a stronghold): a raid lost costs the scouts' rest and nothing else.
  return { kind: "camp", n, seed: 0, name: CAMP_NAMES[tierOf(n)], tier: tierOf(n), cost: 0, loot: strongholdLoot(state, n), need: 1, champion };
};
const strongholdLoot = (state: BaseState, n: number) => Math.round((20 + n * 10) * lootTimes(state));

/**
 * A rematch (1.5.10): the last stronghold taken, again. The magpies have not
 * got over it, so it is a sure thing (★★★ whatever is sent, and the forecast
 * says so), for a small share of what it was worth; it moves nothing on. An
 * acorn top-up with nothing to judge. Null before any stronghold has fallen.
 */
export const rematchOf = (state: BaseState): RaidPlan | null => {
  if (state.camps < 1) return null;
  const n = state.camps - 1;
  return { kind: "rematch", n, seed: 0, name: CAMP_NAMES[tierOf(n)], tier: tierOf(n), cost: 0, loot: Math.max(1, Math.round(strongholdLoot(state, n) * REMATCH_LOOT)), need: 1, champion: null };
};

/**
 * How hard the King is, by the hut's level: set where scouts of that level,
 * sent by themselves, do not take him, and where with a hero most of them do.
 * He is measured against the scouts and not the ladder, so a reader who has
 * taken few strongholds does not get an easy banner for it.
 */
const KING_AT = [1, 1, 4, 7, 10, 13];

/** This month's King: a roost, with a roost's worth more of everything than a stronghold of its size, and wanting two stars. */
export const theKing = (state: BaseState): RaidPlan => {
  const n = KING_AT[Math.min(MAX_LEVEL, Math.max(0, state.levels.hut))];
  return { kind: "king", n, seed: 0, name: "The Magpie King", tier: tierOf(n), cost: 0, loot: Math.round((80 + state.camps * 12) * lootTimes(state)), need: 2, champion: KING_CHAMPION };
};
export const KING_NEEDS_CAMPS = KING_FROM_CAMPS;

/** The three camps on the road each day: an easy one, an even one and a rich one. */
const ROAD: ReadonlyArray<{ name: string; easier: number; loot: number }> = [
  { name: "Stragglers", easier: 3, loot: 0.6 },
  { name: "A magpie patrol", easier: 1, loot: 1 },
  { name: "A loot caravan", easier: -1, loot: 1.7 }
];
export const ROAD_CAMPS = ROAD.length;
/**
 * How hard each of the three is at least, by the hut's level: set where
 * scouts of that level, sent by themselves, take the first whole, the second
 * with two stars about, and the third with one or two. So there is always a
 * raid that is a stretch, however few strongholds have been taken.
 */
const ROAD_AT: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [5, 7, 8],
  [6, 8, 9],
  [8, 11, 12],
  [11, 14, 17],
  [17, 21, 24]
];
/** The same, for a camp a hero has come to: word of a hero gets round, and the road is ready for one. */
const ROAD_AT_HERO: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [6, 8, 9],
  [8, 10, 12],
  [10, 13, 16],
  [15, 19, 24],
  [21, 25, 29]
];

/**
 * A camp met on the road today. There are three, new ones every day, and
 * each can be raided once: they are what there is to raid on a day when the
 * next stronghold is out of reach, which is most days. Taking one moves
 * nothing on; it pays, and the richer one pays for the risk.
 *
 * How hard one is goes by the scouts (the hut's level, and whether a hero
 * has come to the camp) and by the ladder, whichever asks more. What it costs and pays goes by the ladder alone: the
 * road gets richer by taking strongholds, not by building.
 */
export const roadCamp = (state: BaseState, day: string, slot: number): RaidPlan => {
  const at = Math.min(ROAD.length - 1, Math.max(0, slot));
  const road = ROAD[at];
  const along = Math.max(0, state.camps - road.easier);
  const least = HEROES.some((hero) => heroHere(state, hero.id)) ? ROAD_AT_HERO : ROAD_AT;
  const n = Math.max(along, least[Math.min(MAX_LEVEL, Math.max(0, state.levels.hut))][at]);
  return {
    kind: "wild",
    n,
    slot,
    seed: 1 + (hashOf(`${day}|${slot}`) % 100_000),
    name: road.name,
    tier: tierOf(n),
    cost: 0,
    loot: Math.round((8 + along * 4) * road.loot * lootTimes(state)),
    need: 1,
    champion: null
  };
};
/** Whether one of today's camps on the road has been raided. */
export const roadDone = (state: BaseState, day: string, slot: number) => state.wild.day === day && state.wild.done.includes(slot);

/** The raid of a kind, as things stand. (A rematch before any stronghold has fallen is the first stronghold's.) */
export const planFor = (state: BaseState, kind: RaidKind, day: string, slot = 0): RaidPlan =>
  kind === "king" ? theKing(state) : kind === "camp" ? nextCamp(state) : kind === "rematch" ? (rematchOf(state) ?? { ...nextCamp(state), kind: "rematch", champion: null }) : roadCamp(state, day, slot);

/**
 * Why the King cannot be gone after today, or null when he can. He comes with chapter 10 (1.5.10); a camp from before
 * chapters still has him from ten strongholds, as it did. ("camps" is no longer said: "chapter" is.)
 */
export const kingClosed = (state: BaseState, day: string): "chapter" | "camps" | "won" | "today" | null =>
  !opened(state, undefined, "king") ? "chapter" : state.banners.includes(monthOf(day)) ? "won" : state.kingDay === day ? "today" : null;

/** Raids the scouts are rested for: one for every quarter hour read, a few in hand at most. */
export const raidsReady = (state: BaseState, minutesRead: number) =>
  Math.min(RAIDS_IN_HAND, Math.floor(Math.max(0, Math.floor(minutesRead) - state.raidFrom) / RAID_EVERY));
/** Minutes of reading until the scouts are rested for another; 0 when they have all the rest they can use. */
export const restIn = (state: BaseState, minutesRead: number) =>
  raidsReady(state, minutesRead) >= RAIDS_IN_HAND ? 0 : RAID_EVERY - (Math.max(0, Math.floor(minutesRead) - state.raidFrom) % RAID_EVERY);

/** One thing earned by reading is spent: the mark moves on by its price, and a full hand starts counting from now. */
const spend = (from: number, minutesRead: number, every: number, inHand: number) => {
  const now = Math.floor(minutesRead);
  return now - from >= every * inHand ? now - every * (inHand - 1) : from + every;
};

/** Why a raid cannot set out. ("acorns" is never said since supplies are free; "none": there is no stronghold to rematch yet.) */
export type RaidBlocked = "hut" | "rest" | "acorns" | "chapter" | "camps" | "won" | "today" | "done" | "none";

/** Why a raid cannot set out, or null when it can. */
export const raidBlocked = (state: BaseState, kind: RaidKind, now: Now, slot = 0): RaidBlocked | null => {
  if (state.levels.hut < 1) return "hut";
  if (kind === "king") {
    const closed = kingClosed(state, now.day);
    if (closed) return closed;
  }
  if (kind === "wild" && roadDone(state, now.day, slot)) return "done";
  if (kind === "rematch" && state.camps < 1) return "none";
  if (raidsReady(state, now.minutes) < 1) return "rest";
  return state.acorns < planFor(state, kind, now.day, slot).cost ? "acorns" : null;
};

/** A raid that has set out: where to, with whom. */
export type Raid = { plan: RaidPlan; setup: Setup; month: string | null };

const setupFor = (state: BaseState, plan: RaidPlan, tipped: boolean, at?: number): Setup => ({
  n: plan.n,
  king: plan.kind === "king",
  capacity: scoutsOf(state) + (tipped ? TIP_SCOUTS : 0),
  level: state.levels.hut,
  kinds: trained(state),
  fast: state.forks.hut === "a",
  seed: plan.seed,
  hero: heroWith(state, at),
  champion: plan.champion,
  // (1.5.11) Down the trail, from the left; and the Puffcaps the hut has trained.
  drop: DROP_STRONGHOLD,
  bombers: bombersOf(state)
});

/** Trophies in all: what a hero may be brought by, whatever kind they are. */
const trophies = (state: BaseState) => Math.max(state.raised.length, state.shelf.reduce((sum, count) => sum + count, 0));
/** Whether a hero has come to the camp. */
export const heroHere = (state: BaseState, id: number) => heroOpen(state.shelf, trophies(state), id);
/** The hero who goes on the next raid: the one chosen, if they are here; sturdier and surer for every step of friendship. */
export const heroWith = (state: BaseState, at?: number) => {
  // One who is worn out and asleep goes nowhere: the scouts go without them.
  const traits = state.hero !== null && heroHere(state, state.hero) && !isAsleep(state, 100 + state.hero, at) ? heroTraits(state.hero) : null;
  if (!traits) return null;
  const knows = 1 + BOND_STRONGER * bondOf(state, traits.id);
  const blade = BLADES[bladeOf(state, traits.id)]?.gives ?? {};
  return {
    ...traits,
    hp: Math.round(traits.hp * knows * (blade.hp ?? 1)),
    dps: Math.round(traits.dps * knows * (blade.dps ?? 1) * 10) / 10,
    speed: Math.round(traits.speed * (blade.speed ?? 1) * 10) / 10,
    reach: traits.reach + (blade.reach ?? 0),
    ...(blade.splash ? { splash: Math.max(traits.splash ?? 0, blade.splash) } : {}),
    ...(blade.champion ? { times: { ...traits.times, champion: (traits.times?.champion ?? 1) * blade.champion } } : {})
  };
};
/** Chooses who goes on raids; null for nobody. */
export const chooseHero = (state: BaseState, id: number | null): BaseState =>
  id === state.hero || (id !== null && !heroHere(state, id)) ? state : { ...state, hero: id };
/** The villain's name, for a raid that has one. */
export const championName = (plan: RaidPlan) => (plan.champion === null ? null : CHAMPIONS[plan.champion]);

/**
 * Sets out: the provisions are paid, the scouts' rest is spent, and a tip (if
 * one is used) is two more of them. From here the raid is fought
 * (`battle.ts`) and `finishRaid` takes how it went; a raid walked away from
 * has already cost what it costs, so leaving is not a way out of a bad one.
 */
export const startRaid = (state: BaseState, kind: RaidKind, now: Now, tip = false, slot = 0): { state: BaseState; raid: Raid } | null => {
  if (raidBlocked(state, kind, now, slot)) return null;
  const plan = planFor(state, kind, now.day, slot);
  const tipped = tip && state.intel > 0;
  const setup = setupFor(state, plan, tipped, now.at);
  return {
    state: {
      ...state,
      acorns: state.acorns - plan.cost,
      intel: state.intel - (tipped ? 1 : 0),
      raidFrom: spend(state.raidFrom, now.minutes, RAID_EVERY, RAIDS_IN_HAND),
      kingDay: kind === "king" ? now.day : state.kingDay,
      wild: kind === "wild" ? { day: now.day, done: [...(state.wild.day === now.day ? state.wild.done : []), slot] } : state.wild
    },
    raid: { plan, setup, month: kind === "king" ? monthOf(now.day) : null }
  };
};

export type RaidEnd = {
  won: boolean;
  stars: number;
  loot: number;
  name: string;
  banner: string | null;
  /** The next stronghold emptied at the news. Never since 1.5.10 (the ladder moves one step at a time): kept for old screens. */
  fled: boolean;
  /** Acorns more for taking a stronghold with all three stars (`THREE_STAR_BONUS`); already in `loot`. */
  bonus: number;
  /** A blade won with it: a lord's, or the King's, the first time he falls. */
  blade: number | null;
  /** A thing the raiders had carried off, brought home: which kind. */
  home: number | null;
};

// ---- worn out, and asleep --------------------------------------------------------------

/**
 * The camp's fighters are not made of stone. One who goes out to a prowler
 * and does not finish him takes a knock for it; at three they are worn
 * out, and sleep for three hours by the wall clock, wherever their post
 * is. Knocks that are an hour old are shaken off. A friend's raid that
 * took two stars or three leaves every guardian asleep the same way. One
 * who is asleep fights nobody: not the prowlers, and not at their post in
 * the night's fight. So a guardian left to hold a side alone is soon not
 * holding it, and one who is backed up by what throws never tires.
 * Sleeping is by the clock and not by reading: being away is what mends
 * it, so nothing here asks anybody to come back.
 */
export const WOUNDS_MOST = 3;
export const REST_MS = 3 * 60 * 60 * 1000;
/** A campfire set down in the camp is where the worn out are laid: by it they are on their feet again in half the time. */
export const hasFire = (state: BaseState) => state.decor.some((entry) => entry.kind === 10);
export const restMs = (state: BaseState, day?: string) => (hasFire(state) ? REST_MS / (day !== undefined && seasonOf(day) === 2 ? WINTER_FIRE : 2) : REST_MS);
const SHAKEN_OFF_MS = 60 * 60 * 1000;
/** Whether one of the camp's fighters is asleep at a time (none are, when no time is said). */
export const isAsleep = (state: BaseState, who: number, at?: number) => at !== undefined && (state.tired[who]?.until ?? 0) > at;
/** Until when they sleep, in milliseconds; 0 for one who is awake. */
export const asleepUntil = (state: BaseState, who: number, at: number) => (isAsleep(state, who, at) ? state.tired[who]!.until : 0);
/** The knocks one of them is carrying at a time: none once slept off, or shaken off. */
export const woundsOf = (state: BaseState, who: number, at: number) => {
  const kept = state.tired[who];
  if (!kept) return 0;
  if (kept.until > at) return WOUNDS_MOST;
  return kept.until > 0 || at - kept.since > SHAKEN_OFF_MS ? 0 : kept.wounds;
};
/** Everyone who is asleep at a time. */
export const sleepers = (state: BaseState, at: number): number[] =>
  Object.keys(state.tired)
    .map(Number)
    .filter((who) => isAsleep(state, who, at));
const fighterName = (who: number) => (who >= 100 ? (HEROES.find((hero) => hero.id === who - 100)?.short ?? "A hero") : (GUARDIANS[who]?.short ?? "A guardian"));
/** One of them took a knock: the third puts them to sleep. */
export const woundFighter = (state: BaseState, who: number, at: number, day: string): BaseState => {
  if (isAsleep(state, who, at)) return state;
  const wounds = Math.min(WOUNDS_MOST, woundsOf(state, who, at) + 1);
  const out = wounds >= WOUNDS_MOST;
  return {
    ...state,
    tired: { ...state.tired, [who]: { wounds, since: at, until: out ? at + restMs(state, day) : 0 } },
    events: out ? noted(state, day, `${fighterName(who)} is worn out, and asleep for a few hours.`) : state.events
  };
};

// ---- the guardians' signposts ---------------------------------------------------------

/**
 * A guardian keeps to the ground about a signpost. It starts beside the
 * building they were posted at, and the reader can carry it anywhere in
 * the clearing: that is where the guardian stands, whom they come out to
 * fight (anyone within `POST_REACH` of it), and where they stand in the
 * night's fight, when they throw at whatever comes that near. What they do
 * for their building they go on doing wherever the post is. The dragon has
 * no post: she keeps to the larder's roof.
 */
export const POST_REACH = 20;
type Posted = {
  spots: Record<Placed, Spot>;
  walls: ReadonlyArray<readonly [number, number]>;
  yard: ReadonlyArray<{ kind: YardKind | null; level: number }>;
  posts?: Partial<Record<number, readonly [number, number]>>;
  /** (1.5.11) Where the wall across the trail stands: the guardians are posted on the front about it. */
  line?: number | null;
  front?: { x: number };
};
/**
 * Where each guardian stands on the front by default (1.5.11), from the wall's line and the trail: Halvar on the wall
 * by the gate, Corwin at the gate, Mossgather out on the trail, Dame Berit just inside the gate, Ilsa among the
 * towers. (Pim keeps to the yard, and Emberling to the larder's roof.)
 */
const FRONT_POSTS: Partial<Record<number, readonly [number, number]>> = { 0: [5, -12], 1: [6, 8], 2: [-18, 9], 3: [16, 3], 6: [24, 12] };
/** Where a guardian's signpost is: where it was carried to, or beside their building. Null for one with no post on the ground, or nowhere yet to stand it. */
export const postSpotOf = (camp: Posted, guard: number): Spot | null => {
  const post = GUARDIANS[guard]?.post;
  if (!post || post === "store") return null;
  const moved = camp.posts?.[guard];
  if (moved) return [moved[0], moved[1]];
  const onFront = FRONT_POSTS[guard];
  const line = camp.line ?? camp.front?.x ?? null;
  if (onFront && line !== null) return [Math.round(line + onFront[0]), TRAIL_Y + onFront[1]];
  // Beside the building, on the side away from the middle of the clearing.
  const beside = (site: Placed): Spot => {
    const [x, y] = camp.spots[site];
    const out = REACH[site] * FOOT + 7;
    return [Math.round(Math.min(DECOR_LAND.right, Math.max(DECOR_LAND.left, x > 140 ? x + out : x - out))), Math.min(DECOR_LAND.bottom, y + 1)];
  };
  if (post === "fence") return camp.walls[0] ? [Math.max(DECOR_LAND.left, camp.walls[0][0] - 10), Math.min(DECOR_LAND.bottom, camp.walls[0][1] + 3)] : null;
  if (post === "yard") {
    const index = camp.yard.findIndex((slot) => slot.kind !== null && slot.level > 0);
    return index < 0 ? null : beside(index === 0 ? "yard0" : "yard1");
  }
  return beside(post);
};
/** Carries a posted guardian's signpost to somewhere else in the clearing: as often as the reader likes, for nothing. */
export const movePost = (state: BaseState, guard: number, x: number, y: number): BaseState => {
  if (guardOf(state, guard) <= 0 || !GUARDIANS[guard] || GUARDIANS[guard].post === "store") return state;
  const at = onLand(x, y, woodOf(state));
  return { ...state, posts: { ...state.posts, [guard]: [at.x, at.y] } };
};

// ---- prowlers who got through --------------------------------------------------------

/**
 * Between raids, prowlers come out of the wood one at a time (the picture
 * shows them: `scene.ts`). Where enough of the camp reaches the way one
 * comes, he is seen off and that is all. Where it does not, he gets to the
 * building he came for and knocks it about: a knock is kept here, four at
 * most to a building. It costs acorns to put right, more for a better
 * building, and the building is not built on until it is. A camp laid out
 * so that every way in is watched takes none. They come only while the
 * camp is being looked at, so nothing is knocked about behind a reader's
 * back; and four knocks is all a building ever has.
 */
export const HARM_MOST = 4;
export const harmOf = (state: BaseState, site: Site) => state.harm[site as Placed] ?? 0;
/**
 * Knocked about as far as it goes, a building is broken, and that is more
 * than how it looks: one that throws, throws at nobody (by night, or at a
 * prowler); and a broken larder hides nothing of what is in it. It is put
 * right for the same acorns as any knocks are.
 */
export const isBroken = (state: BaseState, site: Site) => harmOf(state, site) >= HARM_MOST;
/** What each building stops doing while it is broken, in a few words: for whoever is deciding what to mend first. */
/** What each building does a tenth less of for every knock it has, short of broken: for the same reader. Nothing, for the yard. */
export const WORN_DOES: Record<Placed, string> = {
  burrow: "it throws a tenth less hard",
  oak: "it drops a tenth fewer acorns",
  store: "it hides a tenth less",
  tower: "it throws a tenth less hard",
  hut: "it throws a tenth less hard",
  yard0: "",
  yard1: ""
};
export const BROKEN_DOES: Record<Placed, string> = {
  burrow: "it throws at nobody",
  oak: "it drops half as many acorns",
  store: "it hides none of what is in it",
  tower: "it throws at nobody",
  hut: "it throws at nobody, and has a bed for one hero only",
  yard0: "it does nothing for the camp",
  yard1: "it does nothing for the camp"
};
/** The buildings a prowler has got to, and not been put right since. */
export const harmed = (state: BaseState): Placed[] => PLACED.filter((site) => harmOf(state, site) > 0);
/** A prowler got to a building that stands: one more knock, said the first time. */
/**
 * How much prowlers can do in a day, whatever gets through: two knocks
 * and one theft. They only come while the camp is on screen, and a camp
 * left on screen is looked at for as long as the reader likes; without a
 * limit, a camp that stops nothing lost in an afternoon of watching what
 * a day of reading brings (measured: as much as it earned). A loss here is
 * meant to be a nudge to stand something by the larder, not a tax on
 * looking at one's own camp. After the day's share, whoever gets through
 * finds nothing left worth the trouble and goes off again.
 */
export const KNOCKS_A_DAY = 2;
export const THEFTS_A_DAY = 1;
const prowledOn = (state: BaseState, day: string) => (state.prowled.day === day ? state.prowled : { day, knocks: 0, thefts: 0 });
export const harmSite = (state: BaseState, site: Placed, day: string): BaseState => {
  const had = harmOf(state, site);
  const today = prowledOn(state, day);
  if (had >= HARM_MOST || levelOf(state, site) === 0 || today.knocks >= KNOCKS_A_DAY) return state;
  return {
    ...state,
    harm: { ...state.harm, [site]: had + 1 },
    prowled: { ...today, knocks: today.knocks + 1 },
    events: had === 0 ? noted(state, day, `A prowler got to the ${siteName(state, site).toLowerCase()}.`) : state.events
  };
};
/** What it costs to put a building right: by how knocked about it is, and how good a building it is. */
/** The owl keeps watch: mending is a quarter cheaper with her about (her own good thing since 2026-10-15, when the night she watched for was put away). */
export const OWL_MENDS = 0.75;
export const fixCost = (state: BaseState, site: Site, day?: string) =>
  Math.ceil(harmOf(state, site) * (2 + levelOf(state, site)) * (day !== undefined && seasonOf(day) === 3 ? SPRING_MENDS : 1) * (hasAnimal(state, 3) ? OWL_MENDS : 1));
/** Puts a building right, for acorns; unchanged when there is nothing to fix or not enough to fix it with. */
export const fixSite = (state: BaseState, site: Placed, day?: string): BaseState => {
  const cost = fixCost(state, site, day);
  if (cost === 0 || state.acorns < cost) return state;
  const harm = { ...state.harm };
  delete harm[site];
  return { ...state, acorns: state.acorns - cost, harm };
};

/**
 * What a prowler makes off with. One who gets to the larder or the oak and
 * is still on his feet when he has done does more than knock it about: he
 * takes a few acorns with him. A few: what the larder hides is never
 * touched, and off the oak it is only what was hanging ready. It is why
 * the two of them are worth standing something beside.
 */
export const PROWLER_TAKES = (burrow: number) => 2 + Math.max(1, burrow);
export const robSite = (state: BaseState, site: Placed, minutesRead: number, day: string): { state: BaseState; taken: number } => {
  const most = PROWLER_TAKES(state.levels.burrow);
  const today = prowledOn(state, day);
  // One theft a day and no more (see `KNOCKS_A_DAY`).
  if (today.thefts >= THEFTS_A_DAY) return { state, taken: 0 };
  const robbed = { ...today, thefts: today.thefts + 1 };
  if (site === "store" && state.levels.store > 0) {
    const taken = Math.min(most, Math.max(0, state.acorns - hides(state)));
    return taken <= 0
      ? { state, taken: 0 }
      : { state: { ...state, acorns: state.acorns - taken, prowled: robbed, events: noted(state, day, `A prowler made off with ${taken} acorns from the larder.`) }, taken };
  }
  if (site === "oak" && state.levels.oak > 0) {
    const taken = Math.min(most, oakReady(state, minutesRead));
    if (taken <= 0) return { state, taken: 0 };
    // The oak's clock is set to the reading that what is left on it took to grow: however long the tree stood full,
    // it is those acorns that are gone, and no more.
    const left = oakReady(state, minutesRead) - taken;
    const oakFrom = Math.floor(minutesRead) - Math.ceil((left * OAK_EVERY) / oakDrops(state));
    return { state: { ...state, oakFrom, prowled: robbed, events: noted(state, day, `A prowler shook ${taken} acorns out of the oak and ran.`) }, taken };
  }
  return { state, taken: 0 };
};

// ---- friends' camps ---------------------------------------------------------------------

/**
 * Raiding a friend. Readers who follow each other can see each other's
 * camps; this lets one be fought over. The fight is here, on the raider's
 * own device, against the camp as the friend's card shows it: their
 * buildings where they put them, their fence, their constructs and their
 * guardians. Nothing is taken from the friend: the raider's prize is the
 * game's, and small. What the friend gets is the news of it, a camp that
 * wants mending (by a little reading, like everything else here), and the
 * wish for a better defence. A raid that takes no star is news too: the
 * camp held, and its owner is told so and thanked with acorns.
 */
export type SharedCamp = {
  levels: Record<BuildingId, number>;
  yard: ReadonlyArray<{ kind: YardKind | null; level: number }>;
  spots?: Partial<Record<Placed, readonly [number, number]>>;
  walls?: ReadonlyArray<readonly [number, number]>;
  works?: ReadonlyArray<{ kind: number; x: number; y: number }>;
  guards?: readonly number[];
  /** Where each guardian's signpost stands, in their order; null for one still beside their building. */
  posts?: ReadonlyArray<readonly [number, number] | null>;
};
/** Acorns a star on a friend's camp is worth to the raider, and what holding a friend off is worth to the one who held. */
export const FRIEND_PRIZE = 6;
export const HELD_PRIZE = 8;
/**
 * A camp fights harder at home than it has to against the night's raiders,
 * who are small: against a friend's scouts everything in it is this much
 * sturdier and throws this much harder. Measured again once the guardians
 * stood in the fight at their signposts (friend-tune.ts): scouts against a
 * camp of their own level take two stars, guardians posted or not; against
 * a bare one, three; against one two levels up with every guardian
 * trained, none.
 */
export const FRIEND_STURDY = 2;
export const FRIEND_HITS = 2;
/** Minutes of reading that mend the camp after a friend's raid, a star; and the most there is ever to mend. */
export const MEND_A_STAR = 4;
export const MEND_MOST = 20;

/** A friend's camp as their card shows it, stood up as a camp: for fighting over and nothing else. */
export const campOfShared = (camp: SharedCamp, day: string): BaseState => {
  const { front: _front, ...blank } = newBase(0, day);
  // (1.5.11) Brought onto the front as any camp kept from before it is (a card does not say where its slots are):
  // its wall across its trail at its fence's level, its constructs on the spots and pads its burrow would have.
  const read = readBase({
    ...blank,
    legacy: { burrow: Math.max(1, Math.min(MAX_LEVEL, Math.floor(camp.levels.burrow ?? 1))) },
    levels: camp.levels,
      yard: camp.yard,
      spots: { ...blank.spots, ...(camp.spots ?? {}) },
      walls: camp.walls ?? [],
      works: camp.works ?? [],
      guards: camp.guards ?? blank.guards,
    posts: Object.fromEntries((Array.isArray(camp.posts) ? camp.posts : []).map((spot, guard) => [guard, spot] as const).filter((entry) => Array.isArray(entry[1])))
  });
  return read ? seatShed(read) : newBase(0, day);
};

export type Friend = { handle: string; name: string };
/** A raid on a friend's camp: an ordinary raid, with the camp that is fought over handed in and whose it is. */
export type FriendRaid = Raid & { friend: Friend; structures: Structure[] };
export type FriendBlocked = "hut" | "today" | "rest";

/** Why a friend's camp cannot be raided now, or null when it can: each friend once a day, and for a raid's worth of the scouts' rest. */
export const friendBlocked = (state: BaseState, now: Now, handle: string): FriendBlocked | null =>
  state.levels.hut < 1 ? "hut" : state.rivals.day === now.day && state.rivals.raided.includes(handle) ? "today" : raidsReady(state, now.minutes) < 1 ? "rest" : null;

/** Sets out for a friend's camp. It costs the scouts' rest and nothing else. */
export const startFriendRaid = (state: BaseState, camp: SharedCamp, friend: Friend, now: Now): { state: BaseState; raid: FriendRaid } | null => {
  if (friendBlocked(state, now, friend.handle)) return null;
  const theirs = campOfShared(camp, now.day);
  const plan: RaidPlan = {
    kind: "wild",
    n: Math.max(0, theirs.levels.burrow - 1) * 3,
    seed: 0,
    name: `${friend.name}'s camp`,
    tier: Math.max(0, Math.min(4, theirs.levels.burrow - 1)),
    cost: 0,
    loot: 0,
    need: 1,
    champion: null
  };
  return {
    state: {
      ...state,
      raidFrom: spend(state.raidFrom, now.minutes, RAID_EVERY, RAIDS_IN_HAND),
      rivals: { day: now.day, raided: [...(state.rivals.day === now.day ? state.rivals.raided : []), friend.handle].slice(-60) }
    },
    raid: {
      plan,
      // Their constructs act on the scouts as they do on the night's raiders: a hedge cuts, a patch slows, a pit takes, a bell rings.
      setup: { ...setupFor(state, plan, false, now.at), works: true, drop: DROP_FRIEND },
      month: null,
      friend,
      structures: campStructures(theirs, false).map((entry) => ({ ...entry, hp: entry.hp * FRIEND_STURDY, max: entry.max * FRIEND_STURDY, hit: entry.hit * FRIEND_HITS }))
    }
  };
};

/** The raid on a friend is over: the raider's prize, and a line in the journal either way. */
export const finishFriendRaid = (state: BaseState, raid: FriendRaid, result: Result, day: string, at?: number): { state: BaseState; end: RaidEnd } => {
  const loot = give(state, result.stars * FRIEND_PRIZE);
  const won = result.stars >= 1;
  const text = won ? `Raided ${raid.friend.name}'s camp: ${result.stars} ${result.stars === 1 ? "star" : "stars"}.` : `${raid.friend.name}'s camp held against the scouts.`;
  return {
    state: heroHome({ ...state, acorns: state.acorns + loot, events: noted(state, day, text) }, raid, result, day, at),
    end: { won, stars: result.stars, loot, name: raid.plan.name, banner: null, fled: false, bonus: 0, blade: null, home: null }
  };
};

/** Minutes of reading the camp still wants before it is mended; 0 when there is nothing to mend. */
export const wreckLeft = (state: BaseState, minutesRead: number) => (state.wreck ? Math.max(0, state.wreck.needs - Math.max(0, Math.floor(minutesRead) - state.wreck.from)) : 0);

/**
 * Friends' raids on this camp, as the server hands them over. One that took
 * no star is good news: the camp held, and there are acorns for it. One
 * that took any knocks down a piece of fence a star (`putBack` lays them all
 * again, for nothing). Each is news (`news`), for a card on the next look.
 * Nothing is taken from the larder, nobody is put to sleep (two or three
 * stars put the guardians to sleep until 1.5.10), and nothing gets worse for
 * being left: this is a tease between friends, not a bill.
 * (`minutesRead` and `at` are no longer asked.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const sufferRaids = (state: BaseState, raids: ReadonlyArray<{ name: string; stars: number }>, _minutesRead: number, day: string, _at?: number): BaseState => {
  let next = state;
  for (const raid of raids) {
    const stars = Math.max(0, Math.min(3, Math.round(Number(raid.stars) || 0)));
    const name = (typeof raid.name === "string" ? raid.name : "").trim().slice(0, 40) || "A friend";
    if (stars === 0) {
      const prize = give(next, HELD_PRIZE);
      next = { ...next, acorns: next.acorns + prize, news: [{ by: name, stars, down: 0, prize, day }, ...next.news].slice(0, NEWS_KEPT), events: noted(next, day, `The camp held against ${name}'s scouts.`) };
      continue;
    }
    // (It used to leave the fence to be mended by reading too, four minutes a star: `MEND_A_STAR`. Since 1.5.8 the
    // pieces knocked down are all of it: put up again for nothing, as they always were.)
    // A section of the wall a star, the nearest the gate first (the gate itself among them).
    const fell = [...next.walls].sort((a, b) => Math.abs(a[1] - TRAIL_Y) - Math.abs(b[1] - TRAIL_Y) || a[1] - b[1]).slice(0, stars);
    const down = fell.length;
    next = fronted({
      ...next,
      // The gate goes back with its section; until then the camp has none.
      downed: [...next.downed, ...fell].slice(-60),
      news: [{ by: name, stars, down, prize: 0, day }, ...next.news].slice(0, NEWS_KEPT),
      events: noted(next, day, `${name}'s scouts raided the camp: ${stars} ${stars === 1 ? "star" : "stars"}.${down > 0 ? ` ${down} ${down === 1 ? "section" : "sections"} of the wall came down.` : ""}`)
    });
  }
  return next;
};

/** The friends' raids have been looked at: the card is not shown again. */
export const seeNews = (state: BaseState): BaseState => (state.news.length === 0 ? state : { ...state, news: [] });

/**
 * Puts every section of the wall friends knocked down back up, in one go,
 * for nothing.
 */
export const putBack = (state: BaseState): BaseState => (state.downed.length === 0 ? state : fronted({ ...state, downed: [] }));

/**
 * The one question about friends' raids (1.5.10): "Let friends raid your
 * camp?" Raids are off on the server until the reader says yes; this says
 * the camp has been asked, so it is asked once. Kept with the camp's marks,
 * so a second device does not ask again.
 */
export const RAIDS_ASKED = "raidsAsked";
export const raidsAsked = (state: BaseState) => state.taught.includes(RAIDS_ASKED);
export const askedRaids = (state: BaseState): BaseState => (raidsAsked(state) ? state : { ...state, taught: [...state.taught, RAIDS_ASKED] });

/** Whether a stronghold is its lord's own: the last of each name. */
const lordOf = (n: number) => ((n + 1) % CAMPS_A_NAME === 0 ? tierOf(n) : null);

/**
 * A raid is over. What came down is what is brought home (as far as the
 * larder has room), won or not; a star or better takes a camp, and the next
 * is harder; the King wants two, and gives up the month's banner.
 *
 * A stronghold taken with all three stars empties the next one too, at the
 * news of it (unless that one is a lord's own, who does not run): so a camp
 * whose scouts have outgrown the ladder is not long in catching it up.
 */
/**
 * A raid costs the hero who went, when it goes badly for them. Put down in
 * the fight, they come home worn out and sleep for three hours, like one
 * of the camp's own who has taken too many knocks: no raids, and no going
 * out to prowlers, until they wake. So a hero is not thrown at a camp that
 * is too much for them without a thought; and a camp that puts a friend's
 * hero down has that to show for it.
 */
const heroHome = (state: BaseState, raid: Raid, result: Result, day: string, at?: number): BaseState => {
  const hero = raid.setup.hero ?? null;
  if (!result.heroFell || !hero || at === undefined) return state;
  return {
    ...state,
    tired: { ...state.tired, [100 + hero.id]: { wounds: WOUNDS_MOST, since: at, until: at + restMs(state, day) } },
    events: noted(state, day, `${fighterName(100 + hero.id)} fell on the raid, and is asleep for a few hours.`)
  };
};

export const finishRaid = (state: BaseState, raid: Raid, result: Result, day: string, brings = 1, at?: number): { state: BaseState; end: RaidEnd } => {
  // In summer the days are long, and a raid brings more home.
  const ended = finishRaidPlain(state, raid, result, day, brings * (seasonOf(day) === 0 ? SUMMER_RAIDS : 1));
  return { ...ended, state: heroHome(ended.state, raid, result, day, at) };
};
const finishRaidPlain = (state: BaseState, raid: Raid, result: Result, day: string, brings = 1): { state: BaseState; end: RaidEnd } => {
  const { plan } = raid;
  const won = result.stars >= plan.need;
  // All three stars on a stronghold: a little more of its loot (1.5.10; it used to empty the next stronghold, which
  // moved the ladder two steps without a word of why).
  const bonus = won && plan.kind === "camp" && result.stars === 3 ? give(state, plan.loot * THREE_STAR_BONUS * brings) : 0;
  const loot = give(state, plan.loot * result.destroyed * brings) + bonus;
  const king = plan.kind === "king";
  const month = raid.month ?? monthOf(day);
  const what = plan.kind === "wild" ? plan.name : `Stronghold ${plan.n + 1}`;
  const fled = false;
  const line = king
    ? won
      ? `The Magpie King fell. ${monthName(month)}'s banner flies over the camp.`
      : "The Magpie King kept his nest."
    : plan.kind === "rematch"
      ? `${what} again: ${loot} acorns.`
      : won
        ? `${what} taken with ${result.stars} ${result.stars === 1 ? "star" : "stars"}: ${loot} acorns.`
        : `The raid on ${what[0].toLowerCase()}${what.slice(1)} was beaten back${loot > 0 ? `, with ${loot} acorns carried off` : ""}.`;
  const next: BaseState = {
      ...state,
      acorns: state.acorns + loot,
      // The pack is for a raid won: a lost one leaves it for the next.
      pack: won ? false : state.pack,
      camps: won && plan.kind === "camp" ? state.camps + 1 : state.camps,
      banners: won && king && !state.banners.includes(month) ? [...state.banners, month] : state.banners,
      // (A hero brought home from a raid won was noted for their daily want; wants are not asked since 2026-10-15.)
      stats: { ...state.stats, raids: state.stats.raids + (won ? 1 : 0), stars: state.stats.stars + result.stars },
      events: noted(state, day, line)
  };
  // What was carried off on a lost night is in the first camp on the road that falls.
  // A thing carried off on a night (from before the nights were put away) comes home with the next raid won, whatever it was on.
  const home = won && state.stolen ? state.stolen : null;
  // A blade is won the first time its lord falls.
  const blade = bladesWon(next).find((owned) => !bladesWon(state).includes(owned)) ?? null;
  return {
    state: {
      ...next,
      ...(home ? { stolen: null, decor: next.decor.length < DECOR_MOST ? [...next.decor, home] : next.decor } : {}),
      events:
        blade !== null
          ? noted({ ...next, events: next.events.slice(1) }, day, `${line} ${BLADES[blade].name} is the camp's.`)
          : home
            ? noted({ ...next, events: next.events.slice(1) }, day, `${line} The ${DECOR[home.kind].name.toLowerCase()} is home again.`)
            : next.events
    },
    end: { won, stars: result.stars, loot, name: plan.name, banner: won && king ? month : null, fled, bonus, blade, home: home?.kind ?? null }
  };
};

export const SENT_SHARE = SENT_BRINGS;

/**
 * What the scouts say of a raid before it sets out: how it would go if they
 * were left to it (fought by rule, every scout in from whichever side does
 * best). A camp is the same camp each time, so this is not a guess: it is
 * what sending them will do, and the least a reader who fights it well
 * should get. It is there so nobody pays for a raid that cannot be won
 * without being told.
 */
export const scoutsSay = (state: BaseState, plan: RaidPlan): Result | null =>
  state.levels.hut < 1 ? null : plan.kind === "rematch" ? SURE_WIN : autoBest(setupFor(state, plan, false));
/** A rematch's result, whoever goes: the magpies of a stronghold already taken do not stand. */
const SURE_WIN: Result = { stars: 3, destroyed: 1, hoards: 1 };

/** What the scouts say of a raid, in a plain sentence and stars, and whether they can be sent to it. */
export type Forecast = {
  stars: 0 | 1 | 2 | 3;
  /** "Your scouts take it whole", "Too strong for now: bring a hero or build up the hut". */
  words: string;
  /** Whether "Send" is there: not for a raid the scouts would lose. ("Fight it" always is.) */
  canSend: boolean;
  /** A rematch: nothing to judge. */
  sure: boolean;
  /** What sending them would bring, all told (before the season's more). */
  brings: number;
  /** (1.5.11) Where it is not taken whole: the one thing that would help most, in a few words; null otherwise. */
  hint: string | null;
};
const FORECAST_WORDS = [
  "Too strong for now: bring a hero or build up the hut",
  "Your scouts can just about take it",
  "Your scouts take it, though not all of it",
  "Your scouts take it whole"
];
export const raidForecast = (state: BaseState, plan: RaidPlan): Forecast => {
  const said = scoutsSay(state, plan);
  const stars = (said?.stars ?? 0) as Forecast["stars"];
  const won = said !== null && stars >= plan.need;
  const sure = plan.kind === "rematch";
  const bonus = won && plan.kind === "camp" && stars === 3 ? Math.round(plan.loot * THREE_STAR_BONUS * SENT_BRINGS) : 0;
  const brings = said ? Math.round(plan.loot * said.destroyed * SENT_BRINGS) + bonus : 0;
  const words = sure
    ? "A sure thing: they have not got over the last time"
    : plan.need > 1 && stars > 0 && !won
      ? "Not enough to take him: he needs two stars"
      : FORECAST_WORDS[stars];
  return { stars, words, canSend: won, sure, brings, hint: sure || stars === 3 || state.levels.hut < 1 ? null : raidHint(state, plan) };
};
/**
 * One thing that would help with a raid not taken whole (1.5.11): their wall, and the Puffcaps that open it; a flank
 * their wall leaves open; a hero; or, failing all of those, a better hut.
 */
const raidHint = (state: BaseState, plan: RaidPlan): string => {
  const setup = setupFor(state, plan, false);
  const walled = plan.kind !== "rematch" && layout(plan.n, plan.kind === "king", plan.seed).some((entry) => entry.kind === "wall");
  if (walled && bombersOf(state) === 0) return `Their wall is strong: Puffcaps come with the hut's level ${TRAINED_AT.bomber}`;
  const lane = autoBestLane(setup).side;
  if (walled && lane !== "left") return `Go round the ${lane === "top" ? "top" : "foot"} of their wall`;
  if (!setup.hero && HEROES.some((hero) => heroHere(state, hero.id))) return "Bring a hero";
  return state.levels.hut < MAX_LEVEL ? "A better hut sends more, and stronger" : "Bring a hero, or come back stronger";
};

/**
 * Sends the scouts without the reader, for a reader who would rather not
 * fight the raid (or cannot): it goes as the scouts said it would, and brings
 * less of the loot for it (`SENT_SHARE`). Null when they cannot set out, and
 * (1.5.10) when they would lose: "Send" is not a way to throw a raid's rest
 * away.
 */
export const sendRaid = (state: BaseState, kind: RaidKind, now: Now, slot = 0): { state: BaseState; end: RaidEnd } | null => {
  if (raidBlocked(state, kind, now, slot)) return null;
  if (!raidForecast(state, planFor(state, kind, now.day, slot)).canSend) return null;
  const begun = startRaid(state, kind, now, false, slot);
  return begun ? finishRaid(begun.state, begun.raid, kind === "rematch" ? SURE_WIN : autoBest(begun.raid.setup), now.day, SENT_BRINGS) : null;
};

/** One of the raid board's cards: what it is, the raid, what the scouts say, and why it cannot set out (null when it can). */
export type BoardCard = { kind: "rematch" | "camp" | "king"; plan: RaidPlan; forecast: Forecast; blocked: RaidBlocked | null };
/**
 * The raid board (1.5.10): the rematch (once a stronghold has fallen), the
 * next stronghold, and the King (from chapter 10, while this month's banner
 * is still his). Nothing on it costs acorns.
 */
export const raidBoard = (state: BaseState, now: Now): BoardCard[] => {
  const cards: BoardCard[] = [];
  const rematch = rematchOf(state);
  if (rematch) cards.push({ kind: "rematch", plan: rematch, forecast: raidForecast(state, rematch), blocked: raidBlocked(state, "rematch", now) });
  const next = nextCamp(state);
  cards.push({ kind: "camp", plan: next, forecast: raidForecast(state, next), blocked: raidBlocked(state, "camp", now) });
  if (opened(state, now.minutes, "king") && !state.banners.includes(monthOf(now.day))) {
    const king = theKing(state);
    cards.push({ kind: "king", plan: king, forecast: raidForecast(state, king), blocked: raidBlocked(state, "king", now) });
  }
  return cards;
};

/** How a raid went, in plain words, for the result screen. */
export const raidSummary = (end: RaidEnd): string => {
  const acorns = (count: number) => `${count} ${count === 1 ? "acorn" : "acorns"}`;
  if (end.banner) return `The Magpie King fell: his banner is yours, and ${acorns(end.loot)}.`;
  if (!end.won)
    return end.loot > 0 ? `Beaten back, with ${acorns(end.loot)} carried off. Nothing else lost but the scouts' rest.` : "Beaten back. Nothing lost but the scouts' rest.";
  const blade = end.blade !== null ? ` ${BLADES[end.blade].name} is the camp's.` : "";
  const whole = end.bonus > 0 ? ` All three stars: ${acorns(end.bonus)} of that is for taking it whole.` : "";
  // Inside a sentence a stronghold's own "The" is lower case: "You took the Twig Nest". Its name keeps its capitals.
  const name = end.name.replace(/^The /, "the ");
  return `You took ${name}: ${acorns(end.loot)}.${whole}${blade}`;
};

// ---- the arcade's other games ------------------------------------------------------------

/** Paid runs in hand: one for every ten minutes read, a few at most. */
export const purseLeft = (state: BaseState, minutesRead: number) =>
  Math.min(PURSE_IN_HAND, Math.floor(Math.max(0, Math.floor(minutesRead) - state.purseFrom) / PURSE_EVERY));
const wagersOn = (state: BaseState, day: string) => (state.purse.day === day ? state.purse.wagers : 0);
/** Wagers left today. */
export const wagersLeft = (state: BaseState, day: string) => Math.max(0, WAGERS_A_DAY - wagersOn(state, day));
/** What a paid run pays for its score. */
export const payout = (state: BaseState, game: PayingGame, score: number) =>
  Math.round(Math.min(PURSE_MOST, Math.max(0, Math.floor(score / POINTS_PER_ACORN[game]))) * (1 + STALL_MORE[yardLevel(state, "stall")]));
/** The score a paid run pays the most at. */
export const paysMostAt = (game: PayingGame) => PURSE_MOST * POINTS_PER_ACORN[game];

/** The reader's usual score in a game (the middle of the last few), or null before there are enough to say. */
export const usual = (state: BaseState, game: PayingGame): number | null => {
  const kept = state.scores[game];
  if (kept.length < USUAL_FROM) return null;
  const sorted = [...kept].sort((a, b) => a - b);
  return Math.max(USUAL_LEAST[game], sorted[Math.floor(sorted.length / 2)]);
};
/** The score a wager on a game has to reach: just past the usual. */
export const wagerTarget = (state: BaseState, game: PayingGame) => {
  const mine = usual(state, game);
  return mine === null ? null : mine + 1;
};
/** Runs of a game still to be played before its usual is known. */
export const runsToUsual = (state: BaseState, game: PayingGame) => Math.max(0, USUAL_FROM - state.scores[game].length);

export type WagerBlocked = "pending" | "usual" | "day" | "acorns";

/** Why a wager cannot be placed, or null when it can. */
export const wagerBlocked = (state: BaseState, game: PayingGame, stake: number, day: string): WagerBlocked | null =>
  state.wager ? "pending" : wagerTarget(state, game) === null ? "usual" : wagersOn(state, day) >= WAGERS_A_DAY ? "day" : state.acorns < stake ? "acorns" : null;

/**
 * Puts acorns on the next run of a game beating the reader's own usual. The
 * stake is taken now and the wager waits for a finished run, so leaving a bad
 * run is not a way to keep it.
 */
export const placeWager = (state: BaseState, game: PayingGame, stake: number, day: string): BaseState => {
  if (!(STAKES as readonly number[]).includes(stake) || wagerBlocked(state, game, stake, day)) return state;
  return { ...state, acorns: state.acorns - stake, purse: { day, wagers: wagersOn(state, day) + 1 }, wager: { game, stake, target: wagerTarget(state, game)! } };
};

export type GameEnd = { state: BaseState; paid: number; wager: { won: boolean; stake: number } | null };

/**
 * A finished game: it pays by its score if reading has earned a paid run, a
 * wager on this game is settled, and the score joins the reader's usual.
 * Nothing is ever taken for playing: only a wager can lose acorns.
 */
export const afterGame = (state: BaseState, game: PayingGame, score: number, now: Now): GameEnd => {
  let next: BaseState = { ...state, scores: { ...state.scores, [game]: [...state.scores[game], Math.max(0, Math.floor(score))].slice(-SCORES_KEPT) } };
  let wager: GameEnd["wager"] = null;
  if (state.wager?.game === game) {
    const won = score >= state.wager.target;
    wager = { won, stake: state.wager.stake };
    next = {
      ...next,
      wager: null,
      acorns: next.acorns + (won ? give(next, state.wager.stake * 2) : 0),
      stats: won ? { ...next.stats, wagers: next.stats.wagers + 1 } : next.stats
    };
  }
  const paid = purseLeft(next, now.minutes) > 0 ? give(next, payout(next, game, score)) : 0;
  // A run that paid nothing does not use a paid run up.
  if (paid > 0) next = { ...next, acorns: next.acorns + paid, purseFrom: spend(next.purseFrom, now.minutes, PURSE_EVERY, PURSE_IN_HAND) };
  return { state: next, paid, wager };
};

// ---- the visitor ---------------------------------------------------------------------------

/** A small seeded generator (mulberry32), as the arcade's games use. */
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hashOf = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
};

export type OfferId = "sack" | "tip" | "hand" | "oil" | "pack";
export type Offer = { id: OfferId; name: string; does: string };

const HAND_MINUTES = 10;
const sackOf = (state: BaseState) => 4 + state.levels.burrow * 2 + Math.floor(Math.min(150, charm(state)) / 10);

/**
 * What the hedgehog has today: a sack of acorns, and two other things of the
 * four she carries, different days different ones. One may be taken. Null
 * once today's has been.
 */
export const offers = (state: BaseState, day: string): Offer[] | null => {
  if (state.visitor === day) return null;
  const others: Offer[] = [
    { id: "tip", name: "A tip about the magpies", does: `${TIP_SCOUTS} more scouts on one raid` },
    { id: "hand", name: "A hand with the building", does: `${HAND_MINUTES} minutes off what is going up` },
    { id: "oil", name: "Lamp oil", does: "The lantern is lit tonight, whatever you read" },
    { id: "pack", name: "A sturdy pack", does: "The next raid won brings half as much again" }
  ];
  const roll = seeded(hashOf(day) ^ 0x9e3779b9);
  const first = Math.floor(roll() * others.length);
  const second = (first + 1 + Math.floor(roll() * (others.length - 1))) % others.length;
  return [{ id: "sack", name: "A sack of acorns", does: `${sackOf(state)} acorns` }, others[first], others[second]];
};

/** Why an offer would be wasted on this camp, or null. */
export const offerWasted = (state: BaseState, id: OfferId): string | null =>
  id === "tip" && state.intel >= INTEL_MOST
      ? "You have all the tips you can carry"
      : id === "hand" && state.jobs.length === 0
        ? "Nothing is going up"
        : id === "oil" && state.levels.tower === 0
          ? "There is no lookout to hang a lantern in"
          : id === "pack" && state.pack
            ? "You have one already"
            : null;

/** Takes one of today's offers. */
export const takeOffer = (state: BaseState, id: OfferId, now: Now): BaseState => {
  const today = offers(state, now.day);
  if (!today || !today.some((offer) => offer.id === id) || offerWasted(state, id)) return state;
  const taken: BaseState = { ...state, visitor: now.day };
  switch (id) {
    case "sack":
      return { ...taken, acorns: taken.acorns + give(taken, sackOf(taken)) };
    case "tip":
      return { ...taken, intel: taken.intel + 1 };
    case "hand": {
      // Off the job with the least left: the one she can see nearly done.
      const nearest = [...taken.jobs].sort((a, b) => jobLeft(a, now.minutes) - jobLeft(b, now.minutes))[0];
      return { ...taken, jobs: taken.jobs.map((job) => (job === nearest ? { ...job, needs: Math.max(0, job.needs - HAND_MINUTES) } : job)) };
    }
    case "oil":
      return { ...taken, oil: now.day };
    case "pack":
      return { ...taken, pack: true };
  }
};

/** Whether tonight's lantern is lit as things stand: today's goal met, or oil bought. */
export const litTonight = (state: BaseState, day: string, goalMetToday: boolean) => state.levels.tower > 0 && (goalMetToday || state.oil === day);

// ---- tips from the word quiz ------------------------------------------------------------------

/** Right answers out of ten that earn a tip. */
export const QUIZ_FOR_A_TIP = 7;

/** A round of the word quiz: seven right of ten is a tip about the magpies, once a day. */
export const afterQuiz = (state: BaseState, right: number, of: number, day: string): BaseState =>
  of >= 10 && right >= QUIZ_FOR_A_TIP && state.quizDay !== day && state.intel < INTEL_MOST ? { ...state, intel: state.intel + 1, quizDay: day } : state;

// ---- Pip's wish for the day ----------------------------------------------------------------------

export type Wish = { text: string; reward: number; done: boolean };

/** What Pip may wish for. Every one of them is reading: the camp is paid for by the book. */
const WISHES: ReadonlyArray<{ text: string; minutes: number; goal?: boolean; reward: number }> = [
  { text: "Read for ten minutes today", minutes: 10, reward: 8 },
  { text: "Read for twenty minutes today", minutes: 20, reward: 14 },
  { text: "Read for half an hour today", minutes: 30, reward: 20 },
  { text: "Meet your reading goal today", minutes: 0, goal: true, reward: 16 },
  { text: "Read for three quarters of an hour today", minutes: 45, reward: 28 }
];

/**
 * Today's wish from Pip: a little reading, a different amount on different
 * days, and acorns for it (more for a bigger burrow, and for a streak kept).
 * Null once today's has been granted.
 */
export const wishToday = (state: BaseState, now: Now): Wish | null => {
  if (state.wishDay === now.day) return null;
  const wish = WISHES[hashOf(`wish|${now.day}`) % WISHES.length];
  const done = wish.goal ? now.goalMet === true : (now.today ?? 0) >= wish.minutes;
  return { text: wish.text, reward: Math.round((wish.reward + state.levels.burrow * 2) * (1 + streakAdds(now.streak ?? 0))), done };
};

/** Grants today's wish, once it has come true. */
export const grantWish = (state: BaseState, now: Now): BaseState => {
  const wish = wishToday(state, now);
  if (!wish || !wish.done) return state;
  const reward = give(state, wish.reward);
  return { ...state, acorns: state.acorns + reward, wishDay: now.day, events: noted(state, now.day, `Pip's wish came true: ${reward} acorns.`) };
};

// ---- things set about the clearing ----------------------------------------------------------------

/** How charming the camp is: what has been set about it, its trophies and its banners. */
export const charm = (state: BaseState) =>
  [...state.decor, ...state.meadow].reduce((sum, entry) => sum + (DECOR[entry.kind]?.charm ?? 0), 0) + Math.min(40, state.raised.length) + state.banners.length * 5;

const onLand = (x: number, y: number, wood = 0) => ({
  x: Math.round(Math.min(DECOR_LAND.right - wood, Math.max(DECOR_LAND.left + wood, x))),
  y: Math.round(Math.min(DECOR_LAND.bottom, Math.max(DECOR_LAND.top, y)))
});

/** The camp's two clearings: the one that is lived in and fought over, and the meadow beyond it. */
export type Place = "camp" | "meadow";
/** The burrow's level at which the path to the meadow is cleared. */
/** The burrow's level the meadow came at before chapters. @deprecated it comes with chapter 7: `meadowOpen`. */
export const MEADOW_FROM = 3;
/** Whether the path to the meadow is cleared: from chapter 7. */
export const meadowOpen = (state: BaseState) => opened(state, undefined, "meadow");
const setIn = (state: BaseState, place: Place) => (place === "meadow" ? state.meadow : state.decor);
const withSet = (state: BaseState, place: Place, things: Decor[]): BaseState => (place === "meadow" ? { ...state, meadow: things } : { ...state, decor: things });

/** Why a thing cannot be bought and set down, or null when it can. Each clearing takes so many, and no more; and none before chapter 5. */
export const decorBlocked = (state: BaseState, kind: number, place: Place = "camp"): "chapter" | "full" | "acorns" | null =>
  !decorOpen(state) || (place === "meadow" && !meadowOpen(state))
    ? "chapter"
    : setIn(state, place).length >= DECOR_MOST
      ? "full"
      : state.acorns < (DECOR[kind]?.cost ?? Infinity)
        ? "acorns"
        : null;

/** Buys a thing and sets it down where the reader pointed. */
export const placeDecor = (state: BaseState, kind: number, x: number, y: number, place: Place = "camp"): BaseState =>
  !DECOR[kind] || decorBlocked(state, kind, place) || (place === "meadow" && !meadowOpen(state))
    ? state
    : { ...withSet(state, place, [...setIn(state, place), { kind, ...onLand(x, y, place === "camp" ? woodOf(state) : 0) }]), acorns: state.acorns - DECOR[kind].cost };

/** Moves a thing already bought: as often as the reader likes, for nothing. */
export const moveDecor = (state: BaseState, index: number, x: number, y: number, place: Place = "camp"): BaseState =>
  setIn(state, place)[index] ? withSet(state, place, setIn(state, place).map((entry, at) => (at === index ? { ...entry, ...onLand(x, y, place === "camp" ? woodOf(state) : 0) } : entry))) : state;

/** Takes a thing away. Nothing comes back for it. */
export const removeDecor = (state: BaseState, index: number, place: Place = "camp"): BaseState =>
  setIn(state, place)[index] ? withSet(state, place, setIn(state, place).filter((_, at) => at !== index)) : state;

// ---- landscape: what the reader makes of the ground ---------------------------------------------------------

const landIn = (state: BaseState, place: Place) => (place === "meadow" ? state.meadowLand : state.land);
const withLand = (state: BaseState, place: Place, things: Decor[]): BaseState => (place === "meadow" ? { ...state, meadowLand: things } : { ...state, land: things });
const onGround = (x: number, y: number, wood = 0) => ({
  x: Math.round(Math.min(LAND_LAND.right - wood, Math.max(LAND_LAND.left + wood, x))),
  y: Math.round(Math.min(LAND_LAND.bottom, Math.max(LAND_LAND.top, y)))
});

/** Why a piece of landscape cannot be bought and set down, or null when it can. */
export const landBlocked = (state: BaseState, kind: number, place: Place = "camp"): "chapter" | "full" | "acorns" | null =>
  !decorOpen(state) || (place === "meadow" && !meadowOpen(state))
    ? "chapter"
    : landIn(state, place).length >= LAND_MOST
      ? "full"
      : state.acorns < (SCENERY[kind]?.cost ?? Infinity)
        ? "acorns"
        : null;

/** Buys a piece of landscape and sets it down. It is there for its own sake: nothing about the camp counts it. */
export const placeLand = (state: BaseState, kind: number, x: number, y: number, place: Place = "camp"): BaseState =>
  !SCENERY[kind] || landBlocked(state, kind, place) || (place === "meadow" && !meadowOpen(state))
    ? state
    : { ...withLand(state, place, [...landIn(state, place), { kind, ...onGround(x, y, place === "camp" ? woodOf(state) : 0) }]), acorns: state.acorns - SCENERY[kind].cost };
export const moveLand = (state: BaseState, index: number, x: number, y: number, place: Place = "camp"): BaseState =>
  landIn(state, place)[index] ? withLand(state, place, landIn(state, place).map((entry, at) => (at === index ? { ...entry, ...onGround(x, y, place === "camp" ? woodOf(state) : 0) } : entry))) : state;
export const removeLand = (state: BaseState, index: number, place: Place = "camp"): BaseState =>
  landIn(state, place)[index] ? withLand(state, place, landIn(state, place).filter((_, at) => at !== index)) : state;

// ---- the constructs: one of each, set down where the reader wants it ------------------------------------------

/**
 * Whether a kind of construct can be had in this camp (1.5.11): the seven of the front (`front.ts` `FRONT_WORKS`),
 * each from its chapter (`WORK_CHAPTER`; a camp from before chapters goes by what its burrow had: `frontChapter`);
 * and one the camp already has, always. The kinds that were folded into others (`BECAME`) are no more.
 */
export const workOpen = (state: BaseState, kind: number): boolean => {
  if (!WORKS[kind] || !FRONT_WORKS.includes(kind)) return false;
  // (A camp from before chapters keeps what its burrow had opened, by the burrow level each came at then.)
  return ownCount(state.front, kind) > 0 || frontChapter(state) >= WORK_CHAPTER[kind] || (state.legacy !== null && state.legacy.burrow >= WORKS[kind].burrow);
};
/** The kinds of construct this camp can have, in `WORKS` order. */
export const worksOpen = (state: BaseState): number[] => WORKS.map((_, kind) => kind).filter((kind) => workOpen(state, kind));
/** The kinds a camp could ever have: the front's seven, in the order they come (for the shelf to list). */
export const worksOffered = (_state: BaseState): number[] => [...FRONT_WORKS];

/** Why one more of a construct cannot be had, or null when it can. "most": the camp has as many as it may (two of a tower, one of anything else). */
export const workBlocked = (state: BaseState, kind: number): "chapter" | "acorns" | "most" | null => {
  const work = WORKS[kind];
  if (!work || !FRONT_WORKS.includes(kind)) return "chapter";
  if (ownCount(state.front, kind) >= mostOf(kind)) return "most";
  return !workOpen(state, kind) ? "chapter" : state.acorns < work.cost ? "acorns" : null;
};
/**
 * Puts a construct on the front near a point: on the trap spot or tower pad nearest it (bought, the first time; moved
 * there from the shed or another slot after). Kept for what still sets constructs down by a point: `seatWork` and
 * `buyWork` are the front's own.
 */
export const placeWork = (state: BaseState, kind: number, x: number, y: number): BaseState => {
  if (!WORKS[kind] || !FRONT_WORKS.includes(kind)) return state;
  if (kind === BELL) return state.front.bell ? state : buyWork(state, kind);
  const places = frontPlaces(state);
  const open = frontOpen(state);
  const at: FrontSlot["at"] = isTrap(kind) ? "spot" : "pad";
  const list = at === "spot" ? places.spots.slice(0, open.spots) : places.pads.slice(0, open.pads);
  if (list.length === 0) return ownCount(state.front, kind) > 0 ? state : buyWork(state, kind);
  const index = list.reduce((best, spot, here) => (Math.hypot(spot[0] - x, spot[1] - y) < Math.hypot(list[best][0] - x, list[best][1] - y) ? here : best), 0);
  return seatWork(state, { at, index }, kind);
};

// ---- the blades: won from the lords of the magpies, carried by a hero --------------------------------------------

/** The blades the camp has: each lord's from the first time his stronghold fell, and the King's from the first banner. */
export const bladesWon = (state: BaseState): number[] => [
  ...BLADES.slice(0, CAMP_NAMES.length)
    .filter((blade) => state.camps >= (blade.id + 1) * CAMPS_A_NAME)
    .map((blade) => blade.id),
  ...(state.banners.length > 0 ? [KING_CHAMPION] : []),
  ...BLADES.filter((blade) => blade.hero !== undefined && heroHere(state, blade.hero) && bondOf(state, blade.hero) >= BLADE_AT_BOND).map((blade) => blade.id)
];
/** The blade a hero carries, or -1. One that has been lost to the camp (it cannot be) or given to another is not carried. */
export const bladeOf = (state: BaseState, hero: number) => {
  const blade = state.arms[hero] ?? -1;
  return blade >= 0 && bladesWon(state).includes(blade) ? blade : -1;
};
/** Gives a hero a blade (or takes theirs, with -1). A blade is in one hand: whoever had it has it no more. */
export const armHero = (state: BaseState, hero: number, blade: number): BaseState => {
  if (!HEROES[hero] || (blade >= 0 && !bladesWon(state).includes(blade))) return state;
  return { ...state, arms: state.arms.map((held, at) => (at === hero ? blade : held === blade && blade >= 0 ? -1 : held)) };
};

// ---- the guardians: posted at a building, trained by reading ----------------------------------------------

export const guardOf = (state: BaseState, guard: number) => Math.min(GUARD_MOST, Math.max(0, state.guards[guard] ?? 0));
export const hasAnimal = (state: BaseState, animal: number) => state.animals.includes(animal);
/** Whether the side tonight's magpies come from is known beforehand: a lookout sees it, and so does an owl. */
export const sideKnown = (state: BaseState) => state.levels.tower > 0 || hasAnimal(state, 3);

/**
 * The burrow's level from which guardians came before chapters (they come with chapter 6: `opened(.., "guards")`),
 * and the level a building has to be for one to be posted at it.
 * @deprecated for the gate: ask `opened`.
 */
export const GUARDS_FROM = 3;
const POST_FROM = 2;

/** The guardian whose post a plot of the camp is, if it is anyone's. Either plot of the yard is the gardener's. */
export const guardAt = (site: Site): Guardian | null => GUARDIANS.find((guard) => guard.post === (site === "yard0" || site === "yard1" ? "yard" : site)) ?? null;

/** Whether a guardian's post is there to be taken up: the burrow grown enough, and the building itself. */
export const postOpen = (state: BaseState, guard: number): boolean => {
  const post = GUARDIANS[guard]?.post;
  if (!post || !opened(state, undefined, "guards")) return false;
  if (post === "yard") return state.yard.some((slot) => slot.kind !== null && slot.level > 0);
  if (post === "fence") return state.levels.fence > 0;
  return state.levels[post] >= (post === "burrow" ? GUARDS_FROM : POST_FROM);
};

export type GuardBlocked = "top" | "post" | "busy" | "acorns";
/** Why a guardian cannot be trained to their next rank, or null when they can. One trains at a time. */
export const guardBlocked = (state: BaseState, guard: number): GuardBlocked | null => {
  const to = guardOf(state, guard) + 1;
  if (to > GUARD_MOST) return "top";
  if (!postOpen(state, guard)) return "post";
  if (state.drill) return "busy";
  return state.acorns < guardCost(to) ? "acorns" : null;
};
/** What a rank costs, all told: its acorns, and its training (what reading it used to take) at `ACORNS_A_MINUTE`. */
export const guardCost = (to: number) => {
  const rank = Math.min(GUARD_MOST, Math.max(0, to));
  return rank === 0 ? 0 : GUARD_COSTS[rank] + Math.round(GUARD_MINUTES[rank] * ACORNS_A_MINUTE);
};
export const guardMinutes = (to: number) => GUARD_MINUTES[Math.min(GUARD_MOST, Math.max(0, to))];

/**
 * Trains a guardian to their next rank, paid for in acorns, training and all (`guardCost`). The rank is theirs at
 * once: it goes through a drill that wants no more, which `settle` (straight after, in the store) sees done.
 */
export const trainGuard = (state: BaseState, guard: number, minutesRead: number): BaseState => {
  if (guardBlocked(state, guard)) return state;
  const to = guardOf(state, guard) + 1;
  return { ...state, acorns: state.acorns - guardCost(to), drill: { guard, from: Math.max(0, Math.floor(minutesRead)), needs: 0 } };
};
/** Minutes of reading until the guardian in training is done; null when none is. */
export const drillLeft = (state: BaseState, minutesRead: number) => (state.drill ? Math.max(0, state.drill.needs - Math.max(0, Math.floor(minutesRead) - state.drill.from)) : null);

// ---- the story being read ---------------------------------------------------------------------

/**
 * The book itself, coming into the camp. When the reading passes out of
 * one stretch of a book into the next (a chapter, where the book has them;
 * a twentieth of it otherwise) a parcel comes up the path, to be opened
 * for a few acorns. It is the one thing in the camp that answers to
 * *where* the reader is in a book and not only to how long they read.
 *
 * It stands on reading like everything else: a parcel wants eight minutes
 * read since the last one. Turning to the next chapter is free, and anyone
 * can turn twenty chapters in a minute; that brings one parcel, if the
 * eight minutes are there, and none if they are not. A reader of ordinary
 * chapters gets one a chapter; of very short ones, one every few.
 *
 * The camp keeps the one book it last heard of. Another book taken up
 * starts from where it is opened: there is no parcel for the chapters
 * already behind the bookmark.
 */
export const STRETCH_MINUTES = 8;
/** The most parcels that wait (6 until 1.5.10: past it a parcel was not sent). Nothing a reader can read in a while. */
export const PARCELS_MOST = 99;
/** What a parcel has in it: a few acorns, more in a bigger camp, and one more for every 30 of the camp's charm (the most charming camps get the best parcels: this was the hedgehog's sack, before 2026-10-15). */
export const parcelGives = (state: BaseState) => 4 + 2 * Math.max(1, state.levels.burrow) + Math.floor(Math.min(150, charm(state)) / 30);
export const storyRead = (state: BaseState, bookId: string, stretch: number, minutesRead: number, day: string, title = ""): BaseState => {
  const key = trophyKey(bookId);
  const read = Math.floor(minutesRead);
  const at = Math.max(0, Math.floor(stretch));
  // Another book, or the first: the camp knows where the reading is, and waits.
  if (!state.story || state.story.book !== key) return { ...state, story: { book: key, mark: at, from: read } };
  // Not on from where it was (or back, to read something again): nothing.
  if (at <= state.story.mark) return state;
  // On, but too soon for the reading to have been done: no parcel, and the mark stays, so that it comes when it has.
  if (read - state.story.from < STRETCH_MINUTES) return state;
  const full = state.parcels >= PARCELS_MOST;
  return {
    ...state,
    story: { book: key, mark: at, from: read },
    parcels: Math.min(PARCELS_MOST, state.parcels + 1),
    events: full ? state.events : noted(state, day, title ? `A parcel came up the path, from “${title.slice(0, 60)}”.` : "A parcel came up the path."),
  };
};
/**
 * Opens a parcel: its acorns, all of them, and every other parcel a tale
 * Pip found while you read (what her walks used to bring, before
 * 2026-10-15). (Until 1.5.10 one the larder had no room for waited.)
 */
export const openParcel = (state: BaseState): BaseState => {
  if (state.parcels <= 0) return state;
  // The first reading's parcel is the first opened: it has its own acorns in it, and nothing else.
  if (state.welcome?.firstReadParcel === "sent") return { ...state, parcels: state.parcels - 1, acorns: state.acorns + FIRST_READ_PARCEL, welcome: { ...state.welcome, firstReadParcel: "opened" } };
  const opened = { ...state, parcels: state.parcels - 1, acorns: state.acorns + parcelGives(state) };
  const tale = parcelTale(state);
  return tale === null ? opened : { ...opened, tales: [...state.tales, tale] };
};
/** What the next parcel opened has in it: the first reading's, while it waits, or an ordinary one. */
export const parcelNext = (state: BaseState) => (state.welcome?.firstReadParcel === "sent" ? FIRST_READ_PARCEL : parcelGives(state));
/** How many of the parcels waiting can be opened: all of them (since 1.5.10 there is always room). */
export const parcelsOpenable = (state: BaseState) => state.parcels;
/** The acorns in every parcel waiting: what "Open all" brings. */
export const parcelsBring = (state: BaseState) => openParcels(state).acorns - state.acorns;
/** Opens every parcel waiting, at once ("Open all"). */
export const openParcels = (state: BaseState): BaseState => {
  let next = state;
  for (let left = state.parcels; left > 0; left--) next = openParcel(next);
  return next;
};
/** The tale the next parcel opened has in it, if it has one: every other parcel, while there are tales not yet told. */
export const parcelTale = (state: BaseState): number | null => {
  const untold = TALES.map((_, tale) => tale).filter((tale) => !state.tales.includes(tale));
  const roll = hashOf(`parcel|${state.tales.length}|${state.stats.gathered}|${state.parcels}`);
  return untold.length > 0 && roll % 2 === 0 ? untold[(roll >>> 3) % untold.length] : null;
};

// ---- trophies: the books finished ------------------------------------------------------------

/** A book's short key in the camp's record: enough to tell books apart, not the book's own id. */
export const trophyKey = (bookId: string) => hashOf(bookId).toString(36);

const onShelf = (shelf: readonly number[], kind: number) => shelf.map((count, at) => (at === Math.min(SHELF_KINDS - 1, Math.max(0, Math.floor(kind))) ? count + 1 : count));

/**
 * A trophy stands on reading, and not on a book being marked as finished.
 * Marking is free: anyone can load a shelf of books and tick them off, and
 * if that were all a trophy took, the heroes (who come for trophies) would
 * be had for nothing, which is the one thing in the camp that must be
 * earned by reading. So each trophy wants an hour and a half of reading
 * behind it that no other trophy has: read in Leaflet, by the same ledger
 * the oak drops by. A finished book whose reading is not there yet waits,
 * and is raised when it is. A real reader never notices (a book takes
 * hours); a short book finished in forty minutes waits for the rest.
 *
 * It does not ask *which* book the minutes were read in: Leaflet keeps the
 * days a book was opened, not the minutes in each. What it settles is that
 * a hero costs reading, whichever cover it is put behind.
 */
export const TROPHY_MINUTES = 90;
const claimedOf = (state: BaseState, minutesRead: number) => (state.claimed < 0 ? Math.max(0, Math.floor(minutesRead) - TROPHY_MINUTES) : Math.min(state.claimed, Math.floor(minutesRead)));
/** Minutes read that stand behind no trophy yet. */
export const trophyBudget = (state: BaseState, minutesRead: number) => Math.max(0, Math.floor(minutesRead) - claimedOf(state, minutesRead));
/** How much more reading the next trophy wants before it can be raised: 0 when it can be. */
export const trophyWaits = (state: BaseState, minutesRead: number) => Math.max(0, TROPHY_MINUTES - trophyBudget(state, minutesRead));

/**
 * The books finished before the camp was made are given their trophies, with
 * nothing for them: each of its kind, and as many as the reading done so far
 * stands behind (all of them, where nobody says how much has been read). The
 * rest wait to be raised like any other.
 */
export const adopt = (state: BaseState, books: ReadonlyArray<{ id: string; kind: number }>, minutesRead?: number): BaseState => {
  if (state.adopted) return state;
  let shelf = state.shelf;
  const raised = [...state.raised];
  let left = minutesRead === undefined ? Infinity : Math.floor(trophyBudget(state, minutesRead) / TROPHY_MINUTES);
  let stood = 0;
  for (const book of books) {
    const key = trophyKey(book.id);
    if (raised.includes(key)) continue;
    if (left <= 0) break;
    left -= 1;
    stood += 1;
    raised.push(key);
    shelf = onShelf(shelf, book.kind);
  }
  const claimed = minutesRead === undefined ? state.claimed : claimedOf(state, minutesRead) + stood * TROPHY_MINUTES;
  return { ...state, adopted: true, claimed, raised: raised.slice(-RAISED_KEPT), shelf };
};

export const isRaised = (state: BaseState, bookId: string) => state.raised.includes(trophyKey(bookId));
export const TROPHY_GIVES = TROPHY_GIFT;

/** Raises the trophy of a book finished since: a gift of acorns, once a book, when the reading stands behind it (it always does, where nobody says how much has been read). */
export const raise = (state: BaseState, bookId: string, title: string, day: string, kind = 0, minutesRead?: number): BaseState => {
  if (isRaised(state, bookId)) return state;
  if (minutesRead !== undefined && trophyWaits(state, minutesRead) > 0) return state;
  const gift = give(state, TROPHY_GIFT);
  return {
    ...state,
    acorns: state.acorns + gift,
    claimed: minutesRead === undefined ? state.claimed : claimedOf(state, minutesRead) + TROPHY_MINUTES,
    shelf: onShelf(state.shelf, kind),
    raised: [...state.raised, trophyKey(bookId)].slice(-RAISED_KEPT),
    events: noted(state, day, `A trophy for “${title.slice(0, 60)}”.`)
  };
};

// ---- the club's boss ------------------------------------------------------------------------

/** What a club's week comes to against its boss: every member's minutes, against an hour each (or the club's goal, if that is more). */
export const clubBoss = (weekMinutes: readonly number[], goalMinutes: number) => {
  const need = weekMinutes.length * Math.max(60, goalMinutes);
  const done = Math.round(weekMinutes.reduce((sum, minutes) => sum + Math.max(0, minutes), 0));
  return { need, done: Math.min(done, need), beaten: weekMinutes.length >= 2 && done >= need, reward: Math.min(100, 30 + weekMinutes.length * 10) };
};

/** This camp's share of a boss its club beat this week: once a club a week. */
export const claimClub = (state: BaseState, clubId: string, week: string, reward: number, day: string): BaseState => {
  const key = `${clubId}|${week}`;
  if (state.clubWins.includes(key)) return state;
  const share = give(state, Math.min(100, Math.max(0, reward)));
  return {
    ...state,
    acorns: state.acorns + share,
    clubWins: [...state.clubWins, key].slice(-WINS_KEPT),
    events: noted(state, day, `The club beat its boss: ${share} acorns.`)
  };
};
export const clubClaimed = (state: BaseState, clubId: string, week: string) => state.clubWins.includes(`${clubId}|${week}`);

// ---- who lives here: the heroes, what each would like today, and how well they know the camp ----------

/** How far a friendship goes, and how much stronger each step of it makes a hero on a raid. */
export const BOND_MOST = 5;
const BOND_STRONGER = 0.03;
const BOND_WORDS = ["new here", "settling in", "at home", "a friend", "a good friend", "sworn to the Hollow"];
export const bondOf = (state: BaseState, hero: number) => Math.min(BOND_MOST, Math.max(0, state.bonds[hero] ?? 0));
export const bondWord = (bond: number) => BOND_WORDS[Math.min(BOND_MOST, Math.max(0, bond))];

/** The heroes who have come to the camp, in the order they are listed. */
export const residents = (state: BaseState) => HEROES.filter((hero) => heroHere(state, hero.id));
/**
 * Beds. A hero comes for the books finished, and that is never taken back;
 * but the hut has only so many beds, more for every level of it, and it is
 * the heroes with a bed who are about the camp: seen in it, and out to
 * whatever comes out of the wood. The rest are on the road, and still ask
 * for what they ask for. One bed there always is, by the burrow's fire,
 * before there is a hut at all; and whoever is chosen to lead the raids
 * has the first of them, so that nobody loses the hero they raid with.
 */
export const HUT_BEDS = [1, 2, 3, 5, 7, 10];
export const bedsOf = (state: BaseState) => ((state.harm.hut ?? 0) >= 4 ? HUT_BEDS[0] : HUT_BEDS[Math.min(HUT_BEDS.length - 1, Math.max(0, state.levels.hut))]);
export const lodgers = (state: BaseState) => {
  const here = residents(state);
  // The leader, then whoever knows the camp best, then as they are listed.
  const order = [...here].sort((a, b) => Number(b.id === state.hero) - Number(a.id === state.hero) || bondOf(state, b.id) - bondOf(state, a.id) || a.id - b.id);
  return order.slice(0, bedsOf(state));
};
export const hasBed = (state: BaseState, hero: number) => lodgers(state).some((entry) => entry.id === hero);

const wantsOn = (state: BaseState, day: string) => (state.wants.day === day ? state.wants : { day, done: [], won: [], set: [] });

export type Want = {
  hero: number;
  text: string;
  /** It has come true, and can be seen to. */
  done: boolean;
  /** It has been seen to today. */
  granted: boolean;
  reward: number;
};

/**
 * What a hero would like today. Each has one want a day, the same all day:
 * some reading, the day's goal, the oak gathered, a raid won with them, or a
 * thing for the clearing that is not there yet. Every one of them is either
 * reading or a thing reading pays for, so the people of the camp ask for
 * what the app is for.
 */
export const wantOf = (state: BaseState, hero: number, now: Now): Want | null => {
  if (!heroHere(state, hero)) return null;
  const roll = hashOf(`want|${now.day}|${hero}`);
  const today = wantsOn(state, now.day);
  // What the clearing was without this morning: what it is without now, and what has been set down since. So the want does not change for being met.
  const about = [...state.decor, ...state.meadow];
  const missing = DECOR.map((_, kind) => kind).filter((kind) => today.set.includes(kind) || !about.some((entry) => entry.kind === kind));
  const kinds = ["read", "gather", "goal", ...(state.levels.hut > 0 ? ["raid"] : []), ...(decorOpen(state) && missing.length > 0 ? ["decor"] : [])];
  const kind = kinds[roll % kinds.length];
  const said = (text: string, done: boolean): Want => ({ hero, text, done, granted: today.done.includes(hero), reward: 6 + bondOf(state, hero) * 2 });
  if (kind === "read") {
    const minutes = [10, 15, 20][(roll >>> 4) % 3];
    return said(`Read for ${minutes} minutes today`, (now.today ?? 0) >= minutes);
  }
  if (kind === "gather") return said("Gather the oak's acorns today", state.dewDay === now.day);
  if (kind === "goal") return said("Meet your reading goal today", now.goalMet === true);
  if (kind === "raid") return said("Take me on a raid, and win it", today.won.includes(hero));
  const wanted = missing[(roll >>> 6) % missing.length];
  const name = DECOR[wanted].name.toLowerCase();
  return said(`I should like ${/^[aeiou]/.test(name) ? "an" : "a"} ${name} in the clearing`, about.some((entry) => entry.kind === wanted));
};

/** Sees to a hero's want once it has come true: a step of friendship, and a few acorns from them. */
export const grantWant = (state: BaseState, hero: number, now: Now): BaseState => {
  const want = wantOf(state, hero, now);
  if (!want || !want.done || want.granted) return state;
  const bond = Math.min(BOND_MOST, bondOf(state, hero) + 1);
  const today = wantsOn(state, now.day);
  const grew = bond > bondOf(state, hero);
  return {
    ...state,
    acorns: state.acorns + give(state, want.reward),
    bonds: state.bonds.map((had, at) => (at === hero ? bond : had)),
    wants: { ...today, done: [...today.done, hero] },
    events: grew ? noted(state, now.day, `${HEROES[hero].short} is ${bondWord(bond)}.`) : state.events
  };
};

/** Whether anyone in the camp has a want that has come true and not been seen to. */
export const wantWaits = (state: BaseState, now: Now) =>
  residents(state).some((hero) => {
    const want = wantOf(state, hero.id, now);
    return Boolean(want && want.done && !want.granted);
  });

// ---- Pip's walks: she goes out while the reader reads, and comes back with what she found ---------------

/** How long a walk can be, in minutes of reading, and what share of the oak's own fall for those minutes she brings. */
export const TRIPS = [10, 20, 30] as const;
const TRIP_SHARE = 0.4;

/** What she comes back having seen. Each is found once; the long walks always find one while there are any left. */
export const TALES: readonly string[] = [
  "A snail was reading a leaf. It was on the same line when I came back.",
  "I found a bookmark shaped like a fish. The fish did not want it back.",
  "There is a puddle in the woods that shows a different sky.",
  "A crow sold me a secret. It was about another crow.",
  "Somebody has been numbering the mushrooms. They stop at eleven.",
  "I met a hedgehog going the other way. We both pretended not to be lost.",
  "The old stump has a door. I knocked. It knocked back.",
  "A page blew past me, and I never found the book it was from.",
  "Two beetles were arguing about a comma.",
  "I followed a path that someone had underlined.",
  "There is a hill out there that hums when you sit on it.",
  "A moth told me the moon is a lamp somebody forgot to turn off.",
  "I found the place where the wind keeps its spare leaves.",
  "A fox was teaching her cubs to whisper. I learned a little too.",
  "The stream reads aloud, if you put your ear near it. Mostly it reads the same page.",
  "I traded an acorn for a button. The button is clearly worth more.",
  "There is a tree with a library card stuck in it.",
  "A magpie waved at me. I think she was counting my pockets.",
  "I found a footprint much bigger than mine and walked in it for a while.",
  "The far meadow has a scarecrow who knows all the endings.",
  "It rained on one side of the path only. I walked on the other.",
  "I saw a spider mending a web with a mistake in it. She left the mistake in.",
  "Someone left a chair in the woods, facing nothing. The view is very good.",
  "An owl asked me who. I said me. She seemed satisfied.",
  "I found a bell with no clapper. It rings when nobody is looking.",
  "A worm came up to see what all the reading was about.",
  "There is a stone out there worn smooth by people sitting to finish a chapter.",
  "I picked up a feather that was heavier than it looked. I put it back.",
  "The brambles had kept a kite for years. It was in a very good mood.",
  "I counted the stars through the leaves and got a different number each time.",
  "A mole showed me a map of underneath. It is mostly dark, with one good bit.",
  "I heard two trees creak at each other and I am sure one was laughing.",
  "There was a letter under a rock, addressed to whoever lifts this rock. It said hello.",
  "The path forked, and both ways had my footprints on them already.",
  "I found where the shortcut goes. It is longer, but it has blackberries.",
  "A squirrel had hidden a whole sentence, one word to a hole."
];

/** Minutes of reading until she is back; 0 when she is; null when she is at home. */
export const tripLeft = (state: BaseState, minutesRead: number) => (state.trip ? Math.max(0, state.trip.needs - Math.max(0, Math.floor(minutesRead) - state.trip.from)) : null);

/** Sends Pip out for a walk of so many minutes of reading. She is back when they have been read, and not before. */
export const sendOut = (state: BaseState, minutesRead: number, needs: number): BaseState =>
  state.trip || !TRIPS.some((length) => length === needs) ? state : { ...state, trip: { from: Math.max(0, Math.floor(minutesRead)), needs } };

/** What she has with her when she is back: acorns by how long the walk was, and perhaps a tale not told before. */
export const tripBrings = (state: BaseState): { acorns: number; tale: number | null } | null => {
  if (!state.trip) return null;
  const acorns = Math.max(1, Math.round((state.trip.needs / OAK_EVERY) * oakDrops(state) * TRIP_SHARE));
  const untold = TALES.map((_, tale) => tale).filter((tale) => !state.tales.includes(tale));
  const roll = hashOf(`walk|${state.trip.from}|${state.trip.needs}`);
  // A short walk finds a tale every other time; a longer one always does, while there are any left to find.
  const finds = untold.length > 0 && (state.trip.needs >= 20 || roll % 2 === 0);
  return { acorns, tale: finds ? untold[(roll >>> 3) % untold.length] : null };
};

/** Welcomes her back: what she found goes into the larder, and the tale into the journal. Nothing, while she is still out. */
export const welcomeBack = (state: BaseState, minutesRead: number, day: string): BaseState => {
  const brings = tripBrings(state);
  if (!brings || tripLeft(state, minutesRead) !== 0) return state;
  const acorns = give(state, brings.acorns);
  return {
    ...state,
    acorns: state.acorns + acorns,
    trip: null,
    tales: brings.tale === null ? state.tales : [...state.tales, brings.tale],
    events: noted(state, day, `Pip came back from her walk with ${acorns} ${acorns === 1 ? "acorn" : "acorns"}${brings.tale === null ? "" : ", and a tale"}.`)
  };
};

// ---- Pip's list: the one next thing ---------------------------------------------------------------

/** Where a thing on the list is done: a plot of the camp, the raids, or the meadow. */
export type QuestAt = Site | "raids" | "meadow";
/**
 * A thing on Pip's list: `id` names it across rewrites of the list, `short`
 * is what the goal chip says of it ("Lookout"), and `raise` marks the step
 * that raises the burrow to that level, the last of its group (`ladder.ts`).
 */
export type Quest = { id: string; text: string; short: string; reward: number; done: (state: BaseState) => boolean; at: QuestAt; raise?: number };

/** The welcome basket is opened, or there is none to open (a camp from before it is kept as opened). */
const basketDone = (state: BaseState) => state.welcome?.basketOpened !== false;

/**
 * In order, grouped by the burrow, which is the spine: each group is what a
 * level has to do, and raising the burrow is the last of it. Each is a thing
 * the camp can show it has done, and each says where it is done, so the
 * reader can be shown. Nothing on it asks for what its level has not
 * brought yet. Regrouped on 2026-10-16 (1.5.5): the hut and the lookout went
 * after the burrow's level 2, and the welcome basket joined the first group.
 */
export const QUESTS: readonly Quest[] = [
  { id: "oak", text: "Read 10 minutes, then tap the oak", short: "Tap the oak", reward: 10, done: (state) => state.stats.gathered > 0, at: "oak" },
  { id: "larder", text: "Build a larder", short: "Larder", reward: 10, done: (state) => state.levels.store >= 1, at: "store" },
  { id: "basket", text: "Open Pip's welcome basket", short: "Pip's basket", reward: 0, done: basketDone, at: "burrow" },
  { id: "burrow2", text: "Raise the burrow to level 2", short: "Burrow 2", reward: 25, done: (state) => state.levels.burrow >= 2, at: "burrow", raise: 2 },
  { id: "hut", text: "Build a scouts' hut", short: "Scouts' hut", reward: 15, done: (state) => state.levels.hut >= 1, at: "hut" },
  { id: "lookout", text: "Build a lookout", short: "Lookout", reward: 15, done: (state) => state.levels.tower >= 1, at: "tower" },
  { id: "fence", text: "Build a fence, and lay three pieces of it", short: "Fence", reward: 15, done: (state) => state.levels.fence >= 1 && state.walls.length >= Math.min(3, fencePieces(state)), at: "fence" },
  { id: "raid", text: "Win a raid", short: "A raid", reward: 20, done: (state) => state.stats.raids >= 1 || state.camps >= 1, at: "raids" },
  { id: "burrow3", text: "Raise the burrow to level 3", short: "Burrow 3", reward: 40, done: (state) => state.levels.burrow >= 3, at: "burrow", raise: 3 },
  { id: "construct", text: "Set down a construct", short: "A construct", reward: 20, done: (state) => state.works.length > 0, at: "fence" },
  { id: "yard", text: "Build something in the yard", short: "The yard", reward: 30, done: (state) => state.yard.some((slot) => slot.level > 0), at: "yard0" },
  { id: "guardian", text: "Post a guardian at a building", short: "A guardian", reward: 60, done: (state) => state.guards.some((rank) => rank > 0), at: "tower" },
  { id: "strongholds5", text: "Take 5 strongholds", short: "5 strongholds", reward: 40, done: (state) => state.camps >= 5, at: "raids" },
  { id: "burrow4", text: "Raise the burrow to level 4", short: "Burrow 4", reward: 60, done: (state) => state.levels.burrow >= 4, at: "burrow", raise: 4 },
  { id: "animal", text: "Make the camp charming enough for an animal to come", short: "An animal", reward: 50, done: (state) => state.animals.length > 0, at: "meadow" },
  { id: "strongholds10", text: "Take 10 strongholds", short: "10 strongholds", reward: 60, done: (state) => state.camps >= 10, at: "raids" },
  { id: "burrow5", text: "Raise the burrow to level 5", short: "Burrow 5", reward: 100, done: (state) => state.levels.burrow >= 5, at: "burrow", raise: 5 },
  { id: "guardianTop", text: "Train a guardian to the top rank", short: "A top guardian", reward: 150, done: (state) => state.guards.some((rank) => rank >= GUARD_MOST), at: "tower" },
  { id: "guardians7", text: "Have all seven guardians at their posts", short: "Seven guardians", reward: 300, done: (state) => state.guards.every((rank) => rank > 0), at: "burrow" },
  { id: "animals6", text: "Give all six animals a home", short: "Six animals", reward: 300, done: (state) => state.animals.length >= ANIMALS.length, at: "meadow" }
];

/** The list as it was from 2026-10-15 to 1.5.5 ("list2"), by id: what a camp on it had been paid for. */
const LIST2 = ["oak", "larder", "hut", "lookout", "burrow2", "fence", "raid", "construct", "yard", "burrow3", "guardian", "strongholds5", "burrow4", "animal", "burrow5", "strongholds10", "guardianTop", "guardians7", "animals6"];
const LIST2_MARK = "list2";

/**
 * Kept in `taught` (a list of names, and older builds keep names they do
 * not know): this camp has been brought onto the list above. A camp from
 * the list before ("list2") is put at the first thing it was not paid for,
 * and keeps how far it had got there ("list3:9"): what it was paid for then
 * is ticked off again without acorns, so nobody is paid twice for one hut.
 * A camp from before that has whatever it has done passed over unpaid.
 */
export const LIST_MARK = "list3";
const listMark = (state: BaseState) => state.taught.find((mark) => mark === LIST_MARK || mark.startsWith(`${LIST_MARK}:`));
/** What a thing on the list pays this camp: nothing for what it was paid for on the list before. */
export const rewardOf = (state: BaseState, quest: Quest) => {
  const mark = listMark(state);
  const had = mark && mark !== LIST_MARK ? Number(mark.slice(LIST_MARK.length + 1)) : 0;
  return LIST2.slice(0, Number.isFinite(had) ? had : 0).includes(quest.id) ? 0 : quest.reward;
};

/** The thing on Pip's list now, and whether it is done; null when the list is. */
export const questNow = (state: BaseState): { quest: Quest; done: boolean; index: number } | null => {
  const quest = QUESTS[state.quest];
  return quest ? { quest, done: quest.done(state), index: state.quest } : null;
};

/** Where the thing on the list now is done, for showing the reader. */
export const questAt = (state: BaseState): QuestAt | null => questNow(state)?.quest.at ?? null;

/** Ticks the thing off by hand (`advanceList` does it by itself). Since 1.5.10 the old list pays nothing: the chapter's goals do. */
export const claimQuest = (state: BaseState, day: string): BaseState => {
  const now = questNow(state);
  if (!now || !now.done) return state;
  const reward = 0;
  return {
    ...state,
    acorns: state.acorns + reward,
    quest: state.quest + 1,
    events: noted(state, day, doneLine(now.quest, reward))
  };
};
const doneLine = (quest: Quest, paid: number) => `Done: ${quest.text[0].toLowerCase()}${quest.text.slice(1)}.${paid > 0 ? ` ${paid} acorns.` : ""}`;

/**
 * The list moves on by itself, and so do the chapter's goals. Unchanged, the
 * same object.
 *
 * Since 1.5.10 Pip's list is the chapter's goals (`GOALS`, `chapters.ts`): a
 * goal of this chapter or an earlier one that the camp has done is ticked off
 * and its acorns go in. The old list (`QUESTS`) is still kept up, ticked off
 * as it is done, but pays nothing: it is there for older builds, so that one
 * reading this camp finds its list already done and pays nothing twice.
 * (Goals wait for a camp to be brought onto chapters, `settle`, which ticks
 * off what it has already done without paying.)
 */
export const advanceList = (state: BaseState, day: string): BaseState => {
  let next = state;
  if (!listMark(next)) {
    if (next.taught.includes(LIST2_MARK)) {
      // From the list before: on at the first thing it was not paid for there, and what it was paid for is kept.
      const had = Math.min(next.quest, LIST2.length);
      const paid = new Set(LIST2.slice(0, had));
      let at = 0;
      while (at < QUESTS.length && paid.has(QUESTS[at].id)) at++;
      next = { ...next, quest: at, taught: [...next.taught, `${LIST_MARK}:${had}`] };
    } else {
      let at = Math.min(next.quest, QUESTS.length);
      while (QUESTS[at]?.done(next)) at++;
      next = { ...next, quest: at, taught: [...next.taught, LIST_MARK] };
    }
  }
  // The old list, ticked off unpaid.
  let at = next.quest;
  while (at < QUESTS.length && QUESTS[at].done(next)) at++;
  if (at !== next.quest) next = { ...next, quest: at };
  if (next.chapterSeen < 0) return next;
  const chapter = chapterOf(next.minutes);
  for (const goal of GOALS) {
    if (goal.chapter > chapter || next.goals.includes(goal.id) || !goal.done(next)) continue;
    const reward = give(next, goal.reward);
    next = { ...next, acorns: next.acorns + reward, goals: [...next.goals, goal.id] };
    next = { ...next, events: noted(next, day, `Done: ${goal.text[0].toLowerCase()}${goal.text.slice(1)}.${reward > 0 ? ` ${reward} acorns.` : ""}`) };
  }
  return next;
};

/**
 * The one next thing, as the camp shows it: what to do, where, and what it brings (null when nothing is promised).
 * (`full` is always false since 1.5.10: nothing waits for room. Kept for old screens.)
 */
export type NextStep = { text: string; at: QuestAt; reward: number | null; full: boolean };

/**
 * What Pip says to do next. There is always something: the chapter's next goal
 * (`goalNow`), or whatever is building, the cheapest thing that can be built,
 * or the reading to the next chapter. (Since 1.5.10: it was the old list.)
 */
export const nextStep = (state: BaseState, minutesRead: number): NextStep => {
  const reading = (site: Site): string | null => {
    const job = jobOn(state, site);
    if (!job) return null;
    const left = jobLeft(job, minutesRead);
    return left > 0 ? `Read ${left} more ${left === 1 ? "minute" : "minutes"}: the ${siteName(state, site).toLowerCase()} is finished` : null;
  };
  const goal = goalNow(state, minutesRead)?.goal;
  if (goal) {
    // The goal's own place, as the list's places were (Edit's two are the fence's and the burrow's on an old screen).
    const at: QuestAt = goal.at === "arrange" ? "fence" : goal.at === "decor" ? "burrow" : goal.at;
    if (goal.id === "oak" && oakStatus(state, minutesRead) === "ready") return { text: "Tap the oak to take in its acorns", at: "oak", reward: goal.reward || null, full: false };
    return { text: goal.text, at, reward: goal.reward || null, full: false };
  }
  const going = state.jobs.map((job) => job.site).find((site) => reading(site) !== null);
  if (going) return { text: reading(going)!, at: going, reward: null, full: false };
  const can = SITES.filter((site) => blocked(state, site) === null).sort((a, b) => priceOf(state, a, levelOf(state, a) + 1) - priceOf(state, b, levelOf(state, b) + 1))[0];
  if (can) {
    const to = levelOf(state, can) + 1;
    const name = siteName(state, can).toLowerCase();
    return { text: to === 1 ? `Build ${/^[aeiou]/.test(name) ? "an" : "a"} ${name}` : `Raise the ${name} to level ${to}`, at: can, reward: null, full: false };
  }
  const read = Math.max(state.minutes, Math.floor(minutesRead));
  const ahead = chapterBrings(chapterOf(read) + 1);
  const toGo = Math.max(0, chapterStartsAt(chapterOf(read) + 1) - read);
  return { text: `Read ${hoursWords(toGo)}: ${ahead.title} is next`, at: "oak", reward: null, full: false };
};

// ---- what the camp has to say elsewhere ----------------------------------------------------------

/**
 * The camp in a line, for the end of a reading session: what the reading
 * just finished, and what is waiting. Null when there is nothing to say.
 */
export const campNews = (state: BaseState, minutesRead: number): string | null => {
  const finished = state.jobs.filter((job) => jobLeft(job, minutesRead) === 0).map((job) => siteName(state, job.site).toLowerCase());
  const ready = oakReady(state, minutesRead);
  const parts: string[] = [];
  if (finished.length > 0) parts.push(`the ${finished.join(" and the ")} ${finished.length > 1 ? "are" : "is"} finished`);
  if (state.parcels > 0) parts.push(state.parcels === 1 ? "a parcel is waiting" : `${state.parcels} parcels are waiting`);
  if (basketWaits(state)) parts.push("Pip's basket is waiting");
  if (ready > 0) parts.push(`${ready} ${ready === 1 ? "acorn" : "acorns"} on the oak`);
  if (parts.length === 0) return null;
  const line = parts.join(", ");
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
};

/** Whether the camp has something waiting for the reader: for a dot on the way in. */
export const campWaits = (state: BaseState, now: Now): boolean =>
  // Only what reading has brought and is ready to be taken in: never a day's visitor or a list to keep up with
  // (since 2026-10-15), so the dot on the way in is never a nudge to come back for its own sake.
  state.jobs.some((job) => jobLeft(job, now.minutes) === 0) ||
  // A full oak, when a tap would take something from it: with the larder full, nothing is waiting to be done.
  (state.levels.oak > 0 && oakReady(state, now.minutes) >= oakHolds(state)) ||
  state.parcels > 0 ||
  // A chapter reached, and its card not yet seen.
  (state.chapterSeen >= 0 && state.chapterSeen < Math.min(chapterOf(Math.max(state.minutes, now.minutes)), state.chapterPaid)) ||
  // And what Pip gave in welcome, while it waits: the oak she shook, the basket by the door.
  windfallOf(state) > 0 ||
  basketOpens(state);

/** Pip's basket waits by the door until it is opened (since 1.5.10 there is always room for it). */
export const basketWaits = (state: BaseState) => Boolean(state.welcome?.given && !state.welcome.basketOpened);
export const basketOpens = (state: BaseState) => basketWaits(state);
