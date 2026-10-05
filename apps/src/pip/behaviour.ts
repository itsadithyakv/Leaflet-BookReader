/**
 * What Pip does with herself in the house, decided here and drawn elsewhere.
 *
 * She used to fill each free moment with one move picked at random, for two
 * loops: reading for a few seconds and stopping, with nothing leading in or
 * out. Now a free moment starts an *activity*: a short plan with a beginning
 * (go there, turn to it), a middle that lasts a believable while, and an end
 * (a yawn, the book put back). Which one is a weighted pick from her mood, the
 * time of day, what is in the room, what she owns and what the reader has just
 * done, and never the one she has only just finished.
 *
 * Everything here is a pure function of the state it is given and a random
 * source, so the same seed always gives the same day (behaviour.test.ts). The
 * house scene (components/pip/HouseScene.tsx) walks the plan.
 */
import type { GenreMood } from "./genre";
import type { PipCold } from "../services/habitService";

/** A random source: numbers in [0, 1). */
export type Rand = () => number;

/** A repeatable random source (mulberry32), for tests and anything that must agree with itself. */
export const seeded = (seed: number): Rand => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Something in the room Pip can go to. */
export type SpotKind =
  /** Books to take one from: a stack, a shelf, a desk. */
  | "books"
  /** Somewhere soft to read or nap: an armchair, a beanbag, the rug. */
  | "seat"
  | "window"
  /** A houseplant to water. */
  | "plant"
  /** A record player, a jukebox, a piano. */
  | "music"
  /** An arcade machine. */
  | "cabinet"
  /** A garden plot with something growing in it. */
  | "plot"
  /** The bed, to nap in. */
  | "bed"
  /** A picture hanging crooked, to be put straight. */
  | "crooked"
  /** The fridge, to look in. */
  | "fridge"
  /** Anything else in the room that offers her something to do with it (see `Offer`). */
  | "thing";

/**
 * What a thing in the room offers Pip to do with it, of her own accord: the
 * calendar to look at, the radio's dial to turn. The room says it (the
 * furnishings' `spots()`); the planner only goes there and does it, so a new
 * thing needs nothing here.
 */
export type Offer = {
  /** In plain words, for the label read out to a screen reader: "looking at the calendar". */
  label: string;
  move: string;
  seconds: number;
  /** One is said as she starts. */
  lines?: readonly string[];
  /** How much she feels like it, beside the other things on offer (1 if not given). */
  weight?: number;
  /** What the thing is told as she starts (the furnishings' `pipUse`), so it can answer: the dial turns. */
  use?: string;
};

export type Spot = {
  kind: SpotKind;
  /** Its middle, in floor pixels. */
  x: number;
  /** How wide it is, so she stands beside it and not in it. */
  w: number;
  /** Up on the wall or a shelf: she stands under it and looks up. */
  up?: boolean;
  id?: string;
  /** Something she can do with it in a free moment. */
  offer?: Offer;
};

/**
 * What Pip knows of the world outside the room: the reader's books, and
 * whatever else colours her day. A bag that only grows; every field may be
 * missing, and a planner given none of it behaves as it always did.
 * (pages/pip/usePipWorld.ts gathers it; pip/readingMoments.ts works out the
 * books' part.)
 */
export type World = {
  /** The book last opened: the mood its genres put her in, and how long ago it was read, in minutes. */
  book?: { title: string; mood: GenreMood | null; readAgoMin: number | null } | null;
  /** A book finished within the last day. */
  hangover?: { title: string } | null;
  /** A book begun and not opened for a fortnight: the one most recently put down. */
  dusty?: { title: string; days: number } | null;
  /** She has a cold (a streak ended): how far the reader's reading has nursed her back. Null or missing: she is well. */
  cold?: Cold | null;
  /** A visitor is in the room: the box they stand in (left edge and width), in floor pixels, and who they are. */
  visitor?: { x: number; w: number; handle?: string } | null;
  /** She is out (an expedition): not in the house at all, a note left where she sleeps. The planner is not asked anything while she is. */
  away?: { note?: string } | null;
  /** She is back with something to show, not yet shown: the scene has her come in holding it up. */
  back?: { key: string; name: string; image?: ImageData; line?: string } | null;
};

/**
 * A cold, as the habit snapshot gives it (worked out in Rust from the ledger:
 * a streak of three days or more ended; meeting today's goal cures it). All
 * that matters here is `cure`: 0 with nothing read today, towards 1 as the
 * day's reading nears the goal, at which she has no cold at all.
 */
export type Cold = PipCold;
/** How a cold shows: at its worst, on the mend, nearly gone. */
export type ColdStage = "bad" | "mending" | "nearly";

export type ActivityId =
  | "read"
  | "nap"
  | "window"
  | "water"
  | "tend"
  | "toy"
  | "dance"
  | "exercise"
  | "arcade"
  | "sunbathe"
  | "stroll"
  /** Putting right something the reader left askew. */
  | "tidy"
  /** A look in the fridge: the midnight snack after dark, a peckish visit by day. */
  | "fridge"
  /** Late: in bed (or sitting) with her phone, until she falls asleep over it. */
  | "scroll"
  /** By day: a quick look at the phone, and away it goes. */
  | "phone"
  /** A horror on the go: under the quilt and a look beneath the bed at night, a glance over her shoulder by day. */
  | "spooked"
  /** A mystery: out comes the magnifying glass, and something is followed along the floor. */
  | "sleuth"
  /** A fantasy: a cape, a wooden sword, a quest across the room. */
  | "quest"
  /** Science fiction: a look at the sky, in case. */
  | "starwatch"
  /** A romance: a sigh. */
  | "swoon"
  /** A book finished today: flat on the floor, the closed book on her chest. */
  | "hangover"
  /** A book left a fortnight: dusted off, wistfully. */
  | "dust"
  /** Using a thing in the room that offers something (`Offer`). */
  | "potter"
  /** A visitor is here: reading beside them. */
  | "company"
  /** She has a cold: tissues, tea under a blanket, a sneeze. */
  | "nurse";

/** One stretch of an evening on the phone: what she does, for how long, and what she says as it starts. */
export type ScrollBeat = {
  /** `scroll`: thumb going, eyes down the feed; `drop`: the phone lands on her nose; `doze`: asleep, the screen going out; `innocent`: phone hidden, the reader is looking. */
  beat: "scroll" | "laugh" | "frown" | "yawn" | "drop" | "doze" | "innocent";
  seconds: number;
  line?: string;
};

export type Step =
  /**
   * Walk there (she faces the way she goes); on tiptoe, slowly, when she would
   * rather not be heard. `as`: the move she walks with, when it is not her
   * stroll (bent over a trail, marching with a sword), at a `slow` pace if so
   * said. Without motion she is simply there.
   */
  | { kind: "walk"; x: number; pace?: "tiptoe" | "slow"; as?: string }
  /** Turn to face left (-1) or right (1). */
  | { kind: "face"; dir: 1 | -1 }
  /** Play a move for about this long (the scene rounds it to whole loops), saying `line` as it starts. */
  | { kind: "do"; move: string; seconds: number; line?: string }
  /** Stand a moment. */
  | { kind: "pause"; seconds: number }
  /**
   * Use a thing in the room (the scene knows how): set a picture straight,
   * get into bed and sleep about this long before going on, open the fridge
   * (she holds it open) or shut it, get into bed with the phone (which ends
   * in sleep, and ends the activity), or go back to the bed she got out of;
   * get into bed and hide under the quilt about this long (`hide`); or tell a
   * thing she is using it (`thing`, with the thing's own word for it).
   */
  | { kind: "use"; id: string; what: "straighten" | "open" | "shut" | "bed" }
  | { kind: "use"; id: string; what: "sleep" | "hide"; seconds: number }
  | { kind: "use"; id: string; what: "thing"; verb: string }
  | { kind: "use"; id: string; what: "scroll"; beats: ScrollBeat[] };

export type Activity = {
  id: ActivityId;
  /** In plain words, for the label read out to a screen reader. */
  label: string;
  steps: Step[];
};

/** What the reader did a moment ago, which colours what Pip feels like doing. */
export type JustNow = {
  /** Gave her a snack. */
  fed?: boolean;
  /** Played with her: petted, tickled, threw the ball. */
  played?: boolean;
  /** Came out of an arcade game. */
  gamed?: boolean;
};

export type BehaviourState = {
  /** 0..100. */
  mood: number;
  /** The reader's local hour, 0..23. */
  hour: number;
  floor: { w: number; garden: boolean; arcade: boolean };
  /** Where she stands, in floor pixels. */
  x: number;
  spots: readonly Spot[];
  /** The toys she owns, as their moves (treats.js: "treat-ball"...). */
  toys: readonly string[];
  /** Dance moves she owns (bought in the shop). */
  dances: readonly string[];
  /** Her signature move, and the hobbies every Pip has plus any moves bought. */
  signature: string;
  hobbies: readonly string[];
  /** What she did last, newest first. */
  recent: readonly ActivityId[];
  justNow?: JustNow;
  /** The reader asked for less motion: nothing that walks or bounces. */
  reduced?: boolean;
  /** What she knows of the reader's books and the rest of the world, if anything. */
  world?: World;
};

/** Below this she is glum, and keeps to quiet things (pages/pip/common.ts keeps the same number). */
export const GLUM = 20;
/** How near the walls she walks, in floor pixels. */
const MARGIN = 18;

const between = (rand: Rand, low: number, high: number) => low + rand() * (high - low);
const pick = <T,>(rand: Rand, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
const clampX = (x: number, w: number) => Math.max(MARGIN, Math.min(w - MARGIN, Math.round(x)));

const nearest = (state: BehaviourState, kind: SpotKind): Spot | null => {
  const found = state.spots.filter((spot) => spot.kind === kind);
  if (found.length === 0) return null;
  return found.reduce((best, spot) => (Math.abs(spot.x - state.x) < Math.abs(best.x - state.x) ? spot : best));
};

/**
 * Where to stand for a spot, and which way to face there: under a thing on
 * the wall (facing as she came), or beside a thing on the floor, on the side
 * she is already on, turned towards it.
 */
export const standAt = (spot: Spot, fromX: number, floorW: number): { x: number; face: 1 | -1 } => {
  if (spot.up) return { x: clampX(spot.x, floorW), face: spot.x >= fromX ? 1 : -1 };
  const reach = spot.w / 2 + 11;
  const left = spot.x - reach;
  const right = spot.x + reach;
  let fromLeft = Math.abs(left - fromX) <= Math.abs(right - fromX);
  // Not into a wall: stand on the side there is room for.
  if (left < MARGIN) fromLeft = false;
  else if (right > floorW - MARGIN) fromLeft = true;
  return fromLeft ? { x: clampX(left, floorW), face: 1 } : { x: clampX(right, floorW), face: -1 };
};

/** Where she stands at the fridge: at its handle, on the left (its door swings out to the right), turned to it; the other side by a wall. */
const atFridge = (spot: Spot, floorW: number): { x: number; face: 1 | -1 } => {
  const left = Math.round(spot.x - spot.w / 2 - 10);
  return left >= MARGIN ? { x: left, face: 1 } : { x: clampX(spot.x + spot.w / 2 + 15, floorW), face: -1 };
};

const go = (state: BehaviourState, spot: Spot | null): Step[] => {
  if (!spot || state.reduced) return [];
  const at = standAt(spot, state.x, state.floor.w);
  // Under a thing on the wall she keeps facing the way she came; beside a thing, she turns to it.
  return spot.up ? [{ kind: "walk", x: at.x }] : [{ kind: "walk", x: at.x }, { kind: "face", dir: at.face }];
};

const morning = (hour: number) => hour >= 6 && hour < 11;
const evening = (hour: number) => hour >= 18 && hour < 22;
const night = (hour: number) => hour >= 22 || hour < 5;
/** After dark, as the house keeps it (pip/furnish.ts, `dark`): the room dim, the lamps lit. */
export const afterDark = (hour: number) => hour >= 19 || hour < 6;
/** Late: the hours she takes the phone to bed. Never by day. */
export const late = (hour: number) => hour >= 21 || hour < 5;
const goldenHour = (hour: number) => (hour >= 5 && hour < 7) || (hour >= 17 && hour < 20);

/**
 * How much Pip feels like each thing right now. Zero means "not now" (nothing
 * to do it with, the wrong floor, too glum, or she has only just done it).
 * Exported for the tests, which hold the rules to their word.
 */
export const weights = (state: BehaviourState): Record<ActivityId, number> => {
  const { mood, hour, floor, justNow = {} } = state;
  const has = (kind: SpotKind) => state.spots.some((spot) => spot.kind === kind);
  const glum = mood < GLUM;
  const low = mood < 40;
  const bright = mood >= 60;
  const stage = coldStage(state.world?.cold);

  const w: Record<ActivityId, number> = {
    // Reading is who she is: always possible, more so in the evening.
    read: 3 * (evening(hour) ? 1.7 : 1) * (low ? 0.6 : 1) * (justNow.gamed ? 2 : 1),
    nap: 1 * ((hour >= 13 && hour < 15) || hour >= 21 ? 3 : 1) * (low ? 2 : 1) * (justNow.fed ? 2 : 1),
    window: has("window") ? 2 * (goldenHour(hour) ? 2 : night(hour) ? 1.5 : 1) * (glum ? 2 : 1) : 0,
    water: has("plant") ? 2 * (morning(hour) ? 2 : 1) : 0,
    tend: has("plot") ? 2.5 : 0,
    toy: state.toys.length > 0 ? 3 * (bright ? 2 : 1) * (justNow.fed ? 0.5 : 1) * (justNow.played ? 1.5 : 1) : 0,
    // Everyone can bop; a dance she owns, or music in the room, makes it likelier.
    dance: (state.dances.length > 0 || has("music") ? 2 : 0.8) * (mood >= 70 ? 2 : 1) * (justNow.played ? 1.5 : 1),
    exercise: 2 * (morning(hour) ? 1.5 : 1),
    arcade: has("cabinet") ? (justNow.gamed ? 0 : 4) : 0,
    sunbathe: floor.garden && hour >= 9 && hour < 17 ? 2 : 0,
    stroll: 1.5,
    // A crooked picture bothers her until it is straight.
    tidy: has("crooked") ? 5 : 0,
    // The fridge: a habit after dark, a passing thought by day; hardly at all on a full stomach.
    fridge: has("fridge") ? (afterDark(hour) ? 2.5 : 0.5) * (justNow.fed ? 0.2 : 1) : 0,
    // The phone: taken to bed late, and only glanced at by day.
    scroll: late(hour) ? 3 : 0,
    phone: late(hour) ? 0 : 0.5,
    // The book on the go gets into her head: now and then, and more so just after it was read.
    spooked: bookPull(state, "horror"),
    sleuth: bookPull(state, "mystery"),
    quest: bookPull(state, "fantasy"),
    starwatch: bookPull(state, "scifi") * 0.8,
    swoon: bookPull(state, "romance") * 0.8,
    // A book just finished, and a book left too long: now and then.
    hangover: state.world?.hangover ? 2.5 : 0,
    dust: state.world?.dusty ? 1.2 : 0,
    // Whatever the room's things offer, a little each; never more than a book.
    potter: Math.min(3, offers(state).reduce((sum, spot) => sum + (spot.offer?.weight ?? 1), 0)),
    // Company: with a visitor in the room she mostly reads beside them.
    company: state.world?.visitor ? 4 : 0,
    // A cold is looked after, the more the worse it is.
    nurse: stage === "bad" ? 5 : stage === "mending" ? 3.5 : stage === "nearly" ? 1.5 : 0
  };

  // With a cold she keeps to her blanket: nothing that bounces, more sleep, and less of everything else the worse it is.
  if (stage) {
    w.dance = 0;
    w.exercise = 0;
    w.toy = 0;
    w.arcade = 0;
    w.sunbathe = 0;
    w.quest = 0;
    w.nap *= stage === "bad" ? 3 : stage === "mending" ? 2 : 1.3;
    const less = stage === "bad" ? 0.3 : stage === "mending" ? 0.5 : 0.8;
    for (const id of ["stroll", "water", "tend", "tidy", "fridge", "phone", "sleuth", "spooked", "starwatch", "potter"] as const) w[id] *= less;
  }

  // Glum, she keeps to quiet things: no dancing, no games.
  if (glum) {
    w.toy = 0;
    w.dance = 0;
    w.exercise = 0;
    w.arcade = 0;
    w.sunbathe = 0;
    w.quest = 0;
  } else if (low) {
    w.dance *= 0.4;
    w.exercise *= 0.6;
  }
  // Without motion she does only what can be done standing still.
  if (state.reduced) {
    w.dance = 0;
    w.exercise = 0;
    w.toy = 0;
    w.stroll = 0;
    w.water = 0;
    w.tend = 0;
    w.arcade = 0;
  }
  // Never the same thing twice running, and seldom the one before that.
  const [last, before] = state.recent;
  if (last) w[last] = 0;
  if (before && before !== last) w[before] *= 0.4;
  return w;
};

const weightedPick = (rand: Rand, w: Record<ActivityId, number>): ActivityId => {
  const entries = (Object.entries(w) as Array<[ActivityId, number]>).filter(([, weight]) => weight > 0);
  // Everything ruled out (it cannot be, reading is always possible unless it was last): read on.
  if (entries.length === 0) return "read";
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let at = rand() * total;
  for (const [id, weight] of entries) {
    at -= weight;
    if (at < 0) return id;
  }
  return entries[entries.length - 1][0];
};

/** The things on this floor that offer her something to do. */
const offers = (state: BehaviourState) => state.spots.filter((spot) => spot.offer);

/** How long a book stays in her head, in minutes: strongest in the hour and a half after it was read, gone after a week. */
export const FRESH_READ_MIN = 90;
export const STALE_READ_MIN = 7 * 24 * 60;

/** How much the book last opened pulls her towards its mood's activity: nothing for another mood, or a book long shut. */
const bookPull = (state: BehaviourState, mood: GenreMood) => {
  const book = state.world?.book;
  if (!book || book.mood !== mood || book.readAgoMin === null || book.readAgoMin > STALE_READ_MIN) return 0;
  return book.readAgoMin <= FRESH_READ_MIN ? 2 : book.readAgoMin <= 24 * 60 ? 1.2 : 0.6;
};

/** The steps of one activity, start to finish. */
const build = (id: ActivityId, state: BehaviourState, rand: Rand): Activity => {
  const { floor } = state;
  switch (id) {
    case "read": {
      // To the books, one taken down; then somewhere soft to read it, a good
      // long while; a yawn; and the book goes back.
      const books = nearest(state, "books");
      const seat = nearest(state, "seat");
      const fetchBook: Step[] = books ? [...go(state, books), { kind: "do", move: books.up ? "pointup" : "point", seconds: 1.3 }] : [];
      const settle: Step[] = seat ? go(state, seat) : [];
      const back: Step[] = books && !state.reduced ? [...go({ ...state, x: seat ? standAt(seat, state.x, floor.w).x : state.x }, books), { kind: "do", move: books.up ? "pointup" : "point", seconds: 1.3 }] : [];
      // Now and then the phone comes out a few pages in. She catches herself, and the book wins.
      const drift = rand() < DRIFT_CHANCE;
      const reading: Step[] = drift
        ? [
            { kind: "do", move: "read", seconds: between(rand, 8, 12) },
            { kind: "do", move: "phone", seconds: 4 },
            { kind: "do", move: "shift", seconds: 2, line: pick(rand, BOOK_WINS_LINES) },
            { kind: "do", move: "read", seconds: between(rand, 12, 20) }
          ]
        : [{ kind: "do", move: "read", seconds: between(rand, 20, 40) }];
      return {
        id,
        label: "reading",
        steps: [...fetchBook, ...settle, ...reading, { kind: "do", move: rand() < 0.5 ? "yawn" : "bookmark", seconds: 3.5 }, ...back]
      };
    }
    case "nap": {
      // In her bed if it is out (under the covers, the same sleep the reader can put her to), else somewhere soft.
      const bed = nearest(state, "bed");
      const seat = nearest(state, "seat");
      const sleep: Step[] = bed
        ? [...go(state, bed), { kind: "use", id: bed.id ?? "bed", what: "sleep", seconds: between(rand, 16, 28) }]
        : [...go(state, seat), { kind: "do", move: "sleep", seconds: between(rand, 16, 28) }];
      return {
        id,
        label: "having a nap",
        steps: [{ kind: "do", move: "yawn", seconds: 4 }, ...sleep, { kind: "do", move: "stretch", seconds: 3.3 }]
      };
    }
    case "tidy": {
      const picture = nearest(state, "crooked");
      return {
        id,
        label: "straightening a picture",
        steps: picture
          ? [...go(state, picture), { kind: "do", move: "pointup", seconds: 1.4 }, { kind: "use", id: picture.id ?? "", what: "straighten" }, { kind: "do", move: "kudos", seconds: 2 }]
          : [{ kind: "do", move: "look", seconds: 5 }]
      };
    }
    case "window": {
      const window = nearest(state, "window");
      return {
        id,
        label: floor.garden ? "watching the sky" : "looking out of the window",
        steps: [...go(state, window ? { ...window, up: true } : null), { kind: "do", move: "gaze", seconds: between(rand, 12, 20) }, { kind: "do", move: "look", seconds: 5 }]
      };
    }
    case "water": {
      const plant = nearest(state, "plant");
      return {
        id,
        label: "watering a plant",
        steps: [...go(state, plant), { kind: "do", move: "water", seconds: between(rand, 8, 12) }, { kind: "do", move: "cheer", seconds: 2 }]
      };
    }
    case "tend": {
      // Reading is what waters the garden; Pip only keeps an eye on it.
      const plots = state.spots.filter((spot) => spot.kind === "plot");
      const plot = plots.length > 0 ? pick(rand, plots) : null;
      return {
        id,
        label: "checking on the garden",
        steps: [...go(state, plot), { kind: "do", move: "tap", seconds: 4 }, { kind: "do", move: "look", seconds: 5 }]
      };
    }
    case "toy": {
      const toy = pick(rand, state.toys);
      const middle = clampX(floor.w * between(rand, 0.35, 0.65), floor.w);
      return {
        id,
        label: "playing",
        steps: [...(state.reduced ? [] : [{ kind: "walk", x: middle } as Step]), { kind: "do", move: toy, seconds: between(rand, 8, 14) }, { kind: "do", move: "cheer", seconds: 2 }]
      };
    }
    case "dance": {
      const music = nearest(state, "music");
      const dance = state.dances.length > 0 ? pick(rand, state.dances) : "bop";
      return {
        id,
        label: "dancing",
        steps: [...go(state, music), { kind: "do", move: "bop", seconds: 3 }, { kind: "do", move: dance, seconds: between(rand, 9, 15) }, { kind: "do", move: "cheer", seconds: 2 }]
      };
    }
    case "exercise": {
      // Her signature move twice as often as any other hobby.
      const hobby = rand() < 0.4 ? state.signature : pick(rand, state.hobbies.length > 0 ? state.hobbies : [state.signature]);
      return {
        id,
        label: "keeping busy",
        steps: [{ kind: "do", move: "stretch", seconds: 3.3 }, { kind: "do", move: hobby, seconds: between(rand, 8, 14) }, { kind: "do", move: "hydrate", seconds: 4 }]
      };
    }
    case "arcade": {
      const cabinets = state.spots.filter((spot) => spot.kind === "cabinet");
      const cabinet = cabinets.length > 0 ? pick(rand, cabinets) : null;
      return {
        id,
        label: "playing a game",
        // A win or a loss, as it goes.
        steps: [...go(state, cabinet), { kind: "do", move: "gamer", seconds: between(rand, 12, 22) }, { kind: "do", move: rand() < 0.6 ? "cheer" : "steamed", seconds: 2 }]
      };
    }
    case "fridge":
      return fridgeVisit(state, rand, false);
    case "scroll": {
      // To bed with the phone when there is one; else where she is, on her feet, until she nods off.
      const bed = nearest(state, "bed");
      const beats = scrollSession(state.hour, rand, state.reduced);
      if (bed) return { id, label: "in bed with her phone", steps: [...reach(state, standAt(bed, state.x, floor.w)), { kind: "use", id: bed.id ?? "bed", what: "scroll", beats }] };
      return {
        id,
        label: "on her phone",
        steps: [
          ...beats.map((beat): Step => (beat.beat === "doze" ? { kind: "do", move: "phone-doze", seconds: beat.seconds } : { kind: "do", move: beat.beat === "scroll" ? "phone" : `phone-${beat.beat}`, seconds: beat.seconds, line: beat.line })),
          { kind: "do", move: "sleep", seconds: between(rand, 10, 16) },
          { kind: "do", move: "stretch", seconds: 3.3 }
        ]
      };
    }
    case "phone":
      return {
        id,
        label: "checking her phone",
        steps: [
          { kind: "do", move: "phone", seconds: rand() < 0.5 ? 4 : 8, line: rand() < 0.6 ? pick(rand, PHONE_LINES) : undefined },
          { kind: "do", move: "shift", seconds: 2 }
        ]
      };
    case "spooked":
      return spooked(state, rand);
    case "sleuth":
      return sleuth(state, rand);
    case "quest":
      return quest(state, rand);
    case "starwatch": {
      const window = nearest(state, "window");
      return {
        id,
        label: "watching the sky for visitors",
        steps: [...go(state, window ? { ...window, up: true } : null), { kind: "do", move: "gaze", seconds: between(rand, 8, 12), line: pick(rand, STAR_LINES) }, { kind: "do", move: "look", seconds: 5 }]
      };
    }
    case "swoon":
      return { id, label: "sighing over her book", steps: [{ kind: "do", move: "smitten", seconds: 4, line: pick(rand, SWOON_LINES) }, { kind: "do", move: "shift", seconds: 2 }] };
    case "hangover":
      return hangover(state, rand);
    case "dust":
      return dusting(state, rand);
    case "potter": {
      const on = offers(state);
      // By weight: a thing that offers more is gone to more.
      let at = rand() * on.reduce((sum, spot) => sum + (spot.offer?.weight ?? 1), 0);
      const spot = on.find((entry) => (at -= entry.offer?.weight ?? 1) < 0) ?? on[on.length - 1];
      const offer = spot?.offer;
      if (!spot || !offer) return { id, label: "having a look round", steps: [{ kind: "do", move: "look", seconds: 5 }] };
      return {
        id,
        label: offer.label,
        steps: [
          ...go(state, spot),
          ...(offer.use ? [{ kind: "use", id: spot.id ?? "", what: "thing", verb: offer.use } as Step] : []),
          { kind: "do", move: offer.move, seconds: offer.seconds, line: offer.lines && offer.lines.length > 0 ? pick(rand, offer.lines) : undefined }
        ]
      };
    }
    case "company":
      return company(state, rand);
    case "nurse":
      return nurse(state, rand);
    case "sunbathe":
      return {
        id,
        label: "sunbathing",
        steps: [{ kind: "walk", x: clampX(floor.w * between(rand, 0.3, 0.7), floor.w) }, { kind: "do", move: "sunbathe", seconds: between(rand, 12, 18) }, { kind: "do", move: "stretch", seconds: 3.3 }]
      };
    case "stroll":
    default: {
      // Somewhere else: the far side of the room rather than a step away.
      let x = MARGIN + rand() * (floor.w - MARGIN * 2);
      if (Math.abs(x - state.x) < 30) x = state.x < floor.w / 2 ? state.x + 50 : state.x - 50;
      return { id: "stroll", label: "having a wander", steps: [{ kind: "walk", x: clampX(x, floor.w) }, { kind: "do", move: "look", seconds: 5 }] };
    }
  }
};

// ---- the fridge, and the phone ------------------------------------------------------
//
// The human habits. All of it is for show: a look in the fridge takes
// nothing and gives nothing (no seeds, no mood, no snack bought), and an hour
// on the phone costs her nothing either. Please do not "fix" that by wiring
// them to the mood or the shop: a snack that counts is still the reader's to
// give (Pip's things), and what cheers her up is still reading.

const STARE_LINES = ["...", "hm.", "there was cake. wasn't there cake?", "what do i even want."];
const TAKE_LINES = ["just a little something.", "one bite. for science.", "this was here anyway."];
const NOTHING_LINES = ["nothing. as usual.", "i'm not even hungry.", "same as last time."];
const AGAIN_LINES = ["maybe now?", "one more look.", "something might have changed."];
const STILL_LINES = ["still nothing.", "no. same fridge.", "worth checking."];
const PLEASED_LINES = ["worth it.", "nobody saw that.", "mm. back to bed."];
const PECKISH_LINES = ["peckish.", "just a look.", "anything new in here?"];
const PHONE_LINES = ["no new messages.", "huh.", "just checking the time.", "right. back to it."];

const BOOK_WINS_LINES = ["...no. book.", "where was i.", "the book was better anyway."];
const SNOOZE_LINES = ["five more minutes.", "not yet.", "...snooze."];
const UP_LINES = ["fine. i'm up.", "okay. morning.", "up. mostly."];
/** How often a read is interrupted by her own phone (and resumed). */
const DRIFT_CHANCE = 0.2;

const LAUGH_LINES = ["heh.", "ha. okay.", "pfft."];
const FROWN_LINES = ["hm.", "who asked.", "...really?"];
const MORE_LINES = ["one more.", "just one more.", "last one. promise."];
const DROP_LINES = ["ow. my nose.", "ow.", "...nobody saw that."];
const CAUGHT_LINES = ["i was just looking!", "this isn't what it looks like.", "oh. hi. you're up."];
const HINT_LINES = ["...fine. one more, then sleep.", "okay, okay. nearly done.", "mm. two more minutes."];
const INNOCENT_LINES = ["i was reading.", "phone? what phone.", "just checking the time."];
const SHUT_ON_HER_LINES = ["hey. i was looking at that.", "i wasn't finished staring.", "...rude."];

/** Caught at the fridge after dark: the curtains opened on her, or a light switched on. */
export const caughtLine = (rand: Rand) => pick(rand, CAUGHT_LINES);
/** The reader drew the curtains, or put the light out, while she was on her phone in bed. */
export const hintLine = (rand: Rand) => pick(rand, HINT_LINES);
/** Tapped while on her phone: it is nowhere to be seen. */
export const innocentLine = (rand: Rand) => pick(rand, INNOCENT_LINES);
/** The reader shut the fridge she was staring into. */
export const shutOnHerLine = (rand: Rand) => pick(rand, SHUT_ON_HER_LINES);

/** A walk to a place she must be at (the fridge, her bed) even without motion: the scene puts her there. */
const reach = (state: BehaviourState, at: { x: number; face: 1 | -1 }, pace?: "tiptoe"): Step[] => [
  pace && !state.reduced ? { kind: "walk", x: at.x, pace } : { kind: "walk", x: at.x },
  { kind: "face", dir: at.face }
];

/**
 * A look in the fridge. After dark it is the midnight snack: over on tiptoe,
 * the door open, a long stare into the light, something small eaten standing
 * there (or nothing at all), the door shut, and pleased with herself. One time
 * in four she shuts it, wanders off, and comes back to look again, as if
 * something new might be there. By day it is shorter and plainer. `fromBed`:
 * she got out of bed for it, and goes back.
 */
export const fridgeVisit = (state: BehaviourState, rand: Rand, fromBed: boolean): Activity => {
  const fridge = nearest(state, "fridge");
  const dim = afterDark(state.hour);
  const label = dim ? "having a midnight snack" : "looking in the fridge";
  if (!fridge) return { id: "fridge", label, steps: [{ kind: "do", move: "look", seconds: 5 }] };
  const id = fridge.id ?? "fridge";
  const at = atFridge(fridge, state.floor.w);
  const pace = dim ? ("tiptoe" as const) : undefined;
  const stare = dim ? between(rand, 8, 14) : between(rand, 4, 7);
  const open: Step[] = [...reach(state, at, pace), { kind: "use", id, what: "open" }];
  const steps: Step[] = [...open, { kind: "do", move: "fridge-stare", seconds: stare, line: rand() < 0.7 ? pick(rand, dim ? STARE_LINES : PECKISH_LINES) : undefined }];
  // Shut, off, and back for another look: only where there is walking to do.
  if (!state.reduced && rand() < 0.25) {
    const away = clampX(at.x + (at.x > state.floor.w / 2 ? -1 : 1) * between(rand, 34, 52), state.floor.w);
    steps.push(
      { kind: "use", id, what: "shut" },
      { kind: "walk", x: away, pace },
      { kind: "do", move: "look", seconds: 5 },
      { kind: "pause", seconds: between(rand, 4, 8) },
      ...reach({ ...state, x: away }, at, pace),
      { kind: "use", id, what: "open" },
      { kind: "do", move: "fridge-stare", seconds: between(rand, 4, 8), line: pick(rand, AGAIN_LINES) }
    );
    steps.push({ kind: "use", id, what: "shut" }, { kind: "do", move: "shift", seconds: 2, line: pick(rand, STILL_LINES) });
  } else if (rand() < 0.65) {
    steps.push({ kind: "do", move: "nibble", seconds: 3, line: pick(rand, TAKE_LINES) }, { kind: "use", id, what: "shut" }, { kind: "do", move: "bop", seconds: 2.7, line: dim ? pick(rand, PLEASED_LINES) : undefined });
  } else {
    steps.push({ kind: "use", id, what: "shut" }, { kind: "do", move: "shift", seconds: 2, line: pick(rand, NOTHING_LINES) });
  }
  if (fromBed) steps.push({ kind: "use", id: nearest(state, "bed")?.id ?? "bed", what: "bed" });
  return { id: "fridge", label, steps };
};

/**
 * An evening on the phone, beat by beat: stretches of scrolling with a quiet
 * laugh, a frown or a yawn between them, the phone landing on her nose once
 * if she is at it long enough, "one more", and asleep with it on her chest.
 * The later the hour, the longer she keeps at it. Without motion: fewer
 * beats, and nothing slips.
 */
export const scrollSession = (hour: number, rand: Rand, reduced = false): ScrollBeat[] => {
  // Hours past nine in the evening: 0 at 21:00, 7 at four in the morning.
  const lateness = hour >= 21 ? hour - 21 : hour < 5 ? hour + 3 : 0;
  const total = 20 + lateness * 7 + rand() * 10;
  const beats: ScrollBeat[] = [];
  let spent = 0;
  let last: ScrollBeat["beat"] | null = null;
  let dropped = reduced || total < 35;
  while (spent < total) {
    const stretch = rand() < 0.5 ? 4 : 8;
    beats.push({ beat: "scroll", seconds: stretch });
    spent += stretch;
    if (spent >= total) break;
    if (!dropped && spent > total / 2) {
      dropped = true;
      last = "drop";
      beats.push({ beat: "drop", seconds: 3, line: pick(rand, DROP_LINES) });
    } else {
      const options: Array<ScrollBeat["beat"]> = (["laugh", "frown", "yawn"] as const).filter((beat) => beat !== last);
      last = pick(rand, options);
      beats.push(
        last === "laugh" ? { beat: last, seconds: 2, line: pick(rand, LAUGH_LINES) } : last === "frown" ? { beat: last, seconds: 2, line: pick(rand, FROWN_LINES) } : { beat: last, seconds: 3 }
      );
    }
    spent += 3;
  }
  // A yawn she talks herself out of, a last scroll, and she is gone.
  const end = beats[beats.length - 1];
  if (end.beat === "yawn") end.line = pick(rand, MORE_LINES);
  else {
    if (end.beat !== "scroll") beats.push({ beat: "scroll", seconds: 4 });
    beats.push({ beat: "yawn", seconds: 3, line: pick(rand, MORE_LINES) });
  }
  beats.push({ beat: "scroll", seconds: 4 }, { beat: "doze", seconds: 4 });
  return beats;
};

/** A session cut short because the reader has hinted (curtains drawn, the light out): she takes it, slowly. */
export const scrollWindDown = (rand: Rand): ScrollBeat[] => [
  { beat: "scroll", seconds: 4, line: hintLine(rand) },
  { beat: "yawn", seconds: 3 },
  { beat: "doze", seconds: 4 }
];

/** How long all of a session's beats run, in seconds. */
export const scrollSeconds = (beats: readonly ScrollBeat[]) => beats.reduce((sum, beat) => sum + beat.seconds, 0);

// ---- the night ------------------------------------------------------------------------
//
// After dark Pip is in bed until day. Two things may have her up, or awake:
// the phone as she gets in, and, once asleep, the fridge (or the phone again).
// Only on her own account: a Pip the reader put to bed is left asleep for
// TUCKED_QUIET_MIN minutes, so tucking her in is not undone a minute later.

/** A Pip the reader put to bed does not stir of her own accord for this long, in minutes. */
export const TUCKED_QUIET_MIN = 20;
/** She has to have been asleep this long before she stirs, and this long since the last time, in minutes. */
export const STIR_AFTER_MIN = 0.5;
export const STIR_APART_MIN = 3;
/** The chance she stirs at each look at the clock (the scene looks every half minute). */
export const STIR_CHANCE = 0.3;
/** Of the stirs on a night after a horror, the share that are a peek from under the quilt. */
export const PEEK_SHARE = 0.25;

export type NightState = {
  hour: number;
  /** There is a fridge on the floor. */
  fridge: boolean;
  /** Minutes she has been asleep. */
  asleepFor: number;
  /** Minutes since the reader put her to bed; null: she went by herself. */
  tuckedAgo: number | null;
  /** Minutes since she last stirred; null: not tonight. */
  stirredAgo: number | null;
  /** What she did last, newest first. */
  recent: readonly ActivityId[];
  /** A horror was read this evening (`spookedTonight`): she may wake and peek out from under the quilt. */
  spooked?: boolean;
};

/** Whether she takes the phone to bed as she gets in for the night by herself: about every other night, never two in a row. */
export const bedtimeScroll = (hour: number, recent: readonly ActivityId[], rand: Rand) => late(hour) && recent[0] !== "scroll" && rand() < 0.5;

/** How long after a horror was read it can still wake her in the night, in minutes. */
export const SPOOKED_FOR_MIN = 6 * 60;
/** Whether a horror read lately is still with her tonight. */
export const spookedTonight = (world: World | null | undefined) => {
  const book = world?.book;
  return Boolean(book && book.mood === "horror" && book.readAgoMin !== null && book.readAgoMin <= SPOOKED_FOR_MIN);
};
const PEEK_LINES = ["...what was that?", "just the wind. just the wind.", "i'm not scared. i'm checking.", "nothing there. go to sleep, pip."];
/** What she says, peeking out from under the quilt in the night. */
export const peekLine = (rand: Rand) => pick(rand, PEEK_LINES);
/** How long the peek lasts, in seconds, before she is asleep again. */
export const PEEK_S = 8;

/**
 * What, if anything, has a sleeping Pip up in the night: the fridge, the
 * phone, or (mostly) nothing; and, the night after a horror, a wide-eyed look
 * out from under the quilt (`peek`: she does not get up). Never by day: a nap
 * is a nap.
 */
export const nightStir = (state: NightState, rand: Rand): "fridge" | "scroll" | "peek" | null => {
  if (!afterDark(state.hour)) return null;
  if (state.tuckedAgo !== null && state.tuckedAgo < TUCKED_QUIET_MIN) return null;
  if (state.asleepFor < STIR_AFTER_MIN) return null;
  if (state.stirredAgo !== null && state.stirredAgo < STIR_APART_MIN) return null;
  if (rand() >= STIR_CHANCE) return null;
  const [last] = state.recent;
  const options: Array<"fridge" | "scroll"> = [];
  // The fridge twice as often as the phone, where there is one; neither twice running.
  if (state.fridge && last !== "fridge") options.push("fridge", "fridge");
  if (late(state.hour) && last !== "scroll") options.push("scroll");
  // The horror she read: one stir in four or so, and never twice running.
  if (state.spooked && last !== "spooked") return rand() < PEEK_SHARE ? "peek" : options.length > 0 ? pick(rand, options) : null;
  return options.length > 0 ? pick(rand, options) : null;
};

// ---- the morning -----------------------------------------------------------------------
//
// Day comes while she is asleep for the night: she wakes, pulls the quilt back
// over herself once, and gets up a little later with a stretch; and about one
// morning in two the first thing she does is look in the fridge.

/** How long the snooze buys her, in seconds. */
export const SNOOZE_S = 10;
/** Whether she hits snooze as day comes: once a morning, never twice. */
export const snoozes = (hour: number, already: boolean) => !already && !afterDark(hour) && hour < 12;
export const snoozeLine = (rand: Rand) => pick(rand, SNOOZE_LINES);
export const upLine = (rand: Rand) => pick(rand, UP_LINES);
/** Whether getting up is followed by a look in the fridge. */
export const morningFridge = (fridge: boolean, rand: Rand) => fridge && rand() < 0.5;

// ---- the book on the go, and the books behind her ------------------------------------
//
// Pip knows what the reader is reading (pip/genre.ts reads the genres), and
// it gets into her head: a horror has her under the quilt, a mystery has the
// magnifying glass out, a fantasy is a cape and a wooden sword. And she feels
// the books behind her: flat on the floor for a day after one ends, dusting
// off the one that was left. Occasional things, weighted like any other (see
// `weights`), and all for show: no mood, no seeds.

const SPOOK_LINES = ["...did you hear that?", "what was that.", "it's just the house. settling.", "nope. nope nope."];
const DAY_SPOOK_LINES = ["...what was that?", "nothing. it was nothing.", "i'm fine. it's daytime."];
const QUILT_LINES = ["it can't get me under here.", "quilts are monster-proof. fact.", "if i can't see it..."];
const UNDER_BED_LINES = ["just checking.", "nothing under there. probably.", "one sock. no monsters."];
const SAFE_LINES = ["all clear. i knew that.", "fine. it's fine.", "one more chapter can't hurt."];
const CLUE_LINES = ["hm. a clue.", "aha. footprints.", "the game is afoot."];
const TRAIL_LINES = ["it went this way.", "curious. very curious.", "crumbs. recent ones."];
const SOLVED_LINES = ["it was the butler. always is.", "case closed. it was me.", "elementary, dear reader."];
const OATH_LINES = ["for the realm!", "a quest! at last.", "onward. adventure waits."];
const FOE_LINES = ["have at thee, lamp!", "back, foul shadow!", "you shall not pass. please."];
const VICTORY_LINES = ["the realm is safe. you're welcome.", "another dragon, handled.", "songs will be sung. short ones."];
const STAR_LINES = ["anyone out there?", "that one moved. i saw it.", "beam me up. after this chapter."];
const SWOON_LINES = ["just kiss already.", "they're so in love. sigh.", "my heart. my little green heart."];
const HANGOVER_LINES = ["it's over. what now.", "i'm not ready for another book.", "they just... ended it. like that.", "i miss them already."];
const UP_AGAIN_LINES = ["...okay. okay.", "one day i'll be over it.", "what do i read now?"];
const WISTFUL_LINES = ["we were getting somewhere.", "i remember where we stopped.", "no rush. it'll keep."];

/** A title as she says it: in her own lower case, without its subtitle, and short enough for the bubble. */
export const shortTitle = (title: string, max = 22) => {
  const main = title.split(/:| \(| - | \u2014 /)[0].trim().toLowerCase() || title.trim().toLowerCase();
  return main.length > max ? `${main.slice(0, max - 1).trimEnd()}\u2026` : main;
};

/** The book she is dusting, said wistfully. */
const dustLine = (rand: Rand, title: string) => {
  const name = shortTitle(title);
  return pick(rand, [`${name}... someday.`, `oh, ${name}. i remember you.`, `poor ${name}. so dusty.`]);
};

/**
 * A horror on the go. At night: a start, over to the bed on tiptoe, under the
 * quilt with only her eyes out, then out again to check beneath the bed, and
 * relief. By day it is milder: a glance over her shoulder. With no bed out she
 * only looks about her.
 */
const spooked = (state: BehaviourState, rand: Rand): Activity => {
  if (!afterDark(state.hour)) {
    return { id: "spooked", label: "glancing over her shoulder", steps: [{ kind: "do", move: "glance", seconds: 3, line: pick(rand, DAY_SPOOK_LINES) }, { kind: "do", move: "shift", seconds: 2 }] };
  }
  const start: Step = { kind: "do", move: "glance", seconds: 3, line: pick(rand, SPOOK_LINES) };
  const bed = nearest(state, "bed");
  if (!bed) return { id: "spooked", label: "listening to the house creak", steps: [start, { kind: "do", move: "look", seconds: 5 }, { kind: "do", move: "shift", seconds: 2, line: pick(rand, SAFE_LINES) }] };
  return {
    id: "spooked",
    label: "hiding under the quilt",
    steps: [
      start,
      ...reach(state, standAt(bed, state.x, state.floor.w), "tiptoe"),
      { kind: "use", id: bed.id ?? "bed", what: "hide", seconds: between(rand, 8, 13) },
      // Out of bed she stands at its foot, on the right: the look beneath it is to the left.
      { kind: "face", dir: -1 },
      { kind: "do", move: "underbed", seconds: 4, line: pick(rand, UNDER_BED_LINES) },
      { kind: "do", move: "shift", seconds: 2, line: pick(rand, SAFE_LINES) }
    ]
  };
};
/** What she says from under the quilt (the scene says it as she gets in). */
export const quiltLine = (rand: Rand) => pick(rand, QUILT_LINES);

/** Somewhere across the room from where she stands: on the side with more floor, a good walk away, never into a wall. */
const across = (state: BehaviourState, rand: Rand) => {
  const w = state.floor.w;
  return clampX(state.x < w / 2 ? between(rand, state.x + 50, w - MARGIN) : between(rand, MARGIN, state.x - 50), w);
};

/** A mystery: the glass up to her eye, something followed along the floor one way and part of the way back, and the case solved. */
const sleuth = (state: BehaviourState, rand: Rand): Activity => {
  const first = across(state, rand);
  const second = clampX((first + state.x) / 2 + between(rand, -12, 12), state.floor.w);
  return {
    id: "sleuth",
    label: "following a clue",
    steps: [
      { kind: "do", move: "inspect", seconds: 3, line: pick(rand, CLUE_LINES) },
      { kind: "walk", x: first, pace: "slow", as: "trail" },
      { kind: "do", move: "inspect", seconds: 3, line: pick(rand, TRAIL_LINES) },
      { kind: "walk", x: second, pace: "slow", as: "trail" },
      { kind: "do", move: "idea", seconds: 3.3, line: pick(rand, SOLVED_LINES) }
    ]
  };
};

/** A fantasy: cape on, wooden sword up, a march across the room, a fight with whatever is there, and the sword raised. Without motion: the pose and the oath. */
const quest = (state: BehaviourState, rand: Rand): Activity => {
  const oath: Step = { kind: "do", move: "knight", seconds: 3, line: pick(rand, OATH_LINES) };
  if (state.reduced) return { id: "quest", label: "off on a quest", steps: [oath] };
  return {
    id: "quest",
    label: "off on a quest",
    steps: [
      oath,
      { kind: "walk", x: across(state, rand), as: "march" },
      { kind: "do", move: "swordplay", seconds: between(rand, 6, 10), line: pick(rand, FOE_LINES) },
      { kind: "do", move: "knight", seconds: 3, line: pick(rand, VICTORY_LINES) }
    ]
  };
};

/** The day after a book ends: flat on the floor a good while, staring at the ceiling, the closed book on her chest; then up, slowly. */
const hangover = (_state: BehaviourState, rand: Rand): Activity => ({
  id: "hangover",
  label: "lying on the floor with a book hangover",
  steps: [
    { kind: "do", move: "hangover", seconds: between(rand, 14, 22), line: pick(rand, HANGOVER_LINES) },
    { kind: "do", move: "stretch", seconds: 3.3, line: rand() < 0.5 ? pick(rand, UP_AGAIN_LINES) : undefined }
  ]
});

/** The book left a fortnight: over to the books, the dust off it, its title said wistfully, and a thought after. */
const dusting = (state: BehaviourState, rand: Rand): Activity => {
  const books = nearest(state, "books");
  return {
    id: "dust",
    label: "dusting off a book left unread",
    steps: [
      ...go(state, books),
      { kind: "do", move: "dust", seconds: 5, line: dustLine(rand, state.world?.dusty?.title ?? "that one") },
      { kind: "do", move: "shift", seconds: 2, line: rand() < 0.6 ? pick(rand, WISTFUL_LINES) : undefined }
    ]
  };
};

// ---- company -------------------------------------------------------------------------
//
// A friend's Pip is in the room (components/pip/Visitors.tsx draws them; the
// world says where they stand). She greets them, reads beside them, and never
// walks through them: a plan whose walk would cross the visitor is not made
// while they are here.

/** How near her middle may come to the visitor's box, in floor pixels. */
export const VISITOR_CLEAR = 4;
/** Where she may not stand or cross: the visitor's box and a little either side. */
export const visitorZone = (visitor: { x: number; w: number }) => ({ from: visitor.x - VISITOR_CLEAR, to: visitor.x + visitor.w + VISITOR_CLEAR });

/**
 * Where a walk from `from` to `to` must stop for the visitor: the near edge
 * of their zone, or null when the way is clear. A walk that begins inside the
 * zone (she was put down there) is let out of it.
 */
export const stopForVisitor = (visitor: { x: number; w: number } | null | undefined, from: number, to: number): number | null => {
  if (!visitor) return null;
  const zone = visitorZone(visitor);
  if (from <= zone.from && to > zone.from) return zone.from;
  if (from >= zone.to && to < zone.to) return zone.to;
  return null;
};

/** Whether any walk of a plan would run into the visitor. */
export const crossesVisitor = (activity: Activity, state: BehaviourState) => {
  const visitor = state.world?.visitor;
  if (!visitor) return false;
  let x = state.x;
  for (const step of activity.steps) {
    if (step.kind !== "walk") continue;
    if (stopForVisitor(visitor, x, step.x) !== null) return true;
    x = step.x;
  }
  return false;
};

/** Where she stands beside the visitor: on the side she is on, a little off their box, turned to them. */
export const besideVisitor = (visitor: { x: number; w: number }, fromX: number, floorW: number): { x: number; face: 1 | -1 } => {
  const left = visitor.x - 12;
  const right = visitor.x + visitor.w + 12;
  let onLeft = fromX <= visitor.x + visitor.w / 2;
  if (left < MARGIN) onLeft = false;
  else if (right > floorW - MARGIN) onLeft = true;
  return onLeft ? { x: Math.round(left), face: 1 } : { x: Math.round(right), face: -1 };
};

const KNOCK_LINES = ["a knock! who is it?", "someone's at the door!", "company! is my leaf straight?"];
const BYE_LINES = ["bye! come again.", "that was nice.", "same time tomorrow?"];
const NOTE_LINES = ["oh. someone came by.", "a note! i missed them.", "we had a visitor. i was out."];
/** She hears the knock. */
export const knockedLine = (rand: Rand) => pick(rand, KNOCK_LINES);
/** The visitor has gone. */
export const goodbyeLine = (rand: Rand) => pick(rand, BYE_LINES);
/** A note was left while she was asleep or out. */
export const missedLine = (rand: Rand) => pick(rand, NOTE_LINES);
/** Hello, by name: short enough for the bubble whatever the handle. */
export const helloLine = (rand: Rand, handle: string | undefined) => {
  const name = handle ? `@${handle}` : "you";
  const line = pick(rand, [`hi, ${name}!`, `${name}! you came.`, `oh! hello, ${name}.`]);
  return line.length <= 44 ? line : "oh! hello, you.";
};

/** Reading beside the visitor: over to them (on her own side of them), turned to them, a good long read. */
const company = (state: BehaviourState, rand: Rand, greet = false): Activity => {
  const visitor = state.world?.visitor;
  const read: Step[] = [{ kind: "do", move: "read", seconds: between(rand, 20, 36) }, { kind: "do", move: "bookmark", seconds: 3.3 }];
  if (!visitor) return { id: "company", label: "reading", steps: read };
  const hello: Step[] = greet ? [{ kind: "do", move: "welcome", seconds: 3, line: helloLine(rand, visitor.handle) }] : [];
  return {
    id: "company",
    label: greet ? "saying hello to her visitor" : "reading beside her visitor",
    steps: [...reach(state, besideVisitor(visitor, state.x, state.floor.w)), ...hello, ...read]
  };
};

/** The visitor has just come in: over to them, a wave and their name, and a read together. */
export const greetVisitor = (state: BehaviourState, rand: Rand): Activity => stilled(company(state, rand, true), state);

// ---- a cold --------------------------------------------------------------------------
//
// A streak ended, and instead of the shelf's books burning she has a cold,
// which the reader's reading nurses away (the rule is Rust's, `habit::cold`;
// the words for it are pip/cold.ts's; the world says how far along she is).
// Here it only has a face: a blanket, tissues, tea, a slower walk, fewer
// things done, and all of it easing as today's reading nears the goal. Never
// a word of blame: she caught a chill, and stories are the cure.

/** How a cold shows for how far it is cured; null when she is well. */
export const coldStage = (cold: Cold | null | undefined): ColdStage | null => {
  if (!cold || !(cold.cure < 1)) return null;
  return cold.cure < 1 / 3 ? "bad" : cold.cure < 2 / 3 ? "mending" : "nearly";
};
/** How fast she walks with it, as a share of her stroll. */
export const coldPace = (cold: Cold | null | undefined) => ({ bad: 0.55, mending: 0.7, nearly: 0.9, well: 1 })[coldStage(cold) ?? "well"];
/** How much longer she rests between things. */
export const coldRest = (cold: Cold | null | undefined) => ({ bad: 2.2, mending: 1.6, nearly: 1.15, well: 1 })[coldStage(cold) ?? "well"];
/** Whether she is under her blanket (the two worse stages). */
export const bundled = (cold: Cold | null | undefined) => coldStage(cold) === "bad" || coldStage(cold) === "mending";

const TISSUE_LINES = ["honk.", "that's better.", "where does it all come from."];
const SNEEZE_LINES = ["bless me.", "achoo. excuse me.", "sniff. i'm fine. mostly.", "i hab a code."];
const TEA_LINES = ["tea. blanket. book. the cure.", "warm. mm.", "a story would go well with this."];
const BETTER_LINES = ["feeling better already.", "nearly myself again.", "the stories are working."];

/** Looking after a cold: a tissue, a sneeze, or tea under the blanket; nearly well, only a sniffle and a brighter word. */
const nurse = (state: BehaviourState, rand: Rand): Activity => {
  const stage = coldStage(state.world?.cold);
  if (stage === "nearly" || stage === null) {
    return { id: "nurse", label: "getting over a cold", steps: [{ kind: "do", move: "sniffle", seconds: 3, line: pick(rand, BETTER_LINES) }, { kind: "do", move: "stretch", seconds: 3.3 }] };
  }
  const roll = rand();
  if (roll < 0.4) {
    return { id: "nurse", label: "blowing her nose", steps: [{ kind: "do", move: "tissue", seconds: 4, line: pick(rand, TISSUE_LINES) }, { kind: "do", move: "sniffle", seconds: 3 }] };
  }
  if (roll < 0.7) {
    // (Without motion: no sneeze, only the sniffle after it.)
    return {
      id: "nurse",
      label: "sneezing",
      steps: [...(state.reduced ? [] : [{ kind: "do", move: "sneeze", seconds: 5 } as Step]), { kind: "do", move: "sniffle", seconds: 3, line: pick(rand, SNEEZE_LINES) }]
    };
  }
  return { id: "nurse", label: "having tea under a blanket", steps: [{ kind: "do", move: "tea", seconds: between(rand, 8, 12), line: pick(rand, TEA_LINES) }, { kind: "do", move: "sniffle", seconds: 3 }] };
};

/** Activities that happen at a thing she must be at, motion or no: the scene puts her there, unseen. */
const AT_A_PLACE: ReadonlySet<ActivityId> = new Set<ActivityId>(["fridge", "scroll", "spooked", "company"]);

/** Without motion nothing walks: only the standing parts are left (but for the fridge and her bed, which she has to be at). */
const stilled = (activity: Activity, state: BehaviourState): Activity => {
  if (!state.reduced || AT_A_PLACE.has(activity.id)) return activity;
  return { ...activity, steps: activity.steps.filter((step) => step.kind !== "walk" && step.kind !== "face") };
};

/** An activity by name, planned as the chooser would plan it: for the scene's development hook, and the tests. */
export const planActivity = (id: ActivityId, state: BehaviourState, rand: Rand): Activity => {
  const activity = stilled(build(id, state, rand), state);
  return crossesVisitor(activity, state) ? stilled(company(state, rand), state) : activity;
};

/**
 * An activity the reader asked for, at the thing they pointed at (these books,
 * that window) rather than the nearest of its kind: planned like any other.
 */
export const activityAt = (id: "read" | "window", spot: Spot, state: BehaviourState, rand: Rand): Activity => {
  const activity = build(id, { ...state, spots: [spot, ...state.spots.filter((other) => other.kind !== spot.kind)] }, rand);
  if (crossesVisitor(activity, state)) return stilled(company(state, rand), state);
  if (state.reduced) return { ...activity, steps: activity.steps.filter((step) => step.kind !== "walk" && step.kind !== "face") };
  return activity;
};

/** What Pip does next: one activity, chosen by weight and planned out. */
export const chooseActivity = (state: BehaviourState, rand: Rand): Activity => {
  const w = weights(state);
  const first = stilled(build(weightedPick(rand, w), state, rand), state);
  if (!crossesVisitor(first, state)) return first;
  // The visitor is in the way of that one: something else, and if nothing else will do, their company.
  for (let tries = 0; tries < 4; tries += 1) {
    const other = stilled(build(weightedPick(rand, w), state, rand), state);
    if (!crossesVisitor(other, state)) return other;
  }
  return stilled(company(state, rand), state);
};

/** The longest an activity runs, walking aside: for the tests, and so nothing drags. */
export const busySeconds = (activity: Activity) =>
  activity.steps.reduce(
    (sum, step) =>
      sum + (step.kind === "do" || step.kind === "pause" || (step.kind === "use" && (step.what === "sleep" || step.what === "hide")) ? step.seconds : step.kind === "use" && step.what === "scroll" ? scrollSeconds(step.beats) : 0),
    0
  );

// ---- between activities ---------------------------------------------------------
//
// Standing about, Pip is still alive: she blinks (the idle does that), looks
// around, shifts her weight, hums. One small thing at a time, a few seconds
// apart, and then the next activity.

export type Fidget = { move: string; seconds: number };

/** A small thing to do while standing about; never the one she just did. */
export const fidget = (state: Pick<BehaviourState, "mood" | "hour" | "world">, last: string | null, rand: Rand): Fidget => {
  const options: Fidget[] = [
    { move: "look", seconds: 5 },
    { move: "shift", seconds: 2 },
    { move: "shift", seconds: 2 }
  ];
  const stage = coldStage(state.world?.cold);
  // With a cold: sniffles in place of anything lively, the more the worse it is.
  if (stage) options.push(...Array.from({ length: stage === "nearly" ? 1 : 3 }, () => ({ move: "sniffle", seconds: 3 })));
  if (state.mood >= 60 && !stage) options.push({ move: "bop", seconds: 2.7 });
  if (state.mood >= GLUM && stage !== "bad") options.push({ move: "stretch", seconds: 3.3 });
  if (evening(state.hour) || night(state.hour)) options.push({ move: "yawn", seconds: 4 });
  const fresh = options.filter((option) => option.move !== last);
  return pick(rand, fresh.length > 0 ? fresh : options);
};

/** How long she stands before the next small thing, in seconds. */
export const fidgetGap = (rand: Rand) => between(rand, 2.5, 5);

/** How many small things come between two activities: one or two. */
export const fidgetsBetween = (rand: Rand) => (rand() < 0.45 ? 2 : 1);

// ---- watching the pointer --------------------------------------------------------

/** Where her eyes go: left, middle or right, and up, level or down. */
export type Gaze = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

/**
 * Which way she looks to follow a point, from where her face is (both in the
 * same pixels). Level inside a small dead zone, so her eyes rest when the
 * pointer is on her, and steady at the edges of each zone.
 */
export const gazeAt = (face: { x: number; y: number }, point: { x: number; y: number }, dead = 10): Gaze => {
  const dx = point.x - face.x;
  const dy = point.y - face.y;
  const far = Math.hypot(dx, dy);
  if (far < dead) return { dx: 0, dy: 0 };
  // The eight ways round, each 45 degrees wide.
  const turn = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const table: Array<[Gaze["dx"], Gaze["dy"]]> = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const [x, y] = table[((turn % 8) + 8) % 8];
  return { dx: x, dy: y };
};

/** The idle move that looks that way ("idle" when level). */
export const gazeMove = (gaze: Gaze, base = "idle") => {
  if (gaze.dx === 0 && gaze.dy === 0) return base;
  const y = gaze.dy < 0 ? "u" : gaze.dy > 0 ? "d" : "";
  const x = gaze.dx < 0 ? "l" : gaze.dx > 0 ? "r" : "";
  return `eye-${y}${x}`;
};
