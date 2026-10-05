import { useMemo, useRef, useState } from "react";
import { type TocItem } from "../readerTypes";
import { PAGE_TOP_PAD } from "../finish";
import { type TocPlace } from "../toc";
import { chapterEndTop } from "../smartScroll";
import { chapterEndFor } from "../timeLeft";
import { NO_JUMPS, noteJump, stepBack, stepForward, type JumpHistory } from "../jumpHistory";
import { fractionAt, seekTarget } from "../seek";
import { anchorElement } from "../contentsScan";
import { chapterEndWithin, chapterTail, earlierEntry, entryAtShare, nextChapterEntry, pagesOfChapter, previousChapterEntry, type ChapterStart } from "../chapterSpan";
import { bookOfSection, gapFollows, labelInBook, type ContentsRow, type InnerBook } from "../innerBooks";
import type { Later, WithPlace } from "./scope";

/** What this reaches that hooks called after it add (scope.ts). */
type ChaptersLater = Later<
  | "noteRequestRef" | "setNote" | "chapterEntryRef" | "goToPageEdge"
>;

/**
 * The book's contents as places, and getting about by them: chapters, the
 * edges of a chapter and of the book, the progress bar, and back to where you
 * were.
 */
export const useChapters = (reader: WithPlace & ChaptersLater) => {
  const {
    bookRef, displayChapter, displayedViews, ensureScrollContainer, goToPlace, lastCfiProgressRef,
    lastComputedProgressRef, layoutRef, linePx, loadFurther, markNavigating, progressArmedRef, readingPlace,
    readingPlaceCfi, releaseUserReadingAnchor, renditionRef, sectionPlace, sectionWeightsRef
  } = reader;
  const goToEdgeRef = useRef<(edge: "chapterStart" | "chapterEnd" | "bookStart" | "bookEnd") => void>(() => undefined);

  const [toc, setToc] = useState<TocItem[]>([]);
  // The contents' entries as places in the book, for naming where the reader is (readers/toc.ts).
  const tocPlacesRef = useRef<TocPlace[]>([]);
  const tocLabelsRef = useRef<string[]>([]);
  // The share of its file before each entry of the contents (0 at its top): from the chapter finder (readers/contentsScan.ts).
  const tocWithinRef = useRef<number[]>([]);
  /**
   * With pages: the contents entry the reader asked for by name (the chapter
   * list, next or previous chapter, a link, Home), and the page it was shown
   * on. A chapter that starts part-way down a page is named on that page
   * only when it was asked for, and until another page comes up
   * (readers/chapterSpan.ts: chapterOnPage).
   */
  const askedEntryRef = useRef<{ entry: number; at: string | null } | null>(null);
  // The contents as rows with their depth, and the books inside a set (readers/innerBooks.ts); none for a single work.
  const [contents, setContents] = useState<{ rows: ContentsRow[]; books: InnerBook[]; bytes: number[]; made?: boolean }>({ rows: [], books: [], bytes: [] });
  const innerBooksRef = useRef<InnerBook[]>([]);
  const contentsRowsRef = useRef<ContentsRow[]>([]);
  /**
   * Replaces the book's contents after it has opened (set where the contents
   * are read, in the book-opening effect): for a chapter list made by Leaflet
   * when the book came with none. `made` puts "Chapters found by Leaflet" at
   * the list's head.
   */
  const applyContentsRef = useRef<(tree: TocItem[], made?: boolean) => void>(() => undefined);
  // In a set: the stretches between two stories, as sections and as fractions of the set's story.
  const storyGapsRef = useRef<{ from: number; to: number; start: number; end: number }[]>([]);
  /**
   * A look between two stories of a set from somewhere else in it (the third
   * novel's map opened from its fortieth chapter, the first one's appendix
   * from the second): the progress and the saved place stay where the
   * reading is, as they do for a single novel's map (readers/innerBooks.ts:
   * gapFollows). Reading through from the end of one novel to the start of
   * the next is followed.
   */
  const lookingBetweenStories = (section: number) => {
    const gap = storyGapsRef.current.find((between) => section >= between.from && section <= between.to);
    if (!gap) {
      return false;
    }
    const known = lastCfiProgressRef.current ?? (lastComputedProgressRef.current >= 0 ? lastComputedProgressRef.current : 0);
    return !gapFollows(known, gap.start, gap.end);
  };

  const spineIndexByHrefRef = useRef<Record<string, number>>({});
  const chapterSpineIndicesRef = useRef<number[]>([]);
  const tocSpineStartsRef = useRef<number[]>([]);

  // Back to where you were (readers/jumpHistory.ts): the lines left by jumps,
  // for this visit. The counts are what the dock draws.
  const jumpsRef = useRef<JumpHistory>(NO_JUMPS);
  /** How far below the reading line each of those lines started (scrolling), by its place. */
  const jumpBelowRef = useRef(new Map<string, number>());
  const [jumps, setJumps] = useState({ back: 0, forward: 0 });
  /** The dock is awake for a moment after a jump, so the way back is seen. */
  const [dockAwake, setDockAwake] = useState(false);
  const dockAwakeTimerRef = useRef<number | null>(null);
  // For the key handler and the book's own documents, bound once.
  const goBackRef = useRef<() => void>(() => undefined);
  const goForwardRef = useRef<() => void>(() => undefined);

  /** The progress bar shows with the dock; it can be used once the sections' sizes are known. */
  const [dockNear, setDockNear] = useState(false);
  const [canSeek, setCanSeek] = useState(false);

  /**
   * With pages: the page showing as a page of its chapter, when the contents
   * place several chapters in this file (readers/chapterSpan.ts). The pages
   * the chapters start on are found once for a layout of the file.
   */
  const chapterPagesRef = useRef<{ key: string; starts: Array<{ entry: number; page: number; atTop: boolean }> }>({ key: "", starts: [] });
  const chapterPagesHere = (section: number, page: number, total: number) => {
    const starts = chapterStartsHere(section);
    return starts ? pagesOfChapter(page, total, starts, askedEntryRef.current?.entry) : null;
  };
  /** The pages (from 1) the contents' entries inside this file start on, in page order; null when none does. */
  const chapterStartsHere = (section: number) => {
    const manager = renditionRef.current?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    const pageWidth = Number(manager?.layout?.delta) || 0;
    if (!Number.isInteger(section) || !container || pageWidth <= 0 || manager?.settings?.direction === "rtl") {
      return null;
    }
    const inside = tocPlacesRef.current.map((place, index) => ({ place, index })).filter(({ place, index }) => place.spine === section && (tocWithinRef.current[index] ?? 0) > 0);
    if (inside.length === 0) {
      return null;
    }
    const key = `${section}:${container.scrollWidth}:${pageWidth}:${inside.length}`;
    if (chapterPagesRef.current.key !== key) {
      const view = displayedViews().find((shown) => shown?.section?.index === section);
      const doc = view?.contents?.document as Document | undefined;
      const frame = doc?.defaultView?.frameElement?.getBoundingClientRect();
      if (!doc || !frame) {
        return null;
      }
      const box = container.getBoundingClientRect();
      const starts: Array<{ entry: number; page: number; atTop: boolean }> = [];
      for (const { place, index } of inside) {
        const heading = anchorElement(doc, place.anchor || place.cfi || "");
        const at = heading?.getBoundingClientRect();
        if (at) {
          const across = frame.left + at.left - box.left + container.scrollLeft;
          starts.push({ entry: index, page: Math.floor((across + 1) / pageWidth) + 1, atTop: at.top <= PAGE_TOP_PAD + linePx() * 1.5 });
        }
      }
      starts.sort((a, b) => a.page - b.page);
      chapterPagesRef.current = { key, starts };
    }
    return chapterPagesRef.current.starts;
  };

  const applyJumps = (next: JumpHistory) => {
    jumpsRef.current = next;
    setJumps({ back: next.back.length, forward: next.forward.length });
  };

  /**
   * The place being left, for the jump history. Scrolling, how far below the
   * reading line its line started is kept beside it, so Back puts the line
   * back where it was: it used to come back at the reading line itself, up
   * to a line and a paragraph gap higher than it had been.
   */
  const placeLeft = (): string | null => {
    const line = readingPlace();
    if (!line) {
      return readingPlaceCfi();
    }
    jumpBelowRef.current.set(line.cfi, Math.round(line.below));
    return line.cfi;
  };

  /**
   * The reader is about to be taken elsewhere (a link, a chapter from the
   * list, a search result, a bookmark, the progress bar): the line being left
   * is kept, and the dock wakes for a moment to offer the way back. Called
   * before the jump, while the place is still on the page.
   */
  const noteJumpFromHere = () => {
    // Going elsewhere: a note shown here has nothing more to say.
    reader.noteRequestRef.current += 1;
    reader.setNote(null);
    const before = jumpsRef.current;
    const next = noteJump(before, placeLeft());
    if (next === before) {
      return;
    }
    applyJumps(next);
    setDockAwake(true);
    if (dockAwakeTimerRef.current) {
      window.clearTimeout(dockAwakeTimerRef.current);
    }
    dockAwakeTimerRef.current = window.setTimeout(() => {
      dockAwakeTimerRef.current = null;
      setDockAwake(false);
    }, 6000);
  };

  const goBack = () => {
    const step = stepBack(jumpsRef.current, placeLeft());
    if (step) {
      applyJumps(step.history);
      goToPlace(step.target, jumpBelowRef.current.get(step.target) ?? 0);
    }
  };
  const goForward = () => {
    const step = stepForward(jumpsRef.current, placeLeft());
    if (step) {
      applyJumps(step.history);
      goToPlace(step.target, jumpBelowRef.current.get(step.target) ?? 0);
    }
  };
  goBackRef.current = goBack;
  goForwardRef.current = goForward;

  /** The chapter a fraction of the book falls in, for the progress bar's label. */
  const chapterAtFraction = (fraction: number) => {
    const weights = sectionWeightsRef.current;
    if (!weights) {
      return null;
    }
    const target = seekTarget(weights, fraction);
    // Several chapters to a file: the one that part of the file is in (readers/chapterSpan.ts).
    if (tocWithinRef.current.some((share, index) => share > 0 && tocPlacesRef.current[index]?.spine === target.section)) {
      const entry = entryAtShare(chapterStarts(), target.section, target.within);
      const label = entry >= 0 ? tocLabelsRef.current[entry] : null;
      if (label) {
        return label;
      }
    }
    return chapterNameOfSection(target.section);
  };
  /** In a set of books: the book a fraction falls in, which the label names above the chapter. */
  const bookAtFraction = (fraction: number) => {
    const weights = sectionWeightsRef.current;
    const books = innerBooksRef.current;
    return weights && books.length > 0 ? (books[bookOfSection(books, seekTarget(weights, fraction).section)]?.label ?? null) : null;
  };
  /** In a set of books: where each one after the first begins along the bar. */
  const bookMarks = useMemo(() => {
    const weights = sectionWeightsRef.current;
    return weights ? contents.books.slice(1).map((inner) => ({ at: fractionAt(weights, inner.first, 0), label: inner.label })) : [];
  }, [contents]);

  /**
   * Goes to a fraction of the way through the book (the progress bar): the
   * section it falls in by the sections' sizes, then as far through that
   * section, by its height on the page or by its pages. A jump like any
   * other: Back returns.
   */
  const seekTo = (fraction: number) => {
    const weights = sectionWeightsRef.current;
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    if (!weights || !rendition) {
      return;
    }
    const { section, within } = seekTarget(weights, fraction);
    const target = epub?.spine?.get?.(section);
    if (!target?.href) {
      return;
    }
    noteJumpFromHere();
    releaseUserReadingAnchor();
    progressArmedRef.current = true;
    markNavigating();
    void rendition
      .display(target.href)
      .then(() => {
        if (renditionRef.current !== rendition) {
          return;
        }
        const manager = rendition.manager as any;
        if (layoutRef.current === "pages") {
          const container = manager?.container as HTMLElement | undefined;
          const pageWidth = Number(manager?.layout?.delta) || 0;
          const rtl = manager?.settings?.direction === "rtl";
          if (!container || pageWidth <= 0 || (rtl && manager.settings.rtlScrollType !== "negative")) {
            return;
          }
          const pages = Math.max(1, Math.round(container.scrollWidth / pageWidth));
          const page = Math.min(pages - 1, Math.floor(within * pages));
          if (page > 0) {
            // (A right-to-left book's frame counts down from nought.)
            manager.scrollTo(rtl ? -page * pageWidth : page * pageWidth, 0, true);
            void rendition.reportLocation?.();
          }
          return;
        }
        const container = ensureScrollContainer();
        if (!container) {
          return;
        }
        // The chapter's frame is found again each time: the one above it
        // takes its real height a moment after it loads.
        // And a place in the chapter's last screenful is out of reach until
        // the chapter after it has arrived below (the end of the book's
        // story stopped at the bottom edge of the window): it is put again
        // as that happens, unless the reader has moved on meanwhile.
        let put: number | null = null;
        const place = () => {
          const element = manager?.views?.find?.(target)?.element as HTMLElement | undefined;
          if (!element || renditionRef.current !== rendition || (put !== null && Math.abs(container.scrollTop - put) > 2)) {
            return;
          }
          container.scrollTop = Math.max(element.offsetTop, element.offsetTop + within * element.offsetHeight - PAGE_TOP_PAD);
          put = container.scrollTop;
        };
        place();
        requestAnimationFrame(place);
        [250, 600, 1200].forEach((ms) => window.setTimeout(place, ms));
        loadFurther();
      })
      .catch(() => undefined);
  };

  /** The chapter a section falls under: the last contents entry at or before it. */
  const chapterNameOfSection = (section: number) => {
    let label: string | null = null;
    let best = -1;
    for (const item of toc) {
      const index = spineIndexByHrefRef.current[item.href.split("#")[0]];
      // (The first entry that opens the section: the file's own name, not the
      // last of the anchors inside it. An appendix of ten houses was named
      // for the tenth.)
      if (typeof index === "number" && index <= section && index > best) {
        best = index;
        label = item.label;
      }
    }
    return label;
  };
  /** The same with its book's name, in a set of books: for a search result or a character's mention, where "Tyrion" alone is one of thirty-five. */
  const chapterOfSection = (section: number) => {
    const label = chapterNameOfSection(section);
    const inner = innerBooksRef.current[bookOfSection(innerBooksRef.current, section)];
    return inner ? labelInBook(inner.label, label ?? "") : label;
  };

  const isSkippableSpine = (item: any) => {
    if (!item) {
      return true;
    }
    if (item.linear === "no") {
      return true;
    }
    const rawProps = item.properties ?? [];
    const props = Array.isArray(rawProps)
      ? rawProps
      : typeof rawProps === "string"
        ? rawProps.split(" ")
        : [];
    if (props.some((prop: string) => ["nav", "cover", "cover-image"].includes(prop))) {
      return true;
    }
    const media = item?.mime ?? item?.mediaType ?? "";
    if (media && !media.includes("xhtml") && !media.includes("html") && !media.includes("svg+xml")) {
      return true;
    }
    return !item.href;
  };

  const getLocationIndex = (href?: string) => {
    const location = renditionRef.current?.location;
    if (typeof location?.start?.index === "number") {
      return location.start.index;
    }
    if (typeof location?.end?.index === "number") {
      return location.end.index;
    }
    if (href && spineIndexByHrefRef.current[href] !== undefined) {
      return spineIndexByHrefRef.current[href];
    }
    return undefined;
  };

  const getSpineIndex = (href?: string) => {
    const location = renditionRef.current?.location;
    const key = href ?? location?.start?.href ?? location?.end?.href;
    return getLocationIndex(key);
  };

  const displaySpine = (startIndex: number, direction: 1 | -1) => {
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const spineItems = epub?.spine?.items;
    if (!rendition || !Array.isArray(spineItems)) {
      return false;
    }
    let index = startIndex;
    while (index >= 0 && index < spineItems.length) {
      const item = spineItems[index];
      if (!isSkippableSpine(item)) {
        markNavigating();
        void rendition.display(item.href);
        return true;
      }
      index += direction;
    }
    return false;
  };

  const displayNextSpine = (href?: string) => {
    const index = getSpineIndex(href);
    if (typeof index !== "number") {
      return false;
    }
    return displaySpine(index + 1, 1);
  };

  const displayPrevSpine = (href?: string) => {
    const index = getSpineIndex(href);
    if (typeof index !== "number") {
      return false;
    }
    return displaySpine(index - 1, -1);
  };

  /** The contents' entries as chapter starts (readers/chapterSpan.ts): the section each is in and how far down it. */
  const chapterStarts = (): ChapterStart[] => tocPlacesRef.current.map((place, index) => ({ spine: place.spine, within: tocWithinRef.current[index] ?? 0 }));
  /**
   * How far down the file being read the next chapter starts, when it starts
   * in this file: where the chapter being read ends (the time left in it).
   * Scrolling, it is measured on the page, as the reading line is (a share
   * of the file's height): by the text alone it was minutes out in a file of
   * 200 KB. Measured once for a heading and a layout.
   */
  const headingShareRef = useRef<{ key: string; share: number | null }>({ key: "", share: null });
  const nextHeadingShare = (section: number, within: number): number | null => {
    const starts = chapterStarts();
    const current = reader.chapterEntryRef.current;
    if (layoutRef.current !== "scroll") {
      return chapterEndWithin(starts, section, current, within);
    }
    const index = starts.findIndex((start, at) => at > current && start.spine === section && start.within > 0);
    if (index < 0) {
      return null;
    }
    const view = displayedViews().find((shown) => shown?.section?.index === section);
    const height = Number((view?.element as HTMLElement | undefined)?.offsetHeight) || 0;
    const key = `${section}:${index}:${height}`;
    if (headingShareRef.current.key === key) {
      return headingShareRef.current.share;
    }
    const doc = view?.contents?.document as Document | undefined;
    const place = tocPlacesRef.current[index];
    const heading = doc && place ? anchorElement(doc, place.anchor || place.cfi || "") : null;
    const share = heading && height > 0 ? Math.min(1, Math.max(0, heading.getBoundingClientRect().top / height)) : starts[index].within;
    headingShareRef.current = { key, share };
    return share;
  };
  /** Goes to a contents entry by its number, as choosing it in the list does. */
  const goToEntry = (index: number) => {
    // (From the entries as places, which are always the current contents: a
    // key handler may hold this function from before a made list arrived.)
    const place = tocPlacesRef.current[index];
    const file = typeof place?.spine === "number" ? ((bookRef.current as any)?.spine?.get?.(place.spine)?.href as string | undefined) : undefined;
    if (!place || !file) {
      return false;
    }
    askedEntryRef.current = layoutRef.current === "pages" ? { entry: index, at: null } : null;
    if (place.cfi) {
      goToPlace(place.cfi);
    } else {
      displayChapter(`${file}${place.anchor ? `#${encodeURIComponent(place.anchor)}` : ""}`, { useSaved: false });
    }
    return true;
  };

  /** A click on a line of a flattened contents page (readers/bookBlocks.ts): to the entry it names, with Back. */
  const goToListedLineRef = useRef<(entry: number) => void>(() => undefined);
  goToListedLineRef.current = (entry) => {
    if (Number.isInteger(entry) && entry >= 0) {
      noteJumpFromHere();
      goToEntry(entry);
    }
  };

  const goNextSection = () => {
    // A chapter skipped is a jump: the line left can be come back to.
    noteJumpFromHere();
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    // The next heading, when the contents place it inside a file: several
    // chapters to a file used to be skipped together (readers/chapterSpan.ts).
    const reading = sectionPlace()?.section ?? index;
    if (typeof reading === "number") {
      const next = nextChapterEntry(chapterStarts(), reading, reader.chapterEntryRef.current);
      if (next !== null && goToEntry(next)) {
        return;
      }
    }
    const href = location?.start?.href ?? location?.end?.href;
    if (href && epub?.spine?.get) {
      // From the chapter the reading line is in, which is the one the dock names.
      const current = epub.spine.get(sectionPlace()?.section ?? href);
      const next = current?.next ? current.next() : null;
      if (next?.href) {
        displayChapter(next.href, { useSaved: false });
        return;
      }
    }
    if (typeof index === "number" && displaySpine(index + 1, 1)) {
      return;
    }
    void rendition?.next();
  };

  const goPrevSection = () => {
    noteJumpFromHere();
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    const location = rendition?.location;
    const index = location?.start?.index ?? location?.end?.index;
    // The heading before, when it or this chapter starts inside a file.
    const reading = sectionPlace()?.section ?? index;
    if (typeof reading === "number") {
      const starts = chapterStarts();
      const before = previousChapterEntry(starts, reading, reader.chapterEntryRef.current);
      if (layoutRef.current === "pages" && before !== null) {
        // With pages, a heading on a file's first page shares that page with
        // the file's own entry: going "back" to the one from the other showed
        // the same page again, for ever (an appendix of anchors, and every
        // novel's cover in a boxed set). Entries that land on the page
        // showing are stepped past, into the file before if need be
        // (readers/chapterSpan.ts: earlierEntry).
        const page = Number(location?.start?.displayed?.page) || 1;
        const file = before === "top" && page > 1 ? epub?.spine?.get?.(reading)?.href : null;
        if (file) {
          displayChapter(file, { useSaved: false });
          return;
        }
        const startPages = chapterStartsHere(reading) ?? [];
        const lands = (entry: number) =>
          starts[entry]?.spine === reading && (starts[entry].within > 0 ? startPages.find((start) => start.entry === entry)?.page : 1) === page;
        const target = earlierEntry(starts, reading, before === "top" ? reader.chapterEntryRef.current - 1 : before, lands);
        if (target >= 0 && goToEntry(target)) {
          return;
        }
        // Nothing earlier among the entries: the file before, below.
      } else {
        const file = before === "top" ? epub?.spine?.get?.(reading)?.href : null;
        if (file) {
          displayChapter(file, { useSaved: false });
          return;
        }
        if (typeof before === "number" && goToEntry(before)) {
          return;
        }
      }
    }
    const href = location?.start?.href ?? location?.end?.href;
    if (href && epub?.spine?.get) {
      // From the chapter the reading line is in, which is the one the dock names.
      const current = epub.spine.get(sectionPlace()?.section ?? href);
      const prev = current?.prev ? current.prev() : null;
      if (prev?.href) {
        displayChapter(prev.href, { useSaved: false });
        return;
      }
    }
    if (typeof index === "number" && displaySpine(index - 1, -1)) {
      return;
    }
    void rendition?.prev();
  };

  /**
   * Home, End, Ctrl+Home and Ctrl+End when scrolling: the start or the end of
   * the chapter being read, or of the book. They used to be the browser's:
   * the top or the bottom of whichever chapters happened to be loaded, and
   * only when the keyboard was in the book's text. Jumps: Back returns.
   * (The end of a chapter that shares its file with the next is the end of
   * the file.)
   */
  const goToEdge = (edge: "chapterStart" | "chapterEnd" | "bookStart" | "bookEnd") => {
    // With pages: the first or last page of the chapter or the book (goToPageEdge).
    if (layoutRef.current === "pages") {
      reader.goToPageEdge(edge);
      return;
    }
    const rendition = renditionRef.current;
    const epub = bookRef.current as any;
    if (!rendition || !epub?.spine?.get || layoutRef.current !== "scroll") {
      return;
    }
    const here = sectionPlace()?.section;
    if (edge === "chapterStart" || edge === "bookStart") {
      const entry = edge === "chapterStart" ? tocPlacesRef.current[reader.chapterEntryRef.current] : undefined;
      const section = edge === "bookStart" ? epub.spine.first?.() : epub.spine.get(typeof entry?.spine === "number" ? entry.spine : here);
      if (!section?.href) {
        return;
      }
      noteJumpFromHere();
      if (edge === "chapterStart" && entry?.cfi) {
        // A heading with no id (a chapter list made by Leaflet): its place.
        goToPlace(entry.cfi);
        return;
      }
      displayChapter(`${section.href}${entry?.anchor ? `#${encodeURIComponent(entry.anchor)}` : ""}`, { useSaved: false });
      return;
    }
    // A chapter that shares its file with the next ends at the next heading,
    // not at the end of the file (readers/chapterSpan.ts): its last lines,
    // with the heading after them low in the window.
    if (edge === "chapterEnd" && typeof here === "number") {
      const starts = chapterStarts();
      const following = starts.findIndex((start, at) => at > reader.chapterEntryRef.current && start.spine === here && start.within > 0);
      const place = following >= 0 ? tocPlacesRef.current[following] : undefined;
      const view = place ? displayedViews().find((shown) => shown?.section?.index === here) : null;
      const doc = view?.contents?.document as Document | undefined;
      const heading = doc && place ? anchorElement(doc, place.anchor || place.cfi || "") : null;
      const container = ensureScrollContainer();
      const frame = doc?.defaultView?.frameElement as HTMLElement | null | undefined;
      if (heading && container && frame) {
        const top = frame.getBoundingClientRect().top + heading.getBoundingClientRect().top - container.getBoundingClientRect().top;
        if (top > container.clientHeight * 0.8) {
          noteJumpFromHere();
          releaseUserReadingAnchor();
          markNavigating();
          container.scrollTop = Math.max(0, container.scrollTop + top - container.clientHeight * 0.72);
        }
        // (Already in the window: this is the chapter's end.)
        return;
      }
      // Or at a heading part-way down a later file, when the chapter runs on into it.
      const tail = container ? chapterTail(starts, here, reader.chapterEntryRef.current) : null;
      const after = tail ? starts.findIndex((start, at) => at > reader.chapterEntryRef.current && start.spine === tail.section && start.within === tail.within) : -1;
      const afterCfi = after >= 0 ? tocPlacesRef.current[after]?.cfi : null;
      if (container && afterCfi) {
        noteJumpFromHere();
        goToPlace(afterCfi, Math.round(container.clientHeight * 0.72 - PAGE_TOP_PAD));
        return;
      }
    }
    const lastOfBook: number | undefined = epub.spine.last?.()?.index;
    const last =
      edge === "bookEnd" ? lastOfBook : typeof here === "number" ? chapterEndFor(here, tocSpineStartsRef.current, lastOfBook ?? here) : undefined;
    const target = typeof last === "number" ? epub.spine.get(last) : null;
    if (!target?.href) {
      return;
    }
    noteJumpFromHere();
    releaseUserReadingAnchor();
    progressArmedRef.current = true;
    markNavigating();
    const manager = rendition.manager as any;
    // The chapter's last line, most of the way down the window, with the
    // next chapter's opening under it (readers/smartScroll.ts).
    // Until the chapter after it is on the page there is nothing to scroll
    // into, and the last line stops at the bottom edge: it is put again as
    // that chapter arrives, unless the reader has moved on meanwhile.
    let put: number | null = null;
    const place = () => {
      const container = ensureScrollContainer();
      const view = manager?.views?.find?.(target);
      const element = view?.element as HTMLElement | undefined;
      if (!container || !element || renditionRef.current !== rendition) {
        return;
      }
      if (put !== null && Math.abs(container.scrollTop - put) > 2) {
        return;
      }
      const room = (view.contents?.document as Document | undefined)?.querySelector<HTMLElement>("[data-leaflet-end]")?.offsetHeight ?? 0;
      container.scrollTop = chapterEndTop(element.offsetTop, element.offsetHeight, room, container.clientHeight);
      put = container.scrollTop;
      loadFurther();
    };
    const settle = () => {
      place();
      requestAnimationFrame(place);
      [250, 600, 1200].forEach((ms) => window.setTimeout(place, ms));
    };
    if (manager?.views?.find?.(target)) {
      settle();
      return;
    }
    void rendition.display(target.href).then(settle).catch(() => undefined);
  };
  goToEdgeRef.current = goToEdge;

  return {
    goToEdgeRef, toc, setToc, tocPlacesRef, tocLabelsRef, tocWithinRef, askedEntryRef, contents, setContents,
    innerBooksRef, contentsRowsRef, applyContentsRef, storyGapsRef, lookingBetweenStories, spineIndexByHrefRef,
    chapterSpineIndicesRef, tocSpineStartsRef, jumpsRef, jumpBelowRef, jumps, setJumps, dockAwake, dockAwakeTimerRef,
    goBackRef, goForwardRef, dockNear, setDockNear, canSeek, setCanSeek, chapterPagesHere, chapterStartsHere,
    noteJumpFromHere, goBack, goForward, chapterAtFraction, bookAtFraction, bookMarks, seekTo, chapterNameOfSection,
    chapterOfSection, chapterStarts, nextHeadingShare, goToListedLineRef, goNextSection, goPrevSection
  };
};
