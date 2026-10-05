import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EpubCFI } from "epubjs";
import { highlightsMarkdown, useAnnotations } from "../useAnnotations";
import type { SearchHit } from "../searchBook";
import { HIGHLIGHT_COLORS } from "../highlightColors";
import { BAR_GAP, placeBar, selectedTextBox } from "../lookupPlacement";
import { planHighlightDraws } from "../highlightDraws";
import { orderHighlights } from "../../components/highlights/highlightsView";
import type { Later, WithAnnotations, WithCover, WithHold, WithOutlook } from "./scope";

/** Bookmarks, highlights, the selection, and search. */
export const useReaderMarks = (reader: WithOutlook & Later<"annotations" | "orderedHighlights">) => {
  const {
    book, chapterLabel, clearToolbar, goToPlace, markNavigating, noteJumpFromHere, readingPlaceCfi,
    releaseUserReadingAnchor, renditionRef, showFocusToast
  } = reader;
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);

  /** Text selected in the page, offered for highlighting. */
  const [selection, setSelection] = useState<{ cfi: string; text: string } | null>(null);
  /** A highlight whose note the notes panel opens on (tapped in the page). */
  const [notesFocus, setNotesFocus] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** Words the search panel opens with ("Search in this book" from the selection bar); empty for Ctrl+F. */
  const [searchSeed, setSearchSeed] = useState("");
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchSeed("");
  };
  /**
   * The look-up card (readers/LookupCard.tsx). It holds the selection's CFI,
   * not a flag, so a card can never show for a selection that has gone or
   * changed.
   */
  const [lookUpCfi, setLookUpCfi] = useState<string | null>(null);
  const addBookmarkRef = useRef<() => void>(() => undefined);

  // For the key handler, which is bound once.
  const selectionRef = useRef<{ cfi: string; text: string } | null>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  // Called from the book's own documents, which are bound once.
  const selectionChangedRef = useRef<() => void>(() => undefined);

  const addBookmark = () => {
    const location = renditionRef.current?.location;
    // The line under the toolbar, which is where an opened bookmark is put.
    const cfi = readingPlaceCfi() ?? location?.start?.cfi;
    if (!cfi) {
      return;
    }
    void reader.annotations
      .addBookmark(cfi, chapterLabel || null)
      .then(() => showFocusToast("Bookmarked."))
      .catch(() => showFocusToast("Couldn't save the bookmark."));
  };
  addBookmarkRef.current = addBookmark;

  /**
   * Highlights drawn over the page by epub.js, which keeps them across the
   * sections it renders. Keyed by id and colour, so a recoloured one is
   * redrawn; cleared when the book is reloaded.
   */
  const appliedHighlightsRef = useRef(new Map<string, string>());

  const clearSelection = () => {
    (renditionRef.current?.getContents?.() ?? []).forEach((contents: any) => {
      contents?.window?.getSelection?.()?.removeAllRanges?.();
    });
    setSelection(null);
  };

  const selectionChapter = () => {
    return chapterLabel || null;
  };

  const highlightSelection = (color: string, withNote = false) => {
    if (!selection) {
      return;
    }
    const picked = selection;
    clearSelection();
    void reader.annotations
      .addHighlight(picked.cfi, picked.text, selectionChapter(), color)
      .then((saved) => {
        if (withNote) {
          setNotesFocus(saved.id);
          setBookmarkPanelOpen(true);
        } else {
          // Where it went, for a reader who has not yet found the list.
          showFocusToast("Highlighted. Your highlights are under the bookmark icon.", 3200);
        }
      })
      .catch(() => showFocusToast("Couldn't save the highlight."));
  };

  const copySelection = () => {
    if (selection) {
      void navigator.clipboard.writeText(selection.text).then(
        () => showFocusToast("Copied."),
        () => showFocusToast("Couldn't copy.")
      );
    }
    clearSelection();
  };

  selectionRef.current = selection;
  clearSelectionRef.current = clearSelection;
  // A click elsewhere in the text lets a selection go, and the offer to
  // highlight it must go too. It used to stay, out of sight, and auto-scroll
  // and Smart Read waited on it for good while still showing their pace.
  selectionChangedRef.current = () => {
    if (!selectionRef.current) {
      return;
    }
    const stillSelected = (renditionRef.current?.getContents?.() ?? []).some((contents: any) => {
      const picked = contents?.window?.getSelection?.();
      return Boolean(picked && !picked.isCollapsed && String(picked).trim());
    });
    if (!stillSelected) {
      setSelection(null);
    }
  };

  // The order is readers/escapeOrder.ts; this says what is open and how each
  // closes. Anything new laid over the text belongs in both lists here and in
  // `interruptedRef` above.
  const lookUpShowing = selection !== null && lookUpCfi === selection.cfi;

  /** "Search in this book", from the selection bar: the search panel opens on the selected words. */
  const searchBookFor = (text: string) => {
    setSearchSeed(text);
    clearSelection();
    setSearchOpen(true);
  };

  const exportHighlights = () => {
    void navigator.clipboard.writeText(highlightsMarkdown(book.title, book.author, reader.orderedHighlights)).then(
      () => showFocusToast("Highlights copied as Markdown."),
      () => showFocusToast("Couldn't copy.")
    );
  };

  const searchMarkRef = useRef<{ cfi: string; timer: number } | null>(null);
  /** Jumps to a search result and marks the words there for a few seconds. */
  const openSearchHit = (hit: SearchHit) => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    noteJumpFromHere();
    releaseUserReadingAnchor();
    markNavigating();
    void rendition.display(hit.cfi).then(() => {
      if (renditionRef.current !== rendition) {
        return;
      }
      clearToolbar(hit.cfi);
      const previous = searchMarkRef.current;
      if (previous) {
        window.clearTimeout(previous.timer);
        try {
          rendition.annotations.remove(previous.cfi, "highlight");
        } catch {
          // Gone with its section.
        }
      }
      try {
        rendition.annotations.highlight(hit.cfi, {}, undefined, "leaflet-search-hit", { fill: "#f5b800", "fill-opacity": "0.55" });
      } catch {
        return;
      }
      const timer = window.setTimeout(() => {
        try {
          rendition.annotations.remove(hit.cfi, "highlight");
        } catch {
          // Gone with its section.
        }
        searchMarkRef.current = null;
      }, 4000);
      searchMarkRef.current = { cfi: hit.cfi, timer };
    });
  };

  const openBookmark = (cfi: string) => {
    if (!renditionRef.current) {
      return;
    }
    setBookmarkPanelOpen(false);
    noteJumpFromHere();
    goToPlace(cfi);
  };

  return {
    bookmarkPanelOpen, setBookmarkPanelOpen, selection, setSelection, notesFocus, setNotesFocus, searchOpen,
    setSearchOpen, searchSeed, closeSearch, setLookUpCfi, addBookmarkRef, selectionRef, clearSelectionRef,
    selectionChangedRef, addBookmark, appliedHighlightsRef, clearSelection, selectionChapter, highlightSelection,
    copySelection, lookUpShowing, searchBookFor, exportHighlights, searchMarkRef, openSearchHit, openBookmark
  };
};

/** Bookmarks and highlights, kept in the database (and the backup). */
export const useBookAnnotations = (reader: WithHold) => {
  const { book } = reader;
  // Bookmarks and highlights, kept in the database (and the backup).
  const annotations = useAnnotations(book.id);
  const { bookmarks, highlights } = annotations;

  /** Highlights in reading order, for the notes panel and the export. */
  // One whose place cannot be read comes last (see orderHighlights): settled
  // pair by pair, it scrambled the order of the rest.
  const orderedHighlights = useMemo(() => {
    const cfi = new EpubCFI();
    return orderHighlights(highlights, (a, b) => cfi.compare(a, b));
  }, [highlights]);

  return { annotations, bookmarks, highlights, orderedHighlights };
};

/** Draws the highlights into the chapters on the page. */
export const useHighlightDrawing = (reader: WithAnnotations) => {
  const { appliedHighlightsRef, highlights, loading, renditionRef, setBookmarkPanelOpen, setNotesFocus } = reader;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition?.annotations || loading) {
      return;
    }
    const applied = appliedHighlightsRef.current;
    const wanted = new Map(highlights.map((item) => [`${item.id}|${item.color ?? "yellow"}`, item]));
    // One mark per place: two highlights of the same words share it (see
    // readers/highlightDraws.ts).
    const plan = planHighlightDraws(
      applied,
      Array.from(wanted, ([key, item]) => ({ key, cfi: item.cfi }))
    );
    plan.remove.forEach((key) => {
      const cfi = applied.get(key);
      if (cfi !== undefined) {
        try {
          rendition.annotations.remove(cfi, "highlight");
        } catch {
          // Already gone with its section.
        }
      }
      applied.delete(key);
    });
    plan.draw.forEach((key) => {
      const item = wanted.get(key);
      if (!item) {
        return;
      }
      const colour = HIGHLIGHT_COLORS[item.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow;
      try {
        rendition.annotations.highlight(
          item.cfi,
          { id: item.id },
          () => {
            setNotesFocus(item.id);
            setBookmarkPanelOpen(true);
          },
          "leaflet-highlight",
          { fill: colour.fill, "fill-opacity": "0.32" }
        );
        applied.set(key, item.cfi);
      } catch {
        // A place from another edition of the book: skipped, still listed.
      }
    });
  }, [highlights, loading]);
};

/** Where the selection bar sits, clear of the words selected. */
export const useSelectionDock = (reader: WithCover) => {
  const { dockAbovePace, renditionRef, scrollContainerRef, selection, toolbarRef } = reader;
  // The selection bar sits at the foot of the page, where the last lines of
  // text are too: when it would lie on the selected words it goes just above
  // them (readers/lookupPlacement.ts: placeBar). Measured as the selection is
  // made, and again as the page scrolls or the window changes under it.
  const selectionDockRef = useRef<HTMLDivElement | null>(null);
  const [selectionDockBottom, setSelectionDockBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!selection) {
      setSelectionDockBottom(null);
      return undefined;
    }
    const measure = () => {
      const dock = selectionDockRef.current;
      const frame = dock?.offsetParent as HTMLElement | null | undefined;
      if (!dock || !frame) {
        return;
      }
      const bar = dock.getBoundingClientRect();
      const within = frame.getBoundingClientRect();
      const usualFoot = within.bottom - (dockAbovePace ? 118 : 64);
      const foot = placeBar({
        usualFoot,
        barHeight: bar.height,
        barLeft: bar.left,
        barRight: bar.right,
        ceiling: (toolbarRef.current?.getBoundingClientRect().bottom ?? 0) + BAR_GAP,
        selection: selectedTextBox(renditionRef.current?.getContents?.() ?? [])
      });
      setSelectionDockBottom(foot === usualFoot ? null : Math.round(within.bottom - foot));
    };
    measure();
    const container = scrollContainerRef.current;
    container?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      container?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [selection, dockAbovePace]);

  return { selectionDockRef, selectionDockBottom };
};
