import { useSheetSwipe } from "../components/ui/sheetSwipe";

/**
 * The reader's panels that rise from the foot as sheets on an upright phone
 * (readers/touch.css, "Sheets"): Aa, ···, the sound, notes and bookmarks,
 * search. Each closes by a swipe down, as the app's own sheets do
 * (components/ui/sheetSwipe.ts).
 */
export const READER_SHEETS = ".reader-toolbar .reader-menu, .reader-toolbar .ambience-popover, .reader-notes-panel, .reader-search";

/** The reader sheet a touch is in, on an upright phone. */
export const readerSheetAt = (target: Element): HTMLElement | null => {
  const panel = target.closest<HTMLElement>(READER_SHEETS);
  return panel?.closest('.reader-scope[data-shape="upright"]') ? panel : null;
};

/** While `upright`, a swipe down a reader sheet closes it with `close` (the same as a tap above it, or Back). */
export const useReaderSheetSwipe = (upright: boolean, close: (panel: HTMLElement) => void) =>
  useSheetSwipe(() => document, { panelFor: readerSheetAt, onClose: close }, upright);
