import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachDrawerSwipe, endsDrawerDrag, startsDrawerDrag } from "./drawerSwipe";

/** A touch event as a phone's WebView sends it, at (x, y), `at` ms in. */
const touch = (type: string, x: number, y: number, at: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const one = { identifier: 1, clientX: x, clientY: y };
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [one] });
  Object.defineProperty(event, "timeStamp", { value: at });
  return event;
};

describe("the chapter list's swipe", () => {
  it("is the drawer's toward the left edge, and the list's up or down", () => {
    expect(startsDrawerDrag(-3, 1)).toBe("wait");
    expect(startsDrawerDrag(-20, 4)).toBe("drag");
    expect(startsDrawerDrag(-4, 30)).toBe("pass");
    expect(startsDrawerDrag(4, -30)).toBe("pass");
    // Toward the page is nothing of the drawer's.
    expect(startsDrawerDrag(20, 2)).toBe("pass");
  });

  it("closes pushed far enough or flicked, as a sheet does", () => {
    expect(endsDrawerDrag(120, 0, 320)).toBe("close");
    expect(endsDrawerDrag(30, 0.9, 320)).toBe("close");
    expect(endsDrawerDrag(30, 0.1, 320)).toBe("stay");
  });
});

describe("swiping the chapter list away", () => {
  /** The drawer, as much of an element as the swipe uses. */
  class Drawer extends EventTarget {
    style = { transform: "", transition: "" };
    offsetWidth = 320;
    closest() {
      return null;
    }
  }
  let panel: Drawer;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Element", Drawer);
    vi.stubGlobal("window", { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms) });
    panel = new Drawer();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("follows the finger, and closes when let go far enough over", () => {
    const onClose = vi.fn();
    const detach = attachDrawerSwipe(panel as unknown as HTMLElement, onClose);
    panel.dispatchEvent(touch("touchstart", 300, 400, 0));
    panel.dispatchEvent(touch("touchmove", 280, 402, 100));
    panel.dispatchEvent(touch("touchmove", 150, 404, 400));
    expect(panel.style.transform).toBe("translateX(-150px)");
    panel.dispatchEvent(touch("touchend", 150, 404, 900));
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    // The stylesheet's closed drawer takes it from there.
    expect(panel.style.transform).toBe("");
    detach();
  });

  it("springs back from a short push, and leaves a scroll of the list alone", () => {
    const onClose = vi.fn();
    const detach = attachDrawerSwipe(panel as unknown as HTMLElement, onClose);
    panel.dispatchEvent(touch("touchstart", 300, 400, 0));
    panel.dispatchEvent(touch("touchmove", 280, 401, 300));
    panel.dispatchEvent(touch("touchmove", 270, 401, 600));
    panel.dispatchEvent(touch("touchend", 270, 401, 900));
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(panel.style.transform).toBe("");

    panel.dispatchEvent(touch("touchstart", 300, 400, 1000));
    const scroll = touch("touchmove", 296, 300, 1100);
    panel.dispatchEvent(scroll);
    panel.dispatchEvent(touch("touchend", 296, 300, 1200));
    expect(scroll.defaultPrevented).toBe(false);
    expect(panel.style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    detach();
  });
});
