import { describe, expect, it, vi } from "vitest";
import { alreadyShown, quietShow, type ShowableView } from "./viewShow";

/** A style as the test needs it: what was set, and every setting of `transform`. */
const makeStyle = (visibility: string, sets: string[]) => {
  let transform = "";
  return {
    visibility,
    get transform() {
      return transform;
    },
    set transform(value: string) {
      sets.push(value);
      transform = value;
    }
  };
};

/** A chapter's view as epub.js's IframeView has it: show() as it is in epubjs/src/managers/views/iframe.js. */
const makeView = (visibility = "hidden") => {
  const transforms: string[] = [];
  let layouts = 0;
  const element = { style: makeStyle(visibility, []) };
  const iframe = {
    style: makeStyle(visibility, transforms),
    get offsetWidth() {
      layouts += 1;
      return 300;
    }
  };
  const emit = vi.fn();
  const view = {
    element,
    iframe,
    emit,
    show() {
      element.style.visibility = "visible";
      iframe.style.visibility = "visible";
      // Remind Safari to redraw the iframe
      iframe.style.transform = "translateZ(0)";
      void iframe.offsetWidth;
      iframe.style.transform = "";
      emit("shown", view);
    }
  };
  return { view: view as unknown as ShowableView & typeof view, element, iframe, emit, transforms, layouts: () => layouts };
};

describe("showing a chapter (readers/viewShow.ts)", () => {
  it("shows a hidden chapter as epub.js does", () => {
    const { view, element, iframe, transforms, emit } = makeView("hidden");
    quietShow(view).show();
    expect(element.style.visibility).toBe("visible");
    expect(iframe.style.visibility).toBe("visible");
    expect(transforms).toEqual(["translateZ(0)", ""]);
    expect(emit).toHaveBeenCalledWith("shown", view);
  });

  it("leaves a chapter already showing alone: no transform set and taken away, no forced layout", () => {
    const made = makeView("hidden");
    const { view, iframe, transforms, emit } = made;
    quietShow(view);
    view.show();
    const { layouts } = made;
    for (let i = 0; i < 30; i += 1) view.show();
    expect(transforms).toHaveLength(2);
    expect(layouts()).toBe(1);
    expect(iframe.style.transform).toBe("");
    // Still said to be shown each time, as epub.js says it.
    expect(emit).toHaveBeenCalledTimes(31);
  });

  it("shows it again once it has been hidden", () => {
    const { view, element, iframe, transforms } = makeView("visible");
    quietShow(view);
    view.show();
    expect(transforms).toHaveLength(0);
    element.style.visibility = "hidden";
    iframe.style.visibility = "hidden";
    view.show();
    expect(transforms).toEqual(["translateZ(0)", ""]);
    expect(iframe.style.visibility).toBe("visible");
  });

  it("counts a chapter as showing only when its frame is too", () => {
    const { view, iframe } = makeView("visible");
    expect(alreadyShown(view)).toBe(true);
    iframe.style.visibility = "hidden";
    expect(alreadyShown(view)).toBe(false);
    expect(alreadyShown({ element: view.element, iframe: null, show: () => undefined } as unknown as ShowableView)).toBe(true);
  });
});
