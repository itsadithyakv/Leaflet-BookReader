import { describe, expect, it } from "vitest";
import {
  layoutForShape,
  layoutKeyFor,
  readerShape,
  selectionDockFoot,
  sidewaysPageView,
  spreadFor,
  tapAction,
  tapZone,
  SIDEWAYS_LAYOUT_KEY
} from "./touchLayout";
import { LAYOUT_KEY } from "./readerTypes";

describe("the shape of the screen", () => {
  it("is the desktop's for a mouse, at any size", () => {
    expect(readerShape(380, 800, false)).toBe("desktop");
    expect(readerShape(1400, 900, false)).toBe("desktop");
  });

  it("tells a phone each way up from a tablet", () => {
    expect(readerShape(360, 800, true)).toBe("upright");
    expect(readerShape(412, 915, true)).toBe("upright");
    expect(readerShape(915, 412, true)).toBe("sideways");
    expect(readerShape(740, 360, true)).toBe("sideways");
    expect(readerShape(1024, 768, true)).toBe("tablet");
    expect(readerShape(800, 1280, true)).toBe("tablet");
  });
});

describe("a tap on the page", () => {
  it("turns at the outer thirds and is for the chrome in the middle", () => {
    expect(tapZone(10, 0, 360)).toBe(-1);
    expect(tapZone(119, 0, 360)).toBe(-1);
    expect(tapZone(180, 0, 360)).toBe(0);
    expect(tapZone(241, 0, 360)).toBe(1);
    expect(tapZone(359, 0, 360)).toBe(1);
  });

  it("turns the other way in a right-to-left book", () => {
    expect(tapZone(10, 0, 360, true)).toBe(1);
    expect(tapZone(350, 0, 360, true)).toBe(-1);
  });

  it("counts from the page's own left edge", () => {
    expect(tapZone(110, 100, 300)).toBe(-1);
    expect(tapZone(250, 100, 300)).toBe(0);
  });

  it("with pages, turns at the sides and toggles the chrome in the middle; scrolling, any tap toggles", () => {
    expect(tapAction(1, "pages")).toEqual({ kind: "turn", step: 1 });
    expect(tapAction(-1, "pages")).toEqual({ kind: "turn", step: -1 });
    expect(tapAction(0, "pages")).toEqual({ kind: "chrome" });
    expect(tapAction(1, "scroll")).toEqual({ kind: "chrome" });
    expect(tapAction(0, "scroll")).toEqual({ kind: "chrome" });
  });

});

describe("the layout each way up", () => {
  it("defaults to scrolling upright and to a spread of pages sideways", () => {
    expect(layoutForShape("upright", { upright: null, sideways: null })).toBe("scroll");
    expect(layoutForShape("sideways", { upright: null, sideways: null })).toBe("pages");
    expect(spreadFor("sideways", "pages")).toBe(true);
    expect(spreadFor("sideways", "scroll")).toBe(false);
    expect(spreadFor("upright", "pages")).toBe(false);
  });

  it("remembers each way up apart", () => {
    const stored = { upright: "pages", sideways: "scroll" };
    expect(layoutForShape("upright", stored)).toBe("pages");
    expect(layoutForShape("sideways", stored)).toBe("scroll");
    expect(layoutForShape("desktop", stored)).toBe("pages");
    expect(layoutForShape("tablet", stored)).toBe("pages");
  });

  it("ignores what is not a layout", () => {
    expect(layoutForShape("sideways", { upright: null, sideways: "columns" })).toBe("pages");
    expect(layoutForShape("upright", { upright: "", sideways: null })).toBe("scroll");
  });

  it("keeps a sideways choice under its own key, and every other under the device's", () => {
    expect(layoutKeyFor("sideways")).toBe(SIDEWAYS_LAYOUT_KEY);
    expect(layoutKeyFor("upright")).toBe(LAYOUT_KEY);
    expect(layoutKeyFor("desktop")).toBe(LAYOUT_KEY);
  });

  it("gives a PDF on its side fit-width scrolling until chosen, and a comic its pages", () => {
    const defaults = { fit: "width", pdfLayout: "scroll", comicLayout: "pages" } as const;
    expect(sidewaysPageView("pdf", null, defaults)).toEqual({ fit: "width", layout: "scroll" });
    expect(sidewaysPageView("pdf", { fit: "page", layout: "pages" }, defaults)).toEqual({ fit: "page", layout: "pages" });
    expect(sidewaysPageView("comic", { fit: "page", layout: "scroll" }, defaults)).toEqual({ fit: "page", layout: "pages" });
  });
});

describe("the selection's bar at the foot", () => {
  it("sits over the chapter dock for a mouse, and over the gesture bar for a finger", () => {
    expect(selectionDockFoot(false, false, 48)).toBe(64);
    expect(selectionDockFoot(false, true, 48)).toBe(118);
    expect(selectionDockFoot(true, false, 0)).toBe(8);
    expect(selectionDockFoot(true, false, 300)).toBe(308);
    expect(selectionDockFoot(true, true, 0)).toBe(68);
  });
});
