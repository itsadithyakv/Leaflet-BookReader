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
  | "fridge";

export type Spot = {
  kind: SpotKind;
  /** Its middle, in floor pixels. */
  x: number;
  /** How wide it is, so she stands beside it and not in it. */
  w: number;
  /** Up on the wall or a shelf: she stands under it and looks up. */
  up?: boolean;
  id?: string;
};

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
  | "phone";

/** One stretch of an evening on the phone: what she does, for how long, and what she says as it starts. */
export type ScrollBeat = {
  /** `scroll`: thumb going, eyes down the feed; `drop`: the phone lands on her nose; `doze`: asleep, the screen going out; `innocent`: phone hidden, the reader is looking. */
  beat: "scroll" | "laugh" | "frown" | "yawn" | "drop" | "doze" | "innocent";
  seconds: number;
  line?: string;
};

export type Step =
  /** Walk there (she faces the way she goes); on tiptoe, slowly, when she would rather not be heard. Without motion she is simply there. */
  | { kind: "walk"; x: number; pace?: "tiptoe" }
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
   * in sleep, and ends the activity), or go back to the bed she got out of.
   */
  | { kind: "use"; id: string; what: "straighten" | "open" | "shut" | "bed" }
  | { kind: "use"; id: string; what: "sleep"; seconds: number }
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
    phone: late(hour) ? 0 : 0.5
  };

  // Glum, she keeps to quiet things: no dancing, no games.
  if (glum) {
    w.toy = 0;
    w.dance = 0;
    w.exercise = 0;
    w.arcade = 0;
    w.sunbathe = 0;
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
};

/** Whether she takes the phone to bed as she gets in for the night by herself: about every other night, never two in a row. */
export const bedtimeScroll = (hour: number, recent: readonly ActivityId[], rand: Rand) => late(hour) && recent[0] !== "scroll" && rand() < 0.5;

/** What, if anything, has a sleeping Pip up in the night: the fridge, the phone, or (mostly) nothing. Never by day: a nap is a nap. */
export const nightStir = (state: NightState, rand: Rand): "fridge" | "scroll" | null => {
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

/**
 * An activity the reader asked for, at the thing they pointed at (these books,
 * that window) rather than the nearest of its kind: planned like any other.
 */
export const activityAt = (id: "read" | "window", spot: Spot, state: BehaviourState, rand: Rand): Activity => {
  const activity = build(id, { ...state, spots: [spot, ...state.spots.filter((other) => other.kind !== spot.kind)] }, rand);
  if (state.reduced) return { ...activity, steps: activity.steps.filter((step) => step.kind !== "walk" && step.kind !== "face") };
  return activity;
};

/** What Pip does next: one activity, chosen by weight and planned out. */
export const chooseActivity = (state: BehaviourState, rand: Rand): Activity => {
  const activity = build(weightedPick(rand, weights(state)), state, rand);
  // Without motion nothing walks: only the standing parts are left. (The
  // fridge and her bed she has to be at: the scene puts her there, unseen.)
  if (state.reduced && activity.id !== "fridge" && activity.id !== "scroll") return { ...activity, steps: activity.steps.filter((step) => step.kind !== "walk" && step.kind !== "face") };
  return activity;
};

/** The longest an activity runs, walking aside: for the tests, and so nothing drags. */
export const busySeconds = (activity: Activity) =>
  activity.steps.reduce(
    (sum, step) =>
      sum + (step.kind === "do" || step.kind === "pause" || (step.kind === "use" && step.what === "sleep") ? step.seconds : step.kind === "use" && step.what === "scroll" ? scrollSeconds(step.beats) : 0),
    0
  );

// ---- between activities ---------------------------------------------------------
//
// Standing about, Pip is still alive: she blinks (the idle does that), looks
// around, shifts her weight, hums. One small thing at a time, a few seconds
// apart, and then the next activity.

export type Fidget = { move: string; seconds: number };

/** A small thing to do while standing about; never the one she just did. */
export const fidget = (state: Pick<BehaviourState, "mood" | "hour">, last: string | null, rand: Rand): Fidget => {
  const options: Fidget[] = [
    { move: "look", seconds: 5 },
    { move: "shift", seconds: 2 },
    { move: "shift", seconds: 2 }
  ];
  if (state.mood >= 60) options.push({ move: "bop", seconds: 2.7 });
  if (state.mood >= GLUM) options.push({ move: "stretch", seconds: 3.3 });
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
