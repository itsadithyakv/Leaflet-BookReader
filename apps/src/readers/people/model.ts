/**
 * Characters: what the reader has written down about the people in a book, and
 * what of it may be shown at a given place.
 *
 * Every entry is stamped with the place in the book it was written at, and the
 * cast as seen from a place holds only what is stamped at or before it. So a
 * card opened at 30% cannot hold a note from 60%, a second reading spoils
 * nothing, and a sheet someone else made reveals itself as the reader goes.
 *
 * The rule is strict on purpose, so that it can be proved rather than hoped:
 * what is shown at a place depends on nothing stamped after it (two counts
 * aside: how many people are still ahead, and how many later notes a person
 * has). An entry that arrives out of order (a note stamped before its person,
 * after two devices merged) stays hidden until its person is met.
 *
 * Pure: no storage, no DOM, no clock.
 */

/** Where in the book something was written. */
export type Stamp = {
  /** How far through the book, 0..1: the reader's own size-weighted progress. */
  p: number;
  /** The exact place in this edition, when it is known; exact where `p` is coarse. */
  cfi: string | null;
  /** The chapter, as the reader showed it. */
  chapter: string | null;
};

/** The place being read: the furthest point the reader has on screen. */
export type Place = { progress: number; cfi?: string | null; chapter?: string | null };

/**
 * How two people are tied. `child`, `serves`, `ward` and `killedBy` read from
 * the entry's `person` to its `to` ("Jon, child of Ned"); the rest read the
 * same both ways.
 */
export const LINK_TYPES = [
  "child",
  "spouse",
  "sibling",
  "kin",
  "serves",
  "ward",
  "friend",
  "enemy",
  "killedBy",
  "other"
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** The links a family tree is drawn from; the others are labelled lines. */
export const FAMILY_LINKS: readonly LinkType[] = ["child", "spouse", "sibling"];

type Base = {
  id: string;
  bookId: string;
  at: Stamp;
  createdAt: string;
  /** Every change, the delete included: the newest wins when copies merge. */
  updatedAt: string;
  deletedAt?: string | null;
  /** The book of the series it was carried over from, if it was. */
  from?: string | null;
};

/** Someone in the book, under the name the reader first wrote down. */
export type Person = Base & {
  kind: "person";
  name: string;
  /** The name is also an ordinary word ("Hope", "Will"): match it as written. */
  exact?: boolean;
};

/** Another name for someone, learned at a place ("little bird"). */
export type Alias = Base & {
  kind: "alias";
  person: string;
  text: string;
  /** From here on this is what they are called (a true name, a title taken). */
  main?: boolean;
  /** An ordinary word ("Hound"): match it as written, capital and all. */
  exact?: boolean;
};

export type Note = Base & { kind: "note"; person: string; text: string };

/** The group someone belongs to from a place on (a house, a crew); null leaves it. */
export type Member = Base & { kind: "member"; person: string; group: string | null };

export type Link = Base & {
  kind: "link";
  person: string;
  to: string;
  type: LinkType;
  /** The reader's own word for it ("uncle", "squire"). */
  label: string | null;
  /** Where it stopped being true. Before that place it reads as it always did. */
  ended: Stamp | null;
};

/** A group's colour. Not stamped: a colour gives nothing away. */
export type Group = Base & { kind: "group"; name: string; color: string };

export type Entry = Person | Alias | Note | Member | Link | Group;

/** The colours a group can have; the stylesheet gives each its shade. */
export const GROUP_COLORS = ["rose", "amber", "moss", "teal", "sky", "violet", "clay", "slate"] as const;

export const START: Stamp = { p: 0, cfi: null, chapter: null };

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

/** The stamp for something written at `place`. */
export const stampOf = (place: Place): Stamp => ({
  p: clamp01(place.progress),
  cfi: place.cfi || null,
  chapter: place.chapter?.replace(/\s+/g, " ").trim() || null
});

export type Order = {
  /** Whether something stamped `stamp` may be shown to a reader at `here`. */
  known: (stamp: Stamp, here: Place) => boolean;
  /** Reading order, for sorting what is shown. */
  compare: (a: Stamp, b: Stamp) => number;
};

/** Progress is a quotient of sizes: this forgives its rounding, not a page. */
const EPSILON = 1e-9;

/**
 * How places are ordered. Two places in this edition are compared by their
 * CFIs, which is exact (progress moves a page at a time and shifts with the
 * type size); anything without one (an imported sheet, a series' earlier
 * book) by its fraction of the book. A place that cannot be read counts as
 * later: when in doubt, hidden.
 */
export const placeOrder = (compareCfi?: (a: string, b: string) => number): Order => {
  const byCfi = (a: string | null | undefined, b: string | null | undefined): number | null => {
    if (!compareCfi || !a || !b) {
      return null;
    }
    try {
      const result = compareCfi(a, b);
      return Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  };
  return {
    known: (stamp, here) => {
      const exact = byCfi(stamp.cfi, here.cfi);
      if (exact !== null) {
        return exact <= 0;
      }
      if (!Number.isFinite(stamp.p) || !Number.isFinite(here.progress)) {
        return false;
      }
      return stamp.p <= here.progress + EPSILON;
    },
    compare: (a, b) => {
      const exact = byCfi(a.cfi, b.cfi);
      if (exact !== null && exact !== 0) {
        return exact;
      }
      const pa = Number.isFinite(a.p) ? a.p : 2;
      const pb = Number.isFinite(b.p) ? b.p : 2;
      return pa - pb;
    }
  };
};

/** Names compared as the reader would: case and spacing aside. */
export const nameKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

const tidy = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** The colour a group has when the reader has not picked one: always the same for a name. */
export const defaultGroupColor = (name: string): string => {
  let hash = 0;
  for (const char of nameKey(name)) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
};

export type KnownName = { text: string; exact: boolean };

export type NoteView = { id: string; text: string; at: Stamp };

export type LinkView = {
  id: string;
  type: LinkType;
  label: string | null;
  /** The person at the other end, and what they are called here. */
  other: string;
  otherName: string;
  /** This person is the entry's `person` ("child of other"), not its `to`. */
  outward: boolean;
  /** It has ended, at or before here. A later ending is not in the view at all. */
  over: boolean;
  at: Stamp;
};

export type PersonView = {
  id: string;
  /** What they are called at this place. */
  name: string;
  /** Every name learned so far, for marking the text and finding mentions. */
  names: KnownName[];
  group: string | null;
  color: string | null;
  /** Where they were first written down. */
  met: Stamp;
  /** Oldest first, so the newest is last. */
  notes: NoteView[];
  links: LinkView[];
  /** How many of their notes are later in the book. A number, nothing more. */
  laterNotes: number;
};

export type CastView = {
  /** Everyone met so far, by name. */
  people: PersonView[];
  /** The groups those people are in, as known here. */
  groups: Array<{ name: string; color: string }>;
  /** How many people are still ahead. A number, nothing more. */
  later: number;
};

const live = (entry: Entry) => !entry.deletedAt;

/**
 * The cast as a reader at `here` may see it.
 *
 * - A person is met once their own stamp is at or before here.
 * - A name, a note or a group shows once it is stamped at or before here and
 *   its person is met; a link, once both its people are.
 * - A link that ends later reads as it did before it ended.
 */
export const castAt = (entries: Entry[], here: Place, order: Order = placeOrder()): CastView => {
  const everyone = new Map<string, Person>();
  for (const entry of entries) {
    if (entry.kind === "person" && live(entry) && tidy(entry.name)) {
      everyone.set(entry.id, entry);
    }
  }
  const met = new Map<string, Person>();
  for (const person of everyone.values()) {
    if (order.known(person.at, here)) {
      met.set(person.id, person);
    }
  }

  const inOrder = <T extends Base>(items: T[]) =>
    items.sort(
      (a, b) => order.compare(a.at, b.at) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
  const shown = <T extends Entry & { person: string }>(kind: T["kind"]) => {
    const byPerson = new Map<string, T[]>();
    for (const entry of entries) {
      if (entry.kind === kind && live(entry) && met.has((entry as T).person) && order.known(entry.at, here)) {
        const list = byPerson.get((entry as T).person) ?? [];
        list.push(entry as T);
        byPerson.set((entry as T).person, list);
      }
    }
    byPerson.forEach((list) => inOrder(list));
    return byPerson;
  };
  const aliases = shown<Alias>("alias");
  const notes = shown<Note>("note");
  const members = shown<Member>("member");

  const laterNotes = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "note" && live(entry) && met.has(entry.person) && !order.known(entry.at, here)) {
      laterNotes.set(entry.person, (laterNotes.get(entry.person) ?? 0) + 1);
    }
  }

  const colors = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "group" && live(entry) && tidy(entry.name)) {
      colors.set(nameKey(entry.name), entry.color);
    }
  }
  const colorOf = (group: string) => {
    const picked = colors.get(nameKey(group));
    return picked && (GROUP_COLORS as readonly string[]).includes(picked) ? picked : defaultGroupColor(group);
  };

  const nameOf = (person: Person) => {
    const taken = (aliases.get(person.id) ?? []).filter((alias) => alias.main && tidy(alias.text));
    return tidy(taken.length > 0 ? taken[taken.length - 1].text : person.name);
  };

  const links = new Map<string, LinkView[]>();
  const visibleLinks = inOrder(
    entries.filter(
      (entry): entry is Link =>
        entry.kind === "link" &&
        live(entry) &&
        entry.person !== entry.to &&
        met.has(entry.person) &&
        met.has(entry.to) &&
        order.known(entry.at, here)
    )
  );
  for (const link of visibleLinks) {
    const over = Boolean(link.ended && order.known(link.ended, here));
    const type = (LINK_TYPES as readonly string[]).includes(link.type) ? link.type : "other";
    const ends: Array<[string, string, boolean]> = [
      [link.person, link.to, true],
      [link.to, link.person, false]
    ];
    for (const [self, other, outward] of ends) {
      const list = links.get(self) ?? [];
      list.push({
        id: link.id,
        type,
        label: tidy(link.label) || null,
        other,
        otherName: nameOf(met.get(other) as Person),
        outward,
        over,
        at: link.at
      });
      links.set(self, list);
    }
  }

  const people: PersonView[] = [...met.values()].map((person) => {
    const names: KnownName[] = [];
    const add = (text: string, exact: boolean) => {
      const clean = tidy(text);
      if (clean && !names.some((name) => nameKey(name.text) === nameKey(clean))) {
        names.push({ text: clean, exact });
      }
    };
    add(person.name, Boolean(person.exact));
    (aliases.get(person.id) ?? []).forEach((alias) => add(alias.text, Boolean(alias.exact)));
    const joined = members.get(person.id) ?? [];
    const group = joined.length > 0 ? tidy(joined[joined.length - 1].group) || null : null;
    return {
      id: person.id,
      name: nameOf(person),
      names,
      group,
      color: group ? colorOf(group) : null,
      met: person.at,
      notes: (notes.get(person.id) ?? []).map((note) => ({ id: note.id, text: note.text, at: note.at })),
      links: links.get(person.id) ?? [],
      laterNotes: laterNotes.get(person.id) ?? 0
    };
  });
  people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const groups = new Map<string, { name: string; color: string }>();
  for (const person of people) {
    if (person.group && !groups.has(nameKey(person.group))) {
      groups.set(nameKey(person.group), { name: person.group, color: person.color as string });
    }
  }

  return {
    people,
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    later: everyone.size - met.size
  };
};

/**
 * A met person's notes from later in the book, oldest first. Only for the
 * reader's own deliberate "show them"; nothing else may call this. Nobody's
 * notes are given for a person not yet met.
 */
export const laterNotesOf = (entries: Entry[], personId: string, here: Place, order: Order = placeOrder()): NoteView[] => {
  const person = entries.find((entry) => entry.kind === "person" && entry.id === personId && live(entry));
  if (!person || !order.known(person.at, here)) {
    return [];
  }
  return entries
    .filter(
      (entry): entry is Note =>
        entry.kind === "note" && live(entry) && entry.person === personId && !order.known(entry.at, here)
    )
    .sort((a, b) => order.compare(a.at, b.at) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((note) => ({ id: note.id, text: note.text, at: note.at }));
};
