import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, makeEvent, type MiniElement } from "../../../../testing/miniDom";
import type { SavedWord } from "../../../../readers/words/rows";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
// Pip herself is drawn on a canvas: a stand-in will do here.
vi.mock("../../../PipSprite", () => ({ PipSprite: () => null }));

const document = installMiniDom();

const MEANINGS: Record<string, string> = {
  ephemeral: "Lasting a very short time.",
  brume: "Mist; fog.",
  mizzle: "Fine rain.",
  sagacious: "Wise and shrewd.",
  quiddity: "The essence of a thing."
};

const savedWord = (word: string, extra: Partial<SavedWord> = {}): SavedWord => ({
  id: `word:en:${word}`,
  word,
  meaning: MEANINGS[word] ?? `The meaning of ${word}.`,
  language: "en",
  part: null,
  bookId: "b1",
  at: { p: 0.5, cfi: null, chapter: null },
  count: 1,
  lookedUpAt: "2026-10-20T10:00:00.000Z",
  createdAt: "2026-10-20T10:00:00.000Z",
  box: 0,
  due: null,
  ...extra
});

describe("removing a word from inside the quiz", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let WordQuiz: typeof import("./WordQuiz").WordQuiz;
  const onChanged = vi.fn();
  const words = Object.keys(MEANINGS).map((word) => savedWord(word));

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ WordQuiz } = await import("./WordQuiz"));
  }, 30_000);

  beforeEach(async () => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => (command === "words_restore" ? [] : undefined));
    onChanged.mockReset();
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () =>
      root.render(<WordQuiz words={words} onChanged={onChanged} onMyWords={() => undefined} skin="sprout" outfit={[]} />)
    );
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
  });

  const body = () => document.body as unknown as MiniElement;
  const all = (test: (element: MiniElement) => boolean) => body().findAll(test);
  const byClass = (name: string) => all((element) => (element.getAttribute("class") ?? "").split(" ").includes(name))[0];
  const button = (label: string) =>
    all((element) => element.tagName === "BUTTON" && (element.getAttribute("aria-label") === label || element.textContent.trim() === label))[0];
  const press = async (target: MiniElement | undefined) => {
    expect(target, "something to press").toBeTruthy();
    await React.act(async () => {
      target!.dispatchEvent(makeEvent("click", target!));
    });
  };
  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      await React.act(async () => {
        await Promise.resolve();
      });
    }
  };

  it("takes the word out of the round and the words at once, with Undo to put it back", async () => {
    await press(button("Play: words"));
    expect(byClass("pip-quiz-count")?.textContent).toContain("1 of 5");
    // The first question always holds up a word.
    const asked = byClass("pip-quiz-prompt")!.textContent.trim();
    expect(Object.keys(MEANINGS)).toContain(asked);

    await press(button("Don't ask this word again: remove it from My words"));
    await settle();
    expect(invoke).toHaveBeenCalledWith("words_delete", { ids: [`word:en:${asked}`] });
    // On to the next question, of four now; the removed one is not asked again.
    expect(byClass("pip-quiz-count")?.textContent).toContain("1 of 4");
    expect(byClass("pip-quiz-prompt")!.textContent).not.toBe(asked);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(byClass("pip-quiz-gone")?.textContent).toContain(`Removed “${asked}”`);

    await press(button(`Undo: put “${asked}” back`));
    await settle();
    expect(invoke).toHaveBeenCalledWith("words_restore", { ids: [`word:en:${asked}`] });
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(byClass("pip-quiz-gone")).toBeUndefined();
    // The round goes on as it was.
    expect(byClass("pip-quiz-count")?.textContent).toContain("1 of 4");
  });

  it("ends the round when the last question goes, counting only the questions left", async () => {
    await press(button("Play: words"));
    // Answer four, then remove the fifth.
    for (let at = 0; at < 4; at += 1) {
      await press(byClass("pip-quiz-option"));
      await press(button("Next"));
    }
    expect(byClass("pip-quiz-count")?.textContent).toContain("5 of 5");
    await press(button("Don't ask this word again: remove it from My words"));
    await settle();
    expect(byClass("pip-quiz-prompt")?.textContent).toMatch(/of 4 right/);
    expect(byClass("pip-quiz-gone")?.textContent).toContain("Removed");
  });

  it("says so, and offers no Undo, when the removal does not go through", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "words_delete") throw "The database is busy.";
      return undefined;
    });
    await press(button("Play: words"));
    await press(button("Don't ask this word again: remove it from My words"));
    await settle();
    expect(byClass("pip-quiz-gone")?.textContent).toContain("couldn't be removed");
    expect(all((element) => element.tagName === "BUTTON" && element.textContent.includes("Undo"))).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
