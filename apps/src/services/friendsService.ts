import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CommunityPerson } from "./socialService";

/**
 * The second half of the community: what readers who follow each other share
 * beyond the board. A reader's library, finished-book posts and the feed,
 * books in common, book clubs, follow requests and gifts.
 *
 * As in socialService, the server's JSON is passed through Rust unchanged,
 * with two things added there because only the device knows them: which of a
 * reader's books are in this library too (`inYours`), and which of this
 * library's books the readers followed have (`friendsBooks`). Matching is by
 * a key made in Rust from the title and the author's surname
 * (`commands::friends::book_key`), so every device makes the same one.
 *
 * Everything here needs a signed-in account with a shared profile. In the
 * browser preview there is no server: lists come back empty.
 */

/** A book in a reader's shared library. */
export type LibraryBook = {
  key: string;
  title: string;
  author: string | null;
  state: "reading" | "finished" | "unread";
  percent: number;
  /** Whether this device's library has it too. */
  inYours: boolean;
};

export type ReaderLibrary = { books: LibraryBook[]; updatedAt: string | null };

/**
 * Something a reader said about a book: that they finished it (with a line),
 * a review, or a quote from their highlights. To the readers who follow them
 * unless they chose everyone (`services/discussService.ts`).
 */
export type BookPost = {
  id: string;
  person: CommunityPerson;
  title: string;
  author: string | null;
  /** One to five, or none given. */
  rating: number | null;
  line: string | null;
  createdAt: string;
  isYou: boolean;
  /** Absent from a server of before reviews and quotes: a finished book. */
  kind?: "finished" | "review" | "quote";
  /** A review's words. */
  body?: string | null;
  /** A quote, and what the reader said of it. */
  quote?: string | null;
  note?: string | null;
  /** The writer marked it as giving the book away. */
  spoiler?: boolean;
  audience?: "followers" | "everyone";
  /** What the book is matched by across libraries, reviews and communities. */
  bookKey?: string | null;
  likes?: number;
  dislikes?: number;
  myReaction?: 1 | -1 | 0;
  /** On the writer's own view: hidden from everyone else after reports, until it is looked at. */
  hidden?: boolean;
};

export type Feed = { posts: BookPost[]; more: boolean };

/** A reader you follow who has one of your books open. */
export type FriendReading = CommunityPerson & { state: "reading" | "finished" | "unread"; percent: number };

/** One of this library's books that readers you follow have too. */
export type FriendsBook = {
  bookId: string;
  title: string;
  /** How many of the readers you follow finished it. */
  finished: number;
  /** Those reading it now, furthest along first (at most five). */
  readers: FriendReading[];
};

export type ClubMember = CommunityPerson & { weekMinutes: number; isYou: boolean };

export type Club = {
  id: string;
  name: string;
  /** What a reader types to join. */
  code: string;
  /** Minutes a week each member aims for; 0 for none. */
  goalMinutes: number;
  books: Array<{ title: string; author: string | null }>;
  isOwner: boolean;
  members: ClubMember[];
};

export type FollowRequest = CommunityPerson & { createdAt: string };

/** One badge as Rust reports it (`pip_badges`): earned or not, and how far along in its own unit. */
export type BadgeProgress = { id: string; earned: boolean; value: number; target: number };

/** Something a friend bought for this reader's Pip, not yet unwrapped. */
export type Gift = { id: string; from: CommunityPerson; kind: string; itemId: string; createdAt: string };

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
};

const NEEDS_APP = "This needs the desktop app.";

export const friendsService = {
  /** Readers who asked to follow a profile kept to followers. */
  async followRequests(): Promise<FollowRequest[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ requests: FollowRequest[] }>("community_follow_requests")).requests;
  },

  async answerRequest(handle: string, accept: boolean): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call("community_answer_request", { handle, accept });
  },

  /** A reader's whole library: theirs to share, and only with readers whose follow they have. */
  async library(handle: string): Promise<ReaderLibrary> {
    if (!isTauri()) {
      return { books: [], updatedAt: null };
    }
    return call<ReaderLibrary>("community_reader_library", { handle });
  },

  async postsOf(handle: string): Promise<BookPost[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ posts: BookPost[] }>("community_reader_posts", { handle })).posts;
  },

  /** Finished books from you and the readers you follow, newest first; `before` asks for the page after. */
  async feed(before?: string | null): Promise<Feed> {
    if (!isTauri()) {
      return { posts: [], more: false };
    }
    return call<Feed>("community_feed", { before: before ?? null });
  },

  async post(book: { title: string; author: string | null; rating: number | null; line: string | null }): Promise<BookPost> {
    if (!isTauri()) {
      throw new Error(NEEDS_APP);
    }
    return (await call<{ post: BookPost }>("community_post", book)).post;
  },

  async deletePost(id: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call("community_delete_post", { id });
  },

  /** This library's books that readers you follow have finished or are reading. */
  async friendsBooks(): Promise<FriendsBook[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ books: FriendsBook[] }>("community_friends_books")).books;
  },

  async clubs(): Promise<Club[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ clubs: Club[] }>("community_clubs")).clubs;
  },

  async createClub(name: string, goalMinutes: number): Promise<Club> {
    if (!isTauri()) {
      throw new Error(NEEDS_APP);
    }
    return (await call<{ club: Club }>("community_club_create", { name, goalMinutes })).club;
  },

  async joinClub(code: string): Promise<Club> {
    if (!isTauri()) {
      throw new Error(NEEDS_APP);
    }
    return (await call<{ club: Club }>("community_club_join", { code })).club;
  },

  async leaveClub(id: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call("community_club_leave", { id });
  },

  /** The owner's changes: a new name, a new weekly goal. A field left out stays as it is. */
  async updateClub(id: string, change: { name?: string; goalMinutes?: number }): Promise<Club> {
    if (!isTauri()) {
      throw new Error(NEEDS_APP);
    }
    return (await call<{ club: Club }>("community_club_update", { id, name: change.name ?? null, goalMinutes: change.goalMinutes ?? null })).club;
  },

  async addClubBook(id: string, title: string, author: string | null): Promise<Club> {
    if (!isTauri()) {
      throw new Error(NEEDS_APP);
    }
    return (await call<{ club: Club }>("community_club_add_book", { id, title, author })).club;
  },

  /** Every badge there is for this reader, earned or not, as of the reader's local `todayKey`. */
  async badges(todayKey: string): Promise<BadgeProgress[]> {
    if (!isTauri()) {
      return [];
    }
    return call<BadgeProgress[]>("pip_badges", { todayKey });
  },

  /** Gifts waiting to be unwrapped, oldest first. */
  async gifts(): Promise<Gift[]> {
    if (!isTauri()) {
      return [];
    }
    return (await call<{ gifts: Gift[] }>("community_gifts")).gifts;
  },

  /** Tells the server a thing was sent to a friend; resolves with the gift's id. */
  async sendGift(to: string, kind: string, itemId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error(NEEDS_APP);
    }
    return (await call<{ gift: { id: string } }>("community_gift_send", { to, kind, itemId })).gift.id;
  },

  async claimGift(id: string): Promise<void> {
    if (!isTauri()) {
      return;
    }
    await call("community_gift_claim", { id });
  }
};
