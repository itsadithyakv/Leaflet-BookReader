import { useEffect, useRef, useState } from "react";
import { useLibraryStore } from "../store/libraryStore";
import { syncConfigured } from "../services/syncTiming";

/**
 * "Sync now", in both readers' ··· menus: sends the place read here and
 * takes the others', without leaving the book (2026-10-25: the owner wanted
 * a way to make sure the phone's place had gone up before picking up the
 * laptop). The menu stays open, so its answer can be seen: "Syncing…", then
 * "Synced" for a moment, or "Try again". Not offered where there is nowhere
 * to sync to, where it could only fail.
 */
export const SyncPlaceRow = () => {
  const configured = useLibraryStore((state) => syncConfigured(state.sync));
  const status = useLibraryStore((state) => state.syncStatus);
  const [done, setDone] = useState(false);
  const shown = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (shown.current !== null) window.clearTimeout(shown.current);
    },
    []
  );

  if (!configured) return null;
  const syncing = status === "syncing";
  const failed = status === "error" && !syncing;
  const answer = syncing ? "Syncing…" : done ? "Synced" : failed ? "Try again" : null;

  const run = () => {
    if (syncing) return;
    setDone(false);
    void useLibraryStore
      .getState()
      .syncNow({ manual: true })
      .then(() => {
        setDone(true);
        if (shown.current !== null) window.clearTimeout(shown.current);
        shown.current = window.setTimeout(() => setDone(false), 2500);
      })
      .catch(() => {
        // The failure is in `syncStatus`/`syncError`, and the row says "Try again".
      });
  };

  return (
    <button
      type="button"
      className="mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition reader-border reader-pill reader-icon"
      onClick={run}
      aria-busy={syncing || undefined}
    >
      <span>Sync now</span>
      {answer && <span className="normal-case tracking-normal reader-muted" role="status">{answer}</span>}
    </button>
  );
};
