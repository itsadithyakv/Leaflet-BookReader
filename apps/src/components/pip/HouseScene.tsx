import {
  forwardRef,
  useEffect,
  useId,
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
import { LIT_BY_DAY, houseGlows, itemBox, lightOn, litMatrix, renderHouseLevel, renderItem, type Glow, type HouseLevel, type HouseSlot, type LevelDecor } from "../../pip/home.js";
import { LIB, SKINS, renderFrame, resolve } from "../../pip/core";
import {
  ASK_AWAY_MS,
  BALL_FORGOTTEN_MS,
  BALL_RADIUS,
  CATCH_RUN,
  GRAB_MIN,
  HALF_PACE,
  HEAD_HIGH,
  RALLY_SHOWS,
  REACH_X,
  ballAt,
  ballDown,
  ballShape,
  ballStep,
  ballStill,
  fetched,
  flick,
  hopLift,
  keenness,
  landing,
  lob,
  peaceOffering,
  rallyStart,
  reachOf,
  readerBack,
  readerCaught,
  readerMissed,
  receive,
  shadowOf,
  spinFrame,
  throwSpot,
  throwTarget,
  tossFrom,
  turnOf,
  underarm,
  windupMs,
  type Ask,
  type BallBody,
  type Hit,
  type Rally,
  type Room,
  type Tally
} from "../../pip/catch";
import {
  FOUND_BARE,
  FOUND_FOOD,
  PEEK_S,
  activityAt,
  bareFridgeLine,
  bedtimeScroll,
  bundled,
  caughtLine,
  chooseActivity,
  coldPace,
  coldRest,
  crossesVisitor,
  fidget,
  fidgetGap,
  fidgetsBetween,
  foodAgainLine,
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
  standAt,
  stillBareLine,
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
  type Step,
  type World
} from "../../pip/behaviour";
import { markStopSaid, readStop, stopRemark } from "../../pip/readingMoments";
import { setWorldStub, worldStub } from "../../pip/worldStub";
import {
  CUDDLE_SLACK,
  HARD_LANDING,
  PIP_BOUNCE,
  POKE_RUNGS,
  caught,
  fingerLifts,
  flyStep,
  holdMove,
  holdStart,
  holdStep,
  letGo,
  nearUpright,
  playCounts,
  pokeAgain,
  pokeReaction,
  pressOf,
  releaseVelocity,
  rubOf,
  strokeMove,
  strokeStart,
  tapAgain,
  whirlMove,
  whirlStart,
  whirled,
  zoneOf,
  type PlayKind,
  type Poke,
  type Rub,
  type Sample,
  type Stroke,
  type Taps,
  type Whirl
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
import {
  BARE_STORE,
  bareFound,
  bareMinds,
  bedSleep,
  dark,
  foodFound,
  fridgeFetch,
  fridgeHope,
  fridgeNothing,
  fridgeShutOnHer,
  fridgeStand,
  parseBareSeen,
  visitBeats,
  visitOf,
  type Reaction
} from "../../pip/furnish";
import {
  SULK_MOVE,
  TEMPER_STORE,
  annoy,
  comeRound,
  gladLine,
  heartsOff,
  huffLine,
  humourOf,
  keepTemper,
  offerPeace,
  parseTemper,
  soothe,
  spellMinutesLeft,
  sulkLine,
  tantrumPlan,
  temperAt,
  type Annoyance,
  type Humour,
  type Kindness,
  type Temper
} from "../../pip/temper";
import { getDateKey } from "../../services/habitService";
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
/** In a hurry (to the fridge, to the door), in floor pixels per second. After the ball she is quicker still: pip/catch.ts, `CATCH_RUN`. */
const RUN_SPEED = 66;
/** The ball's button, in floor pixels: a little more than the ball. On screen it is never smaller than a finger (pip/catch.ts, `GRAB_MIN`). */
const BALL_BOX = 12;
/** Where the ball is while she has it, from her feet (floor pixels; `x` is to the side she faces): over her head as she runs, behind her as she winds up, under her chin. As house-moves.js draws them. */
const BALL_CARRIED = { x: 5, y: -18 };
const BALL_WOUND = { x: -6, y: -16 };
const BALL_CHIN = { x: 6, y: -4 };
/** Her hands as she throws, from her feet. */
const HANDS = { x: 6, y: -19 };
/** How long each small thing in a game of catch takes, in milliseconds: the throw's follow-through, a header or a kick, sat down after a bonk, a jump at nothing, a hop for the reader's catch. */
const FLING_MS = 520;
const FLOURISH_MS = 560;
const BONK_MS = 2900;
const WHIFF_MS = 620;
const YAY_MS = 420;
/** A pat that sends the ball rolling to the reader, and the look between them and it after. */
const NUDGE_MS = 520;
const NUDGE_LOOK_MS = 2600;
const NUDGE_SPEED = 95;
/** Putting the ball away: held up a moment, and gone. */
const AWAY_MS = 900;
/** Making up over the ball: a look at it and at the reader, then the pat back. */
const PEACE_LOOK_MS = 2400;
/** Without motion, she has the ball this long before it is handed back; and a ball handed back is the reader's to take for this long before the rally lapses. */
const HANDBACK_MS = 900;
const OFFER_MS = 6000;

const CAUGHT_LINES = ["got it!", "mine!", "ha!"];
const BONK_LINES = ["ow. ...i meant to do that.", "bonk.", "that was my head."];
const WHIFF_LINES = ["almost!", "nearly had it.", "too high!"];
const PEACE_LINES = ["...fine. one throw.", "hmph. ...here.", "...okay. catch."];
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
/** Once she is being cuddled, the hand may shift this far before it has picked her up instead. */
const CUDDLE_SLOP = 12;
/** A cuddle let go of ends this soon after (a stroke, which has no letting go, takes TOUCH_GAP_MS to be over). */
const CUDDLE_END_MS = 160;
/** A Play key's cuddle, which no hand is holding, lasts this long. */
const CUDDLE_KEY_MS = 2400;
/** A tickled leaf makes her sneeze, and then she is not tickled again until the sneeze is over (the move is five seconds). */
const SNEEZE_MS = 5200;
/** When the sneeze's sound starts: its breath in ends as the move's "achoo" comes, 20 frames in (pip/anims.js). */
const SNEEZE_AT_MS = 1400;
/** A trampoline throws her up this fast (floor pixels a second: about 29 pixels high, half a second in the air), from this far above the floor (its mat). */
const TRAMPOLINE_VY = 230;
const TRAMPOLINE_LIFT = 4;

const CUDDLE_LINES = ["mmm. warm.", "oh. a cuddle.", "stay like that.", "this is nice."];
const CUDDLED_LINES = ["one more minute?", "best bit of my day.", "again later?"];
const HIGH_FIVE_LINES = ["high five!", "up top!", "yes! team.", "slap. perfect."];
const SNEEZE_LINES = ["ah... ah... my leaf!", "not the leaf! ah...", "that tickles my... ah..."];
const GIDDY_LINES = ["the room is going round.", "wheee... oh. oh no.", "which way is the floor?", "again! ...in a minute."];
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
  /** What she finds in it when she gets there, where that is known: told as she looks (`foundFridge`). */
  found?: "bare" | "food";
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
/**
 * The time of day, wound on with the scene's clock: for what outlives the page (her temper and the mood she is in,
 * kept on this device and worked out from the clock: pip/temper.ts).
 */
const wallMs = () => Date.now() + clockSkew;

/** The mood she is in, as the page is told of it, for the hearts and the words behind them. */
export type TemperShown = {
  /** What it adds to the mood the hearts show, in points (below zero: takes). */
  off: number;
  humour: Humour;
  /** Minutes of it left, or 0. */
  minutesLeft: number;
};

/** How often the scene looks at her temper again (it eases by the clock), in milliseconds. */
const TEMPER_LOOK_MS = 1000;
/** A hand that will not leave a huffing Pip alone gets a word no more often than this. */
const HUFF_WORD_MS = 2500;
/** A drop from this fast (floor pixels a second, about a third of the room's height) is being dropped, not put down. */
const DROPPED_HARD = 250;
/** A cuddle held at least this long is a long one: it can put her in a good mood, not only soothe her. */
const LONG_CUDDLE_MS = 2500;

const readText = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeText = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Remembered for this visit only.
  }
};

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
 * The ways of playing with Pip that the scene does itself, each as the hand
 * would: a stroke, a tickle, a cuddle (a press held on her), a high five (two
 * quick taps), a whirl (swung round in the hand until she is giddy), a
 * tickled leaf (which makes her sneeze), the ball, a toss, bed, a snack.
 */
export type PlayKey = "pet" | "tickle" | "cuddle" | "highfive" | "spin" | "sneeze" | "ball" | "toss" | "bed" | "snack";

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
  playWith: (how: PlayKey) => void;
  /** A visitor has knocked, has reached their place, or has left: she answers, if she is free to. */
  visitor: (what: "knocked" | "arrived" | "left") => void;
  /** Something kind the page did with her that the scene cannot see for itself (a dance together, a game in the arcade): pip/temper.ts. */
  kindness: (what: "dance" | "game") => void;
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

/**
 * The room's frames, for each way a floor has stood lately (which floor, its
 * decor, the ten minutes of the day, a lamp off, the fridge open): going
 * back to one costs nothing.
 *
 * Kept here, outside the scene: a frame of the room takes 2 to 9 ms to paint
 * by day and more by night, and there are 48 to a loop, each painted on the
 * tick that first shows it. Kept inside the scene's effect they were thrown
 * away on every visit to the page, every change of floor and of decor, and
 * all together whenever a fifth state came along (the one on screen with
 * them): four seconds of heavy ticks each time, which is when Pip's walk
 * stuttered. The oldest state goes when there are too many.
 */
const ROOM_STATES_KEPT = 4;
const roomFrames = new Map<string, Map<number, HTMLCanvasElement>>();
const roomFramesFor = (state: string) => {
  let frames = roomFrames.get(state);
  if (frames) {
    // Used again: last to go.
    roomFrames.delete(state);
  } else {
    trimRoomFrames(ROOM_STATES_KEPT - 1);
    frames = new Map();
  }
  roomFrames.set(state, frames);
  return frames;
};
const trimRoomFrames = (keep: number) => {
  while (roomFrames.size > keep) {
    const oldest = roomFrames.keys().next().value;
    if (oldest === undefined) break;
    roomFrames.delete(oldest);
  }
};
// Art edited while the app runs (development) is drawn afresh.
if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => roomFrames.clear());
}

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
const PIP_HOW =
  "Select to poke, select twice quickly for a high five, press and hold for a cuddle, drag to carry and throw. Left and right arrows walk her, up arrow tosses her; C cuddles, H is a high five, S spins her giddy, L tickles her leaf. More ways to play are under Play.";

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
/** The room the ball flies in: the walls, the ceiling, and the floor its middle rests above. (It is in front of the furniture, where Pip walks, so nothing else is in its way.) */
const ballRoom = (level: HouseLevel): Room => ({ left: 6, right: level.w - 6, top: 6, floor: level.walkY - BALL_RADIUS });

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

/**
 * One frame of a part (the ball as it turns, the rally's count), as a
 * picture: a pure function of the frame, so each is drawn once and kept. The
 * scene puts them on its own canvases, a frame at a time, by where the ball
 * is; nothing plays by itself.
 */
const partFrames = new Map<string, ImageData | null>();
const partFrame = (id: string, frame: number): ImageData | null => {
  const key = `${id}|${frame}`;
  let image = partFrames.get(key);
  if (image === undefined) {
    const move = LIB.find((entry) => entry.id === id);
    try {
      image = move ? renderFrame(move, frame, resolve(SKINS[0], frame)) : null;
    } catch {
      // Art mid-edit: nothing drawn.
      image = null;
    }
    partFrames.set(key, image);
  }
  return image;
};

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
  /** She has looked in her fridge, found it bare, and minded: the page tells Rust, which takes a little off her mood (once a day). */
  onFridgeBare?: () => void;
  /** The mood she is in has changed, or eased (pip/temper.ts): the page lays it over the hearts. */
  onTemper?: (shown: TemperShown) => void;
  label: string;
};

/**
 * `doing`: a step of an activity; `fidget`: a small thing while standing
 * about; `errand`: doing a free moment's errand; `tuck`: hopping into bed;
 * `sleep`: in it. With the ball out: `fetch`, running to it (or to where it
 * will come down); `carry`, running back with it; `catch`, one of the small
 * things a game of catch is made of (`CatchAct`).
 */
type Phase = "rest" | "walk" | "act" | "doing" | "fidget" | "held" | "fall" | "land" | "errand" | "tuck" | "sleep" | "petted" | "fetch" | "carry" | "catch";
/** When the reader's hand can have her attention: not in mid-air, not mid-act. */
const TOUCHABLE: ReadonlySet<Phase> = new Set<Phase>(["rest", "walk", "doing", "fidget", "errand", "petted", "sleep", "tuck", "land"]);
/**
 * The ball: in the air (bouncing counts), rolling, lying still, in the
 * reader's hand, or in Pip's. `by`: who sent it last (nobody, if it was only
 * put down). `live`: thrown by her and not yet down, so the reader can still
 * catch it. `speed`: how fast it left the hand that threw it. `touched`: when
 * the reader last had a hand on it; `rested`: when it last came to rest.
 */
type Ball = { body: BallBody; state: "air" | "roll" | "still" | "held" | "carried"; by: "reader" | "pip" | null; live: boolean; speed: number; touched: number; rested: number };
/**
 * A small thing she is doing in a game of catch, until `until`: winding up
 * with the ball, the throw's follow-through, a header or a kick, sat down
 * after a bonk, a jump at nothing, a hop for the reader's catch, a pat that
 * rolls the ball over and the look after it, lying with her chin on it,
 * putting it away, a look at a peace offering, and (without motion) holding
 * it before it is handed back. `soft`: nothing she would not drop for a ball
 * coming her way.
 */
type CatchAct = { kind: "windup" | "fling" | "flourish" | "bonk" | "whiff" | "yay" | "nudge" | "look" | "chin" | "away" | "peace" | "handback"; until: number; soft?: boolean };
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
    onFridgeBare,
    onTemper,
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
  const ballArtRef = useRef<HTMLCanvasElement | null>(null);
  const ballShadowRef = useRef<HTMLSpanElement | null>(null);
  const tallyRef = useRef<HTMLCanvasElement | null>(null);
  // Whether the ball is out (its place is the loop's, on a ref), and the rally as its label reads it.
  const [ballOut, setBallOut] = useState(false);
  const [rallyShown, setRallyShown] = useState(0);
  // How big the room is drawn: device pixels per art pixel, and the display's scaling that was worked out for.
  // The two are kept together: the scaling can change on its own (the window dragged to another monitor), and a
  // room that read it afresh at each render kept its old size until something else made it render.
  const [{ per, ratio }, setFit] = useState(() => ({ per: 3, ratio: window.devicePixelRatio || 1 }));
  // Out of the house altogether (an expedition): no Pip, a note where she sleeps.
  const out = Boolean(world?.away);
  const outRef = useRef(out);
  outRef.current = out;
  // Her temper, and the mood she is in (pip/temper.ts): kept on this device, so it is there when the reader comes
  // back to the room (or to the app, within the time it lasts), and worked out from the clock, so past its time it is gone.
  const temper = useRef<Temper | null>(null);
  if (temper.current === null) temper.current = parseTemper(readText(TEMPER_STORE), wallMs());
  const [humour, setHumour] = useState<Humour>(() => humourOf(temper.current ?? parseTemper(null, wallMs()), wallMs()));
  const humourRef = useRef(humour);
  humourRef.current = humour;
  // Resting, she stands as she feels: under a blanket with a cold, her back turned in a huff, drooping when glum or sulking.
  const base = bundled(world?.cold) ? "cold-idle" : humour === "huff" ? SULK_MOVE : mopey || humour === "sulk" ? "mope" : "idle";
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
    /**
     * The press that has hold of her, while there is one: where it began and when, whether it has become a carry
     * (`moved`), a cuddle (a press held still: pip/play.ts) or a finger's rub, and how far it has strayed from where
     * it began (CSS pixels). `judged`: it has been held long enough to be a cuddle, and has been one or could not be.
     */
    drag: null as null | { id: number; startX: number; startY: number; moved: boolean; at: number; far: number; judged: boolean; cuddling: boolean; rubbed: boolean; refused: boolean },
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
    /** Pokes in a row, the taps that made them (two quick ones are a high five), and the stroke the pointer is making over her. */
    poke: null as Poke | null,
    taps: null as Taps | null,
    stroke: null as Stroke | null,
    /** Being stroked, tickled or cuddled: since when, until when, and when hearts next rise. */
    touch: null as null | { kind: "pet" | "tickle" | "cuddle"; since: number; last: number; fxAt: number },
    /** A tickled leaf has her sneezing until then: she is not rubbed again before it is over. */
    sneezeUntil: 0,
    /** Held: the hand's path, for whether she is being whirled round; whether she has said so; and (let go) whether she comes down giddy. */
    whirl: null as Whirl | null,
    whirlTold: false,
    giddy: false,
    /** Her temper: a tantrum she is about to throw (when she is next on her feet), a coming-round she owes, and when things were last looked at or said. */
    tantrumDue: null as Annoyance | null,
    roundDue: null as null | "madeUp" | "eased",
    temperSeenAt: 0,
    temperTold: "",
    huffWordAt: -Infinity,
    /** On a trampoline: how many more times it throws her up, and how high its mat is (where she comes down on it); and what she says as she starts. */
    bounce: null as null | { left: number; floor: number },
    bounceSay: null as string | null,
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
    /**
     * The ball, when it is out, and the game of catch (pip/catch.ts). `rally`: the catches in a row, and the chance
     * in it. `act`: the small thing she is doing about it. `why`: what she is running to the ball for. `goal`: where
     * a ball in the air will come down. `spot`: where she is running back to throw from. `passed`: this throw has
     * gone by her (a miss, a bonk), and is not hers to take again until it is down. `asked`: how far her asking to
     * play has got. `impact`: what the ball last met, for its squash. `hop`: a hop where she stands. `seen`: what
     * of the ball is on screen, so its canvases are only drawn when that changes.
     */
    ball: null as Ball | null,
    play: {
      rally: rallyStart(Math.floor(Math.random() * 0x7fffffff)) as Rally,
      act: null as CatchAct | null,
      why: "fetch" as "fetch" | Ask,
      goal: null as number | null,
      spot: null as number | null,
      passed: false,
      asked: 0,
      impact: null as null | (Hit & { at: number }),
      hop: null as null | { at: number; lasts: number; high: number },
      seen: { art: "", shadow: "", tally: -1 }
    },
    /** Where the reader's own pointer is in the room (floor pixels), while it is in it: where her throws are meant for. (`pointer` is what her eyes follow, which is the ball while it flies.) */
    reader: null as null | { x: number; y: number },
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
  const live = useRef({ scale, level, base, repertoire, mood, onActDone, onPoke, onPlayed, ownBall, attentive, decor, plots, decorating, world, onWelcomed, onFridgeBare, onTemper });
  live.current = { scale, level, base, repertoire, mood, onActDone, onPoke, onPlayed, ownBall, attentive, decor, plots, decorating, world, onWelcomed, onFridgeBare, onTemper };
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
  // By night: the lights the room is drawn by just now (and the room and moment they are of), and how bright Pip and
  // her ball were last told to be (`lightThings`).
  const roomLights = useRef<{ key: string; glows: Glow[] | null; dark: boolean }>({ key: "", glows: null, dark: false });
  const litSeen = useRef({ pip: { lit: "" }, ball: { lit: "" } });
  // The two colour filters that light is put on them by (an SVG filter each, in the room), and the button that is Pip.
  const litId = `pip-lit-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pipLitRef = useRef<SVGFEColorMatrixElement | null>(null);
  const ballLitRef = useRef<SVGFEColorMatrixElement | null>(null);
  const pipButtonRef = useRef<HTMLButtonElement | null>(null);
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
      hour = now;
      // The frames drawn so far for the room as it stands (`roomFrames`).
      const stands = `${level.id}|${decorKey}|${hour}|${openSky ? 1 : 0}|${hidden}`;
      const frames = roomFramesFor(stands);
      const shown = {
        ...decor,
        placed: out.size > 0 || unlit.size > 0 ? decor.placed.filter((entry) => !out.has(entry.slot)).map((entry) => (unlit.has(entry.slot) ? { ...entry, off: true } : entry)) : decor.placed,
        ...(fixtures ? { fixtures } : {})
      };
      // By night, the lights the room is drawn by, for what is laid over its picture and is not part of it (Pip, her
      // ball): they are as bright as the light on them (`lightThings`). Asked for again when the room changes, and a
      // few times a second besides, for the lights that flicker.
      // (By day too: a light on behind drawn curtains is what lifts their shade.)
      const dark = level.night || isEvening(Math.floor(hour));
      const lightsKey = `${stands}|${dark ? 1 : 0}|${next >> 2}`;
      if (lightsKey !== roomLights.current.key) {
        let glows: Glow[] | null = null;
        try {
          glows = houseGlows(level, next, shown, hour);
        } catch {
          // Art mid-edit can throw: the lights as they were.
          glows = roomLights.current.glows;
        }
        const changed = JSON.stringify(glows) !== JSON.stringify(roomLights.current.glows);
        roomLights.current = { key: lightsKey, glows, dark };
        // What the furnishings draw themselves (the clock, drawn curtains) is in the room's light too.
        if (changed) furnishRef.current?.relight();
      }
      lightThings();
      let image = frames.get(next);
      if (!image) {
        try {
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

  // Away from Pip's page only the room as it was left is kept (about 5 MB of frames a state).
  useEffect(() => () => trimRoomFrames(1), []);

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
  const furnishPip = useRef<FurnishPip>({ react: () => undefined, bed: () => undefined, asleep: () => false, wake: () => false, go: () => undefined, visit: () => undefined, fridge: () => undefined, vex: () => undefined, clock: nowMs, redraw: () => undefined, light: () => [0, 0, 0, 0] });
  const furnishRef = useRef<ReturnType<typeof useFurnishings> | null>(null);
  // Where her phone lights the bed, while it does (the room's picture draws the light).
  const phoneGlow = useRef<{ x: number; y: number } | null>(null);

  /** Ends the press that has hold of Pip, if there is one (see "carrying Pip", below). */
  const dragEnd = useRef<null | ((how: "up" | "cancel") => void)>(null);
  useEffect(() => () => dragEnd.current?.("cancel"), []);
  /** And the press that has hold of the ball (see "a game of catch", below). */
  const ballDragEnd = useRef<null | ((how: "up" | "cancel") => void)>(null);
  useEffect(() => () => ballDragEnd.current?.("cancel"), []);

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

  /**
   * By night Pip and her ball are in the light that falls on them (pip/home.js,
   * `litMatrix`): dim in a dark room, lit under a lamp, by the open fridge,
   * by her phone, and the colour of a coloured light (pink, then blue, under
   * the disco ball). They are laid over the room's picture, which the night
   * darkens, and used to be left as bright as by day: a Pip glowing in a
   * dark room (the owner, 2026-10-13: "Pip being bright randomly looks
   * off"). Each has a colour filter of its own in the room, whose numbers
   * are set here when they change; by day there is none.
   */
  const lightThings = () => {
    // (By day nothing laid over the room is dimmed or tinted.)
    const glows = roomLights.current.dark ? roomLights.current.glows : null;
    const s = st.current;
    const set = (node: HTMLElement | null, filter: SVGFEColorMatrixElement | null, which: "pip" | "ball", seen: { lit: string }, x: number, y: number) => {
      if (!node || !filter) return;
      const lit = glows ? litMatrix(lightOn(glows, x, y)) : "";
      const wanted = lit ? `url(#${litId}-${which})` : "";
      if (node.style.filter !== wanted) node.style.filter = wanted;
      if (lit === seen.lit && (lit === "" || filter.getAttribute("values") === lit)) return;
      seen.lit = lit;
      filter.setAttribute("values", lit || LIT_BY_DAY);
    };
    // (Her middle, not her feet: it is her face the light is seen on.)
    set(pipButtonRef.current, pipLitRef.current, "pip", litSeen.current.pip, s.x, s.y - 12);
    if (s.ball) set(ballArtRef.current, ballLitRef.current, "ball", litSeen.current.ball, s.ball.body.x, s.ball.body.y);
  };

  const place = () => {
    const s = st.current;
    const node = pipRef.current;
    if (!node) return;
    lightThings();
    const { scale: k } = live.current;
    // (A hop in a game of catch lifts her whole pixels off the floor: pip/catch.ts, `hopLift`.)
    const hop = s.phase === "catch" || s.phase === "fetch" ? s.play.hop : null;
    const lift = hop ? hopLift(nowMs() - hop.at, hop.lasts, hop.high) : 0;
    node.style.transform = `translate(${(s.x - 16) * k}px, ${(s.y - 30 - lift) * k}px)`;
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

  /**
   * Where the ball is drawn, and how: its button's middle at its place (to a
   * whole device pixel), the picture of it for its shape and how far it has
   * turned (pip/catch.ts: `ballShape`, `spinFrame`), its shadow on the floor
   * under it, and the rally's count beside it. In Pip's hands her own sprite
   * draws it, so only the button is there, to take it from her by. The
   * canvases are drawn again only when what they show changes.
   */
  const placeBall = () => {
    const node = ballRef.current;
    const s = st.current;
    const ball = s.ball;
    if (!node || !ball) return;
    lightThings();
    const { scale: k, level: lv, ownBall: own } = live.current;
    const now = nowMs();
    const ratio = window.devicePixelRatio || 1;
    const snap = (css: number) => Math.round(css * ratio) / ratio;
    const grab = Math.max(BALL_BOX * k, GRAB_MIN);
    node.style.transform = `translate(${snap(ball.body.x * k - grab / 2)}px, ${snap(ball.body.y * k - grab / 2)}px)`;
    const seen = s.play.seen;
    const inPaws = ball.state === "carried";
    const impact = s.play.impact;
    const shape = inPaws || ball.state === "held" ? "round" : ballShape(ball.body, impact ? { on: impact.on, speed: impact.speed, ago: now - impact.at } : null);
    const frame = spinFrame(ball.body.angle);
    const id = `ball${shape === "round" ? "" : `-${shape}`}${own ? "" : "-paper"}`;
    const art = inPaws ? "" : `${id}|${frame}`;
    const canvas = ballArtRef.current;
    if (canvas && art !== seen.art) {
      seen.art = art;
      canvas.style.visibility = art ? "visible" : "hidden";
      const image = art ? partFrame(id, frame) : null;
      if (image) canvas.getContext("2d")?.putImageData(image, 0, 0);
    }
    const shadow = ballShadowRef.current;
    if (shadow) {
      const { half, faint } = shadowOf(lv.walkY - BALL_RADIUS - ball.body.y);
      const key = inPaws ? "" : `${half}|${faint ? 1 : 0}|${k}`;
      if (key !== seen.shadow) {
        seen.shadow = key;
        shadow.style.visibility = key ? "visible" : "hidden";
        shadow.style.width = `${half * 2 * k}px`;
        shadow.style.opacity = faint ? "0.55" : "1";
      }
      // On the floor's own pixels, under the ball.
      shadow.style.transform = `translate(${snap((Math.round(ball.body.x) - half) * k)}px, ${snap(lv.walkY * k)}px)`;
    }
    const tally = tallyRef.current;
    if (tally) {
      const count = s.play.rally.count >= RALLY_SHOWS ? Math.min(99, s.play.rally.count) : 0;
      if (count !== seen.tally) {
        seen.tally = count;
        tally.style.visibility = count ? "visible" : "hidden";
        const image = count ? partFrame("tally", count) : null;
        if (image) tally.getContext("2d")?.putImageData(image, 0, 0);
      }
      if (count) {
        // Up and to one side of the ball, whole pixels at a time; on the other side by the right-hand wall.
        const side = ball.body.x > lv.w - 24 ? -1 : 1;
        tally.style.transform = `translate(${snap((Math.round(ball.body.x) + side * 8 - 16) * k)}px, ${snap((Math.max(10, Math.round(ball.body.y) - 9) - 16) * k)}px)`;
      }
    }
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
      // (The mood she is in is laid over the long one here too: sulking she chooses as a glummer Pip would, glad as a brighter.)
      mood: Math.max(0, Math.min(100, feeling + (temper.current ? heartsOff(temper.current, wallMs()) : 0))),
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
      world: worldFelt()
    };
  };

  // ---- her temper, and the mood she is in ----------------------------------------------------
  // The rules are pip/temper.ts's: what wears on her patience and what gives it back, when a tantrum starts, how
  // long the sulk after it lasts and how it eases, and the good moods. Here they meet the scene: what the reader
  // does is reported (`vex`, `please`), the tantrum and the coming-round are played when she is next on her feet
  // (see the loop), she stands as she feels (`base`), and the page is told for the hearts. Kept on this device
  // every time it changes, so leaving the room, or the app, does not wipe it: the clock runs it out.

  /** How she is, as of now. */
  const humourNow = (): Humour => (temper.current ? humourOf(temper.current, wallMs()) : null);
  /** In the huff after a tantrum: she will have nothing to do with the reader. */
  const inHuff = () => humourNow() === "huff";

  /** What is in her fridge, with what this device remembers of her finding it bare (pip/furnish.ts, `bareMinds`). */
  const larderNow = (known: World | undefined): World["fridge"] => {
    const fridge = known?.fridge;
    if (!fridge) return fridge ?? null;
    const seen = parseBareSeen(readText(BARE_STORE));
    return { bare: fridge.bare, resigned: fridge.bare && !bareMinds(seen, getDateKey(), wallMs()), wasBare: seen.wasBare };
  };

  /** The world as she knows it, with how she feels about it: her fridge as she has found it, and the mood she is in. */
  const worldFelt = (): World => {
    const known = worldNow();
    const stage = humourNow();
    return { ...known, fridge: larderNow(known), humour: stage === "huff" ? "sulk" : stage };
  };

  /** Tells the page how she is (it lays that over the hearts), and has her stand as she feels. Says nothing twice. */
  const tellTemper = () => {
    const s = st.current;
    if (!temper.current) return;
    const wall = wallMs();
    const shown: TemperShown = { off: heartsOff(temper.current, wall), humour: humourOf(temper.current, wall), minutesLeft: spellMinutesLeft(temper.current, wall) };
    const told = `${shown.off}|${shown.humour}|${shown.minutesLeft}`;
    if (told === s.temperTold) return;
    s.temperTold = told;
    live.current.onTemper?.(shown);
    if (shown.humour !== humourRef.current) {
      // The huff is over by itself: she owes a look over her shoulder (unless she has been made up with, which has its own).
      if (humourRef.current === "huff" && !s.roundDue) s.roundDue = "eased";
      humourRef.current = shown.humour;
      setHumour(shown.humour);
    }
  };

  const keepTemperNow = () => {
    if (temper.current) writeText(TEMPER_STORE, keepTemper(temper.current, wallMs()));
  };

  /** Something the reader did that wears on her patience. The last straw is a tantrum, thrown when she is next on her feet. */
  const vex = (what: Annoyance) => {
    if (outRef.current || !temper.current) return;
    const result = annoy(temper.current, what, wallMs());
    temper.current = result.temper;
    if (result.tantrum) {
      st.current.tantrumDue = result.tantrum;
      st.current.roundDue = null;
    }
    keepTemperNow();
    tellTemper();
  };

  /** Something kind. Sulking, a cuddle or a snack makes up with her, and she comes round when she is next on her feet. */
  const please = (what: Kindness) => {
    if (outRef.current || !temper.current) return;
    const result = soothe(temper.current, what, wallMs());
    temper.current = result.temper;
    if (result.madeUp) {
      st.current.roundDue = "madeUp";
      st.current.tantrumDue = null;
    }
    keepTemperNow();
    tellTemper();
  };

  /** A hand on a Pip in a huff: a word over her shoulder, now and then, and nothing else. */
  const rebuff = () => {
    const s = st.current;
    const now = nowMs();
    if (now - s.huffWordAt < HUFF_WORD_MS) return;
    s.huffWordAt = now;
    say(huffLine(Math.random));
    playSound("squeak", { pitch: 0.6, volume: 0.5 });
  };

  /** The tantrum she owes: the performance for what set her off (pip/temper.ts, `tantrumPlan`), from where she stands. */
  const throwTantrum = () => {
    const s = st.current;
    const cause = s.tantrumDue;
    if (!cause) return;
    const { level: lv, decor: dc } = live.current;
    s.tantrumDue = null;
    s.roundDue = null;
    s.errand = null;
    s.touch = null;
    dropPlan();
    s.fidgets = 0;
    s.plan = { activity: tantrumPlan(cause, { x: s.x, floorW: lv.w, bed: bedBox(lv, dc) ? BED_ID : null, reduced: prefersReducedMotion() }, Math.random), index: -1 };
    playSound("squeak", { pitch: 0.55 });
    nextStep();
  };

  /** Coming round: made up with, or the huff simply over (pip/temper.ts, `comeRound`). */
  const comeRoundNow = () => {
    const s = st.current;
    const how = s.roundDue;
    s.roundDue = null;
    if (!how) return;
    s.errand = null;
    s.touch = null;
    dropPlan();
    s.fidgets = 0;
    s.plan = { activity: comeRound(how === "madeUp", Math.random, prefersReducedMotion()), index: -1 };
    nextStep();
  };

  // She is as she was left, when the room is come back to: the page is told at once, and nothing is performed.
  useEffect(() => {
    st.current.temperTold = "";
    tellTemper();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * She has looked in her fridge. Bare (and she minds): remembered on this device, the page is told (Rust takes a
   * little off her mood, the first time in a day), and it wears on her. Food, where she last found none: she is glad of it.
   */
  const foundFridge = (what: "bare" | "food") => {
    const seen = parseBareSeen(readText(BARE_STORE));
    if (what === "bare") {
      writeText(BARE_STORE, JSON.stringify(bareFound(seen, getDateKey(), wallMs())));
      live.current.onFridgeBare?.();
      vex("fridge");
    } else if (seen.wasBare) {
      writeText(BARE_STORE, JSON.stringify(foodFound(seen)));
      please("food");
    }
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
    } else if (step.kind === "use" && step.what === "thing" && (step.verb === FOUND_BARE || step.verb === FOUND_FOOD)) {
      // She has looked in the fridge, and this is what she found (pip/behaviour.ts, `fridgeVisit`).
      foundFridge(step.verb === FOUND_BARE ? "bare" : "food");
      nextStep();
    } else if (step.kind === "use" && step.what === "thing" && step.verb.startsWith("bounce:")) {
      // A trampoline: that is hers to do, not the thing's. The plan goes on when she is down again (see `onSpriteDone`).
      bounceOn(Number(step.verb.slice(7)) || 1);
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
   * On a trampoline: thrown straight up from where she stands, so many times
   * (the loop sends her up again each time she comes down on it: see "fall"),
   * arms out, and then a small hop off. For show, like everything the room
   * does with her: it is not told to the page, so it is not a toss that counts.
   */
  const bounceOn = (times: number) => {
    const s = st.current;
    s.bounce = { left: Math.max(0, times - 1), floor: live.current.level.walkY - TRAMPOLINE_LIFT };
    s.vx = 0;
    s.vy = -TRAMPOLINE_VY;
    s.angle = 0;
    s.spin = 0;
    s.tossed = false;
    s.giddy = false;
    s.hardest = 0;
    s.phase = "fall";
    show("tossed", undefined, "fall");
    say(s.bounceSay);
    s.bounceSay = null;
    playSound("bounce", { pitch: 0.8, volume: 0.6 });
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
        if (errand.found) foundFridge(errand.found);
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
    ballGone();
    // Nothing of the night comes along: no phone, no fridge door held (the furnishings shut it), nobody tucked in.
    s.abed = null;
    s.pendingScroll = null;
    s.fridgeHold = null;
    s.snoozing = false;
    s.hiding = false;
    s.tuckedAt = -Infinity;
    phoneGlow.current = null;
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
    // A snack is the surest kindness there is: it makes up with a sulking Pip, and leaves a happy one happy for a while.
    if (snack) please("treat");
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
    } else if (s.phase === "land" && s.plan) {
      // Down off the trampoline, in the middle of what she came to it for: on with it.
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
      ballDragEnd.current?.("cancel");
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
        stepBall(time, dt);
        furnishRef.current?.step(dt, reduced);
        return;
      }
      // Called away with the find still over her head (picked up, poked): it is put by, and counts as shown.
      if (holdingRef.current && s.errand?.kind !== "back") {
        setHolding(null);
        tellWelcomed();
      }
      // Off the trampoline by any road but her own (caught in the air, called away): its bounces do not wait for her next fall.
      if (s.bounce && s.phase !== "fall") s.bounce = null;
      // Her temper eases by the clock: looked at once a second, for the hearts and for how she stands.
      if (time - s.temperSeenAt > TEMPER_LOOK_MS) {
        s.temperSeenAt = time;
        tellTemper();
      }
      // A tantrum she owes, or a coming-round: once she is on her feet and nothing else has her (never from her bed,
      // the hand or the air; never while the room is being rearranged or she is being pointed at).
      if (s.tantrumDue || s.roundDue) {
        if (s.phase === "sleep" || s.phase === "tuck") s.roundDue = null;
        const up = s.phase === "rest" || s.phase === "walk" || s.phase === "doing" || s.phase === "errand";
        if (up && !live.current.decorating && !live.current.attentive && s.plan?.activity.id !== "tantrum") {
          if (s.tantrumDue) throwTantrum();
          else if (s.phase === "rest") comeRoundNow();
        }
      }
      // A press held still on her has become a cuddle (pip/play.ts): it begins under the hand, not when the hand lifts.
      const press = s.drag;
      if (press && !press.moved && !press.judged && !press.rubbed && press.far <= CUDDLE_SLACK && pressOf(time - press.at) === "cuddle") {
        press.judged = true;
        touchPip("cuddle");
        press.cuddling = s.touch?.kind === "cuddle";
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
        // (On a trampoline the floor is its mat, once she is on her way down: she jumps up onto it from the floor.)
        const air = airBounds(lv);
        const flight = flyStep({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin }, dt, s.bounce && s.vy >= 0 ? { ...air, floor: s.bounce.floor } : air, PIP_BOUNCE, true);
        ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin } = flight.body);
        const sprung = s.bounce !== null && flight.impact > 0;
        if (s.bounce && sprung) {
          // Down on the trampoline: up she goes again, as many times as she came for, and then a small hop off it.
          const off = s.bounce.left <= 0;
          s.vy = off ? -TRAMPOLINE_VY * 0.45 : -TRAMPOLINE_VY;
          s.angle = 0;
          s.spin = 0;
          if (off) s.bounce = null;
          else s.bounce.left -= 1;
          playSound("bounce", { pitch: off ? 1 : 0.8, volume: 0.6 });
        } else {
          s.hardest = Math.max(s.hardest, flight.impact);
          if (flight.hit) playSound("bounce", { pitch: 1.3, volume: Math.min(0.7, 0.25 + Math.max(flight.impact, 150) / 600) });
        }
        if (flight.landed && !sprung) {
          // A hard landing (or one still spinning) leaves her seeing stars, and wanting another go.
          const hard = s.tossed && (s.hardest > HARD_LANDING || Math.abs(s.spin) > 4);
          const tilt = nearUpright(s.angle);
          // What it was, to her patience: whirled giddy, thrown (fun, until it is again and again), or simply dropped from a height.
          if (s.giddy) vex("whirled");
          else if (s.tossed) vex("tossed");
          else if (s.hardest > DROPPED_HARD) vex("dropped");
          s.vx = 0;
          s.angle = 0;
          s.spin = 0;
          s.hardest = 0;
          s.phase = "land";
          if (s.giddy) {
            // Whirled round in the hand before she was let go: the room is still going round.
            show("dizzy", 2);
            say(pickOne(GIDDY_LINES));
          } else if (hard) {
            show("dizzy", 1);
            say(pickOne(["whee! again!", "again! again!", "whoa. do that again."]));
          } else {
            show("land", 1);
          }
          playSound("place", { pitch: 1.2, volume: 0.5 });
          // (A whirl is a kind of toss, as far as cheering her up goes, even when she was only set down after it.)
          if (s.tossed || s.giddy) played("toss");
          s.tossed = false;
          s.giddy = false;
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
        // A cuddle lasts as long as the hand is held on her.
        if (touch.kind === "cuddle" && s.drag?.cuddling) touch.last = time;
        if (time - touch.last > (touch.kind === "cuddle" ? CUDDLE_END_MS : TOUCH_GAP_MS)) {
          // The hand has gone: a happy sigh if it stayed a while (a cuddle always has: it took a held press to start one).
          const stayed = touch.kind === "cuddle" || touch.last - touch.since >= TOUCH_MIN_MS;
          s.touch = null;
          s.phase = "fidget";
          if (stayed) {
            // It is kind, and she takes it so: a long cuddle more than a short one or a stroke (pip/temper.ts).
            please(touch.kind === "tickle" ? "tickle" : touch.kind === "cuddle" && touch.last - touch.since >= LONG_CUDDLE_MS ? "cuddle" : "stroke");
            // (A cuddle cheers her up as a stroke does: pip/play.ts, `PLAYS`.)
            played(touch.kind === "cuddle" ? "pet" : touch.kind);
            show(touch.kind === "pet" ? "smitten" : touch.kind === "cuddle" ? "pet" : "shift", 1);
            if (touch.kind === "cuddle") say(pickOne(CUDDLED_LINES));
          } else {
            rest();
          }
        } else if (time > touch.fxAt) {
          touch.fxAt = time + TOUCH_FX_MS;
          playSound(touch.kind === "tickle" ? "giggle" : "purr", { volume: 0.7, pitch: touch.kind === "cuddle" ? 0.85 : 1 });
          const head = headPoint();
          if (head && !reduced && touch.kind !== "tickle") {
            burst(head, { px: live.current.scale, count: touch.kind === "cuddle" ? 3 : 2, sprite: "heart", spread: 30 * live.current.scale * 0.4, lift: 22, fall: 2, duration: 900 });
          }
        }
      } else if (s.phase === "fetch" && s.ball) {
        // After the ball: under it while it is in the air (and it is hers the moment it is in reach), or to where it lies.
        const ball = s.ball;
        const play = s.play;
        const flying = ball.state === "air";
        if (ball.state === "held" || ball.state === "carried" || (flying && (ball.by !== "reader" || play.passed)) || inHuff()) {
          // The reader has it again, or it is not hers to take: she waits to see where it goes.
          rest();
        } else if (flying && Math.abs(ball.body.x - s.x) <= REACH_X && reachOf(ball.body.y, lv.walkY) !== "over" && (ball.body.vy > 0 || ball.body.y > lv.walkY - HEAD_HIGH)) {
          takeBall();
        } else {
          if (flying && play.goal === null) aimForBall();
          const to = flying ? play.goal ?? ball.body.x : ball.body.x;
          const gap = to - s.x;
          const dir = gap < 0 ? -1 : 1;
          const pace = (play.why === "fetch" ? CATCH_RUN * (halfHearted() ? HALF_PACE : 1) : WALK_SPEED * 1.6) * paceNow();
          const next = clampX(s.x + dir * Math.min(Math.abs(gap), pace * dt));
          // (At the floor's edge, as near as she can get is near enough.)
          const there = Math.abs(gap) <= (flying ? 2 : 6) || next === s.x;
          if (!there && stopForVisitor(worldNow()?.visitor, s.x, next) !== null) {
            // The ball is beyond the visitor: she leaves it where it is, rather than run through them.
            ball.by = null;
            ball.rested = time;
            play.asked = 3;
            answer({ move: "shift", loops: 1, line: "it's behind our guest. yours!" });
          } else if (!there) {
            if (Math.abs(gap) > 3) face(dir);
            s.x = next;
            if (viewRef.current.move === "reach") show("scamper", undefined, `fetch-again-${Date.now()}`);
            place();
          } else if (flying) {
            // Under where it will come down: arms up, eyes on it.
            if (viewRef.current.move !== "reach") show("reach", undefined, `ready-${Date.now()}`);
            if (Math.abs(ball.body.x - s.x) > 4) face(ball.body.x < s.x ? -1 : 1);
            place();
          } else {
            atBall();
          }
        }
      } else if (s.phase === "carry" && s.ball) {
        // Back with it, at a run, to where she can throw it from.
        const ball = s.ball;
        if (ball.state !== "carried") {
          // Taken out of her paws.
          rest();
        } else {
          const to = s.play.spot ?? s.x;
          const gap = to - s.x;
          const dir = gap < 0 ? -1 : 1;
          const next = clampX(s.x + dir * Math.min(Math.abs(gap), CATCH_RUN * (halfHearted() ? HALF_PACE : 1) * paceNow() * dt));
          // (With a visitor in the way she throws from where she has got to.)
          if (Math.abs(gap) <= 1 || next === s.x || stopForVisitor(worldNow()?.visitor, s.x, next) !== null) {
            if (ball.by === "reader") {
              // Fetched and brought back: that is the old game, and still counts as it.
              please("fetch");
              played("fetch");
            }
            windUp();
          } else {
            face(dir);
            s.x = next;
            place();
          }
        }
      } else if (s.phase === "catch" && s.ball && s.play.act) {
        // One of the small things a game of catch is made of, until its time is up.
        const act = s.play.act;
        const ball = s.ball;
        const holding = act.kind === "windup" || act.kind === "chin" || act.kind === "away" || act.kind === "handback";
        if (holding && ball.state !== "carried") {
          // Taken out of her paws (or from under her chin): up she gets, to see where it goes.
          rest();
        } else if (act.soft && ball.state === "air" && ball.by === "reader" && !s.play.passed && !inHuff()) {
          // Another one on its way already.
          chase();
        } else if (time >= act.until) {
          endCatchAct(act);
        } else {
          if (act.kind === "look" && time > s.gazeAt) {
            // Asking: her eyes go from the reader to the ball and back.
            s.gazeAt = time + 700;
            const atReader = Math.floor((act.until - time) / 700) % 2 === 0;
            const point = atReader ? s.reader : { x: ball.body.x, y: ball.body.y };
            const gaze = point ? gazeAt({ x: s.x, y: s.y - 15 }, point, 9) : { dx: 0 as const, dy: 0 as const };
            const wanted = gazeMove(s.facing < 0 ? { dx: (gaze.dx * -1) as -1 | 0 | 1, dy: gaze.dy } : gaze, "idle");
            if (wanted !== viewRef.current.move) show(wanted, undefined, "rest");
          }
          place();
        }
      } else if (s.phase === "fetch" || s.phase === "carry" || s.phase === "catch") {
        // The ball has gone (put away, another floor): nothing to play with.
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
      } else if (s.phase === "rest" && s.ball && ballTurn(time, reduced)) {
        // The ball is out, and it is her turn: she is off after it, or asking to play (see `ballTurn`).
      } else if (s.phase === "rest" && time > s.nextFree && !s.plan && inHuff()) {
        // In a huff: her back to the room, and nothing doing. (It passes: pip/temper.ts, `HUFF_MS`.)
        s.nextFree = time + 3000;
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
          const small = fidget({ mood: outlook(time, reduced).mood, hour: new Date().getHours(), world: worldFelt() }, s.lastFidget, Math.random);
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
      stepBall(time, dt);
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
        // The game of catch: the rally, who threw the ball last and whether it can still be caught, the small thing she is doing about it, and what of the ball is drawn.
        const game = s.ball
          ? {
              rally: s.play.rally.count,
              by: s.ball.by,
              live: s.ball.live,
              act: s.phase === "catch" ? s.play.act?.kind ?? null : null,
              why: s.phase === "fetch" ? s.play.why : null,
              unanswered: s.play.rally.unanswered,
              asked: s.play.asked,
              v: [Math.round(s.ball.body.vx), Math.round(s.ball.body.vy)],
              art: s.play.seen.art,
              shadow: s.play.seen.shadow,
              tally: s.play.seen.tally
            }
          : null;
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
          game,
          angle: fixed(s.angle),
          // Held and thrown, to the hundredth: where, how fast, which way up, and the swing in the hand.
          at: [fixed(s.x), fixed(s.y)],
          v: [fixed(s.vx, 1), fixed(s.vy, 1)],
          spin: fixed(s.spin),
          swing: [fixed(s.hold.swing.angle, 3), fixed(s.hold.swing.spin)],
          turn: spinRef.current?.style.transform ?? "",
          dragging: s.drag !== null,
          // Under the hand: stroked, tickled or cuddled; the press that has her; the pokes so far; how far round she has been whirled.
          touch: s.touch?.kind ?? null,
          press: s.drag ? { moved: s.drag.moved, cuddling: s.drag.cuddling, rubbed: s.drag.rubbed } : null,
          pokes: s.poke?.count ?? 0,
          whirl: s.whirl ? fixed(s.whirl.turned / (Math.PI * 2)) : null,
          giddy: s.giddy,
          // Her temper: how she is, her patience, what it adds to the hearts, and what she owes.
          humour: humourNow(),
          patience: temper.current ? fixed(temperAt(temper.current, wallMs()).patience, 1) : null,
          hearts: temper.current ? heartsOff(temper.current, wallMs()) : 0,
          spellLeft: temper.current ? spellMinutesLeft(temper.current, wallMs()) : 0,
          owes: s.tantrumDue ?? s.roundDue
        };
      },
      /** A tap, as the pointer's or the keyboard's: a poke, or (the second of two quick ones) a high five. */
      poke: () => {
        if (!outRef.current) tapPip();
        return hook.state();
      },
      play: (how: "pet" | "tickle" | "cuddle" | "highfive" | "spin" | "sneeze" | "ball" | "toss") => {
        if (outRef.current) return hook.state();
        if (how === "pet") touchPip("pet", 2600);
        else if (how === "tickle") touchPip("tickle", 2200);
        else if (how === "cuddle") touchPip("cuddle", CUDDLE_KEY_MS);
        else if (how === "highfive") highFivePip();
        else if (how === "spin") spinPip();
        else if (how === "sneeze") sneezePip();
        else if (how === "ball") tossBall();
        else hop();
        return hook.state();
      },
      /** The ball, as the reader's hand would throw it: from a place, at a speed (floor pixels); or, with nothing, the Ball key's toss. */
      ball: (from?: { x: number; y: number; vx: number; vy: number }) => {
        if (outRef.current) return hook.state();
        if (from) readerThrow(from, from);
        else tossBall();
        return hook.state();
      },
      /** The game's chance, set by hand: the same seed plays the same game. */
      seed: (seed: number) => {
        st.current.play.rally = rallyStart(seed);
        return hook.state();
      },
      /** Her temper, by hand: something that wears on it, something kind; or all of it forgotten. */
      vex: (what: Annoyance) => {
        vex(what);
        return hook.state();
      },
      please: (what: Kindness) => {
        please(what);
        return hook.state();
      },
      calm: () => {
        temper.current = parseTemper(null, wallMs());
        st.current.tantrumDue = null;
        st.current.roundDue = null;
        writeText(TEMPER_STORE, null);
        tellTemper();
        return hook.state();
      },
      /** She looks in her fridge and finds this, as a step of her own visit would say. */
      found: (what: "bare" | "food") => {
        foundFridge(what);
        return hook.state();
      },
      /** The furnishings that can be used on this floor: where each is and how it stands. */
      furnish: () => furnishRef.current?.state() ?? [],
      /** Uses the first furnishing of a kind as a tap would ("fridge", "bed", "lamp"...), or the one piece named ("visit", "aquarium"). */
      use: (kind: Parameters<NonNullable<typeof furnishRef.current>["use"]>[0], itemId?: string) => {
        furnishRef.current?.use(kind, itemId);
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
        ballGone();
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
    kindness: (what) => please(what),
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
      else if (how === "cuddle") touchPip("cuddle", CUDDLE_KEY_MS);
      else if (how === "highfive") highFivePip();
      else if (how === "spin") spinPip();
      else if (how === "sneeze") sneezePip();
      else if (how === "ball") tossBall();
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
  // again, two quick taps that are a high five, a press held still that is a
  // cuddle, strokes she leans into, a tickle (on her leaf, a sneeze), a ball to
  // fetch, and (below) being picked up by the leaf, swung, whirled round until
  // she is giddy, and let go. The rules are in pip/play.ts; here they meet the
  // sprite, the sounds and the page (which cheers her up). Each way has a key
  // (the Play rail, or a letter on Pip herself: `onKeyDown`), an answer without
  // motion, and does nothing while she is out of the house. None is a new kind
  // of play: each counts as the nearest of the five Rust knows (`PLAYS`).

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
    const asleep = s.phase === "sleep" || s.phase === "tuck";
    const stage = humourNow();
    if (!asleep && stage === "huff") {
      // In a huff: a poke gets a word over her shoulder, and no more.
      rebuff();
      return;
    }
    if (!asleep && stage === "sulk" && s.phase !== "act") {
      // Still sulking: she answers, without any of her usual play in it.
      s.errand = null;
      s.touch = null;
      dropPlan();
      s.poke = null;
      s.phase = "fidget";
      show("mope", 1, `sulky-${now}`);
      say(sulkLine(Math.random));
      playSound("squeak", { pitch: 0.7, volume: 0.6 });
      return;
    }
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
      // Nobody likes being woken.
      vex("woken");
      return;
    }
    s.poke = pokeAgain(s.poke, now);
    const reaction = pokeReaction(s.poke.count);
    // At the end of the ladder, and past it, every poke is one too many.
    if (s.poke.count >= POKE_RUNGS) vex("poked");
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
    // (In a good mood the first poke, which has no line of its own, gets a happy one.)
    say(reaction.line ?? (stage === "glad" ? gladLine(Math.random) : null));
    playSound(reaction.sound, { pitch: reaction.pitch });
    const head = headPoint();
    if (head && !prefersReducedMotion()) burst(head, { px: live.current.scale, count: 5, sprite: "spark", spread: 44, lift: 14, fall: 8, duration: 480 });
  };

  /**
   * Stroked, tickled or cuddled, from now for `hold` more milliseconds (the
   * pointer keeps a stroke going as it rubs, and a cuddle going while it is
   * held on her; a Play key holds either a moment by itself).
   */
  const touchPip = (kind: "pet" | "tickle" | "cuddle", hold = 0) => {
    const s = st.current;
    const now = nowMs();
    if (!TOUCHABLE.has(s.phase)) return;
    if (inHuff()) {
      // In a huff she will not be stroked or tickled. A cuddle is how the reader says sorry, and she lets it.
      if (kind !== "cuddle") {
        rebuff();
        return;
      }
      please("cuddle");
    }
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    s.errand = null;
    dropPlan();
    if (!s.touch || s.touch.kind !== kind) {
      s.touch = { kind, since: s.touch?.since ?? now, last: now + hold, fxAt: now };
      s.phase = "petted";
      show(kind === "pet" ? "pet" : kind === "cuddle" ? "smitten" : "laugh", undefined, `petted-${kind}`);
      if (kind === "tickle") say("that tickles!");
      else if (kind === "cuddle") say(pickOne(CUDDLE_LINES));
    } else {
      s.touch.last = Math.max(s.touch.last, now + hold);
    }
  };

  /**
   * A tap on her (the pointer let go of at once, or the keyboard): a poke, or,
   * the second of two quick ones, a high five instead of a second poke
   * (pip/play.ts, `tapAgain`: the ladder goes back to where it was).
   */
  const tapPip = () => {
    const s = st.current;
    // A poke with an answer of its own (woken, caught on her phone, mid-act) is not half of a high five.
    const plain = TOUCHABLE.has(s.phase) && s.phase !== "sleep" && s.phase !== "tuck";
    const { taps, highFive } = tapAgain(plain ? s.taps : null, nowMs(), s.poke);
    s.taps = plain ? taps : null;
    if (highFive && plain) {
      s.poke = taps.before;
      highFivePip();
    } else {
      pokePip();
    }
  };

  /** A high five: up goes her hand, and yours meets it. */
  const highFivePip = () => {
    const s = st.current;
    if (!TOUCHABLE.has(s.phase)) return;
    if (inHuff()) {
      rebuff();
      return;
    }
    please("highfive");
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    s.errand = null;
    s.touch = null;
    dropPlan();
    s.phase = "fidget";
    show("welcome", 1, `five-${nowMs()}`);
    say(pickOne(HIGH_FIVE_LINES));
    playSound("clap");
    // Where the hands meet: up beside her head, on the side she faces. (Without motion the effects draw nothing.)
    const box = spinRef.current?.getBoundingClientRect();
    if (box) burst({ x: box.left + box.width * (0.5 + 0.3 * s.facing), y: box.top + box.height * 0.35 }, { px: live.current.scale, count: 7, sprite: "spark", spread: 40, lift: 12, fall: 8, duration: 520 });
    // (A high five cheers her up as a stroke does: pip/play.ts, `PLAYS`.)
    played("pet");
  };

  /**
   * Her leaf tickled: a sneeze. One at a time: she is not rubbed again until
   * it is over. Without motion there is no sneeze to watch, only the sniff
   * after it (as with her cold: pip/behaviour.ts).
   */
  const sneezePip = () => {
    const s = st.current;
    const now = nowMs();
    if (!TOUCHABLE.has(s.phase) || now < s.sneezeUntil) return;
    if (inHuff()) {
      rebuff();
      return;
    }
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    // One sneeze is funny. A few, one after another, and she has had enough of it.
    vex("sneezed");
    const reduced = prefersReducedMotion();
    s.sneezeUntil = now + (reduced ? 3200 : SNEEZE_MS);
    s.errand = null;
    s.touch = null;
    s.stroke = null;
    dropPlan();
    s.phase = "fidget";
    // (Turned to the right for it: the move has "achoo" written over her, and turned the other way it reads backwards.)
    if (!reduced) face(1);
    show(reduced ? "sniffle" : "sneeze", 1, `sneeze-${now}`);
    say(reduced ? "achoo! ...my leaf tickles." : pickOne(SNEEZE_LINES));
    playSound("achoo", { delay: reduced ? 0 : SNEEZE_AT_MS });
    // (A tickled leaf cheers her up as a tickle does: pip/play.ts, `PLAYS`.)
    played("tickle");
  };

  /** What the hand's rub comes to (pip/play.ts, `rubOf`): a stroke, a tickle, or a sneeze. */
  const rubPip = (rub: Rub) => {
    if (rub === "none" || nowMs() < st.current.sneezeUntil) return;
    if (rub === "sneeze") sneezePip();
    else touchPip(rub);
  };

  // ---- a game of catch ---------------------------------------------------------------
  // The ball used to be fetch and nothing else. Now it comes back: thrown to
  // her (by hand, a tap on it, or the Ball key's gentle toss) she gets under
  // it, takes it out of the air, wiggles, and throws it in an arc to where
  // the reader's pointer is; the reader catches it by pressing on it before
  // it is down. Catches in a row are a rally, counted beside the ball. She is
  // not perfect (a bonk, a jump at nothing), and a ball that gets past her she
  // fetches, at a run both ways. The rules, the ball's weight and the chances
  // are pip/catch.ts's (pure, catch.test.ts); here they meet the sprite, the
  // sounds and her temper. Without motion nothing flies: the ball is put at
  // her feet, she hands it back, and the rally counts all the same.

  /** The rally as it now stands: for the count beside the ball (the loop draws it) and the ball's label. */
  const setRally = (rally: Rally) => {
    st.current.play.rally = rally;
    setRallyShown(rally.count >= RALLY_SHOWS ? rally.count : 0);
  };

  /** No ball any more (put away, another floor, she has gone out): the press that has it lets go, and the game is over. */
  const ballGone = () => {
    const s = st.current;
    s.ball = null;
    ballDragEnd.current?.("cancel");
    const play = s.play;
    play.rally = rallyStart(play.rally.seed);
    play.act = null;
    play.why = "fetch";
    play.goal = null;
    play.spot = null;
    play.passed = false;
    play.asked = 0;
    play.impact = null;
    play.hop = null;
    play.seen = { art: "?", shadow: "?", tally: -1 };
    setBallOut(false);
    setRallyShown(0);
  };

  /** Whether her heart is only half in it: sulking, past the huff. She plays, slower, and does not cheer. */
  const halfHearted = () => humourNow() === "sulk";

  /** One of the small things a game of catch is made of, from now for `ms` (the loop ends it): the move it shows, and whether a ball coming her way cuts it short. */
  const catchAct = (kind: CatchAct["kind"], ms: number, move: string | null, loops?: number, soft = false) => {
    const s = st.current;
    s.errand = null;
    s.touch = null;
    s.phase = "catch";
    s.play.act = { kind, until: nowMs() + ms, soft };
    if (move) show(move, loops, `catch-${kind}-${Date.now()}`);
  };

  /** A hop where she stands (pip/catch.ts, `hopLift`): whole pixels, up and down once. */
  const hopNow = (high: number, lasts = 320) => {
    st.current.play.hop = { at: nowMs(), lasts, high };
  };

  /**
   * A catch has been counted, hers or the reader's. The first of a rally is
   * as good as a fetch to her, and a few in a row are a game (pip/temper.ts);
   * at a round number she cheers, unless her heart is not in it.
   */
  const countCatch = (tally: Tally, half: boolean) => {
    setRally(tally.rally);
    if (tally.rally.count === 1) please("fetch");
    if (tally.game) please("game");
    played("fetch");
    if (!tally.cheer || half) return;
    playSound("chime", { pitch: 1.3, volume: 0.4 });
    say(`${tally.rally.count}!`);
    hopNow(6, 380);
    const head = headPoint();
    if (head && !prefersReducedMotion()) burst(head, { px: live.current.scale, count: 8, sprite: "spark", spread: 50, lift: 18, fall: 8, duration: 600 });
  };

  /** Where a ball in the air will first come down: where she runs to. */
  const aimForBall = () => {
    const s = st.current;
    const ball = s.ball;
    s.play.goal = ball && ball.state === "air" ? landing(ball.body, ballRoom(live.current.level)).x : null;
  };

  /** After the ball: to where it will come down, or to where it lies. `why`: to fetch it (at a run), or one of the ways she asks to play (at a trot). */
  const chase = (why: "fetch" | Ask = "fetch") => {
    const s = st.current;
    if (!s.ball) return;
    s.errand = null;
    s.touch = null;
    dropPlan();
    s.phase = "fetch";
    s.play.act = null;
    s.play.why = why;
    s.play.spot = null;
    aimForBall();
    const to = s.play.goal ?? s.ball.body.x;
    if (Math.abs(to - s.x) > 3) face(to < s.x ? -1 : 1);
    show(why === "fetch" ? "scamper" : strollMove(), undefined, `fetch-${why}-${Date.now()}`);
  };

  /** Her throw: out of `from`, in an arc that comes down where the reader's pointer is (pip/catch.ts: `throwTarget`, `lob`). The reader's to catch until it is down. */
  const sendBack = (from: { x: number; y: number }, half: boolean) => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const room = ballRoom(live.current.level);
    const to = throwTarget(s.reader, s.x, room);
    const start = { x: Math.max(room.left, Math.min(room.right, from.x)), y: Math.max(room.top, Math.min(room.floor - 1, from.y)) };
    const toss = lob(start, to, room, half ? 1.12 : 1);
    ball.body = { ...ballAt(start.x, start.y, toss.vx, toss.vy), angle: ball.body.angle };
    ball.state = "air";
    ball.by = "pip";
    ball.live = true;
    ball.speed = Math.hypot(toss.vx, toss.vy);
    s.play.passed = false;
    s.play.goal = null;
    s.play.impact = null;
    if (Math.abs(to.x - s.x) > 3) face(to.x < s.x ? -1 : 1);
    placeBall();
  };

  /** She has the ball, and it is going back: a wiggle first, shorter the keener she is (pip/catch.ts, `windupMs`), facing where it will go. */
  const windUp = () => {
    const s = st.current;
    const { level: lv, ownBall: own } = live.current;
    const half = halfHearted();
    const to = throwTarget(s.reader, s.x, ballRoom(lv));
    if (Math.abs(to.x - s.x) > 3) face(to.x < s.x ? -1 : 1);
    catchAct("windup", windupMs(s.play.rally.count, half), own ? "windup" : "windup-paper");
    // Well into a rally she cannot keep her feet on the floor.
    if (!half && keenness(s.play.rally.count) >= 2) hopNow(4, 280);
  };

  /** The throw itself, out of her hands, and the follow-through. */
  const fling = () => {
    const s = st.current;
    const half = halfHearted();
    sendBack({ x: s.x + s.facing * HANDS.x, y: live.current.level.walkY + HANDS.y }, half);
    playSound("whee", { pitch: half ? 0.9 : 1.15, volume: 0.45 });
    catchAct("fling", FLING_MS, "fling", 1, true);
  };

  /** The reader's throw has come to her. How she takes it is pip/catch.ts's (`receive`); here it is played. */
  const takeBall = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const { level: lv } = live.current;
    const now = nowMs();
    const half = halfHearted();
    const high = reachOf(ball.body.y, lv.walkY) === "jump";
    const taken = receive(s.play.rally, { half });
    s.play.goal = null;
    // Turned to where it came from.
    if (Math.abs(ball.body.vx) > 20) face(ball.body.vx > 0 ? -1 : 1);
    if (taken.how === "bonk") {
      // Off the top of her head, and away; and she sits down about it.
      setRally(taken.rally);
      s.play.passed = true;
      ball.body = { ...ball.body, y: Math.min(ball.body.y, lv.walkY - HEAD_HIGH), vx: (ball.body.vx >= 0 ? 1 : -1) * 46, vy: -190, down: false };
      s.play.impact = { on: "ceiling", speed: 200, at: now };
      playSound("bonk");
      catchAct("bonk", BONK_MS, "bonk", 1);
      say(pickOne(BONK_LINES));
      return;
    }
    if (taken.how === "miss") {
      // A jump, and it sails by.
      setRally(taken.rally);
      s.play.passed = true;
      hopNow(7, 380);
      catchAct("whiff", WHIFF_MS, "reach");
      say(pickOne(WHIFF_LINES));
      return;
    }
    if (high) hopNow(6);
    if (taken.how === "flourish") {
      // Straight back, without her hands: off her head if it is up there, off her foot if it is down here.
      const heady = ball.body.y < lv.walkY - 13;
      playSound("bounce", { pitch: heady ? 1.5 : 0.85, volume: 0.6 });
      countCatch(taken, half);
      sendBack({ x: ball.body.x, y: ball.body.y }, half);
      catchAct("flourish", FLOURISH_MS, heady ? "header" : "punt", 1, true);
      return;
    }
    ball.state = "carried";
    ball.live = false;
    playSound("caught", { pitch: 1 + Math.min(12, taken.rally.count) * 0.03 });
    countCatch(taken, half);
    if (taken.rally.received === 1 && !half) say(pickOne(CAUGHT_LINES));
    windUp();
  };

  /** At the ball where it lies, to fetch it: up over her head, and back with it at a run, as far as where she can throw it from (pip/catch.ts, `throwSpot`). */
  const liftBall = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const { level: lv, ownBall: own } = live.current;
    // Thrown by the reader and picked up off the floor, it is a fetch, and the rally starts again. (Hers, missed: she is only trying again.)
    if (ball.by === "reader") setRally(fetched(s.play.rally));
    ball.state = "carried";
    ball.live = false;
    playSound("pop", { pitch: 1.3 });
    s.play.spot = throwSpot(s.x, throwTarget(s.reader, s.x, ballRoom(lv)).x, 18, lv.w - 18);
    s.play.act = null;
    s.phase = "carry";
    if (Math.abs(s.play.spot - s.x) > 1) face(s.play.spot < s.x ? -1 : 1);
    show(own ? "carry" : "carry-paper", undefined, `carry-${Date.now()}`);
  };

  /** A pat that sends the ball rolling across the floor to the reader: her way of asking, and of making up. */
  const patBall = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const room = ballRoom(live.current.level);
    const to = throwTarget(s.reader, s.x, room);
    const gap = to.x - ball.body.x;
    const dir = Math.abs(gap) < 4 ? s.facing : gap < 0 ? -1 : 1;
    face(dir < 0 ? -1 : 1);
    ball.body = { ...ballDown(ball.body.x, room, ball.body.angle), vx: dir * Math.max(50, Math.min(NUDGE_SPEED, 45 + Math.abs(gap))) };
    ball.state = "roll";
    // Nobody's throw: it is an offer, and she waits on it rather than running after it again.
    ball.by = null;
    ball.live = false;
    s.play.asked = Math.max(s.play.asked, 1);
    playSound("bounce", { pitch: 1.2, volume: 0.35 });
    catchAct("nudge", NUDGE_MS, "punt", 1);
  };

  /** Down on the floor with her chin on the ball, until it is taken or she gives up and puts it away. */
  const lieDown = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const to = throwTarget(s.reader, s.x, ballRoom(live.current.level));
    if (Math.abs(to.x - s.x) > 3) face(to.x < s.x ? -1 : 1);
    ball.state = "carried";
    ball.live = false;
    catchAct("chin", Math.max(4000, ball.rested + ASK_AWAY_MS - nowMs()), live.current.ownBall ? "chin" : "chin-paper");
  };

  /** Nobody is playing: she picks the ball up, and it is put away. */
  const putAway = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    ball.state = "carried";
    ball.live = false;
    catchAct("away", AWAY_MS, live.current.ownBall ? "carry" : "carry-paper");
  };

  /** In a huff, and the ball has been rolled gently to her feet: a peace offering, and she takes it (pip/temper.ts, `offerPeace`). A look at it, and at the reader; then she pats it back. */
  const makePeace = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball || !temper.current) return;
    temper.current = offerPeace(temper.current, "fetch", wallMs()).temper;
    keepTemperNow();
    tellTemper();
    // This is the coming-round: the one the huff's end would have owed is not played as well.
    s.roundDue = null;
    dropPlan();
    if (Math.abs(ball.body.x - s.x) > 2) face(ball.body.x < s.x ? -1 : 1);
    if (prefersReducedMotion()) {
      // Without motion: the look, the word, and the ball left where it is for the next throw.
      ball.by = null;
      answer({ move: "glance", loops: 1, line: pickOne(PEACE_LINES) });
      return;
    }
    catchAct("peace", PEACE_LOOK_MS, "glance", 1);
  };

  /** What she came to the ball for, now she is at it. */
  const atBall = () => {
    const why = st.current.play.why;
    if (why === "nudge") patBall();
    else if (why === "chin") lieDown();
    else if (why === "away") putAway();
    else liftBall();
  };

  /** One of the small things is over: what comes after it. */
  const endCatchAct = (act: CatchAct) => {
    const s = st.current;
    const ball = s.ball;
    const { level: lv } = live.current;
    if (act.kind === "windup") {
      fling();
    } else if (act.kind === "nudge") {
      // The pat is done: she looks between the reader and the ball.
      catchAct("look", NUDGE_LOOK_MS, null, undefined, true);
    } else if (act.kind === "chin") {
      putAway();
    } else if (act.kind === "away") {
      // Away it goes, in a puff over her head.
      const head = headPoint();
      if (head && !prefersReducedMotion()) puff({ x: head.x, y: head.y - 8 * live.current.scale }, { px: live.current.scale, count: 5, color: "#FFFFFF", edge: "#DCD6C8", spread: 24 });
      playSound("pop", { pitch: 0.8, volume: 0.4 });
      ballGone();
      rest();
    } else if (act.kind === "peace") {
      say(pickOne(PEACE_LINES));
      patBall();
    } else if (act.kind === "handback" && ball) {
      // Without motion: the ball is put down beside her, the reader's to take.
      const room = ballRoom(lv);
      const side = s.reader ? (s.reader.x < s.x ? -1 : 1) : s.x <= lv.w / 2 ? 1 : -1;
      ball.body = ballDown(s.x + side * 16, room, ball.body.angle);
      ball.state = "still";
      ball.by = "pip";
      ball.live = true;
      ball.rested = nowMs();
      rest();
    } else {
      rest();
    }
  };

  /**
   * Standing free, with the ball out: what, if anything, she does about it
   * now (pip/catch.ts, `turnOf`). Says whether she has started on it. While
   * there is a game to wait on she stays where she is and watches, rather
   * than wandering off to read.
   */
  const ballTurn = (time: number, reduced: boolean): boolean => {
    const s = st.current;
    const ball = s.ball;
    if (!ball || live.current.decorating || live.current.attentive) return false;
    if (inHuff()) {
      // In a huff she will have nothing to do with it; but a ball rolled gently to her feet is a peace offering.
      if (ball.state !== "still" || ball.by !== "reader" || !peaceOffering(ball.body.x, s.x, ball.speed)) return false;
      makePeace();
      return true;
    }
    const watch = () => {
      if (s.queue.length === 0 && !s.plan) s.nextFree = Math.max(s.nextFree, time + 1200);
      return false;
    };
    if (ball.state === "held" || ball.state === "carried") return watch();
    if (reduced) {
      if (ball.state !== "still") return false;
      if (ball.by === "reader") {
        // Without motion: the ball at her feet is caught, and a moment later handed back.
        const half = halfHearted();
        ball.state = "carried";
        ball.live = false;
        playSound("caught");
        countCatch(receive(s.play.rally, { half, still: true }), half);
        catchAct("handback", HANDBACK_MS, live.current.ownBall ? "carry" : "carry-paper");
        return true;
      }
      if (ball.live && time - ball.rested > OFFER_MS) {
        // Handed back and not taken: the rally lapses, without a word.
        ball.live = false;
        setRally(readerMissed(s.play.rally));
      }
      if (time - Math.max(ball.rested, ball.touched) > ASK_AWAY_MS) {
        ballGone();
        return false;
      }
      return watch();
    }
    if (ball.state === "air") {
      // The reader's throw, on its way: under it.
      if (ball.by !== "reader" || s.play.passed) return watch();
      chase();
      return true;
    }
    const turn = turnOf({ by: ball.by, unanswered: s.play.rally.unanswered, idleMs: ball.state === "still" ? time - ball.rested : 0, asked: s.play.asked });
    if (turn === "wait") return watch();
    if (turn === "fetch" || turn === "retry") {
      chase();
      return true;
    }
    s.play.asked = turn === "nudge" ? 1 : turn === "chin" ? 2 : 3;
    chase(turn);
    return true;
  };

  /**
   * The reader's throw: out of the hand at `from`, as fast as it was flicked
   * (nothing: a drop). Whatever she was doing can wait, there is a ball;
   * unless she is in a huff, and will not look at it.
   */
  const readerThrow = (from: { x: number; y: number }, velocity: { vx: number; vy: number }) => {
    const s = st.current;
    const { level: lv } = live.current;
    const room = ballRoom(lv);
    const now = nowMs();
    const was = s.ball;
    const x = Math.max(room.left, Math.min(room.right, from.x));
    const y = Math.max(room.top, Math.min(room.floor, from.y));
    s.ball = { body: { ...ballAt(x, y, velocity.vx, velocity.vy), angle: was?.body.angle ?? 0 }, state: "air", by: "reader", live: false, speed: Math.hypot(velocity.vx, velocity.vy), touched: now, rested: now };
    const play = s.play;
    play.passed = false;
    play.goal = null;
    play.asked = 0;
    play.impact = null;
    setRally(readerBack(play.rally));
    if (!was) {
      play.seen = { art: "?", shadow: "?", tally: -1 };
      setBallOut(true);
    }
    if (prefersReducedMotion()) {
      // Without motion nothing flies or runs: the ball is at her feet, and that is the throw.
      const side = x < s.x ? -1 : 1;
      s.ball.body = ballDown(s.x + side * 14, room, s.ball.body.angle);
      s.ball.state = "still";
      s.ball.speed = 0;
    } else if (s.ball.speed > 0) {
      playSound("whee", { pitch: 1.2, volume: 0.5 });
    }
    placeBall();
    if (inHuff()) return;
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    if (s.phase === "doing" || s.phase === "fidget" || s.phase === "walk" || s.phase === "errand" || s.phase === "petted") {
      s.errand = null;
      s.touch = null;
      dropPlan();
      rest();
    }
  };

  /**
   * The Ball key, the keyboard, a tap on the ball: a gentle underarm toss to
   * her, a little different each time (pip/catch.ts, `underarm`), from where
   * the ball is, or from a few steps off if it is not out yet.
   */
  const tossBall = () => {
    const s = st.current;
    const { level: lv } = live.current;
    const ball = s.ball;
    // (She has it, and is about to throw it: it is hers. From under her chin, or on its way to being put away, it is taken: that is what she was asking for.)
    const asking = s.phase === "catch" && (s.play.act?.kind === "chin" || s.play.act?.kind === "away");
    if (ball?.state === "carried" && !asking) return;
    const room = ballRoom(lv);
    const start = ball ? { x: ball.body.x, y: Math.min(ball.body.y, room.floor - 5), seed: s.play.rally.seed } : tossFrom(s.x, room, s.play.rally.seed);
    const toss = underarm(start, { x: s.x, y: lv.walkY + HANDS.y }, room, start.seed);
    s.play.rally = { ...s.play.rally, seed: toss.seed };
    readerThrow(start, toss);
  };

  /**
   * The reader's hand has closed on the ball. Out of the air from her throw
   * it is a catch, and she hops for it; out of her paws as she brings it back
   * or winds up, it is snatched, which she minds (pip/temper.ts, `ball`).
   * From the floor, or from under her chin, it is simply picked up.
   */
  const grabBall = () => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const now = nowMs();
    const half = halfHearted();
    const act = s.phase === "catch" ? s.play.act : null;
    if (ball.state === "carried" && (s.phase === "carry" || act?.kind === "windup")) vex("ball");
    if (ball.live && ball.by === "pip") {
      playSound("caught", { pitch: 1.1 + Math.min(12, s.play.rally.count) * 0.03 });
      countCatch(readerCaught(s.play.rally), half);
      if (!half && !prefersReducedMotion() && (s.phase === "rest" || act?.soft)) {
        hopNow(4, 300);
        catchAct("yay", YAY_MS, "reach", undefined, true);
      }
    } else {
      // Not a catch: whatever rally there was is over, and what she threw for nothing is forgotten.
      setRally(readerBack(fetched(s.play.rally)));
    }
    ball.state = "held";
    ball.live = false;
    ball.touched = now;
    ball.body = { ...ball.body, vx: 0, vy: 0, spin: 0, down: false, rem: 0 };
    s.play.asked = 0;
    s.play.goal = null;
    s.play.impact = null;
    placeBall();
  };

  /** The ball's own motion (pip/catch.ts, `ballStep`), what it meets, and what its coming down means for the game. */
  const stepBall = (time: number, dt: number) => {
    const s = st.current;
    const ball = s.ball;
    if (!ball) return;
    const { level: lv } = live.current;
    const room = ballRoom(lv);
    const play = s.play;
    if (ball.state === "carried") {
      const act = s.phase === "catch" ? play.act : null;
      if (s.phase !== "carry" && !act) {
        // Called away with the ball in her hands (a snack, a poke, picked up): it is put down where she was, and is nobody's throw.
        ball.body = ballDown(s.x + s.facing * 12, room, ball.body.angle);
        ball.state = "still";
        ball.by = null;
        ball.rested = time;
      } else {
        // In her hands: its button goes where her sprite draws it, so it can be taken from her.
        const at = act?.kind === "windup" ? BALL_WOUND : act?.kind === "chin" ? BALL_CHIN : BALL_CARRIED;
        ball.body = { ...ball.body, x: s.x + s.facing * at.x, y: lv.walkY + at.y, vx: 0, vy: 0 };
      }
    } else if (ball.state === "air" || ball.state === "roll") {
      const flying = ball.state === "air";
      const step = ballStep(ball.body, dt, room);
      ball.body = step.ball;
      const hit = step.hits[step.hits.length - 1];
      if (hit) {
        play.impact = { ...hit, at: time };
        // Where it will come down has changed.
        play.goal = null;
        playSound("bounce", { pitch: hit.on === "floor" ? 1 : 1.25, volume: Math.min(1, 0.25 + hit.speed / 500) });
      }
      if (ballStill(ball.body)) {
        ball.state = "still";
        ball.rested = time;
      } else if (ball.body.down) {
        ball.state = "roll";
      }
      if (flying && ball.state !== "air") {
        // Down. If it was hers, nobody caught it: the rally is over, and nothing is lost by it.
        play.passed = false;
        play.goal = null;
        if (ball.live) {
          ball.live = false;
          setRally(readerMissed(play.rally));
        }
      }
      // Her eyes are on it.
      if (ball.state === "air") s.pointer = { x: ball.body.x, y: ball.body.y, at: time };
    } else if (ball.state === "still" && time - Math.max(ball.rested, ball.touched) > BALL_FORGOTTEN_MS && s.phase !== "fetch" && s.phase !== "carry" && s.phase !== "catch") {
      // Nobody has been in a state to put it away (asleep, a visitor in the way, in a long sulk): it goes by itself, quietly.
      ballGone();
      return;
    }
    placeBall();
  };

  /** A little throw into the air, for the Play keys and the up arrow: what a toss by hand does. */
  const hop = () => {
    const s = st.current;
    if (!TOUCHABLE.has(s.phase)) return;
    if (inHuff()) {
      rebuff();
      return;
    }
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
    s.giddy = false;
    s.hardest = 0;
    s.phase = "fall";
    show("tossed", undefined, "fall");
    playSound("whee");
  };

  /**
   * Spun round, for the Play keys and the S key: what whirling her in the hand
   * does. Up she goes, turning twice over, and comes down giddy. Without
   * motion she is simply giddy where she stands.
   */
  const spinPip = () => {
    const s = st.current;
    if (!TOUCHABLE.has(s.phase)) return;
    if (inHuff()) {
      rebuff();
      return;
    }
    if (s.phase === "sleep" || s.phase === "tuck") untuck();
    s.errand = null;
    s.touch = null;
    dropPlan();
    if (prefersReducedMotion()) {
      s.phase = "fidget";
      show("dizzy", 1);
      say(pickOne(GIDDY_LINES));
      played("toss");
      return;
    }
    const side = s.facing < 0 ? -1 : 1;
    s.vx = 0;
    s.vy = -300;
    s.angle = 0;
    // Twice round in the two thirds of a second she is in the air.
    s.spin = side * 19;
    s.tossed = true;
    s.giddy = true;
    s.hardest = 0;
    s.phase = "fall";
    show("tossed", undefined, "fall");
    playSound("whee", { pitch: 1.25 });
  };

  // The ball in the reader's hand: caught out of the air, carried about, and
  // thrown as it is let go, all in one press if the reader likes. The press is
  // the ball's until it ends, wherever the pointer goes, and it never leaves
  // the ball stuck in the hand: the button up throws it (as fast as the hand
  // was going over its last moments: pip/catch.ts, `flick`) or, let go of
  // slowly, drops it; a press that is taken away (the pointer cancelled or
  // lost, the window losing focus or being hidden, another floor) drops it
  // where it is, and never throws it. A press that does not move is a tap:
  // a gentle toss to her.
  const onBallDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const s = st.current;
    if (!s.ball) return;
    event.preventDefault();
    // A second finger: the first lets go.
    ballDragEnd.current?.("cancel");
    if (!s.ball) return;
    const button = event.currentTarget;
    const id = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    grabBall();
    const first = pointerAt(event);
    // Where on the ball the hand has it: it stays there, rather than jumping to the pointer.
    const grip = first ? { x: s.ball.body.x - first.x, y: s.ball.body.y - first.y } : { x: 0, y: 0 };
    const samples: Sample[] = first ? [{ x: first.x, y: first.y, at: nowMs() }] : [];
    let moved = false;
    let over = false;
    try {
      button.setPointerCapture(id);
    } catch {
      // No such pointer (a press made in a test): the window's listeners below still hear it.
    }
    const move = (e: PointerEvent) => {
      const ball = s.ball;
      if (over || e.pointerId !== id || !ball || ball.state !== "held") return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_SLOP) return;
      moved = true;
      const hand = pointerAt(e);
      if (!hand) return;
      const room = ballRoom(live.current.level);
      const now = nowMs();
      ball.body = { ...ball.body, x: Math.max(room.left, Math.min(room.right, hand.x + grip.x)), y: Math.max(room.top, Math.min(room.floor, hand.y + grip.y)) };
      ball.touched = now;
      samples.push({ x: hand.x, y: hand.y, at: now });
      if (samples.length > 16) samples.shift();
      // Her eyes are on it.
      s.pointer = { x: ball.body.x, y: ball.body.y, at: now };
      placeBall();
    };
    const end = (how: "up" | "cancel") => {
      if (over) return;
      over = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", hidden);
      button.removeEventListener("lostpointercapture", lost);
      if (ballDragEnd.current === end) ballDragEnd.current = null;
      try {
        button.releasePointerCapture(id);
      } catch {
        // Already let go of.
      }
      const ball = s.ball;
      // Put away, or taken out of the hand by something else, while it was held: nothing to let go of.
      if (!ball || ball.state !== "held") return;
      if (how === "cancel") {
        // Taken away, not let go: it drops where it is, and is nobody's throw.
        const now = nowMs();
        ball.body = ballAt(ball.body.x, ball.body.y);
        ball.state = "air";
        ball.by = null;
        ball.speed = 0;
        ball.rested = now;
        if (prefersReducedMotion()) {
          ball.body = ballDown(ball.body.x, ballRoom(live.current.level));
          ball.state = "still";
        }
        placeBall();
        return;
      }
      if (!moved) {
        tossBall();
        return;
      }
      readerThrow(ball.body, flick(samples, nowMs()));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === id) end(e.type === "pointerup" ? "up" : "cancel");
    };
    const lost = () => end("cancel");
    const hidden = () => {
      if (document.visibilityState !== "visible") end("cancel");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", hidden);
    button.addEventListener("lostpointercapture", lost);
    ballDragEnd.current = end;
  };

  /** The keyboard on the ball (Enter, Space): taken as a hand would take it, and tossed to her. */
  const tapBall = () => {
    if (!st.current.ball) return;
    ballDragEnd.current?.("cancel");
    grabBall();
    tossBall();
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
    // Where on her matters: rubbed fast across her leaf she sneezes; across her belly, she is tickled.
    const box = event.currentTarget.getBoundingClientRect();
    const { stroke, touch, zone } = strokeMove(s.stroke ?? strokeStart(event.clientX), event.clientX, nowMs(), 32 * live.current.scale, zoneOf(event.clientY, box.top, box.height));
    s.stroke = stroke;
    rubPip(rubOf(touch, zone));
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
    // The hand's path from here: swung round in a circle a couple of times, she is giddy when she is let go.
    s.whirl = whirlStart(hand.x, hand.y, nowMs());
    s.whirlTold = false;
    s.giddy = false;
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
    // Whirled round in the hand (pip/play.ts): giddy when she is down. (Not if the press was only cancelled.)
    const giddy = !gently && s.whirl !== null && whirled(s.whirl, nowMs());
    s.whirl = null;
    s.giddy = false;
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
        please("bed");
        tuck(true);
        return;
      }
      s.phase = "land";
      if (giddy) {
        // Without motion nothing swung, but the hand went round all the same: she says so, standing still.
        show("dizzy", 1);
        say(pickOne(GIDDY_LINES));
        played("toss");
      } else {
        show("land", 1);
      }
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
      please("bed");
      tuck(false);
      place();
      return;
    }
    ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: s.angle, spin: s.spin } = body);
    s.tossed = tossed;
    s.giddy = giddy;
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
    const drag = { id, startX: event.clientX, startY: event.clientY, moved: false, at: nowMs(), far: 0, judged: false, cuddling: false, rubbed: false, refused: false };
    s.drag = drag;
    // A finger cannot hover, so it rubs her where it is: it stays on her until it leaves her (pip/play.ts, `fingerLifts`).
    const finger = event.pointerType === "touch";
    // Her frame on screen as the press began, for which part of her a finger is on, and how wide a rub is.
    const frame = button.getBoundingClientRect();
    let stroke: Stroke | null = null;
    // The press is hers until it ends, wherever the pointer goes (off the room, off the window).
    try {
      button.setPointerCapture(id);
    } catch {
      // No such pointer (a press made in a test): the window's listeners below still hear it.
    }

    const follow = (e: { clientX: number; clientY: number }) => {
      const hand = pointerAt(e);
      if (!hand || drag.refused) return;
      if (!drag.moved) {
        if (inHuff() && s.phase !== "fall" && s.phase !== "sleep" && s.phase !== "tuck" && !drag.cuddling) {
          // In a huff she will not be picked up: a shoulder turned to the hand, and that is that. (The press still ends cleanly.)
          drag.refused = true;
          rebuff();
          face(hand.x < s.x ? 1 : -1);
          return;
        }
        // Lifted out of her sleep: nobody likes that either.
        if (s.phase === "sleep" && !s.abed && !s.hiding) vex("woken");
        drag.moved = true;
        drag.cuddling = false;
        pickUp(hand);
      }
      // Where the hand has been lately: how fast it goes swings her, and throws her.
      const sample = { x: hand.x, y: hand.y, at: nowMs() };
      s.hold = holdMove(s.hold, s.hand[s.hand.length - 1], sample);
      s.hand.push(sample);
      if (s.hand.length > 8) s.hand.shift();
      s.handAt = hand;
      if (s.phase !== "held") return;
      // Round and round: a couple of times and she says so, and is giddy when she is let go.
      if (s.whirl) {
        s.whirl = whirlMove(s.whirl, hand.x, hand.y, sample.at);
        if (!s.whirlTold && whirled(s.whirl, sample.at)) {
          s.whirlTold = true;
          say("wheee!");
          playSound("whee", { pitch: 1.3, volume: 0.7 });
        }
      }
      carry();
      place();
    };
    /** A finger moving on her, not yet off her: side to side it is a rub (a stroke, a tickle, a sneeze on her leaf). */
    const rub = (e: PointerEvent) => {
      // Still where it went down: that may yet be a cuddle, or a tap.
      if (!stroke && drag.far < DRAG_SLOP) return;
      const next = strokeMove(stroke ?? strokeStart(drag.startX), e.clientX, nowMs(), frame.width, zoneOf(e.clientY, frame.top, frame.height));
      stroke = next.stroke;
      const what = rubOf(next.touch, next.zone);
      if (what === "none") return;
      drag.rubbed = true;
      drag.cuddling = false;
      rubPip(what);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!drag.moved) {
        const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        drag.far = Math.max(drag.far, far);
        if (finger) {
          if (!fingerLifts({ x: drag.startX, y: drag.startY }, { x: e.clientX, y: e.clientY }, frame.width, drag.rubbed || drag.cuddling)) {
            rub(e);
            return;
          }
        } else if (far < (drag.cuddling ? CUDDLE_SLOP : DRAG_SLOP)) {
          return;
        }
      }
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
      // A cuddle ends as the hand lifts (the loop sees to it); a finger's rub ends as a stroke does. Neither is a poke.
      else if (drag.cuddling || drag.rubbed || drag.refused) return;
      else if (how === "up") tapPip();
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
    // What the hand does by holding, whirling and rubbing has a letter each, so none of it needs a pointer.
    // (Two quick presses of Enter are a high five already, as two quick taps are; H is the same in one.)
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !outRef.current) {
      const letter = event.key.toLowerCase();
      const play = letter === "c" ? () => touchPip("cuddle", CUDDLE_KEY_MS) : letter === "h" ? highFivePip : letter === "s" ? spinPip : letter === "l" ? sneezePip : null;
      if (play) {
        event.preventDefault();
        play();
        return;
      }
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const s = st.current;
    if (s.phase === "held" || s.phase === "fall") return;
    if (inHuff()) {
      // In a huff she is not to be walked about either.
      rebuff();
      return;
    }
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
    // In a huff, or in the middle of a tantrum, the room can do what it likes: she is not looking.
    if (inHuff() || s.plan?.activity.id === "tantrum") return;
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
    // Put to bed kindly: she takes it as that.
    please("bed");
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
    if (!freeForFridge() || s.errand?.fridge || inHuff()) return;
    const at = fridgeStand(fridge.box, live.current.level.w);
    // What she will find, where that is known: nothing (she droops, a couple of times a day, and after that only
    // looks), food where there was none (a cheer), or food as usual (and she hopes some of it is for her).
    const larder = larderNow(worldNow());
    const hope: Reaction = !larder
      ? fridgeHope(Math.random)
      : larder.bare
        ? larder.resigned
          ? { move: "shift", loops: 1, line: stillBareLine(Math.random) }
          : { move: "mope", loops: 1, line: bareFridgeLine(Math.random) }
        : larder.wasBare
          ? { move: "cheer", loops: 2, line: foodAgainLine(Math.random) }
          : fridgeHope(Math.random);
    const found = !larder ? undefined : larder.bare ? (larder.resigned ? undefined : ("bare" as const)) : ("food" as const);
    s.touch = null;
    startErrand({ kind: "hope", x: at.x, face: at.face, move: hope.move, loops: hope.loops, line: hope.line, after: 0, fridge: fridge.key, found }, prefersReducedMotion());
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
      if (inHuff() || s.plan?.activity.id === "tantrum") {
        rebuff();
        return;
      }
      const reduced = prefersReducedMotion();
      s.errand = null;
      s.touch = null;
      dropPlan();
      s.fidgets = 0;
      s.plan = { activity: activityAt(what, spot, outlook(nowMs(), reduced), Math.random), index: -1 };
      say(what === "read" ? pickOne(["ooh, that one.", "a chapter? yes.", "good choice."]) : pickOne(["let's see what's out there.", "coming to look."]));
      nextStep();
    },
    visit: (itemId, spot, key) => {
      // A thing that answers a tap (pip/furnish.ts, `VISITS`): she comes over and does what one does with it, as she
      // comes to a window. For show, like the fridge: nothing here is told to the page, so no mood and no seeds.
      const s = st.current;
      const visit = visitOf(itemId);
      if (!visit || outRef.current || live.current.decorating || !TOUCHABLE.has(s.phase) || s.phase === "sleep" || s.phase === "tuck") return;
      // In a huff, or mid-tantrum, she is not to be called over to anything.
      if (inHuff() || s.plan?.activity.id === "tantrum") {
        rebuff();
        return;
      }
      const reduced = prefersReducedMotion();
      const lv = live.current.level;
      s.errand = null;
      s.touch = null;
      dropPlan();
      s.fidgets = 0;
      // Beside it, turned to it; or in front of it, or under it (a thing on a wall, a shelf or the ceiling); or where she is.
      const under = spot.up || visit.stand === "at";
      const at = visit.stand === "stay" ? null : standAt({ ...spot, up: under }, s.x, lv.w);
      const way: Step[] = !at || reduced ? [] : under ? [{ kind: "walk", x: at.x }] : [{ kind: "walk", x: at.x }, { kind: "face", dir: at.face }];
      // It answered the tap; with some way to come, it answers again as she gets there (the record is still playing).
      const again: Step[] = at && !reduced && Math.abs(at.x - s.x) > 24 ? [{ kind: "use", id: key, what: "thing", verb: "answer" }] : [];
      s.bounceSay = null;
      const beats = visitBeats(visit, live.current.repertoire.dances, Math.random).flatMap((beat): Step[] => {
        if (beat.bounces) {
          // A trampoline's bounces are thrown, not played. Without motion nothing is thrown: she is on it, knees bent, and says so.
          if (reduced) return [{ kind: "do", move: "land", seconds: 1.5, line: beat.line }];
          s.bounceSay = beat.line ?? null;
          return [{ kind: "use", id: key, what: "thing", verb: `bounce:${beat.bounces}` }];
        }
        return [...(beat.sound ? [{ kind: "use", id: key, what: "thing", verb: `sound:${beat.sound}` } as Step] : []), { kind: "do", move: beat.move, seconds: beat.seconds, line: beat.line }];
      });
      let activity: Activity = { id: "potter", label: visit.label, steps: [...way, ...again, ...beats] };
      // Not through a visitor: she does it from where she stands (all but bouncing, which wants the trampoline under her).
      if (way.length > 0 && crossesVisitor(activity, outlook(nowMs(), reduced))) {
        activity = { ...activity, steps: beats.filter((step) => !(step.kind === "use" && step.what === "thing" && step.verb.startsWith("bounce:"))) };
      }
      // Where she stands (the cuckoo, or no walking): turned to it, at least.
      if (activity.steps[0]?.kind !== "walk" && Math.abs(spot.x - s.x) > 6) face(spot.x < s.x ? -1 : 1);
      s.plan = { activity, index: -1 };
      nextStep();
    },
    wake: () => !outRef.current && wake("morning! is that the sun?"),
    vex: (what) => vex(what),
    clock: nowMs,
    redraw: () => redraw.current?.(),
    light: (x, y) => (roomLights.current.glows ? lightOn(roomLights.current.glows, x, y) : [0, 0, 0, 0])
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
  // The ball's button: a little more than the ball, and never less than a finger; and where its picture (a whole
  // 32-pixel frame, the ball in its middle) sits in it, on a whole device pixel.
  const ballGrab = Math.max(BALL_BOX * scale, GRAB_MIN);
  const ballInset = Math.round(((ballGrab - pipSize) / 2) * ratio) / ratio;
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
          // And for her throws to come down at (a ball in the air takes her eyes, not her aim).
          st.current.reader = { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
        }}
        onPointerLeave={() => {
          st.current.pointer = null;
          st.current.reader = null;
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

        {/* The light on Pip and on her ball by night: a colour filter each, set by `lightThings`. (With room round it: what she holds up is hers too.) */}
        <svg className="pip-house-lit" width="0" height="0" aria-hidden="true" focusable="false">
          <filter id={`${litId}-pip`} x="-60%" y="-120%" width="220%" height="260%" colorInterpolationFilters="sRGB">
            <feColorMatrix ref={pipLitRef} type="matrix" values={LIT_BY_DAY} />
          </filter>
          <filter id={`${litId}-ball`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            <feColorMatrix ref={ballLitRef} type="matrix" values={LIT_BY_DAY} />
          </filter>
        </svg>
        {!hidePip && !out && (
          <div ref={pipRef} className="pip-house-pip" style={{ width: pipSize, height: pipSize }}>
            <div ref={spinRef} className="pip-house-pip-spin">
              <div ref={turnRef} className="pip-house-pip-turn">
              <button
                ref={pipButtonRef}
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
                  if (event.detail === 0) tapPip();
                }}
                onKeyDown={onKeyDown}
                // A finger held still on her is a cuddle, not the long press that asks a touch screen for a menu.
                onContextMenu={(event) => {
                  if (st.current.drag) event.preventDefault();
                }}
                title="Poke me, hold me, stroke me, or pick me up by my leaf"
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

        {/* The ball: thrown by hand or from the Play keys, caught and thrown back by Pip. Placed by the loop, with its
            shadow on the floor and the rally's count beside it. Its button is a finger wide however small the ball. */}
        {ballOut && !hidePip && !out && (
          <>
            <span ref={ballShadowRef} className="pip-house-ball-shadow" style={{ height: scale, ["--px" as string]: `${scale}px` }} aria-hidden="true" />
            <button
              ref={ballRef}
              type="button"
              className="pip-house-ball"
              style={{ width: ballGrab, height: ballGrab }}
              onPointerDown={onBallDown}
              onClick={(event) => {
                // Pointer presses are handled as they end; this is the keyboard.
                if (event.detail === 0) tapBall();
              }}
              // A finger held on it is holding the ball, not asking a touch screen for a menu.
              onContextMenu={(event) => {
                if (st.current.ball?.state === "held") event.preventDefault();
              }}
              aria-label={`The ball.${rallyShown ? ` A rally of ${rallyShown}.` : ""} Select to toss it to Pip, or drag and let go to throw it.`}
              title="Catch it, throw it"
            >
              <canvas
                ref={ballArtRef}
                width={32}
                height={32}
                className="pip-sprite"
                style={{ left: ballInset, top: ballInset, width: pipSize, height: pipSize }}
                aria-hidden="true"
              />
            </button>
            <canvas ref={tallyRef} width={32} height={32} className="pip-sprite pip-house-tally" style={{ width: pipSize, height: pipSize }} aria-hidden="true" />
          </>
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
