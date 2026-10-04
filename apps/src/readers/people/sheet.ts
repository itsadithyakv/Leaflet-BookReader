/**
 * A character sheet leaving a book and arriving in one: as a file (to give a
 * friend, or to keep), and from the book before it in a series.
 *
 * A sheet that arrives obeys the same rule as one written here: each entry
 * keeps the place it was stamped with, and shows only once the reader gets
 * there. So a friend's sheet can be used without being spoiled by it. From
 * another edition the exact places (CFIs) mean nothing, so they are left
 * behind and the fraction of the book decides.
 *
 * A series' earlier book is different: all of it has been read, so all of it
 * is known from the first page of the next.
 *
 * Pure: entries in, entries to save out.
 */
import { groupId, type Change } from "./edits";
import { castAt, LINK_TYPES, nameKey, placeOrder, type Entry, type LinkType, type Stamp } from "./model";
import type { EntryDraft } from "./rows";

export const SHEET_FORMAT = "leaflet-characters";
/** A sheet longer than this is not one a reader wrote. */
export const MAX_SHEET_ENTRIES = 5000;
const MAX_WORDS = 4000;

type Shed<E> = E extends Entry ? Omit<E, "bookId" | "createdAt" | "updatedAt" | "deletedAt" | "from"> : never;
/** An entry as a file holds it: without the book, the dates and where it was carried from. */
export type SheetEntry = Shed<Entry>;

export type SheetFile = {
  format: typeof SHEET_FORMAT;
  version: 1;
  /** The book it was written in. The file hash says whether its exact places can be trusted here. */
  book: { title: string; author: string | null; fileHash: string | null };
  exportedAt: string;
  entries: SheetEntry[];
};

const live = (entry: Entry) => !entry.deletedAt;
const KIND_ORDER: Entry["kind"][] = ["group", "person", "alias", "member", "note", "link"];

/** A book's sheet as a file: every entry, later ones too (they stay hidden where it arrives). */
export const exportSheet = (
  entries: Entry[],
  book: { title: string; author?: string | null; fileHash?: string | null },
  now: string
): SheetFile => ({
  format: SHEET_FORMAT,
  version: 1,
  book: { title: book.title, author: book.author ?? null, fileHash: book.fileHash ?? null },
  exportedAt: now,
  entries: entries
    .filter(live)
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.at.p - b.at.p ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
    )
    .map((entry) => {
      const { bookId: _book, createdAt: _created, updatedAt: _updated, deletedAt: _deleted, from: _from, ...rest } = entry;
      return rest as SheetEntry;
    })
});

const text = (value: unknown, max = MAX_WORDS) => (typeof value === "string" && value.trim() ? value.slice(0, max) : null);
const stampFrom = (value: unknown): Stamp | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  // A place that cannot be read is the end of the book: hidden until then.
  const p = typeof raw.p === "number" && Number.isFinite(raw.p) ? Math.min(1, Math.max(0, raw.p)) : 1;
  return { p, cfi: text(raw.cfi), chapter: text(raw.chapter, 300) };
};

const entryFrom = (value: unknown): SheetEntry | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 200);
  const at = stampFrom(raw.at);
  if (!id || !at) {
    return null;
  }
  const person = text(raw.person, 200);
  switch (raw.kind) {
    case "person": {
      const name = text(raw.name, 120);
      return name ? { id, at, kind: "person", name, exact: raw.exact === true } : null;
    }
    case "alias": {
      const words = text(raw.text, 120);
      return person && words ? { id, at, kind: "alias", person, text: words, main: raw.main === true, exact: raw.exact === true } : null;
    }
    case "note": {
      const words = text(raw.text);
      return person && words ? { id, at, kind: "note", person, text: words } : null;
    }
    case "member":
      return person ? { id, at, kind: "member", person, group: text(raw.group, 60) } : null;
    case "link": {
      const to = text(raw.to, 200);
      if (!person || !to) {
        return null;
      }
      const type = (LINK_TYPES as readonly string[]).includes(raw.type as string) ? (raw.type as LinkType) : "other";
      return { id, at, kind: "link", person, to, type, label: text(raw.label, 60), ended: stampFrom(raw.ended) };
    }
    case "group": {
      const name = text(raw.name, 60);
      return name ? { id, at, kind: "group", name, color: text(raw.color, 40) ?? "" } : null;
    }
    default:
      return null;
  }
};

/**
 * The sheet a file holds, or null when the file is not one. Entries that
 * cannot be read are left out; nothing in the file is trusted beyond its shape.
 */
export const readSheet = (contents: string): SheetFile | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const file = raw as Record<string, unknown>;
  if (file.format !== SHEET_FORMAT || !Array.isArray(file.entries)) {
    return null;
  }
  const book = (file.book && typeof file.book === "object" ? file.book : {}) as Record<string, unknown>;
  return {
    format: SHEET_FORMAT,
    version: 1,
    book: { title: text(book.title, 300) ?? "", author: text(book.author, 300), fileHash: text(book.fileHash, 200) },
    exportedAt: text(file.exportedAt, 60) ?? "",
    entries: file.entries
      .slice(0, MAX_SHEET_ENTRIES)
      .map(entryFrom)
      .filter((entry): entry is SheetEntry => entry !== null)
  };
};

export type Arrival = Change & {
  /** How much arrived: numbers for the reader, never names. */
  people: number;
  notes: number;
  links: number;
};

type Arriving = {
  bookId: string;
  newId: () => string;
  /** The stamp an arriving entry gets, from the one it had. */
  stamp: (at: Stamp) => Stamp;
  /** The book it was carried from, if it was. */
  from?: string | null;
};

const MUTUAL: readonly LinkType[] = ["spouse", "sibling", "kin", "friend", "enemy", "other"];
const linkKey = (link: { type: LinkType; person: string; to: string }) =>
  `${link.type}|${MUTUAL.includes(link.type) ? [link.person, link.to].sort().join(">") : `${link.person}>${link.to}`}`;

/**
 * Entries arriving on a sheet. Someone already there under the same name is
 * the same person, and nothing already said about them is said again, so
 * bringing a sheet in twice changes nothing the second time.
 */
const arrive = (incoming: SheetEntry[], existing: Entry[], arriving: Arriving): Arrival => {
  const save: EntryDraft[] = [];
  const base = (at: Stamp) => ({ id: arriving.newId(), bookId: arriving.bookId, at: arriving.stamp(at), from: arriving.from ?? null });
  const here = existing.filter(live);

  const byName = new Map<string, string>();
  const names = new Map<string, Set<string>>();
  const notes = new Map<string, Set<string>>();
  const groupsOf = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, person: string, value: string) => {
    const set = map.get(person) ?? new Set<string>();
    map.set(person, set);
    if (set.has(value)) {
      return false;
    }
    set.add(value);
    return true;
  };
  for (const entry of here) {
    if (entry.kind === "person") {
      byName.set(nameKey(entry.name), entry.id);
      add(names, entry.id, nameKey(entry.name));
    }
  }
  const said = new Set<string>();
  const colours = new Set<string>();
  for (const entry of here) {
    if (entry.kind === "alias") {
      add(names, entry.person, nameKey(entry.text));
    } else if (entry.kind === "note") {
      add(notes, entry.person, entry.text.trim());
    } else if (entry.kind === "member") {
      add(groupsOf, entry.person, nameKey(entry.group ?? ""));
    } else if (entry.kind === "link") {
      said.add(linkKey(entry));
    } else if (entry.kind === "group") {
      colours.add(nameKey(entry.name));
    }
  }

  const count = { people: 0, notes: 0, links: 0 };
  const who = new Map<string, string>();
  for (const entry of incoming) {
    if (entry.kind !== "person" || who.has(entry.id)) {
      continue;
    }
    const known = byName.get(nameKey(entry.name));
    if (known) {
      who.set(entry.id, known);
      continue;
    }
    const made = { ...base(entry.at), kind: "person" as const, name: entry.name, exact: Boolean(entry.exact) };
    save.push(made);
    who.set(entry.id, made.id);
    byName.set(nameKey(entry.name), made.id);
    add(names, made.id, nameKey(entry.name));
    count.people += 1;
  }

  for (const entry of incoming) {
    if (save.length >= MAX_SHEET_ENTRIES) {
      break;
    }
    if (entry.kind === "group") {
      if (!colours.has(nameKey(entry.name)) && entry.color) {
        colours.add(nameKey(entry.name));
        save.push({
          id: groupId(arriving.bookId, entry.name),
          bookId: arriving.bookId,
          at: { p: 0, cfi: null, chapter: null },
          from: arriving.from ?? null,
          kind: "group",
          name: entry.name,
          color: entry.color
        });
      }
      continue;
    }
    if (entry.kind === "person") {
      continue;
    }
    const person = who.get(entry.person);
    if (!person) {
      continue;
    }
    if (entry.kind === "alias") {
      if (add(names, person, nameKey(entry.text))) {
        save.push({ ...base(entry.at), kind: "alias", person, text: entry.text, main: Boolean(entry.main), exact: Boolean(entry.exact) });
      }
    } else if (entry.kind === "note") {
      if (add(notes, person, entry.text.trim())) {
        save.push({ ...base(entry.at), kind: "note", person, text: entry.text });
        count.notes += 1;
      }
    } else if (entry.kind === "member") {
      if (add(groupsOf, person, nameKey(entry.group ?? ""))) {
        save.push({ ...base(entry.at), kind: "member", person, group: entry.group });
      }
    } else if (entry.kind === "link") {
      const to = who.get(entry.to);
      if (!to || to === person) {
        continue;
      }
      const link = { type: entry.type, person, to };
      if (!said.has(linkKey(link))) {
        said.add(linkKey(link));
        save.push({
          ...base(entry.at),
          kind: "link",
          ...link,
          label: entry.label,
          ended: entry.ended ? arriving.stamp(entry.ended) : null
        });
        count.links += 1;
      }
    }
  }
  return { save, remove: [], ...count };
};

/**
 * A sheet from a file, arriving in this book. Its exact places are kept only
 * when it was written in this very file; otherwise each entry is held to its
 * fraction of the book.
 */
export const importSheet = (
  file: SheetFile,
  existing: Entry[],
  book: { bookId: string; fileHash?: string | null },
  newId: () => string
): Arrival => {
  const sameFile = Boolean(file.book.fileHash && book.fileHash && file.book.fileHash === book.fileHash);
  return arrive(file.entries, existing, {
    bookId: book.bookId,
    newId,
    stamp: (at) => (sameFile ? at : { p: at.p, cfi: null, chapter: at.chapter })
  });
};

/**
 * The sheet of the book before this one in its series, arriving here: as it
 * stood at that book's end, and all of it known from the first page. Each
 * person comes under the name they ended with, in the group they ended in;
 * a tie that had ended arrives ended.
 */
export const carrySheet = (
  earlier: Entry[],
  existing: Entry[],
  book: { bookId: string; fromBookId: string; fromTitle: string },
  newId: () => string
): Arrival => {
  const cast = castAt(earlier, { progress: 1 }, placeOrder());
  const at: Stamp = { p: 0, cfi: null, chapter: null };
  const incoming: SheetEntry[] = [];
  let next = 0;
  const id = () => `carry-${(next += 1)}`;
  for (const group of cast.groups) {
    incoming.push({ id: id(), at, kind: "group", name: group.name, color: group.color });
  }
  for (const person of cast.people) {
    incoming.push({ id: person.id, at, kind: "person", name: person.name, exact: false });
    for (const name of person.names) {
      if (nameKey(name.text) !== nameKey(person.name)) {
        incoming.push({ id: id(), at, kind: "alias", person: person.id, text: name.text, main: false, exact: false });
      }
    }
    if (person.group) {
      incoming.push({ id: id(), at, kind: "member", person: person.id, group: person.group });
    }
    for (const note of person.notes) {
      incoming.push({ id: id(), at, kind: "note", person: person.id, text: note.text });
    }
  }
  for (const person of cast.people) {
    for (const link of person.links) {
      if (link.outward) {
        incoming.push({ id: id(), at, kind: "link", person: person.id, to: link.other, type: link.type, label: link.label, ended: link.over ? at : null });
      }
    }
  }
  // Everything arrives at one place, so the order it arrives in is the order
  // it is shown in: ids that sort the way they were made keep it.
  let made = 0;
  const ordered = () => `c${String((made += 1)).padStart(5, "0")}-${newId()}`;
  const label = `From ${book.fromTitle}`.slice(0, 120);
  return arrive(incoming, existing, {
    bookId: book.bookId,
    newId: ordered,
    stamp: () => ({ p: 0, cfi: null, chapter: label }),
    from: book.fromBookId
  });
};
