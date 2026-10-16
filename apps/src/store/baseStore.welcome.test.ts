import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS, type SyncStatus } from "@shared/sync/types";
import { newBase, type BaseState } from "../pip/base/rules";

/**
 * The sync guard and the welcome, through the store, on two simulated
 * devices: each device keeps its camp with a stamp (as `pip_base_save`
 * does), and a sync takes whichever of the device's and the cloud's was
 * saved later (as `sync::merge::merge_camp` does).
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

type Kept = { state: string; savedAt: number } | null;
let cloud: Kept = null;
let device: Kept = null;
let clock = 1000;
let status: SyncStatus = EMPTY_SYNC_STATUS;
/** Every camp this device saved, as it saved it. */
let saves: BaseState[] = [];
/** What the next sync reports beyond the ordinary. */
let report: Record<string, unknown> = {};

const backend = () =>
  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "sync_status") return status;
    if (command === "pip_base_load") return device?.state ?? null;
    if (command === "pip_base_save") {
      device = { state: args!.base as string, savedAt: clock++ };
      saves.push(JSON.parse(device.state));
      return null;
    }
    if (command === "sync_now") {
      if (report.accountHolds === undefined) {
        const later = !device ? cloud : !cloud ? device : device.savedAt >= cloud.savedAt ? device : cloud;
        device = later;
        cloud = later;
      }
      return { entriesUpdated: 0, ...report };
    }
    if (command === "list_books" || command === "finished_removed") return [];
    return null;
  });

/** A camp of months on another device, from before 1.5.5 (no welcome in it): level 3. */
const oldCamp = () => {
  const camp: Partial<BaseState> = { ...newBase(0, "2026-06-01"), acorns: 240, levels: { burrow: 3, oak: 3, store: 2, fence: 1, tower: 1, hut: 1 }, quest: 9 };
  delete camp.welcome;
  return JSON.stringify(camp);
};

const load = async () => {
  vi.resetModules();
  const { useBaseStore } = await import("./baseStore");
  const { useLibraryStore } = await import("./libraryStore");
  const { useHabitStore } = await import("./habitStore");
  useLibraryStore.setState({ sync: status });
  /** Reading done since the camp was made: what the oak has dropped by. */
  const read = (minutes: number) => {
    const snapshot = useHabitStore.getState().snapshot;
    useHabitStore.setState({ snapshot: { ...snapshot, days: [{ ...(snapshot.days[0] ?? {}), dateKey: "2026-10-16", minutes, goalMinutes: 0 } as (typeof snapshot.days)[number]] } });
  };
  return { store: useBaseStore, library: useLibraryStore, read };
};

beforeEach(() => {
  cloud = null;
  device = null;
  clock = 1000;
  saves = [];
  report = {};
  status = EMPTY_SYNC_STATUS;
  invoke.mockReset();
  backend();
});

describe("the sync guard: a new device does not overwrite a camp it has not pulled yet", () => {
  it("a level-3 camp elsewhere and a new device: the device ends at level 3, with no second gift", async () => {
    cloud = { state: oldCamp(), savedAt: 10 };
    status = { ...EMPTY_SYNC_STATUS, driveConnected: true };
    const { store, library, read } = await load();

    await store.getState().open();
    read(60);
    expect(store.getState().welcomeReady).toBe(false);
    expect(store.getState().base?.levels.burrow).toBe(1);
    // Played with before the pull: nothing is saved, and the welcome does not begin.
    store.getState().giveWelcome();
    expect(store.getState().base?.welcome.given).toBe(false);
    store.getState().gather();
    store.getState().build("store");
    expect(store.getState().base?.jobs).toHaveLength(1);
    expect(saves).toHaveLength(0);

    // The launch's pull.
    await library.getState().syncNow();
    await vi.waitFor(() => expect(store.getState().welcomeReady).toBe(true));
    await vi.waitFor(() => expect(store.getState().base?.levels.burrow).toBe(3));
    const camp = store.getState().base!;
    expect(camp.welcome.given).toBe(true);
    expect(camp.welcome.paws).toBe(0);

    store.getState().giveWelcome();
    store.getState().openWelcomeBasket();
    expect(store.getState().usePaw("hut")).toBe(false);
    expect(store.getState().base!.acorns).toBe(camp.acorns);
    // No fresh camp was ever saved here, so none could have gone up over the old one.
    expect(saves.every((saved) => saved.levels.burrow === 3)).toBe(true);
    expect(JSON.parse(cloud!.state).levels.burrow).toBe(3);
  });

  it("with nowhere to sync to, the guard is down at once and the camp is kept when touched", async () => {
    const { store } = await load();
    await store.getState().open();
    await vi.waitFor(() => expect(store.getState().welcomeReady).toBe(true));
    store.getState().giveWelcome();
    expect(store.getState().base?.welcome.given).toBe(true);
    expect(saves[saves.length - 1]?.welcome.given).toBe(true);
  });

  it("with sync and no camp anywhere, what waited is kept after the pull", async () => {
    status = { ...EMPTY_SYNC_STATUS, accountBackup: true };
    const { store, library, read } = await load();
    await store.getState().open();
    read(60);
    store.getState().gather();
    store.getState().build("store");
    expect(saves).toHaveLength(0);
    await library.getState().syncNow();
    await vi.waitFor(() => expect(saves.length).toBeGreaterThan(0));
    expect(saves[saves.length - 1]?.jobs[0]?.site).toBe("store");
  });

  it("stays up while the account holds a library still to be brought in", async () => {
    cloud = { state: oldCamp(), savedAt: 10 };
    status = { ...EMPTY_SYNC_STATUS, accountBackup: true };
    report = { accountHolds: 3 };
    const { store, library } = await load();
    await store.getState().open();
    await library.getState().syncNow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getState().welcomeReady).toBe(false);
    store.getState().giveWelcome();
    expect(saves).toHaveLength(0);
  });
});

describe("the welcome through the store", () => {
  it("walks the session: the oak, the larder by a paw, the basket, the burrow by the other; then finishes", async () => {
    const { store } = await load();
    await store.getState().open();
    await vi.waitFor(() => expect(store.getState().welcomeReady).toBe(true));
    const s = store.getState;
    s().giveWelcome();
    s().setTutorialStep(2);
    s().gather();
    expect(s().base!.acorns).toBe(50);
    expect(s().usePaw("store")).toBe(true);
    expect(s().base!.levels.store).toBe(1);
    expect(s().base!.acorns).toBe(35);
    s().openWelcomeBasket();
    expect(s().base!.acorns).toBe(115);
    expect(s().usePaw("burrow")).toBe(true);
    expect(s().base!.levels.burrow).toBe(2);
    expect(s().usePaw("hut")).toBe(false);
    s().finishTutorial(false);
    expect(s().base!.welcome.tutorial).toMatchObject({ done: true, skipped: false });
    expect(saves[saves.length - 1]?.welcome.tutorial.done).toBe(true);
  });

  it("replays as a demonstration that gives and keeps nothing", async () => {
    const { store } = await load();
    await store.getState().open();
    await vi.waitFor(() => expect(store.getState().welcomeReady).toBe(true));
    const s = store.getState;
    s().finishTutorial(true);
    const before = s().base!;
    expect(before.welcome.paws).toBe(2);
    s().replayTutorial();
    s().setTutorialStep(4);
    expect(s().tutorialReplay).toEqual({ step: 4 });
    expect(s().usePaw("store")).toBe(false);
    s().finishTutorial(false);
    expect(s().tutorialReplay).toBeNull();
    expect(s().base).toBe(before);
  });

  it("skipped, the paws still finish the next two builds", async () => {
    const { store } = await load();
    await store.getState().open();
    await vi.waitFor(() => expect(store.getState().welcomeReady).toBe(true));
    const s = store.getState;
    s().finishTutorial(true);
    s().gather();
    s().build("store");
    expect(s().base!.levels.store).toBe(1);
    expect(s().base!.welcome.paws).toBe(1);
  });
});
