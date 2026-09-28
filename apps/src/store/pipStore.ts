import { create } from "zustand";

/**
 * Chatty: celebrations plus the occasional ambient fidget.
 * Quiet: celebrations only. Off: Pip is hidden everywhere.
 */
export type PipMode = "chatty" | "quiet" | "off";

export type PipReaction = { id: number; move: string; loops: number; line: string | null };

type PipState = {
  mode: PipMode;
  /** True while a book is open: Pip's world is covered, so reactions wait. */
  suspended: boolean;
  /**
   * True while the Pip tab is open: Pip is at home in its room there, big, so
   * the roaming Pip steps aside (one Pip on screen, always) and the tab plays
   * any celebration instead.
   */
  onStage: boolean;
  setOnStage: (onStage: boolean) => void;
  /** Pip is behind its door rather than out in the app. */
  home: boolean;
  /** The door is swinging: Pip is on the way in or out. */
  doorSwinging: boolean;
  /** Where Pip actually is right now, as the world reports it. */
  inside: boolean;
  /**
   * Bumped on every door press, so pressing the door always acts, even when
   * the preference it sets is unchanged (Pip out only to celebrate).
   */
  homeRequest: number;
  /** The tour stop Pip is showing, or null when there is no tour running. */
  tour: number | null;
  reaction: PipReaction | null;
  queue: PipReaction[];
  /** A celebration inside the reader: Pip peeks over the corner, then leaves. */
  peek: PipReaction | null;
  /** The book being read, for its scene in Pip's idle time (see pip/bookNods). */
  bookNod: { title: string; author: string | null } | null;
  setBookNod: (book: { title: string; author: string | null } | null) => void;
  setMode: (mode: PipMode) => void;
  setSuspended: (suspended: boolean) => void;
  setHome: (home: boolean) => void;
  setDoorSwinging: (swinging: boolean) => void;
  setInside: (inside: boolean) => void;
  startTour: () => void;
  setTourStop: (stop: number | null) => void;
  /** Queues a one-off move for the stage. Ignored when Pip is off. */
  react: (move: string, options?: { loops?: number; line?: string | null }) => void;
  finishReaction: (id: number) => void;
  /** `loops` defaults to 2; story scenes that end somewhere (soot, spilt tea) play once. */
  showPeek: (move: string, line: string, loops?: number) => void;
  clearPeek: (id: number) => void;
};

const MODE_KEY = "leaflet.pip.mode";
const HOME_KEY = "leaflet.pip.home";
/** A backlog of celebrations played one after another is noise, not delight. */
const QUEUE_LIMIT = 2;

const readMode = (): PipMode => {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "quiet" || stored === "off" ? stored : "chatty";
  } catch {
    return "chatty";
  }
};

/** Chatty Pip lives out in the app; quiet Pip stays in until there is news. */
const readHome = (mode: PipMode) => {
  try {
    const stored = localStorage.getItem(HOME_KEY);
    if (stored === "1" || stored === "0") {
      return stored === "1";
    }
  } catch {
    // fall through to the default
  }
  return mode !== "chatty";
};

let nextId = 1;
const initialMode = readMode();

export const usePipStore = create<PipState>((set, get) => ({
  mode: initialMode,
  suspended: false,
  onStage: false,
  home: readHome(initialMode),
  doorSwinging: false,
  inside: true,
  homeRequest: 0,
  tour: null,
  reaction: null,
  queue: [],
  peek: null,
  bookNod: null,
  setBookNod(bookNod) {
    set({ bookNod });
  },

  setMode(mode) {
    set({ mode, ...(mode === "off" ? { reaction: null, queue: [], peek: null } : {}) });
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // The choice still applies for this session.
    }
  },

  setHome(home) {
    set({ home, homeRequest: get().homeRequest + 1 });
    try {
      localStorage.setItem(HOME_KEY, home ? "1" : "0");
    } catch {
      // Remembered for this session only.
    }
  },

  setOnStage(onStage) {
    set({ onStage });
  },

  setDoorSwinging(doorSwinging) {
    set({ doorSwinging });
  },

  setInside(inside) {
    set({ inside });
  },

  startTour() {
    if (get().mode === "off") {
      return;
    }
    set({ tour: 0 });
  },

  setTourStop(tour) {
    set({ tour });
  },

  setSuspended(suspended) {
    set({ suspended, ...(suspended ? {} : { peek: null }) });
    const { reaction, queue } = get();
    if (!suspended && !reaction && queue.length > 0) {
      set({ reaction: queue[0], queue: queue.slice(1) });
    }
  },

  react(move, options) {
    const { mode, reaction, queue, suspended } = get();
    if (mode === "off" || reaction?.move === move || queue.some((item) => item.move === move)) {
      return;
    }
    const item = { id: nextId++, move, loops: options?.loops ?? 2, line: options?.line ?? null };
    if (!reaction && !suspended) {
      set({ reaction: item });
    } else if (queue.length < QUEUE_LIMIT) {
      set({ queue: [...queue, item] });
    }
  },

  finishReaction(id) {
    const { reaction, queue, suspended } = get();
    if (reaction?.id !== id) {
      return;
    }
    if (!suspended && queue.length > 0) {
      set({ reaction: queue[0], queue: queue.slice(1) });
    } else {
      set({ reaction: null });
    }
  },

  showPeek(move, line, loops = 2) {
    if (get().mode === "off") {
      return;
    }
    set({ peek: { id: nextId++, move, loops, line } });
  },

  clearPeek(id) {
    if (get().peek?.id === id) {
      set({ peek: null });
    }
  }
}));
