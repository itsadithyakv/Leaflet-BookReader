import { describe, expect, it } from "vitest";

/**
 * Leaflet's own desktop below Full (`html[data-look="leather"]`, platform/perfTier.ts): the
 * leather rail and the paper of index.css, with the glass standing aside. Read from the
 * stylesheets on disk (a CSS import is emptied under the test runner).
 */
const read = async (path: string) => {
  type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  return fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
};

const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim().replace(/\s+/g, " "), body: match[2] }));

const STANDS_ASIDE = ':where(:not([data-look="leather"]))';

describe("the desktop's leather", () => {
  it("has the glass's bars, sheets, toasts and tabs stand aside, at no weight", async () => {
    const css = await read("./glass.css");
    const look = (surface: string, property: RegExp) =>
      rules(css).filter((rule) => rule.selector.includes(surface) && property.test(rule.body) && !rule.selector.includes("pip-dragging") && !rule.selector.startsWith("@"));
    for (const surface of [".app-header.app-header", ".now-reading-bar.now-reading-bar", ".modal-surface:not(", ".app-toast.app-toast", ".mobile-nav.mobile-nav", ".segmented-tabs.segmented-tabs"]) {
      const drawn = look(surface, /background|box-shadow/).filter((rule) => !rule.selector.includes("@supports"));
      expect(drawn.length, surface).toBeGreaterThan(0);
      // (`.no-glass` minimal on a phone keeps its solid tint; on the desktop it stands aside too.)
      for (const rule of drawn) expect(rule.selector, `${surface}: ${rule.selector}`).toMatch(/:not\(\[data-look="leather"\]\)\)/);
    }
  });

  it("has the desktop's flat keys, fields and cards stand aside too, and keeps the focus rings and scrollbars", async () => {
    const css = await read("./window-material.css");
    const desktop = rules(css).filter((rule) => rule.selector.includes(':root[data-platform="desktop"][data-input="mouse"]'));
    const flat = desktop.filter((rule) => /\.(tactile-button|key-button|inset-field|paper-surface)\b/.test(rule.selector) && !/focus-visible/.test(rule.selector));
    expect(flat.length).toBeGreaterThan(5);
    for (const rule of flat) expect(rule.selector, rule.selector).toContain(STANDS_ASIDE);
    const kept = desktop.filter((rule) => /focus-visible|::-webkit-scrollbar/.test(rule.selector));
    expect(kept.length).toBeGreaterThan(2);
    for (const rule of kept) expect(rule.selector).not.toContain("data-look");
  });

  it("gives the page's scroller an opaque layer of the page's colour off Mica (a see-through one was painted again every frame)", async () => {
    const css = await read("./leather.css");
    const scroller = rules(css).find((rule) => rule.selector === ':root[data-platform="desktop"]:not([data-window-material="mica"]) .app-main-scroll');
    expect(scroller?.body).toMatch(/background-color:\s*rgb\(var\(--color-background\)\);/);
    // A picture there would take the layer away again.
    expect(scroller?.body).not.toMatch(/background-image|url\(/);
    const mica = rules(css).find((rule) => rule.selector === ':root[data-platform="desktop"][data-window-material="mica"] .app-main-scroll');
    expect(mica?.body).toMatch(/will-change:\s*scroll-position/);
  });

  it("lets no words show through the book being read or a sheet", async () => {
    const css = await read("./leather.css");
    for (const surface of [".now-reading-bar", ".modal-surface"]) {
      const rule = rules(css).find((one) => one.selector.startsWith(`:root[data-look="leather"] ${surface}`));
      expect(rule, surface).toBeTruthy();
      // Opaque stops only: no `/ 0.9…` alpha in the gradient, no texture under it.
      expect(rule!.body).toMatch(/linear-gradient\(\d+deg, rgb\(var\(--color-surface-high\)\), rgb\(var\(--color-surface\)\)\)/);
    }
  });

  it("is cheap: no blur, no backdrop filter, no endless animation", async () => {
    const css = await read("./leather.css");
    expect(css).not.toMatch(/blur\(|backdrop-filter|animation|url\(#/);
  });
});
