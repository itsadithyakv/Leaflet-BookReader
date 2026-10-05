import { useRef, useState } from "react";
import { isChapterLike, progressToSave } from "../progress";
import { isFinished } from "../../constants/books";
import { PAGE_TOP_PAD } from "../finish";
import { tocEntryAt } from "../toc";
import { predictWpm, readerPace } from "../paceModel";
import type { Outlook } from "../ReadingOutlook";
import { chapterEndFor, minutesFor, steadyMinutes, wordsLeft, wordsPerByte } from "../timeLeft";
import { chapterThrough, noteReadingPlace } from "../../pip/readingMoments";
import { elementById } from "../footnotes";
import { fractionAt, seekTarget } from "../seek";
import { anchorElement } from "../contentsScan";
import { beforeStory, chapterTail } from "../chapterSpan";
import { bookOfSection, crossedStoryEnd, fractionOfBook, labelInBook } from "../innerBooks";
import type { WithChapters } from "./scope";

/**
 * The chapter being read, how far through the book that is, and how long is
 * left: what the dock shows.
 */
export const useReaderOutlook = (reader: WithChapters) => {
  const {
    askedEntryRef, book, chapterStarts, displayedViews, holdPill, initialPrefs, innerBooksRef, lastCfiProgressRef,
    lastComputedProgressRef, lastProgressRef, layoutRef, linePx, lookingBetweenStories, nextHeadingShare, paceContext,
    paceProfileRef, pillHeldRef, renditionRef, sectionPlace, sectionWeightsRef, showFocusToastRef, storyEndInView,
    storyGapsRef, tocLabelsRef, tocPlacesRef, tocSpineStartsRef, tocWithinRef
  } = reader;
  // The contents entry being read (its place in the list, -1 before the
  // first) and its name: what the dock shows and the chapter list marks.
  const [chapterEntry, setChapterEntry] = useState(-1);
  const chapterEntryRef = useRef(-1);
  const [chapterLabel, setChapterLabel] = useState("");
  /** The chapter as the book names it; the book's title where the contents name nothing (a cover, a book with no contents). */
  const [chapterInBook, setChapterInBook] = useState<{ book: string; chapter: string } | null>(null);
  const formatChapterDisplay = () => chapterLabel || book.title;

  // For the time left (readers/timeLeft.ts): the words counted in each section
  // seen, the words a byte has held (remembered with the book, so the
  // estimate does not start over each visit), and where chapters start.
  const sectionWordsRef = useRef(new Map<number, number>());
  const wordRatioRef = useRef<{ ratio: number; bytes: number } | null>(
    typeof initialPrefs?.wordsPerByte?.ratio === "number" && typeof initialPrefs?.wordsPerByte?.bytes === "number"
      ? initialPrefs.wordsPerByte
      : null
  );

  const shownMinutesRef = useRef<{ chapter: number | null; book: number | null; inner?: number | null }>({ chapter: null, book: null });
  /** How far through the book, and how long is left: shown in the chapter dock. */
  const [outlook, setOutlook] = useState<Outlook>({
    progress: typeof book.progress === "number" ? book.progress : null,
    chapter: null,
    book: null
  });

  // Called from epub.js's relocation handler and the word index, both bound once.
  const updateOutlookRef = useRef<() => void>(() => undefined);

  /**
   * Names the chapter being read: the contents entry the reading line is
   * under (readers/toc.ts), for the dock and the chapter list. A file can
   * hold several chapters; an entry's anchor counts once it is at the reading
   * line (or, with pages, on the page showing or before it).
   */
  const noteChapterHere = (section: number | undefined) => {
    if (typeof section !== "number") {
      return;
    }
    const container = (renditionRef.current?.manager as any)?.container as HTMLElement | undefined;
    const view = displayedViews().find((shown) => shown?.section?.index === section);
    const doc = view?.contents?.document as Document | undefined;
    const frame = doc?.defaultView?.frameElement as HTMLElement | null | undefined;
    const reached = (anchor: string) => {
      // An id in the file, or a place in it for an entry with no id (a made chapter list): a CFI.
      let target: { getBoundingClientRect: () => DOMRect } | null = null;
      if (doc && anchor.startsWith("epubcfi(")) {
        try {
          // (The element there, not the range: a CFI that names an element comes back as an empty range, whose box is all zeros.)
          target = anchorElement(doc, anchor);
        } catch {
          target = null;
        }
      } else if (doc) {
        target = elementById(doc, anchor);
      }
      if (!target || !frame || !container) {
        return false;
      }
      const box = container.getBoundingClientRect();
      const at = target.getBoundingClientRect();
      const within = frame.getBoundingClientRect();
      if (layoutRef.current === "scroll") {
        return within.top + at.top - box.top <= PAGE_TOP_PAD + linePx();
      }
      // With pages: on an earlier page, yes; on a later one, no. On the page
      // showing, a page belongs to the chapter at its top (readers/
      // chapterSpan.ts: chapterOnPage): a heading part-way down it is the
      // next page's chapter, unless the reader asked for that chapter. (It
      // used to count as soon as it was on the page: End, on a chapter's
      // last page, named the chapter after.) A heading at the head of its
      // file, with only a picture or space above it, is at the top.
      const across = within.left + at.left - box.left;
      if (across < 0 || across >= box.width) {
        return across < 0;
      }
      const index = tocPlacesRef.current.findIndex((place) => place.spine === section && (place.anchor === anchor || place.cfi === anchor));
      return (tocWithinRef.current[index] ?? 0) <= 0 || at.top <= PAGE_TOP_PAD + linePx() * 1.5 || askedEntryRef.current?.entry === index;
    };
    const entry = tocEntryAt(tocPlacesRef.current, section, reached);
    chapterEntryRef.current = entry;
    setChapterEntry(entry);
    // In a set of books the chapter is named with its book: "Tyrion" is in all four.
    const inner = innerBooksRef.current[bookOfSection(innerBooksRef.current, section)];
    const own = entry >= 0 ? (tocLabelsRef.current[entry] ?? "") : "";
    setChapterLabel(labelInBook(inner?.label, own));
    // For the dock, which shows the two apart (the book's name gives way first on a narrow window).
    setChapterInBook(inner && labelInBook(inner.label, own) !== own ? { book: inner.label, chapter: own } : null);
  };

  /**
   * Lets the Smart Read pill show once the reading line is in the story, on
   * a page with words (readers/chapterSpan.ts: beforeStory). Held from the
   * opening of a book in Smart Read.
   */
  const releasePill = (place: { section: number } | null) => {
    if (!pillHeldRef.current || !place) {
      return;
    }
    const weights = sectionWeightsRef.current;
    if (!weights) {
      holdPill(false);
      return;
    }
    const firstChapter = tocLabelsRef.current.findIndex((label) => isChapterLike(label));
    if (beforeStory({ section: place.section, entry: chapterEntryRef.current }, { lo: weights.lo, firstChapter, firstChapterSection: tocPlacesRef.current[firstChapter]?.spine })) {
      return;
    }
    // A page that is one picture (a part's title) is not text to set off on.
    const view = displayedViews().find((shown) => shown?.section?.index === place.section);
    if (((view?.contents?.document as Document | undefined)?.body?.textContent ?? "").trim().length >= 200) {
      holdPill(false);
    }
  };

  /**
   * How far through the book, and how long is left in the chapter and the
   * book at this reader's pace (readers/timeLeft.ts). Nothing is said of time
   * until there is a pace to go on: this book's own, or five minutes of
   * reading anywhere.
   */
  const updateOutlook = () => {
    const weights = sectionWeightsRef.current;
    const place = sectionPlace();
    noteChapterHere(place?.section);
    releasePill(place);
    // For Pip (pip/readingMoments.ts): how far through its chapter the reading line is, within the story.
    noteReadingPlace(
      book.id,
      weights && place && place.section >= weights.lo && place.section <= weights.hi
        ? chapterThrough(weights.bytes, tocSpineStartsRef.current, place.section, place.within, weights.hi)
        : null
    );
    const profile = paceProfileRef.current;
    const paceKnown = Boolean(profile.books[book.id]) || readerPace(profile, Date.now()).minutes >= 5;
    let chapter: number | null = null;
    let whole: number | null = null;
    // In a set of books (readers/innerBooks.ts) "the book" is the novel being read.
    const innerBooks = innerBooksRef.current;
    // The place the percentage stands for: the reading line within the story;
    // where the progress already is when the reader is looking outside it
    // (front or back matter, or between two stories of a set).
    const inStory = Boolean(weights && place && place.section >= weights.lo && place.section <= weights.hi && !lookingBetweenStories(place.section));
    const known = lastCfiProgressRef.current ?? (lastComputedProgressRef.current >= 0 ? lastComputedProgressRef.current : null);
    const standsAt = inStory || !weights || known === null ? place : seekTarget(weights, known);
    const innerBook = standsAt && innerBooks.length > 0 ? innerBooks[bookOfSection(innerBooks, standsAt.section)] : undefined;
    let innerMinutes: number | null = null;
    // (From the story's own sections: contents pages and appendices hold far fewer words for their size.)
    const ratio = weights
      ? wordsPerByte(
          sectionWordsRef.current,
          weights.bytes,
          wordRatioRef.current,
          (section) => section >= weights.lo && section <= weights.hi && !storyGapsRef.current.some((gap) => section >= gap.from && section <= gap.to)
        )
      : null;
    if (ratio) {
      wordRatioRef.current = ratio;
    }
    if (weights && place && ratio && paceKnown && place.section < weights.bytes.length) {
      const left = wordsLeft({
        weights,
        section: place.section,
        within: place.within,
        chapterEnd: chapterEndFor(place.section, tocSpineStartsRef.current, weights.bytes.length - 1),
        // (Several chapters to a file: this one ends at the next heading. readers/chapterSpan.ts)
        chapterEndWithin: nextHeadingShare(place.section, place.within),
        chapterTail: chapterTail(chapterStarts(), place.section, chapterEntryRef.current),
        counted: sectionWordsRef.current,
        ratio: ratio.ratio
      });
      const wpm = predictWpm(profile, paceContext(), { limited: false });
      const chapterMinutes = minutesFor(left.chapter, wpm);
      const bookMinutes = left.book === null ? null : minutesFor(left.book, wpm);
      chapter = chapterMinutes === null ? null : steadyMinutes(shownMinutesRef.current.chapter, chapterMinutes);
      whole = bookMinutes === null ? null : steadyMinutes(shownMinutesRef.current.book, bookMinutes);
      if (innerBook && standsAt) {
        // To the end of this novel's own story: its appendices and the next novel are not what is left of it.
        const leftInBook = wordsLeft({
          weights: { ...weights, hi: innerBook.storyHi },
          section: standsAt.section,
          within: standsAt.within,
          chapterEnd: standsAt.section,
          counted: sectionWordsRef.current,
          ratio: ratio.ratio
        }).book;
        const innerBookMinutes = leftInBook === null ? null : minutesFor(leftInBook, wpm);
        innerMinutes = innerBookMinutes === null ? null : steadyMinutes(shownMinutesRef.current.inner ?? null, innerBookMinutes);
      }
    }
    shownMinutesRef.current = { chapter, book: whole, inner: innerMinutes };
    // Within the story, by the reading line: the bar's handle then sits
    // exactly where a place it went to is. Front and back matter show what
    // the book's progress is (they do not move it).
    // (Short of 100% until the story's end is reached: readers/progress.ts.)
    const progress =
      inStory && weights && place
        ? progressToSave(
            fractionAt(weights, place.section, place.within),
            layoutRef.current === "scroll" ? storyEndInView() : place.section >= weights.last && place.within >= 1,
            isFinished(lastProgressRef.current)
          )
        : known;
    const percent = (value: number | null) => (value === null ? null : Math.round(value * 100));
    const inner = innerBook && weights && standsAt ? { label: innerBook.label, progress: fractionOfBook(innerBook, weights.bytes, standsAt) } : null;
    const next: Outlook = inner ? { progress, chapter, book: innerMinutes, set: whole, inner } : { progress, chapter, book: whole };
    setOutlook((shown) =>
      shown.chapter === next.chapter &&
      shown.book === next.book &&
      (shown.set ?? null) === (next.set ?? null) &&
      percent(shown.progress) === percent(progress) &&
      (shown.inner?.label ?? null) === (inner?.label ?? null) &&
      percent(shown.inner?.progress ?? null) === percent(inner?.progress ?? null)
        ? shown
        : next
    );
    // One quiet word when the reading passes the last line of a novel inside
    // a set (readers/innerBooks.ts: crossedStoryEnd). Not for the last one:
    // that is the book itself finished, which is said where it always was.
    const passed = place ? crossedStoryEnd(innerBooks, outlookSectionRef.current, place.section) : -1;
    outlookSectionRef.current = place?.section ?? outlookSectionRef.current;
    if (passed >= 0 && passed < innerBooks.length - 1) {
      showFocusToastRef.current(`${innerBooks[passed].label}: finished · book ${passed + 2} of ${innerBooks.length} is next`, 5200);
    }
  };
  updateOutlookRef.current = updateOutlook;
  /** The section the reading line was in at the last look, for telling a novel's end being read past. */
  const outlookSectionRef = useRef<number | null>(null);

  return {
    chapterEntry, chapterEntryRef, chapterLabel, chapterInBook, formatChapterDisplay, sectionWordsRef, wordRatioRef,
    shownMinutesRef, outlook, updateOutlookRef
  };
};
