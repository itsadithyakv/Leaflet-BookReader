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
/** How many times a profile has changed. See `boardStamp`. */
let changes = 0;

/**
 * The cached board for a week, or null: its rows, and how many readers share a
 * profile at all (which is what tells an empty board "nobody has read yet this
 * week" from "nobody is sharing yet").
 */
export function cachedBoard(weekKey) {
  const entry = boards.get(weekKey);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    boards.delete(weekKey);
    return null;
  }
  return { rows: entry.rows, sharedReaders: entry.sharedReaders };
}

/**
 * Taken before a board is read from the database, and handed back to
 * `rememberBoard` with the rows.
 *
 * Reading takes a moment, and a profile can change in it. A reader who made
 * their profile private while a board was being read was cleared from the
 * cache and then put straight back by that read, and stayed on the public
 * board for another half a minute.
 */
export function boardStamp() {
  return changes;
}

export function rememberBoard(weekKey, rows, sharedReaders, stamp = changes) {
  // A profile changed since these rows were read: they may be out of date,
  // so this request is answered with them and they are not kept.
  if (stamp !== changes) {
    return;
  }
  if (boards.size >= MAX_WEEKS) {
    boards.clear();
  }
  boards.set(weekKey, { at: Date.now(), rows, sharedReaders });
}

/** A profile changed (minutes, name, avatar, visibility, or it was deleted). */
export function forgetBoards() {
  changes += 1;
  boards.clear();
}
