import { describe, expect, it } from "vitest";
import { Battle } from "../../../../pip/base/battle";
import { group } from "../../../../pip/base/squad";
import { fitPicture } from "./fit";
import {
  CAMERA_MOST,
  DOCK_ROOM,
  HUD_ROOM,
  SIDE_ROOM,
  clampPan,
  easeCamera,
  focusOf,
  follow,
  framedView,
  groundBox,
  shownOnField,
  tagPoint,
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
      // (It was five times on this laptop, with the stronghold a quarter of the screen.) A second gate's wall runs the
      // field's whole height: there the stronghold is the field's height, and the frame no larger than the field's.
      if (fight.quirk === "gate") expect(view.backing).toBeGreaterThanOrEqual(whole.backing);
      else {
        expect(view.backing).toBeGreaterThan(whole.backing);
        expect(view.backing).toBeGreaterThanOrEqual(6);
      }
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
