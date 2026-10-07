/**
 * A Kindle's "My Clippings.txt", read: every highlight and note the Kindle
 * kept, under the book it was made in.
 *
 * The file is a list of entries, each closed by a line of equals signs:
 *
 *     The Salt Road (Maren Voss)
 *     - Your Highlight on page 12 | Location 123-125 | Added on Monday, March 4, 2024 10:15:32 PM
 *
 *     The words that were highlighted.
 *     ==========
 *
 * The Kindle only ever adds to it. A highlight made longer or shorter is
 * written again in full, and the old one stays; a note is an entry of its
 * own, at a location inside the highlight it was written on. Read here, an
 * edited highlight is the last one written, and a note is with its highlight.
 *
 * Only the English wording of the second line is understood. An entry in
 * another language is kept, as a highlight with no place and no date, when it
 * has words: better in the list without a place than not brought over.
 *
 * A Kindle "location" is not a place in the book's file (it counts the
 * Kindle's own edition, about 128 bytes a step), so a highlight brought from
 * one has no place the reader can draw or go to. Its place is kept as
 * `kindle:<location>`, in the same field a CFI or a PDF's `pdf:...` is in
 * (readers/pdfHighlights.ts): enough to list them in the order they are in
 * the book.
 *
 * Pure: text in, entries out. Matching them to the library's books is
 * kindleImport.ts.
 */

export type KindleClipping = {
  /** The highlighted words. Empty for a note written where nothing was highlighted. */
  text: string;
  /** The reader's own note, when there is one. */
  note: string | null;
  /** The Kindle location it starts at and ends at; null when the entry does not say. */
  location: number | null;
  locationEnd: number | null;
  /** The page, as the Kindle wrote it ("12", "xiv"); null when it does not say. */
  page: string | null;
  /** When it was made, by the Kindle's own clock: "2024-03-04T22:15:32", with no zone. */
  addedAt: string | null;
};

export type KindleBook = {
  /** As the Kindle names it. */
  title: string;
  author: string | null;
  /** In the order the file has them. */
  clippings: KindleClipping[];
};

// ---- a place ------------------------------------------------------------------------

const PREFIX = "kindle:";
/** Before a hash of the words, so one made only of digits is not read as a location. */
const HASHED = "h";

/**
 * A small, fixed hash of some words, as sixteen hex digits (cyrb53's two
 * halves). The same on every device, which is what lets a clipping be known
 * again the next time its file is imported.
 */
export const textHash = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return `${hex(h2)}${hex(h1)}`;
};

/** Whether a stored place is a Kindle's: one the reader lists, and neither draws nor goes to. */
export const isKindlePlace = (stored: string | null | undefined): stored is string => typeof stored === "string" && stored.startsWith(PREFIX);

/** What the small "Kindle" tag on such a highlight says when it is pointed at. */
export const KINDLE_TAG_ABOUT = "Brought from a Kindle. Where it is in this book is not known.";

/** A clipping's place as it is stored: its location, or a short hash of its words where the Kindle gave none. */
export const kindlePlace = (clipping: Pick<KindleClipping, "location" | "text" | "note">): string =>
  clipping.location !== null
    ? `${PREFIX}${clipping.location}`
    : `${PREFIX}${HASHED}${textHash(clipping.text || clipping.note || "").slice(0, 8)}`;

/** The location of a stored Kindle place; null when it has none (or is not one). */
export const kindleLocation = (stored: string | null | undefined): number | null => {
  if (!isKindlePlace(stored)) {
    return null;
  }
  const rest = stored.slice(PREFIX.length);
  return /^\d{1,9}$/.test(rest) ? Number(rest) : null;
};

/**
 * Which of two Kindle places comes first in the book: by location. One with
 * no location comes after every one that has; two of those are left as they
 * are (0), for the caller to settle.
 */
export const compareKindlePlaces = (a: string, b: string): number => {
  const first = kindleLocation(a);
  const second = kindleLocation(b);
  if (first === null || second === null) {
    return first === second ? 0 : first === null ? 1 : -1;
  }
  return first - second;
};

// ---- reading the file ---------------------------------------------------------------

/** The line between entries. The Kindle writes ten equals signs. */
const SEPARATOR = /^={6,}\s*$/;
/** What the Kindle puts in place of the words once a book's publisher's limit is reached. */
const LIMIT_NOTICE = /<\s*You have reached the clipping limit for this item\s*>/i;
/** The Kindle starts the file, and often every title, with a byte-order mark. */
const BOM = /﻿/g;

/**
 * "Title (Author)", taken apart. The title may have brackets of its own
 * ("Emberfall (The Tide Cycle Book 2) (Maren Voss)"): the author is the last
 * group, counted back from the end so one bracket inside another stays whole.
 */
export const splitTitleLine = (line: string): { title: string; author: string | null } => {
  const text = line.replace(BOM, "").trim();
  if (text.endsWith(")")) {
    let depth = 0;
    for (let at = text.length - 1; at >= 0; at -= 1) {
      if (text[at] === ")") {
        depth += 1;
      } else if (text[at] === "(") {
        depth -= 1;
        if (depth === 0) {
          const title = text.slice(0, at).trim();
          const author = text.slice(at + 1, -1).trim();
          if (title && author) {
            return { title, author };
          }
          break;
        }
      }
    }
  }
  return { title: text, author: null };
};

type Kind = "highlight" | "note" | "bookmark";

/** "- Your Highlight on ...", and an older Kindle's "- Highlight Loc. ...". */
const KIND = /^-\s*(?:Your\s+)?(Highlight|Note|Bookmark)\b/i;
const PAGE = /\bpage\s+(\d+|[ivxlcdm]+)\b/i;
const LOCATION = /\b(?:location|loc\.?)\s+(\d{1,9})(?:\s*-\s*(\d{1,9}))?/i;
const ADDED = /\bAdded on\s+(.+)$/i;
/** "March 4, 2024 10:15:32 PM", "4 March 2024 22:15:32", "March 04, 2012, 10:15 PM". */
const DATE = /(?:([a-z]+)\.?\s+(\d{1,2})|(\d{1,2})\s+([a-z]+)\.?),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?m\b)?/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const two = (value: number) => String(value).padStart(2, "0");

/** The Kindle's date, as a time with no zone (it is the Kindle's own clock); null when it cannot be read. */
export const parseAdded = (text: string): string | null => {
  const found = DATE.exec(text);
  if (!found) {
    return null;
  }
  const name = (found[1] ?? found[4]).toLowerCase();
  const month = name.length >= 3 ? MONTHS.findIndex((candidate) => candidate.startsWith(name)) : -1;
  const day = Number(found[2] ?? found[3]);
  const year = Number(found[5]);
  let hour = Number(found[6]);
  const minute = Number(found[7]);
  const second = Number(found[8] ?? 0);
  const half = found[9]?.toLowerCase();
  if (half) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = (hour % 12) + (half === "p" ? 12 : 0);
  }
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return `${year}-${two(month + 1)}-${two(day)}T${two(hour)}:${two(minute)}:${two(second)}`;
};

type Entry = {
  kind: Kind;
  body: string;
  /** The body as it is compared: whatever the spaces and line breaks between its words. */
  words: string;
  location: number | null;
  locationEnd: number | null;
  page: string | null;
  addedAt: string | null;
};

/**
 * The second line of an entry. Anything not in English is a highlight with no
 * place and no date (a bookmark in any language has no words, and goes with
 * the other empty entries).
 */
const readHeading = (line: string): Omit<Entry, "body" | "words"> => {
  const kind = KIND.exec(line.trim());
  if (!kind) {
    return { kind: "highlight", location: null, locationEnd: null, page: null, addedAt: null };
  }
  const location = LOCATION.exec(line);
  const start = location ? Number(location[1]) : null;
  let end = location?.[2] ? Number(location[2]) : start;
  // An older Kindle writes "Loc. 1234-36" for 1234 to 1236.
  if (location?.[2] && start !== null && end !== null && end < start && location[2].length < location[1].length) {
    end = Number(`${location[1].slice(0, location[1].length - location[2].length)}${location[2]}`);
  }
  const added = ADDED.exec(line);
  return {
    kind: kind[1].toLowerCase() as Kind,
    location: start,
    locationEnd: end !== null && start !== null && end >= start ? end : start,
    page: PAGE.exec(line)?.[1] ?? null,
    addedAt: added ? parseAdded(added[1]) : null
  };
};

/** Words as they are compared: whatever the spaces and line breaks between them. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** Where an entry ends: its last location, or the only one it has. */
const endOf = (entry: Entry) => entry.locationEnd ?? entry.location ?? 0;

/**
 * One highlight is another, edited: at the same passage (their locations
 * overlap), and the words of one are inside the other's. (Two highlights in
 * one paragraph start at the same location too, and are two highlights:
 * neither's words hold the other's.) Where the Kindle gave no location, only
 * the very same words are the same highlight.
 */
const sameHighlight = (earlier: Entry, later: Entry) => {
  if (earlier.location === null || later.location === null) {
    return earlier.location === later.location && earlier.words === later.words;
  }
  return (
    earlier.location <= endOf(later) &&
    later.location <= endOf(earlier) &&
    (earlier.words.includes(later.words) || later.words.includes(earlier.words))
  );
};

/** A note written again (the Kindle repeats an edited note as it does a highlight): at the same location, or the same words where there is none. */
const sameNote = (earlier: Entry, later: Entry) =>
  earlier.location === null || later.location === null
    ? earlier.location === later.location && earlier.words === later.words
    : earlier.location === later.location;

/**
 * The highlight a note was written on: the one its location is inside. The
 * Kindle puts a note at its highlight's last location, so of two that hold it
 * the one ending there is meant; failing that the shorter, then the later.
 */
const highlightOf = (note: Entry, highlights: Entry[]): Entry | null => {
  if (note.location === null) {
    return null;
  }
  const at = note.location;
  let best: Entry | null = null;
  for (const item of highlights) {
    if (item.location === null || at < item.location || at > endOf(item)) {
      continue;
    }
    if (!best) {
      best = item;
      continue;
    }
    const endsHere = endOf(item) === at;
    if (endsHere !== (endOf(best) === at)) {
      best = endsHere ? item : best;
    } else if (endOf(item) - item.location <= endOf(best) - (best.location ?? 0)) {
      best = item;
    }
  }
  return best;
};

/** One book's entries, as its clippings: edits settled, notes with their highlights. */
const settle = (entries: Entry[]): KindleClipping[] => {
  /** In the order of the file; an entry written again takes the later place. */
  let kept: Entry[] = [];
  for (const entry of entries) {
    const same = entry.kind === "note" ? sameNote : sameHighlight;
    kept = kept.filter((earlier) => earlier.kind !== entry.kind || !same(earlier, entry));
    kept.push(entry);
  }
  const highlights = kept.filter((entry) => entry.kind === "highlight");
  const notes = new Map<Entry, string[]>();
  const alone = new Set<Entry>();
  for (const entry of kept) {
    if (entry.kind !== "note") {
      continue;
    }
    const on = highlightOf(entry, highlights);
    if (on) {
      notes.set(on, [...(notes.get(on) ?? []), entry.body]);
    } else {
      alone.add(entry);
    }
  }
  const clippings: KindleClipping[] = [];
  for (const entry of kept) {
    const place = { location: entry.location, locationEnd: entry.locationEnd, page: entry.page, addedAt: entry.addedAt };
    if (entry.kind === "highlight") {
      clippings.push({ text: entry.body, note: notes.get(entry)?.join("\n\n") ?? null, ...place });
    } else if (alone.has(entry)) {
      // A note where nothing was highlighted is still the reader's own words: kept, with no passage.
      clippings.push({ text: "", note: entry.body, ...place });
    }
  }
  return clippings;
};

/**
 * The file, as books and their clippings. Bookmarks, entries with no words
 * and entries the Kindle refused to copy (the publisher's clipping limit) are
 * left out; a book with nothing left is too.
 */
export const parseClippings = (file: string): KindleBook[] => {
  const books = new Map<string, { title: string; author: string | null; entries: Entry[] }>();
  let lines: string[] = [];
  const close = () => {
    const entry = lines;
    lines = [];
    // The title, the heading, and words: anything shorter is no entry.
    const first = entry.findIndex((line) => line.trim() !== "");
    if (first < 0 || entry.length - first < 3) {
      return;
    }
    const titleLine = entry[first].trim();
    const heading = readHeading(entry[first + 1]);
    const body = entry
      .slice(first + 2)
      .join("\n")
      .trim();
    if (heading.kind === "bookmark" || !body || LIMIT_NOTICE.test(body)) {
      return;
    }
    const book = books.get(titleLine) ?? { ...splitTitleLine(titleLine), entries: [] };
    book.entries.push({ ...heading, body, words: flat(body) });
    books.set(titleLine, book);
  };
  for (const raw of file.split(/\r\n|\r|\n/)) {
    const line = raw.replace(BOM, "");
    if (SEPARATOR.test(line)) {
      close();
    } else {
      lines.push(line);
    }
  }
  // The last entry of a file cut short has no line after it.
  close();

  const read: KindleBook[] = [];
  for (const { title, author, entries } of books.values()) {
    const clippings = settle(entries);
    if (title && clippings.length > 0) {
      read.push({ title, author, clippings });
    }
  }
  return read;
};
