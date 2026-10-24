/**
 * A raid, as a small battle to set going and watch. The same battle serves
 * both ways round: Pip's scouts on a magpie camp, and the magpies on Pip's.
 *
 * A camp is laid out on the field: the nest in the middle, hoards of loot
 * about it, sentries on perches that throw pebbles, and from the fourth
 * camp on a wall of twigs across the near side. The reader puts scouts down
 * anywhere outside it, one at a time, and from then on they look after
 * themselves: each makes for the nearest thing to pull down (a mole for the
 * nearest hoard, and under the wall rather than through it), and a wall in
 * the way is pulled down first. Where they are put, in what order and from
 * which side is the whole of the skill, as in the game this is after.
 *
 * A planned raid (the raids plan, 2026-10-24) is the other way to fight one,
 * and the one the Magpie Lands use: nobody is put down by hand. The setup
 * carries a squad (`Squad`): groups of scouts, each sent down one of the
 * camp's approaches (`approaches.ts`), one of them perhaps held back as a
 * second wave. The stronghold has its quirk (`quirks.ts`), and the reader
 * has a few orders to give as it goes (`orders.ts`): rally a group, release
 * the held one, the hero's move. Its stars are each for something
 * (`feats.ts`). Without a squad a battle is exactly what it always was.
 *
 * One hero may go with them: a character out of the kind of book the reader
 * has finished, with one thing they do that no scout does. And a stronghold
 * may have a champion, who comes out to meet whoever gets near.
 *
 * At night it is turned about. The camp on the field is the reader's own,
 * where they chose to put it (`rules.ts` hands the structures in), and the
 * magpies come in from one side by rule. So where the larder stands, what
 * the lookout can reach and where the fence runs are what decide the night.
 *
 * A plain simulation, like the arcade's games: `step` advances a fixed tick,
 * nothing is random once the camp is laid out (and that comes from the camp's
 * number, so a camp is the same camp every time it is looked at), and there
 * is no clock or canvas in it. So it is tested, and it can be played with
 * nobody at the controls (`autoPlay`): that is what a raid "sent without
 * you" is, what a night is, how a planned raid is played again from its
 * orders, and how the numbers were set.
 */
import { approachesOf, posternTop, POSTERN_Y, rollOf, type Approach, type Zone } from "./approaches";
import { CENTRE, EDGE, FIELD_W, WALL_X } from "./field";
import { MOST_SHARE, starsOf, type Feat, type Missed } from "./feats";
import { heroMove } from "./heroes";
import { HELD_LATEST, ordersAt, type Order, type OrderGiven } from "./orders";
import { QUIRKS, quirkOf, type Quirk } from "./quirks";

export { FIELD_H, FIELD_W, WALL_X } from "./field";
/** Seconds a raid may take. */
export const RAID_SECONDS = 60;
/** Simulation ticks per second. */
export const BATTLE_TICK = 1 / 30;

export type UnitKind = "sprout" | "slinger" | "mole" | "bomber" | "hero";
export type ScoutKind = Exclude<UnitKind, "hero">;
export type StructureKind = "nest" | "hoard" | "perch" | "wall" | "other";

/** What a hero is, to the battle: how strong, and the one thing they do. */
export type HeroTraits = {
  /** Which hero: the picture. */
  id: number;
  hp: number;
  dps: number;
  speed: number;
  /** How far off they strike from: 3 is at arm's length. */
  reach: number;
  /** Goes over walls. */
  leaps?: boolean;
  /** What they strike hurts everything standing within this far of it too. */
  splash?: number;
  /** Mends the worst hurt scout near them, this much a second. */
  heals?: number;
  /** Sentries do not see them. */
  unseen?: boolean;
  /** Sentries throw at them before anyone else. */
  taunts?: boolean;
  /** Makes for these first. */
  prefers?: StructureKind;
  /** Does so many times as much to these. */
  times?: Partial<Record<StructureKind | "champion", number>>;
};

/** One group of a planned raid's squad: how many of each kind, down which approach, and whether it is held back. */
export type SquadGroup = {
  scouts: Partial<Record<ScoutKind, number>>;
  /** Which of the camp's approaches (`Battle.approaches`), by its place. */
  approach: number;
  /** Held back as the second wave, until it is released (`orders.ts`). At most one group is. */
  held?: boolean;
  /** The hero goes with this group (with the first group, if no group says). */
  hero?: boolean;
};
/** The room each kind takes in a planned raid's party: a mole is two places, a Puffcap two, so a mix is a choice. */
export const ROOM: Readonly<Record<ScoutKind, number>> = { sprout: 1, slinger: 1, mole: 2, bomber: 2 };
/** A planned raid's scouts: groups, each within what the hut has room for (`squad.ts` checks one). */
export type Squad = { groups: SquadGroup[] };

export type Setup = {
  /** The camp's place on the ladder, from 0. */
  n: number;
  /** The Magpie King's roost: a camp with more of everything. */
  king: boolean;
  /** Scouts there are to put down (for a planned raid: the room the hut has, `squad.ts` `ROOM`). */
  capacity: number;
  /** The scouts' hut's level, 1 to 5: how strong each scout is. */
  level: number;
  /** The kinds the hut has trained. */
  kinds: UnitKind[];
  /** Runners: scouts that move a quarter faster. */
  fast: boolean;
  /** Which camp of this size it is: a camp on the ladder is always the same one (0); a camp met on the road is a new one each time. */
  seed?: number;
  /** The hero who goes with the scouts, if one does. */
  hero?: HeroTraits | null;
  /** The villain who guards the camp, if one does: which one (the picture). */
  champion?: number | null;
  /** A night raid on the reader's own camp: the scouts here are magpies, and may be put down anywhere at the edge. */
  raiders?: boolean;
  /** How long it may take, when not a raid's minute: a night is shorter. */
  seconds?: number;
  /** The camp's constructs act on those who come, as they do by night: a raid on a friend's camp, where the comers are scouts. */
  works?: boolean;
  /** How much slower the ones on foot go, as a share: roots in a camp that has someone to raise them. */
  slowed?: number;
  /** Who the raiders are, by night: 0 (or nothing) the magpies, 1 a rabble, 2 the Gilded, 3 the Stumbling, 4 frostwights. */
  faction?: number;
  /**
   * (1.5.11) Where scouts come in: a camp is come at down its trail, from the left, and scouts may be put down only
   * this far across the field (and not in among the camp). Absent, anywhere outside the camp (as before; the night's
   * raiders come in at any edge).
   */
  drop?: number;
  /** (1.5.11) Puffcaps the hut has trained for this raid: each blows a wall open (they come out of `capacity`). */
  bombers?: number;
  /** A planned raid: the squad, groups down the camp's approaches. With it nobody is put down by hand. */
  squad?: Squad;
  /** A planned raid's orders, played at their ticks: how a raid is played again exactly as it went. */
  orders?: Order[];
  /** A planned raid's quirk. Absent, a magpie camp's own (`quirkOf`), and none for a camp handed in (a friend's). */
  quirk?: Quirk | null;
  /** A small seed that shakes a planned raid a little (when perches throw first, how close the scouts walk): the forecast's runs. 0 or absent: none. */
  jitter?: number;
};

export type Structure = {
  id: number;
  kind: StructureKind;
  /** The middle of its foot, and how far it reaches about that. */
  x: number;
  y: number;
  r: number;
  hp: number;
  max: number;
  /** What it throws, how far, and how long until it throws again. */
  range: number;
  hit: number;
  every: number;
  cool: number;
  /** In the reader's own camp: which building this is, and at what level, for the picture. */
  look?: { name: string; variant: number };
  /** Who it throws at before anyone else, when one of them is in reach. */
  first?: UnitKind;
  /** The guardian posted at it, for the picture: which one. */
  guard?: number;
  /** A ward: within this far of it, nothing flies. The ones on the wing walk, and are stopped by what stops a walker. */
  grounds?: number;
  /** A hedge: what it does, a second, to whoever on foot is within its own reach of it. */
  cuts?: number;
  /** A thumper: the ones on foot make for it before anything else, while it stands. */
  lures?: boolean;
  /** A smoke brazier: while it stands the larder cannot be seen, and they make for whatever is nearest. */
  hides?: boolean;
  /** Fire: what it throws does so many times as much to the dead and the frozen. */
  burns?: number;
  /** How far about itself a construct of the kinds below acts. */
  zone?: number;
  /** A tanglefoot patch: the share of their pace it takes from whoever on foot is within its zone. */
  slows?: number;
  /** A hornet jar: what it does, a second, to whatever is on the wing within its zone. */
  stings?: number;
  /** A pitfall: how many on foot it will still take. It is stepped on, not fought: nobody makes for it, and it is in nobody's way. */
  traps?: number;
  /** Lies on the ground: walked over, not stopped at, not made for, and not counted with what there was to pull down. */
  flat?: boolean;
  /** A dread totem: whoever is within its zone does this share of the harm they would. */
  daunts?: number;
  /** A watch bell: while anyone is within its zone, the wait between throws is this share of what it was, for everything that throws. */
  rouses?: number;
  /** (Planned raid) The watch-crow's perch. */
  crow?: boolean;
  /** (Planned raid) A wall's gate: the stout one across the trail, or a second gate's weak one. */
  gate?: "main" | "postern";
  /** (Planned raid) Throws at nobody until this many seconds in: a hero's spell. */
  hushed?: number;
};

export type Unit = {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  max: number;
  /** The structure it is at, or making for. */
  target: number | null;
  /** Facing left, for the picture. */
  left: boolean;
  /** At something and pulling it down, for the picture. */
  busy: boolean;
  /** One of the Stumbling that has been put down once already. */
  rose?: boolean;
  /** A Puffcap that has gone off: it is not a scout that fell, and the picture shows a puff where it was. */
  blew?: boolean;
  /** (Planned raid) Its group, by its place in the squad. */
  band?: number;
  /** (Planned raid) How far along its approach's path it is: the next point it walks to. Past the end, it looks after itself. */
  leg?: number;
  /** (Planned raid) What took it, where a hazard did. */
  fell?: "pit" | "thorns";
  /** (Planned raid) Takes no harm until this many seconds in. */
  shield?: number;
  /** (Planned raid) Went through the thorns, and was cut. */
  cut?: boolean;
  /** (Planned raid, shaken) Its own pace, a hair either side of the rest. */
  pace?: number;
};

/** The camp's champion: one villain, who comes out to whoever gets near. */
export type Foe = { variant: number; x: number; y: number; hp: number; max: number; left: boolean; busy: boolean; home: { x: number; y: number }; held?: number };

/** A pebble in the air, for the picture: from, to, and how far along. */
export type Shot = { x0: number; y0: number; x1: number; y1: number; t: number; ours: boolean };

export type Result = {
  stars: 0 | 1 | 2 | 3;
  /** How much of the camp came down, 0 to 1 (walls are in the way, not in the count). */
  destroyed: number;
  /** How many of the hoards were emptied, 0 to 1. */
  hoards: number;
  /** The hero who went was put down, and did not come through it on their feet. */
  heroFell?: boolean;
  /** (Planned raid) Each star: the nest, most of it, the feat. */
  earned?: [boolean, boolean, boolean];
  /** (Planned raid) The stronghold's feat, the third star. */
  feat?: Feat;
  /** (Planned raid) Why each star missed was missed, in the stars' order (`feats.ts` `MISSED`). */
  missed?: Missed[];
  /** (Planned raid) Scouts that fell (a Puffcap that went off did not fall; the hero is `heroFell`). */
  lost?: number;
  /** (Planned raid) Everything that happened, in order (`BattleEvent`). */
  events?: BattleEvent[];
};

/**
 * Something that happened in the fight, for the picture to play (the battle
 * screen's falls, cracks and star pips): what, where, and the tick it was at.
 * The log is kept in `Battle.events`, in order, and is the same every time a
 * raid is played the same way. Cracks come as a structure goes past two
 * thirds and a third of its health (`HURT_AT`).
 */
export type BattleEvent =
  | { tick: number; kind: "hurt"; id: number; structure: StructureKind; x: number; y: number; /** 1: below two thirds; 2: below a third. */ cracks: 1 | 2 }
  | { tick: number; kind: "down"; id: number; structure: StructureKind; x: number; y: number }
  /** A perch fell: its magpie flies off. */
  | { tick: number; kind: "flee"; id: number; x: number; y: number }
  /** A hoard burst: `loot` is the share of the camp's loot it held (the plan's loot times this). */
  | { tick: number; kind: "spill"; id: number; x: number; y: number; loot: number }
  | { tick: number; kind: "nest"; id: number; x: number; y: number }
  /** A section of wall broken: `gate` where it was one. */
  | { tick: number; kind: "breach"; id: number; x: number; y: number; gate?: "main" | "postern" }
  /** A fallen perch manned again (the watch-crow's second flight). */
  | { tick: number; kind: "manned"; id: number; x: number; y: number }
  | { tick: number; kind: "call"; id: number; x: number; y: number }
  /** A pit gave way: `zone` is its place in `Battle.zones`, and `took` how many it took. */
  | { tick: number; kind: "pit"; zone: number; x: number; y: number; took: number }
  | { tick: number; kind: "order"; order: Order }
  /** A star earned (0 the nest, 1 most of it, 2 the feat); `lost` when the second star is lost again (a second flight). */
  | { tick: number; kind: "star"; star: 0 | 1 | 2; lost?: boolean };
export type BattleEventKind = BattleEvent["kind"];
/** The shares of its health below which a structure shows cracks, and more of them. */
export const HURT_AT = [2 / 3, 1 / 3] as const;

/** A planned raid's group as it goes: who is still to come out, down which approach, and what it has been sent at. */
export type Band = {
  /** Still to come out, in the order they will. */
  queue: UnitKind[];
  /** Its approach. */
  via: number;
  held: boolean;
  /** Coming out (or out): a held group once it is released. */
  out: boolean;
  nextAt: number;
  /** The structure it has been rallied to, while that stands. */
  rally: number | null;
  /** How many there were in it. */
  size: number;
  /** The pace it walks its approach at: its slowest scout's, so that it keeps together (the hero keeps up). */
  march: number;
};

// ---- the figures --------------------------------------------------------------

type UnitFigures = { hp: number; dps: number; speed: number; reach: number };
const UNITS: Record<ScoutKind, UnitFigures> = {
  /** Sturdy, and has to be at a thing to pull at it. */
  sprout: { hp: 34, dps: 9, speed: 20, reach: 3 },
  /** Frail, and throws from where a sentry may not reach. */
  slinger: { hp: 18, dps: 7, speed: 18, reach: 30 },
  /** Goes for the loot, under the wall. */
  mole: { hp: 44, dps: 8, speed: 16, reach: 3 },
  /** A Puffcap: runs to the nearest wall and goes off against it (`BLAST`). */
  bomber: { hp: 26, dps: 0, speed: 17, reach: 3 }
};
/** A mole in a planned raid (`RAID_FIGURES.mole`): two places in the party, so sturdier and harder than one by hand. */
const PLANNED_MOLE: UnitFigures = { ...UNITS.mole };
/** The magpies who come by night: frailer than a scout, and there to snatch, not to pull a camp down. One on foot, one on the wing. */
const RAIDERS: Record<ScoutKind, UnitFigures> = {
  sprout: { hp: 12, dps: 1.8, speed: 17, reach: 3 },
  slinger: { hp: 12, dps: 3, speed: 17, reach: 20 },
  mole: { hp: 11, dps: 3, speed: 24, reach: 3 },
  bomber: { hp: 12, dps: 0, speed: 17, reach: 3 }
};
/** What a Puffcap does going off: a section of wall it is at comes down, those beside it lose half, and a building takes this much. */
export const BLAST = 70;
const BLAST_BESIDE = 12;
/**
 * What each kind of night raider is, against a magpie on foot: how sturdy, how
 * hard and how fast, how much harder on a fence; whether it gets up again
 * (and how whole), whether a drum turns it, and how much slower it makes
 * whatever throws near it.
 */
type Faction = { hp: number; dps: number; speed: number; walls: number; rises?: number; proud?: boolean; chills?: number };
const FACTIONS: readonly Faction[] = [
  { hp: 1, dps: 1, speed: 1, walls: 1 },
  { hp: 0.8, dps: 0.9, speed: 1.05, walls: 2.2 },
  { hp: 3.2, dps: 1.7, speed: 1, walls: 1.2, proud: true },
  { hp: 1.1, dps: 1, speed: 0.6, walls: 1, rises: 0.5 },
  { hp: 1.7, dps: 1.2, speed: 0.78, walls: 1, chills: 0.5 }
];
/** How near a frostwight has to be to a thing that throws for it to throw slower. */
const CHILL_REACH = 24;

/** What a mole does to a hoard, as so many times what it does to anything else. */
const MOLE_AT_HOARD = 2.5;
/** How much stronger each level of the hut makes a scout. */
const STRONGER_A_LEVEL = 0.15;
const FASTER = 1.25;
/** How near a healer has to be to mend a scout. */
const HEAL_REACH = 26;

/**
 * How much sturdier each camp is than the one before. (0.1 until 1.5.11. A scout used to stop a hair short of what it
 * was making for, for good, as often as not: the sums left it a fraction too far off to strike, and it stepped that
 * fraction again and again. With that put right the scouts were far stronger than the ladder was set for, and a
 * stronghold is come at from one side since 1.5.11: this puts the ladder back where it was, within a stronghold or two.)
 */
const STURDIER_A_CAMP = 0.16;
const KING_STURDIER = 1.3;
const NEST = { hp: 160, r: 14 };
const KING_NEST = { hp: 260, r: 18 };
const HOARD = { hp: 60, r: 7 };
const PERCH = { hp: 60, r: 5, range: 36, hit: 3.5, every: 0.9 };
const WALL = { hp: 40, r: 5 };
/** How much harder a sentry hits at each camp. */
const HARDER_A_CAMP = 0.055;
/** A camp gains a sentry every third camp, up to this one; the newest hits this much as hard in its first camp, its second and its third. */
const SENTRIES_GROW_TO = 15;
const NEW_SENTRY = [0.45, 0.7, 1];
/** The nest of the tenth camp on throws too, and the King's always. */
const NEST_THROWS_FROM = 9;
const NEST_THROW = { range: 30, hit: 7, every: 1.2 };
const KING_THROW = { range: 44, hit: 12, every: 1.1 };

/** A champion: how sturdy, how hard it hits, how fast, and how near a scout has to come to bring it out. */
const CHAMPION = { hp: 150, dps: 9, speed: 22, wakes: 46, reach: 4 };
/** How near a hero has to be to a champion to turn and fight it. */
const DUEL_REACH = 34;
/** How near a scout has to be to turn on a champion who has hold of somebody else: past its own reach by this. */
const MOB_REACH = 10;

/** Where scouts come in on a stronghold, since 1.5.11: the strip down the left edge of the field, its trail's side. */
export const DROP_STRONGHOLD = 40;
/** How near a camp a scout may be put down: this far from a building's edge, and from a wall's. */
const KEEP_OFF = 16;
const KEEP_OFF_WALL = 6;
const RAIDERS_TOP = 48;

/** The nest counts as so many buildings, in the count of what came down. */
const NEST_COUNTS = 2;

// ---- the figures of a planned raid -------------------------------------------------------

/**
 * A planned raid's figures, in one place, so the balance sim
 * (`scripts/raids/sim.ts`) can try others; the game never changes them.
 *
 * - `planned`: a planned raid's stronghold against the same camp fought by
 *   hand, region by region (the Lands' five, then the Far Rookeries, then
 *   the King): how much sturdier, how much harder its sentries throw, and
 *   how many more sentries it has. A planned raid is fought at the hut a
 *   reader has in that region (the sim's "par"), with a plan made for it and
 *   orders to give, so each region's camps are set against that hut and not
 *   against the ladder's own growth, which outruns the hut late on. Its
 *   nest is sturdier again (`nest`), and always throws (below the tenth
 *   stronghold, where a nest threw by hand, at `nestThrows` of it): the nest is the
 *   first star and the last thing a raid that does not think gets to, so a
 *   raid can pull most of a camp down and still not take it. A lord's
 *   champion is a share of what he is by hand (`champion`), and the rest of
 *   his keep is `keep` of its region's (softer in the first two regions,
 *   where the hut is small): the keep is hard enough with its lord in it.
 * - `level`: how much stronger each level of the hut makes a scout in a
 *   planned raid (0.15 by hand): the hut is the reader's own work, and each
 *   level of it has to be seen to matter on the next stronghold.
 * - `mole`: a planned raid's mole against one by hand: it takes two places
 *   in the party (`ROOM`), so it has to be worth two.
 * - `comeOut`: seconds between one scout of a group coming out and the next:
 *   close, so a group walks as one.
 * - `thorns`: the pace the hedge leaves, and what it cuts a second (more at
 *   each stronghold, as a sentry's pebbles are).
 * - `water`: the pace the ford leaves the ones who wade (a mole goes under).
 * - `pit`: how near a walker has to step to set one off, how near the others
 *   have to be when it gives, how long after, how many it takes at most, and
 *   the share of a sprout's health it costs (a sprout scrambles out).
 * - `fog`: how far the perches see, and how much harder they peck up close.
 * - `crow`: the camp's strength at which the watch-crow calls (the share of
 *   its buildings still standing, the nest counting two, as in the count of
 *   what came down), and how whole its second flight comes.
 * - `gates`: a second gate's stout one and weak one, as so many times a
 *   section of wall.
 */
export const RAID_FIGURES = {
  level: 0.25,
  mole: { hp: 1.6, dps: 1.5 },
  planned: {
    // By region: the Lands' five, the Far Rookeries, the King's roost.
    sturdy: [1.8, 1.6, 1.45, 1.3, 1.3, 1.15, 1],
    hits: [1.8, 1.6, 1.45, 1.3, 1.3, 1.15, 1],
    keep: [0.65, 0.65, 0.8, 0.8, 0.8, 0.8, 1],
    perches: 1,
    nest: 1.8,
    nestThrows: 0.5,
    champion: 0.5
  },
  comeOut: 0.16,
  thorns: { pace: 0.5, cuts: 2.5 },
  water: 0.2,
  pit: { trips: 3, takes: 5, after: 0.25, most: 2, sprout: 0.5 },
  fog: { range: 0.6, hit: 2 },
  crow: { calls: 0.65, flight: 0.5 },
  gates: { main: 2.5, postern: 0.5 }
};
/** A planned stronghold's region, for its figures: 0 to 4 the Lands' regions, 5 the Far Rookeries, 6 the King's roost. */
const regionOf = (n: number, king: boolean) => (king ? 6 : Math.min(5, Math.floor(Math.max(0, n) / 3)));
/** A lord's keep: the last stronghold of each region (the King's roost is his own). */
const keepOf = (n: number, king: boolean) => !king && (Math.floor(Math.max(0, n)) + 1) % 3 === 0;
const plannedSturdy = (n: number, king: boolean) => (RAID_FIGURES.planned.sturdy[regionOf(n, king)] ?? 1) * (keepOf(n, king) ? (RAID_FIGURES.planned.keep[regionOf(n, king)] ?? 1) : 1);
const plannedHits = (n: number, king: boolean) => (RAID_FIGURES.planned.hits[regionOf(n, king)] ?? 1) * (keepOf(n, king) ? (RAID_FIGURES.planned.keep[regionOf(n, king)] ?? 1) : 1);
const THORNS = RAID_FIGURES.thorns;
const PIT = RAID_FIGURES.pit;
const FOG = RAID_FIGURES.fog;
const CROW = RAID_FIGURES.crow;
const GATES = RAID_FIGURES.gates;
/** How near a waypoint counts as at it. */
const AT_POINT = 1.5;
/** The heroes' moves (`heroes.ts` `HERO_MOVES`), in figures. */
const MOVE = {
  mend: 0.5,
  hush: { reach: 50, seconds: 6 },
  wave: { reach: 28, times: 5 },
  volley: { reach: 64, share: 0.35 },
  veil: 5,
  stand: { seconds: 8, takes: 0.5 },
  cleave: 36,
  shield: { reach: 40, seconds: 5 },
  stake: { reach: 40, seconds: 6, share: 0.3 }
};

// ---- laying a camp out -----------------------------------------------------------

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

/** How many hoards, sentries and wall segments a camp has. */
export const campHas = (n: number, king: boolean) => ({
  hoards: king ? 3 : 1 + Math.min(2, Math.floor(n / 2)),
  perches: Math.min(king ? 6 : 5, Math.ceil(n / 3) + (king ? 1 : 0)),
  walls: king ? 10 : n >= 4 ? Math.min(10, n) : 0
});

const sturdyOf = (n: number, king: boolean) => (1 + STURDIER_A_CAMP * n) * (king ? KING_STURDIER : 1);

/**
 * The camp of a number, laid out: the same every time. The hoards and the
 * sentries sit about the nest wherever this camp's own roll puts them, so no
 * two camps are attacked the same way. Since 1.5.11 a stronghold is come at
 * down its trail, from the left: its wall stands straight across that side
 * (x `WALL_X`), its middle section the gate (half as tough again), and it
 * does not reach the top and foot of the field, so there is a way round it
 * for scouts put down wide; or a Puffcap opens it.
 */
export const layout = (n: number, king: boolean, seed = 0, morePerches = 0): Structure[] => {
  const roll = seeded(0xb10c + n * 7919 + (king ? 31 : 0) + Math.imul(seed, 2654435761));
  const sturdy = sturdyOf(n, king);
  const plain = campHas(n, king);
  // (A planned raid's stronghold has a sentry or so more than the camp of its number by hand.)
  const has = { ...plain, perches: plain.perches + Math.max(0, Math.floor(morePerches)) };
  const made: Structure[] = [];
  const add = (kind: StructureKind, x: number, y: number, r: number, hp: number, throws: { range: number; hit: number; every: number } | null, green = 1) => {
    const max = Math.round(hp * sturdy);
    made.push({
      id: made.length,
      kind,
      x: Math.round(Math.min(EDGE.right - r, Math.max(EDGE.left + r, x))),
      y: Math.round(Math.min(EDGE.bottom - 2, Math.max(EDGE.top + r, y))),
      r,
      hp: max,
      max,
      range: throws?.range ?? 0,
      hit: throws ? throws.hit * (1 + HARDER_A_CAMP * n) * green : 0,
      every: throws?.every ?? 0,
      cool: throws ? throws.every : 0
    });
  };
  const nest = king ? KING_NEST : NEST;
  add("nest", CENTRE.x, CENTRE.y, nest.r, nest.hp, king ? KING_THROW : n >= NEST_THROWS_FROM ? NEST_THROW : null);
  // About the nest, on an oval that fits the field: hoards further out, sentries nearer in.
  const turn = roll() * Math.PI * 2;
  for (let index = 0; index < has.hoards; index++) {
    const angle = turn + (index * Math.PI * 2) / has.hoards + (roll() - 0.5) * 0.5;
    add("hoard", CENTRE.x + Math.cos(angle) * 36, CENTRE.y + Math.sin(angle) * 30, HOARD.r, HOARD.hp, null);
  }
  const lean = roll() * Math.PI * 2;
  // The newest sentry is new to the job: a camp with one more of them than the last is not that much harder at a stroke.
  const newest = !king && n <= SENTRIES_GROW_TO ? NEW_SENTRY[(n + 2) % 3] : 1;
  for (let index = 0; index < has.perches; index++) {
    const angle = lean + (index * Math.PI * 2) / Math.max(1, has.perches) + (roll() - 0.5) * 0.6;
    add("perch", CENTRE.x + Math.cos(angle) * 25, CENTRE.y + Math.sin(angle) * 21, PERCH.r, PERCH.hp, PERCH, index === has.perches - 1 ? newest : 1);
  }
  const sections = Math.min(king ? 8 : 6, has.walls);
  for (let index = 0; index < sections; index++) {
    const y = CENTRE.y + (index - (sections - 1) / 2) * 10;
    const gate = Math.abs(y - CENTRE.y) < 5.1 && index === Math.floor((sections - 1) / 2);
    add("wall", WALL_X, y, WALL.r, WALL.hp * (gate ? 1.5 : 1), null);
  }
  return made;
};

/**
 * A stronghold made ready for a planned raid: its quirk worked into it. The
 * fog shortens the perches' reach and sharpens their beaks; the watch-crow's
 * perch is the one furthest back; a second gate means a wall end to end,
 * a stout gate across the trail and a weak one at one end.
 */
const fitQuirk = (made: Structure[], quirk: Quirk | null, n: number, king: boolean, roll: number) => {
  for (const entry of made) {
    entry.hp = entry.max = Math.round(entry.max * plannedSturdy(n, king) * (entry.kind === "nest" ? RAID_FIGURES.planned.nest : 1));
    if (entry.kind === "nest" && entry.range === 0) {
      entry.range = NEST_THROW.range;
      entry.hit = NEST_THROW.hit * (1 + HARDER_A_CAMP * n) * RAID_FIGURES.planned.nestThrows;
      entry.every = entry.cool = NEST_THROW.every;
    }
    entry.hit *= plannedHits(n, king);
  }
  if (quirk === "fog") {
    for (const entry of made) {
      if (entry.range <= 0) continue;
      entry.range = Math.round(entry.range * FOG.range);
      entry.hit *= FOG.hit;
    }
  }
  if (quirk === "crow") {
    // The perch furthest from where the trail comes in: the last a raid that does not think gets to.
    const away = (entry: Structure) => far(entry.x, entry.y, EDGE.left, CENTRE.y);
    const crow = made.filter((entry) => entry.kind === "perch").reduce<Structure | null>((best, entry) => (!best || away(entry) > away(best) ? entry : best), null);
    if (crow) crow.crow = true;
  }
  if (quirk === "gate") {
    for (let index = made.length - 1; index >= 0; index--) if (made[index].kind === "wall") made.splice(index, 1);
    const section = Math.round(WALL.hp * sturdyOf(n, king) * plannedSturdy(n, king));
    const postern = posternTop(roll) ? POSTERN_Y.top : POSTERN_Y.bottom;
    for (let y = CENTRE.y - 50; y <= CENTRE.y + 50; y += 10) {
      const gate = y === CENTRE.y ? "main" : y === postern ? "postern" : undefined;
      const max = Math.round(section * (gate === "main" ? GATES.main : gate === "postern" ? GATES.postern : 1));
      made.push({ id: made.length, kind: "wall", x: WALL_X, y, r: WALL.r, hp: max, max, range: 0, hit: 0, every: 0, cool: 0, ...(gate ? { gate } : {}) });
    }
  } else {
    // Any other wall's gate is its toughest section, across the trail.
    const gate = made.filter((entry) => entry.kind === "wall").reduce<Structure | null>((best, entry) => (!best || entry.max > best.max ? entry : best), null);
    if (gate && gate.max > Math.round(WALL.hp * sturdyOf(n, king) * plannedSturdy(n, king))) gate.gate = "main";
  }
};

// ---- the battle ---------------------------------------------------------------------

/** How far apart two points are. (A square root and not `Math.hypot`, which is several times slower, and a battle asks it thousands of times a second.) */
const far = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Whether the straight way from a point to another passes through a circle. */
const crosses = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / length));
  return far(ax + dx * along, ay + dy * along, cx, cy) < r;
};

const NONE: Structure[] = [];
/** Which of its states a structure's health puts it in: 0 whole, 1 and 2 cracked (`HURT_AT`), 3 down. */
const healthBand = (entry: Structure) => (entry.hp <= 0 ? 3 : entry.hp < entry.max * HURT_AT[1] ? 2 : entry.hp < entry.max * HURT_AT[0] ? 1 : 0);
/** Where a unit is past the end of its approach's path. */
const PATH_DONE = 1e9;

export class Battle {
  readonly setup: Setup;
  readonly structures: Structure[];
  readonly units: Unit[] = [];
  /** The camp's champion, while it has one standing. */
  foe: Foe | null = null;
  shots: Shot[] = [];
  /** Seconds gone. */
  time = 0;
  /** Steps taken: what an order's `tick` counts. */
  ticks = 0;
  /** Scouts still to put down, and whether the hero still is. */
  left: number;
  heroLeft: boolean;
  over = false;
  private made = 0;
  /** Puffcaps still to put down. */
  bombersLeft: number;

  /** A planned raid (the setup has a squad). */
  readonly planned: boolean;
  /** A planned raid's ways in, and the hazards on them; none otherwise. */
  readonly approaches: Approach[] = [];
  readonly zones: Zone[] = [];
  readonly quirk: Quirk | null = null;
  /** The third star: the quirk's feat, or all of it for a camp with none. */
  readonly feat: Feat | null = null;
  /** A planned raid's groups as they go. */
  readonly bands: Band[] = [];
  /** Orders still to give, and the ones given, each with its tick: `{ ...setup, orders: battle.given }` plays the raid again. */
  ordersLeft = 0;
  readonly given: Order[] = [];
  heroMoved = false;
  /** The watch-crow's perch, and when it called and when it fell (seconds in; null for not yet). */
  readonly crow: Structure | null = null;
  crowCalledAt: number | null = null;
  crowFellAt: number | null = null;
  /** When the nest fell. */
  nestAt: number | null = null;
  /** Each pit's state, by its place in `zones`: 0 waiting, a time it gives at, or -1 done. */
  readonly pits: number[] = [];
  /** Hero's moves that last: until when no sentry sees anyone, and every sentry throws at the hero. */
  veiled = 0;
  stood = 0;
  /** What has happened, in order: the picture reads on from where it last read to. */
  readonly events: BattleEvent[] = [];
  /** Each structure as last seen: 0 whole, 1 and 2 cracked, 3 down; and its health then (unchanged, nothing to look at). */
  private readonly seen: number[];
  private readonly seenHp: number[];
  /** Whether anything of the camp still stands, as of the last look. */
  private campStands = true;
  /** The planned stars as last seen: the nest's, and most of it. */
  private starred: [boolean, boolean] = [false, false];

  /** Fixed lists, so a step makes no new ones: the walls, and what the night's constructs are. */
  private readonly walls: Structure[];
  private readonly wards: Structure[];
  private readonly patches: Structure[];
  private readonly totems: Structure[];
  private readonly counted: Structure[];
  private readonly scheduled: Order[];
  private nextOrder = 0;
  /** How much harder a planned stronghold's champion hits (its region's `RAID_FIGURES.planned.hits`). */
  private readonly foeHits: number = 1;
  private readonly shake: (() => number) | null = null;

  /** `structures`: the camp to fight over, when it is not a magpie camp laid out by its number (the reader's own, at night). */
  constructor(setup: Setup, structures?: Structure[]) {
    this.setup = setup;
    this.planned = Boolean(setup.squad) && !setup.raiders;
    this.structures = structures
      ? structures.map((entry, id) => ({ ...entry, id }))
      : layout(setup.n, setup.king, setup.seed ?? 0, this.planned ? RAID_FIGURES.planned.perches : 0);
    this.left = this.planned ? 0 : Math.max(0, Math.floor(setup.capacity));
    this.heroLeft = !this.planned && Boolean(setup.hero);
    this.bombersLeft = setup.kinds.includes("bomber") ? Math.max(0, Math.floor(setup.bombers ?? 0)) : 0;
    if (this.planned) {
      PLANNED_MOLE.hp = UNITS.mole.hp * RAID_FIGURES.mole.hp;
      PLANNED_MOLE.dps = UNITS.mole.dps * RAID_FIGURES.mole.dps;
      const roll = rollOf(setup.n, setup.seed ?? 0, setup.king);
      this.quirk = setup.quirk !== undefined ? setup.quirk : structures ? null : quirkOf(setup.n, setup.king, setup.seed ?? 0);
      this.feat = this.quirk ? QUIRKS[this.quirk].feat : "whole";
      if (!structures) fitQuirk(this.structures, this.quirk, setup.n, setup.king, roll);
      const ways = approachesOf(this.structures, { quirk: this.quirk, roll: structures ? -1 : roll, line: structures ? undefined : WALL_X });
      this.approaches.push(...ways.approaches);
      this.zones.push(...ways.zones);
      for (const zone of this.zones) this.pits.push(zone.kind === "pit" ? 0 : -1);
      this.crow = this.structures.find((entry) => entry.crow) ?? null;
      this.bombersLeft = 0;
      this.ordersLeft = ordersAt(setup.level);
      if (setup.jitter) {
        this.shake = seeded(0x5eed + Math.imul(setup.jitter, 2654435761));
        for (const entry of this.structures) if (entry.every > 0) entry.cool = entry.every * (0.4 + 0.6 * this.shake());
      }
      this.bandsOf(setup.squad!);
    }
    this.walls = this.structures.filter((entry) => entry.kind === "wall");
    this.wards = this.structures.filter((entry) => entry.grounds);
    this.patches = this.structures.filter((entry) => entry.slows);
    this.totems = this.structures.filter((entry) => entry.daunts);
    this.counted = this.structures.filter((entry) => entry.kind !== "wall" && entry.traps === undefined && !entry.flat);
    this.scheduled = this.planned ? [...(setup.orders ?? [])].sort((a, b) => a.tick - b.tick) : [];
    this.seen = this.structures.map((entry) => healthBand(entry));
    this.seenHp = this.structures.map((entry) => entry.hp);
    if (setup.champion !== null && setup.champion !== undefined && !setup.raiders) {
      const nest = this.structures[0];
      const max = Math.round(
        CHAMPION.hp * (1 + STURDIER_A_CAMP * setup.n) * (setup.king ? KING_STURDIER : 1) * (this.planned && !structures ? plannedSturdy(setup.n, setup.king) * RAID_FIGURES.planned.champion : 1)
      );
      // He stands before the nest, on the side the walls are.
      const home = { x: nest.x - nest.r - 8, y: nest.y + 4 };
      this.foe = { variant: setup.champion, ...home, hp: max, max, left: true, busy: false, home };
      if (this.planned && !structures) this.foeHits = plannedHits(setup.n, setup.king) * RAID_FIGURES.planned.champion;
    }
  }

  /** A planned raid's squad, as groups waiting to come out: within the hut's room and trained kinds (what is over is left at home). */
  private bandsOf(squad: Squad) {
    const { setup } = this;
    const room = ROOM;
    let free = Math.max(0, Math.floor(setup.capacity));
    let held = false;
    const heroAt = Math.max(0, squad.groups.findIndex((group) => group.hero));
    squad.groups.forEach((group, index) => {
      const queue: UnitKind[] = [];
      // Puffcaps lead, to whatever wall is in the way; then the throwers and the moles; the sprouts last. (So a group
      // walks into what lies on the trail throwers first: sprouts that are to go first go as a group of their own.)
      for (const kind of ["bomber", "slinger", "mole", "sprout"] as const) {
        if (!setup.kinds.includes(kind)) continue;
        const want = Math.max(0, Math.floor(group.scouts[kind] ?? 0));
        for (let count = 0; count < want && free >= room[kind]; count++) {
          queue.push(kind);
          free -= room[kind];
        }
      }
      if (setup.hero && index === heroAt) queue.splice(Math.min(3, queue.length), 0, "hero");
      const via = Math.max(0, Math.min(this.approaches.length - 1, Math.floor(group.approach)));
      const hold = Boolean(group.held) && !held;
      held = held || hold;
      const march = Math.min(Infinity, ...queue.filter((kind) => kind !== "hero").map((kind) => this.figures(kind).speed));
      this.bands.push({ queue, via, held: hold, out: !hold, nextAt: 0, rally: null, size: queue.length, march: Number.isFinite(march) ? march : 0 });
    });
  }

  private get top() {
    return this.setup.raiders ? RAIDERS_TOP : EDGE.top;
  }

  /** Whether a scout may be put down at a point: on the field, and not in among the camp. (Never, in a planned raid: they come down their approaches.) */
  canDeploy(x: number, y: number, hero = false): boolean {
    if (this.over || this.planned || (hero ? !this.heroLeft : this.left <= 0)) return false;
    if (x < EDGE.left || x > EDGE.right || y < this.top || y > EDGE.bottom) return false;
    // Raiders come in at the edge, however near it the camp was built.
    if (this.setup.raiders) return true;
    // Down the trail, from the left: only so far across the field.
    if (this.setup.drop !== undefined && x > this.setup.drop) return false;
    // (What lies on the ground, a trap, is walked onto, not kept off.)
    return !this.structures.some((entry) => entry.hp > 0 && !entry.flat && entry.traps === undefined && far(x, y, entry.x, entry.y) < entry.r + (entry.kind === "wall" ? KEEP_OFF_WALL : KEEP_OFF));
  }

  /** Who the raiders are: the magpies, unless the night says otherwise. */
  private get faction(): Faction {
    return (this.setup.raiders && FACTIONS[this.setup.faction ?? 0]) || FACTIONS[0];
  }

  private figures(kind: UnitKind): UnitFigures {
    if (kind === "hero") return this.setup.hero!;
    // A mole takes two places in a planned raid's party, and is as stout as that.
    if (this.planned && kind === "mole") return PLANNED_MOLE;
    if (!this.setup.raiders) return UNITS[kind];
    const plain = RAIDERS[kind];
    const made = this.faction;
    return { hp: plain.hp * made.hp, dps: plain.dps * made.dps, speed: plain.speed * made.speed, reach: plain.reach };
  }

  private get strong() {
    return 1 + (this.planned ? RAID_FIGURES.level : STRONGER_A_LEVEL) * (Math.min(5, Math.max(1, this.setup.level)) - 1);
  }

  /** Puts a scout down. False when it cannot be put there (or there are none left, or the hut has not trained that kind). */
  deploy(kind: UnitKind, x: number, y: number): boolean {
    const hero = kind === "hero";
    if (hero ? !this.setup.hero : !this.setup.kinds.includes(kind)) return false;
    if (kind === "bomber" && this.bombersLeft <= 0) return false;
    if (!this.canDeploy(x, y, hero)) return false;
    const max = Math.round(this.figures(kind).hp * this.strong);
    // A hair apart, so scouts put down on one spot do not walk as one.
    const nudge = ((this.made * 7) % 5) - 2;
    this.units.push({ id: this.made++, kind, x, y: Math.min(EDGE.bottom, Math.max(this.top, y + nudge * 0.6)), hp: max, max, target: null, left: false, busy: false });
    if (hero) this.heroLeft = false;
    else this.left -= 1;
    if (kind === "bomber") this.bombersLeft -= 1;
    return true;
  }

  /** A planned raid's scout comes out at the start of its group's approach. */
  private comeOut(band: Band, index: number) {
    const kind = band.queue.shift()!;
    const start = this.approaches[band.via]?.path[0] ?? { x: EDGE.left + 2, y: CENTRE.y };
    const max = Math.round(this.figures(kind).hp * this.strong);
    const nudge = ((this.made * 7) % 5) - 2;
    const shaken = this.shake ? (this.shake() - 0.5) * 2 : 0;
    const unit: Unit = { id: this.made++, kind, x: start.x, y: start.y + nudge * 0.6 + shaken, hp: max, max, target: null, left: false, busy: false, band: index, leg: band.rally === null ? 1 : PATH_DONE };
    if (this.shake) unit.pace = 1 + (this.shake() - 0.5) * 0.06;
    this.units.push(unit);
  }

  /**
   * An order, given now: a rally, the held group released, or the hero's move.
   * False when it cannot be given (none left, or nothing for it to do). One
   * given is kept, with its tick, in `given`.
   */
  order(given: OrderGiven): boolean {
    const made = { ...given, tick: this.ticks } as Order;
    if (!this.obey(made)) return false;
    this.given.push(made);
    return true;
  }

  private obey(order: Order): boolean {
    if (!this.planned || this.over || this.ordersLeft <= 0) return false;
    let done = false;
    if (order.kind === "rally") {
      const band = this.bands[order.group];
      const target = this.structures[order.target];
      if (band && target && target.hp > 0 && target.kind !== "wall" && !target.flat && target.traps === undefined && (band.queue.length > 0 || this.units.some((unit) => unit.band === order.group && unit.hp > 0))) {
        band.rally = target.id;
        for (const unit of this.units) if (unit.band === order.group) unit.leg = PATH_DONE;
        done = true;
      }
    } else if (order.kind === "release") {
      const band = this.bands.find((entry) => entry.held && !entry.out);
      if (band) {
        band.out = true;
        band.nextAt = this.time;
        done = true;
      }
    } else done = this.heroAct(order.target);
    if (done) {
      this.ordersLeft -= 1;
      this.events.push({ tick: this.ticks, kind: "order", order });
      this.scan();
    }
    return done;
  }

  /** The hero's one big act (`heroes.ts` `HERO_MOVES`), once a raid, with the hero on the field. */
  private heroAct(aim?: number): boolean {
    const hero = this.setup.hero ? this.units.find((unit) => unit.kind === "hero" && unit.hp > 0) : undefined;
    if (!hero || this.heroMoved) return false;
    const kind = heroMove(this.setup.hero!.id);
    const near = (x: number, y: number, r: number, reach: number) => far(hero.x, hero.y, x, y) - r <= reach;
    switch (kind) {
      case "mend":
        for (const unit of this.units) if (unit.hp > 0) unit.hp = Math.min(unit.max, unit.hp + unit.max * MOVE.mend);
        break;
      case "hush":
        for (const entry of this.structures) if (entry.hp > 0 && entry.range > 0 && near(entry.x, entry.y, entry.r, MOVE.hush.reach)) entry.hushed = this.time + MOVE.hush.seconds;
        break;
      case "wave": {
        const blow = this.setup.hero!.dps * this.strong * MOVE.wave.times;
        for (const entry of this.structures) {
          if (entry.hp <= 0 || entry.flat || entry.traps !== undefined || !near(entry.x, entry.y, entry.r, MOVE.wave.reach)) continue;
          entry.hp = Math.max(0, entry.hp - blow * (entry.kind === "wall" ? 2 : 1));
        }
        break;
      }
      case "vault": {
        const aimed = aim !== undefined ? this.structures[aim] : undefined;
        const at = aimed && aimed.hp > 0 && aimed.kind !== "wall" && !aimed.flat ? aimed : this.structures[0];
        if (!at || at.hp <= 0) return false;
        hero.x = at.x - at.r - 2;
        hero.y = at.y;
        hero.target = at.id;
        hero.leg = PATH_DONE;
        break;
      }
      case "volley":
        for (const entry of this.structures) if (entry.hp > 0 && entry.kind === "perch" && near(entry.x, entry.y, entry.r, MOVE.volley.reach)) entry.hp = Math.max(0, entry.hp - entry.max * MOVE.volley.share);
        break;
      case "veil":
        this.veiled = this.time + MOVE.veil;
        break;
      case "stand":
        this.stood = this.time + MOVE.stand.seconds;
        break;
      case "cleave":
        for (const entry of this.walls) if (entry.hp > 0 && near(entry.x, entry.y, entry.r, MOVE.cleave)) entry.hp = 0;
        break;
      case "shield":
        for (const unit of this.units) if (unit.hp > 0 && far(unit.x, unit.y, hero.x, hero.y) <= MOVE.shield.reach) unit.shield = this.time + MOVE.shield.seconds;
        break;
      case "stake": {
        const foe = this.foe && this.foe.hp > 0 && far(hero.x, hero.y, this.foe.x, this.foe.y) <= MOVE.stake.reach ? this.foe : null;
        if (foe) {
          foe.hp = Math.max(0, foe.hp - foe.max * MOVE.stake.share);
          foe.held = this.time + MOVE.stake.seconds;
        } else {
          const at = (hero.target !== null ? this.structures[hero.target] : undefined) ?? this.structures[0];
          if (!at || at.hp <= 0 || !near(at.x, at.y, at.r, MOVE.stake.reach)) return false;
          at.hp = Math.max(0, at.hp - at.max * MOVE.stake.share);
        }
        break;
      }
      default:
        return false;
    }
    this.heroMoved = true;
    return true;
  }

  /** How much of a harm a scout takes now: none under a shield. */
  private harmTo(unit: Unit) {
    return unit.shield !== undefined && unit.shield > this.time ? 0 : 1;
  }

  /** What a planned raid's ground does to a walker's pace here: thorns and water slow, and a mole is under both. */
  private paceAt(unit: Unit) {
    let pace = unit.pace ?? 1;
    if (unit.kind === "mole" || this.zones.length === 0) return pace;
    const leaps = unit.kind === "hero" && Boolean(this.setup.hero?.leaps);
    for (const zone of this.zones) {
      if (zone.kind === "pit" || leaps) continue;
      if (unit.x >= zone.x0 && unit.x <= zone.x1 && unit.y >= zone.y0 && unit.y <= zone.y1) pace *= zone.kind === "thorns" ? THORNS.pace : RAID_FIGURES.water;
    }
    return pace;
  }

  /** The nearest standing thing, by its edge, of those that pass; the first of equals. */
  private nearest(unit: Unit, pass: (entry: Structure) => boolean): Structure | null {
    let best: Structure | null = null;
    let bestGap = 0;
    for (const entry of this.structures) {
      if (!pass(entry)) continue;
      const gap = far(unit.x, unit.y, entry.x, entry.y) - entry.r;
      if (!best || gap < bestGap) {
        best = entry;
        bestGap = gap;
      }
    }
    return best;
  }

  /** What a scout makes for: a mole the nearest hoard, a hero what they prefer, anyone the nearest thing standing. A magpie by night makes for the larder. */
  private pick(unit: Unit): Structure | null {
    // (A pitfall is not a thing to make for: it is found by stepping on it.)
    const standing = (entry: Structure) => entry.hp > 0 && entry.traps === undefined && !entry.flat && entry.kind !== "wall";
    // A Puffcap: the nearest wall standing (the gate as soon as any other), and with none, the nearest building.
    // (In a planned raid it blows whatever wall is in its way, and makes for the nearest building.)
    if (unit.kind === "bomber") return (this.planned ? null : this.nearest(unit, (entry) => entry.kind === "wall" && entry.hp > 0)) ?? this.nearest(unit, standing);
    // By night every magpie is after the larder: the ones on foot go straight for it too, and have to get through whatever is in the way.
    // A thumper's drumming draws the ones on foot: they go to it while it stands, and the larder waits.
    if (this.setup.raiders && unit.kind !== "mole" && !this.faction.proud) {
      const lure = this.nearest(unit, (entry) => Boolean(entry.lures) && entry.hp > 0);
      if (lure) return lure;
    }
    // Under a brazier's smoke the larder is not to be seen: they go for what is nearest, as a scout does.
    const hidden = this.setup.raiders && this.structures.some((entry) => entry.hides && entry.hp > 0);
    const first = hidden ? undefined : unit.kind === "mole" || this.setup.raiders ? "hoard" : unit.kind === "hero" ? this.setup.hero?.prefers : undefined;
    // In a planned raid a scout left to itself leaves the nest till last: the heart of the camp is what a rally is for.
    const besides = this.planned ? (entry: Structure) => standing(entry) && entry.kind !== "nest" : standing;
    return (first ? this.nearest(unit, (entry) => standing(entry) && entry.kind === first) : null) ?? (this.planned ? this.nearest(unit, besides) : null) ?? this.nearest(unit, standing);
  }

  step(dt: number): void {
    if (this.over) return;
    // Orders due now are given as a reader's would be, between one step and the next: before the clock moves on.
    if (this.planned) this.ordersDue();
    this.time += dt;
    const strong = this.strong;
    const walls = this.walls;
    const raiders = Boolean(this.setup.raiders);
    const planned = this.planned;
    // The constructs standing as the step begins: a ward, a patch or a totem pulled down in it still counts until the next.
    const wards = raiders ? this.wards.filter((entry) => entry.hp > 0) : NONE;
    // The camp's constructs act on whoever comes to it: the night's raiders, and a friend's scouts.
    const acting = Boolean(raiders || this.setup.works);
    const patches = acting ? this.patches.filter((entry) => entry.hp > 0) : NONE;
    const totems = acting ? this.totems.filter((entry) => entry.hp > 0) : NONE;
    const hero = this.setup.hero ?? null;
    const foe = this.foe && this.foe.hp > 0 ? this.foe : null;
    const grounded = (unit: Unit) => {
      for (const ward of wards) if (far(unit.x, unit.y, ward.x, ward.y) <= (ward.grounds ?? 0)) return true;
      return false;
    };

    if (planned) this.plannedBefore();

    // The champion: out to the nearest scout that has come near, a hero before anyone; home again when none has.
    let foeAt: Unit | null = null;
    if (foe) {
      let foeGap = 0;
      for (const unit of this.units) {
        if (unit.hp <= 0) continue;
        const gap = far(unit.x, unit.y, foe.x, foe.y);
        if (gap > CHAMPION.wakes) continue;
        // A hero before anyone, then the nearest, then the first put down.
        if (!foeAt || (unit.kind === "hero" && foeAt.kind !== "hero") || ((unit.kind === "hero") === (foeAt.kind === "hero") && (gap < foeGap || (gap === foeGap && unit.id < foeAt.id)))) {
          foeAt = unit;
          foeGap = gap;
        }
      }
      // Held still by a hero's stake, he does nothing until it lets go.
      if (planned && foe.held !== undefined && foe.held > this.time) foeAt = null;
      const to = foeAt ?? foe.home;
      const gap = far(foe.x, foe.y, to.x, to.y);
      foe.busy = false;
      if (planned && foe.held !== undefined && foe.held > this.time) {
        // (Where he stands.)
      } else if (gap > (foeAt ? CHAMPION.reach : 1)) {
        const stride = Math.min(gap, CHAMPION.speed * dt);
        foe.x += ((to.x - foe.x) / gap) * stride;
        foe.y += ((to.y - foe.y) / gap) * stride;
        foe.left = to.x < foe.x;
      } else if (foeAt) {
        foeAt.hp = Math.max(0, foeAt.hp - CHAMPION.dps * (1 + HARDER_A_CAMP * this.setup.n) * dt * (planned ? this.harmTo(foeAt) * this.foeHits : 1));
        foe.busy = true;
      }
    }

    for (const unit of this.units) {
      if (unit.hp <= 0) continue;
      const figures = this.figures(unit.kind);
      const traits = unit.kind === "hero" ? hero : null;
      const dps = figures.dps * strong;

      // Whoever the champion has hold of fights back, and so does any scout close by; a hero turns to meet him from further off.
      const toFoe = foe ? far(unit.x, unit.y, foe.x, foe.y) : Infinity;
      // (A Puffcap does not stop to fight: it runs on to the wall, the champion at its heels or not.)
      if (foe && unit.kind !== "bomber" && (foeAt === unit || toFoe <= (traits ? DUEL_REACH : figures.reach + MOB_REACH))) {
        const gap = far(unit.x, unit.y, foe.x, foe.y);
        unit.left = foe.x < unit.x;
        if (gap > Math.max(figures.reach, CHAMPION.reach)) {
          const stride = Math.min(gap, figures.speed * dt);
          unit.x += ((foe.x - unit.x) / gap) * stride;
          unit.y += ((foe.y - unit.y) / gap) * stride;
          unit.busy = false;
        } else {
          foe.hp = Math.max(0, foe.hp - dps * (traits?.times?.champion ?? 1) * dt);
          unit.busy = true;
        }
        continue;
      }

      // By night a mole is a magpie on the wing, and inside a ward's ring it is on foot like the rest.
      const flies = unit.kind === "mole" && !grounded(unit);

      // A planned raid's scout walks its approach's path, until it ends or the group is rallied.
      let point: { x: number; y: number } | null = null;
      let goal: Structure | null = null;
      if (planned && unit.band !== undefined) {
        const band = this.bands[unit.band];
        const rally = band.rally !== null ? this.structures[band.rally] : null;
        if (rally && rally.hp > 0) {
          goal = rally;
          unit.leg = PATH_DONE;
        } else {
          if (rally) band.rally = null;
          const path = this.approaches[band.via]?.path;
          if (path && (unit.leg ?? PATH_DONE) < path.length) {
            const next = path[unit.leg!];
            if (far(unit.x, unit.y, next.x, next.y) <= AT_POINT) unit.leg! += 1;
            if (unit.leg! < path.length) point = path[unit.leg!];
          }
        }
      }
      if (!point && !goal) {
        goal = unit.target === null ? null : (this.structures[unit.target] ?? null);
        if (!goal || goal.hp <= 0 || (goal.kind === "wall" && unit.kind !== "bomber")) {
          goal = this.pick(unit);
        }
      }
      if (!goal && !point) {
        unit.busy = false;
        continue;
      }
      // A wall across the way is the thing to pull down first; a mole goes under, and some heroes over.
      let at: Structure | null = goal;
      if (!flies && !traits?.leaps) {
        const toX = point ? point.x : goal!.x;
        const toY = point ? point.y : goal!.y;
        const reachOfGoal = point ? Infinity : far(unit.x, unit.y, goal!.x, goal!.y) - goal!.r;
        if (reachOfGoal > figures.reach) {
          // By night a building in the way is in the way as a fence is: the larder is reached through whatever stands before it.
          const blocks = raiders ? this.structures : walls;
          let inWay: Structure | null = null;
          let inWayGap = 0;
          // (Only what stands within the box the way spans can be across it: the rest is not looked at closely.)
          const left = Math.min(unit.x, toX);
          const right = Math.max(unit.x, toX);
          const top = Math.min(unit.y, toY);
          const foot = Math.max(unit.y, toY);
          for (const wall of blocks) {
            const pad = wall.r + 1;
            if (wall.x < left - pad || wall.x > right + pad || wall.y < top - pad || wall.y > foot + pad) continue;
            // A patch of tanglefoot and a pitfall are walked into, not stopped at.
            if ((raiders && wall === goal) || wall.hp <= 0 || wall.flat || wall.traps !== undefined || !crosses(unit.x, unit.y, toX, toY, wall.x, wall.y, pad)) continue;
            const gap = far(unit.x, unit.y, wall.x, wall.y);
            if (!inWay || gap < inWayGap) {
              inWay = wall;
              inWayGap = gap;
            }
          }
          if (inWay) at = inWay;
        }
      }
      if (!at) {
        // On its way down its approach, with nothing in the way.
        const target = point!;
        const gap = far(unit.x, unit.y, target.x, target.y);
        unit.left = target.x < unit.x;
        unit.busy = false;
        unit.target = null;
        if (gap > 1e-6) {
          // A group walks its approach together, at its slowest scout's pace.
          const march = unit.band !== undefined ? this.bands[unit.band].march : 0;
          const speed = (march > 0 ? Math.min(figures.speed, march) : figures.speed) * (this.setup.fast ? FASTER : 1) * this.paceAt(unit);
          const stride = Math.min(gap, speed * dt);
          unit.x += ((target.x - unit.x) / gap) * stride;
          unit.y += ((target.y - unit.y) / gap) * stride;
        }
        continue;
      }
      unit.target = at.id;
      const gap = far(unit.x, unit.y, at.x, at.y) - at.r;
      // A thrower stops where it can reach; at a wall everyone has to be at it.
      const reach = at.kind === "wall" ? Math.min(figures.reach, 8) : figures.reach;
      unit.left = at.x < unit.x;
      if (gap > reach + 1e-6) {
        // On the wing by night, nothing on the ground has hold of them.
        const onWing = raiders && flies;
        let tangled = 0;
        if (!onWing) for (const patch of patches) if (far(unit.x, unit.y, patch.x, patch.y) <= (patch.zone ?? 0)) tangled = Math.max(tangled, patch.slows ?? 0);
        let speed = figures.speed * (this.setup.fast ? FASTER : 1) * (unit.kind === "mole" ? 1 : 1 - Math.min(0.6, Math.max(0, this.setup.slowed ?? 0))) * (1 - Math.min(0.8, tangled));
        if (planned) speed *= this.paceAt(unit);
        const stride = Math.min(gap - reach, speed * dt);
        const length = far(unit.x, unit.y, at.x, at.y) || 1;
        unit.x += ((at.x - unit.x) / length) * stride;
        unit.y += ((at.y - unit.y) / length) * stride;
        unit.busy = false;
      } else if (unit.kind === "bomber") {
        // At it: off he goes. A section of wall is down, and those beside it the worse; a building takes the blast.
        if (at.kind === "wall") {
          at.hp = 0;
          for (const other of walls) if (other !== at && other.hp > 0 && far(other.x, other.y, at.x, at.y) <= BLAST_BESIDE) other.hp = Math.max(0, other.hp - other.max * 0.5);
        } else at.hp = Math.max(0, at.hp - BLAST);
        unit.hp = 0;
        unit.busy = false;
        unit.blew = true;
      } else {
        const times = (kind: StructureKind) =>
          unit.kind === "mole" && kind === "hoard" ? MOLE_AT_HOARD : raiders && kind === "wall" ? this.faction.walls : (traits?.times?.[kind] ?? 1);
        // Near a dread totem they have no heart for it.
        let heart = 1;
        for (const totem of totems) if (far(unit.x, unit.y, totem.x, totem.y) <= (totem.zone ?? 0)) heart = Math.min(heart, totem.daunts ?? 1);
        at.hp = Math.max(0, at.hp - dps * times(at.kind) * dt * heart);
        if (traits?.splash) {
          for (const other of this.structures) {
            if (other !== at && other.hp > 0 && far(other.x, other.y, at.x, at.y) - other.r <= traits.splash) other.hp = Math.max(0, other.hp - dps * times(other.kind) * dt * heart);
          }
        }
        unit.busy = true;
        if (figures.reach > 8 && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) {
          this.shots.push({ x0: unit.x, y0: unit.y - 8, x1: at.x, y1: at.y - at.r, t: 0, ours: true });
        }
      }
    }

    // A hedge cuts whoever on foot is in it.
    if (acting) {
      // By night a mole is a magpie on the wing unless a ward has it on the ground; by day it is a scout that digs, and is on foot like the rest.
      const onWing = (unit: Unit) => raiders && unit.kind === "mole" && !grounded(unit);
      for (const hedge of this.structures) {
        if (!hedge.cuts || hedge.hp <= 0) continue;
        for (const unit of this.units) {
          if (unit.hp > 0 && !onWing(unit) && far(unit.x, unit.y, hedge.x, hedge.y) <= hedge.r + 6) unit.hp = Math.max(0, unit.hp - hedge.cuts * dt);
        }
      }
      // The hornets are at whatever is on the wing near their jar.
      for (const jar of this.structures) {
        if (!jar.stings || jar.hp <= 0) continue;
        for (const unit of this.units) {
          if (unit.hp > 0 && onWing(unit) && far(unit.x, unit.y, jar.x, jar.y) <= (jar.zone ?? 0)) unit.hp = Math.max(0, unit.hp - jar.stings * dt);
        }
      }
      // A pitfall takes whoever on foot steps on it, sturdy or not, until it is full. A hero sees it, and goes round.
      for (const pit of this.structures) {
        if (!pit.traps || pit.hp <= 0) continue;
        for (const unit of this.units) {
          if (pit.traps <= 0) break;
          if (unit.hp <= 0 || unit.kind === "hero" || onWing(unit) || far(unit.x, unit.y, pit.x, pit.y) > pit.r + 3) continue;
          unit.hp = 0;
          pit.traps -= 1;
        }
        if (pit.traps <= 0) pit.hp = 0;
      }
    }
    if (planned) this.hazards(dt);
    // The watch bell: while anyone is near it, it is ringing, and the camp is quicker for it.
    let bell = 1;
    if (acting) {
      for (const entry of this.structures) {
        if (!entry.rouses || entry.hp <= 0 || entry.rouses >= bell) continue;
        if (this.units.some((unit) => unit.hp > 0 && far(unit.x, unit.y, entry.x, entry.y) <= (entry.zone ?? 0))) bell = entry.rouses;
      }
    }

    // A hero who mends: one scout at a time, whoever near them is worst hurt.
    if (hero?.heals) {
      const healer = this.units.find((unit) => unit.kind === "hero" && unit.hp > 0);
      if (healer) {
        let hurt: Unit | null = null;
        for (const unit of this.units) {
          if (unit === healer || unit.hp <= 0 || unit.hp >= unit.max || far(unit.x, unit.y, healer.x, healer.y) > HEAL_REACH) continue;
          if (!hurt || unit.hp / unit.max < hurt.hp / hurt.max || (unit.hp / unit.max === hurt.hp / hurt.max && unit.id < hurt.id)) hurt = unit;
        }
        if (hurt) hurt.hp = Math.min(hurt.max, hurt.hp + hero.heals * dt);
      }
    }

    const veiled = planned && this.veiled > this.time;
    const stood = planned && this.stood > this.time;
    const taunts = Boolean(hero?.taunts);
    for (const thrower of this.structures) {
      if (thrower.hp <= 0 || thrower.range === 0) continue;
      // Under a hero's spell it throws at nobody, and is no readier for it after.
      if (planned && thrower.hushed !== undefined && thrower.hushed > this.time) continue;
      thrower.cool -= dt;
      if (thrower.cool > 0) continue;
      const reach = thrower.range + thrower.r;
      const reachSquared = reach * reach;
      let mark: Unit | null = null;
      let markGap = 0;
      if (!veiled) {
        for (const unit of this.units) {
          if (unit.hp <= 0 || (unit.kind === "hero" && hero?.unseen)) continue;
          const dx = unit.x - thrower.x;
          const dy = unit.y - thrower.y;
          if (dx * dx + dy * dy > reachSquared) continue;
          const gap = far(unit.x, unit.y, thrower.x, thrower.y);
          if (gap > reach) continue;
          if (!mark) {
            mark = unit;
            markGap = gap;
            continue;
          }
          // The taunting hero first; then whoever it throws at first; then the nearest; then the first put down.
          const taunt = Number(unit.kind === "hero" && (taunts || stood)) - Number(mark.kind === "hero" && (taunts || stood));
          if (taunt !== 0) {
            if (taunt > 0) {
              mark = unit;
              markGap = gap;
            }
            continue;
          }
          const first = Number(unit.kind === thrower.first) - Number(mark.kind === thrower.first);
          if (first > 0 || (first === 0 && (gap < markGap || (gap === markGap && unit.id < mark.id)))) {
            mark = unit;
            markGap = gap;
          }
        }
      }
      if (!mark) {
        thrower.cool = 0;
        continue;
      }
      const hit = thrower.hit * (thrower.burns && (this.setup.faction === 3 || this.setup.faction === 4) ? thrower.burns : 1);
      mark.hp = Math.max(0, mark.hp - (planned ? hit * this.harmTo(mark) * (stood && mark.kind === "hero" ? MOVE.stand.takes : 1) : hit));
      // Cold comes with a frostwight: a thing that throws with one near it is slower about the next.
      const chilled = this.faction.chills && this.units.some((unit) => unit.hp > 0 && far(unit.x, unit.y, thrower.x, thrower.y) <= CHILL_REACH + thrower.r);
      thrower.cool = thrower.every * (chilled ? 1 + (this.faction.chills ?? 0) : 1) * bell;
      this.shots.push({ x0: thrower.x, y0: thrower.y - thrower.r - 12, x1: mark.x, y1: mark.y - 6, t: 0, ours: false });
    }

    // The Stumbling get up again, once, part mended.
    if (this.faction.rises) {
      for (const unit of this.units) {
        if (unit.hp <= 0 && !unit.rose && !unit.blew) {
          unit.rose = true;
          unit.hp = Math.round(unit.max * this.faction.rises);
        }
      }
    }

    // The pebbles in the air, a step on; the ones that have landed are gone.
    let kept = 0;
    for (const shot of this.shots) {
      shot.t += dt * 5;
      if (shot.t < 1) this.shots[kept++] = shot;
    }
    this.shots.length = kept;

    if (planned) this.plannedAfter();
    this.scan();

    let standing = false;
    for (const unit of this.units) if (unit.hp > 0) standing = true;
    const campStands = this.campStands;
    const waiting = planned && this.bands.some((band) => band.queue.length > 0);
    if (this.time >= (this.setup.seconds ?? RAID_SECONDS) || !campStands || (!standing && this.left === 0 && !this.heroLeft && !waiting)) {
      this.over = true;
      // The feat is known only at the end (the losses, the gate): its star comes then.
      if (planned && this.result().earned?.[2]) this.events.push({ tick: this.ticks, kind: "star", star: 2 });
    }
    this.ticks += 1;
  }

  /** What changed since the last look: cracks, falls, perches manned again, and (in a planned raid) the first two stars. */
  private scan() {
    const tick = this.ticks;
    let campStands = false;
    for (let index = 0; index < this.structures.length; index++) {
      const entry = this.structures[index];
      if (entry.hp > 0 && entry.traps === undefined && !entry.flat && entry.kind !== "wall") campStands = true;
      if (entry.hp === this.seenHp[index]) continue;
      this.seenHp[index] = entry.hp;
      const now = healthBand(entry);
      const was = this.seen[index];
      if (now === was) continue;
      this.seen[index] = now;
      // (What lies on the ground, a trap, is not a thing that falls.)
      if (now < was) {
        if (was === 3 && entry.kind === "perch") this.events.push({ tick, kind: "manned", id: entry.id, x: entry.x, y: entry.y });
        continue;
      }
      if (entry.flat || entry.traps !== undefined) continue;
      if (now < 3) {
        this.events.push({ tick, kind: "hurt", id: entry.id, structure: entry.kind, x: entry.x, y: entry.y, cracks: now as 1 | 2 });
        continue;
      }
      if (entry.kind === "wall") this.events.push({ tick, kind: "breach", id: entry.id, x: entry.x, y: entry.y, ...(entry.gate ? { gate: entry.gate } : {}) });
      else if (entry.kind === "nest") this.events.push({ tick, kind: "nest", id: entry.id, x: entry.x, y: entry.y });
      else if (entry.kind === "perch") this.events.push({ tick, kind: "flee", id: entry.id, x: entry.x, y: entry.y });
      else if (entry.kind === "hoard") this.events.push({ tick, kind: "spill", id: entry.id, x: entry.x, y: entry.y, loot: 1 / (this.counted.length - 1 + NEST_COUNTS) });
      this.events.push({ tick, kind: "down", id: entry.id, structure: entry.kind, x: entry.x, y: entry.y });
    }
    this.campStands = campStands;
    if (!this.planned) return;
    let nestDown = false;
    let down = 0;
    let all = 0;
    for (const entry of this.counted) {
      const weight = entry.kind === "nest" ? NEST_COUNTS : 1;
      all += weight;
      if (entry.hp <= 0) {
        down += weight;
        if (entry.kind === "nest") nestDown = true;
      }
    }
    const most = all > 0 && down / all >= MOST_SHARE;
    if (nestDown && !this.starred[0]) this.events.push({ tick, kind: "star", star: 0 });
    if (most !== this.starred[1]) this.events.push({ tick, kind: "star", star: 1, ...(most ? {} : { lost: true }) });
    this.starred = [nestDown || this.starred[0], most];
  }

  /** A planned raid's orders that are due (`Setup.orders`, a raid played again). */
  private ordersDue() {
    while (this.nextOrder < this.scheduled.length && this.scheduled[this.nextOrder].tick <= this.ticks) {
      const order = this.scheduled[this.nextOrder++];
      if (this.obey(order)) this.given.push(order);
    }
  }

  /** A planned raid, before the fight's step: the held group if it is time, and whoever comes out now. */
  private plannedBefore() {
    this.bands.forEach((band, index) => {
      if (band.held && !band.out && this.time >= HELD_LATEST) {
        band.out = true;
        band.nextAt = this.time;
      }
      while (band.out && band.queue.length > 0 && this.time >= band.nextAt) {
        this.comeOut(band, index);
        band.nextAt += RAID_FIGURES.comeOut;
      }
    });
  }

  /** A planned raid's hazards: the thorns cut, and a pit stepped on gives way under whoever is on it. */
  private hazards(dt: number) {
    const cuts = THORNS.cuts * (1 + HARDER_A_CAMP * this.setup.n);
    const leaps = Boolean(this.setup.hero?.leaps);
    this.zones.forEach((zone, index) => {
      if (zone.kind === "thorns") {
        for (const unit of this.units) {
          if (unit.hp <= 0 || unit.kind === "mole" || (unit.kind === "hero" && leaps)) continue;
          if (unit.x < zone.x0 || unit.x > zone.x1 || unit.y < zone.y0 || unit.y > zone.y1) continue;
          unit.hp = Math.max(0, unit.hp - cuts * dt * this.harmTo(unit));
          unit.cut = true;
          if (unit.hp <= 0) unit.fell = "thorns";
        }
      } else if (zone.kind === "pit") {
        const state = this.pits[index];
        if (state < 0) return;
        // Who it can take: anyone on foot, not a mole (under it) and not the hero (who sees it). A sprout on it
        // scrambles out, hurt: sprouts are what is sent first to spring them.
        const takes = (unit: Unit) => unit.hp > 0 && unit.kind !== "mole" && unit.kind !== "hero";
        if (state === 0) {
          if (this.units.some((unit) => takes(unit) && far(unit.x, unit.y, zone.x, zone.y) <= PIT.trips)) this.pits[index] = this.time + PIT.after;
        } else if (this.time >= state) {
          let took = 0;
          for (const unit of this.units) {
            if (!takes(unit) || far(unit.x, unit.y, zone.x, zone.y) > PIT.takes) continue;
            if (unit.kind === "sprout") {
              unit.hp = Math.max(1, unit.hp - unit.max * PIT.sprout * this.harmTo(unit));
              continue;
            }
            if (took >= PIT.most) continue;
            unit.hp = 0;
            unit.fell = "pit";
            took += 1;
          }
          this.pits[index] = -1;
          this.events.push({ tick: this.ticks, kind: "pit", zone: index, x: zone.x, y: zone.y, took });
        }
      }
    });
  }

  /** A planned raid, after the fight's step: the watch-crow, and when the nest fell. */
  private plannedAfter() {
    const nest = this.structures[0];
    if (this.nestAt === null && nest && nest.kind === "nest" && nest.hp <= 0) this.nestAt = this.time;
    const crow = this.crow;
    if (!crow || this.crowCalledAt !== null || this.crowFellAt !== null) return;
    if (crow.hp <= 0) {
      this.crowFellAt = this.time;
      return;
    }
    let standing = 0;
    let all = 0;
    for (const entry of this.counted) {
      const weight = entry.kind === "nest" ? NEST_COUNTS : 1;
      all += weight;
      if (entry.hp > 0) standing += weight;
    }
    if (all <= 0 || standing / all > CROW.calls) return;
    // At half strength it calls: the perches that have fallen are manned again, and the rest are made good, at half.
    this.crowCalledAt = this.time;
    this.events.push({ tick: this.ticks, kind: "call", id: crow.id, x: crow.x, y: crow.y });
    for (const entry of this.structures) {
      if (entry.kind !== "perch") continue;
      if (entry.hp <= 0) entry.cool = entry.every;
      entry.hp = Math.max(entry.hp, Math.round(entry.max * CROW.flight));
    }
  }

  /** How the raid stands, or stood at its end. */
  result(): Result {
    // A pitfall is not there to be pulled down, so it is not in the count of what was.
    const buildings = this.structures.filter((entry) => entry.kind !== "wall" && entry.traps === undefined && !entry.flat);
    const nest = buildings.find((entry) => entry.kind === "nest");
    const rest = buildings.filter((entry) => entry.kind !== "nest");
    const down = rest.filter((entry) => entry.hp <= 0).length;
    const nestDown = nest ? nest.hp <= 0 : false;
    const destroyed = ((nestDown ? NEST_COUNTS : 0) + down) / (NEST_COUNTS + rest.length);
    const hoards = buildings.filter((entry) => entry.kind === "hoard");
    const hero = this.units.find((unit) => unit.kind === "hero");
    const plain = {
      destroyed,
      hoards: hoards.length === 0 ? 0 : hoards.filter((entry) => entry.hp <= 0).length / hoards.length,
      ...(hero && hero.hp <= 0 ? { heroFell: true } : {})
    };
    if (!this.planned) {
      const stars = ((destroyed >= 0.5 ? 1 : 0) + (nestDown ? 1 : 0) + (destroyed >= 0.999 ? 1 : 0)) as Result["stars"];
      return { stars, ...plain };
    }
    const fallen = this.units.filter((unit) => unit.hp <= 0 && !unit.blew && unit.kind !== "hero");
    const gate = this.walls.find((entry) => entry.gate === "main");
    const counted = starsOf(this.feat ?? "whole", {
      nestDown,
      nestAt: this.nestAt,
      destroyed,
      crowCalled: this.crowCalledAt !== null,
      crowDown: this.crow ? this.crow.hp <= 0 : false,
      crowFirst: this.crowFellAt !== null && this.crowCalledAt === null,
      // Whoever went through the thorns and fell, there or after: the hedge's toll. And any but a sprout the pits took.
      lostToThorns: fallen.filter((unit) => unit.cut).length,
      lostToPits: fallen.filter((unit) => unit.fell === "pit").length,
      perchesStanding: buildings.filter((entry) => entry.kind === "perch" && entry.hp > 0).length,
      gateStanding: gate ? gate.hp > 0 : true
    });
    return { stars: counted.stars, ...plain, earned: counted.earned, feat: counted.feat, missed: counted.missed, lost: fallen.length, events: [...this.events] };
  }
}

// ---- a raid with nobody at the controls ---------------------------------------------------

/** The sides scouts can be sent in from, for a raid played by rule. */
export const SIDES = ["left", "top", "right", "bottom"] as const;
export type Side = (typeof SIDES)[number];

const gateOf = (side: Side, spread: number, top: number, middle: { x: number; y: number }) =>
  side === "left"
    ? { x: 8, y: middle.y + spread }
    : side === "right"
      ? { x: FIELD_W - 8, y: middle.y + spread }
      : side === "top"
        ? { x: middle.x + spread, y: top + 1 }
        : { x: middle.x + spread, y: EDGE.bottom - 1 };

/**
 * Puts a raid's scouts down by rule, a step at a time: every one sent in
 * from one side, the sturdy ones first, the throwers behind them, a mole or
 * two, and the hero once the sentries have someone else to throw at. Not
 * clever, and meant not to be: it is what a raid "sent without you" does, how
 * the magpies come at night, and what a reader who thinks about where the
 * sentries are should beat. Call what it hands back before each step. (A
 * planned raid needs nobody to put anyone down: its squad comes down its
 * approaches by itself, and its orders are in its setup.)
 */
export const autoPilot = (battle: Battle, side: Side = "left"): (() => void) => {
  const { setup } = battle;
  if (battle.planned) return () => undefined;
  const order: UnitKind[] = [];
  const throwers = setup.kinds.includes("slinger") ? Math.floor(setup.capacity * 0.3) : 0;
  const moles = setup.kinds.includes("mole") ? Math.max(1, Math.floor(setup.capacity * 0.15)) : 0;
  for (let index = 0; index < setup.capacity - throwers - moles; index++) order.push("sprout");
  for (let index = 0; index < throwers; index++) order.push("slinger");
  for (let index = 0; index < moles; index++) order.push("mole");
  if (setup.hero) order.splice(Math.min(3, order.length), 0, "hero");
  // Puffcaps lead, where there are any: the wall is the first thing in the way.
  const bombers = setup.kinds.includes("bomber") ? Math.min(Math.max(0, Math.floor(setup.bombers ?? 0)), order.length) : 0;
  for (let index = 0; index < bombers; index++) order[order.lastIndexOf("sprout") >= 0 ? order.lastIndexOf("sprout") : order.length - 1] = "bomber";
  order.sort((a, b) => Number(b === "bomber") - Number(a === "bomber"));
  const middle = setup.raiders ? { x: FIELD_W / 2, y: (RAIDERS_TOP + EDGE.bottom) / 2 } : CENTRE;
  const top = setup.raiders ? RAIDERS_TOP : EDGE.top;
  let sent = 0;
  let next = 0;
  return () => {
    if (battle.over || sent >= order.length || battle.time < next) return;
    // Down the trail (1.5.11): every one in at the left edge, at the lane's height: the middle, or wide at the top or foot.
    const gate =
      setup.drop !== undefined && !setup.raiders
        ? { x: 8, y: (side === "top" ? 26 : side === "bottom" ? 104 : middle.y) + ((sent % 5) - 2) * 4 }
        : gateOf(side, ((sent % 5) - 2) * 7, top, middle);
    // A gate that is in among the camp is moved out along its side until it is not.
    for (let out = 0; out < 12 && !battle.deploy(order[sent], gate.x, gate.y); out++) {
      if (side === "left" || side === "right") gate.y += out % 2 ? 10 * (out + 1) : -10 * (out + 1);
      else gate.x += out % 2 ? 12 * (out + 1) : -12 * (out + 1);
    }
    sent += 1;
    next = battle.time + 0.35;
  };
};

/** Plays a raid out by rule, and hands the battle back as it ended. A planned raid is played out from its squad and its orders. */
export const runAuto = (setup: Setup, side: Side = "left", structures?: Structure[]): Battle => {
  const battle = new Battle(setup, structures);
  const drive = autoPilot(battle, side);
  while (!battle.over) {
    drive();
    battle.step(BATTLE_TICK);
  }
  return battle;
};

export const autoPlay = (setup: Setup, side: Side = "left", structures?: Structure[]): Result => runAuto(setup, side, structures).result();

/** The best a raid played by rule does from any side: what a reader who picks the side well can count on. */
export const autoBest = (setup: Setup): Result => autoBestLane(setup).result;
/** The lanes a raid can be sent down: for a camp come at down its trail, the middle of the strip, or wide at its top or its foot. */
export const LANES: readonly Side[] = ["left", "top", "bottom"];
/** The best a raid played by rule does, and down which lane (or from which side). */
export const autoBestLane = (setup: Setup): { result: Result; side: Side } =>
  (setup.drop !== undefined && !setup.raiders ? LANES : SIDES)
    .map((side) => ({ result: autoPlay(setup, side), side }))
    .reduce((best, entry) => (entry.result.destroyed > best.result.destroyed ? entry : best));
