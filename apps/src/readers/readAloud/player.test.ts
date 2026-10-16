import { describe, expect, it, vi } from "vitest";
import { fakeEngine } from "./engine";
import { createPlayer, sentenceId, type SentenceSource } from "./player";
import type { Sentence } from "./chapterText";

/** A book of chapters, each a list of sentences; `null` for a chapter that is not there. */
const book = (chapters: (number | null)[]) => {
  const loads: number[] = [];
  const make = (section: number, count: number): Sentence[] =>
    Array.from({ length: count }, (_, n) => ({ section, n, start: n * 10, end: n * 10 + 9, text: `s${section}.${n}` }));
  const source: SentenceSource = {
    async load(section) {
      loads.push(section);
      const count = chapters[section];
      return count === undefined || count === null ? null : make(section, count);
    },
    after: (section) => (section + 1 < chapters.length ? section + 1 : null),
    before: (section) => (section > 0 ? section - 1 : null)
  };
  return { source, loads };
};

/** Lets the player's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (chapters: (number | null)[], ahead = 2) => {
  const engine = fakeEngine();
  const { source, loads } = book(chapters);
  const onEnd = vi.fn();
  const states: string[] = [];
  const player = createPlayer(engine, source, {
    ahead: () => ahead,
    onEnd,
    onChange: (state) => states.push(`${state.status}:${state.current ? sentenceId(state.current) : "-"}`)
  });
  return { engine, player, onEnd, loads, states };
};

describe("the read-aloud player", () => {
  it("starts at the sentence a place is in, and keeps a few queued ahead", async () => {
    const { engine, player } = setup([5]);
    await player.start(0, 23);
    await settle();
    expect(engine.current).toBe("0:2");
    expect(engine.queue).toEqual(["0:2", "0:3", "0:4"]);
    expect(player.state.status).toBe("playing");
    expect(engine.log[0]).toBe("stop");
    expect(engine.log[1]).toBe("replace:0:2");
  });

  it("tops the queue up as each sentence starts, never the whole chapter at once", async () => {
    const { engine, player } = setup([20], 3);
    await player.start(0, 0);
    await settle();
    expect(engine.queue.length).toBe(4);
    engine.advance();
    await settle();
    expect(engine.current).toBe("0:1");
    expect(engine.queue).toEqual(["0:0", "0:1", "0:2", "0:3", "0:4"]);
    expect(engine.log.filter((entry) => entry.startsWith("add:"))).toEqual(["add:0:1,0:2,0:3", "add:0:4"]);
  });

  it("goes on into the next chapter by itself, passing over one with nothing to read", async () => {
    const { engine, player, loads } = setup([2, 0, 2], 2);
    await player.start(0, 0);
    await settle();
    expect(engine.queue).toEqual(["0:0", "0:1", "2:0"]);
    expect(loads).toEqual([0, 1, 2]);
    engine.advance();
    engine.advance();
    await settle();
    expect(player.state.current?.section).toBe(2);
  });

  it("ends at the end of the book, once the last sentence is done", async () => {
    const { engine, player, onEnd } = setup([2]);
    await player.start(0, 0);
    await settle();
    engine.advance();
    await settle();
    expect(onEnd).not.toHaveBeenCalled();
    engine.advance();
    await settle();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(player.state.status).toBe("idle");
    expect(engine.queue).toEqual([]);
  });

  it("starts in the next chapter when the place is past the last sentence", async () => {
    const { engine, player } = setup([1, 3]);
    await player.start(0, 500);
    await settle();
    expect(engine.current).toBe("1:0");
  });

  it("pauses and resumes in the engine; a move while paused waits for resume", async () => {
    const { engine, player } = setup([6]);
    await player.start(0, 0);
    await settle();
    player.pause();
    expect(player.state.status).toBe("paused");
    expect(engine.playing).toBe(false);
    player.resume();
    expect(engine.playing).toBe(true);
    expect(engine.log).toContain("resume");
    player.pause();
    await player.next();
    expect(player.state.current?.n).toBe(1);
    expect(player.state.status).toBe("paused");
    expect(engine.playing).toBe(false);
    player.resume();
    await settle();
    expect(engine.current).toBe("0:1");
    expect(engine.log[engine.log.length - 2] ?? "").toMatch(/^replace:0:1$/);
  });

  it("moves a sentence on or back, across chapters, starting the queue again there", async () => {
    const { engine, player } = setup([2, 2]);
    await player.start(1, 0);
    await settle();
    await player.previous();
    await settle();
    expect(engine.current).toBe("0:1");
    await player.next();
    await player.next();
    await settle();
    expect(engine.current).toBe("1:1");
    // Back from the very first sentence stays there.
    await player.start(0, 0);
    await player.previous();
    await settle();
    expect(engine.current).toBe("0:0");
  });

  it("hears a new speed or voice from the start of the sentence being read", async () => {
    const { engine, player } = setup([4]);
    await player.start(0, 0);
    await settle();
    engine.advance();
    await settle();
    player.setRate(1.5);
    expect(engine.rate).toBe(1.5);
    expect(engine.current).toBe("0:1");
    expect(engine.log.filter((entry) => entry.startsWith("replace:"))).toEqual(["replace:0:0", "replace:0:1"]);
    player.setVoice("v2", "en-GB");
    expect(engine.voice).toBe("v2");
    expect(engine.log.filter((entry) => entry.startsWith("replace:")).length).toBe(3);
  });

  it("follows the engine when the notification pauses, skips or stops it", async () => {
    const engine = fakeEngine();
    const { source } = book([5]);
    const onStopped = vi.fn();
    const player = createPlayer(engine, source, { ahead: () => 3, onStopped });
    await player.start(0, 0);
    await settle();
    engine.emit({ type: "state", playing: false });
    expect(player.state.status).toBe("paused");
    engine.emit({ type: "at", id: "0:2" });
    expect(player.state.current?.n).toBe(2);
    engine.emit({ type: "state", playing: true });
    expect(player.state.status).toBe("playing");
    // A sentence it was never given is not taken for the place.
    engine.emit({ type: "start", id: "7:7" });
    expect(player.state.current?.n).toBe(2);
    engine.emit({ type: "stopped" });
    expect(player.state.status).toBe("idle");
    expect(onStopped).toHaveBeenCalled();
  });

  it("queues more when asked (Leaflet going out of sight)", async () => {
    let ahead = 2;
    const engine = fakeEngine();
    const { source } = book([30]);
    const player = createPlayer(engine, source, { ahead: () => ahead });
    await player.start(0, 0);
    await settle();
    expect(engine.queue.length).toBe(3);
    ahead = 20;
    player.topUp();
    await settle();
    expect(engine.queue.length).toBe(21);
  });

  it("drops work begun before a stop", async () => {
    const { engine, player } = setup([10]);
    const starting = player.start(0, 0);
    player.stop();
    await starting;
    await settle();
    expect(player.state.status).toBe("idle");
    expect(engine.queue).toEqual([]);
  });

  it("keeps only a few chapters in memory", async () => {
    const { engine, player, loads } = setup([1, 1, 1, 1, 1, 1], 1);
    await player.start(0, 0);
    for (let step = 0; step < 5; step += 1) {
      await settle();
      engine.advance();
    }
    await settle();
    await player.start(0, 0);
    // Chapter 0 had to be read again.
    expect(loads.filter((section) => section === 0).length).toBe(2);
  });
});

describe("moving by sentences", () => {
  it("counts each of several quick presses", async () => {
    const { engine, player } = setup([8]);
    await player.start(0, 50);
    await settle();
    void player.previous();
    void player.previous();
    await player.previous();
    await settle();
    expect(engine.current).toBe("0:2");
    void player.next();
    await player.next();
    await settle();
    expect(engine.current).toBe("0:4");
  });
});
