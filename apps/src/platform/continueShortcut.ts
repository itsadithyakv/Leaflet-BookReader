import { useEffect, useRef } from "react";
import type { Book } from "@shared/models/book";
import { isFinished } from "../constants/books";
import { useLibraryStore } from "../store/libraryStore";
import { bookService } from "../services/bookService";
import { android, onAndroid } from "./android";

/**
 * The app icon's "Continue <book>" shortcut on Android: a long press on
 * Leaflet's icon offers the book being read, with its cover, and a tap opens
 * it at its place.
 *
 * Which book is the library's to say, so it follows the library: the one
 * opened last that is begun and not at its end (Social's "reading now", with
 * no time limit and nothing sent anywhere). Opening a book, reading on,
 * finishing it, deleting it or deleting everything moves the shortcut on to
 * the next such book, or takes it away. A switch to another library takes it
 * away before the page starts over on the new one (`libraryOwnerStore`).
 *
 * The native half is `Shortcuts.kt`, through `DevicePlugin`.
 */

export const SHORT_LABEL_MAX = 25;
export const LONG_LABEL_MAX = 50;
const VERB = "Continue ";
const ELLIPSIS = "…";

const chars = (text: string) => Array.from(text);
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The book the shortcut offers: opened last, begun, not at its end. */
export const continueBook = (books: readonly Book[]): Book | null => {
  let best: { book: Book; at: number } | null = null;
  for (const book of books) {
    if (!tidy(book.title ?? "") || !book.lastOpened) continue;
    if (!((book.progress ?? 0) > 0) || isFinished(book.progress)) continue;
    const at = Date.parse(book.lastOpened);
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.at || (at === best.at && book.id < best.book.id)) best = { book, at };
  }
  return best?.book ?? null;
};

/** `text` in at most `max` characters: cut at a word where that loses little, and marked with an ellipsis. */
export const fitText = (text: string, max: number): string => {
  const clean = tidy(text);
  if (chars(clean).length <= max) return clean;
  const room = Math.max(1, max - 1);
  const head = chars(clean).slice(0, room).join("");
  const space = head.lastIndexOf(" ");
  const cut = space >= Math.ceil(head.length * 0.6) ? head.slice(0, space) : head;
  return cut.replace(/[\s.,;:!?\-–—(]+$/u, "") + ELLIPSIS;
};

/** "Continue <title>" in at most `max` characters; a subtitle is the first thing to go. */
export const continueLabel = (title: string, max: number): string => {
  const clean = tidy(title);
  const room = max - VERB.length;
  if (chars(clean).length <= room) return VERB + clean;
  const main = tidy(clean.split(/\s*[:(]\s*|\s+[-–—]\s+/u)[0] ?? "");
  return VERB + fitText(main || clean, room);
};

export type ContinueShortcut = { bookId: string; shortLabel: string; longLabel: string; coverUrl: string | null };

/** What the shortcut should be for this library, or null for none. */
export const shortcutFor = (books: readonly Book[]): ContinueShortcut | null => {
  const book = continueBook(books);
  if (!book) return null;
  return {
    bookId: book.id,
    shortLabel: continueLabel(book.title, SHORT_LABEL_MAX),
    longLabel: continueLabel(book.title, LONG_LABEL_MAX),
    coverUrl: book.coverUrl ?? null
  };
};

const keyOf = (shortcut: ContinueShortcut | null) =>
  shortcut ? JSON.stringify([shortcut.bookId, shortcut.shortLabel, shortcut.longLabel, shortcut.coverUrl]) : "";

type Native = {
  set: (shortcut: { bookId: string; shortLabel: string; longLabel: string; coverDataUrl: string | null }) => Promise<void>;
  clear: () => Promise<void>;
  cover: (bookId: string) => Promise<string | null>;
};

/**
 * Keeps the phone's shortcut in step with the library: told each new state of
 * it, it sets or clears the shortcut only when what it would say changed, one
 * call at a time and in order. `forget` clears it and makes the next state
 * set it again.
 */
export const createShortcutKeeper = (native: Native) => {
  let last: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  const run = (step: () => Promise<void>) => {
    queue = queue.then(step).catch(() => undefined);
    return queue;
  };
  return {
    update(books: readonly Book[]) {
      const want = shortcutFor(books);
      const key = keyOf(want);
      if (key === last) return queue;
      last = key;
      if (!want) return run(() => native.clear());
      return run(async () => {
        const coverDataUrl = want.coverUrl ? await native.cover(want.bookId).catch(() => null) : null;
        await native.set({ bookId: want.bookId, shortLabel: want.shortLabel, longLabel: want.longLabel, coverDataUrl });
      });
    },
    forget() {
      last = "";
      return run(() => native.clear());
    }
  };
};

const keeper = createShortcutKeeper({
  set: (shortcut) => android.setContinueShortcut(shortcut),
  clear: () => android.clearContinueShortcut(),
  cover: (bookId) => bookService.coverData(bookId, { thumb: true })
});

/** Takes the shortcut away (before the page starts over on another library). No-op off Android. */
export const clearContinueShortcut = async (): Promise<void> => {
  if (!onAndroid()) return;
  await keeper.forget();
};

declare global {
  interface Window {
    /** Called by the Android side when a "Continue" shortcut was tapped (`Shortcuts.nudge`). */
    __leafletContinue?: () => void;
  }
}

/**
 * On Android: keeps the shortcut in step with the library, and hands a tapped
 * one's book to `onTap` once the library has loaded (a tap can be what started
 * Leaflet); null when that book is no longer in it. No-op elsewhere.
 */
export const useContinueShortcut = (onTap: (book: Book | null) => void) => {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  useEffect(() => {
    if (!onAndroid()) return;
    // The library before its first load is empty, not without a book to continue.
    let loaded = useLibraryStore.getState().books.length > 0;
    let seenLoading = useLibraryStore.getState().loading;
    let tapped: string | null = null;
    let disposed = false;

    const settle = () => {
      const state = useLibraryStore.getState();
      if (state.loading) {
        seenLoading = true;
        return;
      }
      if (seenLoading || state.books.length > 0) loaded = true;
      if (!loaded) return;
      void keeper.update(state.books);
      if (tapped) {
        const bookId = tapped;
        tapped = null;
        onTapRef.current(state.books.find((book) => book.id === bookId) ?? null);
      }
    };

    const drain = () => {
      void android.takeContinueShortcut().then((bookId) => {
        if (!bookId || disposed) return;
        tapped = bookId;
        settle();
      });
    };

    const unsubscribe = useLibraryStore.subscribe(settle);
    window.__leafletContinue = drain;
    settle();
    drain();
    return () => {
      disposed = true;
      unsubscribe();
      if (window.__leafletContinue === drain) delete window.__leafletContinue;
    };
  }, []);
};
