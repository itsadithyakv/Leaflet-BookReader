/**
 * A phone's keyboard, in the app around the pages: the field being typed in
 * stays in sight. The keyboard ends the window at its top edge (the WebView is
 * resized: MainActivity.kt `watchInsets`, which sets `html[data-keyboard]`),
 * and a field low in the page or in a sheet (Settings, Report a problem, a
 * comment) was left under it, or under the header that lies over the page.
 * Once the keyboard is up and the window has its new size, the focused field
 * is scrolled the least that shows it (each scroller's `scroll-padding` keeps
 * it clear of the header). The reader has its own (readers/, `keyboardOpen`).
 */

/** Whether `element` is somewhere text is typed: a keyboard comes up for it. */
export const takesTyping = (element: Element | null): element is HTMLElement => {
  if (!element || typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = ((element as HTMLInputElement).type || "text").toLowerCase();
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
};

const keyboardUp = () => document.documentElement.dataset.keyboard === "open";

/** Brings the focused field into view, if the keyboard is up for one outside the reader. */
export const showFocusedField = () => {
  if (!keyboardUp()) return;
  const field = document.activeElement;
  if (!takesTyping(field) || field.closest(".reader-scope")) return;
  field.scrollIntoView({ block: "nearest", inline: "nearest" });
};

let installed = false;
/** Watches the keyboard come up. Called once, from `main.tsx`. */
export const installKeyboardFocus = () => {
  if (installed || typeof window === "undefined" || typeof MutationObserver === "undefined") return;
  installed = true;
  let pending = 0;
  // After the resize has been laid out: two frames, as the window's new size and the attribute
  // arrive in either order.
  const soon = () => {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = requestAnimationFrame(() => {
        pending = 0;
        showFocusedField();
      });
    });
  };
  new MutationObserver(() => {
    if (keyboardUp()) soon();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-keyboard"] });
  window.addEventListener("resize", () => {
    if (keyboardUp()) soon();
  });
};
