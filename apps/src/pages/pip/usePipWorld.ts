import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Book } from "@shared/models/book";
import type { World } from "../../pip/behaviour";
import { worldOfBooks } from "../../pip/readingMoments";
import { watchWorldStub, worldStub } from "../../pip/worldStub";
import { useVisitorStore } from "../../pip/useVisitors";
import { useExpedition } from "../../components/pip/album";
import { useHabitStore } from "../../store/habitStore";
import { CURED_LINES } from "../../pip/cold";
import { cuePip } from "../../pip/life";

/** The cold she was last seen with on the Pip tab (the day it began), for the moment it is found cured. Kept for this run of the app only. */
let coldSeen: string | null = null;

/** How often the world is looked at again while the tab stays open: a book read an hour ago is not read "just now" for ever. */
const LOOK_EVERY_MS = 5 * 60_000;

/**
 * What Pip knows of the world outside her room, gathered in one place for
 * the house scene to hand to the planner (pip/behaviour.ts, `World`):
 *
 * - from the library: the book last opened and its mood, a book just
 *   finished, a book left too long (pip/readingMoments.ts);
 * - from the focus session: whether she is out on an expedition, and what she
 *   has brought back and not yet shown (components/pip/album, `useExpedition`);
 * - from the visitors' layer: where a visiting Pip stands (pip/useVisitors.ts);
 * - from the habit snapshot: her cold, while she has one (`snapshot.cold`,
 *   worked out in Rust from the ledger), and the moment the reader's reading
 *   has cured it, which she says once.
 *
 * Everything here is worked out from what the app already keeps; nothing is
 * stored. `markSeen` is the expedition's: the scene calls it once she has
 * shown a find.
 */
export const usePipWorld = ({ books }: { books: readonly Book[] }): { world: World; markSeen: (key: string) => void } => {
  // The clock, coarsely: what is "recent" moves on while the reader watches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), LOOK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);
  const { away, back, markSeen } = useExpedition();
  const standing = useVisitorStore((state) => state.standing);
  const handle = useVisitorStore((state) => state.visit?.visitor.handle);
  const visitor = useMemo(() => (standing ? { x: standing.x, w: standing.w, handle } : null), [standing, handle]);
  const cold = useHabitStore((state) => state.snapshot.cold);
  const todayMet = useHabitStore((state) => state.snapshot.todayMet);
  // Seen with a cold, and now without one on a day whose goal is met: the reading cured it, and she says so, once.
  // (A cold that passed by itself goes without a word.)
  useEffect(() => {
    if (cold) {
      coldSeen = cold.since;
      return;
    }
    const was = coldSeen;
    coldSeen = null;
    if (was && todayMet) cuePip({ move: "cheer", loops: 2, line: CURED_LINES[Math.floor(Math.random() * CURED_LINES.length)], houseOnly: true });
  }, [cold, todayMet]);
  // Set by hand (the preview, the tests): laid over the rest, field by field.
  const stub = useSyncExternalStore(watchWorldStub, worldStub);
  const world = useMemo<World>(
    () => ({ ...worldOfBooks(books, now), away: away ? { note: away.note } : null, back, visitor, cold, ...stub }),
    [books, now, away, back, visitor, cold, stub]
  );
  return { world, markSeen };
};
