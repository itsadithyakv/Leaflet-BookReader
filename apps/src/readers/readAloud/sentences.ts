/**
 * A paragraph cut into sentences, for reading aloud: each one is spoken as
 * an utterance of its own and lit on the page while it is.
 *
 * A full stop ends a sentence unless it belongs to a word ("Mr.", "e.g.",
 * an initial, "3.5"); a question or exclamation mark, or an ellipsis, ends
 * one when what follows starts a new one (not a lower-case word: "Stop!" he
 * said is one sentence). Closing quotes and brackets stay with the sentence
 * they close. Scripts without spaces (Chinese, Japanese) end at their own
 * stops. A sentence too long to speak or light comfortably is cut again at a
 * semicolon, a colon, a dash or a comma near the middle.
 */

/** Words that end in a full stop without ending the sentence. Lower case, without the stop. */
const ABBREVIATIONS = new Set(
  (
    "mr mrs ms mx dr prof st sr jr mt ft rev hon gen col capt cpt lt sgt maj cmdr adm gov pres sen rep supt insp det " +
    "vs etc al approx ca cf ed eds esp est fig figs inc ltd co corp dept univ assn bros vol vols no nos pp ch chap sec " +
    "ave blvd rd jan feb mar apr jun jul aug sep sept oct nov dec mon tue tues wed thu thur thurs fri sat sun messrs mme mlle"
  ).split(" ")
);

/** "e.g.", "i.e.", "a.m.", "U.S.": letters each with a stop. */
const DOTTED = /(?:^|[^\p{L}])(?:\p{L}\.){2,}$/u;
/** A lone capital with a stop: an initial ("J. R. R. Tolkien"). */
const INITIAL = /(?:^|[^\p{L}])\p{Lu}\.$/u;

/** What may stand after the stop and still belong to the sentence: closing quotes and brackets. */
const CLOSERS = /["'”’»›)\]}]/u;
/** Sentence ends in scripts written without spaces. */
const WIDE_STOPS = /[。！？｡]/u;

/** Longer than this, a sentence is cut again (see `cutLong`). */
export const LONG_SENTENCE = 320;

export type Span = { start: number; end: number };

const isSpace = (char: string | undefined) => char !== undefined && /\s/u.test(char);
const isLower = (char: string | undefined) => char !== undefined && /\p{Ll}/u.test(char);
const isDigit = (char: string | undefined) => char !== undefined && /\p{Nd}/u.test(char);

/** The word that ends just before `at` (the stop), without the stop. */
const wordBefore = (text: string, at: number) => {
  let from = at;
  while (from > 0 && !isSpace(text[from - 1]) && !/["'“‘«(\[]/u.test(text[from - 1])) {
    from -= 1;
  }
  return text.slice(from, at);
};

/** Whether the full stop at `at` ends a sentence. */
const stopEnds = (text: string, at: number) => {
  const before = text[at - 1];
  const after = text[at + 1];
  // 3.5, 1.000, www.example.com: no space after it.
  if (after !== undefined && !isSpace(after) && !CLOSERS.test(after) && after !== "." && after !== "…") {
    return false;
  }
  if (isDigit(before) && isDigit(after)) {
    return false;
  }
  const word = wordBefore(text, at);
  const bare = word.replace(/^[^\p{L}\p{N}]+/u, "");
  if (ABBREVIATIONS.has(bare.toLowerCase())) {
    return false;
  }
  if (DOTTED.test(text.slice(Math.max(0, at - 12), at + 1)) || INITIAL.test(text.slice(Math.max(0, at - 3), at + 1))) {
    // "U.S." at the end of a sentence is rarely followed by a capital that
    // is not a new sentence, but an initial always is: treat both as words.
    return false;
  }
  return true;
};

/**
 * Where each sentence of `text` starts and ends (white space at either end
 * left out). Line breaks in `text` always end a sentence: a block of the
 * book is never read on into the next.
 */
export const splitSentences = (text: string): Span[] => {
  const spans: Span[] = [];
  let start = 0;
  const push = (end: number) => {
    let from = start;
    let to = end;
    while (from < to && isSpace(text[from])) from += 1;
    while (to > from && isSpace(text[to - 1])) to -= 1;
    // A run with no words in it ("* * *", a lone dash) is not read.
    if (to > from && /[\p{L}\p{N}]/u.test(text.slice(from, to))) {
      spans.push({ start: from, end: to });
    }
    start = end;
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      push(index);
      index += 1;
      continue;
    }
    if (WIDE_STOPS.test(char)) {
      let end = index + 1;
      while (end < text.length && (CLOSERS.test(text[end]) || /[」』）】]/u.test(text[end]))) end += 1;
      push(end);
      index = end;
      continue;
    }
    if (char === "." || char === "!" || char === "?" || char === "…") {
      // The whole run of marks ("?!", "...", ". . .").
      let end = index;
      while (end < text.length && (/[.!?…]/u.test(text[end]) || (text[end] === " " && text[end + 1] === "." && text[end - 1] === "."))) {
        end += 1;
      }
      const run = text.slice(index, end);
      const single = run === ".";
      if (single && !stopEnds(text, index)) {
        index = end;
        continue;
      }
      while (end < text.length && CLOSERS.test(text[end])) end += 1;
      // What comes next: a sentence starts with anything but a lower-case word.
      let next = end;
      while (next < text.length && text[next] !== "\n" && isSpace(text[next])) next += 1;
      const following = text[next];
      const spaced = next > end || end >= text.length || following === "\n";
      if (!spaced) {
        index = end;
        continue;
      }
      if (following !== undefined && following !== "\n" && isLower(following)) {
        // "Stop!" he said. / "Well... perhaps": one sentence.
        index = end;
        continue;
      }
      push(end);
      index = end;
      continue;
    }
    index += 1;
  }
  push(text.length);
  return spans.flatMap((span) => cutLong(text, span));
};

/** A sentence too long for one utterance, cut at the best break near its middle (and again, as often as it takes). */
export const cutLong = (text: string, span: Span, limit = LONG_SENTENCE): Span[] => {
  if (span.end - span.start <= limit) {
    return [span];
  }
  const middle = span.start + Math.floor((span.end - span.start) / 2);
  const reach = Math.floor((span.end - span.start) * 0.4);
  let best = -1;
  let bestScore = -Infinity;
  for (let at = span.start + 20; at < span.end - 20; at += 1) {
    const char = text[at];
    const rank = char === ";" ? 4 : char === ":" ? 3 : char === "—" || char === "–" ? 3 : char === "," ? 2 : char === " " ? 0 : -1;
    if (rank < 0 || !isSpace(text[at + 1]) && char !== "—" && char !== "–") {
      continue;
    }
    const distance = Math.abs(at - middle);
    if (distance > reach) {
      continue;
    }
    const score = rank * 1000 - distance;
    if (score > bestScore) {
      bestScore = score;
      best = at + 1;
    }
  }
  if (best < 0) {
    best = middle;
  }
  let secondStart = best;
  while (secondStart < span.end && isSpace(text[secondStart])) secondStart += 1;
  let firstEnd = best;
  while (firstEnd > span.start && isSpace(text[firstEnd - 1])) firstEnd -= 1;
  return [...cutLong(text, { start: span.start, end: firstEnd }, limit), ...cutLong(text, { start: secondStart, end: span.end }, limit)];
};
