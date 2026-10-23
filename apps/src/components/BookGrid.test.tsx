import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Book } from "@shared/models/book";
import { BookGrid, VIRTUALIZE_FROM } from "./BookGrid";
import { bookService } from "../services/bookService";
import { PageShownContext } from "../hooks/pageShown";

const books: Book[] = Array.from({ length: 300 }, (_, at) => ({
  id: `b-${at}`,
  title: `Book ${at}`,
  author: "Someone",
  genres: [],
  coverUrl: `/covers/h${at}-cover.jpg`,
  localPath: `/books/h${at}.epub`,
  fileHash: `h${at}`,
  progress: 0,
  lastOpened: null,
  createdAt: "2026-10-01T00:00:00Z"
}));

const nothing = () => undefined;

/** The app's scroll area, as far as the first draw reads it: where it is, and how big. */
const atPlace = (scrollTop: number) => {
  const scroller = { scrollTop, clientHeight: 852, clientWidth: 393 };
  vi.stubGlobal("window", { innerWidth: 393, innerHeight: 852 });
  vi.stubGlobal("document", { querySelector: (selector: string) => (selector === ".app-main-scroll" ? scroller : null) });
};

/** The books drawn, by their cards' names, in order. */
const drawn = (markup: string) => [...markup.matchAll(/aria-label="Open Book (\d+) by/g)].map((match) => Number(match[1]));

describe("a long library's grid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws only the rows around the screen, two books to a row", () => {
    atPlace(0);
    const markup = renderToStaticMarkup(<BookGrid books={books} onRefresh={nothing} onOpen={nothing} />);
    const shown = drawn(markup);
    expect(shown[0]).toBe(0);
    expect(shown.length).toBeGreaterThanOrEqual(4);
    expect(shown.length).toBeLessThan(30);
    // Whole rows: each row's two books together.
    expect(shown.length % 2).toBe(0);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });

  it("first draws the rows where the scroll area already is: the library under a closed book keeps its place", () => {
    // A row is an estimated 360 px and the gap 32 (two to a row at 393 px, by a mouse): the 11th row starts at 3920.
    atPlace(3920);
    const shown = drawn(renderToStaticMarkup(<BookGrid books={books} onRefresh={nothing} onOpen={nothing} />));
    expect(shown).toContain(20);
    expect(shown).toContain(21);
    expect(shown).toContain(24);
    expect(shown).not.toContain(0);
    expect(shown).not.toContain(60);
    expect(Math.min(...shown)).toBeGreaterThanOrEqual(10);
  });

  it("draws the same rows while its page is kept hidden: hiding the Library builds nothing again", () => {
    atPlace(3920);
    const shown = drawn(renderToStaticMarkup(<BookGrid books={books} onRefresh={nothing} onOpen={nothing} />));
    const hidden = drawn(
      renderToStaticMarkup(
        <PageShownContext.Provider value={false}>
          <BookGrid books={books} onRefresh={nothing} onOpen={nothing} />
        </PageShownContext.Provider>
      )
    );
    expect(hidden).toEqual(shown);
  });

  it("asks for each cover at the card's size, both widths, lazily", () => {
    atPlace(0);
    vi.spyOn(bookService, "coverThumbUrl").mockImplementation((book, width) => `cover://localhost/${book.id}?w=${width}`);
    const markup = renderToStaticMarkup(<BookGrid books={books} onRefresh={nothing} onOpen={nothing} />);
    expect(markup).toContain('srcSet="cover://localhost/b-0?w=240 240w, cover://localhost/b-0?w=480 480w"');
    expect(markup).toContain('src="cover://localhost/b-0?w=240"');
    // At 393 px wide, two covers to a row: each (393 - 32) / 2 = 180.5 px, sized up to the next 10.
    expect(markup).toContain('sizes="190px"');
    expect(markup).toMatch(/loading="lazy"/);
    expect(markup).toMatch(/decoding="async"/);
    expect(markup).toMatch(/width="240" height="360"/);
  });

  it("keeps Pip's footing and the menu's hold on every card", () => {
    atPlace(0);
    const markup = renderToStaticMarkup(<BookGrid books={books} onRefresh={nothing} onOpen={nothing} />);
    const cards = drawn(markup).length;
    expect(markup.match(/data-pip-ledge="book"/g)?.length).toBe(cards);
    expect(markup.match(/data-book-menu=""/g)?.length).toBe(cards);
  });

  it("draws a short library whole", () => {
    atPlace(0);
    const few = books.slice(0, VIRTUALIZE_FROM);
    expect(drawn(renderToStaticMarkup(<BookGrid books={few} onRefresh={nothing} onOpen={nothing} />))).toHaveLength(VIRTUALIZE_FROM);
  });
});

describe("the rows drawn", () => {
  const range = { startIndex: 10, endIndex: 12, overscan: 2, count: 150 };

  it("are those near the screen", async () => {
    const { rowsToDraw } = await import("./VirtualRows");
    expect(rowsToDraw(range, null)).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });

  it("keep the row with the keyboard's focus, however far it has scrolled", async () => {
    const { rowsToDraw } = await import("./VirtualRows");
    expect(rowsToDraw(range, 2)).toEqual([2, 8, 9, 10, 11, 12, 13, 14]);
    expect(rowsToDraw(range, 11)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    // A row the library no longer has (a filter took it) is not asked for.
    expect(rowsToDraw(range, 400)).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });
});
