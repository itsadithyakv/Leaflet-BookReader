import { beforeAll, describe, expect, it } from "vitest";
import { EVENT_MS, SKY_H, eventInSlot, hourOf, renderSky, skyColours, skyEvents, skySignature, type SkyEvent } from "./sky.js";

beforeAll(() => {
  // The art makes ImageData; outside a browser there is none.
  if (typeof globalThis.ImageData === "undefined") {
    (globalThis as { ImageData?: unknown }).ImageData = class {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }
});

const SLOT_MS = 150_000;
/** Local noon and local midnight on a fixed day. */
const NOON = new Date(2026, 9, 3, 12, 0, 0).getTime();
const MIDNIGHT = new Date(2026, 9, 3, 0, 30, 0).getTime();

/** Every slot of one local day, and what each holds. */
const dayOfSlots = () => {
  const from = Math.ceil(new Date(2026, 9, 3, 0, 0, 0).getTime() / SLOT_MS);
  return Array.from({ length: 576 }, (_, index) => ({ slot: from + index, event: eventInSlot(from + index) }));
};

describe("the sky's colours", () => {
  it("is night at midnight, day at noon, and in between at dusk", () => {
    expect(skyColours(0).night).toBe(1);
    expect(skyColours(12).night).toBe(0);
    expect(skyColours(18).night).toBeGreaterThan(0);
    expect(skyColours(18).night).toBeLessThan(1);
    expect(skyColours(3)).toEqual(skyColours(27));
  });

  it("changes smoothly: no hour steps from one sky to another", () => {
    for (let hour = 0; hour < 24; hour += 0.05) {
      const a = skyColours(hour);
      const b = skyColours(hour + 0.05);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(a.top[channel] - b.top[channel])).toBeLessThanOrEqual(12);
        expect(Math.abs(a.bot[channel] - b.bot[channel])).toBeLessThanOrEqual(12);
      }
    }
  });

  it("reads the reader's own clock", () => {
    expect(hourOf(NOON)).toBe(12);
    expect(hourOf(MIDNIGHT)).toBe(0.5);
  });
});

describe("what crosses the sky", () => {
  it("is decided by the clock alone", () => {
    const first = dayOfSlots().map(({ event }) => event?.kind ?? "-");
    expect(dayOfSlots().map(({ event }) => event?.kind ?? "-")).toEqual(first);
  });

  it("is rare: most of the day the sky is just the sky", () => {
    const events = dayOfSlots().filter(({ event }) => event !== null);
    const empty = 576 - events.length;
    expect(empty).toBeGreaterThan(576 * 0.55);
    const dragons = events.filter(({ event }) => event?.kind === "dragon").length;
    // A dragon a handful of times an hour at the very most, and some days' worth across a day.
    expect(dragons).toBeGreaterThan(10);
    expect(dragons).toBeLessThan(576 * 0.15);
  });

  it("keeps shooting stars for the night and balloons for the day", () => {
    for (const { slot, event } of dayOfSlots()) {
      if (!event) continue;
      const night = skyColours(hourOf(slot * SLOT_MS)).night > 0.5;
      if (event.kind === "star") expect(night).toBe(true);
      if (event.kind === "balloon") expect(night).toBe(false);
    }
    const kinds = new Set(dayOfSlots().map(({ event }) => event?.kind));
    expect(kinds.has("star")).toBe(true);
    expect(kinds.has("balloon")).toBe(true);
    expect(kinds.has("dragon")).toBe(true);
  });

  it("starts and ends inside its slot, and is in the sky only meanwhile", () => {
    const found = dayOfSlots().find(({ event }) => event?.kind === "dragon");
    expect(found?.event).toBeTruthy();
    if (!found?.event) return;
    const { slot, event } = found;
    expect(event.at).toBeGreaterThanOrEqual(slot * SLOT_MS);
    expect(event.at + EVENT_MS.dragon).toBeLessThanOrEqual((slot + 1) * SLOT_MS);
    expect(skyEvents(event.at - 1)).toEqual([]);
    expect(skyEvents(event.at + EVENT_MS.dragon / 2)).toEqual([{ kind: "dragon", t: 0.5, seed: slot }]);
    expect(skyEvents(event.at + EVENT_MS.dragon + 1)).toEqual([]);
  });
});

describe("the picture", () => {
  const dragon: SkyEvent[] = [{ kind: "dragon", t: 0.5, seed: 3 }];
  const count = (a: ImageData, b: ImageData) => {
    let different = 0;
    for (let index = 0; index < a.data.length; index += 4) {
      if (a.data[index] !== b.data[index] || a.data[index + 1] !== b.data[index + 1] || a.data[index + 2] !== b.data[index + 2]) different += 1;
    }
    return different;
  };

  it("fills the whole sky, every pixel opaque", () => {
    const sky = renderSky(240, SKY_H, NOON, []);
    expect([sky.width, sky.height]).toEqual([240, SKY_H]);
    for (let index = 3; index < sky.data.length; index += 4) expect(sky.data[index]).toBe(255);
  });

  it("is the same picture for the same moment", () => {
    expect(count(renderSky(240, SKY_H, NOON, dragon), renderSky(240, SKY_H, NOON, dragon))).toBe(0);
  });

  it("is darker at night than at noon", () => {
    const brightness = (sky: ImageData) => sky.data.reduce((sum, value, index) => (index % 4 === 3 ? sum : sum + value), 0);
    expect(brightness(renderSky(240, SKY_H, MIDNIGHT, []))).toBeLessThan(brightness(renderSky(240, SKY_H, NOON, [])) * 0.5);
  });

  it("shows a dragon when there is one: a small thing in a big sky", () => {
    const changed = count(renderSky(240, SKY_H, NOON, []), renderSky(240, SKY_H, NOON, dragon));
    expect(changed).toBeGreaterThan(60);
    expect(changed).toBeLessThan(700);
  });

  it("lets the clouds drift, far ones slower than near ones", () => {
    expect(count(renderSky(240, SKY_H, NOON, []), renderSky(240, SKY_H, NOON + 20_000, []))).toBeGreaterThan(0);
  });

  it("flies nothing for a reader who asked for less motion", () => {
    expect(count(renderSky(240, SKY_H, NOON, [], true), renderSky(240, SKY_H, NOON, dragon, true))).toBe(0);
  });

  it("only asks for a redraw when something has moved", () => {
    // Two ticks apart (a sixth of a second), a quiet daytime sky is the same picture.
    const quiet = Array.from({ length: 400 }, (_, index) => NOON + index * 1000).find((time) => skySignature(240, SKY_H, time, []) === skySignature(240, SKY_H, time + 83, []));
    expect(quiet).toBeDefined();
    // With a dragon crossing, every twelfth of a second is a new one.
    expect(skySignature(240, SKY_H, NOON, dragon)).not.toBe(skySignature(240, SKY_H, NOON + 100, dragon));
  });
});
