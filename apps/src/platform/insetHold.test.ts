import { describe, expect, it } from "vitest";
import { chooseInsets, insetMemory, receiveInsets, seeAspect, sidewaysInsets, turnedUpright } from "./insetHold";

// The emulator's phone (412 x 915): a notch at the top upright, at the left on its side.
const UPRIGHT = { top: 52, right: 0, bottom: 24, left: 0 };
const SIDEWAYS = { top: 28.19, right: 0, bottom: 24, left: 51.81 };

describe("the insets laid out while the screen turns", () => {
  it("tells a phone on its side's insets by the notch or buttons at a side", () => {
    expect(sidewaysInsets(SIDEWAYS)).toBe(true);
    expect(sidewaysInsets(UPRIGHT)).toBe(false);
    expect(sidewaysInsets({ top: 24, right: 48, bottom: 0, left: 0 })).toBe(true);
  });

  it("leaving Pip: the upright library never gets the sideways insets that are still the latest", () => {
    const memory = insetMemory();
    // The library, upright, before Pip.
    seeAspect(memory, "portrait", 0);
    receiveInsets(memory, UPRIGHT, 10);
    expect(chooseInsets(memory)).toEqual({ insets: UPRIGHT, settled: true });
    // Pip's tab, on its side.
    seeAspect(memory, "landscape", 1000);
    receiveInsets(memory, SIDEWAYS, 1200);
    expect(chooseInsets(memory)).toEqual({ insets: SIDEWAYS, settled: true });
    // Back to the library: the window is upright 100 to 300 ms before its insets come.
    seeAspect(memory, "portrait", 5000);
    const held = chooseInsets(memory);
    expect(held.insets).toMatchObject(UPRIGHT);
    expect(held.settled).toBe(false);
    // They come.
    receiveInsets(memory, UPRIGHT, 5200);
    expect(chooseInsets(memory)).toEqual({ insets: UPRIGHT, settled: true });
  });

  it("with no upright insets yet, turns the sideways ones upright: the notch at the top", () => {
    const memory = insetMemory();
    seeAspect(memory, "landscape", 0);
    receiveInsets(memory, SIDEWAYS, 10);
    seeAspect(memory, "portrait", 500);
    const held = chooseInsets(memory);
    expect(held.settled).toBe(false);
    expect(held.insets).toEqual(turnedUpright(SIDEWAYS));
    expect(held.insets?.top).toBeCloseTo(51.81);
    expect(held.insets?.left).toBe(0);
  });

  it("entering Pip: the window on its side keeps the sideways insets it had before, not the upright ones still the latest", () => {
    const memory = insetMemory();
    seeAspect(memory, "portrait", 0);
    receiveInsets(memory, UPRIGHT, 10);
    chooseInsets(memory);
    seeAspect(memory, "landscape", 100);
    receiveInsets(memory, SIDEWAYS, 200);
    chooseInsets(memory);
    seeAspect(memory, "portrait", 300);
    receiveInsets(memory, UPRIGHT, 400);
    chooseInsets(memory);
    // Pip again: the window has turned, the insets have not been sent yet.
    seeAspect(memory, "landscape", 900);
    expect(chooseInsets(memory)).toEqual({ insets: { ...SIDEWAYS, keyboard: undefined }, settled: false });
    receiveInsets(memory, SIDEWAYS, 1100);
    expect(chooseInsets(memory)).toEqual({ insets: SIDEWAYS, settled: true });
  });

  it("insets sent just before the window turns are taken when they are plainly that way up", () => {
    const memory = insetMemory();
    seeAspect(memory, "portrait", 0);
    receiveInsets(memory, UPRIGHT, 10);
    chooseInsets(memory);
    // Entering Pip: the sideways insets come while the window is still upright; held, not laid out.
    receiveInsets(memory, SIDEWAYS, 100);
    expect(chooseInsets(memory).insets).toMatchObject(UPRIGHT);
    // Then the window turns: they are the ones.
    seeAspect(memory, "landscape", 150);
    expect(chooseInsets(memory)).toEqual({ insets: SIDEWAYS, settled: true });
  });

  it("a first turn to a side with no side insets waits for insets sent after it", () => {
    const memory = insetMemory();
    seeAspect(memory, "portrait", 0);
    receiveInsets(memory, UPRIGHT, 10);
    chooseInsets(memory);
    seeAspect(memory, "landscape", 100);
    // Nothing to hold to: laid out as they are, but not settled until the new ones come.
    expect(chooseInsets(memory)).toEqual({ insets: UPRIGHT, settled: false });
    const bare = { top: 24, right: 0, bottom: 20, left: 0 };
    receiveInsets(memory, bare, 300);
    expect(chooseInsets(memory)).toEqual({ insets: bare, settled: true });
  });

  it("is settled where no insets are sent (off Android)", () => {
    const memory = insetMemory();
    seeAspect(memory, "landscape", 0);
    seeAspect(memory, "portrait", 10);
    expect(chooseInsets(memory)).toEqual({ insets: null, settled: true });
  });
});
