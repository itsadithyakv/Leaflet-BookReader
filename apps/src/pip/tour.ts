/**
 * Pip's tour of the app. Each stop names an element by its data-tour (or the
 * logo, Pip's home); Pip jumps or rolls there, stands on it, and points.
 * Stops whose element is not on screen (the search box on a narrow window,
 * say) are skipped rather than pointed at empty space.
 */
export type TourStop = {
  /** A selector for the thing Pip points at; null means Pip itself. */
  target: string | null;
  line: string;
  /** What she says instead under a finger (a phone): no dropping files, no clicking, no right button. */
  touch?: string;
};

/** The line for this stop, for a finger or a pointer. */
export const tourLine = (stop: TourStop, touch: boolean) => (touch && stop.touch) || stop.line;

export const TOUR: TourStop[] = [
  { target: "[data-pip-home]", line: "hi! i'm pip. that logo is my home. i hop out to keep you company." },
  { target: '[data-tour="import"]', line: "first things first: drop your books in here. epub, pdf, comics, all of it.", touch: "first things first: add your books here. epub, pdf, comics, all of it." },
  { target: '[data-tour="session"]', line: "start a focus session and i'll count your minutes. each one earns seeds to spend on me." },
  { target: '[data-tour="nav"]', line: "your collections, reading stats and my room live down this spine.", touch: "your collections, reading stats and my room live along here." },
  { target: '[data-tour="backup"]', line: "that's you, up here. your profile and your backup live behind this." },
  { target: '[data-tour="search"]', line: "lost a book? search the whole archive up here." },
  { target: null, line: "that's it! grab me by the leaf and throw me, right-click me for shortcuts, and click the logo to send me home.",
    touch: "that's it! grab me by the leaf and throw me, hold me still for shortcuts, and tap the logo to send me home."
  }
];
