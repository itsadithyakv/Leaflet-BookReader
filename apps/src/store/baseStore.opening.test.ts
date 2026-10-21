import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { newBase } from "../pip/base/rules";

/**
 * The camp read while something is done with it. On a phone the read of the
 * kept camp (`pip_base_load`) is slower than the Hollow coming up, which gives
 * the welcome at once: the read used to answer with the camp as it was before
 * that, the welcome was gone again, and the guided session showed with a Next
 * (and a "tap anywhere") that did nothing (`setTutorialStep` keeps to a camp
 * that has been welcomed).
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** What the device keeps, and how long its reads and writes take. */
let device: string | null = null;
let saves = 0;

beforeEach(() => {
  device = null;
  saves = 0;
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "sync_status") return EMPTY_SYNC_STATUS;
    if (command === "pip_base_load") {
      const kept = device;
      await wait(30);
      return kept;
    }
    if (command === "pip_base_save") {
      await wait(30);
      device = args!.base as string;
      saves += 1;
      return null;
    }
    if (command === "list_books" || command === "finished_removed") return [];
    return null;
  });
});

const load = async () => {
  vi.resetModules();
  const { useBaseStore } = await import("./baseStore");
  const { welcome } = await import("../components/pip/onboarding/welcomeApi");
  await useBaseStore.getState().open();
  await vi.waitFor(() => expect(useBaseStore.getState().welcomeReady).toBe(true));
  // The read the guard asked for (`ready`) is over too.
  await wait(50);
  return { store: useBaseStore, welcome };
};

describe("a change made while the kept camp is read", () => {
  it("the Hollow comes up on a camp kept before its welcome: the welcome stays, and the tour's Next goes on", async () => {
    // Kept before the reader ever looked in (a book read sends its story there): not welcomed yet.
    device = JSON.stringify(newBase(0, "2026-10-18"));
    const { store, welcome } = await load();
    // BaseScreen mounting: the camp read again, and the welcome given at once, before the read is back.
    const reading = store.getState().open();
    store.getState().giveWelcome();
    expect(store.getState().base?.welcome.given).toBe(true);
    await reading;
    expect(store.getState().base?.welcome.given).toBe(true);
    // The tour's hello step: Next.
    welcome.setStep(1);
    expect(store.getState().base?.welcome.tutorial.step).toBe(1);
    await wait(80);
    expect(JSON.parse(device!).welcome.tutorial.step).toBe(1);
  });

  it("is done once, not twice, when there was no camp kept to read", async () => {
    const { store } = await load();
    const reading = store.getState().open();
    store.getState().giveWelcome();
    store.getState().gather();
    const acorns = store.getState().base!.acorns;
    await reading;
    expect(store.getState().base!.acorns).toBe(acorns);
    expect(store.getState().base!.welcome.given).toBe(true);
    await wait(80);
  });

  it("is done again on the camp read, once, when one was kept", async () => {
    device = JSON.stringify({ ...newBase(0, "2026-10-18"), acorns: 7 });
    const { store } = await load();
    const reading = store.getState().open();
    store.getState().giveWelcome();
    store.getState().gather();
    const acorns = store.getState().base!.acorns;
    await reading;
    expect(acorns).toBeGreaterThan(7);
    expect(store.getState().base!.acorns).toBe(acorns);
    await wait(80);
    expect(JSON.parse(device!).acorns).toBe(acorns);
    expect(saves).toBeGreaterThan(0);
  });
});
