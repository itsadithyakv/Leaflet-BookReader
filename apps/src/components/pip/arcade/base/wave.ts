/**
 * A night on the front (1.5.11), fought out ahead: everyone who comes down the
 * trail together, so that what one of them does is there for the next. A
 * bomber's gap lets the creepers behind him through; a gate battered by three
 * goes down three times as fast; a thrower that is throwing at one is not
 * throwing at another; a pitfall that has swallowed a brute is full.
 *
 * It is worked out once, when the night is first wanted, in tenths of a
 * second, and after that the clock says where everyone is (the picture draws
 * from it: `scene.ts`). Like the rest of the picture it keeps no state, and
 * nothing in it is random: the same camp and the same night are the same
 * night, every time.
 *
 * The camp may change while a night is on (a trap put on the trail from the
 * shed, the wall slid). The night is then planned again from that moment
 * (`fronts`, a list of how the front stood from when): the same up to it,
 * and the new front after, so a trap put down works at once.
 *
 * What comes down the trail (`front.ts` `ROLES`):
 *   - creepers walk the trail and batter whatever wall is in their way;
 *   - runners are quick, frail, and over the wall in a bound;
 *   - fliers come straight over everything, for the larder;
 *   - brutes are sturdy and batter the gate twice as hard;
 *   - diggers go under it all and come up near what they are after;
 *   - bombers walk to the wall beside the gate and blow it open.
 * A first fence (a few stakes, below `SEALED_FROM`) is short: whoever is on
 * foot goes round its end where that is not much further. From the second
 * level it is a palisade hemmed in by the brambles, with a gate, and has to
 * be broken.
 *
 * Plain functions of plain numbers, with no canvas: so it is tested, and the
 * simulations run the very thing the picture shows.
 */
import { GATE_TOUGHER, ROLE_OF, SEALED_FROM, SECTION_TOUGH, TRAIL_Y, wallXAt, type Role } from "../../../../pip/base/front";
import type { Placed } from "../../../../pip/base/rules";
import { findWay, type Block } from "./walks";

/** How squat an oval of reach is on the screen: the camp is seen from in front and a little above. */
export const SQUAT = 0.6;
/** How far a point is from another, measured as reach is: an oval, squat on the screen. */
export const offBy = (dx: number, dy: number) => Math.hypot(dx, dy / SQUAT);

/** A tenth of a second: the step a night is worked out in. */
export const TICK = 0.1;
/** How fast a prowler walks, in art pixels a second; each role goes at so many times that. */
export const PROWL_SPEED = 13;
const PACE: Readonly<Record<Role, number>> = { creeper: 1, runner: 2.6, flier: 1.6, brute: 0.7, digger: 0.9, bomber: 0.8 };
/** How hard each role batters a wall: so much toughness a second. */
const BATTERS: Readonly<Record<Role, number>> = { creeper: 1, runner: 1, flier: 0, brute: 2, digger: 0, bomber: 0 };
/** Seconds between two stones from the same thrower, and how long one is in the air. */
const THROW_EVERY = 1.35;
const THROW_FLIES = 0.5;
/** Seconds between two blows in a fight, and how long one who is near takes to step out to it. */
const BLOW_EVERY = 0.85;
const RUN_SECONDS = 0.55;
const RUN_SPEED = 38;
/** How long one who has got to a building is at it before it is the worse for it; a bomber's fuse; a runner's bound. */
export const KNOCK_SECONDS = 4.4;
export const FIZZ_SECONDS = 1.8;
const BOUND_SECONDS = 0.3;
/** How near what he is after a digger comes up of his own accord; and how near a thumper brings him up, dazed for so long. */
const MOLE_UP = 24;
const THUMP_REACH = 30;
const DAZED = 2;
/** Traps: how near, how often a thorn strip cuts (a runner, how often), how much a tanglefoot keeps of the pace, how many brutes a pitfall holds. */
const THORN_REACH = 9;
const THORN_EVERY = 1.2;
const THORN_RUNNER = 0.3;
const TANGLE_REACH = 15;
const TANGLE_KEEPS = 0.45;
const PIT_REACH = 6;
const PIT_HOLDS = 2;
/** The bell: how near the wall it hears anyone, and what it does to the wait between throws. */
const BELL_REACH = 32;
const BELL_QUICKER = 0.7;
/** The stone thrower's stone hurts whoever stands this near where it lands; and a bomber it hits goes off there. */
const SPLASH = 8;
/** Where whoever is on foot stands to batter a section: this far in front of the wall. */
const AT_WALL = 5;
/** How much further than the straight way someone on foot goes to get round the end of a short wall rather than batter it. */
const ROUND_MOST = 1.7;
/** The longest a night is let run, in seconds after the last one sets out. */
const NIGHT_MOST = 110;

/** Something that throws: where, how far, and (for the constructs that throw their own way) how long between throws and how hard. */
export type Ring = {
  x: number;
  y: number;
  r: number;
  every?: number;
  hurts?: number;
  site?: string | null;
  work?: number | null;
  /** Where the stone sets off from, up the picture, and how far up its building the thrower stands (for the picture). */
  top?: number;
  rise?: number;
};
/** Somebody who fights whoever comes near where they stand: who (a guardian's number), where, how near, and how many blows they have in them. */
export type Post = { who: number; x: number; y: number; r: number; blows: number; /** Shoots from where they stand, and does not go out to him. */ ranged?: boolean; roams?: boolean };
export type Shot = { from: number; lands: number; fx: number; fy: number; tx: number; ty: number; /** The construct that threw it, or null for a building. */ work: number | null; foot: number; rise: number };
export type Duel = { who: number; from: number; until: number; x: number; y: number; px: number; py: number; blows: number[]; ranged: boolean; /** Seconds they take getting to him. */ run: number };
/** One prowler's walk, as the picture draws it: times are seconds after he set out. */
export type ProwlPlan = {
  from: [number, number];
  ux: number;
  uy: number;
  long: number;
  kind: number;
  health: number;
  /** How far along his way he is at each tenth of a second. */
  fars: number[];
  shots: Shot[];
  duel: Duel | null;
  /** When each thing that takes one off his health lands. */
  hurts: number[];
  /** When the last of his health goes; null when it never does. */
  falls: number | null;
  /** When he gets to what he came for (or, for a bomber, to the wall), if he does. */
  there: number;
  /** When what he came for is the worse for him: null when it never is. */
  harms: number | null;
  flies: boolean;
  /** When one who tunnels came up: 0 for everyone who walks in the open, null if he never did. */
  rose: number | null;
  /** Goes off with a pop when he has done. */
  pops: boolean;
  /** When he was held at the wall, battering or getting over it: from when, until when. */
  breaks: Array<[number, number]>;
  path: Array<[number, number]>;
  lens: number[];
};
/** A walk of a night: the plan, what he was after, when he set out (seconds into the night), his role, and the section he blew open (its height up the picture), if he did. */
export type WalkPlan = ProwlPlan & { site: Placed; start: number; role: Role; blew: number | null };

/** How the front stands: what throws, who is posted, the traps and the bell, and the wall. */
export type FrontSetup = {
  watch: readonly Ring[];
  posts: readonly Post[];
  works: ReadonlyArray<{ kind: number; x: number; y: number }>;
  /** The wall's line across the picture; null for a camp with no fence (the trail still ends there). */
  line: number;
  wall: boolean;
  /** Every section the fence's level has, and those of them standing when the night began (a friend may have knocked some down). */
  all: readonly number[];
  standing: readonly number[];
  /** The gate's section, if there is a gate. */
  gate: number | null;
  level: number;
  /** How much tougher every section is: the watchman, the goat. */
  tough: number;
  /** The trail, from out of sight in the wood to the front of the wall. */
  trail: ReadonlyArray<readonly [number, number]>;
  /** What stands in the way on the camp's side of the wall: for whoever goes round or comes through. */
  blocks: readonly Block[];
  /** The burrow's level: how much health there is in each of them. */
  burrow: number;
};
/** Somebody coming: his look (`ROLE_OF`), when he sets out (seconds into the night), what he is after and where it is, and how far to one side of the trail he walks. */
export type Walker = { kind: number; start: number; site: Placed; target: readonly [number, number]; lane: number };
export type NightPlan = {
  walks: WalkPlan[];
  /** The sections that came down in the night, and when (seconds into it). */
  breaks: Array<{ y: number; at: number }>;
  /** When the last of it is over, in seconds into the night. */
  end: number;
};

/** Health a prowler has: more in a bigger camp. */
export const prowlHealth = (burrow: number) => 1 + Math.max(1, burrow);
export const healthOf = (role: Role, burrow: number) => {
  const plain = prowlHealth(burrow);
  return role === "runner"
    ? Math.max(2, Math.ceil(plain * 0.75))
    : role === "brute"
      ? plain * 2
      : role === "bomber"
        ? plain * 2
        : role === "digger"
          ? Math.ceil(plain * 1.4)
          : plain;
};
/** How tough a section of a wall of a level is: the gate half as much again. */
export const toughOf = (level: number, gate: boolean, tough = 1) => SECTION_TOUGH[Math.max(0, Math.min(SECTION_TOUGH.length - 1, level))] * tough * (gate ? GATE_TOUGHER : 1);

const lensOf = (path: ReadonlyArray<readonly [number, number]>) => {
  const lens = [0];
  for (let piece = 1; piece < path.length; piece++) lens.push(lens[piece - 1] + Math.hypot(path[piece][0] - path[piece - 1][0], path[piece][1] - path[piece - 1][1]));
  return lens;
};
/** Where on a way of several straight pieces somebody is, who has gone so far along it. */
export const along = (path: ReadonlyArray<readonly [number, number]>, lens: readonly number[], far: number): [number, number] => {
  if (far <= 0 || path.length < 2) return [path[0][0], path[0][1]];
  for (let piece = 1; piece < path.length; piece++) {
    if (far <= lens[piece] || piece === path.length - 1) {
      const long = Math.max(1e-6, lens[piece] - lens[piece - 1]);
      const share = Math.min(1, (far - lens[piece - 1]) / long);
      return [path[piece - 1][0] + (path[piece][0] - path[piece - 1][0]) * share, path[piece - 1][1] + (path[piece][1] - path[piece - 1][1]) * share];
    }
  }
  return [path[path.length - 1][0], path[path.length - 1][1]];
};

type Phase = "wait" | "trail" | "approach" | "wall" | "in" | "done";
type Live = {
  spec: Walker;
  role: Role;
  flier: boolean;
  digger: boolean;
  health: number;
  hurts: number[];
  shots: Shot[];
  fars: number[];
  path: Array<[number, number]>;
  lens: number[];
  far: number;
  /** How far along the way the part he is on ends: the end of the trail, the wall, or what he came for. */
  stop: number;
  phase: Phase;
  heldUntil: number;
  arrived: number;
  falls: number | null;
  rose: number | null;
  pops: boolean;
  blew: number | null;
  duel: Duel | null;
  breaks: Array<[number, number]>;
  /** At the wall: the section he is at, and what he is doing to it. */
  at: { y: number; doing: "batter" | "fuse" | "bound"; from: number } | null;
  cutAt: number;
  pitted: boolean;
  /** A stone thrower has hit him, and it lands then: a bomber goes off. */
  stonedAt: number | null;
};

/** How a front has its walkers' way to the wall: the trail, a step to one side, ending in front of the wall. */
const trailFor = (setup: FrontSetup, lane: number): Array<[number, number]> =>
  setup.trail.map(([x, y], index): [number, number] => [x, index === 0 || index === setup.trail.length - 1 ? y + lane * 0.5 : y + lane]).map(([x, y], index, all): [number, number] =>
    index === all.length - 1 ? [setup.line - AT_WALL, TRAIL_Y + lane * 0.4] : [x, y]
  );

/** Keeps a walk's way as far as he has got along it, and sends the rest of it somewhere new. */
const rebase = (live: Live, tail: ReadonlyArray<readonly [number, number]>) => {
  let keep = 0;
  while (keep + 1 < live.lens.length && live.lens[keep + 1] <= live.far) keep++;
  const here = along(live.path, live.lens, live.far);
  const path: Array<[number, number]> = live.path.slice(0, keep + 1).map(([x, y]) => [x, y]);
  if (live.far - live.lens[keep] > 1e-6) path.push(here);
  for (const [x, y] of tail) {
    const last = path[path.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) > 0.01) path.push([x, y]);
  }
  live.path = path;
  live.lens = lensOf(path);
};

/**
 * Plans a night: everyone who comes, against the front as it stood from each moment in `fronts` (the first from the
 * start; at least one). `seed` makes the small choices (which way round a short wall) the same every time.
 */
export const planNight = (walkers: readonly Walker[], fronts: ReadonlyArray<{ at: number; setup: FrontSetup }>, seed = 0): NightPlan => {
  const timeline = [...fronts].sort((a, b) => a.at - b.at);
  let current = 0;
  let setup = timeline[0].setup;
  const breaks: Array<{ y: number; at: number }> = [];
  // The wall: each section's toughness, by its height up the picture.
  const hp = new Map<number, { left: number; most: number }>();
  const raise = (from: FrontSetup, keep: boolean) => {
    const before = new Map(hp);
    hp.clear();
    if (!from.wall) return;
    for (const y of from.all) {
      const most = toughOf(from.level, from.gate === y, from.tough);
      const had = before.get(y);
      // A section that was standing when the night began stands; one a friend knocked down is a gap. A section the
      // night has already had down stays down whatever is done to the front.
      if (keep && had) hp.set(y, { left: had.left <= 0 ? 0 : Math.min(most, had.left + (most - had.most)), most });
      else hp.set(y, { left: from.standing.includes(y) ? most : 0, most });
    }
  };
  raise(setup, false);
  const standingNow = () => [...hp.entries()].filter(([, entry]) => entry.left > 0).map(([y]) => y);
  const gapsNow = () => [...hp.entries()].filter(([, entry]) => entry.left <= 0).map(([y]) => y);
  /** A section is down (or has just been battered down): marked so, once. */
  const breakAt = (y: number, at: number) => {
    const entry = hp.get(y);
    if (!entry || breaks.some((one) => one.y === y)) return;
    entry.left = 0;
    breaks.push({ y, at });
  };
  const ready = new Map<string, number>();
  /** The ground with the wall standing on it, as it stood (the way round a first fence is found on it). */
  const rounds = new Map<string, Block[]>();
  /** Where each of them is, this tick: worked out once, for every thrower to look at. */
  const spots: Array<[number, number]> = [];
  const ringKey = (ring: Ring) => `${Math.round(ring.x)},${Math.round(ring.y)},${ring.work ?? ring.site ?? ""}`;
  const busy = new Map<number, number>();
  const pits = new Map<string, number>();
  const near = (kind: number, x: number, y: number, reach: number) => setup.works.some((work) => work.kind === kind && offBy(x - work.x, y - work.y) <= reach);
  const nearest = (kind: number, x: number, y: number) =>
    setup.works.filter((work) => work.kind === kind).sort((a, b) => offBy(x - a.x, y - a.y) - offBy(x - b.x, y - b.y))[0] ?? null;

  const lives: Live[] = walkers.map((spec) => {
    const role = ROLE_OF[spec.kind] ?? "creeper";
    const flier = role === "flier";
    const digger = role === "digger";
    const from = setup.trail[0];
    const path: Array<[number, number]> = flier || digger ? [[from[0], from[1] + spec.lane * 0.5], [spec.target[0], spec.target[1]]] : trailFor(setup, spec.lane);
    const lens = lensOf(path);
    return {
      spec,
      role,
      flier,
      digger,
      health: healthOf(role, setup.burrow),
      hurts: [],
      shots: [],
      fars: [],
      path,
      lens,
      far: 0,
      stop: flier || digger ? Math.max(1, lens[lens.length - 1] - 9) : lens[lens.length - 1],
      phase: "wait",
      heldUntil: 0,
      arrived: -1,
      falls: null,
      rose: digger ? null : 0,
      pops: role === "bomber",
      blew: null,
      duel: null,
      breaks: [],
      at: null,
      cutAt: 0,
      pitted: false,
      stonedAt: null
    };
  });

  /** In through the wall at a height, or round it, or (with no wall) straight on: and on to what he came for. */
  const goIn = (live: Live, via: number | null) => {
    const here = along(live.path, live.lens, live.far);
    const tail: Array<[number, number]> = [];
    let from: [number, number] = here;
    if (via !== null) {
      const wx = wallXAt(setup.line, via);
      tail.push([wx - AT_WALL + 0.5, via], [wx + 6, via]);
      from = [wx + 6, via];
    }
    const way = findWay(from, live.spec.target, setup.blocks) ?? [from, [live.spec.target[0], live.spec.target[1]]];
    rebase(live, [...tail, ...way.slice(1)]);
    live.phase = "in";
    live.at = null;
    live.stop = Math.max(live.far, live.lens[live.lens.length - 1] - 9);
  };
  /** Sends one on foot who is still on his way to the wall along the trail as it now is. */
  const reroute = (live: Live) => {
    const here = along(live.path, live.lens, live.far);
    if (here[0] >= setup.line - AT_WALL - 0.5) {
      // The wall has been slid back past him: he is on the camp's side of it already.
      live.phase = "trail";
      live.stop = live.far;
      return;
    }
    const tail = trailFor(setup, live.spec.lane).filter(([x], index, all) => x > here[0] + 0.5 || index === all.length - 1);
    rebase(live, tail);
    live.phase = "trail";
    live.at = null;
    live.stop = live.lens[live.lens.length - 1];
  };
  /** At the end of the trail: through a gap, round the end, over in a bound, or at the wall to batter (or blow) it. */
  const atWall = (live: Live, t: number) => {
    if (!setup.wall || hp.size === 0) {
      goIn(live, null);
      return;
    }
    const here = along(live.path, live.lens, live.far);
    // The wall was slid back past him: he is on the camp's side of it already.
    if (here[0] > setup.line - AT_WALL + 1) {
      goIn(live, null);
      return;
    }
    const gaps = gapsNow();
    const up = standingNow();
    if (gaps.length > 0) {
      const gap = [...gaps].sort((a, b) => Math.abs(a - here[1]) - Math.abs(b - here[1]) || a - b)[0];
      goIn(live, gap);
      return;
    }
    if (live.role === "runner") {
      const crossing = setup.gate ?? [...up].sort((a, b) => Math.abs(a - TRAIL_Y) - Math.abs(b - TRAIL_Y) || a - b)[0];
      live.phase = "wall";
      live.at = { y: crossing, doing: "bound", from: t };
      live.heldUntil = t + BOUND_SECONDS;
      return;
    }
    if (setup.level < SEALED_FROM && live.role !== "bomber") {
      // A short wall (a few stakes across the trail): round its end, if that is not much further than going at it.
      const key = `${setup.line}|${up.join()}`;
      let round = rounds.get(key);
      if (!round) rounds.set(key, (round = [...setup.blocks, ...up.map((y) => ({ x: wallXAt(setup.line, y), y: y + 2, rx: 5.5, ry: 5.5 }))]));
      const way = findWay(here, live.spec.target, round);
      const straight = Math.hypot(live.spec.target[0] - here[0], live.spec.target[1] - here[1]);
      if (way && lensOf(way)[way.length - 1] <= straight * ROUND_MOST) {
        rebase(live, way.slice(1));
        live.phase = "in";
        live.stop = Math.max(live.far, live.lens[live.lens.length - 1] - 9);
        return;
      }
    }
    // At it, then: a bomber at the section beside the gate, everyone else at the gate (or the section across the trail).
    const besideGate = setup.gate !== null ? up.filter((y) => Math.abs(y - setup.gate!) === 10) : [];
    const aim =
      live.role === "bomber" && besideGate.length > 0
        ? besideGate.sort((a, b) => Math.abs(a - here[1]) - Math.abs(b - here[1]) || ((seed + live.spec.lane) % 2 === 0 ? a - b : b - a))[0]
        : setup.gate !== null && up.includes(setup.gate)
          ? setup.gate
          : [...up].sort((a, b) => Math.abs(a - TRAIL_Y) - Math.abs(b - TRAIL_Y) || a - b)[0];
    rebase(live, [[wallXAt(setup.line, aim) - AT_WALL, aim + live.spec.lane * 0.3]]);
    live.phase = "approach";
    live.at = { y: aim, doing: live.role === "bomber" ? "fuse" : "batter", from: t };
    live.stop = live.lens[live.lens.length - 1];
  };
  /** The end of him, here and now: whatever he had left goes at once. */
  const finish = (live: Live, local: number) => {
    for (let left = live.health - live.hurts.length; left > 0; left--) live.hurts.push(local);
  };
  const leftOf = (live: Live, local: number) => live.health - live.hurts.filter((when) => when <= local).length;
  const doomed = (live: Live) => live.health - live.hurts.length <= 0;

  const lastStart = walkers.reduce((most, walker) => Math.max(most, walker.start), 0);
  const steps = Math.ceil((lastStart + NIGHT_MOST) / TICK);
  let end = 0;
  for (let step = 0; step <= steps; step++) {
    const t = step * TICK;
    // The front as it stood from this moment: a trap put down, a tower moved, the wall slid.
    while (current + 1 < timeline.length && timeline[current + 1].at <= t + 1e-9) {
      current += 1;
      const before = setup;
      setup = timeline[current].setup;
      raise(setup, true);
      if (before.line !== setup.line || before.trail !== setup.trail) {
        for (const live of lives) if (live.phase === "trail" || live.phase === "approach" || (live.phase === "wall" && live.at?.doing !== "bound")) reroute(live);
      } else {
        // The wall's sections may have changed (a level, a gate): one at a section that is no more goes on.
        for (const live of lives) if ((live.phase === "approach" || live.phase === "wall") && live.at && !hp.has(live.at.y)) reroute(live);
      }
    }
    const ringing = lives.some((live) => {
      if (live.phase === "wait" || live.phase === "done" || (live.digger && live.rose === null)) return false;
      const [x, y] = along(live.path, live.lens, live.far);
      return near(7, x, y, BELL_REACH);
    });
    let anyone = false;
    for (const live of lives) {
      if (live.phase === "done") continue;
      if (live.phase === "wait") {
        if (t + 1e-9 < live.spec.start) {
          anyone = true;
          continue;
        }
        live.phase = live.flier || live.digger ? "in" : "trail";
      }
      anyone = true;
      const local = t - live.spec.start;
      // Done for: the last of him has landed.
      if (live.falls === null && leftOf(live, local) <= 0) {
        live.falls = [...live.hurts].sort((a, b) => a - b)[live.health - 1] ?? local;
        live.phase = "done";
        continue;
      }
      if (live.phase === "in" && live.arrived >= 0 && local >= live.arrived + (live.pops ? FIZZ_SECONDS : KNOCK_SECONDS)) {
        live.phase = "done";
        continue;
      }
      const [wasX, wasY] = along(live.path, live.lens, live.far);
      // One who tunnels comes up when he is nearly there, or where a thumper is drumming; there he is dazed a moment.
      if (live.digger && live.rose === null) {
        const thumped = near(2, wasX, wasY, THUMP_REACH);
        if (live.stop - live.far <= MOLE_UP || thumped) {
          live.rose = local;
          if (thumped) live.heldUntil = Math.max(live.heldUntil, t + DAZED);
        }
      }
      const under = live.digger && live.rose === null;
      const aloft = live.flier && live.arrived < 0;
      const grounded = !under && !aloft;
      // A stone thrower's stone has landed on a bomber: he goes off where he stands, and a section he is at is the worse for it.
      if (live.stonedAt !== null && local >= live.stonedAt && live.blew === null && live.falls === null) {
        if (Math.abs(wasX - wallXAt(setup.line, wasY)) <= AT_WALL + 4) {
          const hit = [...hp.entries()].filter(([y, entry]) => entry.left > 0 && Math.abs(y - wasY) <= 6)[0];
          if (hit) {
            hit[1].left -= hit[1].most * 0.5;
            if (hit[1].left <= 0) breakAt(hit[0], t);
          }
        }
        finish(live, local);
        live.falls = local;
        live.phase = "done";
        continue;
      }
      // At the wall: battering, a fuse, or a bound.
      if (live.phase === "approach" && live.far >= live.stop - 1e-6) {
        live.phase = "wall";
        live.at = live.at ? { ...live.at, from: t } : null;
        if (live.at?.doing === "fuse") {
          live.heldUntil = t + FIZZ_SECONDS;
          live.arrived = local;
        }
      }
      if (live.phase === "wall" && live.at) {
        const section = hp.get(live.at.y);
        if (live.at.doing === "bound") {
          if (t + 1e-9 >= live.heldUntil) {
            live.breaks.push([live.at.from - live.spec.start, local]);
            goIn(live, live.at.y);
          }
        } else if (live.at.doing === "fuse") {
          if (t + 1e-9 >= live.heldUntil) {
            // Off he goes: the section is gone, and those beside it the worse for it.
            breakAt(live.at.y, t);
            for (const [y, entry] of hp) {
              if (Math.abs(y - live.at.y) === 10 && entry.left > 0) {
                entry.left -= entry.most * 0.5;
                if (entry.left <= 0) breakAt(y, t);
              }
            }
            live.blew = live.at.y;
            live.phase = "done";
            continue;
          }
        } else if (!section || section.left <= 0) {
          // It is down (by him or by another): in he goes.
          live.breaks.push([live.at.from - live.spec.start, local]);
          goIn(live, live.at.y);
        } else if (gapsNow().some((y) => Math.abs(y - live.at!.y) <= 10)) {
          // A gap has opened beside him: through it, and never mind the gate.
          const gap = gapsNow().filter((y) => Math.abs(y - live.at!.y) <= 10)[0];
          live.breaks.push([live.at.from - live.spec.start, local]);
          goIn(live, gap);
        } else {
          section.left -= BATTERS[live.role] * TICK;
          if (section.left <= 0) breakAt(live.at.y, t);
        }
      }
      // A guardian sees him, or a blow is on its way.
      const held = t < live.heldUntil || live.phase === "wall";
      const tangled = grounded && near(4, wasX, wasY, TANGLE_REACH);
      const pace = PROWL_SPEED * PACE[live.role] * (tangled ? TANGLE_KEEPS : 1);
      if (!held && live.arrived < 0 && live.phase !== "wall") live.far = Math.min(live.stop, live.far + pace * TICK);
      if (live.phase === "trail" && live.far >= live.stop - 1e-6) atWall(live, t);
      if (live.phase === "in" && live.arrived < 0 && live.far >= live.stop - 1e-6 && !held) live.arrived = local;
      live.fars.push(live.far);
      const [x, y] = along(live.path, live.lens, live.far);
      if (grounded) {
        // A thorn strip cuts whoever is in it, a runner three times as often; a pitfall swallows the first brute, or two others.
        if (local >= live.cutAt && near(8, x, y, THORN_REACH)) {
          live.hurts.push(local);
          // A runner, at the pace he goes, is cut to ribbons.
          if (live.role === "runner") live.hurts.push(local);
          live.cutAt = local + (live.role === "runner" ? THORN_RUNNER : THORN_EVERY);
        }
        // A pitfall's cover holds a light one: it is a brute who goes through it (two a night, and then it is full).
        const pit = live.role === "brute" ? nearest(6, x, y) : null;
        if (!live.pitted && pit && Math.hypot(x - pit.x, y - pit.y) <= PIT_REACH) {
          live.pitted = true;
          const key = `${pit.x},${pit.y}`;
          const room = pits.get(key) ?? PIT_HOLDS;
          if (room > 0) {
            pits.set(key, room - 1);
            finish(live, local);
          }
        }
      }
      if (under || far12(live)) {
        // Still in the trees, or under the ground: nothing has him.
      } else {
        // The guardians: one who comes within a melee guardian's ground is met (and held); the bow shoots from where he stands.
        if (!live.duel && !doomed(live)) {
          const post = setup.posts.find((entry) => (busy.get(entry.who) ?? 0) <= t && (entry.ranged || grounded) && offBy(x - entry.x, y - entry.y) <= entry.r);
          const keeper = live.arrived >= 0 ? setup.posts.find((entry) => !entry.ranged && (busy.get(entry.who) ?? 0) <= t && offBy(live.spec.target[0] - entry.x, live.spec.target[1] - entry.y) <= entry.r + 6) : undefined;
          const meet = post ?? keeper;
          if (meet) {
            const run = meet.ranged ? RUN_SECONDS : Math.max(RUN_SECONDS, Math.hypot(x - meet.x, y - meet.y) / RUN_SPEED);
            const first = meet.ranged ? 0.45 : run + 0.2;
            const blows = Array.from({ length: meet.blows }, (_, blow) => local + first + blow * BLOW_EVERY);
            live.duel = { who: meet.who, from: local, until: blows[blows.length - 1] + 0.3, x, y, px: meet.x, py: meet.y, blows, ranged: Boolean(meet.ranged), run };
            live.hurts.push(...blows);
            busy.set(meet.who, t + (live.duel.until - local) + (meet.ranged ? 0 : run));
            if (!meet.ranged && live.arrived < 0) live.heldUntil = Math.max(live.heldUntil, t + (live.duel.until - local));
          }
        }
      }
      end = Math.max(end, t);
    }
    // What throws: each thrower at one of them at a time, the nearest (an archer's nest at whoever flies first).
    lives.forEach((live, index) => (spots[index] = live.phase === "wait" || live.phase === "done" ? [-999, -999] : along(live.path, live.lens, live.far)));
    const spotOf = (live: Live) => spots[lives.indexOf(live)];
    for (const ring of setup.watch) {
      const key = ringKey(ring);
      if ((ready.get(key) ?? 0) > t + 1e-9) continue;
      const marks = lives.filter((live) => {
        if (live.phase === "wait" || live.phase === "done" || doomed(live) || far12(live)) return false;
        if (live.digger && live.rose === null) return false;
        const [x, y] = spotOf(live);
        return offBy(x - ring.x, y - ring.y) <= ring.r;
      });
      if (marks.length === 0) continue;
      const archer = ring.work === 10;
      const mark = marks.sort((a, b) => {
        if (archer && a.flier !== b.flier) return a.flier ? -1 : 1;
        const [ax, ay] = spotOf(a);
        const [bx, by] = spotOf(b);
        return offBy(ax - ring.x, ay - ring.y) - offBy(bx - ring.x, by - ring.y) || a.spec.start - b.spec.start;
      })[0];
      ready.set(key, t + (ring.every ?? THROW_EVERY) * (ringing ? BELL_QUICKER : 1));
      const local = t - mark.spec.start;
      const moving = mark.phase !== "wall" && t >= mark.heldUntil && mark.arrived < 0;
      const aimFar = moving ? Math.min(mark.stop, mark.far + PROWL_SPEED * PACE[mark.role] * THROW_FLIES) : mark.far;
      const [aimX, aimY] = along(mark.path, mark.lens, aimFar);
      const rise = ring.rise ?? 0;
      mark.shots.push({ from: local, lands: local + THROW_FLIES, fx: ring.x, fy: ring.top ?? ring.y - 12, tx: aimX, ty: aimY - 6, work: ring.work ?? null, foot: ring.y, rise });
      const hits = (ring.hurts ?? 1) * (archer && mark.flier && mark.arrived < 0 ? 2 : 1);
      for (let hit = 0; hit < hits; hit++) mark.hurts.push(local + THROW_FLIES);
      if (ring.work === 9) {
        // The stone thrower's stone: a bomber it hits goes off, and whoever stands by where it lands is hurt too.
        if (mark.role === "bomber" && mark.blew === null) mark.stonedAt = local + THROW_FLIES;
        for (const other of lives) {
          if (other === mark || other.phase === "wait" || other.phase === "done" || doomed(other) || (other.flier && other.arrived < 0) || (other.digger && other.rose === null)) continue;
          const [ox, oy] = spotOf(other);
          if (Math.hypot(ox - aimX, oy - aimY) <= SPLASH) {
            other.hurts.push(t - other.spec.start + THROW_FLIES);
            if (other.role === "bomber" && other.blew === null) other.stonedAt = t - other.spec.start + THROW_FLIES;
          }
        }
      }
    }
    if (!anyone && step > 0) break;
  }

  const walks = lives.map((live): WalkPlan => {
    const [fx, fy] = live.path[0];
    const [tx, ty] = live.spec.target;
    const whole = Math.max(10, Math.hypot(tx - fx, ty - fy));
    const hurts = [...live.hurts].sort((a, b) => a - b);
    const falls = live.falls;
    const fizz = live.blew !== null;
    const there = fizz ? live.arrived : live.arrived >= 0 ? live.arrived : live.fars.length * TICK;
    return {
      from: [fx, fy],
      ux: (tx - fx) / whole,
      uy: (ty - fy) / whole,
      long: live.stop,
      kind: live.spec.kind,
      health: live.health,
      fars: live.fars.length > 0 ? live.fars : [0],
      shots: falls === null ? live.shots : live.shots.filter((shot) => shot.lands <= falls + 1e-9),
      duel: live.duel,
      hurts: falls === null ? hurts : hurts.slice(0, live.health),
      falls,
      there,
      harms: falls === null && (fizz || live.arrived >= 0) ? there + (live.pops ? FIZZ_SECONDS : KNOCK_SECONDS) : null,
      flies: live.flier,
      rose: live.rose,
      pops: live.pops,
      breaks: live.breaks,
      path: live.path,
      lens: live.lens,
      site: live.spec.site,
      start: live.spec.start,
      role: live.role,
      blew: live.blew
    };
  });
  return { walks, breaks, end: Math.max(end, ...walks.map((walk) => walk.start + (walk.falls ?? walk.harms ?? walk.there))) };

  /** He is let a little way out of the trees before anything has him, so that it is seen. */
  function far12(live: Live) {
    return live.far < 12;
  }
};

/** The walks of a night that are over by a time (seconds into it), and how each ended. */
export const nightHeld = (plan: NightPlan) => plan.walks.every((walk) => walk.harms === null || walk.blew !== null);
