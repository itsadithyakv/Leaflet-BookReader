import { create } from "zustand";

type AccountTier = "offline" | "cloud" | "premium";
type SyncState = "offline" | "pending" | "synced" | "error";

type AccountSnapshot = {
  loggedIn: boolean;
  email: string | null;
  premium: boolean;
  lastSyncedAt: string | null;
};

type AccountState = AccountSnapshot & {
  syncState: SyncState;
  load: () => void;
  signIn: (email: string) => void;
  signOut: () => void;
  upgradePremium: () => void;
  restorePremium: () => void;
  setLastSyncedAt: (value: string | null) => void;
  setSyncState: (value: SyncState) => void;
  resetAll: () => void;
  tier: () => AccountTier;
};

const STORAGE_KEY = "leaflet.account";

const readSnapshot = (): AccountSnapshot => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { loggedIn: false, email: null, premium: false, lastSyncedAt: null };
    }
    const parsed = JSON.parse(raw) as AccountSnapshot;
    return {
      loggedIn: !!parsed.loggedIn,
      email: parsed.email ?? null,
      premium: !!parsed.premium,
      lastSyncedAt: parsed.lastSyncedAt ?? null
    };
  } catch {
    return { loggedIn: false, email: null, premium: false, lastSyncedAt: null };
  }
};

const persist = (snapshot: AccountSnapshot) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage errors
  }
};

export const useAccountStore = create<AccountState>((set, get) => ({
  ...readSnapshot(),
  syncState: "offline",
  load() {
    const snapshot = readSnapshot();
    set(snapshot);
  },
  signIn(email) {
    const snapshot = { loggedIn: true, email, premium: get().premium, lastSyncedAt: get().lastSyncedAt };
    set(snapshot);
    persist(snapshot);
  },
  signOut() {
    const snapshot = { loggedIn: false, email: null, premium: false, lastSyncedAt: null };
    set({ ...snapshot, syncState: "offline" });
    persist(snapshot);
  },
  upgradePremium() {
    const snapshot = { loggedIn: true, email: get().email, premium: true, lastSyncedAt: get().lastSyncedAt };
    set(snapshot);
    persist(snapshot);
  },
  restorePremium() {
    const snapshot = { loggedIn: true, email: get().email, premium: true, lastSyncedAt: get().lastSyncedAt };
    set(snapshot);
    persist(snapshot);
  },
  setLastSyncedAt(value) {
    const snapshot = { loggedIn: get().loggedIn, email: get().email, premium: get().premium, lastSyncedAt: value };
    set({ lastSyncedAt: value });
    persist(snapshot);
  },
  setSyncState(value) {
    set({ syncState: value });
  },
  resetAll() {
    const snapshot = { loggedIn: false, email: null, premium: false, lastSyncedAt: null };
    set({ ...snapshot, syncState: "offline" });
    persist(snapshot);
  },
  tier() {
    const { loggedIn, premium } = get();
    if (!loggedIn) {
      return "offline";
    }
    return premium ? "premium" : "cloud";
  }
}));
