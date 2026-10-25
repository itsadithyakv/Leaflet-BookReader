import { describe, expect, it } from "vitest";
import { Battle } from "../../../../pip/base/battle";
import { group } from "../../../../pip/base/squad";
import { fitPicture } from "./fit";
import {
  CAMERA_MOST,
  DOCK_ROOM,
  EDGE_INSET,
  HUD_ROOM,
  SIDE_ROOM,
  clampPan,
  centreOn,
  easeCamera,
  edgeMarks,
  focusOf,
  follow,
  framedView,
  groundBox,
  sealedWall,
  shownOnField,
  tagPoint,
  toField,
  toPicture,
  toRoom,
  type Clear,
  type FramedView,
  type PictureBox
} from "./raidLayout";

/**
 * Where a raid's field goes (raidLayout.ts, 2026-10-25): framed on the stronghold and the last stretch of its approaches
 * at a whole number of device pixels, larger than the whole field would be; the rest of the field a drag away; and a
 * camera that keeps the stronghold in view, moves slowly, and keeps to whole pixels.
 */

const battle = (n: number) =>
  new Battle({ n, king: false, capacity: 13, level: 4, kinds: ["sprout", "slinger", "mole"], fast: false, squad: { groups: [group({ sprout: 9, slinger: 2, mole: 1 }, 0)] } });

/** The room a 1366 by 768 laptop gives the raid, under the camp's bar along its top (as measured in the app). */
const LAPTOP = { w: 1248, h: 626, top: 40 };
const wideFight = (room: { top: number }): Clear => ({ top: room.top + 6, right: SIDE_ROOM, bottom: 6, left: 6 });
const tallFight = (room: { top: number }): Clear => ({ top: room.top + HUD_ROOM, right: 6, bottom: DOCK_ROOM, left: 6 });

/** The clear part of the room, on the picture. */
const clearOnPicture = (view: FramedView, w: number, h: number, clear: Clear): PictureBox => ({
  x0: (clear.left - view.left) / view.css,
  y0: (clear.top - view.top) / view.css,
  x1: (w - clear.right - view.left) / view.css,
  y1: (h - clear.bottom - view.top) / view.css
});

describe("a raid's field, framed on the stronghold", () => {
  for (const n of [2, 4, 6, 7, 9, 12]) {
    it(`frames stronghold ${n + 1} on its stronghold at whole device pixels, larger than the whole field where it can be`, () => {
      const fight = battle(n);
      const clear = wideFight(LAPTOP);
      const view = framedView(LAPTOP.w, LAPTOP.h, 1, clear, (orient) => focusOf(orient, fight.structures, fight.approaches, fight.zones));
      const whole = fitPicture(240, 120, LAPTOP.w - clear.left - clear.right, LAPTOP.h - clear.top - clear.bottom, 1, 0.5);
      expect(view.orient).toBe("wide");
      expect(view.crisp).toBe(true);
      expect(Number.isInteger(view.backing)).toBe(true);
      // (It was five times on this laptop, with the stronghold a quarter of the screen; a second gate's, whose wall runs
      // the field's whole height, stayed at the whole field's size until 2026-10-26.)
      expect(view.backing).toBeGreaterThan(whole.backing);
      expect(view.backing).toBeGreaterThanOrEqual(6);
      // The stronghold's own pieces, standing, all in the room left clear of the bar and the orders.
      const stronghold = focusOf("wide", fight.structures, []).keep;
      const shown = clearOnPicture(view, LAPTOP.w, LAPTOP.h, clear);
      expect(stronghold.x0).toBeGreaterThanOrEqual(shown.x0 - 1);
      expect(stronghold.x1).toBeLessThanOrEqual(shown.x1 + 1);
      expect(stronghold.y0).toBeGreaterThanOrEqual(shown.y0 - 3);
      expect(stronghold.y1).toBeLessThanOrEqual(shown.y1 + 3);
      // The field covers all of the clear room: no bare edge where there is field to show.
      expect(view.left).toBeLessThanOrEqual(clear.left);
      expect(view.left + view.w * view.css).toBeGreaterThanOrEqual(LAPTOP.w - clear.right);
    });
  }

  it("leaves the paths' first steps out, a drag away, and flags them where they come into view", () => {
    const fight = battle(6);
    const clear = wideFight(LAPTOP);
    const view = framedView(LAPTOP.w, LAPTOP.h, 1, clear, (orient) => focusOf(orient, fight.structures, fight.approaches, fight.zones));
    const edge = shownOnField(view, LAPTOP.w, LAPTOP.h);
    // Framed, the start of the trail (x 6) is off the left edge...
    expect(edge.x0).toBeGreaterThan(6);
    // ...and a drag to the right as far as it goes brings it in.
    const dragged = shownOnField(view, LAPTOP.w, LAPTOP.h, view.pan.maxX, 0);
    expect(dragged.x0).toBeLessThanOrEqual(0);
    // The land is painted far enough round the field for wherever it is dragged.
    const land = groundBox(view, LAPTOP.w, LAPTOP.h, view.pan);
    expect(land.left + view.pan.maxX).toBeLessThanOrEqual(0);
    expect(land.left + view.pan.minX + land.w * view.css).toBeGreaterThanOrEqual(LAPTOP.w);
    // Each approach's tag sits on its path where it is in view.
    const shown = { x0: edge.x0, x1: edge.x1, y0: edge.y0, y1: edge.y1 };
    fight.approaches.forEach((approach, index) => {
      const at = tagPoint(approach.path, index, shown);
      expect(at.x).toBeGreaterThanOrEqual(shown.x0);
      expect(at.x).toBeLessThanOrEqual(shown.x1);
    });
  });

  it("on a phone held upright, turns the field and frames it larger than the whole field would be", () => {
    const fight = battle(6);
    const room = { w: 375, h: 640, top: 0 };
    const clear = tallFight(room);
    const view = framedView(room.w, room.h, 3, clear, (orient) => focusOf(orient, fight.structures, fight.approaches, fight.zones));
    const whole = fitPicture(120, 240, room.w - 12, room.h - clear.top - clear.bottom, 3, 0.5);
    expect(view.orient).toBe("tall");
    expect(view.crisp).toBe(true);
    expect(view.backing).toBeGreaterThan(whole.backing);
    // The camp at the top, every piece of it in the room between the bar and the orders.
    const stronghold = focusOf("tall", fight.structures, []).keep;
    const shown = clearOnPicture(view, room.w, room.h, clear);
    expect(stronghold.y0).toBeGreaterThanOrEqual(shown.y0 - 3);
    expect(stronghold.y1).toBeLessThanOrEqual(shown.y1 + 3);
  });
});

describe("the fight's camera", () => {
  const fight = battle(6);
  const clear = wideFight(LAPTOP);
  const view = framedView(LAPTOP.w, LAPTOP.h, 1, clear, (orient) => focusOf(orient, fight.structures, fight.approaches, fight.zones));
  const window = { left: clear.left, top: clear.top, right: LAPTOP.w - clear.right, bottom: LAPTOP.h - clear.bottom };
  const keep = focusOf("wide", fight.structures, []).keep;

  it("stays as framed with nothing to follow, and keeps the stronghold in view whatever the scouts do", () => {
    expect(follow(view, window, keep, null)).toEqual({ dx: 0, dy: 0 });
    // Scouts just come in at the far left: the camera leans toward them only as far as the stronghold allows.
    const arriving: PictureBox = { x0: -2, y0: 50, x1: 14, y1: 68 };
    const to = follow(view, window, keep, arriving);
    expect(to.dx).toBeGreaterThanOrEqual(0);
    const right = (window.right - view.left - to.dx) / view.css;
    expect(right).toBeGreaterThanOrEqual(keep.x1 - 0.5);
    // At the camp: no need to move.
    const atCamp: PictureBox = { x0: 120, y0: 40, x1: 170, y1: 90 };
    expect(follow(view, window, keep, atCamp)).toEqual({ dx: 0, dy: 0 });
  });

  it("eases slowly, at whole device pixels, never faster than its most, and is still once there", () => {
    let at = { dx: 0, dy: 0 };
    const to = { dx: 300, dy: -40 };
    const ratio = 2;
    let last = at;
    for (let frame = 0; frame < 600; frame++) {
      at = easeCamera(at, to, 1 / 60, ratio);
      expect(Math.abs(at.dx - last.dx)).toBeLessThanOrEqual(CAMERA_MOST / 60 + 1e-9);
      expect(Number.isInteger(at.dx * ratio)).toBe(true);
      expect(Number.isInteger(at.dy * ratio)).toBe(true);
      last = at;
    }
    expect(Math.abs(at.dx - to.dx)).toBeLessThan(1);
    // Within a device pixel of where it wants to be: it stays put (no to and fro by a pixel).
    expect(easeCamera(at, { dx: at.dx + 0.3, dy: at.dy }, 1 / 60, ratio)).toEqual(at);
    // Half a second at most moves it CAMERA_MOST / 2.
    expect(easeCamera({ dx: 0, dy: 0 }, { dx: 5000, dy: 0 }, 0.5).dx).toBeLessThanOrEqual(CAMERA_MOST / 2);
  });

  it("keeps a drag within the field, at whole device pixels", () => {
    const kept = clampPan(view.pan, 99999, -99999, 1.5);
    expect(kept.dx).toBeCloseTo(view.pan.maxX, 0);
    expect(kept.dy).toBeLessThanOrEqual(0);
    expect(kept.dx * 1.5).toBeCloseTo(Math.round(kept.dx * 1.5), 6);
  });

  it("puts the tags and targets where the field's points are, as framed", () => {
    const nest = fight.structures.find((entry) => entry.kind === "nest")!;
    const at = toRoom(view, nest.x, nest.y);
    const picture = toPicture(view, nest.x, nest.y);
    expect(at.left).toBeCloseTo(view.left + picture.x * view.css);
    expect(at.top).toBeCloseTo(view.top + picture.y * view.css);
  });
});

describe("a second gate's stronghold, framed on its gates (2026-10-26)", () => {
  const room = { w: 375 - 46, h: 618, top: 0 };
  for (const n of [2, 4]) {
    it(`frames stronghold ${n + 1} larger than the whole field, both its gates in view, and lets the wall run on out of it`, () => {
      const fight = battle(n);
      expect(fight.quirk).toBe("gate");
      expect(sealedWall(fight.structures)).toBe(true);
      const gates = fight.structures.filter((entry) => entry.kind === "wall" && entry.gate);
      expect(gates.map((gate) => gate.gate).sort()).toEqual(["main", "postern"]);
      for (const [shape, clear, ratio] of [
        [LAPTOP, wideFight(LAPTOP), 1],
        [room, tallFight(room), 2],
        // An upright phone's plan, the planner folded to a row along the foot.
        [room, { top: 6, right: 6, bottom: 80, left: 6 }, 2]
      ] as const) {
        const view = framedView(shape.w, shape.h, ratio, clear, (orient) => focusOf(orient, fight.structures, fight.approaches, fight.zones));
        const roomW = shape.w - clear.left - clear.right;
        const roomH = shape.h - clear.top - clear.bottom;
        const whole = view.orient === "wide" ? fitPicture(240, 120, roomW, roomH, ratio, 0.5) : fitPicture(120, 240, roomW, roomH, ratio, 0.5);
        expect(view.backing, `${view.orient}, ${shape.w} by ${shape.h}`).toBeGreaterThan(whole.backing);
        const shown = clearOnPicture(view, shape.w, shape.h, clear);
        for (const gate of gates) {
          const at = toPicture(view, gate.x, gate.y);
          expect(at.x, `the ${gate.gate} gate across`).toBeGreaterThanOrEqual(shown.x0);
          expect(at.x).toBeLessThanOrEqual(shown.x1);
          expect(at.y, `the ${gate.gate} gate down`).toBeGreaterThanOrEqual(shown.y0);
          expect(at.y).toBeLessThanOrEqual(shown.y1);
        }
        // The wall itself is longer than the view: it runs off it.
        const ends = fight.structures.filter((entry) => entry.kind === "wall").map((wall) => toPicture(view, wall.x, wall.y));
        const along = view.orient === "wide" ? ends.map((end) => end.y) : ends.map((end) => end.x);
        const [low, high] = view.orient === "wide" ? [shown.y0, shown.y1] : [shown.x0, shown.x1];
        expect(Math.min(...along) < low || Math.max(...along) > high).toBe(true);
        // Every way in still has its tag in the view: the one to the wall's far end at the view's edge.
        const a = toField(view, shown.x0, shown.y0);
        const b = toField(view, shown.x1, shown.y1);
        const field = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
        fight.approaches.forEach((approach, index) => {
          const tag = tagPoint(approach.path, index, field, view.orient);
          expect(tag.x, approach.name).toBeGreaterThanOrEqual(field.x0);
          expect(tag.x).toBeLessThanOrEqual(field.x1);
          expect(tag.y, approach.name).toBeGreaterThanOrEqual(field.y0);
          expect(tag.y).toBeLessThanOrEqual(field.y1);
        });
      }
    });
  }

  it("frames a stronghold whose wall has a way round it as before: its whole wall in view", () => {
    const fight = battle(6);
    expect(sealedWall(fight.structures)).toBe(false);
    const keep = focusOf("wide", fight.structures, []).keep;
    for (const wall of fight.structures.filter((entry) => entry.kind === "wall")) {
      expect(wall.y - wall.r).toBeGreaterThanOrEqual(keep.y0 - 1);
      expect(wall.y + wall.r).toBeLessThanOrEqual(keep.y1 + 1);
    }
  });
});

describe("a group out of view in a fight (2026-10-26)", () => {
  // An upright phone's fight, framed on the stronghold; the ford well down the trail, below the orders.
  const fight = battle(7);
  const room = { w: 329, h: 618, top: 0 };
  const clear = tallFight(room);
  const view = framedView(room.w, room.h, 2, clear, (orient) => focusOf(orient, fight.structures, fight.approaches, fight.zones));
  const window = { left: clear.left, top: clear.top, right: room.w - clear.right, bottom: room.h - clear.bottom };
  const ford = fight.zones.find((zone) => zone.kind === "water")!;
  if (!("x0" in ford)) throw new Error("the ford is a stretch of the trail");
  const wading = Array.from({ length: 6 }, (_, k) => ({ id: k, x: ford.x0 + 4 + k, y: (ford.y0 + ford.y1) / 2 }));
  const atGate = { id: 6, x: 112, y: 59 };

  it("marks a group at the ford, out of view below, at the foot of the window with an arrow down and its count", () => {
    const marks = edgeMarks(view, { dx: 0, dy: 0 }, window, [{ group: 0, points: wading }]);
    expect(marks).toHaveLength(1);
    const [mark] = marks;
    expect(mark).toMatchObject({ group: 0, turn: 180, count: 6 });
    expect(mark.top).toBe(window.bottom - EDGE_INSET);
    expect(mark.left).toBeGreaterThanOrEqual(window.left + EDGE_INSET);
    expect(mark.left).toBeLessThanOrEqual(window.right - EDGE_INSET);
    expect(mark.ids).toEqual(wading.map((point) => point.id));
  });

  it("marks the ones held up when a quick one of the group is in view, and none for a group in view or one straggler", () => {
    // A mole at the gate and the rest at the ford: the rest are marked, and only they.
    const split = edgeMarks(view, { dx: 0, dy: 0 }, window, [{ group: 0, points: [atGate, ...wading] }]);
    expect(split).toHaveLength(1);
    expect(split[0].count).toBe(6);
    expect(split[0].ids).not.toContain(atGate.id);
    // All at the gate: no mark. One straggler left behind: no mark either.
    expect(edgeMarks(view, { dx: 0, dy: 0 }, window, [{ group: 0, points: [atGate, { ...atGate, id: 9 }] }])).toEqual([]);
    expect(edgeMarks(view, { dx: 0, dy: 0 }, window, [{ group: 0, points: [atGate, { ...atGate, id: 9 }, wading[0]] }])).toEqual([]);
  });

  it("keeps two marks on one edge apart, and points each toward its group", () => {
    const beside = wading.map((point) => ({ ...point, id: point.id + 20, y: point.y - 2 }));
    const marks = edgeMarks(view, { dx: 0, dy: 0 }, window, [
      { group: 0, points: wading },
      { group: 1, points: beside }
    ]);
    expect(marks).toHaveLength(2);
    expect(Math.abs(marks[0].left - marks[1].left)).toBeGreaterThanOrEqual(40);
    for (const mark of marks) expect(mark.turn % 45).toBe(0);
  });

  it("brings marked scouts into the middle of the window when they are looked at, as far as the field goes", () => {
    const xs = wading.map((point) => toPicture(view, point.x, point.y));
    const box = { x0: Math.min(...xs.map((at) => at.x)) - 8, y0: Math.min(...xs.map((at) => at.y)) - 18, x1: Math.max(...xs.map((at) => at.x)) + 8, y1: Math.max(...xs.map((at) => at.y)) + 4 };
    const to = centreOn(view, window, box, 2);
    expect(Number.isInteger(to.dy * 2)).toBe(true);
    expect(to.dy).toBeLessThan(0);
    expect(to.dy).toBeGreaterThanOrEqual(view.pan.minY);
    // There, they are in view and have no mark.
    expect(edgeMarks(view, to, window, [{ group: 0, points: wading }])).toEqual([]);
  });
});
