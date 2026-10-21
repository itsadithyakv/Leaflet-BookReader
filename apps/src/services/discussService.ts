import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CommunityPerson } from "./socialService";
import type { BookPost } from "./friendsService";

/**
 * The public, optional half of the community: reviews and quotes for anyone
 * to read, likes and dislikes, the Discover feed, book communities and their
 * threads, and what keeps it civil (reports, blocks, the owner's review).
 *
 * Nothing here happens by itself. A post goes to the readers who follow you
 * unless "Everyone" is chosen for it; a community is joined by joining it.
 * Posting where everyone can read needs a public profile, a confirmed email
 * address, an account a few days old and the guidelines accepted: the server
 * says which is missing, in words meant to be shown.
 *
 * Every call is one Rust command (`discuss`) naming a route from a fixed
 * list (`commands/discuss.rs`); the server's JSON comes back unchanged.
 */

export type Reaction = 1 | -1 | 0;

/** Who a post is for. */
export type Audience = "followers" | "everyone";

/** How far a thread goes into its book (a book's community) or its series (a series'); null for no spoilers. */
export type Spoiler = { percent: number } | { book: number } | null;

export type CommunityKind = "book" | "series";

/** A book's or a series' community: one a book, one a series, named by the book. */
export type BookCommunity = {
  id: string;
  kind: CommunityKind;
  key: string;
  title: string;
  author: string | null;
  memberCount: number;
  threadCount: number;
  isMember: boolean;
  /** The member who looks after it: may pin, and remove threads, replies and members. */
  isKeeper: boolean;
  /** In the directory: it has three members or more, and has not been taken out of it. */
  listed: boolean;
  createdAt: string;
};

export type Thread = {
  id: string;
  /**
   * Null in a community's list for a thread with a spoiler mark that is not
   * the reader's own (`titleHidden`): a title can give a book away as well
   * as a body can. The thread itself, once opened, has it.
   */
  title: string | null;
  titleHidden?: boolean;
  /** Left out of a list; a short `excerpt` stands in, and only where there is no spoiler. */
  body?: string;
  excerpt?: string | null;
  /** Null for a reader who has since left. */
  author: CommunityPerson | null;
  spoiler: Spoiler;
  pinned: boolean;
  replyCount: number;
  likes: number;
  dislikes: number;
  myReaction: Reaction;
  createdAt: string;
  lastActivityAt: string;
  isYou: boolean;
  canRemove: boolean;
};

export type Reply = {
  id: string;
  body: string;
  author: CommunityPerson | null;
  likes: number;
  dislikes: number;
  myReaction: Reaction;
  createdAt: string;
  isYou: boolean;
  canRemove: boolean;
};

export type ReportTarget = "post" | "thread" | "reply" | "community" | "profile";
export type ReportReason = "spam" | "harassment" | "hate" | "sexual" | "spoiler" | "other";

/** Reports on one thing, as the owner reviews them. */
export type ReportGroup = {
  target: ReportTarget;
  /** The thing's id (for a reader, their account's). */
  id: string;
  count: number;
  /** How many readers gave each reason. */
  reasons: Partial<Record<ReportReason, number>>;
  notes: string[];
  firstAt: string;
  latestAt: string;
  /** The thing as it stands now, and who wrote it (for a reader: who they are). */
  content: {
    person: CommunityPerson | null;
    kind?: string | null;
    title?: string | null;
    author?: string | null;
    body?: string | null;
    quote?: string | null;
    note?: string | null;
    line?: string | null;
    hidden?: boolean;
    unlisted?: boolean | null;
    createdAt?: string | null;
    visibility?: string;
    suspendedUntil?: string | null;
  };
};

export type Counts = { likes: number; dislikes: number; myReaction: Reaction };

export type ProblemStatus = "open" | "closed";

/**
 * A problem report as the owner's list shows it (`GET /v1/admin/problems`):
 * the start of the message, never the diagnostics. Who sent it is a handle
 * (signed in), an address they gave (signed out), or neither.
 */
export type ProblemRow = {
  id: string;
  at: string;
  preview: string;
  /** Whether the message goes on past the preview. */
  cut: boolean;
  hasDiagnostics: boolean;
  version: string;
  platform: string;
  signedIn: boolean;
  handle: string | null;
  contact: string | null;
  status: ProblemStatus;
  note: string | null;
};

/** One report, whole (`GET /v1/admin/problems/:id`). */
export type Problem = Omit<ProblemRow, "preview" | "cut" | "hasDiagnostics"> & {
  message: string;
  diagnostics: string | null;
  closedAt: string | null;
};

/**
 * What the owner changes of a community: what it is called, who keeps it
 * (the handle of a member), a removed reader let back in (their handle), and
 * whether it is in the directory. A field left out stays as it is; a null
 * author takes the author away.
 */
export type CommunityChange = { title?: string; author?: string | null; keeper?: string; unban?: string; relist?: boolean };

const NEEDS_APP = "This needs the desktop app.";

const ask = async <T>(route: string, args: Record<string, unknown> = {}): Promise<T> => {
  if (!isTauri()) {
    throw new Error(NEEDS_APP);
  }
  try {
    return await invoke<T>("discuss", { route, args });
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
};

/** The same, where the browser preview should see an empty answer rather than an error. */
const read = async <T>(empty: T, route: string, args: Record<string, unknown> = {}): Promise<T> => (isTauri() ? ask<T>(route, args) : empty);

export type NewPost =
  | { kind: "finished"; title: string; author: string | null; rating: number | null; line: string | null; audience: Audience; spoiler?: boolean }
  | { kind: "review"; title: string; author: string | null; rating: number; body: string; audience: Audience; spoiler: boolean }
  | { kind: "quote"; title: string; author: string | null; quote: string; note: string | null; audience: Audience; spoiler: boolean };

export const discussService = {
  /** Says yes to the community guidelines, once: needed before anything is posted where everyone can read. */
  acceptRules: () => ask<{ accepted: boolean }>("rules_accept"),

  async post(post: NewPost): Promise<BookPost> {
    return (await ask<{ post: BookPost }>("post", post)).post;
  },

  react: (target: "post" | "thread" | "reply", id: string, value: Reaction) => ask<Counts>("react", { target, id, value }),

  /** What readers anywhere posted for everyone: the newest, or the best liked of the last month. */
  discover: (sort: "new" | "top", page: { cursor?: string | null; skip?: number } = {}) =>
    // `next` is where the newest-first list goes on from (the server holds
    // back a reader's fourth post of a page for the next one, so a date alone
    // would lose it); the best-liked list is paged by how many were shown.
    read<{ posts: BookPost[]; more: boolean; next?: string | null }>({ posts: [], more: false }, "discover", { sort, cursor: page.cursor ?? null, skip: page.skip ?? 0 }),

  /** What has been posted about one book, with how its reviews average. */
  bookPosts: (book: { title: string; author: string | null; key?: string | null }, before?: string | null) =>
    read<{ posts: BookPost[]; more: boolean; summary: { reviews: number; average: number | null } }>(
      { posts: [], more: false, summary: { reviews: 0, average: null } },
      "book_posts",
      { title: book.title, author: book.author, key: book.key ?? null, before: before ?? null }
    ),

  // ---- book communities -------------------------------------------------------

  async communities(query: { mine?: boolean; q?: string } = {}): Promise<BookCommunity[]> {
    return (await read<{ communities: BookCommunity[] }>({ communities: [] }, "communities", { mine: Boolean(query.mine), q: query.q ?? null })).communities;
  },

  /** The community for a book or a series, if somebody has started one; null if not. */
  async findCommunity(of: { kind: CommunityKind; key?: string | null; title: string; author: string | null }): Promise<BookCommunity | null> {
    if (!isTauri()) {
      return null;
    }
    try {
      return (await ask<{ community: BookCommunity }>("community_find", of)).community;
    } catch {
      return null;
    }
  },

  /** Joins the community for a book or a series, starting it if there is none yet. */
  async openCommunity(of: { kind: CommunityKind; key?: string | null; title: string; author: string | null }): Promise<BookCommunity> {
    return (await ask<{ community: BookCommunity }>("community_open", of)).community;
  },

  /** One community by its id, member of it or not. */
  async community(id: string): Promise<BookCommunity> {
    return (await ask<{ community: BookCommunity }>("community", { id })).community;
  },

  async joinCommunity(id: string): Promise<BookCommunity> {
    return (await ask<{ community: BookCommunity }>("community_join", { id })).community;
  },

  leaveCommunity: (id: string) => ask<unknown>("community_leave", { id }),

  removeMember: (id: string, handle: string) => ask<unknown>("community_remove_member", { id, handle }),

  threads: (id: string, before?: string | null) => read<{ threads: Thread[]; more: boolean }>({ threads: [], more: false }, "threads", { id, before: before ?? null }),

  async startThread(id: string, thread: { title: string; body: string; spoiler: Spoiler }): Promise<Thread> {
    return (await ask<{ thread: Thread }>("thread_create", { id, ...thread })).thread;
  },

  thread: (id: string, after?: string | null) =>
    ask<{ thread: Thread; community: BookCommunity; replies: Reply[]; more: boolean }>("thread", { id, after: after ?? null }),

  async reply(threadId: string, body: string): Promise<Reply> {
    return (await ask<{ reply: Reply }>("reply", { id: threadId, body })).reply;
  },

  deleteThread: (id: string) => ask<unknown>("thread_delete", { id }),
  deleteReply: (id: string) => ask<unknown>("reply_delete", { id }),
  pinThread: (id: string, pinned: boolean) => ask<unknown>("thread_pin", { id, pinned }),

  // ---- reports and blocks -------------------------------------------------------

  report: (target: ReportTarget, id: string, reason: ReportReason, note: string | null) => ask<{ reported: boolean }>("report", { target, id, reason, note }),

  block: (handle: string) => ask<unknown>("block", { handle }),
  unblock: (handle: string) => ask<unknown>("unblock", { handle }),

  async blocked(): Promise<CommunityPerson[]> {
    return (await read<{ blocked: CommunityPerson[] }>({ blocked: [] }, "blocks")).blocked;
  },

  // ---- the owner's review (answers "no such route" to anyone else) ---------------

  async openReports(): Promise<ReportGroup[]> {
    return (await ask<{ reports: ReportGroup[] }>("admin_reports")).reports;
  },
  resolve: (target: ReportTarget, id: string, action: "remove" | "restore" | "dismiss") => ask<unknown>("admin_resolve", { target, id, action }),
  suspend: (handle: string, days: number) => ask<unknown>("admin_suspend", { handle, days }),
  settings: () => ask<{ publicPosting: boolean }>("admin_settings"),
  setPublicPosting: (publicPosting: boolean) => ask<{ publicPosting: boolean }>("admin_set_settings", { publicPosting }),
  /** Problem reports with this status, newest first: fifty after `before` (the last shown). */
  problems: (status: ProblemStatus, before?: string) =>
    ask<{ problems: ProblemRow[]; more: boolean }>("admin_problems", { status, before }),
  problem: (id: string) => ask<Problem>("admin_problem", { id }),
  /** Closes or reopens one, with the note as it now stands (empty takes it away). */
  updateProblem: (id: string, status: ProblemStatus, note: string) =>
    ask<Problem>("admin_problem_update", { id, status, note }),
  deleteProblem: (id: string) => ask<unknown>("admin_problem_delete", { id }),
  /** Puts right what only the owner can in a community. Only what is in `change` changes; the community comes back as it now stands. */
  async adminCommunity(id: string, change: CommunityChange): Promise<BookCommunity> {
    return (await ask<{ community: BookCommunity }>("admin_community", { id, ...change })).community;
  },

  /** The key of each library book, by its id: how the app knows the reader's place in the book a thread is about. */
  async libraryKeys(): Promise<Record<string, string>> {
    if (!isTauri()) {
      return {};
    }
    return invoke<Record<string, string>>("library_keys");
  }
};
