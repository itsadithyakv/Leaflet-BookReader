/**
 * The book's title in the reader's toolbar. It is set large, and a long one
 * ("The Communist Manifesto in Plain and Simple English (A Modern Translation
 * and the Original Version)") wrapped onto a second line and made the bar
 * taller. A longer title is set smaller, always on one line; what still does
 * not fit ends in an ellipsis, with the whole title in the tooltip.
 */
export const titleSizeClass = (title: string) => {
  const length = title.trim().length;
  return length <= 34 ? "text-xl" : length <= 60 ? "text-base" : "text-sm";
};

/**
 * Classes for the toolbar's title: its size for its length, one line, never
 * wider than the room between the buttons. The title is centred on the window,
 * so that room is twice the gap to the nearer group: the right one, up to six
 * buttons (with the radio's mark) and 294 px from the edge. 46vw fits from
 * about 1,150 px up; under that (the title shows from 768) a long title lay
 * 7 px over the chapters button and 32 over "Text settings" in an 800 px
 * window.
 */
export const toolbarTitleClass = (title: string) =>
  `max-w-[min(46vw,calc(100vw-39rem))] truncate font-headline font-bold reader-accent ${titleSizeClass(title)}`;
