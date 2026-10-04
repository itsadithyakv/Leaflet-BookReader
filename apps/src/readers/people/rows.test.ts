import { describe, expect, it } from "vitest";
import type { Entry } from "./model";
import { entriesOf, fromRow, isPeopleRow, toRow, type EntryDraft, type PeopleRow } from "./rows";

const AT = { p: 0.3125, cfi: "epubcfi(/6/8!/4/2/1:0)", chapter: "Chapter 2" };
const base = { bookId: "b1", at: AT, from: null };
const DRAFTS: EntryDraft[] = [
  { ...base, id: "p1", kind: "person", name: "Jon Snow", exact: false },
  { ...base, id: "p2", kind: "person", name: "Hope", exact: true, from: "b0" },
  { ...base, id: "a1", kind: "alias", person: "p1", text: "Lord Snow", main: true, exact: false },
  { ...base, id: "a2", kind: "alias", person: "p1", text: "Hound", main: false, exact: true },
  { ...base, id: "n1", kind: "note", person: "p1", text: "Son of Ned,\nthe bastard boy" },
  { ...base, id: "m1", kind: "member", person: "p1", group: "Stark" },
  { ...base, id: "m2", kind: "member", person: "p1", group: null },
  { ...base, id: "l1", kind: "link", person: "p1", to: "p2", type: "child", label: null, ended: null },
  {
    ...base,
    id: "l2",
    kind: "link",
    person: "p1",
    to: "p2",
    type: "serves",
    label: "squire",
    ended: { p: 0.7, cfi: null, chapter: "Chapter 40" }
  },
  { ...base, id: "g1", kind: "group", name: "Stark", color: "slate", at: { p: 0, cfi: null, chapter: null } }
];

/** What the database gives back for a draft it saved. */
const saved = (draft: EntryDraft): PeopleRow => ({
  ...toRow(draft),
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  deletedAt: null
});

describe("character entries as rows", () => {
  it("come back as they went in, every kind", () => {
    for (const draft of DRAFTS) {
      const entry = fromRow(saved(draft));
      expect(entry, draft.id).toEqual({
        ...draft,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        deletedAt: null
      });
    }
  });

  it("put the reader's words where they can be read, and the place in the place", () => {
    const row = toRow(DRAFTS[4]);
    expect(row).toEqual({
      id: "n1",
      bookId: "b1",
      kind: "person.note",
      cfi: "epubcfi(/6/8!/4/2/1:0)",
      chapter: "Chapter 2",
      text: '{"p":0.3125,"who":"p1"}',
      note: "Son of Ned,\nthe bastard boy",
      color: null
    });
  });

  it("keep the details short", () => {
    for (const draft of DRAFTS) {
      expect(toRow(draft).text.length).toBeLessThan(300);
    }
    expect(JSON.parse(toRow({ ...DRAFTS[0], at: { ...AT, p: 1 / 3 } }).text).p).toBe(0.333333);
  });

  it("know their own rows from highlights and bookmarks", () => {
    expect(isPeopleRow({ kind: "person" })).toBe(true);
    expect(isPeopleRow({ kind: "person.link" })).toBe(true);
    expect(isPeopleRow({ kind: "highlight" })).toBe(false);
    expect(isPeopleRow({ kind: "bookmark" })).toBe(false);
    expect(isPeopleRow({ kind: "person.pet" })).toBe(false);
  });

  it("leave out a row that cannot be read rather than guess", () => {
    const good = saved(DRAFTS[4]);
    const bad: PeopleRow[] = [
      { ...good, kind: "highlight" },
      { ...good, kind: "person.pet" },
      { ...good, text: "not json" },
      { ...good, text: "[1]" },
      { ...good, text: "null" },
      { ...good, text: null },
      { ...good, text: '{"p":0.3}' },
      { ...good, note: "   " },
      { ...good, id: "" },
      { ...saved(DRAFTS[7]), text: '{"p":0.3,"who":"p1"}' },
      { ...saved(DRAFTS[0]), note: null }
    ];
    for (const row of bad) {
      expect(fromRow(row), JSON.stringify(row)).toBeNull();
    }
    expect(entriesOf([good, ...bad]).map((entry) => entry.id)).toEqual(["n1"]);
  });

  it("read a place that makes no sense as the end of the book, so it stays hidden", () => {
    const row = saved(DRAFTS[4]);
    for (const text of ['{"who":"p1"}', '{"p":"half","who":"p1"}', '{"p":null,"who":"p1"}']) {
      expect(fromRow({ ...row, text })?.at.p).toBe(1);
    }
    expect(fromRow({ ...row, text: '{"p":7,"who":"p1"}' })?.at.p).toBe(1);
    expect(fromRow({ ...row, text: '{"p":-2,"who":"p1"}' })?.at.p).toBe(0);
    const ended = fromRow({ ...saved(DRAFTS[8]), text: '{"p":0.1,"who":"p1","to":"p2","type":"serves","end":{}}' }) as Extract<
      Entry,
      { kind: "link" }
    >;
    expect(ended.ended?.p).toBe(1);
  });

  it("read a link type from a later version as a plain link", () => {
    const row = { ...saved(DRAFTS[7]), text: '{"p":0.1,"who":"p1","to":"p2","type":"mentor"}' };
    expect((fromRow(row) as Extract<Entry, { kind: "link" }>).type).toBe("other");
  });

  it("carry a delete", () => {
    expect(fromRow({ ...saved(DRAFTS[0]), deletedAt: "2026-10-03T00:00:00Z" })?.deletedAt).toBe("2026-10-03T00:00:00Z");
  });
});
