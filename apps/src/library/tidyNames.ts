import type { Book } from "@shared/models/book";
import type { TidyScannedFile } from "../services/tidyService";
import { guessSeries, librarySeries, seriesKey } from "./series";
import type { TidyFile, TidySeries } from "./tidyPlan";

/**
 * What each file in a folder being tidied is called.
 *
 * A file the library has (the same bytes) is the book the reader knows: its
 * title and author as the library shows them, and the series the library has
 * worked out for it. Any other file goes by what it says about itself, read
 * by the rules import uses, and a series only where the file or its title
 * names one outright: a weak hint is not enough to make a folder of.
 */
export const nameScanned = (files: TidyScannedFile[], books: Book[]): TidyFile[] => {
  const library = librarySeries(books);
  const byId = new Map(books.map((book) => [book.id, book]));

  // One series, one folder: the library's name for it, or the first one met.
  const names = new Map(library.groups.map((group) => [group.key, group.name]));
  const named = (name: string, index: number | null): TidySeries => {
    const key = seriesKey(name) || name.toLowerCase();
    const known = names.get(key) ?? name;
    names.set(key, known);
    return { name: known, index };
  };

  return files.map((file) => {
    const { path, hash, extension } = file;
    const book = file.bookId ? byId.get(file.bookId) : undefined;
    if (book) {
      const series = library.byBook.get(book.id);
      return { path, hash, extension, title: book.title, author: book.author, series: series ? named(series.name, series.index) : null };
    }
    const guess = guessSeries({
      id: hash,
      fileHash: hash,
      title: file.title,
      author: file.author,
      series: file.series,
      seriesIndex: file.seriesIndex,
      genres: [],
      coverUrl: null,
      localPath: "",
      progress: 0,
      lastOpened: null,
      createdAt: ""
    });
    const series = guess && guess !== "none" && guess.strength !== "weak" ? named(guess.name, guess.index) : null;
    return { path, hash, extension, title: file.title, author: file.author, series };
  });
};
