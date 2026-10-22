/**
 * The Front (1.5.11): one way in.
 *
 * The Dark Wood stands along the left of the clearing, and the prowlers have
 * trodden a single trail through it. Everything that comes at the camp comes
 * down that trail: so the fence is a wall across it (with a gate where the
 * trail meets it), traps lie on the trail in front of the wall, and towers
 * stand behind it. Each kind of prowler is good at one thing and is beaten
 * by one thing (`ROLES`), and the night says beforehand who is coming.
 *
 * This file is the geometry and the rules of the front as plain functions of
 * plain numbers: where the trail runs, where the wall stands and how long it
 * is, where the traps and towers go, which constructs there are now and what
 * the old ones became, who comes on a night. It imports nothing from
 * `rules.ts` at run time (only its types), so `rules.ts` can use it, as
 * `chapters.ts` is used. The night itself is fought out in
 * `components/pip/arcade/base/wave.ts`.
 *
 * Everything is in the picture's own pixels: the clearing is 240 wide and
 * 120 tall, the grass from about 54 down.
 */

// ---- the map ----------------------------------------------------------------------------

/** Where the trail meets the wall, up the picture: the gate's section. */
export const TRAIL_Y = 84;
/** Where the trail comes out of the trees, up the picture. */
export const MOUTH_Y = 90;
/** The Dark Wood never clears: at least this much of it stands along the left of the clearing. */
export const DARK_WOOD = 14;
/** Where the wall may stand, across the picture: the default, and how far Edit may slide it either way. */
export const LINE_DEFAULT = 64;
export const LINE_LEAST = 44;
export const LINE_MOST = 104;
/** The least ground between the trees and the wall: the front has to have some trail on it. */
const FRONT_LEAST = 20;

/** The wood still standing on the left: the clearing's, but never less than the Dark Wood. */
export const darkWood = (wood: number) => Math.max(DARK_WOOD, wood);
/** Where the wall's line may go, for a camp with so much wood on its left. */
export const lineRange = (leftWood: number): [number, number] => [Math.max(LINE_LEAST, Math.ceil(leftWood + FRONT_LEAST)), LINE_MOST];
export const clampLine = (x: number, leftWood: number) => {
  const [least, most] = lineRange(leftWood);
  return Math.round(Math.min(most, Math.max(least, x)));
};

/**
 * The wall runs across the trail on the slant: up the picture it leans this far to the left (towards the wood) for
 * every pixel, so that it reads as a wall across the way and not, seen end on, as a post.
 * The gate is where the trail meets it, at `line`.
 */
export const WALL_LEAN = -0.3;
/** Where the wall is across the picture at a height up it. */
export const wallXAt = (line: number, y: number) => line + Math.round((TRAIL_Y - y) * WALL_LEAN);
/** The wall's sections by the fence's level: each 10 apart up the picture, about the trail; the fourth level spans the whole approach. */
const SECTIONS: readonly (readonly number[])[] = [[], [74, 84, 94], [64, 74, 84, 94, 104], [64, 74, 84, 94, 104, 114], [54, 64, 74, 84, 94, 104, 114], [54, 64, 74, 84, 94, 104, 114]];
export const sectionsAt = (level: number): number[] => [...(SECTIONS[Math.max(0, Math.min(SECTIONS.length - 1, Math.round(level)))] ?? [])];
/**
 * The fence level from which nobody goes round the wall: a first fence is a few stakes across the trail, walked
 * round where that is not much further; from the second it is a palisade with a gate, hemmed in by the Dark Wood's
 * brambles, and has to be broken (or flown over, or dug under). Each level after is longer and tougher, and from the
 * fourth it spans the whole approach in stone.
 */
export const SEALED_FROM = 1;
/** How tough a section is, by the fence's level: so many seconds of one prowler battering at it. The gate is half as tough again. */
export const SECTION_TOUGH = [0, 4, 12, 22, 32, 42];
export const GATE_TOUGHER = 1.5;
/** The goat leans on the wall: a quarter tougher. */
export const GOAT_TOUGHER = 1.25;

/** The trail: from out of sight in the Dark Wood, to the front of the wall. One bend, so it reads as a path. */
export const trailOf = (leftWood: number, line: number): Array<[number, number]> => {
  const edge = Math.min(leftWood, line - 12);
  const mid = (edge + line) / 2;
  return [
    [-14, MOUTH_Y],
    [Math.max(0, edge), MOUTH_Y],
    [Math.round(mid), TRAIL_Y - 3],
    [line - 8, TRAIL_Y],
    [line, TRAIL_Y]
  ];
};
/** How far up the picture the trail is at a point across it (in front of the wall). */
export const trailYAt = (trail: ReadonlyArray<readonly [number, number]>, x: number): number => {
  for (let at = 1; at < trail.length; at++) {
    const [ax, ay] = trail[at - 1];
    const [bx, by] = trail[at];
    if (x <= bx || at === trail.length - 1) {
      const share = bx === ax ? 1 : Math.max(0, Math.min(1, (x - ax) / (bx - ax)));
      return ay + (by - ay) * share;
    }
  }
  return TRAIL_Y;
};

/** The three trap spots: on the trail in front of the wall, the nearest the wall first. */
export const trapSpots = (leftWood: number, line: number): Array<[number, number]> => {
  const trail = trailOf(leftWood, line);
  const near = line - 12;
  const far = Math.max(leftWood + 8, line - 40);
  const xs = [near, near - (near - far) / 2, far].map((x) => Math.round(x));
  return xs.map((x) => [x, Math.round(trailYAt(trail, x))]);
};

/** Where tower pads may go behind the wall, in the order they are tried: above and below the gate first. */
const PAD_TRIES: ReadonlyArray<readonly [number, number]> = [
  [16, 72],
  [16, 98],
  [30, 70],
  [30, 100],
  [24, 62],
  [24, 108],
  [44, 68],
  [44, 102],
  [56, 74],
  [56, 96]
];
/** The tower pads: just behind the wall, wherever there is room for one (`free` says whether a point is clear of the buildings). */
export const towerPads = (line: number, free: (x: number, y: number) => boolean, most = 3): Array<[number, number]> => {
  const pads: Array<[number, number]> = [];
  for (const [dx, y] of PAD_TRIES) {
    if (pads.length >= most) break;
    const spot: [number, number] = [wallXAt(line, y) + dx, y];
    if (free(spot[0], spot[1]) && pads.every((other) => Math.hypot(other[0] - spot[0], other[1] - spot[1]) >= 14)) pads.push(spot);
  }
  // A camp with no room behind its wall at all still has its pads: they stand where they would, among things.
  for (const [dx, y] of PAD_TRIES) {
    if (pads.length >= most) break;
    if (!pads.some((other) => other[0] === wallXAt(line, y) + dx && other[1] === y)) pads.push([wallXAt(line, y) + dx, y]);
  }
  return pads;
};
/** Where the watch bell hangs: on the gatehouse. */
export const bellSpot = (line: number): [number, number] => [line + 7, TRAIL_Y - 6];

// ---- the constructs -------------------------------------------------------------------------

/** The four traps (they lie on the trail), the two towers (they stand on pads), and the bell (on the gate). By their number in `WORKS`. */
export const TRAPS: readonly number[] = [8, 4, 6, 2];
export const TOWERS: readonly number[] = [10, 9];
export const BELL = 7;
export const FRONT_WORKS: readonly number[] = [8, 4, 10, 6, 2, 9, 7];
/** How many of a kind a camp may have: two of a tower, one of anything else. */
export const mostOf = (kind: number) => (TOWERS.includes(kind) ? 2 : 1);
export const isTrap = (kind: number) => TRAPS.includes(kind);
export const isTower = (kind: number) => TOWERS.includes(kind);
/** The chapter each comes with. */
export const WORK_CHAPTER: Readonly<Record<number, number>> = { 8: 4, 4: 5, 10: 5, 6: 6, 2: 7, 9: 8, 7: 9 };
/**
 * What the constructs of before became: the hedge and the caltrops are the thorn strip; the ward stone and the
 * hornet jar, the archer's nest; the smoke brazier and the dread totem are no more (and paid back).
 */
export const BECAME: Readonly<Record<number, number | null>> = { 0: 10, 1: 8, 3: null, 5: 10, 11: null };
export const becomes = (kind: number): number | null => (kind in BECAME ? BECAME[kind] : FRONT_WORKS.includes(kind) ? kind : null);

/** Trap spots and tower pads, by the chapter: one trap with the fence, a tower with the archer's nest, and more later. */
export const spotsOpen = (chapter: number) => (chapter >= 8 ? 3 : chapter >= 6 ? 2 : chapter >= 4 ? 1 : 0);
export const padsOpen = (chapter: number) => (chapter >= 10 ? 3 : chapter >= 8 ? 2 : chapter >= 5 ? 1 : 0);

/** The front as a camp keeps it: where the wall stands, what is on each spot and pad (-1 for nothing), what is in the shed, the bell, and the nights. */
export type Front = {
  x: number;
  /** The reader slid the wall: it stays where they put it. Until then it follows the camp (`lineFor`). */
  set: boolean;
  spots: number[];
  pads: number[];
  shed: number[];
  bell: boolean;
  /** Minutes read at the last night that counted: the next counts once there has been reading since. */
  watchedAt: number;
  /** Nights held, all told. */
  held: number;
  /** The kinds of prowler that have got through once (Pip says a word about each, once). */
  through: string[];
  /** Brought onto the front from before it: Pip says what she did, once. */
  moved: boolean;
  /** Brought onto the front, and its constructs still to be seated on the spots and pads (the next `settle`, when the camp's chapter is known). */
  seat?: boolean;
};
export const freshFront = (minutesRead = 0): Front => ({ x: LINE_DEFAULT, set: false, spots: [-1, -1, -1], pads: [-1, -1, -1], shed: [], bell: false, watchedAt: Math.max(0, Math.floor(minutesRead)), held: 0, through: [], moved: false });

/** Every construct the camp owns, wherever it is. */
export const ownedOf = (front: Pick<Front, "spots" | "pads" | "shed" | "bell">): number[] => [
  ...front.spots.filter((kind) => kind >= 0),
  ...front.pads.filter((kind) => kind >= 0),
  ...front.shed,
  ...(front.bell ? [BELL] : [])
];
export const ownCount = (front: Pick<Front, "spots" | "pads" | "shed" | "bell">, kind: number) => ownedOf(front).filter((owned) => owned === kind).length;

/**
 * The constructs of a camp from before the front, sorted out: what each became, what is paid back (a kind that is no
 * more, or one more of a kind than a camp may have), and where each goes (the spots and pads, the nearest the trail
 * first, as many as are open; the rest to the shed).
 */
export const seatOld = (
  works: ReadonlyArray<{ kind: number; x: number; y: number }>,
  costs: (kind: number) => number,
  open: { spots: number; pads: number },
  near: (x: number, y: number) => number
): { spots: number[]; pads: number[]; shed: number[]; bell: boolean; refund: number; refunded: number[] } => {
  const kept: Array<{ kind: number; d: number }> = [];
  let refund = 0;
  const refunded: number[] = [];
  for (const work of works) {
    const kind = becomes(work.kind);
    if (kind === null || kept.filter((other) => other.kind === kind).length >= mostOf(kind)) {
      refund += costs(work.kind);
      refunded.push(work.kind);
      continue;
    }
    kept.push({ kind, d: near(work.x, work.y) });
  }
  kept.sort((a, b) => a.d - b.d);
  const spots = [-1, -1, -1];
  const pads = [-1, -1, -1];
  const shed: number[] = [];
  let bell = false;
  for (const { kind } of kept) {
    if (kind === BELL) bell = true;
    else if (isTrap(kind) && spots.slice(0, open.spots).includes(-1)) spots[spots.indexOf(-1)] = kind;
    else if (isTower(kind) && pads.slice(0, open.pads).includes(-1)) pads[pads.indexOf(-1)] = kind;
    else shed.push(kind);
  }
  return { spots, pads, shed, bell, refund, refunded };
};

// ---- who comes ---------------------------------------------------------------------------------

/**
 * The six kinds of prowler, by what they do. The eight looks the camp has always had are kept: the rabble, the
 * Stumbling and the Frostwights are all creepers (the book being read, and the winter, choose which comes).
 */
export type Role = "creeper" | "runner" | "flier" | "brute" | "digger" | "bomber";
export const ROLES: readonly Role[] = ["creeper", "runner", "flier", "brute", "digger", "bomber"];
/** The role of each of the eight looks, by its number (scene.ts `PROWLER_NAMES`). */
export const ROLE_OF: readonly Role[] = ["creeper", "brute", "creeper", "creeper", "flier", "runner", "digger", "bomber"];
/** The look each role comes as, when nothing chooses another. */
export const KIND_OF: Readonly<Record<Role, number>> = { creeper: 0, brute: 1, flier: 4, runner: 5, digger: 6, bomber: 7 };
/** The chapter each role first comes in. */
export const ROLE_FROM: Readonly<Record<Role, number>> = { creeper: 3, runner: 4, flier: 5, brute: 6, digger: 7, bomber: 8 };
/** What beats each: a construct's number in `WORKS` (null: anything that throws). */
export const COUNTER: Readonly<Record<Role, number | null>> = { creeper: null, runner: 8, flier: 10, brute: 6, digger: 2, bomber: 9 };
export const ROLE_NAMES: Readonly<Record<Role, { one: string; many: string }>> = {
  creeper: { one: "creeper", many: "creepers" },
  runner: { one: "runner", many: "runners" },
  flier: { one: "flier", many: "fliers" },
  brute: { one: "brute", many: "brutes" },
  digger: { one: "digger", many: "diggers" },
  bomber: { one: "bomber", many: "bombers" }
};
/** What each does, in a few words (for the night's card and the guide). */
export const ROLE_DOES: Readonly<Record<Role, string>> = {
  creeper: "Walks the trail and batters the wall",
  runner: "Quick, and over the wall in a bound",
  flier: "Flies over the wall, after the larder",
  brute: "Sturdy, and batters the gate four times as hard",
  digger: "Tunnels under the wall and comes up inside",
  bomber: "Blows a section of the wall open"
};
/** The roles a camp on a chapter has come at it. */
export const rolesAt = (chapter: number): Role[] => ROLES.filter((role) => chapter >= ROLE_FROM[role]);
/** The one roles first come in, in a chapter (for the chapter's card). */
export const rolesNewAt = (chapter: number): Role[] => ROLES.filter((role) => ROLE_FROM[role] === chapter);

/** How many come on a night, by the chapter: a few, and more as the camp grows; one more every third volume; one more in winter. Ten at most. */
export const NIGHT_MOST = 10;
const WAVE_SIZES = [0, 0, 0, 2, 3, 3, 4, 4, 5, 5, 5];
export const waveSize = (chapter: number, winter = false) => {
  const plain = chapter < 3 ? 0 : chapter <= 10 ? WAVE_SIZES[chapter] : 5 + Math.floor((chapter - 10) / 3);
  return Math.min(NIGHT_MOST, plain + (winter && plain > 0 ? 1 : 0));
};

/** A small seeded roll (the same as the battle's): 0 to 1. */
const roller = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Who comes on a night, in the order they come out of the wood: the same every time it is asked for the same night.
 * Creepers are most of it; the other roles that have come are at most half, two of a kind at most, and one in the
 * chapter it first comes in. The book being read brings its own kind oftener (`favoured`, a look's number). Winter
 * brings the Frostwights as the creepers, and more of everyone.
 */
export const waveKinds = (chapter: number, seed: number, night: number, winter = false, favoured: number | null = null): number[] => {
  const size = waveSize(chapter, winter);
  if (size === 0) return [];
  const roll = roller(Math.imul(seed | 0, 2654435761) ^ Math.imul(night + 1, 40503) ^ 0x5eed);
  const others = rolesAt(chapter).filter((role) => role !== "creeper");
  const special: Role[] = [];
  const most = Math.floor(size / 2);
  // Which of them ask first, shuffled: the few places a night has go round all of them, not to the oldest.
  const asking = [...others];
  for (let at = asking.length - 1; at > 0; at--) {
    const other = Math.floor(roll() * (at + 1));
    [asking[at], asking[other]] = [asking[other], asking[at]];
  }
  for (const role of asking) {
    const cap = chapter === ROLE_FROM[role] ? 1 : 2;
    // Each other kind comes on most nights, but not all: some nights are quiet of it.
    let count = roll() < 0.5 ? (roll() < 0.35 ? 2 : 1) : 0;
    count = Math.min(cap, count);
    for (let n = 0; n < count && special.length < most; n++) special.push(role);
  }
  const favouredRole = favoured === null ? null : (ROLE_OF[favoured] ?? null);
  if (favouredRole && favouredRole !== "creeper" && others.includes(favouredRole) && roll() < 0.3 && special.length < most && special.filter((role) => role === favouredRole).length < 2) special.push(favouredRole);
  const creeper = winter ? 3 : favoured !== null && ROLE_OF[favoured] === "creeper" ? favoured : 0;
  const kinds: number[] = special.map((role) => (role === favouredRole && favoured !== null ? favoured : KIND_OF[role]));
  while (kinds.length < size) kinds.push(creeper);
  // Shuffled, with a creeper first: the front sees the plain thing before the clever one.
  for (let at = kinds.length - 1; at > 0; at--) {
    const other = Math.floor(roll() * (at + 1));
    [kinds[at], kinds[other]] = [kinds[other], kinds[at]];
  }
  const first = kinds.findIndex((kind) => ROLE_OF[kind] === "creeper");
  if (first > 0) [kinds[0], kinds[first]] = [kinds[first], kinds[0]];
  return kinds;
};

/** A night's kinds counted by role, in `ROLES` order: what the night's chip shows. */
export const countRoles = (kinds: readonly number[]): Array<{ role: Role; kind: number; count: number }> =>
  ROLES.map((role) => ({ role, kind: kinds.find((kind) => ROLE_OF[kind] === role) ?? KIND_OF[role], count: kinds.filter((kind) => ROLE_OF[kind] === role).length })).filter((entry) => entry.count > 0);

/** What a night held is worth, the first one after some reading: a little, by the chapter. */
export const nightBounty = (chapter: number) => 5 + 2 * Math.min(10, Math.max(3, chapter));

// ---- kept for older builds ----------------------------------------------------------------------

/**
 * The front as one short line of `taught` (which every build keeps whatever it holds): so a camp saved by a build that
 * does not know the front, and read here again, still has its constructs where they were and its nights held.
 */
export const FRONT_MARK = "front:";
/** A kind as one character (a hex digit), "-" for none: the mark has to stay short (a line of `taught` is 80 at most). */
const kindChar = (kind: number) => (kind >= 0 && kind < 16 ? kind.toString(16) : "-");
const charKind = (char: string) => {
  const kind = parseInt(char, 16);
  return Number.isFinite(kind) && FRONT_WORKS.includes(kind) ? kind : -1;
};
export const frontMark = (front: Front) =>
  `${FRONT_MARK}${JSON.stringify({
    // The wall's line, made negative once the reader has slid it.
    x: front.set ? -front.x : front.x,
    k: [...front.spots.slice(0, 3), ...front.pads.slice(0, 3)].map(kindChar).join("") + "|" + front.shed.slice(0, 8).map(kindChar).join(""),
    b: front.bell ? 1 : 0,
    n: Math.min(99999, front.held)
  })}`;
export const readFrontMark = (taught: readonly string[]): Partial<Front> | null => {
  const entry = taught.find((name) => name.startsWith(FRONT_MARK));
  if (!entry) return null;
  try {
    const raw = JSON.parse(entry.slice(FRONT_MARK.length)) as Record<string, unknown>;
    const [slots = "", shed = ""] = typeof raw.k === "string" ? raw.k.split("|") : [];
    const kinds = [...slots.padEnd(6, "-").slice(0, 6)].map(charKind);
    const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : LINE_DEFAULT;
    return {
      x: Math.abs(x),
      set: x < 0,
      spots: kinds.slice(0, 3),
      pads: kinds.slice(3, 6),
      shed: [...shed].map(charKind).filter((kind) => kind >= 0),
      bell: raw.b === 1,
      held: typeof raw.n === "number" && raw.n >= 0 ? Math.floor(raw.n) : 0
    };
  } catch {
    return null;
  }
};
