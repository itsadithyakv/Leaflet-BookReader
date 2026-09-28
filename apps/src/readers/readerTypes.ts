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

export type SmartSession = {
  startedAt: number;
  activeMs: number;
  lastTickAt: number;
  startIndex: number;
  furthestIndex: number;
  difficultyTotal: number;
  difficultySamples: number;
  rereads: number;
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
