/**
 * When a book counts as finished.
 *
 * The last page of an EPUB often reports 0.99x rather than 1, so a book is
 * finished from here on. Everything that says "finished" (the library's count,
 * your stats, the card's label, Pip's celebration and your public reader card)
 * reads this one rule. Rust publishes with the same number, `FINISHED_AT` in
 * `src-tauri/src/commands/mod.rs`; keep the two equal.
 */
export const FINISHED_AT = 0.99;

export const isFinished = (progress: number | null | undefined) => (progress ?? 0) >= FINISHED_AT;
