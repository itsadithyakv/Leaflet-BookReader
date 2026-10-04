import { describe, expect, it } from "vitest";
import { castAt, type Entry } from "./model";
import { cleanName, nameMatcher, namesOf, whoIs, type NameEntry } from "./names";
import { linkWords, suggestLinks } from "./relations";

const stamp = (p: number) => ({ p, cfi: null, chapter: null });
const made = { bookId: "b", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
const person = (id: string, name: string, p = 0): Entry => ({ ...made, id, at: stamp(p), kind: "person", name });
const alias = (id: string, who: string, text: string, p = 0): Entry => ({
  ...made,
  id,
  at: stamp(p),
  kind: "alias",
  person: who,
  text
});

const SHEET: Entry[] = [
  person("jon", "Jon Snow"),
  person("ned", "Ned Stark"),
  person("sansa", "Sansa Stark"),
  person("cat", "Catelyn Stark"),
  person("sandor", "Sandor Clegane"),
  person("renoux", "Lord Renoux"),
  person("benjen", "Benjen Stark"),
  alias("a1", "sandor", "Hound"),
  alias("a2", "sansa", "little bird"),
  alias("a3", "jon", "Jon"),
  alias("a4", "jon", "SPOILER Aegon", 0.9),
  person("later", "SPOILER Ygritte", 0.6)
];
const names = (progress = 0.3) => namesOf(castAt(SHEET, { progress }));
const found = (text: string, list: NameEntry[] = names()) =>
  nameMatcher(list)(text).map((hit) => `${text.slice(hit.start, hit.end)}=${hit.person}`);

describe("the names looked for at a place", () => {
  it("are the names learned so far, and a given name no one else has", () => {
    expect(names().map((name) => name.text)).toEqual([
      "Benjen Stark",
      "Catelyn Stark",
      "Jon Snow",
      "Jon",
      "Lord Renoux",
      "Ned Stark",
      "Sandor Clegane",
      "Hound",
      "Sansa Stark",
      "little bird",
      "Benjen",
      "Catelyn",
      "Renoux",
      "Ned",
      "Sandor",
      "Sansa"
    ]);
  });

  it("never hold a name from later in the book", () => {
    expect(JSON.stringify(names())).not.toContain("SPOILER");
    expect(JSON.stringify(names())).not.toContain("Aegon");
    expect(names(1).map((name) => name.text)).toContain("SPOILER Aegon");
  });

  it("leave out a given name two people share", () => {
    const twins = namesOf(castAt([person("a", "Jon Snow"), person("b", "Jon Arryn")], { progress: 1 }));
    expect(twins.map((name) => name.text)).toEqual(["Jon Arryn", "Jon Snow"]);
  });
});

describe("finding names in text", () => {
  it("marks whole words only", () => {
    expect(found("Ned said to Nedra, who was unsansaed, that Jonas knew Jon.")).toEqual(["Ned=ned", "Jon=jon"]);
  });

  it("takes the longer name where two start together", () => {
    expect(found("Jon Snow and Jon rode with Ned Stark.")).toEqual(["Jon Snow=jon", "Jon=jon", "Ned Stark=ned"]);
  });

  it("finds a name across a line break and with either apostrophe", () => {
    const list: NameEntry[] = [{ text: "Kelsier's crew", person: "crew", exact: true }];
    expect(found("of Kelsier’s\n   crew, and Kelsier's crew", list)).toEqual([
      "Kelsier’s\n   crew=crew",
      "Kelsier's crew=crew"
    ]);
    expect(found("Sansa\n Stark", names())).toEqual(["Sansa\n Stark=sansa"]);
  });

  it("matches a name with a capital as written or all in capitals, not as an ordinary word", () => {
    expect(found("The Hound laughed. A hound barked. THE HOUND. HoUnD")).toEqual(["Hound=sandor", "HOUND=sandor"]);
    expect(found("NED STARK looked north")).toEqual(["NED STARK=ned"]);
  });

  it("matches a name written small in any case", () => {
    expect(found("Little bird, he said. My little bird.")).toEqual(["Little bird=sansa", "little bird=sansa"]);
  });

  it("finds a possessive and a name in quotes", () => {
    expect(found("“Sansa’s wolf,” said Ned's man")).toEqual(["Sansa=sansa", "Ned=ned"]);
  });

  it("falls back to the shorter name when the longer is not a whole word", () => {
    expect(found("Jon Snowfall", names())).toEqual(["Jon=jon"]);
  });

  it("stops at a limit, and finds nothing with no names", () => {
    expect(nameMatcher(names())("Ned Ned Ned Ned", 2)).toHaveLength(2);
    expect(nameMatcher([])("Ned")).toEqual([]);
  });

  it("is not thrown by a name full of pattern characters", () => {
    const list: NameEntry[] = [{ text: "A.B. (the 2nd) [sic]*", person: "x", exact: true }];
    expect(found("so A.B. (the 2nd) [sic]* said, not AxB", list)).toEqual(["A.B. (the 2nd) [sic]*=x"]);
  });
});

describe("who a selection is", () => {
  it("is the one person it names, however it was selected", () => {
    expect(whoIs(names(), "Sansa")).toBe("sansa");
    expect(whoIs(names(), " Sansa’s ")).toBe("sansa");
    expect(whoIs(names(), "“Lady Sansa,”")).toBe("sansa");
    expect(whoIs(names(), "the Hound")).toBe("sandor");
    expect(whoIs(names(), "Renoux")).toBe("renoux");
  });

  it("is no one for an unknown name, two people, or a passage", () => {
    expect(whoIs(names(), "Tyrion")).toBeNull();
    expect(whoIs(names(), "Ned and Sansa")).toBeNull();
    expect(whoIs(names(), "Stark")).toBeNull();
    expect(whoIs(names(), `Sansa ${"word ".repeat(30)}`)).toBeNull();
    expect(whoIs(names(), "")).toBeNull();
  });

  it("is no one for a name learned later", () => {
    expect(whoIs(names(), "Ygritte")).toBeNull();
    expect(whoIs(names(), "Aegon")).toBeNull();
    expect(whoIs(names(1), "SPOILER Ygritte")).toBe("later");
  });

  it("tidies a selection into a name", () => {
    expect(cleanName(" “Vin’s” ")).toBe("Vin");
    expect(cleanName("(Kelsier),")).toBe("Kelsier");
    expect(cleanName("Lord  Renoux.")).toBe("Lord Renoux");
    expect(cleanName("James's")).toBe("James");
  });
});

describe("links suggested by a note", () => {
  const suggest = (text: string, subject = "jon") => suggestLinks(text, names(), subject);

  it("reads the owner's own example", () => {
    expect(suggest("Son of Ned, the bastard boy")).toEqual([{ type: "child", outward: true, other: "ned", label: null }]);
  });

  it("reads both parents", () => {
    expect(suggest("Daughter of Ned and Catelyn", "sansa").map((item) => [item.type, item.outward, item.other])).toEqual([
      ["child", true, "ned"],
      ["child", true, "cat"]
    ]);
  });

  it("reads the other direction", () => {
    expect(suggest("Father of Sansa and Jon", "ned")).toEqual([
      { type: "child", outward: false, other: "sansa", label: null },
      { type: "child", outward: false, other: "jon", label: null }
    ]);
  });

  it("reads a possessive", () => {
    expect(suggest("Ned's bastard son")).toEqual([{ type: "child", outward: true, other: "ned", label: null }]);
    expect(suggest("Sansa’s half-brother")).toEqual([
      { type: "sibling", outward: true, other: "sansa", label: "half-brother" }
    ]);
  });

  it("keeps the reader's word where the type says less", () => {
    expect(suggest("Uncle of Jon", "benjen")).toEqual([{ type: "kin", outward: true, other: "jon", label: "uncle" }]);
    expect(suggest("squire to the Hound", "x")).toEqual([{ type: "serves", outward: true, other: "sandor", label: "squire" }]);
    expect(suggest("rival of Ned", "x")).toEqual([{ type: "enemy", outward: true, other: "ned", label: "rival" }]);
  });

  it("reads the rest of the small set", () => {
    const type = (text: string) => suggest(text, "x").map((item) => `${item.type}${item.outward ? ">" : "<"}${item.other}`);
    expect(type("brother of Sansa")).toEqual(["sibling>sansa"]);
    expect(type("wife of Ned")).toEqual(["spouse>ned"]);
    expect(type("married to Ned")).toEqual(["spouse>ned"]);
    expect(type("mother of Sansa")).toEqual(["child<sansa"]);
    expect(type("serves Lord Renoux")).toEqual(["serves>renoux"]);
    expect(type("sworn to Ned Stark")).toEqual(["serves>ned"]);
    expect(type("ward of Ned")).toEqual(["ward>ned"]);
    expect(type("friend of Jon")).toEqual(["friend>jon"]);
    expect(type("enemy of the Hound")).toEqual(["enemy>sandor"]);
    expect(type("killed by Sandor")).toEqual(["killedBy>sandor"]);
    expect(type("killed Sandor")).toEqual(["killedBy<sandor"]);
    expect(type("cousin of Sansa; aunt of Jon")).toEqual(["kin>sansa", "kin>jon"]);
  });

  it("suggests nothing for a name with no tie, for the person themself, or for a stranger", () => {
    expect(suggest("Rode north with Ned")).toEqual([]);
    expect(suggest("son of Jon")).toEqual([]);
    expect(suggest("son of Rhaegar")).toEqual([]);
    expect(suggest("grandson of nobody, saw Ned")).toEqual([]);
  });

  it("suggests each person once", () => {
    expect(suggest("son of Ned. Ned's son. friend of Ned")).toHaveLength(1);
  });

  it("cannot suggest someone not yet met", () => {
    expect(suggest("lover of Ygritte")).toEqual([]);
    expect(suggestLinks("lover of SPOILER Ygritte", names(1), "jon")).toEqual([
      { type: "friend", outward: true, other: "later", label: "lover" }
    ]);
  });

  it("puts a link in words from either end", () => {
    expect(linkWords("child", true, null)).toBe("child of");
    expect(linkWords("child", false, null)).toBe("parent of");
    expect(linkWords("killedBy", false, null)).toBe("killed");
    expect(linkWords("kin", true, "uncle")).toBe("uncle of");
    expect(linkWords("kin", false, "uncle")).toBe("uncle:");
    expect(linkWords("serves", true, "sworn to")).toBe("sworn to");
    expect(linkWords("other", true, "old shipmates")).toBe("old shipmates:");
  });
});
