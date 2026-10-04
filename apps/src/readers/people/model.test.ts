import { describe, expect, it } from "vitest";
import {
  castAt,
  defaultGroupColor,
  GROUP_COLORS,
  laterNotesOf,
  LINK_TYPES,
  placeOrder,
  stampOf,
  START,
  type Alias,
  type Entry,
  type Group,
  type Link,
  type LinkType,
  type Member,
  type Note,
  type Person,
  type Place,
  type Stamp
} from "./model";

const at = (p: number, cfi: string | null = null, chapter: string | null = null): Stamp => ({ p, cfi, chapter });
const base = (id: string, stamp: Stamp) => ({
  id,
  bookId: "book",
  at: stamp,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z"
});
const person = (id: string, name: string, p: number, more: Partial<Person> = {}): Person => ({
  ...base(id, at(p)),
  kind: "person",
  name,
  ...more
});
const alias = (id: string, who: string, text: string, p: number, more: Partial<Alias> = {}): Alias => ({
  ...base(id, at(p)),
  kind: "alias",
  person: who,
  text,
  ...more
});
const note = (id: string, who: string, text: string, p: number, more: Partial<Note> = {}): Note => ({
  ...base(id, at(p)),
  kind: "note",
  person: who,
  text,
  ...more
});
const member = (id: string, who: string, group: string | null, p: number): Member => ({
  ...base(id, at(p)),
  kind: "member",
  person: who,
  group
});
const link = (
  id: string,
  who: string,
  type: LinkType,
  to: string,
  p: number,
  more: Partial<Link> = {}
): Link => ({ ...base(id, at(p)), kind: "link", person: who, to, type, label: null, ended: null, ...more });
const group = (id: string, name: string, color: string): Group => ({ ...base(id, START), kind: "group", name, color });

const here = (progress: number, cfi: string | null = null): Place => ({ progress, cfi });
const who = (entries: Entry[], place: Place, id: string, order = placeOrder()) =>
  castAt(entries, place, order).people.find((item) => item.id === id);

/** A cast with something of every kind on both sides of 30%. */
const SHEET: Entry[] = [
  person("jon", "Jon Snow", 0.02),
  person("ned", "Ned Stark", 0.01),
  person("sansa", "Sansa Stark", 0.05),
  person("sandor", "Sandor Clegane", 0.2),
  person("ygritte", "SPOILER Ygritte", 0.55),
  alias("a1", "sansa", "little bird", 0.25),
  alias("a2", "sandor", "Hound", 0.21, { exact: true }),
  alias("a3", "jon", "SPOILER Lord Commander", 0.5, { main: true }),
  alias("a4", "jon", "SPOILER Aegon", 0.95),
  note("n1", "jon", "Son of Ned, the bastard boy", 0.02),
  note("n2", "jon", "Takes the black", 0.18),
  note("n3", "jon", "SPOILER stabbed", 0.9),
  note("n4", "ygritte", "SPOILER kissed by fire", 0.56),
  member("m1", "jon", "Stark", 0.02),
  member("m2", "ned", "Stark", 0.01),
  member("m3", "sansa", "Stark", 0.05),
  member("m4", "jon", "SPOILER Night's Watch", 0.4),
  member("m5", "ygritte", "SPOILER Free Folk", 0.55),
  link("l1", "jon", "child", "ned", 0.02),
  link("l2", "sansa", "child", "ned", 0.05),
  link("l3", "jon", "other", "ygritte", 0.6, { label: "SPOILER lovers" }),
  link("l4", "sandor", "serves", "sansa", 0.28, { label: "protects", ended: at(0.7) }),
  link("l5", "jon", "sibling", "sansa", 0.45, { label: "SPOILER cousin really" }),
  group("g1", "Stark", "slate"),
  group("g2", "SPOILER Free Folk", "rose")
];

describe("the cast as seen from a place", () => {
  it("shows what was written at or before here, newest note last", () => {
    const jon = who(SHEET, here(0.3), "jon");
    expect(jon?.name).toBe("Jon Snow");
    expect(jon?.notes.map((item) => item.text)).toEqual(["Son of Ned, the bastard boy", "Takes the black"]);
    expect(jon?.group).toBe("Stark");
    expect(jon?.color).toBe("slate");
    expect(jon?.links).toEqual([
      { id: "l1", type: "child", label: null, other: "ned", otherName: "Ned Stark", outward: true, over: false, at: at(0.02) }
    ]);
    const ned = who(SHEET, here(0.3), "ned");
    expect(ned?.links.map((item) => [item.other, item.outward])).toEqual([
      ["jon", false],
      ["sansa", false]
    ]);
  });

  it("is complete looking back from the end", () => {
    const cast = castAt(SHEET, here(1));
    expect(cast.later).toBe(0);
    expect(cast.people).toHaveLength(5);
    const jon = cast.people.find((item) => item.id === "jon");
    expect(jon?.name).toBe("SPOILER Lord Commander");
    expect(jon?.notes).toHaveLength(3);
    expect(jon?.laterNotes).toBe(0);
    expect(jon?.group).toBe("SPOILER Night's Watch");
    expect(jon?.names.map((name) => name.text)).toEqual(["Jon Snow", "SPOILER Lord Commander", "SPOILER Aegon"]);
  });

  it("something written here is known here", () => {
    expect(who(SHEET, here(0.18), "jon")?.notes).toHaveLength(2);
    expect(who(SHEET, here(0.1799), "jon")?.notes).toHaveLength(1);
  });

  it("a main name is what they are called from where it was learned", () => {
    expect(who(SHEET, here(0.49), "jon")?.name).toBe("Jon Snow");
    expect(who(SHEET, here(0.5), "jon")?.name).toBe("SPOILER Lord Commander");
    // And the other end of a link is called what it is called here.
    expect(who(SHEET, here(0.5), "ned")?.links[0].otherName).toBe("SPOILER Lord Commander");
    expect(who(SHEET, here(0.3), "ned")?.links[0].otherName).toBe("Jon Snow");
  });

  it("a group is the latest one joined, and leaving one leaves none", () => {
    const sheet = [...SHEET, member("m6", "sansa", null, 0.8)];
    expect(who(sheet, here(0.5), "sansa")?.group).toBe("Stark");
    expect(who(sheet, here(0.8), "sansa")?.group).toBeNull();
    expect(who(sheet, here(0.8), "sansa")?.color).toBeNull();
  });

  it("gives a group without a chosen colour the same colour every time", () => {
    const sheet = [person("a", "Vin", 0), member("m", "a", "Kelsier's crew", 0)];
    const color = who(sheet, here(0.1), "a")?.color;
    expect(GROUP_COLORS).toContain(color);
    expect(color).toBe(defaultGroupColor("  kelsier's   CREW "));
    // A colour this build does not know (a later version's) falls back the same way.
    const odd = [...sheet, group("g", "Kelsier's crew", "ultraviolet")];
    expect(who(odd, here(0.1), "a")?.color).toBe(color);
  });

  it("lists a name once however it is spelled, and keeps the as-written mark", () => {
    const sheet = [
      person("s", "Sandor Clegane", 0),
      alias("x", "s", "Hound", 0.1, { exact: true }),
      alias("y", "s", "  sandor   clegane ", 0.1),
      alias("z", "s", "   ", 0.1)
    ];
    expect(who(sheet, here(0.5), "s")?.names).toEqual([
      { text: "Sandor Clegane", exact: false },
      { text: "Hound", exact: true }
    ]);
  });

  it("reads a link type it does not know as a plain link", () => {
    const sheet = [person("a", "A", 0), person("b", "B", 0), link("l", "a", "mentor" as LinkType, "b", 0)];
    expect(who(sheet, here(0), "a")?.links[0].type).toBe("other");
    expect(LINK_TYPES).toContain("child");
  });

  it("stamps the place being read", () => {
    expect(stampOf({ progress: 0.4, cfi: "epubcfi(/6/4!/2)", chapter: " Chapter\n 2 " })).toEqual({
      p: 0.4,
      cfi: "epubcfi(/6/4!/2)",
      chapter: "Chapter 2"
    });
    expect(stampOf({ progress: -3 }).p).toBe(0);
    // A place that cannot be read is the end of the book: hidden until then.
    expect(stampOf({ progress: Number.NaN }).p).toBe(1);
  });
});

describe("nothing from later in the book gets through", () => {
  const view = castAt(SHEET, here(0.3));
  const text = JSON.stringify(view);

  it("carries no later word anywhere in what is shown", () => {
    // Every later name, alias, note, group and label in SHEET says SPOILER.
    expect(text).not.toContain("SPOILER");
    expect(JSON.stringify(castAt(SHEET, here(1)))).toContain("SPOILER");
  });

  it("hides a note stamped later and only counts it", () => {
    const jon = view.people.find((item) => item.id === "jon");
    expect(jon?.notes.map((item) => item.id)).toEqual(["n1", "n2"]);
    expect(jon?.laterNotes).toBe(1);
  });

  it("hides a person not yet met and only counts them", () => {
    expect(view.people.map((item) => item.id)).toEqual(["jon", "ned", "sandor", "sansa"]);
    expect(view.later).toBe(1);
    expect(text).not.toContain("ygritte");
  });

  it("hides a link that starts later, at both ends", () => {
    expect(view.people.find((item) => item.id === "jon")?.links.map((item) => item.id)).toEqual(["l1"]);
    expect(view.people.find((item) => item.id === "sansa")?.links.map((item) => item.id)).toEqual(["l2", "l4"]);
  });

  it("shows a link that ends later as it was, with no sign of the ending", () => {
    const sandor = view.people.find((item) => item.id === "sandor");
    expect(sandor?.links).toHaveLength(1);
    expect(sandor?.links[0].over).toBe(false);
    expect(Object.keys(sandor?.links[0] ?? {})).not.toContain("ended");
    expect(text).not.toContain("0.7");
    // From where it ended, it is over.
    expect(who(SHEET, here(0.7), "sandor")?.links[0].over).toBe(true);
    expect(who(SHEET, here(0.69), "sandor")?.links[0].over).toBe(false);
  });

  it("does not let a later ending change the count of what is hidden", () => {
    const ended = SHEET.map((entry) => (entry.id === "l1" ? { ...entry, ended: at(0.9) } : entry)) as Entry[];
    expect(castAt(ended, here(0.3))).toEqual(view);
  });

  it("leaves out a name learned later, so the text is not marked with it", () => {
    const names = view.people.flatMap((item) => item.names.map((name) => name.text));
    expect(names).toEqual(["Jon Snow", "Ned Stark", "Sandor Clegane", "Hound", "Sansa Stark", "little bird"]);
    expect(who(SHEET, here(0.24), "sansa")?.names.map((name) => name.text)).toEqual(["Sansa Stark"]);
  });

  it("lists only the groups known here", () => {
    expect(view.groups).toEqual([{ name: "Stark", color: "slate" }]);
  });

  it("hides a note about someone met later, however early the note is stamped", () => {
    // Two devices merged, or a sheet was put together by hand: the note cannot
    // show before its person does.
    const sheet = [...SHEET, note("early", "ygritte", "SPOILER early note", 0.1), alias("early2", "ygritte", "SPOILER wildling", 0.1)];
    expect(JSON.stringify(castAt(sheet, here(0.3)))).not.toContain("SPOILER");
    expect(laterNotesOf(sheet, "ygritte", here(0.3))).toEqual([]);
  });

  it("hides a link stamped early to someone met later", () => {
    const sheet = [...SHEET, link("early", "jon", "friend", "ygritte", 0.1)];
    const cast = castAt(sheet, here(0.3));
    expect(cast).toEqual(view);
    expect(castAt(sheet, here(0.55)).people.find((item) => item.id === "jon")?.links.map((item) => item.id)).toContain("early");
  });

  it("shows nothing that was deleted, and no link to a deleted person", () => {
    const gone = "2026-10-02T00:00:00Z";
    const sheet = SHEET.map((entry) =>
      entry.id === "ned" || entry.id === "n2" || entry.id === "a2" ? { ...entry, deletedAt: gone } : entry
    ) as Entry[];
    const cast = castAt(sheet, here(1));
    expect(cast.people.map((item) => item.id)).not.toContain("ned");
    expect(JSON.stringify(cast)).not.toContain("Takes the black");
    expect(JSON.stringify(cast)).not.toContain("Hound");
    expect(cast.people.find((item) => item.id === "jon")?.links.map((item) => item.other)).not.toContain("ned");
    expect(cast.later).toBe(0);
  });

  it("gives later notes only when asked, and only later ones", () => {
    expect(laterNotesOf(SHEET, "jon", here(0.3)).map((item) => item.id)).toEqual(["n3"]);
    expect(laterNotesOf(SHEET, "jon", here(1))).toEqual([]);
    expect(laterNotesOf(SHEET, "nobody", here(0.3))).toEqual([]);
  });

  it("an imported sheet, with no exact places, is held to its fractions", () => {
    // The reader's place has a CFI; the friend's entries have none.
    const order = placeOrder(() => {
      throw new Error("not comparable");
    });
    const cast = castAt(SHEET, { progress: 0.3, cfi: "epubcfi(/6/20!/4/2)" }, order);
    expect(cast).toEqual(view);
  });

  it("an earlier book's sheet is known from the first page", () => {
    const carried: Entry[] = [
      { ...person("k", "Kelsier", 0), at: START, from: "book-1" },
      { ...note("kn", "k", "The Survivor of Hathsin", 0), at: START, from: "book-1" }
    ];
    expect(who(carried, here(0), "k")?.notes).toHaveLength(1);
  });

  it("when a place cannot be read, hides rather than shows", () => {
    const sheet = [person("a", "A", Number.NaN), person("b", "B", 0.1)];
    expect(castAt(sheet, here(0.99)).people.map((item) => item.id)).toEqual(["b"]);
    expect(castAt(sheet, here(Number.NaN)).people).toEqual([]);
    expect(castAt(sheet, here(Number.NaN)).later).toBe(2);
  });
});

describe("places in one chapter are told apart exactly", () => {
  // Progress moves a page at a time: two places on one page share a fraction.
  // "epubcfi(n)" here orders by n.
  const order = placeOrder((a, b) => Math.sign(Number(a.slice(8, -1)) - Number(b.slice(8, -1))));
  const cfi = (n: number) => `epubcfi(${n})`;
  const sheet: Entry[] = [
    { ...person("vin", "Vin", 0.4), at: at(0.4, cfi(100)) },
    { ...note("before", "vin", "a street urchin", 0.4), at: at(0.4, cfi(110)) },
    { ...note("after", "vin", "SPOILER Mistborn", 0.4), at: at(0.4, cfi(190)) }
  ];

  it("hides a note a few lines below the place, on the same page", () => {
    const vin = who(sheet, { progress: 0.4, cfi: cfi(150) }, "vin", order);
    expect(vin?.notes.map((item) => item.id)).toEqual(["before"]);
    expect(vin?.laterNotes).toBe(1);
  });

  it("shows a note above the place though the type size moved its fraction", () => {
    // Larger type: the same place now reads as 0.39.
    expect(who(sheet, { progress: 0.39, cfi: cfi(150) }, "vin", order)?.notes.map((item) => item.id)).toEqual(["before"]);
  });

  it("without the exact comparison the fraction alone decides", () => {
    expect(who(sheet, { progress: 0.4, cfi: cfi(150) }, "vin")?.notes).toHaveLength(2);
    expect(who(sheet, { progress: 0.39, cfi: cfi(150) }, "vin")).toBeUndefined();
  });

  it("sorts by the exact place too", () => {
    const vin = who(sheet, { progress: 0.9, cfi: cfi(900) }, "vin", order);
    expect(vin?.notes.map((item) => item.id)).toEqual(["before", "after"]);
  });
});

describe("what is shown depends on nothing later (random sheets)", () => {
  // A small seeded generator, so a failure can be run again.
  const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const sheetOf = (next: () => number): Entry[] => {
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
    const p = () => Math.round(next() * 20) / 20;
    const ids = Array.from({ length: 3 + Math.floor(next() * 6) }, (_, index) => `p${index}`);
    const entries: Entry[] = ids.map((id) => person(id, `Name ${id}`, p()));
    const count = 10 + Math.floor(next() * 30);
    for (let index = 0; index < count; index += 1) {
      const id = `e${index}`;
      const owner = pick(ids);
      const roll = next();
      if (roll < 0.3) {
        entries.push(note(id, owner, `note ${id}`, p()));
      } else if (roll < 0.5) {
        entries.push(alias(id, owner, `alias ${id}`, p(), { main: next() < 0.3 }));
      } else if (roll < 0.65) {
        entries.push(member(id, owner, next() < 0.2 ? null : pick(["Red", "Blue", "Green"]), p()));
      } else {
        const start = p();
        entries.push(
          link(id, owner, pick(LINK_TYPES), pick(ids), start, {
            label: next() < 0.5 ? `label ${id}` : null,
            ended: next() < 0.4 ? at(Math.min(1, start + p())) : null
          })
        );
      }
      if (next() < 0.1) {
        entries[entries.length - 1] = { ...entries[entries.length - 1], deletedAt: "2026-10-02T00:00:00Z" } as Entry;
      }
    }
    return entries;
  };

  /** The sheet as it was when the reader got to `place`: nothing later exists yet. */
  const asOf = (entries: Entry[], place: Place): Entry[] => {
    const order = placeOrder();
    return entries
      .filter((entry) => entry.kind === "group" || order.known(entry.at, place))
      .map((entry) =>
        entry.kind === "link" && entry.ended && !order.known(entry.ended, place) ? { ...entry, ended: null } : entry
      );
  };

  const withoutCounts = (cast: ReturnType<typeof castAt>) => ({
    ...cast,
    later: 0,
    people: cast.people.map((item) => ({ ...item, laterNotes: 0 }))
  });

  it("the cast at a place is the cast of the sheet as it was then", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const next = random(seed);
      const entries = sheetOf(next);
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const place = here(progress);
        const full = castAt(entries, place);
        const then = castAt(asOf(entries, place), place);
        expect(withoutCounts(full), `seed ${seed} at ${progress}`).toEqual(withoutCounts(then));
        // And the sheet as it was then has nothing hidden in it.
        expect(then.later, `seed ${seed} at ${progress}`).toBe(0);
        expect(then.people.every((item) => item.laterNotes === 0)).toBe(true);
      }
    }
  });

  it("never shows more by going back", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const entries = sheetOf(random(seed));
      let before = -1;
      for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        const cast = castAt(entries, here(progress));
        const size = cast.people.reduce((sum, item) => sum + 1 + item.notes.length + item.names.length + item.links.length, 0);
        expect(size, `seed ${seed} at ${progress}`).toBeGreaterThanOrEqual(before);
        before = size;
      }
    }
  });
});
