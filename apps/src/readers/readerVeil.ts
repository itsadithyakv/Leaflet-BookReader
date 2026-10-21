/**
 * The veil over the page while the book is laid out again: a turn of the
 * phone, or Scroll and Pages swapped in the type panel. It is the page's own
 * colour (the finish's, true black included), goes up the moment the change
 * starts, and lifts with a short fade once the book is drawn at the reader's
 * place in its new shape, so what the reader sees is the page as it was and
 * then the page as it will stay: never the book half laid out, emptied and
 * drawn again, or the text jumping to the place.
 *
 * It covers the page and not the bars: the toolbar, the strip and a sheet
 * (the type panel the switch was made in) stay over it. A reduced-motion
 * reader gets no fade (readers/touch.css). The app's own veil for a turn it
 * makes (platform/shape.ts, Pip's tab) is the same idea for the shell.
 */

/** How long the veil takes to lift (readers/touch.css, `.reader-veil`). */
export const READER_VEIL_LIFT_MS = 200;
/** It lifts by this long after going up, whatever happens: never a page left covered. */
export const READER_VEIL_CAP_MS = 3000;
/**
 * A turn is laid out once, when the window has kept its size this long. A
 * phone turning passes through sizes that are neither way up (the old height
 * at the new width, the bars coming back), and each was a layout of the
 * whole book on a phone that takes a good part of a second over one.
 */
export const TURN_SETTLE_MS = 220;
/** The screen says it is the way up the window is (`screen.orientation`): the turn has landed, and waits only this long. */
export const TURN_LANDED_MS = 60;

/** How long a turn waits, now, for the window to keep its size: less once the screen agrees with the window. */
export const turnSettleMs = (width: number, height: number, screenType: string | undefined): number => {
  if (!screenType || width === height) return TURN_SETTLE_MS;
  return screenType.startsWith("portrait") === width < height ? TURN_LANDED_MS : TURN_SETTLE_MS;
};

/** The same, for the window and the screen as they are. */
export const turnSettleNow = () =>
  typeof window === "undefined"
    ? TURN_SETTLE_MS
    : turnSettleMs(window.innerWidth, window.innerHeight, typeof screen === "undefined" ? undefined : screen.orientation?.type);

type Veil = { node: HTMLElement; cap: ReturnType<typeof setTimeout>; lifting: boolean; wait: ReturnType<typeof setTimeout> | null };
let veil: Veil | null = null;

const frame = (run: () => void) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
};

const hostOf = (from: Element | null | undefined): HTMLElement | null => {
  const host = from?.closest?.(".reader-scope") ?? (typeof document === "undefined" ? null : document.querySelector(".reader-scope"));
  return host instanceof HTMLElement ? host : null;
};

/** Whether the veil is over the page now (and not on its way off). */
export const readerVeilUp = () => veil !== null && !veil.lifting;

/** Puts the veil over the reader's page (`from`: any element inside the reader). Up already: it stays. */
export const raiseReaderVeil = (from?: Element | null) => {
  if (veil) {
    if (veil.lifting) {
      // Lifting already: down again, at once.
      veil.lifting = false;
      veil.node.classList.remove("is-lifting");
    }
    if (veil.wait !== null) {
      clearTimeout(veil.wait);
      veil.wait = null;
    }
    clearTimeout(veil.cap);
    veil.cap = setTimeout(() => liftReaderVeil(), READER_VEIL_CAP_MS);
    return;
  }
  const host = hostOf(from);
  if (!host) return;
  const node = document.createElement("div");
  node.className = "reader-veil";
  node.setAttribute("aria-hidden", "true");
  host.appendChild(node);
  veil = { node, cap: setTimeout(() => liftReaderVeil(), READER_VEIL_CAP_MS), lifting: false, wait: null };
};

/**
 * Lifts the veil, `afterMs` from now and two frames after that (the page
 * drawn in its new shape before it is shown). Nothing when it is not up.
 */
export const liftReaderVeil = (afterMs = 0) => {
  const current = veil;
  if (!current || current.lifting) return;
  if (current.wait !== null) clearTimeout(current.wait);
  const go = () => {
    current.wait = null;
    frame(() =>
      frame(() => {
        if (veil !== current || current.lifting) return;
        current.lifting = true;
        clearTimeout(current.cap);
        current.node.classList.add("is-lifting");
        setTimeout(() => {
          if (veil !== current || !current.lifting) return;
          current.node.remove();
          veil = null;
        }, READER_VEIL_LIFT_MS + 40);
      })
    );
  };
  if (afterMs > 0) current.wait = setTimeout(go, afterMs);
  else go();
};

/** Takes the veil away at once (the reader closing). */
export const dropReaderVeil = () => {
  if (!veil) return;
  clearTimeout(veil.cap);
  if (veil.wait !== null) clearTimeout(veil.wait);
  veil.node.remove();
  veil = null;
};
