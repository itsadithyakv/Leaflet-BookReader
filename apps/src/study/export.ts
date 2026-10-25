/**
 * A book's cards as a CSV file that flashcard apps import (Anki, Quizlet,
 * RemNote): one card a row, `front,back,book,place`, every field quoted
 * (RFC 4180), lines ended CRLF, and a byte order mark so that a spreadsheet
 * reads it as UTF-8. A picture card goes as its text only: which picture and
 * which box on the front, what is under it on the back.
 *
 * Pure.
 */
import type { StudyCard } from "./cards";
import { blanked } from "./fillIn";

const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Where a card is in its book, as words: its chapter or page, and how far through. */
export const placeLabel = (card: StudyCard) => {
  const page = card.at.cfi?.startsWith("pdf:") ? Number(card.at.cfi.slice(4).split(":")[0]) : NaN;
  return [card.at.chapter, Number.isInteger(page) && page > 0 ? `Page ${page}` : null, card.at.p > 0 ? `${Math.round(card.at.p * 100)}%` : null]
    .filter(Boolean)
    .join(" · ");
};

/** A card's two sides as text. `boxOf` numbers a picture's boxes ("box 2 of 5"). */
export const sides = (card: StudyCard, boxOf: (card: StudyCard) => { at: number; of: number } = () => ({ at: 1, of: 1 })) => {
  if (card.kind === "fill") {
    return { front: blanked(card.passage, card.hidden), back: card.passage };
  }
  if (card.kind === "ask") {
    return { front: card.question, back: card.answer };
  }
  const { at, of } = boxOf(card);
  const where = card.picture.kind === "pdf" ? `the picture on page ${card.picture.page}` : "the picture";
  return { front: `What is under box ${at}${of > 1 ? ` of ${of}` : ""} on ${where}?`, back: card.label || "(not written)" };
};

/** The boxes of each picture in the order they were drawn, so the export can number them. */
export const boxNumbers = (cards: StudyCard[]) => {
  const groups = new Map<string, string[]>();
  for (const card of [...cards].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (card.kind === "pic") {
      groups.set(card.group, [...(groups.get(card.group) ?? []), card.id]);
    }
  }
  return (card: StudyCard) => {
    const ids = card.kind === "pic" ? groups.get(card.group) ?? [card.id] : [card.id];
    return { at: Math.max(0, ids.indexOf(card.id)) + 1, of: ids.length };
  };
};

export const cardsCsv = (cards: StudyCard[], bookTitle: string) => {
  const number = boxNumbers(cards);
  const rows = [["front", "back", "book", "place"]];
  // In the book's order, as the reader met them.
  const inOrder = [...cards].sort((a, b) => a.at.p - b.at.p || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const card of inOrder) {
    const { front, back } = sides(card, number);
    rows.push([front, back, bookTitle, placeLabel(card)]);
  }
  return `﻿${rows.map((row) => row.map(quoted).join(",")).join("\r\n")}\r\n`;
};

/** A file name from the book's title: letters, digits and dashes. */
export const csvName = (bookTitle: string) =>
  `${
    bookTitle
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "book"
  }-cards.csv`;
