import { useEffect, useMemo, useRef } from "react";
import { offsetOf, rangeOf, sectionOfCfi, type TextIndex } from "../people/bookText";
import { onAndroid } from "../../platform/android";
import { chapterSentences, sentenceAt, spokenText, type Sentence, type SpokenText } from "./chapterText";
import type { SentenceSource, SpokenWord } from "./player";
import { movedByReader, OWN_MOVE_MS, pageMove, scrollTarget } from "./follow";
import { useReadAloudCore, type ReadAloudControls } from "./useReadAloudCore";
import type { WithPhoneReading } from "../text/scope";

export type { ReadAloudControls, ReadAloudNotice } from "./useReadAloudCore";

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The name the sentence being read is lit under (the CSS Custom Highlight API), in each chapter's frame. */
export const READ_ALOUD_HIGHLIGHT = "leaflet-read-aloud";
/** And the word being said, a little more, where the voice says which it is. */
export const READ_ALOUD_WORD = "leaflet-read-aloud-word";
const STYLE_ID = "leaflet-read-aloud-style";

/** A colour from the reader's accent, soft enough to read through. */
const litColour = (scope: Element | null, alpha = 0.24) => {
  const accent = scope ? getComputedStyle(scope).getPropertyValue("--reader-accent").trim() : "";
  const hex = /^#([0-9a-f]{6})$/i.exec(accent);
  if (hex) {
    const value = parseInt(hex[1], 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }
  return `rgba(214, 160, 40, ${alpha + 0.02})`;
};

/**
 * Read aloud in the text reader: from the first sentence on screen, on
 * through the book, with the sentence being read lit and kept on screen.
 * The player (`player.ts`) reads the chapters from the file; this lights and
 * follows what it reads on the page that is drawn. The voice, the player and
 * the controls are shared with the page reader (`useReadAloudCore.ts`).
 */
export const useReadAloud = (reader: WithPhoneReading) => {
  const { book, bookRef, renditionRef } = reader;
  const ownMoveUntilRef = useRef(0);
  /** The hands-on time the voice's own page turn left behind, which is not the reader's. */
  const ownHandsOnRef = useRef(0);
  /** Each chapter's text as read from the file, for a place to go to (its CFI). */
  const filesRef = useRef(new Map<number, { spoken: SpokenText<Node>; item: any }>());
  /** The same for the chapters on the page, by their document. */
  const drawnRef = useRef(new WeakMap<Document, SpokenText<Node>>());
  const paintedRef = useRef(new Set<Document>());
  const fallbackMarkRef = useRef<string | null>(null);
  /** The word being said, where the voice says. */
  const wordRef = useRef<SpokenWord | null>(null);
  const latest = useRef(reader);
  latest.current = reader;

  const language = (): string | null => (bookRef.current as any)?.packaging?.metadata?.language ?? null;

  // ---- the text --------------------------------------------------------------

  const spine = (): any[] => (bookRef.current as any)?.spine?.spineItems ?? [];

  const loadFile = async (section: number) => {
    const kept = filesRef.current.get(section);
    if (kept) return kept;
    const item = spine()[section];
    if (!item) return null;
    // Read from the file, not through the section: the page on screen is made from the section's own copy.
    const doc: Document = await (bookRef.current as any).load(item.url);
    const root = doc?.body ?? doc?.querySelector?.("body") ?? doc?.documentElement;
    if (!root) return null;
    const entry = { spoken: spokenText<Node>(root as unknown as Node & { childNodes: any }), item };
    filesRef.current.set(section, entry);
    while (filesRef.current.size > 5) {
      filesRef.current.delete(filesRef.current.keys().next().value as number);
    }
    return entry;
  };

  const source: SentenceSource = useMemo(
    () => ({
      async load(section) {
        try {
          const entry = await loadFile(section);
          return entry ? chapterSentences(entry.spoken, section) : null;
        } catch (error) {
          console.warn("read aloud: chapter", section, error);
          return [];
        }
      },
      after(section) {
        const items = spine();
        for (let at = section + 1; at < items.length; at += 1) {
          if (items[at] && items[at].linear !== "no") return at;
        }
        return null;
      },
      before(section) {
        const items = spine();
        for (let at = Math.min(section, items.length) - 1; at >= 0; at -= 1) {
          if (items[at] && items[at].linear !== "no") return at;
        }
        return null;
      }
    }),
    // The book's own functions, read when called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.id]
  );

  /** Where a sentence is, as a CFI the reader can go to. */
  const cfiOf = async (sentence: Sentence): Promise<string | null> => {
    try {
      const entry = await loadFile(sentence.section);
      const range = entry ? rangeOf(entry.spoken as unknown as TextIndex, sentence.start, sentence.end) : null;
      return range ? (entry!.item.cfiFromRange(range) as string) : null;
    } catch {
      return null;
    }
  };

  const drawnContents = (section: number): any | null =>
    (renditionRef.current?.getContents?.() ?? []).find((contents: any) => contents?.sectionIndex === section && contents?.document?.body) ?? null;

  const drawnText = (doc: Document) => {
    let spoken = drawnRef.current.get(doc);
    if (!spoken) {
      spoken = spokenText<Node>(doc.body as unknown as Node & { childNodes: any });
      drawnRef.current.set(doc, spoken);
    }
    return spoken;
  };

  /** The sentence on the page, when its chapter is drawn. */
  const drawnRange = (sentence: Sentence): Range | null => {
    const contents = drawnContents(sentence.section);
    const doc: Document | undefined = contents?.document;
    if (!doc) return null;
    const spoken = drawnText(doc);
    const range = rangeOf(spoken as unknown as TextIndex, sentence.start, sentence.end);
    const same = (text: string) => text.replace(/­/g, "").replace(/\s+/g, " ").trim();
    if (range && same(range.toString()) === same(sentence.text)) {
      return range;
    }
    // The page's text is not the file's (it was changed as it was drawn): drawn afresh next time.
    drawnRef.current.delete(doc);
    return null;
  };

  // ---- lighting the sentence ---------------------------------------------------

  const unpaint = () => {
    paintedRef.current.forEach((doc) => {
      try {
        (doc.defaultView as any)?.CSS?.highlights?.delete(READ_ALOUD_HIGHLIGHT);
        (doc.defaultView as any)?.CSS?.highlights?.delete(READ_ALOUD_WORD);
      } catch {
        // A chapter since let go.
      }
    });
    paintedRef.current.clear();
    if (fallbackMarkRef.current) {
      try {
        renditionRef.current?.annotations?.remove(fallbackMarkRef.current, "highlight");
      } catch {
        // Not there any more.
      }
      fallbackMarkRef.current = null;
    }
  };

  const paint = (sentence: Sentence | null) => {
    unpaint();
    if (!sentence) return;
    const range = drawnRange(sentence);
    if (!range) return;
    const doc = range.startContainer.ownerDocument;
    const win = doc?.defaultView as any;
    const colour = litColour(document.querySelector(".reader-scope"));
    if (doc && win?.CSS?.highlights && typeof win.Highlight === "function") {
      let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement("style");
        style.id = STYLE_ID;
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      const word = litColour(document.querySelector(".reader-scope"), 0.2);
      const rule = `::highlight(${READ_ALOUD_HIGHLIGHT}) { background-color: ${colour}; } ::highlight(${READ_ALOUD_WORD}) { background-color: ${word}; }`;
      if (style.textContent !== rule) style.textContent = rule;
      win.CSS.highlights.set(READ_ALOUD_HIGHLIGHT, new win.Highlight(range));
      paintedRef.current.add(doc);
      // (The voice may already be a word in.)
      if (wordRef.current?.sentence === sentence) paintWord(wordRef.current);
      return;
    }
    // No highlight API: epub.js's own mark, over the words.
    void cfiOf(sentence).then((cfi) => {
      if (!cfi || currentRef.current !== sentence) return;
      try {
        renditionRef.current?.annotations?.add("highlight", cfi, {}, undefined, "leaflet-read-aloud-mark", { fill: colour, "fill-opacity": "1" });
        fallbackMarkRef.current = cfi;
      } catch {
        // Not drawn: the voice reads on regardless.
      }
    });
  };

  /** The word being said, over the sentence's light (only where the highlight API is, and while Leaflet is in sight). */
  const paintWord = (word: SpokenWord | null) => {
    wordRef.current = word;
    if (!word) {
      paintedRef.current.forEach((doc) => {
        try {
          (doc.defaultView as any)?.CSS?.highlights?.delete(READ_ALOUD_WORD);
        } catch {
          // A chapter since let go.
        }
      });
      return;
    }
    if (document.visibilityState === "hidden" || word.sentence !== currentRef.current || word.end <= word.start) return;
    const contents = drawnContents(word.sentence.section);
    const doc: Document | undefined = contents?.document;
    const win = doc?.defaultView as any;
    if (!doc || !paintedRef.current.has(doc) || !win?.CSS?.highlights || typeof win.Highlight !== "function") return;
    const range = rangeOf(drawnText(doc) as unknown as TextIndex, word.start, word.end);
    if (!range) return;
    try {
      win.CSS.highlights.set(READ_ALOUD_WORD, new win.Highlight(range));
    } catch {
      // Not drawn: the sentence stays lit.
    }
  };

  // ---- keeping it on screen --------------------------------------------------

  const ownMove = (ms = OWN_MOVE_MS) => {
    ownMoveUntilRef.current = Date.now() + ms;
  };

  const goTo = async (sentence: Sentence) => {
    const cfi = await cfiOf(sentence);
    if (!cfi || currentRef.current !== sentence || !followingRef.current) return;
    ownMove(2500);
    latest.current.goToPlace(cfi);
  };

  const bringIntoView = (sentence: Sentence) => {
    if (!followingRef.current) return;
    const scope = latest.current;
    const range = drawnRange(sentence);
    if (!range) {
      void goTo(sentence);
      return;
    }
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
    const first = rects[0] ?? range.getBoundingClientRect();
    const last = rects[rects.length - 1] ?? first;
    const frame = (range.startContainer.ownerDocument?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
    if (!frame) return;
    if (scope.layoutRef.current === "scroll") {
      const container = scope.getScrollContainer();
      if (!container) return;
      const box = container.getBoundingClientRect();
      const target = scrollTarget({
        top: frame.top + first.top - box.top,
        bottom: frame.top + last.bottom - box.top,
        viewHeight: container.clientHeight,
        scrollTop: container.scrollTop
      });
      if (target !== null) {
        ownMove();
        if (document.visibilityState === "hidden") {
          // (Nothing is drawn: no glide, which would wait for frames that never come.)
          container.scrollTop = target;
        } else {
          // The reader's own glide, which keeps its footing when a chapter above is let go meanwhile.
          scope.smoothScrollBy(container, target - container.scrollTop);
        }
      }
      return;
    }
    const container = (renditionRef.current?.manager as any)?.container as HTMLElement | undefined;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const move = pageMove({ left: frame.left + first.left - box.left, width: box.width, rtl: Boolean(scope.pagesRtl) });
    if (move === "next") {
      ownMove();
      scope.turnPage(1);
      // (Turning the page counts as hands on it: this one was not the reader's.)
      ownHandsOnRef.current = scope.lastHandsOnAtRef.current;
    } else if (move === "jump") {
      void goTo(sentence);
    }
  };


  /**
   * Scrolling: the reading line sits a little below the top of the window
   * (clear of the toolbar), so a sentence or two above it may still be in
   * full view. The first of those is where reading starts.
   */
  const firstShown = (spoken: SpokenText<Node>, section: number, offset: number) => {
    const container = latest.current.getScrollContainer();
    const sentences = chapterSentences(spoken, section);
    let at = sentenceAt(sentences, offset);
    if (!container || at <= 0) return offset;
    const top = container.getBoundingClientRect().top;
    for (let step = 0; step < 3 && at > 0; step += 1) {
      const range = rangeOf(spoken as unknown as TextIndex, sentences[at - 1].start, sentences[at - 1].end);
      const frame = (range?.startContainer.ownerDocument?.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
      const first = range?.getClientRects()[0];
      if (!frame || !first || frame.top + first.top < top) break;
      at -= 1;
    }
    return sentences[at].start;
  };

  /** The place to start from: the first sentence on screen, as a chapter and an offset in its text. */
  const placeOnScreen = (): { section: number; offset: number } | null => {
    const scope = latest.current;
    const cfi = scope.readingPlaceCfi();
    const section = sectionOfCfi(cfi) ?? (renditionRef.current?.location?.start?.index as number | undefined) ?? null;
    if (section === null) return null;
    const contents = drawnContents(section);
    if (!cfi || !contents?.document) return { section, offset: 0 };
    try {
      const range: Range | null = contents.range(cfi);
      if (!range) return { section, offset: 0 };
      const spoken = drawnText(contents.document);
      const offset = offsetOf(spoken as unknown as TextIndex, range.startContainer, range.startOffset) ?? 0;
      return { section, offset: scope.layoutRef.current === "scroll" ? firstShown(spoken, section, offset) : offset };
    } catch {
      return { section, offset: 0 };
    }
  };

  // ---- the player ------------------------------------------------------------

  const core = useReadAloudCore({
    bookKey: book.id,
    source,
    view: {
      language,
      paint,
      paintWord,
      unpaint,
      bringIntoView,
      placeOnScreen,
      info: (section) => {
        const scope = latest.current;
        let chapter = "";
        try {
          chapter = scope.chapterOfSection(section) ?? "";
        } catch {
          chapter = "";
        }
        return { title: scope.book.title ?? "", author: scope.book.author ?? "", chapter, bookId: String(scope.book.id ?? "") };
      },
      toast: (message) => latest.current.showFocusToastRef.current(message),
      beforeStart: () => {
        const scope = latest.current;
        // One hands-free reading at a time: Smart Read, SpeedRead and auto-scroll give way.
        if (scope.readingModeRef.current !== "standard") scope.requestReadingMode("standard");
        scope.setAutoScrollActive(false);
        scope.setMorePanelOpen(false);
      }
    }
  });
  const { active, currentRef, followingRef, setFollowing, playerRef, prepareAhead, stop } = core;

  // A chapter drawn anew (scrolled to, laid out again, a new type size): lit again.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!active || !rendition?.on) return undefined;
    const repaint = () => window.setTimeout(() => paint(currentRef.current), 0);
    rendition.on("rendered", repaint);
    return () => rendition.off?.("rendered", repaint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reader.reloadKey]);

  // The reader moving the page themselves: the reading goes on, the page stops following.
  useEffect(() => {
    if (!active) return undefined;
    const moved = () => {
      const handsOnAt = latest.current.lastHandsOnAtRef.current;
      if (followingRef.current && handsOnAt !== ownHandsOnRef.current && movedByReader({ now: Date.now(), ownMoveUntil: ownMoveUntilRef.current, handsOnAt })) {
        setFollowing(false);
      }
    };
    const rendition = renditionRef.current;
    const container = latest.current.getScrollContainer() ?? ((rendition?.manager as any)?.container as HTMLElement | undefined) ?? null;
    container?.addEventListener("scroll", moved, { passive: true });
    rendition?.on?.("relocated", moved);
    return () => {
      container?.removeEventListener("scroll", moved);
      rendition?.off?.("relocated", moved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reader.layout, reader.reloadKey]);

  // Smart Read, SpeedRead or auto-scroll started: reading aloud gives way.
  const modeRef = useRef({ mode: reader.readingMode, auto: reader.autoScrollActive });
  useEffect(() => {
    const before = modeRef.current;
    modeRef.current = { mode: reader.readingMode, auto: reader.autoScrollActive };
    const started = (reader.readingMode !== "standard" && before.mode !== reader.readingMode) || (reader.autoScrollActive && !before.auto);
    if (started && playerRef.current && playerRef.current.state.status !== "idle") {
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.readingMode, reader.autoScrollActive]);

  // A book open and the voice idle (on Android, with a studio voice that prepares first): the chapter on screen made ahead.
  useEffect(() => {
    if (active || !onAndroid()) return undefined;
    let timer: number | null = null;
    const later = (ms: number) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void prepareAhead().catch(() => undefined), ms);
    };
    later(4000);
    // Each time the reader settles on a new page.
    const rendition = renditionRef.current;
    const moved = () => later(15000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") later(4000);
    };
    rendition?.on?.("relocated", moved);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) window.clearTimeout(timer);
      rendition?.off?.("relocated", moved);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, book.id, reader.reloadKey]);

  return { readAloud: core.controls as ReadAloudControls };
};
