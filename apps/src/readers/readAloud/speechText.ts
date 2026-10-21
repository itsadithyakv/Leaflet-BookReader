/**
 * A sentence as the voice should say it, not as the page sets it: what a
 * listener should not hear left out, and what a voice would say badly put
 * the way a person reading aloud would say it.
 *
 * - a drop cap joined to its word ("T he" is "The": the walk says where one
 *   ends, `glue`);
 * - note markers left in the text ("[12]", "word¹", "word†") left out;
 * - a run of scene-break glyphs (* * *, ⁂, ❦) inside the text left out (a
 *   scene break on a line of its own is a pause, `chapterText.ts`);
 * - a web address said as its site ("gutenberg.org"), never letter by letter;
 * - dashes said as the pause they stand for, a range of numbers as "to";
 *   spaced dots as an ellipsis; curly quotes and apostrophes made plain;
 *   soft hyphens, zero-width characters and odd spaces gone;
 * - a paragraph's opening in capitals (small caps set as capitals: "IT WAS
 *   the best") in ordinary case, so no voice spells "IT" out;
 * - Roman numerals said as numbers in a heading ("CHAPTER XIV" is "Chapter
 *   14") and after "Chapter", "Part" or "Book" anywhere (never a lone "I").
 *
 * Every character of what is said knows the character of the sentence it
 * came from (`map`), so a word the voice says is lit exactly on the page.
 */

export type Spoken = {
  text: string;
  /** For each character of `text`, where it came from in the source; one more at the end (the source's length). */
  map: number[];
};

export type SpeechContext = {
  /** The sentence is (part of) a heading. */
  heading?: boolean;
  /** The sentence opens its paragraph. */
  blockStart?: boolean;
  /** Offsets in the source just past a drop cap: the space after each is taken out. */
  glue?: readonly number[];
};

type Mapped = { text: string; map: number[] };

const identity = (text: string): Mapped => ({ text, map: Array.from({ length: text.length + 1 }, (_, index) => index) });

/**
 * Each match of `pattern` (global) put as `replace` says (null: left as it
 * is). A replacement's characters map evenly over what they replace, so one
 * the same length maps one to one.
 */
const rewrite = (from: Mapped, pattern: RegExp, replace: (match: RegExpExecArray) => string | null): Mapped => {
  const chars: string[] = [];
  const map: number[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(from.text); match; match = pattern.exec(from.text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (end === start) {
      pattern.lastIndex += 1;
      continue;
    }
    const put = replace(match);
    if (put === null) continue;
    for (let at = last; at < start; at += 1) {
      chars.push(from.text[at]);
      map.push(from.map[at]);
    }
    const span = end - start;
    for (let at = 0; at < put.length; at += 1) {
      chars.push(put[at]);
      map.push(from.map[start + Math.min(span - 1, Math.floor((at * span) / put.length))]);
    }
    last = end;
  }
  if (last === 0 && chars.length === 0) return from;
  for (let at = last; at < from.text.length; at += 1) {
    chars.push(from.text[at]);
    map.push(from.map[at]);
  }
  map.push(from.map[from.text.length]);
  return { text: chars.join(""), map };
};

const trim = (from: Mapped): Mapped => {
  let start = 0;
  let end = from.text.length;
  while (start < end && from.text[start] === " ") start += 1;
  while (end > start && from.text[end - 1] === " ") end -= 1;
  if (start === 0 && end === from.text.length) return from;
  return { text: from.text.slice(start, end), map: [...from.map.slice(start, end), end < from.text.length ? from.map[end] : from.map[from.text.length]] };
};

/** The white space after each drop cap taken out, where a letter follows it. */
const joinDropCaps = (from: Mapped, glue: readonly number[]): Mapped => {
  if (glue.length === 0) return from;
  const cut = new Set<number>();
  for (const at of glue) {
    let end = at;
    while (end < from.text.length && /\s/u.test(from.text[end])) end += 1;
    if (end > at && /\p{L}/u.test(from.text[end] ?? "")) {
      for (let index = at; index < end; index += 1) cut.add(index);
    }
  }
  if (cut.size === 0) return from;
  const chars: string[] = [];
  const map: number[] = [];
  for (let index = 0; index < from.text.length; index += 1) {
    if (cut.has(index)) continue;
    chars.push(from.text[index]);
    map.push(from.map[index]);
  }
  map.push(from.map[from.text.length]);
  return { text: chars.join(""), map };
};

const ROMAN = /^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

/** A Roman numeral's value, or null for anything that is not one. */
export const romanValue = (numeral: string): number | null => {
  const upper = numeral.toUpperCase();
  if (!ROMAN.test(upper)) return null;
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let index = 0; index < upper.length; index += 1) {
    const value = values[upper[index]];
    const next = values[upper[index + 1]] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
};

/** Words a Roman numeral follows as a number ("Chapter IV", "Part II", "Livre III"). */
const NUMBERED = "chapter|part|book|volume|act|scene|canto|section|stave|chapitre|partie|livre|tome|kapitel|teil|buch|cap[ií]tulo|capitolo|parte|libro";
// Only the numeral is matched (the word is looked behind for): the word keeps its own place, so it is lit where it is.
const NUMBERED_ROMAN = new RegExp(String.raw`(?<=(?<!\p{L})(${NUMBERED})\s+)([MDCLXVI]+|[mdclxvi]+)(?![\p{L}\p{N}])`, "giu");

const isUpperWord = (word: string) => /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word);

/** A word in ordinary case: "WHEN" is "When" first, "when" after; "I" stays "I". */
const caseWord = (word: string, first: boolean) => {
  const lower = word.toLowerCase();
  if (/^i(?:['’](?:m|d|ll|ve))?$/u.test(lower)) return `I${word.slice(1).toLowerCase()}`;
  return first ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
};

/**
 * A paragraph that opens in capitals and goes on in lower case: the
 * capitals in ordinary case. Two capital words or more, or one of four
 * letters or more ("WHEN she came"): a short one alone may be a name ("FBI
 * agents").
 */
const openingCapitals = (from: Mapped): Mapped => {
  const words = [...from.text.matchAll(/[\p{L}'’]+/gu)];
  let count = 0;
  while (count < words.length && isUpperWord(words[count][0])) count += 1;
  if (count === 0 || count === words.length) return from;
  if (count === 1 && words[0][0].replace(/['’]/g, "").length < 4) return from;
  // Only where the capitals open the text (after a quote or a bracket, at most).
  if (/[\p{L}\p{N}]/u.test(from.text.slice(0, words[0].index))) return from;
  const until = (words[count - 1].index ?? 0) + words[count - 1][0].length;
  let index = 0;
  return rewrite(from, /[\p{L}'’]+/gu, (match) => {
    if ((match.index ?? 0) >= until) return null;
    const put = caseWord(match[0], index === 0);
    index += 1;
    return put === match[0] ? null : put;
  });
};

/** A heading all in capitals in title case ("THE BOY WHO LIVED" is "The Boy Who Lived"). */
const headingCase = (from: Mapped): Mapped => {
  if (!isUpperWord(from.text) || from.text.replace(/[^\p{L}]/gu, "").length < 2) return from;
  return rewrite(from, /[\p{L}'’]+/gu, (match) => {
    const put = caseWord(match[0], true);
    return put === match[0] ? null : put;
  });
};

/** A heading that is a numeral ("XIV", "IV."), or opens with one ("IV. The Return"): the number. */
const headingNumerals = (from: Mapped): Mapped => {
  const whole = /^([MDCLXVI]+)(?=\s*(?:[.:)\-–—]|$))/u.exec(from.text);
  const value = whole ? romanValue(whole[1]) : null;
  // (Never past 150: "MIX" or "DIX" is a word, not a chapter.)
  if (!whole || value === null || value > 150) return from;
  const length = whole[1].length;
  return rewrite(from, /^[MDCLXVI]+/gu, (match) => (match[0].length === length ? String(value) : null));
};

/** Spaces, and the characters that are for the line rather than the voice. */
const INVISIBLE = /[­​-‍⁠﻿͏]/gu;
const SPACES = /\s+/gu;
const NOTE_BRACKETS = /\s?\[(?:\d{1,3}|[a-z]|[*†‡§¶]{1,3})\]/giu;
const SUPERSCRIPT_MARK = /(?<=[\p{L}]{3}|[.,;:!?"'”’)\]])[¹²³⁰-⁹]+/gu;
const SYMBOL_MARK = /(?<=[\p{L}.,;:!?"'”’)\]])[*†‡]+(?=\s|$|["'”’).,;:!?])/gu;
const GLYPH_RUN = /(?<=^|\s)[*⁂❦☙❧✱✲✳•~#](?:\s*[*⁂❦☙❧✱✲✳•~#])*(?=\s|$)/gu;
const URL = /(?:\bhttps?:\/\/|\bwww\.)[^\s<>"“”]+[^\s<>"“”.,;:!?)\]'’]/giu;
const EM_DASH = /\s*(?:—|―|⸺|⸻|--)\s*/gu;
const NUMBER_RANGE = /(?<=\d)\s?–\s?(?=\d)/gu;
const EN_DASH = /\s*–\s*/gu;
const SPACED_DOTS = /\.(?:\s\.){2,}/gu;

const host = (url: string) => {
  const bare = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const name = bare.split(/[/?#:]/)[0];
  return name && /[\p{L}\p{N}]/u.test(name) ? name : "link";
};

/** The sentence as it is to be said, with where each of its characters came from. */
export const speechText = (source: string, context: SpeechContext = {}): Spoken => {
  let out = identity(source);
  out = joinDropCaps(out, context.glue ?? []);
  out = rewrite(out, INVISIBLE, () => "");
  out = rewrite(out, SPACES, (match) => (match[0] === " " ? null : " "));
  out = rewrite(out, NOTE_BRACKETS, () => "");
  out = rewrite(out, SUPERSCRIPT_MARK, () => "");
  out = rewrite(out, SYMBOL_MARK, () => "");
  out = rewrite(out, GLYPH_RUN, () => "");
  out = rewrite(out, URL, (match) => host(match[0]));
  out = rewrite(out, EM_DASH, (match) => {
    const before = out.text.slice(0, match.index);
    const after = out.text.slice(match.index + match[0].length);
    // Broken off ("I was going to—”) or opening a line of speech: no pause of its own.
    if (!/[\p{L}\p{N}]/u.test(after.slice(0, 1)) && !/^["'“‘(]/u.test(after)) return "";
    if (!/[\p{L}\p{N}.,;:!?]$/u.test(before)) return "";
    return ", ";
  });
  out = rewrite(out, NUMBER_RANGE, () => " to ");
  out = rewrite(out, EN_DASH, (match) => (/\s/u.test(match[0]) ? ", " : "-"));
  out = rewrite(out, SPACED_DOTS, () => "…");
  out = rewrite(out, /[“”„‟«»]/gu, () => '"');
  out = rewrite(out, /[‘’‚‛]/gu, () => "'");
  // A comma made from a dash next to one already there.
  out = rewrite(out, /,\s*(?=[,.;:!?])/gu, () => "");
  out = rewrite(out, NUMBERED_ROMAN, (match) => {
    const value = romanValue(match[2]);
    if (value === null) return null;
    // Outside a heading only "Chapter IV", "Part II": never "the book I wrote".
    if (!context.heading && (!/^\p{Lu}/u.test(match[1]) || match[2] !== match[2].toUpperCase())) return null;
    return String(value);
  });
  if (context.heading) {
    out = headingNumerals(out);
    out = headingCase(out);
  } else if (context.blockStart) {
    out = openingCapitals(out);
  }
  out = rewrite(out, / {2,}/gu, () => " ");
  return trim(out);
};

/** Where the word that starts at `at` ends (its letters, digits and inner apostrophes or hyphens). */
export const wordEnd = (text: string, at: number) => {
  let end = at;
  while (end < text.length && !/\s/u.test(text[end])) end += 1;
  // Not the punctuation after it.
  while (end > at + 1 && /[.,;:!?"')\]…]/u.test(text[end - 1])) end -= 1;
  return end;
};
