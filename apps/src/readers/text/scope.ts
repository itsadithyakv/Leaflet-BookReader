import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Book } from "@shared/models/book";
import type { useReadingHeartbeat } from "../../hooks/useReadingHeartbeat";
import type { useAnnotations } from "../useAnnotations";
import type { ReaderWord, SmartSession } from "../readerTypes";
import type { NoteRun } from "../footnotes";
import type { usePeopleReader } from "../people/usePeopleReader";
import type { useReaderCore } from "./useReaderCore";
import type { useReadingPace } from "./useReadingPace";
import type { useReaderLook } from "./useReaderLook";
import type { useReaderScroll } from "./useReaderScroll";
import type { useReaderWords } from "./useReaderWords";
import type { useAutoScroll } from "./useAutoScroll";
import type { useSmartRead } from "./useSmartRead";
import type { useReaderDot } from "./useReaderDot";
import type { useReaderPlace } from "./useReaderPlace";
import type { useChapters } from "./useChapters";
import type { useReaderOutlook } from "./useReaderOutlook";
import type { useReaderMarks, useBookAnnotations, useSelectionDock } from "./useReaderMarks";
import type { useNotesAndPictures } from "./useNotesAndPictures";
import type { useContentsList } from "./useContentsList";
import type { usePageTurning } from "./usePageTurning";
import type { useReaderPanels } from "./useReaderPanels";
import type { useReadingModes, useReadingHold } from "./useReadingModes";
import type { useReaderPrefs } from "./useReaderPrefs";
import type { useReaderSession } from "./useReaderSession";
import type { useReaderKeys } from "./useReaderKeys";
import type { useReaderChrome } from "./useReaderChrome";
import type { useReaderCover } from "./useReaderCover";

/** What the page hands the reader. */
export type ReaderProps = {
  book: Book;
  onClose: () => void;
  /** Open at this place (a highlight picked outside the reader) rather than where the reading stopped. */
  openAt: string | null;
};

// What each hook finds in the scope when it is called: all that the hooks
// called before it have added, in the order pages/ReaderView.tsx calls them.
export type WithCore = ReaderProps & ReturnType<typeof useReaderCore>;
export type WithPace = WithCore & ReturnType<typeof useReadingPace>;
export type WithLook = WithPace & ReturnType<typeof useReaderLook>;
export type WithScroll = WithLook & ReturnType<typeof useReaderScroll>;
export type WithWords = WithScroll & ReturnType<typeof useReaderWords>;
export type WithAuto = WithWords & ReturnType<typeof useAutoScroll>;
export type WithSmart = WithAuto & ReturnType<typeof useSmartRead>;
export type WithDot = WithSmart & ReturnType<typeof useReaderDot>;
export type WithPlace = WithDot & ReturnType<typeof useReaderPlace>;
export type WithChapters = WithPlace & ReturnType<typeof useChapters>;
export type WithOutlook = WithChapters & ReturnType<typeof useReaderOutlook>;
export type WithMarks = WithOutlook & ReturnType<typeof useReaderMarks>;
export type WithNotes = WithMarks & ReturnType<typeof useNotesAndPictures>;
export type WithContentsList = WithNotes & ReturnType<typeof useContentsList>;
export type WithPages = WithContentsList & ReturnType<typeof usePageTurning>;
export type WithPanels = WithPages & ReturnType<typeof useReaderPanels>;
export type WithModes = WithPanels & ReturnType<typeof useReadingModes>;
export type WithPrefs = WithModes & ReturnType<typeof useReaderPrefs>;
export type WithSession = WithPrefs & ReturnType<typeof useReaderSession>;
export type WithKeys = WithSession & ReturnType<typeof useReaderKeys>;
export type WithChrome = WithKeys & ReturnType<typeof useReaderChrome>;
export type WithHold = WithChrome & ReturnType<typeof useReadingHold>;
export type WithAnnotations = WithHold & ReturnType<typeof useBookAnnotations>;
export type WithCover = WithAnnotations & ReturnType<typeof useReaderCover>;
export type WithSelectionDock = WithCover & ReturnType<typeof useSelectionDock>;

/** The whole scope, once every hook has run: what the components draw from. */
export type ReaderScope = WithSelectionDock;

/**
 * What a hook reaches that a hook called after it adds. It is there by the
 * time anything is called (an effect, a handler), never while rendering, so
 * it is read through the scope where it is used and not taken out at the top.
 * Written out, because two hooks' types cannot each be worked out from the
 * other; where ReaderView hands the scope to a hook, these are checked
 * against what the hooks really return.
 */
export interface ReaderLater {
  // useAutoScroll
  setAutoScrollActive: Dispatch<SetStateAction<boolean>>;
  // useSmartRead
  cancelSmartPageTurn: () => void;
  smartSessionRef: MutableRefObject<SmartSession | null>;
  agreeWithReader: (index: number) => void;
  smartPictureRef: MutableRefObject<{ before: ReaderWord } | null>;
  placeDotAtPicture: () => boolean;
  smartStepHoldUntilRef: MutableRefObject<number>;
  // useReaderDot
  readerDotElementRef: MutableRefObject<HTMLElement | null>;
  readerDotAnchorIndexRef: MutableRefObject<number | null>;
  readerDotUserAnchorUntilRef: MutableRefObject<number>;
  positionReaderDotAtWord: (index: number) => void;
  readerDotEnabledRef: MutableRefObject<boolean>;
  refreshReaderDot: (now?: boolean) => void;
  moveReaderDot: (dot: HTMLElement, container: HTMLElement, top: number, left: number) => void;
  // useReaderOutlook
  sectionWordsRef: MutableRefObject<Map<number, number>>;
  updateOutlookRef: MutableRefObject<() => void>;
  chapterEntryRef: MutableRefObject<number>;
  // useNotesAndPictures
  noteRequestRef: MutableRefObject<number>;
  setNote: Dispatch<SetStateAction<{ href: string; marker: string; paragraphs: NoteRun[][]; truncated: boolean } | null>>;
  // usePageTurning
  goToPageEdge: (edge: "chapterStart" | "chapterEnd" | "bookStart" | "bookEnd") => void;
  // useReaderPrefs
  persistReaderState: (override?: Partial<{ cfi: string; cfiProgress: number; chapterPositions: Record<string, string> }>) => void;
  // useReaderSession
  markReadingActivity: ReturnType<typeof useReadingHeartbeat>;
  // useReaderChrome
  people: ReturnType<typeof usePeopleReader>;
  // useBookAnnotations
  annotations: ReturnType<typeof useAnnotations>;
  orderedHighlights: ReturnType<typeof useAnnotations>["highlights"];
}

export type Later<Name extends keyof ReaderLater> = Pick<ReaderLater, Name>;
