import { useSyncExternalStore } from "react";

/**
 * Whether a phone's keyboard is up: `data-keyboard="open"` on <html>, which
 * the Android side sets as it resizes the page to end at the keyboard
 * (platform/device.ts, MainActivity.kt `watchInsets`).
 */
export const keyboardIsOpen = () => typeof document !== "undefined" && document.documentElement.dataset.keyboard === "open";

const subscribe = (changed: () => void) => {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => undefined;
  const watched = new MutationObserver(changed);
  watched.observe(document.documentElement, { attributes: true, attributeFilter: ["data-keyboard"] });
  return () => watched.disconnect();
};

/** `keyboardIsOpen`, kept as it changes. */
export const useKeyboardOpen = () => useSyncExternalStore(subscribe, keyboardIsOpen, () => false);
