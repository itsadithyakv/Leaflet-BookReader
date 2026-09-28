import type { Book } from "@shared/models/book";
import { BookRow } from "./BookRow";

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
};

export const BookList = ({ books, onRefresh, onOpen, onRemove }: Props) => {
  return (
    <div className="flex flex-col gap-3">
      {books.map((book) => (
        <BookRow
          key={book.id}
          book={book}
          onRefresh={onRefresh}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
};
