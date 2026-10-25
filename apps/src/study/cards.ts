/**
 * Study cards as the database keeps them: rows of the annotations table under
 * a kind of their own, `card` (see `commands/cards.rs` for why, and for the
 * rules a row is written by). A row's `note` is a question card's question,
 * `cfi` and `chapter` the place, and `text` a small JSON object with the rest.
 * This file is the only one in the app that knows that shape; everything else
 * works with `StudyCard` (docs/design/study-plan.md).
 *
 * Pure: no storage, no clock.
 */
import { MAX_BOX } from "../readers/words/rows";
import { mergeRanges, type Range } from "./fillIn";

export const CARD_KIND = "card";
export const MAX_PASSAGE = 600;
export const MAX_QUESTION = 300;
export const MAX_LABEL = 120;
export const MAX_HIDDEN = 60;
/** Boxes on one picture (`commands/cards.rs`). */
export const MAX_GROUP = 40;
const MAX_DAY = 60_000;
const MAX_DETAIL = 3000;
/** A box's sides are kept in ten-thousandths of the picture. */
export const PARTS = 10_000;

export type CardRow = {
  id: string;
  bookId: string;
  kind: string;
  cfi?: string | null;
  text?: string | null;
  note?: string | null;
  color?: string | null;
  chapter?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

/** A part of a picture, in fractions of it (0..1). */
export type Rect = { left: number; top: number; width: number; height: number };

/** Where a picture is in its book: a path in an EPUB's archive, or a PDF's page. */
export type PictureRef = { kind: "epub"; path: string } | { kind: "pdf"; page: number };

type CardBase = {
  id: string;
  bookId: string;
  /** The place: a CFI, or a PDF's `pdf:12`; and the chapter there; and how far through the book. */
  at: { cfi: string | null; chapter: string | null; p: number };
  createdAt: string;
  updatedAt: string;
  /** The review: the box it is in (0 is the first) and the day it is next due; null until it has been asked. */
  box: number;
  due: number | null;
};

export type FillCard = CardBase & { kind: "fill"; highlightId: string | null; passage: string; hidden: Range[] };
export type AskCard = CardBase & { kind: "ask"; highlightId: string | null; question: string; answer: string };
export type PictureCard = CardBase & {
  kind: "pic";
  picture: PictureRef;
  /** The box covered in review. */
  mask: Rect;
  /** The part of a PDF's page shown; the whole picture when null. */
  crop: Rect | null;
  /** What is under the box, when the reader said. */
  label: string;
  /** The cards of one picture share this. */
  group: string;
};
export type StudyCard = FillCard | AskCard | PictureCard;
export type CardKind = StudyCard["kind"];

/** What is sent to make a card, or to edit one: everything but the dates and the review. */
export type CardInput = {
  id: string;
  bookId: string;
  cfi: string | null;
  chapter: string | null;
  question: string | null;
  detail: Record<string, unknown>;
};

/** A review's answer: the box a card moves to and the day it is next due. */
export type CardReview = { id: string; box: number; due: number };

export const isCardRow = (row: { kind: string }) => row.kind === CARD_KIND;

const tidy = (text: string | null | undefined) => (text ?? "").split(/\s+/).filter(Boolean).join(" ");
/** The first `max` characters (whole characters, not halves of one). */
export const clip = (text: string, max: number) => [...text].slice(0, max).join("");

const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

const detailOf = (row: CardRow): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(row.text ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** A rect as kept (ten-thousandths), read back; null when it is not one. */
export const rectFrom = (value: unknown): Rect | null => {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const parts = value.map((part) => whole(part, 0, PARTS));
  if (parts.some((part) => part === null)) {
    return null;
  }
  const [left, top, width, height] = parts as number[];
  if (width <= 0 || height <= 0 || left + width > PARTS || top + height > PARTS) {
    return null;
  }
  return { left: left / PARTS, top: top / PARTS, width: width / PARTS, height: height / PARTS };
};

/** A rect as it is kept: inside the picture, at least a part either way. */
export const rectTo = (rect: Rect): [number, number, number, number] => {
  const left = Math.min(PARTS - 1, Math.max(0, Math.round(rect.left * PARTS)));
  const top = Math.min(PARTS - 1, Math.max(0, Math.round(rect.top * PARTS)));
  const width = Math.min(PARTS - left, Math.max(1, Math.round(rect.width * PARTS)));
  const height = Math.min(PARTS - top, Math.max(1, Math.round(rect.height * PARTS)));
  return [left, top, width, height];
};

export const pictureFrom = (value: unknown): PictureRef | null => {
  if (typeof value !== "string") {
    return null;
  }
  if (value.startsWith("pdf:")) {
    const page = Number(value.slice(4));
    return Number.isInteger(page) && page >= 1 ? { kind: "pdf", page } : null;
  }
  if (value.startsWith("epub:") && value.length > 5) {
    return { kind: "epub", path: value.slice(5) };
  }
  return null;
};

export const pictureTo = (picture: PictureRef) => (picture.kind === "pdf" ? `pdf:${picture.page}` : `epub:${picture.path}`);

/** The hidden words of a passage as kept: in order, apart, inside it. */
const hiddenFrom = (value: unknown, passage: string): Range[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HIDDEN) {
    return null;
  }
  const ranges: Range[] = [];
  let after = 0;
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      return null;
    }
    const [start, end] = pair;
    if (whole(start, 0, passage.length) === null || whole(end, 0, passage.length) === null || start < after || start >= end) {
      return null;
    }
    after = end;
    ranges.push([start, end]);
  }
  return ranges;
};

/**
 * The card a row holds, or null for one that cannot be read (another kind
 * of annotation, a card of a kind a later version made): it is left out
 * rather than guessed at.
 */
export const fromRow = (row: CardRow): StudyCard | null => {
  if (!isCardRow(row) || !row.id || !row.bookId) {
    return null;
  }
  const detail = detailOf(row);
  if (!detail) {
    return null;
  }
  const p = typeof detail.p === "number" && Number.isFinite(detail.p) ? Math.min(1, Math.max(0, detail.p)) : 0;
  const base: CardBase = {
    id: row.id,
    bookId: row.bookId,
    at: { cfi: row.cfi?.trim() ? row.cfi : null, chapter: tidy(row.chapter) || null, p },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    box: whole(detail.b, 0, MAX_BOX) ?? 0,
    due: whole(detail.d, 0, MAX_DAY)
  };
  const from = typeof detail.h === "string" && detail.h ? detail.h : null;
  const passage = typeof detail.s === "string" ? detail.s : "";
  if (detail.t === "fill") {
    const hidden = passage.trim() ? hiddenFrom(detail.x, passage) : null;
    return hidden ? { ...base, kind: "fill", highlightId: from, passage, hidden } : null;
  }
  if (detail.t === "ask") {
    const question = tidy(row.note);
    return question && passage.trim() ? { ...base, kind: "ask", highlightId: from, question, answer: passage } : null;
  }
  if (detail.t === "pic") {
    const picture = pictureFrom(detail.i);
    const box = rectFrom(detail.m);
    const group = typeof detail.g === "string" && detail.g ? detail.g : null;
    if (!picture || !box || !group) {
      return null;
    }
    return {
      ...base,
      kind: "pic",
      picture,
      mask: box,
      crop: detail.r === undefined ? null : rectFrom(detail.r),
      label: typeof detail.a === "string" ? tidy(detail.a) : "",
      group
    };
  }
  return null;
};

/** The cards in a list of rows, removed and unreadable ones left out, the newest first. */
export const cardsOf = (rows: CardRow[]): StudyCard[] =>
  rows
    .filter((row) => !row.deletedAt)
    .map(fromRow)
    .filter((card): card is StudyCard => card !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

/** A new card's id: random, so two devices never make the same one. */
export const newCardId = () =>
  `card:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;

/** Where a card is made: the book and the place in it. */
export type CardPlace = { bookId: string; cfi: string | null; chapter: string | null; p: number };

const placeDetail = (place: CardPlace) => (place.p >= 0 && place.p <= 1 ? { p: Math.round(place.p * 1e6) / 1e6 } : {});

/** A fill-in card from a passage, the words at `hidden` covered. */
export const fillInput = (place: CardPlace, passage: string, hidden: Range[], highlightId: string | null, id = newCardId()): CardInput => ({
  id,
  bookId: place.bookId,
  cfi: place.cfi,
  chapter: place.chapter,
  question: null,
  detail: { t: "fill", s: passage, x: mergeRanges(hidden), ...(highlightId ? { h: highlightId } : {}), ...placeDetail(place) }
});

/** A question card: the reader's question, and the answer (the highlight, or its note). */
export const askInput = (place: CardPlace, question: string, answer: string, highlightId: string | null, id = newCardId()): CardInput => ({
  id,
  bookId: place.bookId,
  cfi: place.cfi,
  chapter: place.chapter,
  question: clip(tidy(question), MAX_QUESTION),
  detail: { t: "ask", s: clip(answer.trim(), MAX_PASSAGE), ...(highlightId ? { h: highlightId } : {}), ...placeDetail(place) }
});

/** One box of a picture: a card of its own, in the picture's group. */
export const pictureInput = (
  place: CardPlace,
  picture: PictureRef,
  box: Rect,
  label: string,
  group: string,
  crop: Rect | null,
  id = newCardId()
): CardInput => {
  const said = clip(tidy(label), MAX_LABEL);
  return {
    id,
    bookId: place.bookId,
    cfi: place.cfi,
    chapter: place.chapter,
    question: null,
    detail: { t: "pic", i: pictureTo(picture), m: rectTo(box), g: group, ...(crop ? { r: rectTo(crop) } : {}), ...(said ? { a: said } : {}), ...placeDetail(place) }
  };
};

/** The input that edits a card as it stands (to change one part of it). */
export const inputOf = (card: StudyCard): CardInput => {
  const place: CardPlace = { bookId: card.bookId, cfi: card.at.cfi, chapter: card.at.chapter, p: card.at.p };
  if (card.kind === "fill") return fillInput(place, card.passage, card.hidden, card.highlightId, card.id);
  if (card.kind === "ask") return askInput(place, card.question, card.answer, card.highlightId, card.id);
  return pictureInput(place, card.picture, card.mask, card.label, card.group, card.crop, card.id);
};

/**
 * The row a save leaves, by the rules of `commands/cards.rs` (the browser
 * preview, which has no backend, keeps its cards with this). The review's
 * box stays as it was. Throws for what is refused.
 */
export const saved = (existing: CardRow | null | undefined, input: CardInput, now: string): CardRow => {
  if (!input.id.startsWith("card:") || input.id.length <= 5) {
    throw new Error("A card needs an id of its own.");
  }
  if (!input.bookId.trim()) {
    throw new Error("A card is kept with the book it was made from.");
  }
  if (existing && !isCardRow(existing)) {
    throw new Error("That id belongs to something else.");
  }
  if (existing?.deletedAt) {
    throw new Error("That card was removed.");
  }
  const kept = existing ? detailOf(existing) ?? {} : {};
  for (const key of ["t", "h", "s", "x", "i", "m", "r", "a", "g", "p"]) {
    delete kept[key];
  }
  const detail = { ...kept, ...input.detail };
  const row: CardRow = {
    id: input.id,
    bookId: input.bookId,
    kind: CARD_KIND,
    cfi: input.cfi ?? "",
    text: JSON.stringify(detail),
    note: input.detail.t === "ask" ? tidy(input.question) || null : null,
    color: null,
    chapter: tidy(input.chapter).slice(0, 300) || null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null
  };
  if ((row.text ?? "").length > MAX_DETAIL || !fromRow(row)) {
    throw new Error("That card cannot be kept.");
  }
  return row;
};

/** A card's row after a review's answer: its box and its day, the rest as it was. Throws for what is refused. */
export const reviewed = (row: CardRow, review: CardReview, now: string): CardRow => {
  if (!isCardRow(row) || row.deletedAt) {
    throw new Error("That card is not kept.");
  }
  if (whole(review.box, 0, MAX_BOX) === null || whole(review.due, 0, MAX_DAY) === null) {
    throw new Error("That is not a box a card can be in.");
  }
  return { ...row, text: JSON.stringify({ ...(detailOf(row) ?? {}), b: review.box, d: review.due }), updatedAt: now };
};
