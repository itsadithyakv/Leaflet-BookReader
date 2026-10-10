/**
 * A name of the book's own under the pointer (a person, a place, an order, a
 * thing the book has a word for), and the line of the book that best says
 * what it is: the answer to "who, or what, is this?" for a reader who has not
 * written anything down.
 *
 * Two questions, both answered from the text alone:
 *
 *   What is the pointer on? The word, and the longest run of capitalised
 *   words around it ("Order of the Phoenix", "Lord Ruler"). There is no
 *   dictionary to ask, so a term is told from an ordinary word by how the
 *   book writes it: with a capital in the middle of a sentence, and not also
 *   written small.
 *
 *   What does the book say it is? Of every sentence so far that uses it, the
 *   one built like an introduction ("X was a...", "X, the...", "a ... called
 *   X"), or failing one, the first.
 *
 * Spoiler-free in the same way as `mentions.ts`: only text up to the place
 * being read is ever handed in.
 *
 * Pure: strings in, offsets out.
 */
import type { Mention } from "./mentions";
import type { NameHit } from "./names";
import { ACTS, ARTICLES, NOT_NAMES, PLACING, TITLES } from "./suggest";

export type TermCandidate = {
  /** The term as the book writes it, without a possessive's tail. */
  text: string;
  /** Where it is in the text handed in. */
  start: number;
  end: number;
  /** It begins with a title ("Lord Renoux"): the name without it is offered too, and is usually the one meant. */
  titled?: boolean;
  /**
   * A word of the book's own that it writes small ("shelldry", "skaa"), known
   * for one only because the book's fan wiki has a page for it; `page` is
   * that page. The only candidate when there is one.
   */
  small?: boolean;
  page?: string;
};

type Token = { start: number; end: number; word: string };

const WORD = /[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu;
/** What an apostrophe adds to a word: "Vin's", "I've", "he'd". */
const ADDED = /[’'](?:s|d|m|t|ll|ve|re)$/iu;
/** Small words inside a name: "Order of the Phoenix", "Vasco da Gama". */
const JOINERS = new Set("of the de la le du des von van der den da di del al el bin ibn".split(" "));
/** How far each side of the pointer a name is looked for. */
const REACH = 120;
/** A run of capitalised words longer than this is a heading, not a name. */
const MAX_RUN = 6;
/** Ends a sentence, opens speech, or otherwise starts something new: a capital after it says nothing. */
const BREAKS = /[.!?…:;\n"“‘(\[—–]/u;

const bare = (word: string) => word.replace(ADDED, "").replace(/[’'-]+$/u, "");
const keyOf = (word: string) =>
  bare(word)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const startsUpper = (word: string) => /^\p{Lu}/u.test(word);
const allCapitals = (word: string) => {
  const letters = bare(word).replace(/[^\p{L}]/gu, "");
  return letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
};
const owned = (word: string) => ADDED.test(word);

/**
 * The names the pointer may be on, the longest first: the whole run of
 * capitalised words ("Lord Renoux"), the run without a title before it
 * ("Renoux"), and the one word. None when it is on an ordinary word.
 *
 * `text` is a chapter's text (or the paragraph's) and `offset` the place in
 * it under the pointer. `isCommon` says a lower-case word is an everyday one.
 * `ownPage`, where the book's fan wiki has been read, gives the wiki's page
 * for a word written small: nothing in the book tells "shelldry" (a game it
 * made up, and names twice) from a word, and a wiki with a page for it does.
 */
export const termsAt = (
  text: string,
  offset: number,
  isCommon: (key: string) => boolean,
  ownPage?: (key: string) => string | null
): TermCandidate[] => {
  if (offset < 0 || offset > text.length) {
    return [];
  }
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEndAt = text.indexOf("\n", offset);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  const from = Math.max(lineStart, offset - REACH);
  const to = Math.min(lineEnd, offset + REACH);
  const tokens: Token[] = [];
  for (const match of text.slice(from, to).matchAll(WORD)) {
    tokens.push({ start: from + match.index, end: from + match.index + match[0].length, word: match[0] });
  }
  let at = tokens.findIndex((token) => token.start <= offset && offset < token.end);
  if (at < 0) {
    at = tokens.findIndex((token) => token.end === offset);
  }
  if (at < 0) {
    return [];
  }

  const gap = (index: number) => (index > 0 ? text.slice(tokens[index - 1].end, tokens[index].start) : text.slice(from, tokens[0].start));
  /** Only spaces between this word and the one before: the two go together. */
  const joined = (index: number) => index > 0 && /^[ \t\u00a0]+$/.test(gap(index));
  const sentenceStart = (index: number) => {
    if (index === 0) {
      // The first word of the line; or of what was looked at, which says nothing.
      return from === lineStart ? true : BREAKS.test(gap(0));
    }
    return BREAKS.test(gap(index));
  };
  const nameish = (index: number) => {
    const token = tokens[index];
    const key = keyOf(token.word);
    return startsUpper(token.word) && !allCapitals(token.word) && key.length >= 2 && !(isCommon(key) && sentenceStart(index));
  };
  const joiner = (index: number) => JOINERS.has(tokens[index].word.toLocaleLowerCase());

  const hovered = tokens[at];
  // A chapter's opening words in capitals: the one word, as it is written elsewhere.
  if (allCapitals(hovered.word)) {
    const word = bare(hovered.word);
    const key = keyOf(word);
    if (key.length < 3 || isCommon(key) || TITLES.has(key) || NOT_NAMES.has(key)) {
      return [];
    }
    return [{ text: word[0] + word.slice(1).toLocaleLowerCase(), start: hovered.start, end: hovered.start + word.length }];
  }
  if (!nameish(at) && !joiner(at)) {
    // Written small: a word of the book's own if its wiki has a page for
    // it, and never an everyday word, whatever a wiki has pages for.
    const word = bare(hovered.word);
    const key = keyOf(word);
    const page = ownPage && !startsUpper(hovered.word) && !isCommon(key) ? ownPage(key) : null;
    return page ? [{ text: word, start: hovered.start, end: hovered.start + word.length, small: true, page }] : [];
  }

  /**
   * The next name to the left of `index`, through small joining words; -1
   * when there is none. A possessive ends a name ("Kelsier's Survivor" is two)
   * unless `through`: "the Night's Watch" and "King's Landing" are one each,
   * and which it is, the book's own use settles.
   */
  const reachLeft = (index: number, through = false) => {
    let i = index;
    for (let hops = 0; hops < 3; hops += 1) {
      if (!joined(i) || (!through && owned(tokens[i - 1].word))) {
        return -1;
      }
      i -= 1;
      if (nameish(i)) {
        return i;
      }
      if (!joiner(i)) {
        return -1;
      }
    }
    return -1;
  };
  const reachRight = (index: number, through = false) => {
    let i = index;
    for (let hops = 0; hops < 3; hops += 1) {
      if (i + 1 >= tokens.length || !joined(i + 1) || (!through && owned(tokens[i].word))) {
        return -1;
      }
      i += 1;
      if (nameish(i)) {
        return i;
      }
      if (!joiner(i)) {
        return -1;
      }
    }
    return -1;
  };

  let lo = at;
  let hi = at;
  if (!nameish(at)) {
    // On "of" in "Order of the Phoenix": a name on both sides, or it is just a word.
    const left = reachLeft(at);
    const right = reachRight(at);
    if (left < 0 || right < 0) {
      return [];
    }
    lo = left;
    hi = right;
  }
  for (let next = reachLeft(lo); next >= 0 && hi - next < MAX_RUN; next = reachLeft(lo)) {
    lo = next;
  }
  for (let next = reachRight(hi); next >= 0 && next - lo < MAX_RUN; next = reachRight(hi)) {
    hi = next;
  }
  // The same, reading through possessives: a longer name, if the book uses it as one.
  let wideLo = lo;
  let wideHi = hi;
  for (let next = reachLeft(wideLo, true); next >= 0 && wideHi - next < MAX_RUN; next = reachLeft(wideLo, true)) {
    wideLo = next;
  }
  for (let next = reachRight(wideHi, true); next >= 0 && next - wideLo < MAX_RUN; next = reachRight(wideHi, true)) {
    wideHi = next;
  }

  const spanOf = (first: number, last: number): TermCandidate => {
    const end = tokens[last].start + bare(tokens[last].word).length;
    return { text: text.slice(tokens[first].start, end).replace(/\s+/g, " "), start: tokens[first].start, end };
  };
  const out: TermCandidate[] = [];
  const add = (candidate: TermCandidate) => {
    if (candidate.text && !out.some((item) => item.text === candidate.text)) {
      out.push(candidate);
    }
  };
  const isTitle = (index: number) => TITLES.has(keyOf(tokens[index].word));
  if (wideLo < lo || wideHi > hi) {
    add({ ...spanOf(wideLo, wideHi), titled: isTitle(wideLo) });
  }
  if (hi > lo) {
    add({ ...spanOf(lo, hi), titled: isTitle(lo) });
    // "Lord Renoux" is Renoux; "Lord Ruler" is not Ruler, which the counts settle.
    let first = lo;
    while (first < hi && first < at && isTitle(first)) {
      first += 1;
    }
    if (first > lo) {
      add(spanOf(first, hi));
    }
  }
  if (nameish(at)) {
    const key = keyOf(hovered.word);
    if (!TITLES.has(key) && !NOT_NAMES.has(key) && key.length >= 3) {
      add(spanOf(at, at));
    }
  }
  return out;
};

// ---- What the book says it is ----------------------------------------------

/** How much of a sentence is kept on each side of the name. */
export const SENTENCE_REACH = 240;

/** "Mr. Potter": the full stop is not the end of a sentence. */
const SHORT_FOR = new Set("mr mrs ms dr st sr jr prof capt col gen lt sgt rev hon mme mlle m".split(" "));

/** Where the sentence that holds `start..end` begins and ends in `text`, with whether either side was cut short. */
const sentenceBounds = (text: string, start: number, end: number) => {
  const floor = Math.max(0, start - SENTENCE_REACH);
  let from = floor;
  let cutBefore = floor > 0;
  for (let i = start - 1; i >= floor; i -= 1) {
    const char = text[i];
    if (char === "\n") {
      from = i + 1;
      cutBefore = false;
      break;
    }
    if (/[.!?…]/u.test(char)) {
      // The end of the sentence before: after its closing marks, at the next word.
      let after = i + 1;
      while (after < start && /["”’)\]]/u.test(text[after])) {
        after += 1;
      }
      const spaced = after < start && /\s/.test(text[after]);
      const word = /([\p{L}]+)$/u.exec(text.slice(Math.max(0, i - 6), i))?.[1] ?? "";
      if (spaced && !(char === "." && SHORT_FOR.has(word.toLocaleLowerCase()))) {
        from = after;
        cutBefore = false;
        break;
      }
    }
  }
  const ceiling = Math.min(text.length, end + SENTENCE_REACH);
  let to = ceiling;
  let cutAfter = ceiling < text.length;
  for (let i = end; i < ceiling; i += 1) {
    const char = text[i];
    if (char === "\n") {
      to = i;
      cutAfter = false;
      break;
    }
    if (/[.!?…]/u.test(char)) {
      const word = /([\p{L}]+)$/u.exec(text.slice(Math.max(end, i - 6), i))?.[1] ?? "";
      if (char === "." && SHORT_FOR.has(word.toLocaleLowerCase())) {
        continue;
      }
      let after = i + 1;
      while (after < ceiling && /[.!?…"”’)\]]/u.test(text[after])) {
        after += 1;
      }
      if (after >= text.length || /\s/.test(text[after])) {
        to = after;
        cutAfter = false;
        break;
      }
    }
  }
  return { from, to, cutBefore, cutAfter };
};

const oneLine = (value: string) => value.replace(/\s+/g, " ");

/** The sentence a mention is in, as a line of the book's words around the name. */
export const sentenceOf = (text: string, section: number, start: number, end: number): Mention => {
  const { from, to, cutBefore, cutAfter } = sentenceBounds(text, start, end);
  let before = oneLine(text.slice(from, start)).replace(/^\s+/, "");
  let after = oneLine(text.slice(end, to)).replace(/\s+$/, "");
  if (cutBefore) {
    before = `…${before.replace(/^\S*\s+/, "")}`;
  }
  if (cutAfter) {
    after = `${after.replace(/\s+\S*$/, "")}…`;
  }
  return { section, start, end, before, match: oneLine(text.slice(start, end)), after };
};

const KINS = "son daughter brother sister wife husband father mother uncle aunt cousin friend servant leader head lord lady king queen captain master mistress heir".replace(/ /g, "|");
/** What a name can be "of": "the city of Luthadel", "the lord of Winterfell". */
const KINDS =
  "city town village kingdom land lands house order ministry guild river sea isle island fortress keep castle empire realm province school company church temple people language port mountains forest valley lord lady king queen prince princess duke leader head captain master god goddess";

/** The name opens the sentence, or a part of it: it is what is being spoken of. */
const SUBJECT = /(?:^|[,;:—–“"‘(]\s*|\b(?:and|but)\s+)(?:the\s+|a\s+|an\s+)?$/iu;
/** The sentence sets a scene before it gets to the name ("When she asked after X, the servants..."). */
const LED_IN = /^["“‘]?(?:when|as|if|after|before|while|since|though|although|once|until|because|with|without|across|behind|beside|beyond|inside|outside)\b/iu;
const AFTER_IS = /^\s+(?:was|is|were|are|had been|has been|had once been|became)\s+(?:a|an|the|one of|known|called|his|her|their|its|not|no|more than|little more|just|only)\b/iu;
/** "along the base of the Wall, a dark cold cell": what follows the comma is about the base, not the Wall. */
const INSIDE = /\b(?:of|to|at|in|on|from|for|with|by|near|along|into|onto|toward|towards|beneath|under|over|behind|beside|through|across|against)\s+(?:the\s+)?$/iu;
const AFTER_APPOSITION = new RegExp(
  `^,\\s+(?:(?:a|an|the|one of)\\b|(?:his|her|their|its|my|our)\\s+(?:[\\p{Ll}’'-]+\\s+)?(?:${KINS})\\b|(?:${KINS})\\s+(?:of|to)\\b)`,
  "iu"
);
const AFTER_WHO = /^,\s+(?:who|whose|whom|which|where)\b/iu;
const AFTER_ASIDE = /^\s*[—–(]/u;
/** The name ends its part of the sentence: "The man, Dockson, was...", "...her brother, Reen." */
const CLOSED = /^[,.;:—–!?]/u;
const BEFORE_NAMED = /\b(?:named|called|known as|name was|name is|titled|dubbed|styled)\s+$/iu;
/** (Relations only: "your Lord Tresting" is a title, not who he is.) */
const BEFORE_KIN = /\b(?:his|her|their|its|my|our|your)\s+(?:[\p{Ll}’'-]+\s+)?(?:son|daughter|brother|sister|wife|husband|father|mother|uncle|aunt|cousin|friend|servant),?\s+$/iu;
/** In speech, a name between commas is someone spoken to; and a name followed by another is one of a list. */
const SPOKEN = /^["“‘]/u;
const LISTED = /^,\s+(?:and\s+)?\p{Lu}/u;
/** ", Vin, perhaps you should...": what follows is said to them, not about them. */
const ADDRESSED =
  /^,\s+(?:you|your|i|i’m|i'm|we|it|it’s|it's|this|that|there|perhaps|please|do|don’t|don't|what|why|how|when|where|who|if|but|so|then|now|my|is|are|can|could|would|will|let|come|go|look|listen|tell|have|did|no|yes)\b/iu;
const BEFORE_APPOSITION = /\b(?:a|an|the|his|her|their|its|my|our|your)\s+[\p{L}’'-]+(?:\s+[\p{L}’'-]+){0,3},\s+(?:the\s+)?$/iu;
const BEFORE_OF = new RegExp(`\\b(?:${KINDS.replace(/ /g, "|")})\\s+of\\s+(?:the\\s+)?$`, "iu");
const BEFORE_KIND = /\b(?:the|a|an|his|her|their|its|my|our|your)\s+(?:[\p{Ll}’'-]+\s+){1,3}$/u;
/** "a glance at X", "the rest of X": the words before lead to the name, they do not say what it is. */
const LEADS_TO =
  /\b(?:at|to|of|in|on|for|from|with|by|about|after|before|toward|towards|into|onto|over|under|behind|beside|near|as|than|like|and|or|but|that|when|while|if|where|who|which|was|is|were|had|said|asked)\s+$/iu;
/** ", the shifting mists making...": a scene going on, not who they are. */
const GOING_ON = /^,\s+(?:\S+\s+){1,3}?\S+ing\b/iu;

/**
 * How much a sentence reads like an introduction of the name in it. At
 * `DESCRIBES` and above it is worth showing instead of the first mention.
 *
 * Tuned on a novel's worth of sentences, and kept strict: a line that only
 * uses the name, shown as if it said who they were, is worse than the plain
 * first mention it would replace.
 */
export const describes = (before: string, after: string): number => {
  let score = 0;
  const ledIn = LED_IN.test(before);
  // "X was a..." says what X is only where X is what is being spoken of:
  // "the keep in Luthadel was a..." is about the keep.
  if (AFTER_IS.test(after) && SUBJECT.test(before)) {
    score += 6;
  } else if (AFTER_APPOSITION.test(after) && !ledIn && !GOING_ON.test(after) && !INSIDE.test(before)) {
    score += 5;
  } else if (AFTER_WHO.test(after) || AFTER_ASIDE.test(after)) {
    score += 2;
  }
  if (BEFORE_NAMED.test(before)) {
    score += 6;
  } else if (BEFORE_KIN.test(before)) {
    score += 5;
  } else if (
    BEFORE_APPOSITION.test(before) &&
    CLOSED.test(after) &&
    !SPOKEN.test(before) &&
    !LISTED.test(after) &&
    !ADDRESSED.test(after)
  ) {
    score += 4;
  } else if (BEFORE_OF.test(before)) {
    score += 3;
  } else if (BEFORE_KIND.test(before) && !LEADS_TO.test(before)) {
    score += 2;
  }
  // "Vin's": about something of theirs, not about them.
  if (/^[’']s\b/u.test(after)) {
    score -= 2;
  }
  // Called to across a room: ", Vin." in speech.
  if (/,\s*$/.test(before) && /^(?:[.!?]|,?["”’])/u.test(after)) {
    score -= 3;
  }
  // Short enough to be an exchange, not an account: "Yes, his name is Yoren."
  if (before.length + after.length < 40) {
    score -= 2;
  }
  // Asked, not told.
  if (/\?["”’)]*…?$/u.test(after)) {
    score -= 3;
  }
  const length = before.length + after.length;
  if (length >= 40 && length <= 230) {
    score += 1;
  }
  return score;
};

/** Capitalised mid-sentence this often, a word is a name whatever else the book does with it. */
export const OFTEN = 8;

/** A sentence scoring at least this says what the name is. */
export const DESCRIBES = 5;

export type TermKind = "person" | "place" | null;

/** What one chapter (or the part of one read so far) says of a name. */
export type SectionStat = {
  section: number;
  count: number;
  /** Written with its capital in the middle of a sentence. */
  mid: number;
  /** The same word written small (one word only): an ordinary word, then. */
  small: number;
  acts: number;
  placed: number;
  article: number;
  first: Mention | null;
  /** Its first line in capitals where the name is not written so (a heading, a title page): shown only failing any other. */
  shout: Mention | null;
  /** The sentence that reads most like an introduction, and how much. */
  best: { mention: Mention; score: number } | null;
};

export type TermSummary = {
  count: number;
  /** How many chapters it has been in. */
  sections: number;
  first: Mention | null;
  /** The line that best says what it is: an introduction if the book gave one, else the first mention. */
  about: Mention | null;
  /** True when `about` is an introduction, not only where the name first came up. */
  described: boolean;
  kind: TermKind;
  /** The book treats it as a name: capitalised mid-sentence, and not also written small. */
  named: boolean;
};

const wordBefore = (text: string, start: number) => /([\p{L}’'-]+)[ \t\u00a0]+$/u.exec(text.slice(Math.max(0, start - 24), start))?.[1].toLocaleLowerCase() ?? "";
const wordAfter = (text: string, end: number) => /^[ \t\u00a0]+([\p{L}’'-]+)/u.exec(text.slice(end, end + 24))?.[1].toLocaleLowerCase() ?? "";

/**
 * Reads one chapter's text for a name. `find` finds the name (and any others
 * of the same person); `person` keeps one person's; `small` is the name as a
 * single lower-case word, when it is one.
 */
export const statOf = (
  section: number,
  text: string,
  find: (text: string) => NameHit[],
  person: string | null,
  small: string | null
): SectionStat => {
  const stat: SectionStat = { section, count: 0, mid: 0, small: 0, acts: 0, placed: 0, article: 0, first: null, shout: null, best: null };
  for (const hit of find(text)) {
    if (person && hit.person !== person) {
      continue;
    }
    stat.count += 1;
    let back = hit.start - 1;
    while (back >= 0 && /[ \t\u00a0]/.test(text[back])) {
      back -= 1;
    }
    if (back >= 0 && !BREAKS.test(text[back]) && !/[’'”]/u.test(text[back])) {
      stat.mid += 1;
    }
    const led = wordBefore(text, hit.start);
    const next = wordAfter(text, hit.end);
    if (ACTS.has(next) || ACTS.has(led)) {
      stat.acts += 1;
    }
    if (PLACING.has(led)) {
      stat.placed += 1;
    }
    if (ARTICLES.has(led)) {
      stat.article += 1;
    }
    const mention = sentenceOf(text, section, hit.start, hit.end);
    // In capitals where the name is not written so: a heading, a title page.
    // Counted, and shown only when the name is written no other way.
    const written = text.slice(hit.start, hit.end);
    if (written === written.toLocaleUpperCase() && written !== written.toLocaleLowerCase()) {
      stat.shout ??= mention;
      continue;
    }
    if (!stat.first) {
      stat.first = mention;
    }
    const score = describes(mention.before, mention.after);
    if (!stat.best || score > stat.best.score) {
      stat.best = { mention, score };
    }
  }
  if (small && stat.count > 0) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_’'-])${small.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "gu");
    stat.small = text.match(pattern)?.length ?? 0;
  }
  return stat;
};

/** What the chapters read so far say of a name, put together. */
export const termSummary = (stats: SectionStat[]): TermSummary => {
  const inOrder = [...stats].filter((stat) => stat.count > 0).sort((a, b) => a.section - b.section);
  const total = (pick: (stat: SectionStat) => number) => inOrder.reduce((sum, stat) => sum + pick(stat), 0);
  const count = total((stat) => stat.count);
  const first = inOrder.find((stat) => stat.first)?.first ?? inOrder.find((stat) => stat.shout)?.shout ?? null;
  // The chapter a name comes into the book in is where it is most likely
  // introduced: its best line there wins a tie with any later one.
  const cameIn = inOrder.find((stat) => stat.best)?.section;
  let top: Mention | null = null;
  let topScore = -Infinity;
  for (const stat of inOrder) {
    const score = stat.best ? stat.best.score + (stat.section === cameIn ? 1 : 0) : -Infinity;
    if (stat.best && score > topScore) {
      top = stat.best.mention;
      topScore = score;
    }
  }
  const described = topScore >= DESCRIBES;
  const acts = total((stat) => stat.acts);
  const placed = total((stat) => stat.placed);
  const small = stats.reduce((sum, stat) => sum + stat.small, 0);
  const mid = total((stat) => stat.mid);
  const kind: TermKind =
    acts >= 2 && acts * 25 >= count && acts >= placed
      ? "person"
      : placed >= 2 && placed * 3 >= count && placed > acts * 2
        ? "place"
        : null;
  return {
    count,
    sections: inOrder.length,
    first,
    about: described && top ? top : first,
    described,
    kind,
    // "the Wall", "the Hand": a word the book also writes small, but gives a
    // capital in the middle of a sentence too often for that to be chance.
    named: mid >= 1 && (small * 5 <= count || mid >= OFTEN)
  };
};

/**
 * Which of the names the pointer may be on the peek is about: the longest
 * the book really uses. `counts` are how often each has been written so far,
 * in `termsAt`'s order (the longest first); `titled` says which begin with a
 * title.
 *
 * A name of several words the book has written three times is that name:
 * "Night's Watch" over "Watch", "Jon Snow" over "Snow", however often the
 * short one is written alone. One that begins with a title has to hold its
 * own against the name without it: "Lord Ruler" over "Ruler" (the book
 * hardly writes one without the other), but "Kelsier" over "Master Kelsier"
 * (it mostly does).
 */
export const pickTerm = (counts: number[], titled: boolean[] = []): number => {
  let chosen = -1;
  counts.forEach((count, index) => {
    if (count < 2) {
      return;
    }
    if (chosen < 0 || (titled[chosen] ? counts[chosen] * 2 < count : counts[chosen] < 3)) {
      chosen = index;
    }
  });
  return chosen;
};
