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

/** A fill-in card's row, from book `bookId`. */
const card = (id: string, bookId: string, due: number | null = null) => ({
  id: `card:${id}`,
  bookId,
  kind: "card",
  cfi: "epubcfi(/6/8!/4/2,/1:0,/1:31)",
  note: null,
  text: JSON.stringify({ t: "fill", s: "The mitral valve has two cusps.", x: [[4, 10]], p: 0.3, ...(due === null ? {} : { b: 1, d: due }) }),
  chapter: "The heart",
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
  deletedAt: null
});

describe("Revise, on the Library", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let ReviseWordsKey: typeof import("./ReviseWordsKey").ReviseWordsKey;
  let StudyOverlay: typeof import("../../study/StudyOverlay").StudyOverlay;
  let useStudyStore: typeof import("../../study/studyStore").useStudyStore;
  let today: number;
  let rows: ReturnType<typeof row>[] = [];
  let cards: ReturnType<typeof card>[] = [];

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ ReviseWordsKey } = await import("./ReviseWordsKey"));
    ({ StudyOverlay } = await import("../../study/StudyOverlay"));
    ({ useStudyStore } = await import("../../study/studyStore"));
    const { resetStartupForTests } = await import("../../platform/afterStartup");
    resetStartupForTests(true);
    const { dayNumber } = await import("../../pip/diary/seed");
    const { getDateKey } = await import("../../services/habitService");
    today = dayNumber(getDateKey());
    const { useLibraryStore } = await import("../../store/libraryStore");
    useLibraryStore.setState({ requestBackup: () => undefined } as never);
    // The quiz is loaded on demand: fetched once here, so the tests do not wait on it.
    await import("../../components/pip/arcade/quiz/ReviseWords");
  }, 30_000);

  beforeEach(() => {
    localStorage.removeItem("leaflet.reader.keepWords");
    useStudyStore.setState({ view: null, words: null, cards: null, making: null });
    rows = [];
    cards = [];
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => (command === "words_list" ? rows : command === "cards_list" ? cards : undefined));
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
    // The key, and the overlay where the app keeps it (App.tsx).
    await React.act(async () =>
      root.render(
        <>
          <ReviseWordsKey compact={compact} />
          <StudyOverlay />
        </>
      )
    );
    await settle();
  };
  const all = (test: (element: MiniElement) => boolean) => (document.body as unknown as MiniElement).findAll(test);
  const key = () => all((element) => element.tagName === "BUTTON" && (element.getAttribute("aria-label") ?? "").startsWith("Revise"))[0];
  const button = (label: string) => all((element) => element.tagName === "BUTTON" && element.textContent.trim() === label)[0];
  const dialog = () => all((element) => element.getAttribute("role") === "dialog")[0];
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
    expect(key()?.getAttribute("aria-label")).toBe("Revise: 3 due");
    expect(key()?.textContent).toContain("Revise");
    expect(key()?.textContent).toContain("3 due");
    // What it is for is in its tooltip, not on the page.
    expect(key()?.getAttribute("title")).toBeTruthy();
  });

  it("counts the cards that are due with the words", async () => {
    rows = [row("brume"), row("mizzle", today + 3), row("ephemeral", today + 3), row("sagacious", today + 7)];
    cards = [card("a", "b1"), card("b", "b2", today), card("c", "b2", today + 2)];
    await mount();
    expect(key()?.getAttribute("aria-label")).toBe("Revise: 3 due");
  });

  it("on a phone is an icon with the count on it", async () => {
    rows = [row("brume"), row("mizzle"), row("ephemeral"), row("sagacious", today + 7)];
    await mount(true);
    expect(key()?.getAttribute("aria-label")).toBe("Revise: 3 due");
    expect(key()?.textContent.trim()).toBe("3");
  });

  it("stays, quietly, when nothing is due", async () => {
    rows = [row("brume", today + 3), row("mizzle", today + 3), row("ephemeral", today + 9), row("sagacious", today + 7)];
    cards = [card("a", "b1", today + 1)];
    await mount(true);
    expect(key()?.getAttribute("aria-label")).toBe("Revise");
    expect(key()?.textContent.trim()).toBe("");
  });

  it("is not there with nothing to revise; with words switched off it is there for cards alone", async () => {
    await mount();
    expect(key()).toBeUndefined();
    await React.act(async () => root.unmount());

    rows = [row("brume"), row("mizzle"), row("ephemeral"), row("sagacious")];
    localStorage.setItem("leaflet.reader.keepWords", "0");
    invoke.mockClear();
    await mount();
    expect(key()).toBeUndefined();
    expect(invoke).not.toHaveBeenCalledWith("words_list");
    await React.act(async () => root.unmount());

    cards = [card("a", "b1")];
    useStudyStore.setState({ cards: null });
    await mount();
    expect(key()?.getAttribute("aria-label")).toBe("Revise: 1 due");
  });

  it("opens over the Library, on all of it, with the words' quiz and My words a choice away, and closes back to it", async () => {
    rows = [row("brume"), row("mizzle"), row("ephemeral"), row("sagacious"), row("quiddity", today + 30)];
    cards = [card("a", "b1"), card("b", "b2")];
    await mount();
    await press(key());
    expect(dialog()?.textContent).toContain("Revise");
    // All, words, or cards.
    expect(button("All")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Start")).toBeTruthy();
    expect(dialog()?.textContent).toContain("6 due");
    await press(button("Words"));
    // The arcade's quiz itself, with Pip's question menu, not a copy of it.
    expect(button("Play: words")).toBeTruthy();
    await press(button("My words (5)"));
    expect(dialog()?.textContent).toContain("My words");
    expect(dialog()?.textContent).toContain("brume");
    await press(button("Revise"));
    expect(button("Play: words")).toBeTruthy();
    // Cards, of every book or of one.
    await press(button("Cards"));
    expect(dialog()?.textContent).toContain("2 due");
    const books = all((element) => element.tagName === "SELECT")[0];
    expect(books?.getAttribute("aria-label")).toBe("Cards from");
    await press(button("Close"));
    expect(dialog()).toBeUndefined();
    expect(key()).toBeTruthy();
  });

  it("asks a card, shows it, and moves it a box for the answer", async () => {
    cards = [card("a", "b1")];
    await mount();
    await press(key());
    // Only cards: no choice to make.
    expect(button("All")).toBeUndefined();
    await press(button("Start"));
    expect(dialog()?.textContent).toContain("Cards: 1 of 1");
    // Before the reveal, the hidden word is a blank.
    const blank = all((element) => element.getAttribute("class") === "pip-card-blank")[0];
    expect(blank?.textContent).toContain("blank");
    await press(button("Reveal"));
    expect(all((element) => element.getAttribute("class") === "pip-card-blank")[0]?.textContent).toBe("mitral");
    const answer = all((element) => element.tagName === "BUTTON" && element.textContent.includes("Had it"))[0];
    await press(answer);
    expect(invoke).toHaveBeenCalledWith("cards_review", { reviews: [{ id: "card:a", box: 1, due: today + 1 }] });
    expect(dialog()?.textContent).toContain("1 of 1");
    expect(button("Another round")).toBeTruthy();
  });
});
