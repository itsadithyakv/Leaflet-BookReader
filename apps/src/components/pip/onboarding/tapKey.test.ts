import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_MS, SLOP_PX, resetTapKeys, tapKey } from "./tapKey";

/** A key on the screen: where it is, and whether it has the pointer. */
const keyAt = (left: number, top: number, width = 60, height = 32) => {
  const key = {
    box: { left, top, right: left + width, bottom: top + height },
    captured: null as number | null,
    getBoundingClientRect() {
      return { ...this.box, width: this.box.right - this.box.left, height: this.box.bottom - this.box.top };
    },
    setPointerCapture(id: number) {
      this.captured = id;
    }
  };
  return key;
};
type Key = ReturnType<typeof keyAt>;

const pointer = (key: Key, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ currentTarget: key, pointerId: 1, button: 0, clientX: x, clientY: y, ...extra }) as never;
const click = (key: Key, detail = 1) => ({ currentTarget: key, detail, clientX: 0, clientY: 0 }) as never;

/** The window's capture listeners, as the key's swallowing of the click after it uses them. */
const windowClicks: Array<(event: Event) => void> = [];

describe("a key in Pip's tour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    windowClicks.length = 0;
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: Event) => void) => type === "click" && windowClicks.push(listener),
      removeEventListener: (type: string, listener: (event: Event) => void) => {
        const at = windowClicks.indexOf(listener);
        if (at >= 0) windowClicks.splice(at, 1);
      },
      setTimeout: (run: () => void, ms: number) => setTimeout(run, ms)
    });
    resetTapKeys();
  });
  afterEach(() => {
    resetTapKeys();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is pressed as the finger lifts, a long press too, with no click after it (the logged miss: 818 ms)", () => {
    const act = vi.fn();
    const key = keyAt(300, 200);
    const handlers = tapKey(act);
    handlers.onPointerDown(pointer(key, 320, 210));
    expect(key.captured).toBe(1);
    vi.advanceTimersByTime(818);
    handlers.onPointerUp(pointer(key, 322, 212));
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("is pressed once, not again by the click that follows a short tap; nor does that click reach the page", () => {
    const act = vi.fn();
    const key = keyAt(300, 200);
    const handlers = tapKey(act);
    handlers.onPointerDown(pointer(key, 320, 210));
    handlers.onPointerUp(pointer(key, 320, 210));
    // The page's click, at the window first: stopped there (whatever is under the finger once the bubble has gone).
    const event = { detail: 1, clientX: 320, clientY: 210, stopPropagation: vi.fn(), preventDefault: vi.fn() };
    windowClicks.forEach((listener) => listener(event as never));
    expect(event.stopPropagation).toHaveBeenCalled();
    // And on the key itself, were it to get there: no second press.
    handlers.onClick(click(key));
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("is pressed when the key moved under the finger between press and release", () => {
    const act = vi.fn();
    const key = keyAt(348, 200);
    const handlers = tapKey(act);
    handlers.onPointerDown(pointer(key, 370, 210));
    // The bubble moved 87 px (348 to 435): the finger is let go where the key was.
    key.box = { left: 435, top: 200, right: 495, bottom: 232 };
    handlers.onPointerUp(pointer(key, 371, 211));
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("is not pressed by a finger that slid off it, or by a press that began elsewhere", () => {
    const act = vi.fn();
    const key = keyAt(300, 200);
    const handlers = tapKey(act);
    handlers.onPointerDown(pointer(key, 320, 210));
    handlers.onPointerUp(pointer(key, 320 + 60 + SLOP_PX + 30, 210));
    expect(act).not.toHaveBeenCalled();
    // A release with no press on it (the press began on the page).
    handlers.onPointerUp(pointer(key, 320, 210));
    expect(act).not.toHaveBeenCalled();
    // A press the browser took for a scroll.
    handlers.onPointerDown(pointer(key, 320, 210));
    handlers.onPointerCancel(pointer(key, 320, 210));
    handlers.onPointerUp(pointer(key, 320, 210));
    expect(act).not.toHaveBeenCalled();
    // The mouse's other buttons.
    handlers.onPointerDown(pointer(key, 320, 210, { button: 2 }));
    handlers.onPointerUp(pointer(key, 320, 210));
    expect(act).not.toHaveBeenCalled();
  });

  it("is pressed by the keyboard (a click with no pointer), even just after a tap", () => {
    const act = vi.fn();
    const key = keyAt(300, 200);
    const handlers = tapKey(act);
    handlers.onClick(click(key, 0));
    expect(act).toHaveBeenCalledTimes(1);
    handlers.onPointerDown(pointer(key, 320, 210));
    handlers.onPointerUp(pointer(key, 320, 210));
    handlers.onClick(click(key, 0));
    expect(act).toHaveBeenCalledTimes(3);
  });

  it("takes a click with no press before it (a screen reader's) as a press, and a late click as a new one", () => {
    const act = vi.fn();
    const key = keyAt(300, 200);
    const handlers = tapKey(act);
    handlers.onClick(click(key));
    expect(act).toHaveBeenCalledTimes(1);
    handlers.onPointerDown(pointer(key, 320, 210));
    handlers.onPointerUp(pointer(key, 320, 210));
    vi.advanceTimersByTime(FOLLOW_MS + 1);
    handlers.onClick(click(key));
    expect(act).toHaveBeenCalledTimes(3);
  });

  it("keeps the phone's long-press menu off it", () => {
    const preventDefault = vi.fn();
    tapKey(() => undefined).onContextMenu({ preventDefault } as never);
    expect(preventDefault).toHaveBeenCalled();
  });
});
