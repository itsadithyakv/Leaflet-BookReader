import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";

// react-dom looks for a document as it loads.
const document = installMiniDom();

describe("the phone's Focus key, mounted", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let Strip: typeof import("./PhoneLibrary").PhoneFocusStrip;
  let root: import("react-dom/client").Root;
  let container: MiniElement;
  const onStart = vi.fn();

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ PhoneFocusStrip: Strip } = await import("./PhoneLibrary"));
  });

  beforeEach(async () => {
    onStart.mockReset();
    container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () =>
      root.render(
        <Strip
          streakTitle="3 Day Streak!"
          session={null}
          reading={false}
          duration={25}
          setDuration={() => undefined}
          fullScreen={false}
          toggleFullScreen={() => undefined}
          onStart={onStart}
          onEnd={() => undefined}
        />
      )
    );
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  });

  const page = () => document.body as unknown as MiniElement;
  const key = () => page().findAll((element) => element.tagName === "BUTTON" && element.getAttribute("data-tour") === "session")[0];
  const fire = async (type: string) => {
    const target = key();
    expect(target, "the Focus key").toBeTruthy();
    await React.act(async () => {
      target.dispatchEvent(makeEvent(type, target));
    });
  };

  it("starts the session in one tap, with no sheet to choose from", async () => {
    await fire("click");
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(page().textContent).not.toContain("Start 25-minute session");
  });

  it("wears the 2× badge, and says the usual length in its tooltip", () => {
    expect(key().textContent).toContain("2×");
    expect(key().getAttribute("title")).toContain("25 min");
  });

  it("opens the length sheet on a right-click (a held finger does too), without starting", async () => {
    await fire("contextmenu");
    expect(onStart).not.toHaveBeenCalled();
    expect(page().textContent).toContain("Start 25-minute session");
  });
});
