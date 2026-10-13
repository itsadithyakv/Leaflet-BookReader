import { tallies } from "./db.js";
import { HttpError } from "./http.js";

/**
 * Daily allowances: so many posts, quotes, threads, replies, reports,
 * communities started and members removed per reader per UTC day.
 *
 * Counted here, in a row per reader, kind and day, and not by counting the
 * things themselves. Counting the things let a reader post their twenty,
 * delete them, and post twenty more, each batch on every feed for as long as
 * it stood; a count that only goes up cannot be refilled that way. The row
 * expires a few days after its day, since nothing asks about it again.
 *
 * Taking one is a single update that only goes through while there is room,
 * so requests sent at the same moment cannot each see the last place free.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after its day a count is kept. Only ever read on the day itself. */
const KEPT_DAYS = 3;

const dayStart = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
/** The UTC day a moment falls in, like `2026-09-27`. */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/** A 429 for an allowance that is used up, good again at midnight UTC. */
const usedUp = (message, now) =>
  new HttpError(429, message, { retryAfter: Math.max(1, Math.ceil((dayStart(now) + DAY_MS - now.getTime()) / 1000)) });

/**
 * Takes one of today's `limit` of a kind for a reader, or refuses with a 429
 * that says `message`.
 *
 * With the count at its limit the update matches nothing and tries to insert
 * a second row for the same reader, kind and day, which the unique index
 * refuses: that refusal is the limit.
 */
export async function spend(db, userId, kind, limit, message, now = new Date()) {
  const take = () =>
    tallies(db).updateOne(
      { userId, kind, day: utcDay(now), count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(dayStart(now) + (KEPT_DAYS + 1) * DAY_MS) } },
      { upsert: true }
    );
  try {
    // (Tried twice: the day's first two, sent at the same moment, both try to
    // insert the row, and the one refused then finds it there.)
    await take().catch((error) => (error?.code === 11000 ? take() : Promise.reject(error)));
  } catch (error) {
    if (error?.code === 11000) {
      throw usedUp(message, now);
    }
    throw error;
  }
}

/**
 * Hands one back, for when what it was taken for did not happen after all
 * (another limit refused it, or the insert failed). Never for a deletion.
 */
export const giveBack = (db, userId, kind, now = new Date()) =>
  tallies(db).updateOne({ userId, kind, day: utcDay(now), count: { $gt: 0 } }, { $inc: { count: -1 } });
