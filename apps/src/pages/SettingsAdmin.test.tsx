import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
// A store with no server snapshot; not what is checked here.
vi.mock("../desktop-pip/DesktopPipSetting", () => ({ DesktopPipSetting: () => null }));

// react-dom looks for a document as it loads.
const document = installMiniDom();

const SERVER = "https://api.example.com";
const SIGNED_IN = {
  available: true,
  apiBase: SERVER,
  signedIn: true,
  account: null,
  offline: false
};

/**
 * The owner's tools are in Settings, under a tab of their own that only the
 * admin is shown, whatever their profile shares: the profile is asked for
 * here, not only on the Social page, and a private one still says `isAdmin`.
 */
describe("Settings, for the admin", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let SettingsPage: typeof import("./SettingsPage").SettingsPage;
  let stores: {
    account: typeof import("../store/accountStore").useAccountStore;
    library: typeof import("../store/libraryStore").useLibraryStore;
    community: typeof import("../components/community/communityStore").useCommunityStore;
  };

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ SettingsPage } = await import("./SettingsPage"));
    stores = {
      account: (await import("../store/accountStore")).useAccountStore,
      library: (await import("../store/libraryStore")).useLibraryStore,
      community: (await import("../components/community/communityStore")).useCommunityStore
    };
  }, 30_000);

  afterEach(async () => {
    await React.act(async () => root.unmount());
  });

  const settle = async () => {
    for (let round = 0; round < 8; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const page = () => document.body as unknown as MiniElement;
  const tab = (label: string) =>
    page().findAll(
      (element) => element.getAttribute("role") === "tab" && element.textContent === label
    )[0];

  const mount = async (isAdmin: boolean) => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, payload?: { route?: string }) => {
      if (command === "sync_status") return { ...EMPTY_SYNC_STATUS, apiBase: SERVER };
      if (command === "account_status") return SIGNED_IN;
      // A private profile: no handle, nothing shared, and still the admin's.
      if (command === "social_profile") return { handle: null, visibility: "private", isAdmin };
      const route = command === "discuss" ? payload?.route : null;
      if (route === "admin_problems") return { problems: [], more: false };
      if (route === "admin_reports") return { reports: [] };
      return null;
    });
    stores.account.setState({ status: SIGNED_IN, loaded: true });
    stores.library.setState({ sync: { ...EMPTY_SYNC_STATUS, apiBase: SERVER } });
    stores.community.setState({ me: null });
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<SettingsPage showToast={() => undefined} />));
    await settle();
  };

  it("asks for the profile, and shows a private admin the Admin tab", async () => {
    await mount(true);
    const commands = () => invoke.mock.calls.map(([command]) => command);
    expect(commands()).toContain("social_profile");
    const admin = tab("Admin");
    expect(admin, "an Admin tab").toBeTruthy();
    await React.act(async () => {
      admin.dispatchEvent(makeEvent("click", admin));
    });
    await settle();
    expect(page().textContent).toContain("Problems");
    expect(page().textContent).toContain("Reports");
    expect(page().textContent).toContain("Update notice");
    const routes = invoke.mock.calls
      .filter(([command]) => command === "discuss")
      .map(([, args]) => args.route);
    expect(routes).toContain("admin_problems");
    expect(routes).toContain("admin_reports");
  });

  it("shows anyone else no such tab", async () => {
    await mount(false);
    expect(tab("General")).toBeTruthy();
    expect(tab("Admin")).toBeUndefined();
  });
});
