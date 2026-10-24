/**
 * The ways into a camp (the raids plan, 2026-10-24). A planned raid's scouts
 * do not come in wherever they are put down: each group comes down one of
 * the camp's two or three approaches, a path from the edge of the field with
 * its own hazards, and looks after itself from where the path ends.
 *
 * - **The trail**: straight in from the left, to the gate where there is a
 *   wall. The shortest way, and the one the quirk lies on (the thorns, the
 *   ford, the pits), since it is the way everybody comes.
 * - **The ridge** and **the hollow**: round the top or the foot of the wall,
 *   longer and open, under whichever perches stand on that side. Where a
 *   wall runs end to end there is no way round, and they meet it there (at
 *   the weak gate, in a stronghold with a second one).
 *
 * All of it is worked out from the camp as it is laid out, so a stronghold
 * is always come at the same ways, and a friend's camp gets approaches from
 * its own wall and buildings (with no quirk on them: its own constructs do
 * that work). Nothing here is random: which flanks a stronghold has comes
 * from its number and seed (`roll`).
 */
import type { Structure } from "./battle";
import { EDGE, type Point } from "./field";
import type { Quirk } from "./quirks";

export type ApproachKind = "trail" | "ridge" | "hollow";
export type Approach = {
  kind: ApproachKind;
  name: string;
  /** From the edge of the field to where its group looks after itself. */
  path: Point[];
  /** A wall stands across it. */
  walled: boolean;
  /** The stronghold's quirk lies on it. */
  hazard: Quirk | null;
};

/** A hazard on the field: a stretch of thorns or water (a box), or a hidden pit. `on`: the approach it lies across. */
export type Zone = { kind: "thorns" | "water"; x0: number; y0: number; x1: number; y1: number; on: number } | { kind: "pit"; x: number; y: number; on: number };

export type Approaches = { approaches: Approach[]; zones: Zone[] };

/** A camp's roll, from its number and seed: which flanks it has, and the side its weak gate is on. */
export const rollOf = (n: number, seed: number, king: boolean) => (Math.imul(Math.max(0, Math.floor(n)) + 1, 40503) + Math.imul(seed >>> 0, 2246822519) + (king ? 7 : 0)) >>> 0;
/** In a stronghold with a second gate: whether the weak one is at the top of the wall (else at its foot). */
export const posternTop = (roll: number) => ((roll >>> 3) & 1) === 0;
/** How far up and down the field a stronghold's weak gate stands. */
export const POSTERN_Y = { top: 24, bottom: 104 } as const;

const buildingOf = (entry: Structure) => entry.kind !== "wall" && !entry.flat && entry.traps === undefined;

/**
 * The approaches to a camp laid out as `structures` (after its quirk has
 * changed it: a second gate's wall, end to end). `roll` < 0 gives every way
 * the layout allows (a friend's camp); `line` is where a stronghold's wall
 * would stand when it has none yet, for the hazards.
 */
export const approachesOf = (structures: readonly Structure[], options: { quirk: Quirk | null; roll: number; line?: number }): Approaches => {
  const walls = structures.filter((entry) => entry.kind === "wall");
  const buildings = structures.filter(buildingOf);
  const nest = structures.find((entry) => entry.kind === "nest") ?? buildings[0] ?? null;
  // The gate is the toughest section (the middle one, of two as tough).
  const mid = walls.length > 0 ? walls.reduce((sum, wall) => sum + wall.y, 0) / walls.length : (nest?.y ?? 64);
  const gate = walls.reduce<Structure | null>((best, wall) => (!best || wall.max > best.max || (wall.max === best.max && Math.abs(wall.y - mid) < Math.abs(best.y - mid)) ? wall : best), null);
  const trailY = gate ? gate.y : mid;
  const left = buildings.length > 0 ? Math.min(...buildings.map((entry) => entry.x - entry.r)) : 140;
  const top = buildings.length > 0 ? Math.min(...buildings.map((entry) => entry.y - entry.r)) : 40;
  const foot = buildings.length > 0 ? Math.max(...buildings.map((entry) => entry.y + entry.r)) : 90;
  const wallX = walls.length > 0 ? walls.reduce((sum, wall) => sum + wall.x, 0) / walls.length : (options.line ?? Math.max(30, left - 14));
  const wallTop = walls.length > 0 ? Math.min(...walls.map((wall) => wall.y - wall.r)) : trailY;
  const wallFoot = walls.length > 0 ? Math.max(...walls.map((wall) => wall.y + wall.r)) : trailY;
  const sealed = walls.length > 0 && wallTop <= EDGE.top + 8 && wallFoot >= EDGE.bottom - 8;
  const start = EDGE.left + 2;

  const kinds: ApproachKind[] =
    options.roll < 0 ? ["trail", "ridge", "hollow"] : options.roll % 4 === 0 ? ["trail", "ridge"] : options.roll % 4 === 1 ? ["trail", "hollow"] : ["trail", "ridge", "hollow"];
  // A second gate's weak one is come at round its own side: that flank is always there.
  if (options.quirk === "gate" && options.roll >= 0) {
    const side: ApproachKind = posternTop(options.roll) ? "ridge" : "hollow";
    if (!kinds.includes(side)) kinds.push(side);
  }

  const flank = (kind: "ridge" | "hollow"): Point[] => {
    const up = kind === "ridge";
    // Round the end of the wall, clear of the camp; or, where the wall runs end to end, to its end section (the weak gate, where there is one).
    const postern = options.quirk === "gate" && (up ? posternTop(options.roll) : !posternTop(options.roll));
    const lane = sealed
      ? postern
        ? up
          ? POSTERN_Y.top
          : POSTERN_Y.bottom
        : up
          ? wallTop + 6
          : wallFoot - 6
      : up
        ? Math.max(EDGE.top + 4, Math.min(wallTop - 8, top - 8))
        : Math.min(EDGE.bottom - 2, Math.max(wallFoot + 8, foot + 6));
    const turn = Math.max(wallX + 16, Math.min(left + 4, wallX + 30));
    return [
      { x: start, y: lane },
      { x: turn, y: lane },
      { x: turn + 10, y: up ? lane + 6 : lane - 6 }
    ];
  };
  const trailEnd = walls.length > 0 ? wallX + 14 : Math.max(start + 20, left - 8);
  const approaches: Approach[] = kinds.map((kind) => {
    if (kind === "trail") {
      const hazard = options.quirk === "hedge" || options.quirk === "ford" || options.quirk === "pits" ? options.quirk : null;
      const name = hazard === "ford" ? "The ford" : hazard === "hedge" ? "The thorn trail" : walls.length > 0 ? "The walled trail" : "The trail";
      return { kind, name, path: [{ x: start, y: trailY }, { x: trailEnd, y: trailY }], walled: walls.length > 0, hazard };
    }
    const postern = options.quirk === "gate" && (kind === "ridge" ? posternTop(options.roll) : !posternTop(options.roll));
    return {
      kind,
      name: postern ? (kind === "ridge" ? "The ridge, to the weak gate" : "The hollow, to the weak gate") : kind === "ridge" ? "The ridge" : "The hollow",
      path: flank(kind),
      walled: sealed,
      hazard: postern ? "gate" : null
    };
  });

  // The quirk's hazards, across the trail in front of the wall's line.
  const zones: Zone[] = [];
  const on = kinds.indexOf("trail");
  const line = walls.length > 0 ? wallX : (options.line ?? wallX);
  if (options.quirk === "hedge") zones.push({ kind: "thorns", x0: line - 46, x1: line - 16, y0: trailY - 13, y1: trailY + 13, on });
  if (options.quirk === "ford") zones.push({ kind: "water", x0: line - 80, x1: line - 32, y0: trailY - 16, y1: trailY + 16, on });
  if (options.quirk === "pits") for (const back of [56, 32]) zones.push({ kind: "pit", x: line - back, y: trailY, on });
  return { approaches, zones };
};
