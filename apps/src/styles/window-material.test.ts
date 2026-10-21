import { describe, expect, it } from "vitest";

/**
 * The desktop window's material and chrome, read from the stylesheet on disk
 * (a CSS import is emptied under the test runner): Mica only where Rust said
 * the window is see-through, an opaque window everywhere else, no blur of its
 * own on what is always on screen over Mica, and Pip's pixel paper left alone.
 */
const read = async (path: string) => {
  type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  return fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
};

/** Every innermost rule: its selector list (each one trimmed) and its body. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1]
      .trim()
      .split(/,(?![^(]*\))/)
      .map((one) => one.replace(/\s+/g, " ").trim()),
    body: match[2]
  }));

const MICA = ':root[data-window-material="mica"]';
const DESKTOP = ':root[data-platform="desktop"][data-input="mouse"]';
const PIP = [".pip-house-page", ".pip-arcade", ".pip-drawer", ".pip-shop", ".pip-album-dialog"];

describe("the desktop window's material", () => {
  it("has its tokens in the light theme and the dark", async () => {
    const css = await read("./window-material.css");
    const bodies = (selector: string) => rules(css).filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(";");
    for (const token of ["--mica-content", "--mica-content-edge", "--mica-sidebar-selected", "--mica-sidebar-float", "--chrome-hairline", "--chrome-hover", "--chrome-card-shadow"]) {
      expect(bodies(":root"), token).toContain(`${token}:`);
      expect(bodies(':root[data-theme="dark"]'), token).toContain(`${token}:`);
    }
  });

  it("makes the window see-through only under Mica", async () => {
    const css = await read("./window-material.css");
    for (const { selectors, body } of rules(css)) {
      if (!/background(-color)?:\s*transparent/.test(body)) continue;
      for (const one of selectors) {
        // Clearing <html> or <body>, or the app's own paper, happens only on a Mica window.
        if (/^:root(\[[^\]]*\])*( body)?$/.test(one) || /\.app-shell\b|\.app-main-scroll\b/.test(one)) {
          expect(one).toContain(MICA);
        }
      }
    }
    const clear = rules(css).find((rule) => rule.selectors.includes(MICA) && rule.selectors.includes(`${MICA} body`));
    expect(clear?.body).toMatch(/background:\s*transparent/);
  });

  it("is solid again for high contrast", async () => {
    const css = await read("./window-material.css");
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{[^}]*data-window-material="mica"[^{]*\{\s*background:\s*Canvas/);
  });

  it("draws the rail as the window's sidebar: no leather, no stitches, a soft pill for the place you are on", async () => {
    const css = await read("./window-material.css");
    const all = rules(css);
    const rail = all.find((rule) => rule.selectors.includes(`${MICA} .leaflet-sidebar.leather-surface`));
    expect(rail?.body).toMatch(/background:\s*transparent/);
    expect(rail?.body).toMatch(/box-shadow:\s*none/);
    const stitches = all.find((rule) => rule.selectors.includes(`${MICA} .leaflet-sidebar.leather-surface::after`));
    expect(stitches?.body).toMatch(/display:\s*none/);
    const here = all.find((rule) => rule.selectors.includes(`${MICA} .leaflet-sidebar .sidebar-nav-item[aria-current="page"]`));
    expect(here?.body).toMatch(/background:\s*var\(--mica-sidebar-selected\)/);
    expect(here?.body).toMatch(/box-shadow:\s*none/);
  });

  it("puts the pages on an opaque-enough content layer, and the toolbar on the window", async () => {
    const css = await read("./window-material.css");
    const all = rules(css);
    // Where the rail is (html[data-shape], platform/shape.ts): beside it, the pages are a layer of their own.
    const content = all.find((rule) => rule.selectors.includes(`${MICA}:where(:is([data-shape="wide"], [data-shape="sideways"])) .app-main-scroll`));
    expect(content?.body).toMatch(/background:\s*var\(--mica-content\)/);
    const cover = (token: string) => Number(css.match(new RegExp(`${token}:\\s*rgb\\([^/]+/\\s*([\\d.]+)\\)`))?.[1]);
    // Enough of the app's paper under the text for AA over Mica's lightest and darkest.
    expect(cover("--mica-content")).toBeGreaterThanOrEqual(0.7);
    const header = all.find((rule) => rule.selectors.includes(`${MICA} .app-header.app-header`));
    expect(header?.body).toMatch(/(^|\s)backdrop-filter:\s*none/);
    expect(header?.body).toMatch(/background:\s*transparent/);
  });

  it("adds no blur of its own on what is always on screen over Mica: only the rail, widened over the page", async () => {
    const css = await read("./window-material.css");
    for (const { selectors, body } of rules(css)) {
      if (!/(^|\s)backdrop-filter:\s*blur/.test(body)) continue;
      for (const one of selectors) expect(one).toMatch(/\.leaflet-sidebar\.leather-surface:is\(:hover, :focus-within\)/);
    }
  });

  it("never animates a backdrop blur", async () => {
    const css = await read("./window-material.css");
    for (const { body } of rules(css)) expect(body).not.toMatch(/transition[^;]*backdrop-filter/);
  });

  it("gives a scrim something to blur: the app's paper while a sheet is open", async () => {
    const css = await read("./window-material.css");
    const open = rules(css).find((rule) => rule.selectors.some((one) => one.startsWith(`${MICA}[data-sheet-open]`)));
    expect(open?.body).toMatch(/background:\s*rgb\(var\(--color-background\)\)/);
  });
});

describe("the desktop's chrome", () => {
  it("is for the desktop by a mouse, in a window wide enough for the rail", async () => {
    const css = await read("./window-material.css");
    const block = css.slice(css.indexOf("@media (min-width: 768px) {"), css.indexOf(":root[data-window-material=\"mica\"],"));
    const inside = rules(block);
    expect(inside.length).toBeGreaterThan(10);
    for (const { selectors } of inside) {
      for (const one of selectors) expect(one.startsWith(DESKTOP), one).toBe(true);
    }
  });

  it("leaves Pip's pixel paper alone wherever it restyles a key, a field or a card", async () => {
    const css = await read("./window-material.css");
    for (const { selectors } of rules(css)) {
      for (const one of selectors) {
        if (!/\.(tactile-button|inset-field|paper-surface)\b/.test(one) || one.includes(".app-header .")) continue;
        for (const pip of PIP) expect(one, one).toContain(pip);
        expect(one).toMatch(/:not\(:is\(\.pip-house-page/);
      }
    }
  });

  it("does not move a key under the pointer", async () => {
    const css = await read("./window-material.css");
    for (const { selectors, body } of rules(css)) {
      if (!selectors.some((one) => /:hover|:active/.test(one))) continue;
      const transform = body.match(/(^|;|\s)transform:\s*([^;]+)/)?.[2]?.trim();
      if (transform) expect(transform, selectors.join(", ")).toBe("none");
    }
  });

  it("is loaded after the glass, so it wins at equal weight", async () => {
    const main = await read("../main.tsx");
    expect(main.indexOf('import "./styles/window-material.css"')).toBeGreaterThan(main.indexOf('import "./styles/glass.css"'));
  });
});
