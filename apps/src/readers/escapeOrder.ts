/**
 * What Escape closes. It used to go straight to leaving the book (or, under
 * focus lock, to the exit guard) whenever the keyboard was in the text, even
 * with search, the notes or a dialog open over it. It closes the nearest
 * thing first: what is on top, then the panels, then a selection, then
 * whatever is playing, and only then the book.
 */

export type EscapeLayer =
  /** A picture opened large: over everything. */
  | "picture"
  /** The keyboard shortcuts sheet. */
  | "shortcuts"
  /** "Where should reading begin?" */
  | "startDialog"
  /** The walkthrough. */
  | "tour"
  /** The progress bar's handle, held: let go without going anywhere. */
  | "seek"
  /** A card opened from a name in the text or from the selection bar (who a character is). */
  | "character"
  /** The look-up card, which belongs to the selection under it. */
  | "lookup"
  /** A footnote shown in place. */
  | "note"
  | "search"
  /** The type panel, the notes and the ··· menu, under their toolbar buttons. */
  | "typePanel"
  | "notesPanel"
  | "moreMenu"
  /** Any other panel over the page (the characters panel). */
  | "sidePanel"
  /** The chapter list. */
  | "chapters"
  /** Selected text and its bar. */
  | "selection"
  /** SpeedRead's stage: back to the page. */
  | "speedRead"
  /** Auto-scroll running, or Smart Read not paused: stop it where it is. */
  | "playing";

/** Nearest first. */
export const ESCAPE_ORDER: EscapeLayer[] = [
  "picture",
  "shortcuts",
  "startDialog",
  "tour",
  "seek",
  "character",
  "lookup",
  "note",
  "search",
  "typePanel",
  "notesPanel",
  "moreMenu",
  "sidePanel",
  "chapters",
  "selection",
  "speedRead",
  "playing"
];

/** What one press of Escape closes, given what is open; "exit" when nothing is: leave the book. */
export const escapeTarget = (open: Partial<Record<EscapeLayer, boolean>>): EscapeLayer | "exit" =>
  ESCAPE_ORDER.find((layer) => open[layer]) ?? "exit";
