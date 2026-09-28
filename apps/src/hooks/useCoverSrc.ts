import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";

/**
 * A book's cover as an image source, for the library and the reader.
 *
 * Covers live on disk and reach the webview as data URLs. The library asks for
 * the small thumbnail; the reader for the full cover. Results are kept in a
 * small in-memory cache, so a card scrolled out of a long library and back
 * (the grid only draws what is on screen) shows its cover at once instead of
 * asking Rust again. Four components each had their own copy of this.
 */

const CACHE_CAP = 500;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

const remember = (key: string, value: string) => {
  cache.set(key, value);
  if (cache.size > CACHE_CAP) {
    // Oldest first: a Map iterates in insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
};

const load = (key: string, bookId: string, thumb: boolean) => {
  let pending = inflight.get(key);
  if (!pending) {
    pending = bookService
      .coverData(bookId, { thumb })
      .then((data) => {
        if (data) {
          remember(key, data);
        }
        return data;
      })
      // A missing or unreadable cover just leaves the placeholder.
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
};

export const useCoverSrc = (book: Pick<Book, "id" | "coverUrl">, { thumb }: { thumb: boolean }) => {
  const local = Boolean(book.coverUrl) && isTauri() && !book.coverUrl?.startsWith("http");
  const key = local ? `${book.id}|${book.coverUrl}|${thumb ? "t" : "f"}` : null;
  // In a plain browser (the dev preview) a remote cover URL is used directly.
  const remote = book.coverUrl && !isTauri() && book.coverUrl.startsWith("http") ? book.coverUrl : null;
  const [src, setSrc] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));
  const triedFull = useRef(false);

  useEffect(() => {
    triedFull.current = false;
    if (!key) {
      setSrc(null);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setSrc(hit);
      return;
    }
    let live = true;
    setSrc(null);
    void load(key, book.id, thumb).then((data) => {
      if (live) {
        setSrc(data);
      }
    });
    return () => {
      live = false;
    };
  }, [key, book.id, thumb]);

  /** For the `<img onError>`: one retry with the full cover. */
  const onError = () => {
    if (triedFull.current || !isTauri()) {
      return;
    }
    triedFull.current = true;
    void bookService
      .coverData(book.id)
      .then((data) => data && setSrc(data))
      .catch(() => undefined);
  };

  return { src: src ?? remote, onError };
};
