import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../../../testing/miniDom";
import type { GameArt } from "../gameArt";
import type { BaseState, Now } from "../../../../pip/base/rules";

/** The Magpie Lands on screen: a stronghold's stars show under it, and a tap opens its card, whose Raid starts it. */

const document = installMiniDom();

const DAY = "2026-10-24";
/** No canvas in the mini DOM: the art is never asked for, and a stand-in does. */
const art = { sprite: () => null, pose: () => null, pip: () => ({ image: {}, w: 32, h: 32, box: [0, 0, 32, 32] }) } as unknown as GameArt;

describe("the Magpie Lands, on screen", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root | null = null;
  let LandsMap: typeof import("./LandsMap").LandsMap;
  let rules: typeof import("../../../../pip/base/rules");
  let chapters: typeof import("../../../../pip/base/chapters");

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ LandsMap } = await import("./LandsMap"));
    rules = await import("../../../../pip/base/rules");
    chapters = await import("../../../../pip/base/chapters");
  }, 30_000);

  afterEach(async () => {
    if (root) await React.act(async () => root!.unmount());
    root = null;
  });

  const body = () => document.body as unknown as MiniElement;
  const all = (test: (element: MiniElement) => boolean) => body().findAll(test);
  const classes = (element: MiniElement) => (element.getAttribute("class") ?? "").split(" ");
  const button = (label: string) => all((element) => element.tagName === "BUTTON" && (element.getAttribute("aria-label") === label || element.textContent.trim() === label))[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
  };

  const show = async (base: BaseState, onRaid = vi.fn()) => {
    const now: Now = { minutes: base.minutes, day: DAY, lit: false };
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () =>
      root!.render(
        <LandsMap
          base={base}
          now={now}
          art={art}
          rested={3}
          restIn={0}
          why={() => "Not now"}
          sent={null}
          onRaid={onRaid}
          onSend={() => undefined}
          onHut={() => undefined}
          onClose={() => undefined}
          heroes={{ here: () => false, asleep: () => false, onChoose: () => undefined }}
          friends={null}
        />
      )
    );
    return onRaid;
  };

  const camp = (camps: number, stars: number[]): BaseState => {
    const minutes = chapters.chapterStartsAt(5);
    const base = rules.settle(rules.newBase(0, DAY), { minutes, day: DAY, lit: false });
    return { ...base, camps, raidFrom: -1000, levels: { ...base.levels, hut: 2 }, strongholds: { stars, scouted: [] } };
  };

  it("shows each stronghold's best stars under it, and none for one taken before stars were kept", async () => {
    await show(camp(3, [3, 2, 0]));
    const first = button("Twig Gate, 3 of 3 stars");
    expect(first).toBeTruthy();
    expect(first!.findAll((element) => element.tagName === "I" && classes(element).includes("is-won"))).toHaveLength(3);
    const second = button("Mossy Hollow, 2 of 3 stars");
    expect(second!.findAll((element) => element.tagName === "I" && classes(element).includes("is-won"))).toHaveLength(2);
    // Taken before stars were kept: taken, and no stars under it.
    const keep = button("Twig Nest Keep, taken");
    expect(keep).toBeTruthy();
    expect(keep!.findAll((element) => element.tagName === "I")).toHaveLength(0);
    expect(button("Thorn Patch, the next stronghold")).toBeTruthy();
    // The one line along the top.
    expect(all((element) => classes(element).includes("pip-lands-progress"))[0].textContent).toBe("Stronghold 3 · 5★ of 9 · Next: Thorn Patch");
  });

  it("opens a stronghold's card on a tap: a taken one is replayed, the next one raided, through the one hand-off", async () => {
    const onRaid = await show(camp(3, [3, 2, 0]));
    await press(button("Mossy Hollow, 2 of 3 stars"));
    const card = () => all((element) => classes(element).includes("pip-lands-card"))[0];
    expect(card().textContent).toContain("Mossy Hollow");
    expect(card().textContent).toContain("Best");
    await press(button("Replay"));
    expect(onRaid).toHaveBeenLastCalledWith({ kind: "rematch", slot: 1 });

    await press(button("Thorn Patch, the next stronghold"));
    expect(card().textContent).toContain("Thorn Patch");
    await press(button("Raid"));
    expect(onRaid).toHaveBeenLastCalledWith({ kind: "camp", slot: 0 });

    await press(button("Close"));
    expect(card()).toBeUndefined();
  });

  it("keeps the strongholds under fog out of reach, and says when the fog lifts", async () => {
    await show(camp(3, [3, 2, 0]));
    expect(button("Crow's Ford")).toBeUndefined();
    expect(button("Tin Hill")).toBeTruthy();
    await press(button("Crow's Corner, under fog"));
    expect(all((element) => classes(element).includes("pip-lands-card"))[0].textContent).toContain("Under fog until chapter 7");
  });
});
