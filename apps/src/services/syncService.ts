import { invoke, isTauri } from "@tauri-apps/api/core";
import { EMPTY_SYNC_STATUS, type SyncReport, type SyncStatus } from "@shared/sync/types";

const EMPTY_REPORT: SyncReport = {
  booksUploaded: 0,
  booksDownloaded: 0,
  booksRemoved: 0,
  booksPending: 0,
  entriesUpdated: 0
};

/**
 * Sync has two transports and one set of rules.
 *
 * A folder the user's own cloud client already keeps in step needs no account,
 * no API and no Google verification; Drive is there for devices with no such
 * client. Both merge identically, so the UI does not need to care which is on.
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
      throw new Error("Drive sync needs the desktop app.");
    }
    await invoke<string>("drive_auth_start");
  },

  /** Resolves when the browser comes back, or rejects saying why it did not. */
  async waitForDriveAuth(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("drive_auth_wait");
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

  async syncNow(): Promise<SyncReport> {
    if (!isTauri()) {
      return EMPTY_REPORT;
    }
    return invoke<SyncReport>("sync_now");
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
      throw new Error("Downloading needs the desktop app.");
    }
    return invoke<string>("download_book", { bookId });
  },

  /** Removes a book everywhere; the tombstone carries the removal to devices. */
  async deleteBook(bookId: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await invoke("delete_book", { bookId });
  }
};
