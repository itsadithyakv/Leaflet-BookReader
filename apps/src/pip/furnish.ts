/**
 * Things in Pip's house the reader can use: curtains to draw, a picture to
 * knock crooked, a bed to put her in, fish for her to come and watch (the
 * pieces that answer a tap: `VISITS`). One small system rather than a special
 * case each: a *kind* of furnishing says what the hand can do with it (in
 * words, for its label, and as a cursor), what is remembered about it on this
 * device, and what Pip makes of it; the pieces of decor that are of that kind
 * are listed once (`KIND_OF`). The house scene (components/pip/furnishings.tsx)
 * lays a button over each one that is out, feeds it the pointer and the
 * keyboard, and draws what changes; the rules are here, pure
 * (furnish.test.ts).
 *
 * Nothing here earns seeds, and nothing here is saved with the house: what
 * is remembered (drawn curtains, a picture hung a little to the left) is a
 * preference of this device, in localStorage, outside the backup. The saved
 * layout (which piece is in which slot) is read and never written.
 *
 * Nor does anything here touch her mood, with one exception. This comment
 * used to say "nothing here earns seeds or mood", and the fridge was for
 * show. On 2026-10-13 the owner asked for the fridge to mean something
 * ("make Pip sad by not having food in the fridge if you don't buy"): it now
 * has food in it or has not, by the snacks on record (Rust: pip/fridge.rs),
 * and her finding it bare takes a little off her mood, once a day at most and
 * never below the floor (Rust decides: `pip_fridge_bare`). What is here is
 * the webview's part: how often she droops over a bare one (`bareMinds`), and
 * what she does when she looks.
 */
import { holdMove, holdStart, holdStep, type Hold, type Sample } from "./play";
import type { PipSound } from "./sound";
import type { Offer } from "./behaviour";

export type FurnishKind =
  | "curtains"
  | "picture"
  | "bed"
  | "window"
  | "books"
  | "lamp"
  | "fridge"
  | "bookcase"
  | "notes"
  | "calendar"
  | "clock"
  | "plant"
  | "radio"
  | "album"
  | "diary"
  /** A thing that answers a tap and has Pip come over to it: the fish to watch, the cuckoo to set off (`VISITS` says what, piece by piece). */
  | "visit";

/** What can be remembered about one furnishing. Each kind keeps only its own fields. */
export type FurnishState = {
  /** Curtains: how far drawn, 0 (tied back) to 1 (closed). */
  closed?: number;
  /** A picture: how far along the wall it hangs from its slot (floor pixels), and how crooked (radians). */
  dx?: number;
  tilt?: number;
  /** A lamp: switched off. */
  off?: boolean;
};

export type KindSpec = {
  /** What it is called in its label, after the piece's own name. */
  noun: string;
  /** What the hand can do, for the label and the tooltip. */
  how: string;
  /** What the keyboard does on it, for the label. */
  keys: string;
  cursor: "pointer" | "grab" | "ew-resize";
  /** The fields of its state kept on this device. */
  remembers: ReadonlyArray<keyof FurnishState>;
};

export const KINDS: Record<FurnishKind, KindSpec> = {
  curtains: {
    noun: "curtains",
    how: "Select to draw or open the curtains, or pull anywhere on the window, any way.",
    keys: "Enter draws or opens them.",
    cursor: "ew-resize",
    remembers: ["closed"]
  },
  picture: {
    noun: "picture",
    how: "Select to nudge it (it swings, and may hang crooked; once too often and it comes down), or drag it along the wall. Fallen, select it to hang it again.",
    keys: "Enter nudges it; left and right arrows move it along the wall.",
    cursor: "grab",
    remembers: ["dx", "tilt"]
  },
  bed: {
    noun: "bed",
    how: "Select to send Pip to bed, or to get her up. You can also carry her over and put her down on it.",
    keys: "Enter sends her to bed, or gets her up.",
    cursor: "pointer",
    remembers: []
  },
  window: {
    noun: "window",
    how: "Select to have Pip come and look out.",
    keys: "Enter calls her over to look out.",
    cursor: "pointer",
    remembers: []
  },
  books: {
    noun: "books",
    how: "Select to have Pip come and read one.",
    keys: "Enter has her come and read one.",
    cursor: "pointer",
    remembers: []
  },
  lamp: {
    noun: "light",
    how: "Select to switch it off or on.",
    keys: "Enter switches it off or on.",
    cursor: "pointer",
    remembers: ["off"]
  },
  fridge: {
    noun: "fridge",
    how: "Select to open the fridge, or to shut it. Left open, it shuts itself after a few seconds.",
    keys: "Enter opens it, or shuts it.",
    cursor: "pointer",
    // An open door is not remembered: it is shut again by the time anyone comes back.
    remembers: []
  },
  bookcase: {
    noun: "bookcase",
    how: "Select to see the books you have finished: each one is a spine here, in its cover's colour.",
    keys: "Enter opens the list.",
    cursor: "pointer",
    remembers: []
  },
  notes: {
    noun: "notes",
    how: "The fridge's lower door: select to read your latest highlights, pinned there, and open one in its book. (The top of the fridge opens the fridge.)",
    keys: "Enter opens them.",
    cursor: "pointer",
    remembers: []
  },
  calendar: {
    noun: "calendar",
    how: "Select to open your reading calendar: the days you read, and the days you met your goal.",
    keys: "Enter opens it.",
    cursor: "pointer",
    remembers: []
  },
  clock: {
    noun: "clock",
    how: "Select to see the time, and how long a focus session has left.",
    keys: "Enter opens it.",
    cursor: "pointer",
    remembers: []
  },
  plant: {
    noun: "plant",
    how: "Select to see how the plant is, and what it wants. Only reading outside a focus session waters it.",
    keys: "Enter opens it.",
    cursor: "pointer",
    remembers: []
  },
  radio: {
    noun: "radio",
    how: "Select to open the radio: rain, a fire or a cafe behind the page while you read.",
    keys: "Enter opens it.",
    cursor: "pointer",
    remembers: []
  },
  album: {
    noun: "album",
    how: "Select to open the album of what Pip has brought home from her expeditions.",
    keys: "Enter opens it.",
    cursor: "pointer",
    remembers: []
  },
  diary: {
    noun: "diary",
    how: "Select to read Pip's diary: a line a day about your reading.",
    keys: "Enter opens it.",
    cursor: "pointer",
    remembers: []
  },
  visit: {
    noun: "thing",
    // What each piece says for itself is in `VISITS`; this is for one that says nothing.
    how: "Select to have Pip come over to it.",
    keys: "Enter does the same.",
    cursor: "pointer",
    remembers: []
  }
};

/** With notes on its lower door, how the fridge itself is opened: by the rest of it. */
export const FRIDGE_HOW_WITH_NOTES = "The top of the fridge (its freezer door): select to open the fridge, or to shut it. Left open, it shuts itself after a few seconds. (The lower door opens the notes pinned to it.)";

const CARDS: ReadonlySet<FurnishKind> = new Set<FurnishKind>(["bookcase", "notes", "calendar", "clock", "plant", "radio", "album", "diary"]);

/** The kinds that open a card over the room when chosen (components/pip/roomThings.tsx says what is in it). */
export const opensCard = (kind: FurnishKind) => CARDS.has(kind);

/** What each of the room's own things is called, by its name among the fixtures. */
export const THING_NAMES: Readonly<Record<string, string>> = {
  minifridge: "Mini fridge",
  fridgenotes: "Fridge notes",
  bookcase: "Pip's bookcase",
  calendar: "Wall calendar",
  wallclock: "Wall clock",
  plantpot: "Houseplant",
  radio: "Radio",
  corkboard: "Album board",
  diary: "Pip's diary"
};

/**
 * The least a thing in the room is pressed by, in CSS pixels a side, however
 * small the room is drawn: with a pointer, and under a finger.
 */
export const MIN_TARGET = 24;
export const TOUCH_TARGET = 44;

/** Where a thing is pressed, in CSS pixels from the room's corner. */
export type PressArea = { left: number; top: number; width: number; height: number };

type Reach = { lo: number; hi: number };

/**
 * Where each thing in a room is pressed: its art (`arts`, in floor pixels, in
 * the order they are drawn: a later one lies over an earlier), at `scale` CSS
 * pixels a floor pixel, grown about its middle to `least` a side where the art
 * is smaller. The art itself is not touched: these are the areas a press is
 * heard in, and a press goes to the thing seen under it.
 *
 * No two overlap. Where two would, the ground between them is divided by a
 * line along the way they lie furthest apart: halfway between the two pieces
 * of art, so each keeps all of its own art and the nearer half of the gap.
 * Where the art itself overlaps (a diary lying on a bookcase), the one drawn
 * on top keeps its own and the other has what shows beside it. A thing cut
 * short on one side grows on the other instead, as far as the room (`room`,
 * floor pixels) and its other neighbours let it. One still short of `least`
 * (the plant, with the fridge under it) is given ground by a neighbour that
 * has more than it needs, which stands back as far as its own art at most;
 * between two close neighbours it is what is left, and that may be less.
 */
export const pressAreas = (arts: ReadonlyArray<{ x: number; y: number; w: number; h: number }>, scale: number, least = MIN_TARGET, room?: { w: number; h: number }): PressArea[] => {
  // Each thing's art along each axis (across, then down), and how far it may reach: the room, less what a neighbour has.
  const art = arts.map((box): [Reach, Reach] => [
    { lo: box.x * scale, hi: (box.x + box.w) * scale },
    { lo: box.y * scale, hi: (box.y + box.h) * scale }
  ]);
  const reach = arts.map((): [Reach, Reach] => [
    { lo: room ? 0 : -Infinity, hi: room ? room.w * scale : Infinity },
    { lo: room ? 0 : -Infinity, hi: room ? room.h * scale : Infinity }
  ]);
  /** A thing's area along one axis: its art, grown to `least` about its middle, slid to stay within its reach. */
  const along = (index: number, axis: 0 | 1): Reach => {
    const own = art[index][axis];
    const may = reach[index][axis];
    const size = Math.max(0, Math.min(Math.max(least, own.hi - own.lo), may.hi - may.lo));
    const lo = Math.max(may.lo, Math.min(may.hi - size, (own.lo + own.hi) / 2 - size / 2));
    return { lo, hi: lo + size };
  };
  /** The lines drawn between two things whose art does not overlap: which way, who is on which side, where, and how far it may move. */
  const lines: Array<{ axis: 0 | 1; first: number; second: number; at: number; from: number; to: number }> = [];
  /** Every two that overlap, divided. A pair is divided once and cannot overlap again, so this ends within a pass a pair. */
  const divide = () => {
    for (let pass = arts.length * arts.length; pass > 0; pass -= 1) {
      const now = arts.map((_, index): [Reach, Reach] => [along(index, 0), along(index, 1)]);
      let divided = false;
      for (let a = 0; a < arts.length && !divided; a += 1) {
        for (let b = a + 1; b < arts.length && !divided; b += 1) {
          if (!([0, 1] as const).every((axis) => now[a][axis].hi > now[b][axis].lo + 0.01 && now[b][axis].hi > now[a][axis].lo + 0.01)) continue;
          // Along the way their art lies furthest apart (or, overlapping, overlaps least).
          const apart = (axis: 0 | 1) => Math.max(art[b][axis].lo - art[a][axis].hi, art[a][axis].lo - art[b][axis].hi);
          const axis = apart(0) >= apart(1) ? 0 : 1;
          const [first, second] = art[a][axis].lo + art[a][axis].hi <= art[b][axis].lo + art[b][axis].hi ? [a, b] : [b, a];
          const from = art[first][axis].hi;
          const to = art[second][axis].lo;
          // Halfway between them; or, their art overlapping, at the edge of the one drawn on top (the later), which keeps its own.
          const at = to >= from ? (from + to) / 2 : second > first ? to : from;
          reach[first][axis].hi = Math.min(reach[first][axis].hi, at);
          reach[second][axis].lo = Math.max(reach[second][axis].lo, at);
          if (to >= from) lines.push({ axis, first, second, at, from, to });
          divided = true;
        }
      }
      if (!divided) return;
    }
  };
  /** How much less than `want` a side (or its own art, if that is more) a thing has along an axis (more than it needs: below nought). */
  const short = (index: number, axis: 0 | 1, want: number) => Math.max(want, art[index][axis].hi - art[index][axis].lo) - (reach[index][axis].hi - reach[index][axis].lo);
  /**
   * A line moved over for the one of its two that is short of `want` and has
   * the line for its edge: by what it lacks, as far as the other can spare
   * (all of the ground the other does not reach anyway, a nearer neighbour of
   * its own having stopped it short of the line), and never into the other's
   * art. Says whether any moved.
   */
  const ease = (want: number) => {
    let moved = false;
    for (const line of lines) {
      const { axis, first, second } = line;
      const before = reach[first][axis];
      const after = reach[second][axis];
      if (before.hi === line.at && short(first, axis, want) > 0.01) {
        const by = Math.min(short(first, axis, want), after.lo - line.at + Math.max(0, -short(second, axis, want)), line.to - line.at);
        if (by > 0.01) {
          line.at += by;
          before.hi = line.at;
          after.lo = Math.max(after.lo, line.at);
          moved = true;
        }
      } else if (after.lo === line.at && short(second, axis, want) > 0.01) {
        const by = Math.min(short(second, axis, want), line.at - before.hi + Math.max(0, -short(first, axis, want)), line.at - line.from);
        if (by > 0.01) {
          line.at -= by;
          after.lo = line.at;
          before.hi = Math.min(before.hi, line.at);
          moved = true;
        }
      }
    }
    return moved;
  };
  // Divided, eased, and divided again: a thing that stood back for one neighbour may have come up against another.
  // Under a finger, where few have 44 px to spare, once more by a pointer's least: none is left with less than
  // that while its neighbour has more.
  for (const want of least > MIN_TARGET ? [least, MIN_TARGET] : [least]) {
    for (let round = 0; round < 6; round += 1) {
      divide();
      if (!ease(want)) break;
    }
  }
  divide();
  return arts.map((_, index) => {
    const across = along(index, 0);
    const down = along(index, 1);
    return { left: across.lo, top: down.lo, width: across.hi - across.lo, height: down.hi - down.lo };
  });
};

/** The pieces of decor that can be used, and as what. Pictures: what hangs from one nail. */
const KIND_OF: Record<string, FurnishKind> = {
  window: "curtains",
  poster: "picture",
  dorianportrait: "picture",
  scarletletter: "picture",
  footprintmap: "picture",
  starmap: "picture",
  chocoticket: "picture",
  shalottmirror: "picture",
  bed: "bed",
  // The windows with no curtains of their own: somewhere to look out of.
  roundwindow: "window",
  archedwindow: "window",
  baywindow: "window",
  stainedglass: "window",
  skylight: "window",
  // Books to take one from (the same pieces Pip reads at of her own accord).
  bookstack: "books",
  bookshelf: "books",
  tallshelf: "books",
  desk: "books",
  lectern: "books",
  // Lights with a warm bulb or flame, which the house art can draw unlit (house.js, `off`).
  lamp: "lamp",
  hangingbulb: "lamp",
  chandelier: "lamp",
  paperlantern: "lamp",
  wallsconce: "lamp",
  candles: "lamp",
  // Not decor but a fixture of the bedroom (home.js, `fridgeBox`): every Pip has one.
  // (The Kitchen's Retro Fridge, "fridge", is decor, and is not one of these yet.)
  minifridge: "fridge",
  // Fixtures too: the bookcase the reader's finished books stand in, what is pinned to the fridge's door,
  // and the rest of what every bedroom has (pip/house-fixtures.js).
  bookcase: "bookcase",
  fridgenotes: "notes",
  calendar: "calendar",
  wallclock: "clock",
  plantpot: "plant",
  radio: "radio",
  corkboard: "album",
  diary: "diary",
  // Things that answer a tap, and have Pip come over (`VISITS`, below, says what each one does).
  // The bedroom's own: (the armchair is not one of these: she sits in it of her own accord.)
  aquarium: "visit",
  fireplace: "visit",
  clock: "visit",
  globe: "visit",
  recordplayer: "visit",
  catbed: "visit",
  plant: "visit",
  trophyshelf: "visit",
  readingnook: "visit",
  beanbag: "visit",
  fairylights: "visit",
  // And the house's:
  lavalamp: "visit",
  mushroomlamp: "visit",
  fishbowl: "visit",
  cattower: "visit",
  piano: "visit",
  gnome: "visit",
  tulips: "visit",
  sunflowers: "visit",
  bonsai: "visit",
  hangingplant: "visit",
  pond: "visit",
  hammock: "visit",
  stringlights: "visit",
  neonread: "visit",
  ceilingfan: "visit",
  trophywall: "visit",
  discoball: "visit",
  robotbuddy: "visit",
  controller: "visit",
  // The toys: drawn to be played with.
  trampoline: "visit",
  musicbox: "visit",
  bubblemachine: "visit"
};

export const kindOf = (itemId: string): FurnishKind | null => KIND_OF[itemId] ?? null;

/** One furnishing's name on this device: the floor, the slot it is in, and the piece (another piece in the slot starts afresh). */
export const furnishKey = (levelId: string, slotId: string, itemId: string) => `${levelId}/${slotId}:${itemId}`;

// ---- what is remembered ------------------------------------------------------------
//
// One localStorage entry for the whole house: `{ "bedroom/window-1:window": { "closed": 1 } }`.
// Read tolerantly (anything unexpected is dropped), and only non-default
// values are kept, so a house nobody has touched stores nothing.

export const FURNISH_STORE = "leaflet.pip.furnish";

export type Remembered = Record<string, FurnishState>;

/** The most crooked a picture hangs. */
export const TILT_MAX = 0.36;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** What a kind keeps of a state: its own fields, in range, and nothing that is just the default. */
export const kept = (kind: FurnishKind, state: FurnishState): FurnishState => {
  const out: FurnishState = {};
  const fields = KINDS[kind].remembers;
  if (fields.includes("closed") && finite(state.closed) && state.closed >= 0.5) out.closed = 1;
  if (fields.includes("dx") && finite(state.dx) && Math.abs(state.dx) >= 0.5) out.dx = Math.max(-400, Math.min(400, Math.round(state.dx)));
  if (fields.includes("off") && state.off === true) out.off = true;
  if (fields.includes("tilt") && finite(state.tilt) && Math.abs(state.tilt) > 0.01) out.tilt = Number(Math.max(-TILT_MAX, Math.min(TILT_MAX, state.tilt)).toFixed(3));
  return out;
};

export const parseRemembered = (text: string | null | undefined): Remembered => {
  if (!text) return {};
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Remembered = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || !/^[^/:]+\/[^/:]+:[^/:]+$/.test(key)) continue;
      const kind = kindOf(key.slice(key.indexOf(":") + 1));
      if (!kind) continue;
      const state = kept(kind, value as FurnishState);
      if (Object.keys(state).length > 0) out[key] = state;
    }
    return out;
  } catch {
    return {};
  }
};

/** The remembered house with one furnishing's state set (or forgotten, when it is back to how it comes). */
export const withRemembered = (all: Remembered, key: string, kind: FurnishKind, state: FurnishState): Remembered => {
  const next = { ...all };
  const keep = kept(kind, state);
  if (Object.keys(keep).length > 0) next[key] = keep;
  else delete next[key];
  return next;
};

// ---- what Pip makes of it ------------------------------------------------------------

/** Something Pip does in answer, where she stands, turned to the thing: a move, a line, and maybe a second thought. */
export type Reaction = {
  move: string;
  loops: number;
  line: string | null;
  sound?: PipSound;
  /** What she does next, once the first is over. */
  then?: Reaction;
  /** It has made her sleepy: if there is a bed, she is off to it. */
  sleepy?: boolean;
};

/** After dark, as the house keeps it (the room dims and the lamps glow from 7 in the evening to 6). */
export const dark = (hour: number) => hour >= 19 || hour < 6;
/** Morning, when opening the curtains wakes a sleeper. */
export const morning = (hour: number) => hour >= 6 && hour < 12;

// ---- curtains ---------------------------------------------------------------------------
//
// Drawn by a tap (they glide shut, or open), or pulled by a drag: the hand's
// move towards the middle of the window draws them, away from it opens them,
// from wherever they were. Let go, they settle the nearer way.

/** A tap's glide from open to closed, in seconds. */
export const CURTAIN_GLIDE = 0.28;

/**
 * How far drawn after the hand has moved: `from` and `to` are how far the
 * hand was and is from the middle of the window, `half` is half the window's
 * width, all in the same pixels.
 */
export const curtainPull = (closed: number, from: number, to: number, half: number) => clamp01(closed + (from - to) / Math.max(1, half));

/**
 * A pull on them, anywhere and any way: open ones are drawn by it and drawn
 * ones opened, by how far the hand has gone as a share of half the window
 * (and a good deal quicker than the hand: a short pull is enough). Going
 * back undoes it. `curtainPull` above wanted the hand to go towards the
 * middle of the window to draw them, which is how a curtain is drawn and
 * not how anybody guesses a picture of one works: a press in the middle of
 * the glass could not draw them at all.
 */
export const curtainTug = (before: number, moved: number, half: number) => clamp01(before + (before >= 0.5 ? -1 : 1) * (moved / Math.max(1, half)) * 1.6);

/**
 * Where they end up when the hand lets go. `most` is the most they were
 * moved from how they were, `closed` how they are now. Hardly moved at all,
 * it was a tap with an unsteady hand, and a tap sends them the other way;
 * pulled and then put back, they stay as they were; pulled and let go,
 * they go the rest of the way, however short the pull was.
 */
export const curtainLetGo = (before: number, closed: number, most: number): 0 | 1 => {
  const was: 0 | 1 = before >= 0.5 ? 1 : 0;
  const other: 0 | 1 = was === 1 ? 0 : 1;
  if (most < 0.1) return other;
  return Math.abs(closed - before) < 0.05 ? was : other;
};

/** Where curtains let go of at `closed` end up: closed, or open. */
export const curtainSettle = (closed: number): 0 | 1 => (closed >= 0.5 ? 1 : 0);

/** Where a tap sends them: the other way. */
export const curtainToggle = (closed: number): 0 | 1 => (closed >= 0.5 ? 0 : 1);

/** A moment later on the way to `target`; at once when motion is reduced. */
export const curtainStep = (closed: number, target: number, dt: number, still = false) => {
  if (still) return target;
  const step = dt / CURTAIN_GLIDE;
  return Math.abs(target - closed) <= step ? target : closed + Math.sign(target - closed) * step;
};

/**
 * How much the room dims for its drawn curtains, 0 to 1 (the scene lays a
 * shade of that strength over it). More by day, when there is light to shut
 * out; a little at night, for the moon. `closed` is each window's, 0 to 1.
 */
export const roomShade = (closed: readonly number[], night: boolean) => {
  if (closed.length === 0) return 0;
  const drawn = closed.reduce((sum, value) => sum + clamp01(value), 0) / closed.length;
  return Number((drawn * (night ? 0.12 : 0.26)).toFixed(3));
};

/** What Pip makes of the curtains being drawn, or opened, at this hour. */
export const curtainReaction = (closed: boolean, hour: number): Reaction => {
  if (closed) {
    return dark(hour)
      ? { move: "yawn", loops: 1, line: "mm. cosy. bedtime?", sleepy: true }
      : { move: "squint", loops: 2, line: "hey! i was using that sun.", sound: "squeak", then: { move: "shift", loops: 1, line: "...fine. it's cosy." } };
  }
  return dark(hour) ? { move: "gaze", loops: 1, line: "ooh. stars." } : { move: "stretch", loops: 1, line: "ah. there's the day." };
};

// ---- a picture on the wall -------------------------------------------------------------
//
// It hangs from one nail, so it is a pendulum, the same one as Pip in the
// hand (pip/play.ts, `holdStep`): nudged, it swings about the way it hangs and
// settles; slid along the wall, it swings behind the hand that slides it. A
// nudge also leaves it hanging crooked (the nail has friction), until it is
// nudged back from the other side, or Pip comes and straightens it.

/** A picture as it hangs: where along the wall, how crooked at rest, and its swing about that (as a Pip's in the hand). */
export type Hanging = { dx: number; tilt: number; hold: Hold };

export const hangingFrom = (state: FurnishState): Hanging => ({ dx: state.dx ?? 0, tilt: state.tilt ?? 0, hold: holdStart() });

/** How far it is turned right now, for drawing: the way it hangs, and its swing about that. */
export const hangingAngle = (picture: Hanging) => picture.tilt + picture.hold.swing.angle;

/** How hard a nudge sets it swinging (radians a second), and how much more crooked each one leaves it. */
const NUDGE_SPIN = 3;
const NUDGE_TILT = 0.18;

/**
 * Nudged on one side (1: its right, which turns it clockwise; -1: its left).
 * It swings from where it is, and comes to rest more crooked that way; a
 * crooked one nudged from the other side goes back to straight.
 */
export const nudge = (picture: Hanging, side: 1 | -1): Hanging => {
  const back = picture.tilt !== 0 && Math.sign(picture.tilt) !== side;
  const tilt = back ? 0 : Math.max(-TILT_MAX, Math.min(TILT_MAX, picture.tilt + side * NUDGE_TILT));
  const { swing } = picture.hold;
  // The same picture on screen, now swinging about the new way it hangs.
  return { ...picture, tilt, hold: { ...picture.hold, swing: { angle: picture.tilt + swing.angle - tilt, spin: swing.spin + side * NUDGE_SPIN } } };
};

/** As crooked as it goes, and knocked the same way once more: it comes off its nail. */
export const comesDown = (picture: Hanging, side: 1 | -1) => Math.abs(picture.tilt) >= TILT_MAX - 1e-9 && Math.sign(picture.tilt) === side;

/** A picture on its way to the floor: how far down it has got (floor pixels), how fast, and whether it has come to rest. */
export type Fall = { y: number; vy: number; landed: boolean };
const FALL_GRAVITY = 560;
export const fallStart = (): Fall => ({ y: 0, vy: 0, landed: false });
/**
 * A moment later on the way down. `drop` is how far below where it hung the
 * floor is. It bounces once, a little, and lies there. At once when motion
 * is reduced.
 */
export const fallStep = (fall: Fall, dt: number, drop: number, still = false): Fall => {
  if (fall.landed) return fall;
  if (still) return { y: drop, vy: 0, landed: true };
  const vy = fall.vy + FALL_GRAVITY * dt;
  const y = fall.y + vy * dt;
  if (y < drop) return { y, vy, landed: false };
  // Hard enough, it comes up again a little; else that is where it stays.
  return vy > 110 ? { y: drop, vy: -vy * 0.28, landed: false } : { y: drop, vy: 0, landed: true };
};
/** What Pip makes of a picture coming down. */
export const fallenReaction = (): Reaction => ({ move: "jumpscare", loops: 1, line: "it fell off the wall!" });

/** Set straight (by Pip): it swings a little about plumb and settles there. */
export const straighten = (picture: Hanging): Hanging => {
  const { swing } = picture.hold;
  return { ...picture, tilt: 0, hold: { ...picture.hold, swing: { angle: picture.tilt + swing.angle, spin: swing.spin * 0.3 } } };
};

/** Slid to `dx` along the wall by a hand at `sample`: it swings behind the hand. */
export const slideTo = (picture: Hanging, dx: number, before: Sample | undefined, sample: Sample): Hanging => ({ ...picture, dx, hold: holdMove(picture.hold, before, sample) });

/** A frame later. Without motion it simply hangs as it should. */
export const hangStep = (picture: Hanging, dt: number, still = false): Hanging => ({ ...picture, hold: still ? holdStart() : holdStep(picture.hold, dt) });

/** Whether it has stopped swinging. */
export const hangsStill = (picture: Hanging) =>
  Math.abs(picture.hold.swing.angle) < 0.006 && Math.abs(picture.hold.swing.spin) < 0.04 && Math.abs(picture.hold.handVx) < 1;

/** Whether it is not as the room's own picture draws it (moved, crooked or swinging), so the scene has to draw it. */
export const hangsOff = (picture: Hanging) => picture.dx !== 0 || picture.tilt !== 0 || !hangsStill(picture);

export type Span = { min: number; max: number };
type Box = { x: number; y: number; w: number; h: number };

/**
 * How far a picture can slide along the wall: `dx` from `min` to `max`. It
 * stays on the wall, and stops `gap` short of the nearest thing either side
 * that it would otherwise hang over (the window, a shelf, another picture).
 * A thing it already overlaps where it starts (the room was laid out that
 * way) does not count.
 */
export const freeSpan = (picture: Box, others: readonly Box[], wallWidth: number, gap = 2): Span => {
  let min = 2 - picture.x;
  let max = wallWidth - 2 - picture.w - picture.x;
  for (const other of others) {
    // Not beside it on the wall: above or below, it is never in the way.
    if (other.y >= picture.y + picture.h + gap || other.y + other.h <= picture.y - gap) continue;
    if (other.x + other.w <= picture.x) min = Math.max(min, other.x + other.w + gap - picture.x);
    else if (other.x >= picture.x + picture.w) max = Math.min(max, other.x - gap - picture.w - picture.x);
  }
  return { min: Math.min(0, min), max: Math.max(0, max) };
};

export const withinSpan = (dx: number, span: Span) => Math.max(span.min, Math.min(span.max, dx));

/** What Pip makes of a picture knocked crooked (once it is; not of every swing). */
export const crookedReaction = (): Reaction => ({ move: "look", loops: 1, line: "that picture is crooked now." });

// ---- the bed -----------------------------------------------------------------------------
//
// Put to bed by the reader in the daytime, Pip has a nap and gets up again by
// herself; after dark she is in bed for the night, as when she goes of her
// own accord (tapping her wakes her, either way).

/** How long she sleeps when put to bed at this hour, in seconds; null: until morning. */
export const bedSleep = (hour: number, rand: () => number): number | null => (dark(hour) ? null : 30 + rand() * 15);

// ---- a light ------------------------------------------------------------------------------
//
// Switched off, a lamp is drawn unlit and casts no glow, so after dark the
// room is that much darker (the house art does both: house.js, `off`).

/** What Pip makes of a light switched off or on at this hour; nothing by day, when it makes no odds. */
export const lampReaction = (off: boolean, hour: number): Reaction | null => {
  if (!dark(hour)) return null;
  return off ? { move: "squint", loops: 1, line: "who turned out the light?" } : { move: "look", loops: 1, line: "ah. that's better." };
};

// ---- things she comes over to ---------------------------------------------------------------
//
// Most of the room's pieces are something to her: fish to watch, a fire to
// warm her leaf at, a cuckoo that makes her jump every time. Chosen, the
// thing answers at once (a sound, a few bubbles or notes off it), and Pip, if
// she is free, comes over and does what one does with it. All for show: no
// seeds, no mood, nothing bought or kept (pip/behaviour.ts says why, by the
// fridge). The moves are ones she already has; a dance is one of her own
// (a move the reader bought her, or a little bop if she has none), so a
// record player never gives away what the shop sells.

/** What comes off a thing as it answers: drawn by the room (components/pip/furnishings.tsx). */
export type VisitFx = "notes" | "bubbles" | "hearts" | "sparks" | "lights" | "drops";

/**
 * One thing she does there. `move: "dance"` is one of her dances (`visitBeats`
 * chooses), and `move: "bounce"` is not a move at all but so many bounces on
 * the thing (`bounces`: the house scene throws her up, as a hand would; without
 * motion she stays on her feet, knees bent). One of `lines` is said as it
 * starts; `sound` is heard then.
 */
export type VisitBeat = { move: string; seconds: number; lines?: readonly string[]; sound?: PipSound; bounces?: number };

export type Visit = {
  /** What choosing it does, for its label and its tooltip. */
  how: string;
  /** What she is doing there, in plain words, for her own label: "watching the fish". */
  label: string;
  /**
   * Where she does it: `beside` the thing, turned to it; `at` it (in front of
   * it, or under it); or wherever she is (`stay`: the cuckoo is heard from
   * anywhere). A thing up on a wall, a shelf or the ceiling is always stood under.
   */
  stand: "beside" | "at" | "stay";
  /** What the thing itself does as it is chosen (and again as she reaches it, if she had some way to come). */
  sound?: PipSound;
  pitch?: number;
  fx?: VisitFx;
  /** The dance she would rather do here, if it is one of hers (the disco ball: the disco). */
  dance?: string;
  beats: readonly VisitBeat[];
};

const watering = (what: string, lines: readonly string[]): Visit => ({
  how: `Select to have Pip come and water the ${what}.`,
  label: `watering the ${what}`,
  stand: "beside",
  fx: "drops",
  beats: [{ move: "water", seconds: 4, lines, sound: "splash" }]
});

const VISITS: Readonly<Record<string, Visit>> = {
  aquarium: {
    how: "Select to have Pip come and watch the fish.",
    label: "watching the fish",
    stand: "beside",
    sound: "bubble",
    fx: "bubbles",
    beats: [{ move: "inspect", seconds: 4, lines: ["hello in there.", "blub. blub.", "that one's my favourite."] }]
  },
  fireplace: {
    how: "Select to have Pip come and warm herself by the fire.",
    label: "warming herself by the fire",
    stand: "beside",
    sound: "crackle",
    fx: "sparks",
    beats: [
      { move: "stretch", seconds: 3.3, lines: ["ahh. toasty.", "warm leaf. happy leaf."] },
      { move: "yawn", seconds: 4, lines: ["...so warm."] }
    ]
  },
  clock: {
    how: "Select to set the cuckoo off.",
    label: "being made to jump by the cuckoo",
    stand: "stay",
    sound: "cuckoo",
    beats: [
      { move: "boop", seconds: 1, lines: ["eep!"] },
      { move: "laugh", seconds: 2, lines: ["it gets me every time.", "cuckoo yourself."] }
    ]
  },
  globe: {
    how: "Select to give the globe a spin.",
    label: "watching the globe go round",
    stand: "beside",
    sound: "swish",
    beats: [{ move: "dizzy", seconds: 4, lines: ["round and round and... whoa.", "where does it stop? there. no, there."] }]
  },
  recordplayer: {
    how: "Select to put a record on: Pip comes to dance.",
    label: "dancing to a record",
    stand: "beside",
    sound: "tune",
    fx: "notes",
    beats: [{ move: "dance", seconds: 5, lines: ["this is my song.", "turn it up!"] }]
  },
  catbed: {
    how: "Select to have Pip come and fuss the cat.",
    label: "fussing the cat",
    stand: "beside",
    sound: "mew",
    fx: "hearts",
    beats: [{ move: "smitten", seconds: 4, lines: ["who's the softest? you are.", "she lets me do that. only me."], sound: "purr" }]
  },
  plant: watering("monstera", ["drink up.", "there you go, big leaf."]),
  trophyshelf: {
    how: "Select to have Pip come and admire the trophies.",
    label: "admiring the trophies",
    stand: "at",
    sound: "star",
    fx: "sparks",
    beats: [{ move: "champ", seconds: 4, lines: ["most chapters in one sitting: me.", "we earned every one."] }]
  },
  readingnook: {
    how: "Select for a game of ghosts at the tent.",
    label: "playing ghosts at the tent",
    stand: "at",
    beats: [
      { move: "ghost", seconds: 5.3, lines: ["boo!", "whooo. i am the ghost of the tent."] },
      { move: "laugh", seconds: 2, lines: ["it was me. it was pip."] }
    ]
  },
  beanbag: {
    how: "Select to have Pip come and flop on the beanbag.",
    label: "flopped on the beanbag",
    stand: "at",
    sound: "bounce",
    beats: [{ move: "floatnap", seconds: 4, lines: ["flump.", "just resting my leaf."] }]
  },
  fairylights: {
    how: "Select to have Pip come and look at the lights.",
    label: "looking at the fairy lights",
    stand: "at",
    sound: "chime",
    pitch: 1.4,
    fx: "sparks",
    beats: [{ move: "gaze", seconds: 4, lines: ["twinkle, twinkle.", "like reading under the stars."] }]
  },
  lavalamp: {
    how: "Select to have Pip come and watch the lamp.",
    label: "watching the lava lamp",
    stand: "beside",
    sound: "bubble",
    pitch: 0.6,
    beats: [{ move: "gaze", seconds: 4, lines: ["bloop. bloop.", "it never does the same thing twice."] }]
  },
  mushroomlamp: {
    how: "Select to have Pip come and look at the mushroom.",
    label: "looking at the mushroom lamp",
    stand: "beside",
    sound: "chime",
    pitch: 1.5,
    beats: [{ move: "idea", seconds: 3.3, lines: ["it glows. i glow. friends.", "a night light for a sprout."] }]
  },
  fishbowl: {
    how: "Select to have Pip come and watch the goldfish.",
    label: "watching the goldfish",
    stand: "at",
    sound: "bubble",
    fx: "bubbles",
    beats: [{ move: "inspect", seconds: 3, lines: ["one fish. i named her chapter.", "hello, chapter."] }]
  },
  cattower: {
    how: "Select to have Pip come and call the cat down.",
    label: "calling the cat down",
    stand: "beside",
    sound: "mew",
    beats: [
      { move: "pointup", seconds: 2.7, lines: ["pspsps.", "come down? please?"] },
      { move: "shift", seconds: 2, lines: ["...fine. be like that."] }
    ]
  },
  piano: {
    how: "Select to have Pip come and play the piano.",
    label: "playing the piano",
    stand: "at",
    sound: "tune",
    fx: "notes",
    beats: [{ move: "gamer", seconds: 4, lines: ["i only know one song.", "and now, the difficult bit."] }]
  },
  gnome: {
    how: "Select to have Pip come and inspect the gnome.",
    label: "inspecting the gnome",
    stand: "beside",
    beats: [
      { move: "inspect", seconds: 3, lines: ["he moved. i saw him move.", "what are you guarding, then?"] },
      { move: "glance", seconds: 3 }
    ]
  },
  tulips: watering("tulips", ["a drink for each of you.", "drink up."]),
  sunflowers: watering("sunflowers", ["up you grow.", "taller than me. show-offs."]),
  bonsai: watering("bonsai", ["just a sip. you're small.", "a hundred years old, and thirsty."]),
  hangingplant: {
    how: "Select to have Pip come and say hello to the fern.",
    label: "saying hello to the fern",
    stand: "at",
    beats: [{ move: "gaze", seconds: 4, lines: ["hello up there.", "nice fronds."] }]
  },
  pond: {
    how: "Select to have Pip come and look in the pond.",
    label: "looking in the pond",
    stand: "beside",
    sound: "splash",
    fx: "drops",
    beats: [
      { move: "inspect", seconds: 3, lines: ["is that a frog?"] },
      { move: "boop", seconds: 1, lines: ["it *is* a frog."] }
    ]
  },
  hammock: {
    how: "Select to have Pip come and lie in the hammock.",
    label: "swinging in the hammock",
    stand: "at",
    beats: [{ move: "floatnap", seconds: 6, lines: ["five minutes.", "wake me at the good bit."] }]
  },
  stringlights: {
    how: "Select to have Pip come and look at the lights.",
    label: "looking at the string lights",
    stand: "at",
    sound: "chime",
    pitch: 1.4,
    fx: "sparks",
    beats: [{ move: "gaze", seconds: 4, lines: ["twinkle, twinkle.", "one's out. no, it's back."] }]
  },
  neonread: {
    how: "Select to have Pip come and read the sign.",
    label: "reading the sign",
    stand: "at",
    sound: "click",
    beats: [{ move: "pointup", seconds: 2.7, lines: ["r. e. a. d. good advice.", "it says read. so."] }]
  },
  ceilingfan: {
    how: "Select to have Pip come and cool off under the fan.",
    label: "cooling off under the fan",
    stand: "at",
    sound: "swish",
    beats: [{ move: "stretch", seconds: 3.3, lines: ["ahh. breezy.", "it ruffles my leaf."] }]
  },
  trophywall: {
    how: "Select to have Pip come and admire the medals.",
    label: "admiring the medals",
    stand: "at",
    sound: "star",
    fx: "sparks",
    beats: [{ move: "champ", seconds: 4, lines: ["gold, silver, bronze. all for reading.", "we earned every one."] }]
  },
  discoball: {
    how: "Select to start the disco: Pip comes to dance.",
    label: "dancing under the disco ball",
    stand: "at",
    sound: "tune",
    fx: "lights",
    dance: "disco",
    beats: [{ move: "dance", seconds: 5, lines: ["lights!", "it's a disco now."] }]
  },
  robotbuddy: {
    how: "Select to have Pip come and dance with the robot.",
    label: "dancing with the robot",
    stand: "beside",
    sound: "click",
    pitch: 1.3,
    dance: "robot",
    beats: [{ move: "dance", seconds: 4, lines: ["beep boop. we are dancing.", "he taught me this one."] }]
  },
  controller: {
    how: "Select to have Pip come and have a go.",
    label: "having a go on the controller",
    stand: "at",
    sound: "click",
    beats: [{ move: "gamer", seconds: 3, lines: ["player two has entered the game.", "one more level."] }]
  },
  trampoline: {
    how: "Select to have Pip come and bounce on the trampoline.",
    label: "bouncing on the trampoline",
    stand: "at",
    sound: "bounce",
    pitch: 0.8,
    beats: [
      { move: "bounce", seconds: 2.5, bounces: 4, lines: ["boing!", "watch this!", "higher!"] },
      { move: "cheer", seconds: 2, lines: ["again! again!", "did you see how high?"] }
    ]
  },
  musicbox: {
    how: "Select to wind the music box: Pip comes to listen.",
    label: "listening to the music box",
    stand: "beside",
    sound: "tune",
    pitch: 1.5,
    fx: "notes",
    // (Her little bop, not a dance of her own: it is that sort of tune.)
    beats: [{ move: "bop", seconds: 5, lines: ["plink. plink. plink.", "wind it again?"] }]
  },
  bubblemachine: {
    how: "Select to switch the bubbles on: Pip comes to pop them.",
    label: "popping bubbles",
    stand: "beside",
    sound: "bubble",
    pitch: 1.2,
    fx: "bubbles",
    beats: [
      { move: "beg", seconds: 3, lines: ["pop! pop! pop!", "that one's mine."], sound: "bubble" },
      { move: "laugh", seconds: 2, lines: ["one landed on my leaf."] }
    ]
  }
};

/** What a piece of decor does when it is chosen and Pip comes over; null for a piece that is not one of these. */
export const visitOf = (itemId: string): Visit | null => VISITS[itemId] ?? null;

/** Every piece that is one of these, for the tests. */
export const VISIT_IDS: readonly string[] = Object.keys(VISITS);

/** The dance she falls back on, with no dance of her own (the Play rail's Dance key does the same). */
export const BOP = "bop";

/** How a bounce on a thing is written among the beats: not a move (see `VisitBeat`). */
export const BOUNCE = "bounce";

/** A beat, ready to play: the move it comes to, for how long, the line said and the sound heard as it starts; or (`BOUNCE`) so many bounces. */
export type VisitStep = { move: string; seconds: number; line?: string; sound?: PipSound; bounces?: number };

/**
 * A visit's beats as she will do them now: each `dance` turned into one of
 * her dances (`dances`: the ones she owns), the one the thing asks for if she
 * has it, a bop if she has none; and one of each beat's lines chosen.
 */
export const visitBeats = (visit: Visit, dances: readonly string[], rand: () => number): VisitStep[] =>
  visit.beats.map((beat) => {
    const move = beat.move !== "dance" ? beat.move : visit.dance && dances.includes(visit.dance) ? visit.dance : dances.length > 0 ? pickLine(dances, rand) : BOP;
    const line = beat.lines && beat.lines.length > 0 ? pickLine(beat.lines, rand) : undefined;
    return { move, seconds: beat.seconds, line, sound: beat.sound, ...(beat.move === BOUNCE ? { bounces: Math.max(1, beat.bounces ?? 3) } : {}) };
  });

/**
 * What a visit offers Pip of her own accord, in a free moment
 * (pip/behaviour.ts, `Offer`): its first beat, now and then. Not the music:
 * she dances by herself already, at a record player or without one.
 */
export const visitOffer = (visit: Visit): Offer | null => {
  const first = visit.beats[0];
  // (Nor a bounce, which is not a move she can be handed.)
  if (!first || first.move === "dance" || first.move === BOUNCE || visit.stand === "stay") return null;
  return { label: visit.label, move: first.move, seconds: first.seconds, lines: first.lines, weight: 0.4, use: "answer" };
};

// ---- the fridge ---------------------------------------------------------------------------
//
// A fixture of the bedroom, not decor (pip/home.js stands it where there is
// room). The door opens under the hand and shuts itself; a hum while it is
// open, a click and a thud as it shuts. Opening it gives nothing: snacks are
// still bought as they are given, from Pip's things. What it is for is Pip,
// who hears it open and comes over hopefully, goes to it for the snack the
// reader is about to choose, and (pip/behaviour.ts) raids it at night.
//
// Since 2026-10-13 (the owner's request) what she finds there matters. Each
// snack bought stocks the fridge for a day, three days at most in hand; Rust
// works that out from the purchases (pip/fridge.rs) and the art draws it
// stocked or bare. Bare, she droops when she looks, and the first look of a
// day costs her a little mood (never below the floor being away stops at).
// Nothing is charged for time the app was shut: she has to look.

/** A door the reader opened shuts itself after this long, in seconds. */
export const FRIDGE_OPEN_S = 8;
/** She has arrived at an open door: it stays open at least this much longer, in seconds, so it does not shut in her face. */
export const FRIDGE_LINGER_S = 4.5;
/** Opened by Pip for the snack the reader is choosing: she waits this long for it, in seconds, before giving up. */
export const FRIDGE_WAIT_S = 16;
/** The hum comes again this often while the door is open, in seconds (each one overlaps the last: pip/sound.ts). */
export const FRIDGE_HUM_S = 1.2;

/**
 * When a door opened at `openedAt` shuts, as things stand at `now` (both in
 * seconds): a few seconds after it was opened, later if Pip has come to look
 * (`pipAt`: when she got there), and not at all while she holds it open
 * herself (`held`: she shuts it when she is done).
 */
export const fridgeShutsAt = (openedAt: number, pipAt: number | null, held: boolean) =>
  held ? Infinity : Math.max(openedAt + FRIDGE_OPEN_S, pipAt === null ? 0 : pipAt + FRIDGE_LINGER_S);

const pickLine = (lines: readonly string[], rand: () => number) => lines[Math.min(lines.length - 1, Math.floor(rand() * lines.length))];

const HOPE_LINES = ["ooh. is it snack time?", "i heard the fridge.", "anything good in there?", "just looking. unless...?"];
const SHUT_LINES = ["...oh.", "and it's gone.", "worth a look."];
const FETCH_LINES = ["snack time. my favourite time.", "let's see what we've got.", "ooh. choices."];
const NOTHING_LINES = ["nothing? okay. i wasn't hungry anyway.", "no snack. noted.", "i'll just shut this, then."];

/** What Pip makes of the reader opening the fridge: over she comes, on her toes. */
export const fridgeHope = (rand: () => number): Reaction => ({ move: "beg", loops: 3, line: pickLine(HOPE_LINES, rand) });
/** The door shut while she was still hoping. */
export const fridgeShutOnHer = (rand: () => number): Reaction => ({ move: "shift", loops: 1, line: pickLine(SHUT_LINES, rand) });
/** She has opened it herself, for the snack the reader is choosing (the Play rail's Snack key). */
export const fridgeFetch = (rand: () => number): Reaction => ({ move: "beg", loops: Math.round(FRIDGE_WAIT_S / (16 / 12)), line: pickLine(FETCH_LINES, rand) });
/** No snack came: she shuts the door again. */
export const fridgeNothing = (rand: () => number): Reaction => ({ move: "shift", loops: 1, line: pickLine(NOTHING_LINES, rand) });

/** What its label and its tooltip say of what is in it. */
export const fridgeHolds = (bare: boolean) => (bare ? "nothing in it" : "food in it");
export const FRIDGE_HOW_BARE = "It is bare: a snack for Pip stocks it for a day.";
export const FRIDGE_HOW_STOCKED = "There is food in it: each snack for Pip stocks it for a day.";

// How often she droops over a bare fridge is this device's to remember (one
// localStorage entry, like the furnishings above): a couple of times a day at
// the very most, and not twice in an afternoon. The mood it costs is Rust's
// business, and stricter: once a day. Also remembered: that she last found it
// bare, so that the first time she finds food in it again she can be pleased.

export const BARE_STORE = "leaflet.pip.bareFridge";
/** She droops over a bare fridge at most this often in a day... */
export const BARE_DROOPS_PER_DAY = 2;
/** ...and not again within this long of the last time, in milliseconds. */
export const BARE_DROOP_GAP_MS = 3 * 60 * 60 * 1000;

/** `day`: the local day `times` belongs to; `at`: when she last drooped (epoch ms); `wasBare`: she last found it bare. */
export type BareSeen = { day: string; times: number; at: number; wasBare: boolean };

export const bareSeenStart = (): BareSeen => ({ day: "", times: 0, at: 0, wasBare: false });

export const parseBareSeen = (text: string | null | undefined): BareSeen => {
  if (!text) return bareSeenStart();
  try {
    const raw = JSON.parse(text) as Partial<BareSeen> | null;
    if (!raw || typeof raw !== "object") return bareSeenStart();
    return {
      day: typeof raw.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : "",
      times: finite(raw.times) ? Math.max(0, Math.floor(raw.times)) : 0,
      at: finite(raw.at) ? Math.max(0, raw.at) : 0,
      wasBare: raw.wasBare === true
    };
  } catch {
    return bareSeenStart();
  }
};

/** Whether a bare fridge still gets a droop out of her, on the local day `today` at `now` (epoch ms). */
export const bareMinds = (seen: BareSeen, today: string, now: number) =>
  seen.day !== today ? true : seen.times < BARE_DROOPS_PER_DAY && now - seen.at >= BARE_DROOP_GAP_MS;

/** She has looked in a bare fridge and drooped over it. */
export const bareFound = (seen: BareSeen, today: string, now: number): BareSeen => ({ day: today, times: seen.day === today ? seen.times + 1 : 1, at: now, wasBare: true });

/** She has found food in it: what she remembers of it being bare is over. */
export const foodFound = (seen: BareSeen): BareSeen => ({ ...seen, wasBare: false });

/** Where Pip stands at a fridge whose box is this: at its handle (the left; the door swings out to the right), turned to it. */
export const fridgeStand = (box: { x: number; w: number }, floorW: number): { x: number; face: 1 | -1 } => {
  const left = Math.round(box.x - 10);
  // No room on that side (a fridge by the left wall): the other, past the open door.
  return left >= 18 ? { x: left, face: 1 } : { x: Math.min(floorW - 18, Math.round(box.x + box.w + 15)), face: -1 };
};

// ---- the notes on the fridge ----------------------------------------------------------------
//
// The reader's latest highlights, pinned to the fridge's lower door under a
// magnet each: up to three, one from each book while there are books to go
// round. Chosen (the notes, not the door: the freezer door above them still
// opens the fridge), they are read in a card, and one can be opened in its
// book. Nothing is stored: they are the annotations the reader made.

/** How many notes the door has room for (house.js draws them: `FRIDGE_NOTES`). */
export const MAGNETS = 3;
/** How many books' highlights are read to find the latest: the ones last open, where a new highlight would be. */
export const NOTE_BOOKS = 6;

/** What of an annotation a note needs. Character-sheet rows share the table, under other kinds, and are passed over. */
export type Notable = { id: string; bookId: string; kind: string; cfi: string; text?: string | null; chapter?: string | null; color?: string | null; createdAt: string; deletedAt?: string | null };

export type Pinned = { id: string; bookId: string; cfi: string; text: string; chapter: string | null; color: string | null; createdAt: string };

const newestFirst = (a: Pinned, b: Pinned) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * The notes on the door, the newest first: the latest highlight of each of
 * the books highlighted most recently, then (with fewer books than magnets)
 * the next latest of those there are.
 */
export const pinnedNotes = (annotations: readonly Notable[], max = MAGNETS): Pinned[] => {
  const all = annotations
    .filter((item) => item.kind === "highlight" && !item.deletedAt && Boolean(item.text?.trim()) && Boolean(item.cfi))
    .map((item): Pinned => ({ id: item.id, bookId: item.bookId, cfi: item.cfi, text: (item.text ?? "").replace(/\s+/g, " ").trim(), chapter: item.chapter?.replace(/\s+/g, " ").trim() || null, color: item.color ?? null, createdAt: item.createdAt }))
    .sort(newestFirst);
  const books = new Set<string>();
  const firsts = all.filter((item) => !books.has(item.bookId) && Boolean(books.add(item.bookId))).slice(0, max);
  const rest = all.filter((item) => !firsts.includes(item)).slice(0, max - firsts.length);
  return [...firsts, ...rest].sort(newestFirst);
};

/**
 * The books whose highlights are worth reading for the door: those that have
 * any, the most recently opened first, and no more than a handful.
 */
export const noteBooks = <T extends { id: string; lastOpened: string | null }>(books: readonly T[], counts: Readonly<Record<string, number>>, max = NOTE_BOOKS): T[] =>
  books
    .filter((book) => (counts[book.id] ?? 0) > 0)
    .sort((a, b) => (b.lastOpened ?? "").localeCompare(a.lastOpened ?? "") || a.id.localeCompare(b.id))
    .slice(0, max);

/** A highlight's words as a note shows them: all of a short one, the start of a long one. */
export const noteWords = (text: string, max = 280) => (text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}…`);

/** What the notes say of themselves, for their label. */
export const notesWords = (count: number) => (count === 1 ? "your latest highlight" : `your ${count} latest highlights`);
