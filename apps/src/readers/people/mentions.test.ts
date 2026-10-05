import { describe, expect, it } from "vitest";
import { CONTEXT, isContentsPage, mentionsIn, mentionsUpTo, type SectionMentions } from "./mentions";
import { nameMatcher } from "./names";

const find = nameMatcher([
  { text: "Vin", person: "vin", exact: true },
  { text: "Kelsier", person: "kel", exact: true }
]);

const ONE = "Ash fell from the sky. Vin watched the downy flakes drift. Kelsier smiled at her.";
const TWO =
  "The crew gathered at dusk. “Vin can do it,” Kelsier said.\n\nNobody argued.   Vin said nothing at all. " +
  "SPOILER Vin burned atium and saw the SPOILER ending.";
const THREE = "SPOILER Vin dies here, in a later chapter.";

const scan = (texts: string[], person = "vin"): SectionMentions[] =>
  texts.map((text, section) => ({ section, hits: mentionsIn(text, find, person) }));

describe("mentions found in a chapter's text", () => {
  it("keeps one person's, with the book's words around each", () => {
    const hits = mentionsIn(ONE, find, "vin");
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe("Vin");
    expect(ONE.slice(hits[0].start, hits[0].end)).toBe("Vin");
    expect(hits[0].before).toBe("Ash fell from the sky. ");
    expect(hits[0].after).toBe(" watched the downy flakes drift. Kelsier smiled at her.");
    expect(mentionsIn(ONE, find)).toHaveLength(2);
  });

  it("keeps no more than a line's worth on each side", () => {
    const long = `${"word ".repeat(100)}Vin${" word".repeat(100)}`;
    const [hit] = mentionsIn(long, find, "vin");
    expect(hit.before).toHaveLength(CONTEXT);
    expect(hit.after).toHaveLength(CONTEXT);
  });
});

describe("what may be shown of them at a place", () => {
  const all = scan([ONE, TWO, THREE]);
  const firstSpoiler = TWO.indexOf("SPOILER");

  it("counts every earlier chapter, and names the first appearance", () => {
    const summary = mentionsUpTo(all, { section: 1, offset: firstSpoiler });
    expect(summary.count).toBe(3);
    expect(summary.first).toMatchObject({ section: 0, before: "", match: "Vin", after: " watched the downy flakes drift." });
  });

  it("lists the last few before here, the latest first, as plain single lines", () => {
    const summary = mentionsUpTo(all, { section: 1, offset: firstSpoiler });
    expect(summary.recent.map((hit) => `${hit.before}[${hit.match}]${hit.after}`)).toEqual([
      "[Vin] said nothing at all.",
      "“[Vin] can do it,” Kelsier said."
    ]);
    expect(mentionsUpTo(all, { section: 1, offset: firstSpoiler }, 1).recent).toHaveLength(1);
  });

  it("never counts a later chapter, whatever it was handed", () => {
    const text = JSON.stringify(mentionsUpTo(all, { section: 1, offset: TWO.length }));
    expect(text).not.toContain("later chapter");
    expect(mentionsUpTo(all, { section: 1, offset: TWO.length }).count).toBe(4);
    expect(mentionsUpTo(all, { section: 2, offset: THREE.length }).count).toBe(5);
    expect(mentionsUpTo(all, { section: 0, offset: ONE.length }).count).toBe(1);
  });

  it("leaves out a mention after the place in the chapter being read", () => {
    const summary = mentionsUpTo(all, { section: 1, offset: firstSpoiler });
    expect(JSON.stringify(summary)).not.toContain("SPOILER");
    expect(JSON.stringify(summary)).not.toContain("atium");
  });

  it("cuts the words after a mention at the place, mid-line", () => {
    // The place is just after "Vin said": the rest of that sentence is still ahead.
    const at = TWO.indexOf("Vin said nothing") + "Vin said".length;
    const summary = mentionsUpTo(all, { section: 1, offset: at });
    expect(summary.recent[0]).toMatchObject({ match: "Vin", after: " said" });
    expect(JSON.stringify(summary)).not.toContain("nothing");
    // And one character short of the name's end, the mention itself is not shown.
    const inside = TWO.indexOf("Vin said nothing") + 2;
    expect(mentionsUpTo(all, { section: 1, offset: inside }).count).toBe(2);
  });

  it("lets nothing later through at any place in the chapter", () => {
    for (let offset = 0; offset <= TWO.length; offset += 1) {
      const summary = mentionsUpTo(all, { section: 1, offset });
      const shown = [summary.first, ...summary.recent].filter((hit) => hit !== null);
      for (const hit of shown) {
        if (hit.section === 1) {
          expect(hit.end, `at ${offset}`).toBeLessThanOrEqual(offset);
          const words = hit.after.replace(/…$/, "");
          expect(TWO.slice(hit.end, offset).replace(/\s+/g, " "), `at ${offset}`).toContain(words.trimEnd());
        }
      }
      if (offset <= firstSpoiler) {
        expect(JSON.stringify(summary), `at ${offset}`).not.toContain("SPOILER");
      }
    }
  });

  it("shows nothing of the chapter being read when the place in it cannot be told", () => {
    const summary = mentionsUpTo(all, { section: 1, offset: null });
    expect(summary.count).toBe(1);
    expect(summary.first?.section).toBe(0);
  });

  it("has nothing to show for a name not yet mentioned", () => {
    expect(mentionsUpTo(scan([ONE, TWO], "nobody"), { section: 1, offset: 10 })).toEqual({ count: 0, first: null, recent: [] });
    expect(mentionsUpTo(all, { section: 0, offset: 5 })).toEqual({ count: 0, first: null, recent: [] });
  });

  it("does not repeat the first appearance among the recent ones", () => {
    const summary = mentionsUpTo(all, { section: 0, offset: ONE.length });
    expect(summary.first?.match).toBe("Vin");
    expect(summary.recent).toEqual([]);
  });

  it("starts a long line at a whole word and marks where it was cut", () => {
    const long = `${"alpha beta gamma ".repeat(20)}Vin ${"delta epsilon ".repeat(20)}`;
    const summary = mentionsUpTo([{ section: 0, hits: mentionsIn(long, find, "vin") }], { section: 0, offset: long.length });
    expect(summary.first?.before.startsWith("…")).toBe(true);
    expect(summary.first?.before).not.toMatch(/^…\S*a\S* (?!alpha|beta|gamma)/);
    expect(summary.first?.after.endsWith("…")).toBe(true);
    expect(`${summary.first?.before}${summary.first?.match}${summary.first?.after}`).not.toContain("\n");
  });
});

describe("a contents page is not read for mentions", () => {
  it("knows one by its name, alone or under its book's", () => {
    expect(isContentsPage("Contents")).toBe(true);
    expect(isContentsPage("CONTENTS")).toBe(true);
    expect(isContentsPage("Table of Contents")).toBe(true);
    expect(isContentsPage("A CLASH OF KINGS · CONTENTS")).toBe(true);
    expect(isContentsPage("The Contents of the Chest")).toBe(false);
    expect(isContentsPage("TYRION")).toBe(false);
    expect(isContentsPage("A CLASH OF KINGS · TYRION")).toBe(false);
    expect(isContentsPage(null)).toBe(false);
  });
});
