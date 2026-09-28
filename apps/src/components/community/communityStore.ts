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
  /** The reader's own profile, when signed in. */
  me: SocialProfile | null;
  scope: BoardScope;
  boards: Record<BoardScope, CommunityBoard | null>;
  boardLoading: Record<BoardScope, boolean>;
  boardError: Record<BoardScope, string | null>;
  duels: Duel[];
  inbox: InboxItem[];
  /** The newest server event seen, for `?since=`. */
  inboxSince: string | null;
  /** Items newer than this are unread. */
  seenAt: string;
  /** The reader card being shown, by handle. */
  openHandle: string | null;

  setMe: (me: SocialProfile | null) => void;
  setScope: (scope: BoardScope) => void;
  loadBoard: (scope: BoardScope) => Promise<CommunityBoard | null>;
  loadDuels: () => Promise<void>;
  /** Fetches new inbox events; resolves with the ones not seen before. */
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

export const useCommunityStore = create<CommunityState>((set, get) => ({
  me: null,
  scope: readJson<BoardScope>(SCOPE_KEY, "everyone") === "following" ? "following" : "everyone",
  boards: { everyone: null, following: null },
  boardLoading: { everyone: false, following: false },
  boardError: { everyone: null, following: null },
  duels: [],
  inbox: [],
  inboxSince: null,
  seenAt: readJson<string>(SEEN_KEY, new Date(0).toISOString()),
  openHandle: null,

  setMe(me) {
    set({ me });
  },

  setScope(scope) {
    set({ scope });
    writeJson(SCOPE_KEY, scope);
  },

  async loadBoard(scope) {
    set((state) => ({ boardLoading: { ...state.boardLoading, [scope]: true } }));
    try {
      const board = await socialService.board(scope);
      set((state) => ({
        boards: { ...state.boards, [scope]: board },
        boardError: { ...state.boardError, [scope]: null }
      }));
      return board;
    } catch (cause) {
      set((state) => ({ boardError: { ...state.boardError, [scope]: errorText(cause) } }));
      return null;
    } finally {
      set((state) => ({ boardLoading: { ...state.boardLoading, [scope]: false } }));
    }
  },

  async loadDuels() {
    try {
      set({ duels: await socialService.duels() });
    } catch {
      // Signed out or offline: keep what is shown.
    }
  },

  async pollInbox() {
    const { inboxSince, inbox } = get();
    const { events } = await socialService.inbox(inboxSince);
    const known = new Set(inbox.map((item) => item.id));
    const fresh = events.filter((event) => !known.has(event.id));
    // Refresh duel states on events already listed (an invite since accepted).
    const updated = new Map(events.map((event) => [event.id, event]));
    const merged = [...fresh, ...inbox.map((item) => updated.get(item.id) ?? item)]
      .sort(byNewest)
      .slice(0, INBOX_CAP);
    const newest = events.reduce<string | null>(
      (latest, event) => (!latest || event.createdAt > latest ? event.createdAt : latest),
      inboxSince
    );
    set({ inbox: merged, inboxSince: newest });
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
    set((state) => ({
      me: null,
      boards: { everyone: state.boards.everyone, following: null },
      duels: [],
      inbox: [],
      inboxSince: null,
      openHandle: null
    }));
  }
}));

/** How many inbox items arrived since the reader last looked. */
export const selectUnread = (state: CommunityState) =>
  state.inbox.reduce((count, item) => (item.createdAt > state.seenAt ? count + 1 : count), 0);
