import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

import { EMPTY_SYNC_STATUS, type SyncReport, type SyncStatus } from "@shared/sync/types";
import { syncService } from "./syncService";
import { syncConfigured } from "./syncTiming";
import { bookService } from "./bookService";
import { useLibraryStore } from "../store/libraryStore";
import { backupLine, backupTitle } from "../components/ProfileButton";

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

  it("puts the question when a fresh library meets what the account held", async () => {
    await run(report({ accountHolds: 7 }));
    expect(useLibraryStore.getState().accountHolds).toBe(7);
    expect(useLibraryStore.getState().syncStatus).toBe("idle");
    useLibraryStore.getState().dismissAccountHolds();
    expect(useLibraryStore.getState().accountHolds).toBeNull();
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

  it("is the usual line for the account's own library", () => {
    const mine = status({ accountBackup: true, library: { standing: "mine", stayOut: false, elsewhere: false, refused: null } });
    expect(backupLine("account", "idle", mine)).not.toBe("Paused");
    expect(backupLine("account", "syncing", mine)).toMatch(/…$/);
  });
});
