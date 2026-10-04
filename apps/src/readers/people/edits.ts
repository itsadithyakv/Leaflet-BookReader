/**
 * What the reader does to a sheet, as entries to save and ids to delete.
 * Everything new is stamped with the place being read.
 *
 * Pure: the ids and the place come in.
 */
import {
  nameKey,
  stampOf,
  type Entry,
  type Link,
  type LinkType,
  type Note,
  type Order,
  type Person,
  type Place
} from "./model";
import { cleanName } from "./names";
import type { EntryDraft } from "./rows";

export type Change = { save: EntryDraft[]; remove: string[] };

export type Writing = { bookId: string; place: Place; newId: () => string };

/** Links that read the same from both ends. */
const MUTUAL: readonly LinkType[] = ["spouse", "sibling", "kin", "friend", "enemy", "other"];

const live = (entry: Entry) => !entry.deletedAt;
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** An entry as it is saved again: the dates are set where it is saved. */
export const draftOf = (entry: Entry): EntryDraft => {
  const { createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...draft } = entry;
  return draft as EntryDraft;
};

const fresh = (writing: Writing) => ({
  id: writing.newId(),
  bookId: writing.bookId,
  at: stampOf(writing.place),
  from: null
});

/**
 * Someone written down here, with what the reader said about them.
 *
 * A name already on the sheet is not written twice. If that person is from
 * later in the book (an earlier reading, a friend's sheet), they are met here
 * instead: their stamp moves back to this place, and what is stamped later
 * about them stays hidden as before.
 */
export const addPerson = (
  entries: Entry[],
  order: Order,
  writing: Writing,
  input: { name: string; note?: string; group?: string }
): Change & { person: string | null } => {
  const name = cleanName(input.name).slice(0, 120);
  if (!name) {
    return { save: [], remove: [], person: null };
  }
  const save: EntryDraft[] = [];
  const known = entries.find(
    (entry): entry is Person => entry.kind === "person" && live(entry) && nameKey(entry.name) === nameKey(name)
  );
  let person: string;
  if (known) {
    person = known.id;
    if (!order.known(known.at, writing.place)) {
      save.push({ ...draftOf(known), at: stampOf(writing.place) } as EntryDraft);
    }
  } else {
    const made = { ...fresh(writing), kind: "person" as const, name };
    person = made.id;
    save.push(made);
  }
  const note = input.note?.trim();
  if (note) {
    save.push({ ...fresh(writing), kind: "note", person, text: note });
  }
  const group = tidy(input.group ?? "");
  if (group) {
    save.push({ ...fresh(writing), kind: "member", person, group });
  }
  return { save, remove: [], person };
};

export const addNote = (writing: Writing, person: string, text: string): Change => {
  const note = text.trim();
  return { save: note ? [{ ...fresh(writing), kind: "note", person, text: note }] : [], remove: [] };
};

/** A note reworded. It stays where it was written. */
export const editNote = (note: Note, text: string): Change =>
  text.trim() ? { save: [{ ...draftOf(note), text: text.trim() } as EntryDraft], remove: [] } : { save: [], remove: [note.id] };

/** Another name, learned here; `main` when it is what they are called from here on. */
export const addAlias = (writing: Writing, person: string, text: string, main = false): Change => {
  const alias = cleanName(text).slice(0, 120);
  return { save: alias ? [{ ...fresh(writing), kind: "alias", person, text: alias, main, exact: false }] : [], remove: [] };
};

/** The name set right (a spelling). It changes wherever the name shows. */
export const rename = (person: Person, name: string): Change => {
  const clean = cleanName(name).slice(0, 120);
  return { save: clean && clean !== person.name ? [{ ...draftOf(person), name: clean } as EntryDraft] : [], remove: [] };
};

/** The group they are in from here on; null when they leave it. */
export const setGroup = (writing: Writing, person: string, group: string | null): Change => ({
  save: [{ ...fresh(writing), kind: "member", person, group: tidy(group ?? "").slice(0, 60) || null }],
  remove: []
});

/** One record per group and book, whichever device makes it: its id is its name. */
export const groupId = (bookId: string, name: string) => `people-group:${bookId}:${nameKey(name).slice(0, 60)}`;

export const setGroupColor = (bookId: string, name: string, color: string): Change => ({
  save: tidy(name)
    ? [{ id: groupId(bookId, name), bookId, at: { p: 0, cfi: null, chapter: null }, from: null, kind: "group", name: tidy(name), color }]
    : [],
  remove: []
});

/**
 * A link between two people, written here. Nothing, if the sheet already
 * says so (the same two people, the same way) at this place.
 */
export const addLink = (
  entries: Entry[],
  order: Order,
  writing: Writing,
  subject: string,
  link: { type: LinkType; outward: boolean; other: string; label?: string | null }
): Change => {
  const person = link.outward ? subject : link.other;
  const to = link.outward ? link.other : subject;
  if (!person || !to || person === to) {
    return { save: [], remove: [] };
  }
  const same = (entry: Link) =>
    entry.type === link.type &&
    ((entry.person === person && entry.to === to) ||
      (MUTUAL.includes(link.type) && entry.person === to && entry.to === person));
  const there = entries.some(
    (entry) =>
      entry.kind === "link" &&
      live(entry) &&
      same(entry) &&
      order.known(entry.at, writing.place) &&
      !(entry.ended && order.known(entry.ended, writing.place))
  );
  if (there) {
    return { save: [], remove: [] };
  }
  return {
    save: [{ ...fresh(writing), kind: "link", person, to, type: link.type, label: tidy(link.label ?? "").slice(0, 60) || null, ended: null }],
    remove: []
  };
};

/** A link that stops being true here. Before this place it reads as it always did. */
export const endLink = (writing: Writing, link: Link): Change => ({
  save: [{ ...draftOf(link), ended: stampOf(writing.place) } as EntryDraft],
  remove: []
});

/** Everything about someone: their names, notes and groups, and every link to or from them. */
export const removePerson = (entries: Entry[], person: string): Change => ({
  save: [],
  remove: entries
    .filter(
      (entry) =>
        live(entry) &&
        (entry.id === person ||
          ((entry.kind === "alias" || entry.kind === "note" || entry.kind === "member") && entry.person === person) ||
          (entry.kind === "link" && (entry.person === person || entry.to === person)))
    )
    .map((entry) => entry.id)
});

/**
 * Two entries on the sheet that are one person ("Strider" and "Aragorn"):
 * everything written about `from` becomes `into`'s, `from`'s name becomes one
 * of `into`'s names (learned where `from` was met), and `from` is deleted.
 * The person is met from the earlier of the two places. A link between the
 * two, and a link said twice once they are one, are dropped.
 */
export const mergePeople = (entries: Entry[], order: Order, from: string, into: string, newId: () => string): Change => {
  const gone = entries.find((entry): entry is Person => entry.kind === "person" && entry.id === from && live(entry));
  const kept = entries.find((entry): entry is Person => entry.kind === "person" && entry.id === into && live(entry));
  if (!gone || !kept || from === into) {
    return { save: [], remove: [] };
  }
  const save: EntryDraft[] = [];
  const remove = [from];
  if (order.compare(gone.at, kept.at) < 0) {
    save.push({ ...draftOf(kept), at: gone.at } as EntryDraft);
  }
  const names = new Set([nameKey(kept.name)]);
  for (const entry of entries) {
    if (entry.kind === "alias" && live(entry) && entry.person === into) {
      names.add(nameKey(entry.text));
    }
  }
  if (!names.has(nameKey(gone.name))) {
    names.add(nameKey(gone.name));
    save.push({
      id: newId(),
      bookId: gone.bookId,
      at: gone.at,
      from: gone.from ?? null,
      kind: "alias",
      person: into,
      text: gone.name,
      main: false,
      exact: Boolean(gone.exact)
    });
  }
  const said = new Set<string>();
  const sayOnce = (link: Link) => {
    const ends = MUTUAL.includes(link.type) ? [link.person, link.to].sort().join(">") : `${link.person}>${link.to}`;
    const key = `${link.type}|${ends}`;
    if (said.has(key)) {
      return false;
    }
    said.add(key);
    return true;
  };
  for (const entry of entries) {
    if (entry.kind === "link" && live(entry) && entry.person !== from && entry.to !== from) {
      sayOnce(entry);
    }
  }
  for (const entry of entries) {
    if (!live(entry)) {
      continue;
    }
    if (entry.kind === "alias" && entry.person === from) {
      if (names.has(nameKey(entry.text))) {
        remove.push(entry.id);
      } else {
        names.add(nameKey(entry.text));
        save.push({ ...draftOf(entry), person: into } as EntryDraft);
      }
    } else if ((entry.kind === "note" || entry.kind === "member") && entry.person === from) {
      save.push({ ...draftOf(entry), person: into } as EntryDraft);
    } else if (entry.kind === "link" && (entry.person === from || entry.to === from)) {
      const moved: Link = { ...entry, person: entry.person === from ? into : entry.person, to: entry.to === from ? into : entry.to };
      if (moved.person === moved.to || !sayOnce(moved)) {
        remove.push(entry.id);
      } else {
        save.push(draftOf(moved));
      }
    }
  }
  return { save, remove };
};

/** A sheet after a change, before the database has answered: what the reader sees at once. */
export const applied = (entries: Entry[], saved: Entry[], removed: string[]): Entry[] => {
  const gone = new Set([...removed, ...saved.map((entry) => entry.id)]);
  return [...entries.filter((entry) => !gone.has(entry.id)), ...saved];
};
