import { describe, expect, it, vi } from "vitest";
import type { EngineEvent } from "./engine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const { neuralEngine, PREPARE_AHEAD } = await import("./neuralEngine");
const { studioStatus: status } = await import("./studioVoice.fixture");

/** Rust, faked: what was asked of it, and a way to send its news. */
const rust = (answers: Record<string, unknown> = {}) => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  let send: ((event: unknown) => void) | null = null;
  const bridge = {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command in answers) {
        const answer = answers[command];
        if (answer instanceof Error) throw answer;
        return answer;
      }
      return undefined;
    }),
    listen: vi.fn(async (_event: string, handler: (payload: never) => void) => {
      send = handler as (event: unknown) => void;
      return () => {
        send = null;
      };
    })
  };
  return { bridge, calls, emit: (event: unknown) => send?.(event) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Studio voice engine (Windows)", () => {
  it("says where it is a sentence at a time, at the marks", () => {
    const engine = neuralEngine(rust().bridge as never);
    expect(engine.kind).toBe("neural");
    expect(engine.progress).toBe("sentence");
  });

  it("hands items and controls to Rust", async () => {
    const { bridge, calls } = rust();
    const engine = neuralEngine(bridge as never);
    engine.speak([{ id: "4:0", text: "One. Two.", marks: [0, 5], silence: 400 }], { replace: true });
    engine.setRate(1.3);
    engine.setVoice("neural:bf_emma", "en-GB");
    engine.setVoice("Microsoft Aria", "en-US");
    engine.pause();
    engine.resume();
    engine.stop();
    await settle();
    expect(calls).toEqual([
      { command: "studio_speak", args: { items: [{ id: "4:0", text: "One. Two.", marks: [0, 5], silence: 400 }], replace: true } },
      { command: "studio_set_rate", args: { rate: 1.3 } },
      { command: "studio_set_voice", args: { voice: "neural:bf_emma" } },
      { command: "studio_set_voice", args: { voice: null } },
      { command: "studio_pause", args: undefined },
      { command: "studio_resume", args: undefined },
      { command: "studio_stop", args: undefined }
    ]);
  });

  it("gives Rust's news to the player as it comes", async () => {
    const { bridge, emit } = rust();
    const engine = neuralEngine(bridge as never);
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    await settle();
    emit({ type: "start", id: "4:0" });
    emit({ type: "boundary", id: "4:0", charIndex: 5, kind: "sentence" });
    emit({ type: "done", id: "4:0" });
    expect(heard).toEqual([
      { type: "start", id: "4:0" },
      { type: "boundary", id: "4:0", charIndex: 5, kind: "sentence" },
      { type: "done", id: "4:0" }
    ]);
  });

  it("turns preparing news into the page's, ended by the start, and then wants the chapter queued", async () => {
    const { bridge, emit } = rust();
    const engine = neuralEngine(bridge as never);
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    await settle();
    expect(engine.ahead?.()).toBeNull();
    // As Rust sends it (src-tauri/src/tts/timeline.rs), the same shape as Android's.
    emit({ type: "preparing", id: "7:0", seconds: 42 });
    expect(engine.ahead?.()).toBe(PREPARE_AHEAD);
    emit({ type: "start", id: "7:0" });
    expect(heard).toEqual([{ type: "preparing", seconds: 42 }, { type: "preparing", seconds: null }, { type: "start", id: "7:0" }]);
  });

  it("lists its voices only where this build can make them, and learns the mode from the status", async () => {
    const live = neuralEngine(rust({ studio_voice_status: status() }).bridge as never);
    expect((await live.voices()).map((voice) => voice.id)).toContain("neural:af_heart");
    const prepare = neuralEngine(rust({ studio_voice_status: status({ mode: "prepare", slow: true }) }).bridge as never);
    await prepare.voices();
    expect(prepare.mode).toBe("prepare");
    expect(prepare.ahead?.()).toBe(PREPARE_AHEAD);
    const noRuntime = neuralEngine(rust({ studio_voice_status: status({ canSpeak: false }) }).bridge as never);
    expect(await noRuntime.voices()).toEqual([]);
    const failing = neuralEngine(rust({ studio_voice_status: new Error("no") }).bridge as never);
    expect(await failing.voices()).toEqual([]);
  });

  it("says when Rust refuses a command", async () => {
    const { bridge } = rust({ studio_speak: new Error("The Studio voice is not downloaded") });
    const engine = neuralEngine(bridge as never);
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    engine.speak([{ id: "1:0", text: "Hi." }], { replace: true });
    await settle();
    expect(heard).toEqual([{ type: "error", id: null, message: "The Studio voice is not downloaded" }]);
  });

  it("sends each command once the one before is done, so a pause just after the first speak is not lost", async () => {
    const order: string[] = [];
    let finishSpeak: (() => void) | null = null;
    const bridge = {
      invoke: vi.fn((command: string) => {
        order.push(`begin ${command}`);
        if (command === "studio_speak") {
          // The engine is being made: this takes a while.
          return new Promise<void>((resolve) => {
            finishSpeak = () => {
              order.push(`end ${command}`);
              resolve();
            };
          });
        }
        order.push(`end ${command}`);
        return Promise.resolve();
      }),
      listen: vi.fn(async () => () => {})
    };
    const engine = neuralEngine(bridge as never);
    engine.speak([{ id: "1:0", text: "Hi." }], { replace: true });
    engine.pause();
    engine.stop();
    await settle();
    expect(order).toEqual(["begin studio_speak"]);
    finishSpeak!();
    await settle();
    expect(order).toEqual(["begin studio_speak", "end studio_speak", "begin studio_pause", "end studio_pause", "begin studio_stop", "end studio_stop"]);
  });

  it("goes on with the next command after one is refused", async () => {
    const { bridge, calls } = rust({ studio_pause: new Error("no") });
    const engine = neuralEngine(bridge as never);
    engine.pause();
    engine.resume();
    await settle();
    expect(calls.map((call) => call.command)).toEqual(["studio_pause", "studio_resume"]);
  });

  it("passes on nothing of a reading stopped until the next one starts", async () => {
    const { bridge, emit } = rust();
    const engine = neuralEngine(bridge as never);
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    await settle();
    engine.speak([{ id: "1:0", text: "Hi." }], { replace: true });
    emit({ type: "start", id: "1:0" });
    engine.stop();
    // Already on its way from Rust when the stop went.
    emit({ type: "done", id: "1:0" });
    emit({ type: "preparing", id: "1:0", seconds: 30 });
    expect(heard).toEqual([{ type: "start", id: "1:0" }]);
    engine.speak([{ id: "1:0", text: "Hi." }], { replace: true });
    emit({ type: "start", id: "1:0" });
    expect(heard).toEqual([
      { type: "start", id: "1:0" },
      { type: "start", id: "1:0" }
    ]);
  });

  it("drops news that is not an event", async () => {
    const { bridge, emit } = rust();
    const engine = neuralEngine(bridge as never);
    const heard: EngineEvent[] = [];
    engine.onEvent((event) => heard.push(event));
    await settle();
    emit({ type: "boundary", id: "1:0" });
    emit(null);
    emit({ type: "nonsense" });
    expect(heard).toEqual([]);
  });
});
