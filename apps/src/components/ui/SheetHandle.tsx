import { useRef } from "react";
import { onTopEdge, useSheetSwipe } from "./sheetSwipe";

/**
 * The grip at the top of a dialog drawn as a sheet on a phone
 * (`.sheet-panel`, styles/touch-shell.css). Pulled down by the grip, or
 * anywhere on the sheet while it is scrolled to its top, the sheet follows
 * the finger, and let go far enough down (or flicked) it closes
 * (components/ui/sheetSwipe.ts). Not drawn where the dialog is a centred
 * card, and then the sheet does not move either. Back and a tap outside
 * close it too; this is the third way, where the thumb already is.
 */
export const SheetHandle = ({ onClose }: { onClose: () => void }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  // (A test's stand-in for the DOM may have no `closest`: then there is nothing to drag.)
  const panel = () => (typeof ref.current?.closest === "function" ? ref.current.closest<HTMLElement>(".sheet-panel") : null);
  useSheetSwipe(panel, {
    // Only while the grip shows: a centred card on a wide screen stays put.
    panelFor: () => (ref.current && ref.current.offsetParent !== null ? panel() : null),
    onGrip: (target, on, y) =>
      Boolean(ref.current?.contains(target) || target.closest(".sheet-panel > h2, .sheet-panel > header")) || onTopEdge(on, y),
    onClose: () => onClose()
  });

  return (
    <div ref={ref} className="sheet-handle" aria-hidden="true">
      <span />
    </div>
  );
};
