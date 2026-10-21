import { describe, expect, it } from "vitest";
import { TURN_LANDED_MS, TURN_SETTLE_MS, turnSettleMs } from "./readerVeil";

describe("how long a turn waits before the book is laid out", () => {
  it("waits for the window to keep its size while the screen still says the other way up", () => {
    expect(turnSettleMs(852, 393, "portrait-primary")).toBe(TURN_SETTLE_MS);
    expect(turnSettleMs(393, 852, "landscape-primary")).toBe(TURN_SETTLE_MS);
  });

  it("waits only a moment once the screen agrees with the window: the turn has landed", () => {
    expect(turnSettleMs(852, 393, "landscape-primary")).toBe(TURN_LANDED_MS);
    expect(turnSettleMs(393, 852, "portrait-secondary")).toBe(TURN_LANDED_MS);
  });

  it("waits the whole while where the screen says nothing, or the window is square", () => {
    expect(turnSettleMs(852, 393, undefined)).toBe(TURN_SETTLE_MS);
    expect(turnSettleMs(600, 600, "landscape-primary")).toBe(TURN_SETTLE_MS);
  });
});
