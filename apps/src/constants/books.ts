/**
 * When a book counts as finished.
 *
 * The last page of an EPUB often reports 0.99x rather than 1, so a book is
 * finished from here on. Everything that says "finished" (the library's count,
 * your stats, the card's label, Pip's celebration and your public reader card)
 * reads this one rule. Rust publishes with the same number, `FINISHED_AT` in
 * `src-tauri/src/db/mod.rs`; keep the two equal.
 */
export const FINISHED_AT = 0.99;

export const isFinished = (progress: number | null | undefined) => (progress ?? 0) >= FINISHED_AT;

type Finishable = { progress?: number | null; finishedAt?: string | null; progressUpdatedAt?: string | null; lastOpened?: string | null };

/**
 * Whether the reader has finished the book, ever: it is at its end now, or it
 * has a finished date from before a second reading took it back to the start.
 * This is what a count of books finished goes by; `isFinished` is where the
 * book is now, which is what a shelf goes by. (Rust: `has_finished`.)
 */
export const hasFinished = (book: Finishable) => Boolean(book.finishedAt) || isFinished(book.progress);

/**
 * When the book was finished: its finished date, or, for a book at its end
 * without one (finished before 1.3 kept the date), when its progress last
 * moved. Null for a book not finished.
 */
export const finishedOn = (book: Finishable): string | null =>
  book.finishedAt || (isFinished(book.progress) ? (book.progressUpdatedAt ?? book.lastOpened ?? null) : null);
