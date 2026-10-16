import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

// react-dom looks for a document as it loads.
const document = installMiniDom();

describe("the library-owner sheets, mounted", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let container: MiniElement;
  let stores: {
    owner: typeof import("../../store/libraryOwnerStore").useLibraryOwnerStore;
    library: typeof import("../../store/libraryStore").useLibraryStore;
    habit: typeof import("../../store/habitStore").useHabitStore;
  };
  let Sheets: () => import("react").ReactElement;
  const reload = vi.fn();

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    const { LibraryOwnerSheet } = await import("./LibraryOwnerSheet");
    const { AccountHoldsSheet } = await import("./AccountHoldsSheet");
    const { ConfirmDialog } = await import("../ConfirmDialog");
    stores = {
      owner: (await import("../../store/libraryOwnerStore")).useLibraryOwnerStore,
      library: (await import("../../store/libraryStore")).useLibraryStore,
      habit: (await import("../../store/habitStore")).useHabitStore
    };
    Sheets = () => (
      <>
        <LibraryOwnerSheet />
        <AccountHoldsSheet />
        <ConfirmDialog />
      </>
    );
    Object.defineProperty(globalThis, "location", { value: { reload }, configurable: true, writable: true });
  }, 30_000);

  beforeEach(async () => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => (command === "sync_status" ? EMPTY_SYNC_STATUS : command === "list_books" ? [] : null));
    reload.mockReset();
    stores.owner.setState({ offerOpen: false, busy: false });
    stores.library.setState({ accountHolds: null, importing: false, metadataRefreshing: false, sync: EMPTY_SYNC_STATUS });
    stores.habit.setState({ activeSession: null, flushReading: async () => null });
    container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<Sheets />));
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
  });

  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const page = () => document.body as unknown as MiniElement;
  const shown = () => page().textContent;
  const button = (label: string, within?: (element: MiniElement) => boolean) =>
    page().findAll((element) => element.tagName === "BUTTON" && element.textContent === label && (!within || within(element)))[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "a button to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
    await settle();
  };
  const tips = () => page().findAll((element) => element.getAttribute("role") === "img").map((element) => element.getAttribute("title"));

  it("shows nothing until a question is put", () => {
    expect(shown()).not.toContain("Another account's library");
    expect(shown()).not.toContain("Your account already has a library");
  });

  it("asks about another account's library, with short labels and each meaning behind an (i)", async () => {
    await React.act(async () => stores.owner.setState({ offerOpen: true }));
    expect(shown()).toContain("Another account's library");
    expect(shown()).toContain("Start a fresh library for this account");
    expect(shown()).toContain("Stay out of reading sync");
    expect(tips()).toEqual([
      "This device's library belongs to another Leaflet account. Leaflet never mixes two accounts' reading.",
      "A new, empty library for you. The other one stays on this device.",
      "Keep using Social. Reading sync and the board stay off for this library."
    ]);
  });

  it("starts a fresh library and reloads on it", async () => {
    await React.act(async () => stores.owner.setState({ offerOpen: true }));
    await press(button("Start a fresh library for this account"));
    expect(invoke).toHaveBeenCalledWith("library_start_fresh");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("offers the account's own library instead, when it has one here", async () => {
    await React.act(async () =>
      stores.library.setState({ sync: { ...stores.library.getState().sync, library: { standing: "other", stayOut: false, elsewhere: true, refused: null } } })
    );
    await React.act(async () => stores.owner.setState({ offerOpen: true }));
    await press(button("Open my library"));
    expect(invoke).toHaveBeenCalledWith("library_open_mine");
  });

  it("stays out of reading sync, and closes", async () => {
    await React.act(async () => stores.owner.setState({ offerOpen: true }));
    await press(button("Stay out of reading sync"));
    expect(invoke).toHaveBeenCalledWith("library_stay_out", { on: true });
    expect(shown()).not.toContain("Another account's library");
  });

  it("asks what to do with the account's earlier library, and uses it", async () => {
    await React.act(async () => stores.library.setState({ accountHolds: 12 }));
    expect(shown()).toContain("Your account already has a library · 12 books");
    expect(tips()).toEqual([
      "From before this device had a library of its own.",
      "Bring it into this library.",
      "Replaces what your account holds. Can't be undone."
    ]);
    await press(button("Use it"));
    expect(invoke).toHaveBeenCalledWith("library_fresh_answer", { useIt: true });
    expect(shown()).not.toContain("Your account already has a library");
  });

  it("starts empty only once that is confirmed", async () => {
    await React.act(async () => stores.library.setState({ accountHolds: 1 }));
    expect(shown()).toContain("Your account already has a library · 1 book");
    await press(button("Start empty"));
    expect(invoke).not.toHaveBeenCalledWith("library_fresh_answer", expect.anything());
    expect(shown()).toContain("Start empty?");
    // The confirm's own "Start empty", in the alert dialog.
    const inAlert = (element: MiniElement) => {
      for (let node: MiniElement | null = element; node; node = node.parentNode as MiniElement | null) {
        if (node.getAttribute?.("role") === "alertdialog") return true;
      }
      return false;
    };
    // On the page itself, beside the sheet (a portal on the body too), not in
    // the app's own layer: there it stood behind the sheet, out of reach.
    let top = button("Start empty", inAlert);
    while (top.parentNode && top.parentNode !== (document.body as unknown)) top = top.parentNode as MiniElement;
    expect(top.parentNode).toBe(document.body);
    expect(top).not.toBe(container);
    await press(button("Start empty", inAlert));
    expect(invoke).toHaveBeenCalledWith("library_fresh_answer", { useIt: false });
  });

  it("keeps what the account holds when the confirm is turned down", async () => {
    await React.act(async () => stores.library.setState({ accountHolds: 4 }));
    await press(button("Start empty"));
    await press(button("Keep it"));
    expect(invoke).not.toHaveBeenCalledWith("library_fresh_answer", expect.anything());
    expect(shown()).toContain("Your account already has a library · 4 books");
  });
});
