import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TidyMove } from "../library/tidyPlan";

/** One book file in the folder, and what it says about itself. */
export type TidyScannedFile = {
  /** From the folder, with `/` between the parts. */
  path: string;
  size: number;
  hash: string;
  /** The book in the library with these exact bytes, if there is one. */
  bookId: string | null;
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  extension: string;
};

export type TidyScan = {
  folder: string;
  files: TidyScannedFile[];
  /** Book files that could not be read. They keep their names. */
  leftAlone: Array<{ path: string; reason: string }>;
  /** The folder holds more book files than one scan reads. */
  capped: boolean;
};

/** A move that was not made, and why. */
export type TidySkipped = { from: string; reason: string };
export type TidyReport = { moved: number; skipped: TidySkipped[] };
export type TidyUndone = { restored: number; skipped: TidySkipped[] };
/** The last run, while it can still be undone. */
export type TidyLast = { folder: string; count: number; at: string };

const needsDesktop = () => new Error("Tidying a folder needs the desktop app.");

/**
 * "Tidy a folder": the book files in a folder the reader chose, renamed and
 * sorted. `scan` only reads; the names are worked out on the page
 * (`library/tidyPlan.ts`) and shown; `apply` makes the moves, checking each
 * one again in Rust; `undo` puts the last run back.
 */
export const tidyService = {
  /** False in the browser preview, where there are no files to rename. */
  available: () => isTauri(),

  async scan(folder: string): Promise<TidyScan> {
    if (!isTauri()) {
      throw needsDesktop();
    }
    return invoke<TidyScan>("tidy_scan", { folder });
  },

  async apply(folder: string, moves: TidyMove[]): Promise<TidyReport> {
    if (!isTauri()) {
      throw needsDesktop();
    }
    return invoke<TidyReport>("tidy_apply", { folder, moves });
  },

  async undo(): Promise<TidyUndone> {
    if (!isTauri()) {
      throw needsDesktop();
    }
    return invoke<TidyUndone>("tidy_undo");
  },

  async last(): Promise<TidyLast | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke<TidyLast | null>("tidy_last");
  }
};
