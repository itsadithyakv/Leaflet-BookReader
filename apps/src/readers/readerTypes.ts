/** Types shared by the reader and its helpers. */

export type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
};

export type ReaderDisplayMode = "paper" | "dark-paper" | "true-white" | "true-black" | "app";
export type ReadingMode = "standard" | "smart" | "speed";

export type ReaderWord = {
  text: string;
  trailing: string;
  node: Text;
  start: number;
  end: number;
  difficulty: number;
  rsvpPauseMultiplier: number;
  sentenceEnd: boolean;
  paragraphEnd: boolean;
  iframe: HTMLIFrameElement;
};

export type ReadingWordState = {
  index: number;
  total: number;
  text: string;
  /** Punctuation after the word ("," or ".”"), shown in RSVP so sentences still read as sentences. */
  punctuation: string;
  contextStart: number;
  context: Array<{ text: string; trailing: string; index: number }>;
};

/** Smart Read through one chapter. */
export type SmartSession = {
  startedAt: number;
  /** Time Dotty was moving: pauses, waits and time away are left out. */
  activeMs: number;
  lastTickAt: number;
  /** Where the reader and Dotty last agreed, which the reader's own pace is measured from. */
  anchorIndex: number;
  anchorActiveMs: number;
  /** Read at Dotty's pace since then with no correction: a sign the pace suits. */
  acceptedWords: number;
  acceptedMs: number;
};

/** Scrolling through a chapter, or turning pages. */
export type ReaderLayout = "scroll" | "pages";

export const LAYOUT_KEY = "leaflet.reader.layout";

export const readLayout = (): ReaderLayout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "pages" ? "pages" : "scroll";
  } catch {
    return "scroll";
  }
};
