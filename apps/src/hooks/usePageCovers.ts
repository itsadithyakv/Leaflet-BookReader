import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { MAX_BACKGROUND_BYTES, TRIED_KEY, duePageCovers, readTried, withTried, type Tried } from "../library/pageCoverQueue";
import { COVER_WIDTH } from "../readers/pageCover";
import { bookService } from "../services/bookService";
import { useLibraryStore } from "../store/libraryStore";

/** How long the library is left alone before a cover is made, and between one and the next. */
const WAIT_MS = 4000;

/** Tried since the app started: what stops a second try where nothing can be stored. */
const attempted = new Set<string>();

const storedTried = (): Tried => {
  try {
    return readTried(localStorage.getItem(TRIED_KEY));
  } catch {
    return {};
  }
};

/**
 * Makes one PDF's cover from its first page: the file is read, the page
 * drawn and saved, and the file let go. The PDF reader is loaded only now
 * (it is the largest part of the app the library does not need).
 */
const makeCover = async (bookId: string) => {
  const bytes = await bookService.fileSize(bookId);
  if (bytes === null || bytes > MAX_BACKGROUND_BYTES) {
    return;
  }
  const { createPdfPageSource } = await import("../readers/pageSources");
  const source = await createPdfPageSource(bookId);
  try {
    const image = await source.pdf?.coverImage(COVER_WIDTH);
    if (image) {
      await useLibraryStore.getState().savePageCover(bookId, image);
    }
  } finally {
    source.destroy();
  }
};

/**
 * Gives every PDF with no cover its first page for one, without the book
 * being opened (library/pageCoverQueue.ts says which, and why). One at a
 * time, a while after the library has settled, and never while a book is
 * open: the page being read comes first, and that book's reader makes its
 * own cover.
 */
export const usePageCovers = (readingId: string | null) => {
  const books = useLibraryStore((state) => state.books);
  const lookupTried = useLibraryStore((state) => state.lookupTried);
  const busyRef = useRef(false);
  // Bumped when a cover is done, so the next book has its turn.
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (!isTauri() || readingId !== null || busyRef.current) {
      return;
    }
    const next = duePageCovers(books, lookupTried, storedTried(), Date.now()).find((book) => !attempted.has(book.id));
    if (!next) {
      return;
    }
    const timer = window.setTimeout(() => {
      busyRef.current = true;
      attempted.add(next.id);
      // Noted before it is tried: a file that cannot be drawn is not read again at every launch.
      try {
        localStorage.setItem(TRIED_KEY, JSON.stringify(withTried(storedTried(), next.id, Date.now(), useLibraryStore.getState().books)));
      } catch {
        // Without storage it is tried once a run (`attempted`).
      }
      void makeCover(next.id)
        .catch(() => {
          // Tried again in a fortnight, or when the book is opened.
        })
        .finally(() => {
          busyRef.current = false;
          setTurn((value) => value + 1);
        });
    }, WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [books, lookupTried, readingId, turn]);
};
