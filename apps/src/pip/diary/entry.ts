/**
 * Pip's diary: a day's facts, written up.
 *
 * `entryFor` is a function of the day's facts and its date and nothing else,
 * so a day reads the same on every device and however often it is opened. An
 * entry is a lead (what kind of day it was) and at most two asides: one about
 * something the reader did that day (a character written down, a highlight, a
 * word looked up), one about the day itself (the streak, the hour, a focus
 * session, where the bookmark was left).
 *
 * No line is used two days running: the date deals each pool's lines out in
 * turn (seed.ts), and `diaryEntries` also keeps an entry off the lines of the
 * one before it, which matters when the page before is a week back.
 *
 * Pure: no clock, no storage.
 */
import type { DayFacts, DiaryFacts } from "./facts";
import { dayNumber, dealt, hash } from "./seed";
import { ASIDES, LEADS, type AsideKind, type LeadKind, type Line, type Slots } from "./templates";

export type EntryPart = {
  /** Which line it is: the pool and its place there. */
  id: string;
  kind: LeadKind | AsideKind;
  text: string;
};

export type DiaryEntry = {
  dateKey: string;
  kind: LeadKind;
  /** Nothing was read that day. */
  rest: boolean;
  parts: EntryPart[];
  /** The entry as it is read. */
  text: string;
};

/** Short of this a day is "a sip of a book". */
const TINY_MINUTES = 5;
/** A long day: this much, and at least twice the goal. */
const BIG_MINUTES = 60;
/** Days since the last day read from which coming back is the story of the day. */
const BACK_AFTER = 4;
/** A highlight is quoted by its first few words. */
const QUOTE_WORDS = 7;
const QUOTE_CHARS = 56;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "34 minutes", "1 hour", "2 hours 5 minutes". */
export const minutesText = (minutes: number): string => {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) {
    return plural(whole, "minute");
  }
  const rest = whole % 60;
  return rest === 0 ? plural(whole / 60, "hour") : `${plural(Math.floor(whole / 60), "hour")} ${plural(rest, "minute")}`;
};

/** The first few words of a passage, without the marks a selection picks up at its ends. */
export const quoteOf = (text: string): string => {
  const words = text
    .replace(/[“”"«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const taken: string[] = [];
  for (const word of words) {
    if (taken.length >= QUOTE_WORDS || (taken.length > 0 && taken.join(" ").length + word.length + 1 > QUOTE_CHARS)) {
      break;
    }
    taken.push(word);
  }
  let quote = taken.join(" ");
  if (!quote) {
    return "";
  }
  let cut = taken.length < words.length;
  // One word longer than a line (a URL, a run of letters) is cut like a passage.
  if (quote.length > QUOTE_CHARS) {
    quote = quote.slice(0, QUOTE_CHARS);
    cut = true;
  }
  // A quote that stops short says so; one that is whole keeps no trailing comma.
  return cut ? `${quote.replace(/[\s,;:.!?…—–-]+$/u, "")}…` : quote.replace(/[\s,;:]+$/u, "");
};

/** One book by name, two as a pair, more as the first and a count. */
const titlesText = (titles: string[]): string | null => {
  if (titles.length === 0) {
    return null;
  }
  if (titles.length === 1) {
    return titles[0];
  }
  if (titles.length === 2) {
    return `${titles[0]} and ${titles[1]}`;
  }
  return `${titles[0]} and ${titles.length - 1} others`;
};

const EMPTY: ReadonlySet<string> = new Set();

const BLANK: Slots = {
  mins: minutesText(0),
  title: null,
  of: "",
  book: "the book",
  name: "",
  quote: "",
  chapter: null,
  word: "",
  run: 0,
  sessions: 0,
  percent: 0,
  nod: ""
};

const leadKind = (facts: DayFacts, today: boolean): LeadKind => {
  if (!facts.read) {
    return today ? "yet" : "rest";
  }
  if (facts.first) {
    return "first";
  }
  if (facts.books.some((book) => book.finished)) {
    return "finished";
  }
  if (facts.gap >= BACK_AFTER) {
    return "back";
  }
  if (facts.minutes < TINY_MINUTES) {
    return "tiny";
  }
  if (facts.minutes >= BIG_MINUTES && facts.minutes >= facts.goal * 2) {
    return "big";
  }
  return facts.books.length > 0 ? "book" : "read";
};

/**
 * A day's entry.
 *
 * `today` only matters on a day with nothing read: today's page says "not
 * yet", a day gone by says it was a day off. `avoid` holds lines not to use
 * (those of the entry before).
 */
export const entryFor = (
  facts: DayFacts,
  { today = false, avoid = EMPTY }: { today?: boolean; avoid?: ReadonlySet<string> } = {}
): DiaryEntry => {
  const day = dayNumber(facts.dateKey);
  const pickOf = <T,>(items: T[], salt: string): T => items[hash(`${facts.dateKey}/${salt}`) % items.length];

  /** The pool's line for this day, stepped past any the entry before used. */
  const write = (kind: LeadKind | AsideKind, pool: Line[], slots: Slots): EntryPart => {
    let index = dealt(kind, pool.length, day);
    for (let tries = 0; tries < pool.length && avoid.has(`${kind}.${index}`); tries += 1) {
      index = (index + 1) % pool.length;
    }
    return { id: `${kind}.${index}`, kind, text: pool[index](slots) };
  };

  const kind = leadKind(facts, today);
  const finished = facts.books.filter((book) => book.finished).map((book) => book.title);
  const title = kind === "finished" ? titlesText(finished) : titlesText(facts.books.map((book) => book.title));
  const base: Slots = {
    ...BLANK,
    mins: minutesText(facts.minutes),
    title,
    of: title ? ` of ${title}` : "",
    book: title ?? "the book",
    run: facts.run,
    sessions: facts.focus.count
  };
  const parts: EntryPart[] = [write(kind, LEADS[kind], base)];
  const aside = (asideKind: AsideKind, slots: Partial<Slots> = {}) => write(asideKind, ASIDES[asideKind], { ...base, ...slots });

  if (!facts.read) {
    if (facts.covered && !today) {
      parts.push(aside(facts.covered));
    }
    return { dateKey: facts.dateKey, kind, rest: true, parts, text: parts.map((part) => part.text).join(" ") };
  }

  // Something the reader did that day: one of them, a different kind on different days.
  const did: Array<() => EntryPart> = [];
  if (facts.people.length > 0) {
    did.push(() => aside("person", { name: pickOf(facts.people, "who").name }));
  }
  const quotable = facts.highlights.map((highlight) => ({ ...highlight, quote: quoteOf(highlight.text) })).filter((highlight) => highlight.quote);
  if (quotable.length > 0) {
    did.push(() => {
      const chosen = pickOf(quotable, "quote");
      return aside("highlight", { quote: chosen.quote, chapter: chosen.chapter });
    });
  }
  if (facts.words.length > 0) {
    did.push(() => aside("word", { word: pickOf(facts.words, "word") }));
  }
  if (did.length > 0) {
    parts.push(pickOf(did, "did")());
  }

  // Something about the day itself. A milestone or a record is always the one;
  // otherwise whichever the date picks of what is true.
  const about: Array<() => EntryPart> = [];
  if (facts.milestone) {
    parts.push(aside("milestone"));
  } else if (facts.record) {
    parts.push(aside("record"));
  } else {
    if (facts.late) {
      about.push(() => aside("late"));
    } else if (facts.early) {
      about.push(() => aside("early"));
    }
    if (facts.focus.clean > 0) {
      about.push(() => aside("clean"));
    } else if (facts.focus.count > 0) {
      about.push(() => aside("session"));
    }
    const marked = kind === "finished" ? undefined : facts.books.find((book) => book.percent !== null && book.percent > 0 && !book.finished);
    if (marked) {
      about.push(() => aside("percent", { percent: marked.percent as number, book: marked.title }));
    }
    // Her own line about a book she knows, now and then, and never the one she wrote yesterday.
    const nod = facts.books.find((book) => book.nod)?.nod;
    if (nod && hash(`${facts.dateKey}/nod`) % 3 === 0 && !avoid.has(`nod:${nod}`)) {
      about.push(() => ({ id: `nod:${nod}`, kind: "nod", text: ASIDES.nod[0]({ ...base, nod }) }));
    }
    if (facts.run >= 2) {
      about.push(() => aside("streak"));
    } else if (facts.goalMet) {
      about.push(() => aside("goal"));
    }
    if (about.length > 0) {
      parts.push(pickOf(about, "about")());
    }
  }

  return { dateKey: facts.dateKey, kind, rest: false, parts, text: parts.map((part) => part.text).join(" ") };
};

/**
 * The whole diary, oldest day first: an entry for every day from the first
 * day read to today. There is no entry for a day before anything was read.
 *
 * Each entry keeps off the lines of the day before it and of the last day
 * read before it, so turning back through the days read never meets the same
 * line twice in a row either.
 */
export const diaryEntries = (facts: DiaryFacts, todayKey: string): DiaryEntry[] => {
  const entries: DiaryEntry[] = [];
  let lastRead: DiaryEntry | null = null;
  for (const day of facts.days) {
    const before = entries[entries.length - 1];
    const avoid = new Set<string>();
    for (const entry of [before, lastRead]) {
      entry?.parts.forEach((part) => avoid.add(part.id));
    }
    const entry = entryFor(day, { today: day.dateKey === todayKey, avoid });
    entries.push(entry);
    if (!entry.rest) {
      lastRead = entry;
    }
  }
  return entries;
};
