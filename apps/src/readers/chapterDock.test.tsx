import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChapterDock } from "./ChapterDock";

/** A stylesheet read from disk (a CSS import is emptied under the test runner); named so the app's types need no Node. */
const readCss = async (path: string) => {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
};

const nothing = () => undefined;

/** The dock's turning buttons as drawn, left to right: what each is called, its hint and the way its arrow points. */
const arrows = (props: { paged: boolean; rtl?: boolean }) => {
  const markup = renderToStaticMarkup(
    <ChapterDock
      {...props}
      label="Chapter 3"
      onPrev={nothing}
      onNext={nothing}
      onPrevChapter={nothing}
      onNextChapter={nothing}
      outlook={{ progress: null, chapter: null, book: null }}
      canGoBack={false}
      canGoForward={false}
      onBack={nothing}
      onForward={nothing}
      awake={false}
    />
  );
  return [...markup.matchAll(/<button[^>]*title="([^"]*)"[^>]*aria-label="((?:Previous|Next) (?:page|chapter))"[^>]*>(.*?)<\/button>/g)].map(
    ([, title, name, inside]) => ({
      name,
      title,
      points: /chevron_left|chevrons-left/.test(inside) ? "left" : /chevron_right|chevrons-right/.test(inside) ? "right" : "?"
    })
  );
};

describe("the chapter dock's arrows", () => {
  it("go back on the left and on on the right in a left-to-right book", () => {
    expect(arrows({ paged: true })).toEqual([
      { name: "Previous chapter", title: "Previous chapter (Ctrl+Left)", points: "left" },
      { name: "Previous page", title: "Previous page (Left arrow)", points: "left" },
      { name: "Next page", title: "Next page (Right arrow or Space)", points: "right" },
      { name: "Next chapter", title: "Next chapter (Ctrl+Right)", points: "right" }
    ]);
  });

  it("sit and point the other way in a right-to-left book's pages, and name the arrow that turns them", () => {
    expect(arrows({ paged: true, rtl: true })).toEqual([
      { name: "Next chapter", title: "Next chapter (Ctrl+Right)", points: "left" },
      { name: "Next page", title: "Next page (Left arrow or Space)", points: "left" },
      { name: "Previous page", title: "Previous page (Right arrow)", points: "right" },
      { name: "Previous chapter", title: "Previous chapter (Ctrl+Left)", points: "right" }
    ]);
  });

  it("are the chapters' when scrolling, whichever way the book reads", () => {
    const scrolling = [
      { name: "Previous chapter", title: "Previous chapter (Left arrow)", points: "left" },
      { name: "Next chapter", title: "Next chapter (Right arrow)", points: "right" }
    ];
    expect(arrows({ paged: false })).toEqual(scrolling);
    expect(arrows({ paged: false, rtl: true })).toEqual(scrolling);
  });
});

describe("the dock's arrows by finger (QA: the first tap on › missed)", () => {
  let css = "";
  beforeAll(async () => {
    css = await readCss("./readingOutlook.css");
  });
  /** The declarations of the rule for exactly `selector`, or null. */
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? null : css.slice(at, css.indexOf("}", at));
  };

  it("never shows the time left on a hover or a focus, which a tap leaves behind and which widened the dock under the thumb", () => {
    const hidden = /html\[data-input="touch"\] \.reader-chapter-dock:hover \.reader-outlook-time,\s*html\[data-input="touch"\] \.reader-chapter-dock:focus-within \.reader-outlook-time \{\s*display: none;/;
    expect(css).toMatch(hidden);
    // And without the app's touch marker, on any screen that cannot hover.
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.reader-chapter-dock:hover \.reader-outlook-time,\s*\.reader-chapter-dock:focus-within \.reader-outlook-time \{\s*display: none;/);
  });

  it("opens the time left above the row when asked for, not in it", () => {
    expect(rule('html[data-input="touch"] .reader-chapter-dock.is-open .reader-outlook-time')).toMatch(/position: absolute;[\s\S]*bottom: calc\(100% \+ 6px\);/);
  });

  it("gives the chapter's name and the counts widths of their own, so a longer name does not move the arrows", () => {
    expect(rule('html[data-input="touch"] .reader-dock-label')).toMatch(/flex: none;[\s\S]*width: min\(42vw, 11rem\);/);
    expect(rule('html[data-input="touch"] .reader-outlook-percent')).toMatch(/min-width:/);
    expect(rule('html[data-input="touch"] .reader-dock-pages')).toMatch(/min-width:/);
  });

  it("keeps the way back after a jump outside the row", () => {
    expect(rule('html[data-input="touch"] .reader-dock-way')).toMatch(/position: absolute;[\s\S]*bottom: calc\(100% \+ 6px\);/);
    const markup = renderToStaticMarkup(
      <ChapterDock
        paged={false}
        label="Chapter 3"
        onPrev={nothing}
        onNext={nothing}
        outlook={{ progress: 0.34, chapter: 15, book: 720 }}
        canGoBack
        canGoForward={false}
        onBack={nothing}
        onForward={nothing}
        awake
      />
    );
    expect(markup).toMatch(/<span class="reader-dock-way"><button[^>]*aria-label="Back to where you were"/);
  });
});
