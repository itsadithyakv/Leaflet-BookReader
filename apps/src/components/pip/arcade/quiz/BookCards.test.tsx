import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../../../testing/miniDom";
import type { StudyCard } from "../../../../study/cards";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const document = installMiniDom();

describe("a book's cards", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let BookCards: typeof import("./BookCards").BookCards;
  let cards: StudyCard[];
  const onChanged = vi.fn();
  const onRevise = vi.fn();
  const loader = { load: vi.fn(() => Promise.reject(new Error("no pictures here"))), close: vi.fn() };

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ BookCards } = await import("./BookCards"));
    const { useLibraryStore } = await import("../../../../store/libraryStore");
    useLibraryStore.setState({ requestBackup: () => undefined, books: [{ id: "b1", title: "Gray's Anatomy", available: true }] } as never);
    const { askInput, fillInput, fromRow, saved } = await import("../../../../study/cards");
    const place = { bookId: "b1", cfi: "epubcfi(/6/8!/4/2)", chapter: "The heart", p: 0.2 };
    cards = [
      fromRow(saved(null, fillInput(place, "The mitral valve has two cusps.", [[4, 10]], "h1", "card:f"), "2026-10-25T10:00:00.000Z"))!,
      fromRow(saved(null, askInput({ ...place, p: 0.4 }, "What closes first?", "The mitral valve.", "h2", "card:a"), "2026-10-25T10:00:01.000Z"))!,
      // Another book's: not listed here.
      fromRow(saved(null, askInput({ ...place, bookId: "b2" }, "Elsewhere?", "Yes.", null, "card:x"), "2026-10-25T10:00:02.000Z"))!
    ];
  }, 30_000);

  beforeEach(async () => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args: { cards?: unknown[] }) => (command === "cards_save" ? [] : command === "cards_restore" ? [] : args ? undefined : undefined));
    onChanged.mockReset();
    onRevise.mockReset();
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () =>
      root.render(<BookCards bookId="b1" cards={cards} loader={loader} onChanged={onChanged} onRevise={onRevise} onOpened={() => undefined} />)
    );
  });

  afterEach(async () => {
    await React.act(async () => root?.unmount());
    for (const child of [...(document.body as unknown as MiniElement).childNodes]) {
      (document.body as unknown as MiniElement).removeChild(child);
    }
  });

  const page = () => document.body as unknown as MiniElement;
  const all = (test: (element: MiniElement) => boolean) => page().findAll(test);
  const button = (label: string) => all((element) => element.tagName === "BUTTON" && element.textContent.trim() === label)[0];
  const labelled = (start: string) => all((element) => element.tagName === "BUTTON" && (element.getAttribute("aria-label") ?? "").startsWith(start))[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
    for (let round = 0; round < 4; round += 1) {
      await React.act(async () => {
        await new Promise((done) => setTimeout(done, 0));
      });
    }
  };

  it("lists this book's cards, in the book's order, with how many are due", () => {
    expect(page().textContent).toContain("Gray's Anatomy");
    expect(page().textContent).toContain("2 cards · 2 due");
    const items = all((element) => element.getAttribute("class") === "pip-word");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("The ____ valve has two cusps.");
    expect(items[1].textContent).toContain("What closes first?");
    expect(page().textContent).not.toContain("Elsewhere?");
  });

  it("revises just this book", async () => {
    await press(button("Revise this book"));
    expect(onRevise).toHaveBeenCalledWith("b1");
  });

  it("removes a card at once, with Undo after, which puts it back", async () => {
    await press(labelled("Remove: What closes first?"));
    expect(invoke).toHaveBeenCalledWith("cards_delete", { ids: ["card:a"] });
    expect(onChanged).toHaveBeenCalled();
    expect(page().textContent).toContain("Card removed");
    await press(labelled("Undo"));
    expect(invoke).toHaveBeenCalledWith("cards_restore", { ids: ["card:a"] });
  });

  it("edits a card in place: a passage's blanks are pressed again", async () => {
    await press(labelled("Edit: The ____ valve"));
    // Nothing changed yet: nothing to save.
    expect(button("Save")?.getAttribute("disabled")).not.toBeNull();
    await press(all((element) => element.tagName === "BUTTON" && element.getAttribute("class") === "pip-card-edit-word" && element.textContent === "cusps")[0]);
    await press(button("Save"));
    const saved = invoke.mock.calls.find(([command]) => command === "cards_save");
    expect(saved?.[1]).toMatchObject({ cards: [{ id: "card:f", detail: { t: "fill", x: [[4, 10], [25, 30]], h: "h1" } }] });
  });
});
