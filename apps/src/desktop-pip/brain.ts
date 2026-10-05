/**
 * What desktop Pip is doing, worked out here and drawn by her page.
 *
 * A small part of her life in the house, not its planner: she stands, strolls
 * along the taskbar, sits down for a while, fidgets, sleeps at night, looks at
 * the pointer when it comes near, answers a poke, hangs from the hand and
 * falls from it, and holds up a sign when a reminder is due. Rust moves her
 * window (`src-tauri/src/desktop_pip`) and says what happened to it; this
 * decides the pose. Pure: a brain, what happened, the brain after and what to
 * ask of the host (brain.test.ts).
 *
 * Standing, sitting and sleeping are still poses: nothing is drawn again
 * until something happens, so a Pip left alone costs no frames at all.
 */
import { pokeAgain, pokeReaction, type Poke } from "../pip/play";

export type Act =
  | { kind: "stand" }
  | { kind: "sit" }
  | { kind: "sleep" }
  | { kind: "walk" }
  | { kind: "held" }
  | { kind: "fall"; tossed: boolean }
  /** A move played through once: a fidget, a poke's answer, a landing. */
  | { kind: "play"; move: string; loops: number };

export type Glance = { side: -1 | 0 | 1; up: boolean; near: boolean };

export type Brain = {
  act: Act;
  /** Goes up whenever a move should start from its first frame. */
  beat: number;
  facing: -1 | 1;
  /** The reminders' quiet hours (23:00 to 07:00): she sleeps through them. */
  night: boolean;
  /** Quiet Pip: no strolls, no fidgets. */
  quiet: boolean;
  /** Reduced motion: she stands where she is put. */
  still: boolean;
  /** What her sign says, while one is up. */
  sign: string | null;
  menu: boolean;
  glance: Glance;
  poke: Poke | null;
  /** When she next thinks of something to do (ms), or null while she is not waiting to. */
  thinkAt: number | null;
};

/** What the page asks of the host on her behalf. */
export type Ask = { type: "stroll"; roll: number; turn: boolean } | { type: "halt" } | { type: "hold" } | { type: "release" };

export type Happening =
  // From the host (Rust).
  | { type: "world"; night: boolean; quiet: boolean }
  | { type: "walking"; facing: number }
  | { type: "arrived" }
  | { type: "falling"; tossed: boolean }
  | { type: "landed"; impact: number; flat: boolean }
  | { type: "glance"; side: number; up: boolean; near: boolean }
  | { type: "sign"; text: string | null }
  // From the hand.
  | { type: "press" }
  | { type: "poke" }
  | { type: "grab" }
  | { type: "drop" }
  // From the page.
  | { type: "done" }
  | { type: "think" }
  | { type: "menu"; open: boolean }
  | { type: "still"; on: boolean };

export type Step = { brain: Brain; asks: Ask[] };

/** Between one thing to do and the next, standing or sitting. */
export const THINK_MIN_MS = 6000;
export const THINK_JITTER_MS = 10000;
/** Quick things done on the spot, once through. */
export const FIDGETS = ["look", "stretch", "tap", "yawn"] as const;

const NO_GLANCE: Glance = { side: 0, up: false, near: false };

export const newBrain = (still = false): Brain => ({
  act: { kind: "stand" },
  beat: 0,
  facing: -1,
  night: false,
  quiet: false,
  still,
  sign: null,
  menu: false,
  glance: NO_GLANCE,
  poke: null,
  thinkAt: null
});

/** Whether she is left to her own devices: nothing up, nothing held, awake, free to move. */
const idle = (brain: Brain) => !brain.night && !brain.still && brain.sign === null && !brain.menu;

const thinkLater = (brain: Brain, now: number, rand: () => number) =>
  idle(brain) ? now + THINK_MIN_MS + rand() * THINK_JITTER_MS : null;

/**
 * Back to rest after whatever she was doing: asleep at night, otherwise on
 * her feet (or still sat, if she was sitting and nothing calls for standing).
 */
const settle = (brain: Brain, now: number, rand: () => number, keepSeat = false): Brain => {
  const seated = keepSeat && brain.act.kind === "sit" && brain.sign === null && !brain.menu;
  const act: Act = brain.night ? { kind: "sleep" } : seated ? { kind: "sit" } : { kind: "stand" };
  const next = { ...brain, act };
  return { ...next, thinkAt: thinkLater(next, now, rand) };
};

const play = (brain: Brain, move: string, loops = 1): Brain => ({ ...brain, act: { kind: "play", move, loops }, beat: brain.beat + 1, thinkAt: null });

const carried = (brain: Brain) => brain.act.kind === "held" || brain.act.kind === "fall";

/** Something to do with a free moment. */
const think = (brain: Brain, now: number, rand: () => number): Step => {
  const roll = rand();
  const seated = brain.act.kind === "sit";
  if (brain.quiet) {
    // Quiet Pip only changes how she waits.
    const act: Act = roll < 0.3 ? (seated ? { kind: "stand" } : { kind: "sit" }) : brain.act;
    const next = { ...brain, act };
    return { brain: { ...next, thinkAt: thinkLater(next, now, rand) }, asks: [] };
  }
  if (roll < 0.45) {
    // Off for a stroll. She stays as she is until the host says she is
    // walking (or says she is not, and she settles again).
    return { brain: { ...brain, act: { kind: "stand" }, thinkAt: null }, asks: [{ type: "stroll", roll: rand(), turn: rand() < 0.25 }] };
  }
  if (roll < 0.65) {
    const next: Brain = { ...brain, act: seated ? { kind: "stand" } : { kind: "sit" } };
    return { brain: { ...next, thinkAt: thinkLater(next, now, rand) }, asks: [] };
  }
  if (roll < 0.85 && !seated) {
    return { brain: play(brain, FIDGETS[Math.min(FIDGETS.length - 1, Math.floor(rand() * FIDGETS.length))]), asks: [] };
  }
  return { brain: { ...brain, thinkAt: thinkLater(brain, now, rand) }, asks: [] };
};

const side = (value: number): -1 | 0 | 1 => (value < 0 ? -1 : value > 0 ? 1 : 0);

/** The brain after something happens at `now`, and what to ask of the host. */
export const reduce = (brain: Brain, happening: Happening, now: number, rand: () => number = Math.random): Step => {
  const stay: Step = { brain, asks: [] };
  const walking = brain.act.kind === "walk";
  switch (happening.type) {
    case "world": {
      const next = { ...brain, night: happening.night, quiet: happening.quiet };
      if (walking && happening.night) {
        // Bedtime finds her mid-stroll: she stops where she is.
        return { brain: settle(next, now, rand), asks: [{ type: "halt" }] };
      }
      if (carried(next) || next.act.kind === "play" || walking) {
        // Whatever she is in the middle of ends first; she settles into the new hour after it.
        return { brain: next, asks: [] };
      }
      if (!happening.night && brain.night && brain.act.kind === "sleep") {
        // Morning: a stretch, then the day.
        return { brain: play(next, "stretch"), asks: [] };
      }
      return { brain: settle(next, now, rand, true), asks: [] };
    }
    case "walking":
      if (carried(brain)) return stay;
      return { brain: { ...brain, act: { kind: "walk" }, facing: happening.facing < 0 ? -1 : 1, beat: brain.beat + 1, thinkAt: null }, asks: [] };
    case "arrived":
      return carried(brain) || brain.act.kind === "play" ? stay : { brain: settle(brain, now, rand), asks: [] };
    case "falling":
      return { brain: { ...brain, act: { kind: "fall", tossed: happening.tossed }, beat: brain.beat + 1, thinkAt: null }, asks: [] };
    case "landed":
      return { brain: play(brain, happening.flat ? "splat" : "land"), asks: [] };
    case "glance":
      return { brain: { ...brain, glance: { side: side(happening.side), up: happening.up, near: happening.near } }, asks: [] };
    case "sign": {
      const next = { ...brain, sign: happening.text };
      if (carried(next) || next.act.kind === "play" || (walking && happening.text === null)) return { brain: next, asks: [] };
      // The sign is held standing: a walk stops, a sitter gets up.
      return { brain: settle(next, now, rand), asks: walking ? [{ type: "halt" }] : [] };
    }
    case "press":
      // A finger on her stops her where she is, so the press can become a carry.
      return walking ? { brain: settle(brain, now, rand), asks: [{ type: "halt" }] } : stay;
    case "poke": {
      // With the sign up a click on her is a click on the sign (the page follows it).
      if (carried(brain) || brain.sign !== null) return stay;
      const asks: Ask[] = walking ? [{ type: "halt" }] : [];
      if (brain.act.kind === "sleep") {
        // Woken: a yawn, and back to sleep.
        return { brain: play(brain, "yawn"), asks };
      }
      const poke = pokeAgain(brain.poke, now);
      const answer = pokeReaction(poke.count);
      return { brain: { ...play(brain, answer.move, answer.loops), poke: answer.surprise ? null : poke }, asks };
    }
    case "grab":
      if (carried(brain)) return stay;
      return { brain: { ...brain, act: { kind: "held" }, beat: brain.beat + 1, menu: false, thinkAt: null }, asks: [{ type: "hold" }] };
    case "drop":
      // She stays in the hand's pose until the host says she is falling or down.
      return brain.act.kind === "held" ? { brain, asks: [{ type: "release" }] } : stay;
    case "done":
      return brain.act.kind === "play" ? { brain: settle(brain, now, rand), asks: [] } : stay;
    case "think":
      if ((brain.act.kind !== "stand" && brain.act.kind !== "sit") || brain.thinkAt === null || now < brain.thinkAt || !idle(brain)) return stay;
      return think(brain, now, rand);
    case "menu": {
      if (happening.open === brain.menu) return stay;
      const next = { ...brain, menu: happening.open };
      if (carried(next) || next.act.kind === "play" || (walking && !happening.open)) return { brain: next, asks: [] };
      return { brain: settle(next, now, rand, !happening.open), asks: walking ? [{ type: "halt" }] : [] };
    }
    case "still": {
      if (happening.on === brain.still) return stay;
      const next = { ...brain, still: happening.on };
      if (carried(next) || next.act.kind === "play" || (walking && !happening.on)) return { brain: next, asks: [] };
      return { brain: settle(next, now, rand), asks: walking ? [{ type: "halt" }] : [] };
    }
  }
};

export type Pose = {
  move: string;
  /** Play this many times and say "done"; absent, it loops (or holds, when still). */
  loops?: number;
  /** One held frame: nothing is drawn again until the pose changes. */
  still: boolean;
  /** Mirrored: she faces left. */
  flip: boolean;
  /** Changes when the move should start over. */
  key: string;
};

/** Whether the sign is showing: it is put away while she is in the hand or the air. */
export const signShowing = (brain: Brain) => brain.sign !== null && !carried(brain);

/** The idle, looking where the pointer is (pip/house-moves.js, "eye-..."). */
const watching = (glance: Glance) => {
  const way = `${glance.up ? "u" : ""}${glance.side < 0 ? "l" : glance.side > 0 ? "r" : ""}`;
  return way ? `eye-${way}` : "idle";
};

/** How she is drawn. */
export const pose = (brain: Brain): Pose => {
  const left = brain.facing < 0;
  const { act } = brain;
  switch (act.kind) {
    case "held":
      return { move: "held", still: false, flip: false, key: `held-${brain.beat}` };
    case "fall":
      return { move: act.tossed ? "tumble" : "fall", still: false, flip: left, key: `fall-${brain.beat}` };
    case "walk":
      return { move: "walk", still: false, flip: left, key: `walk-${brain.beat}` };
    case "play":
      return { move: act.move, loops: act.loops, still: false, flip: false, key: `play-${brain.beat}` };
    case "sleep":
      return { move: "sleep", still: true, flip: false, key: "sleep" };
    case "sit":
      return { move: "sit", still: true, flip: false, key: "sit" };
    case "stand":
      if (brain.sign !== null) return { move: "holdup", still: true, flip: false, key: "holdup" };
      // The eyes are drawn looking one way, so they are never mirrored.
      if (brain.glance.near) return { move: watching(brain.glance), still: true, flip: false, key: "watch" };
      return { move: "idle", still: true, flip: left, key: "idle" };
  }
};
