import { afterEach, describe, expect, it } from "vitest";
import { webSpeechEngine } from "./webSpeechEngine";
import type { EngineEvent } from "./engine";

/** The browser's speech, as far as the engine uses it: utterances are kept, and said when told. */
class FakeUtterance {
  rate = 1;
  lang = "";
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onboundary: ((event: { name: string; charIndex: number; charLength?: number }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

const fakeSynth = () => {
  let queue: FakeUtterance[] = [];
  const said: FakeUtterance[] = [];
  return {
    said,
    get queue() {
      return queue;
    },
    speak(utterance: FakeUtterance) {
      queue.push(utterance);
      said.push(utterance);
    },
    cancel() {
      const dropped = queue;
      queue = [];
      dropped.forEach((utterance) => utterance.onerror?.({ error: "interrupted" }));
    },
    getVoices: () => [
      { voiceURI: "zira", name: "Microsoft Zira", lang: "en-US", localService: true, default: true },
      { voiceURI: "aria", name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", localService: false, default: false }
    ],
    /** The first in the queue starts. */
    begin() {
      queue[0]?.onstart?.();
      return queue[0];
    },
    /** The first in the queue is at this word. */
    word(charIndex: number, charLength?: number) {
      queue[0]?.onboundary?.({ name: "word", charIndex, charLength });
    },
    /** The first in the queue ends. */
    end() {
      const utterance = queue.shift();
      utterance?.onend?.();
      return utterance;
    },
    /** The first in the queue starts, and ends. */
    sayOne() {
      const utterance = queue[0];
      utterance?.onstart?.();
      queue.shift();
      utterance?.onend?.();
      return utterance;
    }
  };
};

const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

const setup = (hidden = false) => {
  const synth = fakeSynth();
  (globalThis as { window?: unknown }).window = { SpeechSynthesisUtterance: FakeUtterance };
  const timers: { run: () => void; ms: number }[] = [];
  const state = { hidden };
  const engine = webSpeechEngine(synth as unknown as SpeechSynthesis, {
    hidden: () => state.hidden,
    setTimer: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    }
  });
  const events: string[] = [];
  engine.onEvent((event: EngineEvent) =>
    events.push(event.type === "boundary" ? `boundary:${event.id}@${event.charIndex}` : "id" in event ? `${event.type}:${event.id}${event.type === "start" && event.from ? `@${event.from}` : ""}` : event.type)
  );
  /** The silence before the next item runs out. */
  const tick = () => timers.shift()?.run();
  return { synth, engine, events, timers, tick, state };
};

describe("the browser's speech as a read-aloud engine", () => {
  it("says the items one at a time, each after its silence, with the speed, and says when each starts and ends", () => {
    const { synth, engine, events, timers, tick } = setup();
    engine.setRate(1.5);
    engine.speak([{ id: "a", text: "One." }, { id: "b", text: "Two.", silence: 400 }], { replace: true });
    engine.speak([{ id: "c", text: "Three." }], { replace: false });
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["One."]);
    expect(synth.queue[0].rate).toBe(1.5);
    synth.sayOne();
    // The paragraph's pause, kept by the engine (Windows' voices read markup out loud).
    expect(synth.queue).toEqual([]);
    expect(timers.map((timer) => timer.ms)).toEqual([400]);
    tick();
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["Two."]);
    synth.sayOne();
    // No silence asked for: at once.
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["Three."]);
    synth.sayOne();
    expect(events).toEqual(["start:a", "done:a", "start:b", "done:b", "start:c", "done:c"]);
  });

  it("says which word the voice is at, and goes on from that word after a pause", () => {
    const { synth, engine, events } = setup();
    engine.speak([{ id: "a", text: "It was cold. The wind blew." }, { id: "b", text: "Two." }], { replace: true });
    synth.begin();
    synth.word(0, 2);
    synth.word(13, 3);
    expect(events).toEqual(["start:a", "boundary:a@0", "boundary:a@13"]);
    engine.pause();
    expect(synth.queue).toEqual([]);
    engine.resume();
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["The wind blew."]);
    synth.begin();
    // Offsets stay those of the whole item.
    synth.word(4, 4);
    expect(events.slice(3)).toEqual(["start:a@13", "boundary:a@17"]);
    synth.end();
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["Two."]);
  });

  it("goes on from the start of the next item when paused in the silence before it", () => {
    const { synth, engine, timers } = setup();
    engine.speak([{ id: "a", text: "One." }, { id: "b", text: "Two.", silence: 500 }], { replace: true });
    synth.sayOne();
    expect(timers.length).toBe(1);
    engine.pause();
    expect(timers.length).toBe(0);
    engine.resume();
    // The silence again, then the next.
    expect(timers.map((timer) => timer.ms)).toEqual([500]);
    timers.shift()?.run();
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["Two."]);
  });

  it("hands the whole queue over while out of sight, where timers are slowed", () => {
    const { synth, engine, timers } = setup(true);
    engine.speak([{ id: "a", text: "One." }, { id: "b", text: "Two.", silence: 400 }], { replace: true });
    engine.speak([{ id: "c", text: "Three.", silence: 400 }], { replace: false });
    expect(timers).toEqual([]);
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["One.", "Two.", "Three."]);
  });

  it("lists the voices with how good they sound, and stops with nothing left queued", async () => {
    const { synth, engine } = setup();
    expect(await engine.voices()).toEqual([
      { id: "zira", name: "Microsoft Zira", lang: "en-US", online: false, preferred: true, quality: 300 },
      { id: "aria", name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", online: true, preferred: false, quality: 500 }
    ]);
    engine.speak([{ id: "a", text: "One." }], { replace: true });
    engine.stop();
    expect(synth.queue).toEqual([]);
    engine.resume();
    expect(synth.queue).toEqual([]);
  });
});
