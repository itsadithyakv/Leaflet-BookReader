import { describe, expect, it } from "vitest";
import { fillPlace, sceneScale } from "./sceneFit";
import { LIFT_FLOATING } from "./layout";

/** A floor of the house: 240 by 120 art pixels, Pip's feet at row 109. */
const W = 240;
const H = 120;
const FEET = 109;

/** houseStage.css, read from disk (a CSS import is emptied under the test runner), as its rules: selector to declarations. */
const readRules = async () => {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
  const css = fs.readFileSync(new URL("./houseStage.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = new Map<string, Map<string, string>>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const line of match[2].split(";")) {
      const at = line.indexOf(":");
      if (at > 0) declarations.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
    for (const selector of match[1].split(",")) rules.set(selector.trim().replace(/\s+/g, " "), declarations);
  }
  return (selector: string) => {
    const found = rules.get(selector);
    if (!found) throw new Error(`no rule for ${selector}`);
    return found;
  };
};

const HOUSE = ".pip-house-page .pip-house.pip-house[data-fill]";
const px = (value: string | undefined) => parseFloat(value ?? "0");

/** The phones it was laid out for: width, height, scaling, status bar, gesture bar. */
const PHONES: Array<[number, number, number, number, number]> = [
  [800, 360, 3, 24, 16],
  [915, 412, 2.625, 28, 0],
  [851, 393, 2.75, 28, 16],
  [640, 360, 2, 24, 16]
];

describe("Pip's house as the whole screen of a phone on its side", () => {
  it("keeps the room whole and crisp in what the controls leave clear, with nothing of it under them", async () => {
    const rule = await readRules();
    const house = rule(HOUSE);
    const hud = px(house.get("--fill-hud"));
    const rail = px(house.get("--fill-rail"));
    for (const [width, height, ratio, top, bottom] of PHONES) {
      // The stage's padding (houseStage.css): under the HUD, past the lift, short of the rail.
      const fillTop = top + 8;
      const fillBottom = Math.max(6, bottom);
      const box = { left: 8 + 52, top: fillTop + hud + 6, right: width - (rail + 8 + 8), bottom: height - fillBottom };
      const per = sceneScale(W, H, box.right - box.left, box.bottom - box.top, ratio);
      expect(Number.isInteger(per * 2)).toBe(true);
      const scale = per / ratio;
      const place = fillPlace(W * scale, H * scale, box.right - box.left, box.bottom - box.top, ratio);
      const room = { left: box.left + place.left, top: box.top + place.top, right: box.left + place.left + W * scale, bottom: box.top + place.top + H * scale };
      // The ceiling (its lamps), the side walls (a poster, the calendar, the light switch) and Pip's feet: all clear.
      expect(room.top).toBeGreaterThanOrEqual(fillTop + hud);
      expect(room.left).toBeGreaterThanOrEqual(8 + 44);
      expect(room.right).toBeLessThanOrEqual(width - (rail + 8));
      expect(room.top + FEET * scale).toBeLessThan(height - bottom);
      // Still most of the screen: at least two thirds of its height.
      expect(H * scale).toBeGreaterThan(height * 0.66);
    }
  });

  it("makes the house, its body and the room's stage the whole window, and the page's padding goes", async () => {
    const rule = await readRules();
    expect(rule(HOUSE).get("position")).toBe("absolute");
    expect(rule(HOUSE).get("inset")).toBe("0");
    expect(rule(`${HOUSE} > .pip-house-body`).get("inset")).toBe("0");
    expect(rule(`${HOUSE} .pip-house-stage`).get("inset")).toBe("0");
    expect(rule(`${HOUSE} .pip-house-stage`).get("padding")).toContain("var(--fill-hud)");
    expect(rule("html[data-pip-fill] .app-shell.app-shell .app-main-scroll.app-main-scroll").get("padding")).toBe("0");
  });

  it("keeps everything laid over the walls inside the system's bars, the HUD 8 px under the status bar", async () => {
    const rule = await readRules();
    expect(rule(HOUSE).get("--fill-top")).toBe("calc(var(--inset-top, 0px) + 8px)");
    for (const side of ["right", "bottom", "left"]) expect(rule(HOUSE).get(`--fill-${side}`)).toContain(`var(--inset-${side}`);
    const hud = rule(`${HOUSE} > .pip-hud-top`);
    expect([hud.get("top"), hud.get("left")]).toEqual(["var(--fill-top)", "var(--fill-left)"]);
    const rail = rule(`${HOUSE} > .pip-rail`);
    expect([rail.get("top"), rail.get("right"), rail.get("bottom")]).toEqual(["var(--fill-top)", "var(--fill-right)", "var(--fill-bottom)"]);
    expect(rule(`${HOUSE} .pip-lift[data-floating]`).get("left")).toBe("var(--fill-left)");
  });

  it("fits the six tools (and the arcade floor's seven) down the right of a 360 px phone under its bars", async () => {
    const rule = await readRules();
    const belt = rule(`${HOUSE} > .pip-rail > .pip-rail-belt`);
    expect(belt.get("max-height")).toBe("100%");
    const keyHeight = px(rule(`${HOUSE} > .pip-rail .pip-rail-key`).get("min-height"));
    expect(keyHeight).toBeGreaterThanOrEqual(44);
    expect(px(rule(`${HOUSE} > .pip-rail .pip-rail-label`).get("font-size"))).toBeGreaterThanOrEqual(11);
    const room = 360 - (24 + 8) - 16;
    expect(6 * keyHeight + 5 * px(belt.get("gap")) + 2 * px(belt.get("padding"))).toBeLessThanOrEqual(room);
    const seven = rule(`${HOUSE} > .pip-rail > .pip-rail-belt:has(> .pip-rail-key:nth-of-type(7))`);
    expect(7 * keyHeight + 6 * px(seven.get("gap")) + 2 * px(seven.get("padding-block"))).toBeLessThanOrEqual(room);
  });

  it("floats a small lift under the menu", async () => {
    const rule = await readRules();
    expect(px(rule(`${HOUSE} .pip-lift[data-floating] .pip-lift-arrow`).get("height")) * 2).toBeLessThan(LIFT_FLOATING);
    expect(LIFT_FLOATING).toBeLessThanOrEqual(104);
  });
});
