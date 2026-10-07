import { describe, expect, it, vi } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { EpubCFI } from "epubjs";
import type { Book } from "@shared/models/book";
import { annotationService, type Annotation } from "../services/annotationService";
import { groupByChapter, orderHighlights, sectionOfCfi } from "../components/highlights/highlightsView";
import { isKindlePlace } from "../library/kindleClippings";
import { planKindleImport } from "../library/kindleImport";
import {
  anchoredIn, fractionOfLocation, kindleWanted, passageInPieces, passageOf, placeInBook, placePassageInBook, readTried,
  sectionLetters, triedKey, wholeIn, writeTried, type PieceSpan
} from "./kindlePlacing";

/** The words a match covers, read back out of the pieces it points into; a block's edge is a bar. */
const wordsOf = (pieces: (string | null)[], match: PieceSpan) => {
  if (match.start.piece === match.end.piece) {
    return (pieces[match.start.piece] ?? "").slice(match.start.offset, match.end.offset);
  }
  const middle = pieces.slice(match.start.piece + 1, match.end.piece).map((piece) => piece ?? "|");
  return [(pieces[match.start.piece] ?? "").slice(match.start.offset), ...middle, (pieces[match.end.piece] ?? "").slice(0, match.end.offset)].join("");
};

/** What a clipping's words are found to be in some pieces: each place's words. */
const found = (pieces: (string | null)[], clipping: string) => passageInPieces(pieces, clipping).map((match) => wordsOf(pieces, match));

describe("a section's letters", () => {
  it("are its letters and digits, lower case and unaccented, whatever stands between them", () => {
    const pieces = ["“Don’t—stop,” she", null, "said… A naïve co\u00adoperation \ufb01nds 3\u00a0gulls."];
    expect(sectionLetters(pieces).key).toBe("dontstopshesaidanaivecooperationfinds3gulls");
    expect(sectionLetters(["Cafe\u0301 E\u0301TÉ"]).key).toBe("cafeete");
    expect(sectionLetters([null, "  ", "—…", null]).key).toBe("");
  });

  it("keep the place each was read from", () => {
    const pieces = ["  The  light", null, "house\n", " keeper’s \ufb01sh "];
    const letters = sectionLetters(pieces);
    expect(letters.key).toBe("thelighthousekeepersfish");
    expect(letters.piece).toHaveLength(letters.key.length);
    [...letters.key].forEach((letter, at) => {
      const from = (pieces[letters.piece[at]] ?? "")[letters.offset[at]];
      // (The ligature is one character read as two letters.)
      expect(from === "\ufb01" ? "fi" : from.toLowerCase(), `${at}`).toContain(letter);
    });
  });

  it("know where a word starts: after a space, a mark or a block's edge, not after a tag or a soft hyphen", () => {
    const starts = (pieces: (string | null)[]) => {
      const letters = sectionLetters(pieces);
      return [...letters.key].map((letter, at) => (letters.parted[at] ? letter.toUpperCase() : letter)).join("");
    };
    expect(starts(["A light", "house on-the rock."])).toBe("ALighthouseOnTheRock");
    expect(starts(["Light", null, "house"])).toBe("LightHouse");
    expect(starts(["over\u00adloaded zero\u200bwidth don’t"])).toBe("OverloadedZerowidthDonT");
  });
});

describe("a clipping's words, found in a section", () => {
  it("are found as they stand", () => {
    const pieces = [null, "The tide kept its own ledger, and nobody read it.", null];
    expect(found(pieces, "kept its own ledger")).toEqual(["kept its own ledger"]);
    expect(passageInPieces(pieces, "kept its own ledger")).toEqual([{ start: { piece: 1, offset: 9 }, end: { piece: 1, offset: 28 } }]);
    expect(found(pieces, "The tide kept its own ledger, and nobody read it.")).toEqual(["The tide kept its own ledger, and nobody read it."]);
  });

  it("are found whatever their case and whichever quotation marks and apostrophes", () => {
    const pieces = ["Then: “Nobody asked the gulls,” said Ines. “They’d have lied.” And she laughed."];
    expect(found(pieces, "\"Nobody asked the gulls,\" said Ines. \"They'd have lied.\"")).toEqual(["“Nobody asked the gulls,” said Ines. “They’d have lied.”"]);
    expect(found(pieces, "NOBODY ASKED THE GULLS, SAID INES")).toEqual(["Nobody asked the gulls,” said Ines"]);
    // The other way round: the Kindle's curly, the book's straight.
    expect(found(["She said \"they'd have lied\" twice."], "“they’d have lied”")).toEqual(["\"they'd have lied\""]);
  });

  it("are found over runs of white space, line breaks and a paragraph's end, joined by a space or by nothing", () => {
    const pieces = ["The harbour  was\n   quiet.", null, null, "The\u00a0bell was not.", null];
    const words = "The harbour  was\n   quiet.||The\u00a0bell was not.";
    expect(found(pieces, "The harbour was quiet. The bell was not.")).toEqual([words]);
    expect(found(pieces, "The harbour was quiet.The bell was not.")).toEqual([words]);
    expect(found(pieces, "The harbour was quiet.\nThe bell\twas   not.")).toEqual([words]);
  });

  it("are found across inline tags, inside a word too", () => {
    const pieces = ["She had ", "never", " seen the ", "Low", "water light", " so close."];
    expect(found(pieces, "never seen the Lowwater light so close")).toEqual(["never seen the Lowwater light so close"]);
    expect(passageInPieces(pieces, "seen the Lowwater")).toEqual([{ start: { piece: 2, offset: 1 }, end: { piece: 4, offset: 5 } }]);
  });

  it("are found whichever dash or hyphen, and through soft hyphens and zero-width characters", () => {
    const pieces = ["The ferry—late, as ever–was a well\u2011worn, over\u00adloaded, flat\u200bbottomed thing."];
    expect(found(pieces, "The ferry-late, as ever - was a well-worn, overloaded, flatbottomed thing.")).toEqual([pieces[0]]);
    expect(found(["A plain well-worn ferry -- late - as ever."], "well\u2011worn ferry — late – as ever")).toEqual(["well-worn ferry -- late - as ever"]);
  });

  it("are found whether an ellipsis is one character, three dots or three dots spaced out", () => {
    const pieces = ["She waited… and waited . . . and then she left."];
    expect(found(pieces, "She waited... and waited… and then she left.")).toEqual([pieces[0]]);
    expect(found(["He counted...one, two…"], "He counted… one, two...")).toEqual(["He counted...one, two…"]);
  });

  it("are found whether an accent is part of its letter or written after it, and a ligature as its letters", () => {
    expect(found(["The cafe\u0301 by the quay sold fried \ufb01sh."], "café by the quay sold fried fish")).toEqual(["cafe\u0301 by the quay sold fried \ufb01sh"]);
    // (To the end of the last letter, its accent with it.)
    expect(found(["Back to the old cafe\u0301, then."], "to the old café")).toEqual(["to the old cafe\u0301"]);
  });

  it("take in the marks the clipping opens and closes with, and no others", () => {
    const pieces = ["(“Low water at six,” the board said.)"];
    expect(found(pieces, "“Low water at six,”")).toEqual(["“Low water at six,”"]);
    expect(found(pieces, "Low water at six")).toEqual(["Low water at six"]);
    expect(found(pieces, "(\"Low water at six,\" the board said.)")).toEqual([pieces[0]]);
  });

  // Twenty-six words; the book has a note's number after the ninth.
  const CLIPPING = "The pilot knew every shoal between the two lights, and he had names for them that were on no chart the harbour office had ever drawn.";
  const NOTED = "The pilot knew every shoal between the two lights,[3] and he had names for them that were on no chart the harbour office had ever drawn.";

  it("are found by their opening and closing words when the middle is not the same", () => {
    const pieces = ["Before. ", NOTED, " After."];
    const letters = sectionLetters(pieces);
    const passage = passageOf(CLIPPING);
    expect(passage && wholeIn(letters, passage)).toEqual([]);
    expect([passage?.head, passage?.tail]).toEqual(["thepilotkneweveryshoalbetweenthetwo", "nocharttheharbourofficehadeverdrawn"]);
    expect(found(pieces, CLIPPING)).toEqual([NOTED]);
    // A word set right between two editions, and a sentence the book has one word more of.
    const mended = NOTED.replace(",[3] and he had names", ", and he had his own names");
    expect(found([mended], CLIPPING)).toEqual([mended]);
  });

  it("are not found by their two ends when those are too far apart, too close or the wrong way round", () => {
    const head = "The pilot knew every shoal between the two";
    const tail = "no chart the harbour office had ever drawn.";
    const far = `${head} lights. Then came forty more words about nothing in particular at all, and more, and more again, until at last there was ${tail}`;
    expect(found([far], CLIPPING)).toEqual([]);
    expect(found([`${head} ${tail}`], CLIPPING)).toEqual([]);
    expect(found([`${tail} And then: ${head} lights, and he had names for them.`], CLIPPING)).toEqual([]);
    // One end alone is not the passage.
    expect(found([`${head} lights, and he had names for them, and that was all.`], CLIPPING)).toEqual([]);
  });

  it("end at the closing words where they are due, not at the same words further on", () => {
    const again = `${NOTED} And on no chart the harbour office had ever drawn.`;
    expect(found([again], CLIPPING)).toEqual([NOTED]);
    // A long passage, whose closing words the book has twice within reach: the nearer to where they are due.
    const middle = Array.from({ length: 30 }, (_, at) => `and the ${["grey", "green", "white"][at % 3]} water went by`).join(", ");
    const long = `The pilot knew every shoal between the two lights, ${middle}, as it does on no chart the harbour office had ever drawn.`;
    const book = `${long.replace("grey water", "grey [7] water")} So: no chart the harbour office had ever drawn.`;
    expect(found([book], long)).toEqual([long.replace("grey water", "grey [7] water")]);
  });

  it("are looked for by their ends only when they are long enough to be known by them", () => {
    // Eight words: its two ends would be the whole of it.
    expect(passageOf("The tide kept its own ledger that year.")?.head).toBe("");
    // Nine, but of so few letters that four of them are in the book a hundred times.
    expect(passageOf("An ox is in a pen by me so")?.head).toBe("");
    expect(passageOf("Onward two three fourth fifth six seven eight ninth")?.head).toBe("onwardtwothreefourth");
    expect(passageOf(CLIPPING)?.short).toBe(false);
    expect(found(["The tide kept its own red ledger that year."], "The tide kept its own ledger that year.")).toEqual([]);
  });

  it("are not found where they are not, or where the section ends before they do", () => {
    const pieces = ["The tide kept its own ledger, and nobody"];
    expect(found(pieces, "The gulls kept their own counsel")).toEqual([]);
    expect(found(pieces, "kept its own ledger, and nobody read it")).toEqual([]);
    expect(found([], "kept its own ledger")).toEqual([]);
    expect(found(pieces, "  ")).toEqual([]);
    expect(found(pieces, "— … —")).toEqual([]);
    expect(passageOf("…")).toBeNull();
  });

  it("are every place the section has them, in order", () => {
    const pieces = ["The bell rang twice over the water.", null, "Later the bell rang twice over the water again."];
    expect(passageInPieces(pieces, "the bell rang twice over the water").map((match) => match.start)).toEqual([
      { piece: 0, offset: 0 },
      { piece: 2, offset: 6 }
    ]);
  });

  it("are whole words when they are one word or two", () => {
    const pieces = ["The lighthouse and the light. A light", "house keeper, over\u00adloaded."];
    expect(passageOf("light")?.short).toBe(true);
    expect(passageOf("the light")?.short).toBe(true);
    expect(passageOf("So it is.")?.short).toBe(true);
    expect(passageOf("the light went out")?.short).toBe(false);
    expect(passageInPieces(pieces, "light")).toEqual([{ start: { piece: 0, offset: 23 }, end: { piece: 0, offset: 28 } }]);
    expect(found(pieces, "the light")).toEqual(["the light"]);
    // (The second is "light" and "house" in two pieces, with nothing between them.)
    expect(found(pieces, "Lighthouse")).toEqual(["lighthouse", "lighthouse"]);
    expect(found(pieces, "loaded")).toEqual([]);
    expect(found(pieces, "overloaded.")).toEqual(["over\u00adloaded."]);
    // Longer, they are found inside a word as anything is: the Kindle's highlights begin and end on words.
    expect(found(pieces, "house and the light")).toEqual(["house and the light"]);
  });

  it("are not held to whole words where the writing has no spaces", () => {
    const pieces = ["海は静かだった。灯台の光は遠い。"];
    expect(found(pieces, "灯台の光")).toEqual(["灯台の光"]);
    expect(found(pieces, "海は静かだった。")).toEqual(["海は静かだった。"]);
  });

  it("are counted no further than asked", () => {
    const letters = sectionLetters(["tide tide tide tide tide"]);
    const passage = passageOf("tide");
    expect(passage && wholeIn(letters, passage, 2)).toHaveLength(2);
    expect(passage && wholeIn(letters, passage)).toHaveLength(5);
    expect(passage && anchoredIn(letters, passage)).toEqual([]);
  });
});

describe("where in the book a Kindle location is", () => {
  it("is against the highest location known, when nothing is placed yet", () => {
    expect(fractionOfLocation(250, 1000, [])).toBe(0.25);
    expect(fractionOfLocation(1200, 1000, [])).toBe(1);
  });

  it("is in step with the highlights placed either side of it", () => {
    const known = [
      { location: 100, fraction: 0.1 },
      { location: 400, fraction: 0.2 },
      { location: 800, fraction: 0.6 }
    ];
    expect(fractionOfLocation(250, 4000, known)).toBeCloseTo(0.15);
    expect(fractionOfLocation(600, 4000, known)).toBeCloseTo(0.4);
    expect(fractionOfLocation(400, 4000, known)).toBeCloseTo(0.2);
    // Past the last of them, and before the first: in step with that one from the book's start.
    expect(fractionOfLocation(1000, 4000, known)).toBeCloseTo(0.75);
    expect(fractionOfLocation(50, 4000, known)).toBeCloseTo(0.05);
    expect(fractionOfLocation(2000, 4000, known)).toBe(1);
  });

  it("is not known for a clipping with no location, or with nothing to go by", () => {
    expect(fractionOfLocation(null, 1000, [{ location: 100, fraction: 0.1 }])).toBeNull();
    expect(fractionOfLocation(250, null, [])).toBeNull();
    expect(fractionOfLocation(250, 0, [])).toBeNull();
    expect(fractionOfLocation(0, 1000, [])).toBeNull();
  });
});

// A book as epub.js holds it open: sections read from the file as parsed
// documents, and CFIs written by epub.js's own EpubCFI. (The parser is the one
// epub.js itself falls back to; it has no Range, so one is stood in with the
// things EpubCFI reads from it, as in findPlace.test.ts.)
// (The app's typings for epub.js know only the CFI read from a string.)
const Cfi = EpubCFI as unknown as new (from: unknown, base: string) => { toString(): string };
const parents = (node: Node | null) => {
  const chain: Node[] = [];
  for (let at = node; at; at = at.parentNode) {
    chain.unshift(at);
  }
  return chain;
};
const rangeIn = () => {
  const range = {
    startContainer: null as Node | null,
    startOffset: 0,
    endContainer: null as Node | null,
    endOffset: 0,
    collapsed: false,
    commonAncestorContainer: null as Node | null,
    setStart(node: Node, offset: number) {
      range.startContainer = node;
      range.startOffset = offset;
    },
    setEnd(node: Node, offset: number) {
      range.endContainer = node;
      range.endOffset = offset;
      const from = parents(range.startContainer);
      const to = parents(node);
      range.commonAncestorContainer = from.filter((step, at) => to[at] === step).pop() ?? null;
    }
  };
  return range;
};
const page = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>The tide in the head</title><style>p { color: tide }</style></head><body>${body}</body></html>`;

/** A book of these pages, a section each. `broken` names sections that will not load. */
const bookOf = (bodies: string[], broken: number[] = []) => {
  const docs = bodies.map((body) => {
    const doc = new DOMParser().parseFromString(page(body), "application/xhtml+xml") as unknown as Document;
    (doc as unknown as { createRange: () => unknown }).createRange = rangeIn;
    return doc;
  });
  const loads: string[] = [];
  const book = {
    load: async (url: string) => {
      loads.push(url);
      const index = Number(url.slice(1));
      if (broken.includes(index)) {
        throw new Error("no");
      }
      return docs[index];
    },
    spine: {
      // As epub.js's Section writes them: the second section's are at /6/4.
      spineItems: bodies.map((_, index) => ({ url: `/${index}`, cfiFromRange: (range: unknown) => new Cfi(range, `/6/${(index + 1) * 2}`).toString() }))
    }
  };
  return { book, docs, loads };
};

/** The words between a range CFI's two ends, read back out of its section by epub.js's own steps; white space run together. */
const wordsAt = (docs: Document[], cfi: string | null | undefined) => {
  const section = sectionOfCfi(cfi);
  if (!cfi || section === null) {
    return null;
  }
  const doc = docs[section];
  type Steps = { index: number; type: string }[];
  const parsed = new EpubCFI(cfi) as unknown as {
    path: { steps: Steps };
    start: { steps: Steps; terminal: { offset: number } };
    end: { steps: Steps; terminal: { offset: number } };
  };
  const walk = (steps: Steps) => {
    // (A CFI's steps start from the root element.)
    let node: Node = doc.documentElement;
    for (const step of steps) {
      const children = Array.from({ length: node.childNodes.length }, (_, at) => node.childNodes[at]);
      node = children.filter((child) => child.nodeType === (step.type === "text" ? 3 : 1))[step.index];
    }
    return node;
  };
  const from = walk([...parsed.path.steps, ...parsed.start.steps]);
  const to = walk([...parsed.path.steps, ...parsed.end.steps]);
  const texts: Node[] = [];
  const gather = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        texts.push(child);
      } else {
        gather(child);
      }
    }
  };
  gather(doc.documentElement);
  const words = texts
    .slice(texts.indexOf(from), texts.indexOf(to) + 1)
    .map((node, at, all) => (node as Text).data.slice(at === 0 ? parsed.start.terminal.offset : 0, at === all.length - 1 ? parsed.end.terminal.offset : undefined));
  // (One node: both ends are in it.)
  const text = from === to ? (from as Text).data.slice(parsed.start.terminal.offset, parsed.end.terminal.offset) : words.join("");
  return text.replace(/\s+/g, " ");
};

const REFRAIN = "The bell rang twice over the water that night.";
const PAGES = [
  `<h1>One</h1><p>The tide kept its own ledger, and <em>nobody</em> read it.</p><p>“Nobody asked the gulls,” said Ines. ${REFRAIN}</p>`,
  `<h1>Two</h1><p>The pilot knew every shoal between the two lights,<sup>3</sup> and he had names for them that were on no chart the harbour office had ever drawn.</p>
   <p>A lamp was lit in the harbour office.</p><p>Ash on the water, and the ferry gone.</p>`,
  `<h1>Three</h1><p>The harbour was quiet.</p>
   <p>The bell was not. ${REFRAIN} Then the lamp went out in the long room, and the salt road lay white under the moon.</p>`
];

describe("clippings found in a book open in epub.js", () => {
  it("are each given a place: a CFI of their own words", async () => {
    const { book, docs, loads } = bookOf(PAGES);
    const placed = await placeInBook(book, [
      { id: "ledger", text: "The tide kept its own ledger, and nobody read it.", location: 10 },
      { id: "gulls", text: "\"Nobody asked the gulls,\" said Ines.", location: 14 },
      { id: "ash", text: "Ash on the water", location: 480 },
      { id: "road", text: "the salt road lay white under the moon", location: 950 }
    ]);
    expect(placed && [...placed.keys()]).toEqual(["ledger", "gulls", "ash", "road"]);
    expect(wordsAt(docs, placed?.get("ledger")?.cfi)).toBe("The tide kept its own ledger, and nobody read it.");
    expect(wordsAt(docs, placed?.get("gulls")?.cfi)).toBe("“Nobody asked the gulls,” said Ines.");
    expect(wordsAt(docs, placed?.get("ash")?.cfi)).toBe("Ash on the water");
    expect(wordsAt(docs, placed?.get("road")?.cfi)).toBe("the salt road lay white under the moon");
    expect([...(placed?.values() ?? [])].map((place) => [place.section, sectionOfCfi(place.cfi)])).toEqual([[0, 0], [0, 0], [1, 1], [2, 2]]);
    expect([...(placed?.values() ?? [])].every((place) => /^epubcfi\(\/6\/\d+!\/4\/.+,.+,.+\)$/.test(place.cfi))).toBe(true);
    // How far down its section each starts: for naming its chapter.
    expect(placed?.get("ledger")?.within).toBeCloseTo(3 / 105, 2);
    expect(placed?.get("road")?.within ?? 0).toBeGreaterThan(0.6);
    // Every section read once, from the file.
    expect(loads).toEqual(["/0", "/1", "/2"]);
  });

  it("are found from one paragraph into the next, and by their two ends round a note's number", async () => {
    const { book, docs } = bookOf(PAGES);
    const placed = await placeInBook(book, [
      { id: "quiet", text: "The harbour was quiet. The bell was not.", location: null },
      { id: "pilot", text: "The pilot knew every shoal between the two lights, and he had names for them that were on no chart the harbour office had ever drawn.", location: null }
    ]);
    expect(wordsAt(docs, placed?.get("quiet")?.cfi)).toBe("The harbour was quiet. The bell was not.");
    expect(wordsAt(docs, placed?.get("pilot")?.cfi)).toBe(
      "The pilot knew every shoal between the two lights,3 and he had names for them that were on no chart the harbour office had ever drawn."
    );
  });

  it("go, when the book has them twice, to the place nearest where the Kindle's location points", async () => {
    const { book } = bookOf(PAGES);
    const where = async (location: number | null, top: number | null) => {
      const cfi = await placePassageInBook(book, REFRAIN, location, { top });
      return sectionOfCfi(cfi);
    };
    // Against the highest location known: early in the book, and late.
    expect(await where(150, 1000)).toBe(0);
    expect(await where(900, 1000)).toBe(2);
    // Nothing to judge by: the first.
    expect(await where(null, 1000)).toBe(0);
    expect(await where(900, null)).toBe(0);
  });

  it("go by the highlights placed round them, when the Kindle was not read to the end", async () => {
    const { book } = bookOf(PAGES);
    // The reader stopped a fifth of the way through this Kindle book: its
    // highest location is 60, and 50 over 60 would point at the book's end.
    const placed = await placeInBook(
      book,
      [
        { id: "refrain", text: REFRAIN, location: 50 },
        { id: "ledger", text: "The tide kept its own ledger", location: 10 },
        { id: "gulls", text: "Nobody asked the gulls", location: 40 }
      ],
      { top: 60 }
    );
    expect(sectionOfCfi(placed?.get("refrain")?.cfi)).toBe(0);
    const alone = await placeInBook(book, [{ id: "refrain", text: REFRAIN, location: 50 }], { top: 60 });
    expect(sectionOfCfi(alone?.get("refrain")?.cfi)).toBe(2);
  });

  it("are placed, when they are a word or two, only where the book has them once", async () => {
    const { book, docs } = bookOf(PAGES);
    const placed = await placeInBook(book, [
      { id: "once", text: "shoal", location: 400 },
      { id: "two-words", text: "salt road", location: 900 },
      { id: "twice", text: "lamp", location: 500 },
      { id: "in-a-word", text: "ledge", location: 10 },
      { id: "many", text: "the", location: 10 }
    ]);
    expect(placed && [...placed.keys()]).toEqual(["once", "two-words"]);
    expect(wordsAt(docs, placed?.get("once")?.cfi)).toBe("shoal");
    expect(wordsAt(docs, placed?.get("two-words")?.cfi)).toBe("salt road");
  });

  it("are left where they were when the book has not got them, or has them across two sections", async () => {
    const { book } = bookOf(PAGES);
    const placed = await placeInBook(book, [
      { id: "gone", text: "A sentence from some other edition of the book.", location: 5 },
      { id: "across", text: "said Ines. The bell rang twice over the water that night. Two The pilot knew every shoal", location: 20 },
      { id: "no-words", text: " … ", location: 30 }
    ]);
    expect(placed).toEqual(new Map());
    expect(await placePassageInBook(book, "A sentence from some other edition of the book.")).toBeNull();
  });

  it("are not placed when the book has them too often for a location to say where", async () => {
    const { book } = bookOf([Array.from({ length: 30 }, () => "<p>And the bell rang again.</p>").join("")]);
    expect(await placePassageInBook(book, "And the bell rang again.", 5, { top: 10 })).toBeNull();
    const fewer = bookOf([Array.from({ length: 6 }, () => "<p>And the bell rang again.</p>").join("")]);
    expect(await placePassageInBook(fewer.book, "And the bell rang again.", 5, { top: 10 })).not.toBeNull();
  });

  it("pass over a section that will not load, and count the book without it", async () => {
    const { book, docs, loads } = bookOf(PAGES, [0]);
    const placed = await placeInBook(book, [
      { id: "ledger", text: "The tide kept its own ledger", location: 10 },
      { id: "refrain", text: REFRAIN, location: 20 }
    ]);
    expect(loads).toHaveLength(3);
    expect(placed && [...placed.keys()]).toEqual(["refrain"]);
    expect(wordsAt(docs, placed?.get("refrain")?.cfi)).toBe(REFRAIN);
  });

  it("give the page a turn after every section, and stop when asked", async () => {
    const { book, loads } = bookOf(PAGES);
    let turns = 0;
    const wanted = [{ id: "ash", text: "Ash on the water", location: 480 }];
    await placeInBook(book, wanted, { pause: async () => void (turns += 1) });
    expect(turns).toBeGreaterThanOrEqual(3);
    // With no time allowed, a turn after every passage too.
    turns = 0;
    await placeInBook(book, [...wanted, { id: "gulls", text: "Nobody asked the gulls", location: 14 }], { sliceMs: -1, pause: async () => void (turns += 1) });
    expect(turns).toBe(9);

    // Closed while the second section was being read: nothing is said, and the third is not opened.
    loads.length = 0;
    const stop = new AbortController();
    const stopped = await placeInBook(book, wanted, {
      signal: stop.signal,
      pause: async () => {
        if (loads.length === 2) {
          stop.abort();
        }
      }
    });
    expect(stopped).toBeNull();
    expect(loads).toEqual(["/0", "/1"]);
    const never = new AbortController();
    never.abort();
    expect(await placeInBook(book, wanted, { signal: never.signal })).toBeNull();
  });

  it("find nothing in no book, and ask nothing of a book when there is nothing to find", async () => {
    const wanted = [{ id: "ash", text: "Ash on the water", location: 480 }];
    expect(await placeInBook(null, wanted)).toEqual(new Map());
    expect(await placeInBook({ spine: { spineItems: [] } }, wanted)).toEqual(new Map());
    const { book, loads } = bookOf(PAGES);
    expect(await placeInBook(book, [])).toEqual(new Map());
    expect(await placeInBook(book, [{ id: "note", text: "", location: 4 }])).toEqual(new Map());
    expect(loads).toEqual([]);
  });
});

const highlight = (id: string, cfi: string, text: string | null, more: Partial<Annotation> = {}): Annotation => ({
  id,
  bookId: "salt",
  kind: "highlight",
  cfi,
  text,
  color: "yellow",
  chapter: null,
  createdAt: "2024-03-04T16:45:32.000Z",
  updatedAt: "2026-10-07T10:00:00Z",
  ...more
});

describe("which highlights are still to look for", () => {
  const all = [
    highlight("own", "epubcfi(/6/4!/4/2,/1:0,/1:5)", "A passage of the book."),
    highlight("k1", "kindle:123", "The tide kept its own ledger."),
    highlight("k2", "kindle:300", "Nobody asked the gulls."),
    highlight("k3", "kindle:h0a1b2c3d", "Die Flut führte ihr eigenes Buch."),
    highlight("note", "kindle:500", null, { note: "Who is the pilot?" }),
    highlight("blank", "kindle:40", "   "),
    { ...highlight("mark", "kindle:900", "A bookmark is no highlight."), kind: "bookmark" as const }
  ];

  it("are those at a Kindle's place that have words, with their locations", () => {
    expect(kindleWanted(all, readTried(null))).toEqual({
      passages: [
        { id: "k1", text: "The tide kept its own ledger.", location: 123 },
        { id: "k2", text: "Nobody asked the gulls.", location: 300 },
        { id: "k3", text: "Die Flut führte ihr eigenes Buch.", location: null }
      ],
      // The highest location of them all: the note's, which is not looked for.
      top: 500
    });
    expect(kindleWanted([all[0]], readTried(null))).toEqual({ passages: [], top: null });
  });

  it("are not those tried before on this device", () => {
    const tried = readTried(writeTried({ ids: new Set(["k1", "k3"]), top: 2000 }));
    expect(tried).toEqual({ ids: new Set(["k1", "k3"]), top: 2000 });
    const wanted = kindleWanted(all, tried);
    expect(wanted.passages.map((one) => one.id)).toEqual(["k2"]);
    // The highest location is remembered from when more of them were at a Kindle's place.
    expect(wanted.top).toBe(2000);
    expect(kindleWanted(all, readTried(writeTried({ ids: new Set(), top: 200 }))).top).toBe(500);
  });

  it("are all of them again when what was kept cannot be read, or was kept by an older way of looking", () => {
    for (const raw of [null, undefined, "", "{", "[]", "7", "{\"v\":1}", "{\"v\":1,\"ids\":\"k1\"}"]) {
      expect(readTried(raw), String(raw)).toEqual({ ids: new Set(), top: null });
    }
    expect(readTried("{\"v\":1,\"ids\":[\"k1\",7,null],\"top\":\"x\"}")).toEqual({ ids: new Set(["k1"]), top: null });
    expect(readTried("{\"v\":0,\"ids\":[\"k1\"],\"top\":640}")).toEqual({ ids: new Set(), top: 640 });
    expect(triedKey("salt")).toBe("leaflet.kindleTried.salt");
  });
});

describe("a Kindle highlight, once it has its place", () => {
  it("is listed by its place among the book's own, under its chapter", () => {
    const compare = (a: string, b: string) => new EpubCFI().compare(a, b);
    const before = [
      highlight("own-late", "epubcfi(/6/8!/4/2,/1:0,/1:5)", "Late in the book.", { chapter: "Three" }),
      highlight("k1", "kindle:300", "From the middle.", { chapter: "Location 300" }),
      highlight("k2", "kindle:20", "Never found.", { chapter: "Location 20" }),
      highlight("own-early", "epubcfi(/6/4!/4/2,/1:0,/1:5)", "Early in the book.", { chapter: "One" })
    ];
    expect(orderHighlights(before, compare).map((item) => item.id)).toEqual(["own-early", "own-late", "k2", "k1"]);
    const after = before.map((item) => (item.id === "k1" ? { ...item, cfi: "epubcfi(/6/6!/4/4,/1:0,/1:16)", chapter: "Two" } : item));
    const ordered = orderHighlights(after, compare);
    expect(ordered.map((item) => item.id)).toEqual(["own-early", "k1", "own-late", "k2"]);
    expect(ordered.map((item) => isKindlePlace(item.cfi))).toEqual([false, false, false, true]);
    expect(groupByChapter(ordered).map((group) => group.chapter)).toEqual(["One", "Two", "Three", "Location 20"]);
  });

  it("is not added again when the same file is imported", async () => {
    const RULE = "==========";
    const entry = (heading: string, body: string) => ["The Salt Road (Voss, Maren)", heading, "", body, RULE].join("\n");
    const at = (where: string) => `- Your Highlight on ${where} | Added on Monday, March 4, 2024 10:15:32 PM`;
    const FILE = `${[
      entry(at("page 12 | Location 123-125"), "The tide kept its own ledger."),
      entry("- Your Note on page 12 | Location 125 | Added on Monday, March 4, 2024 10:16:00 PM", "Like the harbour master."),
      entry(at("Location 300-301"), "A line this edition of the book has not got.")
    ].join("\n")}\n`;
    const library: Book[] = [
      { id: "salt", title: "The Salt Road", author: "Maren Voss", genres: [], coverUrl: null, localPath: "/books/salt.epub", fileHash: "salt", progress: 0, lastOpened: null, createdAt: "2026-01-01T00:00:00Z" }
    ];
    // The preview's store (annotationService keeps annotations there outside the app).
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key)
    });
    try {
      const idsIn = async (bookId: string) => (await annotationService.list(bookId)).map((item) => item.id);
      const first = await planKindleImport(FILE, library, idsIn);
      expect(first.fresh).toHaveLength(2);
      for (const item of first.fresh) {
        await annotationService.save(item);
      }
      // The first is found in the book: saved as the reader saves it, the same row at its new place.
      const { book } = bookOf(PAGES);
      const rows = await annotationService.list("salt");
      const { passages } = kindleWanted(rows, readTried(null));
      const placed = await placeInBook(book, passages);
      expect(placed?.size).toBe(1);
      const row = rows.find((item) => placed?.has(item.id));
      const place = row ? placed?.get(row.id) : undefined;
      expect([row?.cfi, row?.chapter, row?.note]).toEqual(["kindle:123", "Page 12", "Like the harbour master."]);
      if (!row || !place) {
        throw new Error("the first clipping was not placed");
      }
      const { createdAt: _c, updatedAt: _u, deletedAt: _d, ...input } = row;
      await annotationService.save({ ...input, cfi: place.cfi, chapter: "One" });
      const before = stored.get("leaflet.annotations.preview");

      const again = await planKindleImport(FILE, library, idsIn);
      expect(again.fresh).toEqual([]);
      expect([again.books, again.had]).toEqual([0, 2]);
      expect(stored.get("leaflet.annotations.preview")).toBe(before);
      const now = await annotationService.list("salt");
      expect(now).toHaveLength(2);
      const kept = now.find((item) => item.id === row.id);
      // The same id, the Kindle's date, its note and colour; a place of its own and its chapter's name.
      expect(kept).toMatchObject({ id: row.id, text: "The tide kept its own ledger.", note: "Like the harbour master.", color: "yellow", chapter: "One" });
      expect(kept?.createdAt).toBe(new Date(2024, 2, 4, 22, 15, 32).toISOString());
      expect(kept?.cfi).toBe(place.cfi);
      expect(isKindlePlace(kept?.cfi)).toBe(false);
      // The one not found is as it was, and is the only one still to look for.
      expect(now.filter((item) => isKindlePlace(item.cfi)).map((item) => item.cfi)).toEqual(["kindle:300"]);
      expect(kindleWanted(now, readTried(null)).passages.map((one) => one.text)).toEqual(["A line this edition of the book has not got."]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
