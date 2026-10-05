import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@shared/models/book";
import { bookService, type ImportOutcome } from "../services/bookService";
import { useLibraryStore } from "./libraryStore";

const book = (id: string) => ({ id, title: id, author: "Someone", genres: ["x"], coverUrl: "c", progress: 0 }) as unknown as Book;

const came = (...books: Book[]): ImportOutcome => ({ asked: books.length, books, failed: [] });

/** A promise finished by hand, to hold an import open. */
const held = <Value,>() => {
  let finish!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
};

describe("importing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useLibraryStore.getState().resetAll();
  });

  /**
   * The bug this guards: `importing` was a flag each import switched on and
   * off. With two running (the dialog open while a file arrives through "Open
   * with"), the first to finish switched it off under the other.
   */
  it("stays on until the last of two overlapping imports has finished", async () => {
    const dialog = held<ImportOutcome | null>();
    const opened = held<ImportOutcome>();
    vi.spyOn(bookService, "importFromDialog").mockReturnValue(dialog.promise);
    vi.spyOn(bookService, "importPaths").mockReturnValue(opened.promise);

    const first = useLibraryStore.getState().importBooks();
    const second = useLibraryStore.getState().importPaths(["C:\\Books\\b.epub"]);
    expect(useLibraryStore.getState().importing).toBe(true);

    opened.finish(came(book("b")));
    await second;
    expect(useLibraryStore.getState().importing).toBe(true);

    dialog.finish(came(book("a")));
    await first;
    expect(useLibraryStore.getState().importing).toBe(false);
    expect(useLibraryStore.getState().books.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
  });

  it("is switched off when an import fails", async () => {
    vi.spyOn(bookService, "importPaths").mockRejectedValue("That file is empty (0 bytes).");

    await expect(useLibraryStore.getState().importPaths(["C:\\Books\\empty.epub"])).rejects.toBe(
      "That file is empty (0 bytes)."
    );
    expect(useLibraryStore.getState().importing).toBe(false);
  });

  /**
   * The dialog used to say nothing of a file that failed, and "Open with" was
   * told only when every file did. The store hands back what happened, and
   * still answers "Open with" as the backend's own command does.
   */
  it("hands back the files that were not added, and why", async () => {
    const empty = { name: "empty.epub", reason: "That file is empty (0 bytes)." };
    vi.spyOn(bookService, "importFromDialog").mockResolvedValue({ asked: 2, books: [book("a")], failed: [empty] });
    expect(await useLibraryStore.getState().importBooks()).toEqual({ asked: 2, books: [book("a")], failed: [empty] });
    expect(useLibraryStore.getState().books.map((entry) => entry.id)).toEqual(["a"]);

    // Closed with nothing chosen: nothing to say.
    vi.spyOn(bookService, "importFromDialog").mockResolvedValue(null);
    expect(await useLibraryStore.getState().importBooks()).toBeNull();

    vi.spyOn(bookService, "importPaths").mockResolvedValue({ asked: 2, books: [book("b")], failed: [empty] });
    expect(await useLibraryStore.getState().importPaths(["b.epub", "empty.epub"])).toEqual([book("b")]);
    expect((await useLibraryStore.getState().importFiles(["b.epub", "empty.epub"])).failed).toEqual([empty]);

    vi.spyOn(bookService, "importPaths").mockResolvedValue({ asked: 1, books: [], failed: [empty] });
    await expect(useLibraryStore.getState().importPaths(["empty.epub"])).rejects.toBe("That file is empty (0 bytes).");
    expect(useLibraryStore.getState().importing).toBe(false);
  });
});
