import { describe, expect, it } from "vitest";
import type { DayRecord, FocusSessionRecord } from "../../services/habitService";
import { diaryEntries, entryFor, minutesText, quoteOf } from "./entry";
import { diaryFacts, shortTitle, type Clock, type DiaryBookRow, type DiaryMarkRow, type DiarySource } from "./facts";
import { dayKey, dayNumber, dealt } from "./seed";
import { ASIDES, LEADS, type Slots } from "./templates";
import { diaryWeeks, weekStart, weekSummary } from "./week";

/** Times in these tests are written as the reader's own clock reads. */
const clock: Clock = (iso) => (/^\d{4}-\d{2}-\d{2}T\d{2}/.test(iso) ? { dateKey: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) } : null);

const day = (dateKey: string, minutes: number, extra: Partial<DayRecord> = {}): DayRecord => ({
  dateKey,
  minutes,
  goalMinutes: 20,
  freezeUsed: false,
  graceUsed: false,
  ...extra
});

const session = (id: string, dateKey: string, minutes: number, extra: Partial<FocusSessionRecord> = {}): FocusSessionRecord => ({
  id,
  startedAt: `${dateKey}T19:00:00`,
  endedAt: `${dateKey}T19:40:00`,
  dateKey,
  minutes,
  bookId: "b1",
  title: "Mistborn: The Final Empire",
  notes: null,
  endedReason: "completed",
  clean: true,
  styleSeed: id,
  burnedAt: null,
  ...extra
});

const MISTBORN: DiaryBookRow = { id: "b1", title: "Mistborn: The Final Empire", author: "Brandon Sanderson", progress: 0.42, progressUpdatedAt: "2026-10-03T20:00:00", lastOpened: "2026-10-03T19:00:00" };

const mark = (id: string, kind: string, words: string, createdAt: string, extra: Partial<DiaryMarkRow> = {}): DiaryMarkRow => ({
  id,
  bookId: "b1",
  kind,
  words,
  detail: kind === "person" ? '{"p":0.1}' : null,
  chapter: "Chapter 4",
  hasPlace: true,
  createdAt,
  ...extra
});

const source = (partial: Partial<DiarySource>): DiarySource => ({ days: [], sessions: [], freeReads: [], books: [], marks: [], ...partial });

/** `count` days in a row from `from`, each read for `minutes(index)`. */
const run = (from: string, count: number, minutes: (index: number) => number) =>
  Array.from({ length: count }, (_, index) => day(dayKey(dayNumber(from) + index), minutes(index)));

const SAMPLE: Slots = {
  mins: "34 minutes",
  title: "mistborn",
  of: " of mistborn",
  book: "mistborn",
  name: "vin",
  quote: "the mists were out",
  chapter: "chapter 4",
  word: "brume",
  run: 7,
  sessions: 2,
  percent: 42,
  nod: "push the coin, fly the pip."
};

describe("the diary's dice", () => {
  it("deals every line of a pool before any comes round again, and never the same two days running", () => {
    for (let n = 2; n <= 12; n += 1) {
      let before = -1;
      for (let d = 20_000; d < 20_600; d += 1) {
        const index = dealt("pool", n, d);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(n);
        expect(index, `n=${n} day=${d}`).not.toBe(before);
        before = index;
      }
      if (n >= 3) {
        const deal = Array.from({ length: n }, (_, index) => dealt("pool", n, 20_300 - (20_300 % n) + index));
        expect(new Set(deal).size).toBe(n);
      }
    }
    expect(dealt("pool", 1, 20_000)).toBe(0);
    expect(dealt("pool", 5, Number.NaN)).toBe(0);
  });

  it("turns a day into a number and back", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayKey(dayNumber("2026-10-04"))).toBe("2026-10-04");
    expect(dayKey(dayNumber("2024-02-29") + 1)).toBe("2024-03-01");
    expect(Number.isNaN(dayNumber("yesterday"))).toBe(true);
  });
});

describe("what a day holds", () => {
  it("has no entry before the first day read, and none at all with nothing read", () => {
    expect(diaryFacts(source({}), "2026-10-04", clock)).toEqual({ first: null, days: [] });
    expect(diaryEntries(diaryFacts(source({ days: [day("2026-10-01", 0.4)] }), "2026-10-04", clock), "2026-10-04")).toEqual([]);

    const facts = diaryFacts(source({ days: [day("2026-09-28", 0), day("2026-10-01", 12), day("2026-10-03", 25)] }), "2026-10-04", clock);
    expect(facts.first).toBe("2026-10-01");
    expect(facts.days.map((entry) => entry.dateKey)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(facts.days.map((entry) => entry.read)).toEqual([true, false, true, false]);
    expect(facts.days[0].first).toBe(true);
    expect(facts.days[2].first).toBe(false);
    // A day in the ledger past today (a clock set back) is not written about.
    expect(diaryFacts(source({ days: [day("2026-10-09", 30)] }), "2026-10-04", clock).days).toEqual([]);
  });

  it("knows the book from a session, from a mark, from where the bookmark moved, and last from what was opened", () => {
    const facts = diaryFacts(
      source({
        days: run("2026-10-01", 4, () => 25),
        sessions: [session("s1", "2026-10-01", 20), session("s2", "2026-10-01", 4, { bookId: null, title: "Dune" })],
        books: [MISTBORN, { id: "b2", title: "Emma", progress: 0.1, progressUpdatedAt: null, lastOpened: "2026-10-04T08:00:00" }],
        marks: [mark("h1", "highlight", "The mists were out.", "2026-10-02T21:00:00")]
      }),
      "2026-10-04",
      clock
    );
    const titles = facts.days.map((entry) => entry.books.map((book) => book.title));
    expect(titles).toEqual([["Mistborn", "Dune"], ["Mistborn"], ["Mistborn"], ["Emma"]]);
    // Where the bookmark was left is known for the day the book last moved, and no other.
    expect(facts.days.map((entry) => entry.books[0].percent)).toEqual([null, null, 42, null]);
    expect(facts.days[0].books[0].minutes).toBe(20);
    expect(facts.days[0].focus).toEqual({ count: 2, minutes: 24, clean: 2 });
    // She knows this one.
    expect(facts.days[0].books[0].nod).toMatch(/coin|rules/);
  });

  it("counts the streak as the ledger does, covered days included", () => {
    const facts = diaryFacts(
      source({
        days: [
          day("2026-10-01", 25),
          day("2026-10-02", 25),
          day("2026-10-03", 0, { freezeUsed: true }),
          day("2026-10-04", 30),
          day("2026-10-05", 5),
          ...run("2026-10-06", 6, () => 22)
        ]
      }),
      "2026-10-11",
      clock
    );
    expect(facts.days.map((entry) => entry.run)).toEqual([1, 2, 3, 4, 0, 1, 2, 3, 4, 5, 6]);
    expect(facts.days.map((entry) => entry.covered).slice(0, 4)).toEqual([null, null, "freeze", null]);
    // A first streak beats nothing; the second passes it on its fifth day, once.
    expect(facts.days.map((entry) => entry.record)).toEqual([false, false, false, false, false, false, false, false, false, true, false]);
    // A milestone is a day read: the freeze that made it three is not one.
    expect(facts.days.map((entry) => entry.milestone)).toEqual([false, false, false, false, false, false, false, true, false, false, false]);
    expect(facts.days.map((entry) => entry.gap).slice(0, 6)).toEqual([0, 1, 0, 2, 1, 1]);
  });

  it("names only a character the reader wrote down at a place they have read", () => {
    const at = "2026-10-03T20:00:00";
    const facts = diaryFacts(
      source({
        days: [day("2026-10-03", 30)],
        books: [MISTBORN],
        marks: [
          mark("p1", "person", "Vin", at),
          // Further on than the book has been read (a friend's sheet, brought in).
          mark("p2", "person", "The Lord Ruler's Secret", at, { detail: '{"p":0.9}' }),
          // Carried from the book before, and one with no exact place.
          mark("p3", "person", "Kelsier", at, { detail: '{"p":0,"from":"b0"}' }),
          mark("p4", "person", "Sazed", at, { hasPlace: false }),
          // A book that is not in the library cannot be shown to have been read.
          mark("p5", "person", "Elend", at, { bookId: "gone" }),
          mark("p6", "person", "Breeze", at, { detail: "not json" }),
          mark("n1", "person.note", "a thief", at)
        ]
      }),
      "2026-10-03",
      clock
    );
    expect(facts.days[0].people).toEqual([{ name: "Vin", book: "Mistborn" }]);
  });

  it("hears the hour: a night owl, an early bird", () => {
    const facts = diaryFacts(
      source({
        days: run("2026-10-01", 3, () => 25),
        sessions: [session("s1", "2026-10-01", 20, { startedAt: "2026-10-01T23:20:00", endedAt: "2026-10-01T23:45:00" })],
        marks: [mark("h1", "highlight", "words", "2026-10-02T05:30:00"), mark("h2", "highlight", "words", "2026-10-03T14:00:00")]
      }),
      "2026-10-03",
      clock
    );
    expect(facts.days.map((entry) => [entry.late, entry.early])).toEqual([[true, false], [false, true], [false, false]]);
  });

  it("writes a title as Pip would", () => {
    expect(shortTitle("Mistborn: The Final Empire (Mistborn, #1)")).toBe("Mistborn");
    expect(shortTitle("The Way of Kings - Book One")).toBe("The Way of Kings");
    expect(shortTitle("  Emma ")).toBe("Emma");
    expect(shortTitle("Spider-Man")).toBe("Spider-Man");
    expect(shortTitle("")).toBeNull();
    expect(shortTitle(null)).toBeNull();
    expect((shortTitle("x".repeat(80)) as string).length).toBeLessThanOrEqual(44);
  });
});

describe("a day's entry", () => {
  const rich = () =>
    source({
      days: run("2026-09-01", 34, (index) => 20 + (index % 9)),
      sessions: [session("s1", "2026-10-03", 20)],
      books: [MISTBORN],
      marks: [mark("p1", "person", "Vin", "2026-10-03T20:00:00"), mark("h1", "highlight", "The mists were out, and with them came everything else.", "2026-10-02T20:00:00")]
    });

  it("reads the same every time, on every device", () => {
    const first = diaryEntries(diaryFacts(rich(), "2026-10-04", clock), "2026-10-04");
    // Another device: the same records, listed another way round.
    const other = rich();
    other.days.reverse();
    other.marks.reverse();
    const second = diaryEntries(diaryFacts(other, "2026-10-04", clock), "2026-10-04");
    expect(second).toEqual(first);
    const facts = diaryFacts(rich(), "2026-10-04", clock);
    const one = facts.days[10];
    expect(entryFor(one)).toEqual(entryFor({ ...one }));
    // A day gone by reads the same tomorrow.
    const later = diaryEntries(diaryFacts(rich(), "2026-10-09", clock), "2026-10-09");
    expect(later.slice(0, first.length - 1)).toEqual(first.slice(0, -1));
  });

  it("is about that day: the minutes, the book, a character, a highlight", () => {
    const entries = diaryEntries(diaryFacts(rich(), "2026-10-04", clock), "2026-10-04");
    const third = entries.find((entry) => entry.dateKey === "2026-10-03");
    expect(third?.text).toContain("Mistborn");
    expect(third?.text).toMatch(/\b2[0-9] minutes\b/);
    expect(third?.parts.map((part) => part.kind)).toContain("person");
    expect(third?.text).toContain("Vin");
    const second = entries.find((entry) => entry.dateKey === "2026-10-02");
    expect(second?.parts.map((part) => part.kind)).toContain("highlight");
    expect(second?.text).toContain("“The mists were out, and with them…”");
    expect(entries[0].kind).toBe("first");
    expect(entries[0].text).toMatch(/20 minutes/);
  });

  it("never uses a line two days running", () => {
    // A year of ordinary days, every one with a book, a session, a streak and a highlight.
    const from = "2025-10-01";
    const days = run(from, 366, (index) => 21 + (index % 30));
    const sessions = days.map((entry, index) => session(`s${index}`, entry.dateKey, 20));
    const marks = days.map((entry, index) => mark(`h${index}`, index % 2 ? "highlight" : "word", index % 2 ? "A line worth keeping, more or less." : "brume", `${entry.dateKey}T12:00:00`));
    const entries = diaryEntries(diaryFacts(source({ days, sessions, books: [MISTBORN], marks }), dayKey(dayNumber(from) + 365), clock), dayKey(dayNumber(from) + 365));
    expect(entries).toHaveLength(366);
    for (let index = 1; index < entries.length; index += 1) {
      const before = new Set(entries[index - 1].parts.map((part) => part.id));
      for (const part of entries[index].parts) {
        expect(before.has(part.id), `${entries[index].dateKey}: ${part.id}`).toBe(false);
      }
      expect(entries[index].text).not.toBe(entries[index - 1].text);
    }
    // Most of the pool gets used: the date really does deal them out.
    expect(new Set(entries.filter((entry) => entry.kind === "book").map((entry) => entry.parts[0].id)).size).toBe(LEADS.book.length);
  });

  it("never uses a line on two days read in a row either, with days off between them", () => {
    const from = dayNumber("2025-10-01");
    const days = Array.from({ length: 200 }, (_, index) => day(dayKey(from + index * 3), 25));
    const today = dayKey(from + 199 * 3);
    const entries = diaryEntries(diaryFacts(source({ days }), today, clock), today);
    const read = entries.filter((entry) => !entry.rest);
    const rest = entries.filter((entry) => entry.rest);
    expect(read).toHaveLength(200);
    expect(rest).toHaveLength(398);
    for (const list of [read, entries]) {
      for (let index = 1; index < list.length; index += 1) {
        const before = new Set(list[index - 1].parts.map((part) => part.id));
        expect(list[index].parts.some((part) => before.has(part.id)), list[index].dateKey).toBe(false);
      }
    }
  });

  it("makes sense with almost nothing known", () => {
    // No book, no session, no goal, a first day, a minute.
    const bare = diaryFacts(source({ days: [day("2026-10-01", 1, { goalMinutes: 0 }), day("2026-10-02", 2.9), day("2026-10-03", 240)] }), "2026-10-04", clock);
    const entries = diaryEntries(bare, "2026-10-04");
    expect(entries.map((entry) => entry.kind)).toEqual(["first", "tiny", "big", "yet"]);
    expect(entries[0].text).toContain("1 minute");
    expect(entries[0].text).not.toContain("1 minutes");
    expect(entries[1].text).toContain("2 minutes");
    expect(entries[2].text).toContain("4 hours");
    for (const entry of entries) {
      expect(entry.text).not.toMatch(/undefined|null|NaN|\bof\s*[.,]|\s{2,}|“”/);
      expect(entry.text.length).toBeGreaterThan(10);
      expect(entry.text.length).toBeLessThan(260);
    }
    expect(entries[3].rest).toBe(true);
    expect(entries[3].parts).toHaveLength(1);
  });

  it("says a day off was a day off, and says what covered the streak", () => {
    const facts = diaryFacts(
      source({ days: [day("2026-10-01", 25), day("2026-10-02", 0, { graceUsed: true }), day("2026-10-03", 25), day("2026-10-05", 0, { freezeUsed: true }), day("2026-10-06", 25)] }),
      "2026-10-07",
      clock
    );
    const entries = diaryEntries(facts, "2026-10-07");
    expect(entries.map((entry) => entry.kind)).toEqual(["first", "rest", "book", "rest", "rest", "book", "yet"].map((kind) => (kind === "book" ? "read" : kind)));
    expect(entries[1].parts.map((part) => part.kind)).toEqual(["rest", "grace"]);
    expect(entries[3].parts.map((part) => part.kind)).toEqual(["rest"]);
    expect(entries[4].parts.map((part) => part.kind)).toEqual(["rest", "freeze"]);
    // Today, with nothing read yet, is not a day off.
    expect(entryFor(facts.days[6], { today: true }).kind).toBe("yet");
    expect(entryFor(facts.days[6]).kind).toBe("rest");
  });

  it("marks the big days: a book finished, a return, a milestone", () => {
    const facts = diaryFacts(
      source({
        days: [...run("2026-09-20", 3, () => 25), day("2026-10-03", 30)],
        books: [{ ...MISTBORN, progress: 1 }]
      }),
      "2026-10-03",
      clock
    );
    const entries = diaryEntries(facts, "2026-10-03");
    const last = entries[entries.length - 1];
    expect(last.kind).toBe("finished");
    expect(last.text).toContain("Mistborn");
    expect(last.parts.map((part) => part.kind)).not.toContain("percent");
    expect(entries[2].parts.map((part) => part.kind)).toContain("milestone");
    expect(entries[2].text).toContain("3");

    const back = diaryFacts(source({ days: [day("2026-09-20", 25), day("2026-10-03", 30)] }), "2026-10-03", clock);
    expect(entryFor(back.days[back.days.length - 1]).kind).toBe("back");
  });

  it("quotes a few words of a highlight, not the passage", () => {
    expect(quoteOf("The mists were out.")).toBe("The mists were out.");
    expect(quoteOf("“The mists were out, and with them came everything else that night.”")).toBe("The mists were out, and with them…");
    expect(quoteOf("  spaced \n out,  ")).toBe("spaced out");
    expect(quoteOf("x".repeat(200))).toBe(`${"x".repeat(56)}…`);
    expect(quoteOf("   ")).toBe("");
    expect(minutesText(1)).toBe("1 minute");
    expect(minutesText(59.9)).toBe("59 minutes");
    expect(minutesText(60)).toBe("1 hour");
    expect(minutesText(125)).toBe("2 hours 5 minutes");
  });
});

describe("Pip's lines", () => {
  const all = [...Object.entries(LEADS), ...Object.entries(ASIDES)];

  it("are in her voice: lower case, short, and never counting pages", () => {
    for (const [kind, pool] of all) {
      expect(pool.length, kind).toBeGreaterThanOrEqual(kind === "nod" ? 1 : 3);
      for (const line of pool) {
        for (const slots of [SAMPLE, { ...SAMPLE, title: null, of: "", book: "the book", chapter: null, sessions: 1 }]) {
          const text = line(slots);
          expect(text, kind).toBe(text.toLowerCase());
          expect(text.length, text).toBeLessThan(140);
          expect(text, kind).not.toMatch(/\d+ pages?\b|\bpages read\b|undefined|null/);
          expect(text, kind).toMatch(/[.?!)”]$/);
        }
      }
      expect(new Set(pool.map((line) => line(SAMPLE))).size, `${kind} has a line twice`).toBe(pool.length);
    }
  });

  it("never guilt a day off", () => {
    for (const kind of ["rest", "yet"] as const) {
      for (const line of LEADS[kind]) {
        expect(line(SAMPLE)).not.toMatch(/should|missed|forgot|lazy|shame|behind|sad|lonely|waiting|disappoint|streak|only/);
      }
    }
    for (const line of LEADS.back) {
      expect(line(SAMPLE)).not.toMatch(/\d+ days|finally|at last|where were you/);
    }
  });
});

describe("a week of the diary", () => {
  it("runs Monday to Sunday", () => {
    expect(weekStart("1970-01-01")).toBe("1969-12-29");
    expect(weekStart("2024-01-01")).toBe("2024-01-01");
    expect(weekStart("2024-01-07")).toBe("2024-01-01");
    expect(weekStart("2024-01-08")).toBe("2024-01-08");
    expect(new Date(`${weekStart("2026-10-04")}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it("sums the week and picks its best line", () => {
    const data = source({
      days: [day("2026-09-29", 25), day("2026-09-30", 12), day("2026-10-02", 40), day("2026-10-06", 30)],
      sessions: [session("s1", "2026-09-29", 20), session("s2", "2026-10-02", 30, { bookId: "b2", title: "Dune" })],
      books: [MISTBORN, { id: "b2", title: "Dune", progress: 0.2, progressUpdatedAt: "2026-10-02T20:00:00" }],
      marks: [mark("p1", "person", "Vin", "2026-09-30T20:00:00"), mark("h1", "highlight", "A line.", "2026-10-02T20:00:00", { bookId: "b2" })]
    });
    const facts = diaryFacts(data, "2026-10-07", clock);
    const entries = diaryEntries(facts, "2026-10-07");
    expect(diaryWeeks(facts)).toEqual(["2026-09-28", "2026-10-05"]);

    const week = weekSummary(facts, entries, "2026-09-28");
    expect(week.end).toBe("2026-10-04");
    expect(week.days.map((entry) => entry.read)).toEqual([false, true, true, false, true, false, false]);
    // Monday is before the diary's first page.
    expect(week.days.map((entry) => entry.inDiary)).toEqual([false, true, true, true, true, true, true]);
    expect(week.daysRead).toBe(3);
    expect(week.minutes).toBe(77);
    expect(week.books).toEqual(["Dune", "Mistborn"]);
    expect(week.sessions).toBe(2);
    expect(week.highlights).toBe(1);
    // The first day ever beats a character, which beats an ordinary day.
    expect(week.best?.dateKey).toBe("2026-09-29");
    expect(week.best?.text).toBe(entries[0].text);

    const empty = weekSummary(facts, entries, "2026-10-12");
    expect(empty.daysRead).toBe(0);
    expect(empty.best).toBeNull();
    expect(empty.days.every((entry) => !entry.inDiary)).toBe(true);
  });
});
