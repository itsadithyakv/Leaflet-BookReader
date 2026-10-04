import { describe, expect, it } from "vitest";
import { ago, causeWords, explainMood, moodWord, type MoodInputs } from "./mood";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const rules = {
  driftPerDay: 8,
  driftFloor: 40,
  perReadingMinute: 0.25,
  readingPerDay: 10,
  perSession: 5,
  perHarvest: 2,
  perGame: 3,
  perPlay: 1,
  playPerDay: 12,
  perWish: 10,
  start: 70
};

const names = { treatName: (id: string) => (id === "apple" ? "A Crunchy Apple" : id), gameName: (id: string) => (id === "dash" ? "Pip Dash" : id) };

const input = (over: Partial<MoodInputs> = {}): MoodInputs => ({
  mood: 54,
  moodUpdatedAt: new Date(NOW - 2 * DAY).toISOString(),
  now: NOW,
  rules,
  log: [],
  playToday: 0,
  readingToday: 0,
  sessionsToday: 0,
  minutesToday: 0,
  wish: null,
  ripe: 0,
  snack: null,
  ...names,
  ...over
});

describe("why Pip feels as she does", () => {
  it("says how much the mood has drifted, and since when", () => {
    const report = explainMood(input());
    expect(report.word).toBe("Content");
    expect(report.level).toBe(54);
    expect(report.why[0]).toEqual({ id: "drift", tone: "down", text: "Nothing has cheered her up since 2 days ago, so her mood has drifted down by 16." });
    expect(report.headline).toBe("Content: 54 out of 100. Nothing has cheered her up since 2 days ago, so her mood has drifted down by 16.");
  });

  it("does not blame a drift that has not happened", () => {
    const report = explainMood(input({ mood: 75, moodUpdatedAt: new Date(NOW - 20 * 60_000).toISOString(), sessionsToday: 1 }));
    expect(report.why[0]).toMatchObject({ id: "drift", tone: "plain" });
    expect(report.why[0].text).toContain("20 minutes ago");
    expect(report.headline).toContain("1 focus session today: +5 each.");
  });

  it("says the drift stops at the floor, and blames it for no more than it took", () => {
    const report = explainMood(input({ mood: 40, moodUpdatedAt: new Date(NOW - 12 * DAY).toISOString() }));
    expect(report.word).toBe("Content");
    expect(report.why[0]).toEqual({ id: "drift", tone: "down", text: "Nothing has cheered her up since 12 days ago. Her mood is at 40, where the drift stops." });
    expect(report.why.some((line) => line.id === "mope")).toBe(false);
    // A few points above the floor, it is still the plain drift.
    expect(explainMood(input({ mood: 46, moodUpdatedAt: new Date(NOW - 3 * DAY).toISOString() })).why[0].text).toBe(
      "Nothing has cheered her up since 3 days ago, so her mood has drifted down by 24."
    );
    // The floor is Rust's number, not one kept here.
    expect(explainMood(input({ mood: 30, rules: { ...rules, driftFloor: 30 }, moodUpdatedAt: new Date(NOW - 12 * DAY).toISOString() })).why[0].text).toContain("at 30, where the drift stops");
  });

  it("keeps a mood that was already under the floor where it is, and says so", () => {
    // A reader who was away before the drift had a floor.
    const report = explainMood(input({ mood: 12, moodUpdatedAt: new Date(NOW - 12 * DAY).toISOString() }));
    expect(report.word).toBe("Missing you");
    expect(report.level).toBe(12);
    expect(report.why[0]).toEqual({
      id: "drift",
      tone: "plain",
      text: "Nothing has cheered her up since 12 days ago. Under 40 her mood does not drift: it stays where it is until something cheers her up."
    });
    expect(report.why.some((line) => line.id === "mope" && /nothing is lost/.test(line.text))).toBe(true);
    // Just cheered up a little, and still under it.
    expect(explainMood(input({ mood: 12.25, moodUpdatedAt: new Date(NOW - 5 * 60_000).toISOString() })).why[0].text).toBe(
      "Her mood last changed 5 minutes ago. Under 40 it does not drift: it stays where it is until something cheers her up."
    );
    // Nothing says the mood runs out.
    const everything = [report.headline, report.rule, ...report.why.map((line) => line.text)].join(" ");
    expect(everything).not.toMatch(/all the way down|stops at zero/);
  });

  it("counts any reading, by the minute, with the number Rust kept", () => {
    const reading = (over: Partial<MoodInputs>) => explainMood(input(over)).why.find((line) => line.id === "reading");
    expect(reading({})).toEqual({ id: "reading", tone: "down", text: "No reading yet today." });
    expect(reading({ minutesToday: 23, readingToday: 5.75 })).toEqual({ id: "reading", tone: "up", text: "You read 23 minutes today: +6." });
    // A quarter of a point is not a point.
    expect(reading({ minutesToday: 1, readingToday: 0.25 })?.text).toBe("You read 1 minute today: less than +1.");
    expect(reading({ minutesToday: 2.2, readingToday: 0.55 })?.text).toBe("You read 2 minutes today: less than +1.");
    // The day's allowance, reached.
    expect(reading({ minutesToday: 95, readingToday: 10 })?.text).toBe("You read 95 minutes today: +10, all that reading adds in a day.");
    // Minutes the mood on this device has no count for are only minutes.
    expect(reading({ minutesToday: 34.4 })).toEqual({ id: "reading", tone: "plain", text: "You read 34 minutes today." });
    // No session is needed, and nothing says one is.
    const report = explainMood(input({ minutesToday: 23, readingToday: 5.75 }));
    expect(report.headline).toBe("Content: 54 out of 100. Nothing has cheered her up since 2 days ago, so her mood has drifted down by 16.");
    expect([report.rule, ...report.why.map((line) => line.text), ...report.lifts.map((lift) => lift.text)].join(" ")).not.toMatch(/only focus sessions/i);
    expect(report.why.some((line) => line.id === "session")).toBe(false);
  });

  it("adds a focus session's own cheer on top of its minutes", () => {
    const report = explainMood(input({ minutesToday: 36, readingToday: 9, sessionsToday: 2 }));
    expect(report.why.find((line) => line.id === "reading")?.text).toBe("You read 36 minutes today: +9.");
    expect(report.why.find((line) => line.id === "session")).toEqual({ id: "session", tone: "up", text: "2 focus sessions today: +5 each." });
  });

  it("counts today's games and play against the day's allowance", () => {
    expect(explainMood(input({ playToday: 4 })).why.find((line) => line.id === "play")?.text).toBe("Games and play have added 4 today, of the 12 they can in a day.");
    expect(explainMood(input()).why.some((line) => line.id === "play")).toBe(false);
  });

  it("says what changed it most recently, from the log", () => {
    expect(explainMood(input()).last).toBeNull();
    const log = [
      { at: new Date(NOW - 5 * HOUR).toISOString(), cause: "session", gain: 5, mood: 60 },
      { at: new Date(NOW - 3 * HOUR).toISOString(), cause: "treat:apple", gain: 5, mood: 65 }
    ];
    expect(explainMood(input({ log })).last).toBe("A Crunchy Apple cheered her up by 5, 3 hours ago.");
    expect(explainMood(input({ log: [log[0]] })).last).toBe("A focus session cheered her up by 5, 5 hours ago.");
  });

  it("says a minute of reading is less than a point, and a long read is what it added up to", () => {
    const read = (gain: number, minutesAgo: number) => [{ at: new Date(NOW - minutesAgo * 60_000).toISOString(), cause: "reading", gain, mood: 60 }];
    expect(explainMood(input({ log: read(0.25, 0) })).last).toBe("Reading cheered her up by less than 1, just now.");
    expect(explainMood(input({ log: read(0.75, 0) })).last).toBe("Reading cheered her up by less than 1, just now.");
    expect(explainMood(input({ log: read(1, 3) })).last).toBe("Reading cheered her up by 1, 3 minutes ago.");
    expect(explainMood(input({ log: read(5.75, 5) })).last).toBe("Reading cheered her up by 6, 5 minutes ago.");
    expect(explainMood(input({ log: read(10, 90) })).last).toBe("Reading cheered her up by 10, 1 hour ago.");
  });

  it("names every cause", () => {
    expect(causeWords("reading", names)).toBe("Reading");
    expect(causeWords("session", names)).toBe("A focus session");
    expect(causeWords("game:dash", names)).toBe("A game of Pip Dash");
    expect(causeWords("play:pet", names)).toBe("Being stroked");
    expect(causeWords("play:fetch", names)).toBe("Fetching the ball");
    expect(causeWords("harvest", names)).toBe("Picking a ripe plant");
    expect(causeWords("wish", names)).toBe("Her wish coming true");
    expect(causeWords("play:somethingnew", names)).toBe("Playing");
  });

  it("lists what would lift it, the most first, from what is really possible", () => {
    const report = explainMood(
      input({ wish: { granted: false, mood: 10 }, snack: { name: "a Crunchy Apple", price: 5, mood: 5 }, ripe: 1, playToday: 9 })
    );
    expect(report.lifts.map((lift) => lift.id)).toEqual(["wish", "reading", "snack", "session", "play", "harvest"]);
    expect(report.lifts.map((lift) => lift.text)).toEqual([
      "Grant today's wish: +10.",
      "Read, in a focus session or not: +0.25 a minute, up to +10 today (40 minutes).",
      "Give her a Crunchy Apple (5 seeds): +5.",
      "Read in a focus session: +5 each time, on top of the minutes.",
      "Play with her, or play a game: up to +3 more today.",
      "Pick the ripe plant: +2."
    ]);
  });

  it("says what more reading would add today, up to the day's allowance", () => {
    const lift = (readingToday: number) => explainMood(input({ minutesToday: readingToday * 4, readingToday })).lifts.find((entry) => entry.id === "reading");
    expect(lift(5.75)).toEqual({ id: "reading", gain: 4.25, text: "Read, in a focus session or not: +0.25 a minute, up to +4 more today (17 minutes)." });
    expect(lift(9.75)?.text).toBe("Read, in a focus session or not: +0.25 a minute, up to less than +1 more today (1 minute).");
    expect(lift(10)).toBeUndefined();
    // Other numbers from Rust, other words.
    const other = explainMood(input({ rules: { ...rules, perReadingMinute: 0.5, readingPerDay: 20 }, minutesToday: 10, readingToday: 5 }));
    expect(other.lifts.find((entry) => entry.id === "reading")?.text).toBe("Read, in a focus session or not: +0.5 a minute, up to +15 more today (30 minutes).");
  });

  it("offers nothing that cannot be done", () => {
    const report = explainMood(input({ wish: { granted: true, mood: 10 }, playToday: 12, minutesToday: 60, readingToday: 10 }));
    expect(report.lifts.map((lift) => lift.id)).toEqual(["session"]);
    expect(report.why.some((line) => line.id === "wish")).toBe(true);
    expect(explainMood(input({ mood: 100 })).lifts).toEqual([]);
  });

  it("states the rule with the real numbers", () => {
    expect(explainMood(input()).rule).toContain("drifts down 8 a day");
    expect(explainMood(input({ rules: { ...rules, driftPerDay: 6, perSession: 7 } })).rule).toContain("drifts down 6 a day");
    expect(explainMood(input({ rules: { ...rules, perSession: 7 } })).rule).toContain("A focus session adds 7");
    expect(explainMood(input()).rule).toBe(
      "Her mood drifts down 8 a day from the last time she was cheered up, whether Leaflet is open or not, and the drift stops at 40. Reading adds 0.25 a minute, in a focus session or not, up to 10 a day. A focus session adds 5 more. Games and play add up to 12 a day between them, picking a ripe plant adds 2, her wish coming true adds 10, and each snack or toy adds its own amount."
    );
    const other = explainMood(input({ rules: { ...rules, driftFloor: 30, perReadingMinute: 0.5, readingPerDay: 20 } })).rule;
    expect(other).toContain("the drift stops at 30");
    expect(other).toContain("Reading adds 0.5 a minute, in a focus session or not, up to 20 a day");
  });
});

describe("small words", () => {
  it("names each band of mood", () => {
    expect([100, 80, 79, 60, 40, 20, 19, 0].map(moodWord)).toEqual(["Blissful", "Blissful", "Happy", "Happy", "Content", "Wistful", "Missing you", "Missing you"]);
  });

  it("says how long ago", () => {
    expect(ago(30_000)).toBe("just now");
    expect(ago(5 * 60_000)).toBe("5 minutes ago");
    expect(ago(HOUR)).toBe("1 hour ago");
    expect(ago(26 * HOUR)).toBe("1 day ago");
    expect(ago(3 * DAY)).toBe("3 days ago");
  });
});
