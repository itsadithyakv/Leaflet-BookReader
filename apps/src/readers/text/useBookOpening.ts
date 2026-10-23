import { useEffect, useRef } from "react";
import { isDoubleClickedWord, lookUpOnDoubleClick } from "../words/wordPrefs";
import { isTauri } from "@tauri-apps/api/core";
import ePub from "epubjs";
import { bookService } from "../../services/bookService";
import { accountService } from "../../services/accountService";
import ztNatureBoldWoff2 from "../../assets/fonts/ZTNature-Bold.woff2";
import { formatSummary, getBookExtension, isReadableExtension } from "../../constants/bookFormats";
import { buildSectionWeights, chaptersFrameBook, dropsToStartAtOpen, isChapterLike, OPEN_SETTLE_MS, outsideStory, readingAt, spineIndexForProgress } from "../progress";
import { isFinished } from "../../constants/books";
import { FALLBACK_FACE, MEASURE_PADDING, applyTypeChoice, type TocItem } from "../readerTypes";
import { applyCustomFont } from "../customFonts";
import { getReaderFinish, getReaderFinishBackground, PAGE_TOP_PAD } from "../finish";
import { flattenToc, tocPlace } from "../toc";
import { markInkImages } from "../inkImages";
import { friendlyOpenError } from "../openErrors";
import { markOpenings, OPENINGS_CSS } from "../dropCaps";
import { PAGE_FOOT_PAD, PAGES_CSS, PHONE_PAGE_GAP, PHONE_PAGES_CSS, PHONE_TEXT_CSS, PHONE_TEXT_PAD, phonePageSides } from "../pagesStyle";
import { insetPx, isPhoneShape, readerShape, steadyWindowHeight } from "../touchLayout";
import { BLOCKS_CSS, markBlocks, markListedLines, pictureRoom } from "../bookBlocks";
import { NARROW_CSS, markNarrowBoxes, markNarrowColumn, textColumnWidth } from "../narrowColumn";
import { sectionsFromArchive } from "../archiveSections";
import { holdsFetching } from "../scrollbarHold";
import { heldScrollTop, holdsPrepend } from "../jumpSettle";
import { aboveWindow, aboveWindowPrepended } from "../keepStill";
import { isOutsideLink } from "../bookLinks";
import { markViewable, pictureAt } from "../pictures";
import { MOVING_FETCH_SCREENS, RELOCATE_AFTER_SCROLL_MS, afterScrollSettles, fetchAheadPx, readerScroll, reportWhileScrolling } from "../scrollQuiet";
import { fractionAt } from "../seek";
import { quietShow } from "../viewShow";
import { fullerToc, tocFromNcx } from "../ncx";
import { CONTENTS_KEY_PREFIX, decideContents, keepContents, nestFlatParts, placeKey, readKept, type KeptContents } from "../autoContents";
import { scanBook } from "../contentsScan";
import { listedAgain } from "../chapterSpan";
import { findInnerBooks, storyGaps, tocDepths, type ContentsRow } from "../innerBooks";
import { placeToSave } from "../readingPlace";
import { findInBook } from "../findPlace";
import { isLook } from "../openAt";
import type { WithCover } from "./scope";
import { noteChapter } from "../../pip/base/storyFeed";
import { isTouchInput } from "../../platform/device";
import { freezeRendition, windowChangesLayout, type Ghost } from "./renditionGhost";
import { dropReaderVeil, liftReaderVeil, raiseReaderVeil } from "../readerVeil";
import { selectionIsAccidental, type Press } from "../touchSelect";

/** Scrolling, a book drawn anew under the veil is uncovered this long after it is up: the line is pinned back by then. */
const UNCOVER_SCROLLED_MS = 80;

/**
 * Opens the book: reads the file, builds the contents, makes the rendition,
 * and binds into each chapter's document as it arrives. One effect, as it has
 * always been; what it calls lives in the other hooks.
 */
export const useBookOpening = (reader: WithCover) => {
  const {
    activeWordIndexRef, appliedHighlightsRef, applyContentsRef, applyEndRoom, applyReaderInsets, applyReaderTypography,
    book, bookMeasureCss, bookRef, chapterPositionsRef, chapterSpineIndicesRef, chapterTurnUntilRef, clearToolbar,
    closeNoteRef, contentsRowsRef, contentWheelHandlerRef, customFontRef, displayModeRef, ensureScrollContainer,
    ensureSingleScrollContainer, followBookLinkRef, fontSizeRef, goToListedLineRef, holdAutoScrollRef, innerBooksRef,
    lastCfiBelowRef, lastCfiProgressRef, lastCfiRef, lastComputedProgressRef, lastHandsOnAtRef, lastProgressRef,
    layoutRef, lookingBetweenStories, markNavigating, markReadingActivity, navigatingUntilRef, notePagePlace,
    notePageShownRef, noteRef, noteRequestRef, openedAtRef, openPictureRef, pagePlaceRef, pageRelayoutsRef,
    pageSlideRef, peopleMarkedRef, persistReaderState, placeFollowsNow, progressArmedRef, queuedTurnRef,
    readerKeyHandlerRef, readerThemeRef, readerWordsRef, readingPaceScaleRef, readingPlace, reloadKey,
    removeLastReadMarker, renditionRef, scheduleReaderDotUpdate, scheduleReaderWordIndex,
    scrollAdvanceLockRef, scrollbarHoldRef, scrollbarLetGoRef, searchMarkRef, sectionPlace, sectionWeightsRef,
    selectionChangedRef, setCanSeek, setContents, setLoadError, setLoading, setNote, setPageOf, setPicture,
    setSelection, settleOnPage, setToc, showFocusToastRef, shownLineRef, spineIndexByHrefRef, storyEndBottom,
    storyEndInView, storyEndWasBelowRef, storyGapsRef, tocLabelsRef, tocPlacesRef, tocSpineStartsRef, tocWithinRef,
    typeChoiceRef, updateBookProgress, updateOutlookRef, viewerRef
  } = reader;
  /** When a word in the book was last double-clicked: the selection that follows is that word, and is looked up. */
  const doubleClickedAtRef = useRef(0);
  // For a book opened at a match of the library's search (below, where the saved place is restored).
  const { markSearchHit, openAt, openedAtPlaceRef, searchBookFor, soughtRef } = reader;
  const relocateHandlerRef =useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  const lastProgressAtRef = useRef(0);
  /**
   * The book as parsed, kept while it is laid out again in another layout
   * (useReaderLook's `relayout`): which book it is, and how many hooks its
   * spine had before a rendition added its own (a new rendition adds them
   * again, and the old one's would run on a rendition taken down).
   */
  const parsedRef = useRef<{ id: string; spineHooks: number } | null>(null);
  /** The last press on the page, and where the page was then: whether a selection was held for (readers/touchSelect.ts). */
  const pressRef = useRef<Press | null>(null);
  /** The page that was, held over the viewer until the new layout's page is up (renditionGhost.ts). */
  const ghostRef = useRef<Ghost | null>(null);
  const dropGhost = () => {
    ghostRef.current?.remove();
    ghostRef.current = null;
  };

  const localPath =
    (book as { localPath?: string; local_path?: string }).localPath ??
    (book as { localPath?: string; local_path?: string }).local_path ??
    "";

  useEffect(() => {
    // Laid out again in another layout (a turn of the phone, the type
    // panel): the book already parsed is drawn again, not read again.
    const relayingRef = reader.relayingRef;
    const reuse = relayingRef.current && bookRef.current !== null && parsedRef.current?.id === book.id;
    relayingRef.current = reuse;
    setLoading(true);
    setLoadError(null);
    if (!reuse) {
      setToc([]);
    }
    // Closing the book (or opening another) mid-load must stop this one:
    // otherwise it kept parsing a whole book nobody was looking at.
    let cancelled = false;
    /** This rendition has drawn the reader's place: it can be held on screen while the next is made. */
    let shown = false;
    /**
     * Heard before epub.js hears it, and before the window's first new size
     * is drawn: a turn that makes pages a spread, or one column again, covers
     * the page at once, until the book is drawn anew for the way up it ends
     * at (useShapeLayout; readers/readerVeil.ts). The page as it is is held,
     * deaf and mute, meanwhile (renditionGhost.ts): laid out at the sizes
     * the window passes through, it moved the place it is about to be drawn
     * anew at. A turn that keeps the layout is covered as the page's frame
     * changes size (useResizeRelayout).
     */
    const onResizeFirst = () => {
      const rendition = renditionRef.current;
      if (!shown || ghostRef.current || !rendition || !windowChangesLayout({ layout: layoutRef.current, spread: reader.spreadRef.current })) {
        return;
      }
      raiseReaderVeil(viewerRef.current);
      ghostRef.current = freezeRendition(rendition);
    };

    if (!localPath) {
      setLoadError("Missing book file.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const kept = reuse ? bookRef.current : null;
        let epub: ReturnType<typeof ePub>;
        if (kept) {
          epub = kept;
          // The spine's own hooks; the rendition about to be made adds its own.
          const spineHooks = (epub.spine as any)?.hooks?.content?.hooks;
          if (Array.isArray(spineHooks) && parsedRef.current) {
            spineHooks.splice(parsedRef.current.spineHooks);
          }
        } else {
          const ext = getBookExtension(localPath);
          if (ext && !isReadableExtension(ext)) {
            setLoadError(`This reader supports ${formatSummary()} files.`);
            setLoading(false);
            return;
          }
          let buffer: ArrayBuffer;
          if (isTauri()) {
            // Raw bytes straight from the backend: no base64 round trip, which
            // used to cost four to five times the book's size in memory.
            buffer = await bookService.readBookBytes(book.id);
            if (cancelled) {
              return;
            }
          } else {
            const source = localPath;
            const response = await fetch(source);
            if (!response.ok) {
              throw new Error("fetch failed");
            }
            buffer = await response.arrayBuffer();
          }
          if (cancelled) {
            return;
          }

          if (bookRef.current) {
            try {
              bookRef.current.destroy();
            } catch {
              // Half built (see the cleanup below).
            }
            bookRef.current = null;
          }

          try {
            epub = ePub(buffer);
          } catch {
            setLoadError(
              ext && ext !== "epub"
                ? `Leaflet converted this ${ext.toUpperCase()} file but could not read the result. Re-import the book and try again.`
                : "This file is not a readable EPUB. It may be damaged."
            );
            setLoading(false);
            return;
          }
          bookRef.current = epub;
          parsedRef.current = { id: book.id, spineHooks: ((epub.spine as any)?.hooks?.content?.hooks ?? []).length };
        }

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        window.addEventListener("resize", onResizeFirst);
        /** On a phone (readers/pagesStyle.ts): narrower margins, the cutout as a page's margin, hyphenation that works. */
        const phone = isPhoneShape(readerShape(window.innerWidth, steadyWindowHeight(), isTouchInput()));
        // Scrolling is one continuous book: the chapters follow each other
        // down the page, fetched as the reading nears them. It used to be a
        // chapter at a time, swapped for the next at its last line.
        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          ...(layoutRef.current === "pages"
            ? phone
              ? { gap: PHONE_PAGE_GAP }
              : {}
            : // Where the page is, worked out once the scrolling pauses
              // rather than at every hitch of it (readers/scrollQuiet.ts).
              { manager: "continuous", flow: "scrolled", afterScrolledTimeout: RELOCATE_AFTER_SCROLL_MS })
        });
        renditionRef.current = rendition;
        // epub.js decides which chapters to fetch from a scroll position it
        // remembers from the last scroll event, a frame behind the page. Just
        // after a chapter loaded in above (and the page was moved down to
        // keep the text still) it still read "at the top", and fetched the
        // chapter before that one too. It is told where the page really is.
        void (rendition as any).started?.then(() => {
          const manager = rendition.manager as any;
          if (manager?.name !== "continuous" || typeof manager.check !== "function") {
            return;
          }
          const check = manager.check.bind(manager);
          manager.check = (...args: unknown[]) => {
            if (manager.container && !manager.settings?.fullsize) {
              manager.scrollTop = manager.container.scrollTop;
            }
            // The scrollbar is held (readers/scrollbarHold.ts): the chapters
            // on the page are shown and hidden as they come into view, and
            // none is fetched. Held at the bottom, the thumb used to fetch
            // chapter after chapter and carry the reader half the book on.
            if (holdsFetching(scrollbarHoldRef.current, Date.now())) {
              manager.q?.enqueue?.(() => manager.update?.());
              return Promise.resolve(false);
            }
            // Scrolling down through a chapter, the next is fetched two
            // windows ahead (readers/scrollQuiet.ts: fetchAheadPx).
            // In a fling, three windows ahead (readers/scrollQuiet.ts: fetchWhileMoving).
            const now = Date.now();
            const moving = now < reader.appendOnlyUntilRef.current;
            const ahead =
              args.length === 0 && manager.container
                ? moving
                  ? Math.round(manager.container.clientHeight * MOVING_FETCH_SCREENS)
                  : fetchAheadPx(manager.container.scrollTop, manager.container.clientHeight)
                : null;
            // A jump settling, or a fetch asked for in a fling: no chapter is
            // put in above, which needs a scroll to keep the text still (it
            // fell short under a jump's place, and stops a fling). epub.js
            // is told the page is far enough down not to want one
            // (readers/jumpSettle.ts).
            if (manager.container && !manager.settings?.fullsize && (holdsPrepend(reader.jumpHoldRef.current, now) || moving)) {
              const given = typeof args[1] === "number" ? args[1] : 0;
              const reach = Math.max(given, ahead ?? 0, Number(manager.settings?.offset) || 0);
              manager.scrollTop = heldScrollTop(manager.container.scrollTop, reach);
            }
            return ahead !== null ? check(undefined, ahead) : check(...args);
          };
          // A chapter fetched ahead is kept drawn until it is reached. epub.js
          // lets go of (empties) every chapter more than 500px from the window
          // whenever it looks, so one fetched three windows ahead was emptied
          // at the next look and drawn again as it came into the window: in a
          // fling, a blank stretch where it should have been.
          if (typeof manager.update === "function") {
            const update = manager.update.bind(manager);
            manager.update = (offset?: number) =>
              update(
                typeof offset === "number"
                  ? offset
                  : Math.max(Number(manager.settings?.offset) || 0, Math.round((manager.container?.clientHeight ?? 0) * MOVING_FETCH_SCREENS))
              );
          }
          // A chapter above the window that changes height (a picture in it
          // arrives, it is drawn again after being let go, its fonts come)
          // moved the text being read by as much: epub.js keeps the text
          // still only for a chapter it has just put above. Every other one
          // above the window does the same now (readers/keepStill.ts).
          if (typeof manager.createView === "function" && typeof manager.prepend === "function" && typeof manager.counter === "function") {
            const createView = manager.createView.bind(manager);
            /** Keeps the text still when `view` changes height above the window, by `rule` (readers/keepStill.ts). */
            const keepStill = (view: any, rule: typeof aboveWindow) =>
              view.on("resized", (bounds: { heightDelta?: number } | undefined) => {
                const container = manager.container as HTMLElement | undefined;
                const element = view.element as HTMLElement | undefined;
                const delta = Number(bounds?.heightDelta) || 0;
                if (!container || !element?.isConnected || manager.isPaginated || layoutRef.current !== "scroll") {
                  return;
                }
                if (rule(element.offsetTop, element.offsetHeight, delta, container.scrollTop)) {
                  manager.counter(bounds);
                }
                // A jump's place held: put back by where it is, which a
                // change told in steps (or told twice) cannot leave short.
                reader.pinNowRef.current?.();
              });
            let prepending = false;
            manager.createView = (...args: unknown[]) => {
              const view = createView(...args);
              if (!prepending && typeof view?.on === "function") {
                keepStill(view, aboveWindow);
              }
              return view;
            };
            // epub.js's own `prepend`, but for when it keeps the text still.
            manager.prepend = (section: unknown, forceRight?: unknown) => {
              prepending = true;
              let view: any;
              try {
                view = manager.createView(section, forceRight);
              } finally {
                prepending = false;
              }
              keepStill(view, aboveWindowPrepended);
              view.on("resized", () => {
                view.expanded = true;
              });
              view.on("axis", (axis: unknown) => manager.updateAxis?.(axis));
              view.on("writingMode", (mode: unknown) => manager.updateWritingMode?.(mode));
              manager.views.prepend(view);
              view.onDisplayed = manager.afterDisplayed.bind(manager);
              return view;
            };
          }
          // A chapter already showing is not shown again every time epub.js
          // looks at the page, which forced a layout of the whole page every
          // 30 ms while it scrolled (readers/viewShow.ts). Those on the page
          // now, and every one made from here (prepended ones too).
          if (typeof manager.createView === "function") {
            const makeView = manager.createView.bind(manager);
            manager.createView = (...args: unknown[]) => {
              const view = makeView(...args);
              return typeof view?.show === "function" ? quietShow(view) : view;
            };
            for (const view of (manager.views?.all?.() ?? []) as any[]) {
              if (typeof view?.show === "function") quietShow(view);
            }
          }
          // Where the page is, said at least once a second while it never
          // rests, moving slowly (readers/scrollQuiet.ts: reportWhileScrolling).
          if (manager.container && typeof (rendition as any).reportLocation === "function") {
            const container = manager.container as HTMLElement;
            let reportedAt = performance.now();
            let reportedTop = container.scrollTop;
            rendition.on("relocated", () => {
              reportedAt = performance.now();
              reportedTop = container.scrollTop;
            });
            container.addEventListener(
              "scroll",
              () => {
                const now = performance.now();
                if (reportWhileScrolling(now - reportedAt, container.scrollTop - reportedTop)) {
                  reportedAt = now;
                  reportedTop = container.scrollTop;
                  (rendition as any).reportLocation();
                }
              },
              { passive: true }
            );
          }
          // Asked where the page is, epub.js first sets every chapter on the
          // page out again and measures it (a layout of each, forced), then
          // walks the text on screen. While the page is being scrolled and
          // the window has not changed size, the chapters have not changed
          // either (a chapter whose text moves measures itself again, by its
          // own resize watch): only the walk is done.
          if (typeof manager.currentLocation === "function" && typeof manager.scrolledLocation === "function" && manager.stage) {
            const currentLocation = manager.currentLocation.bind(manager);
            manager.currentLocation = () => {
              const was = manager._stageSize as { width: number; height: number } | undefined;
              const scrolling = performance.now() - readerScroll.lastAt() < 1000;
              if (scrolling && was && !manager.isPaginated) {
                const size = manager.stage.size();
                if (size && size.width === was.width && size.height === was.height) {
                  manager.location = manager.scrolledLocation();
                  return manager.location;
                }
              }
              return currentLocation();
            };
          }
          // Nor is a chapter above taken away under a held scrollbar: that
          // moves the scroll position, and the thumb with it. It goes once
          // the thumb is let go (every look at the page asks again).
          if (typeof manager.trim === "function") {
            const trim = manager.trim.bind(manager);
            manager.trim = (...args: unknown[]) =>
              holdsFetching(scrollbarHoldRef.current, Date.now()) ? Promise.resolve() : trim(...args);
          }
        });
        // Development only: lets a console (or a test driving the reader) see epub.js's state.
        if (import.meta.env.DEV) {
          (window as unknown as { __leafletRendition?: unknown }).__leafletRendition = rendition;
          // And the reader's own: the words indexed, the one being read, the pace's scale.
          (window as unknown as { __leafletReader?: unknown }).__leafletReader = {
            words: () => readerWordsRef.current,
            active: () => activeWordIndexRef.current,
            paceScale: () => readingPaceScaleRef.current,
            // Chapters held and names marked by the characters feature.
            people: () => peopleMarkedRef.current(),
            // The contents: the section weights' story span and the books inside a set; and replacing them (a made chapter list).
            story: () => ({
              lo: sectionWeightsRef.current?.lo,
              hi: sectionWeightsRef.current?.hi,
              last: sectionWeightsRef.current?.last,
              bytes: sectionWeightsRef.current?.bytes,
              rows: contentsRowsRef.current,
              books: innerBooksRef.current
            }),
            applyContents: (tree: TocItem[], made?: boolean) => applyContentsRef.current(tree, made)
          };
        }
        appliedHighlightsRef.current.clear();
        setSelection(null);
        // A note or a picture from the page that is going (its address dies with the book).
        noteRequestRef.current += 1;
        setNote(null);
        setPicture(null);
        setCanSeek(false);

        /** A phone's page margins, put back each time epub.js lays the columns out (it sets them to half its gap). */
        const phoneSides = (contents: any) => {
          if (!phone || layoutRef.current !== "pages" || typeof contents?.css !== "function") {
            return;
          }
          const sides = phonePageSides(PHONE_PAGE_GAP, insetPx("left"), insetPx("right"));
          contents.css("padding-left", `${sides.left}px`, true);
          contents.css("padding-right", `${sides.right}px`, true);
        };
        rendition.hooks?.content?.register((contents: any) => {
          const doc = contents?.document;
          if (!doc) {
            return;
          }
          const pad = phone ? PHONE_TEXT_PAD : 24;
          // A chapter that names no language takes the book's, so that its words can be broken at the line's end.
          const bookLanguage = phone ? String((epub as any)?.packaging?.metadata?.language ?? "").trim() : "";
          if (bookLanguage && !doc.documentElement.getAttribute("lang") && !doc.documentElement.getAttribute("xml:lang")) {
            doc.documentElement.setAttribute("lang", bookLanguage);
          }
          const layout = (rendition.manager as any)?.layout;
          if (phone && layout && typeof layout.format === "function" && !layout.__leafletSides) {
            const format = layout.format.bind(layout);
            layout.__leafletSides = true;
            layout.format = (...args: any[]) => {
              const formatted = format(...args);
              phoneSides(args[0]);
              return formatted;
            };
          }
          phoneSides(contents);
          doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          doc.documentElement.style.setProperty("--reader-measure", bookMeasureCss());
          applyTypeChoice(doc.documentElement, typeChoiceRef.current);
          // The reader's own font, if its file has been read by now; if not,
          // it is put in when it has (useTypeChange).
          applyCustomFont(doc, customFontRef.current);
          doc.documentElement.setAttribute("data-leaflet-layout", layoutRef.current);
          // A phone's pages keep no room for chrome that is away (readers/pagesStyle.ts).
          doc.documentElement.toggleAttribute("data-leaflet-phone", phone);
          // A narrow column reins in the book's widest insets and boxes (readers/narrowColumn.ts).
          markNarrowColumn(
            doc,
            textColumnWidth({
              pages: layoutRef.current === "pages",
              frame: (((rendition.manager as any)?.container as HTMLElement | undefined) ?? viewerRef.current)?.clientWidth || window.innerWidth,
              columnWidth: layout?.columnWidth,
              pad,
              measure: bookMeasureCss(),
              fontSize: fontSizeRef.current
            })
          );
          if (!doc.getElementById("reader-font-scale")) {
            // The book's drop caps and opening small capitals are found
            // first, while the publisher's own sizes can still be read: the
            // rules below give running text one size (readers/dropCaps.ts).
            try {
              markOpenings(doc);
            } catch {
              // An opening left unmarked is set at body size, as it was.
            }
            // And what the publisher did with whole blocks: centred lines,
            // headings that are paragraphs, paragraphs that are divs, scene
            // breaks made of space, insets (readers/bookBlocks.ts).
            try {
              markBlocks(doc);
            } catch {
              // A block left unmarked is set as running text, as it was.
            }
            try {
              markNarrowBoxes(doc);
            } catch {
              // A block left unmarked keeps the book's own room on a narrow column.
            }
            const style = doc.createElement("style");
            style.id = "reader-font-scale";
            style.textContent = `
              @font-face { font-family: "ZT Nature"; src: url("${ztNatureBoldWoff2}") format("woff2"); font-display: swap; font-weight: 700; }
              :root { --reader-font-size: ${fontSizeRef.current}px; }
              html { font-size: var(--reader-font-size) !important; }
              /* A new line length eases in, but only once the chapter has
                 settled (see the end of this hook). */
              html[data-leaflet-settled], html[data-leaflet-settled] body { transition: padding 0.25s ease; }
              /* Scrolling: the text fills the width. Pages: epub.js sets the
                 body's width for its columns, which this must not override. */
              html:not([data-leaflet-layout="pages"]), html:not([data-leaflet-layout="pages"]) body { width: 100% !important; max-width: 100% !important; }
              body { font-size: 1em !important; margin: 0 !important; padding-top: ${PAGE_TOP_PAD}px !important; padding-left: ${MEASURE_PADDING} !important; padding-right: ${MEASURE_PADDING} !important; text-align: var(--reader-align, justify) !important; text-justify: inter-word !important; hyphens: auto; line-height: var(--reader-line-height, 1.8) !important; box-sizing: border-box; }
              /* The face (readers/readerTypes.ts). A book that names none is
                 set in the book serif; a face the reader chose is imposed on
                 the running text, and "the book's own" imposes nothing. Code
                 keeps its fixed width, headings their own face (below). */
              :where(body) { font-family: ${FALLBACK_FACE}; }
              html[data-leaflet-face] body,
              html[data-leaflet-face] body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font):not(:where(pre, code, kbd, samp, tt) *) { font-family: var(--reader-font-family) !important; }
              body > *:first-child { margin-top: 0 !important; padding-top: 0 !important; }
              /* One reading size for running text, whatever the publisher
                 set; headings, footnote markers and small print keep their
                 proportions (a blanket rule made headings body-sized and
                 footnote numbers full-sized). */
              body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font) { font-size: inherit !important; }
              body * { line-height: inherit; box-sizing: border-box; max-width: 100% !important; }
              /* One line spacing for running text too, the reader's: a
                 publisher's own (often tighter) would leave the setting
                 doing nothing, and every count made in lines wrong. */
              body :where(p, div, span, li, blockquote, td, th, dd, dt, a, em, i, b, strong, cite, section, article, font) { line-height: inherit !important; }
              h1 { font-size: 1.6em !important; }
              h2 { font-size: 1.4em !important; }
              h3 { font-size: 1.22em !important; }
              h4, h5, h6 { font-size: 1.08em !important; }
              sup, sub { font-size: 0.72em !important; line-height: 0 !important; }
              small { font-size: 0.86em !important; }
              body > * { max-width: 100% !important; }
              p { text-align: var(--reader-align, justify) !important; text-justify: inter-word !important; hyphens: auto; text-indent: 0 !important; margin-left: 0 !important; margin-bottom: 1.6em !important; }
              /* A ragged right edge needs no broken words. */
              html[data-leaflet-align="left"] body, html[data-leaflet-align="left"] body * { -webkit-hyphens: manual !important; hyphens: manual !important; }
              /* Scene breaks, epigraphs and title lines the book centres stay centred. */
              p[align="center"], p.center, p.centered, p[style*="text-align: center"], p[style*="text-align:center"],
              div[align="center"] p, .center p, .centered p { text-align: center !important; }
              /* On a dark page, text the publisher coloured dark (common in
                 InDesign exports) takes the page's ink, links the accent,
                 and boxes lose light backgrounds that would glare. */
              html[data-reader-dark="1"] body :where(div, span, em, i, b, strong, small, cite, section, article, figcaption, sup, sub, font, dfn, abbr) { color: inherit !important; }
              /* Links only. Books mark page breaks with empty anchors
                 (<a id="page12"/>); read as HTML those never close, and the
                 paragraph after each one ended up inside it, in the accent. */
              html[data-reader-dark="1"] body a:any-link { color: #8cc95a !important; }
              /* An anchor that is not a link takes the page's ink, like any
                 other inline (a book's "a { color: navy }" reaches the text
                 an unclosed <a id> swallowed). And the colour is the colour:
                 a book that also sets -webkit-text-fill-color (which paints
                 over "color") kept its navy links on a black page. */
              html[data-reader-dark="1"] body a:not(:any-link) { color: inherit !important; }
              body, body * { -webkit-text-fill-color: currentcolor !important; }
              html[data-reader-dark="1"] body :where(div, section, article, aside, p, blockquote, table, tr, td, th) { background-color: transparent !important; }
              p, div, section, article, blockquote, li { text-indent: 0 !important; margin-left: 0 !important; }
              /* Lists. A bullet or a number sits beside its item's first
                 line: a stylesheet that says "inside" with a paragraph in the
                 item (<li><p>) leaves the marker alone on a line of its own,
                 above its item. And a list inside a list is indented: reset
                 to no padding, every level started at the same edge. */
              body li { list-style-position: outside !important; }
              body :where(ul, ol) { padding-left: 2em !important; margin-left: 0 !important; }
              body li > :where(p, div):first-child { margin-top: 0 !important; }
              h1, h2, h3, h4, h5, h6 { font-family: "ZT Nature", "Segoe UI", sans-serif !important; font-weight: 700 !important; letter-spacing: -0.01em; }
              html[data-reader-finish="paper"] body { color: #30291f !important; }
              html[data-reader-finish="paper"] p,
              html[data-reader-finish="paper"] li,
              html[data-reader-finish="paper"] blockquote,
              html[data-reader-finish="paper"] td,
              html[data-reader-finish="paper"] dd {
                color: rgba(43, 36, 27, 0.96) !important;
                text-shadow:
                  0.18px 0 rgba(32, 25, 18, 0.42),
                  -0.12px 0.16px rgba(82, 65, 43, 0.2);
                filter: contrast(1.035);
              }
              html[data-reader-finish="paper"] h1,
              html[data-reader-finish="paper"] h2,
              html[data-reader-finish="paper"] h3,
              html[data-reader-finish="paper"] h4,
              html[data-reader-finish="paper"] h5,
              html[data-reader-finish="paper"] h6 {
                color: #2b3a2c !important;
                text-shadow: 0.22px 0.18px rgba(45, 35, 24, 0.28);
              }
              html[data-reader-finish="paper"] ::selection { background: rgba(30, 111, 66, 0.25); }
              html[data-reader-finish="dark-paper"] body { color: #eeeae0 !important; }
              html[data-reader-finish="dark-paper"] p,
              html[data-reader-finish="dark-paper"] li,
              html[data-reader-finish="dark-paper"] blockquote,
              html[data-reader-finish="dark-paper"] td,
              html[data-reader-finish="dark-paper"] dd {
                color: rgba(238, 234, 224, 0.96) !important;
                text-shadow:
                  0.16px 0 rgba(255, 255, 255, 0.12),
                  -0.12px 0.16px rgba(0, 0, 0, 0.46);
                filter: contrast(1.04);
              }
              html[data-reader-finish="dark-paper"] h1,
              html[data-reader-finish="dark-paper"] h2,
              html[data-reader-finish="dark-paper"] h3,
              html[data-reader-finish="dark-paper"] h4,
              html[data-reader-finish="dark-paper"] h5,
              html[data-reader-finish="dark-paper"] h6 {
                color: #d9f4e2 !important;
                text-shadow: 0.2px 0.18px rgba(0, 0, 0, 0.55);
              }
              html[data-reader-finish="dark-paper"] ::selection { background: rgba(114, 171, 68, 0.34); }
              html[data-reader-finish="true-white"] body,
              html[data-reader-finish="true-white"] p,
              html[data-reader-finish="true-white"] li,
              html[data-reader-finish="true-white"] blockquote,
              html[data-reader-finish="true-white"] td,
              html[data-reader-finish="true-white"] dd {
                color: #090a09 !important;
                text-shadow: none !important;
                filter: none !important;
              }
              html[data-reader-finish="true-white"] h1,
              html[data-reader-finish="true-white"] h2,
              html[data-reader-finish="true-white"] h3,
              html[data-reader-finish="true-white"] h4,
              html[data-reader-finish="true-white"] h5,
              html[data-reader-finish="true-white"] h6 {
                color: #090a09 !important;
                text-shadow: none !important;
              }
              html[data-reader-finish="true-white"] ::selection { background: rgba(79, 123, 55, 0.24); }
              html[data-reader-finish="true-black"] body,
              html[data-reader-finish="true-black"] p,
              html[data-reader-finish="true-black"] li,
              html[data-reader-finish="true-black"] blockquote,
              html[data-reader-finish="true-black"] td,
              html[data-reader-finish="true-black"] dd {
                color: #f2f1eb !important;
                text-shadow: none !important;
                filter: none !important;
              }
              html[data-reader-finish="true-black"] h1,
              html[data-reader-finish="true-black"] h2,
              html[data-reader-finish="true-black"] h3,
              html[data-reader-finish="true-black"] h4,
              html[data-reader-finish="true-black"] h5,
              html[data-reader-finish="true-black"] h6 {
                color: #f2f1eb !important;
                text-shadow: none !important;
              }
              html[data-reader-finish="true-black"] ::selection { background: rgba(114, 171, 68, 0.42); }
              /* Ink-on-white pictures (see markInkImages) take the page's
                 colour: on a light page the white multiplies into the paper;
                 on a dark page only headings and ornaments are inverted to
                 white ink and screened onto the page. Maps and drawings stay
                 as drawn. The picture viewer switches a picture back. */
              html[data-reader-dark="0"] [data-leaflet-ink]:not([data-leaflet-ink-off="1"]) { mix-blend-mode: multiply; }
              html[data-reader-dark="1"] [data-leaflet-ink="title"]:not([data-leaflet-ink-off="1"]) {
                filter: invert(1) hue-rotate(180deg) brightness(0.92);
                mix-blend-mode: screen;
              }
              /* A picture that opens in the viewer (readers/pictures.ts). Two
                 fingers on it are the viewer's pinch, never the browser's zoom
                 (readers/pictureHandover.ts); one still scrolls the page. */
              [data-leaflet-zoom] { cursor: zoom-in; touch-action: pan-x pan-y; }
              ${OPENINGS_CSS}
              ${BLOCKS_CSS}
              ${NARROW_CSS}
              ${PAGES_CSS}
              ${PHONE_PAGES_CSS}
              ${PHONE_TEXT_CSS}
            `;
            doc.head.appendChild(style);
          } else {
            doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
            doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          }
          // Scrolling only: clipping the width would hide a paginated
          // chapter's columns from epub.js, which would then see one page.
          if (layoutRef.current !== "pages") {
            doc.documentElement.style.overflow = "visible";
            doc.body.style.overflow = "visible";
            doc.documentElement.style.overflowX = "hidden";
            doc.body.style.overflowX = "hidden";
          }
          const currentDisplayMode = displayModeRef.current;
          const currentReaderTheme = readerThemeRef.current;
          const finish = getReaderFinish(currentDisplayMode, currentReaderTheme);
          const finishBackground = getReaderFinishBackground(finish);
          doc.documentElement.dataset.readerFinish = currentDisplayMode;
          doc.documentElement.dataset.readerDark = finish.themeName === "leaflet-dark" ? "1" : "0";
          // Scrolling, a picture has the window's room and no more (readers/bookBlocks.ts).
          doc.documentElement.style.setProperty(
            "--leaflet-picture-room",
            `${pictureRoom((((rendition.manager as any)?.container as HTMLElement | undefined) ?? viewerRef.current)?.clientHeight ?? 0, PAGE_TOP_PAD, PAGE_FOOT_PAD)}px`
          );
          // The lines of a flattened contents page that lead to a contents entry.
          markListedLines(doc, tocLabelsRef.current);
          markInkImages(doc);
          // (Which pictures open the viewer is looked at once the chapter is
          // laid out, below: measured here, each chapter was laid out twice.)
          doc.documentElement.style.backgroundColor = finish.background;
          doc.body.style.backgroundColor = finish.background;
          doc.documentElement.style.backgroundImage = finishBackground;
          doc.body.style.backgroundImage = finishBackground;
          doc.documentElement.style.backgroundSize = "auto";
          doc.body.style.backgroundSize = "auto";
          applyEndRoom(contents);
          // The frame was sized before these styles and the theme's went in,
          // and they make a chapter two or three times as long. epub.js
          // measures again a frame later, but goes to the place asked for
          // first: a place further down than the old length was out of
          // reach, so a saved place, a bookmark or a search result deep in a
          // chapter opened somewhere else in it, or on a blank page. The
          // frame takes its real size now.
          try {
            (rendition.manager as any)?.views?.forEach?.((view: any) => {
              if (view?.contents === contents) {
                view.expand?.();
              }
            });
          } catch {
            // epub.js measures again by itself.
          }
          // Only from here does a change of line length ease in. Easing the
          // padding as the chapter arrived went on moving every line for a
          // quarter of a second after the place had been gone to.
          void doc.body.offsetHeight;
          doc.documentElement.setAttribute("data-leaflet-settled", "1");
        });

        // epub.js writes a theme's keys out as they are given, so a key in
        // camelCase (overflowX, borderTop) is no CSS property and does
        // nothing. Three such rules mattered and are now spelt as CSS: a rule
        // (hr) had its border taken away and never given back, so a scene
        // break drawn with one was a blank gap; a table wider than the column
        // ran off the window with no way to reach its last cells; and a long
        // line of code did the same. The other camelCase keys below are
        // still inert, on purpose: what they ask for the reader's stylesheet
        // (reader-font-scale) already does, except a hairline above h1 and
        // h2 and a gap under list items, which no book has ever been shown
        // with. Spelling those as CSS would change the look of every book.
        rendition.themes.register("leaflet-dark", {
          html: {
            background: "#202227",
            color: "#f7f9fc",
            overflowX: "hidden"
          },
          body: {
            background: "#202227",
            color: "#f7f9fc",
            lineHeight: "1.8",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          p: {
            margin: "0 0 1.6em 0",
            textAlign: "justify",
            textIndent: "0"
          },
          span: {
            fontSize: "inherit"
          },
          div: {
            fontSize: "inherit"
          },
          li: {
            marginBottom: "0.6em"
          },
          h1: { fontSize: "1.6em", margin: "2.2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(255,255,255,0.08)" },
          h2: { fontSize: "1.45em", margin: "2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(255,255,255,0.08)" },
          h3: { fontSize: "1.3em", margin: "1.6em 0 0.5em 0" },
          h4: { fontSize: "1.2em", margin: "0 0 0.5em 0" },
          h5: { fontSize: "1.1em", margin: "0 0 0.4em 0" },
          h6: { fontSize: "1.05em", margin: "0 0 0.4em 0" },
          hr: { border: "none", "border-top": "1px solid rgba(255,255,255,0.08)", margin: "2em 0" },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            display: "block",
            "overflow-x": "auto"
          },
          pre: {
            "white-space": "pre-wrap",
            "overflow-wrap": "anywhere"
          },
          code: {
            "overflow-wrap": "anywhere"
          }
        });
        rendition.themes.register("leaflet-light", {
          html: {
            background: "#edeae2",
            color: "#16191e",
            overflowX: "hidden"
          },
          body: {
            background: "#edeae2",
            color: "#16191e",
            lineHeight: "1.8",
            margin: "0 auto",
            width: "100%",
            padding: "0",
            maxWidth: "100%",
            overflowX: "hidden"
          },
          "*": {
            boxSizing: "border-box",
            maxWidth: "100%"
          },
          p: {
            margin: "0 0 1.6em 0",
            textAlign: "justify",
            textIndent: "0"
          },
          span: {
            fontSize: "inherit"
          },
          div: {
            fontSize: "inherit"
          },
          li: {
            marginBottom: "0.6em"
          },
          h1: { fontSize: "1.6em", margin: "2.2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(15,15,16,0.12)" },
          h2: { fontSize: "1.45em", margin: "2em 0 0.6em 0", paddingTop: "0.4em", borderTop: "1px solid rgba(15,15,16,0.12)" },
          h3: { fontSize: "1.3em", margin: "1.6em 0 0.5em 0" },
          h4: { fontSize: "1.2em", margin: "0 0 0.5em 0" },
          h5: { fontSize: "1.1em", margin: "0 0 0.4em 0" },
          h6: { fontSize: "1.05em", margin: "0 0 0.4em 0" },
          hr: { border: "none", "border-top": "1px solid rgba(15,15,16,0.12)", margin: "2em 0" },
          img: {
            maxWidth: "100%",
            height: "auto"
          },
          svg: {
            maxWidth: "100%",
            height: "auto"
          },
          table: {
            width: "100%",
            display: "block",
            "overflow-x": "auto"
          },
          pre: {
            "white-space": "pre-wrap",
            "overflow-wrap": "anywhere"
          },
          code: {
            "overflow-wrap": "anywhere"
          }
        });
        const initialFinish = getReaderFinish(displayModeRef.current, readerThemeRef.current);
        rendition.themes.select(initialFinish.themeName);
        rendition.themes.override("background", initialFinish.background);
        rendition.themes.override("color", initialFinish.text);
        applyReaderTypography();
        applyReaderInsets();
        const initialFlow = layoutRef.current === "pages" ? "paginated" : "scrolled";
        // Pages on a phone on its side are a spread, two columns a turn
        // (readers/touchLayout.ts), at whatever width the phone has: epub.js's
        // own threshold (800 px) would take most phones' sideways width for
        // one column.
        const initialSpread = layoutRef.current === "pages" && reader.spreadRef.current ? "auto" : "none";
        rendition.flow(initialFlow);
        const manager = rendition.manager as any;
        if (manager?.settings) {
          manager.settings.flow = initialFlow;
          manager.settings.spread = initialSpread;
          if (initialSpread === "auto") {
            manager.settings.minSpreadWidth = 1;
          }
        }
        if (typeof rendition.spread === "function") {
          (rendition as any).spread(initialSpread, initialSpread === "auto" ? 1 : undefined);
        }
        ensureSingleScrollContainer();

        const navigation = await epub.loaded.navigation;
        if (cancelled) {
          return;
        }
        const spineIndexByHref: Record<string, number> = {};
        const spineItems = epub.spine?.items ?? [];
        spineItems.forEach((item: any, idx: number) => {
          if (item?.href) {
            spineIndexByHref[item.href] = idx;
          }
        });
        // A section outside the reading order (linear="no": often the cover,
        // or a file of notes) is a dead end to epub.js: it has no next and no
        // previous. Opened from the chapter list or a link, nothing followed
        // it down the page, auto-scroll and Smart Read announced the end of
        // the book there, and with pages it could not be turned away from. It
        // leads on to the reading order around it; reading through the book
        // still passes it by.
        const sections: any[] = (epub.spine as any)?.spineItems ?? [];
        // The same file twice in a row in the reading order (a title page a
        // conversion listed as the cover too) is shown once: the second is
        // passed by like any section outside the reading order, and links
        // to the file lead to the first.
        listedAgain(sections.map((section) => String(section?.href ?? ""))).forEach((at) => {
          sections[at].linear = false;
          const shown = Math.min(spineIndexByHref[sections[at].href] ?? at, at - 1);
          spineIndexByHref[sections[at].href] = shown;
          // epub.js keeps a table of its own, which named the last copy: a
          // contents entry for the file opened the copy that is passed by.
          const byHref = (epub.spine as any)?.spineByHref as Record<string, number> | undefined;
          if (byHref) {
            for (const key of Object.keys(byHref)) {
              if (byHref[key] === at) {
                byHref[key] = shown;
              }
            }
          }
        });
        sections.forEach((section, at) => {
          if (!section || section.linear) {
            return;
          }
          const towards = (step: 1 | -1) => () => {
            for (let i = at + step; i >= 0 && i < sections.length; i += step) {
              if (sections[i]?.linear) {
                return sections[i];
              }
            }
            return undefined;
          };
          section.next = towards(1);
          section.prev = towards(-1);
        });
        // TOC links are written relative to the table of contents file, but
        // sections are named relative to the package file. When the two live
        // in different folders (nav in Text/, chapters beside it), the raw
        // links matched nothing: chapter entries did nothing when clicked,
        // and progress had no chapters to count.
        const packaging = (epub as unknown as { packaging?: { navPath?: string; ncxPath?: string } }).packaging;
        const tocFile = packaging?.navPath || packaging?.ncxPath || "";
        const tocDir = tocFile.includes("/") ? tocFile.slice(0, tocFile.lastIndexOf("/") + 1) : "";
        const resolveTocHref = (href: string) => {
          const hashAt = href.indexOf("#");
          const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
          const fragment = hashAt >= 0 ? href.slice(hashAt) : "";
          if (!path || spineIndexByHref[path] !== undefined || /^[a-z]+:/i.test(path)) {
            return href;
          }
          const parts: string[] = [];
          for (const part of `${tocDir}${path}`.split("/")) {
            if (part === "..") {
              parts.pop();
            } else if (part && part !== ".") {
              parts.push(part);
            }
          }
          const joined = parts.join("/");
          let decoded = joined;
          try {
            decoded = decodeURIComponent(joined);
          } catch {
            // A stray "%" in a file name: the raw form is the only candidate.
          }
          const candidates = [joined, decoded];
          const match = candidates.find((candidate) => spineIndexByHref[candidate] !== undefined);
          return match ? `${match}${fragment}` : href;
        };
        // Labels come with the file's own line breaks and indentation, which
        // went into every bookmark and highlight made under them.
        // epub.js files an NCX's entries by id and loses every entry under a
        // repeated one (readers/ncx.ts: half a boxed set's chapters). The
        // file is read again by its nesting, and used when it holds more.
        let tocTree = navigation.toc as TocItem[];
        if (packaging?.ncxPath && !packaging?.navPath) {
          try {
            const ncx = await (epub as any).load(packaging.ncxPath);
            tocTree = fullerToc(tocTree, tocFromNcx((ncx as Document | null)?.documentElement as any));
          } catch {
            // The contents as epub.js read them.
          }
          if (cancelled) {
            return;
          }
        }
        spineIndexByHrefRef.current = spineIndexByHref;
        // Section sizes, for progress by how much has been read. A quick call
        // (the archive's directory only); without it, the older estimates below.
        sectionWeightsRef.current = null;
        let bookSections: Awaited<ReturnType<typeof bookService.epubSections>> = [];
        try {
          bookSections = await bookService.epubSections(book.id).catch(() => []);
          if (cancelled) {
            return;
          }
          // No backend (the browser preview), or it could not read them: the
          // sizes are in the copy of the archive epub.js already holds.
          if (bookSections.length === 0) {
            bookSections = sectionsFromArchive(epub);
          }
        } catch {
          bookSections = [];
        }
        // Chapters are counted per section file: a location reports its file,
        // never the anchor inside it, so the keys drop the "#...". (Read by
        // the relocation handler below; refilled when the contents change.)
        const indexMap: Record<string, number> = {};
        /**
         * Takes a contents tree as the book's contents: the flat list, the
         * entries as places, the story's span among the sections, the books
         * inside a set, the chapter list itself. Everything that hangs off
         * the contents is redone here and nowhere else, so the contents can
         * be replaced after the book has opened (a list made by Leaflet for a
         * book that came with none: `made`).
         */
        const applyContents = (given: TocItem[], made: boolean) => {
          // Parts and their chapters at one level: the chapters under their parts (readers/autoContents.ts).
          const tree = nestFlatParts(given);
          const flatToc = flattenToc(tree).map((item) => ({
            ...item,
            label: item.label.replace(/\s+/g, " ").trim(),
            href: resolveTocHref(item.href)
          }));
          const flatDepths = tocDepths(tree);
          setToc(flatToc);
          const chapterToc = flatToc.filter((item) => isChapterLike(item.label));
          for (const key of Object.keys(indexMap)) {
            delete indexMap[key];
          }
          let dedupIndex = 0;
          const seenHrefs = new Set<string>();
          chapterToc.forEach((item) => {
            const file = item.href.split("#")[0];
            if (seenHrefs.has(file)) {
              return;
            }
            seenHrefs.add(file);
            indexMap[file] = dedupIndex;
            dedupIndex += 1;
          });
          tocPlacesRef.current = flatToc.map((item) => tocPlace(item.href, (file) => spineIndexByHref[file], item.cfi));
          tocLabelsRef.current = flatToc.map((item) => item.label);
          chapterSpineIndicesRef.current = Object.keys(indexMap)
            .map((href) => spineIndexByHref[href])
            .filter((value) => typeof value === "number")
            .sort((a, b) => (a as number) - (b as number)) as number[];

          tocSpineStartsRef.current = flatToc
            .map((item) => spineIndexByHref[item.href.split("#")[0]])
            .filter((value): value is number => typeof value === "number");

          try {
            sectionWeightsRef.current = buildSectionWeights(
              spineItems.map((item: any) => String(item?.href ?? "")),
              bookSections,
              flatToc,
              (href) => spineIndexByHref[href.split("#")[0]]
            );
          } catch {
            sectionWeightsRef.current = null;
          }
          setCanSeek(sectionWeightsRef.current !== null);
          // The books inside, when the file is a set of them (readers/innerBooks.ts).
          const contentsRows: ContentsRow[] = flatToc.map((item, index) => ({
            label: item.label,
            spine: tocPlacesRef.current[index]?.spine,
            depth: flatDepths[index] ?? 0,
            book: item.book
          }));
          const weighed = sectionWeightsRef.current;
          contentsRowsRef.current = contentsRows;
          innerBooksRef.current = weighed ? findInnerBooks(contentsRows, weighed.bytes) : [];
          // The stretches between two of its stories (one book's appendices, the next one's cover and maps).
          storyGapsRef.current = weighed
            ? storyGaps(innerBooksRef.current, weighed.bytes.length - 1)
                .filter((gap) => gap.before >= 0 && gap.after >= 0)
                .map((gap) => ({ from: gap.from, to: gap.to, start: fractionAt(weighed, gap.from, 0), end: fractionAt(weighed, gap.to, 1) }))
            : [];
          setContents({ rows: contentsRows, books: innerBooksRef.current, bytes: weighed?.bytes ?? [], made });
        };
        applyContents(tocTree, false);
        applyContentsRef.current = (tree, made = true) => {
          if (cancelled || renditionRef.current !== rendition) {
            return;
          }
          applyContents(tree, made);
          // The chapter's name and the percentage are read from the contents: say them again.
          updateOutlookRef.current();
        };

        // A chapter list for a book that came with none, or next to none
        // (readers/autoContents.ts). What was found the last time the book
        // was open is used at once. Otherwise the book is read for its
        // headings once its first page is up, a section at a time between
        // the page's own work (readers/contentsScan.ts), and the list
        // changes when that is done. A book with honest contents keeps them.
        const contentsKey = `${CONTENTS_KEY_PREFIX}${book.id}`;
        const withinOf = (tree: TocItem[], within: Record<string, number>) =>
          flattenToc(tree).map((item) => within[placeKey({ href: resolveTocHref(item.href), cfi: item.cfi })] ?? 0);
        let keptContents: KeptContents | null = null;
        try {
          keptContents = readKept(localStorage.getItem(contentsKey), spineItems.length);
        } catch {
          keptContents = null;
        }
        if (keptContents) {
          if (keptContents.toc) {
            applyContents(keptContents.toc, keptContents.use !== "own");
          }
          tocWithinRef.current = withinOf(keptContents.toc ?? tocTree, keptContents.within);
        } else {
          tocWithinRef.current = [];
          let begun = false;
          const findContents = async () => {
            if (begun || cancelled) {
              return;
            }
            begun = true;
            const gone = {
              get aborted() {
                return cancelled || renditionRef.current !== rendition;
              }
            };
            const scan = await scanBook(epub, { signal: gone, landmarks: (navigation as any)?.landmarks });
            if (!scan || gone.aborted) {
              return;
            }
            const placeOf = (href: string) => {
              const at = tocPlace(resolveTocHref(href), (file) => spineIndexByHref[file]);
              return { section: at.spine, anchor: at.anchor };
            };
            const decision = decideContents(tocTree, placeOf, scan.sections);
            // Where in its file each entry with an anchor is: a chapter that
            // shares its file with the next ends there (the time left in it).
            const within: Record<string, number> = { ...decision.within };
            flattenToc(decision.toc).forEach((item) => {
              const href = resolveTocHref(item.href);
              const at = placeOf(href);
              if (!item.cfi && at.anchor && typeof at.section === "number") {
                const share = scan.ids[at.section]?.get(at.anchor);
                if (typeof share === "number" && share > 0) {
                  within[href] = share;
                }
              }
            });
            try {
              localStorage.setItem(contentsKey, JSON.stringify(keepContents(decision, spineItems.length, within)));
            } catch {
              // Found again the next time.
            }
            if (import.meta.env.DEV) {
              (window as unknown as { __leafletContents?: unknown }).__leafletContents = { use: decision.use, reason: decision.reason, source: decision.source, ms: scan.ms, sections: scan.sections.length };
            }
            if (decision.use !== "own") {
              applyContentsRef.current(decision.toc, true);
            } else if (decision.retitled) {
              // The book's own, its names put right.
              applyContentsRef.current(decision.toc, false);
            }
            tocWithinRef.current = withinOf(decision.toc, within);
            updateOutlookRef.current();
            // The lines of a flattened contents page on the page now lead to the entries just made.
            ((rendition.getContents?.() as any[] | undefined) ?? []).forEach((shown) => {
              if (shown?.document) {
                markListedLines(shown.document, tocLabelsRef.current);
              }
            });
          };
          (rendition as any).once?.("displayed", () => window.setTimeout(() => void findContents(), 900));
          window.setTimeout(() => void findContents(), 8000);
        }

        /** With pages, the place carried in from the layout before while no page shown holds it yet (useReaderPlace). */
        const carriedPlace = () => {
          const carried = reader.carriedPlaceRef.current;
          return layoutRef.current === "pages" && carried && Date.now() <= carried.until ? carried.cfi : null;
        };
        /** When the saved place was put back (0: not yet, or there was none), and the last input then. */
        let restoredAt = 0;
        let handsOnAtRestore = 0;
        const onRelocated = (location: any) => {
          // A look at the map or the notes from the middle of the story
          // (readers/progress.ts: outsideStory): the progress and the saved
          // place stay where the reading is. Front matter used to read as
          // 0%, and closing the book there saved it.
          let lookingOutside = false;
          const outside = (side: "front" | "back") => {
            const known = lastCfiProgressRef.current ?? (lastComputedProgressRef.current >= 0 ? lastComputedProgressRef.current : 0);
            const rule = outsideStory(side, known);
            lookingOutside = !rule.placeFollows;
            return rule.progress;
          };
          const resolveProgress = () => {
            const href = location?.start?.href ?? location?.end?.href;
            // Scrolling: where the reading line is (as the saved place and
            // the dock's percentage are), not the top of the window, which
            // is under the toolbar and a screenful coarse.
            const line = layoutRef.current === "scroll" ? sectionPlace() : null;
            const spineIndex = line
              ? line.section
              : typeof location?.start?.index === "number"
                ? location.start.index
                : typeof location?.end?.index === "number"
                  ? location.end.index
                  : href
                    ? spineIndexByHrefRef.current[href]
                    : undefined;

            const sectionProgress = () => {
              if (line) {
                return line.within;
              }
              // (A chapter of one page is read once it is shown: a last
              // chapter that short used to count for nothing, and the book
              // could not be finished.)
              const displayed = location?.start?.displayed ?? location?.end?.displayed;
              if (displayed?.page && displayed?.total && displayed.total >= 1) {
                const ratio = displayed.page / displayed.total;
                if (Number.isFinite(ratio)) {
                  return Math.min(1, Math.max(0, ratio));
                }
              }
              return 0;
            };

            // epub.js's own index of the book, when it has made one (null until then).
            const located = (() => {
              const cfi = location?.start?.cfi ?? location?.end?.cfi;
              const locations = bookRef.current?.locations;
              if (cfi && locations?.percentageFromCfi) {
                try {
                  const percent = locations.percentageFromCfi(cfi);
                  if (typeof percent === "number" && Number.isFinite(percent)) {
                    return percent;
                  }
                } catch {
                  // Not indexed yet.
                }
              }
              const direct = location?.start?.percentage ?? location?.end?.percentage;
              return typeof direct === "number" && Number.isFinite(direct) ? direct : null;
            })();

            // By the sections' sizes, else the chapters, else epub.js's index,
            // else the section's place in the book (readers/progress.ts:
            // readingAt). Never 0 past the first section: the chapters' idea
            // of where the story starts used to come first, and a book whose
            // only chapter-like entries were its epilogue and an appendix
            // saved 0% from anywhere before them.
            const displayed = location?.start?.displayed ?? location?.end?.displayed;
            const reading = readingAt({
              spineIndex,
              within: sectionProgress(),
              spineCount: spineItems.length,
              weights: sectionWeightsRef.current,
              chapterSpines: chapterSpineIndicesRef.current,
              chapterIndex: href && indexMap[href] !== undefined ? indexMap[href] : undefined,
              located,
              endInView: line ? storyEndInView() : false,
              // Finished with pages on the story's last page; scrolling, by its last line (above).
              page: line ? null : { page: Number(displayed?.page) || 0, total: Number(displayed?.total) || 0 },
              between: lookingBetweenStories,
              wasFinished: isFinished(lastProgressRef.current)
            });
            if (!reading) {
              // Unknown: better to save nothing than a 0 that overwrites real progress.
              return null;
            }
            if (reading.kind === "front" || reading.kind === "back") {
              return outside(reading.kind);
            }
            if (reading.kind === "between") {
              lookingOutside = true;
              return null;
            }
            // The camp goes by chapters where a book has them (see pip/base/storyFeed).
            if (reading.chapter) {
              noteChapter(book.id, reading.chapter.index, reading.chapter.total);
            }
            return reading.progress;
          };

          const percentage = resolveProgress();
          if (percentage !== null) {
            lastCfiProgressRef.current = percentage;
          }
          // For the next look: whether the story's end is still below the
          // window. A jump is not reading through it.
          if (layoutRef.current === "scroll") {
            const endBottom = storyEndBottom();
            const windowHeight = ((rendition.manager as any)?.container as HTMLElement | undefined)?.clientHeight ?? 0;
            storyEndWasBelowRef.current = Date.now() >= navigatingUntilRef.current && endBottom !== null && endBottom > windowHeight + 1;
          }
          const now = Date.now();
          // The place saved is the reading line (readers/readingPlace.ts),
          // the height a reopened book puts it back at. It used to be the
          // line at the very top, under the toolbar: put back 80px lower,
          // the line then at the top was saved, and a book reopened without
          // scrolling crept back some seventy pixels each time.
          const lineNow = layoutRef.current === "scroll" ? readingPlace() : null;
          shownLineRef.current = lineNow;
          const savedCfi = lookingOutside
            ? null
            : placeToSave(
                layoutRef.current,
                lineNow?.cfi ?? null,
                // With pages, the place held across re-layouts (see pagePlaceRef), when there is one.
                (layoutRef.current === "pages" ? pagePlaceRef.current?.cfi : null) ?? (location?.start?.cfi as string | undefined) ?? null,
                // With pages, a place carried from the layout before, not yet on a page shown (readers/readingPlace.ts).
                carriedPlace()
              );
          if (location?.start?.cfi) {
            const href = location?.start?.href;
            if (href) {
              chapterPositionsRef.current = {
                ...chapterPositionsRef.current,
                [href]: location.start.cfi
              };
            }
            if (savedCfi) {
              lastCfiRef.current = savedCfi;
              lastCfiBelowRef.current = lineNow && lineNow.cfi === savedCfi ? Math.round(lineNow.below) : 0;
              persistReaderState({ cfi: savedCfi, chapterPositions: chapterPositionsRef.current });
            } else {
              persistReaderState({ chapterPositions: chapterPositionsRef.current });
            }
          }

          // no auto-advance in scroll mode

          if (!progressArmedRef.current && lastHandsOnAtRef.current > openedAtRef.current) {
            progressArmedRef.current = true;
          }
          // A look at a highlight (opened from the library) is not reading on
          // from there: the book's progress and place wait until it is.
          const shouldUpdateProgress =
            percentage !== null &&
            progressArmedRef.current &&
            placeFollowsNow() &&
            // Opening the book is not reading it back to the start (readers/progress.ts).
            !dropsToStartAtOpen(
              lastProgressRef.current,
              percentage,
              lastHandsOnAtRef.current <= handsOnAtRestore && now - restoredAt < OPEN_SETTLE_MS
            ) &&
            (Math.abs(percentage - lastProgressRef.current) >= 0.005 || now - lastProgressAtRef.current >= 10000);

          if (shouldUpdateProgress && percentage !== null) {
            lastProgressRef.current = percentage;
            lastProgressAtRef.current = now;
            const position = savedCfi ?? location?.start?.cfi ?? null;
            lastCfiProgressRef.current = percentage;
            void bookService.updateProgress(book.id, percentage, position);
            updateBookProgress(book.id, percentage, position ?? undefined);
            lastComputedProgressRef.current = percentage;
          }

          scheduleReaderDotUpdate();
          scrollAdvanceLockRef.current = false;
          // Turning pages is reading too, and teaches the pace.
          if (layoutRef.current === "pages") {
            notePageShownRef.current(location);
          }
          updateOutlookRef.current();
        };
        relocateHandlerRef.current = onRelocated;
        // With pages, first: the page's number is put right before it is read below.
        rendition.on("relocated", notePagePlace);
        rendition.on("relocated", onRelocated);
        // Selected text is offered for highlighting (the selection bar).
        rendition.on("selected", (cfiRange: string, contents: any) => {
          const text = String(contents?.window?.getSelection?.()?.toString?.() ?? "")
            .replace(/\s+/g, " ")
            .trim();
          // A word selected by a swipe that scrolled the page (or turned it) was
          // never held: it is let go, and no bar comes up (readers/touchSelect.ts).
          const frame = (rendition.manager as any)?.container as HTMLElement | undefined;
          if (
            text &&
            reader.selectionRef.current === null &&
            selectionIsAccidental(pressRef.current, Date.now(), { top: frame?.scrollTop ?? 0, left: frame?.scrollLeft ?? 0 })
          ) {
            try {
              contents?.window?.getSelection?.()?.removeAllRanges?.();
            } catch {
              // Gone with its chapter.
            }
            return;
          }
          if (text) {
            // A note and the selection bar share a place: one at a time.
            closeNoteRef.current();
            setSelection({ cfi: cfiRange, text });
            // A word double-clicked is looked up without the button being
            // pressed (Settings, "Look a word up when I double-click it").
            // (Not by a finger: a phone selects by a press and hold, and Look up leads its bar.)
            if (!isTouchInput() && lookUpOnDoubleClick() && isDoubleClickedWord(text, doubleClickedAtRef.current)) {
              doubleClickedAtRef.current = 0;
              reader.setLookUpCfi(cfiRange);
            }
          }
        });
        const bindChromeReveal = () => {
          (rendition.getContents?.() ?? []).forEach((contents: any) => {
            const doc = contents?.document as Document | undefined;
            if (!doc || (doc as any).__leafletChromeBound) {
              return;
            }
            (doc as any).__leafletChromeBound = true;
            const handsOn = () => {
              lastHandsOnAtRef.current = Date.now();
              markReadingActivity();
            };
            // When a word was last double-clicked: the selection that follows is that word.
            doc.addEventListener("dblclick", () => {
              doubleClickedAtRef.current = Date.now();
            });
            let pressedAt = 0;
            doc.addEventListener(
              "pointerdown",
              (event: PointerEvent) => {
                const frame = (rendition.manager as any)?.container as HTMLElement | undefined;
                pressRef.current = { at: Date.now(), pointerType: event.pointerType, top: frame?.scrollTop ?? 0, left: frame?.scrollLeft ?? 0 };
                handsOn();
                scrollbarLetGoRef.current();
                pressedAt = Date.now();
                // (A finger brings the chrome by a tap in the middle of the
                // page, not by any touch: readers/text/useTouchReading.ts.)
                holdAutoScrollRef.current(true);
                // A click on the page lets a note go (a click on another
                // note reference then opens that one).
                if (noteRef.current) {
                  closeNoteRef.current();
                }
              },
              { passive: true }
            );
            // Web links in a book open in the browser. epub.js marks them
            // target=_blank, which the sandboxed page silently blocks, so
            // they used to do nothing. Links within the book are left to
            // epub.js, which turns them into jumps.
            doc.addEventListener(
              "click",
              (event) => {
                const anchor = (event.target as Element | null)?.closest?.("a[href]");
                const href = anchor?.getAttribute("href") ?? "";
                if (anchor && href.trim() && !isOutsideLink(href)) {
                  // A link within the book: a jump the reader can come back
                  // from, made the reader's own way (see followBookLinkRef).
                  event.preventDefault();
                  event.stopPropagation();
                  followBookLinkRef.current(anchor, contents?.sectionIndex);
                  return;
                }
                // A line of a contents page that a conversion flattened into
                // plain paragraphs, which names a contents entry: it goes
                // there, as the link it once was did (readers/bookBlocks.ts).
                const listed = anchor ? null : (event.target as Element | null)?.closest?.("[data-leaflet-jump]");
                if (listed && !(doc.getSelection?.()?.toString() ?? "").trim()) {
                  event.preventDefault();
                  event.stopPropagation();
                  goToListedLineRef.current(Number(listed.getAttribute("data-leaflet-jump")));
                  return;
                }
                if (!anchor) {
                  // A picture opens large (readers/ImageViewer.tsx). A long
                  // press is holding the page still, not asking to look. A
                  // finger's tap on a phone is told from a scroll first, and
                  // opens it there (useTapRuns.ts).
                  if (pressRef.current?.pointerType === "touch" && isTouchInput()) {
                    return;
                  }
                  const found = Date.now() - pressedAt < 700 ? pictureAt(event.target as Element | null) : null;
                  if (found) {
                    event.preventDefault();
                    openPictureRef.current(found);
                  }
                  return;
                }
                if (!/^https?:\/\//i.test(href)) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const secure = href.replace(/^http:\/\//i, "https://");
                accountService.openLink(secure).catch(() => showFocusToastRef.current("Couldn't open that link."));
              },
              true
            );
            // Hold to pause: auto-scroll waits while a finger or button is
            // down on the text (which is also when a passage is being selected).
            const release = () => holdAutoScrollRef.current(false);
            doc.addEventListener("pointerup", release, { passive: true });
            doc.addEventListener("pointercancel", release, { passive: true });
            // Once the text has been clicked the iframe owns focus, and Space,
            // arrows and Escape stopped working in every mode.
            doc.addEventListener("keydown", (event) => {
              handsOn();
              readerKeyHandlerRef.current?.(event);
            });
            // Wheeling over the text scrolls the outer container but the wheel
            // event itself stays in here; without it, manual reading stopped
            // earning time five minutes after the reader opened.
            doc.addEventListener(
              "wheel",
              (event) => {
                handsOn();
                contentWheelHandlerRef.current?.(event.deltaY);
              },
              { passive: true }
            );
            doc.addEventListener(
              "pointermove",
              (event) => {
                markReadingActivity();
                // The pointer over the text with no button down: a scrollbar that was held has been let go.
                if (event.buttons === 0) {
                  scrollbarLetGoRef.current();
                }
              },
              { passive: true }
            );
            doc.addEventListener("selectionchange", () => selectionChangedRef.current());
          });
        };
        bindChromeReveal();
        rendition.on?.("rendered", () => {
          applyReaderTypography();
          ensureSingleScrollContainer();
          ensureScrollContainer();
          scheduleReaderWordIndex(true);
          bindChromeReveal();
          // Images have their final addresses by now; check any the first
          // pass couldn't read.
          (rendition.getContents?.() ?? []).forEach((contents: any) => {
            if (contents?.document) {
              markInkImages(contents.document);
            }
          });
          // Measuring the pictures lays the chapters out: once the page is still.
          afterScrollSettles(() => {
            if (renditionRef.current !== rendition) {
              return;
            }
            (rendition.getContents?.() ?? []).forEach((contents: any) => {
              if (contents?.document) {
                markViewable(contents.document, reader.pinchablePicture);
              }
            });
          });
        });

        applyReaderInsets();
        // Opened at a match of the library's search: the words are found in
        // their section now that the book is open (readers/findPlace.ts), and
        // the reader goes there as it would to a saved place. Once: a book
        // laid out again reopens where the reader is by then.
        const sought = soughtRef.current;
        const match = sought ? await findInBook(epub, sought) : null;
        if (cancelled) {
          return;
        }
        if (sought) {
          soughtRef.current = null;
          if (match) {
            lastCfiRef.current = match.cfi;
            lastCfiBelowRef.current = 0;
          }
          // A book without that section opens where the reading stopped, and
          // that is no look (readers/openAt.ts).
          openedAtPlaceRef.current = isLook(openAt, match !== null);
        }
        // The saved place, if it still resolves. A stale or broken position
        // used to reject here and the book never opened again.
        markNavigating(2500);
        // Held there while the chapters round it come (readers/jumpSettle.ts):
        // put once, a place near a chapter's end opened a screen early.
        const opening = lastCfiRef.current;
        reader.beginJump();
        const restored = lastCfiRef.current
          ? await rendition.display(lastCfiRef.current).then(
              () => true,
              () => false
            )
          : false;
        if (cancelled) {
          return;
        }
        if (restored) {
          progressArmedRef.current = true;
          restoredAt = Date.now();
          handsOnAtRestore = lastHandsOnAtRef.current;
          // epub.js puts the saved line at the very top, under the toolbar:
          // it goes back to the reading line, as far below it as it was.
          const below = Math.min(lastCfiBelowRef.current, (ensureScrollContainer()?.clientHeight ?? 0) / 2);
          clearToolbar(lastCfiRef.current, below);
          if (opening) {
            reader.pinJump(() => reader.placeTopFor(opening, below));
          }
          // With pages, a place in the middle of a paragraph opened a page early.
          if (lastCfiRef.current) {
            settleOnPage(lastCfiRef.current);
          }
        } else {
          reader.jumpHoldRef.current = null;
          // No local position (another device, cleared data): start at the
          // chapter the synced progress points into, rather than page one.
          const progress = typeof book.progress === "number" ? book.progress : 0;
          const chapters = chapterSpineIndicesRef.current;
          const weights = sectionWeightsRef.current;
          const midway = progress > 0.01 && progress < 0.995;
          const spineIndex =
            midway && weights
              ? spineIndexForProgress(weights, progress)
              : midway && chaptersFrameBook(chapters, spineItems.length)
                ? chapters[Math.min(chapters.length - 1, Math.floor(progress * chapters.length))]
                : null;
          const href = spineIndex !== null ? epub.spine?.items?.[spineIndex]?.href : null;
          await (href ? rendition.display(href) : rendition.display()).catch(() => rendition.display());
          if (progress <= 0.001) {
            progressArmedRef.current = true;
          }
        }
        if (cancelled) {
          return;
        }
        scheduleReaderWordIndex(true);
        shown = true;
        relayingRef.current = false;
        setLoading(false);
        // The page that was goes once the new one is drawn, and the veil over
        // a turn or a new layout lifts (scrolling, once the line is pinned back).
        window.requestAnimationFrame(dropGhost);
        liftReaderVeil(layoutRef.current === "scroll" ? UNCOVER_SCROLLED_MS : 0);
        // The match the book was opened at is marked as a result of the
        // in-book search is, with that search open on the same words: the
        // book's other matches are a click away.
        if (restored && sought && match?.found) {
          markSearchHit(match.cfi);
          searchBookFor(sought.query);
        }
        // Indexing the whole book (for progress in books without usable
        // chapters) waits until the first page is up, and runs when idle.
        // With section sizes known, progress needs no index at all; this is
        // for the books where they could not be read.
        const locations = epub.locations;
        if (!sectionWeightsRef.current && locations && typeof locations.generate === "function" && !(reuse && (locations as any).length?.() > 0)) {
          const start = () => {
            if (!cancelled) {
              void locations.generate(1600);
            }
          };
          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(start, { timeout: 4000 });
          } else {
            window.setTimeout(start, 1200);
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        relayingRef.current = false;
        dropGhost();
        liftReaderVeil();
        setLoadError(friendlyOpenError(error instanceof Error ? error.message : String(error ?? "")));
        setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResizeFirst);
      // Laid out again in another layout: the book stays, parsed, and its
      // page stays on screen until the next one is up.
      const relaying = relayingRef.current;
      if (relaying && shown && !ghostRef.current && renditionRef.current) {
        ghostRef.current = freezeRendition(renditionRef.current);
      }
      if (renditionRef.current && relocateHandlerRef.current) {
        renditionRef.current.off("relocated", relocateHandlerRef.current);
      }
      // What was on its way in the page that is going: a page mid-slide, a
      // turn into another chapter (which hides the page until it arrives, and
      // would leave the next one hidden), a search result's mark.
      if (pageSlideRef.current) {
        window.cancelAnimationFrame(pageSlideRef.current.frame);
        pageSlideRef.current = null;
      }
      chapterTurnUntilRef.current = 0;
      // The place held for the pages belongs to the book and layout that are going.
      pagePlaceRef.current = null;
      pageRelayoutsRef.current = 0;
      queuedTurnRef.current = null;
      setPageOf(null);
      if (viewerRef.current) {
        delete viewerRef.current.dataset.turn;
      }
      if (searchMarkRef.current) {
        window.clearTimeout(searchMarkRef.current.timer);
        searchMarkRef.current = null;
      }
      removeLastReadMarker();
      // A book left in the moment between epub.js making its manager and
      // drawing the first chapter is half built, and taking it down throws:
      // leaving then showed "Something went wrong" instead of the library.
      if (renditionRef.current && renditionRef.current !== ghostRef.current?.rendition) {
        try {
          renditionRef.current.destroy();
        } catch {
          // Half built: there was nothing more of it to take down.
        }
      }
      renditionRef.current = null;
      if (!relaying) {
        dropGhost();
        parsedRef.current = null;
      }
      if (bookRef.current && !relaying) {
        try {
          bookRef.current.destroy();
        } catch {
          // The same.
        }
        bookRef.current = null;
      }
    };
  }, [book.id, localPath, reloadKey]);

  // The reader closing in the middle of a new layout: the book kept for it goes too.
  useEffect(
    () => () => {
      dropGhost();
      dropReaderVeil();
      parsedRef.current = null;
      if (bookRef.current) {
        try {
          bookRef.current.destroy();
        } catch {
          // Half built.
        }
        bookRef.current = null;
      }
    },
    []
  );
};
