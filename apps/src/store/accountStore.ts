import { create } from "zustand";
import { useCommunityStore } from "../components/community/communityStore";
import { accountService, errorMessage, SIGNED_OUT, type AccountStatus } from "../services/accountService";
import { socialService } from "../services/socialService";

type AccountState = {
  status: AccountStatus;
  loaded: boolean;
  /** Reads the local answer at once, then (optionally) confirms with the server. */
  load: (refresh?: boolean) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string, avatar?: string | null) => Promise<void>;
  /**
   * Creates the account and signs this device in, but does not say so here
   * yet: the sign-up form has the profile to save next, and the pages that
   * show it are replaced the moment this store says "signed in". The form
   * hands the answer to `adopt` when it is done (or is closed half-way).
   */
  createAccount: (email: string, password: string, displayName?: string, avatar?: string | null) => Promise<AccountStatus>;
  /** Takes the answer from `createAccount` as who is signed in. */
  adopt: (status: AccountStatus) => void;
  setAvatar: (avatar: string | null) => Promise<void>;
  /** Emails a new confirmation code to the account's address. */
  requestEmailCode: () => Promise<void>;
  /** Confirms the address with the emailed code. */
  confirmEmail: (code: string) => Promise<void>;
  /** A new address, with the password; it starts unconfirmed. */
  changeEmail: (password: string, email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Emails a reset code; resolves to how many minutes it lasts. */
  requestReset: (email: string) => Promise<number>;
  /** Sets a new password with the code and signs in. */
  resetPassword: (email: string, code: string, password: string) => Promise<void>;
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

    async createAccount(email, password, displayName, avatar) {
      try {
        return await accountService.signUp(email, password, displayName, avatar);
      } catch (cause) {
        throw new Error(errorMessage(cause));
      }
    },

    adopt(status) {
      set({ status, loaded: true });
    },

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

    requestEmailCode: () => run(() => accountService.requestEmailCode()),

    confirmEmail: (code) => run(() => accountService.confirmEmail(code)),

    changeEmail: (password, email) => run(() => accountService.changeEmail(password, email)),

    signIn: (email, password) => run(() => accountService.signIn(email, password)),

    async requestReset(email) {
      try {
        return await accountService.requestReset(email);
      } catch (cause) {
        throw new Error(errorMessage(cause));
      }
    },

    resetPassword: (email, code, password) => run(() => accountService.confirmReset(email, code, password)),

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

// A session can end on the server while the app is open: the password was
// changed on another computer, or the account deleted. The first call that is
// refused makes Rust forget the session, but this store went on saying
// "signed in", so the Social page kept the profile card up, drew the reader a
// second row "on its way", and stopped saying why nothing was sent. Reading
// the answer on this device again (no request is made) puts that right. Only
// "signed out" is taken from it: anything else the store knows (that the
// server could not be reached, say) is left as it is.
socialService.onCallFailed(() => {
  if (!useAccountStore.getState().status.signedIn) {
    return;
  }
  void accountService
    .status(false)
    .then((status) => {
      if (!status.signedIn && useAccountStore.getState().status.signedIn) {
        useAccountStore.setState({ status });
      }
    })
    .catch(() => undefined);
});
