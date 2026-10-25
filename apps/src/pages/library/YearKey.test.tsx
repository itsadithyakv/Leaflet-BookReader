import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, type MiniElement } from "../../testing/miniDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const document = installMiniDom();

describe("the Library's key to the year in pages", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let YearKey: typeof import("./YearKey").YearKey;
  let useHabitStore: typeof import("../../store/habitStore").useHabitStore;
  let usePipStore: typeof import("../../store/pipStore").usePipStore;
  let useShareStore: typeof import("../../components/share/shareStore").useShareStore;
  let root: import("react-dom/client").Root | null = null;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ YearKey } = await import("./YearKey"));
    ({ useHabitStore } = await import("../../store/habitStore"));
    ({ usePipStore } = await import("../../store/pipStore"));
    ({ useShareStore } = await import("../../components/share/shareStore"));
    (await import("../../platform/afterStartup")).resetStartupForTests(true);
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    localStorage.clear();
    usePipStore.setState({ mode: "chatty", peek: null });
    useShareStore.setState({ year: null });
    useHabitStore.setState((state) => ({ snapshot: { ...state.snapshot, days: [{ dateKey: "2026-06-01", minutes: 30, goalMinutes: 20, freezeUsed: false, graceUsed: false }] } }));
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    root = null;
    vi.useRealTimers();
  });

  const mount = async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await React.act(async () => root!.render(React.createElement(YearKey)));
    return container as unknown as MiniElement;
  };
  const button = (container: MiniElement) => container.findAll((element) => element.nodeName === "BUTTON")[0] ?? null;

  it("is not there outside the season", async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 12));
    expect(button(await mount())).toBeNull();
  });

  it("is there from 24 December, opens the year, and Pip says so once a year", async () => {
    vi.setSystemTime(new Date(2026, 11, 24, 9));
    const key = button(await mount());
    expect(key?.textContent).toBe("Your 2026 in pages");
    await React.act(async () => vi.advanceTimersByTime(2000));
    expect(usePipStore.getState().peek?.line).toBe("your 2026 in pages is ready. it's up top.");
    expect(localStorage.getItem("leaflet.year.told")).toBe("2026");

    await React.act(async () => key!.click());
    expect(useShareStore.getState().year).toBe(2026);

    // Seen again: no second word from her this year.
    await React.act(async () => root?.unmount());
    usePipStore.setState({ peek: null });
    await mount();
    await React.act(async () => vi.advanceTimersByTime(2000));
    expect(usePipStore.getState().peek).toBeNull();
  });

  it("still opens last year in the first week of January", async () => {
    vi.setSystemTime(new Date(2027, 0, 7, 20));
    expect(button(await mount())?.textContent).toBe("Your 2026 in pages");
  });

  it("is not there for a year with no reading in it", async () => {
    vi.setSystemTime(new Date(2026, 11, 28, 12));
    useHabitStore.setState((state) => ({ snapshot: { ...state.snapshot, days: [{ dateKey: "2025-06-01", minutes: 30, goalMinutes: 20, freezeUsed: false, graceUsed: false }] } }));
    expect(button(await mount())).toBeNull();
  });
});
