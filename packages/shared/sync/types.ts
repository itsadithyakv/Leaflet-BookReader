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
  /**
   * Account sync is on: signed in, and this library is the account's own (or
   * becoming it). Reading state then lives with the Leaflet account; there is
   * no switch for it. The name is kept from the old opt-in toggle.
   */
  accountBackup?: boolean;
  /** Whose this device's library is, as far as sync cares. Absent from older builds. */
  library?: LibraryOwnerInfo;
  /** Drive holds another account's library: only book files go there. */
  driveFilesOnly?: boolean;
  /** The sync folder holds another account's library: only book files go there. */
  folderFilesOnly?: boolean;
};

/**
 * This library's standing with the Leaflet account signed in.
 *
 * - `unowned`: signed out, and no account has adopted this library yet.
 * - `adopting`: signed in, and the library is becoming this account's.
 * - `mine`: the library belongs to the account signed in.
 * - `signedOut`: the library belongs to an account, and nobody is signed in.
 * - `other`: the library belongs to another account than the one signed in.
 */
export type LibraryStanding = "unowned" | "adopting" | "mine" | "signedOut" | "other";

export type LibraryOwnerInfo = {
  standing: LibraryStanding;
  /** The reader chose to stay out of reading sync for this library. */
  stayOut: boolean;
  /** The account signed in already has a library of its own on this device. */
  elsewhere: boolean;
  /** Signed out, and a sync store holds another account's library. */
  refused: "drive" | "folder" | null;
};

/** What `library_resolve` decided after a sign-in or at launch. */
export type LibraryResolveAction = "stay" | "claimed" | "switch" | "offer";

export type LibraryResolveResult = {
  action: LibraryResolveAction;
};

/** What one sync run did. */
export type SyncReport = {
  booksUploaded: number;
  booksDownloaded: number;
  booksRemoved: number;
  booksPending: number;
  entriesUpdated: number;
  /** Large files not sent because the reader has not been asked about them yet. */
  booksHeld?: number;
  /** A later version of Leaflet wrote the shared library: this device read it and wrote nothing back. */
  updateNeeded?: boolean;
  /** This library belongs to another account: nothing was synced, by design. */
  ownerPaused?: boolean;
  /**
   * A fresh library met an account copy from before: nothing was merged, and
   * the reader is asked about it. The number of books that copy holds.
   */
  accountHolds?: number | null;
};

/** What the reader is told then, in place of a sync error. */
export const SYNC_UPDATE_NEEDED =
  "Your library was last saved by a newer Leaflet. Update Leaflet on this device to keep it in step.";

/**
 * A book whose file is over the size a backup sends without asking (10 MB),
 * and what the reader has said: `true` to back the file up, `false` not to,
 * `null` when not yet asked.
 */
export type LargeBook = {
  id: string;
  title: string;
  bytes: number;
  backUp: boolean | null;
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
  accountBackup: false,
  library: { standing: "unowned", stayOut: false, elsewhere: false, refused: null },
  driveFilesOnly: false,
  folderFilesOnly: false
};

/** One book on a shared shelf. The spine's look derives from the seed. */
export type ShelfBook = {
  title: string;
  author: string | null;
  styleSeed: string;
};

/** Who may see a profile: everyone, only the readers whose follow it accepted, or nobody. */
export type ProfileVisibility = "private" | "followers" | "public";

/** The book a reader has open, as their profile and the board say it. */
export type ReadingNow = { title: string; author: string | null; percent: number };

/** Best scores in Pip's three arcade games. */
export type ArcadeBests = { dash: number; catch: number; flap: number };

/**
 * A reader's public face.
 *
 * `private` is the default and means exactly that: the profile appears on no
 * board and is readable by nobody. Reading history says a lot about a person,
 * so publishing it is a decision rather than a default. `followers` is in
 * between: findable by handle, and read only by the readers whose request to
 * follow it accepted.
 */
export type SocialProfile = {
  handle: string | null;
  displayName: string | null;
  visibility: ProfileVisibility;
  weekMinutes: number;
  streak: number;
  booksFinished: number;
  shelf: ShelfBook[];
  /** Whether the readers who follow this one may see its whole library. Absent from older servers. */
  sharesLibrary?: boolean;
  reading?: ReadingNow | null;
  /** The level seeds ever earned have reached. */
  level?: number | null;
  /** The ids of the badges earned (components/community/badges.ts names them). */
  badges?: string[];
  arcade?: ArcadeBests | null;
  /** Whether the community guidelines were accepted: needed before posting where everyone can read. */
  rulesAccepted?: boolean;
  /** The owner's account: sees reports and can act on them. */
  isAdmin?: boolean;
  /** Until when posting is suspended, if it is. */
  suspendedUntil?: string | null;
  /** Position on this week's board, when the entry came from one. */
  rank?: number | null;
  /** How many different readers sent this one kudos, and how many they sent kudos to, counted up to ten (the two kudos badges). Absent from older servers. */
  kudosFrom?: number;
  kudosTo?: number;
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
