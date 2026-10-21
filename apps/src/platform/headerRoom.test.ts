import { afterEach, describe, expect, it, vi } from "vitest";
import { headerBodyHeight, watchHeaderRoom } from "./headerRoom";

describe("the room the floating header takes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the header less its top padding, never below nothing", () => {
    // Upright on the emulator: 129 px tall with 52 px of status bar and 12 of its own padding.
    expect(headerBodyHeight(129, 64)).toBe(65);
    expect(headerBodyHeight(129.19, 64.19)).toBe(65);
    // Hidden (Pip's tab on its side): it measures nothing.
    expect(headerBodyHeight(0, 18)).toBe(0);
    expect(headerBodyHeight(40, Number.NaN)).toBe(40);
  });

  it("is written on the shell without the inset, and watched by the border box", () => {
    let paddingTop = 40;
    let height = 105;
    const observed: { target: unknown; options: unknown }[] = [];
    let fire = () => undefined as void;
    class FakeObserver {
      constructor(callback: () => void) {
        fire = callback;
      }
      observe(target: unknown, options?: unknown) {
        observed.push({ target, options });
      }
      disconnect() {
        observed.length = 0;
      }
    }
    vi.stubGlobal("ResizeObserver", FakeObserver);
    vi.stubGlobal("getComputedStyle", () => ({ paddingTop: `${paddingTop}px` }));
    const props = new Map<string, string>();
    const shell = { style: { setProperty: (name: string, value: string) => props.set(name, value) } } as unknown as HTMLElement;
    const header = { getBoundingClientRect: () => ({ height }) } as unknown as HTMLElement;

    const stop = watchHeaderRoom(shell, header);
    expect(props.get("--app-header-body-h")).toBe("65px");
    // Only the body is measured: the shell is never told the whole height (CSS adds the inset).
    expect(props.has("--app-header-h")).toBe(false);
    // A padding-only change does not change the content box: the border box is the one watched.
    expect(observed).toEqual([{ target: header, options: { box: "border-box" } }]);

    // Android sends the real inset (28 -> 52): the padding grows, the body does not.
    paddingTop = 64;
    height = 129;
    fire();
    expect(props.get("--app-header-body-h")).toBe("65px");
    // A taller body (a bigger font) is caught.
    height = 133;
    fire();
    expect(props.get("--app-header-body-h")).toBe("69px");

    stop();
    expect(observed).toEqual([]);
  });
});
