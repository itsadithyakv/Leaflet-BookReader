import { create } from "zustand";
import type { LibraryResolveAction } from "@shared/sync/types";
import { libraryOwnerService } from "../services/libraryOwnerService";
import { errorMessage } from "../services/accountService";
import { useHabitStore } from "./habitStore";
import { useLibraryStore } from "./libraryStore";

/** Said when another library is asked for while a focus session runs. */
export const SWITCH_REFUSED_SESSION = "Finish your session first.";
/** Said when another library is asked for while books are still coming in. */
export const SWITCH_REFUSED_BUSY = "Leaflet is still adding books. Try again in a moment.";

/** Where the open library goes: the account's own on this device, or a new one for it. */
export type LibraryTarget = "mine" | "fresh";

type LibraryOwnerState = {
  /** "Another account's library": the sheet is up (components/sync/LibraryOwnerSheet.tsx). */
  offerOpen: boolean;
  /** A switch or an answer is under way: the sheets' buttons wait. */
  busy: boolean;
  /**
   * Asks the backend what a sign-in means for this library, and acts on it:
   * opens the account's own library, or puts the question up. `launch`: at
   * most once a run (signing in asks every time). The action, or null when
   * the backend could not say (an older build has no such command).
   */
  resolve: (options?: { launch?: boolean }) => Promise<LibraryResolveAction | null>;
  closeOffer: () => void;
  /** Keeps this library out of reading sync, and the question away. */
  stayOut: () => Promise<void>;
  /**
   * Opens another library and reloads the app on it. Refused, with a toast,
   * while a focus session runs or books are being added. False when it did
   * not happen.
   */
  switchAndReload: (target: LibraryTarget) => Promise<boolean>;
  /** "Your account already has a library": use it (true), or start empty (false). */
  answerHolds: (useIt: boolean) => Promise<void>;
};

type Hooks = {
  showToast?: (message: string) => void;
  /** Closes the open book, so its place is saved before the library goes. */
  closeReader?: () => void;
};

let hooks: Hooks = {};
/** The question was put at launch already this run. */
let offeredAtLaunch = false;

/** The app hands over its toast and its way to close the reader (App.tsx). Returns the undo. */
export const connectLibraryOwner = (next: Hooks) => {
  hooks = next;
  return () => {
    if (hooks === next) hooks = {};
  };
};

/** For tests: forget that the question was put this run. */
export const resetLibraryOwnerRun = () => {
  offeredAtLaunch = false;
};

const toast = (message: string) => hooks.showToast?.(message);

/** A focus session is running, here or in another of Leaflet's windows (they share storage). */
const sessionRunning = () => {
  if (useHabitStore.getState().activeSession) return true;
  try {
    const raw = localStorage.getItem("leaflet.habit.active");
    return Boolean(raw && raw !== "null");
  } catch {
    return false;
  }
};

/** Lets the closed reader's own clean-up (its last place) run before going on. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const useLibraryOwnerStore = create<LibraryOwnerState>((set, get) => ({
  offerOpen: false,
  busy: false,

  async resolve(options = {}) {
    let action: LibraryResolveAction;
    try {
      ({ action } = await libraryOwnerService.resolve());
    } catch {
      return null;
    }
    if (action === "switch" && (await get().switchAndReload("mine"))) {
      return action;
    }
    if (action === "offer") {
      if (!options.launch || !offeredAtLaunch) {
        offeredAtLaunch = offeredAtLaunch || Boolean(options.launch);
        set({ offerOpen: true });
      }
    }
    // Adopted, or paused: what the sync card says follows.
    void useLibraryStore.getState().loadSyncStatus();
    return action;
  },

  closeOffer() {
    set({ offerOpen: false });
  },

  async stayOut() {
    set({ busy: true });
    try {
      await libraryOwnerService.stayOut(true);
      set({ offerOpen: false });
      void useLibraryStore.getState().loadSyncStatus();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't change that. Try again."));
    } finally {
      set({ busy: false });
    }
  },

  async switchAndReload(target) {
    if (get().busy) return false;
    if (sessionRunning()) {
      toast(SWITCH_REFUSED_SESSION);
      return false;
    }
    const library = useLibraryStore.getState();
    if (library.importing || library.metadataRefreshing) {
      toast(SWITCH_REFUSED_BUSY);
      return false;
    }
    set({ busy: true });
    try {
      hooks.closeReader?.();
      await settle();
      // What was read and not yet in the ledger goes into this library's.
      await useHabitStore.getState().flushReading(false).catch(() => null);
      if (target === "mine") {
        await libraryOwnerService.openMine();
      } else {
        await libraryOwnerService.startFresh();
      }
    } catch (cause) {
      set({ busy: false });
      toast(errorMessage(cause, "Couldn't open that library."));
      return false;
    }
    // Every store holds the old library: the app starts over on the new one.
    window.location.reload();
    return true;
  },

  async answerHolds(useIt) {
    set({ busy: true });
    try {
      await libraryOwnerService.freshAnswer(useIt);
      const library = useLibraryStore.getState();
      library.dismissAccountHolds();
      await Promise.all([library.loadBooks(), library.loadSyncStatus()]);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't reach your account. Try again."));
    } finally {
      set({ busy: false });
    }
  }
}));
