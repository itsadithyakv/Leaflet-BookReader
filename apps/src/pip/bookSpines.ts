/**
 * Her shelf is your shelf. Every book the reader has finished is a spine in
 * Pip's bookcase, in the colour of its cover, and the book she holds when she
 * reads is the reader's current one. The rules, pure (bookSpines.test.ts):
 * which books are finished and in what order, the one colour a cover comes
 * down to, how a bookcase of four shelves holds none, seven, forty or four
 * hundred of them, and where the ribbon sits in the book in her hands.
 *
 * Nothing new is stored about the reader: finished is the library's own rule
 * (constants/books.ts), the order is when each book's progress last moved,
 * and a colour can always be worked out again. Only that last is kept, on this device
 * (`leaflet.pip.spines`), because working it out means reading a cover's
 * pixels.
 */
import type { Book } from "@shared/models/book";
import { isFinished } from "../constants/books";
import { hash } from "../components/shelf/spine";

type Shelved = Pick<Book, "id" | "title" | "progress" | "lastOpened" | "createdAt" | "progressUpdatedAt">;

/** A moment as a number, whatever way it was written down (with an offset or without); 0 for none. */
const moment = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

const openedAt = (book: Pick<Book, "lastOpened" | "createdAt">) => moment(book.lastOpened ?? book.createdAt);

/**
 * When a finished book was finished: when its progress last really moved
 * (`progressUpdatedAt`), which for a finished book is the day it was finished.
 * A book from before the library kept that has only when it was last open.
 */
export const finishedAt = (book: Pick<Book, "progressUpdatedAt" | "lastOpened" | "createdAt">) => moment(book.progressUpdatedAt) || openedAt(book);

/**
 * The books the reader has finished, the most recently finished first. A
 * finished book opened again to look something up keeps its place: opening
 * moves nothing.
 */
export const finishedBooks = <T extends Shelved>(books: readonly T[]): T[] =>
  books
    .filter((book) => isFinished(book.progress))
    .sort((a, b) => finishedAt(b) - finishedAt(a) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id));

/** The book the reader is in the middle of: the one last opened that is not finished. Null with none begun. */
export const currentBook = <T extends Shelved>(books: readonly T[]): T | null =>
  books
    .filter((book) => book.lastOpened && !isFinished(book.progress))
    .sort((a, b) => openedAt(b) - openedAt(a) || a.id.localeCompare(b.id))[0] ?? null;

// ---- a cover's colour ------------------------------------------------------------------
//
// The dominant colour, not the average: a navy cover with gold lettering is
// navy, where the mean of the two is mud. Pixels are sorted by hue (twelve
// sectors, each light or dark; greys by lightness), a vivid pixel counting
// for several pale ones so a white page with a red title is red, and the
// heaviest sort's own mean is the colour.

type Rgb = [number, number, number];

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const hueOf = (r: number, g: number, b: number, max: number, min: number) => {
  const span = max - min;
  if (span === 0) return 0;
  const hue = max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (hue * 60 + 360) % 360;
};

/** Below this chroma (0 to 1) a pixel is a grey: black ink, white paper, a photograph's shadows. */
const GREY = 0.12;

/**
 * The one colour of a cover, from its pixels (RGBA bytes, as a canvas gives
 * them); null when there is nothing opaque to go by.
 */
export const dominantColour = (pixels: ArrayLike<number>): string | null => {
  const sorts = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = (max - min) / 255;
    const light = (max + min) / 510;
    const key = chroma < GREY ? 100 + Math.min(3, Math.floor(light * 4)) : Math.floor(hueOf(r, g, b, max, min) / 30) * 2 + (light < 0.5 ? 0 : 1);
    const weight = 0.2 + chroma * 1.5;
    const sort = sorts.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    sort.weight += weight;
    sort.r += r * weight;
    sort.g += g * weight;
    sort.b += b * weight;
    sorts.set(key, sort);
  }
  let best: { weight: number; r: number; g: number; b: number } | null = null;
  for (const sort of sorts.values()) if (!best || sort.weight > best.weight) best = sort;
  return best ? toHex([best.r / best.weight, best.g / best.weight, best.b / best.weight]) : null;
};

/**
 * A colour a spine two pixels wide can be told by, on any wallpaper and after
 * dark: neither nearly black nor nearly white (its lightness brought within
 * `LIGHT`), its hue and richness as they were.
 */
const LIGHT = { min: 0.3, max: 0.72 };
export const legible = (hex: string): string => {
  const [r, g, b] = fromHex(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const target = Math.max(LIGHT.min, Math.min(LIGHT.max, light));
  if (target === light) return toHex([r * 255, g * 255, b * 255]);
  const span = max - min;
  // Its richness, less for a colour that had barely any (a black with a hint of red in it does not come out scarlet).
  const saturation = span === 0 ? 0 : (span / (1 - Math.abs(2 * light - 1))) * Math.min(1, span / 0.25);
  const hue = hueOf(r, g, b, max, min);
  // HSL back to RGB, at the new lightness.
  const c = (1 - Math.abs(2 * target - 1)) * Math.min(1, saturation);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = target - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
};

/** The house's own book colours (the Bookshelf's and the Book Tower's), for a book with no cover to go by. */
export const SPINE_PALETTE = ["#C8453B", "#2F80E6", "#FFB400", "#1FA36A", "#8E5CFF", "#E07A3A", "#35A6A0", "#B0203A", "#5B7FD6", "#D9774A", "#3FA35E", "#C89BFF"];

/** A book's colour from its id alone: always the same one, and always one that reads. */
export const fallbackColour = (bookId: string) => SPINE_PALETTE[hash(bookId) % SPINE_PALETTE.length];

/** A spine's height in the bookcase, 6 to 8 pixels: from the id, so a shelf is not a row of fence posts. */
export const spineTall = (bookId: string) => 6 + (hash(`tall:${bookId}`) % 3);

// ---- the colours kept on this device -------------------------------------------------------
//
// `{ bookId: [colour, cover] }`: the colour a cover came down to, and which
// cover that was (a book given a new cover is read again). Read tolerantly;
// a book that has left the library is dropped the next time anything is kept.

export const SPINE_STORE = "leaflet.pip.spines";

export type KeptSpines = Record<string, [colour: string, cover: string]>;

const HEX = /^#[0-9a-f]{6}$/i;

export const parseSpines = (text: string | null | undefined): KeptSpines => {
  if (!text) return {};
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: KeptSpines = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value) && typeof value[0] === "string" && HEX.test(value[0]) && typeof value[1] === "string") out[id] = [value[0], value[1]];
    }
    return out;
  } catch {
    return {};
  }
};

/** What names a book's cover, for telling a new one from the one already read. Short, whatever the cover's address is. */
export const coverKey = (book: Pick<Book, "coverUrl">) => (book.coverUrl ? hash(book.coverUrl).toString(36) : "");

/** The kept colours with one book's set, and only the library's own books in them. */
export const withSpine = (all: KeptSpines, book: Pick<Book, "id" | "coverUrl">, colour: string, library: ReadonlySet<string>): KeptSpines => {
  const next: KeptSpines = {};
  for (const [id, value] of Object.entries(all)) if (library.has(id)) next[id] = value;
  next[book.id] = [legible(colour), coverKey(book)];
  return next;
};

/** The colour kept for this book's cover as it is now, or null: not read yet, or the cover has changed. */
export const keptColour = (all: KeptSpines, book: Pick<Book, "id" | "coverUrl">): string | null => {
  const kept = all[book.id];
  return kept && book.coverUrl && kept[1] === coverKey(book) ? kept[0] : null;
};

/** A book's spine: its cover's colour once that is known, its own fallback until then (and for good, with no cover). */
export const spineColour = (all: KeptSpines, book: Pick<Book, "id" | "coverUrl">) => keptColour(all, book) ?? fallbackColour(book.id);

// ---- the bookcase ------------------------------------------------------------------------
//
// Four shelves. Books stand in rows, eleven to a shelf, the most recently
// finished first (top shelf, left to right). When they no longer fit, the
// lowest shelves are given over to stacks (three to a shelf, eight books
// lying flat in each), the oldest books in them; and past what three shelves
// of stacks and one of spines hold, the newest are shown and a tag on top of
// the case says how many there are in all.

export const SHELVES = 4;
export const ROW_BOOKS = 11;
export const STACKS = 3;
export const STACK_BOOKS = 8;
/** The top shelf is always spines: her latest reads, each to be told apart. */
const MAX_STACKED = SHELVES - 1;

const holds = (stacked: number) => (SHELVES - stacked) * ROW_BOOKS + stacked * STACKS * STACK_BOOKS;

/** One shelf: books standing (their places in the finished order), or stacks of them lying flat. */
export type Shelf = { standing: number[] } | { stacks: number[][] };

export type ShelfPlan = {
  /** Top shelf first. */
  shelves: Shelf[];
  /** How many of the books are on the shelves. */
  shown: number;
  /** The number on the tag: all of them, when they are not all shown; else null. */
  count: number | null;
};

/** How `n` finished books stand in the bookcase. */
export const shelfPlan = (n: number): ShelfPlan => {
  const total = Math.max(0, Math.floor(n));
  let stacked = 0;
  while (stacked < MAX_STACKED && holds(stacked) < total) stacked += 1;
  const shown = Math.min(total, holds(stacked));
  const shelves: Shelf[] = [];
  let next = 0;
  for (let shelf = 0; shelf < SHELVES; shelf += 1) {
    if (shelf < SHELVES - stacked) {
      const standing: number[] = [];
      while (standing.length < ROW_BOOKS && next < shown) standing.push(next++);
      shelves.push({ standing });
    } else {
      const stacks: number[][] = [];
      for (let stack = 0; stack < STACKS && next < shown; stack += 1) {
        const pile: number[] = [];
        while (pile.length < STACK_BOOKS && next < shown) pile.push(next++);
        stacks.push(pile);
      }
      shelves.push({ stacks });
    }
  }
  return { shelves, shown, count: total > shown ? total : null };
};

/** The bookcase as its art draws it (house.js, "bookcase"): each shelf's books by colour (and height, standing), and the tag. */
export type BookcaseArt = { shelves: Array<{ standing: Array<[colour: string, tall: number]> } | { stacks: string[][] }>; count: number | null };

export const bookcaseArt = (finished: ReadonlyArray<Pick<Book, "id" | "coverUrl">>, kept: KeptSpines): BookcaseArt => {
  const plan = shelfPlan(finished.length);
  const colour = (index: number) => spineColour(kept, finished[index]);
  return {
    shelves: plan.shelves.map((shelf) =>
      "standing" in shelf ? { standing: shelf.standing.map((index): [string, number] => [colour(index), spineTall(finished[index].id)]) } : { stacks: shelf.stacks.map((pile) => pile.map(colour)) }
    ),
    count: plan.count
  };
};

/** How many of the finished books are drawn, and so whose covers are worth reading. */
export const shownBooks = (n: number) => shelfPlan(n).shown;

/** What the bookcase says of itself, for its label. */
export const shelfWords = (n: number) => (n === 0 ? "no finished books yet" : n === 1 ? "1 finished book" : `${n} finished books`);

// ---- the book in her hands -------------------------------------------------------------------

/** The places a ribbon can sit along the foot of the open book (pip/furnish-art.js draws it eight pixels of page wide). */
export const RIBBON_STEPS = 8;

/** Where the ribbon sits for this much of the book read: 0 (the first page) to `RIBBON_STEPS - 1` (the last). */
export const ribbonStep = (progress: number | null | undefined) => Math.max(0, Math.min(RIBBON_STEPS - 1, Math.floor((Number.isFinite(progress) ? (progress as number) : 0) * RIBBON_STEPS)));

/** A short name for a thing's data: the room's picture is drawn again only when this changes. */
export const revOf = (data: unknown) => hash(JSON.stringify(data) ?? "").toString(36);
