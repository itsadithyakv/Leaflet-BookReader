import { describe, expect, it } from "vitest";

/**
 * The app around the pages takes "a phone on its side" from the window's steady shape,
 * `html[data-shape]` (platform/shape.ts), never from the window's height alone: a phone's keyboard
 * makes the window short too (the WebView ends at it), and a 412 x 915 phone typing into Settings
 * was laid out on its side, the rail for the tab bar. Read from disk (a CSS import is emptied under
 * the test runner); named so the app's types need no Node.
 */
type Fs = {
  readFileSync: (path: URL, encoding: "utf8") => string;
  readdirSync: (path: URL, options: { recursive: true }) => string[];
};
const load = async () => (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;

const SRC = new URL("../", import.meta.url);

/** Every stylesheet of the app but the reader's (readers/ keeps its own shape: readers/touchLayout.ts). */
const shellSheets = async () => {
  const fs = await load();
  return fs
    .readdirSync(SRC, { recursive: true })
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => file.endsWith(".css") && !file.startsWith("readers/"))
    .map((file) => ({ file, css: fs.readFileSync(new URL(file, SRC), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
};

/** The phone-on-its-side line, as a height in a media query: 520 px tall or less, or more than that. */
const SIDEWAYS_BY_HEIGHT = /\((?:max-height:\s*520px|min-height:\s*521px)\)/;

describe("a phone on its side, in the app's stylesheets", () => {
  it("is never a window's height alone", async () => {
    const sheets = await shellSheets();
    expect(sheets.length).toBeGreaterThan(5);
    const found = sheets.flatMap(({ file, css }) =>
      [...css.matchAll(/@media([^{]+)\{/g)].filter((match) => SIDEWAYS_BY_HEIGHT.test(match[1])).map((match) => `${file}: @media${match[1]}`)
    );
    expect(found).toEqual([]);
  });

  it("is the window's shape where the tab bar and the rail change places", async () => {
    const sheets = Object.fromEntries((await shellSheets()).map(({ file, css }) => [file, css]));
    // The header and the rail sideways, the tab bar's room upright.
    expect(sheets["styles/touch-shell.css"]).toMatch(/:where\(html\[data-shape="sideways"\]\) \.app-header\.app-header \{/);
    expect(sheets["index.css"]).toMatch(/:where\(html\[data-shape="upright"\]\) \.app-main-scroll \{\s*padding-bottom: calc\(var\(--mobile-nav-height\)/);
    expect(sheets["styles/phone-polish.css"]).toMatch(/:where\(html\[data-shape="sideways"\]\) \.app-shell \{\s*--dock-room: 0px;/);
  });

  it("is a Tailwind variant on the shape, not a screen of a height", async () => {
    const fs = await load();
    const config = fs.readFileSync(new URL("../../tailwind.config.cjs", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(config).not.toMatch(SIDEWAYS_BY_HEIGHT);
    expect(config).toContain(`addVariant("short", 'html[data-shape="sideways"] &')`);
  });

  it("puts the tab bar and the book being read away while the keyboard is up", async () => {
    const css = Object.fromEntries((await shellSheets()).map(({ file, css }) => [file, css]))["styles/touch-shell.css"];
    expect(css).toMatch(/html\[data-keyboard="open"\] \{\s*--mobile-nav-height: 0px;/);
    expect(css).toMatch(/html\[data-keyboard="open"\] \.mobile-nav\.mobile-nav,\s*html\[data-keyboard="open"\] \.app-shell \.now-reading-dock \{\s*display: none;/);
  });
});
