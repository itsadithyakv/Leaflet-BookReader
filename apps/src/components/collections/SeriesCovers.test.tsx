import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Book } from "@shared/models/book";
import type { SeriesGroup } from "../../library/series";
import { SeriesCovers } from "./SeriesCovers";
import { SeriesDetail } from "./SeriesDetail";

const book = (id: string, title: string): Book => ({
  id,
  title,
  author: "Frank Herbert",
  genres: [],
  coverUrl: null,
  localPath: `/books/${id}.epub`,
  fileHash: id,
  progress: 0,
  lastOpened: null,
  createdAt: "2026-10-01T00:00:00Z"
});

const dune: SeriesGroup = {
  key: "dune|herbert",
  name: "Dune",
  author: "Frank Herbert",
  members: [
    { book: book("a", "Dune"), index: 1 },
    { book: book("b", "Dune Messiah"), index: 2 }
  ],
  total: 6,
  missing: [],
  parts: [],
  missingExtras: [],
  finishedCount: 0,
  ownedCount: 2,
  next: book("a", "Dune"),
  upNext: false,
  missingNext: null
} as SeriesGroup;

const nothing = () => undefined;
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("a series' covers", () => {
  it("are found from the series' ⋯ menu, not a button on its card", () => {
    const page = <SeriesDetail group={dune} onOpen={nothing} showToast={nothing} />;
    const markup = renderToStaticMarkup(page);
    expect(text(markup)).not.toMatch(/\bCovers\b/);
    expect(markup).toContain('aria-label="More for Dune"');
  });

  it("show blank covers and how far the look has got while Open Library is asked", () => {
    const sheet = <SeriesCovers group={dune} onClose={nothing} showToast={nothing} />;
    const markup = renderToStaticMarkup(sheet);
    expect(markup).toContain('role="status"');
    expect(text(markup)).toContain("this can take a minute");
    expect(text(markup)).toContain("0 of 2 books");
    // A blank cover a book, in each of the two waiting rows.
    expect(markup.match(/cover-ghost h-28/g)?.length).toBe(4);
    // It can be closed while it looks.
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Close<\/button>/);
  });
});
