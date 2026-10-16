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
    getVoices: () => [{ voiceURI: "zira", name: "Microsoft Zira", lang: "en-US", localService: true, default: true }],
    /** The first in the queue starts, and ends. */
    sayOne() {
      const utterance = queue.shift();
      utterance?.onstart?.();
      utterance?.onend?.();
      return utterance;
    }
  };
};

const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

const setup = () => {
  const synth = fakeSynth();
  (globalThis as { window?: unknown }).window = { SpeechSynthesisUtterance: FakeUtterance };
  const engine = webSpeechEngine(synth as unknown as SpeechSynthesis);
  const events: string[] = [];
  engine.onEvent((event: EngineEvent) => events.push("id" in event ? `${event.type}:${event.id}` : event.type));
  return { synth, engine, events };
};

describe("the browser's speech as a read-aloud engine", () => {
  it("speaks each sentence as an utterance, with the speed, and says when each starts and ends", () => {
    const { synth, engine, events } = setup();
    engine.setRate(1.5);
    engine.speak([{ id: "a", text: "One." }, { id: "b", text: "Two." }], { replace: true });
    engine.speak([{ id: "c", text: "Three." }], { replace: false });
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["One.", "Two.", "Three."]);
    expect(synth.queue[0].rate).toBe(1.5);
    synth.sayOne();
    synth.sayOne();
    expect(events).toEqual(["start:a", "done:a", "start:b", "done:b"]);
  });

  it("pauses by cancelling, and says the sentence again from its start on resume", () => {
    const { synth, engine, events } = setup();
    engine.speak([{ id: "a", text: "One." }, { id: "b", text: "Two." }], { replace: true });
    synth.sayOne();
    synth.queue[0].onstart?.();
    engine.pause();
    expect(synth.queue).toEqual([]);
    // What the cancelled utterances say afterwards is not news.
    expect(events).toEqual(["start:a", "done:a", "start:b"]);
    engine.resume();
    expect(synth.queue.map((utterance) => utterance.text)).toEqual(["Two."]);
  });

  it("lists the voices, and stops with nothing left queued", async () => {
    const { synth, engine } = setup();
    expect(await engine.voices()).toEqual([{ id: "zira", name: "Microsoft Zira", lang: "en-US", online: false, preferred: true }]);
    engine.speak([{ id: "a", text: "One." }], { replace: true });
    engine.stop();
    expect(synth.queue).toEqual([]);
    engine.resume();
    expect(synth.queue).toEqual([]);
  });
});
