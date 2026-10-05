import { useMemo, useSyncExternalStore } from "react";
import { sessionElapsedMs, useHabitStore } from "../../../store/habitStore";
import { AWAY_NOTE, showLine, tripNow, type Found, type Place } from "../../../pip/expedition";
import { renderFind } from "../../../pip/expedition-art.js";
import { useAlbum } from "./useAlbum";

/**
 * The session whose find Pip last came in with, so she shows each find once.
 * This device's own note (localStorage, outside the backup): the finds
 * themselves are worked out from the shelf and need no record. Forgotten by
 * Delete All Data (services/deviceData.ts).
 */
const SEEN_KEY = "leaflet.pip.findSeen";

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

let seen = readSeen();
const watchers = new Set<() => void>();
const watch = (onChange: () => void) => {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
};

/** The house has shown the find from this session: she will not come in with it again. */
export const markFindSeen = (sessionId: string) => {
  if (seen === sessionId) {
    return;
  }
  seen = sessionId;
  try {
    localStorage.setItem(SEEN_KEY, sessionId);
  } catch {
    // She shows it again next time; harmless.
  }
  watchers.forEach((notify) => notify());
};

/** What the house scene is given while she is out. */
export type PipAway = {
  /** What the note she leaves says. */
  note: string;
  /** How far she has got on the minutes read so far; null while still short of the gate. */
  place: Place | null;
};

/** What the house scene is given when she is back with something to show. */
export type PipBack = {
  /** The session it came from: hand it to `markSeen` once she has shown it. */
  key: string;
  /** "a smooth stone". */
  name: string;
  /** The thing, 12 x 12, to hold up. */
  image: ImageData;
  /** What she says, short enough for her bubble. */
  line: string;
  /** The find itself, for anything more (its rarity, her longer line for the album). */
  found: Found;
};

/**
 * Pip's trips, for the house: `away` while a focus session runs, `back` when
 * the newest find has not been shown yet (and is still news), and `markSeen`
 * to say it has been. Both are null most of the time.
 */
export const useExpedition = (): { away: PipAway | null; back: PipBack | null; markSeen: (key: string) => void } => {
  const running = useHabitStore((state) => state.activeSession);
  const album = useAlbum();
  const seenId = useSyncExternalStore(watch, () => seen);
  const trip = tripNow({ running, readMs: running ? sessionElapsedMs(running) : 0, album, seen: seenId, now: Date.now() });

  // The same objects until what they say changes, so the scene is not handed a new prop at every heartbeat.
  const out = Boolean(trip.away);
  const place = trip.away?.place ?? null;
  const away = useMemo<PipAway | null>(() => (out ? { note: AWAY_NOTE, place } : null), [out, place]);
  const found = trip.back;
  const key = found?.sessionId ?? null;
  const back = useMemo<PipBack | null>(
    () =>
      found
        ? { key: found.sessionId, name: found.find.name, image: renderFind(found.find.id, 0), line: showLine(found.find), found }
        : null,
    // The session says it all: a find never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  return { away, back, markSeen: markFindSeen };
};
