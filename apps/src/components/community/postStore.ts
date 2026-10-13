import { create } from "zustand";

/**
 * Whether the "I finished a book" dialog is open, and on which book. Opened
 * from two places (a finished book's own menu, and the feed), so it is state
 * of its own and the dialog is mounted once.
 */
export type PostDraft = { title: string; author: string | null };

/** What the dialog opens on: a review, a quote (with its words, from a highlight), or a finished book. */
export type PostStart = { kind?: "finished" | "review" | "quote"; quote?: string };

type PostState = {
  /** The book being told of; `null` for "pick one" (from the feed). */
  open: ({ book: PostDraft | null } & PostStart) | null;
  /** Bumped when a post is made or removed, so the feed reads again. */
  changed: number;
  compose: (book: PostDraft | null, start?: PostStart) => void;
  close: () => void;
  noteChanged: () => void;
};

export const usePostStore = create<PostState>((set, get) => ({
  open: null,
  changed: 0,
  compose(book, start) {
    set({ open: { book, ...start } });
  },
  close() {
    set({ open: null });
  },
  noteChanged() {
    set({ changed: get().changed + 1 });
  }
}));

/** Opens the dialog on a book (or on none, to pick one of the finished). */
export const composePost = (book: PostDraft | null = null, start?: PostStart) => usePostStore.getState().compose(book, start);
