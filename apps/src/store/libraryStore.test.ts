import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";
import { useLibraryStore } from "./libraryStore";

const book = (id: string) => ({ id, title: id, author: "Someone", genres: ["x"], coverUrl: "c", progress: 0 }) as unknown as Book;

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
    const dialog = held<Book[]>();
    const opened = held<Book[]>();
    vi.spyOn(bookService, "importFromDialog").mockReturnValue(dialog.promise);
    vi.spyOn(bookService, "importPaths").mockReturnValue(opened.promise);

    const first = useLibraryStore.getState().importBooks();
    const second = useLibraryStore.getState().importPaths(["C:\\Books\\b.epub"]);
    expect(useLibraryStore.getState().importing).toBe(true);

    opened.finish([book("b")]);
    await second;
    expect(useLibraryStore.getState().importing).toBe(true);

    dialog.finish([book("a")]);
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
});
