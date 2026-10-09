import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { orderHighlights } from "../components/highlights/highlightsView";
import type { Annotation } from "../services/annotationService";
import { HighlightCard } from "./HighlightCard";
import { HIGHLIGHT_COLORS } from "./highlightColors";
import { LookupCard } from "./LookupCard";
import type { Box } from "./lookupPlacement";
import { comparePlaces, decodePlace, encodePlace, highlightAt, highlightsUnderRects, lineRects, selectedWords, toPageRects } from "./pdfHighlights";
import type { PageRect } from "./pdfText";
import { SelectionBar } from "./SelectionBar";
import { useAnnotations } from "./useAnnotations";

/** A highlight as a page draws it. */
export type PageHighlight = { id: string; rects: PageRect[]; swatch: string };

const NONE: PageHighlight[] = [];
/** A selection longer than this is kept as far as this: a highlight is a passage, not a chapter. */
const MAX_TEXT = 6000;
/** A "rectangle" this much of the page tall is not a line of text (the layer's own filler, a whole-page run). */
const NOT_A_LINE = 0.2;

type Picked = { page: number; rects: PageRect[]; text: string; box: Box };

type Options = {
  bookId: string;
  /** False for a comic, and until the PDF is open: nothing is read or listened for. */
  enabled: boolean;
  /** The scrolling stage the pages are in. */
  stageRef: RefObject<HTMLElement | null>;
  /** What a page is called in the list of notes: its chapter, or "Page 12". */
  labelOf: (page: number) => string;
  /** The book's language and how far through it the reader is, for a word looked up and kept. */
  language?: string | null;
  progress: () => number;
  onSearch?: (text: string) => void;
  /** The list of all notes, opened on a highlight. */
  onShowAll: (id: string) => void;
  /** A highlight's words as a picture to share. */
  onShare?: (text: string) => void;
  toast: (message: string) => void;
};

/**
 * Highlights and notes in a PDF: selecting words on a page offers what
 * selecting them in a book does, a highlight is drawn over the page, and
 * pressing one opens its card. The page reader mounts this once and is handed
 * back what to draw.
 *
 * A PDF could not be highlighted at all: the page reader had a bookmark for a
 * page and nothing for a line.
 *
 * The words are pdf.js's text layer, which is the page reader's own document
 * (not a frame, as a book's chapters are), so the selection is the window's.
 */
export const usePdfNotes = ({ bookId, enabled, stageRef, labelOf, language, progress, onSearch, onShowAll, onShare, toast }: Options) => {
  // (The page reader keeps its bookmarks under the key a book's old bookmarks were moved from: not to be moved.)
  const annotations = useAnnotations(bookId, { moveOldBookmarks: false, enabled });
  const { highlights } = annotations;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [opened, setOpened] = useState<{ id: string; writing: boolean } | null>(null);
  const [lookUp, setLookUp] = useState(false);

  const ordered = useMemo(() => orderHighlights(highlights, comparePlaces), [highlights]);

  /** Each page's highlights, for drawing and for telling which one a press is on. */
  const byPage = useMemo(() => {
    const pages = new Map<number, PageHighlight[]>();
    for (const item of highlights) {
      const place = decodePlace(item.cfi);
      if (!place || place.rects.length === 0) {
        continue;
      }
      const swatch = (HIGHLIGHT_COLORS[item.color ?? "yellow"] ?? HIGHLIGHT_COLORS.yellow).swatch;
      const list = pages.get(place.page) ?? [];
      list.push({ id: item.id, rects: place.rects, swatch });
      pages.set(place.page, list);
    }
    return pages;
  }, [highlights]);
  const byPageRef = useRef(byPage);
  byPageRef.current = byPage;

  const clearSelection = useCallback(() => {
    try {
      document.getSelection()?.removeAllRanges();
    } catch {
      // Nothing was selected.
    }
    setPicked(null);
    setLookUp(false);
  }, []);

  // What is selected on a page, read when the selecting stops.
  useEffect(() => {
    if (!enabled) {
      setPicked(null);
      return undefined;
    }
    const read = () => {
      const stage = stageRef.current;
      const selection = document.getSelection();
      if (!stage || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPicked(null);
        setLookUp(false);
        return;
      }
      const range = selection.getRangeAt(0);
      const from = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement;
      const layer = from?.closest(".textLayer");
      const pageBox = layer?.closest<HTMLElement>(".pdf-reader-page");
      const page = Number(pageBox?.dataset.page);
      const text = selectedWords(selection.toString()).slice(0, MAX_TEXT);
      if (!layer || !pageBox || !stage.contains(layer) || !Number.isInteger(page) || page < 1 || !text) {
        setPicked(null);
        setLookUp(false);
        return;
      }
      // Only what is on the page the selection began on: a highlight is on one page.
      const within = pageBox.getBoundingClientRect();
      const rects = lineRects(toPageRects(Array.from(range.getClientRects()), within).filter((rect) => rect.height < NOT_A_LINE));
      if (rects.length === 0) {
        setPicked(null);
        return;
      }
      const around = range.getBoundingClientRect();
      setPicked({ page, rects, text, box: { left: around.left, right: around.right, top: around.top, bottom: around.bottom } });
    };
    const soon = () => window.setTimeout(read, 0);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === "Shift") {
        soon();
      }
    };
    // A selection let go by a click elsewhere takes its bar with it.
    const onChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed) {
        setPicked(null);
        setLookUp(false);
      }
    };
    document.addEventListener("pointerup", soon);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("pointerup", soon);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [enabled, stageRef]);

  // Escape lets a selection go before it does anything else.
  useEffect(() => {
    if (!picked) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [picked, clearSelection]);

  // A press on a highlight's words opens it. The text layer lies over the
  // highlights (so their words can still be selected), and so the press is
  // found by where it landed on the page.
  useEffect(() => {
    const stage = stageRef.current;
    if (!enabled || !stage) {
      return undefined;
    }
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onClick = (event: MouseEvent) => {
      const pressed = down;
      down = null;
      const target = event.target as Element | null;
      const pageBox = target?.closest<HTMLElement>(".pdf-reader-page");
      const page = Number(pageBox?.dataset.page);
      // A drag is a selection being made; a link is the link's.
      if (
        event.button !== 0 ||
        event.defaultPrevented ||
        !pageBox ||
        !Number.isInteger(page) ||
        (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5) ||
        target?.closest("a, button, .pdf-link-area") ||
        !document.getSelection()?.isCollapsed
      ) {
        return;
      }
      const box = pageBox.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        return;
      }
      const hit = highlightAt(byPageRef.current.get(page) ?? NONE, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
      if (hit) {
        setOpened({ id: hit.id, writing: false });
      }
    };
    stage.addEventListener("pointerdown", onDown, { passive: true });
    stage.addEventListener("click", onClick);
    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("click", onClick);
    };
  }, [enabled, stageRef]);

  /** The highlights the selected words lie over, and the one that holds them all already. */
  const underPicked = () => highlightsUnderRects(picked ? byPageRef.current.get(picked.page) ?? NONE : NONE, picked?.rects ?? []);

  const highlight = (color: string, withNote = false) => {
    if (!picked) {
      return;
    }
    const made = picked;
    const { within } = underPicked();
    clearSelection();
    // Highlighted already: that highlight, in the colour asked for. Nothing is laid on it.
    if (within) {
      const had = annotations.highlights.find((item) => item.id === within.id);
      if (withNote) {
        setOpened({ id: within.id, writing: true });
      } else if ((had?.color ?? "yellow") === color) {
        toast("Already highlighted.");
      } else {
        void annotations.update(within.id, { color }).then(
          () => toast("Colour changed."),
          () => toast("Couldn't save the highlight.")
        );
      }
      return;
    }
    void annotations
      .addHighlight(encodePlace({ page: made.page, rects: made.rects }), made.text, labelOf(made.page), color)
      .then((saved) => {
        if (withNote) {
          setOpened({ id: saved.id, writing: true });
        } else {
          toast("Highlighted.");
        }
      })
      .catch(() => toast("Couldn't save the highlight."));
  };

  /** The selection bar's "Remove highlight": every highlight under the selected words. */
  const removeUnderPicked = () => {
    const ids = underPicked().over.map((item) => item.id);
    clearSelection();
    if (ids.length === 0) {
      return;
    }
    void Promise.all(ids.map((id) => annotations.remove(id))).then(
      () => toast(ids.length === 1 ? "Highlight removed." : `${ids.length} highlights removed.`),
      () => toast("Couldn't remove the highlight.")
    );
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast("Copied."),
      () => toast("Couldn't copy.")
    );
  };

  /** Where a highlight is in the window now, for its card to keep off it; null when its page is not drawn. */
  const boxOf = (item: Annotation): Box | null => {
    const place = decodePlace(item.cfi);
    const pageBox = place ? stageRef.current?.querySelector<HTMLElement>(`.pdf-reader-page[data-page="${place.page}"]`) : null;
    if (!place || !pageBox || place.rects.length === 0) {
      return null;
    }
    const within = pageBox.getBoundingClientRect();
    const tops = place.rects.map((rect) => rect.top);
    const bottoms = place.rects.map((rect) => rect.top + rect.height);
    const lefts = place.rects.map((rect) => rect.left);
    const rights = place.rects.map((rect) => rect.left + rect.width);
    return {
      top: within.top + Math.min(...tops) * within.height,
      bottom: within.top + Math.max(...bottoms) * within.height,
      left: within.left + Math.min(...lefts) * within.width,
      right: within.left + Math.max(...rights) * within.width
    };
  };

  const openedItem = opened ? (highlights.find((item) => item.id === opened.id) ?? null) : null;

  /** What sits over the foot of the page: the selection's bar (and a look-up), or an open highlight. */
  const dock: ReactNode =
    enabled && picked ? (
      <div className="pdf-notes-dock">
        {lookUp && (
          <LookupCard
            term={picked.text}
            language={language ?? undefined}
            avoid={() => picked.box}
            place={{ bookId, cfi: encodePlace({ page: picked.page, rects: [] }), chapter: labelOf(picked.page), progress: progress() }}
            onClose={() => setLookUp(false)}
          />
        )}
        <SelectionBar
          text={picked.text}
          onHighlight={(color) => highlight(color)}
          onNote={() => highlight("yellow", true)}
          onRemoveHighlight={underPicked().over.length > 0 ? removeUnderPicked : undefined}
          onCopy={() => {
            copy(picked.text);
            clearSelection();
          }}
          onDismiss={clearSelection}
          onLookUp={() => setLookUp((open) => !open)}
          lookUpOpen={lookUp}
          onSearchBook={
            onSearch
              ? () => {
                  const text = picked.text;
                  clearSelection();
                  onSearch(text);
                }
              : undefined
          }
        />
      </div>
    ) : enabled && openedItem ? (
      <div className="pdf-notes-dock">
        <HighlightCard
          key={openedItem.id}
          highlight={openedItem}
          writing={opened?.writing}
          avoid={() => boxOf(openedItem)}
          onSaveNote={(text) => void annotations.update(openedItem.id, { note: text || null })}
          onRecolor={(color) => void annotations.update(openedItem.id, { color })}
          onRemove={() => {
            setOpened(null);
            // And any other highlight of exactly this place with no note of
            // its own, laid on this one by an older version.
            annotations.highlights
              .filter((item) => item.id === openedItem.id || (item.cfi === openedItem.cfi && !item.note?.trim()))
              .forEach((item) => void annotations.remove(item.id));
          }}
          onCopy={() => copy(openedItem.text ?? "")}
          onShare={onShare ? () => onShare(openedItem.text ?? "") : undefined}
          onShowAll={() => {
            const id = openedItem.id;
            setOpened(null);
            onShowAll(id);
          }}
          onClose={() => setOpened(null)}
        />
      </div>
    ) : null;

  return {
    /** In reading order, for the list of notes. */
    highlights: ordered,
    /** A page's highlights, to draw over it. The same list for the same page until a highlight changes. */
    onPage: byPage,
    dock,
    /** Something of this is over the page (a selection's bar, an open highlight). */
    busy: Boolean(picked) || Boolean(openedItem),
    opened: openedItem?.id ?? null,
    close: () => setOpened(null),
    update: annotations.update,
    remove: annotations.remove,
    copy
  };
};

/** A page's highlights, drawn under its text layer. */
export const PdfHighlightMarks = ({ highlights }: { highlights: PageHighlight[] | undefined }) =>
  highlights && highlights.length > 0 ? (
    <div className="pdf-reader-highlights" aria-hidden="true">
      {highlights.map((item) =>
        item.rects.map((rect, part) => (
          <span
            key={`${item.id}-${part}`}
            className="pdf-reader-highlight"
            style={{
              left: `${rect.left * 100}%`,
              top: `${rect.top * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
              background: item.swatch
            }}
          />
        ))
      )}
    </div>
  ) : null;
