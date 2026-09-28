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
  sort: "recent" | "opened" | "author";
  view: "grid" | "list";
};
