import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
// Pip herself is drawn on a canvas: a stand-in will do here.
vi.mock("../../components/PipSprite", () => ({ PipSprite: () => null }));

const document = installMiniDom();

/** A word's row as the database keeps it; `due` a day number, or none for a word never asked. */
const row = (word: string, due: number | null = null) => ({
  id: `word:en:${word}`,
  bookId: "b1",
  kind: "word",
  cfi: "",
  note: word,
  text: JSON.stringify({ m: `The meaning of ${word}.`, p: 0.5, n: 1, at: "2026-10-20T10:00:00.000Z", l: "en", ...(due === null ? {} : { b: 2, d: due }) }),
  chapter: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  deletedAt: null
});

describe("Revise words, on the Library", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let ReviseWordsKey: typeof import("./ReviseWordsKey").ReviseWordsKey;
  let today: number;
  let rows: ReturnType<typeof row>[] = [];

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ ReviseWordsKey } = await import("./ReviseWordsKey"));
    const { resetStartupForTests } = await import("../../platform/afterStartup");
    resetStartupForTests(true);
    const { dayNumber } = await import("../../pip/diary/seed");
    const { getDateKey } = await import("../../services/habitService");
    today = dayNumber(getDateKey());
    // The quiz is loaded on demand: fetched once here, so the tests do not wait on it.
    await import("../../components/pip/arcade/quiz/ReviseWords");
  }, 30_000);

  beforeEach(() => {
    localStorage.removeItem("leaflet.reader.keepWords");
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => (command === "words_list" ? rows : undefined));
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    for (const child of [...(document.body as unknown as MiniElement).childNodes]) {
      (document.body as unknown as MiniElement).removeChild(child);
    }
  });

  const settle = async () => {
    for (let round = 0; round < 8; round += 1) {
      await React.act(async () => {
        await new Promise((done) => setTimeout(done, 0));
      });
    }
  };
  const mount = async (compact = false) => {
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () => root.render(<ReviseWordsKey compact={compact} />));
    await settle();
  };
  const all = (test: (element: MiniElement) => boolean) => (document.body as unknown as MiniElement).findAll(test);
  const key = () => all((element) => element.tagName === "BUTTON" && (element.getAttribute("aria-label") ?? "").startsWith("Revise words"))[0];
  const button = (label: string) => all((element) => element.tagName === "BUTTON" && element.textContent.trim() === label)[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
    await settle();
  };

  it("shows with words kept, and says how many are due", async () => {
    rows = [row("brume"), row("mizzle"), row("ephemeral", today - 1), row("sagacious", today + 7), row("quiddity", today + 30)];
    await mount();
    expect(key()?.getAttribute("aria-label")).toBe("Revise words: 3 due");
    expect(key()?.textContent).toContain("Revise words");
    expect(key()?.textContent).toContain("3 due");
    // What it is for is in its tooltip, not on the page.
    expect(key()?.getAttribute("title")).toBeTruthy();
  });

  it("on a phone is an icon with the count on it", async () => {
    rows = [row("brume"), row("mizzle"), row("ephemeral"), row("sagacious", today + 7)];
    await mount(true);
    expect(key()?.getAttribute("aria-label")).toBe("Revise words: 3 due");
    expect(key()?.textContent.trim()).toBe("3");
  });

  it("stays, quietly, when nothing is due", async () => {
    rows = [row("brume", today + 3), row("mizzle", today + 3), row("ephemeral", today + 9), row("sagacious", today + 7)];
    await mount(true);
    expect(key()?.getAttribute("aria-label")).toBe("Revise words");
    expect(key()?.textContent.trim()).toBe("");
  });

  it("is not there with no words, or with keeping words switched off", async () => {
    rows = [];
    await mount();
    expect(key()).toBeUndefined();
    await React.act(async () => root.unmount());

    rows = [row("brume"), row("mizzle"), row("ephemeral"), row("sagacious")];
    localStorage.setItem("leaflet.reader.keepWords", "0");
    invoke.mockClear();
    await mount();
    expect(key()).toBeUndefined();
    expect(invoke).not.toHaveBeenCalledWith("words_list");
  });

  it("opens the quiz over the Library, with My words behind it, and closes back to it", async () => {
    rows = [row("brume"), row("mizzle"), row("ephemeral"), row("sagacious"), row("quiddity", today + 30)];
    await mount();
    await press(key());
    const dialog = () => all((element) => element.getAttribute("role") === "dialog")[0];
    expect(dialog()?.textContent).toContain("Revise words");
    // The arcade's quiz itself, with Pip's question menu, not a copy of it.
    expect(button("Play: words")).toBeTruthy();
    await press(button("My words (5)"));
    expect(dialog()?.textContent).toContain("My words");
    expect(dialog()?.textContent).toContain("brume");
    await press(button("Quiz"));
    expect(button("Play: words")).toBeTruthy();
    await press(button("Close"));
    expect(dialog()).toBeUndefined();
    expect(key()).toBeTruthy();
  });
});
