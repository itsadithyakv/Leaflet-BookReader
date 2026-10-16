import { describe, expect, it, vi } from "vitest";
import type { Book } from "@shared/models/book";
import {
  LONG_LABEL_MAX,
  SHORT_LABEL_MAX,
  continueBook,
  continueLabel,
  createShortcutKeeper,
  fitText,
  shortcutFor
} from "./continueShortcut";

const book = (id: string, overrides: Partial<Book> = {}): Book => ({
  id,
  title: `Book ${id}`,
  author: null,
  genres: [],
  coverUrl: null,
  localPath: `/books/${id}.epub`,
  fileHash: id,
  progress: 0.3,
  lastOpened: "2026-10-01T10:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides
});

describe("which book the shortcut continues", () => {
  it("is the one opened last", () => {
    const books = [
      book("a", { lastOpened: "2026-10-01T10:00:00Z" }),
      book("b", { lastOpened: "2026-10-03T10:00:00Z" }),
      book("c", { lastOpened: "2026-10-02T10:00:00Z" })
    ];
    expect(continueBook(books)?.id).toBe("b");
  });

  it("skips a finished book, one at its end, and one not begun", () => {
    const books = [
      book("older", { lastOpened: "2026-09-01T10:00:00Z" }),
      book("end", { lastOpened: "2026-10-05T10:00:00Z", progress: 0.995 }),
      book("marked", { lastOpened: "2026-10-04T10:00:00Z", progress: 1, finishedAt: "2026-10-04T10:00:00Z" }),
      book("unstarted", { lastOpened: "2026-10-06T10:00:00Z", progress: 0 })
    ];
    expect(continueBook(books)?.id).toBe("older");
  });

  it("keeps a book read a second time (finished before, begun again)", () => {
    expect(continueBook([book("again", { finishedAt: "2025-01-01T00:00:00Z", progress: 0.2 })])?.id).toBe("again");
  });

  it("has no time limit, unlike Social's reading now", () => {
    expect(continueBook([book("old", { lastOpened: "2024-01-01T00:00:00Z" })])?.id).toBe("old");
  });

  it("is none for a library with nothing in progress", () => {
    expect(continueBook([])).toBeNull();
    expect(continueBook([book("never", { lastOpened: null }), book("bad", { lastOpened: "not a date" }), book("blank", { title: "  " })])).toBeNull();
  });

  it("breaks a tie the same way every time", () => {
    const at = "2026-10-01T10:00:00Z";
    expect(continueBook([book("z", { lastOpened: at }), book("m", { lastOpened: at })])?.id).toBe("m");
  });
});

describe("the shortcut's labels", () => {
  it("say Continue and the title when it fits", () => {
    expect(continueLabel("Dune", SHORT_LABEL_MAX)).toBe("Continue Dune");
    expect(continueLabel("  The   Hobbit ", LONG_LABEL_MAX)).toBe("Continue The Hobbit");
  });

  it("drop a subtitle first", () => {
    expect(continueLabel("Sapiens: A Brief History of Humankind", SHORT_LABEL_MAX)).toBe("Continue Sapiens");
    expect(continueLabel("Sapiens: A Brief History of Humankind", LONG_LABEL_MAX)).toBe("Continue Sapiens: A Brief History of Humankind");
    expect(continueLabel("Mistborn - The Final Empire (Book 1)", SHORT_LABEL_MAX)).toBe("Continue Mistborn");
  });

  it("cut a long title at a word, with an ellipsis", () => {
    const short = continueLabel("The Curious Incident of the Dog in the Night-Time", SHORT_LABEL_MAX);
    expect(short).toBe("Continue The Curious…");
    expect(Array.from(short).length).toBeLessThanOrEqual(SHORT_LABEL_MAX);
    const long = continueLabel("The Curious Incident of the Dog in the Night-Time and Other Stories Too", LONG_LABEL_MAX);
    expect(long).toBe("Continue The Curious Incident of the Dog in the…");
    expect(Array.from(long).length).toBeLessThanOrEqual(LONG_LABEL_MAX);
  });

  it("cut one long word where it must", () => {
    expect(fitText("Supercalifragilisticexpialidocious", 10)).toBe("Supercali…");
    expect(Array.from(continueLabel("Ἀλφαβητάριονκαὶἄλλαπολλάκαὶἄλλα", SHORT_LABEL_MAX)).length).toBeLessThanOrEqual(SHORT_LABEL_MAX);
  });

  it("leave no dangling punctuation before the ellipsis", () => {
    expect(fitText("Alpha, beta, gamma, delta", 13)).toBe("Alpha, beta…");
  });

  it("come with the book's id and cover", () => {
    expect(shortcutFor([book("a", { title: "Emma", coverUrl: "cover.jpg" })])).toEqual({
      bookId: "a",
      shortLabel: "Continue Emma",
      longLabel: "Continue Emma",
      coverUrl: "cover.jpg"
    });
    expect(shortcutFor([])).toBeNull();
  });
});

describe("keeping the phone's shortcut in step", () => {
  const native = () => ({
    set: vi.fn(async (_shortcut: { bookId: string; shortLabel: string; longLabel: string; coverDataUrl: string | null }) => undefined),
    clear: vi.fn(async () => undefined),
    cover: vi.fn(async (bookId: string) => `data:image/jpeg;base64,${bookId}`)
  });

  it("sets it when a book is opened, with its cover, and only once while nothing it says changes", async () => {
    const phone = native();
    const keeper = createShortcutKeeper(phone);
    await keeper.update([book("a", { coverUrl: "a.jpg" })]);
    await keeper.update([book("a", { coverUrl: "a.jpg", progress: 0.4 })]);
    expect(phone.set).toHaveBeenCalledTimes(1);
    expect(phone.set).toHaveBeenCalledWith({
      bookId: "a",
      shortLabel: "Continue Book a",
      longLabel: "Continue Book a",
      coverDataUrl: "data:image/jpeg;base64,a"
    });
  });

  it("asks for no cover when the book has none, and sets it without one when the cover can't be read", async () => {
    const phone = native();
    const keeper = createShortcutKeeper(phone);
    await keeper.update([book("a")]);
    expect(phone.cover).not.toHaveBeenCalled();
    expect(phone.set.mock.calls[0][0].coverDataUrl).toBeNull();
    phone.cover.mockRejectedValueOnce(new Error("no"));
    await keeper.update([book("b", { coverUrl: "b.jpg" })]);
    expect(phone.set.mock.calls[1][0]).toMatchObject({ bookId: "b", coverDataUrl: null });
  });

  it("moves on to the next book when this one is finished, and goes when none is left", async () => {
    const phone = native();
    const keeper = createShortcutKeeper(phone);
    const older = book("older", { lastOpened: "2026-09-01T00:00:00Z" });
    await keeper.update([older, book("now", { lastOpened: "2026-10-01T00:00:00Z" })]);
    await keeper.update([older, book("now", { lastOpened: "2026-10-01T00:00:00Z", progress: 1 })]);
    expect(phone.set.mock.calls.map((call) => call[0].bookId)).toEqual(["now", "older"]);
    await keeper.update([]);
    expect(phone.clear).toHaveBeenCalledTimes(1);
    await keeper.update([]);
    expect(phone.clear).toHaveBeenCalledTimes(1);
  });

  it("clears a stale one at the first look at a library with nothing in progress", async () => {
    const phone = native();
    await createShortcutKeeper(phone).update([book("new", { progress: 0, lastOpened: null })]);
    expect(phone.clear).toHaveBeenCalledTimes(1);
    expect(phone.set).not.toHaveBeenCalled();
  });

  it("follows a retitled book or a new cover", async () => {
    const phone = native();
    const keeper = createShortcutKeeper(phone);
    await keeper.update([book("a")]);
    await keeper.update([book("a", { title: "Persuasion" })]);
    await keeper.update([book("a", { title: "Persuasion", coverUrl: "p.jpg" })]);
    expect(phone.set).toHaveBeenCalledTimes(3);
  });

  it("forgets on a library switch: cleared, then set again by the next library", async () => {
    const phone = native();
    const keeper = createShortcutKeeper(phone);
    await keeper.update([book("a")]);
    await keeper.forget();
    expect(phone.clear).toHaveBeenCalledTimes(1);
    await keeper.update([book("a")]);
    expect(phone.set).toHaveBeenCalledTimes(2);
  });

  it("keeps the calls in order, a slow cover included", async () => {
    const phone = native();
    const order: string[] = [];
    let release = () => undefined as void;
    phone.cover.mockImplementationOnce(() => new Promise<string>((resolve) => (release = () => resolve("data:x"))));
    phone.set.mockImplementation(async (shortcut) => void order.push(`set ${shortcut.bookId}`));
    phone.clear.mockImplementation(async () => void order.push("clear"));
    const keeper = createShortcutKeeper(phone);
    void keeper.update([book("a", { coverUrl: "a.jpg" })]);
    const done = keeper.update([]);
    await vi.waitFor(() => expect(phone.cover).toHaveBeenCalled());
    expect(order).toEqual([]);
    release();
    await done;
    expect(order).toEqual(["set a", "clear"]);
  });

  it("carries on after a failed call", async () => {
    const phone = native();
    phone.set.mockRejectedValueOnce(new Error("no"));
    const keeper = createShortcutKeeper(phone);
    await keeper.update([book("a")]);
    await keeper.update([]);
    expect(phone.clear).toHaveBeenCalledTimes(1);
  });
});
