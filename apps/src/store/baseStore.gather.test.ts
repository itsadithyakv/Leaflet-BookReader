import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { newBase, oakReady, oakStatus } from "../pip/base/rules";

/**
 * Gathering through the store says what it brought in (BaseScreen shows that
 * figure, and nothing it works out on its own copy of the camp), and with no
 * room in the larder it brings nothing and leaves the camp as it was.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "sync_status") return EMPTY_SYNC_STATUS;
    if (command === "pip_base_load") return JSON.stringify(newBase(0, "2026-10-18"));
    if (command === "list_books" || command === "finished_removed") return [];
    return null;
  });
});

const load = async () => {
  vi.resetModules();
  const { useBaseStore } = await import("./baseStore");
  const { useHabitStore } = await import("./habitStore");
  await useBaseStore.getState().open();
  await vi.waitFor(() => expect(useBaseStore.getState().welcomeReady).toBe(true));
  const read = (minutes: number) => {
    const snapshot = useHabitStore.getState().snapshot;
    useHabitStore.setState({ snapshot: { ...snapshot, days: [{ ...(snapshot.days[0] ?? {}), dateKey: "2026-10-16", minutes, goalMinutes: 0 } as (typeof snapshot.days)[number]] } });
  };
  return { store: useBaseStore, read };
};

describe("gathering the oak through the store", () => {
  it("says how many acorns came in, the oak's own (not what the list paid for it)", async () => {
    const { store, read } = await load();
    read(40);
    const before = store.getState().base!;
    expect(oakReady(before, 40)).toBeGreaterThan(0);
    const got = store.getState().gather();
    const after = store.getState().base!;
    expect(got).toBeGreaterThan(0);
    expect(after.acorns - before.acorns).toBeGreaterThanOrEqual(got);
    expect(after.stats.gathered - before.stats.gathered).toBeLessThanOrEqual(got);
  });

  it("brings everything in, however many acorns the camp has (1.5.10: no brim): ready, then bare", async () => {
    const { store, read } = await load();
    read(400);
    const base = store.getState().base!;
    store.setState({ base: { ...base, acorns: 1412 } });
    const over = store.getState().base!;
    expect(oakStatus(over, 400)).toBe("ready");
    const got = store.getState().gather();
    expect(got).toBeGreaterThan(0);
    expect(store.getState().base!.acorns).toBeGreaterThanOrEqual(over.acorns + got);
    expect(oakStatus(store.getState().base!, 400)).toBe("bare");
  });
});
