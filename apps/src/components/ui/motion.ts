/**
 * Surfaces leave gently. React takes a closed sheet, dialog, menu, card or
 * toast out of the page at once, so it vanished in a frame however softly it
 * came in. This watches for one being removed, puts the very element back
 * where it was, inert and hidden from assistive tech, for the length of its
 * way out (styles/glass.css and readers/glass.css, `data-leaving`), and then
 * takes it away for good. One place for every surface, so no component has to
 * keep itself mounted to animate out.
 *
 * Only an element whose own parent is still in the page is put back: a book
 * closing takes its reader, cards and all, with no ghost of a card left over
 * the library. A sheet pulled down by a finger (an inline transform, from
 * components/ui/sheetSwipe.ts or readers/drawerSwipe.ts) is already out of
 * sight: it keeps where it was and only its scrim fades.
 *
 * (`.no-glass`, glass drawn solid on a phone short of memory, is now the
 * "minimal" visual-effects tier: platform/perfTier.ts.)
 */

/** What way a surface goes, by what it is. The first match wins. */
export const LEAVES: ReadonlyArray<readonly [selector: string, kind: LeaveKind]> = [
  // A dialog or a sheet on its scrim: the scrim fades, the dialog shrinks back (a sheet goes down).
  [".sheet-backdrop, .profile-sheet-backdrop", "sheet"],
  // The reader's scrims.
  [".reader-sheet-scrim, .reader-people-scrim, .reader-sidebar-scrim", "fade"],
  // The reader's sheets (down on an upright phone) and its panels and popovers (back where they hang from).
  [".reader-menu, .reader-type-panel, .ambience-popover, .reader-notes-panel, .reader-search, .reader-people-panel", "panel"],
  // What pops: menus and panels from a button, cards, bars, toasts.
  [
    // (The reader's toast is a box around its glass: the glass is what goes.)
    ".anchored-panel, .modal-surface[role='menu'], .reader-lookup, .reader-term-peek, .reader-selection-bar, .app-toast, .update-card, .further-on-offer, .reader-toast > div, .reader-back-chip, .reader-tap-hint",
    "pop"
  ]
];

export type LeaveKind = "sheet" | "fade" | "panel" | "pop" | "swiped";

/** Nothing is held longer than this, whether or not its animation reports its end. */
export const LEAVE_MAX_MS = 420;

const kindOf = (element: Element): LeaveKind | null => {
  for (const [selector, kind] of LEAVES) {
    if (element.matches(selector)) return kind;
  }
  return null;
};

/** Pulled away by a finger already: it, or a sheet in it, carries the drag's transform. */
const swiped = (element: HTMLElement) => {
  const moved = (one: Element) => /translate/.test((one as HTMLElement).style?.transform ?? "");
  return moved(element) || Array.from(element.querySelectorAll(".sheet-panel, .reader-menu, .reader-type-panel, .reader-notes-panel, .reader-people-panel, .reader-sidebar")).some(moved);
};

export type Leaving = {
  /** The element put back (the one React removed). */
  root: HTMLElement;
  /** The surface in it that animates: the root itself, or the one surface a wrapper held. */
  part: HTMLElement;
  kind: LeaveKind;
};

/**
 * Whether a removed element leaves gently, and how: it is a surface, or a
 * wrapper (a positioning box) around exactly one. Null for anything else.
 */
export const leaving = (node: Node, reduced = false): Leaving | null => {
  if (node.nodeType !== 1 || node.isConnected) return null;
  const element = node as HTMLElement;
  // One already on its way out, now gone: not again.
  if (element.hasAttribute("data-leaving") || element.hasAttribute("data-leaving-root")) return null;
  let part: HTMLElement = element;
  let kind = kindOf(element);
  if (!kind && element.childElementCount === 1 && element.firstElementChild) {
    part = element.firstElementChild as HTMLElement;
    kind = kindOf(part);
  }
  if (!kind) return null;
  if (reduced) return { root: element, part, kind: "fade" };
  return { root: element, part, kind: kind !== "fade" && swiped(element) ? "swiped" : kind };
};

/** Puts a removed surface back for its way out; resolves when it is gone again. */
export const holdWhileLeaving = (left: Leaving, parent: Node, before: Node | null): Promise<void> => {
  const { root, part, kind } = left;
  // A ghost: not reachable, not announced, and not mistaken for the dialog that may open in its place.
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");
  for (const marked of [root, ...Array.from(root.querySelectorAll("[id], [role='dialog'], [aria-modal]"))]) {
    marked.removeAttribute("id");
    if (marked.getAttribute("role") === "dialog") marked.removeAttribute("role");
    marked.removeAttribute("aria-modal");
  }
  if (part !== root) root.setAttribute("data-leaving-root", "");
  part.setAttribute("data-leaving", kind);
  parent.insertBefore(root, before && before.parentNode === parent ? before : null);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      root.remove();
      resolve();
    };
    const timer = window.setTimeout(finish, LEAVE_MAX_MS);
    // (Asking for them works out the styles, so the way out has begun.)
    const animations = typeof root.getAnimations === "function" ? root.getAnimations({ subtree: true }) : null;
    if (animations === null) return; // No animations to ask about (a test's DOM): the timer ends it.
    if (animations.length === 0) {
      // Nothing drawn for its way out (none for this kind here): gone at once, as before.
      finish();
      return;
    }
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(finish);
  });
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Watches `root` (the document's body) for surfaces leaving. Returns the stop. */
export const watchLeaving = (root: Node = document.body) => {
  const observer = new MutationObserver((records) => {
    const reduced = reducedMotion();
    for (const record of records) {
      // The parent went too (a page, a whole reader): nothing of it is put back.
      if (!record.target.isConnected) continue;
      record.removedNodes.forEach((node) => {
        const left = leaving(node, reduced);
        if (left) void holdWhileLeaving(left, record.target, record.nextSibling);
      });
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
};

/** A sheet's or a dialog's scrim. */
export const SHEET_SCRIMS = ".sheet-backdrop, .profile-sheet-backdrop";

const touchesScrim = (nodes: NodeList) =>
  Array.from(nodes).some((node) => node.nodeType === 1 && ((node as Element).matches(SHEET_SCRIMS) || (node as Element).querySelector(SHEET_SCRIMS) !== null));

/**
 * `html[data-sheet-open]` while a sheet or a dialog is up (or on its way out): for the rules that
 * change the window behind one (styles/window-material.css). It was `:root:has(.sheet-backdrop)`,
 * which made every insertion anywhere restyle the whole page. Set in the observer's microtask, so
 * before the frame the sheet first shows in.
 */
export const watchSheets = (root: Node = document.body, html: HTMLElement = document.documentElement) => {
  const mark = () => {
    const open = document.querySelector(SHEET_SCRIMS) !== null;
    if (open !== html.hasAttribute("data-sheet-open")) html.toggleAttribute("data-sheet-open", open);
  };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => touchesScrim(record.addedNodes) || touchesScrim(record.removedNodes))) mark();
  });
  observer.observe(root, { childList: true, subtree: true });
  mark();
  return () => observer.disconnect();
};

let installed = false;
/** Called once, from `main.tsx`. */
export const installSurfaceMotion = () => {
  if (installed || typeof document === "undefined") return;
  installed = true;
  watchLeaving();
  watchSheets();
};
