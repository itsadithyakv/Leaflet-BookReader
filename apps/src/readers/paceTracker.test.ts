import { describe, expect, it } from "vitest";
import { judgeCatchUp, PagePaceTracker, ReadingWindow, ScrollPaceTracker } from "./paceTracker";

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
