import { describe, expect, it } from "vitest";
import { ratioQuery, watchPixelRatio } from "./pixelRatio";
import { sceneScale } from "./sceneFit";

/** A window whose scaling can be changed by hand: its media queries tell whoever is listening, as a browser's do. */
const display = (ratio: number) => {
  const listening = new Map<string, Set<() => void>>();
  const view = {
    devicePixelRatio: ratio,
    matchMedia: (query: string) =>
      ({
        media: query,
        addEventListener: (_: string, heard: () => void) => listening.set(query, (listening.get(query) ?? new Set()).add(heard)),
        removeEventListener: (_: string, heard: () => void) => listening.get(query)?.delete(heard)
      }) as unknown as MediaQueryList
  };
  return {
    view,
    /** The queries with anyone listening. */
    armed: () => [...listening].filter(([, heard]) => heard.size > 0).map(([query]) => query),
    /** The window moves to a display at `next`: every query that matched the old scaling says so. */
    moveTo: (next: number) => {
      const was = ratioQuery(view.devicePixelRatio);
      view.devicePixelRatio = next;
      [...(listening.get(was) ?? [])].forEach((heard) => heard());
    }
  };
};

describe("the display's scaling, watched", () => {
  it("asks about the scaling there is now", () => {
    expect(ratioQuery(1.25)).toBe("(resolution: 1.25dppx)");
    expect(ratioQuery(2)).toBe("(resolution: 2dppx)");
    // Nonsense is one device pixel a pixel.
    expect(ratioQuery(0)).toBe("(resolution: 1dppx)");
    expect(ratioQuery(Number.NaN)).toBe("(resolution: 1dppx)");
  });

  it("tells of every change, not only the first: the listener moves to the new scaling's query", () => {
    const screen = display(1);
    const heard: number[] = [];
    const stop = watchPixelRatio((ratio) => heard.push(ratio), screen.view);
    expect(screen.armed()).toEqual(["(resolution: 1dppx)"]);

    screen.moveTo(1.5);
    expect(heard).toEqual([1.5]);
    expect(screen.armed()).toEqual(["(resolution: 1.5dppx)"]);

    screen.moveTo(1.25);
    screen.moveTo(1);
    expect(heard).toEqual([1.5, 1.25, 1]);
    expect(screen.armed()).toEqual(["(resolution: 1dppx)"]);

    stop();
    expect(screen.armed()).toEqual([]);
    screen.moveTo(2);
    expect(heard).toEqual([1.5, 1.25, 1]);
  });

  it("does without where the query cannot be made", () => {
    const stop = watchPixelRatio(() => undefined, {
      devicePixelRatio: 1,
      matchMedia: () => {
        throw new Error("no such query");
      }
    });
    expect(() => stop()).not.toThrow();
  });

  it("is why the room is measured again: the same box holds another scale at another scaling", () => {
    // A 1280 x 720 window's room has 1110 x 464 CSS pixels at any scaling; what fits in it does not stay the same.
    const fit = (ratio: number) => sceneScale(240, 120, 1110, 464, ratio);
    expect(fit(1)).toBe(3.5);
    expect(fit(1.5)).toBe(5.5);
    // In CSS pixels the room is 840 wide at 100% and 880 at 150%: kept at 3.5 device pixels after the move, it would be 560.
    expect((240 * fit(1)) / 1).toBe(840);
    expect((240 * fit(1.5)) / 1.5).toBe(880);
    expect((240 * fit(1)) / 1.5).toBe(560);
  });
});
