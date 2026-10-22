import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { HOLD_LONGEST_MS, pushHold } from "./pushHold";
import { SYNC_ON_LEAVING_AFTER_MS, syncDue } from "./syncTiming";
import { syncService } from "./syncService";
import { bookService } from "./bookService";
import { useLibraryStore } from "../store/libraryStore";

describe("highlights and notes wait while a book is open", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushHold.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    pushHold.reset();
  });

  it("goes at once with no book open", () => {
    const flush = vi.fn();
    expect(pushHold.hold(flush)).toBe(false);
    expect(pushHold.waiting()).toBe(false);
    vi.advanceTimersByTime(HOLD_LONGEST_MS * 2);
    expect(flush).not.toHaveBeenCalled();
  });

  it("waits while one is, five minutes at the most from the first change", () => {
    const flush = vi.fn();
    pushHold.setReading(true);
    expect(pushHold.hold(flush, 0)).toBe(true);
    vi.advanceTimersByTime(HOLD_LONGEST_MS - 60_000);
    // A later change does not push the five minutes back.
    expect(pushHold.hold(flush)).toBe(true);
    expect(pushHold.waitingSince()).toBe(0);
    vi.advanceTimersByTime(59_999);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(pushHold.waiting()).toBe(false);
    // And it starts over with the next change.
    expect(pushHold.hold(flush)).toBe(true);
    expect(pushHold.waiting()).toBe(true);
  });

  it("lets go when the book closes or a sync carries what waited", () => {
    const flush = vi.fn();
    pushHold.setReading(true);
    pushHold.hold(flush);
    pushHold.setReading(false);
    expect(pushHold.waiting()).toBe(false);
    vi.advanceTimersByTime(HOLD_LONGEST_MS);
    // The close's own sync carried it.
    expect(flush).not.toHaveBeenCalled();

    pushHold.setReading(true);
    pushHold.hold(flush);
    pushHold.carried();
    vi.advanceTimersByTime(HOLD_LONGEST_MS);
    expect(flush).not.toHaveBeenCalled();
  });

  it("never keeps going out of sight from syncing", () => {
    // Just after another sync, hiding waits its turn, unless something waits.
    expect(syncDue("hidden", SYNC_ON_LEAVING_AFTER_MS - 1, true)).toBe(false);
    expect(syncDue("hidden", SYNC_ON_LEAVING_AFTER_MS - 1, true, true)).toBe(true);
    expect(syncDue("hidden", 0, true, true)).toBe(true);
    // Coming back is no reason to rush, and nowhere to sync to is still nowhere.
    expect(syncDue("visible", 0, true, true)).toBe(false);
    expect(syncDue("hidden", 0, false, true)).toBe(false);
  });
});

describe("the library asks for a backup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushHold.reset();
    useLibraryStore.setState({ sync: { ...EMPTY_SYNC_STATUS, accountBackup: true } });
    vi.spyOn(bookService, "list").mockResolvedValue([]);
    vi.spyOn(bookService, "finishedRemoved").mockResolvedValue([]);
    vi.spyOn(syncService, "status").mockResolvedValue({ ...EMPTY_SYNC_STATUS, accountBackup: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    pushHold.reset();
    useLibraryStore.getState().resetAll();
  });

  it("holds a highlight's backup while reading, and sends it when the book closes", async () => {
    const run = vi.spyOn(syncService, "syncNow").mockResolvedValue({
      booksUploaded: 0,
      booksDownloaded: 0,
      booksRemoved: 0,
      booksPending: 0,
      entriesUpdated: 0,
      booksHeld: 0,
      updateNeeded: false,
      ownerPaused: false,
      accountHolds: null
    });
    pushHold.setReading(true);
    for (let mark = 0; mark < 20; mark += 1) {
      useLibraryStore.getState().requestBackup({ whileReading: true });
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(run).not.toHaveBeenCalled();

    // The book closes: one sync for the twenty.
    pushHold.setReading(false);
    useLibraryStore.getState().requestBackup();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(run).toHaveBeenCalledTimes(1);
    expect(pushHold.waiting()).toBe(false);
  });

  it("sends what waited after five minutes of reading on", async () => {
    const run = vi.spyOn(syncService, "syncNow").mockRejectedValue(new Error("offline"));
    pushHold.setReading(true);
    useLibraryStore.getState().requestBackup({ whileReading: true });
    await vi.advanceTimersByTimeAsync(HOLD_LONGEST_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 + 1_500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not hold a change made with no book open, or one that is not a mark", async () => {
    const run = vi.spyOn(syncService, "syncNow").mockRejectedValue(new Error("offline"));
    useLibraryStore.getState().requestBackup({ whileReading: true });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(run).toHaveBeenCalledTimes(1);

    pushHold.setReading(true);
    useLibraryStore.getState().requestBackup();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
