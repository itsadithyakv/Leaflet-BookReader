import { describe, expect, it } from "vitest";
import {
  AUTO_RAISE_EVERY_MS,
  aheadToastDue,
  autoRaise,
  judgeCatchUp,
  nudgedWpm,
  tickReading,
  PagePaceTracker,
  ReadingWindow,
  ScrollPaceTracker
} from "./paceTracker";

const window = () => new ReadingWindow({ minMs: 75_000, minWords: 180, maxStepMs: 180_000 });

describe("a reading window", () => {
  it("gathers steady reading until there is enough to learn from", () => {
    const reading = window();
    // 250 wpm: 125 words every 30 seconds.
    expect(reading.step(125, 30_000, 250).sample).toBeNull();
    expect(reading.step(125, 30_000, 250).sample).toBeNull();
    expect(reading.step(125, 30_000, 250).sample).toEqual({ words: 375, ms: 90_000 });
  });

  it("leaves a stop to think out, words and time alike", () => {
    const reading = window();
    reading.step(125, 30_000, 250);
    // 125 words should take 30s; this took two and a half minutes.
    expect(reading.step(125, 150_000, 250)).toEqual({ sample: null, paused: true });
    reading.step(125, 30_000, 250);
    expect(reading.step(125, 30_000, 250).sample).toEqual({ words: 375, ms: 90_000 });
  });

  it("keeps what came before a long absence, and drops the absence", () => {
    const reading = window();
    reading.step(125, 30_000, 250);
    reading.step(125, 30_000, 250);
    expect(reading.step(125, 600_000, 250)).toEqual({ sample: { words: 250, ms: 60_000 }, paused: true });
  });

  it("takes slow steps that keep coming as the reader's own pace", () => {
    const reading = window();
    // 125 words should take 30s; two minutes is past the 110s a pause starts at.
    const results = [0, 1, 2, 3].map(() => reading.step(125, 120_000, 250));
    expect(results.map((result) => result.paused)).toEqual([true, true, false, false]);
    expect(results[3].sample).toEqual({ words: 250, ms: 240_000 });
  });

  it("does not learn from pages scrolled past unread", () => {
    const reading = window();
    reading.step(125, 30_000, 250);
    reading.step(125, 30_000, 250);
    // A thousand words in five seconds.
    expect(reading.step(1000, 5000, 250)).toEqual({ sample: { words: 250, ms: 60_000 }, paused: false });
    expect(reading.flush()).toBeNull();
  });

  it("counts going back over text as time spent, not as words gained", () => {
    const reading = window();
    reading.step(200, 45_000, 250);
    reading.step(-60, 10_000, 250);
    expect(reading.step(200, 45_000, 250).sample).toEqual({ words: 340, ms: 100_000 });
  });
});

describe("free reading by scrolling", () => {
  it("learns from the words passing the reading line, chapter by chapter", () => {
    const tracker = new ScrollPaceTracker();
    const chapterOne = {};
    let at = 0;
    const samples = [];
    for (let index = 0; index <= 1000; index += 100) {
      samples.push(tracker.observe(index, at, chapterOne, 240).sample);
      at += 25_000;
    }
    expect(samples.filter(Boolean)[0]).toEqual({ words: 300, ms: 75_000 });
    // A new chapter starts a new count; what was gathered is kept.
    const next = tracker.observe(0, at, {}, 240);
    expect(next.sample).toEqual({ words: 100, ms: 25_000 });
  });

  it("leaves out a stop to think between two scrolls", () => {
    const tracker = new ScrollPaceTracker();
    const chapter = {};
    tracker.observe(0, 0, chapter, 240);
    // 100 words should take 25 seconds; three minutes went by.
    expect(tracker.observe(100, 170_000, chapter, 240).paused).toBe(true);
    tracker.observe(200, 195_000, chapter, 240);
    expect(tracker.stop()).toEqual({ words: 100, ms: 25_000 });
  });

  it("hands over what it has when reading stops", () => {
    const tracker = new ScrollPaceTracker();
    const chapter = {};
    tracker.observe(0, 0, chapter, 240);
    tracker.observe(120, 30_000, chapter, 240);
    expect(tracker.stop()).toEqual({ words: 120, ms: 30_000 });
    expect(tracker.stop()).toBeNull();
  });
});

describe("turning pages", () => {
  it("learns from pages read one after another", () => {
    const tracker = new PagePaceTracker();
    let at = 0;
    const samples = [];
    // 150-word pages at 250 wpm: 36 seconds each.
    for (let page = 1; page <= 5; page += 1) {
      samples.push(tracker.show(`p${page}`, at, page > 1, 250).sample);
      tracker.count(`p${page}`, 150);
      at += 36_000;
    }
    expect(samples.filter(Boolean)).toEqual([
      { words: 300, ms: 72_000 },
      { words: 300, ms: 72_000 }
    ]);
  });

  it("starts over after going back, and never counts a page it could not count", () => {
    const tracker = new PagePaceTracker();
    tracker.show("p1", 0, true, 250);
    tracker.count("p1", 250);
    tracker.show("p2", 60_000, true, 250);
    tracker.count("p2", 250);
    // Back a page: what was gathered is dropped.
    tracker.show("p1", 70_000, false, 250);
    tracker.count("p1", 250);
    tracker.show("p2", 130_000, true, 250);
    // p2's words were never counted this time round.
    tracker.show("p3", 190_000, true, 250);
    expect(tracker.stop()).toBeNull();
  });
});

describe("reading ahead of Dotty", () => {
  it("measures a reader who is faster than Dotty", () => {
    expect(judgeCatchUp({ words: 300, activeMs: 60_000, dottyWpm: 220 })).toEqual({ kind: "faster", wpm: 300 });
  });

  it("moves Dotty without changing its pace when there is nothing to measure", () => {
    // Too soon to tell.
    expect(judgeCatchUp({ words: 60, activeMs: 8000, dottyWpm: 220 }).kind).toBe("moved");
    // Too fast to be reading: a jump ahead.
    expect(judgeCatchUp({ words: 1500, activeMs: 60_000, dottyWpm: 220 }).kind).toBe("moved");
    // Not faster than Dotty at all: the page was scrolled on ahead of the reading.
    expect(judgeCatchUp({ words: 210, activeMs: 60_000, dottyWpm: 220 }).kind).toBe("moved");
  });
});

describe("saying the reader is ahead of Dotty", () => {
  it("says it once a reading session", () => {
    expect(aheadToastDue(null, 260)).toBe(true);
    expect(aheadToastDue(260, 260)).toBe(false);
    expect(aheadToastDue(260, 280)).toBe(false);
  });

  it("says it again only for a real rise in the pace", () => {
    expect(aheadToastDue(260, 299)).toBe(true);
    expect(aheadToastDue(300, 320)).toBe(false);
  });
});

describe("raising Dotty's pace by itself", () => {
  const at250 = { dottyWpm: 250, base: 250, raisedAt: null, activeMs: 10 * 60_000 };

  it("goes up 12 % at most, however far ahead the reader scrolled", () => {
    // A skim: 600 a minute "read" ahead. The catch-up used to take 80 % of the gap, to 530.
    expect(autoRaise({ ...at250, wanted: 250 + (600 - 250) * 0.8 })).toBeCloseTo(280, 5);
    // A small gap is closed as measured.
    expect(autoRaise({ ...at250, wanted: 265 })).toBe(265);
  });

  it("comes once in two minutes of reading", () => {
    const raisedAt = 10 * 60_000;
    expect(autoRaise({ ...at250, wanted: 300, raisedAt, activeMs: raisedAt + 60_000 })).toBeNull();
    const later = raisedAt + AUTO_RAISE_EVERY_MS;
    expect(autoRaise({ ...at250, wanted: 300, raisedAt, activeMs: later })).not.toBeNull();
  });

  it("never takes Dotty past 20 % over the reader's own pace for the book", () => {
    // From 250, one raise every two minutes: 280, then 300, and no further.
    let dotty = 250;
    let raisedAt: number | null = null;
    for (let minute = 0; minute < 30; minute += 1) {
      const activeMs = minute * 60_000;
      const next = autoRaise({ dottyWpm: dotty, wanted: 600, base: 250, raisedAt, activeMs });
      if (next !== null) {
        dotty = next;
        raisedAt = activeMs;
      }
    }
    expect(dotty).toBeCloseTo(300, 5);
    // Over it already (the reader's own +): nothing more by itself.
    expect(autoRaise({ ...at250, dottyWpm: 400, wanted: 500 })).toBeNull();
  });
});

describe("the pace's − and +", () => {
  it("go to round numbers, in steps that suit the pace", () => {
    expect(nudgedWpm(400, true)).toBe(425);
    expect(nudgedWpm(400, false)).toBe(375);
    expect(nudgedWpm(397, true)).toBe(400);
    expect(nudgedWpm(397, false)).toBe(380);
    expect(nudgedWpm(250, true)).toBe(260);
    expect(nudgedWpm(150, false)).toBe(140);
  });
});

describe("Smart Read's reading clock", () => {
  it("does not count a wait (the rest after a glide) as reading", () => {
    const session = { activeMs: 0, lastTickAt: 0 };
    tickReading(session, 200, false);
    expect(session.activeMs).toBe(200);
    // The glide and the rest after it: 2 s of waiting ticks.
    for (let at = 380; at <= 2200; at += 180) {
      expect(tickReading(session, at, true)).toBe(0);
    }
    expect(session.activeMs).toBe(200);
    // The next word counts only from the end of the wait.
    expect(tickReading(session, 2400, false)).toBe(2400 - 2180);
  });
});
