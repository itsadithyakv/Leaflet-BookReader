import { invoke, isTauri } from "@tauri-apps/api/core";
import { EMPTY_PROFILE, type ArcadeBests, type ProfileVisibility, type ReadingNow, type SocialProfile, type SyncStatus } from "@shared/sync/types";

/**
 * Publishing is cheap but not free: it was the server's largest writer at
 * once a minute for everybody reading, and the board it feeds counts a
 * week. Every five minutes is plenty. A finished session, and arriving at
 * the board, publish at once whatever this says (`force`).
 */
const PUBLISH_EVERY_MS = 5 * 60_000;
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
  /** The book they have open, and the level their seeds have reached. Absent from older servers. */
  reading?: ReadingNow | null;
  level?: number | null;
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
  /** Seeds each side put on it; 0 or absent for none. The two apps settle it (pip/stakes.ts). */
  stake?: number;
};

/**
 * A profile kept to followers, seen by a reader it has not accepted: who
 * they are, and whether this reader has asked.
 */
export type LockedProfile = CommunityPerson & {
  visibility: "followers";
  locked: true;
  requested: boolean;
  isYou?: boolean;
  isFollowing?: boolean;
};

/**
 * Pip's camp in the Hollow, as its reader shows it: building levels and
 * counts, and how it is laid out. The layout is where each building stands
 * (`spots`), each piece of fence (`walls`, 32 at most) and each thing set
 * down (`decor`, 24 at most), in the scene's own pixels. With them come the
 * landscape set about the camp (`land`, 30 at most, kinds 0 to 9), its
 * defences (`works`, 12 at most, kinds 0 to 11) and the rank of the guardian
 * at each of seven posts (`guards`, 0 for none, 3 at most), and where each
 * guardian's signpost was carried to (`posts`, always seven, in the
 * guardians' order: `[x, y]`, or `null` for one not moved, for the dragon
 * and for a guardian not posted). Each part of it is absent from a camp
 * shared by an older app, or kept by an older server, `guards` also from a
 * camp with no guardian posted, and `posts` from one with no signpost moved.
 */
export type CampSummary = {
  levels: Record<"burrow" | "oak" | "store" | "fence" | "tower" | "hut", number>;
  yard: Array<{ kind: "workshop" | "hive" | "well" | "stall" | null; level: number }>;
  camps: number;
  banners: number;
  trophies: number;
  spots?: Partial<Record<"burrow" | "oak" | "store" | "tower" | "hut" | "yard0" | "yard1", [number, number]>>;
  walls?: Array<[number, number]>;
  decor?: Array<{ kind: number; x: number; y: number }>;
  land?: Array<{ kind: number; x: number; y: number }>;
  works?: Array<{ kind: number; x: number; y: number }>;
  guards?: number[];
  posts?: Array<[number, number] | null>;
};

/** A reader whose camp can be raided: you follow each other, they share a camp, and they have not switched raids off. */
export type RaidTarget = { handle: string; name: string; camp: CampSummary; raidedToday: boolean };
/** A raid a friend made on this reader's camp, not yet seen here. */
export type CampRaid = { id: string; by: string; name: string; stars: number; at: string };

export type ReaderProfile = CommunityPerson & {
  visibility: "public" | "followers";
  locked?: false;
  /** Whether a request to follow is waiting (never, on a profile already read). */
  requested?: boolean;
  sharesLibrary?: boolean;
  reading?: ReadingNow | null;
  level?: number | null;
  badges?: string[];
  arcade?: ArcadeBests | null;
  camp?: CampSummary | null;
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

export type InboxEventType =
  | "follow"
  | "kudos"
  | "duel_invite"
  | "duel_accepted"
  | "duel_result"
  /** Someone asked to follow a profile kept to followers, or such a request was accepted. */
  | "follow_request"
  | "follow_accept"
  /** A friend bought something for Pip. */
  | "gift";

export type InboxEvent = {
  id: string;
  type: InboxEventType;
  createdAt: string;
  actor: CommunityPerson;
  duel?: Duel;
  /** On a `follow_request`: whether it still waits for an answer. */
  pending?: boolean;
  /** On `kudos` sent for one of the reader's posts: what it was. Absent for kudos sent from a profile. */
  about?: KudosAbout;
};

/** What kudos were for: a post of the reader's, by its kind and the book's title. */
export type KudosAbout = { kind: "finished" | "review" | "quote"; title: string };

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
    visibility?: ProfileVisibility;
    /** Whether the readers who follow this one may see its whole library. */
    shareLibrary?: boolean;
  }): Promise<SocialProfile> {
    if (!isTauri()) {
      return EMPTY_PROFILE;
    }
    return call<SocialProfile>("save_social_profile", {
      handle: update.handle ?? null,
      displayName: update.displayName ?? null,
      visibility: update.visibility ?? null,
      shareLibrary: update.shareLibrary ?? null
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
    publishing = call<boolean>("publish_social_stats", { force: options.force === true })
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

  /**
   * A reader's card. 404s (rejects) for private or unknown handles. A profile
   * kept to followers answers with little more than a name until it has
   * accepted this reader (`LockedProfile`).
   */
  async reader(handle: string): Promise<ReaderProfile | LockedProfile> {
    if (!isTauri()) {
      throw new Error("No shared profile with that handle.");
    }
    return call<ReaderProfile | LockedProfile>("community_profile", { handle });
  },

  /** Follows, or asks to (`requested`) where the profile is kept to followers; `follow` false unfollows or takes the request back. */
  async setFollowing(handle: string, follow: boolean): Promise<{ following: boolean; requested?: boolean }> {
    if (!isTauri()) {
      return { following: false };
    }
    return call("community_follow", { handle, follow });
  },

  /** Kudos; once per reader per local day. For one of their posts when `postId` is given: the inbox then says which. */
  async sendKudos(handle: string, postId?: string): Promise<{ sent: boolean; kudosThisWeek: number }> {
    if (!isTauri()) {
      return { sent: false, kudosThisWeek: 0 };
    }
    return call("community_kudos", postId ? { handle, postId } : { handle });
  },

  /** `stake`: seeds each side puts on it, 0 for a duel for its own sake. */
  async challenge(handle: string, stake = 0): Promise<Duel> {
    if (!isTauri()) {
      throw new Error("Duels need the desktop app.");
    }
    return call<Duel>("community_challenge", { handle, stake });
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
  },

  // ---- raids ----------------------------------------------------------------
  //
  // A raid is played here, against the camp a friend's profile shows; the
  // server only keeps that it happened (who, whom, the stars, when) and hands
  // it to the friend. The two lists are empty for a reader who is signed out,
  // and from a server that has no raids yet.

  /** The friends whose camp could be raided, by handle, at most 50. */
  async raidTargets(): Promise<RaidTarget[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ targets: RaidTarget[] }>("community_raid_targets")).targets;
  },

  /**
   * Tells the server a friend's camp was raided and how many stars it won
   * (0 to 3). Once a day (UTC) for each friend; rejects with the server's
   * reason when it is refused.
   */
  async reportRaid(handle: string, stars: number): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call("community_raid", { handle, stars: Math.round(stars) });
  },

  /** The raids on this reader's camp that have not been acknowledged, oldest first, at most 20. */
  async raidsOnMe(): Promise<CampRaid[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ raids: CampRaid[] }>("community_raids")).raids;
  },

  /** Marks raids as seen, so they are not handed over again. Ids that are not this reader's are passed over. */
  async ackRaids(ids: string[]): Promise<void> {
    if (!isTauri() || ids.length === 0) {
      return;
    }
    await call("community_raids_ack", { ids });
  },

  /** Whether friends may raid this reader's camp. On until it is switched off. */
  async raidable(): Promise<boolean> {
    if (!isTauri()) {
      return true;
    }
    return call<boolean>("community_raidable");
  },

  /** Switches raids on this reader's camp on or off; rejects when it could not be saved. */
  async setRaidable(on: boolean): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call("community_set_raidable", { on });
  }
};
