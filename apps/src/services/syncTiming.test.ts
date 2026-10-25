import { describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import type { Book } from "@shared/models/book";
import { useLibraryStore } from "../store/libraryStore";
import { PULL_BEFORE_OPEN_AFTER_MS, SYNC_ON_LEAVING_AFTER_MS, SYNC_ON_RETURN_AFTER_MS, syncDue, syncFor } from "./syncTiming";

describe("a place read just after a sync (2026-10-25)", () => {
  it("goes up as the app leaves, however soon after the pull that opened the book", async () => {
    const book = { id: "b1", title: "The Hero of Ages", progress: 0.28, position: "epubcfi(/6/72!/4/8/1:279)" } as Book;
    const syncNow = vi.fn(async () => {
      useLibraryStore.setState({ syncStatus: "syncing" });
      useLibraryStore.setState({ syncStatus: "success" });
    });
    useLibraryStore.setState({ books: [book], sync: { ...EMPTY_SYNC_STATUS, accountBackup: true }, syncStatus: "idle", syncNow } as never);
    const t = Date.now();

    // Opening the book pulls first.
    await syncFor("open", t);
    expect(syncNow).toHaveBeenCalledTimes(1);
    // Locked a moment later, nothing read: the gap holds, nothing to send.
    await syncFor("hidden", t + 5_000);
    expect(syncNow).toHaveBeenCalledTimes(1);
    // A page or two read, then locked, still well inside the gap: the place goes up.
    useLibraryStore.getState().updateBookProgress("b1", 0.29, "epubcfi(/6/72!/4/10/1:12)");
    await syncFor("hidden", t + 20_000);
    expect(syncNow).toHaveBeenCalledTimes(2);
    // And once it has, leaving again on its heels waits as before.
    await syncFor("hidden", t + 25_000);
    expect(syncNow).toHaveBeenCalledTimes(2);
  });
});

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
