import { createRoot, type Root } from "react-dom/client";
import { DiaryBook, type DiaryBookProps } from "./DiaryBook";

/**
 * Opens Pip's diary from anywhere: the rail's key, a diary lying in the room.
 *
 * The book is a dialog over the whole window and needs nothing from the page
 * it was opened from (it reads the stores itself), so it is put up in a root
 * of its own rather than asking each page for a place to stand. One at a
 * time: opening it again turns the open book to the day asked for.
 */
let root: Root | null = null;
let host: HTMLDivElement | null = null;

export const closePipDiary = () => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
};

export const openPipDiary = (at: Pick<DiaryBookProps, "initialDay" | "initialView"> = {}) => {
  if (!host) {
    host = document.createElement("div");
    host.dataset.pipDiary = "";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  // Keyed by what was asked for, so asking again starts the book there.
  root?.render(<DiaryBook key={`${at.initialDay ?? ""}/${at.initialView ?? ""}/${Date.now()}`} onClose={closePipDiary} {...at} />);
};

export const pipDiaryOpen = () => host !== null;
