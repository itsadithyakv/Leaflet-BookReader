import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEvent } from "./engine";

const calls: { op: string; args?: Record<string, unknown> }[] = [];
let answers: Record<string, unknown> = {};
const invoke = vi.fn(async () => null);

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
vi.mock("../../platform/android", () => ({
  onAndroid: () => true,
  android: {
    readAloud: async (op: string, args?: Record<string, unknown>) => {
      calls.push({ op, args });
      return answers[op] ?? null;
    }
  }
}));

const { androidEngine, androidStudioSelfTest, isStudioVoice, PREPARE_AHEAD, toEngineEvent, toWireItem } = await import("./androidEngine");

// (The tests run without a DOM: the engine's callback is set on a window of their own.)
vi.stubGlobal("window", {} as Window);

beforeEach(() => {
  calls.length = 0;
  answers = {};
  invoke.mockClear();
});

describe("the Android engine's events", () => {
  it("passes the Kotlin side's events through as they are", () => {
    expect(toEngineEvent({ type: "start", id: "3:0" })).toEqual({ type: "start", id: "3:0" });
    expect(toEngineEvent({ type: "start", id: "3:0", from: 12 })).toEqual({ type: "start", id: "3:0", from: 12 });
    expect(toEngineEvent({ type: "boundary", id: "3:0", charIndex: 40, charLength: 5, kind: "word" })).toEqual({
      type: "boundary",
      id: "3:0",
      charIndex: 40,
      charLength: 5,
      kind: "word"
    });
    expect(toEngineEvent({ type: "done", id: "3:0" })).toEqual({ type: "done", id: "3:0" });
    expect(toEngineEvent({ type: "at", id: "3:4" })).toEqual({ type: "at", id: "3:4" });
    expect(toEngineEvent({ type: "state", playing: false })).toEqual({ type: "state", playing: false });
    expect(toEngineEvent({ type: "stopped" })).toEqual({ type: "stopped" });
  });

  it("maps the Studio voice's sentence boundaries, errors and preparing", () => {
    expect(toEngineEvent({ type: "boundary", id: "3:0", charIndex: 57, kind: "sentence" })).toEqual({
      type: "boundary",
      id: "3:0",
      charIndex: 57,
      kind: "sentence"
    });
    expect(toEngineEvent({ type: "error", id: null, message: "studio: the model did not load" })).toEqual({
      type: "error",
      id: null,
      message: "studio: the model did not load"
    });
    expect(toEngineEvent({ type: "preparing", seconds: 80 })).toEqual({ type: "preparing", seconds: 80 });
    expect(toEngineEvent({ type: "preparing", seconds: null })).toEqual({ type: "preparing", seconds: null });
  });

  it("drops what is malformed or unknown", () => {
    expect(toEngineEvent(null)).toBeNull();
    expect(toEngineEvent("start")).toBeNull();
    expect(toEngineEvent({ type: "start" })).toBeNull();
    expect(toEngineEvent({ type: "boundary", id: "a", charIndex: -1 })).toBeNull();
    expect(toEngineEvent({ type: "state" })).toBeNull();
    expect(toEngineEvent({ type: "lunch" })).toBeNull();
  });

  it("hands the page's listeners what Kotlin calls back with", () => {
    const engine = androidEngine();
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    window.__leafletReadAloud?.({ type: "start", id: "1:0" });
    window.__leafletReadAloud?.({ type: "bogus" });
    window.__leafletReadAloud?.({ type: "preparing", seconds: 12.4 });
    expect(heard).toEqual([
      { type: "start", id: "1:0" },
      { type: "preparing", seconds: 12 }
    ]);
  });
});

describe("the Android engine's commands", () => {
  it("sends the items with their marks", () => {
    const engine = androidEngine();
    engine.speak([{ id: "1:0", text: "One. Two.", marks: [0, 5], silence: 300 }], { replace: true });
    expect(calls).toEqual([{ op: "speak", args: { items: [{ id: "1:0", text: "One. Two.", silence: 300, marks: [0, 5] }], replace: true } }]);
    expect(toWireItem({ id: "x", text: "Hi.", marks: [] })).toEqual({ id: "x", text: "Hi." });
  });

  it("says where it is a sentence at a time with a Studio voice, and as the phone's voice does otherwise", async () => {
    answers.voices = {
      voices: [
        { id: "en-us-x-iom-local", name: "English 1", lang: "en-US" },
        { id: "neural:af_heart", name: "Heart", lang: "en-US", studio: true, quality: 500, slow: true }
      ]
    };
    const engine = androidEngine();
    await engine.voices();
    expect(engine.progress).toBeUndefined();
    expect(engine.ahead?.()).toBeNull();
    engine.setVoice("neural:af_heart", "en-US");
    expect(engine.progress).toBe("sentence");
    // Slow here: the rest of the chapter queued, for it to prepare.
    expect(engine.ahead?.()).toBe(PREPARE_AHEAD);
    engine.setVoice("en-us-x-iom-local", "en-US");
    expect(engine.progress).toBeUndefined();
    expect(isStudioVoice("neural:bf_emma")).toBe(true);
    expect(isStudioVoice(null)).toBe(false);
  });

  it("prepares ahead only for a Studio voice", () => {
    const engine = androidEngine();
    engine.setRate(1.2);
    engine.prepare?.([{ id: "1:0", text: "One." }], { bookId: "b1" });
    expect(calls.some((call) => call.op === "prepare")).toBe(false);
    engine.setVoice("neural:af_heart", "en-US");
    engine.prepare?.([{ id: "1:0", text: "One.", marks: [0] }], { bookId: "b1" });
    expect(calls[calls.length - 1]).toEqual({
      op: "prepare",
      args: { items: [{ id: "1:0", text: "One.", marks: [0] }], voice: "neural:af_heart", rate: 1.2, bookId: "b1" }
    });
    engine.forget?.();
    expect(calls[calls.length - 1]?.op).toBe("forget");
  });

  it("records the self-test with the pack", async () => {
    answers.studioSelfTest = { rtf: 1.3, threads: 4, loadMs: 2100, seconds: 6.2, mode: "prepare" };
    const result = await androidStudioSelfTest("neural:af_heart");
    expect(result?.rtf).toBe(1.3);
    expect(calls[calls.length - 1]).toEqual({ op: "studioSelfTest", args: { voice: "neural:af_heart" } });
    expect(invoke).toHaveBeenCalledWith("studio_voice_record_self_test", { rtf: 1.3, threads: 4 });
  });
});
