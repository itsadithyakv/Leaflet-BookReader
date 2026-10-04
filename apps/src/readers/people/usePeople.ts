import { useCallback, useEffect, useRef, useState } from "react";
import { peopleService } from "../../services/peopleService";
import { useLibraryStore } from "../../store/libraryStore";
import { applied, type Change } from "./edits";
import type { MentionSearch } from "./bookText";
import type { MentionSummary } from "./mentions";
import type { Entry, Place } from "./model";
import type { NameEntry } from "./names";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * A book's character sheet, kept in the database (and so in the backup).
 * Changes schedule a backup, like a new highlight does. With the feature
 * switched off nothing is read at all.
 */
export const usePeople = (bookId: string, enabled: boolean) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);
  const requestBackup = useLibraryStore((state) => state.requestBackup);

  useEffect(() => {
    setEntries([]);
    setReady(false);
    if (!enabled) {
      return;
    }
    let live = true;
    peopleService
      .list(bookId)
      .catch(() => [] as Entry[])
      .then((loaded) => {
        if (live) {
          setEntries(loaded);
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [bookId, enabled]);

  /** Saves a change. False when it could not be saved (the sheet is then as it was). */
  const commit = useCallback(
    async (change: Change): Promise<boolean> => {
      if (change.save.length === 0 && change.remove.length === 0) {
        return true;
      }
      try {
        const saved = await peopleService.save(change.save);
        await peopleService.remove(change.remove);
        setEntries((current) => applied(current, saved, change.remove));
        requestBackup();
        return true;
      } catch {
        return false;
      }
    },
    [requestBackup]
  );

  return { entries, ready, commit };
};

export type MentionsState =
  | { status: "searching"; summary: MentionSummary | null }
  | { status: "done"; summary: MentionSummary }
  /** The place being read cannot be told, so nothing can safely be shown. */
  | { status: "unknown"; summary: null };

/**
 * Where names were mentioned up to `place`, found a chapter at a time while
 * the card is open, and dropped when it closes or asks about someone else.
 */
export const useMentions = (
  search: MentionSearch | null,
  names: NameEntry[] | null,
  person: string | null,
  place: Place
): MentionsState => {
  const [state, setState] = useState<MentionsState>({ status: "searching", summary: null });
  // The names as one string: a new list with the same names is the same question.
  const key = names ? `${person ?? ""}|${names.map((name) => `${name.text}>${name.person}`).join("|")}` : null;
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    const asked = namesRef.current;
    if (!search || !asked || asked.length === 0) {
      setState({ status: "unknown", summary: null });
      return;
    }
    const stop = new AbortController();
    setState({ status: "searching", summary: null });
    search
      .find(asked, person, place, {
        signal: stop.signal,
        onProgress: (summary) => {
          if (!stop.signal.aborted) {
            setState({ status: "searching", summary });
          }
        }
      })
      .then(
        (summary) => {
          if (!stop.signal.aborted) {
            setState(summary ? { status: "done", summary } : { status: "unknown", summary: null });
          }
        },
        () => {
          if (!stop.signal.aborted) {
            setState({ status: "unknown", summary: null });
          }
        }
      );
    return () => stop.abort();
    // `place` is the card's own, fixed while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, key, person, place.cfi, place.progress]);

  return state;
};
