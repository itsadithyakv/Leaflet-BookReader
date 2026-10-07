import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Annotation } from "../services/annotationService";
import { KINDLE_TAG_ABOUT } from "../library/kindleClippings";
import { AnnotationsPanel } from "./AnnotationsPanel";

const highlight = (id: string, cfi: string, text: string | null, more: Partial<Annotation> = {}): Annotation => ({
  id,
  bookId: "b",
  kind: "highlight",
  cfi,
  text,
  color: "yellow",
  chapter: null,
  createdAt: "2024-03-04T16:45:32.000Z",
  updatedAt: "2026-10-07T10:00:00Z",
  ...more
});

const nothing = () => undefined;

/** The notes panel as it is first drawn, as markup. */
const panel = (highlights: Annotation[]) =>
  renderToStaticMarkup(
    <AnnotationsPanel
      bookmarks={[]}
      highlights={highlights}
      onAddBookmark={nothing}
      onOpen={nothing}
      onRemove={nothing}
      onSaveNote={nothing}
      onRecolor={nothing}
      onCopy={nothing}
      onExport={nothing}
      onClose={nothing}
    />
  );

/** The part of the markup that is one highlight's. */
const itemOf = (markup: string, id: string) => {
  const from = markup.indexOf(`data-note="${id}"`);
  const to = markup.indexOf("</article>", from);
  return from < 0 ? "" : markup.slice(from, to);
};

describe("a highlight brought from a Kindle, in the reader's notes", () => {
  const own = highlight("own", "epubcfi(/6/4!/4/2,/1:0,/1:5)", "A passage of the book.", { chapter: "One" });
  const kindle = highlight("k1", "kindle:123", "The tide kept its own ledger.", { chapter: "Page 12", note: "Like the harbour master." });
  const noteOnly = highlight("k2", "kindle:500", null, { chapter: "Location 500", note: "Who is the pilot?" });

  it("is listed with its words, its note and a Kindle tag", () => {
    const item = itemOf(panel([own, kindle]), "k1");
    expect(item).toContain("The tide kept its own ledger.");
    expect(item).toContain("Like the harbour master.");
    expect(item).toContain(">Kindle</span>");
    expect(item).toContain(`title="${KINDLE_TAG_ABOUT}"`);
  });

  it("is words, not a way to a place in the book", () => {
    const markup = panel([own, kindle]);
    expect(itemOf(markup, "own")).toContain("Go to this place in the book");
    expect(itemOf(markup, "own")).not.toContain(">Kindle</span>");
    expect(itemOf(markup, "k1")).not.toContain("Go to this place in the book");
    expect(itemOf(markup, "k1")).toMatch(/<p class="reader-notes-quote"[^>]*>The tide kept its own ledger\.<\/p>/);
  });

  it("is only its note where nothing was highlighted", () => {
    const item = itemOf(panel([noteOnly]), "k2");
    expect(item).toContain("Who is the pilot?");
    expect(item).not.toContain("reader-notes-quote");
    expect(item).toContain(">Kindle</span>");
  });

  it("is filed under the Kindle's page, after the book's own chapters", () => {
    const markup = panel([own, kindle, noteOnly]);
    expect(markup.indexOf(">One<")).toBeGreaterThan(-1);
    expect(markup.indexOf(">Page 12<")).toBeGreaterThan(markup.indexOf(">One<"));
    expect(markup.indexOf(">Location 500<")).toBeGreaterThan(markup.indexOf(">Page 12<"));
  });
});
