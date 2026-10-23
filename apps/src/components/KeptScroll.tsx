import { useEffect, useLayoutEffect, useRef } from "react";
import { usePageShown } from "../hooks/pageShown";

const scroller = () => document.querySelector<HTMLElement>(".app-main-scroll");

/**
 * A kept page's place in the scroll area that every page shares: taken from
 * each scroll while the page is shown, and not from the ones while it is
 * hidden (the other page's, and the one that hiding causes when the other
 * page is shorter).
 */
export const placeKeeper = (start: number | null = null) => {
  let place = start;
  let shown = true;
  return {
    show(value: boolean) {
      shown = value;
    },
    scrolled(top: number) {
      if (shown) {
        place = top;
      }
    },
    /** Where the page was when last shown (null before any scroll was seen). */
    get place() {
      return place;
    }
  };
};

/**
 * A kept page's place in the app's scroll area (`.app-main-scroll`), put back
 * when it is shown again (pages/LibraryPage.tsx). Rendered first inside the
 * page, so that its layout effect runs before those of what comes after it:
 * the list's virtualizer reads the place as it wakes, and must find this one,
 * not the place the other tab left.
 */
export const KeptScroll = () => {
  const shown = usePageShown();
  // The page is made with the app, at the top of the scroll area: its place is 0 until it is scrolled
  // (read from the scroll area here, it laid the whole page out in the middle of the first screen's work).
  const keeper = useRef(placeKeeper(0));
  const wasShown = useRef(shown);

  useLayoutEffect(() => {
    // Before the scroll event that hiding causes, so it is not taken as this page's.
    keeper.current.show(shown);
    const comingBack = shown && !wasShown.current;
    wasShown.current = shown;
    // Only coming back: at the start there is nothing to put back (and reading the place lays the page out).
    if (!comingBack) {
      return;
    }
    const element = scroller();
    const place = keeper.current.place;
    if (shown && element && place !== null && element.scrollTop !== place) {
      element.scrollTop = place;
    }
  }, [shown]);

  useEffect(() => {
    const element = scroller();
    if (!element) {
      return;
    }
    const note = () => keeper.current.scrolled(element.scrollTop);
    element.addEventListener("scroll", note, { passive: true });
    return () => element.removeEventListener("scroll", note);
  }, []);

  return null;
};
