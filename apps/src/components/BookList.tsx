import type { Book } from "@shared/models/book";
import { BookRow } from "./BookRow";
import { VIRTUALIZE_FROM } from "./BookGrid";
import { VirtualRows } from "./VirtualRows";

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  /** Told a book's title once its menu has removed it. */
  onRemoved?: (title: string) => void;
};

export const BookList = ({ books, onRefresh, onOpen, onRemoved }: Props) => {
  const row = (book: Book) => <BookRow key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} onRemoved={onRemoved} />;

  if (books.length <= VIRTUALIZE_FROM) {
    return <div className="flex flex-col gap-3">{books.map(row)}</div>;
  }

  // A long library draws only the rows on screen.
  return <VirtualRows count={books.length} estimate={96} gap={12} overscan={8} renderRow={(index) => row(books[index])} />;
};
