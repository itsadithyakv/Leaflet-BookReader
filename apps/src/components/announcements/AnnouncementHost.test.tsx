import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.5.11" }));

const document = installMiniDom();

const announcement = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  body: "Google changed how Leaflet signs in.",
  link: { label: "Reconnect", action: "reconnect_drive" },
  audience: { kind: "everyone" },
  at: "2026-10-23T10:00:00.000Z",
  expiresAt: null,
  ...extra
});

describe("announcements, as a reader sees them", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let Host: typeof import("./AnnouncementHost").AnnouncementHost;
  let updateService: typeof import("../../services/updateService").updateService;
  const onAction = vi.fn();

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ AnnouncementHost: Host } = await import("./AnnouncementHost"));
    ({ updateService } = await import("../../services/updateService"));
    // This app's version, at once (it is read through a dynamic import in the app).
    vi.spyOn(updateService, "mine").mockResolvedValue("1.5.11");
  }, 30_000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    localStorage.clear?.();
    for (const key of ["leaflet.announcements.seen", "leaflet.driveUsed"]) localStorage.removeItem(key);
    updateService.forgetNotice();
    invoke.mockReset();
    onAction.mockReset();
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    vi.useRealTimers();
  });

  const serve = (announcements: unknown[] | undefined, fail = false) =>
    invoke.mockImplementation(async (command: string) => {
      if (command !== "update_notice") return undefined;
      if (fail) throw "Not found.";
      return { version: null, note: null, at: null, ...(announcements ? { announcements } : {}) };
    });

  let ready = true;
  let driveConnected = false;
  const render = async () =>
    React.act(async () => root.render(<Host ready={ready} driveConnected={driveConnected} onAction={onAction} showToast={() => undefined} />));
  const mount = async () => {
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await render();
    await React.act(async () => {
      await vi.advanceTimersByTimeAsync(26_000);
    });
    // The notice and the version are asked for after that: let them come back.
    for (let round = 0; round < 10; round += 1) {
      await React.act(async () => {
        await Promise.resolve();
      });
    }
    return container;
  };
  const card = () => (document.body as unknown as MiniElement).findAll((element) => (element.getAttribute("class") ?? "").includes("announcement-card"))[0];
  const button = (label: string) => (document.body as unknown as MiniElement).findAll((element) => element.tagName === "BUTTON" && element.textContent === label)[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
  };

  it("shows each once, oldest first, and never again once put away", async () => {
    ready = true;
    serve([announcement("aaaaaaaaaaaa"), announcement("bbbbbbbbbbbb")]);
    await mount();
    expect(card()?.textContent).toContain("Title aaaaaaaaaaaa");
    await press(button("OK"));
    expect(card()?.textContent).toContain("Title bbbbbbbbbbbb");
    await React.act(async () => root.unmount());

    // The next start: the first is put away for good on this device.
    updateService.forgetNotice();
    await mount();
    expect(card()?.textContent).toContain("Title bbbbbbbbbbbb");
  });

  it("waits while a book is open (or the Library is not showing), and shows when the reader is back", async () => {
    ready = false;
    serve([announcement("cccccccccccc")]);
    await mount();
    expect(card()).toBeUndefined();
    ready = true;
    await render();
    expect(card()?.textContent).toContain("Title cccccccccccc");
  });

  it("carries out a known action with its button, and shows one from a newer server without the button", async () => {
    ready = true;
    serve([announcement("dddddddddddd"), announcement("eeeeeeeeeeee", { link: { label: "Open the Hollow", action: "open_hollow" } })]);
    await mount();
    await press(button("Reconnect"));
    expect(onAction).toHaveBeenCalledWith("reconnect_drive");
    expect(card()?.textContent).toContain("Title eeeeeeeeeeee");
    expect(button("Open the Hollow")).toBeUndefined();
    expect(button("OK")).toBeTruthy();
  });

  it("is for Drive's readers only where Drive was used, and shows nothing when the server has none (or says not found)", async () => {
    ready = true;
    serve([announcement("ffffffffffff", { audience: { kind: "drive" } })]);
    await mount();
    expect(card()).toBeUndefined();
    await React.act(async () => root.unmount());

    driveConnected = true;
    updateService.forgetNotice();
    await mount();
    expect(card()?.textContent).toContain("Title ffffffffffff");
    await React.act(async () => root.unmount());
    driveConnected = false;

    serve(undefined);
    updateService.forgetNotice();
    await mount();
    expect(card()).toBeUndefined();
    await React.act(async () => root.unmount());

    serve(undefined, true);
    updateService.forgetNotice();
    await mount();
    expect(card()).toBeUndefined();
  });
});
