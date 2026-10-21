import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventHub, fakeEngine, type SpeechEngine } from "./engine";
import { createPlayer, FAILURES_TO_STOP, forgetVoices, sentenceId, type SentenceSource, type SpokenWord } from "./player";
import { chapterSentences, type Sentence } from "./chapterText";
import { pauseMs } from "./units";

/** A book of chapters, each a list of sentences (one paragraph each); `null` for a chapter that is not there. */
const book = (chapters: (number | null)[]) => {
  const loads: number[] = [];
  const make = (section: number, count: number): Sentence[] =>
    Array.from({ length: count }, (_, n) => {
      const text = `s${section}.${n}`;
      return {
        section,
        n,
        start: n * 10,
        end: n * 10 + 9,
        text,
        say: text,
        map: Array.from({ length: text.length + 1 }, (_, at) => n * 10 + at),
        block: n,
        heading: false,
        lead: n === 0 ? "chapter" : "paragraph"
      } satisfies Sentence;
    });
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

/** A book whose chapters are text: paragraphs a line each (as the walk makes them), cut into sentences as a real chapter is. */
const textBook = (chapters: string[]) => {
  const source: SentenceSource = {
    async load(section) {
      const text = chapters[section];
      // (Its first line is its heading.)
      return text === undefined ? null : chapterSentences({ text, headings: [{ start: 0, end: text.indexOf("\n") }] }, section);
    },
    after: (section) => (section + 1 < chapters.length ? section + 1 : null),
    before: (section) => (section > 0 ? section - 1 : null)
  };
  return source;
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

beforeEach(() => forgetVoices());

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
    expect(engine.log.filter((entry) => entry.startsWith("replace:")).pop()).toBe("replace:0:1");
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

  it("hears a new speed or voice from the start of the sentence being read, when the voice says nothing of its words", async () => {
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
    // An item it was never given is not taken for the place.
    engine.emit({ type: "start", id: "7:7" });
    expect(player.state.current?.n).toBe(2);
    engine.emit({ type: "stopped" });
    expect(player.state.status).toBe("idle");
    expect(onStopped).toHaveBeenCalled();
  });

  it("carries on from a place moved to while paused when the notification resumes it", async () => {
    const { engine, player } = setup([6]);
    await player.start(0, 0);
    await settle();
    player.pause();
    await player.next();
    await player.next();
    engine.emit({ type: "state", playing: true });
    await settle();
    expect(player.state.status).toBe("playing");
    expect(engine.current).toBe("0:2");
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

const CHAPTER =
  "Chapter One\n" +
  "It was cold. The wind blew hard. Nobody came.\n" +
  "She waited by the door. Then she left.\n" +
  "* * *\n" +
  "Morning came at last.";

describe("a paragraph at a time, where the voice says which word it is at", () => {
  const start = async (options: { ahead?: number; rate?: number } = {}) => {
    const engine = fakeEngine();
    const words: (SpokenWord | null)[] = [];
    const player = createPlayer(engine, textBook([CHAPTER]), { ahead: () => options.ahead ?? 8, onWord: (word) => words.push(word) });
    if (options.rate) player.setRate(options.rate);
    await player.start(0, 0);
    await settle();
    return { engine, player, words };
  };

  it("gives a voice not yet heard from a sentence at a time, then whole paragraphs once it says where it is", async () => {
    const { engine, player } = await start({ ahead: 3 });
    expect(player.mode).toBe("sentence");
    expect(engine.items.map((item) => item.text)).toEqual(["Chapter One", "It was cold.", "The wind blew hard.", "Nobody came."]);
    engine.word(1);
    expect(player.mode).toBe("paragraph");
    for (let step = 0; step < 4; step += 1) {
      engine.word(0);
      engine.advance();
      await settle();
    }
    // The next paragraph goes as one, its sentences joined.
    expect(engine.items.map((item) => item.text)).toContain("She waited by the door. Then she left.");
  });

  it("lights the sentence the voice is in, and the word, from where it says it is", async () => {
    // As heard before: paragraphs from the start.
    const first = await start();
    first.engine.word(1);
    first.player.stop();
    const { engine, player, words } = await start();
    expect(engine.items.map((item) => item.text)[1]).toBe("It was cold. The wind blew hard. Nobody came.");
    engine.advance();
    expect(player.state.current?.text).toBe("It was cold.");
    // "blew", in the second sentence.
    const text = engine.currentItem!.text;
    engine.word(text.split(" ").indexOf("blew"));
    expect(player.state.current?.text).toBe("The wind blew hard.");
    const word = words[words.length - 1]!;
    expect(CHAPTER.slice(word.start, word.end)).toBe("blew");
    // The last word, with its stop left off.
    engine.word(text.split(" ").length - 1);
    const last = words[words.length - 1]!;
    expect(player.state.current?.text).toBe("Nobody came.");
    expect(CHAPTER.slice(last.start, last.end)).toBe("came");
  });

  it("keeps a silence before each unit for the break it follows, none before the first, shorter when faster", async () => {
    const first = await start();
    first.engine.word(0);
    first.player.stop();
    const { engine } = await start({ rate: 1.5 });
    const silences = engine.items.map((item) => [item.text.slice(0, 12), item.silence ?? 0]);
    expect(silences).toEqual([
      ["Chapter One", 0],
      ["It was cold.", pauseMs("heading", 1.5)],
      ["She waited b", pauseMs("paragraph", 1.5)],
      ["Morning came", pauseMs("scene", 1.5)]
    ]);
    expect(pauseMs("paragraph", 1)).toBeGreaterThan(pauseMs("paragraph", 1.5));
    expect(pauseMs("scene", 1)).toBeGreaterThan(pauseMs("heading", 1));
  });

  it("goes on from the word it was at after a pause, and starts there again for a new speed", async () => {
    const first = await start();
    first.engine.word(0);
    first.player.stop();
    const { engine, player } = await start();
    engine.advance();
    const text = engine.currentItem!.text;
    engine.word(text.split(" ").indexOf("wind"));
    player.pause();
    player.resume();
    // The engine went on from "wind" (an item resumed part of the way in), and the sentence stayed lit.
    expect(engine.log[engine.log.length - 1]).toMatch(/^say:0:1~\d+@\d+$/);
    expect(player.state.current?.text).toBe("The wind blew hard.");
    player.setRate(1.3);
    const replaced = engine.log.filter((entry) => entry.startsWith("replace:")).pop();
    expect(replaced).toMatch(/^replace:0:2\+\d+$/);
    expect(engine.items[0].text.startsWith("wind blew hard. Nobody came.")).toBe(true);
    expect(engine.items[0].silence ?? 0).toBe(0);
    expect(player.state.current?.text).toBe("The wind blew hard.");
    // And the words of what is said from there map back to the page.
    engine.word(1);
    expect(player.state.current?.text).toBe("The wind blew hard.");
  });

  it("goes back to a sentence at a time when a voice stops saying where it is", async () => {
    const first = await start();
    first.engine.word(0);
    first.player.stop();
    const { engine, player } = await start({ ahead: 2 });
    expect(player.mode).toBe("paragraph");
    engine.advance();
    await settle();
    // Two whole paragraphs said through without a word of news.
    engine.advance();
    await settle();
    expect(player.mode).toBe("paragraph");
    engine.advance();
    await settle();
    expect(player.mode).toBe("sentence");
  });

  it("keeps a voice that never says where it is on a sentence at a time", async () => {
    const { engine, player } = await start({ ahead: 3 });
    engine.advance();
    engine.advance();
    engine.advance();
    await settle();
    expect(player.mode).toBe("sentence");
    expect(engine.items.every((item) => !item.text.includes(". "))).toBe(true);
  });
});

describe("preparing ahead (a voice that makes a chapter before it reads)", () => {
  it("hands the engine what reading from a place would say, across into the next chapter, without reading", async () => {
    const engine = fakeEngine();
    const prepared: string[][] = [];
    const withPrepare = Object.assign(engine, { prepare: (items: { id: string }[]) => prepared.push(items.map((item) => item.id)) });
    const { source } = book([3, 2]);
    const player = createPlayer(withPrepare, source, { ahead: () => 4 });
    await player.prepare(0, 12);
    expect(prepared).toEqual([["0:1", "0:2", "1:0", "1:1"]]);
    expect(player.state.status).toBe("idle");
    expect(engine.log).toEqual([]);
  });

  it("does nothing while reading, or for an engine that cannot", async () => {
    const engine = fakeEngine();
    const prepared: string[][] = [];
    const withPrepare = Object.assign(engine, { prepare: (items: { id: string }[]) => prepared.push(items.map((item) => item.id)) });
    const { source } = book([3]);
    const player = createPlayer(withPrepare, source, { ahead: () => 4 });
    await player.start(0, 0);
    await player.prepare(0, 0);
    expect(prepared).toEqual([]);
    const plain = createPlayer(fakeEngine(), book([3]).source, { ahead: () => 4 });
    await expect(plain.prepare(0, 0)).resolves.toBeUndefined();
  });
});

describe("a voice that cannot speak", () => {
  /** An engine whose every item fails at once, as a voice that needs the network does offline: it goes on to the next, failing that too. */
  const failingEngine = () => {
    const hub = eventHub();
    const said: string[] = [];
    let queue: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      const id = queue.shift();
      if (id === undefined) return;
      said.push(id);
      hub.emit({ type: "error", id, message: "network" });
      timer = setTimeout(run, 0);
    };
    const engine: SpeechEngine = {
      kind: "fake",
      voices: async () => [],
      speak(items, { replace }) {
        if (replace) queue = [];
        queue.push(...items.map((item) => item.id));
        if (!timer) timer = setTimeout(run, 0);
      },
      pause() {},
      resume() {},
      stop() {
        queue = [];
      },
      setRate() {},
      setVoice() {},
      onEvent: hub.on
    };
    return { engine, said };
  };

  it("stops after a few items fail in a row, instead of running on to the end of the book", async () => {
    const { engine, said } = failingEngine();
    const { source } = book([40, 40]);
    const onFailed = vi.fn();
    const onEnd = vi.fn();
    const player = createPlayer(engine, source, { ahead: () => 2, onFailed, onEnd });
    await player.start(0, 0);
    for (let step = 0; step < 50; step += 1) await settle();
    expect(player.state.status).toBe("idle");
    expect(onFailed).toHaveBeenCalledWith("network");
    expect(onEnd).not.toHaveBeenCalled();
    // Stopped where it was, not chapters on.
    expect(said.length).toBe(FAILURES_TO_STOP);
    expect(said.every((id) => id.startsWith("0:"))).toBe(true);
  });

  it("reads on past an item that fails now and then", async () => {
    const engine = fakeEngine();
    const { source } = book([10]);
    const onFailed = vi.fn();
    const player = createPlayer(engine, source, { ahead: () => 2, onFailed });
    await player.start(0, 0);
    await settle();
    for (let step = 0; step < 6; step += 1) {
      // Every other one fails; the one between is said through.
      if (step % 2 === 0) engine.emit({ type: "error", id: engine.current, message: "odd" });
      engine.advance();
      await settle();
    }
    expect(onFailed).not.toHaveBeenCalled();
    expect(player.state.status).toBe("playing");
  });
});
