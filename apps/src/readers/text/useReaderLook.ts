import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EpubCFI } from "epubjs";
import { useAppearanceStore } from "../../store/appearanceStore";
import { ALIGN_KEY, LAYOUT_KEY, LINE_HEIGHT, MEASURE_KEY, MEASURE_PADDING, SPACING_KEY, TYPEFACE_KEY, applyTypeChoice, lineHeightPx, measureCss, readAlign, readLayout, readMeasure, readSpacing, readTypeface, type ReaderAlign, type ReaderLayout, type ReaderMeasure, type ReaderSpacing, type ReaderTypeface, type ReaderDisplayMode } from "../readerTypes";
import { getReaderFinish, getReaderFinishBackground, PAGE_TOP_PAD } from "../finish";
import type { Later, WithCover, WithPace } from "./scope";

/** Room left below the last line of the book, as a share of the window: how far up that line can be brought. */
const END_ROOM = 0.5;

/**
 * How the page looks: the size and face of the type, how long a line runs,
 * scrolling or pages, the page's colours. And putting those into the book's own
 * documents.
 */
export const useReaderLook = (reader: WithPace & Later<"setAutoScrollActive">) => {
  const { bookRef, initialPrefs, renditionRef, setReadingMode, setReloadKey, viewerRef } = reader;
  const [fontSize, setFontSize] = useState(initialPrefs?.fontSize ?? 18);
  const fontSizeRef = useRef(fontSize);

  const [displayMode, setDisplayMode] = useState<ReaderDisplayMode>(
    initialPrefs?.displayMode ?? "paper"
  );

  const readerTheme = useAppearanceStore((state) => state.theme);
  const displayModeRef = useRef<ReaderDisplayMode>(displayMode);
  const readerThemeRef = useRef(readerTheme);

  // Keep the mirrors current during render so long-lived callbacks created inside
  // the load effect (relocation handler, epub content hook) never read stale prefs.
  displayModeRef.current = displayMode;
  readerThemeRef.current = readerTheme;
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);

  // Scrolling (the default) or turning pages. A preference of this device,
  // shared by every book; changing it rebuilds the page.
  const [layout, setLayout] = useState<ReaderLayout>(readLayout);
  const layoutRef = useRef<ReaderLayout>(layout);
  layoutRef.current = layout;
  const paged = layout === "pages";
  // How long a line may run (readers/readerTypes.ts): the text in a column on
  // a wide window. A preference of this device, like the layout.
  const [measure, setMeasure] = useState<ReaderMeasure>(readMeasure);
  const measureRef = useRef<ReaderMeasure>(measure);
  measureRef.current = measure;

  const chooseMeasure = (next: ReaderMeasure) => {
    try {
      localStorage.setItem(MEASURE_KEY, next);
    } catch {
      // This session only.
    }
    setMeasure(next);
  };
  // The face, the line spacing and the alignment (readers/readerTypes.ts):
  // preferences of this device too. Read through a ref by the chapters'
  // stylesheet hook and by everything that counts in lines.
  const [typeface, setTypeface] = useState<ReaderTypeface>(readTypeface);
  const [spacing, setSpacing] = useState<ReaderSpacing>(readSpacing);
  const [align, setAlign] = useState<ReaderAlign>(readAlign);
  const typeChoiceRef = useRef({ typeface, spacing, align });
  typeChoiceRef.current = { typeface, spacing, align };
  const keepChoice = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // This session only.
    }
  };
  const chooseTypeface = (next: ReaderTypeface) => {
    keepChoice(TYPEFACE_KEY, next);
    setTypeface(next);
  };
  const chooseSpacing = (next: ReaderSpacing) => {
    keepChoice(SPACING_KEY, next);
    setSpacing(next);
  };
  const chooseAlign = (next: ReaderAlign) => {
    keepChoice(ALIGN_KEY, next);
    setAlign(next);
  };
  /** One line of the book's text, in pixels: the one place its height is worked out. */
  const linePx = () => lineHeightPx(fontSizeRef.current, typeChoiceRef.current.spacing);
  /** The column for the book's stylesheet. Pages narrow the viewer instead: their frame spans every column. */
  const bookMeasureCss = () => measureCss(layoutRef.current === "pages" ? "full" : measureRef.current);
  const chooseLayout = (next: ReaderLayout) => {
    if (next === layout) {
      return;
    }
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // This session only.
    }
    if (next === "pages") {
      // Auto-scroll, Smart Read and SpeedRead are built on scrolling.
      reader.setAutoScrollActive(false);
      setReadingMode("standard");
    }
    setLayout(next);
    setReloadKey((key) => key + 1);
  };

  const applyReaderInsets = () => {
    const rendition = renditionRef.current;
    // With pages, epub.js sizes and pads the columns itself; forcing a full
    // width here would collapse them into one long page.
    if (!rendition?.themes || layoutRef.current === "pages") {
      return;
    }
    rendition.themes.override("padding-left", MEASURE_PADDING);
    rendition.themes.override("padding-right", MEASURE_PADDING);
    rendition.themes.override("margin-left", "0px");
    rendition.themes.override("margin-right", "0px");
    rendition.themes.override("max-width", "100%");
    rendition.themes.override("width", "100%");
    rendition.themes.override("box-sizing", "border-box");
  };

  const ensureSingleScrollContainer = () => {
    if (layoutRef.current === "pages") {
      return;
    }
    const manager = renditionRef.current?.manager as any;
    const container = manager?.container as HTMLElement | undefined;
    if (container) {
      container.style.overflowY = "auto";
      container.style.overflowX = "hidden";
      container.style.height = "100%";
      container.style.width = "100%";
      container.style.position = "relative";
      // epub.js keeps the text still itself when a chapter loads in above or
      // is let go; the browser doing the same would move it twice.
      container.style.setProperty("overflow-anchor", "none");
    }
    if (viewerRef.current) {
      viewerRef.current.style.overflowY = "hidden";
      viewerRef.current.style.overflowX = "hidden";
    }
  };

  /**
   * Room below the last line of the book (scrolling). A chapter's frame ends
   * with its last line, and the next chapter's top brings it up the window;
   * the book's very last line had nothing after it, so it stopped at the
   * bottom edge of the window, under the chapter dock, and could not be
   * brought up to be read. An empty block: the words and their places are
   * untouched.
   */
  const applyEndRoom = (contents: any) => {
    const doc = contents?.document as Document | undefined;
    if (!doc?.body || layoutRef.current !== "scroll") {
      return;
    }
    const section = (bookRef.current as any)?.spine?.get?.(contents.sectionIndex);
    const existing = doc.querySelector<HTMLElement>("[data-leaflet-end]");
    if (!section || section.next?.()) {
      existing?.remove();
      return;
    }
    const room = existing ?? doc.createElement("div");
    if (!existing) {
      room.setAttribute("data-leaflet-end", "");
      room.setAttribute("aria-hidden", "true");
      doc.body.appendChild(room);
    }
    const windowHeight = ((renditionRef.current?.manager as any)?.container as HTMLElement | undefined)?.clientHeight ?? 0;
    room.style.cssText = `height: ${Math.round(windowHeight * END_ROOM)}px; margin: 0; padding: 0; border: 0; clear: both;`;
  };

  const applyReaderTypography = () => {
    const rendition = renditionRef.current;
    if (!rendition?.themes) {
      return;
    }
    rendition.themes.override("line-height", String(LINE_HEIGHT[typeChoiceRef.current.spacing]));
    rendition.themes.override("font-weight", "400");

    const contentsList = rendition.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.setProperty("--reader-font-size", `${fontSizeRef.current}px`);
      doc.documentElement.style.setProperty("--reader-measure", bookMeasureCss());
      applyTypeChoice(doc.documentElement, typeChoiceRef.current);
    });
  };

  const applyContentFlowStyles = () => {
    if (layoutRef.current === "pages") {
      return;
    }
    const rendition = renditionRef.current;
    const contentsList = rendition?.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.overflow = "visible";
      doc.body.style.overflow = "visible";
      doc.documentElement.style.overflowX = "hidden";
      doc.body.style.overflowX = "hidden";
    });
  };

  const isLight = readerTheme === "light";

  // RSVP takes its colours from the page, not the app: a true-black page gets
  // a dark stage even when the rest of Leaflet is light, and the paper finish
  // stays paper when the app is dark.
  const rsvpFinish = getReaderFinish(displayMode, readerTheme);
  const rsvpDark = rsvpFinish.themeName === "leaflet-dark";
  // The page's own colours, for everything around the book text (its gutters,
  // the scrollbar, the frame), which otherwise followed the app's theme and
  // showed as pale strips beside a dark page.
  // The paper's grain too: with lines capped, the room either side of a
  // centred page shows, and a flat frame beside grained paper read as a seam.
  const pageStyle = {
    "--reader-page-bg": rsvpFinish.background,
    "--reader-page-texture": getReaderFinishBackground(rsvpFinish),
    "--reader-page-ink": rsvpFinish.text,
    colorScheme: rsvpDark ? "dark" : "light"
  } as CSSProperties;
  const rsvpStyle = {
    "--rsvp-bg": rsvpFinish.background,
    "--rsvp-text": rsvpFinish.text,
    "--rsvp-accent": rsvpDark ? "#8cc95a" : "#0b7a45"
  } as CSSProperties;

  return {
    fontSize, setFontSize, fontSizeRef, displayMode, setDisplayMode, readerTheme, displayModeRef, readerThemeRef,
    toggleTheme, layout, layoutRef, paged, measure, chooseMeasure, typeface, spacing, align, typeChoiceRef,
    chooseTypeface, chooseSpacing, chooseAlign, linePx, bookMeasureCss, chooseLayout, applyReaderInsets,
    ensureSingleScrollContainer, applyEndRoom, applyReaderTypography, isLight, rsvpDark, pageStyle, rsvpStyle
  };
};

/** A change of the page's colours, or of the app's theme, reaches the book's documents. */
export const useThemeChange = (reader: WithCover) => {
  const {
    displayMode, displayModeRef, ensureScrollContainer, persistReaderState, readerDotEnabled, readerTheme,
    readerThemeRef, renditionRef, scheduleReaderDotUpdate
  } = reader;
  useEffect(() => {
    displayModeRef.current = displayMode;
    readerThemeRef.current = readerTheme;
    if (!renditionRef.current?.themes) {
      return;
    }
    const finish = getReaderFinish(displayMode, readerTheme);
    renditionRef.current.themes.select(finish.themeName);
    renditionRef.current.themes.override("background", finish.background);
    renditionRef.current.themes.override("color", finish.text);
    const finishBackground = getReaderFinishBackground(finish);
    const contentsList = renditionRef.current.getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc = contents?.document;
      if (!doc) {
        return;
      }
      doc.documentElement.style.backgroundColor = finish.background;
      doc.body.style.backgroundColor = finish.background;
      doc.documentElement.dataset.readerFinish = displayMode;
      doc.documentElement.dataset.readerDark = finish.themeName === "leaflet-dark" ? "1" : "0";
      doc.documentElement.style.backgroundImage = finishBackground;
      doc.body.style.backgroundImage = finishBackground;
      doc.documentElement.style.backgroundSize = "auto";
      doc.body.style.backgroundSize = "auto";
      doc.documentElement.style.color = finish.text;
      doc.body.style.color = finish.text;
    });
    if (readerDotEnabled) {
      ensureScrollContainer();
      scheduleReaderDotUpdate();
    }
    persistReaderState();
  }, [readerTheme, displayMode]);
};

/** A change of type lays the page out again round the line being read. */
export const useTypeChange = (reader: WithCover) => {
  const {
    align, applyReaderInsets, applyReaderTypography, autoScrollRunRef, clearToolbar, displayedViews, fontSize,
    fontSizeRef, layoutRef, markNavigating, measure, measurePagesAgain, pagePlaceRef, persistReaderState, readingPlace,
    readingPlaceCfi, refreshReaderDot, renditionRef, scheduleReaderWordIndex, settleOnPage, spacing, typeface
  } = reader;
  /** The line the last change of type was anchored on (scrolling), and how far below the reading line it was put. */
  const typeAnchorRef = useRef<{ cfi: string; below: number } | null>(null);
  /** That anchor, if it is still where it was put: within two pixels. Null once the reader has moved. */
  const heldTypeAnchor = (): { cfi: string; below: number } | null => {
    const held = typeAnchorRef.current;
    const container = ((renditionRef.current?.manager as any)?.container as HTMLElement | undefined) ?? null;
    if (!held || !container || layoutRef.current !== "scroll") {
      return null;
    }
    try {
      const spinePos = (new EpubCFI(held.cfi) as unknown as { spinePos?: number }).spinePos;
      const view = displayedViews().find((shown) => shown?.section?.index === spinePos);
      const element = view?.element as HTMLElement | undefined;
      const top = element ? Number(view.contents?.locationOf?.(held.cfi)?.top) : Number.NaN;
      if (!element || !Number.isFinite(top)) {
        return null;
      }
      return Math.abs(element.offsetTop + top - container.scrollTop - PAGE_TOP_PAD - held.below) <= 2 ? held : null;
    } catch {
      return null;
    }
  };
  const appliedFontSizeRef = useRef(fontSize);
  const appliedMeasureRef = useRef(measure);
  const appliedTypeRef = useRef(`${typeface}|${spacing}|${align}`);
  useEffect(() => {
    if (!renditionRef.current?.themes?.fontSize) {
      applyReaderTypography();
      return;
    }
    // Bigger or smaller text, a longer or shorter line, another face, line
    // spacing or alignment: each changes the chapter's height while the
    // scroll position stays put, so the page jumped by hundreds of pixels.
    // Note the line in view first, and return to it once the text has
    // reflowed.
    const rendition = renditionRef.current;
    const typeNow = `${typeface}|${spacing}|${align}`;
    const changed =
      appliedFontSizeRef.current !== fontSize || appliedMeasureRef.current !== measure || appliedTypeRef.current !== typeNow;
    appliedFontSizeRef.current = fontSize;
    appliedMeasureRef.current = measure;
    appliedTypeRef.current = typeNow;
    if (changed) {
      // Auto-scroll's run so far was counted in lines of the old height.
      autoScrollRunRef.current = { ms: 0, px: 0 };
    }
    // (With pages, the reader's place: see pagePlaceRef.)
    // (Scrolling, the reading line and how far below it the line started: it goes back exactly there.)
    // The anchor of the change before this one is used again while it is
    // still where it was put (the reader has not scrolled since). After a
    // change the anchored word is in the middle of its line, and a fresh
    // anchor is the first word of that line, a few words earlier: every
    // change stepped the text a line down (Mistborn, word by word: 80, 116,
    // 145, 152, 177px over six changes of size).
    const lineBefore = changed && layoutRef.current === "scroll" ? (heldTypeAnchor() ?? readingPlace()) : null;
    const anchor: string | undefined = changed
      ? ((layoutRef.current === "pages" ? pagePlaceRef.current?.cfi : null) ?? lineBefore?.cfi ?? readingPlaceCfi() ?? undefined)
      : undefined;
    fontSizeRef.current = fontSize;
    applyReaderTypography();
    applyReaderInsets();
    let resettle: number | null = null;
    if (anchor) {
      // The line that was under the toolbar goes back there.
      const restore = () => {
        if (renditionRef.current !== rendition) {
          return;
        }
        markNavigating();
        // Scrolling: the chapters take their new heights now, not a frame
        // later. Going to a line beyond a chapter's old end made epub.js take
        // the chapter for one scrolled out of reach and let go of it, leaving
        // a blank where the text had been.
        if (layoutRef.current === "scroll") {
          try {
            (rendition.manager as any)?.views?.forEach?.((view: any) => {
              if (view?.displayed) {
                view.expand?.();
              }
            });
          } catch {
            // The line is found again below either way.
          }
        } else {
          measurePagesAgain();
        }
        void rendition.display(anchor).then(
          () => {
            if (renditionRef.current === rendition) {
              clearToolbar(anchor, lineBefore?.below ?? 0);
              settleOnPage(anchor);
              typeAnchorRef.current = layoutRef.current === "scroll" ? { cfi: anchor, below: lineBefore?.below ?? 0 } : null;
            }
          },
          () => undefined
        );
      };
      requestAnimationFrame(restore);
      // And once more when the column's padding has eased into place, which
      // moves the line again.
      resettle = window.setTimeout(restore, 330);
    }
    scheduleReaderWordIndex(true);
    persistReaderState();
    // The column's padding eases over a quarter of a second (see the book's
    // stylesheet), and Dotty was placed against where it started: place it
    // again once the text has settled.
    const settle = window.setTimeout(() => refreshReaderDot(true), 400);
    return () => {
      window.clearTimeout(settle);
      if (resettle !== null) {
        window.clearTimeout(resettle);
      }
    };
  }, [fontSize, measure, typeface, spacing, align]);
};
