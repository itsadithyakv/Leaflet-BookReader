import { describe, expect, it } from "vitest";
import { GAME_W } from "../arcade/games";
import { doorBox, inDoor, letThrough, overlap, pad, placeBubble, placePaw, sceneToScreen, siteBox, whole, type Rect } from "./geometry";

const BURROW: [number, number] = [150, 90];
const PHONE: Rect = { left: 0, top: 0, width: 740, height: 360 };
const DESKTOP: Rect = { left: 0, top: 0, width: 1280, height: 800 };
const BUBBLE = { width: 300, height: 92 };

const inside = (box: Rect, bounds: Rect) => box.left >= bounds.left && box.top >= bounds.top && box.left + box.width <= bounds.left + bounds.width && box.top + box.height <= bounds.top + bounds.height;

describe("finding things in the picture", () => {
  it("puts a box of the clearing on the screen by the canvas and its sky", () => {
    const canvas = { left: 10, top: 20, width: GAME_W * 3 };
    expect(sceneToScreen({ x: 10, y: 5, w: 4, h: 2 }, canvas, 0)).toEqual({ left: 40, top: 35, width: 12, height: 6 });
    expect(sceneToScreen({ x: 10, y: 5, w: 4, h: 2 }, canvas, 10).top).toBe(65);
    expect(whole({ left: 1.4, top: 2.6, width: 3.2, height: 1 })).toEqual({ left: 1, top: 2, width: 4, height: 2 });
  });

  it("knows the burrow's door from the rest of the burrow", () => {
    const burrow = siteBox("burrow", BURROW);
    const door = doorBox(BURROW);
    // The door is inside the burrow's front, at its foot.
    expect(door.x).toBeGreaterThan(burrow.x);
    expect(door.x + door.w).toBeLessThan(burrow.x + burrow.w);
    expect(inDoor(BURROW, BURROW[0], BURROW[1] - 3)).toBe(true);
    // The burrow's shoulders and top are not the door: a tap there chooses the burrow.
    expect(inDoor(BURROW, burrow.x + 1, BURROW[1] - 3)).toBe(false);
    expect(inDoor(BURROW, BURROW[0], burrow.y + 1)).toBe(false);
    // A finger's width on a phone (3 CSS pixels to the picture's pixel): at least 36 px each way.
    expect(door.w * 3).toBeGreaterThanOrEqual(36);
    expect(door.h * 3).toBeGreaterThanOrEqual(36);
  });
});

describe("what a tap may reach during the tour", () => {
  const hole: Rect = { left: 100, top: 100, width: 40, height: 30 };
  it("lets through only taps in a hole", () => {
    expect(letThrough({ x: 120, y: 110 }, [hole])).toBe(true);
    expect(letThrough({ x: 100, y: 100 }, [hole])).toBe(true);
    expect(letThrough({ x: 140, y: 110 }, [hole])).toBe(false);
    expect(letThrough({ x: 99, y: 110 }, [hole])).toBe(false);
    expect(letThrough({ x: 120, y: 131 }, [hole])).toBe(false);
    expect(letThrough({ x: 5, y: 5 }, [hole, { left: 0, top: 0, width: 10, height: 10 }])).toBe(true);
    expect(letThrough({ x: 5, y: 5 }, [])).toBe(false);
  });
});

describe("Pip's bubble", () => {
  // Every target the phone tour points at, at the audit's layout (the oak was covered there), and a few hard places.
  const targets: Array<[string, Rect]> = [
    ["the oak, middle left", { left: 230, top: 150, width: 80, height: 92 }],
    ["the burrow, middle", { left: 300, top: 180, width: 100, height: 80 }],
    ["the door", { left: 335, top: 230, width: 36, height: 40 }],
    ["the larder stakes, right", { left: 560, top: 150, width: 100, height: 86 }],
    ["a key in the panel, top right", { left: 600, top: 40, width: 120, height: 32 }],
    ["the basket, low", { left: 380, top: 290, width: 48, height: 46 }],
    ["top left corner", { left: 8, top: 8, width: 60, height: 40 }],
    ["bottom right corner", { left: 660, top: 300, width: 70, height: 50 }]
  ];
  for (const [name, target] of targets)
    it(`never covers ${name} in phone landscape, and stays on screen`, () => {
      const bounds = pad(PHONE, -8);
      const at = placeBubble(target, BUBBLE, bounds);
      const box = { left: at.left, top: at.top, width: BUBBLE.width, height: BUBBLE.height };
      expect(overlap(box, target)).toBe(0);
      expect(inside(box, bounds)).toBe(true);
      expect(Number.isInteger(at.left) && Number.isInteger(at.top)).toBe(true);
    });

  it("goes above or below on a large screen, its tail at the target", () => {
    const target = { left: 600, top: 400, width: 80, height: 80 };
    const at = placeBubble(target, BUBBLE, DESKTOP);
    expect(at.side).toBe("above");
    expect(at.top + BUBBLE.height).toBeLessThanOrEqual(target.top);
    const tail = at.left + (BUBBLE.width * at.tailAt) / 100;
    expect(Math.abs(tail - 640)).toBeLessThan(2);
  });

  it("keeps off the paw and an open panel's card when it can", () => {
    const target = { left: 330, top: 200, width: 60, height: 50 };
    const paw = placePaw(target, { width: 27, height: 33 }, PHONE);
    const pawRect = { left: paw.left, top: paw.top, width: 27, height: 33 };
    const card = { left: 440, top: 0, width: 300, height: 360 };
    const at = placeBubble(target, BUBBLE, PHONE, [pawRect, card]);
    const box = { left: at.left, top: at.top, width: BUBBLE.width, height: BUBBLE.height };
    expect(overlap(box, target)).toBe(0);
    expect(overlap(box, pawRect)).toBe(0);
    expect(overlap(box, card)).toBe(0);
  });

  it("puts the paw over the target, or under it where there is no room above, in whole pixels", () => {
    const above = placePaw({ left: 100.5, top: 100, width: 41, height: 20 }, { width: 27, height: 33 }, PHONE);
    expect(above.up).toBe(false);
    expect(above.top + 33).toBeLessThanOrEqual(100);
    expect(Number.isInteger(above.left)).toBe(true);
    const below = placePaw({ left: 100, top: 10, width: 40, height: 20 }, { width: 27, height: 33 }, PHONE);
    expect(below.up).toBe(true);
    expect(below.top).toBeGreaterThanOrEqual(30);
  });
});
