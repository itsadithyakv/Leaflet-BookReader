import { describe, expect, it } from "vitest";
import { PAGE_FOOT_PAD } from "./pagesStyle";
import {
  PHONE_FOOTER_STRIP,
  SESSION_MARK_LOOK,
  roomUnderText,
  sessionMarkClearOfText,
  sessionMarkSpot,
  sessionMarkTop,
  type SessionMarkSpot
} from "./sessionMark";

/** A stylesheet read from disk (a CSS import is emptied under the test runner). */
const readCss = async (path: string) => {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
};

describe("a focus session's mark", () => {
  it("is in a phone's footer strip, either way up and in either layout", () => {
    for (const shape of ["upright", "sideways"] as const) {
      expect(sessionMarkSpot(shape, "pages")).toBe("footer");
      expect(sessionMarkSpot(shape, "scroll")).toBe("footer");
    }
  });

  it("with pages on a desktop or a tablet, is in the room under the page's text; scrolling, in the corner", () => {
    expect(sessionMarkSpot("desktop", "pages")).toBe("foot-pad");
    expect(sessionMarkSpot("tablet", "pages")).toBe("foot-pad");
    expect(sessionMarkSpot("desktop", "scroll")).toBe("corner");
    expect(sessionMarkSpot("tablet", "scroll")).toBe("corner");
  });

  it("never reaches up into the text from the room it sits in", () => {
    expect(roomUnderText("footer")).toBe(PHONE_FOOTER_STRIP);
    expect(roomUnderText("foot-pad")).toBe(PAGE_FOOT_PAD);
    for (const spot of ["footer", "foot-pad", "corner"] as SessionMarkSpot[]) {
      expect(sessionMarkClearOfText(spot)).toBe(true);
    }
    expect(sessionMarkTop("footer")).toBeLessThanOrEqual(PHONE_FOOTER_STRIP);
    expect(sessionMarkTop("foot-pad")).toBeLessThanOrEqual(PAGE_FOOT_PAD);
    // The old phone mark: 0.6 of 72 px, at the top right, 43 px over the first lines.
    expect(72 * 0.6).toBeGreaterThan(PHONE_FOOTER_STRIP);
  });

  it("is small and faint on a phone, and as it was in a desktop's scrolling corner", () => {
    expect(SESSION_MARK_LOOK.footer.scale).toBeLessThan(SESSION_MARK_LOOK["foot-pad"].scale);
    expect(SESSION_MARK_LOOK.footer.opacity).toBeLessThan(1);
    expect(SESSION_MARK_LOOK.corner).toEqual({ scale: 1, bottom: 24, opacity: 1 });
  });

  it("is placed by the stylesheet from the spot, with the footer's strip as tall as the code says", async () => {
    const css = await readCss("./touch.css");
    expect(css).toContain(`--reader-footer-height: ${PHONE_FOOTER_STRIP}px`);
    expect(css).toMatch(/\.leaflet-mug\[data-spot="footer"\][\s\S]*?bottom: calc\(var\(--inset-bottom\) \+ var\(--session-mark-bottom\)\)/);
    // Not the old top right corner, under the toolbar's place.
    expect(css).not.toMatch(/\.leaflet-mug,\s*\n\.reader-scope\[data-shape\] \.leaflet-flower \{\s*\n[^}]*top: calc\(max\(var\(--reader-toolbar-height\)/);
    // Away with the chrome, when the dock and the bar are at the foot.
    expect(css).toMatch(/:not\(\.reader-chrome-hidden\) \.leaflet-mug\[data-spot="footer"\]/);
  });
});

describe("the veil over a turn or a new layout", () => {
  it("is the page's own colour, lifts with a fade, and at once for a reduced-motion reader", async () => {
    const css = await readCss("./touch.css");
    const veil = css.slice(css.indexOf(".reader-scope > .reader-veil {"));
    expect(veil).toMatch(/background: var\(--reader-page-bg/);
    expect(veil).toMatch(/\.reader-veil\.is-lifting \{\s*opacity: 0;/);
    expect(veil).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.reader-scope > \.reader-veil \{\s*transition: none;/);
  });
});
