import { invoke, isTauri } from "@tauri-apps/api/core";
import { android } from "../platform/android";
import { EMPTY_SYNC_STATUS, type LargeBook, type SyncReport, type SyncStatus } from "@shared/sync/types";

const EMPTY_REPORT: SyncReport = {
  booksUploaded: 0,
  booksDownloaded: 0,
  booksRemoved: 0,
  booksPending: 0,
  entriesUpdated: 0,
  booksHeld: 0,
  updateNeeded: false,
  ownerPaused: false,
  accountHolds: null
};

/** Smaller copies of book files for Drive: on or off on this device, and the bytes saved so far. */
export type SmallerBackups = { on: boolean; savedBytes: number };

/** A place in a book: how far, and exactly where (an EPUB CFI; null for page-based books). */
export type Place = { progress: number; position: string | null };

/**
 * Sync has two transports and one set of rules.
 *
 * A folder the user's own cloud client already keeps in step needs no account,
 * no API and no Google verification; Drive is there for devices with no such
 * client. Both merge identically, so the UI does not need to care which is on.
 *
 * Signed in, the reading itself lives with the Leaflet account, always; Drive
 * and the folder then carry the book files (and, for the same account, a copy
 * of the reading too).
 */
export const syncService = {
  async status(): Promise<SyncStatus> {
    if (!isTauri()) {
      return EMPTY_SYNC_STATUS;
    }
    return invoke<SyncStatus>("sync_status");
  },

  /**
   * Opens Google's consent page in the *system* browser.
   *
   * The backend opens it, not `window.open`: Google refuses to run its sign-in
   * inside an embedded webview, which is where a webview's `window.open` lands.
   */
  async startDriveAuth(): Promise<void> {
    if (!isTauri()) {
      throw new Error("Drive sync needs the Leaflet app.");
    }
    // On a phone the browser comes back to Leaflet itself, which Android
    // would otherwise pause while the browser is in front.
    await android.holdForSignIn(true);
    try {
      await invoke<string>("drive_auth_start");
    } catch (error) {
      await android.holdForSignIn(false);
      throw error;
    }
  },

  /** Resolves when the browser comes back, or rejects saying why it did not. */
  async waitForDriveAuth(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke("drive_auth_wait");
    } finally {
      await android.holdForSignIn(false);
    }
  },

  /**
   * Sets the Google OAuth client Leaflet presents.
   *
   * Anyone can create a free "Desktop app" client; without this, Drive sync
   * only worked in a build that happened to ship credentials.
   */
  async setDriveCredentials(clientId: string, clientSecret: string): Promise<SyncStatus> {
    if (!isTauri()) {
      return EMPTY_SYNC_STATUS;
    }
    return invoke<SyncStatus>("set_drive_credentials", { clientId, clientSecret });
  },

  async clearDriveCredentials(): Promise<SyncStatus> {
    if (!isTauri()) {
      return EMPTY_SYNC_STATUS;
    }
    return invoke<SyncStatus>("clear_drive_credentials");
  },

  async disconnectDrive(): Promise<SyncStatus> {
    if (!isTauri()) {
      return EMPTY_SYNC_STATUS;
    }
    return invoke<SyncStatus>("drive_disconnect");
  },

  /** Passing null clears the folder and stops that transport. */
  async setFolder(path: string | null): Promise<SyncStatus> {
    if (!isTauri()) {
      return EMPTY_SYNC_STATUS;
    }
    return invoke<SyncStatus>("set_sync_folder", { path });
  },

  /** `manual`: the reader asked, so Drive is tried even while Google's refusal is being waited out. */
  async syncNow(manual = false): Promise<SyncReport> {
    if (!isTauri()) {
      return EMPTY_REPORT;
    }
    return invoke<SyncReport>("sync_now", { manual });
  },

  /** The library's books over 10 MB on this device, largest first, each with the reader's answer. */
  async largeBooks(): Promise<LargeBook[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<LargeBook[]>("large_books");
  },

  /** Records whether these large books' files are backed up; the next backup acts on it. */
  async setLargeBookBackup(bookIds: string[], backUp: boolean): Promise<void> {
    if (!isTauri() || bookIds.length === 0) {
      return;
    }
    await invoke("set_large_book_backup", { bookIds, backUp });
  },

  /** This device's "Smaller backups" switch for Drive (on unless turned off), and what it has saved. */
  async smallerBackups(): Promise<SmallerBackups> {
    if (!isTauri()) {
      return { on: true, savedBytes: 0 };
    }
    return invoke<SmallerBackups>("smaller_backups");
  },

  /** Turns smaller Drive copies on or off for files backed up from now on; Drive's files stay as they are. */
  async setSmallerBackups(on: boolean): Promise<SmallerBackups> {
    if (!isTauri()) {
      return { on, savedBytes: 0 };
    }
    return invoke<SmallerBackups>("set_smaller_backups", { on });
  },

  /**
   * Fetches a book this device has an entry for but no file.
   *
   * Book files are not pulled during sync — the shared document is kilobytes
   * while a library is gigabytes — so a new device is usable immediately and
   * the bytes arrive when a book is opened.
   */
  async downloadBook(bookId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error("Downloading needs the Leaflet app.");
    }
    return invoke<string>("download_book", { bookId });
  },

  /**
   * Where this device itself last stood in a book, apart from the place a
   * sync may have brought; null if it was never read here.
   */
  async placeHere(bookId: string): Promise<(Place & { at?: string | null }) | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<(Place & { at?: string | null }) | null>("place_here", { bookId });
  },

  /** Removes a book everywhere; the tombstone carries the removal to devices. */
  async deleteBook(bookId: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("delete_book", { bookId });
  }
};
