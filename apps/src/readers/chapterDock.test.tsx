import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChapterDock } from "./ChapterDock";

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
