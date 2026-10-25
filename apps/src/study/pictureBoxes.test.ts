import { describe, expect, it } from "vitest";
import { boxAt, boxBetween, cropAround, isBox, moveBox, toPicture, toStage, withinCrop, MIN_CROP } from "./pictureBoxes";

const stage = { width: 1000, height: 800 };
const natural = { width: 2000, height: 1000 };

describe("boxes drawn over a picture", () => {
  it("a point on the screen is a place on the picture at any zoom, and back", () => {
    // Fitted: half size, in the middle. The picture spans 0..1000 across, 150..650 down.
    const fit = { scale: 0.5, x: 0, y: 0 };
    expect(toPicture({ x: 0, y: 150 }, stage, fit, natural)).toEqual({ x: 0, y: 0 });
    expect(toPicture({ x: 500, y: 400 }, stage, fit, natural)).toEqual({ x: 0.5, y: 0.5 });
    // Zoomed in twice as far and moved: the same place on the picture.
    const zoomed = { scale: 1, x: -200, y: 100 };
    const back = toStage({ left: 0.25, top: 0.25, width: 0.1, height: 0.1 }, stage, zoomed, natural);
    expect(back).toEqual({ left: -200, top: 250, width: 200, height: 100 });
    expect(toPicture({ x: back.left, y: back.top }, stage, zoomed, natural)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("a box is the corners either way round, kept inside the picture, and a slip of the finger is none", () => {
    expect(boxBetween({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({ left: 0.2, top: 0.1, width: 0.6 - 0.2, height: 0.5 - 0.1 });
    const edge = boxBetween({ x: -0.5, y: 0.9 }, { x: 0.1, y: 1.4 });
    expect([edge.left, edge.top, edge.width]).toEqual([0, 0.9, 0.1]);
    expect(edge.height).toBeCloseTo(0.1);
    expect(isBox(boxBetween({ x: 0.5, y: 0.5 }, { x: 0.503, y: 0.6 }))).toBe(false);
    expect(isBox(boxBetween({ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.6 }))).toBe(true);
  });

  it("the box pressed is the top one, and a box moved stays on the picture", () => {
    const boxes = [
      { left: 0.1, top: 0.1, width: 0.3, height: 0.3 },
      { left: 0.2, top: 0.2, width: 0.1, height: 0.1 }
    ];
    expect(boxAt({ x: 0.25, y: 0.25 }, boxes)).toBe(1);
    expect(boxAt({ x: 0.12, y: 0.12 }, boxes)).toBe(0);
    expect(boxAt({ x: 0.9, y: 0.9 }, boxes)).toBe(-1);
    expect(moveBox(boxes[1], 0.9, -0.5)).toEqual({ left: 0.9, top: 0, width: 0.1, height: 0.1 });
  });

  it("a PDF's card shows its boxes and a margin, never a sliver of the page", () => {
    const crop = cropAround([
      { left: 0.2, top: 0.3, width: 0.1, height: 0.05 },
      { left: 0.5, top: 0.4, width: 0.1, height: 0.05 }
    ])!;
    expect(crop.left).toBeCloseTo(0.14);
    expect(crop.left + crop.width).toBeCloseTo(0.66);
    expect(crop.height).toBeCloseTo(MIN_CROP);
    expect(crop.top).toBeLessThanOrEqual(0.3);
    expect(crop.top + crop.height).toBeGreaterThanOrEqual(0.45);
    // Boxes all over the page: the whole page.
    expect(cropAround([{ left: 0.02, top: 0.02, width: 0.1, height: 0.1 }, { left: 0.85, top: 0.85, width: 0.1, height: 0.1 }])).toBeNull();
    expect(cropAround([])).toBeNull();
    // A box in a corner: the crop stays on the page.
    const corner = cropAround([{ left: 0.95, top: 0.95, width: 0.05, height: 0.05 }])!;
    expect(corner.left + corner.width).toBeLessThanOrEqual(1);
    expect(corner.top + corner.height).toBeLessThanOrEqual(1);
    // A box drawn on the page, placed on the part shown.
    const placed = withinCrop({ left: 0.2, top: 0.3, width: 0.1, height: 0.05 }, { left: 0.1, top: 0.2, width: 0.5, height: 0.5 });
    expect(placed.left).toBeCloseTo(0.2);
    expect(placed.top).toBeCloseTo(0.2);
    expect(placed.width).toBeCloseTo(0.2);
    expect(placed.height).toBeCloseTo(0.1);
  });
});
