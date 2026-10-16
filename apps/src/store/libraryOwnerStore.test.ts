import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const reload = vi.fn();
vi.stubGlobal("window", { location: { reload } });

import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import {
  SWITCH_REFUSED_BUSY,
  SWITCH_REFUSED_SESSION,
  connectLibraryOwner,
  resetLibraryOwnerRun,
  useLibraryOwnerStore
} from "./libraryOwnerStore";
import { useLibraryStore } from "./libraryStore";
import { useHabitStore, type ActiveSession } from "./habitStore";
import { useAccountStore } from "./accountStore";

/** The backend: `library_resolve` answers `action`; everything else succeeds quietly. */
const backend = (action: string | Error) =>
  invoke.mockImplementation(async (command: string) => {
    if (command === "library_resolve") {
      if (action instanceof Error) throw action;
      return { action };
    }
    if (command === "sync_status") return EMPTY_SYNC_STATUS;
    if (command === "list_books") return [];
    return null;
  });

const commands = () => invoke.mock.calls.map(([command]) => command as string);

describe("whose library this is, after a sign-in", () => {
  let toasts: string[];
  let closed: number;
  let disconnect: () => void;

  beforeEach(() => {
    invoke.mockReset();
    reload.mockReset();
    resetLibraryOwnerRun();
    toasts = [];
    closed = 0;
    disconnect = connectLibraryOwner({ showToast: (message) => toasts.push(message), closeReader: () => (closed += 1) });
    useLibraryOwnerStore.setState({ offerOpen: false, busy: false });
    useHabitStore.setState({ activeSession: null, flushReading: async () => null });
    useLibraryStore.setState({ importing: false, metadataRefreshing: false, accountHolds: null });
  });

  afterEach(() => disconnect());

  it("opens the account's own library when it has one here, closing the book first, and reloads", async () => {
    backend("switch");
    expect(await useLibraryOwnerStore.getState().resolve()).toBe("switch");
    expect(closed).toBe(1);
    expect(commands()).toContain("library_open_mine");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(false);
  });

  it("asks when the library is another account's and this one has none here", async () => {
    backend("offer");
    expect(await useLibraryOwnerStore.getState().resolve()).toBe("offer");
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("asks at launch at most once a run, but after every sign-in", async () => {
    backend("offer");
    await useLibraryOwnerStore.getState().resolve({ launch: true });
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(true);
    useLibraryOwnerStore.getState().closeOffer();
    await useLibraryOwnerStore.getState().resolve({ launch: true });
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(false);
    await useLibraryOwnerStore.getState().resolve();
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(true);
  });

  it("stays, asking nothing, when the library is the account's (or was just adopted)", async () => {
    for (const action of ["stay", "claimed"]) {
      backend(action);
      expect(await useLibraryOwnerStore.getState().resolve()).toBe(action);
      expect(useLibraryOwnerStore.getState().offerOpen).toBe(false);
    }
    expect(reload).not.toHaveBeenCalled();
    expect(commands()).not.toContain("library_open_mine");
  });

  it("says nothing against a build without the command", async () => {
    backend(new Error("command library_resolve not found"));
    expect(await useLibraryOwnerStore.getState().resolve()).toBeNull();
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(false);
    expect(toasts).toEqual([]);
  });

  it("refuses to switch during a focus session", async () => {
    backend("switch");
    useHabitStore.setState({ activeSession: { startedAt: new Date().toISOString() } as unknown as ActiveSession });
    expect(await useLibraryOwnerStore.getState().switchAndReload("fresh")).toBe(false);
    expect(toasts).toEqual([SWITCH_REFUSED_SESSION]);
    expect(commands()).not.toContain("library_start_fresh");
    expect(closed).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses to switch while books are coming in or being looked up", async () => {
    backend("stay");
    useLibraryStore.setState({ importing: true });
    expect(await useLibraryOwnerStore.getState().switchAndReload("mine")).toBe(false);
    useLibraryStore.setState({ importing: false, metadataRefreshing: true });
    expect(await useLibraryOwnerStore.getState().switchAndReload("mine")).toBe(false);
    expect(toasts).toEqual([SWITCH_REFUSED_BUSY, SWITCH_REFUSED_BUSY]);
    expect(commands()).not.toContain("library_open_mine");
  });

  it("starts a fresh library: flushes the reading, then switches, then reloads", async () => {
    backend("stay");
    const order: string[] = [];
    useHabitStore.setState({ flushReading: async () => (order.push("flush"), null) });
    invoke.mockImplementation(async (command: string) => {
      order.push(command);
      return null;
    });
    expect(await useLibraryOwnerStore.getState().switchAndReload("fresh")).toBe(true);
    expect(order).toEqual(["flush", "library_start_fresh"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("says why a switch failed, and stays", async () => {
    invoke.mockRejectedValue("This library belongs to another Leaflet account.");
    expect(await useLibraryOwnerStore.getState().switchAndReload("mine")).toBe(false);
    expect(toasts).toEqual(["This library belongs to another Leaflet account."]);
    expect(reload).not.toHaveBeenCalled();
    expect(useLibraryOwnerStore.getState().busy).toBe(false);
  });

  it("stays out of reading sync, and puts the question away", async () => {
    backend("offer");
    await useLibraryOwnerStore.getState().resolve();
    await useLibraryOwnerStore.getState().stayOut();
    expect(invoke).toHaveBeenCalledWith("library_stay_out", { on: true });
    expect(useLibraryOwnerStore.getState().offerOpen).toBe(false);
  });

  it("answers the account's earlier library, and the question goes", async () => {
    backend("stay");
    useLibraryStore.setState({ accountHolds: 12 });
    await useLibraryOwnerStore.getState().answerHolds(true);
    expect(invoke).toHaveBeenCalledWith("library_fresh_answer", { useIt: true });
    expect(useLibraryStore.getState().accountHolds).toBeNull();
    useLibraryStore.setState({ accountHolds: 3 });
    await useLibraryOwnerStore.getState().answerHolds(false);
    expect(invoke).toHaveBeenCalledWith("library_fresh_answer", { useIt: false });
  });
});

describe("signing in asks whose library this is", () => {
  const SIGNED_IN = {
    available: true,
    apiBase: "https://leaflet.example",
    signedIn: true,
    account: { id: "a1", email: "adi@example.com", displayName: "Adi", avatar: null, createdAt: null },
    offline: false
  };

  beforeEach(() => {
    invoke.mockReset();
    resetLibraryOwnerRun();
    useLibraryOwnerStore.setState({ offerOpen: false, busy: false });
  });

  it.each([
    ["signing in", () => useAccountStore.getState().signIn("adi@example.com", "secret")],
    ["a new password", () => useAccountStore.getState().resetPassword("adi@example.com", "123456", "secret-secret")],
    ["signing up", () => Promise.resolve(useAccountStore.getState().adopt(SIGNED_IN))]
  ])("after %s", async (_what, act) => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "library_resolve") return { action: "offer" };
      if (command === "sync_status") return EMPTY_SYNC_STATUS;
      return SIGNED_IN;
    });
    await act();
    await vi.waitFor(() => expect(useLibraryOwnerStore.getState().offerOpen).toBe(true));
  });

  it("but not when the sign-in did not take", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "account_login") throw "Wrong email or password.";
      return { action: "offer" };
    });
    await expect(useAccountStore.getState().signIn("adi@example.com", "nope")).rejects.toThrow("Wrong email");
    expect(invoke).not.toHaveBeenCalledWith("library_resolve");
  });
});
