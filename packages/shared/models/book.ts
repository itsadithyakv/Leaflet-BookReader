export type Book = {
  id: string;
  title: string;
  author: string | null;
  genres: string[];
  coverUrl: string | null;
  localPath: string;
  fileHash: string;
  progress: number;
  /**
   * The exact reading position (an EPUB CFI), synced with `progress` so another
   * device reopens at the reader's line rather than the chapter start. Null for
   * page-based books, whose page follows from `progress`.
   */
  position?: string | null;
  /**
   * The series the book is in, from the book itself or set by the reader;
   * `""` means the reader said it is in none. Most books have nothing here and
   * the library works their series out (src/library/series.ts).
   */
  series?: string | null;
  /** Its number in the series (2.5 for a novella between two books). */
  seriesIndex?: number | null;
  lastOpened: string | null;
  createdAt: string;
  // Last time metadata enrichment ran for this book, successful or not.
  metadataCheckedAt?: string | null;
  /**
   * Whether the file is on this device.
   *
   * Sync publishes the library index to every device but fetches the bytes on
   * demand, so a book can be in the library with nothing to open yet.
   */
  available?: boolean;
};

export type BookFilter = {
  query: string;
  author: string;
  genre: string;
  sort: "recent" | "opened" | "title" | "author" | "series";
  view: "grid" | "list";
};
