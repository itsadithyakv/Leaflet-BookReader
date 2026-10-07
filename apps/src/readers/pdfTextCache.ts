/**
 * The text of a PDF, read once and kept for the library's search ("Search
 * inside books").
 *
 * The app itself cannot read a PDF's text well; pdf.js, in the page, can. So
 * the page reads it, a page at a time, and hands it over to be kept
 * (src-tauri/src/pdf_text.rs), and the search reads what was kept. It is read
 * in two places: by the reader, on the pass that finds a PDF's chapters, which
 * reads every page's text anyway (`collectPdfText`); and by the search's
 * dialog, for a PDF with no text kept yet (`readPdfText`).
 *
 * What is kept of a page is the text the reader's own search goes through
 * (readers/pdfText.ts `joinTextItems`): its runs joined, a line break for each
 * end of line.
 *
 * Pure: where a page's text comes from is passed in, so this can be tried
 * without a PDF.
 */

/** The most pages kept of one PDF, and the most characters over all of them (as src-tauri/src/pdf_text.rs has them). */
export const MAX_PAGES = 20_000;
export const MAX_CHARS = 10_000_000;

/**
 * The pages as they are handed over: no more than the limits (the app cuts
 * them there anyway; this spares sending what would be dropped), and no half
 * of a character's pair left alone, which the app could not take at all (a
 * PDF with a broken table of characters can give one).
 */
export const fitToKeep = (pages: readonly string[]): string[] => {
  let room = MAX_CHARS;
  return pages.slice(0, MAX_PAGES).map((page) => {
    let kept = page.length > room ? page.slice(0, room) : page;
    kept = kept.replace(/\p{Cs}/gu, "�");
    room -= kept.length;
    return kept;
  });
};

/**
 * Takes a PDF's pages as a pass over them reads each, in any order. `whole`
 * is every page's text, in order, once every page has been put; null while
 * one is missing (the pass was cut short, or a page could not be read), and
 * then nothing is to be kept: text kept is never made again, so it is kept
 * whole or not at all.
 */
export const collectPdfText = (pageCount: number) => {
  const pages = new Map<number, string>();
  return {
    put(page: number, text: string) {
      if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
        pages.set(page, text);
      }
    },
    whole(): string[] | null {
      if (pageCount <= 0 || pages.size < pageCount) {
        return null;
      }
      return Array.from({ length: pageCount }, (_, at) => pages.get(at + 1) ?? "");
    }
  };
};

type ReadOptions = {
  pageCount: number;
  /** A page's text (1-based), read and let go. */
  textOf: (page: number) => Promise<string>;
  /** Asked before every page: false once nobody is waiting (the dialog was shut, the words changed). */
  stillWanted: () => boolean;
  /** Told after each page, for the line of progress. */
  onPage?: (done: number, total: number) => void;
  /** Lets the window draw and take input; resolves when the reading may go on. */
  breathe?: () => Promise<void>;
  /** A clock, for tests. */
  now?: () => number;
};

/** How long the reading may run before it lets the window have a turn. */
const BREATHE_AFTER_MS = 12;

/** How many pages may fail to be read and the rest still be kept: two, or one page in fifty of a long PDF. */
export const mayFail = (pageCount: number) => Math.max(2, Math.floor(pageCount / 50));

/**
 * Reads every page's text, one page at a time. Null when it was called off
 * on the way. A page that cannot be read is a page with nothing on it, as it
 * is to the reader's own search; but when more than a few cannot (the
 * document went away under the reading), this throws, and nothing is kept:
 * the PDF is read again another time rather than kept as empty for good.
 * Stops at the limits on what is kept, however long the PDF goes on.
 */
export const readPdfText = async ({
  pageCount,
  textOf,
  stillWanted,
  onPage,
  breathe = () => new Promise((resolve) => setTimeout(resolve, 0)),
  now = () => performance.now()
}: ReadOptions): Promise<string[] | null> => {
  const pages: string[] = [];
  const total = Math.min(Math.max(0, pageCount), MAX_PAGES);
  let chars = 0;
  let failed = 0;
  let since = now();
  for (let page = 1; page <= total && chars < MAX_CHARS; page += 1) {
    if (!stillWanted()) {
      return null;
    }
    let text = "";
    try {
      text = await textOf(page);
    } catch {
      failed += 1;
      // (Not when the reading was called off: a document let go of fails every page after.)
      if (failed > mayFail(pageCount) && stillWanted()) {
        throw new Error("Too many of the PDF's pages could not be read.");
      }
    }
    pages.push(text);
    chars += text.length;
    onPage?.(page, total);
    if (now() - since >= BREATHE_AFTER_MS) {
      await breathe();
      since = now();
    }
  }
  return stillWanted() ? fitToKeep(pages) : null;
};
