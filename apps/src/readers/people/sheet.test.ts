import { describe, expect, it } from "vitest";
import { applied } from "./edits";
import { castAt, placeOrder, type Entry } from "./model";
import { carrySheet, exportSheet, importSheet, MAX_SHEET_ENTRIES, readSheet, SHEET_FORMAT, type Arrival } from "./sheet";

const NOW = "2026-10-04T00:00:00Z";
const stamp = (p: number, cfi: string | null = null, chapter: string | null = null) => ({ p, cfi, chapter });
const made = { bookId: "friend-book", createdAt: NOW, updatedAt: NOW };

/** A friend's sheet, written to the end of the book. */
const FRIEND: Entry[] = [
  { ...made, id: "jon", at: stamp(0.02, "epubcfi(/6/8!/4/2/1:0)", "Chapter 1"), kind: "person", name: "Jon Snow" },
  { ...made, id: "ned", at: stamp(0.01, "epubcfi(/6/6!/4/2/1:0)", "Prologue"), kind: "person", name: "Ned Stark" },
  { ...made, id: "ygritte", at: stamp(0.55, "epubcfi(/6/60!/4/2/1:0)", "Chapter 30"), kind: "person", name: "SPOILER Ygritte" },
  { ...made, id: "n1", at: stamp(0.02, "epubcfi(/6/8!/4/2/1:5)"), kind: "note", person: "jon", text: "Son of Ned, the bastard boy" },
  { ...made, id: "n2", at: stamp(0.9, "epubcfi(/6/90!/4/2/1:5)"), kind: "note", person: "jon", text: "SPOILER stabbed" },
  { ...made, id: "a1", at: stamp(0.5), kind: "alias", person: "jon", text: "SPOILER Lord Commander", main: true },
  { ...made, id: "m1", at: stamp(0.02), kind: "member", person: "jon", group: "Stark" },
  { ...made, id: "m2", at: stamp(0.4), kind: "member", person: "jon", group: "SPOILER Night's Watch" },
  { ...made, id: "l1", at: stamp(0.02), kind: "link", person: "jon", to: "ned", type: "child", label: null, ended: stamp(0.7) },
  { ...made, id: "l2", at: stamp(0.6), kind: "link", person: "jon", to: "ygritte", type: "friend", label: "SPOILER lovers", ended: null },
  { ...made, id: "g1", at: stamp(0), kind: "group", name: "Stark", color: "slate" },
  { ...made, id: "gone", at: stamp(0.1), kind: "note", person: "jon", text: "deleted", deletedAt: NOW }
];
const BOOK = { title: "A Game of Thrones", author: "George R. R. Martin", fileHash: "hash-1" };

let serial = 0;
const newId = () => `new-${(serial += 1)}`;
/** A sheet with an arrival saved into it. */
const saved = (existing: Entry[], arrival: Arrival): Entry[] =>
  applied(
    existing,
    arrival.save.map((draft) => ({ ...draft, createdAt: NOW, updatedAt: NOW, deletedAt: null }) as Entry),
    arrival.remove
  );

describe("a sheet as a file", () => {
  const file = exportSheet(FRIEND, BOOK, NOW);

  it("holds every live entry, with its place, and says which book it is from", () => {
    expect(file.format).toBe(SHEET_FORMAT);
    expect(file.book).toEqual(BOOK);
    expect(file.entries).toHaveLength(FRIEND.length - 1);
    expect(file.entries.some((entry) => entry.id === "gone")).toBe(false);
    expect(file.entries.find((entry) => entry.id === "n1")).toEqual({
      id: "n1",
      at: stamp(0.02, "epubcfi(/6/8!/4/2/1:5)"),
      kind: "note",
      person: "jon",
      text: "Son of Ned, the bastard boy"
    });
    // Nothing of this device: no book id, no dates of its own.
    expect(JSON.stringify(file.entries)).not.toContain("friend-book");
    expect(JSON.stringify(file.entries)).not.toContain("createdAt");
  });

  it("is read back as it was written", () => {
    expect(readSheet(JSON.stringify(file))).toEqual({
      ...file,
      entries: file.entries.map((entry) =>
        entry.kind === "person" ? { ...entry, exact: false } : entry.kind === "alias" ? { ...entry, exact: false } : entry
      )
    });
  });

  it("is not read at all when it is something else", () => {
    for (const contents of ["", "not json", "[]", "null", '{"entries":[]}', '{"format":"something-else","entries":[]}', '{"format":"leaflet-characters"}']) {
      expect(readSheet(contents), contents).toBeNull();
    }
  });

  it("leaves out what cannot be read, and reads a senseless place as the end of the book", () => {
    const odd = {
      format: SHEET_FORMAT,
      entries: [
        { id: "p", kind: "person", name: "Vin", at: { p: "soon" } },
        { id: "q", kind: "person", name: "", at: { p: 0 } },
        { id: "r", kind: "pet", name: "Wolf", at: { p: 0 } },
        { kind: "person", name: "No id", at: { p: 0 } },
        { id: "s", kind: "note", text: "no person", at: { p: 0 } },
        { id: "t", kind: "link", person: "p", to: "p", type: "mentor", at: { p: 0.1 } },
        "nonsense",
        null
      ]
    };
    const read = readSheet(JSON.stringify(odd));
    expect(read?.entries.map((entry) => entry.id)).toEqual(["p", "t"]);
    expect(read?.entries[0].at.p).toBe(1);
    expect(read?.entries[1]).toMatchObject({ type: "other" });
  });

  it("is never longer than a sheet could be", () => {
    const many = { format: SHEET_FORMAT, entries: Array.from({ length: MAX_SHEET_ENTRIES + 50 }, (_, n) => ({ id: `p${n}`, kind: "person", name: `P ${n}`, at: { p: 0 } })) };
    expect(readSheet(JSON.stringify(many))?.entries).toHaveLength(MAX_SHEET_ENTRIES);
  });
});

describe("a friend's sheet arriving", () => {
  const file = readSheet(JSON.stringify(exportSheet(FRIEND, BOOK, NOW)));
  if (!file) {
    throw new Error("the sheet did not read back");
  }
  // Another edition of the book: its exact places mean nothing here.
  const arrival = importSheet(file, [], { bookId: "mine", fileHash: "hash-2" }, newId);
  const mine = saved([], arrival);

  it("says how much arrived, in numbers", () => {
    expect([arrival.people, arrival.notes, arrival.links]).toEqual([3, 2, 2]);
    expect(Object.keys(arrival).sort()).toEqual(["links", "notes", "people", "remove", "save"]);
  });

  it("belongs to this book, under ids of its own", () => {
    expect(mine.every((entry) => entry.bookId === "mine")).toBe(true);
    expect(mine.some((entry) => ["jon", "ned", "n1", "l1"].includes(entry.id))).toBe(false);
  });

  it("does not spoil: at 30% it shows what the friend knew at 30%", () => {
    const cast = castAt(mine, { progress: 0.3, cfi: "epubcfi(/6/20!/4/2/1:0)" }, placeOrder(() => 0));
    expect(JSON.stringify(cast)).not.toContain("SPOILER");
    expect(cast.people.map((person) => person.name)).toEqual(["Jon Snow", "Ned Stark"]);
    expect(cast.later).toBe(1);
    const jon = cast.people[0];
    expect(jon.notes.map((note) => note.text)).toEqual(["Son of Ned, the bastard boy"]);
    expect(jon.laterNotes).toBe(1);
    expect(jon.group).toBe("Stark");
    expect(jon.links.map((link) => [link.type, link.otherName, link.over])).toEqual([["child", "Ned Stark", false]]);
  });

  it("reveals itself as the reader goes", () => {
    expect(castAt(mine, { progress: 0.56 }).people.map((person) => person.name)).toContain("SPOILER Ygritte");
    const end = castAt(mine, { progress: 1 }).people.find((person) => person.names.some((name) => name.text === "Jon Snow"));
    expect(end?.name).toBe("SPOILER Lord Commander");
    expect(end?.notes).toHaveLength(2);
    expect(end?.links.find((link) => link.type === "child")?.over).toBe(true);
  });

  it("from another edition is held to its fractions: no exact place comes with it", () => {
    expect(mine.every((entry) => entry.at.cfi === null)).toBe(true);
    expect(mine.every((entry) => entry.kind !== "link" || entry.ended === null || entry.ended.cfi === null)).toBe(true);
    expect(mine.find((entry) => entry.kind === "person" && entry.name === "Jon Snow")?.at).toEqual(stamp(0.02, null, "Chapter 1"));
  });

  it("from this very file keeps its exact places", () => {
    const same = saved([], importSheet(file, [], { bookId: "mine", fileHash: "hash-1" }, newId));
    expect(same.find((entry) => entry.kind === "person" && entry.name === "Jon Snow")?.at.cfi).toBe("epubcfi(/6/8!/4/2/1:0)");
  });

  it("brought in twice changes nothing the second time", () => {
    const again = importSheet(file, mine, { bookId: "mine", fileHash: "hash-2" }, newId);
    expect(again.save).toEqual([]);
    expect([again.people, again.notes, again.links]).toEqual([0, 0, 0]);
  });

  it("joins people the reader already has, and keeps what the reader wrote", () => {
    const own: Entry[] = [
      { ...made, bookId: "mine", id: "my-jon", at: stamp(0.1), kind: "person", name: "jon snow" },
      { ...made, bookId: "mine", id: "my-note", at: stamp(0.1), kind: "note", person: "my-jon", text: "my own note" }
    ];
    const arrived = importSheet(file, own, { bookId: "mine", fileHash: "hash-2" }, newId);
    const both = saved(own, arrived);
    expect(arrived.people).toBe(2);
    const cast = castAt(both, { progress: 0.3 });
    const jon = cast.people.find((person) => person.id === "my-jon");
    expect(cast.people).toHaveLength(2);
    expect(jon?.notes.map((note) => note.text)).toEqual(["Son of Ned, the bastard boy", "my own note"]);
    expect(jon?.links).toHaveLength(1);
  });

  it("drops a link to someone the file does not hold", () => {
    const broken = { ...file, entries: file.entries.filter((entry) => entry.id !== "ned") };
    const arrived = importSheet(broken, [], { bookId: "mine" }, newId);
    expect(arrived.save.filter((entry) => entry.kind === "link")).toHaveLength(1);
  });
});

describe("the sheet of the book before, in a series", () => {
  const carried = carrySheet(FRIEND, [], { bookId: "book-2", fromBookId: "book-1", fromTitle: "A Game of Thrones" }, newId);
  const next = saved([], carried);

  it("is all known from the first page", () => {
    const cast = castAt(next, { progress: 0 });
    expect(cast.later).toBe(0);
    expect(cast.people.map((person) => person.name).sort()).toEqual(["Ned Stark", "SPOILER Lord Commander", "SPOILER Ygritte"]);
    const jon = cast.people.find((person) => person.name === "SPOILER Lord Commander");
    expect(jon?.notes.map((note) => note.text)).toEqual(["Son of Ned, the bastard boy", "SPOILER stabbed"]);
    expect(jon?.laterNotes).toBe(0);
    expect(jon?.group).toBe("SPOILER Night's Watch");
    expect(jon?.names.map((name) => name.text)).toEqual(["SPOILER Lord Commander", "Jon Snow"]);
  });

  it("arrives as it stood at the end: a tie that had ended is over", () => {
    const jon = castAt(next, { progress: 0 }).people.find((person) => person.name === "SPOILER Lord Commander");
    expect(jon?.links.map((link) => [link.type, link.over]).sort()).toEqual([
      ["child", true],
      ["friend", false]
    ]);
  });

  it("says where it came from, and has no exact places", () => {
    expect(next.filter((entry) => entry.kind !== "group").every((entry) => entry.from === "book-1" && entry.at.cfi === null && entry.at.p === 0)).toBe(true);
    expect(next.find((entry) => entry.kind === "note")?.at.chapter).toBe("From A Game of Thrones");
    expect(next.every((entry) => entry.bookId === "book-2")).toBe(true);
  });

  it("keeps a group's colour", () => {
    const sheet: Entry[] = [...FRIEND.filter((entry) => entry.id !== "m2")];
    const arrived = saved([], carrySheet(sheet, [], { bookId: "book-2", fromBookId: "book-1", fromTitle: "T" }, newId));
    expect(castAt(arrived, { progress: 0 }).groups).toEqual([{ name: "Stark", color: "slate" }]);
  });

  it("carried twice changes nothing the second time, and leaves this book's own notes alone", () => {
    const own: Entry = { ...made, bookId: "book-2", id: "mine", at: stamp(0.2), kind: "person", name: "Brienne" };
    const again = carrySheet(FRIEND, [...next, own], { bookId: "book-2", fromBookId: "book-1", fromTitle: "A Game of Thrones" }, newId);
    expect(again.save).toEqual([]);
  });

  it("carries nothing that was deleted", () => {
    expect(next.some((entry) => entry.kind === "note" && entry.text === "deleted")).toBe(false);
  });
});
