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
 * you" is, what a night is, and how the numbers were set.
 */

export const FIELD_W = 240;
export const FIELD_H = 120;
/** Seconds a raid may take. */
export const RAID_SECONDS = 60;
/** Simulation ticks per second. */
export const BATTLE_TICK = 1 / 30;

export type UnitKind = "sprout" | "slinger" | "mole" | "bomber" | "hero";
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

export type Setup = {
  /** The camp's place on the ladder, from 0. */
  n: number;
  /** The Magpie King's roost: a camp with more of everything. */
  king: boolean;
  /** Scouts there are to put down. */
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
};

/** The camp's champion: one villain, who comes out to whoever gets near. */
export type Foe = { variant: number; x: number; y: number; hp: number; max: number; left: boolean; busy: boolean; home: { x: number; y: number } };

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
};

// ---- the figures --------------------------------------------------------------

const CENTRE = { x: 156, y: 64 };

type UnitFigures = { hp: number; dps: number; speed: number; reach: number };
const UNITS: Record<Exclude<UnitKind, "hero">, UnitFigures> = {
  /** Sturdy, and has to be at a thing to pull at it. */
  sprout: { hp: 34, dps: 9, speed: 20, reach: 3 },
  /** Frail, and throws from where a sentry may not reach. */
  slinger: { hp: 18, dps: 7, speed: 18, reach: 30 },
  /** Goes for the loot, under the wall. */
  mole: { hp: 44, dps: 8, speed: 16, reach: 3 },
  /** A Puffcap: runs to the nearest wall and goes off against it (`BLAST`). */
  bomber: { hp: 26, dps: 0, speed: 17, reach: 3 }
};
/** The magpies who come by night: frailer than a scout, and there to snatch, not to pull a camp down. One on foot, one on the wing. */
const RAIDERS: Record<Exclude<UnitKind, "hero">, UnitFigures> = {
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
/** The edge of the field scouts are kept inside; raiders at night come out of the trees, not the sky. */
const EDGE = { left: 4, right: FIELD_W - 4, top: 14, bottom: FIELD_H - 4 };
const RAIDERS_TOP = 48;

/** The nest counts as so many buildings, in the count of what came down. */
const NEST_COUNTS = 2;

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

/**
 * The camp of a number, laid out: the same every time. The hoards and the
 * sentries sit about the nest wherever this camp's own roll puts them, so no
 * two camps are attacked the same way. Since 1.5.11 a stronghold is come at
 * down its trail, from the left: its wall stands straight across that side
 * (x `WALL_X`), its middle section the gate (half as tough again), and it
 * does not reach the top and foot of the field, so there is a way round it
 * for scouts put down wide; or a Puffcap opens it.
 */
export const layout = (n: number, king: boolean, seed = 0): Structure[] => {
  const roll = seeded(0xb10c + n * 7919 + (king ? 31 : 0) + Math.imul(seed, 2654435761));
  const sturdy = (1 + STURDIER_A_CAMP * n) * (king ? KING_STURDIER : 1);
  const has = campHas(n, king);
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
/** Where a stronghold's wall stands across the field. */
export const WALL_X = 106;

// ---- the battle ---------------------------------------------------------------------

const far = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** Whether the straight way from a point to another passes through a circle. */
const crosses = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / length));
  return far(ax + dx * along, ay + dy * along, cx, cy) < r;
};

export class Battle {
  readonly setup: Setup;
  readonly structures: Structure[];
  readonly units: Unit[] = [];
  /** The camp's champion, while it has one standing. */
  foe: Foe | null = null;
  shots: Shot[] = [];
  /** Seconds gone. */
  time = 0;
  /** Scouts still to put down, and whether the hero still is. */
  left: number;
  heroLeft: boolean;
  over = false;
  private made = 0;
  /** Puffcaps still to put down. */
  bombersLeft: number;

  /** `structures`: the camp to fight over, when it is not a magpie camp laid out by its number (the reader's own, at night). */
  constructor(setup: Setup, structures?: Structure[]) {
    this.setup = setup;
    this.structures = structures ? structures.map((entry, id) => ({ ...entry, id })) : layout(setup.n, setup.king, setup.seed ?? 0);
    this.left = Math.max(0, Math.floor(setup.capacity));
    this.heroLeft = Boolean(setup.hero);
    this.bombersLeft = setup.kinds.includes("bomber") ? Math.max(0, Math.floor(setup.bombers ?? 0)) : 0;
    if (setup.champion !== null && setup.champion !== undefined && !setup.raiders) {
      const nest = this.structures[0];
      const max = Math.round(CHAMPION.hp * (1 + STURDIER_A_CAMP * setup.n) * (setup.king ? KING_STURDIER : 1));
      // He stands before the nest, on the side the walls are.
      const home = { x: nest.x - nest.r - 8, y: nest.y + 4 };
      this.foe = { variant: setup.champion, ...home, hp: max, max, left: true, busy: false, home };
    }
  }

  private get top() {
    return this.setup.raiders ? RAIDERS_TOP : EDGE.top;
  }

  /** Whether a scout may be put down at a point: on the field, and not in among the camp. */
  canDeploy(x: number, y: number, hero = false): boolean {
    if (this.over || (hero ? !this.heroLeft : this.left <= 0)) return false;
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
    if (!this.setup.raiders) return UNITS[kind];
    const plain = RAIDERS[kind];
    const made = this.faction;
    return { hp: plain.hp * made.hp, dps: plain.dps * made.dps, speed: plain.speed * made.speed, reach: plain.reach };
  }

  /** Puts a scout down. False when it cannot be put there (or there are none left, or the hut has not trained that kind). */
  deploy(kind: UnitKind, x: number, y: number): boolean {
    const hero = kind === "hero";
    if (hero ? !this.setup.hero : !this.setup.kinds.includes(kind)) return false;
    if (kind === "bomber" && this.bombersLeft <= 0) return false;
    if (!this.canDeploy(x, y, hero)) return false;
    const strong = 1 + STRONGER_A_LEVEL * (Math.min(5, Math.max(1, this.setup.level)) - 1);
    const max = Math.round(this.figures(kind).hp * strong);
    // A hair apart, so scouts put down on one spot do not walk as one.
    const nudge = ((this.made * 7) % 5) - 2;
    this.units.push({ id: this.made++, kind, x, y: Math.min(EDGE.bottom, Math.max(this.top, y + nudge * 0.6)), hp: max, max, target: null, left: false, busy: false });
    if (hero) this.heroLeft = false;
    else this.left -= 1;
    if (kind === "bomber") this.bombersLeft -= 1;
    return true;
  }

  private alive(kind?: StructureKind) {
    // A pitfall is not a thing to make for: it is found by stepping on it.
    return this.structures.filter((entry) => entry.hp > 0 && entry.traps === undefined && !entry.flat && (kind ? entry.kind === kind : entry.kind !== "wall"));
  }

  /** What a scout makes for: a mole the nearest hoard, a hero what they prefer, anyone the nearest thing standing. A magpie by night makes for the larder. */
  private pick(unit: Unit): Structure | null {
    const nearest = (among: Structure[]) =>
      among.reduce<Structure | null>((best, entry) => (!best || far(unit.x, unit.y, entry.x, entry.y) - entry.r < far(unit.x, unit.y, best.x, best.y) - best.r ? entry : best), null);
    // A Puffcap: the nearest wall standing (the gate as soon as any other), and with none, the nearest building.
    if (unit.kind === "bomber") return nearest(this.structures.filter((entry) => entry.kind === "wall" && entry.hp > 0)) ?? nearest(this.alive());
    // By night every magpie is after the larder: the ones on foot go straight for it too, and have to get through whatever is in the way.
    // A thumper's drumming draws the ones on foot: they go to it while it stands, and the larder waits.
    if (this.setup.raiders && unit.kind !== "mole" && !this.faction.proud) {
      const lure = nearest(this.structures.filter((entry) => entry.lures && entry.hp > 0));
      if (lure) return lure;
    }
    // Under a brazier's smoke the larder is not to be seen: they go for what is nearest, as a scout does.
    const hidden = this.setup.raiders && this.structures.some((entry) => entry.hides && entry.hp > 0);
    const first = hidden ? undefined : unit.kind === "mole" || this.setup.raiders ? "hoard" : unit.kind === "hero" ? this.setup.hero?.prefers : undefined;
    return (first ? nearest(this.alive(first)) : null) ?? nearest(this.alive());
  }

  step(dt: number): void {
    if (this.over) return;
    this.time += dt;
    const strong = 1 + STRONGER_A_LEVEL * (Math.min(5, Math.max(1, this.setup.level)) - 1);
    const walls = this.structures.filter((entry) => entry.kind === "wall");
    const wards = this.setup.raiders ? this.structures.filter((entry) => entry.grounds && entry.hp > 0) : [];
    // The camp's constructs act on whoever comes to it: the night's raiders, and a friend's scouts.
    const acting = Boolean(this.setup.raiders || this.setup.works);
    const patches = acting ? this.structures.filter((entry) => entry.slows && entry.hp > 0) : [];
    const totems = acting ? this.structures.filter((entry) => entry.daunts && entry.hp > 0) : [];
    const hero = this.setup.hero ?? null;
    const foe = this.foe && this.foe.hp > 0 ? this.foe : null;

    // The champion: out to the nearest scout that has come near, a hero before anyone; home again when none has.
    let foeAt: Unit | null = null;
    if (foe) {
      const near = this.units
        .filter((unit) => unit.hp > 0 && far(unit.x, unit.y, foe.x, foe.y) <= CHAMPION.wakes)
        .sort((a, b) => Number(b.kind === "hero") - Number(a.kind === "hero") || far(a.x, a.y, foe.x, foe.y) - far(b.x, b.y, foe.x, foe.y) || a.id - b.id);
      foeAt = near[0] ?? null;
      const to = foeAt ?? foe.home;
      const gap = far(foe.x, foe.y, to.x, to.y);
      foe.busy = false;
      if (gap > (foeAt ? CHAMPION.reach : 1)) {
        const stride = Math.min(gap, CHAMPION.speed * dt);
        foe.x += ((to.x - foe.x) / gap) * stride;
        foe.y += ((to.y - foe.y) / gap) * stride;
        foe.left = to.x < foe.x;
      } else if (foeAt) {
        foeAt.hp = Math.max(0, foeAt.hp - CHAMPION.dps * (1 + HARDER_A_CAMP * this.setup.n) * dt);
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

      let goal = unit.target === null ? null : (this.structures[unit.target] ?? null);
      if (!goal || goal.hp <= 0 || (goal.kind === "wall" && unit.kind !== "bomber")) {
        goal = this.pick(unit);
      }
      if (!goal) {
        unit.busy = false;
        continue;
      }
      // A wall across the way is the thing to pull down first; a mole goes under, and some heroes over.
      // By night a mole is a magpie on the wing, and inside a ward's ring it is on foot like the rest.
      const flies = unit.kind === "mole" && !wards.some((ward) => far(unit.x, unit.y, ward.x, ward.y) <= (ward.grounds ?? 0));
      let at = goal;
      if (!flies && !traits?.leaps) {
        const reachOfGoal = far(unit.x, unit.y, goal.x, goal.y) - goal.r;
        if (reachOfGoal > figures.reach) {
          // By night a building in the way is in the way as a fence is: the larder is reached through whatever stands before it.
          const blocks = this.setup.raiders ? this.structures.filter((entry) => entry !== goal) : walls;
          const inWay = blocks
            // A patch of tanglefoot and a pitfall are walked into, not stopped at.
            .filter((wall) => wall.hp > 0 && !wall.flat && wall.traps === undefined && crosses(unit.x, unit.y, goal!.x, goal!.y, wall.x, wall.y, wall.r + 1))
            .sort((a, b) => far(unit.x, unit.y, a.x, a.y) - far(unit.x, unit.y, b.x, b.y))[0];
          if (inWay) at = inWay;
        }
      }
      unit.target = at.id;
      const gap = far(unit.x, unit.y, at.x, at.y) - at.r;
      // A thrower stops where it can reach; at a wall everyone has to be at it.
      const reach = at.kind === "wall" ? Math.min(figures.reach, 8) : figures.reach;
      unit.left = at.x < unit.x;
      if (gap > reach + 1e-6) {
        // On the wing by night, nothing on the ground has hold of them.
        const onWing = Boolean(this.setup.raiders) && flies;
        const tangled = onWing ? 0 : Math.max(0, ...patches.filter((patch) => far(unit.x, unit.y, patch.x, patch.y) <= (patch.zone ?? 0)).map((patch) => patch.slows ?? 0));
        const speed = figures.speed * (this.setup.fast ? FASTER : 1) * (unit.kind === "mole" ? 1 : 1 - Math.min(0.6, Math.max(0, this.setup.slowed ?? 0))) * (1 - Math.min(0.8, tangled));
        const stride = Math.min(gap - reach, speed * dt);
        const length = far(unit.x, unit.y, at.x, at.y) || 1;
        unit.x += ((at.x - unit.x) / length) * stride;
        unit.y += ((at.y - unit.y) / length) * stride;
        unit.busy = false;
      } else if (unit.kind === "bomber") {
        // At it: off he goes. A section of wall is down, and those beside it the worse; a building takes the blast.
        if (at.kind === "wall") {
          at.hp = 0;
          for (const other of this.structures) if (other !== at && other.kind === "wall" && other.hp > 0 && far(other.x, other.y, at.x, at.y) <= BLAST_BESIDE) other.hp = Math.max(0, other.hp - other.max * 0.5);
        } else at.hp = Math.max(0, at.hp - BLAST);
        unit.hp = 0;
        unit.busy = false;
        unit.blew = true;
      } else {
        const times = (kind: StructureKind) =>
          unit.kind === "mole" && kind === "hoard" ? MOLE_AT_HOARD : this.setup.raiders && kind === "wall" ? this.faction.walls : (traits?.times?.[kind] ?? 1);
        // Near a dread totem they have no heart for it.
        const heart = Math.min(1, ...totems.filter((totem) => far(unit.x, unit.y, totem.x, totem.y) <= (totem.zone ?? 0)).map((totem) => totem.daunts ?? 1));
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
      const onWing = (unit: Unit) => Boolean(this.setup.raiders) && unit.kind === "mole" && !wards.some((ward) => far(unit.x, unit.y, ward.x, ward.y) <= (ward.grounds ?? 0));
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
    // The watch bell: while anyone is near it, it is ringing, and the camp is quicker for it.
    const bell = acting
      ? Math.min(
          1,
          ...this.structures
            .filter((entry) => entry.rouses && entry.hp > 0 && this.units.some((unit) => unit.hp > 0 && far(unit.x, unit.y, entry.x, entry.y) <= (entry.zone ?? 0)))
            .map((entry) => entry.rouses ?? 1)
        )
      : 1;

    // A hero who mends: one scout at a time, whoever near them is worst hurt.
    if (hero?.heals) {
      const healer = this.units.find((unit) => unit.kind === "hero" && unit.hp > 0);
      if (healer) {
        const hurt = this.units
          .filter((unit) => unit !== healer && unit.hp > 0 && unit.hp < unit.max && far(unit.x, unit.y, healer.x, healer.y) <= HEAL_REACH)
          .sort((a, b) => a.hp / a.max - b.hp / b.max || a.id - b.id)[0];
        if (hurt) hurt.hp = Math.min(hurt.max, hurt.hp + hero.heals * dt);
      }
    }

    for (const thrower of this.structures) {
      if (thrower.hp <= 0 || thrower.range === 0) continue;
      thrower.cool -= dt;
      if (thrower.cool > 0) continue;
      const mark = this.units
        .filter((unit) => unit.hp > 0 && !(unit.kind === "hero" && hero?.unseen) && far(unit.x, unit.y, thrower.x, thrower.y) <= thrower.range + thrower.r)
        .sort(
          (a, b) =>
            Number(b.kind === "hero" && Boolean(hero?.taunts)) - Number(a.kind === "hero" && Boolean(hero?.taunts)) ||
            Number(b.kind === thrower.first) - Number(a.kind === thrower.first) ||
            far(a.x, a.y, thrower.x, thrower.y) - far(b.x, b.y, thrower.x, thrower.y) ||
            a.id - b.id
        )[0];
      if (!mark) {
        thrower.cool = 0;
        continue;
      }
      mark.hp = Math.max(0, mark.hp - thrower.hit * (thrower.burns && (this.setup.faction === 3 || this.setup.faction === 4) ? thrower.burns : 1));
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

    this.shots = this.shots.map((shot) => ({ ...shot, t: shot.t + dt * 5 })).filter((shot) => shot.t < 1);

    const standing = this.units.some((unit) => unit.hp > 0);
    if (this.time >= (this.setup.seconds ?? RAID_SECONDS) || this.alive().length === 0 || (!standing && this.left === 0 && !this.heroLeft)) {
      this.over = true;
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
    const stars = ((destroyed >= 0.5 ? 1 : 0) + (nestDown ? 1 : 0) + (destroyed >= 0.999 ? 1 : 0)) as Result["stars"];
    const hero = this.units.find((unit) => unit.kind === "hero");
    return {
      stars,
      destroyed,
      hoards: hoards.length === 0 ? 0 : hoards.filter((entry) => entry.hp <= 0).length / hoards.length,
      ...(hero && hero.hp <= 0 ? { heroFell: true } : {})
    };
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
 * sentries are should beat. Call what it hands back before each step.
 */
export const autoPilot = (battle: Battle, side: Side = "left"): (() => void) => {
  const { setup } = battle;
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

/** Plays a raid out by rule, and hands the battle back as it ended. */
export const runAuto = (setup: Setup, side: Side = "left", structures?: Structure[]): Battle => {
  const battle = new Battle(setup, structures);
  const drive = autoPilot(battle, side);
  while (!battle.over) {
    drive();
    battle.step(BATTLE_TICK);
  }
  return battle;
};

export const autoPlay = (setup: Setup, side: Side = "left"): Result => runAuto(setup, side).result();

/** The best a raid played by rule does from any side: what a reader who picks the side well can count on. */
export const autoBest = (setup: Setup): Result => autoBestLane(setup).result;
/** The lanes a raid can be sent down: for a camp come at down its trail, the middle of the strip, or wide at its top or its foot. */
export const LANES: readonly Side[] = ["left", "top", "bottom"];
/** The best a raid played by rule does, and down which lane (or from which side). */
export const autoBestLane = (setup: Setup): { result: Result; side: Side } =>
  (setup.drop !== undefined && !setup.raiders ? LANES : SIDES)
    .map((side) => ({ result: autoPlay(setup, side), side }))
    .reduce((best, entry) => (entry.result.destroyed > best.result.destroyed ? entry : best));
