import { follows, profiles } from "./db.js";

/**
 * How many readers follow a reader, and how many they follow, kept on the
 * profile (`followerCount`, `followingCount`) so that showing a profile does
 * not count the `follows` collection. Every follow made or removed goes
 * through here, so the two numbers move with it:
 *
 *   - a follow is counted only when the upsert made it (`upsertedCount`), so
 *     following again, or two requests at once, count it once;
 *   - an unfollow only when the delete removed one (`deletedCount`).
 *
 * A follow row that goes some other way (a test writing to the database, a
 * server from before 1.5.15 running for a while) leaves the counts behind;
 * `backfillFollowCounts` sets them from the rows again.
 *
 * The counts are never upserted: a reader without a profile is not given one.
 * A count can be read below zero only after such drift, so readers of it
 * clamp (`countOf`).
 */

/** A stored count as shown: a whole number, never below nothing. */
export const countOf = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** The two `$inc`s for one follow made (+1) or removed (-1). */
async function moveCounts(db, followerId, followeeId, by) {
  await profiles(db).bulkWrite(
    [
      { updateOne: { filter: { _id: followeeId }, update: { $inc: { followerCount: by } } } },
      { updateOne: { filter: { _id: followerId }, update: { $inc: { followingCount: by } } } }
    ],
    { ordered: false }
  );
}

/**
 * Makes the follow if it is not there, and counts it if this call made it.
 * Says whether it did.
 */
export async function addFollow(db, followerId, followeeId, now = new Date()) {
  const { upsertedCount } = await follows(db).updateOne(
    { followerId, followeeId },
    { $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  if (upsertedCount) {
    await moveCounts(db, followerId, followeeId, 1);
  }
  return upsertedCount > 0;
}

/** Removes the follow if it is there, and counts it down if this call removed it. */
export async function removeFollow(db, followerId, followeeId) {
  const { deletedCount } = await follows(db).deleteOne({ followerId, followeeId });
  if (deletedCount) {
    await moveCounts(db, followerId, followeeId, -1);
  }
  return deletedCount > 0;
}

/**
 * Counts follows already written in bulk (`acceptAllRequests`): `followeeId`
 * gained `followerIds.length` followers, each of whom follows one more.
 */
export async function countBulkFollows(db, followerIds, followeeId) {
  if (followerIds.length === 0) {
    return;
  }
  await profiles(db).bulkWrite(
    [
      { updateOne: { filter: { _id: followeeId }, update: { $inc: { followerCount: followerIds.length } } } },
      { updateMany: { filter: { _id: { $in: followerIds } }, update: { $inc: { followingCount: 1 } } } }
    ],
    { ordered: false }
  );
}

/**
 * Removes every follow to and from `userId` (their account or profile is
 * going), a thousand rows at a time, and counts each one down on the other
 * side: whom they followed loses a follower, who followed them follows one
 * fewer. Their own counts go with their profile.
 */
export async function removeFollowsOf(db, userId) {
  for (const [mine, theirs, field] of [
    ["followerId", "followeeId", "followerCount"],
    ["followeeId", "followerId", "followingCount"]
  ]) {
    for (;;) {
      const rows = await follows(db)
        .find({ [mine]: userId }, { projection: { _id: 1, [theirs]: 1 }, limit: 1000 })
        .toArray();
      if (rows.length === 0) {
        break;
      }
      await follows(db).deleteMany({ _id: { $in: rows.map((row) => row._id) } });
      await profiles(db).updateMany({ _id: { $in: rows.map((row) => row[theirs]) } }, { $inc: { [field]: -1 } });
    }
  }
}

/**
 * Sets every profile's two counts from the `follows` rows: once, the first
 * time a 1.5.15 server starts (`backfillPeople`), and again whenever its
 * marker is removed by hand. Profiles counted before and with no follows now
 * are set back to 0; the rest are written a thousand at a time.
 */
export async function backfillFollowCounts(db) {
  await profiles(db).updateMany(
    { $or: [{ followerCount: { $ne: 0, $exists: true } }, { followingCount: { $ne: 0, $exists: true } }] },
    { $set: { followerCount: 0, followingCount: 0 } }
  );
  let written = 0;
  for (const [key, field] of [
    ["$followeeId", "followerCount"],
    ["$followerId", "followingCount"]
  ]) {
    const counts = await follows(db)
      .aggregate([{ $group: { _id: key, count: { $sum: 1 } } }])
      .toArray();
    for (let at = 0; at < counts.length; at += 1000) {
      const batch = counts.slice(at, at + 1000);
      await profiles(db).bulkWrite(
        batch.map((row) => ({ updateOne: { filter: { _id: row._id }, update: { $set: { [field]: row.count } } } })),
        { ordered: false }
      );
      written += batch.length;
    }
  }
  return written;
}
