import { useMemo } from "react";
import type { Book } from "@shared/models/book";
import { useLibraryStore } from "../store/libraryStore";

/** As much of a book as a count of books finished needs. */
export type BookRead = Pick<Book, "id" | "title" | "author" | "progress" | "lastOpened"> & Pick<Partial<Book>, "finishedAt" | "progressUpdatedAt" | "genres">;

/**
 * The books a count of books finished goes by: the library's, and after them
 * the ones finished and since removed from it. Taking a book out of the
 * library is not un-reading it: it used to lower the reader's books
 * finished, here and on their public card, and drop the book from its year.
 *
 * A removed book is only its title, its author and the day it was finished:
 * it has no progress, was "last opened" never, and is in no shelf or series.
 */
export const useBooksRead = (): BookRead[] => {
  const books = useLibraryStore((state) => state.books);
  const gone = useLibraryStore((state) => state.finishedGone);
  return useMemo(
    () => [...books, ...gone.map((book) => ({ id: book.id, title: book.title, author: book.author, progress: 0, lastOpened: null, finishedAt: book.finishedAt }))],
    [books, gone]
  );
};
