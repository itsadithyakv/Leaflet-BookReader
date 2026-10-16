import { describe, expect, it } from "vitest";
import { GHOST_MS, isGhostClick, type Press } from "./ghostClick";

const canvas = { id: "canvas" } as unknown as EventTarget;
const tile = { id: "burrow tile" } as unknown as EventTarget;
const press: Press = { x: 300, y: 200, at: 1000, target: canvas };

describe("a finger's tap on the camp's picture, and the click that follows it", () => {
  it("drops the click that lands on a panel opened under the finger", () => {
    expect(isGhostClick(press, { x: 301, y: 199, at: 1120, target: tile })).toBe(true);
  });

  it("lets the picture's own click through (a double tap still reaches it)", () => {
    expect(isGhostClick(press, { x: 300, y: 200, at: 1120, target: canvas })).toBe(false);
  });

  it("lets a real tap on the panel through: later, or somewhere else", () => {
    expect(isGhostClick(press, { x: 300, y: 200, at: 1000 + GHOST_MS + 1, target: tile })).toBe(false);
    expect(isGhostClick(press, { x: 360, y: 200, at: 1100, target: tile })).toBe(false);
  });

  it("does nothing without a finger's press (a mouse's click is never a ghost)", () => {
    expect(isGhostClick(null, { x: 300, y: 200, at: 1100, target: tile })).toBe(false);
  });

  it("never drops a click from before the press", () => {
    expect(isGhostClick(press, { x: 300, y: 200, at: 900, target: tile })).toBe(false);
  });
});
