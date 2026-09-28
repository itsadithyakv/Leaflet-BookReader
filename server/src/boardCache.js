/**
 * The public weekly board, kept for a short while.
 *
 * It is the one query that is the same for every reader, and every open
 * Social page asks for it, so it is served from memory instead of sorting
 * profiles on each request. Any change to a profile clears it, so a reader
 * never sees a stale version of their own row; the time limit only bounds how
 * long an idle entry lingers. At most a few weeks of 100 rows each: a few
 * hundred kilobytes at worst.
 */

const TTL_MS = 30_000;
const MAX_WEEKS = 4;
const boards = new Map();

/** The cached rows for a week, or null. */
export function cachedBoard(weekKey) {
  const entry = boards.get(weekKey);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    boards.delete(weekKey);
    return null;
  }
  return entry.rows;
}

export function rememberBoard(weekKey, rows) {
  if (boards.size >= MAX_WEEKS) {
    boards.clear();
  }
  boards.set(weekKey, { at: Date.now(), rows });
}

/** A profile changed (minutes, name, avatar, visibility, or it was deleted). */
export function forgetBoards() {
  boards.clear();
}
