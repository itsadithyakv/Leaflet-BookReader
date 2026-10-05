import { isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import { bookService } from "../../services/bookService";
import { dominantColour } from "../../pip/bookSpines";

/**
 * A cover's one colour, read from its pixels: the library's small thumbnail,
 * drawn smaller still and handed to `dominantColour` (pip/bookSpines.ts). In
 * the app a cover is a file Rust hands over as a data URL; in the browser
 * preview it is whatever address the book carries. Null when there is no
 * cover, it cannot be loaded, or its pixels may not be read (another site's
 * image, without leave): the spine keeps the colour its id gives it.
 */

/** The cover is read at this size: enough to tell its colour by, and quick. */
const SAMPLE = { w: 16, h: 24 };

const sourceOf = async (book: Pick<Book, "id" | "coverUrl">): Promise<string | null> => {
  const url = book.coverUrl;
  if (!url) return null;
  if (isTauri()) return url.startsWith("http") ? null : bookService.coverData(book.id, { thumb: true });
  return url;
};

const load = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    if (src.startsWith("http")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

export const coverColour = async (book: Pick<Book, "id" | "coverUrl">): Promise<string | null> => {
  try {
    const src = await sourceOf(book);
    const image = src ? await load(src) : null;
    if (!image || image.naturalWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE.w;
    canvas.height = SAMPLE.h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE.w, SAMPLE.h);
    return dominantColour(context.getImageData(0, 0, SAMPLE.w, SAMPLE.h).data);
  } catch {
    return null;
  }
};
