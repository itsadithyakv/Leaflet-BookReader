import { describe, expect, it } from "vitest";
import { PULL_BEFORE_OPEN_AFTER_MS, SYNC_ON_LEAVING_AFTER_MS, SYNC_ON_RETURN_AFTER_MS, syncDue } from "./syncTiming";

describe("when a sync runs as the app leaves, returns, and opens a book", () => {
  it("never runs with nowhere to sync to", () => {
    expect(syncDue("hidden", null, false)).toBe(false);
    expect(syncDue("visible", 10 * 60_000, false)).toBe(false);
    expect(syncDue("open", null, false)).toBe(false);
  });

  it("runs when there has been none since launch", () => {
    expect(syncDue("hidden", null, true)).toBe(true);
    expect(syncDue("visible", null, true)).toBe(true);
    expect(syncDue("open", null, true)).toBe(true);
  });

  it("leaving: not on the heels of another sync, since a book closing has just run one", () => {
    expect(syncDue("hidden", SYNC_ON_LEAVING_AFTER_MS - 1, true)).toBe(false);
    expect(syncDue("hidden", SYNC_ON_LEAVING_AFTER_MS, true)).toBe(true);
  });

  it("returning: only after long enough for another device to have written", () => {
    expect(syncDue("visible", SYNC_ON_LEAVING_AFTER_MS, true)).toBe(false);
    expect(syncDue("visible", SYNC_ON_RETURN_AFTER_MS - 1, true)).toBe(false);
    expect(syncDue("visible", SYNC_ON_RETURN_AFTER_MS, true)).toBe(true);
  });

  it("opening a book: a pull first, unless one has just run", () => {
    expect(syncDue("open", PULL_BEFORE_OPEN_AFTER_MS - 1, true)).toBe(false);
    expect(syncDue("open", PULL_BEFORE_OPEN_AFTER_MS, true)).toBe(true);
  });
});
