import { create } from "zustand";
import { useCommunityStore } from "../components/community/communityStore";
import { accountService, errorMessage, SIGNED_OUT, type AccountStatus } from "../services/accountService";

type AccountState = {
  status: AccountStatus;
  loaded: boolean;
  /** Reads the local answer at once, then (optionally) confirms with the server. */
  load: (refresh?: boolean) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string, avatar?: string | null) => Promise<void>;
  setAvatar: (avatar: string | null) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
};

/**
 * Who is signed in to a Leaflet account, if anyone.
 *
 * Holds no secrets: the session token stays in Rust and the OS keychain. The
 * actions reject with a readable message for the UI to show.
 */
export const useAccountStore = create<AccountState>((set) => {
  const run = async (action: () => Promise<AccountStatus>) => {
    try {
      set({ status: await action(), loaded: true });
    } catch (cause) {
      throw new Error(errorMessage(cause));
    }
  };

  return {
    status: SIGNED_OUT,
    loaded: false,

    async load(refresh = false) {
      try {
        set({ status: await accountService.status(false), loaded: true });
        if (refresh) {
          set({ status: await accountService.status(true) });
        }
      } catch {
        set({ loaded: true });
      }
    },

    signUp: (email, password, displayName, avatar) =>
      run(() => accountService.signUp(email, password, displayName, avatar)),

    async setAvatar(avatar) {
      await run(() => accountService.setAvatar(avatar));
      // The Social page keeps its boards between visits, so the reader's own
      // row would show the old avatar until the next poll. Reload the boards
      // already shown; the profile card reads the avatar from this store.
      const community = useCommunityStore.getState();
      for (const scope of ["everyone", "following"] as const) {
        if (community.boards[scope]) {
          void community.loadBoard(scope);
        }
      }
    },

    signIn: (email, password) => run(() => accountService.signIn(email, password)),

    signOut: () => run(() => accountService.signOut()),

    async changePassword(current, next) {
      try {
        await accountService.changePassword(current, next);
      } catch (cause) {
        throw new Error(errorMessage(cause));
      }
    },

    deleteAccount: (password) => run(() => accountService.deleteAccount(password))
  };
});
