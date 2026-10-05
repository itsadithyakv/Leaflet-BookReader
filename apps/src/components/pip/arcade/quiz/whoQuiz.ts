/**
 * "Who is this?": the quiz's second mode, made from the reader's character
 * sheets (readers/people). Pip names someone and offers four of the reader's
 * own notes; one of them is about that person.
 *
 * It can never spoil. Everyone named and every note offered comes through
 * `castAt` at the book's saved progress, the same rule a character's card is
 * held to: only what is stamped at or before the place the reader has reached
 * in that book. A person not yet met is not asked about, a note from further
 * on is not offered, not even as a wrong answer.
 *
 * Pure: the sheets and the seed are handed in.
 */
import { castAt, type Entry } from "../../../../readers/people/model";
import { ROUND, OPTIONS, distinct, laidOut, seededRandom, shuffled, type Question } from "./round";

/** A book's sheet, and how far the book has been read (0..1). */
export type Sheet = { bookId: string; title: string; progress: number; entries: Entry[] };

export type KnownPerson = { id: string; name: string; bookId: string; book: string; notes: string[] };

/** People with a note, so that every answer has three others to stand beside. */
export const MIN_PEOPLE = 4;
/** A note is offered at this length at most: an answer to pick, not a page to read. */
const NOTE_CHARS = 140;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string) => (text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS - 1).trimEnd()}…` : text);

/** Everyone the reader has met and written a note about, book by book, as far as each book has been read. */
export const knownPeople = (sheets: Sheet[]): KnownPerson[] => {
  const people: KnownPerson[] = [];
  for (const sheet of sheets) {
    const progress = Number.isFinite(sheet.progress) ? Math.min(1, Math.max(0, sheet.progress)) : 0;
    // No CFI is given, so places are compared by how far through the book they are: the saved progress.
    for (const person of castAt(sheet.entries, { progress }).people) {
      const notes = distinct(person.notes.map((note) => clip(tidy(note.text))), [], Number.MAX_SAFE_INTEGER);
      if (person.name && notes.length > 0) {
        people.push({ id: person.id, name: person.name, bookId: sheet.bookId, book: sheet.title, notes });
      }
    }
  }
  return people;
};

/**
 * A round: up to ten of the people known, each with four notes to choose
 * from. The wrong notes are about other people, those of the same book
 * first. Empty with fewer than four people (the mode is then not offered).
 */
export const buildWhoRound = (people: KnownPerson[], seed: number): Question[] => {
  if (people.length < MIN_PEOPLE) {
    return [];
  }
  const random = seededRandom(seed);
  const questions: Question[] = [];
  for (const person of shuffled(people, random)) {
    if (questions.length >= ROUND) {
      break;
    }
    const right = person.notes[Math.floor(random() * person.notes.length)];
    const others = people.filter((other) => !(other.id === person.id && other.bookId === person.bookId));
    const near = shuffled(others.filter((other) => other.bookId === person.bookId), random);
    const far = shuffled(others.filter((other) => other.bookId !== person.bookId), random);
    // One note from each other person in turn, so the three are about three people where they can be.
    const offered = [...near, ...far].map((other) => other.notes[Math.floor(random() * other.notes.length)]);
    const spare = shuffled([...near, ...far].flatMap((other) => other.notes), random);
    // Nothing that is also true of this person is a wrong answer.
    const wrong = distinct([...offered, ...spare], person.notes, OPTIONS - 1);
    if (wrong.length < OPTIONS - 1) {
      continue;
    }
    questions.push({ id: person.id, way: "who", prompt: person.name, context: person.book, ...laidOut(right, wrong, random) });
  }
  return questions;
};
