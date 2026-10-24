/**
 * What a raid's events look like (the Magpie Lands, 2026-10-24; raids-plan.md, section 5): the battle keeps a log of
 * what happened (`battle.ts` `BattleEvent`), and this turns each into what the field shows. A structure hurt shows
 * cracks; one that falls falls its own way and leaves rubble that stays for the rest of the raid:
 *
 * - a section of wall splinters and topples, a gate breaks;
 * - a perch tips over, and its magpie flaps away;
 * - a hoard bursts, and acorns hop out toward the scouts;
 * - the nest collapses in twigs and feathers.
 *
 * Besides those, the watch-crow's call (a squawk, and the perches manned again), a pit giving way under whoever is on
 * it, and the stars as they are won. Each plays once and never loops, and nothing shakes the field. Where motion is
 * kept still (reduced motion, or the lightest tier) every one is its end at once: the rubble, the cracks, the pit
 * open, and no specks or flights.
 *
 * Plain data and functions of it, in field units and seconds of the screen's own clock: no canvas. `raidPaint.ts`
 * draws it.
 */
import type { BattleEvent, Structure, StructureKind } from "../../../../pip/base/battle";

/** How a thing falls. */
export type FallKind = "topple" | "break" | "tip" | "burst" | "collapse";
/** What it leaves: the rubble's picture (`raidrubble`'s variant, or the King's own). */
export type RubbleKind = "wall" | "gate" | "perch" | "hoard" | "nest" | "king" | "building";
export const RUBBLE_VARIANT: Readonly<Record<Exclude<RubbleKind, "king">, number>> = { wall: 0, gate: 1, perch: 2, hoard: 3, nest: 4, building: 5 };

/** How long each kind of fall takes, in seconds: short, and over. */
export const FALL_SECONDS: Readonly<Record<FallKind, number>> = { topple: 0.5, break: 0.45, tip: 0.6, burst: 0.4, collapse: 0.8 };
/** How many pictures each fall is drawn in (`raidPaint.ts` makes them once, from the thing standing). */
export const FALL_FRAMES: Readonly<Record<FallKind, number>> = { topple: 5, break: 4, tip: 6, burst: 4, collapse: 5 };

export type Fall = { kind: FallKind; at: number; seconds: number };

/** A speck in the air: dust, a splinter, a twig, a feather, an acorn hopping. `z` is its height off the ground. */
export type SpeckKind = "dust" | "splinter" | "twig" | "feather" | "acorn";
export type Speck = { kind: SpeckKind; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; colour: string; bounces: number };

/** Something that crosses the field once: the magpie flying off a fallen perch (or back to one), the crow's squawk, a star, an order's flag. */
export type FlightKind = "flee" | "manned" | "squawk" | "star" | "order";
export type Flight = { kind: FlightKind; x: number; y: number; at: number; seconds: number; star?: number };
export const FLIGHT_SECONDS: Readonly<Record<FlightKind, number>> = { flee: 1.4, manned: 0.9, squawk: 1.1, star: 1.2, order: 0.9 };

/** A sound to be played for what has just happened (the screen plays and forgets them). */
export type Cue = "crumble" | "caw" | "pop" | "star" | "coin" | "squeak";

export type FxState = {
  /** Nothing moves: every event is shown as its end. */
  still: boolean;
  cracks: Map<number, 1 | 2>;
  falls: Map<number, Fall>;
  /** What has fallen, and what it left: kept until a perch is manned again (the crow's second flight). */
  rubble: Map<number, RubbleKind>;
  /** The pits given way, by their place in `Battle.zones`. */
  sprung: Set<number>;
  specks: Speck[];
  flights: Flight[];
  /** The star pips along the top: each one as the events last said. */
  stars: [boolean, boolean, boolean];
  cues: Cue[];
  /** How far through the battle's events this has read. */
  read: number;
};

export const newFx = (still: boolean): FxState => ({
  still,
  cracks: new Map(),
  falls: new Map(),
  rubble: new Map(),
  sprung: new Set(),
  specks: [],
  flights: [],
  stars: [false, false, false],
  cues: [],
  read: 0
});

/** How a structure falls: by its kind, a gate its own way, a friend's building (`look`) as a heap. */
export const fallOf = (kind: StructureKind, gate?: Structure["gate"], built = false): FallKind =>
  built ? "collapse" : kind === "wall" ? (gate ? "break" : "topple") : kind === "perch" ? "tip" : kind === "hoard" ? "burst" : "collapse";

/** What a fallen structure leaves. */
export const rubbleOf = (kind: StructureKind, gate?: Structure["gate"], built = false, king = false): RubbleKind =>
  built ? "building" : kind === "wall" ? (gate ? "gate" : "wall") : kind === "perch" ? "perch" : kind === "hoard" ? "hoard" : kind === "nest" ? (king ? "king" : "nest") : "building";

/** The most specks at once: a raid's worst moment stays cheap to draw. */
export const SPECKS_MOST = 140;

/** A small seeded number for a speck, so the same raid throws the same specks. */
const jitter = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const DUST = ["#D8C9A3", "#B9A57A", "#EFE6CC"];
const SPLINTER = ["#DCA662", "#BA8048", "#F0D9A8"];
const TWIGS = ["#A88A68", "#7A5E46", "#54402E"];
const FEATHER = ["#1E1E2A", "#FFFFFF", "#2F6FD0"];
const ACORN = ["#E0A040", "#B06A28"];

const spray = (fx: FxState, kind: SpeckKind, x: number, y: number, count: number, colours: readonly string[], speed: number, up: number, seed: number) => {
  for (let k = 0; k < count && fx.specks.length < SPECKS_MOST; k++) {
    const angle = (k / count) * Math.PI * 2 + jitter(seed + k) * 0.8;
    const fast = speed * (0.5 + jitter(seed + k * 3) * 0.6);
    fx.specks.push({
      kind,
      x,
      y,
      z: 2 + jitter(seed + k * 5) * 6,
      vx: Math.cos(angle) * fast,
      vy: Math.sin(angle) * fast * 0.6,
      vz: up * (0.6 + jitter(seed + k * 7) * 0.6),
      age: 0,
      life: kind === "feather" ? 1.4 + jitter(seed + k) * 0.6 : kind === "dust" ? 0.5 + jitter(seed + k) * 0.3 : 0.9 + jitter(seed + k) * 0.4,
      colour: colours[k % colours.length],
      bounces: kind === "acorn" ? 2 : 0
    });
  }
};

/** Acorns out of a burst hoard, hopping off toward the trail's side (where the scouts are). */
const hop = (fx: FxState, x: number, y: number, count: number, seed: number) => {
  for (let k = 0; k < count && fx.specks.length < SPECKS_MOST; k++) {
    const spread = (jitter(seed + k) - 0.5) * 1.6;
    fx.specks.push({ kind: "acorn", x, y, z: 4, vx: -(14 + jitter(seed + k * 2) * 12), vy: spread * 10, vz: 34 + jitter(seed + k * 3) * 14, age: 0, life: 1.3, colour: ACORN[k % 2], bounces: 2 });
  }
};

/**
 * Reads the battle's events since the last read and turns them into what is shown: `now` is the screen's clock, in
 * seconds. `structures` are the battle's, for what each event's structure is.
 */
export const takeEvents = (fx: FxState, events: readonly BattleEvent[], now: number, structures: readonly Structure[], king = false): void => {
  for (; fx.read < events.length; fx.read++) {
    const event = events[fx.read];
    const seed = fx.read * 13 + 7;
    switch (event.kind) {
      case "hurt":
        fx.cracks.set(event.id, event.cracks);
        if (!fx.still) spray(fx, "dust", event.x, event.y, 4, DUST, 14, 10, seed);
        break;
      case "down": {
        const entry = structures[event.id];
        const built = Boolean(entry?.look);
        const kind = fallOf(event.structure, entry?.gate, built);
        fx.falls.set(event.id, { kind, at: now, seconds: fx.still ? 0 : FALL_SECONDS[kind] });
        fx.rubble.set(event.id, rubbleOf(event.structure, entry?.gate, built, king));
        fx.cracks.delete(event.id);
        fx.cues.push("crumble");
        if (fx.still) break;
        if (event.structure === "wall") spray(fx, "splinter", event.x, event.y, entry?.gate ? 10 : 7, SPLINTER, 26, 22, seed);
        else if (event.structure === "perch") spray(fx, "splinter", event.x, event.y, 5, SPLINTER, 18, 18, seed);
        spray(fx, "dust", event.x, event.y, event.structure === "nest" ? 14 : 8, DUST, event.structure === "nest" ? 30 : 20, 12, seed + 1);
        break;
      }
      case "flee":
        if (!fx.still) fx.flights.push({ kind: "flee", x: event.x, y: event.y, at: now, seconds: FLIGHT_SECONDS.flee });
        fx.cues.push("squeak");
        break;
      case "spill":
        if (!fx.still) hop(fx, event.x, event.y, 6, seed);
        fx.cues.push("coin");
        break;
      case "nest":
        if (!fx.still) {
          spray(fx, "twig", event.x, event.y - 6, 12, TWIGS, 30, 30, seed);
          spray(fx, "feather", event.x, event.y - 10, 6, FEATHER, 14, 26, seed + 2);
        }
        break;
      case "breach":
        // (A section's fall is its `down`; a gate's planks fly as well.)
        if (!fx.still && event.gate) spray(fx, "splinter", event.x, event.y, 6, SPLINTER, 30, 26, seed);
        break;
      case "manned":
        // The second flight: a fallen perch is manned again, its rubble cleared, a magpie flying in to it.
        fx.rubble.delete(event.id);
        fx.falls.delete(event.id);
        fx.cracks.delete(event.id);
        if (!fx.still) fx.flights.push({ kind: "manned", x: event.x, y: event.y, at: now, seconds: FLIGHT_SECONDS.manned });
        break;
      case "call":
        if (!fx.still) fx.flights.push({ kind: "squawk", x: event.x, y: event.y, at: now, seconds: FLIGHT_SECONDS.squawk });
        fx.cues.push("caw");
        break;
      case "pit":
        fx.sprung.add(event.zone);
        if (!fx.still) spray(fx, "dust", event.x, event.y, 10, DUST, 22, 16, seed);
        fx.cues.push("pop");
        break;
      case "star":
        fx.stars[event.star] = !event.lost;
        if (!event.lost) {
          if (!fx.still) fx.flights.push({ kind: "star", x: structures[0]?.x ?? 156, y: structures[0]?.y ?? 64, at: now, seconds: FLIGHT_SECONDS.star, star: event.star });
          fx.cues.push("star");
        }
        break;
      case "order": {
        const order = event.order;
        const target = order.kind === "rally" ? structures[order.target] : order.kind === "hero" && order.target !== undefined ? structures[order.target] : null;
        if (!fx.still && target) fx.flights.push({ kind: "order", x: target.x, y: target.y, at: now, seconds: FLIGHT_SECONDS.order });
        break;
      }
    }
  }
};

/** The specks a step on: they fly, fall, and (acorns) hop on the ground a couple of times; the spent ones go. */
export const stepFx = (fx: FxState, dt: number, now: number): void => {
  let kept = 0;
  for (const speck of fx.specks) {
    speck.age += dt;
    speck.x += speck.vx * dt;
    speck.y += speck.vy * dt;
    speck.z += speck.vz * dt;
    // A feather drifts down slowly; everything else falls.
    speck.vz -= (speck.kind === "feather" ? 18 : 90) * dt;
    if (speck.kind === "feather") speck.vz = Math.max(speck.vz, -6);
    if (speck.z <= 0) {
      speck.z = 0;
      if (speck.bounces > 0 && speck.vz < -4) {
        speck.vz = -speck.vz * 0.45;
        speck.bounces -= 1;
      } else {
        speck.vz = 0;
        speck.vx *= 0.6;
        speck.vy *= 0.6;
      }
    }
    if (speck.age < speck.life) fx.specks[kept++] = speck;
  }
  fx.specks.length = kept;
  fx.flights = fx.flights.filter((flight) => now - flight.at < flight.seconds);
};

/** Which of a fall's pictures shows at `now`: from the first to the last, then the rubble (null). */
export const fallFrame = (fall: Fall, now: number): number | null => {
  if (fall.seconds <= 0) return null;
  const t = (now - fall.at) / fall.seconds;
  if (t >= 1) return null;
  return Math.max(0, Math.min(FALL_FRAMES[fall.kind] - 1, Math.floor(t * FALL_FRAMES[fall.kind])));
};

/** Whether anything is still moving at `now` (so the field is painted while it is, and rests after). */
export const moving = (fx: FxState, now: number): boolean => {
  if (fx.specks.length > 0 || fx.flights.length > 0) return true;
  for (const fall of fx.falls.values()) if (fallFrame(fall, now) !== null) return true;
  return false;
};
