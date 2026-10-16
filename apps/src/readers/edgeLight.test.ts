import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<number | null> = [];
let androidApp = true;
vi.mock("../platform/android", () => ({
  onAndroid: () => androidApp,
  android: {
    setBrightness: async (level: number | null) => {
      sent.push(level);
      return { system: 0.5 };
    }
  }
}));

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key)
});

let clock = 0;
vi.stubGlobal("performance", { now: () => clock });

const { edgeLightHandlers } = await import("./edgeLight");
const store = await import("./readingLightStore");
const { DRAG_SPAN, LIGHT_KEY } = await import("./readingLight");

// No DOM: a touch event is what the handlers read of one.
type FakeTouch = { identifier: number; clientX: number; clientY: number };
const touchList = (touches: FakeTouch[]) => Object.assign([...touches], { length: touches.length }) as unknown as TouchList;
const touchEvent = (touches: FakeTouch[], changed: FakeTouch[] = touches) => {
  const event = {
    touches: touchList(touches),
    changedTouches: touchList(changed),
    target: null,
    cancelable: true,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    }
  };
  return event as unknown as TouchEvent & { defaultPrevented: boolean };
};

const page = { left: 0, top: 0, width: 400, height: 800 };
const finger = (x: number, y: number): FakeTouch => ({ identifier: 1, clientX: x, clientY: y });

const handlers = (busy = false) =>
  edgeLightHandlers({ enabled: () => true, page: () => page, busy: () => busy });

/** Down at (x, y), then each step (dx, dy) after `ms` more; returns the events. */
const swipe = (light: ReturnType<typeof handlers>, x: number, y: number, steps: Array<[number, number, number]>) => {
  light.start(touchEvent([finger(x, y)]));
  const moves = steps.map(([dx, dy, ms]) => {
    clock += ms;
    const event = touchEvent([finger(x + dx, y + dy)]);
    light.move(event);
    return event;
  });
  return moves;
};

const lift = (light: ReturnType<typeof handlers>) => light.end(touchEvent([], [finger(0, 0)]));

describe("the swipe at the page's edges", () => {
  beforeEach(() => {
    stored.clear();
    sent.length = 0;
    clock = 1000;
    androidApp = true;
    store.resetLightForTests({ brightness: 0.5, warmth: 0 });
  });

  it("sets the brightness by a swipe up the left strip, and keeps the page from scrolling", async () => {
    const light = handlers();
    const moves = swipe(light, 20, 600, [[0, -6, 16], [1, -14, 16], [1, -14 - 80, 16]]);
    expect(moves.every((event) => event.defaultPrevented)).toBe(true);
    // Measured from where the swipe became the light's: no jump for the first pixels.
    expect(store.useReadingLight.getState().brightness).toBeCloseTo(0.5 + 80 / (800 * DRAG_SPAN), 2);
    expect(store.useReadingLight.getState().pill).toBe("brightness");
    expect(store.useReadingLight.getState().pillHeld).toBe(true);
    expect(stored.has(LIGHT_KEY)).toBe(false);
    lift(light);
    expect(store.useReadingLight.getState().pillHeld).toBe(false);
    expect(JSON.parse(stored.get(LIGHT_KEY)!).brightness).toBe(store.useReadingLight.getState().brightness);
    await Promise.resolve();
    expect(sent.length).toBeGreaterThan(0);
  });

  it("sets the warmth by a swipe down the right strip", () => {
    store.resetLightForTests({ brightness: null, warmth: 0.5 });
    const light = handlers();
    swipe(light, 385, 200, [[0, 14, 16], [0, 14 + 44, 16]]);
    lift(light);
    expect(store.useReadingLight.getState().warmth).toBeCloseTo(0.5 - 44 / (800 * DRAG_SPAN), 2);
    expect(store.useReadingLight.getState().brightness).toBeNull();
    expect(sent).toEqual([]);
  });

  it("lets a swipe across from the strip go, to turn the page", () => {
    const light = handlers();
    const moves = swipe(light, 20, 400, [[2, 0, 16], [14, 1, 16], [60, 2, 16]]);
    lift(light);
    expect(moves[0].defaultPrevented).toBe(false);
    expect(moves[2].defaultPrevented).toBe(false);
    expect(store.useReadingLight.getState().brightness).toBe(0.5);
    expect(store.useReadingLight.getState().pill).toBeNull();
  });

  it("leaves a swipe in the middle of the page to the page", () => {
    const light = handlers();
    const moves = swipe(light, 200, 400, [[0, -20, 16], [0, -120, 16]]);
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    expect(store.useReadingLight.getState().brightness).toBe(0.5);
  });

  it("never takes a press and hold, even when the finger moves after", () => {
    const light = handlers();
    const moves = swipe(light, 20, 400, [[0, 0, 500], [0, -60, 16]]);
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    expect(store.useReadingLight.getState().pill).toBeNull();
  });

  it("does not take a finger that stays still (a tap)", () => {
    const light = handlers();
    const moves = swipe(light, 20, 400, [[1, 1, 16]]);
    lift(light);
    expect(moves[0].defaultPrevented).toBe(false);
    expect(store.useReadingLight.getState().pill).toBeNull();
  });

  it("does nothing while something is selected or open over the page", () => {
    const light = handlers(true);
    const moves = swipe(light, 20, 400, [[0, -20, 16], [0, -120, 16]]);
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
    expect(store.useReadingLight.getState().brightness).toBe(0.5);
  });

  it("lets go when a second finger comes (a pinch)", () => {
    const light = handlers();
    swipe(light, 20, 600, [[0, -20, 16]]);
    const before = store.useReadingLight.getState().brightness;
    const second = touchEvent([finger(20, 580), { identifier: 2, clientX: 200, clientY: 300 }]);
    light.start(second);
    expect(store.useReadingLight.getState().pillHeld).toBe(false);
    light.move(touchEvent([finger(20, 300), { identifier: 2, clientX: 200, clientY: 300 }]));
    expect(store.useReadingLight.getState().brightness).toBe(before);
  });

  it("is off when the reader says so", () => {
    const light = edgeLightHandlers({ enabled: () => false, page: () => page });
    const moves = swipe(light, 20, 600, [[0, -20, 16], [0, -120, 16]]);
    expect(moves.some((event) => event.defaultPrevented)).toBe(false);
  });
});

describe("the light's state", () => {
  beforeEach(() => {
    stored.clear();
    sent.length = 0;
    androidApp = true;
    store.resetLightForTests({ brightness: null, warmth: 0 });
  });

  it("starts a swipe from the phone's own brightness while following the system", async () => {
    expect(store.startLevel("brightness")).toBe(1);
    store.enterReader();
    await new Promise((done) => setTimeout(done, 0));
    expect(sent).toEqual([null]);
    expect(store.useReadingLight.getState().system).toBe(0.5);
    expect(store.startLevel("brightness")).toBeGreaterThan(0.2);
    expect(store.startLevel("brightness")).toBeLessThan(1);
  });

  it("starts at the top on a computer, where only the veil dims", () => {
    androidApp = false;
    expect(store.startLevel("brightness")).toBe(1);
    store.setLight("brightness", 0.4);
    expect(sent).toEqual([]);
  });

  it("sends only the newest of the levels a swipe asks for while Android answers", async () => {
    store.setLight("brightness", 0.9, { held: true });
    store.setLight("brightness", 0.8, { held: true });
    store.setLight("brightness", 0.7, { held: true });
    await new Promise((done) => setTimeout(done, 0));
    expect(sent.length).toBe(2);
    expect(sent[1]).toBeCloseTo(0.01 + 0.99 * ((0.7 - 0.2) / 0.8), 3);
  });

  it("keeps a slider's level at once, and the reset follows the system again", async () => {
    store.setLight("warmth", 0.3, { pill: false });
    expect(JSON.parse(stored.get(LIGHT_KEY)!)).toEqual({ brightness: "system", warmth: 0.3 });
    expect(store.useReadingLight.getState().pill).toBeNull();
    store.setLight("brightness", 0.1);
    store.resetLight("brightness");
    await new Promise((done) => setTimeout(done, 0));
    expect(store.useReadingLight.getState().brightness).toBeNull();
    expect(sent[sent.length - 1]).toBeNull();
    expect(JSON.parse(stored.get(LIGHT_KEY)!)).toEqual({ brightness: "system", warmth: 0.3 });
  });

  it("gives the window back to the system when the reader closes", async () => {
    store.setLight("brightness", 0.3);
    store.leaveReader();
    await new Promise((done) => setTimeout(done, 0));
    expect(sent[sent.length - 1]).toBeNull();
    expect(store.useReadingLight.getState().pill).toBeNull();
    // The level itself is kept for the next book.
    expect(store.useReadingLight.getState().brightness).toBe(0.3);
  });
});
