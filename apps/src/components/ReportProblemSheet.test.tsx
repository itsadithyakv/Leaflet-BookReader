import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_STATUS } from "@shared/sync/types";
import { installMiniDom, makeEvent, type MiniElement } from "../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

// react-dom looks for a document as it loads.
const document = installMiniDom();
// And for `oninput` on it, to hear typing by the input event rather than by
// keys and focus, which the stand-in DOM does not send.
(document as unknown as { oninput: null }).oninput = null;

const REPORT = "Leaflet 1.5.7\nRecent log:\n12:00 opened a book";
const SERVER = "https://api.example.com";
const SIGNED_IN = {
  available: true,
  apiBase: SERVER,
  signedIn: true,
  account: null,
  offline: false
};
const SIGNED_OUT = { ...SIGNED_IN, signedIn: false };

describe("Report a problem, the sheet", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let container: MiniElement;
  let Sheet: typeof import("./ReportProblemSheet").ReportProblemSheet;
  let stores: {
    account: typeof import("../store/accountStore").useAccountStore;
    library: typeof import("../store/libraryStore").useLibraryStore;
  };
  const showToast = vi.fn();
  const onClose = vi.fn();
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ ReportProblemSheet: Sheet } = await import("./ReportProblemSheet"));
    stores = {
      account: (await import("../store/accountStore")).useAccountStore,
      library: (await import("../store/libraryStore")).useLibraryStore
    };
  }, 30_000);

  const answers = (send: () => Promise<unknown>) =>
    invoke.mockImplementation(async (command: string) => {
      if (command === "problem_diagnostics") return REPORT;
      if (command === "diagnostics") return `${REPORT}\n(whole)`;
      if (command === "send_problem") return send();
      return null;
    });

  const mount = async ({ signedIn = true, server = true } = {}) => {
    stores.account.setState({ status: signedIn ? SIGNED_IN : SIGNED_OUT, loaded: true });
    stores.library.setState({ sync: { ...EMPTY_SYNC_STATUS, apiBase: server ? SERVER : null } });
    container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    const sheet = <Sheet open onClose={onClose} showToast={showToast} />;
    await React.act(async () => root.render(sheet));
    await settle();
  };

  beforeEach(() => {
    invoke.mockReset();
    answers(async () => null);
    showToast.mockReset();
    onClose.mockReset();
    writeText.mockClear();
    (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };
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
  const find = (test: (element: MiniElement) => boolean) => page().findAll(test)[0];
  const button = (label: string) =>
    find((element) => element.tagName === "BUTTON" && element.textContent === label);
  const field = (tag: "TEXTAREA" | "INPUT") => find((element) => element.tagName === tag);
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
    await settle();
  };
  const type = async (target: MiniElement | undefined, text: string) => {
    expect(target, "a field to type in").toBeTruthy();
    // React reads `type` to tell a text field (the stand-in DOM keeps it as an attribute only).
    if (target!.tagName === "INPUT") (target as unknown as { type: string }).type = "email";
    target!.value = text;
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("input", target!));
    });
  };
  const sent = () =>
    invoke.mock.calls.filter(([command]) => command === "send_problem").map(([, args]) => args);

  it("sends the words with the diagnostics it shows, and thanks the reader", async () => {
    await mount();
    expect(button("Send")!.hasAttribute("disabled"), "nothing to send yet").toBe(true);
    // The (i) shows the diagnostics exactly as they go.
    expect(page().textContent).not.toContain("12:00 opened a book");
    const info = (element: MiniElement) =>
      element.getAttribute("aria-label") === "What the diagnostics say";
    await press(find(info));
    expect(find((element) => element.tagName === "PRE")!.textContent).toBe(REPORT);

    await type(field("TEXTAREA"), "  The book would not open.  ");
    await press(button("Send"));
    const message = "The book would not open.";
    expect(sent()).toEqual([{ message, diagnostics: REPORT, contact: null }]);
    expect(showToast).toHaveBeenCalledWith("Sent. Thank you.");
    expect(onClose).toHaveBeenCalled();
  });

  it("sends no diagnostics when they are switched off", async () => {
    await mount();
    const toggle = find((element) => element.getAttribute("role") === "switch");
    expect(toggle!.getAttribute("aria-checked")).toBe("true");
    await press(toggle);
    expect(toggle!.getAttribute("aria-checked")).toBe("false");
    await type(field("TEXTAREA"), "It froze.");
    await press(button("Send"));
    expect(sent()).toEqual([{ message: "It froze.", diagnostics: null, contact: null }]);
  });

  it("asks a reader signed out for an address to reply to, and only them", async () => {
    await mount({ signedIn: false });
    const email = field("INPUT");
    expect(page().textContent).toContain("Email for a reply");
    await type(field("TEXTAREA"), "It froze.");
    await type(email, "not an address");
    await press(button("Send"));
    expect(sent()).toEqual([]);
    expect(page().textContent).toContain("That email address doesn't look right.");
    await type(email, " me@example.com ");
    await press(button("Send"));
    const contact = "me@example.com";
    expect(sent()).toEqual([{ message: "It froze.", diagnostics: REPORT, contact }]);

    // Signed in, there is no such field.
    await React.act(async () => root.unmount());
    await mount({ signedIn: true });
    expect(page().textContent).not.toContain("Email for a reply");
  });

  it("offers email when it could not be sent, the words and diagnostics copied", async () => {
    answers(async () => {
      throw "This Leaflet server can't take problem reports yet.";
    });
    await mount();
    await type(field("TEXTAREA"), "It froze.");
    await press(button("Send"));
    expect(page().textContent).toContain("This Leaflet server can't take problem reports yet.");
    expect(onClose).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();

    await press(button("Email it instead"));
    expect(writeText).toHaveBeenCalledWith(`What happened:\nIt froze.\n\n${REPORT}`);
    expect(invoke).toHaveBeenLastCalledWith("report_problem");
    expect(showToast).toHaveBeenCalledWith("Copied. Paste it into the email.");
    expect(onClose).toHaveBeenCalled();
  });

  it("goes by email at once in a build with no server", async () => {
    await mount({ server: false });
    expect(page().textContent).not.toContain("Email for a reply");
    await type(field("TEXTAREA"), "It froze.");
    await press(button("Email it"));
    expect(sent()).toEqual([]);
    expect(writeText).toHaveBeenCalledWith(`What happened:\nIt froze.\n\n${REPORT}`);
    expect(invoke).toHaveBeenLastCalledWith("report_problem");
  });
});
