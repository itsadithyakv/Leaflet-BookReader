import { invoke, isTauri } from "@tauri-apps/api/core";

/** A copy that did not happen, kept until a later run puts it right. */
export type LibraryCopyProblem = { at: string; message: string };

export type LibraryCopyStatus = {
  enabled: boolean;
  /** The folder the reader chose. Remembered while the feature is off. */
  folder: string | null;
  /** False for an unplugged drive, or a folder moved or deleted since. */
  folderFound: boolean;
  problem: LibraryCopyProblem | null;
};

/** What "Copy my existing library there now" did. */
export type LibraryCopyReport = {
  copied: number;
  alreadyThere: number;
  /** In the library, but not downloaded to this computer yet. */
  notDownloaded: number;
  failed: number;
  /** The first few failures, by title, with why. */
  failures: Array<{ title: string; reason: string }>;
  status: LibraryCopyStatus;
};

const OFF: LibraryCopyStatus = { enabled: false, folder: null, folderFound: false, problem: null };

const needsDesktop = () => new Error("Keeping copies in a folder needs the desktop app.");

/**
 * "Keep a copy of my books in a folder": each book added to the library is
 * also saved, as `Title - Author.ext`, in a folder the reader chose.
 *
 * The folder is a fact about this computer. Rust keeps it with the other
 * device settings; it is never part of the backup or the synced document.
 */
export const libraryCopyService = {
  /** False in the browser preview, where there is no filesystem to copy to. */
  available: () => isTauri(),

  async status(): Promise<LibraryCopyStatus> {
    if (!isTauri()) {
      return OFF;
    }
    return invoke<LibraryCopyStatus>("library_copy_status");
  },

  /** Turns it on or off; pass `folder` to choose or change where copies go. */
  async set(enabled: boolean, folder?: string): Promise<LibraryCopyStatus> {
    if (!isTauri()) {
      throw needsDesktop();
    }
    return invoke<LibraryCopyStatus>("library_copy_set", { enabled, folder: folder ?? null });
  },

  /** Copies every book already in the library that is not in the folder yet. */
  async copyLibrary(): Promise<LibraryCopyReport> {
    if (!isTauri()) {
      throw needsDesktop();
    }
    return invoke<LibraryCopyReport>("library_copy_run");
  }
};
