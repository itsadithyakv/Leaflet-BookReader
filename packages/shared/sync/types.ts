export type DriveSyncStatus = "idle" | "syncing" | "success" | "error";

/**
 * Where the Google OAuth client came from.
 *
 * `built-in` ships with the app, `custom` was entered by the reader, and `none`
 * means Drive cannot be used until one is supplied.
 */
export type CredentialSource = "built-in" | "custom" | "none";

/**
 * How sync is set up on this device, as the backend sees it.
 *
 * The old panel could only say "connected" or not, which left it unable to
 * express the states that actually mattered: no OAuth client — where the Drive
 * button could never work — and folder sync, which needs no account at all.
 */
export type SyncStatus = {
  /** Drive is connected and holds a usable refresh token. */
  driveConnected: boolean;
  /** Leaflet has a Google OAuth client, from any source. */
  driveAvailable: boolean;
  driveCredentialSource: CredentialSource;
  expiresAt: string | null;
  /** The real Google account, rather than a placeholder. */
  accountEmail: string | null;
  /** The chosen sync folder, when folder sync is in use. */
  folderPath: string | null;
  /** The Leaflet API, when cloud sync and the social features are in use. */
  apiBase: string | null;
  /** The address was entered on this device, rather than being Leaflet's own. */
  apiBaseCustom: boolean;
  lastSyncedAt: string | null;
  /** Books in the library whose file is not on this device yet. */
  booksPending: number;
  /** The reader chose to back up to their Leaflet account by itself, and is signed in. */
  accountBackup?: boolean;
};

/** What one sync run did. */
export type SyncReport = {
  booksUploaded: number;
  booksDownloaded: number;
  booksRemoved: number;
  booksPending: number;
  entriesUpdated: number;
};

export const EMPTY_SYNC_STATUS: SyncStatus = {
  driveConnected: false,
  driveAvailable: false,
  driveCredentialSource: "none",
  expiresAt: null,
  accountEmail: null,
  folderPath: null,
  apiBase: null,
  apiBaseCustom: false,
  lastSyncedAt: null,
  booksPending: 0,
  accountBackup: false
};

/** One book on a shared shelf. The spine's look derives from the seed. */
export type ShelfBook = {
  title: string;
  author: string | null;
  styleSeed: string;
};

/**
 * A reader's public face.
 *
 * `private` is the default and means exactly that: the profile appears on no
 * board and is readable by nobody. Reading history says a lot about a person,
 * so publishing it is a decision rather than a default.
 */
export type SocialProfile = {
  handle: string | null;
  displayName: string | null;
  visibility: "private" | "public";
  weekMinutes: number;
  streak: number;
  booksFinished: number;
  shelf: ShelfBook[];
  /** Position on this week's board, when the entry came from one. */
  rank?: number | null;
};

export const EMPTY_PROFILE: SocialProfile = {
  handle: null,
  displayName: null,
  visibility: "private",
  weekMinutes: 0,
  streak: 0,
  booksFinished: 0,
  shelf: []
};
