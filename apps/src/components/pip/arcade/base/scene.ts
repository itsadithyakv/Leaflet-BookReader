import { BUILDINGS, DEFAULT_SPOTS, MAX_LEVEL, PLACED, PROWLERS_FROM, YARD_MAX, plotOpenAt, postSpotOf, woodAt, lodgers as campLodgers, gateOf, seasonOf, type BaseState, type BuildingId, type Decor, type Placed, type Site, type Spot, type Yard } from "../../../../pip/base/rules";
import { GUARDIANS, SCENERY } from "../../../../pip/base/guards";
import { findWay, onWalk, planWalk, shuffled, wayRound, type Block, type Plan, type Stop } from "./walks";
import type { GameArt } from "../gameArt";
import { GAME_H, GAME_W } from "../games";
import { GOAT_TOUGHER, LINE_DEFAULT, MOUTH_Y, ROLE_FROM, TRAIL_Y, WALL_LEAN, darkWood, sectionsAt, trailOf, wallXAt, waveKinds } from "../../../../pip/base/front";
import { GUARD_GIVES } from "../../../../pip/base/guards";
import {
  FIZZ_SECONDS,
  PROWL_SPEED,
  SQUAT,
  TICK,
  along as alongWay,
  offBy,
  planNight,
  type FrontSetup,
  type Post,
  type NightPlan,
  type ProwlPlan,
  type Ring,
  type WalkPlan,
  type Walker
} from "./wave";

/**
 * The picture of a camp: the clearing in its season, by day or night, with
 * everything that stands in it drawn back to front by where its feet are.
 *
 * A camp is drawn from a plain description (`CampLook`), so the same painter
 * serves the reader's own camp, with its work going on and Pip in it, and a
 * friend's camp on their card, which is its levels, its counts and where
 * its things stand.
 *
 * By night everything that stands is drawn in the night's own light (cooler
 * and darker, as the clearing is), and only what gives light is left bright:
 * the art is painted for the day, and a daylit house on a moonlit field
 * looked pasted on.
 *
 * The art's own frames turn twelve times a second, as all of Pip's do. What
 * moves across the picture (Pip on her rounds, a leaf coming down, an acorn
 * on its way to the larder) is placed by the clock instead, and to the
 * screen's pixels rather than the art's, so it glides where it used to step.
 *
 * A thing with only two pictures is never flipped between them: that is a
 * blink, and a row of things blinking in time is a nuisance. Such a thing
 * holds its first picture, and what life it has is eased in: its second
 * picture faded up and down over some seconds (water, a ward's glow, smoke),
 * or a slow breath in the way it stands (a guardian at rest). Each keeps its
 * own time, so no two are ever in step.
 */

/** Sprite animation rate, like every other Pip. */
export const ART_FPS = 12;

export type CampLook = {
  /** (1.5.10) How far the wood is cleared back: the burrow's level, but the whole clearing only once chapter 10 has opened it. Absent, the burrow's. */
  clearing?: number;
  /** (1.5.10) The burrow's level when the camp was brought onto chapters: what it had opened stays open. */
  legacy?: number;
  levels: Record<BuildingId, number>;
  yard: readonly Yard[];
  /** Where each building stands, and each piece of fence. */
  spots: Record<Placed, Spot>;
  walls: readonly Spot[];
  /** The piece of fence that is the gate, where there is one. */
  gate?: Spot | null;
  /** Parcels from the reading, waiting by the burrow to be opened. */
  parcels?: number;
  /** Pip's welcome basket waits on the path by the door (`pip/base/welcome.ts`). */
  basket?: boolean;
  /** False while prowlers are held off (a new camp, until the reader has read after the welcome). */
  prowlers?: boolean;
  /** The kind of book being read (a trophy's kind), where one is: it has a say in who comes out of the wood. */
  reading?: number | null;
  /** Sites with work going on: scaffolding over them. */
  jobs: readonly Site[];
  /** 0 summer, 1 autumn, 2 winter, 3 spring. */
  season: number;
  night: boolean;
  /** Where the guardians' signposts stand, for those that have been carried from beside their building. */
  posts?: Partial<Record<number, readonly [number, number]>>;
  /** Who of the camp's fighters is worn out and asleep: a guardian's number, or a hero's plus a hundred. */
  asleep?: readonly number[];
  /** Knocks each building has taken from prowlers: a bar over it says how many. */
  harm?: Partial<Record<Placed, number>>;
  /** The garden's bed by the burrow, where the camp is the place Pip's tab opens on: 0 empty, 1 growing, 2 ripe. Not drawn when not said. */
  garden?: number | null;
  /** The lookout's lantern is lit. */
  lit: boolean;
  /** The seasons of the banners that fly: the latest few. */
  banners: readonly number[];
  /** The trophies that stand: which kind each is. */
  trophies: readonly number[];
  decor: readonly Decor[];
  /** The hedgehog is here with something to offer. */
  visitor: boolean;
  /** Acorns wait on the oak, and a tap takes them in (`oakStatus` "ready"): one bobs over it, asking to be tapped. */
  oakReady: boolean;
  /** Acorns on the oak with no room in the larder for them (`oakStatus` "full"): one sits still in its leaves, asking nothing. */
  oakFull?: boolean;
  /** The heroes who live here and are about the place: which, a few at most. */
  residents?: readonly number[];
  /** A week's reading streak or better: a rainbow stands over the trees. */
  rainbow?: boolean;
  /** Each guardian's rank, by number: one that is posted is drawn at its building. */
  guards?: readonly number[];
  /** Which clearing is looked at: the camp (when not said), or the meadow beyond it. */
  area?: "camp" | "meadow";
  /** The animals that live in the meadow, and what is set about it. */
  animals?: readonly number[];
  meadow?: readonly Decor[];
  /** Landscape set about the camp, and about the meadow; and the constructs. */
  land?: readonly Decor[];
  meadowLand?: readonly Decor[];
  works?: readonly Decor[];
  /** The lookout's path, once it has one: it is a different tower to look at. */
  towerPath?: "a" | "b" | null;
  /** (1.5.11) Where the wall across the trail stands, across the picture (`front.ts`). Absent, where a camp's begins. */
  line?: number;
  /** (1.5.11) The nights of this visit: what makes them (the same every time it is asked), and the chapter, which says who comes. Absent, nobody comes by night. */
  wave?: { seed: number; chapter: number };
};

/** The piece of landscape under a point, the nearest the front first; -1 for none. Flat pieces are low and wide, the rest tall. */
export const landAt = (land: readonly Decor[], x: number, y: number): number => {
  let found = -1;
  land.forEach((entry, index) => {
    const flat = SCENERY[entry.kind]?.flat ?? false;
    const wide = (flat ? 14 : 9) * THINGS;
    const tall = (flat ? 11 : 25) * THINGS;
    if (Math.abs(x - entry.x) <= wide && y >= entry.y - tall && y <= entry.y + 2 && (found < 0 || entry.y >= land[found].y)) found = index;
  });
  return found;
};

/** The construct under a point; -1 for none. */
export const workAt = (works: readonly Decor[], x: number, y: number): number =>
  works.findIndex((entry) => Math.abs(x - entry.x) <= 10 * THINGS && y >= entry.y - 22 * THINGS && y <= entry.y + 2);

/** How many of the camp's people are drawn about it at once: by day, and by night. The rest are indoors. */
export const RESIDENTS_SHOWN = 6;
const RESIDENTS_BY_NIGHT = 1;

/**
 * The reader's own camp as a picture of it elsewhere shows it (its card on
 * the arcade's front page): by day, as it is laid out, with whatever is
 * going up, and nothing that is only of the moment.
 */
export const lookOfBase = (base: BaseState, season: number): CampLook => ({
  levels: base.levels,
  yard: base.yard,
  spots: base.spots,
  walls: base.walls,
  gate: gateOf(base),
  parcels: base.parcels,
  jobs: base.jobs.map((job) => job.site),
  season,
  night: false,
  lit: false,
  banners: base.banners.slice(-3).map((month) => seasonOf(`${month}-15`)),
  trophies: [],
  decor: base.decor,
  visitor: false,
  oakReady: false,
  // Those with a bed in the hut: they are the ones about the camp.
  residents: campLodgers(base)
    .slice(0, RESIDENTS_SHOWN)
    .map((hero) => hero.id),
  guards: base.guards,
  land: base.land,
  works: base.works,
  towerPath: base.forks.tower ?? null
});

/** How big each building's plot is (the sprite's own size, and the stand-in's where art is missing). */
export const PLOT_SIZE: Record<Placed, { w: number; h: number; colour: string }> = {
  oak: { w: 40, h: 48, colour: "#3f8f4f" },
  burrow: { w: 48, h: 40, colour: "#8a5a34" },
  store: { w: 32, h: 28, colour: "#b07a4a" },
  tower: { w: 22, h: 44, colour: "#6f6a7a" },
  hut: { w: 32, h: 30, colour: "#a0522d" },
  yard0: { w: 30, h: 28, colour: "#9a6b3f" },
  yard1: { w: 30, h: 28, colour: "#9a6b3f" }
};

/** Where the trophies stand, along the back of the clearing under the trees, in the order they fill. */
const TROPHY_SPOTS: ReadonlyArray<[number, number]> = [
  [72, 54],
  [90, 54],
  [150, 54],
  [204, 54],
  [224, 54],
  [168, 54],
  [54, 54],
  [132, 54]
];
export const TROPHIES_SHOWN = TROPHY_SPOTS.length;
/** Where the banners fly, at the near edge of the trees. */
const BANNER_SPOTS: ReadonlyArray<[number, number]> = [
  [10, 62],
  [230, 62],
  [24, 56]
];
export const BANNERS_SHOWN = BANNER_SPOTS.length;
/** How far up the lookout the lantern hangs, by the lookout's level. */
const LANTERN_UP = [0, 26, 30, 31, 36, 40];
const HEDGEHOG_AT: [number, number] = [146, 117];
/** The night's own light, laid over everything that stands. */
const NIGHT_SHADE = "rgba(22, 34, 92, 0.46)";

/**
 * How large things stand in the clearing, beside the size their pictures
 * are: smaller, so that there is room for more of them and a full camp
 * does not look like a heap. Where they stand is the same; what shrinks is
 * the picture, about its feet, and the ground each takes up with it.
 */
export const THINGS = 0.64;
/** That, as near as a canvas of so many pixels to the art pixel can draw it with every pixel of a picture the same size. */
const smallAt = (px: number) => (px >= 3 ? Math.floor(THINGS * px + 0.25) / px : THINGS);
/** Pip beside her buildings is smaller again: at the size of her picture she is as tall as her own burrow. */
const PIP_SMALL = 0.82;

/** A thing that stands: where its feet are (for which is in front, and for what it shrinks about), the shadow it throws, and how it is drawn. */
type Standing = {
  y: number;
  /** With this, it is drawn at the clearing's smaller size, about its feet. Without, as its draw has it. */
  x?: number;
  /** Where its feet are, when that is not where it sorts by (something on a roof). */
  at?: number;
  /** Shrunk in height only: a piece of fence, which has to go on meeting the pieces beside it. */
  wide?: boolean;
  /** Smaller again by this much. */
  small?: number;
  /** Half the width of the shadow under it, in its picture's own pixels; none when not said. */
  shade?: number;
  draw: () => void;
};

/** A shadow on the grass: a low, wide blot, drawn a row at a time so it is of a piece with the rest. */
const blot = (on: CanvasRenderingContext2D, x: number, y: number, half: number, tall: number) => {
  for (let row = -tall; row <= tall; row++) {
    const wide = half * Math.sqrt(Math.max(0, 1 - (row / (tall + 0.5)) ** 2));
    on.fillRect(Math.round(x - wide), Math.round(y + row), Math.max(1, Math.round(wide * 2)), 1);
  }
};

/**
 * Draws everything that stands: the shadows first, all of them on the
 * ground and under every thing, then the things from the back of the
 * clearing to the front, each at the clearing's smaller size.
 */
const drawAll = (on: CanvasRenderingContext2D, things: Standing[], px: number, dusk: number, lean = 0.22) => {
  const small = smallAt(px);
  const place = snapper(px);
  // A shadow lies on the ground away from the sun (or, by night and fainter, the moon): longer and further out the
  // lower the light is. It is what says the things are standing on a floor and not laid flat on a map.
  on.fillStyle = `rgba(20, 28, 44, ${(0.22 * (1 - 0.5 * dusk)).toFixed(3)})`;
  const long = 1 + Math.abs(lean) * 0.9;
  for (const thing of things) {
    if (!thing.shade || thing.x === undefined) continue;
    const half = thing.shade * small * (thing.small ?? 1);
    blot(on, thing.x + half * lean * 1.5, thing.at ?? thing.y, half * long, Math.max(1, Math.round(half * 0.28)));
  }
  things
    .sort((a, b) => a.y - b.y)
    .forEach((thing) => {
      if (thing.x === undefined) {
        thing.draw();
        return;
      }
      const fx = place(thing.x);
      const fy = place(thing.at ?? thing.y);
      const by = small * (thing.small ?? 1);
      on.save();
      on.translate(fx, fy);
      on.scale(thing.wide ? 1 : by, by);
      on.translate(-fx, -fy);
      thing.draw();
      on.restore();
    });
};

/** The room a building takes in the picture: at the clearing's smaller size, unless another is asked for. */
const boxOf = (site: Placed, spot: Spot, by = THINGS) => {
  const size = PLOT_SIZE[site];
  return { left: Math.round(spot[0] - (size.w * by) / 2), top: spot[1] - size.h * by, w: size.w * by, h: size.h * by };
};

/** Where the acorn that waits on the oak is drawn, about its middle: the first of them sets off from there when gathered. */
export const oakAcornAt = (spots: Pick<Record<Placed, Spot>, "oak">) => ({ x: spots.oak[0], y: boxOf("oak", spots.oak).top + 2 });

/** The building under a point of the scene, the nearest the front first. */
export const siteAt = (spots: Record<Placed, Spot>, x: number, y: number, there: readonly Placed[] = PLACED): Placed | null => {
  for (const site of [...there].sort((a, b) => spots[b][1] - spots[a][1])) {
    const box = boxOf(site, spots[site]);
    if (x >= box.left && x < box.left + box.w && y >= box.top && y < box.top + box.h) return site;
  }
  return null;
};

/** The thing set down under a point of the scene, the nearest the front first; -1 for none. */
export const decorAt = (decor: readonly Decor[], x: number, y: number): number => {
  let found = -1;
  decor.forEach((entry, index) => {
    if (x >= entry.x - 10 * THINGS && x < entry.x + 10 * THINGS && y >= entry.y - 18 * THINGS && y <= entry.y && (found < 0 || entry.y >= decor[found].y)) found = index;
  });
  return found;
};

export type CampExtras = {
  /** How much more sky there is above the picture, in art pixels: the sun and the moon go up into it. */
  sky?: number;
  /** The ground things take up, to be shown in red on the grass: what is chosen, or everything while the camp is being laid out. How far things reach is `rings`, in blue. */
  spaces?: ReadonlyArray<{ x: number; y: number; r: number }>;
  /** A guardian's signpost being carried: whose, and where it is just now. */
  posting?: { guard: number; x: number; y: number } | null;
  /** Buildings whose health is to be shown on a bar just now: one just knocked, or one the pointer is resting on. The damage itself is always on the building. */
  bars?: readonly Placed[];
  /** What in the camp throws, and how far each reaches: with it, prowlers come out of the wood and are seen off (or are not, where too little reaches). */
  watch?: ReadonlyArray<{ x: number; y: number; r: number; every?: number; hurts?: number }>;
  /** Seconds the camp has been open: the clock its own day and night are told by, and so when the prowlers come. */
  clock?: number;
  /** Pip was woken in the night by a tap on her burrow: how many seconds ago. She is up and about for a while, then goes back in. */
  awake?: number;
  /** How far night has fallen, 0 (day) to 1 (night), where the picture keeps hours of its own. Not said, it is the look's day or night. */
  dusk?: number;
  /** Canvas pixels to an art pixel: what moves is placed to these, not to whole art pixels. 1 when not said. */
  px?: number;
  /** Seconds the picture has been up. Without it nothing wanders, drifts or bobs: the picture is a still. */
  time?: number;
  /** A building just chosen gives a little bounce: which, and how many seconds ago. */
  bounce?: { site: Placed; age: number } | null;
  /** Acorns on their way from the oak to the larder: how far along each is, 0 to 1. */
  flying?: readonly number[];
  /**
   * The oak tapped, and seen to be: "gather", a quick shiver and a few leaves let go as its acorns come down; "full",
   * a slow shake of its head, with nothing let go, when the larder has no room. How many seconds ago.
   */
  oakShake?: { kind: "gather" | "full"; age: number } | null;
  /** The hedgehog trundling in: how far along, 0 to 1. */
  arriving?: number;
  /** While things are moved about: how far each thing that throws reaches, and the line the magpies will take to the larder. */
  rings?: ReadonlyArray<{ x: number; y: number; r: number; /** How far it would reach a level up (a building sheet): a dashed line of butter, no wash. */ next?: boolean }>;
  path?: { from: readonly [number, number]; to: readonly [number, number] } | null;
  /** An animal just petted: where, and how many seconds ago. */
  petted?: { x: number; y: number; age: number } | null;
  /** The building pointed at, or chosen: any fence standing in front of it is drawn thin, so that the building can be seen and got at. */
  through?: Placed | null;
  /** Where the pointer is resting in the scene: fence under it is drawn thin too, for whatever small thing stands behind it. */
  peek?: { x: number; y: number } | null;
  /**
   * Something just happened at a place, and is seen to have: a burst of bits there, and (where there are words, a
   * figure as a rule: "+7", "-10") the words going up from it. `bad` is a loss, in red. `age` in seconds.
   */
  floats?: ReadonlyArray<{ x: number; y: number; age: number; text?: string; bad?: boolean }>;
  /** A mark over a chosen piece of landscape or a construct: where its foot is, and how tall it stands. */
  mark?: { x: number; y: number; up: number } | null;
  /** A piece of landscape or a construct being set down, following the pointer: which sprite, which of them, and where. */
  setting?: { sprite: "land" | "work"; kind: number; x: number; y: number } | null;
  /** Pip, in the reader's own camp: beside what she is building, or on her rounds. */
  pip?: boolean;
  /** A marker over the chosen building. */
  selected?: Placed | null;
  /** A marker over the chosen thing set down. */
  selectedDecor?: number;
  /** A thing being set down, following the pointer. */
  placing?: { kind: number; x: number; y: number } | null;
  /** A building being moved, following the pointer: where, and whether it may stand there. */
  carrying?: { site: Placed; x: number; y: number; ok: boolean } | null;
  /** A piece of fence about to go down: where, and whether it may. */
  wall?: { x: number; y: number; ok: boolean } | null;
  /** How far the lookout throws, shown while things are being moved about. */
  reach?: number | null;
  /** The side tonight's magpies come from, shown while things are being moved about. */
  from?: "left" | "top" | "right" | "bottom" | null;
  /** A building just finished: the burst over it, and how far along. */
  burst?: { site: Site; frame: number } | null;
  /** Magpies crossing, for the morning after: how far along, 0 to 1. */
  magpies?: number | null;
  /** Pip on her way in at the burrow's door: the `time` she set off at (see `pipEntry`). */
  entering?: number | null;
  /** Pip has just come out of the burrow with the reader: the `time` she came out at (see `pipExit`). */
  cameOut?: number | null;
  /** The burrow's door glows, to be found (its first visit, and the tour's step for it): how bright, 0 to 1. */
  doorGlow?: number;
  /** (1.5.11) The front's slots, while it is arranged: where each trap spot and tower pad is, how many are open, which have something on them, and the one chosen. */
  front?: {
    spots: ReadonlyArray<readonly [number, number]>;
    pads: ReadonlyArray<readonly [number, number]>;
    open: { spots: number; pads: number };
    filled: { spots: readonly boolean[]; pads: readonly boolean[] };
    chosen?: { at: "spot" | "pad"; index: number } | null;
  } | null;
  /** (1.5.11) The wall is taken hold of, to be slid along the trail: it glows. */
  sliding?: boolean;
};

/** Places to a grid of so many to the art pixel. */
const snapper = (px: number) => (value: number) => Math.round(value * px) / px;

/** How far Pip walks in a second, in art pixels, and what she does at each stop. */
const PIP_SPEED = 13;
const PIP_STOPS = ["idle", "look", "idle", "yawn", "idle", "stretch"] as const;

/**
 * Pip on her rounds: where she is at a time, and what she is doing. She
 * walks from stop to stop and idles at each, the same round for the same
 * camp, so it needs no memory: the clock says where she is.
 */
export const pipRounds = (time: number, stops: ReadonlyArray<readonly [number, number]>, pace = 1, stay = 1) => {
  const count = stops.length;
  const legs = stops.map((from, index) => {
    const to = stops[(index + 1) % count];
    // A slower walker takes longer over the walking, not over the standing: nobody stands about for long,
    // or the clearing looks as if it had stopped.
    return { from, to, walk: Math.hypot(to[0] - from[0], to[1] - from[1]) / (PIP_SPEED * pace), rest: (1.5 + (index % 3) * 0.7) * stay, act: PIP_STOPS[index % PIP_STOPS.length] };
  });
  const round = legs.reduce((sum, leg) => sum + leg.walk + leg.rest, 0);
  let left = round > 0 ? ((time % round) + round) % round : 0;
  for (const leg of legs) {
    if (left < leg.walk) {
      const along = left / leg.walk;
      return { x: leg.from[0] + (leg.to[0] - leg.from[0]) * along, y: leg.from[1] + (leg.to[1] - leg.from[1]) * along, move: "walk", faceLeft: leg.to[0] < leg.from[0], age: left };
    }
    left -= leg.walk;
    if (left < leg.rest) return { x: leg.to[0], y: leg.to[1], move: leg.act as string, faceLeft: false, age: left };
    left -= leg.rest;
  }
  return { x: stops[0]?.[0] ?? 0, y: stops[0]?.[1] ?? 0, move: "idle", faceLeft: false, age: 0 };
};

/** The squash a thing just chosen gives: down, up, and still again, in half a second. */
const boing = (age: number) => (age < 0 || age > 0.6 ? 0 : 0.16 * Math.exp(-6 * age) * Math.cos(18 * age));

/** How long the oak's shake lasts, in seconds: the gathering's shiver, and the full larder's slower "no". */
export const OAK_SHAKE_SECONDS = { gather: 0.42, full: 0.6 } as const;
/**
 * Where the oak is, sideways, while it shakes: a whole art pixel either way or none, never between (a small
 * sprite moved by fractions shimmers). Gathering, it shivers quickly; with the larder full, it shakes its head
 * slowly, twice, and is still.
 */
export const oakShakeOffset = (kind: "gather" | "full", age: number): -1 | 0 | 1 => {
  if (age < 0 || age >= OAK_SHAKE_SECONDS[kind]) return 0;
  const beat = Math.floor(age / (kind === "gather" ? 0.06 : 0.15));
  return kind === "gather" ? (beat % 2 === 0 ? 1 : -1) : ([1, -1, 1, 0] as const)[beat % 4];
};
/** The leaves a gathering shakes out of the oak: so many, falling for so long (seconds). */
const LEAVES_LET_GO = 5;
const LEAF_FALL_SECONDS = 0.9;
/** The leaves' colours by the season: spring, summer, autumn, winter (as the trees' own). */
const LEAF_COLOURS = [
  ["#7cc85a", "#4e8e3e"],
  ["#e8943a", "#d8642c"],
  ["#f4f6ff", "#c9d1ff"],
  ["#f4a8c8", "#9ad06a"]
] as const;

const DRIFT: ReadonlyArray<{ count: number; colours: readonly string[]; fall: number; sway: number }> = [
  // Summer has butterflies, drawn their own way.
  { count: 3, colours: ["#fff7d6", "#ffd86b", "#9ad0ff"], fall: 0, sway: 0 },
  { count: 9, colours: ["#e07a2f", "#c9482b", "#e8b03a"], fall: 9, sway: 5 },
  { count: 16, colours: ["#ffffff", "#e8f0ff"], fall: 6, sway: 3 },
  { count: 9, colours: ["#f6b7c9", "#ffffff", "#f29bb4"], fall: 5, sway: 6 }
];

/** What is on the air in a season: butterflies, leaves, snow, petals. Placed by the clock alone. */
const drift = (ctx: CanvasRenderingContext2D, season: number, time: number, snap: (value: number) => number) => {
  const air = DRIFT[season % 4];
  for (let bit = 0; bit < air.count; bit++) {
    ctx.fillStyle = air.colours[bit % air.colours.length];
    if (air.fall === 0) {
      const x = 120 + Math.sin(time * 0.31 + bit * 2.1) * 84 + Math.sin(time * 1.7 + bit) * 5;
      const y = 78 + Math.cos(time * 0.43 + bit * 1.3) * 20 + Math.sin(time * 2.3 + bit) * 3;
      const open = Math.sin(time * 14 + bit * 2) > 0;
      ctx.fillRect(snap(x), snap(y), 1, 1);
      if (open) {
        ctx.fillRect(snap(x - 1), snap(y - 1), 1, 1);
        ctx.fillRect(snap(x + 1), snap(y - 1), 1, 1);
      }
      continue;
    }
    const x = ((bit * 53.7 + time * (4 + (bit % 3) * 2)) % (GAME_W + 20)) - 10 + Math.sin(time * 1.3 + bit) * air.sway;
    const y = 34 + ((bit * 37.3 + time * (air.fall + (bit % 4) * 1.5)) % (GAME_H - 34));
    // A leaf turns as it falls: seen flat, then edge on.
    const flat = air.fall > 6 && Math.sin(time * 3 + bit) > 0;
    ctx.fillRect(snap(x), snap(y), flat ? 2 : 1, 1);
  }
};

/** Fireflies, by night: a few slow lights that come and go. */
const fireflies = (ctx: CanvasRenderingContext2D, time: number, snap: (value: number) => number) => {
  ctx.fillStyle = "#f7f29a";
  for (let fly = 0; fly < 7; fly++) {
    const glow = Math.sin(time * 1.6 + fly * 1.7) ** 2;
    if (glow < 0.15) continue;
    ctx.globalAlpha = 0.25 + glow * 0.75;
    ctx.fillRect(snap(30 + fly * 30 + Math.sin(time * 0.4 + fly * 2.3) * 16), snap(72 + (fly % 3) * 12 + Math.cos(time * 0.55 + fly) * 8), 1, 1);
  }
  ctx.globalAlpha = 1;
};

const RAINBOW = ["#e8504a", "#f29b3a", "#f4d94a", "#6cc35a", "#4a9be0", "#8a63c9"];
/** A rainbow over the trees, in the art's own pixels: a band for each colour, its feet lost behind the wood. */
const rainbow = (ctx: CanvasRenderingContext2D) => {
  const centre = { x: 168, y: 58 };
  ctx.globalAlpha = 0.5;
  RAINBOW.forEach((colour, band) => {
    const r = 50 - band * 2;
    ctx.fillStyle = colour;
    for (let x = -r; x <= r; x++) {
      const y = centre.y - Math.round(Math.sqrt(r * r - x * x));
      if (y < 44) ctx.fillRect(centre.x + x, y, 1, 2);
    }
  });
  ctx.globalAlpha = 1;
};

const marker = (ctx: CanvasRenderingContext2D, x: number, top: number, frame: number, bob: number | null = null) => {
  const tip = Math.max(2, top - 7 + (bob ?? Math.round(Math.sin((frame / ART_FPS) * Math.PI * 2 + 1))));
  ctx.fillStyle = "#1a1a22";
  ctx.fillRect(x - 4, tip - 1, 9, 3);
  ctx.fillRect(x - 2, tip + 2, 5, 2);
  ctx.fillRect(x, tip + 4, 1, 1);
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(x - 3, tip, 7, 1);
  ctx.fillRect(x - 2, tip + 1, 5, 1);
  ctx.fillRect(x - 1, tip + 2, 3, 1);
  ctx.fillRect(x, tip + 3, 1, 1);
};

/** A dotted circle on the ground: how far something reaches. */
/**
 * How much shallower than it is wide anything's reach is. The camp is
 * looked at from a slant and not from above, so a round patch of ground is
 * an oval on the screen; and reach is measured the way it is drawn, so that
 * what the oval covers is what is reached.
 */
// (`SQUAT` and `offBy`, how far off something is as reach goes, are `wave.ts`'s since 1.5.11: the night is fought there.)

/** A patch of colour on the grass, an oval as the ring round it is: the ground a thing takes, or how far it reaches. */
const disc = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) => {
  ctx.fillStyle = colour;
  const tall = Math.max(1, Math.round(r * SQUAT));
  for (let row = -tall; row <= tall; row++) {
    const wide = r * Math.sqrt(Math.max(0, 1 - (row / (tall + 0.5)) ** 2));
    ctx.fillRect(Math.round(x - wide), Math.round(y + row), Math.max(1, Math.round(wide * 2)), 1);
  }
};

const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) => {
  ctx.fillStyle = colour;
  const dots = Math.max(12, Math.round(r * 1.1));
  for (let dot = 0; dot < dots; dot += 2) {
    const angle = (dot / dots) * Math.PI * 2;
    ctx.fillRect(Math.round(x + Math.cos(angle) * r), Math.round(y + Math.sin(angle) * r * SQUAT), 1, 1);
  }
};

let layer: HTMLCanvasElement | null = null;
/** A second canvas for what has to be drawn and then lit as one: the scene's size, at so many canvas pixels to the art pixel. */
const layerOf = (px: number) => {
  layer ??= document.createElement("canvas");
  if (layer.width !== GAME_W * px || layer.height !== GAME_H * px) {
    layer.width = GAME_W * px;
    layer.height = GAME_H * px;
  }
  const ctx = layer.getContext("2d");
  if (ctx) {
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, GAME_W, GAME_H);
  }
  return ctx;
};

/**
 * Draws things onto the scene in the scene's light: as they are by day, and
 * under the night's shade by night. `draw` is handed the canvas to draw on.
 * `px` is how many canvas pixels the scene has to each art pixel, so what is
 * lit is as finely placed as what is not.
 */
export const inLight = (ctx: CanvasRenderingContext2D, night: boolean | number, draw: (on: CanvasRenderingContext2D) => void, px = 1) => {
  // How much of the night's shade there is: all of it, none, or as far as dusk has got.
  const shade = typeof night === "number" ? Math.max(0, Math.min(1, night)) : night ? 1 : 0;
  const on = shade > 0 ? layerOf(Math.max(1, Math.round(px))) : null;
  if (!on || !layer) {
    draw(ctx);
    return;
  }
  draw(on);
  // Only where something was drawn: the shade falls on the things, not on the air between them.
  on.globalCompositeOperation = "source-atop";
  on.fillStyle = NIGHT_SHADE;
  on.globalAlpha = shade;
  on.fillRect(0, 0, GAME_W, GAME_H);
  on.globalAlpha = 1;
  on.globalCompositeOperation = "source-over";
  ctx.drawImage(layer, 0, 0, GAME_W, GAME_H);
};

/**
 * The picture keeps hours of its own. A day by the wall clock would show a
 * reader who opens the app in the evening nothing but night, for ever; so
 * a day in the clearing is twelve minutes long: light for nine, a dusk, a
 * night of a little over two minutes, a dawn. It begins in the morning each
 * time the camp is opened. It is for looking at only: the night the raiders
 * come in is still the calendar's.
 *
 * (It was four minutes, light for two of them, until 1.5.8: on a phone a
 * visit of a few minutes, a card or two read, went dark "at midday", which
 * read as a fault. Still far quicker than the wall clock, as the owner
 * asked; a visit is now mostly by day.)
 */
export const DAY_SECONDS = 720;
const DUSK_AT = 540;
const TURN_SECONDS = 24;
const DAWN_AT = DAY_SECONDS - TURN_SECONDS;
/** How far night has fallen so many seconds after the camp was opened: 0 by day, 1 by night, and eased between at dusk and at dawn. */
export const duskAt = (seconds: number) => {
  const at = ((seconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const ease = (t: number) => t * t * (3 - 2 * t);
  if (at < DUSK_AT) return 0;
  if (at < DUSK_AT + TURN_SECONDS) return ease((at - DUSK_AT) / TURN_SECONDS);
  if (at < DAWN_AT) return 1;
  return 1 - ease((at - DAWN_AT) / TURN_SECONDS);
};

/**
 * The sun, going over from one side of the sky to the other in the camp's
 * own day, up into whatever more sky there is above the picture and down
 * behind the far trees at the end of it. (The moon is in the night's own
 * picture, and stays where it is painted.)
 */
/** How far across the sky the sun is at a moment of the camp's clock, and the moon: 0 at one side to 1 at the other; out of that when it is not up. */
const skyAt = (clock: number) => {
  const at = ((clock % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const sunFrom = DAWN_AT + 4;
  const sunFor = DAY_SECONDS - sunFrom + DUSK_AT + 11;
  return { sun: ((at - sunFrom + DAY_SECONDS) % DAY_SECONDS) / sunFor, moon: (at - (DUSK_AT + 4)) / (DAWN_AT + 9 - (DUSK_AT + 4)) };
};
/** Which way shadows lie, and how far: away from whichever light is up. To the right when it is not known. */
const leanAt = (clock: number | undefined) => {
  if (clock === undefined) return 0.22;
  const { sun, moon } = skyAt(clock);
  // By night it is the moon in the night's own picture, which is over to the right.
  void moon;
  const light = sun >= 0 && sun <= 1 ? sun : 0.83;
  return (0.5 - light) * -1.6;
};
/**
 * The far end of the clearing is a little paler than the near: the air
 * between. In bands, as the rest of the picture is in pixels. Laid over
 * the ground and whatever stands on it, so that what is further off is
 * further off.
 */
const haze = (on: CanvasRenderingContext2D, dusk: number) => {
  const bands = 6;
  const from = 44;
  const each = 7;
  for (let band = 0; band < bands; band++) {
    const strength = 0.17 * (1 - band / bands) * (1 - 0.55 * dusk);
    on.fillStyle = dusk > 0.5 ? `rgba(120, 140, 200, ${strength.toFixed(3)})` : `rgba(244, 248, 226, ${strength.toFixed(3)})`;
    on.fillRect(0, from + band * each, GAME_W, each);
  }
};

const orbs = (ctx: CanvasRenderingContext2D, clock: number, sky: number) => {
  const { sun, moon } = skyAt(clock);
  const horizon = 21;
  const top = 7 - sky;
  const place = (along: number): [number, number] => [12 + along * (GAME_W - 24), horizon + 6 - Math.sin(along * Math.PI) * (horizon + 6 - top)];
  const ball = (x: number, y: number, r: number, colour: string) => {
    ctx.fillStyle = colour;
    for (let row = -r; row <= r; row++) {
      const wide = Math.sqrt(Math.max(0, (r + 0.4) ** 2 - row * row));
      ctx.fillRect(Math.round(x - wide), Math.round(y + row), Math.max(1, Math.round(wide * 2)), 1);
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, -sky, GAME_W, sky + horizon + 1);
  ctx.clip();
  if (sun >= 0 && sun <= 1) {
    const [x, y] = place(sun);
    // Low in the sky it is redder.
    const low = 1 - Math.sin(sun * Math.PI);
    ball(x, y, 6, low > 0.6 ? "rgba(255, 170, 90, 0.28)" : "rgba(255, 240, 170, 0.3)");
    ball(x, y, 4, low > 0.6 ? "#ffb35c" : "#fff0a8");
    ball(x - 1, y - 1, 2, low > 0.6 ? "#ffd08a" : "#fffbe0");
  }
  // The night's own picture has its moon in it already, over to the right: a second one going across would be one too many.
  void moon;
  ctx.restore();
};

/** The clearing behind everything: the day's picture, and the night's laid over it as far as dusk has got. False where the art is not there. */
const backdrop = (ctx: CanvasRenderingContext2D, art: GameArt, season: number, frame: number, dusk: number) => {
  const day = dusk < 1 ? art.sprite("bg", frame, { variant: season % 4 }) : null;
  const dark = dusk > 0 ? art.sprite("bg", frame, { variant: (season % 4) + 4 }) : null;
  if (!day && !dark) return false;
  if (day) ctx.drawImage(day.image, 0, 0);
  if (dark) {
    ctx.globalAlpha = day ? dusk : 1;
    ctx.drawImage(dark.image, 0, 0);
    ctx.globalAlpha = 1;
  }
  return true;
};

const scatter = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * More sky, above the picture: where the room is taller than the clearing,
 * the sky goes on up rather than the picture stopping short. `tall` art
 * pixels of it, drawn from the top of the canvas; the clearing is drawn
 * under it by whoever asked. By night it has stars of its own.
 */
export const paintSky = (ctx: CanvasRenderingContext2D, art: GameArt, look: CampLook, tall: number, dusk?: number) => {
  if (tall <= 0) return;
  const level = Math.max(0, Math.min(1, dusk ?? (look.night ? 1 : 0)));
  const fill = (variant: number, plain: string, alpha: number) => {
    const top = art.sprite("skytop", 0, { variant });
    ctx.globalAlpha = alpha;
    if (top) ctx.drawImage(top.image, 0, 0, GAME_W, tall);
    else {
      ctx.fillStyle = plain;
      ctx.fillRect(0, 0, GAME_W, tall);
    }
    ctx.globalAlpha = 1;
  };
  if (level < 1) fill(look.season % 4, "#9fd3e6", 1);
  if (level > 0) {
    fill((look.season % 4) + 4, "#1c2447", level);
    // As thick as the stars in the picture's own sky, so the join does not show.
    const stars = Math.round(tall * 2);
    for (let k = 0; k < stars; k++) {
      const x = Math.floor(scatter(k * 3 + 5) * GAME_W);
      const y = Math.floor(scatter(k * 7 + 9) * Math.max(1, Math.floor(tall)));
      ctx.globalAlpha = level;
      ctx.fillStyle = k % 5 === 0 ? "#FFFFFF" : k % 3 === 0 ? "#C9D1FF" : "#8C9AD8";
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
};

/**
 * More ground, below the picture: the grass goes on down, for the row of
 * keys to stand on without hiding the front of the clearing. `tall` art
 * pixels of it, from `top` down.
 */
export const paintGround = (ctx: CanvasRenderingContext2D, art: GameArt, look: CampLook, top: number, tall: number, dusk?: number) => {
  if (tall <= 0) return;
  const level = Math.max(0, Math.min(1, dusk ?? (look.night ? 1 : 0)));
  const fill = (variant: number, plain: string, alpha: number) => {
    const end = art.sprite("groundend", 0, { variant });
    ctx.globalAlpha = alpha;
    if (end) ctx.drawImage(end.image, 0, top, GAME_W, tall);
    else {
      ctx.fillStyle = plain;
      ctx.fillRect(0, top, GAME_W, tall);
    }
    ctx.globalAlpha = 1;
  };
  if (level < 1) fill(look.season % 4, "#7fbf6a", 1);
  if (level > 0) fill((look.season % 4) + 4, "#3c6a5a", level);
};

/** Where the garden's bed lies: by the burrow, to its left and a little forward, and on the grass. */
export const gardenSpot = (spots: Record<Placed, Spot>): Spot => [Math.max(16, Math.min(GAME_W - 16, spots.burrow[0] - 22)), Math.max(60, Math.min(GAME_H - 4, spots.burrow[1] + 8))];
/** Whether a point of the scene is on the garden's bed. */
export const gardenAt = (spots: Record<Placed, Spot>, x: number, y: number) => {
  const [gx, gy] = gardenSpot(spots);
  return Math.abs(x - gx) <= 13 * THINGS && y >= gy - 14 * THINGS && y <= gy + 1;
};

/**
 * The wood at the clearing's edges. A new camp has little ground: trees
 * stand close on either side, and each level of the burrow clears them
 * further back (`woodAt`). They are the reader's own kinds of tree and
 * bush, thick enough to be a wood and no thicker, set the same way every
 * time for the same camp; and none stands on top of anything the reader
 * has put there, so a camp laid out before the wood was thought of is not
 * buried in it.
 */
const WOODS = new WeakMap<CampLook, Array<Decor & { dark?: boolean }>>();
/** How near the trail no tree of the Dark Wood stands: the trail is a way through it. */
const TRAIL_ROOM = 8;
/** How far a point is from the trail (in front of the wall), across the ground. */
const offTrail = (trail: ReadonlyArray<readonly [number, number]>, x: number, y: number) => {
  let best = Infinity;
  for (let at = 1; at < trail.length; at++) {
    const [ax, ay] = trail[at - 1];
    const [bx, by] = trail[at];
    const dx = bx - ax;
    const dy = by - ay;
    const long = dx * dx + dy * dy;
    const share = long === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / long));
    best = Math.min(best, Math.hypot(ax + dx * share - x, ay + dy * share - y));
  }
  return best;
};
const forestOf = (look: CampLook): Array<Decor & { dark?: boolean }> => {
  const kept = WOODS.get(look);
  if (kept) return kept;
  const right = woodAt(look.clearing ?? look.levels.burrow);
  // The Dark Wood on the left never clears (1.5.11): its trail comes through it.
  const left = leftWoodOfLook(look);
  const trail = look.levels.burrow >= PROWLERS_FROM ? trailOf(left, frontLine(look)) : null;
  const wood = Math.max(left, right);
  const trees: Array<Decor & { dark?: boolean }> = [];
  if (wood > 0) {
    const taken: Array<readonly [number, number]> = [
      ...PLACED.map((site) => look.spots[site]),
      ...look.walls,
      ...look.decor.map((entry) => [entry.x, entry.y] as const),
      ...(look.land ?? []).map((entry) => [entry.x, entry.y] as const),
      ...(look.works ?? []).map((entry) => [entry.x, entry.y] as const)
    ];
    // Pine, birch and bush, a pine oftenest: rows of them from the trees' edge to the foot of the picture.
    const KINDS = [4, 9, 4, 5, 4, 9];
    // A little way in from where things may be set down: the last trees stand at the clearing's very edge.
    let n = 0;
    for (let row = 0; row < 9; row++) {
      const y = 53 + row * 8;
      for (let col = 0; col * 7 < wood + 4; col++) {
        for (const side of [0, 1]) {
          n += 1;
          const deep = (side === 0 ? left : right) + 4;
          const inward = col * 7 + scatter(n * 3.1 + 7) * 5 - (row % 2) * 3;
          if (deep <= 4 || inward > deep - 2) continue;
          const x = Math.round(side === 0 ? inward : GAME_W - inward);
          const ty = Math.round(y + scatter(n * 5.3 + 2) * 5);
          if (taken.some(([tx, tyy]) => Math.hypot(tx - x, tyy - ty) < 15)) continue;
          // The trail is kept clear through the Dark Wood.
          if (side === 0 && trail && offTrail(trail, x, ty - 2) < TRAIL_ROOM) continue;
          trees.push({ kind: KINDS[Math.floor(scatter(n * 9.7 + 1) * KINDS.length)], x, y: Math.min(GAME_H - 1, ty), dark: side === 0 && trail !== null });
        }
      }
    }
  }
  WOODS.set(look, trees);
  return trees;
};

/** How long Pip is up for when she is woken in the night. */
export const AWAKE_SECONDS = 45;

/** The ground everything in a camp takes: what a walker goes round. */
/**
 * Where a fence joins itself going up the picture. Pieces are laid on a
 * grid ten apart, and a piece is drawn facing the reader: side by side
 * they meet, but one behind another they stood apart like the rungs of a
 * ladder, and so did two on the diagonal. Each join is from a piece to the
 * one behind it (straight behind, or behind and to one side), and is
 * drawn as the fence seen from its end, and counted as fence by whoever
 * has to go round it. A diagonal is only a join where the two are not
 * joined already round the corner.
 */
export const fenceLinks = (pieces: ReadonlyArray<readonly [number, number]>): Array<[number, number, number, number]> => {
  const has = (x: number, y: number) => pieces.some((piece) => piece[0] === x && piece[1] === y);
  const links: Array<[number, number, number, number]> = [];
  for (const [x, y] of pieces) {
    if (has(x, y - 10)) links.push([x, y, x, y - 10]);
    for (const side of [-10, 10]) if (has(x + side, y - 10) && !has(x + side, y) && !has(x, y - 10)) links.push([x, y, x + side, y - 10]);
  }
  return links;
};
/**
 * The colours a fence of a level is drawn in, taken from its own picture:
 * the light along its top, its face, and the same in shade for the side of
 * it that is seen where it runs away up the picture. Taken from the
 * picture so that a paling is joined in wood and a wall in stone, whatever
 * the art for a level is.
 */
const FENCE_TONES = new WeakMap<GameArt, Map<number, { top: string; face: string; side: string; rail: string }>>();
const fenceTones = (art: GameArt, level: number) => {
  let kept = FENCE_TONES.get(art);
  if (!kept) FENCE_TONES.set(art, (kept = new Map()));
  const had = kept.get(level);
  if (had) return had;
  let tones = { top: "#c79a5c", face: "#9a6f3e", side: "#6b4a2e", rail: "#4a2f1a" };
  try {
    const sprite = art.sprite("fencepiece", 0, { variant: level });
    const image = sprite?.image as HTMLCanvasElement | undefined;
    const data = image?.getContext?.("2d")?.getImageData(Math.floor(sprite!.w / 2), 0, 1, sprite!.h).data;
    if (data) {
      // Down the middle of the piece: what is not its outline.
      const seen: Array<[number, number, number]> = [];
      for (let row = 0; row < data.length / 4; row++) {
        const [r, g, b, a] = [data[row * 4], data[row * 4 + 1], data[row * 4 + 2], data[row * 4 + 3]];
        if (a > 200 && r + g + b > 150) seen.push([r, g, b]);
      }
      if (seen.length >= 3) {
        const shade = (c: [number, number, number], by: number) => `rgb(${Math.round(c[0] * by)}, ${Math.round(c[1] * by)}, ${Math.round(c[2] * by)})`;
        const face = seen[Math.floor(seen.length / 2)];
        // The top of a wall running away from the reader is its face with the light on it: not as bright as the one
        // row of light along the top of a piece, which over a whole strip would be a white bar.
        const lid: [number, number, number] = [(seen[0][0] + face[0] * 2) / 3, (seen[0][1] + face[1] * 2) / 3, (seen[0][2] + face[2] * 2) / 3];
        tones = { top: shade(lid, 1.06), face: shade(face, 1), side: shade(face, 0.74), rail: shade(face, 0.52) };
      }
    }
  } catch {
    // No picture to take them from: the wood's own.
  }
  kept.set(level, tones);
  return tones;
};

/**
 * Whether a piece of fence has no piece to either side of it: it is drawn
 * as a post then, not as a length of fence. That is so in a run going up
 * the picture, where a length sticking out to either side would be wrong;
 * and it is so of a piece standing by itself, which has no direction at
 * all until it has a neighbour. Drawn as a length facing the reader, a
 * lone piece looked as if it had been put down sideways and wanted
 * turning: there is nothing to turn, a wall goes the way its pieces are
 * laid.
 */
const endOn = (pieces: ReadonlyArray<readonly [number, number]>, x: number, y: number) => {
  const has = (px: number, py: number) => pieces.some((piece) => piece[0] === px && piece[1] === py);
  return !has(x - 10, y) && !has(x + 10, y);
};

/** The room each piece of landscape takes on the ground: how wide, how deep, and how far up from where it is set down its middle is. */
const LAND_ROOM: Record<number, [number, number, number]> = { 0: [13, 6, 8], 1: [16, 8, 10], 2: [12, 4, 2], 3: [6, 3, 1], 4: [3, 2, 1], 5: [5, 2.5, 1], 9: [3, 2, 1] };

/**
 * What stands in the way of somebody coming out of the wood: every building
 * but the one he is after, and the lie of the land (water, a knoll,
 * boulders, a trunk). Not what is set down to be walked into: a hedge, a
 * patch of tanglefoot, a pitfall are no use to anyone if they are walked
 * round. So a pond dug in the right place, or a knoll, is a wall that
 * cannot be climbed: it turns whoever comes on foot, and the reader can
 * say which way.
 */
export const prowlBlocks = (look: CampLook, after: Placed | null): Block[] => {
  const blocks: Block[] = [];
  for (const site of PLACED) {
    if (site === after) continue;
    const yard = site === "yard0" ? look.yard[0] : site === "yard1" ? look.yard[1] : undefined;
    if (!plotOpenAt(look.levels.burrow, yard, site, look.legacy ?? 0)) continue;
    const rx = PLOT_SIZE[site].w * THINGS * 0.46;
    const ry = Math.max(3.5, rx * 0.42);
    blocks.push({ x: look.spots[site][0], y: look.spots[site][1] - ry * 0.5, rx, ry });
  }
  (look.land ?? []).forEach((entry) => {
    const room = LAND_ROOM[entry.kind];
    if (room) blocks.push({ x: entry.x, y: entry.y - room[2], rx: room[0], ry: room[1] });
  });
  return blocks;
};

const blocksOf = (look: CampLook): Block[] => {
  const blocks: Block[] = [];
  for (const site of PLACED) {
    const yard = site === "yard0" ? look.yard[0] : site === "yard1" ? look.yard[1] : undefined;
    if (!plotOpenAt(look.levels.burrow, yard, site, look.legacy ?? 0)) continue;
    const rx = PLOT_SIZE[site].w * THINGS * 0.46;
    const ry = Math.max(3.5, rx * 0.42);
    blocks.push({ x: look.spots[site][0], y: look.spots[site][1] - ry * 0.5, rx, ry });
  }
  // The gate is the way through the fence, for the camp's own.
  look.walls.forEach(([x, y]) => {
    if (!look.gate || look.gate[0] !== x || look.gate[1] !== y) blocks.push({ x, y: y + 2, rx: 5.5, ry: 2.5 });
  });
  // And between one piece and the one behind it there is fence too.
  fenceLinks(look.walls).forEach(([x, y, bx, by]) => blocks.push({ x: (x + bx) / 2, y: (y + by) / 2 + 2, rx: 3, ry: 4 }));
  look.decor.forEach((entry) => blocks.push({ x: entry.x, y: entry.y - 1, rx: 4.5, ry: 2.2 }));
  (look.works ?? []).forEach((entry) => blocks.push({ x: entry.x, y: entry.y - 1, rx: 5.5, ry: 2.5 }));
  // Water is gone round; a knoll, a boulder and a trunk too. Flowers, grass and stepping stones are walked over.
  (look.land ?? []).forEach((entry) => {
    const room = LAND_ROOM[entry.kind];
    if (room) blocks.push({ x: entry.x, y: entry.y - room[2], rx: room[0], ry: room[1] });
  });
  if (look.garden !== undefined && look.garden !== null) {
    const [gx, gy] = gardenSpot(look.spots);
    blocks.push({ x: gx, y: gy - 4, rx: 9.5, ry: 4 });
  }
  look.trophies.slice(0, TROPHIES_SHOWN).forEach((_, index) => blocks.push({ x: TROPHY_SPOTS[index][0], y: TROPHY_SPOTS[index][1] - 1, rx: 3, ry: 2 }));
  // The wood at either side, while any of it stands: nobody goes for a walk through it.
  const wood = woodAt(look.clearing ?? look.levels.burrow);
  const left = leftWoodOfLook(look);
  if (left > 0) blocks.push({ x: 0, y: 84, rx: left + 6, ry: 70 });
  if (wood > 0) blocks.push({ x: GAME_W, y: 84, rx: wood + 6, ry: 70 });
  if (look.visitor) blocks.push({ x: HEDGEHOG_AT[0], y: HEDGEHOG_AT[1] - 1, rx: 5, ry: 2.5 });
  return blocks;
};

const onGrass = (x: number, y: number): [number, number] => [Math.max(12, Math.min(GAME_W - 12, x)), Math.max(58, Math.min(GAME_H - 3, y))];

/**
 * The places there are to go in a camp: the door of everything built (and
 * in at some of them), the garden, the things set down to be looked at,
 * the water's edge, and a few spots of open grass. A camp with more in it
 * has more to do in it.
 */
const placesOf = (look: CampLook, blocks: readonly Block[]) => {
  const door = (site: Placed, aside = 0) => onGrass(look.spots[site][0] + aside, look.spots[site][1] + 3);
  const home: Stop = { x: door("burrow")[0], y: door("burrow")[1], act: "idle", rest: 3.4, inside: true };
  const places: Stop[] = [];
  const add = (at: [number, number], act: string, rest: number, inside = false) => places.push({ x: at[0], y: at[1], act, rest, inside });
  // Under the oak she has a nap.
  if (look.levels.oak > 0) add(door("oak", 3), "sleep", 5.5);
  if (look.levels.store > 0) add(door("store"), "idle", 2.8, true);
  if (look.levels.hut > 0) add(door("hut"), "idle", 2.6, true);
  if (look.levels.tower > 0) add(door("tower", -5), "look", 2.2);
  (["yard0", "yard1"] as const).forEach((site, index) => {
    if (look.yard[index]?.kind && look.yard[index].level > 0) add(door(site, 4), index === 0 ? "cheer" : "stretch", 2.2);
  });
  if (look.garden !== undefined && look.garden !== null) {
    const [gx, gy] = gardenSpot(look.spots);
    // The garden is watered, and cheered when something in it is ripe.
    add(onGrass(gx, gy + 3), look.garden === 2 ? "cheer" : "water", 3.2);
  }
  // What is set down is used: a read on the bench, a drink at the pond or the well, a sandwich on the blanket, tea by the fire.
  const USES: Record<number, [string, number]> = { 2: ["read", 4.5], 3: ["hydrate", 3.4], 6: ["hydrate", 3.4], 9: ["sandwich", 3.6], 10: ["tea", 4], 11: ["sunbathe", 5], 13: ["hydrate", 3.4], 14: ["cheer", 2.4], 15: ["booknap", 5] };
  look.decor.slice(0, 8).forEach((entry, index) => {
    const use = USES[entry.kind] ?? [["look", "stretch", "yawn", "look", "cheer", "idle"][index % 6], 2 + (index % 3) * 0.5];
    add(onGrass(entry.x + (index % 2 === 0 ? 7 : -7), entry.y + 1), use[0] as string, use[1] as number);
  });
  (look.land ?? [])
    .filter((entry) => entry.kind <= 1)
    .slice(0, 2)
    // At the water's edge, a drink.
    .forEach((entry) => add(onGrass(entry.x, entry.y + 3), "hydrate", 3.4));
  // Open grass: a few spots of it, wherever nothing stands.
  const seed = Math.round(look.spots.burrow[0] * 7 + look.spots.burrow[1] * 13 + look.decor.length * 31 + look.walls.length * 17 + (look.land?.length ?? 0) * 5);
  const grass: Array<[number, number]> = [];
  const edge = 18 + woodAt(look.clearing ?? look.levels.burrow);
  for (let col = 0; col < 8; col++) for (let row = 0; row < 4; row++) if (28 + col * 26 >= edge && 28 + col * 26 <= GAME_W - edge) grass.push([28 + col * 26, 68 + row * 13]);
  shuffled(grass, seed)
    .filter(([x, y]) => !blocks.some((block) => ((x - block.x) / (block.rx + 4)) ** 2 + ((y - block.y) / (block.ry + 4)) ** 2 < 1))
    .slice(0, 4)
    .forEach((at, index) => add(at, ["idle", "look", "yawn", "stretch"][index % 4], 1.6 + (index % 2) * 0.6));
  return { home, places, seed };
};

/**
 * How long is spent at each stop. A nap, a read, a cup of tea are things
 * done for a good while, not for five seconds and on to the next: a figure
 * forever setting off again looks as if it cannot settle to anything. The
 * things that take time take four times what they were first given, and
 * the rest two and a half.
 */
const SETTLED = new Set(["sleep", "read", "booknap", "sunbathe", "tea", "sandwich", "water"]);
const lingering = (stops: readonly Stop[], by: number): Stop[] => stops.map((stop) => ({ ...stop, rest: stop.rest * (SETTLED.has(stop.act) ? 4 : 2.5) * by }));

const MEADOW_WALKS = new WeakMap<CampLook, Plan>();
type Walks = { blocks: Block[]; pip: Plan; folk: Map<number, Plan> };
/** A camp's rounds, planned once for the camp as it stands: the picture is painted many times a second and the camp does not change between. */
const WALKS = new WeakMap<CampLook, Walks>();
const walksOf = (look: CampLook): Walks => {
  const kept = WALKS.get(look);
  if (kept) return kept;
  const blocks = blocksOf(look);
  const { home, places, seed } = placesOf(look, blocks);
  // Three times round, each in a different order, before the first comes again; and always setting out from her own door.
  const round: Stop[] = [home, ...shuffled(places, seed), home, ...shuffled(places, seed + 1), home, ...shuffled(places, seed + 2)];
  const made: Walks = { blocks, pip: planWalk(lingering(round, 1), blocks), folk: new Map() };
  WALKS.set(look, made);
  return made;
};
/** Seconds Pip takes going in at her door, and coming out of it (as on her rounds), and the most her walk to it may take. */
const DOOR_IN = 0.45;
const ENTER_MOST = 2;
/**
 * Pip going in at the burrow's door when the reader goes in: from wherever
 * her round has her at `since`, round what is in the way to her door, at a
 * brisk walk (never a slide: the walk is capped in time, not sped up past a
 * trot: from the far side of the clearing she runs, her steps as quick as
 * her pace), then in. `total` is how long all of it takes, in seconds.
 */
const ENTRIES = new WeakMap<CampLook, Map<string, unknown>>();
/** Worked out once for a camp and a moment: the picture asks many times a second. */
const once = <T>(look: CampLook, key: string, make: () => T): T => {
  let kept = ENTRIES.get(look);
  if (!kept) ENTRIES.set(look, (kept = new Map()));
  if (!kept.has(key)) kept.set(key, make());
  return kept.get(key) as T;
};
export const pipEntry = (look: CampLook, since: number) => once(look, `in${since}`, () => entryOf(look, since));
const entryOf = (look: CampLook, since: number) => {
  const walks = walksOf(look);
  const from = onWalk(walks.pip, since, PIP_SPEED);
  const door = onGrass(look.spots.burrow[0], look.spots.burrow[1] + 3);
  // Already in (or on her way in): there is only the door to see open.
  const path: Array<[number, number]> = from.shown < 0.5 ? [door] : wayRound([from.x, from.y], door, walks.blocks);
  let long = 0;
  for (let point = 1; point < path.length; point++) long += Math.hypot(path[point][0] - path[point - 1][0], path[point][1] - path[point - 1][1]);
  const walk = long <= 0 ? 0 : Math.min(ENTER_MOST, Math.max(0.35, long / (PIP_SPEED * 1.8)));
  return { path, long, walk, inside: from.shown < 0.5, total: walk + DOOR_IN };
};

/** Where Pip is on her way in, `age` seconds after she set off; and how far open the door is (0 shut, 1 ajar, 2 open). */
export const pipEntering = (entry: ReturnType<typeof pipEntry>, age: number) => {
  const end = entry.path[entry.path.length - 1];
  const door = age >= entry.walk - 0.25 ? (age >= entry.walk - 0.08 && age < entry.total - 0.05 ? 2 : 1) : 0;
  if (age < entry.walk && entry.long > 0) {
    let gone = (age / entry.walk) * entry.long;
    for (let point = 1; point < entry.path.length; point++) {
      const from = entry.path[point - 1];
      const to = entry.path[point];
      const long = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (gone <= long || point === entry.path.length - 1) {
        const along = long > 0 ? Math.min(1, gone / long) : 1;
        // Her steps keep up with her pace: quicker feet, not a glide.
        const pace = Math.max(1, entry.long / entry.walk / PIP_SPEED);
        return { x: from[0] + (to[0] - from[0]) * along, y: from[1] + (to[1] - from[1]) * along, move: "walk", faceLeft: to[0] < from[0], age: age * pace, shown: 1, door };
      }
      gone -= long;
    }
  }
  const inFor = age - entry.walk;
  // (Rounded off at the end: a walk's time and the door's added and taken away again can leave a hair of her showing.)
  const left = 1 - inFor / DOOR_IN;
  return { x: end[0], y: end[1], move: "idle", faceLeft: false, age: inFor, shown: entry.inside || left < 1e-9 ? 0 : left, door };
};

/**
 * Pip coming out of her door when the reader comes out: in the open
 * doorway over a moment, then a walk to wherever her round has her by the
 * time she gets there, so that she goes on with it from there without a
 * jump.
 */
export const pipExit = (look: CampLook, since: number) => once(look, `out${since}`, () => exitOf(look, since));
const exitOf = (look: CampLook, since: number) => {
  const walks = walksOf(look);
  const door = onGrass(look.spots.burrow[0], look.spots.burrow[1] + 3);
  const guess = onWalk(walks.pip, since + DOOR_IN + 1, PIP_SPEED);
  const walk = Math.min(ENTER_MOST, Math.max(0.35, Math.hypot(guess.x - door[0], guess.y - door[1]) / (PIP_SPEED * 1.8)));
  const there = onWalk(walks.pip, since + DOOR_IN + walk, PIP_SPEED);
  const path = wayRound(door, [there.x, there.y], walks.blocks);
  let long = 0;
  for (let point = 1; point < path.length; point++) long += Math.hypot(path[point][0] - path[point - 1][0], path[point][1] - path[point - 1][1]);
  return { path, long, walk, there, total: DOOR_IN + walk };
};

/** Where Pip is on her way out, `age` seconds after the camp came up; and how far open the door is. */
export const pipExiting = (exit: ReturnType<typeof pipExit>, age: number) => {
  const door = age < DOOR_IN ? 2 : age < DOOR_IN + 0.15 ? 1 : 0;
  const start = exit.path[0];
  if (age < DOOR_IN) return { x: start[0], y: start[1], move: "idle", faceLeft: false, age, shown: Math.max(0, age / DOOR_IN), door };
  let gone = Math.min(1, (age - DOOR_IN) / Math.max(0.01, exit.walk)) * exit.long;
  for (let point = 1; point < exit.path.length; point++) {
    const from = exit.path[point - 1];
    const to = exit.path[point];
    const long = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (gone <= long || point === exit.path.length - 1) {
      const along = long > 0 ? Math.min(1, gone / long) : 1;
      return { x: from[0] + (to[0] - from[0]) * along, y: from[1] + (to[1] - from[1]) * along, move: "walk", faceLeft: to[0] < from[0], age: age - DOOR_IN, shown: Math.min(1, exit.there.shown + 1 - Math.min(1, (age - DOOR_IN) / exit.walk)), door };
    }
    gone -= long;
  }
  return { x: start[0], y: start[1], move: "idle", faceLeft: false, age, shown: 1, door };
};

/** One of the camp's people on a round of their own: the same places as Pip has, but not her door, and in an order nobody else has. */
const folkWalk = (look: CampLook, hero: number, index: number): Plan => {
  const walks = walksOf(look);
  const kept = walks.folk.get(hero);
  if (kept) return kept;
  const { places, seed } = placesOf(look, walks.blocks);
  const own = shuffled(places.length > 0 ? places : [{ x: look.spots.hut[0] + 14, y: Math.min(GAME_H - 4, look.spots.hut[1] + 4), act: "idle", rest: 2 }], seed + 101 * (hero + 1) + index * 7);
  const plan = planWalk(lingering(own, 0.7), walks.blocks);
  walks.folk.set(hero, plan);
  return plan;
};

/**
 * Between raids the wood is not empty. Since 1.5.11 everything that comes at
 * the camp comes down one trail out of the Dark Wood, on the left (`front.ts`):
 * by day a lone creeper or runner now and then, and every night a wave of
 * them, so many and of such kinds as the chapter has (the night's chip says
 * who, at dusk). They batter the wall across the trail, or go round a first
 * fence, over it, under it, or (a bomber) through it; and whatever in the camp
 * throws, throws at them while they are within its reach. One who gets to
 * what he came for knocks it about, or makes off with a few acorns, a little
 * and at most so much a day.
 *
 * Each has some health, more in a bigger camp, and it is on a bar over his
 * head. A night is fought out ahead, all of it together (`wave.ts`), and after
 * that the clock says where everyone is.
 */
export const PROWL_EVERY = 8;
export { PROWL_SPEED, SQUAT, offBy, prowlHealth, type Post, type ProwlPlan, type Ring } from "./wave";
export { NIGHT_MOST, countRoles } from "../../../../pip/base/front";
/** The kind of prowler that comes on the wing: a magpie, over everything on the ground until it is brought down or lands. */
const FLIER = 4;
/** Rattlenut the squirrel (a runner), the Rootgnaw (a digger) and Fizzwick (a bomber), by their looks' numbers. */
const SQUIRREL = 5;
const MOLE = 6;
const FIZZER = 7;
/** What they are called, by kind. */
export const PROWLER_NAMES = ["the Mudtusk rabble", "the Gilded", "the Stumbling", "the Frostwights", "magpies", "Rattlenut the squirrel", "the Rootgnaw", "Fizzwick"] as const;
/**
 * Who a kind of book brings out of the wood oftener (by a trophy's kind):
 * the Gilded for fantasy and the classics, Fizzwick for science fiction,
 * the mole for a mystery, magpies for a romance, the Stumbling for horror,
 * the rabble for history, the Frostwights for science, the squirrel for
 * adventures and young readers' books. Three nights in ten, one more of that
 * kind (once its role has come: `front.ts` `waveKinds`).
 */
export const GENRE_FOE: ReadonlyArray<number | null> = [null, 1, FIZZER, MOLE, FLIER, 2, 0, 3, 1, SQUIRREL, SQUIRREL];
/** Where on his way a prowler is, so far along it. */
export const prowlSpot = (plan: Pick<ProwlPlan, "path" | "lens">, far: number) => alongWay(plan.path, plan.lens, far);

/**
 * When in the camp's day the night's prowlers set out (a little after dusk begins), and how: in bands of two at most,
 * a band every `BAND_EVERY` seconds, and the prowlers of a band a moment apart. So a night is a minute or two of bands
 * coming down the trail, and two at a gate batter it down twice as fast as one.
 */
export const NIGHT_FROM = DUSK_AT + 10;
export const NIGHT_EVERY = 1.8;
export const BAND_EVERY = 15;
const BAND_MOST = 2;
/** When the prowler of a night's place in it sets out, in seconds into the night. */
export const setsOutAt = (index: number) => Math.floor(index / BAND_MOST) * BAND_EVERY + (index % BAND_MOST) * NIGHT_EVERY;
/** The night a moment of the camp's clock is in, or the last one before it: its number, from 0. -1 before the first. */
export const nightAt = (clock: number) => Math.floor((clock - NIGHT_FROM) / DAY_SECONDS);
/** When a night's prowlers begin to set out, on the camp's clock. */
export const nightStart = (night: number) => night * DAY_SECONDS + NIGHT_FROM;
/** Whether a lone prowler sets out in a slot of the camp's clock by day: one in sixteen (about one every two minutes; in winter, twice that). */
const daySets = (slot: number, winter = false) => duskAt(slot * PROWL_EVERY) < 0.5 && duskAt(slot * PROWL_EVERY + 60) < 0.5 && (slot % 16 === 3 || (winter && slot % 16 === 11));

type Prowl = {
  x: number;
  y: number;
  faceLeft: boolean;
  age: number;
  kind: number;
  /** His health, and what is left of it. */
  health: number;
  left: number;
  /** Coming out of the wood: how much of him there is to see yet, 0 to 1. */
  fade: number;
  /** In the air just now: drawn above the ground, with his shadow under him. */
  aloft: boolean;
  /** Where he came out of the wood, while the leaves there are still shaking: null after, or where there is no wood to come out of. */
  out: [number, number] | null;
  /** Under the ground just now: all there is to see of him is the earth he heaves up. */
  under: boolean;
  /** Hissing at what he came for, before he goes off: how far through it, 0 to 1; -1 when he is not. */
  fizz: number;
  /** Went off with a pop: what `puff` is the smoke of. */
  pop: boolean;
  /** Whoever is throwing at him from a roof just now: where they stand, which way they face, and how far through the throw. */
  throwers: Array<{ x: number; foot: number; rise: number; left: boolean; frame: number }>;
  /** How far through a swing of his club he is, 0 to 1; -1 when he is not swinging it. */
  swing: number;
  /** Stones on their way to him: where each is from, where it will land, and how far along it is. */
  stones: Array<{ fx: number; fy: number; tx: number; ty: number; along: number; big: boolean }>;
  /** A throw just made: where from, so there is something to see at the thrower. */
  sparks: Array<[number, number]>;
  /** Arrows on their way to him, from the one with the bow. */
  arrows: Array<{ fx: number; fy: number; tx: number; ty: number; along: number }>;
  /** Just hit: he flinches. */
  hit: boolean;
  /** Blades just met, in a fight. */
  clash: boolean;
  /** Seen off: a puff where he was, so many seconds old. He is not drawn. */
  puff: number | null;
  /** At what he came for: laying into it, so many seconds in. */
  rap: number | null;
  /** What he was making for. */
  site: Placed;
};
/**
 * One of the camp who is out fighting: where the fight is and how far they
 * have got towards it (from wherever they were: they are never anywhere
 * suddenly), where he is, and how far through a blow they are.
 */
type Fight = {
  tx: number;
  ty: number;
  /** 0 where they were, 1 at the fight; and back down again when it is over. */
  along: number;
  back: boolean;
  /** Where the one they are fighting is. */
  px: number;
  striking: boolean;
  /** How far through a blow they are, 0 (drawn back) to 1 (through); -1 between blows, with the blade held ready. */
  swing: number;
  /** Shoots from where they stand: a bow, not a blade. */
  ranged: boolean;
  /** They have only just seen him: so many seconds ago. It is said over their head. */
  alert?: number;
  /** They have just seen him off, and stand a moment over it before going home. */
  cheer?: boolean;
};

/** Where a guardian's signpost is (or, for the dragon, her place on the larder's roof): where it was carried to, where it is being carried, or beside their building. */
const postAt = (look: CampLook, guard: number, posting?: CampExtras["posting"]): [number, number] | null => {
  const post = GUARDIANS[guard]?.post;
  if (!post) return null;
  if (post === "store") return [look.spots.store[0] + 3, look.spots.store[1] - PLOT_SIZE.store.h + 10];
  if (posting && posting.guard === guard) return [posting.x, posting.y];
  return postSpotOf(look, guard);
};

/**
 * Where the parcels from the reading are put down: on the path before the
 * burrow's door, a row of three and a second row in front of it. Before the
 * door, because nothing is built there (the burrow's own ground is kept
 * clear), so they are never behind a fence or a building.
 */
export const parcelSpots = (look: CampLook): Array<[number, number]> => {
  const [bx, by] = look.spots.burrow;
  return Array.from({ length: Math.max(0, Math.min(6, look.parcels ?? 0)) }, (_, index): [number, number] => [
    Math.max(8, Math.min(GAME_W - 8, bx - 7 + (index % 3) * 7 + (index >= 3 ? 3 : 0))),
    Math.min(GAME_H - 2, by + 9 + (index >= 3 ? 5 : 0))
  ]);
};
/** Whether there is a parcel at a point of the scene. */
export const parcelAtPoint = (look: CampLook, x: number, y: number) => parcelSpots(look).some(([px, py]) => Math.abs(x - px) <= 5 && y >= py - 8 && y <= py + 3);
/** Where Pip's welcome basket stands: on the path before the door, to the right of the parcels. The middle of its foot. */
export const basketSpot = (look: Pick<CampLook, "spots">): [number, number] => {
  const [bx, by] = look.spots.burrow;
  return [Math.max(8, Math.min(GAME_W - 8, bx + 16)), Math.min(GAME_H - 2, by + 11)];
};
/** Whether the welcome basket is at a point of the scene (generous: it is the thing a new reader is asked to tap). */
export const basketAtPoint = (look: CampLook, x: number, y: number) => {
  if (!look.basket) return false;
  const [px, py] = basketSpot(look);
  return Math.abs(x - px) <= 8 && y >= py - 12 && y <= py + 3;
};
/** The trophy at a point of the scene: which of those standing, or -1. */
export const trophyAtPoint = (look: CampLook, x: number, y: number) =>
  look.trophies.slice(0, TROPHIES_SHOWN).findIndex((_, index) => Math.abs(x - TROPHY_SPOTS[index][0]) <= 5 && y >= TROPHY_SPOTS[index][1] - 12 && y <= TROPHY_SPOTS[index][1] + 3);

/** The guardian at a point of the scene, by their signpost (they do not go far from it); null for none. */
export const guardAtPoint = (look: CampLook, x: number, y: number): number | null => {
  let found: number | null = null;
  (look.guards ?? []).forEach((rank, guard) => {
    if (rank <= 0 || found !== null) return;
    const at = postAt(look, guard);
    if (at && Math.abs(x - at[0]) <= 10 && y >= at[1] - 18 && y <= at[1] + 5) found = guard;
  });
  return found;
};
/** The signpost at a point of the scene, for taking hold of: whose it is, or null. Not the dragon's: she has none. */
export const postAtPoint = (look: CampLook, x: number, y: number): number | null => {
  let found: number | null = null;
  (look.guards ?? []).forEach((rank, guard) => {
    if (rank <= 0 || found !== null || GUARDIANS[guard]?.post === "store") return;
    const at = postAt(look, guard);
    if (at && Math.abs(x - at[0]) <= 5 && y >= at[1] - 14 && y <= at[1] + 2) found = guard;
  });
  return found;
};

/**
 * Who in the camp fights whoever comes near: the guardians. A guardian
 * holds a post: whatever comes within the ground about their signpost is
 * theirs, a blow more for each rank, and they do not leave it for
 * anything. So where the signposts are put matters.
 */
const fightersOf = (look: CampLook): Post[] => {
  const posts: Post[] = [];
  const asleep = look.asleep ?? [];
  (look.guards ?? []).forEach((rank, guard) => {
    if (rank <= 0 || GUARDIANS[guard]?.post === "store" || asleep.includes(guard)) return;
    const at = postAt(look, guard);
    // The ranger has a bow: further off, and from where he stands. The rest go out with a blade.
    if (at) posts.push(guard === 0 ? { who: guard, x: at[0], y: at[1], r: 34, blows: 1 + rank, ranged: true } : { who: guard, x: at[0], y: at[1], r: 20, blows: 1 + rank });
  });
  // (The heroes with a bed in the hut used to run out to prowlers too. Since 2026-10-15 they do not: heroes lead
  // raids and are shown off, guardians hold the camp, and the two are not to be confused.)
  return posts;
};

/**
 * What a prowler makes for. Each kind has its own mind: the rabble are
 * hungry and go for the larder; the Gilded go for what stands tallest,
 * the lookout or the burrow; the Stumbling for whatever is nearest the
 * trail; the Frostwights for the oak, which they cannot abide; the squirrel
 * for the oak too; the mole and the magpie for the larder; Fizzwick for
 * whatever is nearest. And three in ten of any kind are after easy
 * pickings: whatever in the camp the fewest things reach.
 */
/** The kind of prowler the book being read brings oftener, if it brings one. */
const favouredOf = (look: CampLook): number | null => (look.reading === undefined || look.reading === null ? null : (GENRE_FOE[look.reading] ?? null));

const prowlTarget = (look: CampLook, watch: readonly Ring[], kind: number, roll: number): Placed => {
  const from: readonly [number, number] = [frontLine(look), TRAIL_Y];
  const built = PLACED.filter((site) =>
    site === "yard0" ? Boolean(look.yard[0]?.kind) && look.yard[0].level > 0 : site === "yard1" ? Boolean(look.yard[1]?.kind) && look.yard[1].level > 0 : site === "burrow" || look.levels[site as BuildingId] > 0
  );
  const has = (site: Placed) => built.includes(site);
  const posts = fightersOf(look);
  const reached = (site: Placed) => {
    const [x, y] = look.spots[site];
    return watch.filter((ring) => offBy(x - ring.x, y - ring.y) <= ring.r).length + posts.filter((post) => offBy(x - post.x, y - post.y) <= post.r + 6).length;
  };
  if (scatter(roll * 9.77 + 4) < 0.3) return [...built].sort((a, b) => reached(a) - reached(b))[0] ?? "burrow";
  const nearest = () => [...built].sort((a, b) => Math.hypot(look.spots[a][0] - from[0], look.spots[a][1] - from[1]) - Math.hypot(look.spots[b][0] - from[0], look.spots[b][1] - from[1]))[0] ?? "burrow";
  const wanted: Placed = kind === 1 ? (has("tower") ? "tower" : "burrow") : kind === 2 || kind === FIZZER ? nearest() : kind === 3 || kind === SQUIRREL ? "oak" : "store";
  return has(wanted) ? wanted : has("store") ? "store" : "burrow";
};

/** Where the wall's line is: the camp's own, or (a camp from before the front, on a card) where a camp begins. */
const frontLine = (look: CampLook) => look.line ?? LINE_DEFAULT;
/** The wood on the left of a camp's clearing: the Dark Wood never clears. */
export const leftWoodOfLook = (look: Pick<CampLook, "clearing" | "levels">) => darkWood(woodAt(look.clearing ?? look.levels.burrow));

/** The front as the night meets it: what throws (with where each throws from), who is posted, the traps, and the wall. */
const setupOf = (look: CampLook, watch: readonly Ring[]): FrontSetup => {
  const line = frontLine(look);
  const level = look.levels.fence;
  const corwin = Math.min(3, Math.max(0, (look.guards ?? [])[1] ?? 0));
  return {
    watch: watch.map((ring) => {
      // Thrown by somebody, from somewhere: off the roof of a building, or out of the construct itself.
      const rise = ring.site && ring.site in PLOT_SIZE ? PLOT_SIZE[ring.site as Placed].h - 9 : 0;
      return { ...ring, rise, top: ring.y - (rise > 0 ? rise * THINGS + 7 : 12) };
    }),
    posts: fightersOf(look),
    works: look.works ?? [],
    line,
    wall: level > 0,
    all: sectionsAt(level),
    standing: look.walls.filter(([x, y]) => Math.abs(x - wallXAt(line, y)) < 1).map(([, y]) => y),
    gate: look.gate ? TRAIL_Y : null,
    level,
    tough: GUARD_GIVES.fence[corwin] * ((look.animals ?? []).includes(2) ? GOAT_TOUGHER : 1),
    trail: trailOf(leftWoodOfLook(look), line),
    blocks: prowlBlocks(look, null),
    burrow: look.levels.burrow
  };
};
/** A front, as a few words: two that read the same are the same front, and a night goes on as planned. */
const frontKey = (setup: FrontSetup) =>
  JSON.stringify([
    setup.watch.map((ring) => [Math.round(ring.x), Math.round(ring.y), Math.round(ring.r), ring.every ?? 0, ring.hurts ?? 1, ring.work ?? -1]),
    setup.posts.map((post) => [post.who, Math.round(post.x), Math.round(post.y), post.blows]),
    setup.works.map((work) => [work.kind, work.x, work.y]),
    setup.line,
    setup.wall,
    setup.standing,
    setup.level,
    setup.tough
  ]);

/** Who comes on a night of this camp, in order: none before prowlers come, or on a camp's card. */
export const nightKinds = (look: CampLook, night: number): number[] =>
  !look.wave || look.prowlers === false || look.levels.burrow < PROWLERS_FROM || night < 0 ? [] : waveKinds(look.wave.chapter, look.wave.seed, night, look.season % 4 === 2, favouredOf(look));

/**
 * The nights planned in this visit, by the visit's seed and the night's number: who comes (fixed when the night is
 * first wanted), and the front as it stood from each moment of it. A front that changes while the night is on adds a
 * moment, and the night is planned again from it.
 */
const NIGHTS = new Map<string, { walkers: Walker[]; fronts: Array<{ at: number; setup: FrontSetup; key: string }>; plan: NightPlan | null }>();
export const nightPlanOf = (look: CampLook, watch: readonly Ring[], night: number, clock?: number): NightPlan | null => {
  const kinds = nightKinds(look, night);
  if (kinds.length === 0 || !look.wave) return null;
  const name = `${look.wave.seed}|${night}`;
  const setup = setupOf(look, watch);
  const key = frontKey(setup);
  let kept = NIGHTS.get(name);
  // Into the night so far: before it begins, the front is just as it is.
  const into = clock === undefined ? 0 : Math.max(0, Math.round((clock - nightStart(night)) / TICK) * TICK);
  if (!kept) {
    const walkers = kinds.map((kind, index): Walker => {
      const site = prowlTarget(look, watch, kind, night * 31 + index);
      return { kind, start: setsOutAt(index), site, target: look.spots[site], lane: ((index * 3) % 5) - 2 };
    });
    kept = { walkers, fronts: [{ at: 0, setup, key }], plan: null };
    NIGHTS.set(name, kept);
    // Only the nights that may still be watched are kept.
    for (const other of NIGHTS.keys()) if (other.startsWith(`${look.wave.seed}|`) && Number(other.split("|")[1]) < night - 1) NIGHTS.delete(other);
    if (NIGHTS.size > 8) NIGHTS.delete(NIGHTS.keys().next().value as string);
  } else if (kept.fronts[kept.fronts.length - 1].key !== key) {
    if (into <= 0) kept.fronts = [{ at: 0, setup, key }];
    else kept.fronts = [...kept.fronts, { at: Math.max(kept.fronts[kept.fronts.length - 1].at, into), setup, key }];
    kept.plan = null;
  }
  if (!kept.plan) kept.plan = planNight(kept.walkers, kept.fronts, look.wave.seed + night);
  return kept.plan;
};

/** A lone prowler by day, in a slot of the camp's clock: a creeper, or (once they come) a runner. */
const DAYS = new WeakMap<CampLook, Map<number, WalkPlan | null>>();
const dayPlanOf = (look: CampLook, watch: readonly Ring[], slot: number): WalkPlan | null => {
  if (look.prowlers === false || look.levels.burrow < PROWLERS_FROM || slot < 0 || !daySets(slot, look.season % 4 === 2)) return null;
  // The cat: one in ten thinks better of it and stays in the wood.
  if ((look.animals ?? []).includes(1) && scatter(slot * 3.31 + 9.1) < 0.1) return null;
  let plans = DAYS.get(look);
  if (!plans) DAYS.set(look, (plans = new Map()));
  if (plans.has(slot)) return plans.get(slot) ?? null;
  const chapter = look.wave?.chapter ?? 3;
  const favoured = favouredOf(look);
  const creeper = look.season % 4 === 2 ? 3 : favoured === 2 || favoured === 0 ? favoured : 0;
  const kind = chapter >= ROLE_FROM.runner && scatter(slot * 5.9 + 2.2) < 0.35 ? SQUIRREL : creeper;
  const site = prowlTarget(look, watch, kind, slot);
  const plan = planNight([{ kind, start: 0, site, target: look.spots[site], lane: (slot % 5) - 2 }], [{ at: 0, setup: setupOf(look, watch) }], slot).walks[0] ?? null;
  plans.set(slot, plan);
  if (plans.size > 14) for (const old of plans.keys()) if (old < slot - 9) plans.delete(old);
  return plan;
};

/** A walk somebody is on, wherever in the camp's clock it set out: by day (`d` and its slot) or in a night (`n`, the night and his place in it). */
export type Walk = WalkPlan & { id: string; at: number; night: number | null };
/**
 * Everyone who has set out by a moment of the camp's clock and may still be about (or have just been): the day's
 * lone ones and the night's, each with when he set out on the clock.
 */
export const walksAt = (look: CampLook, watch: readonly Ring[], clock: number): Walk[] => {
  const walks: Walk[] = [];
  const now = Math.floor(clock / PROWL_EVERY);
  // A lone walk is never much longer than a minute: those that set out in the last eight slots may still be on it.
  for (let slot = Math.max(0, now - 8); slot <= now; slot++) {
    const walk = dayPlanOf(look, watch, slot);
    if (walk) walks.push({ ...walk, id: `d${slot}`, at: slot * PROWL_EVERY, night: null });
  }
  const night = nightAt(clock);
  for (const n of [night - 1, night]) {
    if (n < 0) continue;
    const plan = nightPlanOf(look, watch, n, clock);
    if (!plan) continue;
    plan.walks.forEach((walk, index) => {
      if (nightStart(n) + walk.start <= clock) walks.push({ ...walk, id: `n${n}.${index}`, at: nightStart(n) + walk.start, night: n });
    });
  }
  return walks;
};
/** The sections of the wall down at a moment of the camp's clock: knocked down in tonight's fight, and not yet mended (at dawn). */
export const wallDownAt = (look: CampLook, watch: readonly Ring[], clock: number): number[] => {
  const night = nightAt(clock);
  if (night < 0) return [];
  const into = clock - nightStart(night);
  // Mended by dawn: the night runs until the day turns.
  if (into > DAWN_AT + TURN_SECONDS - NIGHT_FROM) return [];
  const plan = nightPlanOf(look, watch, night, clock);
  return plan ? plan.breaks.filter((entry) => entry.at <= into).map((entry) => entry.y) : [];
};

/** The prowlers there are about at a moment of the camp's clock, and whoever is out fighting one. */
const prowlsAt = (look: CampLook, watch: readonly Ring[], clock: number): { about: Prowl[]; fights: Map<number, Fight> } => {
  const about: Prowl[] = [];
  const fights = new Map<number, Fight>();
  for (const walk of walksAt(look, watch, clock)) {
    const t = clock - walk.at;
    const farAt = (when: number) => {
      const step = Math.max(0, when / TICK);
      const low = Math.min(walk.fars.length - 1, Math.floor(step));
      const high = Math.min(walk.fars.length - 1, low + 1);
      return walk.fars[low] + (walk.fars[high] - walk.fars[low]) * Math.min(1, step - low);
    };
    const at = (far: number): [number, number] => prowlSpot(walk, far);
    // When it is over for him, one way or the other.
    const end = walk.falls ?? walk.harms ?? walk.there;
    const duel = walk.duel;
    const arrows: Array<{ fx: number; fy: number; tx: number; ty: number; along: number }> = [];
    const [hx, hy] = at(farAt(Math.min(t, end)));
    // Back again takes as long as getting there did: it is as far.
    // Whoever sees him off stands over it a moment, blade up, before going home: a fight that ends has an end.
    const won = duel !== null && !duel.ranged && walk.falls !== null && walk.falls <= duel.until + 0.01;
    const pause = won ? 0.75 : 0;
    if (duel && t >= duel.from && t < Math.min(end, duel.until) + duel.run + pause) {
      const ended = Math.min(end, duel.until);
      const blow = duel.blows.find((when) => t >= when - 0.24 && t < when + 0.12);
      const swing = blow === undefined || t >= ended ? -1 : Math.max(0, Math.min(1, (t - (blow - 0.24)) / 0.36));
      const alert = t - duel.from < 0.55 ? { alert: t - duel.from } : {};
      if (duel.ranged) {
        fights.set(duel.who, { tx: duel.px, ty: duel.py, along: 0, back: false, px: hx, striking: swing >= 0, swing, ranged: true, ...alert });
        for (const when of duel.blows) if (t >= when - 0.25 && t < when && when <= end) arrows.push({ fx: duel.px, fy: duel.py - 10, tx: hx, ty: hy - 7, along: (t - (when - 0.25)) / 0.25 });
      } else {
        // Out to the fight (a pace off him, on the side they came from), at it, and back to whatever they were doing.
        const side = duel.px < duel.x ? -5 : 5;
        const back = Math.max(0, Math.min(1, (t - ended - pause) / duel.run));
        fights.set(duel.who, {
          tx: duel.x + side,
          ty: duel.y,
          along: back > 0 ? 1 - back : Math.min(1, (t - duel.from) / duel.run),
          back: back > 0,
          px: duel.x,
          striking: swing >= 0,
          swing,
          ranged: false,
          ...alert,
          ...(won && t >= ended && t < ended + pause ? { cheer: true } : {})
        });
      }
    }
    const knocking = t >= walk.there && t < end;
    // At a piece of fence, getting over it.
    const breaking = walk.breaks.some(([began, done]) => t >= began && t < done);
    const duelling = Boolean(duel && !duel.ranged && t >= duel.from + duel.run && t < Math.min(end, duel.until));
    const base = {
      // The way he is going just here: his way may turn.
      faceLeft: (() => {
        const far = farAt(Math.min(t, end));
        const ahead = at(Math.min(walk.long, far + 3));
        const behind = at(Math.max(0, far - 3));
        return Math.abs(ahead[0] - behind[0]) > 0.3 ? ahead[0] < behind[0] : walk.ux < 0;
      })(),
      age: t,
      kind: walk.kind,
      health: walk.health,
      left: Math.max(0, walk.health - walk.hurts.filter((when) => when <= t).length),
      fade: Math.min(1, t / 0.8),
      aloft: walk.flies && t < walk.there && !(look.works ?? []).some((work) => work.kind === 0 && offBy(hx - work.x, hy - work.y) <= 34),
      // The trees he came out between shake for a moment (not at the foot of the picture, where there are none; nor for one who came under them).
      out: t < 1.2 && walk.path[0][1] <= GAME_H && walk.rose !== null && walk.rose === 0 ? ([Math.max(3, Math.min(GAME_W - 3, walk.path[0][0])), Math.max(48, Math.min(GAME_H - 6, walk.path[0][1]))] as [number, number]) : null,
      under: walk.rose === null || t < walk.rose,
      fizz: walk.pops && knocking ? Math.min(1, (t - walk.there) / FIZZ_SECONDS) : -1,
      pop: false,
      // Whoever throws is seen to: up on the roof a moment before the stone goes, and a moment after.
      throwers: walk.shots
        .filter((shot) => shot.work === null && shot.rise > 0 && t >= shot.from - 0.4 && t < shot.from + 0.3)
        .map((shot) => ({ x: shot.fx, foot: shot.foot, rise: shot.rise, left: shot.tx < shot.fx, frame: Math.floor(((t - (shot.from - 0.4)) / 0.7) * 4) })),
      // His club comes over every three quarters of a second while he is at something, or somebody.
      swing: knocking || duelling || breaking ? (t % 0.75) / 0.75 : -1,
      // The nest looses arrows; everything else throws stones, and the stone thrower a big one.
      stones: walk.shots
        .filter((shot) => shot.work !== 10 && t >= shot.from && t < shot.lands)
        .map((shot) => ({ fx: shot.fx, fy: shot.fy, tx: shot.tx, ty: shot.ty, along: (t - shot.from) / (shot.lands - shot.from), big: shot.work === 9 })),
      sparks: walk.shots.filter((shot) => shot.work !== null && t >= shot.from && t < shot.from + 0.16).map((shot): [number, number] => [shot.fx, shot.fy]),
      arrows: [...arrows, ...walk.shots.filter((shot) => shot.work === 10 && t >= shot.from && t < shot.lands).map((shot) => ({ fx: shot.fx, fy: shot.fy, tx: shot.tx, ty: shot.ty, along: (t - shot.from) / (shot.lands - shot.from) }))],
      hit: walk.hurts.some((when) => t >= when && t < when + 0.14),
      clash: Boolean(duel && !duel.ranged && duel.blows.some((blow) => t >= blow && t < blow + 0.14)),
      site: walk.site
    };
    if (t < end) about.push({ ...base, x: hx, y: hy, puff: null, rap: knocking ? t - walk.there : null });
    else if (walk.falls !== null) {
      if (t < walk.falls + 0.6) about.push({ ...base, x: hx, y: hy, puff: t - walk.falls, rap: null });
    } else if (walk.pops) {
      // Gone off: there is nothing of him left to walk away.
      if (t < end + 0.8) about.push({ ...base, x: hx, y: hy, puff: t - end, pop: true, rap: null });
    } else {
      // And off again, the way he came and a good deal quicker.
      const back = walk.long - (t - end) * PROWL_SPEED * 1.9;
      if (back < 0) continue;
      const [x, y] = at(back);
      about.push({ ...base, x, y, faceLeft: !base.faceLeft, aloft: walk.flies, out: null, under: false, fizz: -1, throwers: [], swing: -1, stones: [], sparks: [], arrows: [], hit: false, clash: false, puff: null, rap: null });
    }
  }
  return { about, fights };
};

/**
 * The weapon of one who is out fighting, drawn in their hand: a blade held
 * ready, drawn back and brought through with each blow; or a bow, bent and
 * let go. `which` is the blade's picture. Drawn about the hand, so it
 * turns as an arm would.
 */
const armed = (on: CanvasRenderingContext2D, art: GameArt, fight: { swing: number; ranged: boolean }, x: number, y: number, tall: number, which: number, faceLeft: boolean) => {
  const side = faceLeft ? -1 : 1;
  const hx = x + side * 3;
  const hy = y - tall * 0.5;
  if (fight.ranged) {
    // A bow: the stave, the string drawn back as far as the blow has got, and let go at the end of it.
    const drawn = fight.swing < 0 ? 0 : fight.swing < 0.7 ? fight.swing / 0.7 : 0;
    on.fillStyle = "#6e4c2c";
    on.fillRect(Math.round(hx + side * 2), Math.round(hy - 5), 1, 10);
    on.fillRect(Math.round(hx + side), Math.round(hy - 6), 1, 2);
    on.fillRect(Math.round(hx + side), Math.round(hy + 4), 1, 2);
    on.fillStyle = "#f4ead0";
    on.fillRect(Math.round(hx + side - side * drawn * 3), Math.round(hy - 4), 1, 8);
    return;
  }
  const blade = art.sprite("blade", 0, { variant: which });
  // Held up and a little back; drawn further back, then brought down through him.
  const turn = fight.swing < 0 ? -0.5 : -1.5 + fight.swing * 2.9;
  on.save();
  on.translate(hx, hy);
  on.rotate(side * turn);
  if (blade) {
    on.scale(0.7, 0.7);
    on.drawImage(blade.image, -blade.w / 2, -blade.h + 2);
  } else {
    on.fillStyle = "#e8ecff";
    on.fillRect(-0.5, -9, 1, 9);
  }
  on.restore();
};

/** A prowler's club, swung at whatever he is at: held back over his shoulder between blows. */
const club = (on: CanvasRenderingContext2D, x: number, y: number, tall: number, faceLeft: boolean, swing: number) => {
  const side = faceLeft ? -1 : 1;
  on.save();
  on.translate(x + side * 4, y - tall * 0.5);
  on.rotate(side * (swing < 0 ? -0.7 : -1.7 + swing * 3));
  on.fillStyle = "#6e4c2c";
  on.fillRect(-0.5, -8, 1.5, 8);
  on.fillStyle = "#8a6238";
  on.fillRect(-1.5, -11, 3.5, 4);
  on.restore();
};

/** Somebody asleep: it is said over them, small and rising. */
const zzz = (ctx: CanvasRenderingContext2D, x: number, y: number, time: number, strength: number) => {
  ctx.fillStyle = "#e8ecff";
  for (let z = 0; z < 3; z++) {
    const along = (time * 0.3 + z / 3) % 1;
    const zx = Math.round(x + along * 7 + Math.sin(along * 6 + z) * 1.5);
    const zy = Math.round(y - along * 9);
    ctx.globalAlpha = strength * (1 - along) * 0.9;
    const size = z === 0 ? 2 : 3;
    ctx.fillRect(zx, zy, size, 1);
    ctx.fillRect(zx + Math.floor(size / 2), zy + 1, 1, 1);
    ctx.fillRect(zx, zy + 2, size, 1);
  }
  ctx.globalAlpha = 1;
};

/**
 * What the camp's people do when they are standing about. Each is a thing
 * to see, done with something in the hand, and moves by whole pixels: a
 * figure this small that is breathed or leaned by a fraction of one only
 * twitches, and a row of them twitching looks like a row of sneezes.
 */
type Act = "stand" | "rest" | "raise" | "whet" | "scout" | "hop" | "nock" | "whistle" | "sprinkle" | "leaves" | "juggle" | "read" | "flame";
const STAND: readonly Act[] = ["stand"];
/*
 * Nobody swings a blade or looses an arrow at nothing: a blow that has
 * nobody on the end of it looks like a fault in the game, not like
 * practice. A blade comes out for a fight, and is otherwise leant on, or
 * has an edge put on it.
 */
const GUARD_ACTS: ReadonlyArray<readonly Act[]> = [
  // The ranger: a look through the glass, his bow tried, a stand.
  ["scout", "stand", "nock", "stand"],
  // The watchman: leant on his blade, the glass, the stone.
  ["rest", "scout", "whet", "stand"],
  // The one of the oak: leaves about him, and in no hurry.
  ["leaves", "stand", "stand"],
  // The knight: leant on her blade, as a knight on watch is; an edge put on it; a look about.
  ["rest", "stand", "whet", "scout"],
  // The dragon, on her roof: a breath of fire now and then.
  ["flame", "stand", "stand"],
  // The gardener: the can, a look about.
  ["sprinkle", "stand", "scout"],
  // The whistler: a tune, her bow tried, a stand.
  ["whistle", "stand", "nock"]
];
const HERO_ACTS: readonly Act[] = ["juggle", "stand", "read", "scout", "hop", "stand"];
/** Which of their things one of them is doing: the same all through one stop, and another at the next. */
const pickAct = (acts: readonly Act[], began: number, own: number): Act => acts[Math.floor(scatter(Math.round(began * 4) * 0.37 + own * 5.1) * acts.length) % acts.length] ?? "stand";
/** How they hold themselves for it: off the ground, in whole pixels, and which way they are looking. */
const poseOf = (act: Act, age: number) => ({
  hop: act === "hop" && age < 1.3 ? -Math.round(Math.abs(Math.sin((age / 0.65) * Math.PI)) * 3) : 0,
  turned: act === "scout" && Math.floor(age / 1.3) % 2 === 1
});
/** What is in their hand, or about them, while they are at it. */
const props = (on: CanvasRenderingContext2D, art: GameArt, act: Act, age: number, x: number, y: number, tall: number, faceLeft: boolean, which: number) => {
  const side = faceLeft ? -1 : 1;
  const hx = x + side * 3;
  const hy = y - tall * 0.5;
  const cycle = (every: number, own = 0) => ((age / every + own) % 1 + 1) % 1;
  if (act === "rest") {
    // Leant on the blade: its point in the grass in front of them, and both hands on it. Still: it is a rest.
    const blade = art.sprite("blade", 0, { variant: which });
    const long = blade ? (blade.h - 2) * 0.7 : 9;
    on.save();
    on.translate(Math.round(hx + side), Math.round(y - long));
    on.rotate(Math.PI);
    if (blade) {
      on.scale(0.7, 0.7);
      on.drawImage(blade.image, -blade.w / 2, -blade.h + 2);
    } else {
      on.fillStyle = "#e8ecff";
      on.fillRect(-0.5, -9, 1, 9);
    }
    on.restore();
  } else if (act === "raise") {
    // The blade held up, and the light on its point.
    const blade = art.sprite("blade", 0, { variant: which });
    on.save();
    on.translate(hx, hy - 1);
    on.rotate(side * -0.12);
    on.scale(0.7, 0.7);
    if (blade) on.drawImage(blade.image, -blade.w / 2, -blade.h + 2);
    on.restore();
    if (Math.sin(age * 5) > 0.2) {
      on.fillStyle = "#fffbe0";
      on.fillRect(Math.round(hx) - 1, Math.round(hy - 12), 3, 1);
      on.fillRect(Math.round(hx), Math.round(hy - 13), 1, 3);
    }
  } else if (act === "whet") {
    // An edge put on it: the blade across the knee, and sparks off the stone.
    const blade = art.sprite("blade", 0, { variant: which });
    on.save();
    on.translate(hx, hy + 2);
    on.rotate(side * 1.7);
    on.scale(0.7, 0.7);
    if (blade) on.drawImage(blade.image, -blade.w / 2, -blade.h + 2);
    on.restore();
    for (let bit = 0; bit < 3; bit++) {
      const c = cycle(0.45, bit / 3);
      on.fillStyle = bit % 2 === 0 ? "#ffd86b" : "#fff6c2";
      on.globalAlpha = 1 - c;
      on.fillRect(Math.round(hx + side * (4 + c * 5)), Math.round(hy + 3 - c * 4 + c * c * 6), 1, 1);
      on.globalAlpha = 1;
    }
  } else if (act === "scout") {
    // A glass to the eye, one way and then the other.
    const ey = Math.round(y - tall * 0.74);
    on.fillStyle = "#6e4c2c";
    on.fillRect(Math.round(side > 0 ? x + 2 : x - 6), ey, 4, 1);
    on.fillStyle = "#cfe6ff";
    on.fillRect(Math.round(side > 0 ? x + 6 : x - 7), ey, 1, 1);
  } else if (act === "nock") {
    // The bow tried: drawn, held, and let down again without loosing. Nothing is shot at nothing.
    const c = cycle(2.6);
    const drawn = c < 0.3 ? c / 0.3 : c < 0.6 ? 1 : c < 0.8 ? 1 - (c - 0.6) / 0.2 : 0;
    armed(on, art, { swing: drawn * 0.69, ranged: true }, x, y, tall, which, faceLeft);
  } else if (act === "whistle") {
    // A tune: the notes of it going up.
    for (let note = 0; note < 2; note++) {
      const c = cycle(1.4, note * 0.5);
      const nx = Math.round(x + side * 5 + Math.sin(c * 6 + note) * 2);
      const ny = Math.round(y - tall - 1 - c * 8);
      on.globalAlpha = 1 - c;
      on.fillStyle = "#fff6c2";
      on.fillRect(nx, ny, 2, 2);
      on.fillRect(nx + 1, ny - 3, 1, 3);
      on.globalAlpha = 1;
    }
  } else if (act === "sprinkle") {
    // The can, tipped, and the water out of it.
    on.fillStyle = "#8d98a6";
    on.fillRect(Math.round(hx + side), Math.round(hy), 3, 2);
    on.fillStyle = "#7cc4f4";
    for (let drop = 0; drop < 3; drop++) {
      const c = cycle(0.55, drop / 3);
      on.fillRect(Math.round(hx + side * (4 + drop)), Math.round(hy + 2 + c * (tall * 0.45)), 1, 1);
    }
  } else if (act === "leaves") {
    // Leaves going round him, as if he had asked them to.
    for (let leaf = 0; leaf < 4; leaf++) {
      const turn = age * 2.2 + (leaf * Math.PI) / 2;
      on.fillStyle = leaf % 2 === 0 ? "#7cc85a" : "#4e8e3e";
      on.fillRect(Math.round(x + Math.cos(turn) * 8), Math.round(y - tall * 0.5 + Math.sin(turn) * 5), 1, 1);
    }
  } else if (act === "juggle") {
    // Two acorns, up and over.
    for (let nut = 0; nut < 2; nut++) {
      const c = cycle(0.9, nut * 0.5);
      const nx = Math.round(x + (nut === 0 ? -4 + c * 8 : 4 - c * 8));
      const ny = Math.round(y - tall - 1 - Math.sin(c * Math.PI) * 7);
      on.fillStyle = "#b9773a";
      on.fillRect(nx, ny, 2, 2);
      on.fillStyle = "#6e4c2c";
      on.fillRect(nx, ny - 1, 2, 1);
    }
  } else if (act === "read") {
    // A book, open, and a page turned now and then.
    on.fillStyle = "#f4ead0";
    on.fillRect(Math.round(hx - 2), Math.round(hy), 5, 3);
    on.fillStyle = "#8a5a34";
    on.fillRect(Math.round(hx), Math.round(hy), 1, 3);
    if (cycle(2.4) > 0.9) {
      on.fillStyle = "#ffffff";
      on.fillRect(Math.round(hx + 1), Math.round(hy - 1), 2, 1);
    }
  } else if (act === "flame") {
    // A breath of fire, out and gone.
    const c = cycle(4);
    if (c < 0.22) {
      const out = c / 0.22;
      for (let lick = 0; lick < 5; lick++) {
        on.fillStyle = lick % 2 === 0 ? "#ffb03a" : "#ff7a2a";
        on.globalAlpha = 1 - out * 0.7;
        on.fillRect(Math.round(x + side * (6 + out * 9 + lick)), Math.round(y - tall * 0.55 + Math.sin(lick * 2 + out * 6) * 1.5), 2, 1);
        on.globalAlpha = 1;
      }
    }
  }
};

/**
 * A building a prowler has got to, as it looks for it: its own picture
 * with soot on it, cracks down it and, from the second knock, boards
 * nailed across. Drawn onto the picture's own pixels only, so nothing
 * falls outside the building, and kept, so it is made once for each
 * picture and each number of knocks and not at every frame.
 */
const WORN = new WeakMap<object, Map<number, CanvasImageSource>>();
const damaged = (image: CanvasImageSource, w: number, h: number, harm: number): CanvasImageSource => {
  let kept = WORN.get(image as object);
  if (!kept) WORN.set(image as object, (kept = new Map()));
  const have = kept.get(harm);
  if (have) return have;
  if (typeof document === "undefined") return image;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(30, 22, 18, ${(0.12 + harm * 0.06).toFixed(2)})`;
  for (let patch = 0; patch < harm * 2; patch++) blot(ctx, scatter(patch * 3.1 + w) * w, h * (0.25 + scatter(patch * 5.7 + h) * 0.6), 3 + harm, 2 + Math.floor(harm / 2));
  ctx.fillStyle = "rgba(36, 24, 18, 0.85)";
  for (let crack = 0; crack <= harm; crack++) {
    let x = Math.round(w * (0.2 + scatter(crack * 7.3 + harm) * 0.6));
    let y = Math.round(h * (0.2 + scatter(crack * 2.9 + 1) * 0.3));
    for (let step = 0; step < 5 + harm * 2; step++) {
      ctx.fillRect(x, y, 1, 1);
      y += 1;
      x += scatter(crack * 11 + step * 1.7) < 0.35 ? -1 : scatter(crack * 13 + step * 2.3) > 0.65 ? 1 : 0;
    }
  }
  if (harm >= 2) {
    for (let board = 0; board < harm - 1; board++) {
      const bx = Math.round(w * (0.28 + scatter(board * 4.1 + 9) * 0.3));
      const by = Math.round(h * (0.5 + scatter(board * 6.3 + 2) * 0.25));
      for (let step = 0; step < 8; step++) {
        const dy = board % 2 === 0 ? Math.floor(step / 3) : -Math.floor(step / 3);
        ctx.fillStyle = "#b98a52";
        ctx.fillRect(bx + step, by + dy, 1, 2);
        ctx.fillStyle = "#8a6238";
        ctx.fillRect(bx + step, by + dy + 1, 1, 1);
      }
    }
  }
  if (harm >= 4) {
    // Broken: the top of it has come down (a ragged line where the roof or the crown was), what is left is dark, and
    // there is rubble at its foot. Not "a little the worse": nobody should have to ask whether it still works.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let x = 0; x < w; x++) {
      const gone = Math.round(h * (0.2 + scatter(x * 1.7 + w) * 0.22 + (Math.abs(x - w / 2) / w) * 0.12));
      ctx.fillRect(x, 0, 1, gone);
    }
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(28, 20, 16, 0.4)";
    ctx.fillRect(0, 0, w, h);
    for (let bit = 0; bit < 9; bit++) {
      ctx.fillStyle = bit % 3 === 0 ? "#8a857a" : bit % 3 === 1 ? "#5e574c" : "#a0947e";
      ctx.fillRect(Math.round(scatter(bit * 2.3 + h) * (w - 2)), h - 1 - Math.round(scatter(bit * 4.1 + w) * 3), 2, 1);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  kept.set(harm, canvas);
  return canvas;
};

/** Light on the night: a soft round glow, a ring at a time, added to what is under it. */
const glow = (ctx: CanvasRenderingContext2D, x: number, y: number, wide: number, strength: number, colour = "255, 206, 120") => {
  if (strength <= 0.01) return;
  const before = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  for (let ring = 4; ring >= 1; ring--) {
    ctx.fillStyle = `rgba(${colour}, ${(0.1 * strength).toFixed(3)})`;
    const r = (wide * ring) / 4;
    blot(ctx, x, y, r, Math.max(1, Math.round(r * 0.8)));
  }
  ctx.globalCompositeOperation = before;
};

/** Draws a picture turned to face left, where it stands. */
/** Run from one place to another, how many strides have been taken: one for every two and a half pixels of ground, so that feet and ground agree. */
const stridesOf = (from: { x: number; y: number }, fight: Fight) => Math.floor((Math.hypot(fight.tx - from.x, fight.ty - from.y) * fight.along) / 2.5);
/**
 * Birds over the far trees, by day: a pair of them across the sky every
 * so often, one way and then the other. Nothing depends on them; a sky
 * that nothing ever crosses is a painted one.
 */
const birds = (ctx: CanvasRenderingContext2D, clock: number, sky: number, strength: number) => {
  const EVERY = 23;
  const OVER = 10;
  const turn = ((clock % EVERY) + EVERY) % EVERY;
  if (turn > OVER) return;
  const pass = Math.floor(clock / EVERY);
  const leftward = pass % 2 === 1;
  const along = turn / OVER;
  const high = 8 + (pass % 3) * 3 - Math.min(sky, 24) * 0.5;
  ctx.fillStyle = `rgba(58, 63, 85, ${(0.8 * strength).toFixed(3)})`;
  for (let bird = 0; bird < 2 + (pass % 2); bird++) {
    const x = Math.round((leftward ? GAME_W + 8 - along * (GAME_W + 16) : -8 + along * (GAME_W + 16)) + (leftward ? 1 : -1) * bird * 6);
    const y = Math.round(high + bird * 2 + Math.sin(along * 9 + bird) * 1.5);
    // Wings up, wings down.
    const up = Math.floor(clock * 5 + bird * 0.5) % 2 === 0;
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x - 1, y + (up ? -1 : 0), 1, 1);
    ctx.fillRect(x + 1, y + (up ? -1 : 0), 1, 1);
    if (up) {
      ctx.fillRect(x - 2, y - 1, 1, 1);
      ctx.fillRect(x + 2, y - 1, 1, 1);
    }
  }
};

/** Fireflies over the grass by night, each going its own slow way and coming and going; and a glint on any water, by day or night. */
const smallLights = (ctx: CanvasRenderingContext2D, look: CampLook, time: number, dusk: number) => {
  if (dusk > 0.55) {
    for (let fly = 0; fly < 8; fly++) {
      const lit = Math.max(0, Math.sin(time * (0.9 + (fly % 3) * 0.25) + fly * 1.7)) ** 2 * ((dusk - 0.55) / 0.45);
      if (lit < 0.08) continue;
      const x = Math.round(24 + scatter(fly * 3.1) * (GAME_W - 48) + Math.sin(time * 0.31 + fly * 2.3) * 9);
      const y = Math.round(66 + scatter(fly * 5.7) * 44 + Math.cos(time * 0.23 + fly) * 4);
      ctx.fillStyle = `rgba(246, 255, 176, ${(lit * 0.22).toFixed(3)})`;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = `rgba(246, 255, 176, ${lit.toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  (look.land ?? []).forEach((entry, index) => {
    if (entry.kind > 1) return;
    // One glint at a time, somewhere on it, for a quarter of a second in every two and a bit.
    const every = 2.3 + (index % 3) * 0.4;
    const phase = (time + index * 0.9) % every;
    if (phase > 0.28) return;
    const pick = Math.floor((time + index * 0.9) / every);
    const half = entry.kind === 0 ? 8 : 11;
    const x = Math.round(entry.x + (scatter(pick * 1.3 + index) - 0.5) * half * 1.4);
    const y = Math.round(entry.y - (entry.kind === 0 ? 8 : 10) + (scatter(pick * 2.9 + index) - 0.5) * 5);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(x - 1, y, 3, 1);
    ctx.fillRect(x, y - 1, 1, 3);
  });
};

/** What has just happened somewhere, seen: bits flying out from it, and a figure going up. */
const floatsOf = (ctx: CanvasRenderingContext2D, floats: NonNullable<CampExtras["floats"]>) => {
  for (const float of floats) {
    if (float.age < 0.45) {
      const spread = float.age / 0.45;
      ctx.globalAlpha = 1 - spread;
      for (let bit = 0; bit < 7; bit++) {
        const turn = (bit / 7) * Math.PI * 2 + 0.4;
        ctx.fillStyle = float.bad ? (bit % 2 === 0 ? "#ff8f80" : "#ffd0c8") : bit % 2 === 0 ? "#ffd84a" : "#fffbe0";
        ctx.fillRect(Math.round(float.x + Math.cos(turn) * (2 + spread * 8)), Math.round(float.y - 3 + Math.sin(turn) * (1 + spread * 5)), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (!float.text) continue;
    // Up, quickly at first and then slower; gone by a second and a third.
    const up = 1 - (1 - Math.min(1, float.age / 1.3)) ** 2;
    const x = float.x;
    const y = float.y - 7 - up * 11;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (1.3 - float.age) / 0.35));
    ctx.font = '700 7px "ZT Nature", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#2a2016";
    for (const [dx, dy] of [[-0.6, 0], [0.6, 0], [0, -0.6], [0, 0.6]]) ctx.fillText(float.text, x + dx, y + dy);
    ctx.fillStyle = float.bad ? "#ff9d8f" : "#ffe08a";
    ctx.fillText(float.text, x, y);
    ctx.restore();
  }
};

/** "!" over the head of whoever has just seen a prowler: up it comes, and is gone in half a second. */
const alertMark = (on: CanvasRenderingContext2D, x: number, top: number, age: number) => {
  const rise = Math.min(3, Math.round(age * 16));
  const left = Math.round(x) - 1;
  const y = Math.round(top) - 5 - rise;
  on.fillStyle = "#2a2016";
  on.fillRect(left - 1, y - 1, 3, 8);
  on.fillStyle = "#ffd84a";
  on.fillRect(left, y, 1, 4);
  on.fillRect(left, y + 5, 1, 1);
};

/** What a runner's feet throw up behind them: a bit of dust at each footfall. */
const dust = (on: CanvasRenderingContext2D, x: number, y: number, faceLeft: boolean, stride: number) => {
  const back = faceLeft ? 1 : -1;
  on.fillStyle = "rgba(244, 236, 204, 0.75)";
  on.fillRect(Math.round(x + back * (4 + (stride % 2) * 2)), Math.round(y - 1 - (stride % 2)), 1, 1);
  on.fillStyle = "rgba(244, 236, 204, 0.4)";
  on.fillRect(Math.round(x + back * (7 + (stride % 3))), Math.round(y - 2 - (stride % 2)), 1, 1);
};

const turned = (ctx: CanvasRenderingContext2D, image: CanvasImageSource, w: number, left: number, top: number) => {
  ctx.save();
  ctx.translate(left + w, top);
  ctx.scale(-1, 1);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
};

/** Where the meadow's animals go between: a round each, spread about the grass. */
const MEADOW_STOPS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[40, 96], [92, 108], [70, 84], [28, 110]],
  [[150, 100], [118, 86], [176, 112], [204, 94]],
  [[96, 76], [140, 78], [186, 74], [120, 96]],
  [[214, 70], [200, 70], [214, 70], [222, 72]],
  [[60, 70], [24, 82], [110, 112], [168, 88]],
  [[130, 112], [160, 114], [196, 112], [100, 114]]
];

/** Where each of the meadow's animals is at a time, and which way it faces: for drawing them, and for finding the one under a finger. */
export const animalSpots = (time: number | null, animals: readonly number[]) =>
  animals.map((animal, index) => {
    const stops = MEADOW_STOPS[animal % MEADOW_STOPS.length];
    // The tortoise is in no hurry, and the owl mostly sits.
    const pace = animal === 5 ? 0.25 : animal === 3 ? 0.4 : 0.75;
    const now = time === null ? { x: stops[0][0], y: stops[0][1], move: "idle", faceLeft: index % 2 === 1, age: 0 } : pipRounds(time * pace + animal * 9.1, stops);
    return { animal, x: now.x, y: now.y, walking: now.move === "walk", faceLeft: now.faceLeft, age: now.age };
  });

/** The animal under a point of the meadow, the nearest the front first; null for none. */
export const animalAt = (time: number | null, animals: readonly number[], x: number, y: number): { animal: number; x: number; y: number } | null => {
  const found = animalSpots(time, animals)
    .filter((spot) => Math.abs(x - spot.x) <= 9 * THINGS && y >= spot.y - 15 * THINGS && y <= spot.y + 2)
    .sort((a, b) => b.y - a.y)[0];
  return found ? { animal: found.animal, x: found.x, y: found.y } : null;
};

/**
 * The meadow: the camp's second clearing, where the animals live and there
 * is room to set things down. It is the same wood seen from the other side
 * (the camp's own backdrop, turned about), so it is the same place and
 * plainly not the same spot. Nothing is built here and the magpies do not
 * come: it is somewhere to make nice.
 */
const paintMeadow = (ctx: CanvasRenderingContext2D, art: GameArt, look: CampLook, frame: number, extras: CampExtras) => {
  const px = Math.max(1, Math.round(extras.px ?? 1));
  const snap = snapper(px);
  const time = extras.time ?? null;
  const dusk = Math.max(0, Math.min(1, extras.dusk ?? (look.night ? 1 : 0)));
  const night = dusk >= 0.5;
  ctx.save();
  ctx.translate(GAME_W, 0);
  ctx.scale(-1, 1);
  const ground = backdrop(ctx, art, look.season, frame, dusk);
  ctx.restore();
  if (!ground) {
    ctx.fillStyle = night ? "#3c6a5a" : "#7fbf6a";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  }
  const things = look.meadow ?? [];
  inLight(
    ctx,
    dusk,
    (on) => {
      const standing: Standing[] = [];
      layLand(on, art, look.meadowLand ?? [], time, standing, px);
      if (extras.setting) {
        const setting = extras.setting;
        standing.push({ y: setting.y, x: setting.x, draw: () => ghost(on, art, setting, frame) });
      }
      things.forEach((entry) =>
        standing.push({
          y: entry.y,
          x: entry.x,
          shade: 5,
          draw: () => {
            const sprite = art.sprite("decor", frame, { variant: entry.kind });
            if (sprite) on.drawImage(sprite.image, Math.round(entry.x - sprite.w / 2), Math.round(entry.y - sprite.h));
          }
        })
      );
      for (const spot of animalSpots(time, look.animals ?? [])) {
        // A spring in the step for the ones that walk; the owl hops.
        const hop = spot.walking ? -Math.abs(Math.sin(spot.age * (spot.animal === 3 ? 5 : 9))) * (spot.animal === 3 ? 3 : 1) : 0;
        standing.push({
          y: spot.y,
          x: spot.x,
          shade: 5,
          draw: () => {
            const sprite = art.sprite("animal", spot.walking ? Math.floor(spot.age * (spot.animal === 5 ? 3 : 7 + spot.animal)) : 0, { variant: spot.animal });
            if (!sprite) {
              on.fillStyle = "#f4ead0";
              on.fillRect(snap(spot.x - 4), snap(spot.y - 6 + hop), 8, 6);
              return;
            }
            const left = snap(spot.x - sprite.w / 2);
            const top = snap(spot.y - sprite.h + 1 + hop);
            if (spot.faceLeft) turned(on, sprite.image, sprite.w, left, top);
            else on.drawImage(sprite.image, left, top);
          }
        });
      }
      if (extras.placing) {
        const { kind, x, y } = extras.placing;
        standing.push({
          y,
          x,
          draw: () => {
            on.globalAlpha = 0.75;
            const sprite = art.sprite("decor", frame, { variant: kind });
            if (sprite) on.drawImage(sprite.image, Math.round(x - sprite.w / 2), Math.round(y - sprite.h));
            on.globalAlpha = 1;
          }
        });
      }
      if (extras.pip && time !== null) {
        // Pip is out here as well, seeing to the animals: a pat, a look, something from the can.
        let plan = MEADOW_WALKS.get(look);
        if (!plan) {
          const blocks: Block[] = things.map((entry) => ({ x: entry.x, y: entry.y - 1, rx: 4.5, ry: 2.2 }));
          const stops: Stop[] = [
            { x: 60, y: 96, act: "pet", rest: 3 },
            { x: 122, y: 84, act: "look", rest: 2.4 },
            { x: 184, y: 100, act: "water", rest: 3.2 },
            { x: 100, y: 110, act: "cheer", rest: 2.2 },
            { x: 204, y: 80, act: "pet", rest: 3 }
          ];
          plan = planWalk(stops, blocks);
          MEADOW_WALKS.set(look, plan);
        }
        const now = onWalk(plan, time, PIP_SPEED);
        const hop = now.move === "walk" ? -Math.abs(Math.sin(now.age * 9)) * 1.4 : 0;
        standing.push({
          y: now.y,
          x: now.x,
          small: PIP_SMALL,
          shade: 7,
          draw: () => {
            const sprite = art.pip(now.move, Math.floor(now.age * ART_FPS));
            const left = snap(now.x - sprite.w / 2);
            const top = snap(now.y - 30 + hop);
            if (now.faceLeft) turned(on, sprite.image, sprite.w, left, top);
            else on.drawImage(sprite.image, left, top);
          }
        });
      }
      drawAll(on, standing, px, dusk);
    },
    px
  );
  if (time !== null) {
    if (night) fireflies(ctx, time, snap);
    else drift(ctx, look.season, time, snap);
  }
  // An animal just petted: a heart goes up from it.
  if (extras.petted && extras.petted.age < 0.9) {
    const heart = art.sprite("heart", frame);
    ctx.globalAlpha = Math.max(0, 1 - extras.petted.age / 0.9);
    const x = snap(extras.petted.x - 3);
    const y = snap(extras.petted.y - 18 - extras.petted.age * 14);
    if (heart) ctx.drawImage(heart.image, x, y);
    else {
      ctx.fillStyle = "#e2557a";
      ctx.fillRect(x, y, 5, 4);
    }
    ctx.globalAlpha = 1;
  }
  const bob = time === null ? null : snap(Math.sin(time * 3.4) * 1.6);
  const chosen = extras.selectedDecor !== undefined && extras.selectedDecor >= 0 ? things[extras.selectedDecor] : null;
  if (chosen) marker(ctx, chosen.x, chosen.y - 18 * THINGS, frame, bob);
  if (extras.mark) marker(ctx, extras.mark.x, extras.mark.y - extras.mark.up * THINGS, frame, bob);
};

/**
 * Draws a thing of two pictures without ever flipping between them: the
 * first is held, and the second is faded up over it and down again, slowly,
 * each thing in its own time. `every` is how many seconds one such breath
 * takes; 0 (or no clock) holds the first picture and nothing more.
 */
const eased = (on: CanvasRenderingContext2D, art: GameArt, name: string, variant: number, x: number, y: number, time: number | null, every: number, own: number) => {
  const still = art.sprite(name, 0, { variant });
  if (!still) return;
  const left = Math.round(x - still.w / 2);
  const top = Math.round(y - still.h);
  on.drawImage(still.image, left, top);
  if (time === null || every <= 0) return;
  const other = art.sprite(name, 1, { variant });
  if (!other) return;
  // A smooth rise and fall, with a good share of the time spent at rest at either end.
  const wave = (Math.sin((time / every) * Math.PI * 2 + own * 2.4) + 1) / 2;
  const before = on.globalAlpha;
  on.globalAlpha = before * wave * wave * (3 - 2 * wave);
  on.drawImage(other.image, left, top);
  on.globalAlpha = before;
};

/** How long a breath of each piece of landscape takes: water and grass slowly, trees slower, stone not at all. */
const LAND_EVERY = [5, 6, 0, 0, 7, 0, 0, 0, 4, 7];
/** The same for the constructs: a ward's glow comes and goes, smoke shifts; a hedge and a thumper are still until there is a fight. */
const WORK_EVERY = [6, 0, 0, 3.5, 0, 1.8, 0, 0, 2.6, 0, 1.2, 2.4];

/** Landscape: the flat pieces are drawn on the ground at once; the standing ones are handed back to be drawn in their place among everything else. */
const layLand = (on: CanvasRenderingContext2D, art: GameArt, land: readonly Decor[], time: number | null, standing: Standing[], px = 1) => {
  const small = smallAt(px);
  land.forEach((entry, index) => {
    const put = () => eased(on, art, "land", entry.kind, entry.x, entry.y, time, LAND_EVERY[entry.kind] ?? 0, index + entry.x);
    if (SCENERY[entry.kind]?.flat) {
      on.save();
      on.translate(entry.x, entry.y);
      on.scale(small, small);
      on.translate(-entry.x, -entry.y);
      put();
      on.restore();
    } else standing.push({ y: entry.y, x: entry.x, shade: 6, draw: put });
  });
};

/** A thing being set down that is not a decoration: drawn pale where the pointer is. */
const ghost = (on: CanvasRenderingContext2D, art: GameArt, setting: NonNullable<CampExtras["setting"]>, frame: number) => {
  const sprite = art.sprite(setting.sprite, frame, { variant: setting.kind });
  on.globalAlpha = 0.75;
  if (sprite) on.drawImage(sprite.image, Math.round(setting.x - sprite.w / 2), Math.round(setting.y - sprite.h));
  on.globalAlpha = 1;
};

/** Paints a camp. */
/** The burrow's door in its picture, by the burrow's level (as `base-art.js` draws it): how wide either side of the middle, and how tall. */
const DOOR_RX = [4, 4, 5, 5, 5];
const DOOR_RY = [7, 7, 8, 9, 9];
/**
 * Over the burrow's own picture (in its pixels, where it is drawn): its
 * door ajar or open, dark inside with the lamplight on the floor, and the
 * glow round it that says it can be gone in at. The glow is a ring of
 * whole pixels that only grows brighter and fainter; nothing moves.
 */
const burrowDoor = (on: CanvasRenderingContext2D, spot: Spot, level: number, open: number, glow: number) => {
  if (open <= 0 && glow <= 0) return;
  const n = Math.max(1, Math.min(5, level));
  const rx = DOOR_RX[n - 1];
  const ry = DOOR_RY[n - 1];
  const cx = Math.round(spot[0] - 24) + 24;
  const foot = Math.round(spot[1] - 40) + 38;
  const half = (row: number) => (row >= ry ? 0 : Math.max(1, Math.round(rx * Math.sqrt(1 - ((row + 0.5) / ry) ** 2))));
  if (open > 0) {
    for (let row = 0; row < ry; row++) {
      const wide = half(row);
      // Ajar, the door has swung in on its left-hand hinge: the dark is the right of it.
      const from = open >= 2 ? -wide : 0;
      on.fillStyle = row === 0 ? "#8a5a2c" : "#24160c";
      on.fillRect(cx + from, foot - row, wide - from, 1);
    }
    if (open === 1) {
      on.fillStyle = "#c8955a";
      // The door's own edge, turned to us.
      on.fillRect(cx - 1, foot - ry + 2, 1, ry - 2);
    }
  }
  if (glow > 0) {
    const ring = (by: number, alpha: number) => {
      on.fillStyle = `rgba(255, 210, 63, ${alpha.toFixed(3)})`;
      for (let row = 0; row < ry; row++) {
        const wide = half(row);
        on.fillRect(cx - wide - by, foot - row, 1, 1);
        on.fillRect(cx + wide - 1 + by, foot - row, 1, 1);
      }
      on.fillRect(cx - half(ry - 1) - by + 1, foot - ry + 1 - by, half(ry - 1) * 2 + by * 2 - 2, 1);
    };
    ring(1, glow);
    ring(2, glow * 0.4);
  }
};

// ---- the front, drawn (1.5.11): the Dark Wood, its trail, the trail's mouth --------------------------------------

/** A tree of the Dark Wood: the camp's own kinds of tree, in the wood's own dark (kept, a picture at a time). */
const DARKS = new WeakMap<object, CanvasImageSource>();
const darkened = (image: CanvasImageSource, w: number, h: number): CanvasImageSource => {
  const kept = DARKS.get(image as object);
  if (kept) return kept;
  if (typeof document === "undefined") return image;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(14, 18, 36, 0.62)";
  ctx.fillRect(0, 0, w, h);
  DARKS.set(image as object, canvas);
  return canvas;
};
const darkTree = (on: CanvasRenderingContext2D, art: GameArt, kind: number, x: number, y: number) => {
  const still = art.sprite("land", 0, { variant: kind });
  if (!still) return;
  on.drawImage(darkened(still.image, still.w, still.h), Math.round(x - still.w / 2), Math.round(y - still.h));
};

/** The trail's earth by the season (summer, autumn, winter, spring): its middle, its edges, and a fleck. */
const TRAIL_TONES: ReadonlyArray<readonly [string, string, string]> = [
  ["#b8925c", "#957043", "#d2b07a"],
  ["#a8804e", "#86603a", "#c98a3c"],
  ["#d6dbe3", "#aeb6c4", "#8d7a66"],
  ["#93704a", "#735536", "#6f8f4a"]
];
const TRAILS = new Map<string, HTMLCanvasElement | null>();
/**
 * The trail on the ground: worn earth from out of the Dark Wood to the wall, and a fainter track on through the gate
 * to the burrow's door. Drawn once for a camp as it stands, and kept.
 */
const paintTrail = (on: CanvasRenderingContext2D, look: CampLook) => {
  if (look.levels.burrow < PROWLERS_FROM) return;
  const line = frontLine(look);
  const left = leftWoodOfLook(look);
  const season = ((look.season % 4) + 4) % 4;
  const [bx, by] = look.spots.burrow;
  const key = `${line}|${left}|${season}|${bx}|${by}|${look.levels.fence > 0 ? 1 : 0}`;
  if (!TRAILS.has(key)) {
    if (TRAILS.size > 12) TRAILS.clear();
    TRAILS.set(key, typeof document === "undefined" ? null : drawTrail(line, left, season, [bx, by]));
  }
  const canvas = TRAILS.get(key);
  if (canvas) on.drawImage(canvas, 0, 0);
};
const drawTrail = (line: number, left: number, season: number, burrow: readonly [number, number]): HTMLCanvasElement | null => {
  const canvas = document.createElement("canvas");
  canvas.width = GAME_W;
  canvas.height = GAME_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [middle, edge, fleck] = TRAIL_TONES[season];
  const trail = trailOf(left, line);
  // The track on from the gate to the door: the camp's own, fainter.
  const inside: Array<readonly [number, number]> = [
    [line, TRAIL_Y],
    [line + 14, TRAIL_Y + 2],
    [burrow[0] - 4, burrow[1] + 7]
  ];
  const lay = (path: ReadonlyArray<readonly [number, number]>, half: number, colour: string, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    for (let at = 1; at < path.length; at++) {
      const [ax, ay] = path[at - 1];
      const [bxx, byy] = path[at];
      const steps = Math.max(1, Math.ceil(Math.hypot(bxx - ax, byy - ay)));
      for (let step = 0; step <= steps; step++) {
        const x = Math.round(ax + ((bxx - ax) * step) / steps);
        const y = Math.round(ay + ((byy - ay) * step) / steps);
        // An oval a row at a time: the ground is seen from a slant.
        for (let row = -Math.ceil(half * SQUAT); row <= Math.ceil(half * SQUAT); row++) {
          const wide = Math.round(half * Math.sqrt(Math.max(0, 1 - (row / (half * SQUAT + 0.5)) ** 2)));
          ctx.fillRect(x - wide, y + row, wide * 2 + 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  };
  lay(trail, 6, edge, 0.85);
  lay(trail, 4.5, middle, 0.95);
  lay(inside, 3.5, edge, 0.45);
  lay(inside, 2.5, middle, 0.5);
  // Footprints and grit, the same every time for the same trail.
  ctx.fillStyle = fleck;
  for (let k = 0; k < 40; k++) {
    const x = Math.round(scatter(k * 4.7 + line) * line);
    const y = Math.round(trailYAtLook(trail, x) + (scatter(k * 2.3 + left) - 0.5) * 6);
    ctx.fillRect(x, y, scatter(k * 1.9) < 0.5 ? 1 : 2, 1);
  }
  return canvas;
};
/** Up the picture, where the trail is at a point across it. */
const trailYAtLook = (trail: ReadonlyArray<readonly [number, number]>, x: number) => {
  for (let at = 1; at < trail.length; at++) {
    const [ax, ay] = trail[at - 1];
    const [bx, by] = trail[at];
    if (x <= bx || at === trail.length - 1) return ay + (by - ay) * (bx === ax ? 1 : Math.max(0, Math.min(1, (x - ax) / (bx - ax))));
  }
  return TRAIL_Y;
};

/**
 * The trail's mouth: where it comes out of the Dark Wood, a dark hollow between two gnarled trunks, brambles either
 * side of the way, and a crooked post with a warning on it (an acorn, struck through). Drawn among everything that
 * stands, by its foot.
 */
const trailMouth = (on: CanvasRenderingContext2D, look: CampLook) => {
  const x0 = Math.round(leftWoodOfLook(look));
  const y0 = MOUTH_Y + 1;
  // The hollow: the way going on into the dark under the trees, an arch with the dark deepest at its heart.
  for (let row = 0; row < 15; row++) {
    const up = 15 - row;
    const wide = Math.round(Math.min(7, 2 + row * 0.55)) + (row > 11 ? 1 : 0);
    const middle = x0 - 6 - Math.round(row * 0.15);
    on.fillStyle = "#2b2236";
    on.fillRect(middle - wide, y0 - up, wide * 2 + 1, 1);
    if (wide > 2) {
      on.fillStyle = row > 4 ? "#120d19" : "#1b1424";
      on.fillRect(middle - wide + 2, y0 - up, wide * 2 - 3, 1);
    }
  }
  // Gnarled roots and trunks either side, leaning in.
  on.fillStyle = "#2b2219";
  on.fillRect(x0 - 15, y0 - 10, 2, 11);
  on.fillRect(x0 - 14, y0 - 14, 2, 5);
  on.fillRect(x0 - 12, y0 - 17, 2, 4);
  on.fillRect(x0 + 1, y0 - 9, 2, 10);
  on.fillRect(x0 + 0, y0 - 13, 2, 5);
  on.fillRect(x0 - 2, y0 - 16, 2, 4);
  on.fillRect(x0 - 17, y0, 4, 1);
  on.fillRect(x0 + 2, y0, 3, 1);
  on.fillStyle = "#3d3024";
  on.fillRect(x0 - 15, y0 - 5, 1, 5);
  on.fillRect(x0 + 2, y0 - 4, 1, 4);
  // Their crowns, meeting over it: ragged, not a lid.
  const leaves: ReadonlyArray<readonly [number, number, number, number]> = [
    [-19, -21, 7, 4],
    [-14, -24, 8, 4],
    [-8, -23, 7, 3],
    [-3, -21, 7, 4],
    [-17, -18, 5, 2],
    [-1, -18, 5, 2],
    [-10, -20, 4, 2]
  ];
  on.fillStyle = "#16221c";
  for (const [dx, dy, w, h] of leaves) on.fillRect(x0 + dx, y0 + dy, w, h);
  on.fillStyle = "#223229";
  on.fillRect(x0 - 13, y0 - 24, 3, 1);
  on.fillRect(x0 - 6, y0 - 23, 2, 1);
  on.fillRect(x0 - 18, y0 - 21, 2, 1);
  // A few hanging down into the mouth.
  on.fillStyle = "#16221c";
  on.fillRect(x0 - 11, y0 - 17, 1, 3);
  on.fillRect(x0 - 5, y0 - 18, 1, 2);
  // Brambles either side of the way.
  on.fillStyle = "#2c3a26";
  for (const [bx, by] of [
    [x0 + 4, y0 - 8],
    [x0 + 7, y0 + 4],
    [x0 - 1, y0 + 4],
    [x0 + 10, y0 - 7]
  ] as const) {
    on.fillRect(bx - 2, by, 5, 1);
    on.fillRect(bx - 1, by - 1, 3, 1);
    on.fillRect(bx, by - 2, 1, 1);
  }
  on.fillStyle = "#7d3b3b";
  on.fillRect(x0 + 4, y0 - 9, 1, 1);
  on.fillRect(x0 + 7, y0 + 3, 1, 1);
  // The warning post: an acorn, struck through.
  const px = x0 + 12;
  const py = y0 - 9;
  on.fillStyle = "#4e3622";
  on.fillRect(px, py - 9, 1, 10);
  on.fillStyle = "#8a6a44";
  on.fillRect(px - 3, py - 10, 7, 4);
  on.fillStyle = "#5e3f22";
  on.fillRect(px - 1, py - 9, 2, 2);
  on.fillStyle = "#9b2f2f";
  on.fillRect(px - 2, py - 9, 1, 1);
  on.fillRect(px - 1, py - 8, 1, 1);
  on.fillRect(px + 1, py - 9, 1, 1);
  on.fillRect(px + 2, py - 8, 1, 1);
};
/** At dusk and by night, eyes in the trail's mouth: a pair, then another, each blinking now and then on its own time. */
const mouthEyes = (on: CanvasRenderingContext2D, look: CampLook, time: number, dusk: number) => {
  if (dusk < 0.2 || look.levels.burrow < PROWLERS_FROM) return;
  const x0 = Math.round(leftWoodOfLook(look));
  const pairs: ReadonlyArray<readonly [number, number, number]> = [
    [x0 - 9, MOUTH_Y - 7, 0],
    [x0 - 5, MOUTH_Y - 4, 1.7]
  ];
  on.fillStyle = "#ffd34a";
  pairs.forEach(([x, y, own], index) => {
    if (index === 1 && dusk < 0.6) return;
    // Open most of the time; shut for a fifth of a second every few seconds.
    if ((time + own) % 4.3 < 0.2) return;
    on.globalAlpha = Math.min(1, (dusk - 0.2) * 2);
    on.fillRect(x, y, 1, 1);
    on.fillRect(x + 2, y, 1, 1);
  });
  on.globalAlpha = 1;
};
/** By night a low mist creeps out of the mouth along the trail, drifting slowly. */
const mouthMist = (on: CanvasRenderingContext2D, look: CampLook, time: number, dusk: number) => {
  if (dusk < 0.3 || look.levels.burrow < PROWLERS_FROM) return;
  const x0 = Math.round(leftWoodOfLook(look));
  on.fillStyle = "rgba(160, 140, 200, 1)";
  for (let k = 0; k < 4; k++) {
    const drift = Math.round(((time * 1.5 + k * 7) % 22) - 4);
    on.globalAlpha = 0.1 * Math.min(1, (dusk - 0.3) * 2) * (1 - Math.abs(drift - 7) / 18);
    on.fillRect(x0 - 2 + drift, MOUTH_Y - 1 + (k % 2) * 3 - k, 10 + (k % 3) * 3, 1);
  }
  on.globalAlpha = 1;
};

/** The front's slots, shown while it is arranged: an empty trap spot is a worn flat stone in the trail, an empty pad a ring of timber. The chosen one, ringed. */
const frontSlots = (on: CanvasRenderingContext2D, slots: NonNullable<CampExtras["front"]>, time: number | null) => {
  const ring = (x: number, y: number, rx: number, colour: string) => {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      on.fillStyle = colour;
      on.fillRect(Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * rx * SQUAT), 1, 1);
    }
  };
  slots.spots.forEach(([x, y], index) => {
    if (index >= slots.open.spots) return;
    if (!slots.filled.spots[index]) {
      on.fillStyle = "rgba(226, 214, 184, 0.75)";
      on.fillRect(x - 4, y - 1, 9, 3);
      on.fillStyle = "rgba(160, 146, 116, 0.8)";
      on.fillRect(x - 4, y + 1, 9, 1);
    }
    if (slots.chosen?.at === "spot" && slots.chosen.index === index) ring(x, y, 7 + (time !== null && Math.floor(time * 3) % 2 === 0 ? 1 : 0), "#ffe08a");
  });
  slots.pads.forEach(([x, y], index) => {
    if (index >= slots.open.pads) return;
    if (!slots.filled.pads[index]) {
      on.fillStyle = "#7a5233";
      on.fillRect(x - 5, y - 2, 11, 3);
      on.fillStyle = "#a0714a";
      on.fillRect(x - 4, y - 2, 9, 1);
      on.fillStyle = "#5a3a22";
      on.fillRect(x - 5, y + 1, 11, 1);
    }
    if (slots.chosen?.at === "pad" && slots.chosen.index === index) ring(x, y, 8 + (time !== null && Math.floor(time * 3) % 2 === 0 ? 1 : 0), "#ffe08a");
  });
};

export const paintCamp = (ctx: CanvasRenderingContext2D, art: GameArt, look: CampLook, frame: number, extras: CampExtras = {}) => {
  ctx.clearRect(0, 0, GAME_W, GAME_H);
  if (look.area === "meadow") {
    paintMeadow(ctx, art, look, frame, extras);
    return;
  }
  const dusk = Math.max(0, Math.min(1, extras.dusk ?? (look.night ? 1 : 0)));
  const night = dusk >= 0.5;
  if (!backdrop(ctx, art, look.season, frame, dusk)) {
    ctx.fillStyle = night ? "#1c2447" : "#9fd3e6";
    ctx.fillRect(0, 0, GAME_W, 46);
    ctx.fillStyle = night ? "#3c6a5a" : "#7fbf6a";
    ctx.fillRect(0, 46, GAME_W, GAME_H - 46);
  }
  if (extras.clock !== undefined) orbs(ctx, extras.clock, extras.sky ?? 0);

  if (look.rainbow && !night) rainbow(ctx);
  if (extras.clock !== undefined && dusk < 0.45) birds(ctx, extras.clock, extras.sky ?? 0, 1 - dusk / 0.45);

  // What gives light is drawn after the night's shade, so it stays bright.
  const lights: Array<() => void> = [];
  const px = Math.max(1, Math.round(extras.px ?? 1));
  const small = smallAt(px);
  const snap = snapper(px);
  const time = extras.time ?? null;

  // What is chosen says what it needs and what it does: how far it reaches in blue, the ground it takes in red.
  // Laid on the grass, under everything that stands.
  for (const ring of extras.rings ?? []) if (!ring.next) disc(ctx, ring.x, ring.y - 2, ring.r, "rgba(70, 140, 255, 0.21)");
  for (const space of extras.spaces ?? []) disc(ctx, space.x, space.y - 1, space.r, "rgba(236, 72, 60, 0.32)");

  inLight(ctx, dusk, (on) => {
    // The trail out of the Dark Wood, worn into the ground under everything (1.5.11).
    paintTrail(on, look);
    if (extras.front) frontSlots(on, extras.front, time);
    // Everything that stands, by where its feet are.
    const things: Standing[] = [];
    if (look.levels.burrow >= PROWLERS_FROM) things.push({ y: MOUTH_Y - 0.5, draw: () => trailMouth(on, look) });
    const { about: prowls, fights } = extras.watch && extras.clock !== undefined && time !== null ? prowlsAt(look, extras.watch, extras.clock) : { about: [] as Prowl[], fights: new Map<number, Fight>() };
    // What is being knocked at just now, and how far into it: a building that is hit is seen to be.
    const knocked = new Map<Placed, number>();
    for (const prowl of prowls) if (prowl.rap !== null && prowl.puff === null) knocked.set(prowl.site, prowl.rap);
    const LEAVES = [["#7cc85a", "#4e8e3e"], ["#e8943a", "#d8642c"], ["#f4f6ff", "#c9d1ff"], ["#f4a8c8", "#9ad06a"]][look.season % 4];
    const stand = (name: string, x: number, y: number, variant?: number, squash = 0, wear = 0) => {
      const sprite = art.sprite(name, frame, variant === undefined ? {} : { variant });
      if (!sprite) return sprite;
      // Knocked about by a prowler: its own picture, the worse for it.
      const picture = wear > 0 ? damaged(sprite.image, sprite.w, sprite.h, Math.min(4, wear)) : sprite.image;
      if (squash === 0) {
        on.drawImage(picture, Math.round(x - sprite.w / 2), Math.round(y - sprite.h));
        return sprite;
      }
      // Squashed about its feet: wider as it is shorter, the way a soft thing lands.
      on.save();
      on.translate(Math.round(x), Math.round(y));
      on.scale(1 + squash * 0.6, 1 - squash);
      on.drawImage(picture, -Math.round(sprite.w / 2), -sprite.h);
      on.restore();
      return sprite;
    };

    layLand(on, art, look.land ?? [], time, things, px);
    // The wood the camp has not yet cleared: it stands like any other trees, and is in front of or behind things as they are.
    forestOf(look).forEach((tree) =>
      things.push({ y: tree.y, x: tree.x, shade: 6, draw: () => (tree.dark ? darkTree(on, art, tree.kind, tree.x, tree.y) : eased(on, art, "land", tree.kind, tree.x, tree.y, null, 0, 0)) })
    );
    (look.works ?? []).forEach((entry) => {
      // A patch of tanglefoot and a pitfall lie on the ground: whoever is on them is drawn over them, and they throw no shadow.
      const lies = entry.kind === 4 || entry.kind === 6;
      things.push({
        y: lies ? entry.y - 9 : entry.y,
        at: entry.y,
        x: entry.x,
        shade: lies ? 0 : 6,
        draw: () => eased(on, art, "work", entry.kind, entry.x, entry.y, time, WORK_EVERY[entry.kind] ?? 0, entry.kind)
      });
    });
    if (extras.setting) {
      const setting = extras.setting;
      things.push({ y: setting.y, x: setting.x, draw: () => ghost(on, art, setting, frame) });
    }

    look.trophies.slice(0, TROPHIES_SHOWN).forEach((kind, index) => {
      const [x, y] = TROPHY_SPOTS[index];
      things.push({ y, x, shade: 4, draw: () => void stand("trophy", x, y, kind) });
    });
    look.banners.slice(-BANNERS_SHOWN).forEach((season, index) => {
      const [x, y] = BANNER_SPOTS[index];
      things.push({ y, x, shade: 2, draw: () => void stand("banner", x, y, season) });
    });
    look.decor.forEach((entry) => things.push({ y: entry.y, x: entry.x, shade: 5, draw: () => void stand("decor", entry.x, entry.y, entry.kind) }));

    const piece = (x: number, y: number) => {
      if (stand("fencepiece", x, y + 3, Math.max(1, look.levels.fence))) return;
      // No piece of its own yet: a cut from the long fence of its level, or plain posts.
      const long = art.sprite("fence", frame, { variant: Math.max(1, look.levels.fence) });
      if (long) on.drawImage(long.image, 4, 0, 10, long.h, Math.round(x - 5), Math.round(y + 3 - long.h), 10, long.h);
      else {
        on.fillStyle = "#7a4c2c";
        on.fillRect(Math.round(x - 5), y - 9, 10, 12);
      }
    };
    // The gate: two posts and a lintel, and the doors between them, where the piece of fence would be.
    const gateway = (x: number, y: number) => {
      const left = Math.round(x) - 5;
      const foot = Math.round(y) + 3;
      on.fillStyle = "#3d2a1a";
      on.fillRect(left, foot - 14, 2, 14);
      on.fillRect(left + 8, foot - 14, 2, 14);
      on.fillStyle = "#6e4c2c";
      on.fillRect(left - 1, foot - 15, 12, 2);
      on.fillStyle = "#9a6f3e";
      on.fillRect(left + 2, foot - 10, 6, 10);
      on.fillStyle = "#6e4c2c";
      on.fillRect(left + 5, foot - 10, 1, 10);
      on.fillRect(left + 2, foot - 7, 6, 1);
      on.fillStyle = "#e8c66a";
      on.fillRect(left + 4, foot - 5, 1, 1);
      on.fillRect(left + 6, foot - 5, 1, 1);
    };
    // How tall a piece stands as it is drawn (pieces are shrunk in height, like everything).
    const fenceTall = Math.max(4, Math.round(12 * small));
    const tones = fenceTones(art, Math.max(1, look.levels.fence));
    // A piece in a run going up the picture: the end of the fence, as thick as it is, with the light on its top.
    const post = (x: number, y: number) => {
      const left = Math.round(x) - 2;
      on.fillStyle = tones.face;
      on.fillRect(left, y + 3 - 12, 5, 12);
      on.fillStyle = tones.side;
      on.fillRect(left + 4, y + 3 - 12, 1, 12);
      on.fillRect(left, y + 2, 5, 1);
      on.fillStyle = tones.top;
      on.fillRect(left, y + 3 - 13, 5, 2);
    };
    // A fence in front of the building that is pointed at is drawn thin: a wall round the larder must not be a wall
    // between the reader and the larder.
    const behind = extras.through ? { spot: look.spots[extras.through], box: boxOf(extras.through, look.spots[extras.through]) } : null;
    // And so is any fence the pointer is resting on: what is behind it (a signpost, a parcel, a construct) is small.
    const peek = extras.peek ?? null;
    const veils = (x: number, y: number) =>
      (behind !== null && y >= behind.spot[1] - 2 && y + 3 - fenceTall < behind.spot[1] && y + 3 > behind.box.top && Math.abs(x - behind.spot[0]) <= behind.box.w / 2 + 7) ||
      (peek !== null && Math.abs(x - peek.x) <= 9 && peek.y >= y + 3 - fenceTall - 6 && peek.y <= y + 5);
    // The wall across the trail (1.5.11): a palisade, or stone from the fourth level, seen running away up the picture as
    // stake after stake (or block after block), with a gatehouse where the trail meets it. What tonight's prowlers have
    // knocked down lies in a heap until dawn.
    const down = extras.watch && extras.clock !== undefined && time !== null ? wallDownAt(look, extras.watch, extras.clock) : [];
    const onLine = (x: number, y: number) => look.line !== undefined && Math.abs(x - wallXAt(look.line, y)) < 1;
    const stone = look.levels.fence >= 4;
    /** One log of the palisade (a block of the stone wall), its foot at `foot`: its shadowed side to the trail, its lit side to the camp, a point on top. */
    const stake = (x: number, foot: number, tall: number, shade: boolean) => {
      if (stone) {
        on.fillStyle = shade ? tones.side : tones.face;
        on.fillRect(x - 3, foot - tall, 7, tall);
        on.fillStyle = "#34303a";
        on.fillRect(x - 3, foot - tall, 1, tall);
        on.fillStyle = tones.top;
        on.fillRect(x + 3, foot - tall + 1, 1, tall - 1);
        on.fillStyle = "#57525c";
        for (let row = foot - 4; row > foot - tall; row -= 4) on.fillRect(x - 2, row, 5, 1);
        on.fillStyle = tones.top;
        on.fillRect(x - 3, foot - tall - 1, 7, 1);
        if (look.levels.fence >= 5) {
          on.fillRect(x - 3, foot - tall - 3, 2, 2);
          on.fillRect(x + 2, foot - tall - 3, 2, 2);
        }
        return;
      }
      // A log: dark on the side to the trail, lit on the side to the camp, and pointed.
      on.fillStyle = shade ? "#6a4426" : "#80552f";
      on.fillRect(x - 2, foot - tall, 5, tall);
      on.fillStyle = "#33200f";
      on.fillRect(x - 2, foot - tall + 1, 1, tall - 1);
      on.fillStyle = "#b5854f";
      on.fillRect(x + 2, foot - tall + 1, 1, tall - 2);
      on.fillRect(x - 1, foot - tall - 1, 3, 1);
      on.fillStyle = "#d9b27a";
      on.fillRect(x, foot - tall - 2, 1, 1);
      // The rope that binds it to the next.
      on.fillStyle = "#3d2a16";
      on.fillRect(x - 2, foot - tall + 4, 5, 1);
    };
    /** A section of the wall: logs (or blocks) one behind another, the far one first. */
    const section = (x: number, y: number) => {
      const tall = stone ? 12 : 14 + (look.levels.fence >= 3 ? 2 : 0);
      const steps = stone ? [-3, 1] : [-4, -1.5, 1, 3.5];
      // Drawn leaning a little, the far end to the right: the wall is seen running away up the picture, its face to the trail.
      steps.forEach((dy, index) => stake(Math.round((look.line ?? x) + (TRAIL_Y - (y + dy)) * WALL_LEAN), Math.round(y + dy) + 3, tall, index % 2 === 1));
      if (extras.sliding) {
        on.fillStyle = "#ffe08a";
        on.fillRect(Math.round(x) - 3, Math.round(y) - tall - 3, 7, 1);
      }
    };
    /** The gatehouse: two log towers (stone, from the fourth level) with caps, the doors between, and a beam over. */
    const gatehouse = (x: number, y: number) => {
      const left = Math.round(x);
      const back = Math.round(y) - 3;
      const front = Math.round(y) + 6;
      const tower = (foot: number) => {
        on.fillStyle = stone ? tones.face : "#6e4a2c";
        on.fillRect(left - 3, foot - 21, 7, 21);
        on.fillStyle = stone ? "#3d3a40" : "#3b2616";
        on.fillRect(left - 3, foot - 21, 1, 21);
        on.fillStyle = stone ? tones.top : "#9a6f3e";
        on.fillRect(left + 3, foot - 20, 1, 20);
        on.fillStyle = stone ? tones.side : "#4a3220";
        for (let row = foot - 5; row > foot - 21; row -= 5) on.fillRect(left - 2, row, 5, 1);
        // A cap over it.
        on.fillStyle = "#6b2f22";
        on.fillRect(left - 4, foot - 23, 9, 2);
        on.fillRect(left - 2, foot - 25, 5, 2);
        on.fillRect(left, foot - 26, 1, 1);
        on.fillStyle = "#8c4430";
        on.fillRect(left - 3, foot - 23, 7, 1);
      };
      tower(back);
      // The doors, seen edge on as the wall is: planks, banded with iron.
      for (const foot of [back + 3, back + 5, back + 7]) {
        on.fillStyle = "#a87b48";
        on.fillRect(left - 2, foot - 13, 5, 13);
        on.fillStyle = "#6e4c2c";
        on.fillRect(left - 2, foot - 13, 1, 13);
        on.fillStyle = "#55555f";
        on.fillRect(left - 2, foot - 10, 5, 1);
        on.fillRect(left - 2, foot - 4, 5, 1);
      }
      // The beam over, from the far tower to the near.
      on.fillStyle = "#4a3220";
      for (let step = 0; step <= front - back; step++) on.fillRect(left - 2, back - 17 + step, 5, 2);
      tower(front);
      if (extras.sliding) {
        on.fillStyle = "#ffe08a";
        on.fillRect(left - 4, back - 27, 9, 1);
        on.fillRect(left - 4, front - 27, 9, 1);
      }
    };
    /** A section knocked down in the night: stumps and splinters (a heap of stone), until dawn. */
    const rubble = (x: number, y: number) => {
      const foot = Math.round(y) + 3;
      const left = Math.round(x + (TRAIL_Y - y) * WALL_LEAN);
      on.fillStyle = stone ? tones.face : tones.side;
      on.fillRect(left - 3, foot - 2, 2, 2);
      on.fillRect(left, foot - 3, 2, 3);
      on.fillRect(left + 2, foot - 1, 2, 1);
      on.fillStyle = stone ? tones.side : tones.face;
      on.fillRect(left - 5, foot, 2, 1);
      on.fillRect(left + 4, foot - 1, 3, 1);
      on.fillRect(left - 1, foot + 1, 2, 1);
    };
    for (const y of down) {
      if (look.line === undefined) break;
      const x = wallXAt(look.line, y);
      things.push({ y, x, at: y + 3, wide: true, draw: () => rubble(look.line ?? x, y) });
    }
    look.walls.forEach(([x, y]) => {
      if (onLine(x, y) && down.includes(y)) return;
      if (onLine(x, y)) {
        const isGate = Boolean(look.gate && look.gate[0] === x && look.gate[1] === y);
        things.push({
          y: y + 3,
          x,
          at: y + 6,
          wide: true,
          draw: () => {
            const thin = veils(x, y);
            if (thin) on.globalAlpha = 0.28;
            if (isGate) gatehouse(x, y);
            else section(x, y);
            if (thin) on.globalAlpha = 1;
          }
        });
        return;
      }
      const isGate = Boolean(look.gate && look.gate[0] === x && look.gate[1] === y);
      const run = !isGate && endOn(look.walls, x, y);
      // A corner: fence runs back or forward from this piece, and along from it to one side only. -1 when the side it
      // goes along to is the right (so its left end is the corner), 1 when it is the left.
      const wallAtSpot = (px: number, py: number) => look.walls.some((wall) => wall[0] === px && wall[1] === py);
      const turns = wallAtSpot(x, y - 10) || wallAtSpot(x, y + 10);
      const corner = !isGate && turns && wallAtSpot(x + 10, y) !== wallAtSpot(x - 10, y) ? (wallAtSpot(x + 10, y) ? -1 : 1) : 0;
      things.push({
        y,
        x,
        at: y + 3,
        wide: true,
        draw: () => {
          const thin = veils(x, y);
          if (thin) on.globalAlpha = 0.28;
          if (isGate) gateway(x, y);
          else if (run) post(x, y);
          else if (corner !== 0) {
            // At a corner the length of fence stops where the fence running back from it does: it is drawn only from
            // that fence's outer edge inwards, so that the two meet flush and nothing sticks out past the corner.
            on.save();
            on.beginPath();
            if (corner < 0) on.rect(Math.round(x) - 2, y - 60, 12, 120);
            else on.rect(Math.round(x) - 10, y - 60, 13, 120);
            on.clip();
            piece(x, y);
            on.restore();
          } else piece(x, y);
          if (thin) on.globalAlpha = 1;
        }
      });
    });
    // The fence between a piece and the one behind it. The camp is seen from in front and a little above, so of a
    // wall running away from the reader what shows is its top, all the way along, and its face only at the near end
    // (which is the near piece's own post). Of one running away on the slant, the top and the side that is turned
    // this way. It was drawn as its side all the way up, which made a dark bar with posts through it.
    fenceLinks(look.walls.filter(([x, y]) => !onLine(x, y))).forEach(([x, y, bx, by]) => {
      things.push({
        y: (y + by) / 2,
        draw: () => {
          const thin = veils((x + bx) / 2, Math.max(y, by));
          if (thin) on.globalAlpha = 0.28;
          const near = Math.round(y) + 3;
          const far = Math.round(by) + 3;
          if (bx === x) {
            // Straight back: the top of it, from the far end to the near, with an edge down either side.
            const left = Math.round(x) - 2;
            const top = far - fenceTall - 1;
            const long = near - fenceTall - top;
            on.fillStyle = tones.top;
            on.fillRect(left, top, 5, long);
            on.fillStyle = tones.face;
            on.fillRect(left, top, 1, long);
            on.fillStyle = tones.side;
            on.fillRect(left + 4, top, 1, long);
          } else {
            // On the slant: column by column from the far end to the near, its side below and its top above.
            const steps = Math.abs(bx - x);
            for (let step = steps; step >= 0; step--) {
              const sx = Math.round(x + ((bx - x) * step) / steps);
              const foot = Math.round(near + ((far - near) * step) / steps);
              on.fillStyle = tones.side;
              on.fillRect(sx - 1, foot - fenceTall, 2, fenceTall);
              on.fillStyle = tones.rail;
              on.fillRect(sx - 1, foot - 1, 2, 1);
              on.fillStyle = tones.top;
              on.fillRect(sx - 1, foot - fenceTall - 3, 2, 3);
              on.fillStyle = tones.face;
              on.fillRect(sx - 1, foot - fenceTall, 2, 1);
            }
          }
          if (thin) on.globalAlpha = 1;
        }
      });
    });
    // Parcels come up the path from the reading: by the burrow's door until they are opened.
    parcelSpots(look).forEach(([x, y], index) => {
      things.push({
        y,
        x,
        shade: 3,
        draw: () => {
          const left = Math.round(x) - 3;
          const top = Math.round(y) - 5;
          on.fillStyle = "#5e3a1f";
          on.fillRect(left, top, 7, 6);
          on.fillStyle = index % 2 === 0 ? "#d2a566" : "#c2925a";
          on.fillRect(left + 1, top + 1, 5, 4);
          // The string round it, and the knot.
          on.fillStyle = "#f4ead0";
          on.fillRect(left + 3, top + 1, 1, 4);
          on.fillRect(left + 1, top + 3, 5, 1);
          on.fillStyle = "#e0564a";
          on.fillRect(left + 3, top, 1, 1);
        }
      });
    });
    // Pip's welcome basket: a wicker basket brimming with acorns, a checked cloth tucked in, a handle over it.
    if (look.basket && (look.area ?? "camp") === "camp") {
      const [x, y] = basketSpot(look);
      things.push({
        y,
        x,
        shade: 4,
        draw: () => {
          const left = Math.round(x) - 5;
          const foot = Math.round(y);
          // The handle, an arch of whole pixels.
          on.fillStyle = "#5e3a1f";
          on.fillRect(left + 2, foot - 11, 1, 3);
          on.fillRect(left + 3, foot - 12, 5, 1);
          on.fillRect(left + 8, foot - 11, 1, 3);
          // Acorns heaped over the rim.
          on.fillStyle = "#8a5a2b";
          on.fillRect(left + 2, foot - 8, 2, 2);
          on.fillRect(left + 5, foot - 9, 2, 3);
          on.fillRect(left + 7, foot - 8, 2, 2);
          on.fillStyle = "#4a3018";
          on.fillRect(left + 2, foot - 9, 2, 1);
          on.fillRect(left + 5, foot - 10, 2, 1);
          on.fillRect(left + 7, foot - 9, 2, 1);
          // The cloth, red and cream, hanging over one side.
          on.fillStyle = "#e0564a";
          on.fillRect(left, foot - 7, 3, 2);
          on.fillStyle = "#f4ead0";
          on.fillRect(left + 1, foot - 7, 1, 1);
          on.fillRect(left, foot - 6, 1, 1);
          // The basket: an ink rim, then wicker in two weaves.
          on.fillStyle = "#5e3a1f";
          on.fillRect(left, foot - 6, 11, 1);
          on.fillRect(left + 1, foot - 1, 9, 1);
          on.fillStyle = "#d8a95e";
          on.fillRect(left + 1, foot - 5, 9, 4);
          on.fillStyle = "#b9853f";
          for (let col = 0; col < 9; col += 2) on.fillRect(left + 1 + col, foot - 5 + (col % 4 === 0 ? 0 : 1), 1, 1);
          for (let col = 1; col < 9; col += 2) on.fillRect(left + 1 + col, foot - 3 + (col % 4 === 1 ? 0 : 1), 1, 1);
          on.fillStyle = "#5e3a1f";
          on.fillRect(left, foot - 5, 1, 4);
          on.fillRect(left + 10, foot - 5, 1, 4);
        }
      });
    }
    if (look.garden !== undefined && look.garden !== null) {
      const [gx, gy] = gardenSpot(look.spots);
      const state = look.garden;
      things.push({ y: gy, x: gx, draw: () => void stand("gardenbed", gx, gy, state) });
    }

    for (const site of PLACED) {
      const carried = extras.carrying?.site === site ? extras.carrying : null;
      const spot: Spot = carried ? [carried.x, carried.y] : look.spots[site];
      const size = PLOT_SIZE[site];
      const yard = site === "yard0" ? look.yard[0] : site === "yard1" ? look.yard[1] : null;
      // A plot of the yard is what a level of the camp brings: until then there is nothing there to draw.
      if (!plotOpenAt(look.levels.burrow, yard ?? undefined, site, look.legacy ?? 0)) continue;
      const level = yard ? yard.level : look.levels[site as BuildingId];
      const name = yard ? (yard.kind ?? "workshop") : site;
      things.push({
        y: spot[1],
        x: spot[0],
        shade: level > 0 ? size.w * 0.42 : 0,
        draw: () => {
          // In its picture's own size here: the whole of it is drawn smaller together.
          const box = boxOf(site, spot, 1);
          const wear = look.harm?.[site] ?? 0;
          if (carried) on.globalAlpha = carried.ok ? 0.8 : 0.4;
          const squash = extras.bounce?.site === site ? boing(extras.bounce.age) : 0;
          // Knocked at: it jolts with each blow, a pixel and back.
          const rapped = knocked.get(site);
          if (rapped !== undefined && rapped % 0.75 < 0.13) on.translate(rapped % 1.5 < 0.75 ? 1 : -1, 0);
          // Tapped: the oak shivers as its acorns come down, or shakes its head when the larder is full.
          else if (site === "oak" && extras.oakShake) on.translate(oakShakeOffset(extras.oakShake.kind, extras.oakShake.age), 0);
          // A lookout that has taken a path is another tower to look at: the white spire, or the dark watch.
          const pathLook = site === "tower" && look.towerPath && level >= 3 ? stand(look.towerPath === "a" ? "spire" : "darkwatch", spot[0], spot[1], level - 3, squash, wear) : null;
          if (!pathLook && !stand(name, spot[0], spot[1], level, squash, wear)) {
            if (level === 0) {
              on.strokeStyle = "#5e3a1f";
              on.strokeRect(box.left + 0.5, spot[1] - 7.5, box.w - 1, 7);
            } else {
              // A plain stand-in: taller with every level.
              const tall = Math.round((box.h * (level + 1)) / ((yard ? YARD_MAX : MAX_LEVEL) + 1));
              on.fillStyle = size.colour;
              on.fillRect(box.left + 2, spot[1] - tall, box.w - 4, tall);
            }
          }
          on.globalAlpha = 1;
          if (site === "burrow" && level > 0 && !carried) {
            const open =
              extras.entering !== undefined && extras.entering !== null && time !== null
                ? pipEntering(pipEntry(look, extras.entering), time - extras.entering).door
                : extras.cameOut !== undefined && extras.cameOut !== null && time !== null
                  ? pipExiting(pipExit(look, extras.cameOut), time - extras.cameOut).door
                  : 0;
            burrowDoor(on, spot, level, open, 0);
            // The glow is a light: drawn over the night's shade (as the windows are), so it is seen on a first night too.
            const glow = extras.doorGlow ?? 0;
            if (glow > 0)
              lights.push(() => {
                const fx = snap(spot[0]);
                const fy = snap(spot[1]);
                ctx.save();
                ctx.translate(fx, fy);
                ctx.scale(small, small);
                ctx.translate(-fx, -fy);
                burrowDoor(ctx, spot, level, 0, glow);
                ctx.restore();
              });
          }
          for (let bit = 0; bit < wear * 2; bit++) {
            // What came off it: a few stones on the grass at its foot.
            on.fillStyle = bit % 2 === 0 ? "#8d8a80" : "#6f6c64";
            on.fillRect(Math.round(spot[0] - box.w / 2 + scatter(bit * 3.3 + spot[0]) * box.w), Math.round(spot[1] - 1 + (bit % 3)), bit % 3 === 0 ? 2 : 1, 1);
          }
          if (site === "tower" && look.lit && level > 0) {
            lights.push(() => {
              const lantern = art.sprite("lantern", frame);
              if (lantern) ctx.drawImage(lantern.image, spot[0] - Math.round(lantern.w / 2), Math.round(spot[1] - LANTERN_UP[level] * small) - Math.round(lantern.h / 2));
            });
          }
          if (look.jobs.includes(site)) stand("scaffold", spot[0], spot[1]);
          if (extras.burst?.site === site) {
            const at = extras.burst.frame;
            lights.push(() => {
              const burst = art.sprite("burst", at);
              if (burst) ctx.drawImage(burst.image, spot[0] - Math.round(burst.w / 2), spot[1] - Math.round((box.h * small) / 2) - Math.round(burst.h / 2));
            });
          }
        }
      });
    }

    if (look.visitor) {
      // He trundles in from the trees' edge, rocking as he comes, and then stays put.
      const along = Math.min(1, Math.max(0, extras.arriving ?? 1));
      const eased = 1 - (1 - along) ** 3;
      const x = HEDGEHOG_AT[0] + (1 - eased) * (GAME_W - HEDGEHOG_AT[0] + 14);
      const rock = along < 1 && time !== null ? -Math.abs(Math.sin(time * 11)) * 1.2 : 0;
      things.push({
        y: HEDGEHOG_AT[1],
        x,
        shade: 6,
        draw: () => {
          const sprite = art.sprite("hedgehog", frame);
          if (sprite) on.drawImage(sprite.image, snap(x - sprite.w / 2), snap(HEDGEHOG_AT[1] - sprite.h + rock));
        }
      });
    }
    if (extras.pip) {
      const working = look.jobs.find((job): job is Placed => job !== "fence") ?? null;
      const beside = (site: Placed): [number, number] => {
        const spot = look.spots[site];
        const size = PLOT_SIZE[site];
        // On the side of it that faces the middle of the clearing, so she is never off the edge or behind it.
        const left = spot[0] > GAME_W / 2 + 20 ? spot[0] - (size.w * THINGS) / 2 - 24 : spot[0] + (size.w * THINGS) / 2 - 9;
        return [Math.min(GAME_W - 32, Math.max(0, left)) + 16, Math.min(GAME_H - 4, spot[1] + 2)];
      };
      const coming = extras.cameOut !== undefined && extras.cameOut !== null && time !== null && time - extras.cameOut < pipExit(look, extras.cameOut).total;
      if ((extras.entering !== undefined && extras.entering !== null && time !== null) || coming) {
        // On her way in at her own door, the reader following her; or out of it again with them.
        const now =
          extras.entering !== undefined && extras.entering !== null && time !== null
            ? pipEntering(pipEntry(look, extras.entering), time - extras.entering)
            : pipExiting(pipExit(look, extras.cameOut as number), (time as number) - (extras.cameOut as number));
        const hop = now.move === "walk" ? -Math.round(Math.abs(Math.sin(now.age * 9)) * 1.4) : 0;
        if (now.shown > 0.02)
          things.push({
            y: now.y,
            x: now.x,
            small: PIP_SMALL * (0.82 + 0.18 * now.shown),
            shade: now.shown > 0.6 ? 7 : 0,
            draw: () => {
              const sprite = art.pip(now.move, Math.floor(now.age * ART_FPS));
              const left = snap(now.x - sprite.w / 2);
              const top = snap(now.y - 30 + hop);
              const before = on.globalAlpha;
              on.globalAlpha = before * now.shown;
              if (now.faceLeft) turned(on, sprite.image, sprite.w, left, top);
              else on.drawImage(sprite.image, left, top);
              on.globalAlpha = before;
            }
          });
      } else if (working || time === null) {
        // Building: beside the work, cheering it on. In a still picture: at home, and asleep there by night.
        const [x, feet] = beside(working ?? "burrow");
        const move = look.jobs.length > 0 ? "cheer" : night ? "sleep" : "idle";
        things.push({ y: feet, x, small: PIP_SMALL, shade: 7, draw: () => on.drawImage(art.pip(move, frame).image, Math.round(x - 16), feet - 30) });
      } else {
        // Nothing going up: on her rounds. From her door to whatever there is in the camp to go to, round what stands
        // in the way and in at the doors that have one; as night falls she goes in to bed, and a tap on the burrow
        // has her up again for a while.
        const awake = extras.awake !== undefined && extras.awake < AWAKE_SECONDS ? extras.awake : null;
        const now = onWalk(walksOf(look).pip, awake ?? time, PIP_SPEED);
        const out = awake !== null ? Math.min(1, (AWAKE_SECONDS - awake) / 1.2) : Math.max(0, Math.min(1, (0.6 - dusk) / 0.2));
        const seen = now.shown * out;
        // One of them near her: she starts, and it shows.
        const scare = prowls.some((prowl) => prowl.puff === null && Math.hypot(prowl.x - now.x, prowl.y - now.y) < 26);
        const hop = scare ? -Math.abs(Math.sin(time * 14)) * 2.2 : now.move === "walk" ? -Math.abs(Math.sin(now.age * 9)) * 1.4 : 0;
        if (scare && seen > 0.5) {
          lights.push(() => {
            ctx.fillStyle = "#ff8a5c";
            ctx.fillRect(Math.round(now.x), Math.round(now.y - 30 * small * PIP_SMALL - 6), 2, 4);
            ctx.fillRect(Math.round(now.x), Math.round(now.y - 30 * small * PIP_SMALL - 1), 2, 1);
          });
        }
        if (seen > 0.02) {
          things.push({
            y: now.y,
            x: now.x,
            // Going in at a door she is smaller as well as fainter: she is going away from us.
            small: PIP_SMALL * (0.82 + 0.18 * now.shown),
            shade: seen > 0.6 ? 7 : 0,
            draw: () => {
              const sprite = art.pip(now.move, Math.floor(now.age * ART_FPS));
              const left = snap(now.x - sprite.w / 2);
              const top = snap(now.y - 30 + hop);
              const before = on.globalAlpha;
              on.globalAlpha = before * seen;
              if (now.faceLeft) turned(on, sprite.image, sprite.w, left, top);
              else on.drawImage(sprite.image, left, top);
              on.globalAlpha = before;
            }
          });
        }
      }
    }
    // The guardians. Each keeps to the ground about a signpost, which the reader can carry anywhere: they stand by it,
    // walk a short beat from it, have something to do at each end of the beat, go out from it to whoever comes near, and
    // lie down by it when they are worn out. The dragon has no post: she keeps to the larder's roof.
    (look.guards ?? []).forEach((rank, guard) => {
      const post = GUARDIANS[guard]?.post;
      if (!post || rank <= 0) return;
      const sign = postAt(look, guard, extras.posting);
      if (!sign) return;
      const roof = post === "store";
      // They stand on the side of the post that is toward the middle of the clearing.
      const out = sign[0] < GAME_W / 2 ? 1 : -1;
      const within = (x: number) => Math.min(GAME_W - 9, Math.max(9, x));
      // Their own post, with their own thing on it; the plain one where the picture is not there.
      if (!roof) {
        things.push({
          y: sign[1],
          x: sign[0],
          small: 0.95,
          shade: 2,
          draw: () => {
            if (!stand("signpost", sign[0], sign[1], guard)) stand("decor", sign[0], sign[1], 8);
          }
        });
      }
      const at: [number, number] = roof ? sign : [within(sign[0] + out * 7), Math.min(GAME_H - 3, sign[1] + 1)];
      const asleep = (look.asleep ?? []).includes(guard);
      const beat: Array<[number, number]> = [at, [within(at[0] + out * 9), Math.min(GAME_H - 3, at[1] + 5)], at, [within(at[0] + out * 4), Math.max(58, at[1] - 6)]];
      // Worn out, they are laid by the campfire, where the camp has one: it is where they get their strength back, and quicker.
      const fire = asleep ? (look.decor.find((entry) => entry.kind === 10) ?? null) : null;
      const bed: [number, number] = fire ? [within(fire.x + (guard % 2 === 0 ? -11 : 11) + (guard % 3) * 2), Math.min(GAME_H - 3, fire.y + 1 + (guard % 3) * 2)] : at;
      const strolling = time === null || roof || asleep ? { x: bed[0], y: bed[1], move: "idle", faceLeft: out < 0, age: roof && time !== null ? time : 0 } : pipRounds(time + guard * 13.7, beat, 0.45 + guard * 0.04, 2.2);
      const fight = asleep ? null : (fights.get(guard) ?? null);
      // Out fighting: from wherever they were to the fight and back again, never from nowhere.
      const now =
        fight && !fight.ranged
          ? {
              x: strolling.x + (fight.tx - strolling.x) * fight.along,
              y: strolling.y + (fight.ty - strolling.y) * fight.along,
              move: fight.along < 1 ? "walk" : "fight",
              faceLeft: fight.back ? strolling.x < fight.tx : fight.px < strolling.x + (fight.tx - strolling.x) * fight.along,
              age: (time ?? 0) * 1.6
            }
          : fight
            ? { ...strolling, move: "fight", faceLeft: fight.px < strolling.x }
            : strolling;
      const walking = now.move === "walk";
      // Running to a fight or home from one, a stride for the ground covered; on their beat, a step in their own time.
      const running = Boolean(fight && !fight.ranged && fight.along < 1);
      const stride = running && fight ? stridesOf(strolling, fight) : Math.floor(now.age * 4.7);
      things.push({
        // On a roof, she is drawn after the building she is on, and is smaller about its feet, not her own.
        y: roof ? look.spots.store[1] + 0.5 : now.y,
        x: roof ? look.spots.store[0] : now.x,
        ...(roof ? { at: look.spots.store[1] } : { shade: 4.5 }),
        draw: () => {
          // As they are kitted at their rank; frames 2 to 5 are their step.
          const sprite = art.sprite("guardian", walking ? 2 + (stride % 4) : 0, { variant: guard, rank });
          if (!sprite) return;
          if (asleep) {
            // Worn out: laid down by the post, and out to the world.
            on.save();
            on.translate(snap(now.x), snap(now.y));
            on.rotate(out < 0 ? Math.PI / 2 : -Math.PI / 2);
            on.drawImage(sprite.image, -sprite.w / 2, -sprite.h + 3);
            on.restore();
            return;
          }
          const act: Act = walking || fight || time === null ? "stand" : pickAct(GUARD_ACTS[guard] ?? STAND, roof ? Math.floor(time / 8) * 8 : time - now.age, guard);
          const pose = poseOf(act, now.age);
          const left = snap(now.x - sprite.w / 2);
          const top = snap(now.y - sprite.h + 1 + (running ? -(stride % 2) : walking ? 0 : pose.hop));
          // Walking or fighting, they face the way of it; standing, out from the post, or wherever the glass is turned.
          const flip = !roof && (walking || fight ? now.faceLeft : (out < 0) !== pose.turned);
          if (flip) turned(on, sprite.image, sprite.w, left, top);
          else on.drawImage(sprite.image, left, top);
          if (running) dust(on, now.x, now.y, flip, stride);
          if (fight?.alert !== undefined) alertMark(on, now.x, top, fight.alert);
          if (fight?.cheer) props(on, art, "raise", now.age, now.x, now.y, sprite.h, flip, 1 + (guard % 8));
          else if (fight) armed(on, art, fight, now.x, now.y, sprite.h, 1 + (guard % 8), flip);
          else props(on, art, act, now.age, now.x, now.y + pose.hop, sprite.h, flip, 1 + (guard % 8));
        }
      });
      if (asleep && time !== null) lights.push(() => zzz(ctx, now.x, now.y - 9 * small, time, 1));
    });

    // The camp's people, about the place: each on a round of their own about the camp (round what stands in the way,
    // in at a door now and then, at a pace nobody else has). One who is worn out is in the hut, asleep, and not seen.
    (look.residents ?? [])
      .filter((hero) => !(look.asleep ?? []).includes(100 + hero))
      .slice(0, night ? RESIDENTS_BY_NIGHT : RESIDENTS_SHOWN)
      .forEach((hero, index) => {
        const hut = look.spots.hut;
        const strolling =
          time === null
            ? { x: Math.min(GAME_W - 12, hut[0] + 16 + index * 6), y: Math.min(GAME_H - 4, hut[1] + 4), move: "idle", faceLeft: index % 2 === 1, age: 0, shown: 1 }
            : onWalk(folkWalk(look, hero, index), time + hero * 7.3 + index * 11, PIP_SPEED * (0.6 + (hero % 4) * 0.09));
        const fight = fights.get(100 + hero) ?? null;
        // Out fighting: from wherever they were to the fight and back again, never from nowhere.
        const now = fight
          ? {
              x: strolling.x + (fight.tx - strolling.x) * fight.along,
              y: strolling.y + (fight.ty - strolling.y) * fight.along,
              move: fight.along < 1 ? "walk" : "fight",
              faceLeft: fight.back ? strolling.x < fight.tx : fight.px < strolling.x + (fight.tx - strolling.x) * fight.along,
              age: (time ?? 0) * 1.6,
              shown: Math.max(strolling.shown, Math.min(1, fight.along * 3))
            }
          : strolling;
        if (now.shown < 0.02) return;
        const walking = now.move === "walk";
        const running = Boolean(fight && fight.along < 1);
        const stride = running && fight ? stridesOf(strolling, fight) : 0;
        const hop = running ? -(stride % 2) : walking ? -Math.abs(Math.sin(now.age * (4.4 + (hero % 3)))) * 1.1 : 0;
        things.push({
          y: now.y,
          x: now.x,
          small: 0.85 + 0.15 * now.shown,
          shade: now.shown > 0.6 ? 4.5 : 0,
          draw: () => {
            // Their own walk, begun when they set off: nobody is in step with anybody. Standing, they are at something.
            const sprite = art.sprite("hero", running ? stride : walking ? Math.floor(now.age * (4.8 + (hero % 3))) : 0, { variant: hero });
            if (!sprite) return;
            const act: Act = walking || fight || time === null || now.shown < 1 ? "stand" : pickAct(HERO_ACTS, time - now.age, hero);
            const pose = poseOf(act, now.age);
            const left = snap(now.x - sprite.w / 2);
            const top = snap(now.y - sprite.h + 2 + (walking ? hop : pose.hop));
            const flip = walking || fight ? now.faceLeft : now.faceLeft !== pose.turned;
            const before = on.globalAlpha;
            on.globalAlpha = before * now.shown;
            if (flip) turned(on, sprite.image, sprite.w, left, top);
            else on.drawImage(sprite.image, left, top);
            if (running) dust(on, now.x, now.y, flip, stride);
            if (fight?.alert !== undefined) alertMark(on, now.x, top, fight.alert);
            if (fight?.cheer) props(on, art, "raise", now.age, now.x, now.y, sprite.h, flip, 3 + (hero % 6));
            else if (fight) armed(on, art, fight, now.x, now.y, sprite.h, 3 + (hero % 6), flip);
            else props(on, art, act, now.age, now.x, now.y + pose.hop, sprite.h, flip, 3 + (hero % 6));
            on.globalAlpha = before;
          }
        });
      });
    for (const prowl of prowls) {
      // The leaves where he came out of the wood: shaken loose, and falling.
      if (prowl.out) {
        const [ox, oy] = prowl.out;
        const age = prowl.age;
        things.push({
          y: oy + 0.2,
          draw: () => {
            for (let leaf = 0; leaf < 7; leaf++) {
              const turn = (leaf / 7) * Math.PI * 2 + 0.6;
              const reach = 2 + age * (5 + (leaf % 3) * 2);
              on.globalAlpha = Math.max(0, 1 - age / 1.2);
              on.fillStyle = LEAVES[leaf % 2];
              on.fillRect(Math.round(ox + Math.cos(turn) * reach), Math.round(oy - 4 + Math.sin(turn) * reach * 0.5 + age * age * 9), 1, 1);
            }
            on.globalAlpha = 1;
          }
        });
      }
      // Whoever is up on a roof throwing at him.
      for (const who of prowl.throwers) {
        things.push({
          y: who.foot + 0.7,
          x: who.x,
          at: who.foot,
          draw: () => {
            const sprite = art.sprite("slinger", who.frame);
            if (!sprite) return;
            const left = snap(who.x - sprite.w / 2);
            const top = snap(who.foot - who.rise - sprite.h + 3);
            if (who.left) turned(on, sprite.image, sprite.w, left, top);
            else on.drawImage(sprite.image, left, top);
          }
        });
      }
      if (prowl.puff === null && prowl.under) {
        // Under the ground: the earth he heaves up as he goes, and the crumbs of it.
        things.push({
          y: prowl.y,
          x: prowl.x,
          draw: () => {
            const mx = Math.round(prowl.x);
            const my = Math.round(prowl.y);
            on.fillStyle = "#7a5a36";
            on.fillRect(mx - 4, my - 1, 8, 2);
            on.fillRect(mx - 3, my - 3, 6, 2);
            on.fillStyle = "#a07a4c";
            on.fillRect(mx - 2, my - 4, 3, 1);
            on.fillStyle = "#5e4428";
            for (let bit = 0; bit < 3; bit++) {
              const c = (prowl.age * 2.6 + bit / 3) % 1;
              on.fillRect(Math.round(prowl.x + (bit - 1) * 4 + (bit - 1) * c * 2), Math.round(prowl.y - 4 - Math.sin(c * Math.PI) * 4), 1, 1);
            }
          }
        });
      } else if (prowl.puff === null) {
        things.push({
          y: prowl.y,
          x: prowl.x,
          shade: prowl.fade > 0.6 ? 4 : 0,
          draw: () => {
            // Quick on his feet, and quicker running away; a flinch when a stone lands; and at what he came for, a club brought down on it.
            const bird = prowl.kind === FLIER;
            const sprite = bird
              ? (art.sprite("magpie", Math.floor(prowl.age * 10)) ?? art.sprite("raider", Math.floor(prowl.age * 9)))
              : prowl.kind === MOLE
                ? (art.sprite("mole", prowl.rap === null ? Math.floor(prowl.age * 9) : 0) ?? art.sprite("raider", Math.floor(prowl.age * 9)))
                : (art.sprite("foe", prowl.rap === null ? Math.floor(prowl.age * (prowl.kind === SQUIRREL ? 14 : prowl.kind === FIZZER ? 6 : 9)) : 0, { variant: prowl.kind === SQUIRREL ? 4 : prowl.kind === FIZZER ? 5 : prowl.kind }) ??
                  art.sprite("raider", Math.floor(prowl.age * 9)));
            if (!sprite) return;
            // A flinch when he is hit; and Fizzwick, about to go off, trembles with it.
            const shake = prowl.hit ? (prowl.faceLeft ? 1.5 : -1.5) : prowl.fizz > 0.45 ? (Math.floor(prowl.age * 22) % 2 === 0 ? 0.7 : -0.7) : 0;
            const left = snap(prowl.x - sprite.w / 2 + shake);
            // On the wing he is well off the ground, rising and falling a little; his shadow stays under him on the grass.
            const lift = prowl.aloft ? 11 + Math.sin(prowl.age * 5) * 1.5 : 0;
            const top = snap(prowl.y - sprite.h + 1 - lift - (prowl.rap === null && !bird ? Math.abs(Math.sin(prowl.age * 8)) * 0.9 : 0));
            const before = on.globalAlpha;
            // Coming out of the wood he is not all there at once.
            on.globalAlpha = before * prowl.fade;
            if (prowl.faceLeft !== bird) turned(on, sprite.image, sprite.w, left, top);
            else on.drawImage(sprite.image, left, top);
            // A club for those who carry one: the squirrel, the mole and Fizzwick do it their own way.
            if (prowl.kind <= 3) club(on, prowl.x + shake, prowl.y, sprite.h, prowl.faceLeft, prowl.swing);
            if (prowl.fizz >= 0) {
              // The sprout on his head, fizzing: quicker and brighter as he gets nearer to going off.
              const quick = Math.floor(prowl.age * (10 + prowl.fizz * 16));
              on.fillStyle = quick % 2 === 0 ? "#fffbe0" : "#ffb02e";
              // (The sprout's tip is a pixel off the middle of him, two rows down his picture.)
              const tip = Math.round(prowl.x) + (prowl.faceLeft ? 0 : -1);
              on.fillRect(tip - 1 + (quick % 3), top + 1, 1, 1);
              on.fillRect(tip + (quick % 2), top - (quick % 2), 1, 1);
              if (prowl.fizz > 0.6 && quick % 2 === 0) {
                on.globalAlpha = before * 0.55;
                on.fillStyle = "#fffbe0";
                on.fillRect(left + 2, top + 2, sprite.w - 4, sprite.h - 4);
                on.globalAlpha = before * prowl.fade;
              }
            }
            on.globalAlpha = before;
            if (prowl.clash) {
              // Blades met: a cross of light between them.
              on.fillStyle = "#fffbe0";
              on.fillRect(Math.round(prowl.x) - 2, Math.round(prowl.y - 9), 5, 1);
              on.fillRect(Math.round(prowl.x), Math.round(prowl.y - 11), 1, 5);
            }
          }
        });
      }
      lights.push(() => {
        if (prowl.puff === null && prowl.rap === null && !prowl.under && prowl.left < prowl.health) {
          // What he has left, over his head, once he has been hit: a bar that goes from green to red as it shortens.
          const wide = 9;
          const top = Math.round(prowl.y - 18 * small - 3 - (prowl.aloft ? 11 * small : 0));
          const leftEdge = Math.round(prowl.x - wide / 2);
          ctx.fillStyle = "rgba(20, 24, 36, 0.75)";
          ctx.fillRect(leftEdge - 0.5, top - 0.5, wide + 1, 2);
          const share = prowl.left / prowl.health;
          ctx.fillStyle = share > 0.5 ? "#7ddc6a" : share > 0.25 ? "#f4c542" : "#f0624a";
          ctx.fillRect(leftEdge, top, Math.max(0.5, wide * share), 1);
        }
        if (prowl.hit && prowl.puff === null && !prowl.under) {
          // Where a stone or a blade landed: a star of light, for the moment of it.
          const hx = Math.round(prowl.x + (prowl.faceLeft ? 3 : -3));
          const hy = Math.round(prowl.y - 9 * small - (prowl.aloft ? 11 * small : 0));
          ctx.fillStyle = "#fffbe0";
          ctx.fillRect(hx - 2, hy, 5, 1);
          ctx.fillRect(hx, hy - 2, 1, 5);
          ctx.fillStyle = "#ffd84a";
          ctx.fillRect(hx - 1, hy - 1, 1, 1);
          ctx.fillRect(hx + 1, hy + 1, 1, 1);
        }
        for (const [sx, sy] of prowl.sparks) {
          // The throw: a quick flash where it is thrown from.
          ctx.fillStyle = "#fff6c2";
          ctx.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1);
          ctx.fillRect(Math.round(sx), Math.round(sy) - 1, 1, 3);
        }
        for (const arrow of prowl.arrows) {
          // An arrow: a short shaft along the way it is going, pale at the head.
          const ax = arrow.fx + (arrow.tx - arrow.fx) * arrow.along;
          const ay = arrow.fy + (arrow.ty - arrow.fy) * arrow.along - Math.sin(arrow.along * Math.PI) * 2;
          const long = Math.max(1, Math.hypot(arrow.tx - arrow.fx, arrow.ty - arrow.fy));
          const dx = (arrow.tx - arrow.fx) / long;
          const dy = (arrow.ty - arrow.fy) / long;
          ctx.fillStyle = "#6e4c2c";
          for (let bit = 1; bit <= 4; bit++) ctx.fillRect(snap(ax - dx * bit), snap(ay - dy * bit), 1, 1);
          ctx.fillStyle = "#f4ead0";
          ctx.fillRect(snap(ax), snap(ay), 1, 1);
        }
        for (const stone of prowl.stones) {
          // The stone, lobbed: it rises and comes down on him, with a little of where it has been behind it.
          const place = (along: number): [number, number] => [stone.fx + (stone.tx - stone.fx) * along, stone.fy + (stone.ty - stone.fy) * along - Math.sin(along * Math.PI) * 9];
          const [tx, ty] = place(Math.max(0, stone.along - 0.12));
          // A pebble, grey with the light on one corner of it: nobody is throwing snowballs.
          ctx.fillStyle = "rgba(70, 66, 60, 0.4)";
          ctx.fillRect(snap(tx), snap(ty), 1, 1);
          const [x, y] = place(stone.along);
          const size = stone.big ? 3 : 2;
          ctx.fillStyle = "#57524a";
          ctx.fillRect(snap(x), snap(y), size, size);
          ctx.fillStyle = "#d9d3c2";
          ctx.fillRect(snap(x), snap(y), 1, 1);
        }
        if (prowl.pop && prowl.puff !== null && prowl.puff < 0.13) {
          // Fizzwick, going off: a flash first.
          ctx.globalAlpha = 0.75 * (1 - prowl.puff / 0.13);
          disc(ctx, prowl.x, prowl.y - 5, 12, "#fffbe0");
          ctx.globalAlpha = 1;
        }
        if (prowl.puff !== null) {
          // Seen off: a puff of dust that spreads and thins.
          const spread = prowl.puff / (prowl.pop ? 0.8 : 0.6);
          ctx.globalAlpha = Math.max(0, 1 - spread) * 0.85;
          // Fizzwick goes off in green and white, a good deal wider.
          const bits = prowl.pop ? 12 : 6;
          const wide = prowl.pop ? 15 : 7;
          for (let bit = 0; bit < bits; bit++) {
            const turn = (bit / bits) * Math.PI * 2;
            ctx.fillStyle = !prowl.pop ? "#f4ead0" : bit % 3 === 0 ? "#fffbe0" : bit % 3 === 1 ? "#9be36a" : "#5fae4a";
            ctx.fillRect(snap(prowl.x + Math.cos(turn) * (2 + spread * wide)), snap(prowl.y - 6 + Math.sin(turn) * (1.5 + spread * wide * 0.7)), 2, 2);
          }
          ctx.globalAlpha = 1;
        }
        if (prowl.rap !== null) {
          // What he is knocking off it: bits of it, flying.
          const side = prowl.faceLeft ? -1 : 1;
          for (let chip = 0; chip < 3; chip++) {
            const c = (prowl.rap / 0.75 + chip / 3) % 1;
            ctx.globalAlpha = 1 - c;
            ctx.fillStyle = chip % 2 === 0 ? "#b98a52" : "#8d8a80";
            ctx.fillRect(snap(prowl.x + side * (6 + c * 5) + (chip - 1) * 2), snap(prowl.y - 8 - Math.sin(c * Math.PI) * 6 + c * 5), 1, 1);
          }
          ctx.globalAlpha = 1;
        }
      });
    }
    if (extras.placing) {
      const { kind, x, y } = extras.placing;
      things.push({
        y,
        x,
        draw: () => {
          on.globalAlpha = 0.75;
          stand("decor", x, y, kind);
          on.globalAlpha = 1;
        }
      });
    }
    if (extras.wall) {
      const { x, y, ok } = extras.wall;
      things.push({
        y,
        x,
        at: y + 3,
        wide: true,
        draw: () => {
          on.globalAlpha = ok ? 0.75 : 0.35;
          // As it would stand there: a post where nothing would be beside it, a length where something would.
          if (endOn(look.walls, x, y)) post(x, y);
          else piece(x, y);
          on.globalAlpha = 1;
        }
      });
    }

    drawAll(on, things, px, dusk, leanAt(extras.clock));
    haze(on, dusk);
  }, px);

  if (time !== null) {
    mouthMist(ctx, look, time, dusk);
    mouthEyes(ctx, look, time, dusk);
  }
  lights.forEach((light) => light());
  if (time !== null) smallLights(ctx, look, time, dusk);
  if (extras.floats && extras.floats.length > 0) floatsOf(ctx, extras.floats);
  for (const site of extras.bars ?? []) {
    const knocks = look.harm?.[site] ?? 0;
    if (knocks <= 0) continue;
    // How much it has left, said for a moment when it is hit and whenever it is pointed at.
    const [bx, by] = look.spots[site];
    const wide = 13;
    // A building of the first level is a good deal shorter than the room its picture has: the bar sits on its roof, not up in the air.
    const level = site === "yard0" ? (look.yard[0]?.level ?? 1) : site === "yard1" ? (look.yard[1]?.level ?? 1) : look.levels[site as BuildingId];
    const top = Math.round(by - PLOT_SIZE[site].h * small * Math.min(1, 0.42 + 0.115 * Math.max(1, level)) - 3);
    const left = Math.round(bx - wide / 2);
    const share = Math.max(0, 1 - knocks / 4);
    ctx.fillStyle = "rgba(20, 24, 36, 0.8)";
    ctx.fillRect(left - 1, top - 1, wide + 2, 4);
    ctx.fillStyle = share > 0.5 ? "#f4c542" : "#f0624a";
    ctx.fillRect(left, top, Math.max(1, Math.round(wide * share)), 2);
  }
  if (time !== null) {
    for (const site of PLACED) {
      // Knocked about badly, it smokes: thin grey, rising off the roof and thinning as it goes.
      const knocks = look.harm?.[site] ?? 0;
      if (knocks < 3) continue;
      const [bx, by] = look.spots[site];
      if (knocks >= 4) {
        // Broken, and said so over it for as long as it is: a red mark that comes and goes slowly.
        const level = site === "yard0" ? (look.yard[0]?.level ?? 1) : site === "yard1" ? (look.yard[1]?.level ?? 1) : look.levels[site as BuildingId];
        const top = Math.round(by - PLOT_SIZE[site].h * small * Math.min(1, 0.42 + 0.115 * Math.max(1, level)) - 9);
        const mx = Math.round(bx);
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(time * 2.2);
        ctx.fillStyle = "#2a1512";
        ctx.fillRect(mx - 3, top - 1, 7, 9);
        ctx.fillStyle = "#e8483a";
        ctx.fillRect(mx - 2, top, 5, 7);
        ctx.fillStyle = "#fff4e0";
        ctx.fillRect(mx, top + 1, 1, 3);
        ctx.fillRect(mx, top + 5, 1, 1);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#cfd2d6";
      for (let wisp = 0; wisp < knocks; wisp++) {
        const along = (time * 0.28 + wisp / knocks) % 1;
        ctx.globalAlpha = (1 - along) * 0.5;
        ctx.fillRect(snap(bx - 3 + wisp * 3 + Math.sin(along * 5 + wisp) * 2), snap(by - PLOT_SIZE[site].h * small * 0.8 - along * 12), 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }
  if (dusk > 0.05) {
    // What is lit by night: the burrow's windows (Pip is in there), a lantern post, a campfire, the brazier, the
    // lookout's lantern. Each a little unsteady, in its own time, as a flame is.
    const flick = (own: number, quick = 3.1) => (time === null ? 1 : 0.86 + 0.14 * Math.sin(time * quick + own * 2.7));
    if (look.levels.burrow > 0) {
      const [bx, by] = look.spots.burrow;
      const up = 10 * small;
      ctx.fillStyle = `rgba(255, 221, 140, ${(0.85 * dusk).toFixed(3)})`;
      for (const side of [-1, 1]) ctx.fillRect(Math.round(bx + side * 11 * small - 1), Math.round(by - up - 1), 2, 2);
      glow(ctx, bx - 11 * small, by - up, 7, dusk * flick(1, 2.3));
      glow(ctx, bx + 11 * small, by - up, 7, dusk * flick(2, 2.6));
      glow(ctx, bx, by - 4 * small, 9, dusk * 0.7 * flick(3, 1.9));
      // Asleep in there, unless she has been woken: it is said over the roof.
      const up2 = extras.awake !== undefined && extras.awake < AWAKE_SECONDS;
      if (extras.pip && time !== null && !up2 && dusk > 0.6 && look.jobs.length === 0) {
        ctx.fillStyle = "#e8ecff";
        for (let z = 0; z < 3; z++) {
          const along = (time * 0.3 + z / 3) % 1;
          const zx = Math.round(bx + 6 * small + along * 7 + Math.sin(along * 6 + z) * 1.5);
          const zy = Math.round(by - PLOT_SIZE.burrow.h * small - 2 - along * 9);
          ctx.globalAlpha = dusk * (1 - along) * 0.9;
          const size = z === 0 ? 2 : 3;
          ctx.fillRect(zx, zy, size, 1);
          ctx.fillRect(zx + Math.floor(size / 2), zy + 1, 1, 1);
          ctx.fillRect(zx, zy + 2, size, 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    look.decor.forEach((entry, index) => {
      if (entry.kind === 1) glow(ctx, entry.x, entry.y - 13 * small, 17, dusk * flick(index + 4));
      // The flame is ten of its picture's pixels up from the foot of it, over the logs.
      else if (entry.kind === 10) glow(ctx, entry.x, entry.y - 10 * small, 13, dusk * flick(index + 9, 5.3), "255, 170, 90");
    });
    (look.works ?? []).forEach((entry) => {
      if (entry.kind === 3) glow(ctx, entry.x, entry.y - 9 * small, 12, dusk * 0.8 * flick(entry.x, 4.1), "255, 170, 90");
    });
    if (look.lit && look.levels.tower > 0) glow(ctx, look.spots.tower[0], look.spots.tower[1] - LANTERN_UP[look.levels.tower] * small, 20, dusk * flick(7));
  }
  // What is on the air: over everything that stands, under the marks the reader put there.
  if (time !== null) {
    if (night) fireflies(ctx, time, snap);
    else drift(ctx, look.season, time, snap);
  }

  // While things are being moved about: how far the lookout throws, and where the magpies will come in.
  if (extras.reach) {
    const carried = extras.carrying?.site === "tower" ? extras.carrying : null;
    const [x, y] = carried ? [carried.x, carried.y] : look.spots.tower;
    circle(ctx, x, y - 2, extras.reach, "#fff6c2");
  }
  for (const ring of extras.rings ?? []) circle(ctx, ring.x, ring.y - 2, ring.r, ring.next ? "#ffd23f" : "#cfe4ff");
  for (const space of extras.spaces ?? []) circle(ctx, space.x, space.y - 1, space.r, "#ffb4a8");
  if (extras.path) {
    // The way they will come: a dotted line from where they come in to the larder they are after.
    const { from, to } = extras.path;
    const long = Math.hypot(to[0] - from[0], to[1] - from[1]);
    ctx.fillStyle = "#ff8a5c";
    for (let step = 4 + (Math.floor(frame / 3) % 6); step < long; step += 6) {
      ctx.fillRect(Math.round(from[0] + ((to[0] - from[0]) * step) / long), Math.round(from[1] + ((to[1] - from[1]) * step) / long), 2, 2);
    }
  }
  if (extras.from) {
    ctx.fillStyle = "#ff8a5c";
    const blink = Math.floor(frame / 6) % 2 === 0;
    for (let step = 0; step < 5; step++) {
      const along = 18 + step * 44;
      const [x, y] =
        extras.from === "left" ? [2, 56 + step * 13] : extras.from === "right" ? [GAME_W - 5, 56 + step * 13] : extras.from === "top" ? [along, 48] : [along, GAME_H - 4];
      if (blink || step % 2 === 0) ctx.fillRect(x, y, 3, 3);
    }
  }

  // Acorns waiting on the oak: one bobbing over it, when a tap will take them in. With the larder full it sits still
  // and low in the leaves, a little faded: there, but asking nothing (a tap says why, BaseScreen's `gatherOak`).
  if ((look.oakReady || look.oakFull) && look.levels.oak > 0) {
    const acorn = art.sprite("acorn", frame);
    const oak = boxOf("oak", look.spots.oak);
    const shake = extras.oakShake ? oakShakeOffset(extras.oakShake.kind, extras.oakShake.age) : 0;
    if (acorn && look.oakReady) {
      const bob = time === null ? Math.round(Math.sin((frame / ART_FPS) * Math.PI * 2) * 1.5) : snap(Math.sin(time * 3.2) * 1.8);
      ctx.drawImage(acorn.image, look.spots.oak[0] - Math.round(acorn.w / 2), oak.top - 2 + bob);
    } else if (acorn) {
      ctx.globalAlpha = 0.72;
      ctx.drawImage(acorn.image, look.spots.oak[0] - Math.round(acorn.w / 2) + shake, oak.top + 3);
      ctx.globalAlpha = 1;
    }
  }
  // A gathering shakes a few leaves out of the crown: they drift down and are gone, each at whole pixels.
  if (extras.oakShake?.kind === "gather" && extras.oakShake.age < LEAF_FALL_SECONDS && look.levels.oak > 0) {
    const age = extras.oakShake.age;
    const oak = boxOf("oak", look.spots.oak);
    const colours = LEAF_COLOURS[look.season % 4];
    ctx.globalAlpha = Math.max(0, Math.min(1, (LEAF_FALL_SECONDS - age) / 0.3));
    for (let leaf = 0; leaf < LEAVES_LET_GO; leaf++) {
      const start = look.spots.oak[0] + (leaf - (LEAVES_LET_GO - 1) / 2) * 6;
      const fall = age * (14 + leaf * 3);
      const sway = Math.sin(age * 9 + leaf * 1.7) * 2;
      ctx.fillStyle = colours[leaf % 2];
      ctx.fillRect(snap(start + sway), snap(oak.top + 8 + (leaf % 3) * 3 + fall), 2, 1);
    }
    ctx.globalAlpha = 1;
  }
  // Acorns just gathered: each in an arc from the oak's crown to the larder's door.
  if (extras.flying && extras.flying.length > 0) {
    const acorn = art.sprite("acorn", frame);
    const from = [look.spots.oak[0], look.spots.oak[1] - PLOT_SIZE.oak.h + 10];
    const to = [look.spots.store[0], look.spots.store[1] - 12];
    for (const along of extras.flying) {
      if (!acorn || along <= 0 || along >= 1) continue;
      const x = from[0] + (to[0] - from[0]) * along;
      const y = from[1] + (to[1] - from[1]) * along - Math.sin(along * Math.PI) * 24;
      ctx.drawImage(acorn.image, snap(x - acorn.w / 2), snap(y - acorn.h / 2));
    }
  }
  // The morning after: the magpies on their way off, right to left across the sky.
  if (extras.magpies !== null && extras.magpies !== undefined) {
    const magpie = art.sprite("magpie", frame);
    if (magpie) {
      for (let bird = 0; bird < 3; bird++) {
        const along = extras.magpies - bird * 0.12;
        if (along > 0 && along < 1) ctx.drawImage(magpie.image, snap(GAME_W - along * (GAME_W + 40)), snap(10 + bird * 9 + Math.sin(along * 14 + bird) * 2));
      }
    }
  }

  // The mark over what is chosen floats, rather than ticking up and down a pixel at a time.
  const bob = time === null ? null : snap(Math.sin(time * 3.4) * 1.6);
  if (extras.mark) marker(ctx, extras.mark.x, extras.mark.y - extras.mark.up * THINGS, frame, bob);
  if (extras.selected && !extras.carrying) marker(ctx, look.spots[extras.selected][0], boxOf(extras.selected, look.spots[extras.selected]).top, frame, bob);
  const chosen = extras.selectedDecor !== undefined && extras.selectedDecor >= 0 ? look.decor[extras.selectedDecor] : null;
  if (chosen) marker(ctx, chosen.x, chosen.y - 18, frame, bob);
};

/** The most of a card's layout that is drawn, as the camp's own rules have it (`pip/base/rules.ts`): pieces of fence, things set down, and kinds of thing. */
const SUMMARY_WALLS = 32;
const SUMMARY_DECOR = 24;
const SUMMARY_DECOR_KINDS = 18;
/** A place from a card, if it is one: two whole numbers inside the scene. */
const spotOfSummary = (raw: unknown): Spot | null => {
  if (!Array.isArray(raw)) return null;
  const [x, y]: unknown[] = raw;
  return typeof x === "number" && typeof y === "number" && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x <= GAME_W && y >= 0 && y <= GAME_H ? [x, y] : null;
};
/** A thing set down, from a card, if it is one: a kind the camp has, at a place. */
const decorOfSummary = (raw: unknown): Decor | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, x, y } = raw as Record<string, unknown>;
  const spot = spotOfSummary([x, y]);
  return spot && typeof kind === "number" && Number.isInteger(kind) && kind >= 0 && kind < SUMMARY_DECOR_KINDS ? { kind, x: spot[0], y: spot[1] } : null;
};
/** The first so many entries of a card's list that can be read; none if it is not a list. */
const listOfSummary = <T>(raw: unknown, most: number, read: (entry: unknown) => T | null): T[] =>
  (Array.isArray(raw) ? raw : [])
    .map(read)
    .filter((entry): entry is T => entry !== null)
    .slice(0, most);

/** The most of a card's landscape and defences that is read, how many kinds of each there are, and the guardians' posts with the rank one stops at. */
const SUMMARY_LAND = 30;
const SUMMARY_LAND_KINDS = 10;
const SUMMARY_WORKS = 12;
const SUMMARY_WORK_KINDS = 12;
const SUMMARY_GUARDS = 7;
const SUMMARY_GUARD_RANK = 3;
/** Something that stands at a place, from a card, if it is one: a kind there is (so many of them, from 0), inside the scene. */
const thingOfSummary =
  (kinds: number) =>
  (raw: unknown): { kind: number; x: number; y: number } | null => {
    if (typeof raw !== "object" || raw === null) return null;
    const { kind, x, y } = raw as Record<string, unknown>;
    const spot = spotOfSummary([x, y]);
    return spot && typeof kind === "number" && Number.isInteger(kind) && kind >= 0 && kind < kinds ? { kind, x: spot[0], y: spot[1] } : null;
  };
/** The landscape set about a camp (ponds, a knoll, trees), from a card: the first thirty pieces that can be read; none if it is not a list. */
export const summaryLand = (raw: unknown): Array<{ kind: number; x: number; y: number }> => listOfSummary(raw, SUMMARY_LAND, thingOfSummary(SUMMARY_LAND_KINDS));
/** A camp's defences, from a card: the first four that can be read; none if it is not a list. */
export const summaryWorks = (raw: unknown): Array<{ kind: number; x: number; y: number }> => listOfSummary(raw, SUMMARY_WORKS, thingOfSummary(SUMMARY_WORK_KINDS));
/** Where a friend's guardians have their signposts, from a card, if it says: seven entries, each a place on the grass or nothing (still beside their building). Anything else says nothing of them. */
export const summaryPosts = (raw: unknown): { posts?: Partial<Record<number, readonly [number, number]>> } => {
  if (!Array.isArray(raw) || raw.length !== SUMMARY_GUARDS) return {};
  const posts: Partial<Record<number, readonly [number, number]>> = {};
  raw.forEach((entry, guard) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !entry.every((part) => typeof part === "number" && Number.isInteger(part))) return;
    const [x, y] = entry as [number, number];
    if (x >= 8 && x <= GAME_W - 8 && y >= 52 && y <= 116) posts[guard] = [x, y];
  });
  return { posts };
};
/** The guardians' ranks, from a card, if they are that: seven whole numbers, 0 to 3. Anything else says nothing of them. */
export const summaryGuards = (raw: unknown): { guards?: readonly number[] } =>
  Array.isArray(raw) && raw.length === SUMMARY_GUARDS && raw.every((rank) => typeof rank === "number" && Number.isInteger(rank) && rank >= 0 && rank <= SUMMARY_GUARD_RANK) ? { guards: [...(raw as number[])] } : {};

/**
 * A camp as a friend's card describes it: its levels and counts, laid out as
 * its reader has it (where each building stands, each piece of fence, each
 * thing set down).
 *
 * The layout may not be there: a card from an older app, or kept by an older
 * server, has none. A building with no place on the card (or one that is not
 * a place in the scene) stands where a camp begins, and with no fence or
 * decorations listed none are drawn. What comes from a server is not taken
 * on trust: only whole numbers inside the scene, and no more of them than a
 * camp can hold.
 */
export const lookOfSummary = (
  summary: {
    levels: Record<BuildingId, number>;
    yard: ReadonlyArray<{ kind: Yard["kind"]; level: number }>;
    banners: number;
    trophies: number;
    spots?: Partial<Record<Placed, readonly number[]>> | null;
    walls?: ReadonlyArray<readonly number[]> | null;
    decor?: ReadonlyArray<{ kind: number; x: number; y: number }> | null;
    land?: ReadonlyArray<{ kind: number; x: number; y: number }> | null;
    works?: ReadonlyArray<{ kind: number; x: number; y: number }> | null;
    guards?: readonly number[] | null;
  },
  season: number
): CampLook => ({
  levels: Object.fromEntries(BUILDINGS.map((building) => [building, Math.min(MAX_LEVEL, Math.max(0, Math.floor(summary.levels?.[building] ?? 0)))])) as Record<BuildingId, number>,
  yard: [0, 1].map((slot) => ({ kind: summary.yard?.[slot]?.kind ?? null, level: Math.min(YARD_MAX, Math.max(0, Math.floor(summary.yard?.[slot]?.level ?? 0))) })),
  spots: Object.fromEntries(PLACED.map((site) => [site, spotOfSummary((summary.spots as Record<string, unknown> | null | undefined)?.[site]) ?? DEFAULT_SPOTS[site]])) as Record<Placed, Spot>,
  walls: listOfSummary(summary.walls, SUMMARY_WALLS, spotOfSummary),
  jobs: [],
  season,
  night: false,
  lit: false,
  // Only how many, not which months: the last few seasons, counted back from this one.
  banners: Array.from({ length: Math.min(BANNERS_SHOWN, Math.max(0, summary.banners)) }, (_, index) => (season + 4 - index) % 4).reverse(),
  // Only how many, not which books: a stack of books for each.
  trophies: Array.from({ length: Math.min(TROPHIES_SHOWN, Math.max(0, summary.trophies)) }, () => 0),
  decor: listOfSummary(summary.decor, SUMMARY_DECOR, decorOfSummary),
  visitor: false,
  oakReady: false,
  land: summaryLand(summary.land),
  works: summaryWorks(summary.works),
  ...summaryGuards(summary.guards),
  ...summaryPosts((summary as { posts?: unknown }).posts)
});
