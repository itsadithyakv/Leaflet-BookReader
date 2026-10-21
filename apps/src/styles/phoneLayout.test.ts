import { describe, expect, it } from "vitest";

/**
 * What the emulator's QA of 1.5.8 found on a phone, held in the stylesheets (read from disk: a CSS
 * import is emptied under the test runner): the room the page keeps for the floating header and
 * the rail under it, the held buttons of a sheet, toasts over Pip, and the reader's way back.
 */
type Fs = {
  readFileSync: (path: URL, encoding: "utf8") => string;
  readdirSync: (path: URL, options: { recursive: true }) => string[];
};
const load = async () => (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
const SRC = new URL("../", import.meta.url);
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const read = async (path: string) => uncomment((await load()).readFileSync(new URL(path, SRC), "utf8"));

/** Every innermost rule: its selector list and its body, with where it starts. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2], at: match.index ?? 0 }));

/** The rules whose selector list includes exactly `selector`. */
const rulesFor = (css: string, selector: string) =>
  rules(css).filter((rule) => rule.selector.split(/,(?![^(]*\))/).some((one) => one.trim() === selector));

const value = (body: string, property: string) => body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`))?.[1].trim();

const PHONE = ':where(html:is([data-shape="upright"], [data-shape="sideways"]))';

describe("the floating header's room on a phone", () => {
  it("is worked out from the same inset the header's padding is, not measured whole", async () => {
    const shell = await read("styles/touch-shell.css");
    const index = await read("index.css");
    const app = await read("App.tsx");

    // The header's top padding is one variable, from the status bar's inset, either way up.
    for (const selector of [":root", ':root[data-shape="sideways"]']) {
      const pad = rulesFor(shell, selector).map((rule) => value(rule.body, "--app-header-pad-top")).find(Boolean);
      expect(pad, selector).toMatch(/var\(--inset-top\)/);
    }
    for (const selector of [".app-header.app-header", ':where(html[data-shape="sideways"]) .app-header.app-header']) {
      const pads = rulesFor(shell, selector).map((rule) => value(rule.body, "padding-top")).filter(Boolean);
      expect(pads.length, selector).toBeGreaterThan(0);
      for (const pad of pads) expect(pad, selector).toBe("var(--app-header-pad-top)");
    }

    // The page's room adds the measured body to it, so a new inset moves both in one frame.
    const room = rulesFor(index, `${PHONE} .app-shell`).map((rule) => value(rule.body, "--app-header-h")).find(Boolean);
    expect(room).toMatch(/^calc\(var\(--app-header-pad-top[^)]*\)\s*\+\s*var\(--app-header-body-h[^)]*\)\)$/);
    const page = rulesFor(index, `${PHONE} .app-main-scroll.app-main-scroll`).map((rule) => value(rule.body, "padding-top")).find(Boolean);
    expect(page).toMatch(/var\(--app-header-h/);

    // App.tsx measures the body only (platform/headerRoom.ts); the whole height is CSS's.
    expect(app).toMatch(/watchHeaderRoom\(/);
    expect(app).not.toMatch(/setProperty\(\s*"--app-header-h"/);
  });

  it("is kept by the rail by a finger too: its keys start below the header, after the rule that set 10 px", async () => {
    const shell = await read("styles/touch-shell.css");
    const plain = rules(shell).find((rule) => /\.leaflet-sidebar:focus-within/.test(rule.selector) && value(rule.body, "padding-top") === "10px");
    const below = rules(shell).find(
      (rule) => rule.selector.startsWith(PHONE) && rule.selector.includes(".leaflet-sidebar:hover") && /var\(--app-header-h/.test(value(rule.body, "padding-top") ?? "")
    );
    expect(plain).toBeDefined();
    expect(below).toBeDefined();
    expect(below!.at).toBeGreaterThan(plain!.at);
  });
});

describe("a sheet's held buttons", () => {
  it("run the sheet's full width and down to its foot", async () => {
    const shell = await read("styles/touch-shell.css");
    const strip = rulesFor(shell, ".sheet-panel .sheet-actions")[0];
    expect(strip).toBeDefined();
    expect(value(strip.body, "margin-inline")).toBe("-1.5rem");
    expect(value(strip.body, "padding")).toMatch(/^0\.625rem 1\.5rem /);
    // Held, it gives back the sheet's foot padding, as its margin does at rest.
    expect(value(strip.body, "bottom")).toBe(value(strip.body, "margin-bottom"));

    // That is the sheets' own side padding: every sheet with held buttons is `p-6`.
    const fs = await load();
    const files = fs
      .readdirSync(SRC, { recursive: true })
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));
    const holders = files.filter((file) => fs.readFileSync(new URL(file, SRC), "utf8").includes("sheet-actions"));
    expect(holders.length).toBeGreaterThan(2);
    for (const file of holders) {
      const source = fs.readFileSync(new URL(file, SRC), "utf8");
      const panels = [...source.matchAll(/"[^"]*\bsheet-panel\b[^"]*"/g)].map((match) => match[0]);
      expect(panels.length, file).toBeGreaterThan(0);
      for (const panel of panels) expect(panel, file).toMatch(/\bp-6\b/);
    }
  });

  it("are the sheet's glass: bare unless the form is under them, never a coat or a blur of their own", async () => {
    const glass = await read("styles/glass.css");
    const own = rulesFor(glass, ".sheet-panel .sheet-actions.sheet-actions");
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const rule of own) {
      expect(value(rule.body, "backdrop-filter"), rule.body).toBeUndefined();
      expect(rule.body).not.toMatch(/surface-high\)\)\s*9\d%/);
    }
    // Where scroll-driven animation runs: bare at rest, the held colour only while the form scrolls under.
    const supported = glass.slice(glass.indexOf("@supports (animation-timeline: scroll())"));
    const bare = rulesFor(supported, ".sheet-panel .sheet-actions.sheet-actions")[0];
    expect(value(bare.body, "background")).toBe("transparent");
    expect(value(bare.body, "animation-timeline")).toMatch(/^scroll\(/);
    // Without it, held always: the sheet's colour as it shows, opaque, in both themes.
    expect(own.some((rule) => value(rule.body, "background") === "var(--sheet-held)")).toBe(true);
    for (const theme of [":root", ':root[data-theme="dark"]']) {
      const held = rulesFor(glass, theme).map((rule) => value(rule.body, "--sheet-held")).find(Boolean);
      expect(held, theme).toMatch(/^color-mix\(in srgb, rgb\(var\(--color-surface-high\)\) 8\d%/);
    }
  });
});

describe("toasts", () => {
  it("are over Pip wherever she is, and let a tap through", async () => {
    const fs = await load();
    const index = await read("index.css");
    const toast = rulesFor(index, ".app-toast").find((rule) => value(rule.body, "z-index"));
    const z = Number(value(toast!.body, "z-index"));
    expect(value(toast!.body, "pointer-events")).toBe("none");

    // Every layer of Pip's in the app's stylesheets (her world, her bubbles, her cards, the peek)...
    const pip = fs
      .readdirSync(SRC, { recursive: true })
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => file.endsWith(".css") && !file.startsWith("readers/") && !file.startsWith("desktop-pip/"))
      .flatMap((file) => rules(uncomment(fs.readFileSync(new URL(file, SRC), "utf8"))))
      .filter((rule) => rule.selector.includes("pip"))
      .map((rule) => Number(value(rule.body, "z-index")))
      .filter((n) => Number.isFinite(n));
    expect(pip.length).toBeGreaterThan(5);
    // ...and the layer she is raised to while carried or flying (components/PipWorld.tsx).
    const raised = Number((await read("components/PipWorld.tsx")).match(/raised \? "(\d+)"/)?.[1]);
    expect(raised).toBeGreaterThan(35);
    expect(z).toBeGreaterThan(Math.max(raised, ...pip));
  });
});

describe("the reader's way back, by finger", () => {
  it("is one pill: its keys lie flat in it, and its shadow is the pill's", async () => {
    const glass = await read("readers/glass.css");
    const way = rulesFor(glass, 'html[data-input="touch"] .reader-scope .reader-dock-way')[0];
    expect(value(way.body, "box-shadow")).toMatch(/var\(--reader-glass-shadow-small\)/);
    expect(value(way.body, "backdrop-filter")).toBe("none");
    const keys = rulesFor(glass, 'html[data-input="touch"] .reader-scope .reader-dock-way .reader-mini-control')[0];
    expect(value(keys.body, "background")).toBe("transparent");
    expect(value(keys.body, "border-color")).toBe("transparent");
    // Its round ends are the dock's (readingOutlook.css), the shape the shadow follows.
    const outlook = await read("readers/readingOutlook.css");
    const shape = rulesFor(outlook, 'html[data-input="touch"] .reader-dock-way')[0];
    expect(value(shape.body, "border-radius")).toBe("inherit");
  });
});
