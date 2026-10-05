import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { EMPTY_SNAPSHOT, getDateKey } from "../services/habitService";
import { useHabitStore } from "../store/habitStore";
import { useLibraryStore } from "../store/libraryStore";
import { usePipStore } from "../store/pipStore";
import { isFinished } from "../constants/books";
import { goalBeat, pickBeat, type PipBeat } from "../pip/moments";

const DAY_MS = 86_400_000;
const WELCOME_BACK_DAYS = 3;

const daysBetween = (fromKey: string, toKey: string) =>
  Math.round((Date.parse(`${toKey}T00:00:00`) - Date.parse(`${fromKey}T00:00:00`)) / DAY_MS);

/**
 * Turns reading events into Pip moments. Pip only moves when something
 * happened; this is the list of what counts.
 *
 * With a book open the stages are covered, so a celebration becomes a peek in
 * the reader instead. A finished session is not here: the wrap-up screen owns
 * that one, and a second celebration underneath it would be noise.
 */
export const usePipReactions = (readerOpen: boolean) => {
  const { react, showPeek, setSuspended } = usePipStore(
    useShallow((state) => ({ react: state.react, showPeek: state.showPeek, setSuspended: state.setSuspended }))
  );
  const { snapshot, pendingBreak, activeSession } = useHabitStore(
    useShallow((state) => ({ snapshot: state.snapshot, pendingBreak: state.pendingBreak, activeSession: state.activeSession }))
  );
  const { books, booksLoading } = useLibraryStore(
    useShallow((state) => ({ books: state.books, booksLoading: state.loading }))
  );
  const readerOpenRef = useRef(readerOpen);
  readerOpenRef.current = readerOpen;

  const celebrate = useRef((beat: PipBeat, loops = 2) => {
    if (readerOpenRef.current) {
      usePipStore.getState().showPeek(beat.move, beat.line);
    } else {
      usePipStore.getState().react(beat.move, { loops, line: beat.line });
    }
  }).current;

  useEffect(() => {
    setSuspended(readerOpen);
  }, [readerOpen, setSuspended]);

  // Goal met by the reading heartbeat: usually mid-book, so usually a peek.
  const previousMet = useRef<boolean | null>(null);
  useEffect(() => {
    if (snapshot === EMPTY_SNAPSHOT) {
      return;
    }
    const previous = previousMet.current;
    previousMet.current = snapshot.todayMet;
    if (previous === false && snapshot.todayMet && !useHabitStore.getState().wrapUp) {
      celebrate(goalBeat(snapshot.streak, getDateKey()));
    }
  }, [snapshot, celebrate]);

  useEffect(() => {
    if (pendingBreak) {
      // A break that gives her a cold (the same snapshot says so) is said with a sneeze, not a comeback speech.
      const beat = pickBeat(useHabitStore.getState().snapshot.cold ? "streakLostCold" : "streakLost", pendingBreak.brokeFrom);
      react(beat.move, { loops: 1, line: beat.line });
    }
  }, [pendingBreak, react]);

  // A session starting gets a warm-up before Pip settles in to read.
  const hadSession = useRef<boolean | null>(null);
  useEffect(() => {
    const running = Boolean(activeSession);
    const had = hadSession.current;
    hadSession.current = running;
    if (had === false && running && activeSession) {
      const beat = pickBeat("sessionStart", activeSession.startedAt);
      react(beat.move, { loops: 1, line: beat.line });
    }
  }, [activeSession, react]);

  // Finished books, and books arriving in the library. The first list after
  // the initial load is the baseline, not a pile of "new" books.
  const progressById = useRef<Map<string, number> | null>(null);
  const sawLoad = useRef(false);
  useEffect(() => {
    if (booksLoading) {
      sawLoad.current = true;
      return;
    }
    if (!sawLoad.current) {
      return;
    }
    const previous = progressById.current;
    progressById.current = new Map(books.map((book) => [book.id, book.progress ?? 0]));
    if (!previous) {
      return;
    }
    const finished = books.find((book) => {
      const before = previous.get(book.id);
      return before !== undefined && !isFinished(before) && isFinished(book.progress);
    });
    if (finished) {
      celebrate(pickBeat("bookFinished", finished.id));
      return;
    }
    const added = books.filter((book) => !previous.has(book.id)).length;
    if (added > 0) {
      const beat = pickBeat("imported", added, { count: added });
      react(beat.move, { loops: 1, line: beat.line });
    }
  }, [books, booksLoading, celebrate, react]);

  // Once per launch: back after a few days away, and nothing read yet today.
  const welcomed = useRef(false);
  useEffect(() => {
    if (welcomed.current || snapshot === EMPTY_SNAPSHOT) {
      return;
    }
    welcomed.current = true;
    const today = getDateKey();
    const lastRead = snapshot.days
      .filter((day) => day.minutes >= 1 && day.dateKey < today)
      .map((day) => day.dateKey)
      .sort()
      .pop();
    const away = lastRead ? daysBetween(lastRead, today) : 0;
    if (lastRead && snapshot.todayMinutes < 1 && away >= WELCOME_BACK_DAYS) {
      const beat = pickBeat("welcomeBack", today, { days: away });
      react(beat.move, { loops: 2, line: beat.line });
    }
  }, [snapshot, react]);

  return { celebrate, showPeek };
};
