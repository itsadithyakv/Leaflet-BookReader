import { describe, expect, it } from "vitest";
import {
  autoTier,
  chromeLook,
  FrameWatch,
  gpuClass,
  lighter,
  MINIMAL_MEMORY_GB,
  probeSaysSlow,
  resolveTier,
  SLOW_FRAME_MS,
  stepDown,
  WATCH_WINDOW_MS,
} from "./perfTier";

describe("what kind of GPU a renderer string names", () => {
  it.each([
    ["Adreno (TM) 619", "mid"],
    ["Adreno (TM) 610", "mid"],
    ["Adreno (TM) 642L", "mid"],
    ["Adreno (TM) 650", "high"],
    ["Adreno (TM) 660", "high"],
    ["Adreno (TM) 730", "high"],
    ["Adreno (TM) 830", "high"],
    ["Adreno (TM) 506", "low"],
    ["ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)", "mid"],
    ["Mali-G52 MC2", "mid"],
    ["Mali-G57 MC2", "mid"],
    ["Mali-G610 MC6", "mid"],
    ["Mali-G710 MC10", "high"],
    ["Mali-G78 MP14", "high"],
    ["Immortalis-G715", "high"],
    ["Mali-G31 MP2", "low"],
    ["Mali-T830", "low"],
    ["PowerVR Rogue GE8320", "low"],
    ["Samsung Xclipse 940", "high"],
    ["Google SwiftShader", "software"],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "software"],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", "software"],
    ["ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", "software"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", "high"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", "high"],
    ["Something new", "unknown"],
  ])("%s → %s", (renderer, kind) => {
    expect(gpuClass(renderer)).toBe(kind);
  });

  it("is unknown with no name", () => {
    expect(gpuClass(null)).toBe("unknown");
    expect(gpuClass("")).toBe("unknown");
  });
});

describe("the tier a device calls for (Auto)", () => {
  it("is Smooth on every Android phone, however strong (the owner's call)", () => {
    // The owner's phone: a OnePlus Nord CE4 Lite (Snapdragon 695, Adreno 619, 8 GB).
    expect(autoTier({ android: true, renderer: "Adreno (TM) 619", memory: 8, cores: 8 })).toBe("lite");
    expect(autoTier({ android: true, renderer: "Adreno (TM) 830", memory: 8, cores: 8 })).toBe("lite");
    expect(autoTier({ android: true, renderer: "Mali-G710 MC10", memory: 8, cores: 8 })).toBe("lite");
    expect(autoTier({ android: true, renderer: null })).toBe("lite");
  });

  it("is minimal on a phone short of memory", () => {
    expect(autoTier({ android: true, renderer: "Adreno (TM) 730", memory: MINIMAL_MEMORY_GB, cores: 8 })).toBe("minimal");
    expect(autoTier({ android: true, renderer: "Adreno (TM) 619", memory: 1, cores: 8 })).toBe("minimal");
  });

  it("is minimal on a weak GPU with little memory or few cores, Smooth with plenty of both", () => {
    expect(autoTier({ android: true, renderer: "Mali-G31 MP2", memory: 3, cores: 8 })).toBe("minimal");
    expect(autoTier({ android: true, renderer: "PowerVR Rogue GE8320", memory: 4, cores: 4 })).toBe("minimal");
    expect(autoTier({ android: true, renderer: "Mali-G31 MP2", memory: 4, cores: 8 })).toBe("lite");
    expect(autoTier({ android: true, renderer: "Adreno (TM) 619", memory: 3, cores: 8 })).toBe("lite");
  });

  it("is Smooth on a computer too, however strong its GPU (Full only by choice), and minimal short of memory", () => {
    // The owner's laptop: an i5-13420H with Intel UHD graphics, on which 1.5.10's glass lagged.
    expect(autoTier({ android: false, renderer: "ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11)", memory: 8, cores: 12 })).toBe("lite");
    expect(autoTier({ android: false, renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)", memory: 8, cores: 16 })).toBe("lite");
    expect(autoTier({ android: false, renderer: null })).toBe("lite");
    expect(autoTier({ android: false, renderer: "ANGLE (Microsoft, Microsoft Basic Render Driver)", memory: 8 })).toBe("lite");
    expect(autoTier({ android: false, renderer: "Google SwiftShader", memory: 8 })).toBe("lite");
    expect(autoTier({ android: false, renderer: "ANGLE (Intel)", memory: 2 })).toBe("minimal");
  });

  it("resolves Auto to Smooth on the desktop, and keeps a reader's Full", () => {
    const desktop = autoTier({ android: false, renderer: "ANGLE (Intel, Intel(R) UHD Graphics)", memory: 8, cores: 12 });
    expect(resolveTier("auto", desktop)).toBe("lite");
    expect(resolveTier("full", desktop)).toBe("full");
    expect(resolveTier("lite", desktop)).toBe("lite");
  });

  it("draws the desktop below Full as Leaflet's leather, and a phone always as glass", () => {
    expect(chromeLook("lite", false)).toBe("leather");
    expect(chromeLook("minimal", false)).toBe("leather");
    expect(chromeLook("full", false)).toBe("glass");
    for (const tier of ["full", "lite", "minimal"] as const) expect(chromeLook(tier, true)).toBe("glass");
  });
});

describe("the tier drawn", () => {
  it("is the reader's choice when there is one", () => {
    expect(resolveTier("full", "lite", "minimal")).toBe("full");
    expect(resolveTier("lite", "full", null)).toBe("lite");
    expect(resolveTier("lite", "minimal", null)).toBe("lite");
  });

  it("on Auto is the device's, stepped down by the session's checks, never up", () => {
    expect(resolveTier("auto", "full")).toBe("full");
    expect(resolveTier("auto", "full", "lite")).toBe("lite");
    expect(resolveTier("auto", "lite", "minimal")).toBe("minimal");
    expect(resolveTier("auto", "minimal", "lite")).toBe("minimal");
  });

  it("steps down one at a time", () => {
    expect(stepDown("full")).toBe("lite");
    expect(stepDown("lite")).toBe("minimal");
    expect(stepDown("minimal")).toBe("minimal");
    expect(lighter("full", "lite")).toBe("lite");
    expect(lighter("minimal", "full")).toBe("minimal");
  });
});

describe("the watchdog over moving frames", () => {
  const feed = (watch: FrameWatch, frames: number[]) => frames.map((d) => watch.add(d)).some(Boolean);
  const run = (fastMs: number, slowMs: number, slowEvery: number, totalMs: number) => {
    const frames: number[] = [];
    let t = 0;
    for (let i = 0; t < totalMs; i++) {
      const d = i % slowEvery === 0 ? slowMs : fastMs;
      frames.push(d);
      t += d;
    }
    return frames;
  };

  it("steps down when 15% or more of 3 s of frames are over 25 ms", () => {
    const watch = new FrameWatch();
    // One in five at 40 ms: 20% slow.
    expect(feed(watch, run(16.7, 40, 5, WATCH_WINDOW_MS + 200))).toBe(true);
  });

  it("does not for a smooth scroll with the odd slow frame", () => {
    const watch = new FrameWatch();
    // One in fifteen: under 7%.
    expect(feed(watch, run(16.7, 45, 15, WATCH_WINDOW_MS * 4))).toBe(false);
  });

  it("does not before 3 s of movement, however slow", () => {
    const watch = new FrameWatch();
    expect(feed(watch, run(16.7, 60, 2, WATCH_WINDOW_MS * 0.6))).toBe(false);
  });

  it("does not count frames at exactly the line, or gaps of a second or more", () => {
    const watch = new FrameWatch();
    expect(feed(watch, run(16.7, SLOW_FRAME_MS, 3, WATCH_WINDOW_MS * 3))).toBe(false);
    expect(watch.add(5000)).toBe(false);
    expect(watch.add(Number.NaN)).toBe(false);
  });

  it("forgets what has rolled out of the window: a slow start then smooth scrolling is fine", () => {
    const watch = new FrameWatch();
    feed(watch, run(16.7, 60, 3, 900));
    expect(feed(watch, run(16.7, 40, 40, WATCH_WINDOW_MS * 3))).toBe(false);
    expect(watch.slowShare).toBeLessThan(0.15);
  });

  it("starts over after stepping down, so the next step takes another 3 s of slow frames", () => {
    const watch = new FrameWatch();
    const frames = run(16.7, 40, 4, WATCH_WINDOW_MS * 2);
    const fired = frames.findIndex((d) => watch.add(d));
    expect(fired).toBeGreaterThan(0);
    expect(watch.slowShare).toBe(0);
    expect(feed(watch, run(16.7, 40, 4, WATCH_WINDOW_MS * 0.5))).toBe(false);
  });
});

describe("the start-up probe", () => {
  it("passes a device keeping 60 frames a second, and one with a hiccup", () => {
    expect(probeSaysSlow(Array(70).fill(16.7))).toBe(false);
    expect(probeSaysSlow([...Array(68).fill(16.7), 120, 90])).toBe(false);
  });

  it("fails one that cannot keep 40 a second", () => {
    expect(probeSaysSlow(Array(40).fill(30))).toBe(true);
    expect(probeSaysSlow([...Array(30).fill(16.7), ...Array(20).fill(40)])).toBe(true);
  });

  it("says nothing on too few frames", () => {
    expect(probeSaysSlow(Array(10).fill(100))).toBe(false);
  });
});
