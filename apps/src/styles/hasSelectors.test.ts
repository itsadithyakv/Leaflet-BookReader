import { describe, expect, it } from "vitest";

/**
 * No `:has()` on the whole page. A `:has()` whose subject is the root, the body or the app's
 * shell (`html:has(.reader-scope) …`, `.app-shell:has(> .reader-scope) …`) made the browser
 * restyle the whole document every time any element was added or removed anywhere: a row of
 * covers as the library scrolls, Pip's speech, a toast. On a phone at 4× CPU that was 90 to
 * 200 ms each time; without it, 4 ms. What those rules asked is now an attribute the app sets
 * (platform/rootMarks.ts, App.tsx's `.app-shell[data-dock]`, motion.ts's `data-sheet-open`).
 * A `:has()` on a small part (a reader's toolbar, a card) is fine.
 */

type Fs = {
  readFileSync: (path: URL, encoding: "utf8") => string;
  readdirSync: (path: URL, options: { withFileTypes: true }) => Array<{ name: string; isDirectory: () => boolean }>;
};

const load = async () => {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
  const root = new URL("../", import.meta.url);
  const files: Array<{ path: string; css: string }> = [];
  const walk = (dir: URL, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${rel}${entry.name}/`);
      else if (entry.name.endsWith(".css")) files.push({ path: `${rel}${entry.name}`, css: fs.readFileSync(new URL(entry.name, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") });
    }
  };
  walk(root, "");
  return files;
};

/** The compound selector a `:has(` at `index` belongs to (read back to the combinator before it). */
export const compoundBefore = (selector: string, index: number) => {
  let depth = 0;
  let i = index - 1;
  for (; i >= 0; i--) {
    const c = selector[i];
    if (c === ")") depth++;
    else if (c === "(") {
      // Inside `:not(` or `:is(`: the compound is the one that pseudo-class is in.
      if (depth > 0) depth--;
    } else if (depth === 0 && /[\s>+~,{}]/.test(c)) break;
  }
  return selector.slice(i + 1, index);
};

/** A compound that is the whole page: the root, the body, the shell, anything, or nothing at all. */
export const broad = (compound: string) =>
  compound === "" || compound === "*" || /^(html|:root|body|\*)(?![\w-])/.test(compound) || /(^|[^\w-])\.app-shell(?![\w-])/.test(compound);

/** A selector list split at its top-level commas. */
const splitList = (text: string) => {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      out.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(text.slice(from).trim());
  return out;
};

/** The index of the `)` closing the `(` at `open`. */
const closing = (text: string, open: number) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
};

/** What comes after a `:has(…)` reaches every element under it: a `*` of its own (`> *`, ` *`, `*::after`). */
export const everything = (tail: string) => /(^|[\s>+~])\*/.test(tail);

describe("`:has()` in the stylesheets", () => {
  it("knows a broad subject from a small one", () => {
    const at = (selector: string) => compoundBefore(selector, selector.indexOf(":has("));
    expect(broad(at("html:has(.reader-scope) .pip-world"))).toBe(true);
    expect(broad(at(":root[data-window-material=\"mica\"]:has(.sheet-backdrop) .app-shell"))).toBe(true);
    expect(broad(at(".app-shell:has(> .reader-scope) > .app-header"))).toBe(true);
    expect(broad(at(":where(html[data-shape=\"upright\"]) .app-shell:has(.now-reading-dock)"))).toBe(true);
    expect(broad(at("body:has(.x)"))).toBe(true);
    expect(broad(at(":has(.x) .y"))).toBe(true);
    expect(broad(at(".reader-scope:has(.reader-autoscroll-pill) .reader-toast"))).toBe(false);
    expect(broad(at("html .reader-scope .reader-toolbar.reader-toolbar:has(.reader-menu)"))).toBe(false);
    expect(broad(at(".pip-room-card-body:has(> .pip-album)"))).toBe(false);
    expect(broad(at(".app-shell-x:has(.y)"))).toBe(false);
    expect(broad(at(".app-header.app-header:not(:has(.anchored-panel))"))).toBe(false);
    expect(everything(" > *")).toBe(true);
    expect(everything(" *::before")).toBe(true);
    expect(everything(" > .share-canvas")).toBe(false);
    expect(everything(":not(.x) .y")).toBe(false);
  });

  it("never asks it of the root, the body or the app's shell, nor of everything under it", async () => {
    const found: string[] = [];
    for (const { path, css } of await load()) {
      for (const rule of css.matchAll(/([^{}]+)\{/g)) {
        const text = rule[1].trim();
        if (!text.includes(":has(") || text.startsWith("@")) continue;
        for (const selector of splitList(text)) {
          for (const match of selector.matchAll(/:has\(/g)) {
            const compound = compoundBefore(selector, match.index!);
            const tail = selector.slice(closing(selector, match.index! + 4) + 1);
            if (broad(compound.trim()) || everything(tail)) found.push(`${path}: ${selector.replace(/\s+/g, " ").slice(-140)}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
