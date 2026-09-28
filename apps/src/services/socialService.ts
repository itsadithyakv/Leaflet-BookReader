import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  EMPTY_PROFILE,
  type Leaderboard,
  type SocialProfile,
  type SyncStatus
} from "@shared/sync/types";

const EMPTY_BOARD: Leaderboard = { weekKey: "", entries: [] };

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
  /** The reader's own row when signed in and public, even outside the top 100. */
  you: BoardEntry | null;
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
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
};

/**
 * The social half: profiles, the weekly board, and shared shelves.
 *
 * All of it runs through Leaflet's own API, which is the only part of the app
 * with a server behind it. Everything here is opt-in — a profile publishes
 * nothing until its owner makes it public.
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

  async profile(): Promise<SocialProfile> {
    if (!isTauri()) {
      return EMPTY_PROFILE;
    }
    return invoke<SocialProfile>("social_profile");
  },

  /**
   * Saves the parts a reader controls. Switching to public also publishes the
   * ranked figures, so the board is not a week behind the switch.
   */
  async saveProfile(update: {
    handle?: string | null;
    displayName?: string | null;
    visibility?: "private" | "public";
  }): Promise<SocialProfile> {
    if (!isTauri()) {
      return EMPTY_PROFILE;
    }
    return invoke<SocialProfile>("save_social_profile", {
      handle: update.handle ?? null,
      displayName: update.displayName ?? null,
      visibility: update.visibility ?? null
    });
  },

  /** This week's board. Public, so it can be read before joining it. */
  async leaderboard(): Promise<Leaderboard> {
    if (!isTauri()) {
      return EMPTY_BOARD;
    }
    return invoke<Leaderboard>("social_leaderboard");
  },

  async profileByHandle(handle: string): Promise<SocialProfile> {
    if (!isTauri()) {
      return EMPTY_PROFILE;
    }
    return invoke<SocialProfile>("social_profile_by_handle", { handle });
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

  async following(): Promise<{ following: CommunityPerson[]; followerCount: number }> {
    if (!isTauri()) {
      return { following: [], followerCount: 0 };
    }
    return call("community_following");
  },

  /** A leaf of kudos; once per reader per local day. */
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
  }
};
