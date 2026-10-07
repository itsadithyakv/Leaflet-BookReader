import { useEffect, useMemo, useState } from "react";
import { annotationService, type Annotation } from "../../services/annotationService";
import { useLibraryStore } from "../../store/libraryStore";
import { isKindlePlace } from "../../library/kindleClippings";
import { EYEBROW } from "../ui/SectionHeader";
import { UiIcon } from "../UiIcon";
import { dayKey, dismiss, dismissedOn, pickBook, pickHighlight } from "./highlightOfTheDay";
import { openInBook, useHighlightsStore } from "./highlightsStore";

/**
 * One of the reader's own highlights, on the library page, once a day
 * (`highlightOfTheDay.ts` chooses it). Nothing when there are no highlights, or
 * when today's has been put away. Pressing the passage opens its book there.
 */
export const DailyHighlight = () => {
  const counts = useHighlightsStore((state) => state.counts);
  const books = useLibraryStore((state) => state.books);
  const [day] = useState(() => dayKey(new Date()));
  const [away, setAway] = useState(() => dismissedOn(day));
  const [found, setFound] = useState<Annotation | null>(null);

  // Among the books still in the library: a count can outlive its book.
  const bookId = useMemo(() => {
    const here = new Set(books.map((book) => book.id));
    return pickBook(Object.fromEntries(Object.entries(counts).filter(([id]) => here.has(id))), day);
  }, [books, counts, day]);

  useEffect(() => {
    if (away || !bookId) {
      setFound(null);
      return undefined;
    }
    let live = true;
    annotationService
      .list(bookId)
      .then((all) => {
        if (live) {
          setFound(pickHighlight(all.filter((item) => item.kind === "highlight"), day, new Date()));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [away, bookId, day]);

  const book = found ? books.find((item) => item.id === found.bookId) : null;
  if (away || !found || !book) {
    return null;
  }
  // A highlight brought in from a Kindle has no place in this copy of the book.
  const canOpen = !isKindlePlace(found.cfi) && book.available !== false;

  return (
    <aside className="paper-surface relative rounded-xl px-5 py-4 pr-12" aria-label="One of your highlights">
      <p className={EYEBROW}>From your highlights</p>
      <button
        type="button"
        className="mt-2 block w-full text-left disabled:cursor-default"
        disabled={!canOpen}
        title={canOpen ? "Open the book here" : undefined}
        onClick={() => openInBook(book.id, found.cfi)}
      >
        <span className="line-clamp-2 font-headline text-base leading-snug text-on-surface">{(found.text ?? "").trim()}</span>
        <span className="mt-2 block truncate text-xs text-on-surface-variant">
          {book.title}
          {book.author ? ` · ${book.author}` : ""}
        </span>
      </button>
      <button
        type="button"
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        aria-label="Put away until tomorrow"
        title="Put away until tomorrow"
        onClick={() => {
          dismiss(day);
          setAway(true);
        }}
      >
        <UiIcon name="close" size={16} />
      </button>
    </aside>
  );
};
