import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Whether the page this is part of is the one on screen.
 *
 * The Library stays mounted while another tab is shown (App.tsx): coming back
 * to it used to build the whole shelf again (0.45 s with the CPU at a quarter
 * of a laptop's speed; 0.16 s kept). Kept, it is out of the layout (`display: none`), and what in it
 * watches the window (the list's virtualizer, the grid's width, the drop
 * target, the session clock's ending) asks this and rests while it is false.
 * Anything not inside a kept page is always shown.
 */
export const PageShownContext = createContext(true);

export const usePageShown = () => useContext(PageShownContext);

const HIDDEN = { display: "none" } as const;

/** The style of a kept page's outermost box: out of the layout while hidden. */
export const keptPageStyle = (shown: boolean) => (shown ? undefined : HIDDEN);

/**
 * For something open over a kept page (a book's menu, a sheet): closed when the
 * page is hidden, as it was when the page went away with it.
 */
export const useCloseWhenHidden = (close: () => void) => {
  const shown = usePageShown();
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!shown) {
      latest.current();
    }
  }, [shown]);
};

/** `useCloseWhenHidden` as an element, to put inside what is open. */
export const CloseWhenHidden = ({ onClose }: { onClose: () => void }) => {
  useCloseWhenHidden(onClose);
  return null;
};
