/**
 * A year of reading, in the figures Leaflet already keeps: the day ledger
 * (minutes a day), the focus sessions, the books and how far each was read,
 * the reader's highlights, looked-up words and study cards, and the Hollow's
 * camp. Nothing new is recorded for it and nothing leaves the device: it is a
 * sum.
 *
 * Pure: records in, figures out. The story (`year/`) and its pictures say
 * these figures; nothing here knows how.
 */
import { finishedOn, hasFinished } from "../../constants/books";
import { chapterOf } from "../../pip/base/chapters";

type Day = { dateKey: string; minutes: number };
type Session = { startedAt: string; minutes: number; dateKey?: string; bookId?: string | null; title?: string | null };
type FreeRead = { dateKey: string; minutes: number; bookId?: string | null; title?: string | null };
type BookRead = {
  id: string;
  title: string;
  author: string | null;
  genres?: string[];
  progress: number;
  progressUpdatedAt?: string | null;
  finishedAt?: string | null;
  lastOpened: string | null;
};
/** A highlight as the database keeps it (bookmarks are left out). */
type Mark = { bookId: string; kind?: string; text?: string | null; note?: string | null; createdAt: string };
/** A looked-up word: how many times, and when first and last. */
type Word = { word: string; meaning?: string; count: number; createdAt: string; lookedUpAt?: string };
/** A study card's review: the box it is in, and when it last moved. */
type Card = { createdAt: string; updatedAt: string; box: number };
/** As much of the Hollow's camp as its year needs. */
type Camp = { minutes: number; camps: number; strongholds: { stars: number[] }; banners: string[] };

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

/**
 * The stretch of the year the story speaks of. A reader who has read with
 * Leaflet since before the year began has the whole year; one who began in
 * it has the months (or weeks) since their first day, so a reader who
 * started in September hears "your first 4 months", not a thin year. A gap
 * in the middle of the year (February, then nothing until September) is
 * still the year: only a late start shortens it.
 */
export type Span = {
  /** "year" for 10 months or more, or any reader who was here before the year began. */
  kind: "year" | "months" | "weeks";
  /** The first day counted, `YYYY-MM-DD`: 1 January, or the reader's first day when that was later. */
  from: string;
  /** The last: 31 December, or today when the year is not over. */
  to: string;
  days: number;
  /** Whole months, at least 1. */
  months: number;
  /** Whole weeks, at least 1. */
  weeks: number;
  /** Opened before 31 December of the year: it is the year so far. */
  soFar: boolean;
  /** The months the calendar and the bars show, 0 for January: from the first counted to the last. */
  firstMonth: number;
  lastMonth: number;
};

export type Highlight = { text: string; note: string | null; title: string; author: string | null };

/** Where the year's minutes went in the day, by focus session time. */
export type DayShare = { band: TimeOfDay; percent: number; bands: Record<TimeOfDay, number> };

export type Comparison = { count: number; says: string };

export type ReaderType = {
  id: string;
  name: string;
  /** A line under the name: what the reader is like, in Pip's warm way. */
  line: string;
  /** Pip, dressed for it: a skin, what she wears, and the move she makes. */
  skin: string;
  outfit: string[];
  move: string;
};

export type HollowYear = {
  /** The chapter the camp was in when the year began, and at its end (or today). */
  chapterFrom: number;
  chapterTo: number;
  /** Strongholds taken and their stars: the camp's own count (it keeps no dates), so given for the latest year only. */
  strongholds: number | null;
  stars: number | null;
  /** The Magpie King's banners won in the year's months. */
  banners: number;
};

export type YearReview = {
  year: number;
  minutes: number;
  daysRead: number;
  /** The most days read in a row, within the year. */
  longestRun: number;
  /** Where that run began, `YYYY-MM-DD`, when there is one of two days or more. */
  longestRunFrom: string | null;
  bestDay: Day | null;
  /** The year's days with reading in them, in order: the calendar's. */
  readDays: Day[];
  /** The first and last days read in the year. */
  firstDay: string | null;
  lastDay: string | null;
  span: Span;
  /** Minutes in each month, January first. */
  byMonth: number[];
  /** The month most was read in (0 for January); null in a year with no reading. */
  busiestMonth: number | null;
  /** Books finished in the year, the latest first. */
  finished: Array<{ id: string; title: string; author: string | null }>;
  /** Books read in at all. */
  booksRead: number;
  sessions: number;
  /** When in the day the focus sessions mostly were; null with too few to say. */
  timeOfDay: TimeOfDay | null;
  dayShare: DayShare | null;
  /** The author most books were read of, when it is more than one book. */
  topAuthor: string | null;
  /** Their books read in the year, by title, the latest first. */
  topAuthorBooks: string[];
  topGenre: string | null;
  /** The book come back to on the most days, when it is three or more. */
  mostReturned: { title: string; days: number } | null;
  highlights: number;
  /** The highlight of the year (one with a note first, otherwise the longest), and the others to swap it for. */
  highlight: Highlight | null;
  highlightChoices: Highlight[];
  words: number;
  /** The hardest word: the one looked up most, or (with none looked up twice) the longest. */
  hardestWord: { word: string; meaning: string; count: number } | null;
  /** Study cards made in the year, and those learnt (`LEARNT_BOX` or past). */
  cardsMade: number;
  cardsLearnt: number;
  hollow: HollowYear | null;
  /** Minutes a week over the span: a reader of 4 months is not averaged over 12. */
  perWeek: number;
  comparison: Comparison | null;
  readerType: ReaderType | null;
  /** Nothing was read: there is no review to show. */
  empty: boolean;
};

/**
 * A card counts as learnt once it rests a week or more between asks: the
 * review's fourth box, reached by being right three times running. "Known"
 * in the quiz (the last box) takes months, which a year of cards begun in
 * autumn could never show.
 */
export const LEARNT_BOX = 3;

const DAY_MS = 86_400_000;
/** A span of this many months or more is the year. */
const YEAR_MONTHS = 10;
/** Under this many days it is weeks. */
const WEEKS_UNDER = 28;
/** The highlights offered to swap for, at most. */
const CHOICES = 12;

const inYear = (iso: string | null | undefined, year: number) => {
  if (!iso) {
    return false;
  }
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === year;
};

const keyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateOf = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};
/** Days from one `YYYY-MM-DD` to another, counting both. Whole local days, whatever the clocks did. */
const daysBetween = (from: string, to: string) => Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS) + 1;

/** The day after a `YYYY-MM-DD`, as one. */
const nextDay = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return keyOf(new Date(year, month - 1, day + 1));
};

const most = (values: string[]): { value: string; count: number } | null => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) {
      best = { value, count };
    }
  }
  return best;
};

const hourBand = (hour: number): TimeOfDay => (hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night");

/** The years there is any reading in, the latest first. */
export const yearsRead = (days: Day[]): number[] => {
  const years = new Set<number>();
  for (const day of days) {
    const year = Number(day.dateKey.slice(0, 4));
    if (day.minutes > 0 && Number.isInteger(year)) {
      years.add(year);
    }
  }
  return [...years].sort((a, b) => b - a);
};

/**
 * The stretch of `year` the story speaks of (see `Span`). `firstUsed` is the
 * first day Leaflet knew of the reader, when it is earlier than their first
 * reading (a day in the ledger with nothing read); `today` is the device's.
 */
export const spanOf = (year: number, firstEver: string | null, today: Date): Span => {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const todayKey = keyOf(today);
  const soFar = today.getFullYear() === year && todayKey < end;
  const to = soFar ? todayKey : end;
  const lateStart = firstEver !== null && firstEver > start && firstEver <= to;
  const from = lateStart ? (firstEver as string) : start;
  const days = Math.max(1, daysBetween(from, to));
  const months = Math.max(1, Math.round(days / 30.44));
  const kind: Span["kind"] = !lateStart || months >= YEAR_MONTHS ? "year" : days < WEEKS_UNDER ? "weeks" : "months";
  return {
    kind,
    from,
    to,
    days,
    months,
    weeks: Math.max(1, Math.round(days / 7)),
    soFar,
    // The calendar shows the year's months from the first counted (all twelve for a whole year that is over).
    firstMonth: kind === "year" ? 0 : Number(from.slice(5, 7)) - 1,
    lastMonth: Number(to.slice(5, 7)) - 1
  };
};

/**
 * What a year's time was as long as: a few journeys and things everyone
 * knows the length of, each the usual time it takes. The longest the year
 * holds two of is said ("about as long as 3 flights from London to New
 * York"), rounded honestly: to the half under three, the whole above.
 */
const LENGTHS: Array<{ minutes: number; one: string; many: string }> = [
  // Apollo 11 took 75 h 50 min from launch to the Moon's orbit; the Rossiya runs Moscow to Vladivostok in about 6 days 22 hours.
  { minutes: 166 * 60, one: "ride on the Trans-Siberian, end to end", many: "rides on the Trans-Siberian, end to end" },
  { minutes: 76 * 60, one: "trip to the Moon, the way Apollo 11 went", many: "trips to the Moon, the way Apollo 11 went" },
  { minutes: 24 * 60, one: "whole day and night", many: "whole days and nights, round the clock" },
  { minutes: 8 * 60, one: "flight from London to New York", many: "flights from London to New York" },
  { minutes: 2 * 60, one: "film, start to credits", many: "films, back to back" },
  { minutes: 5, one: "pot of tea, brewed", many: "pots of tea, brewed and poured" }
];

export const timeComparison = (minutes: number): Comparison | null => {
  for (const length of LENGTHS) {
    const times = minutes / length.minutes;
    if (times >= 2) {
      const count = times < 3 ? Math.round(times * 2) / 2 : Math.round(times);
      return { count, says: `about as long as ${count.toLocaleString()} ${length.many}` };
    }
  }
  return null;
};

/**
 * Kinds of reader, named for the kind of book read most: Leaflet's own names,
 * each with Pip dressed for it from her own wardrobe. The genre listed first
 * speaks first; with no kind of book to go by, when the reading was done
 * does.
 */
const TYPES: Array<{ match: RegExp; type: ReaderType }> = [
  { match: /myster|detective|crime|whodun|noir|sleuth|polic/, type: { id: "detective", name: "The Night Detective", line: "No clue gets past you. Not one.", skin: "detective", outfit: ["magnifier"], move: "idea" } },
  { match: /horror|gothic|ghost|haunt|vampir|occult|macabre|supernatural/, type: { id: "candle", name: "The Candle-Keeper", line: "You read the dark ones, and you keep the light on.", skin: "nightowl", outfit: ["lantern"], move: "read" } },
  { match: /science[ -]fiction|sci[ -]?fi|space|cyberpunk|dystopi|time travel/, type: { id: "stars", name: "The Star-Reader", line: "Your books go further than any rocket.", skin: "astronaut", outfit: [], move: "pointup" } },
  { match: /fantas|fairy|myth|legend|dragon|wizard|magic|sword/, type: { id: "maps", name: "The Map-Maker", line: "Every book a country, and you've been to them all.", skin: "wizard", outfit: ["wand"], move: "magic" } },
  { match: /romance|love|romantic/, type: { id: "heart", name: "The Open Heart", line: "You believe in happy endings. You earned a few.", skin: "sakura", outfit: ["heartglasses"], move: "smitten" } },
  { match: /thrill|suspense|adventure|action|spy|war\b/, type: { id: "trail", name: "The Trailblazer", line: "One more chapter. Then one more.", skin: "cyclist", outfit: ["backpack"], move: "jog" } },
  { match: /histor|biograph|memoir|autobiograph/, type: { id: "time", name: "The Time-Walker", line: "Other people's lives, other centuries: you've walked through them.", skin: "classic", outfit: ["tophat", "monocle"], move: "read" } },
  { match: /poet|verse|classic|literary|literature|drama|plays/, type: { id: "scholar", name: "The Quiet Scholar", line: "You read the lines, and between them.", skin: "bookworm", outfit: ["roundglasses"], move: "read" } },
  { match: /science|philosoph|psycholog|econom|self|business|nonfiction|non-fiction|essay|politic|health/, type: { id: "curious", name: "The Curious Mind", line: "Every answer brought you a better question.", skin: "scientist", outfit: [], move: "idea" } },
  { match: /comic|graphic|manga/, type: { id: "panels", name: "The Panel-Hopper", line: "Pictures, words, and the gutter between.", skin: "skater", outfit: ["shades"], move: "kickflip" } },
  { match: /child|juvenile|young adult|\bya\b|picture book/, type: { id: "dreamer", name: "The Daydreamer", line: "You never stopped reading like a kid. Good.", skin: "sprout", outfit: ["balloon"], move: "floatnap" } }
];
const BY_TIME: Record<TimeOfDay, ReaderType> = {
  morning: { id: "early", name: "The Early Riser", line: "A page with the first coffee, every time.", skin: "earlybird", outfit: ["coffee"], move: "coffee" },
  afternoon: { id: "wanderer", name: "The Wanderer", line: "A chapter wherever the afternoon took you.", skin: "sprout", outfit: ["bookbag", "scarf"], move: "read" },
  evening: { id: "lamp", name: "The Lamplighter", line: "When the day was done, the book came out.", skin: "sprout", outfit: ["lantern"], move: "read" },
  night: { id: "owl", name: "The Midnight Owl", line: "The house asleep, and you, three chapters in.", skin: "nightowl", outfit: [], move: "read" }
};

export const readerTypeOf = (genre: string | null, timeOfDay: TimeOfDay | null): ReaderType | null => {
  const text = (genre ?? "").toLowerCase();
  if (text) {
    const found = TYPES.find((entry) => entry.match.test(text));
    if (found) {
      return found.type;
    }
  }
  return timeOfDay ? BY_TIME[timeOfDay] : null;
};

/** A highlight short enough to set well, and long enough to mean something. */
const settable = (text: string) => text.length >= 12 && text.length <= 420;

export const yearReview = (
  year: number,
  records: {
    days: Day[];
    sessions: Session[];
    books: BookRead[];
    freeReads?: FreeRead[];
    /** A count of highlights, when the highlights themselves are not given. */
    highlights?: number;
    marks?: Mark[];
    /** A count of words, when the words themselves are not given. */
    words?: number;
    wordList?: Word[];
    cards?: Card[];
    camp?: Camp | null;
    /** The device's today: what "so far" and the Hollow's latest year go by. */
    today?: Date;
  }
): YearReview => {
  const today = records.today ?? new Date();
  const prefix = `${year}-`;
  const read = records.days.filter((day) => day.minutes > 0);
  const days = read.filter((day) => day.dateKey.startsWith(prefix)).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const minutes = Math.round(days.reduce((sum, day) => sum + day.minutes, 0));

  let longestRun = 0;
  let longestRunFrom: string | null = null;
  let run = 0;
  let runFrom = "";
  let previous: string | null = null;
  let bestDay: Day | null = null;
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const day of days) {
    if (previous !== null && nextDay(previous) === day.dateKey) {
      run += 1;
    } else {
      run = 1;
      runFrom = day.dateKey;
    }
    if (run > longestRun) {
      longestRun = run;
      longestRunFrom = runFrom;
    }
    previous = day.dateKey;
    if (!bestDay || day.minutes > bestDay.minutes) {
      bestDay = day;
    }
    const month = Number(day.dateKey.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) {
      byMonth[month] += day.minutes;
    }
  }
  const top = Math.max(...byMonth);

  // The reader's first day with Leaflet: the ledger's first row of any kind (a day with a goal set and nothing
  // read yet counts), so a reader who began in March and read first in April has the months from March.
  const ledgerFirst = records.days.reduce<string | null>((first, day) => (first === null || day.dateKey < first ? day.dateKey : first), null);
  const span = spanOf(year, ledgerFirst, today);

  // A book counts for the year its reading last moved in; one only opened, the year it was opened.
  const touched = records.books.filter((book) => book.progress > 0 && inYear(book.progressUpdatedAt ?? book.lastOpened, year));
  // Finished in the year by its finished date, which a second reading in a
  // later year does not move (and which is the progress stamp for a book
  // finished before the date was kept).
  const finished = records.books
    .filter((book) => hasFinished(book) && inYear(finishedOn(book), year))
    .sort((a, b) => (finishedOn(b) ?? "").localeCompare(finishedOn(a) ?? ""))
    .map((book) => ({ id: book.id, title: book.title, author: book.author }));

  const sessions = records.sessions.filter((session) => inYear(session.startedAt, year) && session.minutes > 0);
  // By minutes, not by count: an hour in the evening outweighs two five-minute mornings.
  const bands: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const session of sessions) {
    bands[hourBand(new Date(session.startedAt).getHours())] += session.minutes;
  }
  const sessionMinutes = Object.values(bands).reduce((sum, value) => sum + value, 0);
  const ranked = (Object.entries(bands) as Array<[TimeOfDay, number]>).sort((a, b) => b[1] - a[1]);
  const timeOfDay = sessions.length >= 5 && sessionMinutes > 0 ? ranked[0][0] : null;
  const dayShare: DayShare | null =
    timeOfDay && sessionMinutes > 0
      ? {
          band: timeOfDay,
          percent: Math.round((bands[timeOfDay] / sessionMinutes) * 100),
          bands: Object.fromEntries((Object.keys(bands) as TimeOfDay[]).map((band) => [band, Math.round((bands[band] / sessionMinutes) * 100)])) as Record<TimeOfDay, number>
        }
      : null;

  const author = most(touched.map((book) => (book.author ?? "").trim()).filter(Boolean));
  const genre = most(touched.flatMap((book) => (book.genres ?? []).slice(0, 2)).filter(Boolean));
  const topGenre = genre && genre.count >= 2 ? genre.value : null;

  // The book come back to on the most days: a session or reading outside one, of that book, on a day.
  const titles = new Map(records.books.map((book) => [book.id, book.title]));
  const visits = new Map<string, Set<string>>();
  const named = new Map<string, string>();
  for (const entry of [
    ...sessions.map((session) => ({ bookId: session.bookId, title: session.title, dateKey: session.dateKey ?? keyOf(new Date(session.startedAt)) })),
    ...(records.freeReads ?? []).filter((free) => free.dateKey.startsWith(prefix) && free.minutes > 0)
  ]) {
    if (!entry.bookId) {
      continue;
    }
    const seen = visits.get(entry.bookId) ?? new Set<string>();
    seen.add(entry.dateKey);
    visits.set(entry.bookId, seen);
    const title = titles.get(entry.bookId) ?? entry.title;
    if (title) {
      named.set(entry.bookId, title);
    }
  }
  let mostReturned: YearReview["mostReturned"] = null;
  for (const [bookId, seen] of visits) {
    const title = named.get(bookId);
    if (title && seen.size >= 3 && (!mostReturned || seen.size > mostReturned.days)) {
      mostReturned = { title, days: seen.size };
    }
  }

  // The highlights: one with a note first (the reader said why), otherwise the longest that sets well.
  const books = new Map(records.books.map((book) => [book.id, book]));
  const marks = (records.marks ?? []).filter((mark) => (mark.kind ?? "highlight") === "highlight" && inYear(mark.createdAt, year));
  const choices = marks
    .map((mark) => ({ text: (mark.text ?? "").replace(/\s+/g, " ").trim(), note: (mark.note ?? "").trim() || null, bookId: mark.bookId }))
    .filter((mark) => mark.text.length > 0)
    .sort((a, b) => Number(Boolean(b.note)) - Number(Boolean(a.note)) || Number(settable(b.text)) - Number(settable(a.text)) || b.text.length - a.text.length)
    .slice(0, CHOICES)
    .map((mark): Highlight => ({ text: mark.text, note: mark.note, title: books.get(mark.bookId)?.title ?? "", author: books.get(mark.bookId)?.author ?? null }));

  const words = (records.wordList ?? []).filter((word) => inYear(word.createdAt, year) || inYear(word.lookedUpAt, year));
  const hardest =
    [...words].sort((a, b) => b.count - a.count || b.word.length - a.word.length || a.word.localeCompare(b.word))[0] ?? null;

  const cards = records.cards ?? [];
  const cardsMade = cards.filter((card) => inYear(card.createdAt, year)).length;
  const cardsLearnt = cards.filter((card) => card.box >= LEARNT_BOX && inYear(card.updatedAt, year)).length;

  let hollow: HollowYear | null = null;
  if (records.camp) {
    const camp = records.camp;
    // The camp's minutes are all the reading it has heard of: less what was read after the year, its end; less the year's, its start.
    const after = read.filter((day) => day.dateKey > `${year}-12-31`).reduce((sum, day) => sum + day.minutes, 0);
    const atEnd = Math.max(0, camp.minutes - after);
    const chapterTo = chapterOf(atEnd);
    const chapterFrom = chapterOf(Math.max(0, atEnd - minutes));
    // Strongholds keep no dates: their count is the camp's, which is the latest year's (the Lands began in 2026).
    const latest = year === today.getFullYear() || (year === today.getFullYear() - 1 && today.getMonth() === 0);
    const taken = latest && camp.camps > 0 ? camp.camps : null;
    const stars = taken ? camp.strongholds.stars.reduce((sum, value) => sum + (value > 0 ? value : 0), 0) : null;
    const banners = camp.banners.filter((month) => month.startsWith(prefix)).length;
    if (chapterTo > chapterFrom || taken || banners > 0) {
      hollow = { chapterFrom, chapterTo, strongholds: taken, stars: stars && stars > 0 ? stars : null, banners };
    }
  }

  return {
    year,
    minutes,
    daysRead: days.length,
    longestRun,
    longestRunFrom: longestRun >= 2 ? longestRunFrom : null,
    bestDay,
    readDays: days.map((day) => ({ dateKey: day.dateKey, minutes: day.minutes })),
    firstDay: days[0]?.dateKey ?? null,
    lastDay: days[days.length - 1]?.dateKey ?? null,
    span,
    byMonth: byMonth.map((value) => Math.round(value)),
    busiestMonth: top > 0 ? byMonth.indexOf(top) : null,
    finished,
    booksRead: touched.length,
    sessions: sessions.length,
    timeOfDay,
    dayShare,
    topAuthor: author && author.count >= 2 ? author.value : null,
    topAuthorBooks:
      author && author.count >= 2
        ? touched
            .filter((book) => (book.author ?? "").trim() === author.value)
            .sort((a, b) => (b.progressUpdatedAt ?? b.lastOpened ?? "").localeCompare(a.progressUpdatedAt ?? a.lastOpened ?? ""))
            .map((book) => book.title)
        : [],
    topGenre,
    mostReturned,
    highlights: records.marks ? marks.length : (records.highlights ?? 0),
    highlight: choices[0] ?? null,
    highlightChoices: choices,
    words: records.wordList ? words.length : (records.words ?? 0),
    hardestWord: hardest ? { word: hardest.word, meaning: hardest.meaning ?? "", count: hardest.count } : null,
    cardsMade,
    cardsLearnt,
    hollow,
    perWeek: Math.round(minutes / Math.max(1, span.days / 7)),
    comparison: timeComparison(minutes),
    readerType: readerTypeOf(topGenre, timeOfDay),
    empty: minutes === 0 && finished.length === 0
  };
};

/** "42 hours", "1 hour", "35 minutes": time read, as it is said. */
export const timeWords = (minutes: number) => {
  if (minutes < 90) {
    return `${Math.round(minutes)} ${Math.round(minutes) === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours.toLocaleString()} ${hours === 1 ? "hour" : "hours"}`;
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "14 March": a day of the year, without the year. */
export const dayWords = (dateKey: string) => {
  const [, month, day] = dateKey.split("-").map(Number);
  return month >= 1 && month <= 12 ? `${day} ${MONTHS[month - 1]}` : dateKey;
};

/**
 * How the story names the stretch it speaks of, everywhere it does: the
 * opening, the lines ("In just 4 months you read..."), the summary and every
 * picture's mark. A short span is a beginning, said proudly.
 */
export type Framing = {
  /** The opening's two big lines: "2026" / "in pages", "4 months" / "in pages". */
  big: [string, string];
  /** A small line over them: "Your year", "Your first", "Since 14 December". */
  eyebrow: string;
  /** Leading a sentence: "In 2026", "In just 4 months", "In just 3 weeks". */
  inSpan: string;
  /** The picture's mark: "2026 in pages", "4 months in pages · 2026". */
  mark: string;
  /** In words, for a screen reader and a title: "Your 2026 in pages". */
  title: string;
};

export const framing = (review: Pick<YearReview, "year" | "span">): Framing => {
  const { year, span } = review;
  const soFar = span.soFar ? " so far" : "";
  if (span.kind === "year") {
    return {
      big: [String(year), "in pages"],
      eyebrow: span.soFar ? "Your year so far" : "Your year",
      inSpan: span.soFar ? `So far in ${year}` : `In ${year}`,
      mark: `${year} in pages${span.soFar ? " · so far" : ""}`,
      title: `Your ${year} in pages${soFar}`
    };
  }
  if (span.kind === "months") {
    const months = `${span.months} ${span.months === 1 ? "month" : "months"}`;
    return {
      big: [months, "in pages"],
      eyebrow: "Your first",
      inSpan: `In just ${months}`,
      mark: `${months} in pages · ${year}`,
      title: `Your first ${months} in pages`
    };
  }
  const short = span.days < 7;
  const count = short ? `${span.days} ${span.days === 1 ? "day" : "days"}` : `${span.weeks} ${span.weeks === 1 ? "week" : "weeks"}`;
  return {
    big: [short ? "First days" : "First weeks", "in pages"],
    eyebrow: `Since ${dayWords(span.from)}`,
    inSpan: `In just ${count}`,
    mark: `${short ? "First days" : "First weeks"} in pages · ${year}`,
    title: `Your first ${short ? "days" : "weeks"} in pages`
  };
};
