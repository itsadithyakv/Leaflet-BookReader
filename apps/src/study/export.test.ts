import { describe, expect, it } from "vitest";
import { askInput, fillInput, fromRow, pictureInput, saved, type CardInput, type StudyCard } from "./cards";
import { cardsCsv, csvName, placeLabel } from "./export";

const at = (input: CardInput, createdAt: string): StudyCard => fromRow(saved(null, input, createdAt))!;
const place = (p: number, chapter: string | null = "The heart", cfi: string | null = "epubcfi(/6/8!/4/2)") => ({ bookId: "b1", cfi, chapter, p });

describe("a book's cards as CSV", () => {
  const box = { left: 0.1, top: 0.1, width: 0.1, height: 0.1 };
  const cards = [
    at(askInput(place(0.5), 'What is the "lub" sound?', "The closing of the mitral and\ntricuspid valves.", null, "card:a"), "2026-10-25T10:00:01.000Z"),
    at(fillInput(place(0.2), "The mitral valve has two cusps.", [[4, 10], [21, 24]], null, "card:f"), "2026-10-25T10:00:00.000Z"),
    at(pictureInput(place(0.8, null, "pdf:12"), { kind: "pdf", page: 12 }, box, "Femur", "g", null, "card:p1"), "2026-10-25T10:00:02.000Z"),
    at(pictureInput(place(0.8, null, "pdf:12"), { kind: "pdf", page: 12 }, box, "", "g", null, "card:p2"), "2026-10-25T10:00:03.000Z")
  ];
  const csv = cardsCsv(cards, "Gray's Anatomy");
  const lines = csv.split("\r\n");

  it("has the four columns, quoted, with a byte order mark for spreadsheets", () => {
    expect(csv.startsWith('﻿"front","back","book","place"\r\n')).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("is in the book's order, a fill-in card's blanks [...] and its passage the back", () => {
    expect(lines[1]).toBe('"The [...] valve has [...] cusps.","The mitral valve has two cusps.","Gray\'s Anatomy","The heart · 20%"');
  });

  it("quotes what needs it: quotation marks doubled, a line break kept inside the field", () => {
    expect(csv).toContain('"What is the ""lub"" sound?","The closing of the mitral and\ntricuspid valves.","Gray\'s Anatomy","The heart · 50%"');
  });

  it("gives a picture card as its text only, its boxes numbered", () => {
    expect(csv).toContain('"What is under box 1 of 2 on the picture on page 12?","Femur","Gray\'s Anatomy","Page 12 · 80%"');
    expect(csv).toContain('"What is under box 2 of 2 on the picture on page 12?","(not written)"');
    expect(csv).not.toContain("data:");
  });

  it("names its file from the book", () => {
    expect(csvName("Gray's Anatomy: The Anatomical Basis")).toBe("gray-s-anatomy-the-anatomical-basis-cards.csv");
    expect(csvName("???")).toBe("book-cards.csv");
    expect(placeLabel(cards[0])).toBe("The heart · 50%");
  });
});
