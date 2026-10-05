/**
 * The chapter list as something a reader can find and keep.
 *
 * It slid wholly out of sight. A 16 px tab on the left edge and a toolbar
 * button were added to say it was there, and people shown the app still did
 * not find it: the tab was a sliver at 9% of the page's ink with a chevron on
 * it, and the button goes away with the toolbar. What is here: how wide the
 * margin beside the text is (so the handle on the edge can be as large as it
 * fits and never lie on the text), whether the open list fits in that margin,
 * the one showing of it on a device's first book, and whether the reader left
 * it open.
 */

import { MEASURE_EM, type ReaderLayout, type ReaderMeasure } from "./readerTypes";

/** The list's width on a desktop window (Tailwind's `w-72`). */
export const CONTENTS_WIDTH = 288;

/** Narrower than this the list is a slide-over that covers most of the window: it is not shown unasked. */
export const PEEK_MIN_WIDTH = 768;

/** The least gutter a scrolling page keeps each side of the text (`--reader-content-pad`). */
const CONTENT_PAD = 24;
/** The scrolling page keeps a scrollbar's width clear at both edges (`scrollbar-gutter: stable both-edges`). */
const SCROLLBAR = 16;
/** With pages the viewer is the column and 96 px (`pagesViewerMaxWidth`), and the text starts 40 px or more inside it. */
const PAGES_EXTRA = 96;
const PAGES_INSET = 40;

/**
 * The room between the window's left edge and the text, in pixels, a little
 * under what it measures on screen so nothing set in it touches the text
 * (at 800 px with a 612 px column: 87 px scrolling, 89 px with pages; this
 * gives 86 for both). Scrolling, the column is centred between the two
 * scrollbar gutters with 24 px each side at the least (`MEASURE_PADDING` in
 * readerTypes.ts). With pages the viewer is centred and the text sits inside it.
 */
export const marginBesideText = (windowWidth: number, measure: ReaderMeasure, fontSize: number, layout: ReaderLayout) => {
  const em = MEASURE_EM[measure];
  // A phone or a small tablet draws its scrollbars over the page and keeps no
  // gutter for them: nothing is promised there beyond the page's own 24 px.
  const narrow = windowWidth < PEEK_MIN_WIDTH;
  if (layout === "pages") {
    const viewer = em === null ? windowWidth : Math.min(windowWidth, em * fontSize + PAGES_EXTRA);
    const margin = Math.floor(Math.max(0, (windowWidth - viewer) / 2) + PAGES_INSET);
    return narrow ? Math.max(CONTENT_PAD, margin - PAGES_INSET + CONTENT_PAD) : margin;
  }
  // A gutter at each edge, and the scrollbar itself inside the right-hand one.
  const gutter = narrow ? 0 : SCROLLBAR;
  const room = Math.max(0, windowWidth - gutter * 3);
  const column = em === null ? room : Math.min(room, em * fontSize);
  return Math.floor(gutter + Math.max(CONTENT_PAD, (room - column) / 2));
};

/** The handle on the left edge: with its word when the margin holds it, an icon alone in a narrow one. */
export type HandleSize = "word" | "icon";

/** The handle's width for each size, in pixels (set again in contentsList.css). */
export const HANDLE_WIDTH: Record<HandleSize, number> = { word: 30, icon: 20 };

/** The largest handle the margin holds without lying on the text. */
export const handleSizeFor = (margin: number): HandleSize => (margin >= HANDLE_WIDTH.word + 6 ? "word" : "icon");

/** Whether the open list fits in the margin, beside the text and not over it. */
export const listFitsBeside = (margin: number) => margin >= CONTENTS_WIDTH;

/** How long the list stays open the one time it shows itself. */
export const PEEK_MS = 2800;

const SEEN_KEY = "leaflet.reader.contentsSeen";
const OPEN_KEY = "leaflet.reader.contentsOpen";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // This session only.
  }
};

/** Whether this device has been shown where the list lives. Without storage: yes, or it would show on every book. */
export const contentsSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
};

export const setContentsSeen = () => write(SEEN_KEY, "1");

/** The list shows itself once: on a device that has not seen it, in a window wide enough for it. */
export const shouldPeek = (seen: boolean, windowWidth: number) => !seen && windowWidth >= PEEK_MIN_WIDTH;

/**
 * Whether the reader left the list open: the book's own answer when it has
 * one (`sidebarOpen` in `leaflet.reader.<id>`), else the last choice made on
 * this device.
 */
export const leftOpen = (bookAnswer: boolean | undefined) => bookAnswer ?? read(OPEN_KEY) === "1";

export const saveLeftOpen = (open: boolean) => write(OPEN_KEY, open ? "1" : "0");

/**
 * Whether a list left open comes back open with the book: only where it fits
 * beside the text. Over the text it would be the first thing in the way.
 */
export const reopensWith = (wasLeftOpen: boolean, margin: number) => wasLeftOpen && listFitsBeside(margin);
