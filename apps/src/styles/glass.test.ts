import { describe, expect, it } from "vitest";

/**
 * The glass system, read from the stylesheets on disk (a CSS import is
 * emptied under the test runner): its tokens in both themes and every page
 * finish, the utility, the fallbacks, and Pip's own surfaces left out.
 */
const read = async (path: string) => {
  type Fs = { readFileSync: (path: URL, encoding: "utf8") => string };
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  return fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
};

/** Every innermost rule: its selector list and its body. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));

/** The bodies of the rules whose selector list includes exactly `selector`. */
const rulesFor = (css: string, selector: string) =>
  rules(css)
    .filter((rule) => rule.selector.split(/,(?![^(]*\))/).some((one) => one.trim() === selector))
    .map((rule) => rule.body);

const declares = (bodies: string[], property: string) => bodies.some((body) => new RegExp(`(^|;|\\s)${property}\\s*:`).test(body));

const PIP = ["pip-album-dialog", "pip-arcade", "pip-drawer", "pip-shop"];

describe("the app's glass", () => {
  it("has its tokens in the light theme and the dark", async () => {
    const css = await read("./glass.css");
    const light = rulesFor(css, ":root");
    const dark = rulesFor(css, ':root[data-theme="dark"]');
    for (const token of ["--glass-tint", "--glass-tint-strong", "--glass-blur", "--glass-blur-bar", "--glass-saturate", "--glass-specular", "--glass-edge", "--glass-shadow"]) {
      expect(declares(light, token), token).toBe(true);
    }
    // What changes with the theme: the tint, the light on the edge, the depth.
    for (const token of ["--glass-tint", "--glass-tint-strong", "--glass-specular", "--glass-hairline", "--glass-shadow"]) {
      expect(declares(dark, token), token).toBe(true);
    }
    // And the motion it moves by.
    for (const token of ["--ease-out-soft", "--ease-in-soft", "--dur-quick", "--dur-base", "--dur-slow"]) {
      expect(declares(light, token), token).toBe(true);
    }
  });

  it("is translucent: the tints are between 55 and 90 % cover", async () => {
    const css = await read("./glass.css");
    for (const body of [...rulesFor(css, ":root"), ...rulesFor(css, ':root[data-theme="dark"]')]) {
      for (const match of body.matchAll(/--glass-tint(?:-strong)?:\s*rgb\([^/]+\/\s*([\d.]+)\)/g)) {
        const cover = Number(match[1]);
        expect(cover).toBeGreaterThanOrEqual(0.55);
        expect(cover).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it("has a `.glass` utility that blurs (with the -webkit- spelling) from the tokens", async () => {
    const css = await read("./glass.css");
    const glass = rulesFor(css, ".glass");
    expect(glass.some((body) => /-webkit-backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\)/.test(body))).toBe(true);
    expect(glass.some((body) => /(^|\s)backdrop-filter:\s*blur\(var\(--glass-blur\)\)/.test(body))).toBe(true);
    expect(glass.some((body) => /box-shadow:\s*var\(--glass-edge\),\s*var\(--glass-shadow\)/.test(body))).toBe(true);
    expect(rulesFor(css, ".glass-pill").some((body) => /border-radius:\s*9999px/.test(body))).toBe(true);
  });

  it("is solid where no blur is drawn, and on `.no-glass`", async () => {
    const css = await read("./glass.css");
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(css).toMatch(/html\.no-glass[\s\S]*?backdrop-filter:\s*none/);
  });

  it("leaves Pip's pixel-paper surfaces out wherever it names a modal surface", async () => {
    for (const file of ["./glass.css", "../readers/glass.css"]) {
      const css = await read(file);
      for (const { selector } of rules(css)) {
        for (const one of selector.split(/,(?![^(]*\))/).map((part) => part.trim())) {
          // Pip's surfaces are only ever named to be left out (`.pip-dragging` is a state).
          for (const name of (one.match(/\.pip-[\w-]+/g) ?? []).filter((at) => at !== ".pip-dragging")) {
            expect(one, `${file}: ${one}`).toMatch(new RegExp(`:not\\([^)]*\\${name}`));
          }
          if (/\.modal-surface(?![\w-])/.test(one) && !/\[role="menu"\]/.test(one) && !/^\.sheet-backdrop/.test(one) && !/\[data-leaving/.test(one)) {
            for (const pip of PIP) expect(one, `${file}: ${one}`).toContain(pip);
          }
        }
      }
    }
  });

  it("never animates a blur of what is behind (only the surface fades)", async () => {
    for (const file of ["./glass.css", "../readers/glass.css", "./touch-shell.css", "../readers/touch.css"]) {
      const css = await read(file);
      for (const { selector, body } of rules(css)) {
        if (/^(from|to|\d+%)/.test(selector)) expect(body, `${file} keyframe`).not.toMatch(/backdrop-filter/);
        expect(body, `${file}: ${selector}`).not.toMatch(/transition[^;]*backdrop-filter/);
      }
    }
  });

  it("goes solid on the bars that are always there while Pip is carried under them", async () => {
    const css = await read("./glass.css");
    const bars = ".app-header.app-header, .mobile-nav.mobile-nav, .now-reading-bar.now-reading-bar";
    const carried = rules(css).filter(({ selector }) => {
      const one = selector.replace(/\s+/g, " ");
      return one.includes(`:root[data-perf="full"] .pip-dragging :is(${bars})`) &&
        one.includes(":root[data-perf=\"full\"] .pip-dragging .app-shell::before");
    });
    expect(carried).toHaveLength(1);
    expect(carried[0].body).toMatch(/(^|\s)backdrop-filter:\s*none/);
    expect(carried[0].body).toMatch(/background-color:\s*var\(--glass-tint-solid\)/);
  });

  it("does not draw the app under an open book (its glass was composited again on every frame the text moved)", async () => {
    const css = await read("./glass.css");
    const under = "html[data-reading] .app-shell > :is(.app-header, .app-body, .now-reading-dock, .mobile-nav-edge, .mobile-nav)";
    const hidden = rules(css).filter(({ selector }) => {
      const list = selector.replace(/\s+/g, " ").split(/,(?![^(]*\))/).map((one) => one.trim());
      return list.includes(under) && list.includes("html[data-reading] .app-shell::before");
    });
    expect(hidden).toHaveLength(1);
    // Hidden, never removed or collapsed: the Library keeps its layout and its scroll for when the book closes.
    expect(hidden[0].body).toMatch(/(^|\s)visibility:\s*hidden/);
    expect(hidden[0].body).not.toMatch(/display|content-visibility/);
    // And what animates there for ever (the streak's ring) stops ticking.
    // (Each its own selector: a pseudo-element in `:is()` matches nothing, and the ring is an `::after`.)
    for (const what of ["*", "*::before", "*::after"]) {
      expect(rulesFor(css, `${under} ${what}`).join(""), what).toMatch(/animation-play-state:\s*paused/);
    }
    // Nothing the app shows over a book is in the list: dialogs and toasts come after the reader.
    expect(under).not.toMatch(/toast|dialog|wrap-up|pip-world/);
  });

  it("draws a surface's edge inside its rounded shape, so a corner shows only what is behind it", async () => {
    const css = await read("./glass.css");
    for (const body of [...rulesFor(css, ":root"), ...rulesFor(css, ':root[data-theme="dark"]')]) {
      for (const match of body.matchAll(/--glass-hairline:\s*([^;]+);/g)) expect(match[1]).toMatch(/^inset /);
      for (const match of body.matchAll(/--glass-border:\s*([^;]+);/g)) expect(match[1].trim()).toBe("transparent");
    }
    // The header over a phone's page is flush: no rounded corner, no shadow pooled under one.
    expect(css).toMatch(/:root:where\(:is\(\[data-shape="upright"\], \[data-shape="sideways"\]\)\) \.app-header\.app-header \{\s*border-radius: 0;\s*box-shadow: none;/);
  });

  it("paints no strip under Pip on a phone (she steps off words instead: pip/footing.ts)", async () => {
    expect(await read("./phone-polish.css")).not.toMatch(/\.pip-lane\b/);
  });

  it("stands the tab bar on end for a phone on its side: a floating capsule, not a slab", async () => {
    const css = await read("./glass.css");
    const SIDEWAYS = ':root[data-shape="sideways"][data-input="touch"]';
    const rail = rulesFor(css, `${SIDEWAYS} .leaflet-sidebar.leaflet-sidebar`).join(";");
    expect(rail).toMatch(/border-radius:\s*9999px/);
    expect(rail).toMatch(/(^|\s)backdrop-filter:\s*var\(--liquid-filter\)/);
    expect(rail).toMatch(/translate:\s*0 -50%/);
    expect(rulesFor(css, SIDEWAYS).join(";")).toMatch(/--rail-width:\s*calc\(/);
    // No leather stitching, no labels; and out of the way of a keyboard.
    expect(rulesFor(css, `${SIDEWAYS} .leaflet-sidebar.leaflet-sidebar::after`).join(";")).toMatch(/display:\s*none/);
    expect(rulesFor(css, `${SIDEWAYS}[data-keyboard="open"] .leaflet-sidebar.leaflet-sidebar`).join(";")).toMatch(/visibility:\s*hidden/);
  });

  it("moves less for less motion", async () => {
    for (const file of ["./glass.css", "../readers/glass.css"]) {
      expect(await read(file)).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    }
  });
});

describe("the reader's glass", () => {
  it("is tinted from every page: the app's dark and light, True white and True black", async () => {
    const css = await read("../readers/glass.css");
    for (const scope of [".reader-scope", ".reader-scope.reader-light", ".reader-scope.reader-true-white-finish", ".reader-scope.reader-true-black-finish"]) {
      expect(declares(rulesFor(css, scope), "--reader-glass-tint"), scope).toBe(true);
    }
    for (const token of ["--reader-glass-blur", "--reader-glass-blur-bar", "--reader-glass-saturate", "--reader-glass-specular", "--reader-glass-shadow"]) {
      expect(declares(rulesFor(css, ".reader-scope"), token), token).toBe(true);
    }
  });

  it("stays black over a True black page: a black tint and no shadow to lift its edges", async () => {
    const css = await read("../readers/glass.css");
    const black = rulesFor(css, ".reader-scope.reader-true-black-finish").join(";");
    expect(black).toMatch(/--reader-glass-tint:\s*rgb\(0 0 0 \/ 0\.\d+\)/);
    expect(black).toMatch(/--reader-glass-tint-strong:\s*rgb\(0 0 0 \/ 0\.\d+\)/);
    // (A clear shadow, not `none`: these go in lists, where `none` voids the list.)
    expect(black).toMatch(/--reader-glass-shadow:\s*0 0 #0000/);
    expect(black).toMatch(/--reader-glass-shadow-small:\s*0 0 #0000/);
    // The light line along a top bar is at its foot, not at the screen's edge.
    expect(rulesFor(css, ".reader-scope .reader-toolbar").join(";")).toMatch(/box-shadow:\s*inset 0 -1px 0/);
  });

  it("keeps the small pills over the text nearly solid on every page, and blurs what is behind to mush", async () => {
    const css = await read("../readers/glass.css");
    const covers: Record<string, number> = {};
    for (const scope of [".reader-scope", ".reader-scope.reader-light", ".reader-scope.reader-true-white-finish", ".reader-scope.reader-true-black-finish"]) {
      const body = rulesFor(css, scope).join(";");
      const match = body.match(/--reader-glass-tint-pill:\s*(?:color-mix\(in srgb, var\(--reader-panel\) (\d+)%|rgb\(\d+ \d+ \d+ \/ ([\d.]+)\))/);
      expect(match, scope).not.toBeNull();
      covers[scope] = match![1] ? Number(match![1]) / 100 : Number(match![2]);
      expect(covers[scope], scope).toBeGreaterThanOrEqual(0.9);
      expect(covers[scope], scope).toBeLessThanOrEqual(0.94);
    }
    expect(Number(rulesFor(css, ".reader-scope").join(";").match(/--reader-glass-blur-pill:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(20);
    const pills = rules(css).find((rule) => rule.selector.includes(".reader-back-chip") && rule.selector.includes(".reader-tap-hint") && !rule.selector.startsWith("html.no-glass"));
    expect(pills?.body).toMatch(/background-color:\s*var\(--reader-glass-tint-pill\)/);
    for (const name of [".reader-autoscroll-pill", ".read-aloud-pill", ".reader-toast > div"]) expect(pills?.selector).toContain(name);
  });

  it("gives up the toolbar's blur while one of its own sheets is up (it would be their backdrop root)", async () => {
    const css = await read("../readers/glass.css");
    const toolbar = rules(css).find((rule) => /\.reader-toolbar\.reader-toolbar:has\(\.reader-sheet-scrim/.test(rule.selector));
    expect(toolbar?.body).toMatch(/(^|\s)backdrop-filter:\s*none/);
  });

  it("blurs the pace and read-aloud pills less, over text that moves every frame, and that rule wins", async () => {
    const css = await read("../readers/glass.css");
    /** [ids, classes, types] of one selector; `:is()` weighs as its heaviest choice. */
    const weigh = (selector: string): number[] => {
      let rest = selector;
      let best = [0, 0, 0];
      rest = rest.replace(/:is\(([^()]*)\)/g, (_, inner: string) => {
        for (const one of inner.split(",")) {
          const w = weigh(one.trim());
          if (w[0] * 1e6 + w[1] * 1e3 + w[2] > best[0] * 1e6 + best[1] * 1e3 + best[2]) best = w;
        }
        return " ";
      });
      const ids = (rest.match(/#[\w-]+/g) ?? []).length;
      const classes = (rest.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
      const types = (rest.match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
      return [ids + best[0], classes + best[1], types + best[2]];
    };
    const score = (w: number[]) => w[0] * 1e6 + w[1] * 1e3 + w[2];
    const all = rules(css);
    const lighter = all.find((rule) => /:is\(\.reader-autoscroll-pill, \.read-aloud-pill\)$/.test(rule.selector) && /backdrop-filter:\s*blur\(14px\)/.test(rule.body));
    const shared = all.find((rule) => rule.selector.startsWith(".reader-scope :is(.reader-chapter-dock > div, .reader-autoscroll-pill"));
    expect(lighter).toBeDefined();
    expect(shared).toBeDefined();
    expect(all.indexOf(lighter!)).toBeGreaterThan(all.indexOf(shared!));
    expect(score(weigh(lighter!.selector))).toBeGreaterThanOrEqual(score(weigh(shared!.selector)));
  });

  it("fades the dock's pill, not the dock (whose fade would blank the pill's blur)", async () => {
    const touch = await read("../readers/touch.css");
    const dock = rulesFor(touch, 'html[data-input="touch"] .reader-scope .reader-chapter-dock');
    expect(declares(dock, "opacity")).toBe(false);
    expect(declares(dock, "filter")).toBe(false);
    const hidden = rulesFor(touch, 'html[data-input="touch"] .reader-scope.reader-chrome-hidden .reader-chapter-dock:not(.is-awake) > div');
    expect(hidden.some((body) => /opacity:\s*0/.test(body))).toBe(true);
  });

  it("brings the bars in from their hidden state, both ways, off `data-chrome`", async () => {
    const touch = await read("../readers/touch.css");
    const shown = rulesFor(touch, "html .reader-scope[data-shape] .reader-toolbar").join(";");
    const hidden = rulesFor(touch, 'html .reader-scope[data-shape][data-chrome="hidden"] .reader-toolbar').join(";");
    for (const property of ["transform", "opacity", "filter", "visibility"]) {
      expect(shown, `shown: ${property}`).toMatch(new RegExp(`transition:[^;]*${property}`));
      expect(hidden, `hidden: ${property}`).toMatch(new RegExp(`transition:[^;]*${property}`));
    }
    expect(hidden).toMatch(/opacity:\s*0/);
    expect(hidden).toMatch(/filter:\s*blur\(/);
    expect(hidden).toMatch(/visibility:\s*hidden/);
  });
});
