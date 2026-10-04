import { create } from "zustand";
import type { SocialProfile } from "@shared/sync/types";
import {
  socialService,
  type BoardScope,
  type CommunityBoard,
  type CommunityPerson,
  type Duel,
  type InboxEvent
} from "../../services/socialService";
import { errorText, readJson, writeJson } from "./format";

/**
 * Shared community state: the boards, duels, inbox and which reader card is
 * open. Shared because three places touch it — the Social page, the nav badge
 * and the background pulse (which makes Pip react).
 */

/** Noticed on this device by comparing Following boards; never on the server. */
export type PassedEvent = {
  id: string;
  type: "passed";
  createdAt: string;
  actor: CommunityPerson;
  weekKey: string;
};

export type InboxItem = InboxEvent | PassedEvent;

const SEEN_KEY = "leaflet.community.inboxSeen";
const SCOPE_KEY = "leaflet.community.scope";
const INBOX_CAP = 60;

type CommunityState = {
  /** The reader's own profile, when signed in. Null until it loads, and when it could not. */
  me: SocialProfile | null;
  /**
   * Why the profile could not be read, when it could not. Without this a
   * failed load looked exactly like a private profile.
   */
  meError: string | null;
  /** Why the reader's minutes could not be sent to the board, when they could not. */
  publishError: string | null;
  scope: BoardScope;
  boards: Record<BoardScope, CommunityBoard | null>;
  boardLoading: Record<BoardScope, boolean>;
  boardError: Record<BoardScope, string | null>;
  duels: Duel[];
  inbox: InboxItem[];
  /** Items newer than this are unread. */
  seenAt: string;
  /** The reader card being shown, by handle. */
  openHandle: string | null;

  setMe: (me: SocialProfile | null) => void;
  /** Reads the reader's profile from the server. */
  loadMe: () => Promise<void>;
  /** Sends this week's minutes (see `socialService.publishStats`) and keeps why, if it failed. */
  publish: (options?: { force?: boolean }) => Promise<boolean>;
  setScope: (scope: BoardScope) => void;
  loadBoard: (scope: BoardScope) => Promise<CommunityBoard | null>;
  loadDuels: () => Promise<void>;
  /** Fetches the inbox; resolves with the events not seen before. */
  pollInbox: () => Promise<InboxEvent[]>;
  addPassed: (event: PassedEvent) => void;
  markSeen: () => void;
  openReader: (handle: string) => void;
  closeReader: () => void;
  respondToDuel: (id: string, accept: boolean) => Promise<void>;
  /** Signed out: forget everything personal. */
  reset: () => void;
};

const byNewest = (a: InboxItem, b: InboxItem) => b.createdAt.localeCompare(a.createdAt);

/**
 * Counts sign-outs. An answer still on its way when the reader signs out is
 * about the reader who left, and it used to land afterwards: their profile,
 * duels and inbox reappeared, and were the next account's until its own
 * answers came (for good, if those failed).
 */
let epoch = 0;

/** A board as a signed-out visitor sees it: the same rows, none of them "you". */
const anonymous = (board: CommunityBoard | null): CommunityBoard | null =>
  board && {
    ...board,
    you: null,
    entries: board.entries.map((entry) => (entry.isYou ? { ...entry, isYou: false } : entry))
  };

export const useCommunityStore = create<CommunityState>((set, get) => ({
  me: null,
  meError: null,
  publishError: null,
  scope: readJson<BoardScope>(SCOPE_KEY, "everyone") === "following" ? "following" : "everyone",
  boards: { everyone: null, following: null },
  boardLoading: { everyone: false, following: false },
  boardError: { everyone: null, following: null },
  duels: [],
  inbox: [],
  seenAt: readJson<string>(SEEN_KEY, new Date(0).toISOString()),
  openHandle: null,

  setMe(me) {
    set({ me, meError: null });
  },

  async loadMe() {
    const asked = epoch;
    try {
      const me = await socialService.profile();
      if (asked === epoch) {
        set({ me, meError: null });
      }
    } catch (cause) {
      // Keep the profile already shown: one failed refresh is not "private".
      if (asked === epoch) {
        set({ meError: errorText(cause) });
      }
    }
  },

  async publish(options) {
    const published = await socialService.publishStats(options);
    const publishError = socialService.publishProblem();
    if (publishError !== get().publishError) {
      set({ publishError });
    }
    return published;
  },

  setScope(scope) {
    set({ scope });
    writeJson(SCOPE_KEY, scope);
  },

  async loadBoard(scope) {
    const asked = epoch;
    set((state) => ({ boardLoading: { ...state.boardLoading, [scope]: true } }));
    try {
      const answer = await socialService.board(scope);
      // Asked for before a sign-out: Following was that reader's alone, and
      // Everyone marked them as "you".
      if (asked !== epoch && scope === "following") {
        return null;
      }
      const board = asked === epoch ? answer : (anonymous(answer) as CommunityBoard);
      set((state) => ({
        boards: { ...state.boards, [scope]: board },
        boardError: { ...state.boardError, [scope]: null }
      }));
      return board;
    } catch (cause) {
      if (asked === epoch || scope === "everyone") {
        set((state) => ({ boardError: { ...state.boardError, [scope]: errorText(cause) } }));
      }
      return null;
    } finally {
      set((state) => ({ boardLoading: { ...state.boardLoading, [scope]: false } }));
    }
  },

  async loadDuels() {
    const asked = epoch;
    try {
      const duels = await socialService.duels();
      if (asked === epoch) {
        set({ duels });
      }
    } catch {
      // Signed out or offline: keep what is shown.
    }
  },

  async pollInbox() {
    const asked = epoch;
    // The whole inbox every time, not only what is new. The server leaves out
    // events from readers who are no longer public; asking only for newer
    // ones kept a reader who had made their profile private (or deleted their
    // account) in this list, by name, until the app was restarted. It also
    // brings the current state of each duel (an invite since accepted).
    const { events } = await socialService.inbox();
    if (asked !== epoch) {
      return [];
    }
    const { inbox, boards } = get();
    const known = new Set(inbox.map((item) => item.id));
    const fresh = events.filter((event) => !known.has(event.id));
    // "Passed you" notes are made on this device, so the server's list never
    // has them. They stay while the reader they name is still on the
    // Following board, which lists only public readers.
    const following = boards.following;
    const passed = inbox.filter(
      (item) => item.type === "passed" && (!following || following.entries.some((entry) => entry.handle === item.actor.handle))
    );
    set({ inbox: [...events, ...passed].sort(byNewest).slice(0, INBOX_CAP) });
    return fresh;
  },

  addPassed(event) {
    const { inbox } = get();
    if (inbox.some((item) => item.id === event.id)) {
      return;
    }
    set({ inbox: [event, ...inbox].sort(byNewest).slice(0, INBOX_CAP) });
  },

  markSeen() {
    const newest = get().inbox[0]?.createdAt;
    const seenAt = newest && newest > get().seenAt ? newest : get().seenAt;
    set({ seenAt });
    writeJson(SEEN_KEY, seenAt);
  },

  openReader(handle) {
    set({ openHandle: handle });
  },

  closeReader() {
    set({ openHandle: null });
  },

  async respondToDuel(id, accept) {
    const result = await socialService.respondToDuel(id, accept);
    set((state) => ({
      inbox: state.inbox.map((item) =>
        item.type === "duel_invite" && item.duel?.id === id
          ? { ...item, duel: { ...item.duel, status: result.status } }
          : item
      )
    }));
    await get().loadDuels();
  },

  reset() {
    epoch += 1;
    socialService.forgetPublish();
    set((state) => ({
      me: null,
      meError: null,
      publishError: null,
      // The Everyone board is public and stays, but not who "you" were on it:
      // kept whole, a signed-out page still showed "your place", and the next
      // reader to sign in was shown the last one's row as their own.
      boards: { everyone: anonymous(state.boards.everyone), following: null },
      boardLoading: { ...state.boardLoading, following: false },
      boardError: { ...state.boardError, following: null },
      duels: [],
      inbox: [],
      openHandle: null
    }));
  }
}));

/** How many inbox items arrived since the reader last looked. */
export const selectUnread = (state: CommunityState) =>
  state.inbox.reduce((count, item) => (item.createdAt > state.seenAt ? count + 1 : count), 0);
