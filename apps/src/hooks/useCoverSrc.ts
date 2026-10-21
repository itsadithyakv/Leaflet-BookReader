import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";

/**
 * A book's cover as an image source, for the library and the reader.
 *
 * The library's small covers come by URL from the backend's `cover:` scheme,
 * at 240 and 480 px wide (`srcSet`: the web view picks one for the card's size
 * and the screen), made once from the cover and kept (`storage/thumbs.rs`).
 * Nothing goes through the IPC bridge and nothing stays in the page's memory
 * but the decoded picture, which the web view lets go of off screen.
 *
 * The reader's full cover, and a small one whose URL fails (an older backend,
 * a picture the scheme cannot serve), come as data URLs over IPC instead.
 * Those are kept in a small in-memory cache, so a card scrolled out of a long
 * library and back shows its cover at once instead of asking Rust again.
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

/** The widths the backend keeps (`storage::thumbs::WIDTHS`). */
export const THUMB_WIDTHS = [240, 480] as const;

/** A thumbnail's `src` (the small one) and `srcSet` (both), or null where there are none. */
export const thumbSources = (book: Pick<Book, "id" | "coverUrl">) => {
  const small = bookService.coverThumbUrl(book, THUMB_WIDTHS[0]);
  if (!small) {
    return null;
  }
  const large = bookService.coverThumbUrl(book, THUMB_WIDTHS[1]) ?? small;
  return { src: small, srcSet: `${small} ${THUMB_WIDTHS[0]}w, ${large} ${THUMB_WIDTHS[1]}w` };
};

export type CoverSrc = {
  src: string | null;
  /** Both widths of the thumbnail, for an `<img>` that also says its `sizes`. */
  srcSet?: string;
  onError: (event?: SyntheticEvent<HTMLImageElement>) => void;
};

export const useCoverSrc = (book: Pick<Book, "id" | "coverUrl">, { thumb }: { thumb: boolean }): CoverSrc => {
  // By URL until that fails once for this cover, then by IPC.
  const [urlFailed, setUrlFailed] = useState<string | null>(null);
  const coverKey = `${book.id}|${book.coverUrl ?? ""}`;
  const byUrl = thumb && urlFailed !== coverKey ? thumbSources(book) : null;

  const local = !byUrl && Boolean(book.coverUrl) && isTauri() && !book.coverUrl?.startsWith("http");
  const key = local ? `${coverKey}|${thumb ? "t" : "f"}` : null;
  // In a plain browser (the dev preview) a remote cover URL is used directly.
  const remote = !byUrl && book.coverUrl && !isTauri() && book.coverUrl.startsWith("http") ? book.coverUrl : null;
  const [src, setSrc] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));
  const triedFull = useRef(false);
  // Every way to the picture failed: the card draws its placeholder.
  const [broken, setBroken] = useState<string | null>(null);

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

  /** For the `<img onError>`: the URL's failure falls back to IPC, then one retry with the full cover. */
  const onError = () => {
    if (byUrl) {
      setUrlFailed(coverKey);
      return;
    }
    if (triedFull.current || !isTauri()) {
      setBroken(coverKey);
      return;
    }
    triedFull.current = true;
    void bookService
      .coverData(book.id)
      .then((data) => (data ? setSrc(data) : setBroken(coverKey)))
      .catch(() => setBroken(coverKey));
  };

  if (broken === coverKey) {
    return { src: null, onError };
  }
  if (byUrl) {
    return { src: byUrl.src, srcSet: byUrl.srcSet, onError };
  }
  return { src: src ?? remote, onError };
};

/**
 * What a library cover's `<img>` carries: both sizes with the width it is
 * drawn at (`sizes`), loaded only near the screen, decoded off the main
 * thread, and a 2:3 box before it arrives (the frame sets the real size).
 */
export const coverImgProps = (cover: CoverSrc, sizes: string): ImgHTMLAttributes<HTMLImageElement> => ({
  src: cover.src ?? undefined,
  ...(cover.srcSet ? { srcSet: cover.srcSet, sizes } : {}),
  loading: "lazy",
  decoding: "async",
  width: 240,
  height: 360,
  onError: cover.onError
});
