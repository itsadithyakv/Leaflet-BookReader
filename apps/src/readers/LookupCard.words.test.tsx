import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MiniElement, installMiniDom, makeEvent } from "../testing/miniDom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

const document = installMiniDom();
// The card looks for the reader's toolbar to keep clear of; there is none here.
const miniProto = MiniElement.prototype as unknown as { closest?: () => null };
miniProto.closest ??= () => null;
// And reads the system bar's inset: none.
(globalThis as unknown as { getComputedStyle: () => unknown }).getComputedStyle = () => ({ getPropertyValue: () => "" });

const kept = {
  id: "word:en:brume",
  bookId: "b1",
  kind: "word",
  cfi: "epubcfi(/6/8!/4/2/1:0)",
  note: "brume",
  text: JSON.stringify({ m: "Mist; fog.", p: 0.25, n: 1, at: "2026-10-24T10:00:00.000Z", l: "en", pos: "noun" }),
  chapter: "Chapter 2",
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
  deletedAt: null
};

describe("a looked-up word on the look-up card, kept and taken back", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let root: import("react-dom/client").Root;
  let LookupCard: typeof import("./LookupCard").LookupCard;

  beforeAll(async () => {
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ LookupCard } = await import("./LookupCard"));
    const { lookupService } = await import("../services/lookupService");
    vi.spyOn(lookupService, "lookUp").mockResolvedValue({
      term: "brume",
      meaning: { word: "brume", language: "English", entries: [{ partOfSpeech: "Noun", definitions: ["Mist; fog."] }], url: "https://en.wiktionary.org/wiki/brume", root: null },
      summary: null,
      lead: "meaning",
      missed: []
    });
  }, 30_000);

  beforeEach(async () => {
    localStorage.removeItem("leaflet.reader.keepWords");
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => (command === "word_record" ? kept : command === "words_restore" ? [kept] : undefined));
    const container = document.createElement("div") as MiniElement;
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
    await React.act(async () =>
      root.render(<LookupCard term="brume" language="en" onClose={() => undefined} place={{ bookId: "b1", cfi: kept.cfi, chapter: "Chapter 2", progress: 0.25 }} />)
    );
    for (let round = 0; round < 8; round += 1) {
      await React.act(async () => {
        await new Promise((done) => setTimeout(done, 0));
      });
    }
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
  });

  const all = (test: (element: MiniElement) => boolean) => (document.body as unknown as MiniElement).findAll(test);
  const status = () => all((element) => (element.getAttribute("class") ?? "").includes("reader-lookup-kept"))[0];
  const button = (label: string) => all((element) => element.tagName === "BUTTON" && element.textContent.trim() === label)[0];
  const press = async (label: string) => {
    const target = button(label);
    expect(target, label).toBeTruthy();
    await React.act(async () => {
      target.dispatchEvent(makeEvent("click", target));
    });
    for (let round = 0; round < 4; round += 1) {
      await React.act(async () => {
        await Promise.resolve();
      });
    }
  };

  it("removes the word from My words, and Undo puts it back", async () => {
    expect(invoke).toHaveBeenCalledWith("word_record", expect.anything());
    expect(status()?.textContent).toContain("Kept in My words");
    expect(button("Don’t keep")?.getAttribute("title")).toBeTruthy();

    await press("Don’t keep");
    expect(invoke).toHaveBeenCalledWith("words_delete", { ids: ["word:en:brume"] });
    expect(status()?.textContent).toContain("Not kept.");

    await press("Undo");
    expect(invoke).toHaveBeenCalledWith("words_restore", { ids: ["word:en:brume"] });
    expect(status()?.textContent).toContain("Kept in My words");
  });
});
