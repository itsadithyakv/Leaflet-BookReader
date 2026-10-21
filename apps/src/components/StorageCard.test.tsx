import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";
import { formatBytes } from "../services/storageService";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const document = installMiniDom();

const MB = 1024 * 1024;

describe("sizes, as the card says them", () => {
  it("in whole megabytes, a tenth below one, gigabytes above a thousand", () => {
    expect(formatBytes(488 * MB)).toBe("488 MB");
    expect(formatBytes(0.4 * MB)).toBe("0.4 MB");
    expect(formatBytes(1000)).toBe("0.1 MB");
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(1331 * MB)).toBe("1.3 GB");
  });
});

describe("Settings → Library → Storage, mounted", () => {
  let React: typeof import("react");
  let root: import("react-dom/client").Root;
  let Card: typeof import("./StorageCard").StorageCard;
  const showToast = vi.fn();

  beforeAll(async () => {
    React = await import("react");
    ({ StorageCard: Card } = await import("./StorageCard"));
  }, 30_000);

  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const page = () => document.body as unknown as MiniElement;
  const button = () => page().findAll((element) => element.tagName === "BUTTON")[0];

  beforeEach(async () => {
    invoke.mockReset();
    showToast.mockReset();
    invoke.mockImplementation(async (command: string) => {
      if (command === "storage_usage") return { total: 488 * MB, books: 182 * MB, covers: 28 * MB, cache: 199 * MB };
      if (command === "storage_free_up") return { freed: 211 * MB, usage: { total: 277 * MB, books: 182 * MB, covers: 10 * MB, cache: 0 } };
      return null;
    });
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<Card showToast={showToast} />));
    await settle();
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
  });

  it("says how much Leaflet takes, with the parts behind the (i)", () => {
    expect(page().textContent).toContain("Leaflet uses 488 MB on this device");
    const tip = page().findAll((element) => element.getAttribute("role") === "img")[0];
    expect(tip?.getAttribute("aria-label")).toContain("Books 182 MB · Covers 28 MB · Cache 199 MB");
  });

  it("frees up space on a press, and says how much", async () => {
    await React.act(async () => {
      button().dispatchEvent(makeEvent("click", button()));
    });
    await settle();
    expect(invoke).toHaveBeenCalledWith("storage_free_up");
    expect(showToast).toHaveBeenCalledWith("Freed 211 MB.");
    expect(page().textContent).toContain("Leaflet uses 277 MB on this device");
  });

  it("says so when there was nothing to give back", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "storage_free_up" ? { freed: 0, usage: { total: 488 * MB, books: 182 * MB, covers: 28 * MB, cache: 199 * MB } } : null
    );
    await React.act(async () => {
      button().dispatchEvent(makeEvent("click", button()));
    });
    await settle();
    expect(showToast).toHaveBeenCalledWith("Nothing more to free up.");
  });
});
