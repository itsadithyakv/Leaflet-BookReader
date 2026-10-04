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

/** Classes for the toolbar's title: its size for its length, one line, never wider than the room between the buttons. */
export const toolbarTitleClass = (title: string) =>
  `max-w-[46vw] truncate font-headline font-bold reader-accent ${titleSizeClass(title)}`;
