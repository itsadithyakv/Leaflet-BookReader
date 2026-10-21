/**
 * Showing a chapter on the page without making the page lay itself out again.
 *
 * epub.js shows every chapter within reach each time it looks at the page,
 * which is every 30 ms while the page scrolls, and Smart Read, auto-scroll
 * and read aloud scroll it all the time. Each show set a transform on the
 * chapter's frame, read its width (a forced layout of the whole page) and
 * took the transform away again: a reminder for Safari to redraw the frame.
 * Leaflet runs on Chromium (WebView2, Android's WebView), and the chapter was
 * already showing: on the emulator that was 70 layouts a second and frames
 * dropped while the page moved.
 *
 * Now a chapter already showing is left as it is; one coming out of hiding
 * is shown as epub.js shows it, reminder and all.
 */

export type ShowableView = {
  element?: HTMLElement | null;
  iframe?: HTMLElement | null;
  show: () => void;
  emit?: (event: string, ...args: unknown[]) => void;
};

/** Whether the chapter and its frame are both showing already. */
export const alreadyShown = (view: ShowableView) =>
  view.element?.style.visibility === "visible" && (!view.iframe || view.iframe.style.visibility === "visible");

/** Makes `view.show` do nothing to a chapter already showing (but still say it is shown, as epub.js does). */
export const quietShow = <T extends ShowableView>(view: T): T => {
  const show = view.show.bind(view);
  view.show = () => {
    if (!alreadyShown(view)) {
      show();
      return;
    }
    view.emit?.("shown", view);
  };
  return view;
};
