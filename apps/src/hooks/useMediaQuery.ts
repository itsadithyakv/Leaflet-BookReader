import { useSyncExternalStore } from "react";

const matches = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/** Whether a media query holds, kept as the window turns or resizes. */
export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (listener) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener?.("change", listener);
      return () => list.removeEventListener?.("change", listener);
    },
    () => matches(query),
    () => false
  );

/** Below `sm`: a dialog is a sheet from the bottom (styles/touch-shell.css). */
export const SHEET_QUERY = "(max-width: 639px)";
/** A phone by touch, either way up: menus hanging from a button become sheets. */
export const PHONE_MENU_QUERY =
  "(hover: none) and (pointer: coarse) and (max-width: 639px), (hover: none) and (pointer: coarse) and (max-height: 520px)";

export const useSheetLayout = () => useMediaQuery(SHEET_QUERY);
export const usePhoneMenus = () => useMediaQuery(PHONE_MENU_QUERY);
