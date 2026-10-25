import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const document = installMiniDom();

describe("Sync now, in a reader's menu", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let SyncPlaceRow: typeof import("./SyncPlaceRow").SyncPlaceRow;
  let useLibraryStore: typeof import("../store/libraryStore").useLibraryStore;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ SyncPlaceRow } = await import("./SyncPlaceRow"));
    ({ useLibraryStore } = await import("../store/libraryStore"));
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    for (const child of [...(document.body as unknown as MiniElement).childNodes]) {
      (document.body as unknown as MiniElement).removeChild(child);
    }
  });

  const mount = async () => {
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<SyncPlaceRow />));
    return container;
  };
  const find = (test: (element: MiniElement) => boolean) => (document.body as unknown as MiniElement).findAll(test)[0];
  const row = () => find((element) => element.tagName === "BUTTON");
  const answer = () => find((element) => element.getAttribute("role") === "status")?.textContent;

  it("is not offered where there is nowhere to sync to", async () => {
    useLibraryStore.setState({ sync: { ...EMPTY_SYNC_STATUS }, syncStatus: "idle" });
    await mount();
    expect(row()).toBeUndefined();
  });

  it("syncs as asked by hand, and says so when it is done", async () => {
    const syncNow = vi.fn(async () => {
      useLibraryStore.setState({ syncStatus: "success" });
      return {} as never;
    });
    useLibraryStore.setState({ sync: { ...EMPTY_SYNC_STATUS, accountBackup: true }, syncStatus: "idle", syncNow } as never);
    await mount();
    expect(row()?.textContent).toContain("Sync now");
    await React.act(async () => {
      row()!.dispatchEvent(makeEvent("click", row()!));
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(syncNow).toHaveBeenCalledWith({ manual: true });
    expect(answer()).toBe("Synced");
  });

  it("says Try again after a failed sync", async () => {
    useLibraryStore.setState({ sync: { ...EMPTY_SYNC_STATUS, accountBackup: true }, syncStatus: "error" });
    await mount();
    expect(answer()).toBe("Try again");
  });
});
