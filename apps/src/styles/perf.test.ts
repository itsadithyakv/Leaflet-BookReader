import { describe, expect, it } from "vitest";

/**
 * The lighter visual effects (styles/perf.css, `html[data-perf]`: platform/perfTier.ts),
 * read from the stylesheets on disk (a CSS import is emptied under the test runner).
 */
const read = async (path: string) => {
  type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  return fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
};

const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));

const selectors = (selector: string) => selector.split(/,(?![^(]*\))/).map((one) => one.trim());

const SMOOTH = /html(?::is\([^)]*\[data-perf="lite"\][^)]*\)|\[data-perf="lite"\])/;

describe("Smooth and minimal", () => {
  it("take every backdrop blur away, on every element, over any rule", async () => {
    const css = await read("./perf.css");
    const kill = rules(css).find((rule) => /backdrop-filter:\s*none\s*!important/.test(rule.body) && /-webkit-backdrop-filter:\s*none\s*!important/.test(rule.body));
    expect(kill).toBeTruthy();
    const list = selectors(kill!.selector);
    for (const tier of ["lite", "minimal"]) {
      // Every element, and the one pseudo-element that blurs (the status bar's strip). Not every
      // `::before` and `::after`: a universal pseudo-element rule has the browser work out a pseudo
      // style for every element in the page, which cost more than the blur it took away.
      for (const part of [" *", " .app-shell::before"]) {
        expect(list.some((one) => one.includes(`[data-perf="${tier}"]`) && one.endsWith(part)), `${tier}${part}`).toBe(true);
      }
    }
    expect(list.some((one) => /\s::(before|after)$/.test(one))).toBe(false);
    // Nothing is spared: no `:not(…)` exception lets a blur back in.
    expect(kill!.selector).not.toMatch(/:not\(/);
  });

  it("draw no blur layer in a scroll edge: the tint alone", async () => {
    const css = await read("./perf.css");
    expect(rules(css).some((rule) => SMOOTH.test(rule.selector) && rule.selector.includes(".gradual-blur-layer") && /display:\s*none/.test(rule.body))).toBe(true);
  });

  it("put no lens anywhere: no SVG filter in any of their rules, and the lens tokens are none", async () => {
    const css = await read("./perf.css");
    expect(css).not.toMatch(/url\(#/);
    const lite = rules(css).filter((rule) => selectors(rule.selector).includes('html[data-perf="lite"]'));
    expect(lite.some((rule) => /--liquid-filter:\s*none/.test(rule.body))).toBe(true);
    expect(lite.some((rule) => /--liquid-filter-panel:\s*none/.test(rule.body))).toBe(true);
  });

  it("keep the glass's tints, firmer (90 to 98 % cover; solid under words), in both themes", async () => {
    const css = await read("./perf.css");
    const lite = rules(css).find((rule) => {
      const list = selectors(rule.selector);
      return list.includes('html[data-perf="lite"]') && list.includes('html[data-perf="lite"][data-theme="dark"]');
    });
    expect(lite).toBeTruthy();
    // Where there are words on it (sheets, dialogs, the tab bar, the book being read) it is solid.
    for (const token of ["--glass-tint-strong", "--liquid-tint-text"]) {
      expect(lite!.body, token).toMatch(new RegExp(`${token}:\\s*rgb\\(var\\(--color-surface-high\\)\\);`));
    }
    for (const token of ["--glass-tint", "--liquid-tint"]) {
      const match = new RegExp(`${token}:\\s*rgb\\([^/]+/\\s*([\\d.]+)\\)`).exec(lite!.body);
      expect(match, token).toBeTruthy();
      expect(Number(match![1])).toBeGreaterThanOrEqual(0.9);
      expect(Number(match![1])).toBeLessThanOrEqual(0.98);
    }
  });

  it("keep the rim (inset lines of light) and lighten the shadows to one layer", async () => {
    const css = await read("./perf.css");
    const shadows = rules(css).filter((rule) => /--liquid-shadow:/.test(rule.body));
    expect(shadows.length).toBeGreaterThanOrEqual(2);
    for (const rule of shadows) {
      const value = /--liquid-shadow:\s*([^;]+);/.exec(rule.body)![1];
      expect(value.split(/,(?![^(]*\))/).length).toBe(1);
      const rim = /--liquid-rim:\s*([^;]+);/.exec(rule.body)![1];
      expect(rim.split(/,(?![^(]*\))/).every((one) => one.trim().startsWith("inset"))).toBe(true);
    }
  });

  it("move without blur: the motion's blur tokens are none, and every blurred keyframe reads them", async () => {
    const perf = await read("./perf.css");
    expect(perf).toMatch(/--enter-filter:\s*none/);
    expect(perf).toMatch(/--motion-blur:\s*none/);
    for (const path of ["./glass.css", "./touch-shell.css", "../readers/touch.css", "../readers/glass.css"]) {
      const css = await read(path);
      for (const frames of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\}\s*)\}/g)) {
        expect(frames[2], `${path} ${frames[1]}`).not.toMatch(/filter:\s*blur\(/);
      }
    }
  });

  it("stop the endless decorations (the streak's ring and flame)", async () => {
    const css = await read("./perf.css");
    const stopped = rules(css).filter((rule) => /animation:\s*none/.test(rule.body)).map((rule) => rule.selector).join(" ");
    expect(stopped).toContain(".streak-chip");
    expect(stopped).toContain(".streak-hero-big");
  });

  it("firm the reader's glass too, outweighing its sheet (which loads after this one)", async () => {
    const css = await read("./perf.css");
    const reader = rules(css).filter((rule) => selectors(rule.selector).some((one) => one.startsWith('html[data-perf="lite"] .reader-scope')));
    expect(reader.some((rule) => /--reader-glass-tint:/.test(rule.body))).toBe(true);
    expect(reader.some((rule) => rule.selector.includes(".reader-true-black-finish"))).toBe(true);
  });
});

describe("the sheet's place", () => {
  it("is loaded after every other sheet of the app", async () => {
    const main = await read("../main.tsx");
    const imports = [...main.matchAll(/import\s+"\.\/([^"]+\.css)"/g)].map((match) => match[1]);
    expect(imports[imports.length - 1]).toBe("styles/perf.css");
  });
});
