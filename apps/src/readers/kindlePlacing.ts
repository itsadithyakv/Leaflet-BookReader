/**
 * A highlight brought from a Kindle, found in the book.
 *
 * A Kindle's clipping comes with a "location" that is no place in the book's
 * file (library/kindleClippings.ts), so it is listed and neither drawn nor
 * gone to. But it comes with its words, and the words are in the book: found
 * there, the highlight has a place like any other.
 *
 * The words are not written the same in the two. The Kindle's file has a
 * straight quote where the book has a curly one, one space where the book
 * breaks a paragraph (or none), three dots for an ellipsis, a hyphen for a
 * dash, and none of the soft hyphens a publisher leaves inside long words.
 * So nothing but the letters and digits is compared: lower case, without
 * their accents (readers/searchFold.ts), a ligature as its letters. What
 * stands between two letters decides nothing.
 *
 * A passage that is not in the book whole (a footnote's number in the middle
 * of it, a word set right between two editions) is looked for by its opening
 * and closing words, which must both be there, in order, about as far apart
 * as the passage is long.
 *
 * A wrong place is worse than none: one or two words are placed only where
 * the book says them once, as whole words. A longer passage the book says
 * more than once goes to the one nearest where its Kindle location points.
 *
 * Pure but for `placeInBook`, which is handed the book open in epub.js.
 */

import { isKindlePlace, kindleLocation } from "../library/kindleClippings";
import type { Annotation } from "../services/annotationService";
import { sectionPieces, type TextTreeNode } from "./findPlace";
import { foldText } from "./searchFold";

// ---- the letters --------------------------------------------------------------------

const LETTER = /[\p{L}\p{N}]/u;
const ACCENT = /\p{M}/u;
/** White space as the library's search counts it (readers/findPlace.ts). */
const SPACE = /[\s\u0085]/;
/** Nothing on the page: a soft hyphen, the zero-width characters, an accent written apart. They part no words. */
const UNSEEN = /[\u00ad\u200b-\u200d\u2060\ufeff\p{M}]/u;
/** Writing that puts no space between its words: a word there is not known by what stands beside it. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** What the characters met so far come to, so a book's ten thousand curly quotes are folded once. */
const folded = new Map<string, string>();

/** A character as it is compared: its letters and digits, lower case, no accents; nothing for anything else. */
const lettersOf = (char: string): string => {
  const code = char.charCodeAt(0);
  if (code < 128 && char.length === 1) {
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      return char;
    }
    return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : "";
  }
  let letters = folded.get(char);
  if (letters === undefined) {
    letters = "";
    // (A ligature, a superscript figure or a full-width letter is the letters it stands for.)
    for (const one of foldText(char.normalize("NFKD")).text) {
      if (LETTER.test(one)) {
        letters += one;
      }
    }
    if (folded.size > 4096) {
      folded.clear();
    }
    folded.set(char, letters);
  }
  return letters;
};

/** Some words as they are compared. */
const keyOf = (text: string) => {
  let key = "";
  for (const char of text) {
    key += lettersOf(char);
  }
  return key;
};

/**
 * A section's letters in reading order, from its pieces (readers/findPlace.ts:
 * sectionPieces), and where each came from: `piece[i]` and `offset[i]` are
 * the piece and the place in it of the character the letter at `i` was read
 * from. `parted[i]` says something that parts two words stands before it (a
 * space, a comma, a paragraph's end; not an `<em>` opening inside a word).
 */
export type SectionLetters = { key: string; piece: number[]; offset: number[]; parted: boolean[] };

export const sectionLetters = (pieces: readonly (string | null)[]): SectionLetters => {
  let key = "";
  const piece: number[] = [];
  const offset: number[] = [];
  const parted: boolean[] = [];
  let gap = true;
  pieces.forEach((words, at) => {
    if (words === null) {
      gap = true;
      return;
    }
    for (let index = 0; index < words.length; ) {
      const code = words.codePointAt(index) ?? 0;
      const size = code > 0xffff ? 2 : 1;
      const char = size === 1 ? words[index] : words.slice(index, index + 2);
      const letters = lettersOf(char);
      if (letters) {
        for (let more = 0; more < letters.length; more += 1) {
          piece.push(at);
          offset.push(index);
          parted.push(gap && more === 0);
        }
        key += letters;
        gap = false;
      } else if (!gap) {
        gap = code < 128 || !UNSEEN.test(char);
      }
      index += size;
    }
  });
  return { key, piece, offset, parted };
};

// ---- a passage ----------------------------------------------------------------------

/** A passage of this many words or fewer is placed only where the book has it once, as whole words. */
const SHORT_WORDS = 2;
/** And one of fewer letters than this, however many words they are in ("So it is."). */
const SHORT_LETTERS = 12;
/** How many words open and close a passage that is not found whole. */
const ANCHOR_WORDS = 8;
/** With fewer than this at each end, or fewer letters, the ends are not enough to know it by. */
const ANCHOR_FEWEST = 4;
const ANCHOR_LETTERS = 12;
/** How far from its due place the closing words may be: this share of the passage's length, and never less than this many letters. */
const ANCHOR_SHARE = 0.2;
const ANCHOR_SLACK = 24;
/** A passage the book has more often than this is placed nowhere: no Kindle location tells so many apart. */
const MOST = 24;

export type Passage = {
  /** Its letters. */
  key: string;
  /** One or two words (or very few letters): whole words, and only where the book has them once. */
  short: boolean;
  /** Its opening and closing words' letters; empty when it is too short to be known by them. */
  head: string;
  tail: string;
  /** How many marks stand before its first letter and after its last (a quotation mark, a full stop): the highlight takes them in. */
  lead: number;
  trail: number;
};

/** How many characters that are neither letters nor spaces a text opens with. */
const marksBefore = (chars: string[]) => {
  let marks = 0;
  for (const char of chars) {
    if (lettersOf(char)) {
      break;
    }
    marks += SPACE.test(char) ? 0 : 1;
  }
  return marks;
};

/** A clipping's words, made ready to look for; null when they have no letter in them. */
export const passageOf = (text: string): Passage | null => {
  const words = text.split(/[\s\u0085]+/).map(keyOf).filter(Boolean);
  const key = words.join("");
  if (!key) {
    return null;
  }
  // The two ends never meet: a passage that is its two ends was looked for whole already.
  const each = Math.min(ANCHOR_WORDS, Math.floor((words.length - 1) / 2));
  const head = each >= ANCHOR_FEWEST ? words.slice(0, each).join("") : "";
  const tail = each >= ANCHOR_FEWEST ? words.slice(-each).join("") : "";
  const anchored = head.length >= ANCHOR_LETTERS && tail.length >= ANCHOR_LETTERS;
  const chars = Array.from(text);
  return {
    key,
    short: words.length <= SHORT_WORDS || key.length < SHORT_LETTERS,
    head: anchored ? head : "",
    tail: anchored ? tail : "",
    lead: marksBefore(chars),
    trail: marksBefore(chars.reverse())
  };
};

/** A match, in a section's letters: from the first of them to after the last. */
export type Found = { from: number; to: number };

/** Whether a word starts at this letter (or the one before it ends a word). */
const wordEdge = (letters: SectionLetters, at: number) =>
  at <= 0 ||
  at >= letters.key.length ||
  letters.parted[at] ||
  UNSPACED.test(letters.key[at]) ||
  UNSPACED.test(letters.key[at - 1]);

/** Where a section has the passage whole, in order; no more than `most` of them. A short one only as whole words. */
export const wholeIn = (letters: SectionLetters, passage: Passage, most = MOST + 1): Found[] => {
  const found: Found[] = [];
  const size = passage.key.length;
  for (let at = letters.key.indexOf(passage.key); at !== -1 && found.length < most; at = letters.key.indexOf(passage.key, at + 1)) {
    if (!passage.short || (wordEdge(letters, at) && wordEdge(letters, at + size))) {
      found.push({ from: at, to: at + size });
    }
  }
  return found;
};

/**
 * Where a section has the passage's opening words with its closing words
 * after them, about as far on as the passage is long: for one that is not
 * there whole. Of several closings in reach, the one nearest its due place.
 */
export const anchoredIn = (letters: SectionLetters, passage: Passage, most = MOST + 1): Found[] => {
  const found: Found[] = [];
  if (!passage.head || !passage.tail) {
    return found;
  }
  const { key } = letters;
  const size = passage.key.length;
  const slack = Math.max(ANCHOR_SLACK, Math.ceil(size * ANCHOR_SHARE));
  for (let at = key.indexOf(passage.head); at !== -1 && found.length < most; at = key.indexOf(passage.head, at + 1)) {
    // Where the closing words would start, were nothing between the two ends different.
    const due = at + size - passage.tail.length;
    let best = -1;
    for (
      let end = key.indexOf(passage.tail, Math.max(at + passage.head.length, due - slack));
      end !== -1 && end <= due + slack;
      end = key.indexOf(passage.tail, end + 1)
    ) {
      if (best < 0 || Math.abs(end - due) < Math.abs(best - due)) {
        best = end;
      }
    }
    if (best >= 0) {
      found.push({ from: at, to: best + passage.tail.length });
    }
  }
  return found;
};

export type PiecePlace = { piece: number; offset: number };
export type PieceSpan = { start: PiecePlace; end: PiecePlace };

/** A mark the highlight may take in at its ends: not a letter, not a space, not half of a character. */
const isMark = (char: string | undefined) => {
  const code = char?.charCodeAt(0) ?? 0;
  return Boolean(char) && !(code >= 0xd800 && code <= 0xdfff) && !SPACE.test(char as string) && !lettersOf(char as string);
};

/**
 * A match as the pieces and places of its two ends: from its first letter to
 * the end of its last (accents and all), and out over as many marks as the
 * passage itself opens and closes with, where the book has them there too
 * (the quotation marks round a sentence, its full stop).
 */
export const spanOf = (pieces: readonly (string | null)[], letters: SectionLetters, passage: Passage, found: Found): PieceSpan => {
  const first = pieces[letters.piece[found.from]] ?? "";
  let start = letters.offset[found.from];
  for (let more = passage.lead; more > 0 && start > 0 && isMark(first[start - 1]); more -= 1) {
    start -= 1;
  }
  const last = pieces[letters.piece[found.to - 1]] ?? "";
  let end = letters.offset[found.to - 1];
  end += (last.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
  while (end < last.length && ACCENT.test(last[end])) {
    end += 1;
  }
  for (let more = passage.trail; more > 0 && end < last.length && isMark(last[end]); more -= 1) {
    end += 1;
  }
  return { start: { piece: letters.piece[found.from], offset: start }, end: { piece: letters.piece[found.to - 1], offset: end } };
};

/**
 * Where a clipping's words are in a section's pieces: whole, or failing that
 * by their opening and closing words. Every place the section has them, in
 * order; which of several is meant is for `placeInBook`, which sees the book.
 */
export const passageInPieces = (pieces: readonly (string | null)[], text: string): PieceSpan[] => {
  const passage = passageOf(text);
  if (!passage) {
    return [];
  }
  const letters = sectionLetters(pieces);
  const whole = wholeIn(letters, passage);
  return (whole.length > 0 ? whole : anchoredIn(letters, passage)).map((found) => spanOf(pieces, letters, passage, found));
};

// ---- which of several ---------------------------------------------------------------

/** A Kindle location whose place in the book is known: how far through the book's letters it is, 0 to 1. */
export type Bearing = { location: number; fraction: number };

/**
 * How far through the book a Kindle location is, as near as can be told.
 * Between two highlights already placed, in step with them; past the last of
 * them (or before the first), in step with that one from the book's start.
 * With none placed, against the highest location the book's clippings have,
 * which is right only when the Kindle was read to the end. Null when even
 * that is not known.
 */
export const fractionOfLocation = (location: number | null, top: number | null, known: readonly Bearing[]): number | null => {
  if (location === null || !(location > 0)) {
    return null;
  }
  let below: Bearing | null = null;
  let above: Bearing | null = null;
  for (const bearing of known) {
    if (!(bearing.location > 0)) {
      continue;
    }
    if (bearing.location <= location && (!below || bearing.location > below.location)) {
      below = bearing;
    }
    if (bearing.location >= location && (!above || bearing.location < above.location)) {
      above = bearing;
    }
  }
  if (below && above) {
    const span = above.location - below.location;
    return span > 0 ? below.fraction + ((above.fraction - below.fraction) * (location - below.location)) / span : below.fraction;
  }
  const one = below ?? above;
  if (one) {
    return Math.min(1, (one.fraction * location) / one.location);
  }
  return top !== null && top > 0 ? Math.min(1, location / top) : null;
};

// ---- the book -----------------------------------------------------------------------

/** A clipping to find: its highlight's id, its words, and its Kindle location when it has one. */
export type KindlePassage = { id: string; text: string; location: number | null };

/** Where one was found: its place, the section that is in, and how far down that section (0 to 1), for naming its chapter. */
export type KindlePlaced = { cfi: string; section: number; within: number };

type PlaceOptions = {
  signal?: AbortSignal;
  /** The highest Kindle location the book's clippings have. */
  top?: number | null;
  /** Lets the page have a turn. */
  pause?: () => Promise<void>;
  /** The longest the work goes on without one. */
  sliceMs?: number;
};

/** A place the book has a passage: how many letters into the book, and its CFI (null when it could not be written down). */
type Candidate = Omit<KindlePlaced, "cfi"> & { at: number; cfi: string | null };

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// epub.js has no types for these internals.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Finds the passages in a book open in epub.js: each highlight's id with its
 * place, for those the book has. Null when stopped before the end.
 *
 * One pass over the book, a section at a time, every passage looked for in
 * each: only at the end is it known that a passage is there once, or which of
 * its places is meant. Each section is read from the file and not through
 * epub.js's own copy, which the page being shown is made from (as
 * readers/people/bookText.ts reads them). The page has a turn after every
 * section and whenever the looking has gone on for `sliceMs`.
 */
export const placeInBook = async (
  book: any,
  wanted: readonly KindlePassage[],
  { signal, top = null, pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0)), sliceMs = 8 }: PlaceOptions = {}
): Promise<Map<string, KindlePlaced> | null> => {
  const placed = new Map<string, KindlePlaced>();
  const items: any[] = book?.spine?.spineItems ?? [];
  const seeking = wanted.flatMap((one) => {
    const passage = passageOf(one.text);
    return passage ? [{ ...one, passage, whole: [] as Candidate[], anchored: [] as Candidate[], out: false }] : [];
  });
  if (items.length === 0 || seeking.length === 0 || typeof book?.load !== "function") {
    return placed;
  }
  /** Letters in the sections gone through. */
  let before = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) {
      return null;
    }
    const item = items[index];
    let doc: Document | null = null;
    try {
      doc = await book.load(item.url);
    } catch {
      // A section that will not load is passed over; the rest are still read.
    }
    // (The file was just unpacked and parsed: the page first.)
    await pause();
    if (signal?.aborted) {
      return null;
    }
    const page = doc;
    const root = page?.documentElement;
    if (!page || !root) {
      continue;
    }
    const { pieces, nodes } = sectionPieces(root as unknown as TextTreeNode);
    const letters = sectionLetters(pieces);
    const candidate = (passage: Passage, found: Found): Candidate => {
      let cfi: string | null = null;
      try {
        const span = spanOf(pieces, letters, passage, found);
        const range = page.createRange();
        range.setStart(nodes[span.start.piece] as unknown as Node, span.start.offset);
        range.setEnd(nodes[span.end.piece] as unknown as Node, span.end.offset);
        cfi = item.cfiFromRange(range) as string;
      } catch {
        // A place that cannot be written down is counted, and not gone to.
      }
      return { at: before + found.from, cfi, section: index, within: found.from / letters.key.length };
    };
    let sliceStart = clock();
    for (const one of seeking) {
      if (one.out) {
        continue;
      }
      // A second place settles a short passage (it is placed nowhere); so does one more than can be told apart.
      const most = one.passage.short ? 2 : MOST + 1;
      const whole = wholeIn(letters, one.passage, most - one.whole.length);
      one.whole.push(...whole.map((found) => candidate(one.passage, found)));
      one.out = one.whole.length >= most;
      if (one.whole.length === 0 && one.anchored.length <= MOST) {
        one.anchored.push(...anchoredIn(letters, one.passage, MOST + 1 - one.anchored.length).map((found) => candidate(one.passage, found)));
      }
      if (clock() - sliceStart > sliceMs) {
        await pause();
        if (signal?.aborted) {
          return null;
        }
        sliceStart = clock();
      }
    }
    before += letters.key.length;
  }

  // Those the book has once first: each tells where its Kindle location is, for telling the others' places apart.
  const known: Bearing[] = [];
  const open: Array<{ one: (typeof seeking)[number]; found: Candidate[] }> = [];
  const settle = (id: string, { cfi, section, within }: Candidate) => {
    if (cfi) {
      placed.set(id, { cfi, section, within });
    }
  };
  for (const one of seeking) {
    const found = one.whole.length > 0 ? one.whole : one.anchored;
    if (one.out || found.length === 0 || found.length > MOST) {
      continue;
    }
    if (found.length > 1) {
      open.push({ one, found });
      continue;
    }
    settle(one.id, found[0]);
    if (one.location !== null && before > 0) {
      known.push({ location: one.location, fraction: found[0].at / before });
    }
  }
  for (const { one, found } of open) {
    const due = fractionOfLocation(one.location, top, known);
    let pick = found[0];
    if (due !== null) {
      for (const other of found) {
        if (Math.abs(other.at / before - due) < Math.abs(pick.at / before - due)) {
          pick = other;
        }
      }
    }
    settle(one.id, pick);
  }
  return signal?.aborted ? null : placed;
};

/** One passage's place in the book, as a CFI of its words; null when the book has not got it (or has it too often to say where). */
export const placePassageInBook = async (book: any, text: string, location: number | null = null, options: PlaceOptions = {}) =>
  (await placeInBook(book, [{ id: "", text, location }], options))?.get("")?.cfi ?? null;

// ---- what was tried -----------------------------------------------------------------

/**
 * The highlights looked for in a book and not found, kept on this device
 * (`leaflet.kindleTried.<book id>`; services/deviceData.ts) so they are not
 * looked for again at every opening; and the highest Kindle location the
 * book's clippings had, which those since placed no longer say.
 */
export type KindleTried = { ids: Set<string>; top: number | null };

export const triedKey = (bookId: string) => `leaflet.kindleTried.${bookId}`;

/** Raised when the looking gets better at it: what an older one did not find is then looked for again. */
const LOOKING = 1;
/** More ids than this are not kept: the oldest go, and are looked for again. */
const KEPT = 5000;

export const readTried = (raw: string | null | undefined): KindleTried => {
  try {
    const kept = JSON.parse(raw ?? "null") as { v?: unknown; ids?: unknown; top?: unknown } | null;
    const top = typeof kept?.top === "number" && kept.top > 0 ? kept.top : null;
    const ids = kept?.v === LOOKING && Array.isArray(kept.ids) ? kept.ids.filter((id): id is string => typeof id === "string") : [];
    return { ids: new Set(ids), top };
  } catch {
    return { ids: new Set(), top: null };
  }
};

export const writeTried = (tried: KindleTried): string => JSON.stringify({ v: LOOKING, ids: [...tried.ids].slice(-KEPT), top: tried.top });

/**
 * A book's highlights that are still at a Kindle's place and have words to
 * look for, less those tried already; and the highest Kindle location known
 * for the book. (A note written where nothing was highlighted has no words in
 * the book: it stays as it is.)
 */
export const kindleWanted = (highlights: readonly Annotation[], tried: KindleTried): { passages: KindlePassage[]; top: number | null } => {
  const passages: KindlePassage[] = [];
  let top = tried.top;
  for (const item of highlights) {
    if (item.kind !== "highlight" || !isKindlePlace(item.cfi)) {
      continue;
    }
    const location = kindleLocation(item.cfi);
    if (location !== null && (top === null || location > top)) {
      top = location;
    }
    const text = item.text ?? "";
    if (text.trim() && !tried.ids.has(item.id)) {
      passages.push({ id: item.id, text, location });
    }
  }
  return { passages, top };
};
