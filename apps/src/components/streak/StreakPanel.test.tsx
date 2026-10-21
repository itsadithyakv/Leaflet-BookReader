import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";
import type { PipOverview } from "../../services/pipService";

// react-dom looks for a document as it loads.
const document = installMiniDom();

describe("the streak's Buy a freeze, short of seeds", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Panel: typeof import("./StreakButton").StreakPanel;
  let seeds: typeof import("../../services/seedService").seedService;
  let root: import("react-dom/client").Root;
  let container: MiniElement;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ StreakPanel: Panel } = await import("./StreakButton"));
    ({ seedService: seeds } = await import("../../services/seedService"));
    const { usePipWardrobeStore } = await import("../../store/pipWardrobeStore");
    const shop = { price: 120, boughtThisMonth: 0, perMonth: 2, held: 0, cap: 2 };
    const overview = { wallet: { balance: 50 }, freezes: shop } as unknown as PipOverview;
    usePipWardrobeStore.setState({ overview });
  });

  beforeEach(async () => {
    container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    const nothing = () => undefined;
    await React.act(async () =>
      root.render(
        <Panel flame="out" onRead={nothing} readLabel="Read now" onOpenCalendar={nothing} />
      )
    );
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    container.parentNode?.removeChild(container);
    vi.restoreAllMocks();
  });

  const page = () => document.body as unknown as MiniElement;
  const isBuyKey = (element: MiniElement) =>
    element.tagName === "BUTTON" && element.textContent.includes("Buy a freeze");
  const buyKey = () => page().findAll(isBuyKey)[0];

  it("looks disabled, says nothing until tapped, and a tap says why without buying", async () => {
    const buy = vi.spyOn(seeds, "buyFreeze");
    const key = buyKey();
    expect(key.getAttribute("aria-disabled")).toBe("true");
    expect(key.getAttribute("disabled")).toBeNull();
    expect(page().textContent).not.toContain("70 more seeds needed");
    await React.act(async () => {
      key.dispatchEvent(makeEvent("click", key));
    });
    expect(page().textContent).toContain("70 more seeds needed");
    expect(buy).not.toHaveBeenCalled();
  });
});
