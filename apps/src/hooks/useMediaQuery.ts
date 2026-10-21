import { useSyncExternalStore } from "react";
import { useShellShapeIs } from "../platform/shape";

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
const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

export const useSheetLayout = () => useMediaQuery(SHEET_QUERY);

/**
 * A phone by touch, either way up: menus hanging from a button become sheets. Below `sm`, or on its
 * side (platform/shape.ts: not a short window measured with the keyboard up).
 */
export const usePhoneMenus = () => {
  const touch = useMediaQuery(TOUCH_QUERY);
  const narrow = useMediaQuery(SHEET_QUERY);
  const sideways = useShellShapeIs("sideways");
  return touch && (narrow || sideways);
};
