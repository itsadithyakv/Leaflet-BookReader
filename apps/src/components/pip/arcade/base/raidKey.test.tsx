import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { installMiniDom, makeEvent, type MiniElement } from "../../../../testing/miniDom";

/** The raid key, at the foot of the camp, opens the Magpie Lands (it opened the raid board until 2026-10-24). */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
// Pip herself is drawn on a canvas: a stand-in will do here.
vi.mock("../../../PipSprite", () => ({ PipSprite: () => null }));

const document = installMiniDom();
const DAY = new Date().toISOString().slice(0, 10);

describe("the raid key", () => {
  let React: typeof import("react");
  let root: import("react-dom/client").Root;

  beforeAll(async () => {
    React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const rules = await import("../../../../pip/base/rules");
    const base = rules.newBase(0, DAY);
    const camp = {
      ...base,
      camps: 2,
      raidFrom: -1000,
      levels: { ...base.levels, burrow: 2, hut: 1 },
      strongholds: { stars: [3, 1], scouted: [] },
      welcome: { ...base.welcome, given: true, basketOpened: true, tutorial: { ...base.welcome.tutorial, done: true } }
    };
    invoke.mockImplementation(async (command: string) => {
      if (command === "sync_status") return EMPTY_SYNC_STATUS;
      if (command === "pip_base_load") return JSON.stringify(rules.keptForm(camp));
      if (command === "list_books" || command === "finished_removed") return [];
      return null;
    });
    const { BaseScreen } = await import("./BaseScreen");
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<BaseScreen skin="sprout" outfit={[]} />));
    for (let round = 0; round < 10; round++) await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }, 60_000);

  afterAll(async () => {
    await React.act(async () => root.unmount());
  });

  const body = () => document.body as unknown as MiniElement;
  const byClass = (name: string) => body().findAll((element) => (element.getAttribute("class") ?? "").split(" ").includes(name))[0];

  it("opens the Magpie Lands, and shuts them again", async () => {
    expect(byClass("pip-lands")).toBeUndefined();
    const key = body().findAll((element) => element.tagName === "BUTTON" && element.getAttribute("title") === "Raid the magpies' strongholds")[0];
    expect(key, "the raid key").toBeTruthy();
    await React.act(async () => {
      key.dispatchEvent(makeEvent("click", key));
    });
    expect(byClass("pip-lands")).toBeTruthy();
    expect(byClass("pip-raid-board")).toBeUndefined();
    expect(byClass("pip-lands-progress").textContent).toContain("Stronghold 2");
    await React.act(async () => {
      key.dispatchEvent(makeEvent("click", key));
    });
    expect(byClass("pip-lands")).toBeUndefined();
  });

  it("opens them at the first tap: the finger's press before its click (which ends Pip's arrival and wakes the camera) takes nothing from it", async () => {
    // (2026-10-25: a production build at a phone's shape needed a second tap. It was the turn veil (platform/shape.ts)
    // over the app while it waited for the screen to turn sideways for Pip's tab, which an emulated phone never does;
    // a phone that turns takes the first tap. The camp itself never swallows it.)
    expect(byClass("pip-lands")).toBeUndefined();
    const key = body().findAll((element) => element.tagName === "BUTTON" && element.getAttribute("title") === "Raid the magpies' strongholds")[0];
    await React.act(async () => {
      for (const type of ["pointerdown", "touchstart", "pointerup", "touchend", "click"]) {
        const event = Object.assign(makeEvent(type, key), { pointerType: "touch", clientX: 40, clientY: 40, button: 0 });
        key.dispatchEvent(event);
      }
    });
    expect(byClass("pip-lands")).toBeTruthy();
  });
});
