import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Book } from "@shared/models/book";
import { ensureBookPermissions, pickBookFiles } from "../platform";

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
  async readBookBytes(bookId: string): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<string | null>("read_book_bytes", { bookId });
  },
  async updateProgress(bookId: string, progress: number): Promise<void> {
    if (!isTauri()) {
      return;
    }
    return invoke("update_progress", {
      bookId,
      progress,
      lastOpened: new Date().toISOString()
    });
  },
  async clearAllData(): Promise<void> {
    requireDesktop();
    await invoke("clear_all_data");
  }
};
