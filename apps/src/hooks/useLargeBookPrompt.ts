import { useEffect, useRef } from "react";
import { askConfirm } from "../components/ConfirmDialog";
import { largeBookQuestion } from "../library/largeBooks";
import { syncService } from "../services/syncService";
import { useLibraryStore } from "../store/libraryStore";

/** Asked about since the app started: a book is never asked about twice in a run. */
const asked = new Set<string>();

/**
 * Asks before a large book's file is backed up (library/largeBooks.ts).
 *
 * A backup that held files back says so (`largeHeld`); the books not yet
 * answered for are asked about in one question, the answer is kept, and a
 * "yes" backs up again at once so the files go now. Not while a book is
 * open: the question waits for the library.
 */
export const useLargeBookPrompt = (reading: boolean) => {
  const held = useLibraryStore((state) => state.largeHeld);
  const askingRef = useRef(false);

  useEffect(() => {
    if (held <= 0 || reading || askingRef.current) {
      return;
    }
    askingRef.current = true;
    void (async () => {
      const waiting = (await syncService.largeBooks()).filter((book) => book.backUp === null && !asked.has(book.id));
      if (waiting.length === 0) {
        return;
      }
      waiting.forEach((book) => asked.add(book.id));
      const backUp = await askConfirm(largeBookQuestion(waiting));
      await syncService.setLargeBookBackup(
        waiting.map((book) => book.id),
        backUp
      );
      useLibraryStore.setState({ largeHeld: 0 });
      if (backUp) {
        await useLibraryStore.getState().syncNow();
      }
    })()
      .catch(() => {
        // A backup that fails says so itself (the store's sync error).
      })
      .finally(() => {
        askingRef.current = false;
      });
  }, [held, reading]);
};
