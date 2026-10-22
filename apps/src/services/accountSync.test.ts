import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { EMPTY_SYNC_STATUS, type SyncReport, type SyncStatus } from "@shared/sync/types";
import type { Book } from "@shared/models/book";
import { syncService } from "./syncService";
import { syncConfigured } from "./syncTiming";
import { bookService } from "./bookService";
import { useLibraryStore } from "../store/libraryStore";
import { backupLine, backupTitle, driveLine, failedLine, roomLine } from "../components/ProfileButton";

const status = (over: Partial<SyncStatus>): SyncStatus => ({ ...EMPTY_SYNC_STATUS, ...over });
const other = { standing: "other", stayOut: false, elsewhere: false, refused: null } as const;
const report = (over: Partial<SyncReport> = {}): SyncReport => ({
  booksUploaded: 0,
  booksDownloaded: 0,
  booksRemoved: 0,
  booksPending: 0,
  entriesUpdated: 0,
  ...over
});

describe("the sync status before the backend has said anything", () => {
  it("is signed out, unowned and with nothing set up", () => {
    expect(EMPTY_SYNC_STATUS).toMatchObject({
      driveConnected: false,
      folderPath: null,
      accountBackup: false,
      library: { standing: "unowned", stayOut: false, elsewhere: false, refused: null },
      driveFilesOnly: false,
      folderFilesOnly: false
    });
  });
});

describe("account sync has no switch", () => {
  it("is gone from the service, the store and the Backup card", () => {
    expect("setAccountBackup" in syncService).toBe(false);
    expect("setAccountBackup" in useLibraryStore.getState()).toBe(false);
    const page = Object.values(import.meta.glob("../pages/SettingsPage.tsx", { query: "?raw", import: "default", eager: true }))[0] as string;
    expect(page).toContain("OWNER_COPY.accountSynced");
    expect(page).not.toContain("Back up reading to my Leaflet account");
    expect(page).not.toContain("setAccountBackup");
    expect(page).not.toContain("set_account_backup");
  });
});

describe("where there is somewhere to sync to", () => {
  it("counts the account itself (signed in, the library its own) with nothing else set up", () => {
    expect(syncConfigured(status({}))).toBe(false);
    expect(syncConfigured(status({ accountBackup: true }))).toBe(true);
    expect(syncConfigured(status({ driveConnected: true }))).toBe(true);
    expect(syncConfigured(status({ folderPath: "D:\\Sync" }))).toBe(true);
  });

  it("is nowhere while the library is another account's, Drive or not", () => {
    expect(syncConfigured(status({ library: other }))).toBe(false);
    expect(syncConfigured(status({ library: other, driveConnected: true, folderPath: "D:\\Sync" }))).toBe(false);
  });

  it("works against an older backend that sends no library at all", () => {
    const { library: _gone, ...older } = status({ accountBackup: true });
    expect(syncConfigured(older as SyncStatus)).toBe(true);
  });
});

describe("a sync run, signed in", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    useLibraryStore.getState().resetAll();
  });

  const run = async (result: SyncReport) => {
    vi.spyOn(syncService, "syncNow").mockResolvedValue(result);
    vi.spyOn(syncService, "status").mockResolvedValue(status({ library: other }));
    vi.spyOn(bookService, "list").mockResolvedValue([]);
    vi.spyOn(bookService, "finishedRemoved").mockResolvedValue([]);
    return useLibraryStore.getState().syncNow();
  };

  it("backs up after a change with only the account to go to", async () => {
    vi.useFakeTimers();
    const syncNow = vi.spyOn(syncService, "syncNow").mockResolvedValue(report());
    vi.spyOn(syncService, "status").mockResolvedValue(status({ accountBackup: true }));
    vi.spyOn(bookService, "list").mockResolvedValue([]);
    vi.spyOn(bookService, "finishedRemoved").mockResolvedValue([]);
    useLibraryStore.setState({ sync: status({ accountBackup: true }) });
    useLibraryStore.getState().requestBackup();
    await vi.advanceTimersByTimeAsync(2000);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("is no failure when the library is another account's: it is paused", async () => {
    const done = await run(report({ ownerPaused: true }));
    expect(done.ownerPaused).toBe(true);
    expect(useLibraryStore.getState().syncStatus).toBe("idle");
    expect(useLibraryStore.getState().syncError).toBeNull();
    expect(useLibraryStore.getState().accountHolds).toBeNull();
  });

  it("puts the question when Drive or the folder holds a library from before accounts, and the rest synced", async () => {
    await run(report({ storeHolds: { transport: "drive", books: 3 } }));
    expect(useLibraryStore.getState().storeHolds).toEqual({ transport: "drive", books: 3 });
    expect(useLibraryStore.getState().syncStatus).toBe("success");
    useLibraryStore.getState().dismissStoreHolds();
    expect(useLibraryStore.getState().storeHolds).toBeNull();
  });

  it("puts the question when a fresh library meets what the account held", async () => {
    await run(report({ accountHolds: 7 }));
    expect(useLibraryStore.getState().accountHolds).toBe(7);
    expect(useLibraryStore.getState().syncStatus).toBe("idle");
    useLibraryStore.getState().dismissAccountHolds();
    expect(useLibraryStore.getState().accountHolds).toBeNull();
  });

  it("re-reads the library when a run fails part-way, so a place it brought in is shown", async () => {
    const moved = [{ id: "well", title: "The Well of Ascension", progress: 0.72 }] as unknown as Book[];
    useLibraryStore.setState({ books: [{ id: "well", title: "The Well of Ascension", progress: 0.54 }] as unknown as Book[] });
    vi.spyOn(syncService, "syncNow").mockRejectedValue(new Error("Another device is syncing right now. Try again shortly."));
    vi.spyOn(syncService, "status").mockResolvedValue(status({ accountBackup: true }));
    vi.spyOn(bookService, "list").mockResolvedValue(moved);
    await expect(useLibraryStore.getState().syncNow()).rejects.toThrow("Another device");
    expect(useLibraryStore.getState().books[0].progress).toBe(0.72);
    expect(useLibraryStore.getState().syncStatus).toBe("error");
    expect(useLibraryStore.getState().syncError).toContain("Another device");
  });

  it("is a success when the account synced and only Drive is unavailable", async () => {
    await run(report({ driveUnavailable: "client_disabled" }));
    expect(useLibraryStore.getState().syncStatus).toBe("success");
    expect(useLibraryStore.getState().syncError).toBeNull();
  });

  it("asks Drive again only when the reader pressed Sync now", async () => {
    const syncNow = vi.spyOn(syncService, "syncNow").mockResolvedValue(report());
    vi.spyOn(syncService, "status").mockResolvedValue(status({ accountBackup: true }));
    vi.spyOn(bookService, "list").mockResolvedValue([]);
    vi.spyOn(bookService, "finishedRemoved").mockResolvedValue([]);
    await useLibraryStore.getState().syncNow();
    expect(syncNow).toHaveBeenLastCalledWith(false);
    await useLibraryStore.getState().syncNow({ manual: true });
    expect(syncNow).toHaveBeenLastCalledWith(true);
  });

  it("tells the backend which runs the reader asked for", async () => {
    invoke.mockResolvedValue(report());
    await syncService.syncNow(true);
    expect(invoke).toHaveBeenLastCalledWith("sync_now", { manual: true });
    await syncService.syncNow();
    expect(invoke).toHaveBeenLastCalledWith("sync_now", { manual: false });
  });

  it("asks nothing when the account had nothing to say", async () => {
    await run(report({ accountHolds: null }));
    expect(useLibraryStore.getState().accountHolds).toBeNull();
    expect(useLibraryStore.getState().syncStatus).toBe("success");
  });
});

describe("the profile button's line on sync", () => {
  it("says Paused for another account's library, whatever is connected", () => {
    expect(backupLine("drive", "idle", status({ library: other, driveConnected: true }))).toBe("Paused");
    expect(backupLine("off", "idle", status({ library: other }))).toBe("Paused");
    expect(backupTitle("drive", "idle", status({ library: other, driveConnected: true, driveFilesOnly: true }))).toBe("Paused");
  });

  it("adds Files only where Drive or the folder carries only book files", () => {
    const line = backupLine("drive", "idle", status({ driveConnected: true }));
    expect(line).not.toContain("Files only");
    expect(backupTitle("drive", "idle", status({ driveConnected: true, driveFilesOnly: true }))).toBe(`${line} · Files only`);
    expect(backupTitle("folder", "idle", status({ folderPath: "D:\\Sync", folderFilesOnly: true }))).toContain("Files only");
    // Files only, but Drive since disconnected: nothing to say.
    expect(backupTitle("account", "idle", status({ accountBackup: true, driveFilesOnly: true }))).not.toContain("Files only");
  });

  it("says since when nothing has got through, not only that the last try failed", () => {
    const now = new Date(2026, 9, 21, 16, 52);
    const lastWhole = new Date(2026, 9, 19, 15, 11);
    const line = failedLine({ lastSyncedAt: lastWhole.toISOString() }, now);
    expect(line).toMatch(/^Couldn't (sync|back up) since /);
    expect(line).toContain(lastWhole.toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    const earlier = new Date(2026, 9, 21, 9, 5);
    expect(failedLine({ lastSyncedAt: earlier.toISOString() }, now)).toContain(earlier.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    expect(failedLine({ lastSyncedAt: null }, now)).toMatch(/^Couldn't (sync|back up)$/);
    expect(backupLine("account", "error", status({ accountBackup: true, lastSyncedAt: lastWhole.toISOString() }))).toMatch(/^Couldn't (sync|back up) since /);
  });

  it("is the usual line for the account's own library", () => {
    const mine = status({ accountBackup: true, library: { standing: "mine", stayOut: false, elsewhere: false, refused: null } });
    expect(backupLine("account", "idle", mine)).not.toBe("Paused");
    expect(backupLine("account", "syncing", mine)).toMatch(/…$/);
  });
});

describe("Google refusing Drive while the account syncs", () => {
  const synced = new Date(Date.now() - 5 * 60_000).toISOString();
  const disabled = status({ accountBackup: true, driveConnected: true, lastSyncedAt: synced, driveUnavailable: "client_disabled" });
  const revoked = status({ accountBackup: true, driveConnected: true, lastSyncedAt: synced, driveUnavailable: "reconnect" });

  it("says Drive is unavailable when Google disabled Leaflet's client", () => {
    expect(driveLine(disabled)).toBe("Google Drive is unavailable right now");
  });

  it("asks to reconnect when the reader's grant is gone", () => {
    expect(driveLine(revoked)).toBe("Reconnect Google Drive");
  });

  it("says nothing when Drive is fine, or not connected", () => {
    expect(driveLine(status({ driveConnected: true }))).toBeNull();
    expect(driveLine(status({ driveConnected: false, driveUnavailable: "client_disabled" }))).toBeNull();
  });

  it("still shows the reading as synced, never as a failure", () => {
    const line = backupLine("drive", "success", disabled);
    expect(line).toMatch(/^(Synced|Backed up) /);
    expect(line).not.toContain("Couldn't");
    expect(backupTitle("drive", "success", disabled)).toBe(`${line} · Google Drive is unavailable right now`);
    expect(backupTitle("drive", "success", { ...revoked, driveFilesOnly: true })).toBe(`${line} · Files only · Reconnect Google Drive`);
  });
});

describe("the account's copy filling up", () => {
  const MB = 1024 * 1024;

  it("says so quietly, with the figures, from four fifths of the most", () => {
    const full = status({ accountBackup: true, accountUsage: { bytes: 1.7 * MB, limit: 2 * MB } });
    expect(roomLine(full)).toBe("Account sync nearly full · 1.7 of 2.0 MB");
    expect(backupTitle("account", "success", full)).toContain("Account sync nearly full · 1.7 of 2.0 MB");
    expect(backupLine("account", "success", full)).not.toContain("full");
  });

  it("says nothing otherwise", () => {
    expect(roomLine(status({ accountBackup: true }))).toBeNull();
    expect(roomLine(status({ accountBackup: true, accountUsage: null }))).toBeNull();
  });
});
