/**
 * Walking about the clearing: where somebody on a round is at a time.
 *
 * A round is a list of stops. Between two of them the walker goes round
 * whatever stands in the way (a building, a pond, a run of fence) and not
 * through it: the way is found on a coarse grid and then pulled straight
 * wherever there is a clear line. At a stop they do something for a few
 * seconds, and some stops are doors: there they go in, and are not seen
 * until they come out.
 *
 * Like the rest of the picture it keeps no state. A round is planned once
 * for a camp as it stands, and after that the clock says where on it the
 * walker is.
 */
import { GAME_H, GAME_W } from "../games";

/** Something in the way: the ground it takes, as an oval about the middle of its foot. */
export type Block = { x: number; y: number; rx: number; ry: number };
/** Somewhere to go: what is done there, for how many seconds, and whether it is a door to go in at. */
export type Stop = { x: number; y: number; act: string; rest: number; inside?: boolean };
type Leg = { path: Array<[number, number]>; long: number; stop: Stop };
export type Plan = { legs: Leg[] };
export type Walker = {
  x: number;
  y: number;
  move: string;
  faceLeft: boolean;
  /** Seconds into the walking or the standing. */
  age: number;
  /** How much of them there is to see: 1, but for the moment of going in at a door or coming out, and 0 while inside. */
  shown: number;
};

const CELL = 4;
const LEFT = 6;
const RIGHT = GAME_W - 6;
const TOP = 50;
const BOTTOM = GAME_H - 2;
const COLS = Math.floor((RIGHT - LEFT) / CELL) + 1;
const ROWS = Math.floor((BOTTOM - TOP) / CELL) + 1;
/** A walker is not a point: this much is kept between them and what they go round. */
const ROOM = 2;
/** Seconds a walker takes going in at a door, and coming out of it. */
const DOOR_SECONDS = 0.45;

const within = (blocks: readonly Block[], x: number, y: number, pad: number) => blocks.some((block) => ((x - block.x) / (block.rx + pad)) ** 2 + ((y - block.y) / (block.ry + pad)) ** 2 < 1);

/** Whether the straight line between two points is clear of everything. */
export const clearWay = (blocks: readonly Block[], from: readonly [number, number], to: readonly [number, number]) => {
  const long = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(long / 1.5));
  // The ends are where the walker is and where they are going (a door is hard against its building): only the way between is asked about.
  for (let step = 1; step < steps; step++) {
    const along = step / steps;
    if (within(blocks, from[0] + (to[0] - from[0]) * along, from[1] + (to[1] - from[1]) * along, ROOM * 0.6)) return false;
  }
  return true;
};

const cellOf = (x: number, y: number): [number, number] => [Math.max(0, Math.min(COLS - 1, Math.round((x - LEFT) / CELL))), Math.max(0, Math.min(ROWS - 1, Math.round((y - TOP) / CELL)))];
const centre = (col: number, row: number): [number, number] => [LEFT + col * CELL, TOP + row * CELL];

/** The way from one point to another on the grass, round whatever stands between: the points to walk through, the two ends among them. Walled in on every side, straight there, through whatever it is, rather than standing for ever. */
export const wayRound = (from: readonly [number, number], to: readonly [number, number], blocks: readonly Block[]): Array<[number, number]> =>
  findWay(from, to, blocks) ?? [
    [from[0], from[1]],
    [to[0], to[1]]
  ];

/** The same, for whoever needs to know that there is no way round: null then. */
export const findWay = (from: readonly [number, number], to: readonly [number, number], blocks: readonly Block[]): Array<[number, number]> | null => {
  const a: [number, number] = [from[0], from[1]];
  const b: [number, number] = [to[0], to[1]];
  if (clearWay(blocks, a, b)) return [a, b];
  const shut = new Uint8Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const [x, y] = centre(col, row);
      if (within(blocks, x, y, ROOM)) shut[row * COLS + col] = 1;
    }
  }
  /** The open cell nearest a point: a door's own cell is as often as not under its building. */
  const nearest = (x: number, y: number) => {
    const [col, row] = cellOf(x, y);
    let best = -1;
    let least = Infinity;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (shut[r * COLS + c]) continue;
        const far = (c - col) ** 2 + (r - row) ** 2;
        if (far < least) {
          least = far;
          best = r * COLS + c;
        }
      }
    }
    return best;
  };
  const start = nearest(a[0], a[1]);
  const goal = nearest(b[0], b[1]);
  if (start < 0 || goal < 0) return null;
  // A*, eight ways, and never between two corners that touch.
  const cost = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const done = new Uint8Array(COLS * ROWS);
  const open: number[] = [start];
  cost[start] = 0;
  const goalCol = goal % COLS;
  const goalRow = Math.floor(goal / COLS);
  const guess = (cell: number) => Math.hypot((cell % COLS) - goalCol, Math.floor(cell / COLS) - goalRow);
  let found = false;
  while (open.length > 0) {
    let pick = 0;
    for (let index = 1; index < open.length; index++) if (cost[open[index]] + guess(open[index]) < cost[open[pick]] + guess(open[pick])) pick = index;
    const cell = open.splice(pick, 1)[0];
    if (cell === goal) {
      found = true;
      break;
    }
    if (done[cell]) continue;
    done[cell] = 1;
    const col = cell % COLS;
    const row = Math.floor(cell / COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
        const next = r * COLS + c;
        if (shut[next] || done[next]) continue;
        if (dr !== 0 && dc !== 0 && (shut[row * COLS + c] || shut[r * COLS + col])) continue;
        const reach = cost[cell] + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
        if (reach < cost[next]) {
          cost[next] = reach;
          came[next] = cell;
          open.push(next);
        }
      }
    }
  }
  if (!found) return null;
  const cells: Array<[number, number]> = [];
  for (let cell = goal; cell >= 0; cell = came[cell]) cells.unshift(centre(cell % COLS, Math.floor(cell / COLS)));
  const rough: Array<[number, number]> = [a, ...cells, b];
  // Pulled straight: from each point, on to the furthest one there is a clear line to.
  const way: Array<[number, number]> = [a];
  let at = 0;
  while (at < rough.length - 1) {
    let next = at + 1;
    for (let far = rough.length - 1; far > at + 1; far--) {
      if (clearWay(blocks, rough[at], rough[far])) {
        next = far;
        break;
      }
    }
    way.push(rough[next]);
    at = next;
  }
  return way;
};

/** A round, planned: from each stop to the next and from the last back to the first, round whatever is in the way. */
export const planWalk = (stops: readonly Stop[], blocks: readonly Block[]): Plan => ({
  legs: stops.map((from, index) => {
    const stop = stops[(index + 1) % stops.length];
    const path = stops.length > 1 ? wayRound([from.x, from.y], [stop.x, stop.y], blocks) : [[from.x, from.y] as [number, number]];
    let long = 0;
    for (let point = 1; point < path.length; point++) long += Math.hypot(path[point][0] - path[point - 1][0], path[point][1] - path[point - 1][1]);
    return { path, long, stop };
  })
});

/** Where a walker on a planned round is at a time: `speed` art pixels a second on the walk. */
export const onWalk = (plan: Plan, time: number, speed: number): Walker => {
  const first = plan.legs[0];
  if (!first) return { x: 0, y: 0, move: "idle", faceLeft: false, age: 0, shown: 1 };
  const round = plan.legs.reduce((sum, leg) => sum + leg.long / speed + leg.stop.rest, 0);
  let left = round > 0 ? ((time % round) + round) % round : 0;
  for (const leg of plan.legs) {
    const walk = leg.long / speed;
    if (left < walk) {
      let gone = left * speed;
      for (let point = 1; point < leg.path.length; point++) {
        const from = leg.path[point - 1];
        const to = leg.path[point];
        const long = Math.hypot(to[0] - from[0], to[1] - from[1]);
        if (gone <= long || point === leg.path.length - 1) {
          const along = long > 0 ? Math.min(1, gone / long) : 1;
          return { x: from[0] + (to[0] - from[0]) * along, y: from[1] + (to[1] - from[1]) * along, move: "walk", faceLeft: to[0] < from[0], age: left, shown: 1 };
        }
        gone -= long;
      }
    }
    left -= walk;
    if (left < leg.stop.rest) {
      // At a door: in over a moment, out over a moment, and out of sight between.
      const shown = leg.stop.inside ? Math.max(0, 1 - left / DOOR_SECONDS, 1 - (leg.stop.rest - left) / DOOR_SECONDS) : 1;
      return { x: leg.stop.x, y: leg.stop.y, move: leg.stop.act, faceLeft: false, age: left, shown: Math.min(1, shown) };
    }
    left -= leg.stop.rest;
  }
  return { x: first.stop.x, y: first.stop.y, move: "idle", faceLeft: false, age: 0, shown: 1 };
};

/** A shuffle that is the same every time for the same number: so a camp's round is its own, and does not change while it is looked at. */
export const shuffled = <T>(list: readonly T[], seed: number): T[] => {
  const out = [...list];
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = out.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
};
