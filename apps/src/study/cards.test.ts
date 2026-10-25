import { describe, expect, it } from "vitest";
import {
  askInput, cardsOf, fillInput, fromRow, inputOf, pictureInput, rectFrom, rectTo, reviewed, saved,
  type CardInput, type CardPlace, type CardRow, type PictureCard
} from "./cards";
import { answered, isDue, REST_DAYS } from "../components/pip/arcade/quiz/boxes";

const NOW = "2026-10-25T10:00:00.000Z";
const LATER = "2026-10-26T10:00:00.000Z";
const place: CardPlace = { bookId: "b1", cfi: "epubcfi(/6/8!/4/2,/1:0,/1:31)", chapter: "The heart", p: 0.31234567 };
const passage = "The mitral valve has two cusps.";

/** What a save would leave, read back as a card. */
const made = (input: CardInput, existing: CardRow | null = null, now = NOW) => {
  const row = saved(existing, input, now);
  return { row, card: fromRow(row) };
};

describe("making each kind of card", () => {
  it("a fill-in card keeps the passage, the words hidden, the highlight and the place", () => {
    const { row, card } = made(fillInput(place, passage, [[25, 30], [4, 10]], "h1", "card:f"));
    expect(row.kind).toBe("card");
    expect(row.note).toBeNull();
    expect(JSON.parse(row.text ?? "")).toEqual({ t: "fill", s: passage, x: [[4, 10], [25, 30]], h: "h1", p: 0.312346 });
    expect(card).toMatchObject({
      kind: "fill",
      bookId: "b1",
      passage,
      hidden: [[4, 10], [25, 30]],
      highlightId: "h1",
      at: { cfi: place.cfi, chapter: "The heart", p: 0.312346 },
      box: 0,
      due: null
    });
  });

  it("a question card keeps the reader's question, and the highlight as its answer", () => {
    const { row, card } = made(askInput(place, "  How many   cusps? ", "Two.", "h1", "card:a"));
    expect(row.note).toBe("How many cusps?");
    expect(card).toMatchObject({ kind: "ask", question: "How many cusps?", answer: "Two.", highlightId: "h1" });
  });

  it("a picture card keeps where its picture is and its box, never the picture", () => {
    const box = { left: 0.1, top: 0.2, width: 0.15, height: 0.04 };
    const crop = { left: 0.05, top: 0.05, width: 0.9, height: 0.6 };
    const { row, card } = made(pictureInput({ ...place, cfi: "pdf:12" }, { kind: "pdf", page: 12 }, box, " Femur ", "g1", crop, "card:p"));
    const detail = JSON.parse(row.text ?? "");
    expect(detail).toEqual({ t: "pic", i: "pdf:12", m: [1000, 2000, 1500, 400], g: "g1", r: [500, 500, 9000, 6000], a: "Femur", p: 0.312346 });
    expect((row.text ?? "").length).toBeLessThan(200);
    const picture = card as PictureCard;
    expect(picture.picture).toEqual({ kind: "pdf", page: 12 });
    expect(picture.mask).toEqual(box);
    expect(picture.crop).toEqual(crop);
    expect(picture.label).toBe("Femur");
    // An EPUB's picture is its path in the archive.
    const epub = made(pictureInput(place, { kind: "epub", path: "OEBPS/images/heart.png" }, box, "", "g2", null, "card:e")).card as PictureCard;
    expect(epub.picture).toEqual({ kind: "epub", path: "OEBPS/images/heart.png" });
    expect(epub.crop).toBeNull();
    expect(epub.label).toBe("");
  });

  it("what cannot be a card is refused, and a row that cannot be read is left out", () => {
    expect(() => saved(null, fillInput(place, passage, [], null, "card:x"), NOW)).toThrow();
    expect(() => saved(null, askInput(place, " ", "Two.", null, "card:x"), NOW)).toThrow();
    expect(() => saved(null, { ...fillInput(place, passage, [[4, 10]], null), id: "h1" }, NOW)).toThrow();
    expect(() => saved({ ...made(fillInput(place, passage, [[4, 10]], null, "card:x")).row, kind: "highlight" }, fillInput(place, passage, [[4, 10]], null, "card:x"), NOW)).toThrow();
    const odd: CardRow = { id: "card:z", bookId: "b1", kind: "card", text: '{"t":"essay"}', createdAt: NOW, updatedAt: NOW };
    const notACard: CardRow = { ...odd, kind: "highlight", text: "words" };
    const broken: CardRow = { ...odd, text: '{"t":"fill","s":"abc","x":[[2,9]]}' };
    const good = made(fillInput(place, passage, [[4, 10]], null, "card:g")).row;
    expect(cardsOf([odd, notACard, broken, good]).map((card) => card.id)).toEqual(["card:g"]);
    expect(cardsOf([{ ...good, deletedAt: LATER }])).toEqual([]);
  });

  it("an edit keeps the review's box and what a later version wrote, and changes the rest", () => {
    const first = made(askInput(place, "How many cusps?", "Two.", "h1", "card:a")).row;
    const asked = reviewed(first, { id: "card:a", box: 3, due: 20_400 }, NOW);
    const withExtra = { ...asked, text: JSON.stringify({ ...JSON.parse(asked.text ?? ""), future: 1 }) };
    const card = fromRow(withExtra);
    expect(card).not.toBeNull();
    const edited = saved(withExtra, { ...inputOf(card!), question: "Mitral valve: cusps?" }, LATER);
    expect(JSON.parse(edited.text ?? "")).toMatchObject({ b: 3, d: 20_400, future: 1, s: "Two." });
    expect(fromRow(edited)).toMatchObject({ question: "Mitral valve: cusps?", box: 3, due: 20_400, createdAt: NOW, updatedAt: LATER });
    // A removed card is not edited back to life.
    expect(() => saved({ ...edited, deletedAt: LATER }, inputOf(fromRow(edited)!), LATER)).toThrow();
  });

  it("rects go to ten-thousandths and back, always inside the picture", () => {
    expect(rectTo({ left: 0.99995, top: -0.2, width: 0.5, height: 0 })).toEqual([9999, 0, 1, 1]);
    expect(rectFrom([9999, 0, 1, 1])).toEqual({ left: 0.9999, top: 0, width: 0.0001, height: 0.0001 });
    expect(rectFrom([9000, 0, 2000, 10])).toBeNull();
    expect(rectFrom([0, 0, 0, 10])).toBeNull();
    expect(rectFrom("0,0,1,1")).toBeNull();
  });
});

describe("reviewing cards: the word quiz's boxes and rest days", () => {
  const today = 20_386;
  const card = fromRow(made(fillInput(place, passage, [[4, 10]], null, "card:f")).row)!;

  it("a new card is due, a right answer moves it up a box and rests it, a wrong one back to the first", () => {
    expect(isDue(card, today)).toBe(true);
    const right = answered(card, true, today);
    expect(right).toEqual({ id: "card:f", box: 1, due: today + REST_DAYS[1] });
    const row = reviewed(made(fillInput(place, passage, [[4, 10]], null, "card:f")).row, right, NOW);
    const after = fromRow(row)!;
    expect(isDue(after, today)).toBe(false);
    expect(isDue(after, today + 1)).toBe(true);
    // Up again from box 1, and from the top box it stays there.
    expect(answered(after, true, today + 1)).toEqual({ id: "card:f", box: 2, due: today + 1 + REST_DAYS[2] });
    expect(answered({ ...after, box: 5 }, true, today)).toEqual({ id: "card:f", box: 5, due: today + REST_DAYS[5] });
    expect(answered({ ...after, box: 4 }, false, today)).toEqual({ id: "card:f", box: 0, due: today });
    expect(() => reviewed(row, { id: "card:f", box: 6, due: today }, NOW)).toThrow();
    expect(() => reviewed({ ...row, deletedAt: NOW }, right, NOW)).toThrow();
  });
});
