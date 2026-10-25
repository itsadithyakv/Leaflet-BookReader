import { describe, expect, it } from "vitest";
import { clampView, fitView, type Size, type ZoomView } from "../readers/imageZoom";
import type { Rect } from "./cards";
import { MASK_MIN_PX, boxBetween, cropAround, cropPixels, keepStill, maskOnImage, toPicture, toStage, visiblePart } from "./pictureBoxes";

/** Whether `outer` holds all of `inner`. */
const holds = (outer: Rect, inner: Rect) =>
  outer.left <= inner.left + 1e-9 &&
  outer.top <= inner.top + 1e-9 &&
  outer.left + outer.width >= inner.left + inner.width - 1e-9 &&
  outer.top + outer.height >= inner.top + inner.height - 1e-9;

/**
 * The maker as the reader uses it: a stage somewhere in the window, with a border, the picture at
 * a zoom; the reader drags from one corner of a label to the other as seen on the screen. Returns
 * the box kept (fractions of the picture), through the maker's own mapping of a pointer.
 */
const drawOver = (label: Rect, natural: Size, stage: Size, view: ZoomView, at: { left: number; top: number; border: number }) => {
  const onScreen = toStage(label, stage, view, natural);
  const client = (x: number, y: number) => ({ clientX: at.left + at.border + x, clientY: at.top + at.border + y });
  // PictureCardMaker's `local`: from the window to the inside of the stage's border.
  const local = (event: { clientX: number; clientY: number }) => ({ x: event.clientX - at.left - at.border, y: event.clientY - at.top - at.border });
  const a = client(onScreen.left, onScreen.top);
  const b = client(onScreen.left + onScreen.width, onScreen.top + onScreen.height);
  return boxBetween(toPicture(local(a), stage, view, natural), toPicture(local(b), stage, view, natural));
};

/** "Left ventricle" on the heart diagram of the screenshots (1200 x 900). */
const LABEL = { left: 970 / 1200, top: 612 / 900, width: 220 / 1200, height: 40 / 900 };

describe("the box covered in review is where it was drawn", () => {
  it("whatever the zoom it was drawn at, the pan, the frame's padding and border, and the pixel ratio", () => {
    const stage = { width: 393, height: 600 };
    for (const ratio of [1, 2.75]) {
      // A picture's pixels follow the screen it was drawn for (a PDF page is drawn at the pixel ratio).
      const natural = { width: 1200 * ratio, height: 900 * ratio };
      const fit = fitView(natural, stage);
      for (const view of [fit, clampView({ scale: fit.scale * 2.3, x: -140, y: 60 }, natural, stage)]) {
        const box = drawOver(LABEL, natural, stage, view, { left: 0, top: 56, border: 3 });
        expect(box.left).toBeCloseTo(LABEL.left, 9);
        expect(box.top).toBeCloseTo(LABEL.top, 9);
        expect(box.width).toBeCloseTo(LABEL.width, 9);
        expect(box.height).toBeCloseTo(LABEL.height, 9);
        // In review: drawn 345 or 702 px wide, inside a frame with 6 px of padding and a 2 px border.
        for (const width of [345, 702]) {
          const image = { left: 2 + 6, top: 2 + 6, width, height: (width * 900) / 1200 };
          const cover = maskOnImage(box, null, image);
          const there = {
            left: image.left + LABEL.left * image.width,
            top: image.top + LABEL.top * image.height,
            width: LABEL.width * image.width,
            height: LABEL.height * image.height
          };
          expect(holds(cover, there)).toBe(true);
          // And a margin past it: 4% of the box, at least 2 px.
          expect(there.left - cover.left).toBeGreaterThanOrEqual(Math.max(MASK_MIN_PX, there.width * 0.04) - 1e-9);
          expect(there.top - cover.top).toBeGreaterThanOrEqual(MASK_MIN_PX - 1e-9);
          expect(cover.top + cover.height - (there.top + there.height)).toBeGreaterThanOrEqual(MASK_MIN_PX - 1e-9);
        }
      }
    }
  });

  it("on a PDF page's cut-out, cut with whole pixels", () => {
    const page = { width: 595, height: 842 };
    const label = { left: 380 / page.width, top: 500 / page.height, width: 110 / page.width, height: 14 / page.height };
    for (const ratio of [1, 2.75]) {
      const sheet = { width: Math.round(page.width * 2.4 * ratio), height: Math.round(page.height * 2.4 * ratio) };
      const stage = { width: 1280, height: 720 };
      const view = clampView({ scale: fitView(sheet, stage).scale * 2.3, x: 90, y: -200 }, sheet, stage);
      const box = drawOver(label, sheet, stage, view, { left: 0, top: 0, border: 0 });
      // Zoomed in, the part of the page in view (and the boxes) is what the card shows.
      const crop = cropAround([box, { left: 0.1, top: 0.2, width: 0.08, height: 0.02 }], visiblePart(stage, view, sheet));
      expect(crop).not.toBeNull();
      // The cut-out as study/pictureSource.ts draws it: whole pixels.
      const cut = cropPixels(sheet, crop!);
      for (const width of [cut.width, 340]) {
        const image = { left: 0, top: 0, width, height: (width * cut.height) / cut.width };
        const cover = maskOnImage(box, crop, image);
        const scale = width / cut.width;
        const there = {
          left: (label.left * sheet.width - cut.x) * scale,
          top: (label.top * sheet.height - cut.y) * scale,
          width: label.width * sheet.width * scale,
          height: label.height * sheet.height * scale
        };
        expect(holds(cover, there)).toBe(true);
      }
    }
  });

  it("a box drawn after the maker's bar grows a row still covers its label (the screenshots' bug)", () => {
    // A phone upright: the stage loses 26 px when a box is chosen and its label field joins the bar.
    const natural = { width: 1200, height: 900 };
    const before = { width: 393, height: 600 };
    const after = { width: 393, height: 574 };
    const view = fitView(natural, before);
    // Where the reader saw the label, before the bar grew.
    const seen = toStage(LABEL, before, view, natural);
    const dragged = (still: ZoomView) =>
      boxBetween(
        toPicture({ x: seen.left, y: seen.top }, after, still, natural),
        toPicture({ x: seen.left + seen.width, y: seen.top + seen.height }, after, still, natural)
      );
    // As it was: the picture slid up half the lost height, and the box landed 13 px under the label.
    expect(seen.top - toStage(LABEL, after, view, natural).top).toBeCloseTo(13);
    expect(dragged(view).top).toBeGreaterThan(LABEL.top + 0.02);
    // Now the picture stays still on the screen, and the box is the label.
    const still = keepStill(view, before, after);
    expect(toStage(LABEL, after, still, natural)).toEqual(seen);
    const box = dragged(still);
    const image = { left: 0, top: 0, width: 345, height: 258.75 };
    const there = { left: LABEL.left * 345, top: LABEL.top * 258.75, width: LABEL.width * 345, height: LABEL.height * 258.75 };
    expect(holds(maskOnImage(box, null, image), there)).toBe(true);
  });

  it("a PDF card keeps the figure its labels name, not the labels alone", () => {
    // Labels down the right of the page, the figure at the left: zoomed in on both.
    const labels = [0.22, 0.38, 0.6, 0.67].map((top) => ({ left: 0.73, top, width: 0.1, height: 0.025 }));
    const figure = { left: 0.38, top: 0.15, width: 0.25, height: 0.6 };
    const seen = { left: 0.3, top: 0.12, width: 0.62, height: 0.68 };
    const crop = cropAround(labels, seen)!;
    expect(holds(crop, figure)).toBe(true);
    for (const label of labels) expect(holds(crop, label)).toBe(true);
    // At the fit the whole page is in view: the whole page is the card.
    expect(cropAround(labels, { left: -0.2, top: 0, width: 1.4, height: 1 })).toBeNull();
  });

  it("stays on the picture, and is never smaller than the box", () => {
    const image = { left: 4, top: 4, width: 200, height: 100 };
    const corner = maskOnImage({ left: 0.9, top: 0.9, width: 0.1, height: 0.1 }, null, image);
    expect(corner.left + corner.width).toBeLessThanOrEqual(204);
    expect(corner.top + corner.height).toBeLessThanOrEqual(104);
    expect(corner.width).toBeGreaterThanOrEqual(20);
    const small = maskOnImage({ left: 0.5, top: 0.5, width: 0.01, height: 0.01 }, null, image);
    expect(small.width).toBeCloseTo(2 + 2 + 2);
  });
});
