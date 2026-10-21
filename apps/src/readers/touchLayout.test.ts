import { afterEach, describe, expect, it, vi } from "vitest";
import {
  floatsAway,
  layoutAcrossTurn,
  layoutForShape,
  readerShape,
  readLayoutFor,
  saveLayout,
  selectionDockFoot,
  sidewaysPageView,
  spreadFor,
  steadyHeight,
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

  it("does not turn on its side for a keyboard (ours, or another app's over a notification)", () => {
    const heights = { width: 0, height: 0 };
    const shape = (width: number, height: number) => readerShape(width, steadyHeight(heights, width, height), true);
    expect(shape(360, 740)).toBe("upright");
    // A reply typed into a notification: the window 330px tall, wider than it is tall.
    expect(shape(360, 330)).toBe("upright");
    expect(shape(360, 740)).toBe("upright");
    // A tablet on its side, a keyboard up: still a tablet, not a phone.
    expect(shape(1280, 800)).toBe("tablet");
    expect(shape(1280, 420)).toBe("tablet");
    // A real turn (a new width) is followed.
    expect(shape(740, 360)).toBe("sideways");
    expect(shape(360, 740)).toBe("upright");
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

describe("the layout, kept as the phone turns", () => {
  const never = { chosen: null, sideways: null };

  it("is the reader's one choice whichever way up: a turn never swaps scrolling for pages", () => {
    for (const chosen of ["scroll", "pages"] as const) {
      for (const shape of ["upright", "sideways", "tablet", "desktop"] as const) {
        expect(layoutForShape(shape, { chosen, sideways: null })).toBe(chosen);
      }
    }
    // Scrolling upright, and pages kept apart for on its side by an older Leaflet: scrolling both ways.
    expect(layoutForShape("sideways", { chosen: "scroll", sideways: "pages" })).toBe("scroll");
    expect(layoutForShape("upright", { chosen: "pages", sideways: "scroll" })).toBe("pages");
  });

  it("is the layout the book is in after a turn, both ways", () => {
    expect(layoutAcrossTurn("scroll")).toBe("scroll");
    expect(layoutAcrossTurn("pages")).toBe("pages");
    // Upright scrolling (the default), turned on its side and back: scrolling all the way.
    let layout = layoutForShape("upright", never);
    layout = layoutAcrossTurn(layout);
    expect(layout).toBe("scroll");
    expect(spreadFor("sideways", layout)).toBe(false);
    layout = layoutAcrossTurn(layout);
    expect(layout).toBe("scroll");
  });

  it("has a default for the shape a book opens in only while the reader has never chosen", () => {
    expect(layoutForShape("upright", never)).toBe("scroll");
    expect(layoutForShape("desktop", never)).toBe("scroll");
    expect(layoutForShape("sideways", never)).toBe("pages");
    expect(layoutForShape("sideways", { chosen: null, sideways: "scroll" })).toBe("scroll");
    // The old sideways key never reaches an upright phone.
    expect(layoutForShape("upright", { chosen: null, sideways: "pages" })).toBe("scroll");
  });

  it("pages are a spread on a phone's side, one column upright", () => {
    expect(spreadFor("sideways", "pages")).toBe(true);
    expect(spreadFor("sideways", "scroll")).toBe(false);
    expect(spreadFor("upright", "pages")).toBe(false);
  });

  it("spreads a tablet's pages on its side, and not upright, scrolling or on a desktop", () => {
    expect(spreadFor("tablet", "pages", 1280, 800)).toBe(true);
    expect(spreadFor("tablet", "pages", 960, 600)).toBe(true);
    expect(spreadFor("tablet", "pages", 800, 1280)).toBe(false);
    expect(spreadFor("tablet", "scroll", 1280, 800)).toBe(false);
    expect(spreadFor("desktop", "pages", 1280, 800)).toBe(false);
  });

  it("ignores what is not a layout", () => {
    expect(layoutForShape("sideways", { chosen: null, sideways: "columns" })).toBe("pages");
    expect(layoutForShape("upright", { chosen: "", sideways: null })).toBe("scroll");
  });

  describe("kept on the device", () => {
    afterEach(() => vi.unstubAllGlobals());
    const store = (initial: Record<string, string>) => {
      const items = new Map(Object.entries(initial));
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
      });
      return items;
    };

    it("chosen on a phone's side, is kept for upright too, and the old sideways key goes", () => {
      const items = store({ [SIDEWAYS_LAYOUT_KEY]: "pages" });
      saveLayout("scroll");
      expect(items.get(LAYOUT_KEY)).toBe("scroll");
      expect(items.has(SIDEWAYS_LAYOUT_KEY)).toBe(false);
      expect(readLayoutFor("upright")).toBe("scroll");
      expect(readLayoutFor("sideways")).toBe("scroll");
    });

    it("chosen upright, opens a book on its side in it", () => {
      store({});
      saveLayout("pages");
      expect(readLayoutFor("sideways")).toBe("pages");
      expect(readLayoutFor("upright")).toBe("pages");
    });
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

describe("what floats over a phone's page", () => {
  const clear = { keyboard: false, card: false, drawer: false, sheet: false };

  it("stays while nothing is over the page", () => {
    expect(floatsAway("upright", clear)).toBe(false);
    expect(floatsAway("sideways", clear)).toBe(false);
  });

  it("goes for the keyboard, a card, the chapter list and a sheet", () => {
    for (const over of ["keyboard", "card", "drawer", "sheet"] as const) {
      expect(floatsAway("upright", { ...clear, [over]: true })).toBe(true);
      expect(floatsAway("sideways", { ...clear, [over]: true })).toBe(true);
      expect(floatsAway("tablet", { ...clear, [over]: true })).toBe(true);
    }
  });

  it("stays on a desktop, where the pill is not under any of them", () => {
    const everything = { keyboard: true, card: true, drawer: true, sheet: true };
    expect(floatsAway("desktop", everything)).toBe(false);
  });
});
