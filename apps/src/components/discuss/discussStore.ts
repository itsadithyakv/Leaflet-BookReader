import { create } from "zustand";
import { discussService, type ReportTarget } from "../../services/discussService";
import { useCommunityStore } from "../community/communityStore";

/**
 * State the public community shares between its screens: the keys of the
 * library's books (for a reader's place in the book a thread is about), the
 * two dialogs that open from many places (the guidelines, and a report), the
 * book whose posts are being looked at, and where the Communities tab is.
 */

/** What is being reported: what kind of thing, which one, and a few words for the dialog's title. */
export type Reporting = { target: ReportTarget; id: string; what: string };

export type CommunitiesView = { at: "list" } | { at: "community"; id: string } | { at: "thread"; id: string; communityId: string | null };

type DiscussState = {
  /** Book id to book key, for this library; null until asked for. */
  keys: Record<string, string> | null;
  loadKeys: () => Promise<void>;

  reporting: Reporting | null;
  report: (reporting: Reporting) => void;
  closeReport: () => void;

  /** The guidelines dialog, while it is up: what to tell whoever asked. */
  rulesAsked: ((accepted: boolean) => void) | null;
  /** Resolves true once the guidelines are accepted (now, or before); false if the reader closes them. */
  ensureRules: () => Promise<boolean>;
  answerRules: (accepted: boolean) => Promise<void>;

  /** The book whose posts are shown in a drawer. */
  book: { title: string; author: string | null; key?: string | null } | null;
  openBook: (book: { title: string; author: string | null; key?: string | null }) => void;
  closeBook: () => void;

  view: CommunitiesView;
  go: (view: CommunitiesView) => void;
};

export const useDiscussStore = create<DiscussState>((set, get) => ({
  keys: null,
  async loadKeys() {
    try {
      set({ keys: await discussService.libraryKeys() });
    } catch {
      set({ keys: {} });
    }
  },

  reporting: null,
  report(reporting) {
    set({ reporting });
  },
  closeReport() {
    set({ reporting: null });
  },

  rulesAsked: null,
  ensureRules() {
    if (useCommunityStore.getState().me?.rulesAccepted) {
      return Promise.resolve(true);
    }
    // A second ask while the dialog is up answers the first as "not now".
    get().rulesAsked?.(false);
    return new Promise<boolean>((resolve) => set({ rulesAsked: resolve }));
  },
  async answerRules(accepted) {
    const asked = get().rulesAsked;
    if (!asked) {
      return;
    }
    if (accepted) {
      // Throws if the server will not have it: the dialog stays up and says why.
      await discussService.acceptRules();
      const me = useCommunityStore.getState().me;
      if (me) {
        useCommunityStore.getState().setMe({ ...me, rulesAccepted: true });
      }
    }
    set({ rulesAsked: null });
    asked(accepted);
  },

  book: null,
  openBook(book) {
    set({ book });
  },
  closeBook() {
    set({ book: null });
  },

  view: { at: "list" },
  go(view) {
    set({ view });
  }
}));
