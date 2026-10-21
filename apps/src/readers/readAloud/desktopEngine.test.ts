import { describe, expect, it, vi } from "vitest";
import { fakeEngine, type EngineEvent, type SpeechVoice } from "./engine";
import { desktopEngine } from "./desktopEngine";
import type { NeuralEngine } from "./neuralEngine";

const windowsVoices: SpeechVoice[] = [
  { id: "aria", name: "Microsoft Aria Online (Natural)", lang: "en-US", quality: 500, online: true },
  { id: "zira", name: "Microsoft Zira", lang: "en-US", quality: 300 }
];
const studio: SpeechVoice[] = [{ id: "neural:af_heart", name: "Heart", lang: "en-US", quality: 500, studio: true }];

/** A Studio voice engine, faked: a fake engine that says it is neural. */
const fakeNeural = () => {
  const engine = fakeEngine({ voices: studio, kind: "neural" });
  return Object.assign(engine, { progress: "sentence" as const, mode: "live" as const, status: null, dispose() {} }) as typeof engine & NeuralEngine;
};

const rig = () => {
  const web = fakeEngine({ voices: windowsVoices, kind: "web" });
  const neural = fakeNeural();
  const onFallback = vi.fn();
  const engine = desktopEngine({ web, neural, onFallback });
  const heard: EngineEvent[] = [];
  engine.onEvent((event) => heard.push(event));
  return { web, neural, engine, heard, onFallback };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reading aloud on Windows: the Studio voice or Windows' own", () => {
  it("lists the Studio voices with Windows' own", async () => {
    const { engine } = rig();
    expect((await engine.voices()).map((voice) => voice.id)).toEqual(["neural:af_heart", "aria", "zira"]);
  });

  it("speaks with whichever the voice picked belongs to, and stops the other", () => {
    const { web, neural, engine } = rig();
    engine.setVoice("neural:af_heart", "en-US");
    expect(engine.kind).toBe("neural");
    expect(engine.progress).toBe("sentence");
    engine.speak([{ id: "1:0", text: "Hello there." }], { replace: true });
    expect(neural.queue).toEqual(["1:0"]);
    expect(web.queue).toEqual([]);
    engine.setVoice("aria", "en-US");
    expect(engine.kind).toBe("web");
    expect(neural.log).toContain("stop");
    expect(web.voice).toBe("aria");
    engine.speak([{ id: "1:1", text: "Again." }], { replace: true });
    expect(web.queue).toEqual(["1:1"]);
  });

  it("passes on only the news of the voice speaking", () => {
    const { web, neural, engine, heard } = rig();
    engine.setVoice("neural:af_heart", "en-US");
    web.emit({ type: "done", id: "stale" });
    neural.emit({ type: "start", id: "1:0" });
    expect(heard).toEqual([{ type: "start", id: "1:0" }]);
  });

  it("gives the speed to both, so a change of voice keeps it", () => {
    const { web, neural, engine } = rig();
    engine.setRate(1.4);
    expect(web.rate).toBe(1.4);
    expect(neural.rate).toBe(1.4);
  });

  it("carries on in the best Windows voice from the sentence reached when the Studio voice fails", async () => {
    const { web, neural, engine, heard, onFallback } = rig();
    engine.setVoice("neural:af_heart", "en-US");
    engine.setRate(1.2);
    const text = "It was late. The rain had stopped. Nobody came.";
    engine.speak(
      [
        { id: "4:0", text, marks: [0, 13, 35] },
        { id: "4:3", text: "Then morning.", marks: [0], silence: 400 }
      ],
      { replace: true }
    );
    neural.emit({ type: "start", id: "4:0" });
    neural.emit({ type: "boundary", id: "4:0", charIndex: 13, kind: "sentence" });
    neural.emit({ type: "error", id: "4:0", message: "the model failed" });
    await settle();
    expect(onFallback).toHaveBeenCalledWith("Microsoft Aria Online (Natural)");
    expect(engine.kind).toBe("web");
    expect(neural.log).toContain("stop");
    expect(web.voice).toBe("aria");
    expect(web.rate).toBe(1.2);
    // From the sentence it was in, then on as queued.
    expect(web.items.map((item) => [item.id, item.text, item.marks])).toEqual([
      ["4:0", "The rain had stopped. Nobody came.", [0, 22]],
      ["4:3", "Then morning.", [0]]
    ]);
    // The error is not passed on (reading goes on); Windows' news is given in the item's own terms.
    expect(heard.some((event) => event.type === "error")).toBe(false);
    expect(heard[heard.length - 1]).toEqual({ type: "start", id: "4:0", from: 13 });
    web.emit({ type: "boundary", id: "4:0", charIndex: 4, kind: "word" });
    expect(heard[heard.length - 1]).toEqual({ type: "boundary", id: "4:0", charIndex: 17, kind: "word" });
    web.advance();
    expect(heard.slice(-2)).toEqual([
      { type: "done", id: "4:0" },
      { type: "start", id: "4:3" }
    ]);
  });

  it("carries on from the sentence heard when the piece that failed was one made ahead", async () => {
    const { web, neural, engine } = rig();
    engine.setVoice("neural:af_heart", "en-US");
    const text = "It was late. The rain had stopped. Nobody came.";
    engine.speak(
      [
        { id: "4:0", text, marks: [0, 13, 35] },
        { id: "4:3", text: "Then morning.", marks: [0] },
        { id: "4:4", text: "And the day.", marks: [0] }
      ],
      { replace: true }
    );
    neural.emit({ type: "start", id: "4:0" });
    neural.emit({ type: "boundary", id: "4:0", charIndex: 13, kind: "sentence" });
    // Rust was making "4:4", well ahead of the voice, when the model failed.
    neural.emit({ type: "error", id: "4:4", message: "the model failed" });
    await settle();
    expect(web.items.map((item) => [item.id, item.text])).toEqual([
      ["4:0", "The rain had stopped. Nobody came."],
      ["4:3", "Then morning."],
      ["4:4", "And the day."]
    ]);
  });

  it("carries on from the start when nothing has been heard yet", async () => {
    const { web, neural, engine } = rig();
    engine.setVoice("neural:af_heart", "en-US");
    engine.speak([{ id: "2:0", text: "First." }, { id: "2:1", text: "Second." }], { replace: true });
    neural.emit({ type: "error", id: null, message: "The Studio voice is not downloaded" });
    await settle();
    expect(web.items.map((item) => item.id)).toEqual(["2:0", "2:1"]);
  });

  it("without Windows' voices, a Studio voice failure is passed on", () => {
    const neural = fakeNeural();
    const engine = desktopEngine({ web: null, neural });
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    engine.setVoice("neural:af_heart", "en-US");
    neural.emit({ type: "error", id: "1:0", message: "x" });
    expect(heard).toEqual([{ type: "error", id: "1:0", message: "x" }]);
  });

  it("asks for the chapter queued while the Studio voice prepares it", () => {
    const { neural, engine } = rig();
    expect(engine.ahead?.()).toBeNull();
    engine.setVoice("neural:af_heart", "en-US");
    Object.assign(neural, { ahead: () => 600 });
    expect(engine.ahead?.()).toBe(600);
  });

  it("lets go of its listeners when the book closes", () => {
    const { neural, engine, heard } = rig();
    engine.setVoice("neural:af_heart", "en-US");
    engine.forget?.();
    neural.emit({ type: "start", id: "1:0" });
    expect(heard).toEqual([]);
  });
});
