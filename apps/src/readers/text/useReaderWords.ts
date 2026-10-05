import { useRef, useState } from "react";
import { estimateWordDifficulty, estimateRsvpPauseMultiplier, isCommonWord } from "../../services/smartReadService";
import { type ReaderWord, type ReadingWordState } from "../readerTypes";
import { PAGE_TOP_PAD } from "../finish";
import { noveltyHolds, MAX_WORD_HOLD, READER_WORD_PATTERN, READER_BLOCK_SELECTOR, SENTENCE_END_PATTERN, isInlineJoin, getPaceScale } from "../pacing";
import { estimateTextDifficulty } from "../paceModel";
import { firstTextFrom } from "../lineAt";
import { indexOfPlace, wordPlace, type WordPlace } from "../wordPlace";
import type { Later, WithScroll } from "./scope";

/** The most words indexed at once: the chapters on screen, and a neighbour or two. */
const WORD_INDEX_LIMIT = 90000;

/** What this reaches that hooks called after it add (scope.ts). */
type WordsLater = Later<
  | "readerDotAnchorIndexRef" | "readerDotUserAnchorUntilRef" | "smartSessionRef" | "sectionWordsRef"
  | "agreeWithReader" | "positionReaderDotAtWord" | "smartPictureRef" | "placeDotAtPicture" | "readerDotEnabledRef"
  | "readerDotElementRef" | "refreshReaderDot" | "updateOutlookRef"
>;

/** The words on the page, indexed for Dotty, Smart Read and SpeedRead. */
export const useReaderWords = (reader: WithScroll & WordsLater) => {
  const {
    displayedViews, ensureScrollContainer, learnPace, readingModeRef, renditionRef, scrollContainerRef,
    sectionDifficultyRef
  } = reader;
  const wordIndexTimerRef = useRef<number | null>(null);
  const readerWordsRef = useRef<ReaderWord[]>([]);
  // Scrolling shows several chapters at once (the one being read and its
  // neighbours): the frames the words came from, and where each one's words
  // start, so "this chapter" still means something.
  const wordFramesRef = useRef<HTMLIFrameElement[]>([]);
  const wordSectionStartsRef = useRef<number[]>([]);
  // Which chapter of the book each of those is, and where in their chapters
  // the word being read and a pinned Dotty were: how they are found again
  // when the page is laid out afresh (readers/wordPlace.ts).
  const wordSectionIdsRef = useRef<number[]>([]);
  const keptWordPlaceRef = useRef<{ active: WordPlace | null; anchor: WordPlace | null } | null>(null);
  const readingPaceScaleRef = useRef({ speed: 1, smart: 1 });
  const activeWordIndexRef = useRef(0);
  const sectionWordDifficultyRef = useRef(1);
  const [readingWord, setReadingWord] = useState<ReadingWordState | null>(null);

  const getReaderWordRect = (word: ReaderWord) => {
    try {
      if (!word.iframe.isConnected) {
        return null;
      }
      const range = word.node.ownerDocument.createRange();
      range.setStart(word.node, word.start);
      range.setEnd(word.node, word.end);
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        return null;
      }
      const iframeRect = word.iframe.getBoundingClientRect();
      return {
        top: iframeRect.top + rect.top,
        left: iframeRect.left + rect.left,
        width: rect.width,
        height: rect.height
      };
    } catch {
      return null;
    }
  };

  const findNearestWordIndex = (targetRatio = 0.38) => {
    const words = readerWordsRef.current;
    const container = ensureScrollContainer();
    if (!container || words.length === 0) {
      return 0;
    }
    const containerRect = container.getBoundingClientRect();
    const targetTop = containerRect.top + containerRect.height * targetRatio;
    let nearestIndex = activeWordIndexRef.current;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let low = 0;
    let high = words.length - 1;
    while (low <= high) {
      const index = Math.floor((low + high) / 2);
      const rect = getReaderWordRect(words[index]);
      if (!rect) {
        low = index + 1;
        continue;
      }
      const distance = Math.abs(rect.top + rect.height / 2 - targetTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
      if (rect.top + rect.height / 2 < targetTop) {
        low = index + 1;
      } else {
        high = index - 1;
      }
    }
    return nearestIndex;
  };

  const buildReadingWordState = (index: number): ReadingWordState | null => {
    const words = readerWordsRef.current;
    const word = words[index];
    if (!word) return null;
    const contextStart = Math.floor(index / 42) * 42;
    const span = sectionSpan(index);
    return {
      index,
      total: words.length,
      sectionStart: span.start,
      sectionEnd: span.end,
      text: word.text,
      punctuation: word.trailing.trim(),
      contextStart,
      context: words.slice(contextStart, contextStart + 42).map((entry, offset) => ({
        text: entry.text,
        trailing: entry.trailing,
        index: contextStart + offset
      }))
    };
  };

  /** The word index stopped at its limit, and whether it starts part of the way into a chapter. */
  const wordIndexCutRef = useRef(false);
  const wordIndexWindowedRef = useRef(false);

  /**
   * Where the words must be taken from when the page holds more than the
   * limit: the text a screen above the window, or the word being read
   * hands-free when that comes first.
   */
  const wordWindowStart = (reading: ReaderWord | undefined): { iframe: HTMLIFrameElement; node: Text } | null => {
    const container = ensureScrollContainer();
    if (!container) {
      return null;
    }
    const box = container.getBoundingClientRect();
    let inView: { iframe: HTMLIFrameElement; node: Text } | null = null;
    for (const view of displayedViews()) {
      const iframe = view?.iframe as HTMLIFrameElement | undefined;
      const doc = view?.contents?.document as Document | undefined;
      if (!iframe || !doc) {
        continue;
      }
      const frame = iframe.getBoundingClientRect();
      if (frame.bottom <= box.top - container.clientHeight) {
        continue;
      }
      const node = firstTextFrom(doc, box.top - container.clientHeight - frame.top);
      if (node) {
        inView = { iframe, node };
        break;
      }
    }
    const handsFree = readingModeRef.current !== "standard" && reading?.node.isConnected && reading.iframe.isConnected;
    if (!handsFree || !reading) {
      return inView;
    }
    const read = { iframe: reading.iframe, node: reading.node };
    if (!inView) {
      return read;
    }
    const before =
      inView.iframe === read.iframe
        ? Boolean(read.node.compareDocumentPosition(inView.node) & Node.DOCUMENT_POSITION_FOLLOWING)
        : Boolean(read.iframe.compareDocumentPosition(inView.iframe) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before ? read : inView;
  };

  /** A cut index (see above) that no longer holds the text on screen: the reader went elsewhere in a very long chapter. */
  const wordIndexMissesView = () => {
    const words = readerWordsRef.current;
    const container = scrollContainerRef.current;
    if (!wordIndexCutRef.current || words.length === 0 || !container) {
      return false;
    }
    const box = container.getBoundingClientRect();
    const first = getReaderWordRect(words[0]);
    const last = getReaderWordRect(words[words.length - 1]);
    return Boolean((wordIndexWindowedRef.current && first && first.top > box.top + PAGE_TOP_PAD) || (last && last.top < box.bottom));
  };

  const prepareReaderWords = (startAtViewport = false) => {
    const rendition = renditionRef.current;
    const previousWords = readerWordsRef.current;
    const previousWordCount = previousWords.length;
    const previousAnchor = reader.readerDotAnchorIndexRef.current;
    const preserveUserAnchor =
      Date.now() < reader.readerDotUserAnchorUntilRef.current &&
      previousAnchor !== null &&
      previousWordCount > 0;
    // The words being read and pinned, to find again below: chapters come and
    // go above and below as the reader scrolls, so a word's number changes
    // while the word stays where it is.
    const previousActive = activeWordIndexRef.current;
    const previousActiveWord = Math.min(previousActive, previousWordCount - 1);
    const activeWordBefore = previousWords[previousActiveWord];
    const anchorWordBefore = previousAnchor !== null ? previousWords[previousAnchor] : undefined;
    // The same two as places in the book (readers/wordPlace.ts), for when the
    // page was laid out afresh and its words are new nodes. Kept across an
    // index taken while the page was empty, half way through the swap.
    if (previousWordCount > 0) {
      const startsBefore = wordSectionStartsRef.current;
      const idsBefore = wordSectionIdsRef.current;
      keptWordPlaceRef.current = {
        active: wordPlace(previousActiveWord, startsBefore, idsBefore),
        anchor: preserveUserAnchor && previousAnchor !== null ? wordPlace(previousAnchor, startsBefore, idsBefore) : null
      };
    }
    const keptPlace = keptWordPlaceRef.current;
    let words: ReaderWord[] = [];
    // Parallel to `words`: the block element each word sits in.
    let blocks: Array<Element | null> = [];
    let frames: HTMLIFrameElement[] = [];
    let sectionStarts: number[] = [];
    let sectionIds: number[] = [];
    const contentsList = rendition?.getContents?.() ?? [];
    // The words are taken from the top of the chapters on the page, or, when
    // there are more than can be held, from `from` on (see below).
    const collect = (from: { iframe: HTMLIFrameElement; node: Text } | null) => {
    words = [];
    blocks = [];
    frames = [];
    sectionStarts = [];
    sectionIds = [];
    let reached = from === null;
    contentsList.forEach((contents: any) => {
      const doc = contents?.document as Document | undefined;
      const iframe =
        (contents?.iframe as HTMLIFrameElement | undefined) ??
        (doc?.defaultView?.frameElement as HTMLIFrameElement | null);
      if (!doc?.body || !iframe) return;
      const startsHere = from !== null && from.iframe === iframe;
      frames.push(iframe);
      sectionStarts.push(words.length);
      // A chapter epub.js gave no number matches none (NaN is never found),
      // and nor does one whose words are counted from part of the way in.
      sectionIds.push(startsHere ? Number.NaN : Number(contents?.sectionIndex ?? Number.NaN));
      if (!reached && !startsHere) {
        return;
      }
      reached = true;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      if (startsHere && from) {
        walker.currentNode = from.node;
        node = from.node;
      } else {
        node = walker.nextNode();
      }
      while (node && words.length < WORD_INDEX_LIMIT) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        // (A footnote's marker is not a word of the text: "note" and its
        // raised "1" used to be read, and flashed in SpeedRead, as "note1".)
        const hidden =
          !parent ||
          Boolean(parent.closest("script, style, noscript, svg, [aria-hidden='true'], sup a[href], a[href] > sup, a[role='doc-noteref'], a[epub\\:type~='noteref']")) ||
          parent.hidden;
        if (!hidden && textNode.data.trim()) {
          const block = parent.closest(READER_BLOCK_SELECTOR);
          const matches = Array.from(
            textNode.data.matchAll(READER_WORD_PATTERN)
          );
          // Text before the first word here (". Then", or a node that is only
          // punctuation) belongs to the previous word when it sits in the same
          // block -- "<em>no</em>. Then" used to lose its sentence end.
          const previous = words[words.length - 1];
          const previousInBlock =
            previous && previous.iframe === iframe && blocks[blocks.length - 1] === block;
          const leadingEnd = matches[0]?.index ?? textNode.data.length;
          if (previousInBlock && leadingEnd > 0) {
            previous.trailing += textNode.data.slice(0, leadingEnd);
            previous.sentenceEnd = SENTENCE_END_PATTERN.test(`${previous.text}${previous.trailing}`);
          }
          matches.forEach((match, matchIndex) => {
            const start = match.index ?? 0;
            const text = match[0];
            const end = start + text.length;
            const nextStart = matches[matchIndex + 1]?.index ?? textNode.data.length;
            const trailing = textNode.data.slice(end, nextStart);
            // A word split across inline nodes ("<span>T</span>he", a styled
            // syllable) is one word, not two flashes.
            const last = words[words.length - 1];
            if (
              matchIndex === 0 &&
              start === 0 &&
              previousInBlock &&
              last &&
              last.trailing === "" &&
              last.end === last.node.data.length &&
              isInlineJoin(last.node, textNode)
            ) {
              last.text += text;
              last.trailing = trailing;
              last.difficulty = estimateWordDifficulty(last.text);
              last.sentenceEnd = SENTENCE_END_PATTERN.test(`${last.text}${trailing}`);
              return;
            }
            words.push({
              text,
              trailing,
              node: textNode,
              start,
              end,
              difficulty: estimateWordDifficulty(text),
              rsvpPauseMultiplier: 1,
              sentenceEnd: SENTENCE_END_PATTERN.test(`${text}${trailing}`),
              paragraphEnd: false,
              iframe
            });
            blocks.push(block);
          });
        }
        node = walker.nextNode();
      }
    });
    };
    collect(null);
    // More words than can be held (a chapter of a hundred thousand, a whole
    // novel in one file): the count stopped at the limit, and past it there
    // was nothing to read from. Smart Read started beyond it took the last
    // word held for the reader's place and scrolled the page back to it, then
    // ran on through the text by itself and announced the end of the book.
    // The words are taken from where the reading is instead.
    wordIndexCutRef.current = words.length >= WORD_INDEX_LIMIT;
    wordIndexWindowedRef.current = false;
    if (wordIndexCutRef.current) {
      const from = wordWindowStart(activeWordBefore);
      const at = from ? words.findIndex((word) => word.node === from.node) : -1;
      if (from && (at < 0 || at > WORD_INDEX_LIMIT * 0.6)) {
        collect(from);
        wordIndexWindowedRef.current = true;
      }
    }
    // A paragraph ends where the next word is in another block. Checking the
    // text node's siblings instead paused for a paragraph after every <em>.
    words.forEach((word, index) => {
      word.paragraphEnd = Boolean(blocks[index]) && blocks[index + 1] !== blocks[index];
    });
    const localFrequency = new Map<string, number>();
    words.forEach((word) => {
      const normalized = word.text.toLocaleLowerCase();
      localFrequency.set(normalized, (localFrequency.get(normalized) ?? 0) + 1);
    });
    words.forEach((word) => {
      word.rsvpPauseMultiplier = estimateRsvpPauseMultiplier(
        word.text,
        localFrequency.get(word.text.toLocaleLowerCase()) ?? 1
      );
    });
    // A name being introduced, a word new to this chapter and a figure are
    // held longer in SpeedRead, less each time they come round again.
    noveltyHolds(words, isCommonWord).forEach((hold, index) => {
      if (hold > 0) {
        words[index].rsvpPauseMultiplier = Math.min(MAX_WORD_HOLD, words[index].rsvpPauseMultiplier + hold);
      }
    });
    const indexOfWord = (word: ReaderWord | undefined) =>
      word ? words.findIndex((entry) => entry.node === word.node && entry.start >= word.start) : -1;
    const activeNow = indexOfWord(activeWordBefore);
    // The text being read is still on the page (a new type size, a
    // re-render, or a neighbouring chapter loading or leaving).
    const sameText = activeNow >= 0;
    const smartSession = readingModeRef.current === "smart" ? reader.smartSessionRef.current : null;
    if (smartSession && !sameText && smartSession.acceptedMs > 0) {
      // Smart Read went elsewhere by some other way than reading there: what
      // was read at Dotty's pace is kept (at the old text's difficulty), and
      // the pace is measured afresh below.
      learnPace(smartSession.acceptedWords, smartSession.acceptedMs, "guided");
    }
    // How hard this text reads sets its pace (easy text faster, dense text
    // slower); each word's own difficulty then spreads the time within it.
    sectionDifficultyRef.current = estimateTextDifficulty(words);
    sectionWordDifficultyRef.current =
      words.length > 0 ? words.reduce((sum, word) => sum + word.difficulty, 0) / words.length : 1;
    readingPaceScaleRef.current = {
      speed: getPaceScale(words, "speed"),
      smart: getPaceScale(words, "smart", sectionWordDifficultyRef.current)
    };
    readerWordsRef.current = words;
    wordFramesRef.current = frames;
    wordSectionStartsRef.current = sectionStarts;
    wordSectionIdsRef.current = sectionIds;
    // Each chapter's words, for the time left. An index cut short (a very
    // long page) says nothing true of its last chapter.
    if (words.length < WORD_INDEX_LIMIT) {
      sectionIds.forEach((id, at) => {
        const count = (sectionStarts[at + 1] ?? words.length) - sectionStarts[at];
        if (Number.isFinite(id) && count > 0) {
          reader.sectionWordsRef.current.set(id, count);
        }
      });
    }
    // Re-indexing the same text must not move an RSVP or Smart Read position;
    // only going elsewhere starts over.
    const keepReadingPosition = readingModeRef.current !== "standard" && sameText;
    // A resize makes epub.js render the chapters again: the word being read
    // (or pinned) is there, but as a new node, and is found by its place in
    // its chapter. Smart Read used to carry on from 38% down the window, or
    // from the first word on the page.
    const refound = sameText ? -1 : indexOfPlace(keptPlace?.active ?? null, sectionStarts, sectionIds, words.length);
    let anchorNow = preserveUserAnchor ? indexOfWord(anchorWordBefore) : -1;
    if (anchorNow < 0 && Date.now() < reader.readerDotUserAnchorUntilRef.current) {
      anchorNow = indexOfPlace(keptPlace?.anchor ?? null, sectionStarts, sectionIds, words.length);
    }
    // There was a word being read and it has left the page (its chapter was
    // let go, or the reader jumped elsewhere): reading goes on from what is
    // on screen. Its old number, kept, named some unrelated word.
    const lost = !sameText && refound < 0 && (previousWordCount > 0 || keptPlace !== null);
    const lastIndex = Math.max(0, words.length - 1);
    if (keepReadingPosition) {
      // One past the last word means "all of it is read": kept as that.
      activeWordIndexRef.current = Math.min(words.length, activeNow + (previousActive - previousActiveWord));
    } else {
      const nextIndex =
        anchorNow >= 0
          ? anchorNow
          : refound >= 0
            ? refound
            : (startAtViewport || lost) && words.length > 0
              ? findNearestWordIndex()
              : sameText
                ? activeNow
                : activeWordIndexRef.current;
      activeWordIndexRef.current = Math.min(Math.max(0, nextIndex), lastIndex);
    }
    reader.readerDotAnchorIndexRef.current = Math.min(activeWordIndexRef.current, lastIndex);
    if (smartSession) {
      if (sameText) {
        // Where the reader and Dotty last agreed moved along with the rest.
        smartSession.anchorIndex = Math.max(0, smartSession.anchorIndex + (activeNow - previousActiveWord));
      } else {
        reader.agreeWithReader(activeWordIndexRef.current);
      }
    }
    if (readingModeRef.current !== "standard" && words.length > 0) {
      setReadingWord(buildReadingWordState(Math.min(activeWordIndexRef.current, lastIndex)));
      if (readingModeRef.current === "smart") {
        reader.positionReaderDotAtWord(reader.readerDotAnchorIndexRef.current);
        // (Resting at a picture, Dotty stays beside it: the word to read
        // next is below it, or has only just arrived with its chapter.)
        if (reader.smartPictureRef.current) {
          reader.placeDotAtPicture();
        }
      }
    } else if (reader.readerDotEnabledRef.current && words.length > 0) {
      if (reader.readerDotElementRef.current) {
        // Dotty is already beside a line, and stays with it.
        reader.refreshReaderDot(true);
      } else {
        window.requestAnimationFrame(() => reader.positionReaderDotAtWord(activeWordIndexRef.current));
      }
    }
    reader.updateOutlookRef.current();
  };

  /**
   * Whether the words indexed are still the ones on the page. Scrolling loads
   * the next chapter and lets go of those left behind, and the words of a
   * chapter that has gone have no place on screen.
   */
  const readerWordsStale = () => {
    const frames = wordFramesRef.current;
    const shown = (renditionRef.current?.getContents?.() ?? []).length;
    return shown !== frames.length || frames.some((frame) => !frame.isConnected);
  };

  /** Where, in the word index, the chapter a word is in starts and ends. */
  const sectionSpan = (index: number) => {
    const starts = wordSectionStartsRef.current;
    let at = 0;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i] <= index) {
        at = i;
      }
    }
    return { start: starts[at] ?? 0, end: starts[at + 1] ?? readerWordsRef.current.length };
  };

  const scheduleReaderWordIndex = (startAtViewport = false, delay = 180) => {
    if (wordIndexTimerRef.current) {
      window.clearTimeout(wordIndexTimerRef.current);
    }
    wordIndexTimerRef.current = window.setTimeout(() => {
      wordIndexTimerRef.current = null;
      try {
        prepareReaderWords(startAtViewport);
      } catch {
        readerWordsRef.current = [];
      }
    }, delay);
  };

  return {
    wordIndexTimerRef, readerWordsRef, wordFramesRef, wordSectionIdsRef, keptWordPlaceRef, readingPaceScaleRef,
    activeWordIndexRef, sectionWordDifficultyRef, readingWord, setReadingWord, getReaderWordRect, findNearestWordIndex,
    buildReadingWordState, wordIndexMissesView, prepareReaderWords, readerWordsStale, sectionSpan,
    scheduleReaderWordIndex
  };
};
