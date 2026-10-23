import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countTap, holdTapRun, tapsSoFar } from "../tapRun";
import { takePictureTap } from "./useTapRuns";

/** An element of the page: a picture (as epub.js shows it) or a word's paragraph. */
const element = (tag: string, box: { width: number; height: number }, link = false) => {
  const node = {
    nodeType: 1,
    tagName: tag,
    currentSrc: tag === "IMG" ? "blob:map" : "",
    src: "",
    dataset: {} as Record<string, string>,
    getAttribute: (name: string) => (name === "alt" ? "The Final Empire" : null),
    getBoundingClientRect: () => ({ left: 0, top: 0, ...box, right: box.width, bottom: box.height }),
    closest: (selector: string) => {
      if (selector === "a[href]") return link ? {} : null;
      return selector.includes("img") && tag === "IMG" ? node : null;
    }
  };
  return node;
};

const click = (target: unknown, taken = false) => {
  const event = {
    target,
    defaultPrevented: taken,
    preventDefault() {
      event.defaultPrevented = true;
    }
  };
  return event as unknown as MouseEvent & { defaultPrevented: boolean };
};

describe("a finger's tap on a picture", () => {
  let key: object;
  beforeEach(() => {
    vi.useFakeTimers();
    key = {};
  });
  afterEach(() => vi.useRealTimers());

  it("opens it at once, and is no tap of a run", () => {
    const open = vi.fn();
    const event = click(element("IMG", { width: 340, height: 226 }));
    expect(takePictureTap(key, event, open)).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ src: "blob:map", alt: "The Final Empire" }));
    // The page's own taps (the menu, a turn) pass a claimed click by.
    expect(event.defaultPrevented).toBe(true);
    expect(tapsSoFar(key)).toBe(0);
    // Nothing waits: the next tap on the text begins a run of its own.
    expect(countTap(key, { at: 100, x: 10, y: 10 })).toBe(1);
  });

  it("ends a run under way before it, which does what it does", () => {
    const act = vi.fn();
    countTap(key, { at: 0, x: 200, y: 400 });
    holdTapRun(key, act);
    expect(takePictureTap(key, click(element("IMG", { width: 340, height: 226 })), vi.fn())).toBe(true);
    expect(act).toHaveBeenCalledWith(1);
    expect(tapsSoFar(key)).toBe(0);
  });

  it("is not a tap on text, on an ornament, on a picture that is a link, or one already taken", () => {
    const open = vi.fn();
    expect(takePictureTap(key, click(element("P", { width: 340, height: 40 })), open)).toBe(false);
    expect(takePictureTap(key, click(element("IMG", { width: 32, height: 32 })), open)).toBe(false);
    expect(takePictureTap(key, click(element("IMG", { width: 340, height: 226 }, true)), open)).toBe(false);
    expect(takePictureTap(key, click(element("IMG", { width: 340, height: 226 }), true), open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
