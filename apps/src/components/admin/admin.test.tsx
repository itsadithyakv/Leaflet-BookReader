import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { installMiniDom, type MiniElement } from "../../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
vi.mock("../../constants/features", async (original) => {
  const actual = await original<typeof import("../../constants/features")>();
  return { ...actual, FEATURES: { ...actual.FEATURES, accounts: true, community: true } };
});
vi.mock("../../hooks/useMediaQuery", async (original) => ({
  ...(await original<typeof import("../../hooks/useMediaQuery")>()),
  useSheetLayout: () => false,
  usePhoneMenus: () => false
}));

const document = installMiniDom();

const SERVER = "https://api.example.com";
const SIGNED_IN = {
  available: true,
  apiBase: SERVER,
  signedIn: true,
  account: { id: "a1", email: "owner@example.com", displayName: "Owner", avatar: null, emailConfirmed: true, createdAt: null },
  offline: false
};

describe("the profile menu's Admin", () => {
  let ProfileButton: typeof import("../ProfileButton").ProfileButton;
  let useAccountStore: typeof import("../../store/accountStore").useAccountStore;
  let useCommunityStore: typeof import("../community/communityStore").useCommunityStore;

  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root | null = null;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ ProfileButton } = await import("../ProfileButton"));
    ({ useAccountStore } = await import("../../store/accountStore"));
    ({ useCommunityStore } = await import("../community/communityStore"));
  }, 30_000);

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    root = null;
  });

  const nothing = () => undefined;
  // Mounted (not rendered to a string): the stores are read as they are now, not as they began.
  const menu = async () => {
    await React.act(async () => root?.unmount());
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root!.render(<ProfileButton
        open
        onToggle={nothing}
        onClose={nothing}
        mode="off"
        status="idle"
        sync={{ ...EMPTY_SYNC_STATUS, apiBase: SERVER }}
        error={null}
        onConnectDrive={nothing}
        onDisconnectDrive={nothing}
        onChooseFolder={nothing}
        onClearFolder={nothing}
        onSyncNow={nothing}
        onOpenSettings={nothing}
        onOpenProfile={nothing}
      />));
    const rows = container.findAll((element) => element.tagName === "BUTTON").map((button) => button.textContent);
    return rows;
  };
  const me = (isAdmin: boolean) => ({ handle: "itsadithyakv", visibility: "private", isAdmin }) as never;

  beforeEach(() => {
    invoke.mockReset();
    // Asked for by the menu as it opens: who is signed in, as set below.
    invoke.mockImplementation(async () => useAccountStore.getState().status);
  });

  it("is there for the admin, and opens the admin page", async () => {
    useAccountStore.setState({ status: SIGNED_IN as never, loaded: true });
    useCommunityStore.setState({ me: me(true) });
    expect(await menu()).toContain("Admin");
  });

  it("is not there for anyone else, signed in or not", async () => {
    useAccountStore.setState({ status: SIGNED_IN as never, loaded: true });
    useCommunityStore.setState({ me: me(false) });
    expect(await menu()).not.toContain("Admin");
    useCommunityStore.setState({ me: null });
    expect(await menu()).not.toContain("Admin");
    // The profile kept from before signing out says admin; signed out, it is not offered.
    useAccountStore.setState({ status: { ...SIGNED_IN, signedIn: false, account: null } as never, loaded: true });
    useCommunityStore.setState({ me: me(true) });
    expect(await menu()).not.toContain("Admin");
  });
});

describe("the admin page's overview", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let OverviewPanel: typeof import("./OverviewPanel").OverviewPanel;
  let backupLate: typeof import("./OverviewPanel").backupLate;
  let uptime: typeof import("./OverviewPanel").uptime;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ OverviewPanel, backupLate, uptime } = await import("./OverviewPanel"));
  }, 30_000);

  beforeEach(() => invoke.mockReset());
  afterEach(async () => {
    await React.act(async () => root?.unmount());
  });

  const mount = async () => {
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<OverviewPanel onOpen={() => undefined} />));
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    return container;
  };

  it("says in one line that the server is not updated yet, when it has no overview (a 404)", async () => {
    invoke.mockImplementation(async (command: string) => (command === "admin_overview" ? null : undefined));
    const shown = await mount();
    expect(shown.textContent).toBe("Server not updated yet");
    expect(shown.findAll((element) => element.getAttribute("role") === "alert")).toEqual([]);
  });

  const HOUR = 60 * 60 * 1000;
  const overview = (backup: { at: string } | null) => ({
    at: new Date().toISOString(),
    readers: { accounts: 120, newThisWeek: 4, activeToday: 30, active7: 70, active30: 100, versions: [{ name: "1.5.12", readers: 60 }], platforms: [{ name: "android", readers: 70 }] },
    queues: { openProblems: 2, openReports: 1, errorKinds7: 3, errorDays: [] },
    storage: { usedBytes: 100 * 1024 * 1024, dataBytes: 0, indexBytes: 0, onDiskBytes: 0, documents: 0, quotaBytes: 512 * 1024 * 1024 },
    collections: null,
    backup: backup && { ...backup, sizeMB: 3.2, parts: 1, collections: 30, documents: 900, where: "drive" },
    server: null
  });

  it("shows the readers, and the last backup as a warning when it is late or missing", async () => {
    invoke.mockImplementation(async (command: string) => (command === "admin_overview" ? overview(null) : undefined));
    let shown = await mount();
    expect(shown.textContent).toContain("Active today");
    expect(shown.textContent).toContain("Never");
    const warned = () => shown.findAll((element) => (element.getAttribute("class") ?? "").includes("is-warning")).map((tile) => tile.textContent);
    expect(warned().some((text) => text.startsWith("Last backup"))).toBe(true);
    await React.act(async () => root.unmount());

    invoke.mockImplementation(async (command: string) => (command === "admin_overview" ? overview({ at: new Date(Date.now() - 3 * HOUR).toISOString() }) : undefined));
    shown = await mount();
    expect(warned().some((text) => text.startsWith("Last backup"))).toBe(false);

    expect(backupLate(null)).toBe(true);
    expect(backupLate({ at: new Date(Date.now() - 37 * HOUR).toISOString() } as never)).toBe(true);
    expect(backupLate({ at: new Date(Date.now() - 20 * HOUR).toISOString() } as never)).toBe(false);
    expect(uptime(3 * 86_400 + 4 * 3600 + 60)).toBe("3 d 4 h");
    expect(uptime(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
  });
});
