import { useEffect, useMemo, useRef } from "react";
import { isKindlePlace } from "../../library/kindleClippings";
import type { AnnotationInput } from "../../services/annotationService";
import { entryAtShare } from "../chapterSpan";
import { bookOfSection, labelInBook } from "../innerBooks";
import { kindleWanted, placeInBook, readTried, triedKey, writeTried, type KindleTried } from "../kindlePlacing";
import type { ReaderScope } from "./scope";

/**
 * How long after the book is up the looking starts. Until then the first
 * pages are being drawn, measured and indexed, and the reader is finding the
 * line: nothing is added to that.
 */
const START_AFTER_MS = 4000;
/** The longest the looking goes on before the page has a turn. */
const SLICE_MS = 6;
/** How many are saved together, and the rest before the next lot: each lot redraws the notes and the marks on the page once. */
const LOT = 20;
const LOT_REST_MS = 150;

/** The page's next idle moment, or soon after: reading (and Smart Read's scrolling) comes first. */
const rest = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 400 });
    } else {
      window.setTimeout(resolve, 16);
    }
  });

/**
 * Gives the highlights brought from a Kindle their places in the open book
 * (readers/kindlePlacing.ts). They arrive at `kindle:<location>`, listed and
 * not drawn; with the book open their words are looked for in its text, in
 * the background, and each one found is saved again at its own CFI, under
 * its chapter's name. From then on it is a highlight like any other. One not
 * found stays as it was, and is not looked for again on this device.
 */
export const useKindlePlacing = (reader: ReaderScope) => {
  const { annotations, book, bookRef, chapterStarts, highlights, innerBooksRef, loadError, loading, tocLabelsRef } = reader;
  // The looking takes seconds and the list changes under it (its own saves, a
  // highlight removed meanwhile): what it reads when it saves is today's.
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  /** What was looked for in this book and not found, as this device remembers it. */
  const triedRef = useRef<{ book: string; tried: KindleTried } | null>(null);
  if (triedRef.current?.book !== book.id) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(triedKey(book.id));
    } catch {
      // Storage that cannot be read: they are looked for again.
    }
    triedRef.current = { book: book.id, tried: readTried(raw) };
  }
  // Whether there is anything to look for: the effect below waits on this and
  // not on the list, which its own saves change (it would start over at each).
  const pending = useMemo(
    () => kindleWanted(highlights.filter((item) => item.bookId === book.id), triedRef.current?.tried ?? readTried(null)).passages.length > 0,
    [highlights, book.id]
  );

  /**
   * The chapter a place found is in: the last contents entry that starts at
   * or before it, with its book's name in a set, as the dock names the
   * chapter being read (useReaderOutlook: noteChapterHere), but by how far
   * down its file the place is and not by the page, which may not be showing
   * it. Null where the contents name nothing.
   */
  const chapterAt = (section: number, within: number) => {
    const entry = entryAtShare(chapterStarts(), section, within);
    const inner = innerBooksRef.current[bookOfSection(innerBooksRef.current, section)];
    return labelInBook(inner?.label, entry >= 0 ? (tocLabelsRef.current[entry] ?? "") : "") || null;
  };

  useEffect(() => {
    const epub = bookRef.current;
    if (loading || loadError || !pending || !epub) {
      return undefined;
    }
    const stop = new AbortController();
    const { signal } = stop;
    const run = async () => {
      const tried = triedRef.current?.tried ?? readTried(null);
      const { passages, top } = kindleWanted(highlightsRef.current.filter((item) => item.bookId === book.id), tried);
      if (passages.length === 0) {
        return;
      }
      const placed = await placeInBook(epub, passages, { signal, top, pause: rest, sliceMs: SLICE_MS });
      if (!placed || signal.aborted) {
        return;
      }
      // Those the book has not got are remembered, here and now: they are
      // certain. Those found need no remembering once saved, and one that
      // will not save is looked for again at the next opening.
      const next: KindleTried = { ids: new Set([...tried.ids, ...passages.filter((one) => !placed.has(one.id)).map((one) => one.id)]), top };
      triedRef.current = { book: book.id, tried: next };
      try {
        localStorage.setItem(triedKey(book.id), writeTried(next));
      } catch {
        // Not kept: they are looked for again next time.
      }
      const found = [...placed];
      for (let at = 0; at < found.length && !signal.aborted; at += LOT) {
        const inputs: AnnotationInput[] = [];
        for (const [id, place] of found.slice(at, at + LOT)) {
          // As it is now: removed since, it is not brought back; its note and colour are today's.
          const row = highlightsRef.current.find((item) => item.id === id);
          if (!row || !isKindlePlace(row.cfi)) {
            continue;
          }
          // (No date is sent: a row that is there keeps its own, the Kindle's.)
          const { createdAt: _c, updatedAt: _u, deletedAt: _d, ...input } = row;
          inputs.push({ ...input, cfi: place.cfi, chapter: chapterAt(place.section, place.within) ?? row.chapter ?? null });
        }
        await annotationsRef.current.saveAll(inputs, signal);
        await new Promise((resolve) => window.setTimeout(resolve, LOT_REST_MS));
      }
    };
    const timer = window.setTimeout(() => {
      void run().catch(() => undefined);
    }, START_AFTER_MS);
    // The book closed, changed or loaded again: the looking stops where it is.
    return () => {
      window.clearTimeout(timer);
      stop.abort();
    };
  }, [book.id, loading, loadError, pending]);
};
