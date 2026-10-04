/**
 * Character entries as the database keeps them: rows of the annotations
 * table, under kinds of their own (see `commands/people.rs` for why).
 *
 * A row's `cfi` and `chapter` are the place, `note` holds the reader's own
 * words (a name, a note, a label), `color` a group's colour, and `text` a
 * small JSON object with the rest. This file is the only one that knows that
 * shape; everything else works with `Entry`.
 */
import { LINK_TYPES, type Entry, type LinkType, type Stamp } from "./model";

export type PeopleRow = {
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

/** What is sent to be saved: the timestamps are set where it is saved. */
export type PeopleRowInput = Omit<PeopleRow, "createdAt" | "updatedAt" | "deletedAt"> & { text: string };

type Draft<E> = E extends Entry ? Omit<E, "createdAt" | "updatedAt" | "deletedAt"> : never;
/** An entry on its way to being saved. */
export type EntryDraft = Draft<Entry>;

const KINDS: Record<Entry["kind"], string> = {
  person: "person",
  alias: "person.alias",
  note: "person.note",
  member: "person.member",
  link: "person.link",
  group: "person.group"
};
const KIND_OF = new Map(Object.entries(KINDS).map(([kind, row]) => [row, kind as Entry["kind"]]));

/** Whether a row is a character entry at all (and not a highlight or a bookmark). */
export const isPeopleRow = (row: { kind: string }) => KIND_OF.has(row.kind);

const fraction = (value: unknown) =>
  // A place that cannot be read is the end of the book: hidden until then.
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
const words = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
/** Six decimals place a word in the longest book, and keep the row short. */
const short = (p: number) => Math.round(fraction(p) * 1e6) / 1e6;

export const toRow = (entry: EntryDraft): PeopleRowInput => {
  const detail: Record<string, unknown> = { p: short(entry.at.p) };
  let note: string | null = null;
  let color: string | null = null;
  if (entry.from) {
    detail.from = entry.from;
  }
  switch (entry.kind) {
    case "person":
      note = entry.name;
      if (entry.exact) {
        detail.x = 1;
      }
      break;
    case "alias":
      detail.who = entry.person;
      note = entry.text;
      if (entry.main) {
        detail.main = 1;
      }
      if (entry.exact) {
        detail.x = 1;
      }
      break;
    case "note":
      detail.who = entry.person;
      note = entry.text;
      break;
    case "member":
      detail.who = entry.person;
      note = entry.group;
      break;
    case "link":
      detail.who = entry.person;
      detail.to = entry.to;
      detail.type = entry.type;
      note = entry.label;
      if (entry.ended) {
        detail.end = { p: short(entry.ended.p), cfi: entry.ended.cfi, chapter: entry.ended.chapter };
      }
      break;
    case "group":
      note = entry.name;
      color = entry.color;
      break;
  }
  return {
    id: entry.id,
    bookId: entry.bookId,
    kind: KINDS[entry.kind],
    cfi: entry.at.cfi,
    chapter: entry.at.chapter,
    text: JSON.stringify(detail),
    note,
    color
  };
};

/**
 * The entry a row holds, or null for one that cannot be read (another kind of
 * annotation, a shape from a later version, a row cut short): it is left out
 * rather than guessed at.
 */
export const fromRow = (row: PeopleRow): Entry | null => {
  const kind = KIND_OF.get(row.kind);
  if (!kind || !row.id || !row.bookId) {
    return null;
  }
  let detail: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.text ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    detail = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const at: Stamp = { p: fraction(detail.p), cfi: words(row.cfi), chapter: words(row.chapter) };
  const base = {
    id: row.id,
    bookId: row.bookId,
    at,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
    from: words(detail.from)
  };
  const text = words(row.note);
  const who = words(detail.who);
  switch (kind) {
    case "person":
      return text ? { ...base, kind, name: text, exact: detail.x === 1 } : null;
    case "alias":
      return who && text ? { ...base, kind, person: who, text, main: detail.main === 1, exact: detail.x === 1 } : null;
    case "note":
      return who && text ? { ...base, kind, person: who, text } : null;
    case "member":
      return who ? { ...base, kind, person: who, group: text } : null;
    case "link": {
      const to = words(detail.to);
      if (!who || !to) {
        return null;
      }
      const type = (LINK_TYPES as readonly string[]).includes(detail.type as string) ? (detail.type as LinkType) : "other";
      const end = detail.end && typeof detail.end === "object" ? (detail.end as Record<string, unknown>) : null;
      return {
        ...base,
        kind,
        person: who,
        to,
        type,
        label: text,
        ended: end ? { p: fraction(end.p), cfi: words(end.cfi), chapter: words(end.chapter) } : null
      };
    }
    case "group":
      return text ? { ...base, kind, name: text, color: words(row.color) ?? "" } : null;
  }
};

/** The entries in a list of rows, unreadable ones left out. */
export const entriesOf = (rows: PeopleRow[]): Entry[] =>
  rows.map(fromRow).filter((entry): entry is Entry => entry !== null);
