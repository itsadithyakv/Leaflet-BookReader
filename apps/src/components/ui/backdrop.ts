import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * A dialog's backdrop closes it on a tap or click on the backdrop itself:
 * spread on the backdrop, `{...backdropClose(close)}`.
 *
 * On the click, not on the press. A finger's tap sends its press, its lift
 * and its click one after another; a backdrop gone at the press left the
 * lift and the click to land on whatever was under it (a book, a button).
 * And only when the press began on the backdrop too, so a drag that selects
 * text in the dialog and lets go outside it does not close it.
 */
export const backdropClose = (close: () => void) => ({
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.dataset.pressedHere = event.target === event.currentTarget ? "yes" : "";
  },
  onClick: (event: ReactMouseEvent<HTMLElement>) => {
    const pressedHere = event.currentTarget.dataset.pressedHere === "yes";
    event.currentTarget.dataset.pressedHere = "";
    if (event.target !== event.currentTarget) return;
    // A portal's click still bubbles to the React parent (a book card, say): it stops here.
    event.stopPropagation();
    if (pressedHere) close();
  }
});
