/**
 * Told when the display's scaling changes: the window dragged to a monitor at
 * 150% from one at 100%, or the scaling changed in the system's settings.
 * Neither always fires `resize` (the window can keep its size in CSS pixels),
 * and anything drawn at a whole number of device pixels has to be measured
 * again when it happens.
 *
 * A media query matches one scaling, so the listener is on the query for the
 * scaling there is now, and is put on a new one each time that changes.
 */

/** The media query that matches while the display's scaling is `ratio` (and stops matching when it is not). */
export const ratioQuery = (ratio: number) => `(resolution: ${Number.isFinite(ratio) && ratio > 0 ? ratio : 1}dppx)`;

type RatioView = Pick<Window, "matchMedia" | "devicePixelRatio">;

/**
 * Calls `onChange` each time the scaling changes, with the new one. Returns
 * how to stop. Where the query cannot be made (an old webview), nothing is
 * watched: `resize` is then all there is.
 */
export const watchPixelRatio = (onChange: (ratio: number) => void, view: RatioView = window) => {
  let query: MediaQueryList | null = null;
  let stopped = false;
  const changed = () => {
    if (stopped) return;
    arm();
    onChange(view.devicePixelRatio || 1);
  };
  const arm = () => {
    query?.removeEventListener("change", changed);
    try {
      query = view.matchMedia(ratioQuery(view.devicePixelRatio || 1));
      query.addEventListener("change", changed);
    } catch {
      query = null;
    }
  };
  arm();
  return () => {
    stopped = true;
    query?.removeEventListener("change", changed);
    query = null;
  };
};
