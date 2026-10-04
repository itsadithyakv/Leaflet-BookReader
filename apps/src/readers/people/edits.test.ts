import { describe, expect, it } from "vitest";
import {
  addAlias,
  addLink,
  addNote,
  addPerson,
  applied,
  editNote,
  endLink,
  groupId,
  mergePeople,
  removePerson,
  rename,
  setGroup,
  setGroupColor,
  type Change,
  type Writing
} from "./edits";
import { castAt, placeOrder, type Entry, type Link, type Note, type Person } from "./model";

const order = placeOrder();
const NOW = "2026-10-04T00:00:00Z";

/** A reader at `progress`, and a sheet that saves what they do. */
const reader = (progress: number, sheet: { entries: Entry[] }, chapter = "Chapter 3") => {
  let next = 0;
  const writing: Writing = {
    bookId: "b",
    place: { progress, cfi: null, chapter },
    newId: () => `id${sheet.entries.length}-${(next += 1)}`
  };
  const commit = <T extends Change>(change: T): T => {
    const saved = change.save.map((draft) => ({ ...draft, createdAt: NOW, updatedAt: NOW, deletedAt: null }) as Entry);
    sheet.entries = applied(sheet.entries, saved, change.remove);
    return change;
  };
  return { writing, commit, cast: () => castAt(sheet.entries, writing.place, order) };
};

describe("what the reader writes is stamped with the place being read", () => {
  it("makes a character from a name and one line, as the owner asked", () => {
    const sheet = { entries: [] as Entry[] };
    const at30 = reader(0.3, sheet);
    const change = at30.commit(addPerson(sheet.entries, order, at30.writing, { name: " Jon Snow’s ", note: "Son of Ned, the bastard boy" }));
    expect(change.save.map((draft) => draft.kind)).toEqual(["person", "note"]);
    expect(change.save.every((draft) => draft.at.p === 0.3 && draft.at.chapter === "Chapter 3")).toBe(true);
    const jon = at30.cast().people[0];
    expect(jon.name).toBe("Jon Snow");
    expect(jon.notes.map((note) => note.text)).toEqual(["Son of Ned, the bastard boy"]);
    // And it is not there for a reader who has not got that far.
    expect(reader(0.29, sheet).cast().people).toEqual([]);
    expect(reader(0.29, sheet).cast().later).toBe(1);
  });

  it("does nothing with no name", () => {
    const sheet = { entries: [] as Entry[] };
    expect(addPerson(sheet.entries, order, reader(0.3, sheet).writing, { name: " “” " })).toEqual({
      save: [],
      remove: [],
      person: null
    });
  });

  it("does not write a name twice", () => {
    const sheet = { entries: [] as Entry[] };
    const first = reader(0.3, sheet);
    first.commit(addPerson(sheet.entries, order, first.writing, { name: "Vin" }));
    const again = reader(0.5, sheet);
    const change = again.commit(addPerson(sheet.entries, order, again.writing, { name: "vin", note: "a Mistborn", group: "Kelsier's crew" }));
    expect(change.save.map((draft) => draft.kind)).toEqual(["note", "member"]);
    expect(again.cast().people).toHaveLength(1);
    expect(again.cast().people[0].group).toBe("Kelsier's crew");
  });

  it("meets someone from later in the book here, without showing what is later about them", () => {
    const sheet = { entries: [] as Entry[] };
    const late = reader(0.6, sheet);
    const made = late.commit(addPerson(sheet.entries, order, late.writing, { name: "Marsh", note: "SPOILER an Inquisitor" }));
    const early = reader(0.2, sheet);
    expect(early.cast().people).toEqual([]);

    const change = early.commit(addPerson(sheet.entries, order, early.writing, { name: "Marsh", note: "Kelsier's brother" }));
    expect(change.person).toBe(made.person);
    const marsh = early.cast().people[0];
    expect(marsh.met.p).toBe(0.2);
    expect(marsh.notes.map((note) => note.text)).toEqual(["Kelsier's brother"]);
    expect(marsh.laterNotes).toBe(1);
    expect(JSON.stringify(early.cast())).not.toContain("SPOILER");
    expect(sheet.entries.filter((entry) => entry.kind === "person")).toHaveLength(1);
  });

  it("adds a note, rewords one where it was written, and drops one reworded to nothing", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet, "Chapter 1");
    const made = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Vin", note: "a thief" }));
    const at50 = reader(0.5, sheet);
    at50.commit(addNote(at50.writing, made.person as string, "  trained by Kelsier "));
    expect(addNote(at50.writing, "x", "   ").save).toEqual([]);
    expect(at50.cast().people[0].notes.map((note) => [note.text, note.at.p])).toEqual([
      ["a thief", 0.1],
      ["trained by Kelsier", 0.5]
    ]);

    const first = sheet.entries.find((entry) => entry.kind === "note" && entry.text === "a thief") as Note;
    at50.commit(editNote(first, "a street thief"));
    expect(at10.cast().people[0].notes.map((note) => [note.text, note.at.p, note.at.chapter])).toEqual([
      ["a street thief", 0.1, "Chapter 1"]
    ]);
    const edited = sheet.entries.find((entry) => entry.id === first.id) as Note;
    at50.commit(editNote(edited, "  "));
    expect(at10.cast().people[0].notes).toEqual([]);
  });

  it("learns a name here, and a main name is what they are called from here on", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet);
    const made = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Strider" }));
    const at40 = reader(0.4, sheet);
    at40.commit(addAlias(at40.writing, made.person as string, "Aragorn", true));
    expect(at10.cast().people[0].name).toBe("Strider");
    expect(at10.cast().people[0].names.map((name) => name.text)).toEqual(["Strider"]);
    expect(at40.cast().people[0].name).toBe("Aragorn");
    expect(addAlias(at40.writing, "x", " “” ").save).toEqual([]);
  });

  it("sets a spelling right everywhere, and changes nothing for the same name", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet);
    at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Kelsior" }));
    const person = sheet.entries[0] as Person;
    expect(rename(person, "Kelsior").save).toEqual([]);
    at10.commit(rename(person, "Kelsier"));
    expect(at10.cast().people[0].name).toBe("Kelsier");
    expect(at10.cast().people[0].met.p).toBe(0.1);
  });

  it("moves someone to a group from here on, and colours a group once per book", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet);
    const made = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Jon", group: "Stark" }));
    const at40 = reader(0.4, sheet);
    at40.commit(setGroup(at40.writing, made.person as string, "  Night's   Watch "));
    at40.commit(setGroupColor("b", "Stark", "slate"));
    at40.commit(setGroupColor("b", " stark ", "moss"));
    expect(at10.cast().people[0].group).toBe("Stark");
    expect(at10.cast().people[0].color).toBe("moss");
    expect(at40.cast().people[0].group).toBe("Night's Watch");
    expect(sheet.entries.filter((entry) => entry.kind === "group")).toHaveLength(1);
    expect(groupId("b", "Stark")).toBe(groupId("b", "  STARK"));
    expect(setGroupColor("b", "  ", "moss").save).toEqual([]);
    at40.commit(setGroup(at40.writing, made.person as string, null));
    expect(reader(0.5, sheet).cast().people[0].group).toBeNull();
  });

  it("links two people the way it was said, once", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet);
    const jon = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Jon" })).person as string;
    const ned = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Ned" })).person as string;
    const robb = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Robb" })).person as string;

    at10.commit(addLink(sheet.entries, order, at10.writing, jon, { type: "child", outward: true, other: ned }));
    // "Father of Robb", written on Ned's card: Robb is the child.
    at10.commit(addLink(sheet.entries, order, at10.writing, ned, { type: "child", outward: false, other: robb }));
    at10.commit(addLink(sheet.entries, order, at10.writing, jon, { type: "sibling", outward: true, other: robb, label: " half-brother " }));
    const links = sheet.entries.filter((entry): entry is Link => entry.kind === "link");
    expect(links.map((link) => [link.person, link.type, link.to, link.label])).toEqual([
      [jon, "child", ned, null],
      [robb, "child", ned, null],
      [jon, "sibling", robb, "half-brother"]
    ]);

    // Said again, from either end of a mutual link: nothing new.
    expect(addLink(sheet.entries, order, at10.writing, jon, { type: "child", outward: true, other: ned }).save).toEqual([]);
    expect(addLink(sheet.entries, order, at10.writing, robb, { type: "sibling", outward: true, other: jon }).save).toEqual([]);
    // The other way round is another thing to say, and no one is tied to themself.
    expect(addLink(sheet.entries, order, at10.writing, ned, { type: "child", outward: true, other: jon }).save).toHaveLength(1);
    expect(addLink(sheet.entries, order, at10.writing, jon, { type: "friend", outward: true, other: jon }).save).toEqual([]);
  });

  it("ends a link here, and it reads as before to a reader who has not got here", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet);
    const a = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Sandor" })).person as string;
    const b = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Joffrey" })).person as string;
    at10.commit(addLink(sheet.entries, order, at10.writing, a, { type: "serves", outward: true, other: b }));
    const at70 = reader(0.7, sheet);
    at70.commit(endLink(at70.writing, sheet.entries.find((entry) => entry.kind === "link") as Link));
    expect(at70.cast().people.find((person) => person.id === a)?.links[0].over).toBe(true);
    expect(reader(0.69, sheet).cast().people.find((person) => person.id === a)?.links[0].over).toBe(false);
    // Once it has ended it can be said again.
    expect(addLink(sheet.entries, order, at70.writing, a, { type: "serves", outward: true, other: b }).save).toHaveLength(1);
    expect(addLink(sheet.entries, order, at10.writing, a, { type: "serves", outward: true, other: b }).save).toEqual([]);
  });

  it("removes someone with everything about them and every link to them", () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet);
    const jon = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Jon", note: "a boy", group: "Stark" })).person as string;
    const ned = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Ned", note: "his father" })).person as string;
    at10.commit(addAlias(at10.writing, jon, "Lord Snow"));
    at10.commit(addLink(sheet.entries, order, at10.writing, jon, { type: "child", outward: true, other: ned }));
    at10.commit(removePerson(sheet.entries, jon));
    expect(sheet.entries.map((entry) => entry.kind).sort()).toEqual(["note", "person"]);
    expect(at10.cast().people.map((person) => person.name)).toEqual(["Ned"]);
  });
});

describe("two entries that are one person", () => {
  const build = () => {
    const sheet = { entries: [] as Entry[] };
    const at10 = reader(0.1, sheet, "Chapter 1");
    const strider = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Strider", note: "a ranger", group: "Rangers" })).person as string;
    const frodo = at10.commit(addPerson(sheet.entries, order, at10.writing, { name: "Frodo" })).person as string;
    at10.commit(addLink(sheet.entries, order, at10.writing, strider, { type: "friend", outward: true, other: frodo }));
    const at40 = reader(0.4, sheet, "Chapter 9");
    const aragorn = at40.commit(addPerson(sheet.entries, order, at40.writing, { name: "Aragorn", note: "SPOILER heir of Isildur" })).person as string;
    at40.commit(addAlias(at40.writing, aragorn, "Strider"));
    at40.commit(addLink(sheet.entries, order, at40.writing, frodo, { type: "friend", outward: true, other: aragorn }));
    at40.commit(addLink(sheet.entries, order, at40.writing, aragorn, { type: "serves", outward: false, other: strider }));
    return { sheet, strider, frodo, aragorn, at10, at40 };
  };
  let next = 0;
  const id = () => `merged-${(next += 1)}`;

  it("become one, met from the earlier place, with everything written about either", () => {
    const { sheet, strider, frodo, aragorn, at10, at40 } = build();
    at40.commit(mergePeople(sheet.entries, order, strider, aragorn, id));
    const people = at40.cast().people;
    expect(people.map((person) => person.name).sort()).toEqual(["Aragorn", "Frodo"]);
    const one = people.find((person) => person.id === aragorn);
    expect(one?.met.p).toBe(0.1);
    expect(one?.notes.map((note) => note.text)).toEqual(["a ranger", "SPOILER heir of Isildur"]);
    expect(one?.names.map((name) => name.text).sort()).toEqual(["Aragorn", "Strider"]);
    expect(one?.group).toBe("Rangers");
    // The friendship said from both sides is said once; the tie between the two is gone.
    expect(one?.links.map((link) => [link.type, link.other])).toEqual([["friend", frodo]]);
    expect(sheet.entries.some((entry) => entry.id === strider)).toBe(false);
    // And an earlier reader still sees only what was known then.
    const early = at10.cast().people.find((person) => person.id === aragorn);
    expect(early?.notes.map((note) => note.text)).toEqual(["a ranger"]);
    expect(early?.laterNotes).toBe(1);
    expect(JSON.stringify(at10.cast())).not.toContain("SPOILER");
  });

  it("the other way round keeps the earlier stamp and learns the later name where it was learned", () => {
    const { sheet, strider, aragorn, at10, at40 } = build();
    at40.commit(mergePeople(sheet.entries, order, aragorn, strider, id));
    expect(at10.cast().people.find((person) => person.id === strider)?.names.map((name) => name.text)).toEqual(["Strider"]);
    expect(at40.cast().people.find((person) => person.id === strider)?.names.map((name) => name.text)).toEqual(["Strider", "Aragorn"]);
    expect(at10.cast().later).toBe(0);
  });

  it("does nothing for a person and themself, or someone not there", () => {
    const { sheet, strider } = build();
    expect(mergePeople(sheet.entries, order, strider, strider, id)).toEqual({ save: [], remove: [] });
    expect(mergePeople(sheet.entries, order, strider, "nobody", id)).toEqual({ save: [], remove: [] });
  });
});
