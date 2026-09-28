import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import { ensureBookPermissions, pickBookFiles } from "../platform";
import type { BookFormat } from "../constants/bookFormats";

const requireDesktop = () => {
  if (!isTauri()) {
    throw new Error("This action requires the desktop app. Run `tauri dev` to enable it.");
  }
};

export const bookService = {
  async list(): Promise<Book[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<Book[]>("list_books");
  },
  async importFromDialog(): Promise<Book[]> {
    requireDesktop();
    const ok = await ensureBookPermissions();
    if (!ok) {
      throw new Error("Storage permission denied");
    }

    const paths = await pickBookFiles();
    if (!paths || paths.length === 0) {
      return [];
    }

    return invoke<Book[]>("import_books", { paths });
  },
  async importPaths(paths: string[]): Promise<Book[]> {
    requireDesktop();
    if (paths.length === 0) {
      return [];
    }
    const ok = await ensureBookPermissions();
    if (!ok) {
      throw new Error("Storage permission denied");
    }
    return invoke<Book[]>("import_books", { paths });
  },
  async refreshMetadata(bookId: string): Promise<Book> {
    requireDesktop();
    return invoke<Book>("refresh_metadata", { bookId });
  },
  async fetchCover(bookId: string): Promise<Book | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<Book | null>("fetch_cover", { bookId });
  },
  async coverData(bookId: string): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<string | null>("cover_data", { bookId });
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
