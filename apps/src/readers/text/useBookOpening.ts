import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import ePub from "epubjs";
import { bookService } from "../../services/bookService";
import { accountService } from "../../services/accountService";
import ztNatureBoldWoff2 from "../../assets/fonts/ZTNature-Bold.woff2";
import { formatSummary, getBookExtension, isReadableExtension } from "../../constants/bookFormats";
import { buildSectionWeights, isChapterLike, onLastPage, outsideStory, progressToSave, spineIndexForProgress } from "../progress";
import { isFinished } from "../../constants/books";
import { FALLBACK_FACE, MEASURE_PADDING, applyTypeChoice, type TocItem } from "../readerTypes";
import { getReaderFinish, getReaderFinishBackground, PAGE_TOP_PAD } from "../finish";
import { flattenToc, tocPlace } from "../toc";
import { markInkImages } from "../inkImages";
import { friendlyOpenError } from "../openErrors";
import { markOpenings, OPENINGS_CSS } from "../dropCaps";
import { PAGE_FOOT_PAD, PAGES_CSS } from "../pagesStyle";
import { BLOCKS_CSS, markBlocks, markListedLines, pictureRoom } from "../bookBlocks";
import { sectionsFromArchive } from "../archiveSections";
import { holdsFetching } from "../scrollbarHold";
import { isOutsideLink } from "../bookLinks";
import { markViewable, pictureAt } from "../pictures";
import { fractionAt } from "../seek";
import { fullerToc, tocFromNcx } from "../ncx";
import { CONTENTS_KEY_PREFIX, decideContents, keepContents, placeKey, readKept, type KeptContents } from "../autoContents";
import { scanBook } from "../contentsScan";
import { listedAgain } from "../chapterSpan";
import { findInnerBooks, storyGaps, tocDepths, type ContentsRow } from "../innerBooks";
import { placeToSave } from "../readingPlace";
import type { WithCover } from "./scope";

/**
 * Opens the book: reads the file, builds the contents, makes the rendition,
 * and binds into each chapter's document as it arrives. One effect, as it has
 * always been; what it calls lives in the other hooks.
 */
export const useBookOpening = (reader: WithCover) => {
  const {
    activeWordIndexRef, appliedHighlightsRef, applyContentsRef, applyEndRoom, applyReaderInsets, applyReaderTypography,
    book, bookMeasureCss, bookRef, chapterPositionsRef, chapterSpineIndicesRef, chapterTurnUntilRef, clearToolbar,
    closeNoteRef, contentsRowsRef, contentWheelHandlerRef, displayModeRef, ensureScrollContainer,
    ensureSingleScrollContainer, followBookLinkRef, fontSizeRef, goToListedLineRef, holdAutoScrollRef, innerBooksRef,
    lastCfiBelowRef, lastCfiProgressRef, lastCfiRef, lastComputedProgressRef, lastHandsOnAtRef, lastProgressRef,
    layoutRef, lookingBetweenStories, markNavigating, markReadingActivity, navigatingUntilRef, notePagePlace,
    notePageShownRef, noteRef, noteRequestRef, openedAtRef, openPictureRef, pagePlaceRef, pageRelayoutsRef,
    pageSlideRef, peopleMarkedRef, persistReaderState, placeFollowsNow, progressArmedRef, queuedTurnRef,
    readerKeyHandlerRef, readerThemeRef, readerWordsRef, readingPaceScaleRef, readingPlace, reloadKey,
    removeLastReadMarker, renditionRef, revealChromeRef, scheduleReaderDotUpdate, scheduleReaderWordIndex,
    scrollAdvanceLockRef, scrollbarHoldRef, scrollbarLetGoRef, searchMarkRef, sectionPlace, sectionWeightsRef,
    selectionChangedRef, setCanSeek, setContents, setLoadError, setLoading, setNote, setPageOf, setPicture,
    setSelection, settleOnPage, setToc, showFocusToastRef, shownLineRef, spineIndexByHrefRef, storyEndBottom,
    storyEndInView, storyEndWasBelowRef, storyGapsRef, tocLabelsRef, tocPlacesRef, tocSpineStartsRef, tocWithinRef,
    typeChoiceRef, updateBookProgress, updateOutlookRef, viewerRef
  } = reader;
  const relocateHandlerRef = useRef<((location: { start?: { percentage?: number } }) => void) | null>(null);
  const lastProgressAtRef = useRef(0);

  const localPath =
    (book as { localPath?: string; local_path?: string }).localPath ??
    (book as { localPath?: string; local_path?: string }).local_path ??
    "";

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    setToc([]);
    // Closing the book (or opening another) mid-load must stop this one:
    // otherwise it kept parsing a whole book nobody was looking at.
    let cancelled = false;

    if (!localPath) {
      setLoadError("Missing book file.");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
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

        let epub: ReturnType<typeof ePub>;
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

        if (!viewerRef.current) {
          throw new Error("Reader container not ready.");
        }

        // Scrolling is one continuous book: the chapters follow each other
        // down the page, fetched as the reading nears them. It used to be a
        // chapter at a time, swapped for the next at its last line.
        const rendition = epub.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          ...(layoutRef.current === "pages" ? {} : { manager: "continuous", flow: "scrolled" })
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
            return check(...args);
          };
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

        rendition.hooks?.content?.register((contents: any) => {
          const doc = contents?.document;
          if (!doc) {
            return;
          }
          const pad = 24;
          doc.documentElement.style.setProperty("--reader-content-pad", `${pad}px`);
          doc.documentElement.style.setProperty("--reader-measure", bookMeasureCss());
          applyTypeChoice(doc.documentElement, typeChoiceRef.current);
          doc.documentElement.setAttribute("data-leaflet-layout", layoutRef.current);
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
              /* A picture that opens in the viewer (readers/pictures.ts). */
              [data-leaflet-zoom] { cursor: zoom-in; }
              ${OPENINGS_CSS}
              ${BLOCKS_CSS}
              ${PAGES_CSS}
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
          markViewable(doc);
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
        const initialSpread = "none";
        rendition.flow(initialFlow);
        const manager = rendition.manager as any;
        if (manager?.settings) {
          manager.settings.flow = initialFlow;
          manager.settings.spread = initialSpread;
        }
        if (typeof rendition.spread === "function") {
          rendition.spread(initialSpread);
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
        const applyContents = (tree: TocItem[], made: boolean) => {
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
            applyContents(keptContents.toc, true);
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

            const chapterSpineIndices = chapterSpineIndicesRef.current;
            const chapterTotal = chapterSpineIndices.length;
            const firstChapterSpine = chapterTotal > 0 ? chapterSpineIndices[0] : undefined;
            const lastChapterSpine = chapterTotal > 0 ? chapterSpineIndices[chapterTotal - 1] : undefined;

            if (chapterTotal > 0 && typeof spineIndex === "number" && typeof firstChapterSpine === "number") {
              if (spineIndex < firstChapterSpine) {
                return outside("front");
              }
            }

            let chapterIndex = href && indexMap[href] !== undefined ? indexMap[href] : undefined;
            if (chapterIndex === undefined && typeof spineIndex === "number" && chapterTotal > 0) {
              for (let i = 0; i < chapterSpineIndices.length; i += 1) {
                if (spineIndex >= chapterSpineIndices[i]) {
                  chapterIndex = i;
                } else {
                  break;
                }
              }
            }

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

            const weights = sectionWeightsRef.current;
            if (weights && typeof spineIndex === "number" && spineIndex < weights.bytes.length) {
              // The story's last line on screen: read, however short its last chapter.
              if (line && storyEndInView()) {
                return 1;
              }
              if (spineIndex < weights.lo) {
                return outside("front");
              }
              // Past the story is back matter: a footnote link into it is not
              // finishing the book, so progress stays where the reading was.
              if (spineIndex > weights.hi) {
                return outside("back");
              }
              // Between two stories of a set, looked at from elsewhere: as front and back matter are.
              if (lookingBetweenStories(spineIndex)) {
                lookingOutside = true;
                return null;
              }
              const within = sectionProgress();
              // Finished at the end of the story's last section and not
              // before (readers/progress.ts): scrolling, that was settled
              // above; with pages it is the section's last page. Until then
              // the progress stops just short, however little is left. (It
              // used to be finished from 98% of the way through that section,
              // or as soon as the weights rounded past 99%.)
              const displayed = location?.start?.displayed ?? location?.end?.displayed;
              const atEnd = !line && onLastPage(spineIndex, weights.last, Number(displayed?.page) || 0, Number(displayed?.total) || 0);
              const span = weights.prefix[weights.hi + 1] - weights.prefix[weights.lo];
              const read = weights.prefix[spineIndex] - weights.prefix[weights.lo] + within * weights.bytes[spineIndex];
              return progressToSave(read / span, atEnd, isFinished(lastProgressRef.current));
            }

            if (chapterTotal > 0 && typeof chapterIndex === "number") {
              // Past the last chapter is back matter: endnotes, acknowledgements.
              // A footnote link into it is not finishing the book, so the
              // progress stays where the reading was.
              if (typeof spineIndex === "number" && typeof lastChapterSpine === "number" && spineIndex > lastChapterSpine) {
                return outside("back");
              }
              const within = sectionProgress();
              if (chapterIndex >= chapterTotal - 1 && within >= 0.98) {
                return 1;
              }
              const progress = (chapterIndex + within) / chapterTotal;
              return progressToSave(progress, false, isFinished(lastProgressRef.current));
            }

            const cfi = location?.start?.cfi ?? location?.end?.cfi;
            const locations = bookRef.current?.locations;
            if (cfi && locations?.percentageFromCfi) {
              const percent = locations.percentageFromCfi(cfi);
              if (typeof percent === "number" && Number.isFinite(percent)) {
                return Math.min(1, Math.max(0, percent));
              }
            }

            const direct = location?.start?.percentage ?? location?.end?.percentage;
            if (typeof direct === "number" && Number.isFinite(direct)) {
              return Math.min(1, Math.max(0, direct));
            }

            // Unknown (epub.js is still indexing the book): better to save
            // nothing than a 0 that overwrites real progress.
            return null;
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
                (layoutRef.current === "pages" ? pagePlaceRef.current?.cfi : null) ?? (location?.start?.cfi as string | undefined) ?? null
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
          if (text) {
            // A note and the selection bar share a place: one at a time.
            closeNoteRef.current();
            setSelection({ cfi: cfiRange, text });
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
            let pressedAt = 0;
            doc.addEventListener(
              "pointerdown",
              (event) => {
                handsOn();
                scrollbarLetGoRef.current();
                pressedAt = Date.now();
                if (event.pointerType === "touch") {
                  revealChromeRef.current();
                }
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
                  // press is holding the page still, not asking to look.
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
              markViewable(contents.document);
            }
          });
        });

        applyReaderInsets();
        // The saved place, if it still resolves. A stale or broken position
        // used to reject here and the book never opened again.
        markNavigating(2500);
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
          // epub.js puts the saved line at the very top, under the toolbar:
          // it goes back to the reading line, as far below it as it was.
          clearToolbar(lastCfiRef.current, Math.min(lastCfiBelowRef.current, (ensureScrollContainer()?.clientHeight ?? 0) / 2));
          // With pages, a place in the middle of a paragraph opened a page early.
          if (lastCfiRef.current) {
            settleOnPage(lastCfiRef.current);
          }
        } else {
          // No local position (another device, cleared data): start at the
          // chapter the synced progress points into, rather than page one.
          const progress = typeof book.progress === "number" ? book.progress : 0;
          const chapters = chapterSpineIndicesRef.current;
          const weights = sectionWeightsRef.current;
          const midway = progress > 0.01 && progress < 0.995;
          const spineIndex =
            midway && weights
              ? spineIndexForProgress(weights, progress)
              : midway && chapters.length > 1
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
        setLoading(false);
        // Indexing the whole book (for progress in books without usable
        // chapters) waits until the first page is up, and runs when idle.
        // With section sizes known, progress needs no index at all; this is
        // for the books where they could not be read.
        const locations = epub.locations;
        if (!sectionWeightsRef.current && locations && typeof locations.generate === "function") {
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
        setLoadError(friendlyOpenError(error instanceof Error ? error.message : String(error ?? "")));
        setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
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
      if (renditionRef.current) {
        try {
          renditionRef.current.destroy();
        } catch {
          // Half built: there was nothing more of it to take down.
        }
        renditionRef.current = null;
      }
      if (bookRef.current) {
        try {
          bookRef.current.destroy();
        } catch {
          // The same.
        }
        bookRef.current = null;
      }
    };
  }, [book.id, localPath, reloadKey]);
};
