import { create } from "zustand";

export type ThemeMode = "light" | "dark";

type AppearanceState = {
  theme: ThemeMode;
  /** True when the reader asked to follow the Windows setting. */
  followSystem: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  /** Follow Windows from now on. */
  followSystemTheme: () => void;
  /** Forget every choice: back to the light default. */
  resetTheme: () => void;
};

const STORAGE_KEY = "leaflet.appearance.v1";

type Stored = ThemeMode | "system" | null;

/**
 * Light is the default. Dark is a choice, and so is following Windows: the app
 * used to follow the system silently, which made a first launch on a dark
 * desktop look nothing like the design.
 */
const readPreference = (): Stored => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { theme?: unknown };
    return parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system" ? parsed.theme : null;
  } catch {
    return null;
  }
};

const writePreference = (theme: Stored) => {
  try {
    if (theme === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
    }
  } catch {
    // The choice still applies for this session.
  }
};

const systemThemeQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

const readSystemTheme = (): ThemeMode => (systemThemeQuery()?.matches ? "dark" : "light");

const applyTheme = (theme: ThemeMode) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#141311" : "#e8dfcb");
};

const saved = readPreference();
const initialTheme: ThemeMode = saved === "system" ? readSystemTheme() : saved ?? "light";
applyTheme(initialTheme);

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  theme: initialTheme,
  followSystem: saved === "system",
  setTheme(theme) {
    writePreference(theme);
    applyTheme(theme);
    set({ theme, followSystem: false });
  },
  toggleTheme() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
  followSystemTheme() {
    writePreference("system");
    const theme = readSystemTheme();
    applyTheme(theme);
    set({ theme, followSystem: true });
  },
  resetTheme() {
    writePreference(null);
    applyTheme("light");
    set({ theme: "light", followSystem: false });
  }
}));

export const watchSystemTheme = () => {
  const query = systemThemeQuery();
  if (!query) {
    return () => undefined;
  }
  const onChange = () => {
    if (!useAppearanceStore.getState().followSystem) {
      return;
    }
    const theme = readSystemTheme();
    applyTheme(theme);
    useAppearanceStore.setState({ theme });
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
