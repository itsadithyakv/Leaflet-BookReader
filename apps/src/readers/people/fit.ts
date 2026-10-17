/**
 * Characters on a phone: what is open keeps fitting the window as the
 * keyboard comes and goes. On Android the keyboard makes the window shorter
 * (platform/device.ts, `data-keyboard`); the sheet and the card fit the
 * shorter window, and the field being typed in stays in sight.
 */

type Span = { top: number; bottom: number };

/** How far to scroll a scroller showing `view` so `field` is wholly in it (with `margin`); 0 when it already is. */
export const scrollToShow = (field: Span, view: Span, margin = 8): number => {
  const top = view.top + margin;
  const bottom = view.bottom - margin;
  // Taller than the room: its top, where the typing starts.
  if (field.top < top || field.bottom - field.top > bottom - top) {
    return Math.round(field.top - top);
  }
  if (field.bottom > bottom) {
    return Math.round(field.bottom - bottom);
  }
  return 0;
};

const FIELD = "input, textarea, select";

/** Brings the field being typed in inside `container` into sight in the list that scrolls it. */
export const keepFieldInView = (container: HTMLElement | null) => {
  const field = typeof document === "undefined" ? null : document.activeElement;
  if (!container || !(field instanceof HTMLElement) || !container.contains(field) || !field.matches(FIELD)) {
    return;
  }
  for (let element = field.parentElement; element; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight) {
      const by = scrollToShow(field.getBoundingClientRect(), element.getBoundingClientRect());
      if (by !== 0) {
        element.scrollTop += by;
      }
      return;
    }
    if (element === container) {
      return;
    }
  }
};

/**
 * Calls `changed` whenever the room in the window may have changed: the
 * window resized, the keyboard said to come or go (`data-keyboard`), or the
 * system's insets moved (set on the root's style). Android reports these one
 * after the other, in no fixed order, so each is listened for. Returns the
 * detach.
 */
export const onRoomChange = (changed: () => void) => {
  window.addEventListener("resize", changed);
  window.visualViewport?.addEventListener("resize", changed);
  const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(changed);
  watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-keyboard", "style"] });
  return () => {
    window.removeEventListener("resize", changed);
    window.visualViewport?.removeEventListener("resize", changed);
    watch?.disconnect();
  };
};

/** The keyboard is up (Android says so on the root, platform/device.ts). */
export const keyboardOpen = () => typeof document !== "undefined" && document.documentElement.dataset.keyboard === "open";
