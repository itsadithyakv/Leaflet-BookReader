import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../platform/android", () => ({ onAndroid: () => false, android: { readAloud: vi.fn(async () => null) } }));

const document = installMiniDom();

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key)
});

const { studioStatus } = await import("../readers/readAloud/studioVoice.fixture");
type Status = import("../readers/readAloud/studioVoice").StudioVoiceStatus;

describe("Settings → Reading → Studio voice", () => {
  let React: typeof import("react");
  let root: import("react-dom/client").Root;
  let Card: typeof import("./StudioVoiceCard").StudioVoiceCard;
  let modeNote: typeof import("./StudioVoiceCard").modeNote;
  const showToast = vi.fn();
  let current: Status;
  let progress: ((payload: unknown) => void) | null;
  let finishDownload: ((status: Status) => void) | null;
  const calls: { command: string; args?: Record<string, unknown> }[] = [];

  const bridge = {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      switch (command) {
        case "studio_voice_status":
          return current;
        case "studio_voice_download":
          return new Promise<Status>((resolve) => {
            finishDownload = resolve;
          });
        case "studio_voice_remove":
          current = studioStatus({ installed: false, installedBytes: 0 });
          return 367_000_000;
        default:
          return undefined;
      }
    }),
    listen: vi.fn(async (event: string, handler: (payload: never) => void) => {
      if (event === "studio-voice:progress") progress = handler as (payload: unknown) => void;
      return () => {
        if (event === "studio-voice:progress") progress = null;
      };
    })
  };

  beforeAll(async () => {
    React = await import("react");
    ({ StudioVoiceCard: Card, modeNote } = await import("./StudioVoiceCard"));
  }, 30_000);

  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const page = () => document.body as unknown as MiniElement;
  const buttons = () => page().findAll((element) => element.tagName === "BUTTON");
  const buttonNamed = (name: string) => buttons().find((element) => element.textContent.trim() === name || element.getAttribute("aria-label") === name);
  const click = async (element: MiniElement | undefined) => {
    expect(element).toBeTruthy();
    await React.act(async () => {
      element!.dispatchEvent(makeEvent("click", element!));
    });
    await settle();
  };

  const mount = async (props: { onPhone?: boolean } = {}) => {
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<Card showToast={showToast} bridge={bridge as never} onPhone={props.onPhone ?? false} />));
    await settle();
  };

  beforeEach(() => {
    store.clear();
    calls.length = 0;
    showToast.mockReset();
    progress = null;
    finishDownload = null;
    current = studioStatus({ installed: false, installedBytes: 0, selfTest: null });
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    document.body.childNodes.length = 0;
  });

  it("offers the download up front on a computer: one line, the size, and the button", async () => {
    await mount();
    expect(page().textContent).toContain("Very natural reading voices");
    expect(page().textContent).toContain("350 MB");
    const download = buttonNamed("Download");
    expect(download?.className).toContain("tactile-button-primary");
  });

  it("is lower-key on a phone", async () => {
    await mount({ onPhone: true });
    expect(page().textContent).toContain("Natural voices, on this phone");
    expect(buttonNamed("Download")?.className).not.toContain("tactile-button-primary");
  });

  it("offers to resume a download that stopped part way", async () => {
    current = studioStatus({ installed: false, partialBytes: 120_000_000 });
    await mount();
    expect(buttonNamed("Resume")).toBeTruthy();
  });

  it("shows nothing on a computer whose copy of Leaflet cannot make the voice", async () => {
    current = studioStatus({ installed: false, canSpeak: false });
    await mount();
    expect(page().textContent).toBe("");
  });

  it("downloads with a progress bar and a cancel, then shows the voices", async () => {
    await mount();
    await click(buttonNamed("Download"));
    expect(calls.some((call) => call.command === "studio_voice_download")).toBe(true);
    await React.act(async () => progress?.({ phase: "download", done: 175_000_000, total: 350_000_000 }));
    await settle();
    const bar = page().findAll((element) => element.getAttribute("role") === "progressbar")[0];
    expect(bar?.getAttribute("aria-valuenow")).toBe("50");
    expect(page().textContent).toContain("Downloading · 175 MB of 350 MB");
    await click(buttonNamed("Cancel"));
    expect(calls.some((call) => call.command === "studio_voice_cancel")).toBe(true);
    current = studioStatus();
    await React.act(async () => finishDownload?.(current));
    await settle();
    expect(showToast).toHaveBeenCalledWith("Studio voice ready");
    expect(page().textContent).toContain("Heart");
    expect(page().textContent).toContain("Emma");
    expect(page().textContent).toContain("Michael");
  });

  it("when installed: picks a voice for reading (the reader's own setting), and plays a preview at the speed", async () => {
    current = studioStatus();
    store.set("leaflet.readAloud", JSON.stringify({ rate: 1.3, voices: {} }));
    await mount();
    const radios = page().findAll((element) => element.getAttribute("role") === "radio");
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    await click(radios[1]);
    expect(JSON.parse(store.get("leaflet.readAloud")!)).toEqual({ rate: 1.3, voices: { en: "neural:bf_emma" } });
    await click(buttonNamed("Hear Michael"));
    expect(calls).toContainEqual({ command: "studio_preview", args: { voice: "neural:am_michael", rate: 1.3 } });
    expect(buttonNamed("Stop Michael")).toBeTruthy();
    await click(buttonNamed("Stop Michael"));
    expect(calls).toContainEqual({ command: "studio_stop", args: undefined });
  });

  it("says behind an (i) how it reads on this device", async () => {
    current = studioStatus({ mode: "prepare", slow: true, selfTest: { rtf: 1.4, threads: 2, platform: "windows", at: "" } });
    await mount();
    const tips = page().findAll((element) => element.getAttribute("role") === "img").map((tip) => tip.getAttribute("aria-label") ?? "");
    expect(tips.some((tip) => tip.includes("each chapter is prepared") && tip.includes("1.40×"))).toBe(true);
    expect(modeNote(studioStatus(), false)).toContain("Reads as it goes on this computer");
    expect(modeNote(studioStatus({ mode: "tooSlow" }), true)).toContain("Too slow on this phone");
    expect(modeNote(studioStatus({ selfTest: null }), false)).toBe("Not yet tried on this computer.");
  });

  it("removes it, and says what that freed", async () => {
    current = studioStatus();
    await mount();
    await click(buttonNamed("Remove"));
    expect(showToast).toHaveBeenCalledWith("Studio voice removed · 367 MB freed");
    expect(buttonNamed("Download")).toBeTruthy();
  });
});
