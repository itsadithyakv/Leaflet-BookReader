import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Size } from "../readers/imageZoom";
import type { PdfExtras, PageSource } from "../readers/pageSources";
import { bookService } from "../services/bookService";
import { useLibraryStore } from "../store/libraryStore";
import type { PictureRef, Rect } from "./cards";
import { cropPixels } from "./pictureBoxes";

/**
 * A picture card's picture, found again in its book (docs/design/study-plan.md,
 * "Pictures: by reference"): an EPUB's picture by its path in the archive,
 * unzipped alone by the backend (`book_picture`); a PDF's page drawn with
 * pdf.js and the part of it shown cut out. Nothing of it is kept in the card.
 *
 * Loaded with the review and the picture card maker, never at start: pdf.js
 * comes only for a PDF's card.
 */

export type LoadedPicture = { url: string; natural: Size };

/** The book is not on this device (not in the library, or its file not here): the card shows a placeholder. */
export class PictureMissing extends Error {
  constructor(message = "The book isn't on this device.") {
    super(message);
    this.name = "PictureMissing";
  }
}

/** The longest side a picture is drawn at for a card: sharp on a phone held close, small enough for an old one's memory. */
const LONGEST = 2000;
const MAX_PIXELS = 6_000_000;

const mimeOf = (path: string) => {
  const ending = path.toLowerCase().split(".").pop() ?? "";
  return ending === "svg" ? "image/svg+xml" : ending === "jpg" || ending === "jpeg" ? "image/jpeg" : ending ? `image/${ending}` : "image/png";
};

const naturalOf = (url: string) =>
  new Promise<Size>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1200, height: image.naturalHeight || 900 });
    image.onerror = () => reject(new Error("That picture could not be shown."));
    image.src = url;
  });

const blobUrl = (canvas: HTMLCanvasElement) =>
  new Promise<string>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("The page could not be drawn."))), "image/png")
  );

/**
 * A PDF page drawn as a picture: the whole page, or `crop` of it, at about
 * `longest` pixels along its longer side.
 */
export const pdfPagePicture = async (pdf: PdfExtras, page: number, crop: Rect | null = null, longest = LONGEST): Promise<LoadedPicture> => {
  const size = await pdf.pageSize(page);
  const part = crop ?? { left: 0, top: 0, width: 1, height: 1 };
  const ratio = window.devicePixelRatio || 1;
  // The part shown at `longest`, the whole page within what memory allows.
  const want = longest / Math.max(part.width * size.width, part.height * size.height);
  const scale = Math.min(want, Math.sqrt(MAX_PIXELS / (size.width * size.height))) / ratio;
  const sheet = document.createElement("canvas");
  try {
    await pdf.draw(page, sheet, { scale, maxPixels: MAX_PIXELS }).promise;
    const cut = cropPixels({ width: sheet.width, height: sheet.height }, part);
    const out = document.createElement("canvas");
    out.width = cut.width;
    out.height = cut.height;
    const context = out.getContext("2d");
    if (!context) {
      throw new Error("The page could not be drawn.");
    }
    context.drawImage(sheet, -cut.x, -cut.y);
    const url = await blobUrl(out);
    out.width = 0;
    out.height = 0;
    return { url, natural: { width: cut.width, height: cut.height } };
  } finally {
    sheet.width = 0;
    sheet.height = 0;
  }
};

/** An EPUB's picture, by its path in the archive. */
const epubPicture = async (bookId: string, path: string): Promise<LoadedPicture> => {
  let bytes: ArrayBuffer;
  if (isTauri()) {
    bytes = await invoke<ArrayBuffer>("book_picture", { bookId, path });
  } else {
    // The browser preview: the whole book, and the picture out of it.
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await bookService.readBookBytes(bookId));
    const plain = path.replace(/^\/+/, "");
    const entry = zip.file(plain) ?? zip.file(decodeURIComponent(plain));
    if (!entry) {
      throw new Error("That picture is not in the book.");
    }
    bytes = await entry.async("arraybuffer");
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
  try {
    return { url, natural: await naturalOf(url) };
  } catch (failure) {
    URL.revokeObjectURL(url);
    throw failure;
  }
};

/**
 * Pictures for a review or an edit: each fetched once however many of its
 * boxes are asked, a PDF opened once however many of its pages, and all of
 * it let go of at `close`. A load asked for after a close starts afresh (React
 * may close and open a component's effects again); one that finishes after
 * it is let go of at once.
 */
export const pictureLoader = () => {
  const pictures = new Map<string, Promise<LoadedPicture>>();
  const pdfs = new Map<string, Promise<PageSource>>();
  let generation = 0;

  const pdfOf = (bookId: string) => {
    let source = pdfs.get(bookId);
    if (!source) {
      source = import("../readers/pageSources").then(({ createPdfPageSource }) => createPdfPageSource(bookId));
      pdfs.set(bookId, source);
    }
    return source;
  };

  const load = (bookId: string, picture: PictureRef, crop: Rect | null): Promise<LoadedPicture> => {
    const book = useLibraryStore.getState().books.find((entry) => entry.id === bookId);
    if (!book || book.available === false) {
      return Promise.reject(new PictureMissing());
    }
    const key = `${bookId}|${picture.kind === "pdf" ? `pdf:${picture.page}` : `epub:${picture.path}`}|${crop ? [crop.left, crop.top, crop.width, crop.height].join(",") : ""}`;
    const asked = generation;
    let found = pictures.get(key);
    if (!found) {
      found = (async () => {
        if (picture.kind === "epub") {
          return epubPicture(bookId, picture.path);
        }
        const source = await pdfOf(bookId);
        if (!source.pdf || picture.page > source.pageCount) {
          throw new Error("That page is not in the book.");
        }
        return pdfPagePicture(source.pdf, picture.page, crop);
      })();
      // A failure is not kept: the next card of the picture tries again.
      found.catch(() => pictures.delete(key));
      pictures.set(key, found);
    }
    return found.then((loaded) => {
      if (asked !== generation) {
        throw new Error("Closed.");
      }
      return loaded;
    });
  };

  const close = () => {
    generation += 1;
    pictures.forEach((loading) => void loading.then((loaded) => URL.revokeObjectURL(loaded.url), () => undefined));
    pictures.clear();
    pdfs.forEach((loading) => void loading.then((source) => source.destroy(), () => undefined));
    pdfs.clear();
  };

  return { load, close };
};

export type PictureLoader = ReturnType<typeof pictureLoader>;
