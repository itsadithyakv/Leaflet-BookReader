import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import { ensureBookPermissions, pickBookFiles } from "../platform";
import type { BookFormat } from "../constants/bookFormats";

const requireDesktop = () => {
  if (!isTauri()) {
    throw new Error("This action requires the desktop app. Run `tauri dev` to enable it.");
  }
};

export type EpubSection = { href: string; bytes: number; linear: boolean };

/**
 * What became of the files handed to an import: how many there were, the
 * books that came back for them (one a file, so one book can be there twice)
 * and the files that were not added, each with why in the backend's words
 * (`import_books_report`).
 */
export type ImportOutcome = { asked: number; books: Book[]; failed: Array<{ name: string; reason: string }> };

export const bookService = {
  async list(): Promise<Book[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<Book[]>("list_books");
  },
  /** Through the file dialog. `null` when it was closed with nothing chosen. */
  async importFromDialog(): Promise<ImportOutcome | null> {
    requireDesktop();
    const ok = await ensureBookPermissions();
    if (!ok) {
      throw new Error("Storage permission denied");
    }

    const paths = await pickBookFiles();
    if (!paths || paths.length === 0) {
      return null;
    }

    const report = await invoke<Omit<ImportOutcome, "asked">>("import_books_report", { paths });
    return { asked: paths.length, ...report };
  },
  async importPaths(paths: string[]): Promise<ImportOutcome> {
    requireDesktop();
    if (paths.length === 0) {
      return { asked: 0, books: [], failed: [] };
    }
    const ok = await ensureBookPermissions();
    if (!ok) {
      throw new Error("Storage permission denied");
    }
    const report = await invoke<Omit<ImportOutcome, "asked">>("import_books_report", { paths });
    return { asked: paths.length, ...report };
  },
  /**
   * A PDF's first page, drawn by the page reader (a JPEG `data:` URL), as the
   * cover of a book that has none. The book with its cover, or `null` when
   * nothing changed: it already has one, or it is not a PDF. The backend
   * checks the picture is one and never replaces a cover.
   */
  async savePageCover(bookId: string, image: string): Promise<Book | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<Book | null>("save_page_cover", { bookId, image });
  },
  /**
   * The reader's word on a book's series: a name and number, `""` for "not in
   * a series", or `null` to let the library work it out again.
   */
  async setSeries(bookId: string, series: string | null, seriesIndex: number | null): Promise<Book | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<Book>("book_set_series", { bookId, series, seriesIndex });
  },
  /**
   * "Mark as finished" and "Mark as not started". The book as it now is, or
   * null in the preview, which has no database.
   */
  async setFinished(bookId: string, finished: boolean): Promise<Book | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<Book>("set_book_finished", { bookId, finished });
  },
  /** Reads the series inside the books already in the library, once ever. How many gained one. */
  async scanSeries(): Promise<number> {
    if (!isTauri()) {
      return 0;
    }
    return invoke<number>("scan_series");
  },
  async refreshMetadata(bookId: string): Promise<Book> {
    requireDesktop();
    return invoke<Book>("refresh_metadata", { bookId });
  },
  /**
   * An EPUB's sections in reading order with their sizes (from the archive's
   * directory, nothing decompressed), for progress by how much has been read.
   */
  async epubSections(bookId: string): Promise<EpubSection[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<EpubSection[]>("epub_sections", { bookId });
  },
  async fetchCover(bookId: string): Promise<Book | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<Book | null>("fetch_cover", { bookId });
  },
  /** The cover as a data URL; `thumb` asks for the library's small version. */
  async coverData(bookId: string, options: { thumb?: boolean } = {}): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<string | null>("cover_data", { bookId, thumb: options.thumb ?? false });
  },
  /**
   * The book's file, as raw bytes. The backend returns a raw IPC body, which
   * Tauri delivers as an ArrayBuffer: no base64 string, no byte-by-byte copy,
   * so large PDFs no longer need several times their size in memory to open.
   */
  async readBookBytes(bookId: string): Promise<ArrayBuffer> {
    requireDesktop();
    return invoke<ArrayBuffer>("read_book_bytes", { bookId });
  },
  async takePendingOpenPaths(): Promise<string[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<string[]>("take_pending_open_paths");
  },
  /**
   * `position` is the EPUB CFI for the same place, stored and synced as a pair
   * with `progress`. Omit it (or pass null) for page-based books; a caller that
   * reports an unchanged percentage without one leaves the stored CFI alone.
   */
  async updateProgress(bookId: string, progress: number, position?: string | null): Promise<void> {
    if (!isTauri()) {
      return;
    }
    return invoke("update_progress", {
      bookId,
      progress,
      lastOpened: new Date().toISOString(),
      position: position ?? null
    });
  },
  /** The backend's canonical format table; empty outside the desktop app. */
  async supportedFormats(): Promise<BookFormat[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<BookFormat[]>("supported_formats");
  },
  /**
   * True only when the book cannot be opened without installing the converter.
   * A previously converted book stays readable, so this is false for it even
   * when the converter has since been removed.
   */
  async needsConverter(bookId: string): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }
    return invoke<boolean>("needs_converter", { bookId });
  },
  async clearAllData(): Promise<void> {
    requireDesktop();
    await invoke("clear_all_data");
  }
};
