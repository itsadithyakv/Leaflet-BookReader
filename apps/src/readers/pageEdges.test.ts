import { describe, expect, it } from "vitest";

/**
 * The page's edges on a phone, and with a true black (or true white) page:
 * the page's own colour, with no line or shadow of another down a side.
 * Read from the stylesheets on disk (a CSS import is emptied under the test
 * runner); named so the app's types need no Node.
 */
const read = async (path: string) => {
  type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
};

/** Each rule's body whose selector list includes exactly `selector`. */
const rulesFor = (css: string, selector: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",").some((one) => one.trim() === selector))
    .map((match) => match[2]);

describe("the page's edges", () => {
  it("have no line down the sides by finger (the desktop's border on the page)", async () => {
    const touch = await read("./touch.css");
    const rules = rulesFor(touch, 'html[data-input="touch"] .reader-scope .reader-page-frame');
    expect(rules.some((rule) => /border-inline:\s*0\s*;/.test(rule))).toBe(true);
  });

  it("are the page's colour with a true black or true white page, anywhere", async () => {
    const index = await read("../index.css");
    for (const finish of ["true-black", "true-white"]) {
      const rules = rulesFor(index, `.reader-${finish}-finish .reader-page-frame`);
      expect(rules.some((rule) => /border-inline:\s*0\s*;/.test(rule))).toBe(true);
      expect(rules.some((rule) => /box-shadow:\s*none\s*;/.test(rule))).toBe(true);
    }
  });

  it("put nothing of another colour round the text by finger", async () => {
    const touch = await read("./touch.css");
    // The room kept for the system's bars and a camera's cutout is the page's colour.
    const main = rulesFor(touch, 'html[data-input="touch"] .reader-scope .reader-main');
    expect(main.some((rule) => /background:\s*var\(--reader-page-bg/.test(rule))).toBe(true);
    // No rule there gives the page, its frame or the book's frames an edge of their own.
    const edge = /^(border(-inline|-left|-right)?|outline|box-shadow)$/;
    const edges = (rule: string) =>
      rule
        .split(";")
        .map((declaration) => declaration.split(":").map((part) => part.trim()))
        .filter(([property, value]) => edge.test(property ?? ""))
        .filter(([, value]) => value !== "0" && value !== "none");
    for (const selector of [
      'html[data-input="touch"] .reader-scope .reader-main',
      'html[data-input="touch"] .reader-scope .reader-page-frame',
      ".reader-scope[data-shape] .reader-page-frame",
      ".reader-scope[data-shape] .reader-page-frame.is-scrolling",
      ".reader-scope[data-shape] .reader-page-frame.is-scrolling .epub-container"
    ]) {
      for (const rule of rulesFor(touch, selector)) {
        expect(edges(rule)).toEqual([]);
      }
    }
  });
});
