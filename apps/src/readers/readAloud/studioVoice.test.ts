import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const { formatBytes, isStudioVoice, studioService, studioVoices } = await import("./studioVoice");
const { studioStatus: status } = await import("./studioVoice.fixture");

describe("the Studio voice's voices", () => {
  it("are listed once installed, as studio voices of the best quality", () => {
    const voices = studioVoices(status());
    expect(voices.map((voice) => voice.id)).toEqual(["neural:af_heart", "neural:bf_emma", "neural:am_michael"]);
    expect(voices.every((voice) => voice.studio && voice.quality === 500 && !voice.slow)).toBe(true);
    expect(voices[1].lang).toBe("en-GB");
  });

  it("are marked slow where the self-test says so, and not offered where too slow", () => {
    expect(studioVoices(status({ slow: true, mode: "prepare" })).every((voice) => voice.slow)).toBe(true);
    expect(studioVoices(status({ mode: "tooSlow" }))).toEqual([]);
    expect(studioVoices(status({ installed: false }))).toEqual([]);
    expect(studioVoices(null)).toEqual([]);
  });

  it("are not picked by themselves until a self-test has passed here", () => {
    expect(studioVoices(status({ selfTest: null })).every((voice) => voice.untested)).toBe(true);
    expect(studioVoices(status()).some((voice) => voice.untested)).toBe(false);
  });

  it("are told apart by their id", () => {
    expect(isStudioVoice("neural:af_heart")).toBe(true);
    expect(isStudioVoice("Microsoft Aria Online (Natural)")).toBe(false);
    expect(isStudioVoice(null)).toBe(false);
  });
});

describe("sizes", () => {
  it("in megabytes, gigabytes past a thousand", () => {
    expect(formatBytes(349_906_910)).toBe("350 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(200_000)).toBe("1 MB");
  });
});

describe("the download", () => {
  it("listens for progress while it runs, and stops listening after", async () => {
    let handler: ((progress: unknown) => void) | null = null;
    const stop = vi.fn();
    const seen: unknown[] = [];
    const bridge = {
      invoke: vi.fn(async (command: string) => {
        expect(command).toBe("studio_voice_download");
        handler?.({ phase: "download", done: 10, total: 100 });
        return status();
      }),
      listen: vi.fn(async (_event: string, next: (payload: never) => void) => {
        handler = next as (progress: unknown) => void;
        return stop;
      })
    };
    const result = await studioService(bridge as never).download((progress) => seen.push(progress));
    expect(bridge.listen).toHaveBeenCalledWith("studio-voice:progress", expect.any(Function));
    expect(seen).toEqual([{ phase: "download", done: 10, total: 100 }]);
    expect(result.installed).toBe(true);
    expect(stop).toHaveBeenCalled();
  });

  it("stops listening when it fails or is cancelled", async () => {
    const stop = vi.fn();
    const bridge = { invoke: vi.fn(async () => Promise.reject("cancelled")), listen: vi.fn(async () => stop) };
    await expect(studioService(bridge as never).download(() => {})).rejects.toBe("cancelled");
    expect(stop).toHaveBeenCalled();
  });

  it("previews a voice at a speed", async () => {
    const bridge = { invoke: vi.fn(async () => undefined), listen: vi.fn() };
    await studioService(bridge as never).preview("neural:bf_emma", 1.3);
    expect(bridge.invoke).toHaveBeenCalledWith("studio_preview", { voice: "neural:bf_emma", rate: 1.3 });
  });
});
