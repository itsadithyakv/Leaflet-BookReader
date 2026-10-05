import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { itemBox, renderHouseLevel, renderItem, type HouseLevel, type HouseSlot, type LevelDecor } from "../../pip/home.js";
import { LIB } from "../../pip/core";
import {
  PEEK_S,
  activityAt,
  bedtimeScroll,
  bundled,
  caughtLine,
  chooseActivity,
  coldPace,
  coldRest,
  fidget,
  fidgetGap,
  fidgetsBetween,
  fridgeVisit,
  gazeAt,
  gazeMove,
  goodbyeLine,
  greetVisitor,
  innocentLine,
  knockedLine,
  morningFridge,
  nightStir,
  peekLine,
  planActivity,
  quiltLine,
  spookedTonight,
  stopForVisitor,
  scrollSession,
  scrollWindDown,
  shutOnHerLine,
  snoozeLine,
  snoozes,
  upLine,
  SNOOZE_S,
  type Activity,
  type ActivityId,
  type ScrollBeat,
  type Spot,
  type SpotKind,
  type World
} from "../../pip/behaviour";
import { markStopSaid, readStop, stopRemark } from "../../pip/readingMoments";
import { setWorldStub, worldStub } from "../../pip/worldStub";
import {
  HARD_LANDING,
  PIP_BOUNCE,
  caught,
  flyStep,
  holdMove,
  holdStart,
  holdStep,
  letGo,
  nearUpright,
  playCounts,
  pokeAgain,
  pokeReaction,
  releaseVelocity,
  rollStep,
  strokeMove,
  strokeStart,
  type Body,
  type PlayKind,
  type Poke,
  type Sample,
  type Stroke
} from "../../pip/play";
import { BARREL_H, BARREL_W, PLOT_H, PLOT_W, renderBarrel, renderGardenBed, renderGardenFloor, renderPlant } from "../../pip/garden.js";
import { gardenLayout } from "../../pip/gardenRows";
import { subscribeTick } from "../../pip/ticker";
import { onPipCue } from "../../pip/life";
import { playSound } from "../../pip/sound";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";
import { usePipStore } from "../../store/pipStore";
import { PipSprite } from "../PipSprite";
import { PipSay } from "../PipSay";
import { UiIcon } from "../UiIcon";
import { sceneScale } from "./sceneFit";
import { watchPixelRatio } from "./pixelRatio";
import { floorPoint } from "./layout";
import { fixtureKey, useFurnishings, type FurnishPip, type Fridge, type RoomChange } from "./furnishings";
import { readingMove } from "../../pip/furnish-art.js";
import { bedSleep, dark, fridgeFetch, fridgeHope, fridgeNothing, fridgeShutOnHer, fridgeStand, type Reaction } from "../../pip/furnish";
import type { GameId } from "./arcade/games";
import type { ArcadePage } from "./arcade/ArcadeOverlay";
import { GardenSky } from "./GardenSky";
import "./pipLife.css";
import { banner, burst, centerOf, confetti, dropSeed, floatText, popOff, puff, rain, seedPixel, tossSeed, type Box, type Captured, type Point } from "./fx";

/**
 * The room loops this many frames (4 s at 12 fps) so lamps flicker and fish
 * swim. The windows show the real time of day, fixed across the loop (they
 * used to run 1.6 hours of sky every loop and snap back). Each frame is drawn
 * once and kept, until the time of day moves on (every 10 minutes).
 */
const ROOM_LOOP = 48;
/** Pip's stroll, in floor pixels per second. */
const WALK_SPEED = 22;
/** On tiptoe to the fridge after dark, in floor pixels per second. */
const TIPTOE_SPEED = 13;
/** After the ball, and bringing it back, in floor pixels per second. */
const RUN_SPEED = 66;
const CARRY_SPEED = 34;
/** The ball's middle rests this far above where Pip's feet go. */
const BALL_RADIUS = 3;
/** The ball's button, in floor pixels: a little more than the ball, so it is easy to take hold of. */
const BALL_BOX = 12;
/** A ball nobody has touched for this long is put away. */
const BALL_IDLE_MS = 30_000;
/** Stroking that stops this long has ended; shorter than this, it was a brush, not a stroke. */
const TOUCH_GAP_MS = 750;
const TOUCH_MIN_MS = 900;
/** Hearts rise (and she purrs) this often while she is stroked. */
const TOUCH_FX_MS = 520;
/** A turn to face the other way: edge-on halfway through. */
const TURN_MS = 170;
/** Her eyes follow a pointer that moved this recently, and look for it this often. */
const GAZE_FRESH_MS = 2600;
const GAZE_EVERY_MS = 130;
/** What the reader just did colours what she feels like doing, for this long. */
const JUST_NOW_MS = 60_000;
/** Without motion, a pose is held this long before the next. */
const STILL_GAP_MS = 14_000;
/** How far the pointer moves before a press on Pip becomes a carry. */
const DRAG_SLOP = 4;
/** Where the hand holds Pip: by the leaf, so its feet hang this far below. */
const HOLD_DROP = 26;
/**
 * What Pip turns about, in her 32 pixel frame: the leaf while she hangs from
 * the hand, her middle in the air. The two are HOLD_REACH apart (pip/play.ts),
 * which is how letting go keeps her where she is.
 */
const TURN_HELD = "50% 12%";
const TURN_AIR = "50% 60%";
/** Picked up by the body, she slides into the hand by her leaf: how fast (per second). */
const GRIP_EASE = 16;
/** Landed at a tilt, she rights herself in this long. */
const RIGHT_MS = 160;
/** A piece of decor dropping into its spot, and when it hits the floor (in step with the CSS). */
const DROP_MS = 540;
const DROP_LAND_MS = 330;
/** How far above its spot a piece of decor starts its drop, in floor pixels. */
const DROP_FROM = 26;
/** A seed tossed from a packet to above its plot, then dropped in. */
const TOSS_MS = 480;
const SEED_FALL_MS = 300;
/** The soil's top edge within a plot sprite (garden.js: SOIL_H is 7). */
const SOIL_TOP = PLOT_H - 8;

// ---- Pip's own life in the house ----------------------------------------------------
// Pip keeps herself busy. Left alone she does one thing after another, each
// with a beginning, a middle and an end (pip/behaviour.ts chooses and plans
// them): to the books and one taken down, a good read, a yawn, the book put
// back. Between them she stands about, shifting her weight, looking round,
// her eyes on the pointer if it is near. What the house itself asks for comes
// first: a piece just put out to go and see, a ripe plant to point at, bed.

/** Bedtime, as the roaming Pip keeps it (PipWorld): late at night. */
const bedtime = (hour: number) => hour >= 22 || hour < 5;
/**
 * Pip in the Snug Bed (room.js, 42 x 24): his middle over the pillow, low
 * enough that his closed eyes sit at the quilt's top edge (the sleep pose's
 * eyes are 8 rows above its feet).
 */
const BED_PIP_X = 11;
const BED_PIP_Y = 17;
/**
 * From the quilt's top row down, the bed is drawn again over Pip, so he is
 * under the covers; except over the pillow, where his head rests on it.
 */
const BED_FRONT = 9;
const BED_PILLOW = { x: 5, w: 11, h: 7 };
/** A hop into bed. */
const HOP_MS = 420;
/** Woken, Pip stays up a while before going back to bed. */
const WOKEN_MS = 45_000;
/** A ripe plant is pointed out no more often than this. */
const POINT_EVERY_MS = 16_000;
/** A line of Pip's own (not the page's) stays up this long. */
const OWN_LINE_MS = 3600;
/** After her look in a fridge the reader opened she stays by it this long, and minds if it shuts. */
const HOPE_STAYS_MS = 6000;
/** A piece of decor just put out is looked at once it has landed, and a beat. */
const VISIT_AFTER_MS = DROP_MS + 350;

/** Back from an expedition with nothing to show for it. */
const HOME_LINES = ["i'm back.", "home again.", "nothing worth carrying. nice walk, though."];
/** How far beyond the side wall she comes in from (and visitors too: pip/visitors.ts, `defaultDoor`). */
const DOOR_BEYOND = 14;
/** Where a thing held over her head sits in her 32 pixel frame: its foot on her raised hands, its middle over hers. */
const HELD_FOOT = 13;

/** A note left while she is out: a scrap of paper, a line of writing, a pin. Drawn once. */
let notePaper: ImageData | null = null;
const noteImage = () => {
  if (notePaper) return notePaper;
  const rows = ["..PPPPPPP", ".PWWWRWWP", ".PWWWWWWP", ".PWLLLLWP", ".PWWWWWWP", ".PWLLLWWP", ".PWWWWWWP", ".PPPPPPPP"];
  const ink: Record<string, [number, number, number]> = { P: [94, 85, 68], W: [255, 246, 223], L: [179, 163, 131], R: [224, 57, 62] };
  const image = new ImageData(9, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((mark, x) => {
      const colour = ink[mark];
      if (colour) image.data.set([...colour, 255], (y * 9 + x) * 4);
    })
  );
  notePaper = image;
  return image;
};

const GREETINGS = ["you're back! good chapter?", "there you are. how was the book?", "welcome back, reader.", "back already? tell me everything."];
const RIPE_LINES = ["that one's ripe!", "ooh, pick that one.", "ripe and ready.", "seeds, right there."];
/** Focus sessions done when Pip last said hello (a preference of this device). */
const GREETED_KEY = "leaflet.pip.greetedSessions";
/** The barrel's water when the garden was last on screen, so new water can rain into it. */
const BARREL_SEEN_KEY = "leaflet.pip.barrelSeen";

const readNumber = (key: string) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  } catch {
    return null;
  }
};
const writeNumber = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Remembered for this visit only.
  }
};

const pickOne = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

/**
 * Something Pip goes and does in a free moment: look at a new piece, point
 * out a ripe plant, go to bed, yawn, or a cue from the page (a wish granted).
 */
type Errand = {
  /** `hope`: to a fridge the reader opened; `snack`: to the fridge herself, for the snack the reader is choosing. */
  kind: "visit" | "ripe" | "bed" | "cue" | "yawn" | "hope" | "snack" | "back";
  /** Where to stand, in floor pixels; null: where he is. */
  x: number | null;
  /** Which way to face there. */
  face?: 1 | -1;
  move: string;
  loops: number;
  line?: string | null;
  /** Not before this (nowMs()). */
  after: number;
  /** Afterwards: into bed; or (up in the morning) over to the fridge for a look. */
  then?: "tuck" | "fridge";
  /** At a run, not a stroll; or on tiptoe (back to bed from the fridge). */
  hurry?: boolean;
  tiptoe?: boolean;
  /** To bed with the phone: what she does with it once she is in. */
  scroll?: ScrollBeat[];
  /** The fridge it is about (its name among the furnishings). */
  fridge?: string;
  /** The move she walks there with, when it is not her stroll (`back`: the find held up). */
  as?: string;
};

/**
 * The scene's clock: the page's own, plus whatever the development hook has
 * wound it on by (window.__pipHouse, below). A hidden window gets no frames,
 * so the only way to watch Pip's day there is to step the clock by hand.
 */
let clockSkew = 0;
const nowMs = () => performance.now() + clockSkew;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export type SceneAct = { move: string; loops: number; key: number };

/** What Pip has to keep herself busy with (pages/pip/usePipActs.ts gathers it). */
export type Repertoire = {
  /** Her signature move. */
  signature: string;
  /** Hobbies: the free ones and every move bought. */
  hobbies: readonly string[];
  /** The dances among the moves bought. */
  dances: readonly string[];
  /** The toys she owns, as their moves. */
  toys: readonly string[];
};

/** One garden plot as the scene draws it. */
export type ScenePlot = {
  plot: number;
  /** null: empty soil. */
  plant: string | null;
  /** 0..1 */
  progress: number;
  ripe: boolean;
  /** Not dug yet: shown as a spot to buy. */
  locked?: boolean;
  /** What digging it costs, for the sign on a locked plot. */
  price?: number;
};

/**
 * What the page can ask of the scene: where things are on screen (for effects
 * that fly to them) and the garden's own moments, which need the plot sprites.
 */
export type HouseSceneHandle = {
  /** One art pixel, in CSS pixels. */
  pixel: () => number;
  room: () => DOMRect | null;
  /** Pip's box on screen; null while Pip is away (in a game). */
  pip: () => DOMRect | null;
  /** A point on Pip: the mouth (for food) or the top of the head (hearts rise from it). */
  pipPoint: (part: "mouth" | "head") => Point | null;
  /** Where an item will sit in a slot of this floor, lifted by the drop it lands with. */
  dropStart: (slotId: string, itemId: string) => Box | null;
  /** A just-picked plant springs off its plot. Returns where it stood. */
  reap: (plot: number, plantId: string) => Box | null;
  /** The planting about to land in this plot sprouts in once its seed is down. */
  expectSprout: (plot: number, tossed: boolean) => void;
  /** A seed flies from a packet (if given), drops into the plot, and the soil puffs. */
  sow: (plot: number, from: Captured | null) => void;
  /** Rain on these plots, saying how much water each took. Resolves as the last drop lands. */
  rain: (plots: Array<{ plot: number; gained: number }>) => Promise<void>;
  /** A plot's bed on screen (for the packet picker to sit over), or null when it is not on this floor. */
  plotBox: (plot: number) => Box | null;
  /** Confetti and a title over the room, for a big moment. */
  celebrate: (title: string, note: string) => void;
  /** Plays with Pip as the hand would: for the Play keys, so nothing needs a pointer. */
  playWith: (how: "pet" | "tickle" | "ball" | "toss" | "bed" | "snack") => void;
  /** A visitor has knocked, has reached their place, or has left: she answers, if she is free to. */
  visitor: (what: "knocked" | "arrived" | "left") => void;
};

/**
 * The room, for something laid over it (a visitor, a note on the door): how
 * big a floor pixel is on screen, the floor's size, and where Pip is. An
 * overlay places itself in floor pixels times `scale`.
 */
export type RoomFrame = {
  /** CSS pixels a floor pixel. */
  scale: number;
  /** The floor, in floor pixels. */
  w: number;
  h: number;
  /** Where feet stand. */
  walkY: number;
  floorId: string;
  /** The room is dimmed for the evening. */
  night: boolean;
  /** Pip, now: where her feet are (floor pixels), which way she faces, what she is at, and whether she is out of the house. */
  pip: () => { x: number; y: number; facing: 1 | -1; phase: string; away: boolean };
  /** What stands on the floor line (left edge and width, floor pixels): the bed, the pieces on the floor, the fridge. */
  floor: () => Array<{ x: number; w: number }>;
};

/** Evenings (and nights) the house dims and its lamps glow. */
const isEvening = (hour: number) => hour >= 19 || hour < 6;

/** Whether this floor is dark now: always-dark floors, and every floor in the evening. */
const nightNow = (level: HouseLevel) => level.night || isEvening(new Date().getHours());

/** A plant's drawn stage from its growth, as garden.js draws it: 0 seed, 1 sprout, 2 young, 3 grown. */
const plantStage = (progress: number) => (progress <= 0.02 ? 0 : progress < 0.34 ? 1 : progress < 0.75 ? 2 : 3);

/** The time of day the windows show: the hour, to the nearest 10 minutes. */
const clockHour = (date = new Date()) => date.getHours() + Math.floor(date.getMinutes() / 10) / 6;

/** Where the garden's plots sit on a floor: in two rows across the lawn (pip/gardenRows.ts). */
export const plotBoxes = (level: HouseLevel, count: number) => gardenLayout(level.w, level.floorY, count).plots;

/** The arcade's machines: the game each one plays (the jukebox plays a dance). */
const MACHINES: Record<string, { game: GameId | "dance"; label: string }> = {
  arcadecabinet: { game: "dash", label: "The arcade cabinet: play Pip Dash" },
  tvconsole: { game: "flap", label: "The TV and console: play Page Flap" },
  clawmachine: { game: "catch", label: "The claw machine: play Leaf Catch" },
  jukebox: { game: "dance", label: "The jukebox: a dance with Pip" }
};

/** How to play with Pip, for her label: every way has a key. */
const PIP_HOW = "Select to poke, drag to carry and throw, left and right arrows to walk, up arrow to toss. More ways to play are under Play.";

/** The piece of decor Pip sleeps in. */
const BED_ID = "bed";

/** Where the bed stands on this floor, if it is out: its box in floor pixels. */
const bedBox = (level: HouseLevel, decor: LevelDecor) => {
  const placed = decor.placed.find((entry) => entry.itemId === BED_ID);
  const slot = placed ? level.slots.find((entry) => entry.id === placed.slot) : null;
  return slot ? itemBox(BED_ID, slot) : null;
};

/** The air Pip can be thrown through: in from the walls, under the ceiling, down to where she walks. */
const airBounds = (level: HouseLevel) => ({ left: 12, right: level.w - 12, top: 30, floor: level.walkY });

/** What each piece of decor is to Pip: somewhere to take a book from, to sit, to look out of. */
const SPOT_OF: Record<string, SpotKind> = {
  bed: "bed",
  bookstack: "books",
  bookshelf: "books",
  tallshelf: "books",
  desk: "books",
  lectern: "books",
  armchair: "seat",
  beanbag: "seat",
  readingchair: "seat",
  readingnook: "seat",
  catbed: "seat",
  hammock: "seat",
  rug: "seat",
  window: "window",
  roundwindow: "window",
  archedwindow: "window",
  baywindow: "window",
  stainedglass: "window",
  skylight: "window",
  plant: "plant",
  tulips: "plant",
  bonsai: "plant",
  sunflowers: "plant",
  recordplayer: "music",
  jukebox: "music",
  piano: "music",
  arcadecabinet: "cabinet",
  clawmachine: "cabinet",
  tvconsole: "cabinet"
};
/** Things Pip stands in front of (or on) rather than beside. */
const STAND_AT: ReadonlySet<SpotKind> = new Set<SpotKind>(["seat", "window"]);

/**
 * The places on this floor Pip can go to do something: the decor that is out,
 * the glass wall of the garden (a window anywhere along it), and the plots
 * with something growing in them.
 */
export const roomSpots = (level: HouseLevel, decor: LevelDecor, plots: readonly ScenePlot[] | undefined): Spot[] => {
  const spots: Spot[] = [];
  for (const { slot: slotId, itemId } of decor.placed) {
    const kind = SPOT_OF[itemId];
    const slot = kind ? level.slots.find((entry) => entry.id === slotId) : null;
    const box = slot ? itemBox(itemId, slot) : null;
    if (!kind || !slot || !box) continue;
    const up = STAND_AT.has(kind) || slot.fits === "wall" || slot.fits === "window" || slot.fits === "top" || slot.fits === "ceiling";
    spots.push({ kind, x: box.x + box.w / 2, w: box.w, up, id: itemId });
  }
  if (level.garden) {
    spots.push({ kind: "window", x: level.w * 0.45, w: 40, up: true, id: "sky" });
    const beds = plotBoxes(level, plots?.length ?? 0);
    (plots ?? []).forEach((plot, index) => {
      if (plot.plant && !plot.ripe && !plot.locked) spots.push({ kind: "plot", x: beds[index].x + beds[index].w / 2, w: beds[index].w, id: `plot-${plot.plot}` });
    });
  }
  return spots;
};

/** A move's length in frames (12 a second), for turning seconds into whole loops. */
const loopFrames = (move: string) => LIB.find((entry) => entry.id === move)?.loop ?? 48;
const loopsFor = (move: string, seconds: number) => Math.max(1, Math.round((seconds * 12) / loopFrames(move)));

/** Where the rain barrel stands on a garden floor: the right-hand corner, beyond the last plot. */
const barrelBox = (level: HouseLevel) => ({ x: level.w - BARREL_W - 1, y: level.h - BARREL_H - 2, w: BARREL_W, h: BARREL_H });

// The barrel is drawn at a dozen levels of full, each once and kept.
const barrelArt = new Map<number, ImageData>();
const barrelImage = (fill: number) => {
  const step = Math.round(Math.max(0, Math.min(1, fill)) * 12);
  let image = barrelArt.get(step);
  if (!image) {
    image = renderBarrel(step / 12);
    barrelArt.set(step, image);
  }
  return image;
};

/**
 * Where a slot's pin goes, in floor pixels: on the thing in it, or where a
 * thing would stand (the floor, the shelf), hang (the wall) or dangle (the
 * ceiling). Pins, not the slots' whole boxes: the boxes overlap each other.
 */
const pinPoint = (slot: HouseSlot, inside: { x: number; y: number; w: number; h: number } | null): Point => {
  if (inside) return { x: inside.x + inside.w / 2, y: inside.y + inside.h / 2 };
  const x = slot.x + slot.w / 2;
  if (slot.fits === "ceiling") return { x, y: slot.y + 8 };
  if (slot.fits === "wall" || slot.fits === "window") return { x, y: slot.y + slot.h / 2 };
  if (slot.fits === "stand") return { x, y: slot.y + slot.h - 12 };
  return { x, y: slot.y + slot.h - 5 };
};

// The bed (its rows, and a dug mark at each empty plot) is one picture, drawn
// again only when a plot is dug, planted or picked; plants are a handful per
// plot and stage. Each is drawn once and kept, like the room's frames.
const bedArt = new Map<string, ImageData>();
const bedImage = (level: HouseLevel, plots: readonly ScenePlot[]) => {
  const dug = plots.filter((plot) => !plot.locked).length;
  const key = `${level.w}|${level.floorY}|${plots.map((plot) => (plot.locked ? "x" : plot.plant ? "p" : "e")).join("")}`;
  let image = bedArt.get(key);
  if (!image) {
    if (bedArt.size > 80) bedArt.clear();
    const layout = gardenLayout(level.w, level.floorY, plots.length, dug);
    image = renderGardenBed(
      level.w,
      layout.rows.map((row) => ({ ...row, y: row.y - level.floorY })),
      // Where a plant would stand: the plot's middle, a pixel into the furrow.
      layout.plots.flatMap((box, index) => (plots[index].locked || plots[index].plant ? [] : [{ x: box.x + box.w / 2, y: box.y + SOIL_TOP + 2 - level.floorY }]))
    );
    bedArt.set(key, image);
  }
  return image;
};
const plantArt = new Map<string, ImageData>();
const plantImage = (plant: string, step: number, ripe: boolean, frame: number) => {
  const key = `${plant}|${step}|${ripe}|${frame}`;
  let image = plantArt.get(key);
  if (!image) {
    if (plantArt.size > 600) plantArt.clear();
    image = renderPlant(plant, step / 20, ripe, frame);
    plantArt.set(key, image);
  }
  return image;
};

/** Still art at the room's scale, crisp like the floor under it. */
const SceneArt = ({ image, scale, className, style }: { image: ImageData | null; scale: number; className?: string; style?: CSSProperties }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);
  if (!image) return null;
  return (
    <canvas
      ref={ref}
      className={`pip-sprite ${className ?? ""}`}
      style={{ width: image.width * scale, height: image.height * scale, ...style }}
      aria-hidden="true"
    />
  );
};

/** A plant on its bed; a ripe one glints and sways on the shared 12 fps clock. */
const PlantArt = ({ plant, step, ripe, scale, className, style }: { plant: string; step: number; ripe: boolean; scale: number; className: string; style?: CSSProperties }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = PLOT_W;
    canvas.height = PLOT_H;
    const draw = (frame: number) => context.putImageData(plantImage(plant, step, ripe, frame), 0, 0);
    draw(0);
    if (!ripe || prefersReducedMotion()) return;
    return subscribeTick((tick) => draw(tick % ROOM_LOOP));
  }, [plant, step, ripe]);
  return <canvas ref={ref} className={`pip-sprite ${className}`} style={{ width: PLOT_W * scale, height: PLOT_H * scale, ...style }} aria-hidden="true" />;
};

export type HouseSceneProps = {
  level: HouseLevel;
  /** The floor's place in the house, bottom first: which way a switch slides. */
  floorIndex?: number;
  decor: LevelDecor;
  skin: string;
  outfit: readonly string[];
  /** Something Pip does now (a poke, a treat, a celebration), in place. */
  act: SceneAct | null;
  onActDone: () => void;
  line: string | null;
  /** What Pip can do with a free moment: the moves she knows and the toys she has. */
  repertoire: Repertoire;
  /** Pip's mood, 0 to 100: what she feels like doing follows it. */
  mood: number;
  /** Pip's mood is very low: it mopes when resting. */
  mopey: boolean;
  /** Poked past her own answers: one of the page's surprises. */
  onPoke: () => void;
  /** A bout of play that counts (stroked a while, the ball brought back): the page cheers her up for it. */
  onPlayed?: (kind: PlayKind) => void;
  /** The ball she fetches: her own (the toy), or a ball of scrap paper. */
  ownBall?: boolean;
  /** She is being pointed at (the walkthrough): she stands where she is, not off on her own business. */
  attentive?: boolean;
  decorating: boolean;
  /** The slot being chosen for in the Decorate drawer, lit in the room. */
  selectedSlot?: string | null;
  onSlot: (slot: HouseSlot) => void;
  /** Names what is in a slot, for its label. */
  slotLabel: (slot: HouseSlot) => string;
  /** An arcade machine on this floor was selected: its game (or, with none of its own, the list); or a page of the arcade's, for a thing that opens one (the word quiz). */
  onArcade?: (game: GameId | ArcadePage | null) => void;
  /** The jukebox was selected: a dance. */
  onJukebox?: () => void;
  /** Pip is elsewhere (in a game): the room shows without it. */
  hidePip?: boolean;
  /** The garden's plots, on a garden floor. */
  plots?: ScenePlot[];
  onPlot?: (plot: ScenePlot) => void;
  /** An empty plot was selected: the page opens its packet picker there (instead of `onPlot`). */
  onEmptyPlot?: (plot: ScenePlot) => void;
  plotLabel?: (plot: ScenePlot) => string;
  /** Room kept below the scene (the page's tool rail), in CSS pixels. */
  reserveBelow?: number;
  /** What she knows of the reader's books and the world outside the room (pip/behaviour.ts, `World`): it colours what she does. */
  world?: World;
  /** Something laid over the room, in its own coordinates, under Pip: a visitor, a note. */
  overlay?: (frame: RoomFrame) => ReactNode;
  /** She has come in and shown what she brought back (`world.back`, by its key): the page files it. Called once a find. */
  onWelcomed?: (key: string) => void;
  label: string;
};

/**
 * `doing`: a step of an activity; `fidget`: a small thing while standing
 * about; `errand`: doing a free moment's errand; `tuck`: hopping into bed;
 * `sleep`: in it.
 */
type Phase = "rest" | "walk" | "act" | "doing" | "fidget" | "held" | "fall" | "land" | "errand" | "tuck" | "sleep" | "petted" | "fetch" | "carry";
/** When the reader's hand can have her attention: not in mid-air, not mid-act. */
const TOUCHABLE: ReadonlySet<Phase> = new Set<Phase>(["rest", "walk", "doing", "fidget", "errand", "petted", "sleep", "tuck", "land"]);
/** The ball: in the air, rolling, lying still, in the reader's hand, or in Pip's. */
type Ball = { body: Body; state: "air" | "roll" | "still" | "held" | "carried"; home: number; touched: number };
/** The bed's front, in floor pixels, drawn over Pip while he sleeps. */
type Tucked = { x: number; y: number; w: number; h: number };
/** A piece of decor on its way into a slot: dropping in over the art, which leaves it out until it lands. */
type Arrival = { key: number; slot: string; image: ImageData; box: { x: number; y: number; w: number; h: number } };
type Look = { skin: string; outfit: readonly string[]; key: string };

let arrivalKey = 1;

/**
 * One floor of Pip's house, big: the floor's art at a whole or half number of
 * device pixels per pixel (sceneFit.ts), and Pip living in it at the same scale. Pip strolls, fills free moments, can be
 * picked up and dropped, and reacts when poked. In Decorate mode, each slot
 * of the floor gets a pin to choose what goes there.
 *
 * Pip's motion runs in one requestAnimationFrame loop on refs and writes its
 * transform directly; React state changes only when Pip changes what it is
 * doing. The loop stops when the tab is hidden or the scene unmounts.
 *
 * The scene animates its own changes: decor drops into place (and lifts out),
 * new wallpaper wipes over the old, a new floor slides in from above or below,
 * and Pip spins into a new look in a puff of smoke. The garden's plots are
 * sprites over the floor, so a ripe plant can sway, a picked one pop off and
 * a new one sprout.
 */
export const HouseScene = forwardRef<HouseSceneHandle, HouseSceneProps>(function HouseScene(
  {
    level,
    floorIndex = 0,
    decor,
    skin,
    outfit,
    act,
    onActDone,
    line,
    repertoire,
    mood,
    mopey,
    onPoke,
    onPlayed,
    ownBall = false,
    attentive = false,
    decorating,
    selectedSlot = null,
    onSlot,
    slotLabel,
    onArcade,
    onJukebox,
    hidePip = false,
    plots,
    onPlot,
    onEmptyPlot,
    plotLabel,
    reserveBelow = 28,
    world,
    overlay,
    onWelcomed,
    label
  },
  ref
) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const roomRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipRef = useRef<HTMLDivElement | null>(null);
  const spinRef = useRef<HTMLDivElement | null>(null);
  const turnRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<HTMLButtonElement | null>(null);
  // Whether the ball is out (its place is the loop's, on a ref).
  const [ballOut, setBallOut] = useState(false);
  // How big the room is drawn: device pixels per art pixel, and the display's scaling that was worked out for.
  // The two are kept together: the scaling can change on its own (the window dragged to another monitor), and a
  // room that read it afresh at each render kept its old size until something else made it render.
  const [{ per, ratio }, setFit] = useState(() => ({ per: 3, ratio: window.devicePixelRatio || 1 }));
  // Out of the house altogether (an expedition): no Pip, a note where she sleeps.
  const out = Boolean(world?.away);
  const outRef = useRef(out);
  outRef.current = out;
  // Resting, she stands as she feels: under a blanket with a cold, drooping when glum.
  const base = bundled(world?.cold) ? "cold-idle" : mopey ? "mope" : "idle";
  const [view, setView] = useState<{ move: string; loops?: number; key: string | number; flip: boolean }>({ move: base, key: "rest", flip: false });
  // What is showing, for the loop to compare against without waiting for a render.
  const viewRef = useRef({ move: base });
  // The loop's one step, and when the move showing ends: for the development hook.
  const stepRef = useRef<((time: number) => void) | null>(null);
  const moveEnds = useRef<number | null>(null);

  // ---- size: fill the width, and the window's height below the scene's top ----
  // The room's box just before a resize, so a change of scale can zoom from it.
  const lastRoomBox = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth;
      const top = stage.getBoundingClientRect().top;
      const height = Math.max(220, window.innerHeight - Math.max(0, top) - reserveBelow);
      lastRoomBox.current = roomRef.current?.getBoundingClientRect() ?? null;
      if (width <= 0) return;
      const now = window.devicePixelRatio || 1;
      const fits = sceneScale(level.w, level.h, width, height, now);
      setFit((was) => (was.per === fits && was.ratio === now ? was : { per: fits, ratio: now }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    // A change of scaling does not always come with a resize: measured again at once (pixelRatio.ts).
    const unwatch = watchPixelRatio(measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      unwatch();
    };
  }, [level.w, level.h, reserveBelow]);

  const scale = per / ratio;

  // Pip's own state, and what the loop and the effects read without re-rendering.
  const st = useRef({
    x: level.w / 2,
    y: level.walkY,
    vy: 0,
    phase: "rest" as Phase,
    target: level.w / 2,
    /** How fast she walks to it, in floor pixels a second. */
    pace: WALK_SPEED,
    facing: 1,
    nextFree: 0,
    drag: null as null | { id: number; startX: number; startY: number; moved: boolean },
    /** What Pip is off to do, and what is waiting to be done. */
    errand: null as Errand | null,
    queue: [] as Errand[],
    /** Woken until then: no going back to bed. */
    wokeUntil: 0,
    /** A hop into bed, under way. */
    hop: null as null | { fromX: number; fromY: number; toX: number; toY: number; start: number },
    /** When a ripe plant was last pointed out (never, at first), and which. */
    pointedAt: -Infinity,
    lastPointed: -1,
    saidRipe: false,
    /** When asleep, when to next look at the clock for morning. */
    nightCheck: 0,
    /** How long the sleep she is going to bed for lasts, in seconds (null: until morning), and when one under way ends. */
    napFor: null as number | null,
    wakeAt: Infinity,
    /** The activity under way, and the step it is on. */
    plan: null as null | { activity: Activity; index: number },
    /** What she did last, newest first: never the same thing twice running. */
    recent: [] as ActivityId[],
    /** Small things left to do before the next activity, and the last one done. */
    fidgets: 1,
    lastFidget: null as string | null,
    /** Where the pointer is over the room (floor pixels), and when it last moved. */
    pointer: null as null | { x: number; y: number; at: number },
    gazeAt: 0,
    /** When the reader last fed her, played with her, came back from a game. */
    fedAt: -Infinity,
    playedAt: -Infinity,
    gamedAt: -Infinity,
    /** Pokes in a row, and the stroke the pointer is making over her. */
    poke: null as Poke | null,
    stroke: null as Stroke | null,
    /** Being stroked or tickled: since when, until when, and when hearts next rise. */
    touch: null as null | { kind: "pet" | "tickle"; since: number; last: number; fxAt: number },
    /** Held: where the hand is and has been (floor pixels), and how she swings from it. */
    hand: [] as Sample[],
    handAt: { x: 0, y: 0 },
    hold: holdStart(),
    /** Held: how far she still is from hanging in the hand (she slides into it). */
    grip: { x: 0, y: 0 },
    /** In the air: how fast, which way up, whether she was thrown (not just dropped), and the hardest she has met the floor. */
    vx: 0,
    angle: 0,
    spin: 0,
    tossed: false,
    hardest: 0,
    /** The ball, when it is out; and fetches in a row. */
    ball: null as Ball | null,
    fetches: 0,
    /** When each kind of play last counted. */
    playLast: {} as Partial<Record<PlayKind, number>>,
    /** She has said hello to the hand this visit. */
    invited: false,
    /**
     * Why she has the fridge open, while she has: waiting at it for the snack
     * the reader is choosing, or eating that snack in front of it. Anything
     * that takes her away from it shuts the door (see the loop).
     */
    fridgeHold: null as null | { key: string; why: "snack" | "eating" | "plan" },
    /** In bed with her phone, not asleep: the beats of it (pip/behaviour.ts), and the one she is on. */
    abed: null as null | { beats: ScrollBeat[]; index: number; hinted: boolean },
    /** What she takes to bed with her, when she next gets in. */
    pendingScroll: null as ScrollBeat[] | null,
    /** When the reader last put her to bed (never, if she went herself), when she fell asleep, and when she last stirred in the night. */
    tuckedAt: -Infinity,
    sleptAt: 0,
    stirredAt: -Infinity,
    /** She has hit snooze this morning (once is all she gets), and is under the quilt again for it. */
    snoozed: false,
    snoozing: false,
    /** She has been to look in a fridge the reader opened, and is still by it until then: if it shuts, she has a word. */
    hopedUntil: 0,
    /** In bed, not to sleep: under the quilt, hiding from her book. */
    hiding: false,
    /** Asleep, but for a look out from under the quilt (the night after a horror). */
    peeking: false,
    /** The find she last came in with (its key), and whether the page has been told. */
    welcomed: null as string | null,
    toldWelcomed: null as string | null
  });
  const live = useRef({ scale, level, base, repertoire, mood, onActDone, onPoke, onPlayed, ownBall, attentive, decor, plots, decorating, world, onWelcomed });
  live.current = { scale, level, base, repertoire, mood, onActDone, onPoke, onPlayed, ownBall, attentive, decor, plots, decorating, world, onWelcomed };
  /** The world as she knows it now: the page's, under anything set by hand (pip/worldStub.ts; the page lays it over too, a render later). */
  const worldNow = (): World | undefined => {
    const stub = worldStub();
    return stub ? { ...live.current.world, ...stub } : live.current.world;
  };
  // What she holds up over her head (a find brought home), while she does.
  const [holding, setHolding] = useState<ImageData | null>(null);
  const holdingRef = useRef<ImageData | null>(null);
  holdingRef.current = holding;

  // Pip's own lines (a ripe plant pointed out, a wish come true); the page's
  // come first.
  const [ownLine, setOwnLine] = useState<string | null>(null);
  useEffect(() => {
    if (!ownLine) return;
    const timer = window.setTimeout(() => setOwnLine(null), OWN_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [ownLine]);
  const shownLine = line ?? ownLine;
  const ownLineRef = useRef<string | null>(null);
  ownLineRef.current = ownLine;

  // The bed's front over Pip while he sleeps in it.
  const [tucked, setTucked] = useState<Tucked | null>(null);
  const tuckedRef = useRef<Tucked | null>(null);
  tuckedRef.current = tucked;
  const frontRef = useRef<HTMLCanvasElement | null>(null);

  // A new scale (a drawer opening beside the room) zooms from the old size
  // rather than jumping: the room eases to its new box.
  const shownPer = useRef(per);
  useLayoutEffect(() => {
    const room = roomRef.current;
    const before = lastRoomBox.current;
    const was = shownPer.current;
    shownPer.current = per;
    if (!room || !before || was === per || prefersReducedMotion()) return;
    const now = room.getBoundingClientRect();
    if (now.width === 0) return;
    room.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${before.left - now.left}px, ${before.top - now.top}px) scale(${before.width / now.width})` },
        { transformOrigin: "0 0", transform: "none" }
      ],
      { duration: 340, easing: "cubic-bezier(0.25, 0.9, 0.35, 1)" }
    );
  }, [per]);

  // ---- a new floor slides in: from above going up, from below going down ----
  const lastFloor = useRef<{ id: string; index: number } | null>(null);
  useLayoutEffect(() => {
    const room = roomRef.current;
    const before = lastFloor.current;
    lastFloor.current = { id: level.id, index: floorIndex };
    if (!room || !before || before.id === level.id || prefersReducedMotion()) return;
    const up = floorIndex > before.index;
    room.animate(
      [
        { transform: `translateY(${up ? -7 : 7}%)`, opacity: 0 },
        { transform: "none", opacity: 1 }
      ],
      { duration: 380, easing: "cubic-bezier(0.2, 0.85, 0.3, 1)" }
    );
  }, [level.id, floorIndex]);

  // ---- the floor's art, and decor arriving and leaving ----------------------------
  // The garden's house art has a glass wall: the sky behind it is the scene's own.
  const openSky = level.garden && !level.fallback;
  const decorKey = JSON.stringify(decor);
  // Slots whose new piece is still dropping in: the art leaves them out until it lands.
  const arriving = useRef(new Map<string, number>());
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const redraw = useRef<(() => void) | null>(null);
  // The decor as it was last drawn, to tell what arrived and what left.
  const drawn = useRef<{ level: string; placed: Map<string, string>; wallpaper: string | null; floor: string | null } | null>(null);
  const timers = useRef(new Set<number>());
  const later = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  /** A box in floor pixels, on screen. */
  const onScreen = (box: { x: number; y: number; w: number; h: number }): Box | null => {
    const room = roomRef.current?.getBoundingClientRect();
    if (!room) return null;
    const k = live.current.scale;
    return { left: room.left + box.x * k, top: room.top + box.y * k, width: box.w * k, height: box.h * k };
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = prefersReducedMotion();

    // What changed since the last draw of this floor: pieces to drop in or lift out.
    const placed = new Map(decor.placed.map((entry) => [entry.slot, entry.itemId]));
    const before = drawn.current;
    drawn.current = { level: level.id, placed, wallpaper: decor.wallpaper, floor: decor.floor };
    if (before && before.level !== level.id) {
      arriving.current.clear();
      setArrivals([]);
    }
    const sameFloor = before?.level === level.id;
    if (sameFloor && !reduced) {
      for (const [slotId, itemId] of before.placed) {
        if (placed.get(slotId) === itemId) continue;
        const slot = level.slots.find((entry) => entry.id === slotId);
        const box = slot ? itemBox(itemId, slot) : null;
        const shown = box ? onScreen(box) : null;
        if (!shown) continue;
        try {
          popOff(renderItem(itemId, 0), shown, "lift", nightNow(level));
        } catch {
          // Art mid-edit: no ghost.
        }
        puff({ x: shown.left + shown.width / 2, y: shown.top + shown.height }, { px: live.current.scale, count: 5, color: "#E9E1CF", edge: "#BDB3A0", spread: 30 });
      }
      const fresh: Arrival[] = [];
      for (const [slotId, itemId] of placed) {
        if (before.placed.get(slotId) === itemId) continue;
        const slot = level.slots.find((entry) => entry.id === slotId);
        const box = slot ? itemBox(itemId, slot) : null;
        if (!slot || !box) continue;
        let image: ImageData;
        try {
          image = renderItem(itemId, 0);
        } catch {
          continue;
        }
        const key = arrivalKey++;
        arriving.current.set(slotId, key);
        fresh.push({ key, slot: slotId, image, box });
        later(DROP_LAND_MS, () => {
          playSound("place");
          const shown = onScreen(box);
          if (!shown) return;
          const foot = { x: shown.left + shown.width / 2, y: shown.top + shown.height };
          const k = live.current.scale;
          if (slot.fits === "stand" || slot.fits === "rug" || slot.fits === "top") {
            puff(foot, { px: k, count: 8, color: "#E9E1CF", edge: "#BDB3A0", spread: Math.max(28, shown.width * 0.6) });
          } else {
            burst(centerOf(shown), { px: k, count: 7, sprite: "spark", spread: Math.max(30, shown.width * 0.6), lift: 8, fall: 6 });
          }
        });
        later(DROP_MS, () => {
          // The art takes the piece over first, then the falling copy goes: never a frame without it.
          if (arriving.current.get(slotId) === key) arriving.current.delete(slotId);
          redraw.current?.();
          setArrivals((current) => current.filter((entry) => entry.key !== key));
        });
      }
      if (fresh.length > 0) {
        setArrivals((current) => [...current.filter((entry) => !fresh.some((next) => next.slot === entry.slot)), ...fresh]);
        // Pip goes to see the newest piece once it has landed.
        const newest = fresh[fresh.length - 1];
        const fits = level.slots.find((entry) => entry.id === newest.slot)?.fits;
        if (fits) visit(newest.box, fits);
      }
    }

    // New wallpaper or flooring wipes over the old, top down or left to right.
    const finish = sameFloor && !reduced && (before.wallpaper !== decor.wallpaper || before.floor !== decor.floor) ? (before.wallpaper !== decor.wallpaper ? "wall" : "floor") : null;
    if (finish && canvas.width > 0) {
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.className = "pip-sprite pip-house-canvas pip-house-wipe";
      snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.after(snapshot);
      const wipe = snapshot.animate(
        finish === "wall"
          ? [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(100% 0 0 0)" }]
          : [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 0 100%)" }],
        { duration: 620, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "both" }
      );
      const done = () => snapshot.remove();
      wipe.finished.then(done, done);
    }

    const toCanvas = (image: ImageData) => {
      const out = document.createElement("canvas");
      out.width = image.width;
      out.height = image.height;
      out.getContext("2d")?.putImageData(image, 0, 0);
      return out;
    };
    let hour = clockHour();
    // The frames drawn so far, for each way the room has stood this hour (a
    // lamp off, the fridge open): going back to one costs nothing.
    let kept = new Map<string, Map<number, HTMLCanvasElement>>();
    let step = 0;
    const draw = (next: number) => {
      step = next;
      const now = clockHour();
      // Left out of the picture: a piece still dropping in, and one the furnishings layer is drawing (a picture knocked crooked).
      const out = new Set([...arriving.current.keys(), ...(furnishRef.current?.lifted.current ?? [])]);
      // Drawn unlit: a light the reader has switched off.
      const unlit = furnishRef.current?.unlit.current ?? new Set<string>();
      // The floor's fridge, where the furnishings stand it, shut or open; and the light of her phone, in bed.
      const fridges = furnishRef.current?.fixtures.current;
      const fixtures = fridges || phoneGlow.current ? [...(fridges ?? []), ...(phoneGlow.current ? [{ itemId: "phoneglow", ...phoneGlow.current }] : [])] : undefined;
      const hidden = `${[...out].sort().join(",")}|${[...unlit].sort().join(",")}|${(fixtures ?? []).map(fixtureKey).join(",")}`;
      if (now !== hour) {
        hour = now;
        kept = new Map();
      }
      let frames = kept.get(hidden);
      if (!frames) {
        if (kept.size >= 4) kept = new Map();
        frames = new Map();
        kept.set(hidden, frames);
      }
      let image = frames.get(next);
      if (!image) {
        try {
          const shown = {
            ...decor,
            placed: out.size > 0 || unlit.size > 0 ? decor.placed.filter((entry) => !out.has(entry.slot)).map((entry) => (unlit.has(entry.slot) ? { ...entry, off: true } : entry)) : decor.placed,
            ...(fixtures ? { fixtures } : {})
          };
          // The garden's glass is left clear: the living sky (GardenSky) shows through it.
          const art = renderHouseLevel(level, next, shown, isEvening(Math.floor(hour)), hour, openSky) ?? renderGardenFloor(level.w, level.h, level.floorY, next);
          image = toCanvas(art);
        } catch {
          // Art mid-edit can throw; keep the last good frame.
          return;
        }
        frames.set(next, image);
      }
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, level.w, level.h);
      context.drawImage(image, 0, 0);
      // The bed's front over a sleeping Pip: the room's own pixels, lamps and
      // night light included, copied from the frame just drawn.
      const front = frontRef.current;
      const region = tuckedRef.current;
      const frontContext = front?.getContext("2d");
      if (front && region && frontContext) {
        frontContext.imageSmoothingEnabled = false;
        frontContext.clearRect(0, 0, region.w, region.h);
        frontContext.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
        // His head on the pillow shows through.
        frontContext.clearRect(BED_PILLOW.x, 0, BED_PILLOW.w, BED_PILLOW.h);
      }
    };
    redraw.current = () => draw(step);
    draw(0);
    if (reduced) return;
    return subscribeTick((tick) => draw(tick % ROOM_LOOP));
    // decorKey stands in for decor, a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, decorKey]);

  // ---- the garden's plots ------------------------------------------------------------
  const plotsKey = JSON.stringify(plots ?? []);
  const plotNodes = useRef(new Map<number, HTMLDivElement>());
  const plotAt = useRef(new Map<number, { x: number; locked: boolean; plant: string | null; stage: number; ripe: boolean }>());
  // Plantings on their way in: which plot, and how long its seed takes to land.
  const sprouting = useRef(new Map<number, { until: number; delay: number }>());
  const boxes = useMemo(() => plotBoxes(level, plots?.length ?? 0), [level, plots?.length]);

  // A plot dug: the others shuffle along to make room and the new bed pops up.
  // A plant that grows a stage gives a little stretch; one that ripens sparkles.
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    (plots ?? []).forEach((plot, index) => {
      const node = plotNodes.current.get(plot.plot);
      const box = boxes[index];
      const was = plotAt.current.get(plot.plot);
      const stage = plantStage(plot.progress);
      plotAt.current.set(plot.plot, { x: box.x, locked: Boolean(plot.locked), plant: plot.plant, stage, ripe: plot.ripe });
      if (!node || !was || reduced) return;
      const k = live.current.scale;
      if (plot.plant && was.plant === plot.plant && (stage > was.stage || (plot.ripe && !was.ripe))) {
        node.querySelector(".pip-plot-plant")?.animate(
          [{ transform: "none" }, { transform: "scale(0.9, 1.18)", offset: 0.4 }, { transform: "scale(1.06, 0.95)", offset: 0.7 }, { transform: "none" }],
          { duration: 480, easing: "ease-out" }
        );
        if (plot.ripe && !was.ripe) {
          const shown = onScreen(box);
          if (shown) burst({ x: shown.left + shown.width / 2, y: shown.top + shown.height * 0.35 }, { px: k, count: 10, sprite: "spark", spread: shown.width, lift: 14, fall: 6 });
        }
      }
      if (was.x !== box.x) {
        node.animate([{ transform: `translateX(${(was.x - box.x) * k}px)` }, { transform: "none" }], {
          duration: 460,
          easing: "cubic-bezier(0.3, 1.25, 0.5, 1)"
        });
      }
      if (was.locked && !plot.locked) {
        node.animate(
          [
            { transform: "scale(0.2, 0.2)", opacity: 0 },
            { transform: "scale(1.15, 0.85)", opacity: 1, offset: 0.55 },
            { transform: "scale(0.95, 1.06)", offset: 0.8 },
            { transform: "none" }
          ],
          { duration: 560, delay: 120, easing: "ease-out", fill: "backwards" }
        );
        const shown = onScreen(box);
        if (shown) {
          puff({ x: shown.left + shown.width / 2, y: shown.top + shown.height - 4 * k }, { px: k, count: 10, spread: shown.width });
          confetti({ left: shown.left - shown.width, top: shown.top - shown.height, width: shown.width * 3, height: shown.height * 2 }, { px: k, count: 22 });
        }
      }
    });
    // plotsKey stands in for plots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotsKey, boxes]);

  // ---- Pip --------------------------------------------------------------------------
  // What the furnishings ask of Pip, and the furnishings for the loop to move (both set further down).
  const furnishPip = useRef<FurnishPip>({ react: () => undefined, bed: () => undefined, asleep: () => false, wake: () => false, go: () => undefined, fridge: () => undefined, clock: nowMs, redraw: () => undefined });
  const furnishRef = useRef<ReturnType<typeof useFurnishings> | null>(null);
  // Where her phone lights the bed, while it does (the room's picture draws the light).
  const phoneGlow = useRef<{ x: number; y: number } | null>(null);

  /** Ends the press that has hold of Pip, if there is one (see "carrying Pip", below). */
  const dragEnd = useRef<null | ((how: "up" | "cancel") => void)>(null);
  useEffect(() => () => dragEnd.current?.("cancel"), []);

  /** A pointer's place in the room, in floor pixels (layout.ts: by the room's own box). */
  const pointerAt = (pointer: { clientX: number; clientY: number }) => {
    const room = roomRef.current?.getBoundingClientRect();
    return room ? floorPoint(pointer, room, live.current.level.w) : null;
  };

  const show = (move: string, loops?: number, key: string | number = `${move}-${Date.now()}`) => {
    viewRef.current.move = move;
    moveEnds.current = loops ? nowMs() + ((loops * loopFrames(move)) / 12) * 1000 : null;
    setView({ move, loops, key, flip: st.current.facing < 0 });
  };

  const place = () => {
    const s = st.current;
    const node = pipRef.current;
    if (!node) return;
    const { scale: k } = live.current;
    node.style.transform = `translate(${(s.x - 16) * k}px, ${(s.y - 30) * k}px)`;
    // Held, she swings from the hand by her leaf; thrown, she turns about her middle.
    const spin = spinRef.current;
    if (!spin) return;
    const angle = s.phase === "held" ? s.hold.swing.angle : s.phase === "fall" ? s.angle : 0;
    const turn = angle ? `rotate(${angle.toFixed(3)}rad)` : "";
    if (spin.style.transform !== turn) {
      spin.style.transformOrigin = s.phase === "held" ? TURN_HELD : TURN_AIR;
      spin.style.transform = turn;
    }
  };

  /** Where the ball is drawn: its middle at its place, turned as it rolls. Hidden in Pip's hands. */
  const placeBall = () => {
    const node = ballRef.current;
    const ball = st.current.ball;
    if (!node || !ball) return;
    const { scale: k } = live.current;
    node.style.visibility = ball.state === "carried" ? "hidden" : "visible";
    node.style.transform = `translate(${(ball.body.x - BALL_BOX / 2) * k}px, ${(ball.body.y - BALL_BOX / 2) * k}px) rotate(${ball.body.angle.toFixed(2)}rad)`;
  };

  /**
   * Turns Pip to face left or right. A real turn, not a mirror flip: she goes
   * edge-on halfway round, so walking back the way she came reads as turning.
   */
  const face = (dir: 1 | -1) => {
    const s = st.current;
    if (s.facing === dir) return;
    s.facing = dir;
    if (prefersReducedMotion()) return;
    turnRef.current?.animate([{ transform: "scaleX(-1)" }, { transform: "scaleX(0.12)", offset: 0.5 }, { transform: "scaleX(1)" }], {
      duration: TURN_MS,
      easing: "ease-in-out"
    });
  };

  const rest = () => {
    const s = st.current;
    const now = nowMs();
    s.phase = "rest";
    // Something waiting (a new piece to see, a cue) comes soon after; otherwise
    // she stands a few seconds before the next small thing, or the next activity.
    const waiting = s.queue.length > 0 ? Math.min(...s.queue.map((errand) => errand.after)) : null;
    s.nextFree = waiting !== null ? Math.max(now + 600, waiting) : now + (prefersReducedMotion() ? STILL_GAP_MS : fidgetGap(Math.random) * 1000 * coldRest(worldNow()?.cold));
    s.gazeAt = 0;
    show(live.current.base, undefined, "rest");
  };

  /** The room as Pip sees it, for choosing what to do next. */
  const outlook = (now: number, reduced: boolean) => {
    const s = st.current;
    const { level: lv, decor: dc, plots: shown, repertoire: can, mood: feeling } = live.current;
    return {
      mood: feeling,
      hour: new Date().getHours(),
      floor: { w: lv.w, garden: lv.garden, arcade: lv.arcade },
      x: s.x,
      spots: [...roomSpots(lv, dc, shown), ...(furnishRef.current?.spots() ?? [])],
      toys: can.toys,
      dances: can.dances,
      signature: can.signature,
      hobbies: can.hobbies,
      recent: s.recent,
      justNow: { fed: now - s.fedAt < JUST_NOW_MS, played: now - s.playedAt < JUST_NOW_MS, gamed: now - s.gamedAt < JUST_NOW_MS },
      reduced,
      world: worldNow()
    };
  };

  /** Her stroll, as she is: a shuffle in her blanket with a cold. And how fast she goes, as a share of her usual pace. */
  const strollMove = () => (bundled(worldNow()?.cold) ? "shuffle" : "walk");
  const paceNow = () => coldPace(worldNow()?.cold);

  /** The next step of the activity under way; past the last one, it is done. */
  const nextStep = () => {
    const s = st.current;
    const plan = s.plan;
    if (!plan) {
      rest();
      return;
    }
    plan.index += 1;
    const step = plan.activity.steps[plan.index];
    if (!step) {
      // Done: remembered, so the next thing is something else.
      s.recent = [plan.activity.id, ...s.recent].slice(0, 3);
      s.plan = null;
      s.fidgets = fidgetsBetween(Math.random);
      rest();
      return;
    }
    if (step.kind === "walk") {
      if (Math.abs(step.x - s.x) <= 2) {
        nextStep();
        return;
      }
      if (prefersReducedMotion()) {
        // Without motion she is simply there (only the fridge and her bed are walked to at all: pip/behaviour.ts).
        s.x = step.x;
        place();
        nextStep();
        return;
      }
      s.target = step.x;
      s.pace = (step.pace ? TIPTOE_SPEED : WALK_SPEED) * paceNow();
      face(step.x < s.x ? -1 : 1);
      s.phase = "walk";
      // Her stroll, unless the activity walks its own way (bent over a trail, on the march).
      show(step.as ?? (step.pace === "tiptoe" ? "tiptoe" : strollMove()), undefined, "walk");
    } else if (step.kind === "face") {
      face(step.dir);
      nextStep();
    } else if (step.kind === "do") {
      s.phase = "doing";
      // Reading, the book in her hands is the reader's own (pip/furnish-art.js).
      const move = step.move === "read" ? readingMove() : step.move;
      show(move, loopsFor(move, step.seconds), `plan-${Date.now()}`);
      say(step.line);
    } else if (step.kind === "use" && step.what === "sleep") {
      // Into bed for a nap; the plan goes on when she gets up (see the loop).
      s.napFor = step.seconds;
      tuck(prefersReducedMotion());
    } else if (step.kind === "use" && step.what === "hide") {
      // Into bed, but not to sleep: under the quilt a while, and then on with the plan, as after a nap.
      s.napFor = step.seconds;
      s.hiding = true;
      tuck(prefersReducedMotion());
    } else if (step.kind === "use" && step.what === "thing") {
      // A thing in the room she is about to use: it is told, in its own word (the furnishings know what to do).
      (furnishRef.current?.pipUse as undefined | ((key: string, what: string) => void))?.(step.id, step.verb);
      nextStep();
    } else if (step.kind === "use" && (step.what === "scroll" || step.what === "bed")) {
      // Into bed, with the phone or back to sleep: the activity ends there, and the night goes on.
      s.recent = [plan.activity.id, ...s.recent].slice(0, 3);
      s.plan = null;
      s.fidgets = fidgetsBetween(Math.random);
      if (step.what === "scroll") {
        s.pendingScroll = step.beats;
        s.napFor = bedSleep(new Date().getHours(), Math.random);
        tuck(prefersReducedMotion());
      } else {
        backToBed();
      }
    } else if (step.kind === "use" && step.what === "open") {
      // The fridge: she holds it open until she shuts it, or is called away.
      furnishRef.current?.pipUse(step.id, "open");
      s.fridgeHold = { key: step.id, why: "plan" };
      nextStep();
    } else if (step.kind === "use" && step.what === "shut") {
      shutFridge();
      nextStep();
    } else if (step.kind === "use") {
      furnishRef.current?.pipUse(step.id, "straighten");
      nextStep();
    } else {
      // A pause: she stands, and the loop moves on when it is over.
      s.phase = "rest";
      s.nextFree = nowMs() + step.seconds * 1000;
      show(live.current.base, undefined, "rest");
    }
  };

  /**
   * Drops whatever Pip was in the middle of: the reader has her attention now.
   * `remember`: it still counts as done, so the next thing she picks is another.
   */
  const dropPlan = (remember = false) => {
    const s = st.current;
    if (remember && s.plan) s.recent = [s.plan.activity.id, ...s.recent].slice(0, 3);
    s.plan = null;
  };

  /** Says a line of Pip's own, under any the page is showing. */
  const say = (text: string | null | undefined) => {
    if (text) setOwnLine(text);
  };

  const clampX = (x: number) => Math.max(18, Math.min(live.current.level.w - 18, x));

  /**
   * Out of bed (woken, dragged, or the floor changed), standing beside it,
   * awake. `lifted`: taken out by the hand, from where she lies.
   */
  const untuck = (lifted = false) => {
    const s = st.current;
    if (s.phase !== "sleep" && s.phase !== "tuck") return;
    const { level: lv, decor: dc } = live.current;
    const bed = bedBox(lv, dc);
    setTucked(null);
    s.hop = null;
    s.wokeUntil = nowMs() + WOKEN_MS;
    // The phone goes wherever phones go.
    s.abed = null;
    s.pendingScroll = null;
    s.hiding = false;
    s.peeking = false;
    s.tuckedAt = -Infinity;
    setPhoneGlow(false);
    if (lifted) return;
    s.x = bed ? clampX(bed.x + bed.w + 8) : s.x;
    s.y = lv.walkY;
    place();
    rest();
  };

  /** Pip lies down in the bed, under the quilt, asleep until something wakes him. */
  const sleepIn = (bed: { x: number; y: number; w: number; h: number }) => {
    const s = st.current;
    s.phase = "sleep";
    s.hop = null;
    s.x = bed.x + BED_PIP_X;
    s.y = bed.y + BED_PIP_Y;
    s.facing = 1;
    s.nightCheck = nowMs() + 30_000;
    // A nap ends by itself; a night's sleep lasts until morning (or until she is woken).
    s.wakeAt = s.napFor === null ? Infinity : nowMs() + s.napFor * 1000;
    s.napFor = null;
    s.sleptAt = nowMs();
    s.snoozed = false;
    s.snoozing = false;
    place();
    setTucked({ x: bed.x, y: bed.y + BED_FRONT, w: bed.w, h: bed.h - BED_FRONT });
    // Not asleep yet, if she has brought the phone.
    const beats = s.pendingScroll;
    s.pendingScroll = null;
    if (beats) startScroll(beats);
    else if (s.hiding) {
      // Not asleep at all: under the quilt, and up for a look each way.
      show("quilt-hide", undefined, "hide");
      say(quiltLine(Math.random));
    } else show("sleep", undefined, "sleep");
  };

  // ---- the phone, in bed -----------------------------------------------------------
  // Late, she takes it to bed (pip/behaviour.ts plans the session, beat by
  // beat): she is in bed as when asleep, with a different move showing, and
  // its light on the pillow is the room's own (a glow in the floor's picture,
  // drawn again only when it comes on and goes out). It ends in sleep.

  /** The phone's light on the bed, after dark: on or off. */
  const setPhoneGlow = (on: boolean) => {
    const s = st.current;
    const lit = on && nightNow(live.current.level);
    if (lit === (phoneGlow.current !== null)) return;
    // Where the phone is held, beside her head (pip/house-moves.js, "scroll").
    phoneGlow.current = lit ? { x: Math.round(s.x + 9), y: Math.round(s.y - 15) } : null;
    redraw.current?.();
  };

  /** The next beat of her evening on the phone; past the last, she is asleep with it on her chest. */
  const nextBeat = () => {
    const s = st.current;
    const abed = s.abed;
    if (!abed || s.phase !== "sleep") return;
    abed.index += 1;
    const beat = abed.beats[abed.index];
    if (!beat) {
      s.abed = null;
      s.sleptAt = nowMs();
      setPhoneGlow(false);
      show("scroll-asleep", undefined, "sleep");
      return;
    }
    // Hidden from the reader, or going out with her: no light.
    setPhoneGlow(beat.beat !== "innocent" && beat.beat !== "doze");
    const move = beat.beat === "innocent" ? "innocent" : beat.beat === "scroll" ? "scroll" : `scroll-${beat.beat}`;
    show(move, loopsFor(move, beat.seconds), `abed-${abed.index}-${Date.now()}`);
    say(beat.line);
  };

  /** In bed already: out comes the phone. */
  const startScroll = (beats: ScrollBeat[]) => {
    const s = st.current;
    if (s.phase !== "sleep") return;
    s.abed = { beats, index: -1, hinted: false };
    if (s.recent[0] !== "scroll") s.recent = ["scroll" as ActivityId, ...s.recent].slice(0, 3);
    s.stirredAt = nowMs();
    nextBeat();
  };

  /** Back to the bed she got out of (after the fridge), quietly, for the rest of the night. */
  const backToBed = () => {
    const s = st.current;
    const bed = bedBox(live.current.level, live.current.decor);
    if (!bed) {
      rest();
      return;
    }
    s.wokeUntil = 0;
    s.napFor = bedSleep(new Date().getHours(), Math.random);
    startErrand({ kind: "bed", x: clampX(bed.x + bed.w * 0.75), face: -1, move: "yawn", loops: 1, after: 0, then: "tuck", tiptoe: true }, prefersReducedMotion());
  };

  /** Up in the night, of her own accord, for a look in the fridge: out of bed, over on tiptoe, and back. */
  const raid = () => {
    const s = st.current;
    const reduced = prefersReducedMotion();
    untuck();
    // Up on her own account, not woken: once she is done (or caught) it is straight back to bed.
    s.wokeUntil = 0;
    s.stirredAt = nowMs();
    s.errand = null;
    s.fidgets = 0;
    s.plan = { activity: fridgeVisit(outlook(nowMs(), reduced), Math.random, true), index: -1 };
    nextStep();
  };

  /** Into bed: a hop from beside it, or straight in without motion. */
  const tuck = (instant: boolean) => {
    const s = st.current;
    const bed = bedBox(live.current.level, live.current.decor);
    if (!bed) {
      s.pendingScroll = null;
      s.hiding = false;
      rest();
      return;
    }
    if (instant) {
      sleepIn(bed);
      return;
    }
    if (stopForVisitor(worldNow()?.visitor, s.x, bed.x + BED_PIP_X) !== null) {
      // A visitor stands between her and her bed: she does not leap over them. Bed can wait.
      s.pendingScroll = null;
      s.hiding = false;
      s.napFor = null;
      s.errand = null;
      dropPlan(true);
      s.wokeUntil = nowMs() + WOKEN_MS;
      rest();
      return;
    }
    s.phase = "tuck";
    s.hop = { fromX: s.x, fromY: s.y, toX: bed.x + BED_PIP_X, toY: bed.y + BED_PIP_Y, start: nowMs() };
    show("land", undefined, "hop");
  };

  /** Arrived where an errand goes (or it goes nowhere): do it. */
  const arrive = () => {
    const s = st.current;
    const errand = s.errand;
    if (!errand) {
      // An activity's walk: on to its next step (or, after a walk by the arrow keys, a rest).
      if (s.plan) nextStep();
      else rest();
      return;
    }
    if (errand.face) face(errand.face);
    if (errand.fridge) {
      const fridge = furnishRef.current?.fridge();
      if (errand.kind === "snack" && fridge) {
        // Her own doing: she opens it, and holds it open while the reader chooses.
        furnishRef.current?.pipUse(errand.fridge, "open");
        s.fridgeHold = { key: errand.fridge, why: "snack" };
      } else if (fridge?.open) {
        // The reader's doing: it waits for her to have her look.
        furnishRef.current?.pipUse(errand.fridge, "linger");
      } else {
        // It shut before she got there.
        s.errand = null;
        answer(fridgeShutOnHer(Math.random));
        return;
      }
    }
    s.phase = "errand";
    show(errand.move, errand.loops, `errand-${Date.now()}`);
    say(errand.line);
    if (errand.kind === "back") {
      // In, and holding it up: that is the showing. The page is told, once.
      playSound("chime", { pitch: 1.2, volume: 0.5 });
      tellWelcomed();
    }
  };

  /** The page hears that the find she came in with has been shown (or that she was called away with it in her hands). */
  const tellWelcomed = () => {
    const s = st.current;
    if (!s.welcomed || s.toldWelcomed === s.welcomed) return;
    s.toldWelcomed = s.welcomed;
    live.current.onWelcomed?.(s.welcomed);
  };

  /** Asleep for the night, the night after a horror: a wide-eyed look out from under the quilt, and asleep again. She does not get up. */
  const peek = () => {
    const s = st.current;
    if (s.phase !== "sleep" || s.abed || s.hiding) return;
    s.peeking = true;
    s.stirredAt = nowMs();
    s.recent = ["spooked" as ActivityId, ...s.recent].slice(0, 3);
    show("quilt-hide", loopsFor("quilt-hide", PEEK_S), `peek-${Date.now()}`);
    say(peekLine(Math.random));
  };

  /** A move and a line where she stands, as her own answer to something (not an errand, not the page's). */
  const answer = (reaction: Reaction) => {
    st.current.phase = "fidget";
    show(reaction.move, reaction.loops, `answer-${Date.now()}`);
    say(reaction.line);
    if (reaction.sound) playSound(reaction.sound);
  };

  const startErrand = (errand: Errand, reduced: boolean) => {
    const s = st.current;
    // Without motion, Pip does not walk anywhere: a bed is got into at once.
    if (reduced && errand.kind === "bed") {
      s.pendingScroll = errand.scroll ?? null;
      tuck(true);
      return;
    }
    s.errand = errand;
    dropPlan();
    if (errand.x !== null && !reduced && Math.abs(errand.x - s.x) > 2) {
      s.target = errand.x;
      s.pace = (errand.hurry ? RUN_SPEED : errand.tiptoe ? TIPTOE_SPEED : WALK_SPEED) * paceNow();
      face(errand.x < s.x ? -1 : 1);
      s.phase = "walk";
      show(errand.as ?? (errand.hurry ? "scamper" : errand.tiptoe ? "tiptoe" : strollMove()), undefined, "walk");
      return;
    }
    // Without motion she is simply at the fridge, not on her way to it.
    if (reduced && errand.fridge && errand.x !== null) {
      s.x = errand.x;
      place();
    }
    arrive();
  };

  /** A ripe plant to point out: stand beside it, facing it. */
  const ripeErrand = (): Errand | null => {
    const s = st.current;
    const { level: lv, plots: shown } = live.current;
    if (!shown) return null;
    const beds = plotBoxes(lv, shown.length);
    const ripe = shown.map((plot, index) => ({ plot, box: beds[index] })).filter(({ plot }) => plot.ripe && plot.plant && !plot.locked);
    if (ripe.length === 0) return null;
    const choice = ripe.find(({ plot }) => plot.plot !== s.lastPointed) ?? ripe[0];
    s.lastPointed = choice.plot.plot;
    const middle = choice.box.x + choice.box.w / 2;
    const fromLeft = Math.abs(middle - 17 - s.x) <= Math.abs(middle + 17 - s.x);
    let x = fromLeft ? middle - 17 : middle + 17;
    let face: 1 | -1 = fromLeft ? 1 : -1;
    if (x < 18) [x, face] = [middle + 17, -1];
    else if (x > lv.w - 18) [x, face] = [middle - 17, 1];
    // Said the first time only; after that the pointing says it.
    const line = s.saidRipe ? null : pickOne(RIPE_LINES);
    s.saidRipe = true;
    return { kind: "ripe", x, face, move: "point", loops: 3, line, after: 0 };
  };

  /**
   * What Pip does with a free moment, if anything in particular: what is
   * waiting first (a cue, a new piece to see), then bed at night, then now
   * and then a ripe plant, or an evening yawn. Null: a stroll or a hobby.
   */
  const plan = (now: number, reduced: boolean): Errand | null => {
    const s = st.current;
    const { level: lv, decor: dc, decorating: busy } = live.current;
    const ready = s.queue.findIndex((errand) => errand.after <= now);
    if (ready >= 0) return s.queue.splice(ready, 1)[0];
    if (busy) return null;
    const hour = new Date().getHours();
    const bed = bedBox(lv, dc);
    if (bed && bedtime(hour) && now > s.wokeUntil) {
      // For the night, not a nap someone asked for earlier and she never got to.
      s.napFor = null;
      // Her own bedtime: every other night or so the phone comes too.
      const scroll = bedtimeScroll(hour, s.recent, Math.random) ? scrollSession(hour, Math.random, reduced) : undefined;
      return { kind: "bed", x: clampX(bed.x + bed.w * 0.75), face: -1, move: "yawn", loops: 1, after: 0, then: "tuck", scroll };
    }
    if (reduced) return null;
    if (now > s.pointedAt + POINT_EVERY_MS && Math.random() < 0.55) {
      const errand = ripeErrand();
      if (errand) {
        s.pointedAt = now;
        return errand;
      }
    }
    if (isEvening(hour) && Math.random() < 0.25) return { kind: "yawn", x: null, move: "yawn", loops: 1, after: 0 };
    return null;
  };

  /** A piece just put out: once it has landed, Pip goes over and looks at it (up at it, on a wall). */
  const visit = (box: { x: number; y: number; w: number; h: number }, fits: HouseSlot["fits"]) => {
    const s = st.current;
    const up = fits === "wall" || fits === "window" || fits === "ceiling";
    let x = box.x + box.w / 2;
    let face: 1 | -1 = x >= s.x ? 1 : -1;
    if (!up) {
      // Beside it, on the side nearer Pip, turned towards it.
      const left = box.x - 12;
      const right = box.x + box.w + 12;
      const fromLeft = Math.abs(left - s.x) <= Math.abs(right - s.x);
      [x, face] = fromLeft ? [left, 1] : [right, -1];
    }
    const after = nowMs() + VISIT_AFTER_MS;
    s.queue = [...s.queue.filter((errand) => errand.kind !== "visit"), { kind: "visit", x: clampX(x), face, move: up ? "pointup" : "look", loops: up ? 2 : 1, after }];
    if (s.phase === "rest") s.nextFree = Math.min(s.nextFree, after);
  };

  // A new floor: Pip arrives in the middle, on the floor, awake (and out of the hand).
  useEffect(() => {
    const s = st.current;
    dragEnd.current?.("cancel");
    setTucked(null);
    s.hop = null;
    s.errand = null;
    s.plan = null;
    s.touch = null;
    s.ball = null;
    // Nothing of the night comes along: no phone, no fridge door held (the furnishings shut it), nobody tucked in.
    s.abed = null;
    s.pendingScroll = null;
    s.fridgeHold = null;
    s.snoozing = false;
    s.hiding = false;
    s.tuckedAt = -Infinity;
    phoneGlow.current = null;
    setBallOut(false);
    s.queue = s.queue.filter((errand) => errand.kind === "cue");
    s.x = level.w / 2;
    s.y = level.walkY;
    s.vy = 0;
    rest();
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level.id]);

  // Decorating wakes Pip: the bed may be about to move.
  useEffect(() => {
    if (decorating) untuck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decorating]);

  // Pointed at (the walkthrough): she stops what she is doing and stands still for it.
  useEffect(() => {
    const s = st.current;
    if (!attentive || s.phase === "held" || s.phase === "fall" || s.phase === "sleep" || s.phase === "tuck" || s.phase === "act") return;
    s.errand = null;
    s.touch = null;
    dropPlan();
    rest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attentive]);

  // The bed's front is drawn from the room's own frame: draw it as it appears.
  useLayoutEffect(() => {
    redraw.current?.();
  }, [tucked]);

  // Cues from the page (a wish granted): done when Pip is next free.
  useEffect(
    () =>
      onPipCue((cue) => {
        const s = st.current;
        // Out of the house: nobody to do it.
        if (outRef.current) return;
        const after = nowMs() + 300;
        s.queue = [...s.queue.filter((errand) => errand.kind !== "cue" || errand.move !== cue.move), { kind: "cue", x: null, move: cue.move, loops: cue.loops ?? 1, line: cue.line ?? null, after }];
        if (s.phase === "rest") s.nextFree = Math.min(s.nextFree, after);
      }),
    []
  );

  // Every render (a new scale, the ball just out): Pip and the ball back at their places.
  useEffect(() => {
    place();
    placeBall();
  });

  // Resting pose follows the mood.
  useEffect(() => {
    if (st.current.phase === "rest") show(base, undefined, "rest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Something to do now, from the page: stop (getting out of bed if need be),
  // face the reader, do it. An errand under way waits until after.
  useEffect(() => {
    if (!act) return;
    const s = st.current;
    if (outRef.current) {
      // Out of the house: there is nobody to do it, and nothing waits on her.
      live.current.onActDone();
      return;
    }
    // Out of the hand first: the page has something for her to do.
    dragEnd.current?.("cancel");
    untuck();
    s.touch = null;
    if (s.phase === "held" || s.phase === "fall") {
      s.phase = "act";
      s.y = live.current.level.walkY;
      s.vy = 0;
      place();
    }
    // (Not the fridge: by the time she is free again its door has shut.)
    if (s.errand && s.errand.kind !== "bed" && !s.errand.fridge) s.queue.push({ ...s.errand, after: 0 });
    s.errand = null;
    dropPlan();
    // A snack is remembered a while: a full Pip is a sleepy Pip.
    const snack = /^treat-/.test(act.move) && !live.current.repertoire.toys.includes(act.move);
    if (snack) s.fedAt = nowMs();
    // At the fridge she opened for it: she eats it there, in its light, and shuts the door after.
    if (snack && s.fridgeHold) s.fridgeHold = { ...s.fridgeHold, why: "eating" };
    s.phase = "act";
    show(act.move, act.loops, `act-${act.key}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act?.key]);

  // A new look (the wardrobe, a preview) goes on in a spin and a puff of smoke:
  // the old look turns edge-on, and the new one turns back round.
  const lookKey = `${skin}|${outfit.join("+")}`;
  const [look, setLook] = useState<Look>({ skin, outfit, key: lookKey });
  useLayoutEffect(() => {
    if (lookKey === look.key) return;
    const next = { skin, outfit, key: lookKey };
    const spinner = spinRef.current;
    if (!hidePip) playSound("pop", { pitch: 1.5, volume: 0.45 });
    if (hidePip || !spinner || prefersReducedMotion()) {
      setLook(next);
      return;
    }
    spinner.animate(
      [
        { transform: "translateY(0) rotateY(0deg)" },
        { transform: "translateY(-14%) rotateY(180deg)", offset: 0.45 },
        { transform: "translateY(0) rotateY(360deg)" }
      ],
      { duration: 520, easing: "cubic-bezier(0.4, 0, 0.3, 1)" }
    );
    const box = spinner.getBoundingClientRect();
    const k = live.current.scale;
    const middle = { x: box.left + box.width / 2, y: box.top + box.height * 0.6 };
    puff(middle, { px: k, count: 10, color: "#FFFFFF", edge: "#DCD6C8", spread: box.width * 0.55, rise: box.height * 0.25, duration: 620 });
    burst(middle, { px: k, count: 6, sprite: "spark", spread: box.width * 0.7, lift: box.height * 0.2, fall: 4 });
    // Edge-on at a quarter turn (about 150 ms in, on that curve): the moment to swap.
    const timer = window.setTimeout(() => setLook(next), 150);
    return () => window.clearTimeout(timer);
    // look.key is read, not watched: only a new look starts a spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, hidePip]);

  const onSpriteDone = () => {
    const s = st.current;
    if (s.phase === "act") {
      live.current.onActDone();
      // The snack from the fridge is eaten: the door goes to.
      shutFridge();
      rest();
    } else if (s.phase === "errand") {
      const errand = s.errand;
      s.errand = null;
      if (errand?.then === "tuck") {
        s.pendingScroll = errand.scroll ?? null;
        tuck(false);
      } else if (errand?.then === "fridge") {
        s.fidgets = 0;
        s.plan = { activity: fridgeVisit(outlook(nowMs(), prefersReducedMotion()), Math.random, false), index: -1 };
        nextStep();
      } else if (errand?.kind === "snack") {
        // She waited at the open door and no snack came.
        shutFridge();
        answer(fridgeNothing(Math.random));
      } else if (errand?.kind === "back") {
        // Shown: it goes in her pocket (and into the album), in a puff.
        const head = headPoint();
        if (head && holdingRef.current && !prefersReducedMotion()) puff({ x: head.x, y: head.y - 8 * live.current.scale }, { px: live.current.scale, count: 5, color: "#FFFFFF", edge: "#DCD6C8", spread: 24 });
        setHolding(null);
        rest();
      } else {
        // Done hoping at the reader's open fridge: she stays by it a little, in case.
        if (errand?.kind === "hope") s.hopedUntil = nowMs() + HOPE_STAYS_MS;
        rest();
      }
    } else if (s.phase === "doing") {
      nextStep();
    } else if (s.phase === "fidget" || s.phase === "land") {
      rest();
    } else if (s.phase === "sleep" && s.abed) {
      nextBeat();
    } else if (s.phase === "sleep" && s.snoozing) {
      // Snoozed: asleep again, until the clock is looked at next.
      s.snoozing = false;
      show("sleep", undefined, "sleep");
    } else if (s.phase === "sleep" && s.peeking) {
      // Nothing there: asleep again.
      s.peeking = false;
      show("sleep", undefined, "sleep");
    }
  };

  // Hidden (in a game), Pip is not in bed either; back from one, she has had her fill of games.
  useEffect(() => {
    if (hidePip) {
      st.current.gamedAt = nowMs();
      dragEnd.current?.("cancel");
      dropPlan();
    }
    if (hidePip) untuck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidePip]);

  // The loop: strolls, free moments, errands, falling after a drop, a hop into bed.
  useEffect(() => {
    if (hidePip) return;
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = 0;
    const step = (time: number) => {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      const s = st.current;
      const { level: lv } = live.current;
      if (outRef.current) {
        // She is out: the room goes on without her.
        stepBall(time, dt, reduced);
        furnishRef.current?.step(dt, reduced);
        return;
      }
      // Called away with the find still over her head (picked up, poked): it is put by, and counts as shown.
      if (holdingRef.current && s.errand?.kind !== "back") {
        setHolding(null);
        tellWelcomed();
      }
      if (s.phase === "walk") {
        const dir = s.target < s.x ? -1 : 1;
        const next = s.x + dir * s.pace * dt;
        // Not through a visitor: she stops at their side. What she was on her way to is beyond them, so it
        // is given up (a plan, the fridge, her bed: see `tuck`); a thing she can do from where she stands, she does.
        const stop = stopForVisitor(worldNow()?.visitor, s.x, dir < 0 ? Math.max(next, s.target) : Math.min(next, s.target));
        if (stop !== null) {
          s.x = stop;
          if (s.errand && !s.errand.fridge) {
            arrive();
          } else {
            s.errand = null;
            dropPlan(true);
            rest();
          }
        } else if ((dir < 0 && next <= s.target) || (dir > 0 && next >= s.target)) {
          s.x = s.target;
          arrive();
        } else {
          s.x = next;
        }
        place();
      } else if (s.phase === "fall") {
        // Dropped or thrown: an arc, off the walls and the ceiling, a bounce or two on the floor.
        const flight = flyStep({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin }, dt, airBounds(lv), PIP_BOUNCE, true);
        ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin } = flight.body);
        s.hardest = Math.max(s.hardest, flight.impact);
        if (flight.hit) playSound("bounce", { pitch: 1.3, volume: Math.min(0.7, 0.25 + Math.max(flight.impact, 150) / 600) });
        if (flight.landed) {
          // A hard landing (or one still spinning) leaves her seeing stars, and wanting another go.
          const hard = s.tossed && (s.hardest > HARD_LANDING || Math.abs(s.spin) > 4);
          const tilt = nearUpright(s.angle);
          s.vx = 0;
          s.angle = 0;
          s.spin = 0;
          s.hardest = 0;
          s.phase = "land";
          if (hard) {
            show("dizzy", 1);
            say(pickOne(["whee! again!", "again! again!", "whoa. do that again."]));
          } else {
            show("land", 1);
          }
          playSound("place", { pitch: 1.2, volume: 0.5 });
          if (s.tossed) played("toss");
          s.tossed = false;
          // Down at a tilt: she rights herself, the short way round.
          if (Math.abs(tilt) > 0.02) {
            spinRef.current?.animate(
              [
                { transformOrigin: TURN_AIR, transform: `rotate(${tilt.toFixed(3)}rad)` },
                { transformOrigin: TURN_AIR, transform: "rotate(0rad)" }
              ],
              { duration: RIGHT_MS, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" }
            );
          }
        }
        place();
      } else if (s.phase === "held") {
        // Hanging from the hand by her leaf: the hand's sideways push swings her (pip/play.ts).
        s.hold = holdStep(s.hold, dt, reduced);
        if (s.grip.x !== 0 || s.grip.y !== 0) {
          // Picked up by the body: she slides the last of the way into the hand.
          const keep = reduced ? 0 : Math.exp(-dt * GRIP_EASE);
          s.grip = Math.hypot(s.grip.x, s.grip.y) * keep < 0.2 ? { x: 0, y: 0 } : { x: s.grip.x * keep, y: s.grip.y * keep };
          carry();
        }
        place();
      } else if (s.phase === "petted" && s.touch) {
        const touch = s.touch;
        if (time - touch.last > TOUCH_GAP_MS) {
          // The hand has gone: a happy sigh if it stayed a while.
          const stayed = touch.last - touch.since >= TOUCH_MIN_MS;
          s.touch = null;
          s.phase = "fidget";
          if (stayed) {
            played(touch.kind);
            show(touch.kind === "pet" ? "smitten" : "shift", 1);
          } else {
            rest();
          }
        } else if (time > touch.fxAt) {
          touch.fxAt = time + TOUCH_FX_MS;
          playSound(touch.kind === "pet" ? "purr" : "giggle", { volume: 0.7 });
          const head = headPoint();
          if (head && !reduced && touch.kind === "pet") burst(head, { px: live.current.scale, count: 2, sprite: "heart", spread: 30 * live.current.scale * 0.4, lift: 22, fall: 2, duration: 900 });
        }
      } else if ((s.phase === "fetch" || s.phase === "carry") && s.ball) {
        const ball = s.ball;
        // After the ball (wherever it has rolled to), or back to where it was thrown from.
        const to = s.phase === "fetch" ? ball.body.x : ball.home;
        const dir = to < s.x ? -1 : 1;
        if (s.phase === "fetch" && (ball.state === "held" || ball.state === "air")) {
          // The reader has it again: she waits to see where it goes.
          rest();
        } else if (Math.abs(to - s.x) > 6 && stopForVisitor(worldNow()?.visitor, s.x, clampX(s.x + dir * (s.phase === "fetch" ? RUN_SPEED : CARRY_SPEED) * dt)) !== null) {
          // The ball (or the way back with it) is beyond the visitor: she leaves it, rather than run through them.
          ball.home = ball.state === "carried" ? s.x : ball.body.x;
          answer({ move: "shift", loops: 1, line: s.phase === "fetch" ? "it's behind our guest. yours!" : null });
        } else if (Math.abs(to - s.x) > 6) {
          face(dir);
          s.x = clampX(s.x + dir * (s.phase === "fetch" ? RUN_SPEED : CARRY_SPEED) * dt);
          // The floor's edge: as near as she can get is near enough.
          if ((s.x <= 18 && dir < 0) || (s.x >= lv.w - 18 && dir > 0)) ball.body.x = s.x;
          place();
        } else if (s.phase === "fetch") {
          if (ball.state === "still" || ball.state === "roll") {
            // Got it: up over her head, and back.
            ball.state = "carried";
            ball.touched = time;
            placeBall();
            playSound("pop", { pitch: 1.3 });
            s.phase = "carry";
            face(ball.home < s.x ? -1 : 1);
            show(live.current.ownBall ? "carry" : "carry-paper", undefined, "carry");
          }
        } else {
          // Back: the ball goes down in front of her, and she is pleased with herself.
          ball.state = "still";
          ball.body = { x: clampX(s.x + s.facing * 10), y: lv.walkY - BALL_RADIUS, vx: 0, vy: 0, angle: 0, spin: 0 };
          ball.touched = time;
          placeBall();
          s.fetches += 1;
          s.phase = "fidget";
          // Three in a row and she is puffed.
          if (s.fetches % 3 === 0) {
            show("hydrate", 1);
            say("phew. one more?");
          } else {
            show("cheer", 1);
            if (s.fetches === 1) say(pickOne(["got it!", "again?", "throw it again!"]));
          }
          played("fetch");
        }
      } else if (s.phase === "fetch" || s.phase === "carry") {
        // The ball has gone (put away, another floor): nothing to fetch.
        rest();
      } else if (s.phase === "tuck" && s.hop) {
        // A little arc from beside the bed into it.
        const hop = s.hop;
        const t = Math.min(1, (time - hop.start) / HOP_MS);
        s.x = hop.fromX + (hop.toX - hop.fromX) * t;
        s.y = hop.fromY + (hop.toY - hop.fromY) * t - Math.sin(t * Math.PI) * 12;
        place();
        if (t >= 1) {
          const bed = bedBox(lv, live.current.decor);
          if (bed) sleepIn(bed);
          else rest();
        }
      } else if (s.phase === "sleep" && time > s.wakeAt) {
        // A nap is over: up, and on with what she was doing (the stretch that ends a nap), or a stretch of its own.
        s.wakeAt = Infinity;
        untuck();
        s.wokeUntil = 0;
        if (s.plan) {
          nextStep();
        } else {
          s.errand = { kind: "cue", x: null, move: "stretch", loops: 1, after: 0 };
          arrive();
        }
      } else if (s.phase === "sleep" && time > s.nightCheck) {
        // Morning comes while the tab is open: up, with a stretch.
        s.nightCheck = time + 30_000;
        // (Day, not just past bedtime: put to bed in the evening, she is in it for the night.)
        const hour = new Date().getHours();
        if (!bedtime(hour) && !dark(hour) && snoozes(hour, s.snoozed || Boolean(s.abed) || s.hiding)) {
          // Day, and she knows it: the quilt goes back over her head, once.
          s.snoozed = true;
          s.snoozing = true;
          s.nightCheck = time + SNOOZE_S * 1000;
          show("snooze", 1, `snooze-${Date.now()}`);
          say(snoozeLine(Math.random));
        } else if (!bedtime(hour) && !dark(hour)) {
          const snoozed = s.snoozed;
          untuck();
          s.wokeUntil = 0;
          // Up with a stretch; and, some mornings, straight to the fridge.
          s.errand = {
            kind: "cue",
            x: null,
            move: "stretch",
            loops: 1,
            line: snoozed ? upLine(Math.random) : null,
            after: 0,
            then: morningFridge(Boolean(furnishRef.current?.fridge()), Math.random) ? "fridge" : undefined
          };
          arrive();
        } else if (!s.abed && !s.peeking && s.wakeAt === Infinity && !live.current.decorating && !live.current.attentive) {
          // Still night, and she is asleep for it: now and then something has her up (pip/behaviour.ts, `nightStir`;
          // never within a while of the reader tucking her in).
          const minutes = (since: number) => (time - since) / 60_000;
          const stir = nightStir(
            {
              hour,
              fridge: Boolean(furnishRef.current?.fridge()),
              asleepFor: minutes(s.sleptAt),
              tuckedAgo: s.tuckedAt > -Infinity ? minutes(s.tuckedAt) : null,
              stirredAgo: s.stirredAt > -Infinity ? minutes(s.stirredAt) : null,
              recent: s.recent,
              spooked: spookedTonight(worldNow())
            },
            Math.random
          );
          if (stir === "fridge") raid();
          else if (stir === "scroll") startScroll(scrollSession(hour, Math.random, reduced));
          else if (stir === "peek") peek();
        }
      } else if (s.phase === "rest" && s.ball && (s.ball.state === "roll" || s.ball.state === "still") && Math.abs(s.ball.body.x - s.ball.home) > 14 && !reduced) {
        // The ball is down, away from where it was thrown: after it.
        chase();
      } else if (s.phase === "rest" && time > s.nextFree) {
        const errand = s.plan ? null : plan(time, reduced);
        if (errand) {
          startErrand(errand, reduced);
        } else if (s.plan) {
          // A pause inside an activity is over.
          nextStep();
        } else if (live.current.decorating || live.current.attentive) {
          // Out of the way while the room is rearranged, or still while she is pointed at: she watches.
          s.nextFree = time + 4000;
        } else if (s.fidgets > 0 && !reduced) {
          // A small thing while standing about.
          s.fidgets -= 1;
          const small = fidget({ mood: live.current.mood, hour: new Date().getHours(), world: worldNow() }, s.lastFidget, Math.random);
          s.lastFidget = small.move;
          s.phase = "fidget";
          show(small.move, loopsFor(small.move, small.seconds), `fidget-${Date.now()}`);
        } else {
          // The next thing to do, start to finish.
          s.plan = { activity: chooseActivity(outlook(time, reduced), Math.random), index: -1 };
          nextStep();
        }
      } else if (s.phase === "rest" && !reduced && time > s.gazeAt) {
        // Standing about, her eyes follow the pointer while it is moving near.
        s.gazeAt = time + GAZE_EVERY_MS;
        const pointer = s.pointer;
        const base = live.current.base;
        const watching = pointer && time - pointer.at < GAZE_FRESH_MS && base === "idle";
        const gaze = watching ? gazeAt({ x: s.x, y: s.y - 15 }, pointer, 9) : { dx: 0 as const, dy: 0 as const };
        // The sprite is mirrored when she faces left, so left and right swap.
        const wanted = gazeMove(s.facing < 0 ? { dx: (gaze.dx * -1) as -1 | 0 | 1, dy: gaze.dy } : gaze, base);
        if (wanted !== viewRef.current.move) show(wanted, undefined, "rest");
      }
      // Called away from the fridge she had open (picked up, poked, a ball thrown): the door goes to behind her.
      const hold = s.fridgeHold;
      if (hold && !(hold.why === "snack" ? s.phase === "errand" && s.errand?.kind === "snack" : hold.why === "eating" ? s.phase === "act" : s.plan?.activity.id === "fridge")) shutFridge();
      stepBall(time, dt, reduced);
      furnishRef.current?.step(dt, reduced);
    };
    stepRef.current = step;
    const tick = (time: number) => {
      step(time + clockSkew);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!raf && document.visibilityState === "visible") {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      stepRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hidePip]);

  // Development only: Pip's day, stepped by hand. `advance(ms)` winds the
  // scene's clock on in frames, ending each move when its loops are up (the
  // sprite's own clock stands still in a hidden window); `state()` says what
  // she is doing. Not in a release build: the check is a constant there.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hook = {
      advance: (ms: number, frame = 40) => {
        for (let passed = 0; passed < ms; passed += frame) {
          clockSkew += frame;
          const time = nowMs();
          stepRef.current?.(time);
          if (moveEnds.current !== null && time >= moveEnds.current) {
            moveEnds.current = null;
            onSpriteDone();
          }
        }
        return hook.state();
      },
      state: () => {
        const s = st.current;
        const ball = s.ball ? `${s.ball.state}@${Math.round(s.ball.body.x)},${Math.round(s.ball.body.y)}` : null;
        const fixed = (value: number, places = 2) => Number(value.toFixed(places));
        return {
          phase: s.phase,
          move: viewRef.current.move,
          x: Math.round(s.x),
          y: Math.round(s.y),
          facing: s.facing,
          doing: s.plan?.activity.id ?? null,
          step: s.plan?.index ?? null,
          recent: s.recent.join(","),
          errand: s.errand?.kind ?? null,
          abed: s.abed ? `${s.abed.beats[s.abed.index]?.beat ?? "?"} ${s.abed.index + 1}/${s.abed.beats.length}` : null,
          hiding: s.hiding,
          peeking: s.peeking,
          away: outRef.current,
          holding: holdingRef.current ? `${holdingRef.current.width}x${holdingRef.current.height}` : null,
          welcomed: s.toldWelcomed,
          pace: fixed(s.pace, 1),
          label: s.plan?.activity.label ?? null,
          glow: phoneGlow.current,
          tucked: s.tuckedAt > -Infinity,
          line: ownLineRef.current,
          fridge: furnishRef.current?.fridge() ?? null,
          fidgets: s.fidgets,
          ball,
          angle: fixed(s.angle),
          // Held and thrown, to the hundredth: where, how fast, which way up, and the swing in the hand.
          at: [fixed(s.x), fixed(s.y)],
          v: [fixed(s.vx, 1), fixed(s.vy, 1)],
          spin: fixed(s.spin),
          swing: [fixed(s.hold.swing.angle, 3), fixed(s.hold.swing.spin)],
          turn: spinRef.current?.style.transform ?? "",
          dragging: s.drag !== null
        };
      },
      poke: () => {
        if (!outRef.current) pokePip();
        return hook.state();
      },
      play: (how: "pet" | "tickle" | "ball" | "toss") => {
        if (outRef.current) return hook.state();
        if (how === "pet") touchPip("pet", 2600);
        else if (how === "tickle") touchPip("tickle", 2200);
        else if (how === "ball") throwBall();
        else hop();
        return hook.state();
      },
      /** The furnishings that can be used on this floor: where each is and how it stands. */
      furnish: () => furnishRef.current?.state() ?? [],
      /** Uses the first furnishing of a kind as a tap would ("fridge", "bed", "lamp"...). */
      use: (kind: Parameters<NonNullable<typeof furnishRef.current>["use"]>[0]) => {
        furnishRef.current?.use(kind);
        return hook.state();
      },
      /** The night, on demand: up for the fridge, or (in bed) out with the phone. */
      night: (what: "fridge" | "scroll" | "peek") => {
        if (what === "fridge") raid();
        else if (what === "peek") peek();
        else startScroll(scrollSession(new Date().getHours(), Math.random, prefersReducedMotion()));
        return hook.state();
      },
      /** The bed, as the reader's hand uses it. */
      bed: () => {
        putToBed();
        return hook.state();
      },
      /** The Play rail's Snack key: off to the fridge. */
      snack: () => {
        fetchSnack();
        return hook.state();
      },
      /** What she knows of the world, set by hand (over what the page gives); null: the page's again. */
      world: (patch?: World | null) => {
        if (patch !== undefined) setWorldStub(patch);
        return worldNow() ?? null;
      },
      /** A visitor's knock, arrival or leaving, as the visitors' layer reports it. */
      visitor: (what: "knocked" | "arrived" | "left") => {
        company(what);
        return hook.state();
      },
      /** Starts an activity by name, from where she stands, as if she had chosen it. */
      choose: (id: ActivityId) => {
        const s = st.current;
        if (!TOUCHABLE.has(s.phase) || s.phase === "sleep" || s.phase === "tuck") return hook.state();
        const reduced = prefersReducedMotion();
        s.errand = null;
        s.touch = null;
        dropPlan();
        s.fidgets = 0;
        s.plan = { activity: planActivity(id, outlook(nowMs(), reduced), Math.random), index: -1 };
        nextStep();
        return hook.state();
      },
      /** The plan under way, step by step. */
      plan: () => st.current.plan?.activity ?? null,
      scene: st
    };
    (window as unknown as { __pipHouse?: typeof hook }).__pipHouse = hook;
    return () => {
      delete (window as unknown as { __pipHouse?: typeof hook }).__pipHouse;
    };
  });

  // ---- coming back after reading --------------------------------------------------------
  // A focus session done since Pip last saw the reader (on this device): Pip
  // says hello, out of bed if need be. Not on a first look (nothing to come
  // back from), and not over a celebration already queued, which says it.
  const sessionsDone = usePipWardrobeStore((state) => state.overview?.sessionsDone ?? null);
  const suspended = usePipStore((state) => state.suspended);
  useEffect(() => {
    if (sessionsDone === null || suspended || hidePip) return;
    const seen = readNumber(GREETED_KEY);
    if (seen !== null && sessionsDone <= seen) return;
    const timer = window.setTimeout(() => {
      writeNumber(GREETED_KEY, sessionsDone);
      const pip = usePipStore.getState();
      // (Not while she is out, and not over a find she is bringing in: that is her hello.)
      if (seen === null || pip.reaction || pip.queue.length > 0 || outRef.current || worldNow()?.back) return;
      pip.react("welcome", { loops: 1, line: pickOne(GREETINGS) });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [sessionsDone, suspended, hidePip]);

  // ---- out, and back with something in hand -----------------------------------------------
  // An expedition (the world says so: `away`, then `back`): she is not in the
  // house at all while she is out, a note left on her pillow, the room
  // otherwise alive; and she comes back in from the side with what she found
  // held up over her head, shows it, and it goes into the album (the page is
  // told: `onWelcomed`). A find not yet shown when the tab opens is brought
  // in the same way. Without motion she is simply back, holding it up.

  /** In through the side: with the find held up, or (nothing found) just home. */
  const comeIn = (found: NonNullable<World["back"]> | null) => {
    const s = st.current;
    const lv = live.current.level;
    const reduced = prefersReducedMotion();
    dragEnd.current?.("cancel");
    untuck();
    dropPlan();
    s.errand = null;
    s.touch = null;
    s.fidgets = 0;
    const to = clampX(Math.round(lv.w * 0.7));
    s.x = reduced ? to : lv.w + DOOR_BEYOND;
    s.y = lv.walkY;
    s.vy = 0;
    s.facing = -1;
    place();
    if (found) {
      s.welcomed = found.key;
      setHolding(found.image ?? null);
      startErrand({ kind: "back", x: to, move: "show", loops: 3, line: found.line ?? "look what i found!", after: 0, as: "bring" }, reduced);
    } else {
      startErrand({ kind: "cue", x: to, move: "welcome", loops: 1, line: pickOne(HOME_LINES), after: 0 }, reduced);
    }
  };

  const wasOut = useRef(false);
  const backKey = world?.back?.key ?? null;
  useEffect(() => {
    const s = st.current;
    if (out) {
      if (!wasOut.current) {
        // Off she goes: out of the hand, out of bed, whatever she was at dropped, the ball put away.
        dragEnd.current?.("cancel");
        untuck();
        shutFridge();
        dropPlan();
        s.errand = null;
        s.touch = null;
        s.queue = [];
        s.ball = null;
        setBallOut(false);
        setHolding(null);
        s.phase = "rest";
      }
      wasOut.current = true;
      return;
    }
    // (In a game: she comes in when the room is hers again.)
    if (hidePip) return;
    const came = wasOut.current;
    wasOut.current = false;
    const found = world?.back ?? null;
    if (found && s.welcomed !== found.key) comeIn(found);
    else if (came) comeIn(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, backKey, hidePip]);

  // The note she leaves: selecting it (or resting on it) shows what it says.
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => {
    if (!out) setNoteOpen(false);
  }, [out]);

  // ---- company -------------------------------------------------------------------------------
  // A friend's Pip visits (components/pip/Visitors.tsx, laid over the room by
  // the page; the world says where they stand). She hears the knock, goes over
  // to say hello and reads beside them (pip/behaviour.ts plans it), and waves
  // them off. Her walks stop at the visitor's side (see the loop).
  const company = (what: "knocked" | "arrived" | "left") => {
    const s = st.current;
    if (outRef.current) return;
    const free = () => TOUCHABLE.has(s.phase) && s.phase !== "sleep" && s.phase !== "tuck" && s.phase !== "petted" && s.errand?.kind !== "back" && !live.current.decorating;
    if (what === "knocked") {
      if (!free()) return;
      s.errand = null;
      dropPlan();
      // Towards the door (the right-hand wall, as the visitors have it).
      face(1);
      answer({ move: "boop", loops: 2, line: knockedLine(Math.random) });
    } else if (what === "arrived") {
      // A moment, so the world has heard where they stand.
      later(200, () => {
        if (!free() || !worldNow()?.visitor) return;
        const reduced = prefersReducedMotion();
        s.errand = null;
        s.touch = null;
        dropPlan();
        s.fidgets = 0;
        s.plan = { activity: greetVisitor(outlook(nowMs(), reduced), Math.random), index: -1 };
        nextStep();
      });
    } else if (free()) {
      const after = nowMs() + 300;
      s.queue = [...s.queue.filter((errand) => errand.kind !== "cue" || errand.move !== "welcome"), { kind: "cue", x: null, face: 1, move: "welcome", loops: 1, line: goodbyeLine(Math.random), after }];
      if (s.phase === "rest") s.nextFree = Math.min(s.nextFree, after);
    }
  };

  // ---- "you stopped there?" ----------------------------------------------------------------
  // The reader closed a book in the middle of a chapter (the reader leaves the
  // record: pip/readingMoments.ts) and has come to see Pip within the hour:
  // she has a word about it, once, when she is next free. Not from her bed:
  // a sleeping Pip says nothing, and the stop keeps for a later visit.
  useEffect(() => {
    if (suspended || hidePip) return;
    const timer = window.setTimeout(() => {
      const s = st.current;
      const stop = readStop();
      const remark = stopRemark(stop, Date.now(), Math.random);
      if (!stop || !remark || s.phase === "sleep" || s.phase === "tuck" || outRef.current) return;
      markStopSaid(stop);
      const after = nowMs() + 300;
      s.queue = [...s.queue, { kind: "cue", x: null, move: "look", loops: 1, line: remark, after }];
      if (s.phase === "rest") s.nextFree = Math.min(s.nextFree, after);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [suspended, hidePip]);

  // ---- the rain barrel -----------------------------------------------------------------
  // On a garden floor: the water reading poured while nothing grew, waiting for
  // the next planting. New water since the garden was last on screen rains
  // into it, after the plots have had theirs.
  const gardenWater = usePipWardrobeStore((state) => state.overview?.garden ?? null);
  const barrel = plots ? barrelBox(level) : null;
  const barrelWater = gardenWater ? Math.round(gardenWater.barrel) : 0;
  const barrelCap = gardenWater?.barrelCap ?? 120;
  useEffect(() => {
    if (!barrel || !gardenWater || suspended) return;
    const seen = readNumber(BARREL_SEEN_KEY);
    if (seen === null || barrelWater - seen < 1 || prefersReducedMotion()) {
      writeNumber(BARREL_SEEN_KEY, barrelWater);
      return;
    }
    const timer = window.setTimeout(() => {
      writeNumber(BARREL_SEEN_KEY, barrelWater);
      const shown = onScreen(barrel);
      if (!shown) return;
      const k = live.current.scale;
      floatText({ x: shown.left + shown.width / 2, y: shown.top - 6 * k }, `+${barrelWater - seen} water`, "water");
      void rain(shown, shown.top + 4 * k, { px: k, count: 8, spread: 420 });
    }, 1100);
    return () => window.clearTimeout(timer);
    // The barrel box follows the floor; its water is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barrel !== null, barrelWater, suspended]);

  // ---- what the page can ask of the scene ------------------------------------------------
  const plotIndex = (plot: number) => (plots ?? []).findIndex((entry) => entry.plot === plot);
  useImperativeHandle(ref, () => ({
    pixel: () => live.current.scale,
    room: () => roomRef.current?.getBoundingClientRect() ?? null,
    pip: () => spinRef.current?.getBoundingClientRect() ?? null,
    pipPoint: (part) => {
      const box = spinRef.current?.getBoundingClientRect();
      if (!box) return null;
      // Pip's mouth sits a little forward of centre, in the 32 px frame.
      const forward = st.current.facing < 0 ? -1 : 1;
      return part === "mouth"
        ? { x: box.left + box.width * (0.5 + (3 / 32) * forward), y: box.top + box.height * (18 / 32) }
        : { x: box.left + box.width / 2, y: box.top + box.height * (8 / 32) };
    },
    dropStart: (slotId, itemId) => {
      const slot = live.current.level.slots.find((entry) => entry.id === slotId);
      const box = slot ? itemBox(itemId, slot) : null;
      return box ? onScreen({ ...box, y: box.y - DROP_FROM }) : null;
    },
    reap: (plot, plantId) => {
      const index = plotIndex(plot);
      if (index < 0) return null;
      const shown = onScreen(plotBoxes(live.current.level, plots?.length ?? 0)[index]);
      if (!shown) return null;
      const k = live.current.scale;
      try {
        popOff(renderPlant(plantId, 1, true, 0), shown, "pick", nightNow(live.current.level));
      } catch {
        // Art mid-edit: the seeds still fly.
      }
      const middle = { x: shown.left + shown.width / 2, y: shown.top + shown.height * 0.45 };
      burst(middle, { px: k, count: 12, colors: ["#8FD66A", "#4FA84A", "#2F7A36", "#FFE36B"], spread: shown.width * 1.1, lift: shown.height * 0.3 });
      puff({ x: middle.x, y: shown.top + SOIL_TOP * k }, { px: k, count: 6, spread: shown.width * 0.7 });
      return shown;
    },
    expectSprout: (plot, tossed) => {
      if (prefersReducedMotion()) return;
      const delay = (tossed ? TOSS_MS : 0) + SEED_FALL_MS;
      sprouting.current.set(plot, { until: nowMs() + delay + 2500, delay });
    },
    sow: (plot, from) => {
      const index = plotIndex(plot);
      const shown = index < 0 ? null : onScreen(plotBoxes(live.current.level, plots?.length ?? 0)[index]);
      if (!shown || prefersReducedMotion()) {
        playSound("pop");
        return;
      }
      const k = live.current.scale;
      const soil = { x: shown.left + shown.width / 2, y: shown.top + SOIL_TOP * k };
      const above = { x: soil.x, y: soil.y - Math.max(70, 16 * k) };
      const size = seedPixel(k);
      const tossed = from ? tossSeed(centerOf(from.rect), above, size) : Promise.resolve();
      void tossed
        .then(() => dropSeed(above, soil, size))
        .then(() => {
          puff(soil, { px: k, count: 8, spread: shown.width * 0.8 });
          plotNodes.current.get(plot)?.animate([{ transform: "scale(1, 1)" }, { transform: "scale(1.06, 0.9)", offset: 0.35 }, { transform: "none" }], {
            duration: 260,
            easing: "ease-out"
          });
        });
    },
    rain: (watered) => {
      const k = live.current.scale;
      const all = plotBoxes(live.current.level, plots?.length ?? 0);
      const falls = watered.map(({ plot, gained }, order) => {
        const index = plotIndex(plot);
        const shown = index < 0 ? null : onScreen(all[index]);
        if (!shown) return Promise.resolve();
        const soil = shown.top + SOIL_TOP * k;
        // One plot after another, left to right, like a passing shower.
        return new Promise<void>((done) => window.setTimeout(done, order * 220))
          .then(() => {
            floatText({ x: shown.left + shown.width / 2, y: shown.top - 6 * k }, `+${Math.round(gained)} water`, "water");
            return rain(shown, soil, { px: k, count: 10 + Math.min(8, Math.round(gained / 6)) });
          })
          .then(() => puff({ x: shown.left + shown.width / 2, y: soil }, { px: k, count: 5, color: "#BFE6FF", edge: "#7CC8FF", spread: shown.width * 0.6, rise: 8 }));
      });
      return Promise.all(falls).then(() => undefined);
    },
    plotBox: (plot) => {
      const index = plotIndex(plot);
      return index < 0 ? null : onScreen(plotBoxes(live.current.level, plots?.length ?? 0)[index]);
    },
    celebrate: (title, note) => {
      const box = roomRef.current?.getBoundingClientRect();
      if (!box) return;
      confetti(box, { px: live.current.scale, count: 48 });
      banner(box, title, note);
    },
    visitor: (what) => company(what),
    playWith: (how) => {
      // Out of the house: there is nobody to play with.
      if (outRef.current) return;
      if (how === "pet") touchPip("pet", 2600);
      else if (how === "tickle") touchPip("tickle", 2200);
      else if (how === "ball") throwBall();
      else if (how === "bed") putToBed();
      else if (how === "snack") fetchSnack();
      else hop();
    }
    // The floor, the scale and Pip are read from refs; the plots are the one
    // prop it closes over, and plotsKey says when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plotsKey]);

  // ---- playing with Pip --------------------------------------------------------------
  // The reader's hand on her: a poke answered differently each time it comes
  // again, strokes she leans into, a tickle, a ball to fetch, and (below) being
  // picked up by the leaf, swung, and let go. The rules are in pip/play.ts;
  // here they meet the sprite, the sounds and the page (which cheers her up).

  /** The top of her head on screen, where hearts and sparks rise from. */
  const headPoint = (): Point | null => {
    const box = spinRef.current?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height * 0.3 } : null;
  };

  /** A bout of play that counts: told to the page, once in a while per kind. */
  const played = (kind: PlayKind) => {
    const s = st.current;
    const now = nowMs();
    s.playedAt = now;
    if (!playCounts(s.playLast[kind], now)) return;
    s.playLast[kind] = now;
    live.current.onPlayed?.(kind);
  };

  /** Poked: the next rung of the ladder, at once. */
  const pokePip = () => {
    const s = st.current;
    const now = nowMs();
    if (s.phase === "held" || s.phase === "fall") return;
    if (s.phase === "sleep" && s.abed) {
      // On her phone: it is under the quilt before the hand has left her, and she was doing nothing of the kind.
      s.abed.beats.splice(s.abed.index + 1, 0, { beat: "innocent", seconds: 3, line: innocentLine(Math.random) });
      playSound("squeak", { pitch: 0.9, volume: 0.6 });
      nextBeat();
      return;
    }
    if ((s.phase === "sleep" || s.phase === "tuck") && s.hiding) {
      // Under the quilt, and something touched her: out of bed in one go. (The hiding is over; it still counts as done.)
      dropPlan(true);
      untuck();
      s.poke = null;
      s.phase = "fidget";
      show("boop", 2);
      say(pickOne(["eep! ...oh. it's you.", "aah! don't do that.", "not a monster. good. hi."]));
      playSound("squeak", { pitch: 1.4 });
      return;
    }
    if (s.phase === "sleep" || s.phase === "tuck") {
      // Woken: no ladder, just a sleepy Pip.
      untuck();
      s.poke = null;
      s.phase = "fidget";
      show("yawn", 1);
      say("mm? i was asleep.");
      playSound("squeak", { pitch: 0.7 });
      return;
    }
    s.poke = pokeAgain(s.poke, now);
    const reaction = pokeReaction(s.poke.count);
    // Past her own answers (or mid-act, which is the page's to cut short): one of the page's surprises.
    if (reaction.surprise || s.phase === "act") {
      if (reaction.surprise) s.poke = null;
      playSound(reaction.sound, { pitch: reaction.pitch });
      live.current.onPoke();
      return;
    }
    s.errand = null;
    s.touch = null;
    dropPlan();
    s.phase = "fidget";
    show(reaction.move, reaction.loops, `poke-${now}`);
    say(reaction.line);
    playSound(reaction.sound, { pitch: reaction.pitch });
    const head = headPoint();
    if (head && !prefersReducedMotion()) burst(head, { px: live.current.scale, count: 5, sprite: "spark", spread: 44, lift: 14, fall: 8, duration: 480 });
  };

  /**
   * Stroked or tickled, from now for `hold` more milliseconds (the pointer
   * keeps it going as it rubs; a Play key holds it a moment by itself).
   */
  const touchPip = (kind: "pet" | "tickle", hold = 0) => {
    const s = st.current;
    const now = nowMs();
    if (!TOUCHABLE.has(s.phase)) return;
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    s.errand = null;
    dropPlan();
    if (!s.touch || s.touch.kind !== kind) {
      s.touch = { kind, since: s.touch?.since ?? now, last: now + hold, fxAt: now };
      s.phase = "petted";
      show(kind === "pet" ? "pet" : "laugh", undefined, `petted-${kind}`);
      if (kind === "tickle") say("that tickles!");
    } else {
      s.touch.last = Math.max(s.touch.last, now + hold);
    }
  };

  /** After the ball. */
  const chase = () => {
    const s = st.current;
    if (!s.ball) return;
    s.errand = null;
    dropPlan();
    s.phase = "fetch";
    face(s.ball.body.x < s.x ? -1 : 1);
    show("scamper", undefined, "fetch");
  };

  /** The ball out and in the air: from the hand that threw it, or tossed up from beside Pip. */
  const throwBall = (from?: { x: number; y: number; vx: number; vy: number }) => {
    const s = st.current;
    const { level: lv } = live.current;
    const now = nowMs();
    const side = s.x < lv.w / 2 ? 1 : -1;
    const start = from ?? { x: clampX(s.x + side * 14), y: lv.walkY - 34, vx: side * (70 + Math.random() * 70), vy: -210 };
    // Where it is brought back to: where Pip stood when it was thrown.
    s.ball = { body: { ...start, angle: 0, spin: start.vx * 0.12 }, state: "air", home: s.ball?.home ?? s.x, touched: now };
    if (!from) s.ball.home = s.x;
    setBallOut(true);
    placeBall();
    playSound("whee", { pitch: 1.2, volume: 0.6 });
    if (prefersReducedMotion()) {
      // Without motion nothing flies or runs: the ball is at her feet, and that is the game.
      s.ball.state = "still";
      s.ball.body = { x: clampX(s.x + 12), y: lv.walkY - BALL_RADIUS, vx: 0, vy: 0, angle: 0, spin: 0 };
      placeBall();
      if (TOUCHABLE.has(s.phase)) {
        s.phase = "fidget";
        show("cheer", 1);
        played("fetch");
      }
      return;
    }
    // Whatever she was doing can wait: there is a ball.
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    if (s.phase === "doing" || s.phase === "fidget" || s.phase === "walk" || s.phase === "errand" || s.phase === "petted") {
      s.errand = null;
      s.touch = null;
      dropPlan();
      rest();
    }
  };

  /** The ball's own motion: in the air, rolling, and put away once forgotten. */
  const stepBall = (time: number, dt: number, reduced: boolean) => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const { level: lv } = live.current;
    const bounds = { left: 6, right: lv.w - 6, top: 6, floor: lv.walkY - BALL_RADIUS };
    if (ball.state === "carried" && s.phase !== "carry") {
      // Called away with the ball in her hands (a snack, a poke, picked up): it is put down where she was.
      ball.state = "still";
      ball.body = { x: clampX(s.x + s.facing * 10), y: bounds.floor, vx: 0, vy: 0, angle: 0, spin: 0 };
      ball.home = ball.body.x;
      ball.touched = time;
      placeBall();
    } else if (ball.state === "air") {
      const flight = flyStep(ball.body, dt, bounds, 0.55);
      ball.body = flight.body;
      if (flight.hit) playSound("bounce", { volume: Math.min(1, 0.3 + flight.impact / 500) });
      if (flight.landed) ball.state = "roll";
      // Her eyes are on it.
      s.pointer = { x: ball.body.x, y: ball.body.y, at: time };
      placeBall();
    } else if (ball.state === "roll") {
      const roll = rollStep(ball.body, dt, bounds);
      ball.body = roll.body;
      if (roll.still) ball.state = "still";
      placeBall();
    } else if (ball.state === "still" && time - ball.touched > BALL_IDLE_MS && s.phase !== "fetch" && s.phase !== "carry") {
      // Forgotten: put away, in a puff.
      const box = ballRef.current?.getBoundingClientRect();
      if (box && !reduced) puff({ x: box.left + box.width / 2, y: box.top + box.height / 2 }, { px: live.current.scale, count: 5, color: "#E9E1CF", edge: "#BDB3A0", spread: 26 });
      s.ball = null;
      s.fetches = 0;
      setBallOut(false);
    }
  };

  /** A little throw into the air, for the Play keys and the up arrow: what a toss by hand does. */
  const hop = () => {
    const s = st.current;
    if (!TOUCHABLE.has(s.phase)) return;
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    s.errand = null;
    s.touch = null;
    dropPlan();
    if (prefersReducedMotion()) {
      s.phase = "fidget";
      show("cheer", 1);
      played("toss");
      return;
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    s.vx = side * (30 + Math.random() * 50);
    s.vy = -330;
    s.angle = 0;
    s.spin = side * 9;
    s.tossed = true;
    s.hardest = 0;
    s.phase = "fall";
    show("tossed", undefined, "fall");
    playSound("whee");
  };

  // The ball in the reader's hand: carried about, and thrown as it is let go.
  const onBallDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const s = st.current;
    const ball = s.ball;
    if (!ball || ball.state === "carried") return;
    event.preventDefault();
    const id = event.pointerId;
    const samples: Sample[] = [];
    let moved = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id || !s.ball) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_SLOP) return;
      moved = true;
      const hand = pointerAt(e);
      if (!hand) return;
      const { level: lv } = live.current;
      const now = nowMs();
      const x = Math.max(6, Math.min(lv.w - 6, hand.x));
      const y = Math.max(6, Math.min(lv.walkY - BALL_RADIUS, hand.y));
      s.ball.state = "held";
      s.ball.body = { x, y, vx: 0, vy: 0, angle: s.ball.body.angle, spin: 0 };
      s.ball.touched = now;
      samples.push({ x, y, at: now });
      if (samples.length > 8) samples.shift();
      s.pointer = { x, y, at: now };
      placeBall();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!s.ball) return;
      if (!moved) {
        // A tap on the ball throws it again.
        throwBall();
        return;
      }
      const velocity = releaseVelocity(samples, nowMs());
      throwBall({ x: s.ball.body.x, y: s.ball.body.y, ...velocity });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // The pointer rubbed over her, no button down: a stroke, or a tickle.
  const onPipHover = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const s = st.current;
    if (event.buttons !== 0 || event.pointerType === "touch" || s.drag) return;
    if (!s.invited && s.phase === "rest") {
      // The first time the hand comes near: she says what it can do.
      s.invited = true;
      say("pat me? or pick me up by my leaf.");
    }
    const { stroke, touch } = strokeMove(s.stroke ?? strokeStart(event.clientX), event.clientX, nowMs(), 32 * live.current.scale);
    s.stroke = stroke;
    if (touch !== "none") touchPip(touch);
  };

  // ---- carrying Pip ---------------------------------------------------------------
  // Picked up, she hangs from the hand by her leaf and swings with it; let go,
  // she drops, or flies if the hand (or her own swing) was moving. The motion
  // is pip/play.ts's; here the pointer becomes a hand, and the hand never
  // leaves her stuck: whatever ends the press (the button up, the pointer
  // cancelled or lost, the window losing focus, another floor) lets go of her.

  /** Held: at the hand, less what is left of the slide into it, inside the room. */
  const carry = () => {
    const s = st.current;
    const { level: lv } = live.current;
    s.x = Math.max(10, Math.min(lv.w - 10, s.handAt.x + s.grip.x));
    s.y = Math.max(28, Math.min(lv.walkY, s.handAt.y + HOLD_DROP + s.grip.y));
  };

  /** Whether a Pip let go of at `x` is over her bed (and so is being put to bed). */
  const overBed = (x: number) => {
    const bed = bedBox(live.current.level, live.current.decor);
    return bed !== null && x >= bed.x + 3 && x <= bed.x + bed.w - 3;
  };

  /** Into the hand, from whatever she was doing (it is dropped, cleanly), where she is. */
  const pickUp = (hand: Point) => {
    const s = st.current;
    const acting = s.phase === "act";
    // Out of the air: she keeps her tilt, and her speed swings her from the hand.
    const flying = s.phase === "fall" && !prefersReducedMotion() ? caught({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin }) : null;
    untuck(true);
    s.errand = null;
    s.touch = null;
    dropPlan(true);
    s.phase = "held";
    s.hand = [];
    s.hold = flying?.hold ?? holdStart();
    if (flying) ({ x: s.x, y: s.y } = flying.feet);
    s.handAt = hand;
    // From where she is: she slides into the hand rather than jumping to it.
    s.grip = prefersReducedMotion() ? { x: 0, y: 0 } : { x: s.x - hand.x, y: s.y - (hand.y + HOLD_DROP) };
    s.vx = 0;
    s.vy = 0;
    s.angle = 0;
    s.spin = 0;
    show("held", undefined, "held");
    playSound("squeak", { pitch: 1.25, volume: 0.5 });
    // A move the page asked for is over: the page is told, so nothing waits on it.
    if (acting) live.current.onActDone();
  };

  /**
   * Out of the hand. A still hand drops her, a moving one throws her, and her
   * own swing goes with her. `gently` (the press was cancelled, not ended):
   * just a drop. Without motion she is put down where she is held.
   */
  const release = (gently: boolean) => {
    const s = st.current;
    const { level: lv } = live.current;
    // Called away while held (the page had something for her to do): there is nothing to drop.
    if (s.phase !== "held") return;
    const swing = s.hold.swing;
    s.hold = holdStart();
    s.grip = { x: 0, y: 0 };
    s.hardest = 0;
    if (prefersReducedMotion()) {
      const bounds = airBounds(lv);
      s.x = Math.max(bounds.left, Math.min(bounds.right, s.x));
      s.y = lv.walkY;
      s.vx = 0;
      s.vy = 0;
      s.angle = 0;
      s.spin = 0;
      s.tossed = false;
      if (overBed(s.x)) {
        // Put down on her bed: she is in it.
        s.wokeUntil = 0;
        s.napFor = bedSleep(new Date().getHours(), Math.random);
        s.pendingScroll = null;
        s.tuckedAt = nowMs();
        tuck(true);
        return;
      }
      s.phase = "land";
      show("land", 1);
      playSound("place", { pitch: 1.2, volume: 0.5 });
      place();
      return;
    }
    const { body, tossed } = letGo({ x: s.x, y: s.y }, gently ? { angle: swing.angle, spin: 0 } : swing, gently ? { vx: 0, vy: 0 } : releaseVelocity(s.hand, nowMs()));
    if (!tossed && overBed(s.x)) {
      // Put down on her bed: she gets in, from where she was let go.
      s.vx = 0;
      s.vy = 0;
      s.angle = 0;
      s.spin = 0;
      s.tossed = false;
      s.wokeUntil = 0;
      s.napFor = bedSleep(new Date().getHours(), Math.random);
      s.pendingScroll = null;
      s.tuckedAt = nowMs();
      say(pickOne(["oh. bedtime, is it?", "tucked in. goodnight.", "mm. just a little nap."]));
      tuck(false);
      place();
      return;
    }
    ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin } = body);
    s.tossed = tossed;
    s.phase = "fall";
    show(tossed ? "tossed" : "fall", undefined, "fall");
    if (tossed) playSound("whee");
    place();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // A second finger: the first lets go.
    dragEnd.current?.("cancel");
    const s = st.current;
    const button = event.currentTarget;
    const id = event.pointerId;
    const drag = { id, startX: event.clientX, startY: event.clientY, moved: false };
    s.drag = drag;
    // The press is hers until it ends, wherever the pointer goes (off the room, off the window).
    try {
      button.setPointerCapture(id);
    } catch {
      // No such pointer (a press made in a test): the window's listeners below still hear it.
    }

    const follow = (e: { clientX: number; clientY: number }) => {
      const hand = pointerAt(e);
      if (!hand) return;
      if (!drag.moved) {
        drag.moved = true;
        pickUp(hand);
      }
      // Where the hand has been lately: how fast it goes swings her, and throws her.
      const sample = { x: hand.x, y: hand.y, at: nowMs() };
      s.hold = holdMove(s.hold, s.hand[s.hand.length - 1], sample);
      s.hand.push(sample);
      if (s.hand.length > 8) s.hand.shift();
      s.handAt = hand;
      if (s.phase !== "held") return;
      carry();
      place();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_SLOP) return;
      follow(e);
    };
    const end = (how: "up" | "cancel") => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", lost);
      button.removeEventListener("lostpointercapture", lost);
      if (dragEnd.current === end) dragEnd.current = null;
      if (s.drag === drag) s.drag = null;
      try {
        button.releasePointerCapture(id);
      } catch {
        // Already let go of.
      }
      if (drag.moved) release(how === "cancel");
      else if (how === "up") pokePip();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === id) end(e.type === "pointerup" ? "up" : "cancel");
    };
    const lost = () => end("cancel");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", lost);
    button.addEventListener("lostpointercapture", lost);
    dragEnd.current = end;
    // Caught in mid-air: in the hand at once, no need to move first.
    if (s.phase === "fall") follow(event);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp") {
      // Up: a little toss into the air, as a hand would give her.
      event.preventDefault();
      hop();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const s = st.current;
    if (s.phase === "held" || s.phase === "fall") return;
    s.touch = null;
    const lv = live.current.level;
    const dir = event.key === "ArrowLeft" ? -1 : 1;
    untuck();
    s.errand = null;
    dropPlan();
    face(dir);
    s.target = Math.max(18, Math.min(lv.w - 18, s.x + dir * 24));
    s.pace = WALK_SPEED * paceNow();
    s.phase = prefersReducedMotion() ? "rest" : "walk";
    if (s.phase === "rest") {
      // (Not through a visitor: as far as their side, and no further.)
      s.x = stopForVisitor(worldNow()?.visitor, s.x, s.target) ?? s.target;
      place();
    }
    show(s.phase === "walk" ? strollMove() : live.current.base, undefined, s.phase === "walk" ? "walk" : "rest");
  };

  // ---- the room under the hand -----------------------------------------------------
  // Furnishings that can be used (pip/furnish.ts, ./furnishings.tsx): the
  // curtains drawn, and so on. They move in this scene's frame loop, and Pip
  // answers what is done to her room.

  /** She answers something done to the room, where she stands, turned to it: if she is free to. */
  const reactTo = (reaction: Reaction, x: number, what?: RoomChange) => {
    const s = st.current;
    if (s.phase === "sleep" && s.abed) {
      // On her phone in bed, and the room is made darker for her: she takes the hint, slowly.
      if ((what === "curtains-closed" || what === "light-off") && !s.abed.hinted) {
        s.abed.beats = [...s.abed.beats.slice(0, s.abed.index + 1), ...scrollWindDown(Math.random)];
        s.abed.hinted = true;
        nextBeat();
      }
      return;
    }
    if (!TOUCHABLE.has(s.phase) || s.phase === "sleep" || s.phase === "tuck" || s.phase === "petted") return;
    const now = nowMs();
    if (s.plan?.activity.id === "fridge" && (what === "curtains-open" || what === "light-on") && dark(new Date().getHours())) {
      // At the fridge after dark, and the light comes in on her: caught. (The door she held goes to behind her: see the loop.)
      dropPlan(true);
      s.errand = null;
      playSound("squeak", { pitch: 1.3 });
      answer({ move: "caught", loops: 1, line: caughtLine(Math.random) });
      return;
    }
    const bed = reaction.sleepy ? bedBox(live.current.level, live.current.decor) : null;
    if (bed) {
      // It has made her sleepy, and there is a bed: she says so on her way to it.
      s.touch = null;
      s.wokeUntil = 0;
      s.tuckedAt = now;
      s.napFor = bedSleep(new Date().getHours(), Math.random);
      startErrand({ kind: "bed", x: clampX(bed.x + bed.w * 0.75), face: -1, move: reaction.move, loops: reaction.loops, line: reaction.line, after: 0, then: "tuck" }, prefersReducedMotion());
      return;
    }
    s.errand = null;
    dropPlan();
    if (Math.abs(x - s.x) > 6) face(x < s.x ? -1 : 1);
    s.phase = "fidget";
    show(reaction.move, reaction.loops, `react-${now}`);
    say(reaction.line);
    if (reaction.sound) playSound(reaction.sound);
    // A second thought comes once the first is over.
    const then = reaction.then;
    if (then) s.queue = [...s.queue.filter((errand) => errand.kind !== "cue"), { kind: "cue", x: null, move: then.move, loops: then.loops, line: then.line, after: now + 400 }];
  };
  /**
   * To bed with her, as the reader asks (the bed tapped, or its Play key): she
   * walks over, yawns and gets in. A nap by day, the night after dark. If she
   * is in it already, she is got up instead.
   */
  const putToBed = () => {
    const s = st.current;
    const bed = bedBox(live.current.level, live.current.decor);
    if (s.phase === "sleep" || s.phase === "tuck") {
      wake("mm? is it time to get up?");
      return;
    }
    if (!bed) {
      say("there's no bed out on this floor.");
      return;
    }
    if (!TOUCHABLE.has(s.phase)) return;
    s.touch = null;
    s.wokeUntil = 0;
    // The reader's doing: no phone comes too, and she is left to sleep (pip/behaviour.ts, TUCKED_QUIET_MIN).
    s.tuckedAt = nowMs();
    s.napFor = bedSleep(new Date().getHours(), Math.random);
    startErrand({ kind: "bed", x: clampX(bed.x + bed.w * 0.75), face: -1, move: "yawn", loops: 1, line: pickOne(["bed? ...okay. just a little nap.", "mm. tuck me in.", "a nap sounds good."]), after: 0, then: "tuck" }, prefersReducedMotion());
  };

  /** Up and out of bed, with a stretch and a word. Says whether she was in it. */
  const wake = (line: string) => {
    const s = st.current;
    if (s.phase !== "sleep" && s.phase !== "tuck") return false;
    untuck();
    s.poke = null;
    s.phase = "fidget";
    show("stretch", 1);
    say(line);
    return true;
  };

  // ---- the fridge -------------------------------------------------------------------
  // A fixture of the bedroom (pip/home.js), used like the other furnishings.
  // Opening it gives nothing; it is somewhere for Pip to go: over to a door
  // the reader opened, in hope; and to it herself for the snack the reader is
  // about to choose (the Play rail's Snack key), so that it comes out of the
  // fridge and not out of the air.

  /** The door she was holding open goes to. */
  const shutFridge = () => {
    const s = st.current;
    if (!s.fridgeHold) return;
    furnishRef.current?.pipUse(s.fridgeHold.key, "shut");
    s.fridgeHold = null;
  };

  /** Whether she is free to go to the fridge: on her feet, not in the hand, the air or bed. */
  const freeForFridge = () => {
    const s = st.current;
    return TOUCHABLE.has(s.phase) && s.phase !== "sleep" && s.phase !== "tuck" && s.phase !== "petted";
  };

  /** The reader opened the fridge, or it has shut: what she makes of it. */
  const fridgeChanged = (what: "opened" | "shut", fridge: Fridge) => {
    const s = st.current;
    if (what === "shut") {
      // Shut on her while she hoped (or under her nose, by the reader's hand), or just after, while she stood by it.
      if (s.fridgeHold?.why === "plan") {
        // The reader shut the door she was staring through.
        s.fridgeHold = null;
        dropPlan(true);
        answer({ move: "shift", loops: 1, line: shutOnHerLine(Math.random) });
        return;
      }
      const hoping = s.errand?.fridge && (s.phase === "errand" || s.phase === "walk");
      const lingering = nowMs() < s.hopedUntil && s.phase === "rest" && !s.plan;
      s.hopedUntil = 0;
      if (hoping || lingering) {
        s.errand = null;
        s.fridgeHold = null;
        answer(fridgeShutOnHer(Math.random));
      }
      return;
    }
    if (!freeForFridge() || s.errand?.fridge) return;
    const at = fridgeStand(fridge.box, live.current.level.w);
    const hope = fridgeHope(Math.random);
    s.touch = null;
    startErrand({ kind: "hope", x: at.x, face: at.face, move: hope.move, loops: hope.loops, line: hope.line, after: 0, fridge: fridge.key }, prefersReducedMotion());
  };

  /**
   * To the fridge for the snack the reader is about to choose: she runs over,
   * opens it and waits on her toes. The snack, when it comes (the page's
   * `act`), is eaten there; if none does, she shuts the door again. Nothing
   * is taken or given here: a snack is still bought as it is given.
   */
  const fetchSnack = () => {
    const s = st.current;
    const fridge = furnishRef.current?.fridge();
    if (!fridge || live.current.decorating || s.errand?.kind === "snack") return;
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    if (!freeForFridge()) return;
    const at = fridgeStand(fridge.box, live.current.level.w);
    const wait = fridgeFetch(Math.random);
    s.touch = null;
    startErrand({ kind: "snack", x: at.x, face: at.face, move: wait.move, loops: wait.loops, line: wait.line, after: 0, hurry: true, fridge: fridge.key }, prefersReducedMotion());
  };

  furnishPip.current = {
    // (Out of the house, she answers nothing done to her room.)
    react: (reaction, x, what) => (outRef.current ? undefined : reactTo(reaction, x, what)),
    bed: () => (outRef.current ? say(null) : putToBed()),
    fridge: (what, fridge) => (outRef.current ? undefined : fridgeChanged(what, fridge)),
    asleep: () => !outRef.current && (st.current.phase === "sleep" || st.current.phase === "tuck"),
    go: (what, spot) => {
      // Called over to a thing: she drops what she was at and comes, unless she is in the hand, the air, or bed.
      const s = st.current;
      if (outRef.current || !TOUCHABLE.has(s.phase) || s.phase === "sleep" || s.phase === "tuck") return;
      const reduced = prefersReducedMotion();
      s.errand = null;
      s.touch = null;
      dropPlan();
      s.fidgets = 0;
      s.plan = { activity: activityAt(what, spot, outlook(nowMs(), reduced), Math.random), index: -1 };
      say(what === "read" ? pickOne(["ooh, that one.", "a chapter? yes.", "good choice."]) : pickOne(["let's see what's out there.", "coming to look."]));
      nextStep();
    },
    wake: () => !outRef.current && wake("morning! is that the sun?"),
    clock: nowMs,
    redraw: () => redraw.current?.()
  };
  const furnish = useFurnishings({ level, decor, scale, night: nightNow(level), decorating, roomRef, pip: furnishPip });
  furnishRef.current = furnish;

  // The arcade's machines that are out on this floor: each opens its game.
  const machines = level.arcade
    ? decor.placed.flatMap((entry) => {
        const machine = MACHINES[entry.itemId];
        const slot = machine ? level.slots.find((candidate) => candidate.id === entry.slot) : undefined;
        const box = slot ? itemBox(entry.itemId, slot) : null;
        return machine && box ? [{ ...machine, id: entry.itemId, box }] : [];
      })
    : [];
  const pipSize = 32 * scale;
  // What she is in the middle of, in words (the view changes with each step, so this keeps up).
  const busyWith = st.current.plan?.activity.label ?? null;
  const night = nightNow(level);
  const now = nowMs();
  const frame: RoomFrame = {
    scale,
    w: level.w,
    h: level.h,
    walkY: level.walkY,
    floorId: level.id,
    night,
    pip: () => ({ x: st.current.x, y: st.current.y, facing: st.current.facing < 0 ? -1 : 1, phase: st.current.phase, away: outRef.current }),
    floor: () => {
      const lv = live.current.level;
      const standing = live.current.decor.placed.flatMap((entry) => {
        const slot = lv.slots.find((candidate) => candidate.id === entry.slot);
        const box = slot && slot.fits === "stand" ? itemBox(entry.itemId, slot) : null;
        return box ? [{ x: box.x, w: box.w }] : [];
      });
      const fridge = furnishRef.current?.fridge();
      return fridge ? [...standing, { x: fridge.box.x, w: fridge.box.w }] : standing;
    }
  };
  // Where the note goes while she is out: on her pillow, or in the middle of the floor on a floor with no bed.
  const noteBed = out ? bedBox(level, decor) : null;
  const noteAt = noteBed ? { x: noteBed.x + 6, y: noteBed.y + 2 } : { x: Math.round(level.w / 2) - 4, y: level.walkY - 9 };
  const noteText = world?.away?.note ?? "out. back soon.";
  // Said aloud, a line loses the marks that lean on a word ("you stopped *there*?").
  const spoken = shownLine?.replace(/\*/g, "") ?? null;

  return (
    <div ref={stageRef} className="pip-house-stage">
      <div
        ref={roomRef}
        className="pip-house-room"
        data-decorating={decorating || undefined}
        data-night={night || undefined}
        style={{ width: level.w * scale, height: level.h * scale }}
        role="group"
        aria-label={label}
        onPointerMove={(event) => {
          // Where the pointer is, for Pip's eyes to follow. A ref, not state: nothing re-renders.
          const box = event.currentTarget.getBoundingClientRect();
          st.current.pointer = { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale, at: nowMs() };
        }}
        onPointerLeave={() => {
          st.current.pointer = null;
        }}
      >
        {openSky && <GardenSky width={level.w} scale={scale} />}
        <canvas ref={canvasRef} width={level.w} height={level.h} className="pip-sprite pip-house-canvas" data-open-sky={openSky || undefined} aria-hidden="true" />

        {furnish.layer}

        {arrivals.map((entry) => (
          <SceneArt
            key={entry.key}
            image={entry.image}
            scale={scale}
            className="pip-decor-drop"
            style={
              {
                left: entry.box.x * scale,
                top: entry.box.y * scale,
                "--drop": `${Math.min(DROP_FROM, entry.box.y + entry.box.h) * scale}px`
              } as CSSProperties
            }
          />
        ))}

        {barrel && (
          <div
            className="pip-barrel"
            role="img"
            aria-label={`Rain barrel: ${barrelWater} of ${barrelCap} water, for the next planting. Reading in focus fills it while nothing is growing.`}
            title={`Rain barrel: ${barrelWater} / ${barrelCap} water`}
            style={{ left: barrel.x * scale, top: barrel.y * scale }}
          >
            <SceneArt image={barrelImage(barrelWater / Math.max(1, barrelCap))} scale={scale} />
          </div>
        )}

        {/* The garden's rows: one picture under the plants. */}
        {plots && <SceneArt image={bedImage(level, plots)} scale={scale} className="pip-plot-soil pip-garden-bed" style={{ top: level.floorY * scale }} />}

        {plots &&
          boxes.map((box, index) => {
            const plot = plots[index];
            const state = plot.locked ? "locked" : plot.ripe ? "ripe" : plot.plant ? "growing" : "empty";
            const fresh = sprouting.current.get(plot.plot);
            const sprout = fresh && fresh.until > now ? fresh : null;
            return (
              <div
                key={plot.plot}
                ref={(node) => {
                  if (node) plotNodes.current.set(plot.plot, node);
                  else plotNodes.current.delete(plot.plot);
                }}
                className="pip-plot"
                data-state={state}
                // The back row stands behind the front one.
                style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale, zIndex: box.row === 1 ? 0 : undefined, ["--plot" as string]: index }}
              >
                {plot.locked ? (
                  <span className="pip-plot-dig" aria-hidden="true">
                    <span className="pip-plot-dig-plus">+</span>
                    {plot.price ? <span className="pip-plot-dig-price">{plot.price}</span> : null}
                  </span>
                ) : (
                  <>
                    {plot.plant && (
                      <PlantArt
                        key={plot.plant}
                        plant={plot.plant}
                        step={Math.floor(plot.progress * 20)}
                        ripe={plot.ripe}
                        scale={scale}
                        className={sprout ? "pip-plot-plant pip-plant-sprout" : "pip-plot-plant"}
                        style={sprout ? { animationDelay: `${sprout.delay}ms` } : undefined}
                      />
                    )}
                    {plot.plant && !plot.ripe && (
                      <span className="pip-plot-bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${Math.max(0.04, plot.progress).toFixed(3)})` }} />
                      </span>
                    )}
                  </>
                )}
                {onPlot && !decorating && (
                  <button
                    type="button"
                    className="pip-house-hotspot pip-plot-hit"
                    onClick={() => (onEmptyPlot && state === "empty" ? onEmptyPlot(plot) : onPlot(plot))}
                    aria-haspopup={onEmptyPlot && state === "empty" ? "dialog" : undefined}
                    aria-label={plotLabel?.(plot) ?? `Plot ${plot.plot}`}
                    title={plotLabel?.(plot)}
                  />
                )}
              </div>
            );
          })}

        {!decorating &&
          machines.map((machine) => (
            <button
              key={machine.id}
              type="button"
              className="pip-house-hotspot pip-house-arcade"
              style={{ left: machine.box.x * scale, top: machine.box.y * scale, width: machine.box.w * scale, height: machine.box.h * scale }}
              onClick={() => (machine.game === "dance" ? onJukebox?.() : onArcade?.(machine.game))}
              aria-label={machine.label}
              title={machine.label}
            />
          ))}

        {overlay?.(frame)}

        {out && !hidePip && (
          <button
            type="button"
            className="pip-away-note"
            style={{ left: noteAt.x * scale, top: noteAt.y * scale }}
            onClick={() => setNoteOpen((open) => !open)}
            onMouseEnter={() => setNoteOpen(true)}
            onMouseLeave={() => setNoteOpen(false)}
            onBlur={() => setNoteOpen(false)}
            aria-label={`Pip is out. She left a note: “${noteText}”`}
            title="A note from Pip"
          >
            <SceneArt image={noteImage()} scale={scale} />
            {noteOpen && (
              <span className="pip-away-note-say" aria-hidden="true">
                <PipSay text={noteText} tailAt={14} />
              </span>
            )}
          </button>
        )}

        {!hidePip && !out && (
          <div ref={pipRef} className="pip-house-pip" style={{ width: pipSize, height: pipSize }}>
            <div ref={spinRef} className="pip-house-pip-spin">
              <div ref={turnRef} className="pip-house-pip-turn">
              <button
                type="button"
                className="pip-house-pip-button"
                style={{ width: pipSize, height: pipSize, transform: view.flip ? "scaleX(-1)" : undefined }}
                data-walk="pip"
                onPointerDown={onPointerDown}
                onPointerMove={onPipHover}
                onPointerLeave={() => {
                  st.current.stroke = null;
                }}
                onClick={(event) => {
                  // Pointer presses are handled on release; this is the keyboard.
                  if (event.detail === 0) pokePip();
                }}
                onKeyDown={onKeyDown}
                title="Poke me, stroke me, or pick me up by my leaf"
                aria-label={
                  spoken
                    ? `Pip says “${spoken}” ${PIP_HOW}`
                    : tucked
                      ? `Pip, ${st.current.abed ? "in bed with her phone" : st.current.hiding ? "hiding under the quilt" : "asleep in bed"}. ${PIP_HOW}`
                      : `Pip${busyWith ? `, ${busyWith}` : ""}. ${PIP_HOW}`
                }
              >
                <PipSprite move={view.move} size={pipSize} skin={look.skin} outfit={look.outfit} loops={view.loops} playKey={view.key} onDone={onSpriteDone} />
                {/* What she holds up over her head: a find, brought home. */}
                {holding && (
                  <span className="pip-held" style={{ left: (16 - holding.width / 2) * scale, top: (HELD_FOOT - holding.height) * scale }} aria-hidden="true">
                    <SceneArt image={holding} scale={scale} />
                  </span>
                )}
              </button>
              </div>
            </div>
            {shownLine && (
              <div className="pip-house-say" aria-hidden="true">
                <PipSay key={shownLine} text={shownLine} />
              </div>
            )}
          </div>
        )}

        {/* The ball: thrown from the Play keys or by hand, fetched by Pip. Placed by the loop. */}
        {ballOut && !hidePip && !out && (
          <button
            ref={ballRef}
            type="button"
            className="pip-house-ball"
            style={{ width: BALL_BOX * scale, height: BALL_BOX * scale, ["--ball-sprite" as string]: `${pipSize}px` }}
            onPointerDown={onBallDown}
            onClick={(event) => {
              // The keyboard: Enter throws it again.
              if (event.detail === 0) throwBall();
            }}
            aria-label="The ball. Select to throw it for Pip, or drag and let go."
            title="Throw it again"
          >
            <PipSprite move={ownBall ? "ball" : "ball-paper"} size={pipSize} still />
          </button>
        )}

        {/* The bed's front, over Pip while he sleeps: tucked in under the quilt. */}
        {tucked && !hidePip && (
          <canvas
            ref={frontRef}
            width={tucked.w}
            height={tucked.h}
            className="pip-sprite pip-bed-front"
            style={{ left: tucked.x * scale, top: tucked.y * scale, width: tucked.w * scale, height: tucked.h * scale }}
            aria-hidden="true"
          />
        )}

        {decorating &&
          level.slots.map((slot) => {
            const inside = decor.placed.find((entry) => entry.slot === slot.id)?.itemId ?? null;
            const box = inside ? itemBox(inside, slot) : null;
            // On the piece where it is: a picture slid along the wall takes its pin with it.
            const pin = pinPoint(slot, box ? { ...box, x: box.x + furnish.offsetOf(slot.id) } : null);
            return (
              // A point-sized button at the pin: the dot and the slot's outline hang off it.
              <button
                key={slot.id}
                type="button"
                className="pip-slot-pin"
                data-kind={slot.fits}
                data-filled={inside ? true : undefined}
                aria-pressed={selectedSlot === slot.id}
                style={{ left: pin.x * scale, top: pin.y * scale }}
                onClick={() => onSlot(slot)}
                aria-label={slotLabel(slot)}
                title={slotLabel(slot)}
              >
                <span
                  className="pip-slot-area"
                  aria-hidden="true"
                  style={{ left: (slot.x - pin.x) * scale, top: (slot.y - pin.y) * scale, width: slot.w * scale, height: slot.h * scale }}
                />
                <span className="pip-slot-dot" aria-hidden="true">
                  <UiIcon name={inside ? "edit" : "plus"} size={inside ? 12 : 15} />
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
});
