/**
 * The room the app's header takes at the top of the page where it floats over it (a phone, either
 * way up: index.css, `--app-header-h`). That room is the header's top padding, which CSS works out
 * from the status bar's inset (`--app-header-pad-top`, styles/touch-shell.css), plus the header's
 * body below it, which only a measurement knows: `--app-header-body-h`, kept here.
 *
 * The inset is left out of the measurement on purpose. The Android side sends the real inset after
 * the first paint, and a height measured whole kept the inset it was measured with: the header
 * covered the top of the page (the Library's search field took taps meant for it) until a change of
 * tab measured it again. Left to CSS, a new inset moves the page in the same frame as the header.
 */

/** The header's height below its top padding, in px (never below 0: a hidden header measures 0). */
export const headerBodyHeight = (height: number, paddingTop: number): number => {
  const body = height - (Number.isFinite(paddingTop) ? paddingTop : 0);
  return Number.isFinite(body) && body > 0 ? Math.round(body * 100) / 100 : 0;
};

/**
 * Writes the header's body height on the shell, now and whenever the header's box changes size (its
 * buttons, a font arriving, the padding). Watched as the border box: a padding-only change does not
 * change the content box, so the default box would miss it. Returns the way to stop.
 */
export const watchHeaderRoom = (shell: HTMLElement, header: HTMLElement): (() => void) => {
  const note = () => {
    const paddingTop = parseFloat(getComputedStyle(header).paddingTop);
    shell.style.setProperty("--app-header-body-h", `${headerBodyHeight(header.getBoundingClientRect().height, paddingTop)}px`);
  };
  note();
  if (typeof ResizeObserver === "undefined") {
    return () => undefined;
  }
  const watch = new ResizeObserver(note);
  watch.observe(header, { box: "border-box" });
  return () => watch.disconnect();
};
