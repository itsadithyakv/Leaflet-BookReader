import { communities, posts, replies, reports, threads } from "./db.js";

/**
 * Reports, and what they do by themselves before an admin has looked.
 *
 * A report is one reader saying one thing is not all right. The unique index
 * allows one per reader per thing, so "three reports" is three readers, and
 * each of them had to share a profile, hold an account a few days old and
 * not be suspended to make it.
 *
 * Every report is recorded, and the admin sees them all. But only some
 * count towards the numbers below (`counts` on the report, settled when it
 * is made): those from a reader whose email address is confirmed, and whose
 * reports have not kept turning out to be wrong. Otherwise three accounts
 * made for the purpose could hide anything they liked until the owner woke
 * up. A reader is discredited when five or more of their reports were
 * dismissed (the thing was left standing, or restored) in the last ninety
 * days and not one was upheld (the thing was removed); one upheld report, or
 * the old ones ageing out, and they count again.
 *
 * Enough of them act at once, because the owner is one person and asleep
 * some of the time:
 *   a post, thread or reply   3 readers: hidden from everyone but its author;
 *   a community               5 readers: taken out of the directory;
 *   a thread or post, as a spoiler
 *                             2 readers: marked as spoiling the whole book,
 *                             which is the cure for that complaint, so those
 *                             reports do not count towards hiding it.
 * A report about a profile changes nothing by itself: what a person is like
 * is for a person to judge.
 *
 * All of it is undone or confirmed by an admin (`routes/moderation.js`), and
 * once an admin has looked at a thing and let it stand (`clearedAt`), further
 * reports are still recorded for them but no longer act on their own, so the
 * same few accounts cannot keep hiding what has already been judged.
 */

export const HIDE_AT = 3;
export const UNLIST_AT = 5;
export const SPOILER_AT = 2;
/** Dismissed reports, with none upheld, after which a reader's reports stop counting. */
export const DISCREDITED_AT = 5;
const DISCREDIT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The whole book, or the whole series: what a thread reported as a spoiler is marked as. */
export const WHOLE = { book: { percent: 100 }, series: { book: 99 } };

export const REPORT_TARGETS = ["post", "thread", "reply", "community", "profile"];
export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "spoiler", "other"];

const HOME = { post: posts, thread: threads, reply: replies, community: communities };

/**
 * Whether a reader's reports have stopped counting: five or more dismissed
 * in the last ninety days, and none upheld. (Settled reports are kept 180
 * days, so the ninety are always there to count.)
 */
export async function isDiscredited(db, reporterId, now = new Date()) {
  const recent = { reporterId, resolvedAt: { $gte: new Date(now.getTime() - DISCREDIT_DAYS * DAY_MS) } };
  const [dismissed, upheld] = await Promise.all([
    reports(db).countDocuments({ ...recent, resolution: { $in: ["dismiss", "restore"] } }),
    reports(db).countDocuments({ ...recent, resolution: "remove" })
  ]);
  return dismissed >= DISCREDITED_AT && upheld === 0;
}

/** Applies what the open reports that count on one thing now call for. Called after each new report. */
export async function afterReport(db, target, targetId, now = new Date()) {
  const home = HOME[target]?.(db);
  if (!home) {
    return; // a profile
  }
  const [thing, open] = await Promise.all([
    home.findOne({ _id: targetId }, { projection: { clearedAt: 1, hiddenAt: 1, unlistedAt: 1, communityId: 1 } }),
    reports(db)
      .find({ target, targetId, resolvedAt: null, counts: true }, { projection: { reason: 1 }, limit: 100 })
      .toArray()
  ]);
  if (!thing) {
    return;
  }
  if (target === "community") {
    const update = { reportCount: open.length };
    if (open.length >= UNLIST_AT && !thing.unlistedAt && !thing.clearedAt) {
      update.unlistedAt = now;
    }
    await home.updateOne({ _id: targetId }, { $set: update });
    return;
  }
  if (thing.clearedAt) {
    return;
  }
  // A reply has no spoiler mark to widen, so there every report counts alike.
  const marks = target !== "reply";
  const spoilers = marks ? open.filter((report) => report.reason === "spoiler").length : 0;
  const update = {};
  if (spoilers >= SPOILER_AT) {
    if (target === "post") {
      update.spoiler = true;
    } else {
      const community = await communities(db).findOne({ _id: thing.communityId }, { projection: { kind: 1 } });
      update.spoiler = WHOLE[community?.kind] ?? WHOLE.book;
    }
    update.spoilerBy = "reports";
  }
  if (open.length - spoilers >= HIDE_AT && !thing.hiddenAt) {
    update.hiddenAt = now;
    update.hiddenBy = "reports";
  }
  if (Object.keys(update).length > 0) {
    await home.updateOne({ _id: targetId }, { $set: update });
  }
}

/**
 * Closes the open reports on these things: an admin dealt with them, or the
 * thing itself is gone (`resolution: "deleted"`). Closed, not deleted: they
 * stay half a year as the record of what was said, then expire.
 */
export async function closeReports(db, target, ids, resolution, now = new Date()) {
  if (ids.length === 0) {
    return 0;
  }
  const { modifiedCount } = await reports(db).updateMany(
    { target, targetId: { $in: ids }, resolvedAt: null },
    { $set: { resolvedAt: now, resolution } }
  );
  return modifiedCount;
}
