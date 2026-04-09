import { create } from "zustand";

export type GoalMode = "minutes" | "pages" | "chapters";

export type DailyGoal = {
  mode: GoalMode;
  target: number;
};

export type ReadingSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  bookId?: string;
  title?: string;
  notes?: string;
  endedReason?: "completed" | "manual_end";
  cleanSession?: boolean;
  shelfStyle?: ShelfStyle;
};

export type ActiveSession = {
  startedAt: string;
  durationMinutes: number;
  bookId?: string;
  title?: string;
};

export type FocusSettings = {
  goalBinding: boolean;
  kioskMode: boolean;
  checkpointPrompts: boolean;
  sessionNotes: boolean;
};

export type ShelfStyle = {
  accent: string;
  icon: string;
  spike: "zig" | "steps" | "teeth";
  stickerShape: "circle" | "diamond" | "ticket" | "squircle";
  stripeCount: 1 | 2 | 3;
  cornerStyle: "round" | "sharp" | "chamfer";
  foil: "none" | "gold" | "silver" | "bronze";
  wear: number;
  showSticker: boolean;
  showStripes: boolean;
  showFoil: boolean;
  showWear: boolean;
};

export type ForestItem = {
  id: string;
  dateKey: string;
  size: "sprout" | "sapling" | "tree";
  sessionId: string;
  style?: "normal" | "glow";
};

export type DailyRecord = {
  minutes: number;
  manualComplete?: boolean;
};

type HabitState = {
  goal: DailyGoal;
  sessions: ReadingSession[];
  forest: ForestItem[];
  daily: Record<string, DailyRecord>;
  activeSession?: ActiveSession | null;
  focusSettings: FocusSettings;
  setGoal: (goal: DailyGoal) => void;
  setFocusSettings: (next: Partial<FocusSettings>) => void;
  addSession: (session: Omit<ReadingSession, "id">) => void;
  addSessionNote: (id: string, notes: string) => void;
  markGoalComplete: (dateKey: string, complete: boolean) => void;
  startSession: (session: ActiveSession) => void;
  extendSession: (extraMinutes: number) => void;
  stopSession: (options?: {
    reason?: ReadingSession["endedReason"];
    cleanSession?: boolean;
  }) => string | null;
  clearSessionShelf: () => void;
  resetAll: () => void;
};

const STORAGE_KEY = "leaflet.habit";

const shelfAccents = ["#f6b4a2", "#8fd3c8", "#c6b4f2", "#f3d889", "#9fc89b", "#93c5fd", "#f4a3b8", "#f2c6a0"];
const shelfIcons = ["pets", "local_florist", "nightlight", "auto_awesome", "coffee", "forest", "menu_book", "favorite"];
const shelfSpikes: ShelfStyle["spike"][] = ["zig", "steps", "teeth"];
const stickerShapes: ShelfStyle["stickerShape"][] = ["circle", "diamond", "ticket", "squircle"];
const stripeCounts: ShelfStyle["stripeCount"][] = [1, 2, 3];
const cornerStyles: ShelfStyle["cornerStyle"][] = ["round", "sharp", "chamfer"];
const foilTypes: ShelfStyle["foil"][] = ["none", "gold", "silver", "bronze"];

const hashSeed = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildCombos = () => {
  const combos: ShelfStyle[] = [];
  for (const accent of shelfAccents) {
    for (const icon of shelfIcons) {
      for (const spike of shelfSpikes) {
        for (const stickerShape of stickerShapes) {
          for (const stripeCount of stripeCounts) {
            for (const cornerStyle of cornerStyles) {
              for (const foil of foilTypes) {
                combos.push({
                  accent,
                  icon,
                  spike,
                  stickerShape,
                  stripeCount,
                  cornerStyle,
                  foil,
                  wear: 0.3,
                  showSticker: true,
                  showStripes: true,
                  showFoil: foil !== "none",
                  showWear: true
                });
              }
            }
          }
        }
      }
    }
  }
  return combos;
};

const shelfCombos = buildCombos();

const styleKey = (style?: ShelfStyle | null) =>
  style
    ? `${style.accent}|${style.icon}|${style.spike}|${style.stickerShape}|${style.stripeCount}|${style.cornerStyle}|${style.foil}|${style.showSticker}|${style.showStripes}|${style.showFoil}|${style.showWear}`
    : "";

const pickShelfStyle = (seed: string, existing: ReadingSession[]) => {
  const used = new Set(existing.map((session) => styleKey(session.shelfStyle)));
  const startIndex = hashSeed(seed) % shelfCombos.length;
  for (let offset = 0; offset < shelfCombos.length; offset += 1) {
    const index = (startIndex + offset) % shelfCombos.length;
    const combo = shelfCombos[index];
    if (!used.has(styleKey(combo))) {
      return combo;
    }
  }
  return shelfCombos[startIndex];
};

const defaultGoal: DailyGoal = { mode: "minutes", target: 20 };
const defaultFocusSettings: FocusSettings = {
  goalBinding: false,
  kioskMode: false,
  checkpointPrompts: true,
  sessionNotes: true
};

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<HabitState>;
    if (parsed.sessions && parsed.sessions.length > 0) {
      let updated = false;
      const existing: ReadingSession[] = [];
      const sessions = parsed.sessions.map((session) => {
        if (session.shelfStyle && session.shelfStyle.stickerShape && session.shelfStyle.stripeCount) {
          existing.push(session as ReadingSession);
          return session;
        }
        const style = pickShelfStyle(session.id ?? `${Date.now()}`, existing);
        const seed = hashSeed(session.id ?? `${Date.now()}`);
        const showSticker = seed % 5 !== 0;
        const showStripes = seed % 4 !== 0;
        const showFoil = seed % 6 === 0;
        const showWear = seed % 3 !== 0;
        const enriched = {
          ...style,
          showSticker,
          showStripes,
          showFoil,
          showWear,
          wear: showWear ? 0.2 + (seed % 12) / 50 : 0
        };
        updated = true;
        const next = { ...session, shelfStyle: enriched } as ReadingSession;
        existing.push(next);
        return next;
      });
      if (updated) {
        parsed.sessions = sessions;
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            goal: parsed.goal ?? defaultGoal,
            sessions,
            forest: parsed.forest ?? [],
            daily: parsed.daily ?? {},
            activeSession: parsed.activeSession ?? null,
            focusSettings: parsed.focusSettings ?? defaultFocusSettings
          })
        );
      }
    }
    return parsed;
  } catch {
    return null;
  }
};

const persistState = (state: HabitState) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        goal: state.goal,
        sessions: state.sessions,
        forest: state.forest,
        daily: state.daily,
        activeSession: state.activeSession,
        focusSettings: state.focusSettings
      })
    );
  } catch {
    // ignore persistence errors
  }
};

export const getDateKey = (value: Date = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDays = (value: Date, offset: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + offset);
  return next;
};

export const buildDateRange = (days: number) => {
  const today = new Date();
  return Array.from({ length: days }).map((_, index) => getDateKey(addDays(today, -(days - 1 - index))));
};

export const isGoalMet = (goal: DailyGoal, record?: DailyRecord) => {
  if (!record) {
    return false;
  }
  if (goal.mode === "minutes") {
    return record.minutes >= goal.target;
  }
  return Boolean(record.manualComplete);
};

const sizeForMinutes = (minutes: number): ForestItem["size"] => {
  if (minutes >= 30) {
    return "tree";
  }
  if (minutes >= 15) {
    return "sapling";
  }
  return "sprout";
};

const initial = loadState();

export const useHabitStore = create<HabitState>((set, get) => ({
  goal: initial?.goal ?? defaultGoal,
  sessions: initial?.sessions ?? [],
  forest: initial?.forest ?? [],
  daily: initial?.daily ?? {},
  activeSession: initial?.activeSession ?? null,
  focusSettings: initial?.focusSettings ?? defaultFocusSettings,
  setGoal(goal) {
    set({ goal });
    persistState({ ...get(), goal });
  },
  setFocusSettings(next) {
    const focusSettings = { ...get().focusSettings, ...next };
    set({ focusSettings });
    persistState({ ...get(), focusSettings });
  },
  addSession(session) {
    const id = `session-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const shelfStyle = pickShelfStyle(id, get().sessions);
    const seed = hashSeed(id);
    const showSticker = seed % 5 !== 0;
    const showStripes = seed % 4 !== 0;
    const showFoil = seed % 6 === 0;
    const showWear = seed % 3 !== 0;
    const full: ReadingSession = { id, ...session, shelfStyle };
    full.shelfStyle = {
      ...shelfStyle,
      showSticker,
      showStripes,
      showFoil,
      showWear,
      wear: showWear ? 0.2 + (seed % 12) / 50 : 0
    };
    const dateKey = getDateKey(new Date(session.endedAt));
    const daily = { ...get().daily };
    const record = daily[dateKey] ?? { minutes: 0 };
    record.minutes += Math.max(0, session.durationMinutes);
    daily[dateKey] = record;

    const forest = [
      ...get().forest,
      {
        id: `forest-${id}`,
        dateKey,
        size: sizeForMinutes(session.durationMinutes),
        sessionId: id,
        style: session.cleanSession ? "glow" : "normal"
      }
    ];

    const sessions = [...get().sessions, full];
    set({ sessions, forest, daily });
    persistState({ ...get(), sessions, forest, daily });
  },
  addSessionNote(id, notes) {
    const sessions = get().sessions.map((session) =>
      session.id === id ? { ...session, notes } : session
    );
    set({ sessions });
    persistState({ ...get(), sessions });
  },
  markGoalComplete(dateKey, complete) {
    const daily = { ...get().daily };
    const record = daily[dateKey] ?? { minutes: 0 };
    record.manualComplete = complete;
    daily[dateKey] = record;
    set({ daily });
    persistState({ ...get(), daily });
  },
  startSession(session) {
    set({ activeSession: session });
    persistState({ ...get(), activeSession: session });
  },
  extendSession(extraMinutes) {
    const active = get().activeSession;
    if (!active) {
      return;
    }
    const durationMinutes = Math.max(1, active.durationMinutes + extraMinutes);
    const next = { ...active, durationMinutes };
    set({ activeSession: next });
    persistState({ ...get(), activeSession: next });
  },
  stopSession(options) {
    const active = get().activeSession;
    if (!active) {
      return null;
    }
    const startedAt = new Date(active.startedAt);
    const endedAt = new Date();
    const durationMinutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
    const endedReason = options?.reason ?? "manual_end";
    const cleanSession = options?.cleanSession ?? true;
    const id = `session-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const shelfStyle = pickShelfStyle(id, get().sessions);
    const seed = hashSeed(id);
    const showSticker = seed % 5 !== 0;
    const showStripes = seed % 4 !== 0;
    const showFoil = seed % 6 === 0;
    const showWear = seed % 3 !== 0;
    const full: ReadingSession = {
      id,
      startedAt: active.startedAt,
      endedAt: endedAt.toISOString(),
      durationMinutes,
      bookId: active.bookId,
      title: active.title,
      endedReason,
      cleanSession,
      shelfStyle: {
        ...shelfStyle,
        showSticker,
        showStripes,
        showFoil,
        showWear,
        wear: showWear ? 0.2 + (seed % 12) / 50 : 0
      }
    };

    const dateKey = getDateKey(new Date(full.endedAt));
    const daily = { ...get().daily };
    const record = daily[dateKey] ?? { minutes: 0 };
    record.minutes += Math.max(0, full.durationMinutes);
    daily[dateKey] = record;

    const forest = [
      ...get().forest,
      {
        id: `forest-${id}`,
        dateKey,
        size: sizeForMinutes(full.durationMinutes),
        sessionId: id,
        style: cleanSession ? "glow" : "normal"
      }
    ];

    const sessions = [...get().sessions, full];
    set({ sessions, forest, daily, activeSession: null });
    persistState({ ...get(), sessions, forest, daily, activeSession: null });
    return id;
  },
  clearSessionShelf() {
    const next = { ...get(), sessions: [], forest: [] };
    set({ sessions: [], forest: [] });
    persistState(next);
  },
  resetAll() {
    const reset: HabitState = {
      ...get(),
      goal: defaultGoal,
      sessions: [],
      forest: [],
      daily: {},
      activeSession: null,
      focusSettings: defaultFocusSettings
    };
    set(reset);
    persistState(reset);
  }
}));

export const getSessionProgress = (session?: ActiveSession | null) => {
  if (!session) {
    return 0;
  }
  const totalSeconds = session.durationMinutes * 60;
  if (totalSeconds <= 0) {
    return 0;
  }
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(session.startedAt)) / 1000));
  return Math.min(1, elapsedSeconds / totalSeconds);
};
