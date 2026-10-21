import { describe, expect, it } from "vitest";
import { dottyShows } from "./readerDot";

/** The reader's stylesheet for a finger, read from disk (a CSS import is emptied in tests). */
const touchCss = async () => {
  type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  const css = fs.readFileSync(new URL("./touch.css", import.meta.url), "utf8");
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
};

/** The bodies of the rules whose selector list includes exactly `selector`. */
const rulesFor = (css: string, selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",").some((one) => one.trim() === selector))
    .map((match) => match[2]);

describe("Dotty", () => {
  it("shows in Smart Read only, and while the walkthrough introduces it", () => {
    expect(dottyShows("smart", false)).toBe(true);
    expect(dottyShows("standard", false)).toBe(false);
    expect(dottyShows("speed", false)).toBe(false);
    expect(dottyShows("standard", true)).toBe(true);
  });

  it("is out of sight, where it was, while the scope says so", async () => {
    const rules = rulesFor(await touchCss(), '.reader-scope[data-dotty="hidden"] .reader-dot');
    expect(rules.some((rule) => /visibility:\s*hidden/.test(rule))).toBe(true);
  });
});

describe("the way back to the library", () => {
  it("is a phone's own, top left with the chrome: the bar's arrow is not drawn there as well", async () => {
    const css = await touchCss();
    expect(rulesFor(css, ".reader-scope[data-shape] .reader-exit-button").some((rule) => /display:\s*none/.test(rule))).toBe(true);
    const back = rulesFor(css, ".reader-phone-back").join("");
    expect(back).toMatch(/position:\s*fixed/);
    expect(back).toMatch(/top:\s*calc\(var\(--inset-top\) \+ 10px\)/);
    expect(back).toMatch(/left:\s*calc\(var\(--inset-left\) \+ 10px\)/);
    // Away, and taking no touch, while the chrome is.
    expect(rulesFor(css, ".reader-scope.reader-chrome-hidden .reader-phone-back").some((rule) => /pointer-events:\s*none/.test(rule))).toBe(true);
  });

  it("is no longer hidden on Android as a whole: a tablet keeps the bar's arrow", async () => {
    expect(rulesFor(await touchCss(), 'html[data-platform="android"] .reader-scope .reader-exit-button')).toEqual([]);
  });
});
