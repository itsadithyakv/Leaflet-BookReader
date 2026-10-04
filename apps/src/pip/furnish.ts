/**
 * Things in Pip's house the reader can use: curtains to draw, a picture to
 * knock crooked, a bed to put her in. One small system rather than a special
 * case each: a *kind* of furnishing says what the hand can do with it (in
 * words, for its label, and as a cursor), what is remembered about it on this
 * device, and what Pip makes of it; the pieces of decor that are of that kind
 * are listed once (`KIND_OF`). The house scene (components/pip/furnishings.tsx)
 * lays a button over each one that is out, feeds it the pointer and the
 * keyboard, and draws what changes; the rules are here, pure
 * (furnish.test.ts).
 *
 * Nothing here earns seeds or mood, and nothing here is saved with the house:
 * what is remembered (drawn curtains, a picture hung a little to the left) is
 * a preference of this device, in localStorage, outside the backup. The saved
 * layout (which piece is in which slot) is read and never written.
 */
import { holdMove, holdStart, holdStep, type Hold, type Sample } from "./play";
import type { PipSound } from "./sound";

export type FurnishKind = "curtains" | "picture" | "bed" | "window" | "books" | "lamp" | "fridge";

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
    how: "Select to draw or open the curtains, or drag across the window to pull them part way.",
    keys: "Enter draws or opens them.",
    cursor: "ew-resize",
    remembers: ["closed"]
  },
  picture: {
    noun: "picture",
    how: "Select to nudge it (it swings, and may hang crooked), or drag it along the wall to hang it somewhere else.",
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
  }
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
  minifridge: "fridge"
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

// ---- the fridge ---------------------------------------------------------------------------
//
// A fixture of the bedroom, not decor (pip/home.js stands it where there is
// room). The door opens under the hand and shuts itself; a hum while it is
// open, a click and a thud as it shuts. Opening it gives nothing: snacks are
// still bought as they are given, from Pip's things. What it is for is Pip,
// who hears it open and comes over hopefully, goes to it for the snack the
// reader is about to choose, and (pip/behaviour.ts) raids it at night.

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

/** Where Pip stands at a fridge whose box is this: at its handle (the left; the door swings out to the right), turned to it. */
export const fridgeStand = (box: { x: number; w: number }, floorW: number): { x: number; face: 1 | -1 } => {
  const left = Math.round(box.x - 10);
  // No room on that side (a fridge by the left wall): the other, past the open door.
  return left >= 18 ? { x: left, face: 1 } : { x: Math.min(floorW - 18, Math.round(box.x + box.w + 15)), face: -1 };
};
