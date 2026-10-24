import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { PdfExtras } from "../pageSources";
import type { MeasureText, PageRect } from "../pdfText";
import { lineKey } from "../pageScroll";
import type { Sentence } from "./chapterText";
import { sentenceId, type SpokenWord } from "./player";
import { movedByReader, OWN_MOVE_MS, scrollTarget } from "./follow";
import { createPdfSentenceSource, partRects, type PdfTextPage } from "./pdfSource";
import { useReadAloudCore, type ReadAloudControls, type ReadAloudNotice, type ReadAloudPlace } from "./useReadAloudCore";

/** The marks' layer, laid in each page's box beside the search's marks (`readAloud.css`). */
const LAYER = "pdf-read-aloud";
/** How long after the page scrolls its marks are looked at again (a page that has just come near is given them). */
const REDRAW_MS = 80;
/** Pages looked at for words before reading starts on a page with none. */
const LOOK_AHEAD = 5;

export type PdfReadAloudOptions = {
  bookId: string;
  title: string;
  author: string | null;
  pdf: PdfExtras | null;
  pageCount: number;
  /** The reader's stage: the scroller its pages are in. */
  stageRef: RefObject<HTMLDivElement>;
  /** All the pages in one scroll (else a page at a time). */
  scrolling: boolean;
  /** The page the reader is on, and (a page at a time) the one drawn. */
  pageNumber: number;
  drawnPage: number;
  /** Puts a line of a page (readers/pageScroll.ts `lineKey`) a third of the way down the window. */
  goToLine: (key: string) => void;
  chapterOf: (page: number) => string | null;
  toast: (message: string) => void;
  /** The PDF is known to be pictures of pages (its chapters could not be looked for). */
  scanned: boolean;
  /** Menus and sheets close as the reading starts. */
  closeMenus: () => void;
};

/** What is lit: the sentence's rectangles on each page it is on, and the word's. */
type Lit = { sentence: Sentence; key: string; rects: Map<number, PageRect[]>; word: Map<number, PageRect[]> | null; wordKey: string };

const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

const fillMarks = (into: Element, rects: readonly PageRect[] | undefined, className: string) => {
  const doc = into.ownerDocument;
  into.replaceChildren(
    ...(rects ?? []).map((rect) => {
      const mark = doc.createElement("span");
      mark.className = className;
      mark.style.left = `${rect.left * 100}%`;
      mark.style.top = `${rect.top * 100}%`;
      mark.style.width = `${rect.width * 100}%`;
      mark.style.height = `${rect.height * 100}%`;
      return mark;
    })
  );
};

/**
 * Read aloud in the page reader (a PDF; a comic has no words): from the
 * first sentence on screen, a page at a time (`pdfSource.ts`), the sentence
 * being read lit on its page with the rectangles the search marks with, and
 * kept on screen in either layout until the reader moves the page
 * themselves. The voice, the speed and the controls are the text reader's
 * (`useReadAloudCore.ts`).
 *
 * The marks are laid into the pages' boxes by hand, not drawn by React: a
 * word several times a second must not draw the column of pages again.
 */
export const usePdfReadAloud = (options: PdfReadAloudOptions) => {
  const latest = useRef(options);
  latest.current = options;
  const { bookId } = options;
  const litRef = useRef<Lit | null>(null);
  const wordRef = useRef<SpokenWord | null>(null);
  const languageRef = useRef<string | null>(null);
  /** Page texts fetched for lighting, when the source has let them go. */
  const textsRef = useRef(new Map<number, PdfTextPage>());
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const ownMoveUntilRef = useRef(0);
  const handsOnAtRef = useRef(0);
  const redrawRef = useRef<number | null>(null);

  const source = useMemo(
    () =>
      createPdfSentenceSource({
        pageCount: () => latest.current.pageCount,
        readPage: (page) => latest.current.pdf?.pageText(page) ?? Promise.resolve(null)
      }),
    // A new book, a new source; the document is read through `latest` when asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId]
  );

  // The language the PDF says it is in, for the voice; else the reader's own (most PDFs say nothing).
  useEffect(() => {
    languageRef.current = null;
    const pdf = options.pdf;
    if (!pdf?.language) return undefined;
    let wanted = true;
    void pdf
      .language()
      .then((found) => {
        if (wanted) languageRef.current = found;
      })
      .catch(() => undefined);
    return () => {
      wanted = false;
    };
  }, [options.pdf]);

  const language = () =>
    languageRef.current ?? (typeof navigator === "undefined" ? null : (navigator.languages?.[0] ?? navigator.language ?? null));

  // ---- where a sentence is ---------------------------------------------------

  /** Letters measured in the run's own kind of face, as the search's marks are (PageReaderView). */
  const measureFor = (text: PdfTextPage): MeasureText | undefined => {
    if (!contextRef.current) {
      contextRef.current = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    }
    const context = contextRef.current;
    if (!context) return undefined;
    let face = "";
    return (piece, item) => {
      const family = text.fontFamilies?.[item.fontName ?? ""] ?? "sans-serif";
      if (family !== face) {
        context.font = `16px ${family}`;
        face = family;
      }
      return context.measureText(piece).width;
    };
  };

  const textOf = (page: number) => source.textNow(page) ?? textsRef.current.get(page) ?? null;

  /** A stretch of a section's text as rectangles on each page it is on; null while its page or text is not at hand. */
  const rectsFor = (section: number, start: number, end: number): Map<number, PageRect[]> | null => {
    if (!source.sectionNow(section)) return null;
    const out = new Map<number, PageRect[]>();
    for (const part of source.partsOf(section, start, end)) {
      const text = textOf(part.page);
      if (!text) return null;
      out.set(part.page, partRects(text, part, measureFor(text)));
    }
    return out;
  };

  /** What lighting a sentence needs, fetched: its section, and the text of the pages it is on. */
  const fetchFor = async (sentence: Sentence) => {
    await source.section(sentence.section);
    const pages = new Set(source.partsOf(sentence.section, sentence.start, sentence.end).map((part) => part.page));
    await Promise.all(
      [...pages].map(async (page) => {
        if (textOf(page)) return;
        const text = await latest.current.pdf?.pageText(page).catch(() => null);
        if (!text) return;
        textsRef.current.set(page, text);
        while (textsRef.current.size > 6) textsRef.current.delete(textsRef.current.keys().next().value as number);
      })
    );
  };

  // ---- lighting it -----------------------------------------------------------

  /** Lays what is lit into the boxes of the pages it is on, and takes it out of any other. */
  const draw = () => {
    const stage = latest.current.stageRef.current;
    if (!stage) return;
    const lit = litRef.current;
    stage.querySelectorAll<HTMLElement>(`.${LAYER}`).forEach((layer) => {
      const page = Number(layer.parentElement?.dataset.page);
      if (!lit || !lit.rects.has(page) || layer.dataset.page !== String(page)) layer.remove();
    });
    if (!lit) return;
    lit.rects.forEach((rects, page) => {
      const box = stage.querySelector<HTMLElement>(`.pdf-reader-page[data-page="${page}"]`);
      if (!box) return;
      let layer = box.querySelector<HTMLElement>(`:scope > .${LAYER}`);
      if (!layer) {
        layer = box.ownerDocument.createElement("div");
        layer.className = LAYER;
        layer.setAttribute("aria-hidden", "true");
        layer.append(box.ownerDocument.createElement("div"), box.ownerDocument.createElement("div"));
        box.append(layer);
      }
      const [sentenceMarks, wordMarks] = Array.from(layer.children);
      if (layer.dataset.key !== lit.key || layer.dataset.page !== String(page)) {
        fillMarks(sentenceMarks, rects, "pdf-read-aloud-mark");
        layer.dataset.key = lit.key;
        layer.dataset.page = String(page);
        layer.dataset.word = "";
        wordMarks.replaceChildren();
      }
      if (layer.dataset.word !== lit.wordKey) {
        fillMarks(wordMarks, lit.word?.get(page), "pdf-read-aloud-word");
        layer.dataset.word = lit.wordKey;
      }
    });
  };

  const drawSoon = () => {
    if (redrawRef.current !== null || hidden()) return;
    redrawRef.current = window.setTimeout(() => {
      redrawRef.current = null;
      draw();
    }, REDRAW_MS);
  };

  const unpaint = () => {
    litRef.current = null;
    wordRef.current = null;
    draw();
  };

  const paint = (sentence: Sentence | null, again = true) => {
    if (!sentence) {
      unpaint();
      return;
    }
    const rects = rectsFor(sentence.section, sentence.start, sentence.end);
    if (!rects) {
      litRef.current = null;
      draw();
      // Not at hand (let go while the voice read ahead): fetched, then lit and followed.
      if (again) {
        void fetchFor(sentence).then(() => {
          if (core.currentRef.current !== sentence) return;
          paint(sentence, false);
          if (core.followingRef.current) bringIntoView(sentence);
        });
      }
      return;
    }
    litRef.current = { sentence, key: sentenceId(sentence), rects, word: null, wordKey: "" };
    draw();
    if (wordRef.current?.sentence === sentence) paintWord(wordRef.current);
  };

  const paintWord = (word: SpokenWord | null) => {
    wordRef.current = word;
    const lit = litRef.current;
    if (!lit) return;
    if (!word || word.sentence !== lit.sentence || word.end <= word.start) {
      if (lit.word) {
        lit.word = null;
        lit.wordKey = "";
        draw();
      }
      return;
    }
    // (Out of sight, nothing is drawn: the sentence is lit afresh on the way back.)
    if (hidden()) return;
    const rects = rectsFor(word.sentence.section, word.start, word.end);
    if (!rects) return;
    lit.word = rects;
    lit.wordKey = `${word.start}:${word.end}`;
    draw();
  };

  // ---- keeping it on screen --------------------------------------------------

  const ownMove = (ms = OWN_MOVE_MS) => {
    ownMoveUntilRef.current = Date.now() + ms;
  };

  /** Where the sentence starts: its first page, and how far down it its first line is and its lines there end. */
  const firstPlace = (sentence: Sentence) => {
    const lit = litRef.current;
    if (!lit || lit.sentence !== sentence) return null;
    const first = lit.rects.entries().next().value as [number, PageRect[]] | undefined;
    if (!first || first[1].length === 0) return null;
    const [page, rects] = first;
    const last = rects[rects.length - 1];
    return { page, top: rects[0].top, bottom: last.top + last.height };
  };

  const bringIntoView = (sentence: Sentence) => {
    const scope = latest.current;
    const stage = scope.stageRef.current;
    const place = firstPlace(sentence);
    if (!stage || !place) return;
    if (hidden()) {
      // Nothing is drawn: only the page is kept up with, so the place the book reopens at is the voice's.
      if (place.page !== scope.pageNumber) {
        ownMove(2500);
        scope.goToLine(lineKey(place.page, place.top));
      }
      return;
    }
    const box = stage.querySelector<HTMLElement>(`.pdf-reader-page[data-page="${place.page}"]`);
    if (box) {
      const frame = box.getBoundingClientRect();
      const view = stage.getBoundingClientRect();
      const target = scrollTarget({
        top: frame.top - view.top + place.top * frame.height,
        bottom: frame.top - view.top + place.bottom * frame.height,
        viewHeight: stage.clientHeight,
        scrollTop: stage.scrollTop
      });
      if (target !== null) {
        ownMove();
        stage.scrollTo({ top: target, behavior: reducedMotion() ? "auto" : "smooth" });
      }
      return;
    }
    // A page at a time, the voice's page being drawn: it is followed once it is up.
    if (!scope.scrolling && scope.pageNumber === place.page) return;
    ownMove(2500);
    scope.goToLine(lineKey(place.page, place.top));
  };

  // ---- where reading starts --------------------------------------------------

  /** The page across the top of the window (below the toolbar) and how far down it that is. */
  const pageOnScreen = () => {
    const scope = latest.current;
    const stage = scope.stageRef.current;
    if (!stage) return null;
    const view = stage.getBoundingClientRect();
    const line = view.top + Math.min(64, stage.clientHeight * 0.08);
    const boxes = Array.from(stage.querySelectorAll<HTMLElement>(".pdf-reader-page[data-page]"))
      .map((box) => ({ page: Number(box.dataset.page), frame: box.getBoundingClientRect() }))
      .filter((entry) => entry.page >= 1 && entry.frame.height > 0)
      .sort((a, b) => a.page - b.page);
    const across = boxes.find((entry) => entry.frame.bottom > line + 4);
    if (!across) return { page: Math.max(1, scope.pageNumber), fraction: 0 };
    return { page: across.page, fraction: Math.min(1, Math.max(0, (line - across.frame.top) / across.frame.height)) };
  };

  /** The first sentence whose first line is on screen; the next page's first when none is left on this one. */
  const placeOnScreen = async (): Promise<ReadAloudPlace | null> => {
    const shown = pageOnScreen();
    if (!shown) return null;
    const made = await source.section(shown.page);
    if (!made || made.sentences.length === 0 || shown.fraction <= 0) return { section: shown.page, offset: 0 };
    const text = textOf(shown.page);
    for (const sentence of made.sentences) {
      const part = source.partsOf(shown.page, sentence.start, sentence.end).find((entry) => entry.page === shown.page);
      const rect = part && text ? partRects(text, part, measureFor(text))[0] : undefined;
      if (!rect || rect.top + rect.height / 2 >= shown.fraction) return { section: shown.page, offset: sentence.start };
    }
    return shown.page < latest.current.pageCount ? { section: shown.page + 1, offset: 0 } : { section: shown.page, offset: made.sentences[made.sentences.length - 1].start };
  };

  /** A page with no words (a scanned PDF): a notice, not a voice reading through pages of pictures. */
  const check = async (place: ReadAloudPlace): Promise<ReadAloudNotice> => {
    const scope = latest.current;
    if (scope.scanned) return "noTextBook";
    const last = Math.min(scope.pageCount, place.section + LOOK_AHEAD - 1);
    for (let page = place.section; page <= last; page += 1) {
      if (await source.hasText(page)) return null;
    }
    return scope.pageCount <= LOOK_AHEAD ? "noTextBook" : "noText";
  };

  const core = useReadAloudCore({
    bookKey: bookId,
    source,
    view: {
      language,
      paint: (sentence) => paint(sentence),
      paintWord,
      unpaint,
      bringIntoView,
      placeOnScreen,
      check,
      info: (page) => {
        const scope = latest.current;
        return { title: scope.title ?? "", author: scope.author ?? "", chapter: scope.chapterOf(page) ?? `Page ${page}`, bookId: scope.bookId };
      },
      toast: (message) => latest.current.toast(message),
      beforeStart: () => latest.current.closeMenus(),
      onEnd: () => latest.current.toast(source.stoppedAtGap ? "No more text to read" : "The end of the book")
    }
  });
  const { active, currentRef, followingRef, setFollowing } = core;

  /** The reader moved the page themselves: the reading goes on, the page stops following. */
  const noteMove = () => {
    if (followingRef.current && movedByReader({ now: Date.now(), ownMoveUntil: ownMoveUntilRef.current, handsOnAt: handsOnAtRef.current })) {
      followingRef.current = false;
      setFollowing(false);
    }
  };

  // The reader's hands on the page (a wheel, a finger, a key; not the read-aloud controls), and the page moving.
  useEffect(() => {
    const stage = options.stageRef.current;
    if (!active || !stage) return undefined;
    const handsOn = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".read-aloud-dock")) return;
      handsOnAtRef.current = Date.now();
    };
    const onScroll = () => {
      noteMove();
      drawSoon();
    };
    stage.addEventListener("wheel", handsOn, { passive: true });
    stage.addEventListener("touchstart", handsOn, { passive: true });
    window.addEventListener("pointerdown", handsOn, true);
    window.addEventListener("keydown", handsOn, true);
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stage.removeEventListener("wheel", handsOn);
      stage.removeEventListener("touchstart", handsOn);
      window.removeEventListener("pointerdown", handsOn, true);
      window.removeEventListener("keydown", handsOn, true);
      stage.removeEventListener("scroll", onScroll);
      if (redrawRef.current !== null) {
        window.clearTimeout(redrawRef.current);
        redrawRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, options.scrolling]);

  // A page turned or drawn, or the layout changed: lit there; the voice's page, once up, followed.
  const pageRef = useRef(options.pageNumber);
  useEffect(() => {
    if (!active) return;
    if (pageRef.current !== options.pageNumber) {
      pageRef.current = options.pageNumber;
      noteMove();
    }
    draw();
    const sentence = currentRef.current;
    if (sentence && followingRef.current && !hidden()) bringIntoView(sentence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, options.pageNumber, options.drawnPage, options.scrolling]);

  // Another book: what was kept of this one's text goes.
  useEffect(
    () => () => {
      source.forget();
      textsRef.current.clear();
    },
    [source]
  );

  return { readAloud: core.controls as ReadAloudControls };
};
