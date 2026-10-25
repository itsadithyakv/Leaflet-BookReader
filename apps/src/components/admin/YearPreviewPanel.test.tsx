import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMiniDom, type MiniElement } from "../../testing/miniDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const document = installMiniDom();

describe("Admin's preview of the year in pages", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let panel: typeof import("./YearPreviewPanel");
  let useHabitStore: typeof import("../../store/habitStore").useHabitStore;
  let useShareStore: typeof import("../share/shareStore").useShareStore;
  let root: import("react-dom/client").Root | null = null;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    panel = await import("./YearPreviewPanel");
    ({ useHabitStore } = await import("../../store/habitStore"));
    ({ useShareStore } = await import("../share/shareStore"));
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    root = null;
    useShareStore.setState({ year: null });
  });

  const day = (dateKey: string, minutes: number) => ({ dateKey, minutes });

  it("offers this year so far and every year with reading, latest first", () => {
    expect(panel.previewYears([day("2024-03-01", 20), day("2025-03-01", 0), day("2026-01-02", 5)], new Date(2026, 9, 25))).toEqual([2026, 2024]);
    expect(panel.previewYears([], new Date(2026, 9, 25))).toEqual([2026]);
  });

  it("opens the story for the year chosen, whatever the date", async () => {
    useHabitStore.setState((state) => ({ snapshot: { ...state.snapshot, days: [{ dateKey: "2024-05-01", minutes: 30, goalMinutes: 20, freezeUsed: false, graceUsed: false }] } }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await React.act(async () => root!.render(React.createElement(panel.YearPreviewPanel)));
    const buttons = (container as unknown as MiniElement).findAll((element) => element.nodeName === "BUTTON");
    const thisYear = new Date().getFullYear();
    expect(buttons[0].textContent).toBe(`${thisYear} so far`);
    await React.act(async () => buttons.find((button) => button.textContent === "2024")!.click());
    expect(useShareStore.getState().year).toBe(2024);
    await React.act(async () => buttons[0].click());
    expect(useShareStore.getState().year).toBe(thisYear);
  });
});
