import { describe, expect, it } from "vitest";
import { glideFrame, glideSet, startGlide } from "./glide";

/** A page that reports positions in thirds of a pixel (a display scaled to 150%) and stops at its end. */
const page = (top: number, max = 100_000) => {
  const snap = (value: number) => Math.min(max, Math.max(0, Math.round(value * 1.5) / 1.5));
  let at = snap(top);
  return {
    get top() {
      return at;
    },
    set top(value: number) {
      at = snap(value);
    },
    /** Something else moves the page: epub.js letting a chapter go above, the reader's wheel. */
    shift(by: number) {
      at = snap(at + by);
    }
  };
};

/** Runs a glide of `distance` in `frames` even steps, with `between` called before each frame. */
const run = (start: number, distance: number, frames: number, between: (frame: number, scroller: ReturnType<typeof page>) => void, max?: number) => {
  const scroller = page(start, max);
  const glide = startGlide(scroller.top);
  for (let frame = 1; frame <= frames; frame += 1) {
    between(frame, scroller);
    scroller.top = glideFrame(glide, scroller.top, (distance * frame) / frames);
    glideSet(glide, scroller.top);
  }
  return scroller.top;
};

describe("a scroll the reader animates", () => {
  it("ends its own distance from where it started when nothing else moves the page", () => {
    expect(run(1985, 154, 13, () => undefined)).toBeCloseTo(1985 + 154, 0);
  });

  it("keeps the text still when a chapter above is let go half way through", () => {
    // epub.js removes a chapter of 949 px above and moves the page up by as
    // much. The glide used to set 1985 + its progress on the next frame: the
    // text jumped 949 px on.
    const end = run(1985, 154, 13, (frame, scroller) => {
      if (frame === 7) {
        scroller.shift(-949);
      }
    });
    expect(end).toBeCloseTo(1985 - 949 + 154, 0);
  });

  it("keeps the text still when a chapter arrives above", () => {
    const end = run(300, -154, 13, (frame, scroller) => {
      if (frame === 4) {
        scroller.shift(19_720);
      }
    });
    expect(end).toBeCloseTo(300 + 19_720 - 154, 0);
  });

  it("adds to the reader's own wheel instead of undoing it", () => {
    const end = run(5000, 600, 20, (frame, scroller) => {
      if (frame === 5 || frame === 6) {
        scroller.shift(120);
      }
    });
    expect(end).toBeCloseTo(5000 + 600 + 240, 0);
  });

  it("does not take the page's own rounding, or its end, for someone else's move", () => {
    // Positions land on thirds of a pixel; twenty frames of that must not add up to a drift.
    expect(Math.abs(run(1000.2, 100, 20, () => undefined) - 1100.2)).toBeLessThan(0.7);
    // Stopped by the end of what is loaded: it stays there.
    expect(run(900, 400, 10, () => undefined, 1000)).toBe(1000);
  });
});
