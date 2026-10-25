import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../../testing/miniDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const document = installMiniDom();

describe("the story on screen", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let YearStory: typeof import("./YearStory").YearStory;
  let testing: typeof import("./testing");
  let root: import("react-dom/client").Root | null = null;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ YearStory } = await import("./YearStory"));
    testing = await import("./testing");
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    root = null;
  });

  const all = (test: (element: MiniElement) => boolean) => (document.body as unknown as MiniElement).findAll(test);
  const scene = () => {
    const found = all((element) => element.className.startsWith("ys-scene ys-"))[0];
    return found ? /ys-scene ys-([a-z]+)/.exec(found.className)?.[1] : null;
  };
  const key = async (name: string) => {
    await React.act(async () => {
      const event = Object.assign(makeEvent("keydown", document as never), { key: name });
      document.dispatchEvent(event);
    });
  };
  const mount = async (props: Partial<Parameters<typeof YearStory>[0]> = {}) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    const onClose = vi.fn();
    await React.act(async () => {
      root!.render(React.createElement(YearStory, { review: testing.fullYear(), covers: new Map(), onClose, still: true, ...props }));
    });
    return onClose;
  };

  it("has a bar for each of the year's scenes, and opens on the first", async () => {
    await mount();
    expect(all((element) => element.className.startsWith("ys-bar ")).length).toBe(12);
    expect(scene()).toBe("opening");
  });

  it("goes on and back with the arrow keys, and closes with Esc", async () => {
    const onClose = await mount();
    await key("ArrowRight");
    expect(scene()).toBe("time");
    await key("ArrowRight");
    expect(scene()).toBe("days");
    await key("ArrowLeft");
    expect(scene()).toBe("time");
    await key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("skips what a year has nothing for", async () => {
    await mount({ review: testing.lateYear() });
    const seen: string[] = [];
    for (let at = 0; at < 12; at++) {
      seen.push(scene() as string);
      await key("ArrowRight");
    }
    expect([...new Set(seen)]).toEqual(["opening", "time", "days", "books", "month", "summary"]);
  });

  it("is each scene's held end when still: its figures already counted", async () => {
    await mount({ startAt: 1 });
    const count = all((element) => element.className === "ys-count")[0];
    expect(count?.textContent).toBe(Math.round(testing.fullYear().minutes / 60).toLocaleString());
    // No bar is running: the story waits to be moved on.
    expect(all((element) => element.className.includes("is-now")).length).toBe(0);
  });

  it("says a year with nothing read kindly, in one card", async () => {
    await mount({ review: testing.emptyYear() });
    expect(scene()).toBe("empty");
    expect(all((element) => element.className.startsWith("ys-bar ")).length).toBe(1);
  });
});
