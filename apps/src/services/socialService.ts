import { invoke, isTauri } from "@tauri-apps/api/core";
import { EMPTY_PROFILE, type SocialProfile, type SyncStatus } from "@shared/sync/types";

/** Publishing is cheap but not free; once a minute is plenty for a weekly board. */
const PUBLISH_EVERY_MS = 60_000;
let lastPublish = 0;
let publishing: Promise<boolean> | null = null;
/** Why the last publish failed, or null when it went through (or had nothing to send). */
let publishError: string | null = null;
/** Counts `forgetPublish` calls, so a publish that outlives a sign-out reports to nobody. */
let publishEpoch = 0;
/** Told whenever a call to the server fails. See `onCallFailed`. */
let callFailed: (() => void) | null = null;

// ---- community types --------------------------------------------------------
//
// The server's JSON, passed through Rust unchanged (see `community_*` commands).

/** Who someone is, as far as a stranger may know. */
export type CommunityPerson = {
  handle: string;
  displayName: string | null;
  /** Picks the reader's Pip skin, deterministically, when they have no avatar. Currently the handle. */
  pipSeed: string;
  /** The avatar they picked (`skin.move`), or null. Absent from older servers. */
  avatar?: string | null;
};

export type BoardScope = "everyone" | "following";

export type BoardEntry = CommunityPerson & {
  rank: number;
  weekMinutes: number;
  streak: number;
  booksFinished: number;
  isYou: boolean;
};

export type CommunityBoard = {
  weekKey: string;
  scope: BoardScope;
  entries: BoardEntry[];
  /**
   * The reader's own row when signed in and public, even outside the top 100.
   * Null for a private reader: their own row is drawn from this device's
   * minutes instead (see `community/ownRow.ts`).
   */
  you: BoardEntry | null;
  /**
   * How many readers share a profile at all, read this week or not (Everyone
   * only). Lets an empty board say why it is empty. Absent from older servers.
   */
  sharedReaders?: number | null;
};

export type DuelSide = CommunityPerson & { minutes: number };

export type Duel = {
  id: string;
  weekKey: string;
  status: "pending" | "accepted" | "declined" | "finished";
  youChallenged: boolean;
  /** The week is over everywhere; results are final once settled. */
  weekOver: boolean;
  you: {
    handle: string | null;
    displayName: string | null;
    pipSeed: string | null;
    avatar?: string | null;
    minutes: number;
  };
  them: DuelSide | null;
  result: "won" | "lost" | "tie" | null;
};

export type ReaderProfile = CommunityPerson & {
  visibility: "public";
  weekKey: string;
  weekMinutes: number;
  streak: number;
  booksFinished: number;
  shelf: SocialProfile["shelf"];
  kudosThisWeek: number;
  followerCount: number;
  followingCount: number;
  // Only when signed in:
  isYou?: boolean;
  isFollowing?: boolean;
  followsYou?: boolean;
  kudosSentToday?: boolean;
  activeDuel?: { id: string; status: "pending" | "accepted" | "declined"; youChallenged: boolean } | null;
};

export type InboxEventType = "follow" | "kudos" | "duel_invite" | "duel_accepted" | "duel_result";

export type InboxEvent = {
  id: string;
  type: InboxEventType;
  createdAt: string;
  actor: CommunityPerson;
  duel?: Duel;
};

export type SearchResult = CommunityPerson & { weekMinutes: number; streak: number };

const EMPTY_COMMUNITY_BOARD = (scope: BoardScope): CommunityBoard => ({
  weekKey: "",
  scope,
  entries: [],
  you: null
});

/** Rejections from Rust arrive as plain strings; give the UI an Error. */
const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    callFailed?.();
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
};

/**
 * The social half: profiles, the weekly board, and shared shelves.
 *
 * All of it runs through Leaflet's own API, which is the only part of the app
 * with a server behind it. A profile publishes nothing unless it is public:
 * one created at sign-up is, unless the reader switched that off on the form,
 * and any profile can be made private again.
 *
 * Profile calls need a signed-in Leaflet account (see accountService); Rust
 * attaches the session from the OS keychain and rejects with "Sign in to your
 * Leaflet account first." otherwise. The board and shared profiles are public.
 * No Google or Drive token is ever sent to this server.
 */
export const socialService = {
  /** Points the app at a Leaflet server. An empty string turns it all off. */
  async setApiBase(url: string): Promise<SyncStatus | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<SyncStatus>("set_cloud_api", { url });
  },

  /**
   * Asks the server whether it is there. Resolves when it answers; rejects
   * with the reason when it cannot be reached.
   */
  async checkServer(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call<void>("cloud_reachable");
  },

  async profile(): Promise<SocialProfile> {
    if (!isTauri()) {
      return EMPTY_PROFILE;
    }
    return call<SocialProfile>("social_profile");
  },

  /**
   * Saves the parts a reader controls. Switching to public also publishes the
   * ranked figures, so the board is not a week behind the switch.
   *
   * A field left out (or null) is left as it is; an empty name removes it.
   */
  async saveProfile(update: {
    handle?: string | null;
    displayName?: string | null;
    visibility?: "private" | "public";
  }): Promise<SocialProfile> {
    if (!isTauri()) {
      return EMPTY_PROFILE;
    }
    return call<SocialProfile>("save_social_profile", {
      handle: update.handle ?? null,
      displayName: update.displayName ?? null,
      visibility: update.visibility ?? null
    });
  },

  /**
   * Publishes this week's minutes, streak and shelf, when the profile is
   * public. Called when a session ends, when the Social page opens and on the
   * community pulse, at most once a minute unless `force`d. Never throws: a
   * board a minute stale is not worth an error. But a failure is kept (see
   * `publishProblem`), because a reader whose minutes are being refused is
   * otherwise just missing from the board with nothing to say why.
   */
  async publishStats(options: { force?: boolean } = {}): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }
    if (publishing) {
      return publishing;
    }
    // A clock that was set back makes the last publish look like the future.
    // Without the first test nothing was sent until the clock caught up.
    const sinceLast = Date.now() - lastPublish;
    if (!options.force && sinceLast >= 0 && sinceLast < PUBLISH_EVERY_MS) {
      return false;
    }
    lastPublish = Date.now();
    const epoch = publishEpoch;
    publishing = call<boolean>("publish_social_stats")
      .then((published) => {
        if (epoch === publishEpoch) {
          publishError = null;
        }
        return published;
      })
      .catch((cause) => {
        if (epoch === publishEpoch) {
          publishError = cause instanceof Error ? cause.message : String(cause);
        }
        return false;
      })
      .finally(() => {
        publishing = null;
      });
    return publishing;
  },

  /** Why the last publish failed (offline, signed out, refused), or null. */
  publishProblem(): string | null {
    return publishError;
  },

  /**
   * Signed out: the last publish, and why it failed, were that reader's. Kept,
   * the next reader to sign in here waited out the last one's minute and was
   * shown the last one's error.
   */
  forgetPublish() {
    publishEpoch += 1;
    lastPublish = 0;
    publishError = null;
  },

  /**
   * Names who to tell when a call to the server fails. A session that ended
   * on the server (a password changed elsewhere, the account deleted) is only
   * found out by a call failing, and Rust forgets it there and then; this is
   * how the page hears, instead of going on as if still signed in.
   */
  onCallFailed(listener: (() => void) | null) {
    callFailed = listener;
  },

  // ---- community ------------------------------------------------------------

  /** This week's board. `everyone` is public; `following` needs an account. */
  async board(scope: BoardScope): Promise<CommunityBoard> {
    if (!isTauri()) {
      return EMPTY_COMMUNITY_BOARD(scope);
    }
    return call<CommunityBoard>("community_leaderboard", { scope });
  },

  /** A reader's card. 404s (rejects) for private or unknown handles. */
  async reader(handle: string): Promise<ReaderProfile> {
    if (!isTauri()) {
      throw new Error("No shared profile with that handle.");
    }
    return call<ReaderProfile>("community_profile", { handle });
  },

  async setFollowing(handle: string, follow: boolean): Promise<{ following: boolean }> {
    if (!isTauri()) {
      return { following: false };
    }
    return call("community_follow", { handle, follow });
  },

  /** Kudos; once per reader per local day. */
  async sendKudos(handle: string): Promise<{ sent: boolean; kudosThisWeek: number }> {
    if (!isTauri()) {
      return { sent: false, kudosThisWeek: 0 };
    }
    return call("community_kudos", { handle });
  },

  async challenge(handle: string): Promise<Duel> {
    if (!isTauri()) {
      throw new Error("Duels need the desktop app.");
    }
    return call<Duel>("community_challenge", { handle });
  },

  async respondToDuel(id: string, accept: boolean): Promise<Partial<Duel> & { id: string; status: Duel["status"] }> {
    if (!isTauri()) {
      throw new Error("Duels need the desktop app.");
    }
    return call("community_respond_duel", { id, accept });
  },

  async duels(): Promise<Duel[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ duels: Duel[] }>("community_duels")).duels;
  },

  /** Events after `since` (ISO), newest first, at most 50. */
  async inbox(since?: string | null): Promise<{ events: InboxEvent[]; now: string }> {
    if (!isTauri()) {
      return { events: [], now: new Date().toISOString() };
    }
    return call("community_inbox", { since: since ?? null });
  },

  /** Public readers whose handle starts with `query`. */
  async search(query: string): Promise<SearchResult[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ results: SearchResult[] }>("community_search", { query })).results;
  },

  /**
   * The readers this one follows who read today, for a friend's Pip to come
   * by (see `pip/visitors.ts`): the server's answer as it came, or null when
   * there is nothing to ask (the browser preview) or the server has no such
   * route yet (one deployed before visitors), which is not an error.
   */
  async visitors(): Promise<unknown | null> {
    if (!isTauri()) {
      return null;
    }
    return call<unknown | null>("community_visitors");
  }
};
