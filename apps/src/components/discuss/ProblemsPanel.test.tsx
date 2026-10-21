import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";
import type { Problem, ProblemRow } from "../../services/discussService";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

// react-dom looks for a document as it loads, and for `oninput` to hear typing by.
const document = installMiniDom();
(document as unknown as { oninput: null }).oninput = null;

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const row = (id: string, extra: Partial<ProblemRow> = {}): ProblemRow => ({
  id,
  at: ago(5),
  preview: `Problem ${id}`,
  cut: false,
  hasDiagnostics: true,
  version: "1.5.7",
  platform: "windows",
  signedIn: false,
  handle: null,
  contact: null,
  status: "open",
  note: null,
  ...extra
});

const ROWS = [
  row("a".repeat(24), {
    handle: "maya",
    signedIn: true,
    preview: "The book would not open",
    cut: true
  }),
  row("b".repeat(24), { contact: "tester@example.com", platform: "android", at: ago(180) }),
  row("c".repeat(24))
];

const WHOLE: Problem = {
  id: "a".repeat(24),
  at: ago(5),
  message: "The book would not open. It said the file was missing.",
  diagnostics: "Leaflet 1.5.7\nRecent log:\n12:00 opened a book",
  version: "1.5.7",
  platform: "windows",
  signedIn: true,
  handle: "maya",
  contact: null,
  status: "open",
  note: null,
  closedAt: null
};

describe("the admin's problems, mounted", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let container: MiniElement;
  let Panel: () => import("react").ReactElement;
  const showToast = vi.fn();
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    const { ProblemsPanel } = await import("./ProblemsPanel");
    const { ConfirmDialog } = await import("../ConfirmDialog");
    Panel = () => (
      <>
        <ProblemsPanel showToast={showToast} />
        <ConfirmDialog />
      </>
    );
  }, 30_000);

  const asked = () =>
    invoke.mock.calls
      .filter(([command]) => command === "discuss")
      .map(([, { route, args }]) => ({ route, args }));

  const lastAsked = () => {
    const all = asked();
    return all[all.length - 1];
  };

  beforeEach(async () => {
    invoke.mockReset();
    type Asked = { route: string; args: { id: string; status: string; note: string } };
    invoke.mockImplementation(async (command: string, { route, args }: Asked) => {
      if (command !== "discuss") return null;
      if (route === "admin_problems") {
        return args.status === "closed"
          ? { problems: [row("d".repeat(24), { status: "closed", note: "Fixed" })], more: false }
          : { problems: ROWS, more: true };
      }
      if (route === "admin_problem") return WHOLE;
      if (route === "admin_problem_update") {
        return { ...WHOLE, status: args.status, note: args.note || null };
      }
      if (route === "admin_problem_delete") return { deleted: true };
      return null;
    });
    showToast.mockReset();
    writeText.mockClear();
    (navigator as unknown as { clipboard: unknown }).clipboard = { writeText };
    container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<Panel />));
    await settle();
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
  const find = (test: (element: MiniElement) => boolean) => page().findAll(test)[0];
  const button = (label: string) =>
    find((element) => element.tagName === "BUTTON" && element.textContent === label);
  const rowButton = (text: string) =>
    find((element) => element.tagName === "BUTTON" && element.textContent.includes(text));
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
    await settle();
  };
  const type = async (target: MiniElement | undefined, text: string) => {
    expect(target, "a field to type in").toBeTruthy();
    target!.value = text;
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("input", target!));
    });
  };

  it("lists the open ones: the start of each, version and platform, who and when", async () => {
    expect(asked()[0]).toEqual({ route: "admin_problems", args: { status: "open" } });
    expect(shown()).toContain("Problems 3+");
    expect(shown()).toContain("The book would not open…");
    expect(shown()).toContain("1.5.7 · Windows");
    expect(shown()).toContain("· @maya");
    expect(shown()).toContain("1.5.7 · Android· tester@example.com· 3h ago");
    expect(shown()).toContain("· signed out");
    // No diagnostics in the list.
    expect(shown()).not.toContain("Recent log");
  });

  it("asks for the closed ones, and for the next fifty", async () => {
    await press(button("More"));
    expect(lastAsked()).toEqual({
      route: "admin_problems",
      args: { status: "open", before: "c".repeat(24) }
    });
    await press(button("Closed"));
    expect(lastAsked()).toEqual({ route: "admin_problems", args: { status: "closed" } });
    expect(shown()).toContain("Problems 1");
    expect(shown()).not.toContain("The book would not open");
  });

  it("opens one whole, copies its diagnostics, and closes it with a note", async () => {
    await press(rowButton("The book would not open"));
    expect(lastAsked()).toEqual({ route: "admin_problem", args: { id: "a".repeat(24) } });
    expect(shown()).toContain("It said the file was missing.");
    const pre = find((element) => element.tagName === "PRE");
    expect(pre!.textContent).toBe(WHOLE.diagnostics);

    await press(button("Copy"));
    expect(writeText).toHaveBeenCalledWith(WHOLE.diagnostics);
    expect(showToast).toHaveBeenCalledWith("Diagnostics copied.");

    await type(find((element) => element.tagName === "TEXTAREA"), "Fixed in 1.5.8");
    await press(button("Close report"));
    expect(lastAsked()).toEqual({
      route: "admin_problem_update",
      args: { id: "a".repeat(24), status: "closed", note: "Fixed in 1.5.8" }
    });
    expect(showToast).toHaveBeenLastCalledWith("Closed.");
    // Closed, it leaves the open list; the sheet now offers to reopen it.
    expect(button("Reopen")).toBeTruthy();
    expect(shown()).toContain("Problems 2+");
  });

  it("deletes one only once that is confirmed", async () => {
    await press(rowButton("The book would not open"));
    await press(button("Delete"));
    expect(shown()).toContain("Delete this report?");
    await press(button("Cancel"));
    expect(asked().some(({ route }) => route === "admin_problem_delete")).toBe(false);

    await press(button("Delete"));
    const confirm = page().findAll(
      (element) => element.tagName === "BUTTON" && element.textContent === "Delete"
    );
    await press(confirm[confirm.length - 1]);
    expect(lastAsked()).toEqual({ route: "admin_problem_delete", args: { id: "a".repeat(24) } });
    expect(showToast).toHaveBeenLastCalledWith("Deleted.");
    expect(shown()).not.toContain("It said the file was missing.");
    expect(shown()).not.toContain("The book would not open");
  });
});
