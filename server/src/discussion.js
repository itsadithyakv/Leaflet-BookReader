import { communities, posts, replies, threads } from "./db.js";
import { deleteReactionsOn } from "./reactions.js";
import { closeReports } from "./reports.js";

/**
 * Taking public writing back out: posts, threads, replies and communities,
 * with everything that hangs off each. Shared by the routes that delete one
 * thing, by an admin's "remove", and by account deletion, so that whichever
 * way a thing goes, its reactions go with it, its reports are closed, and the
 * counts kept beside it (`replyCount`, `threadCount`) stay true.
 */

/** Deletes the posts matching `filter`, their reactions, and closes their reports. */
export async function deletePosts(db, filter) {
  const ids = (await posts(db).find(filter, { projection: { _id: 1 } }).toArray()).map((post) => post._id);
  if (ids.length === 0) {
    return 0;
  }
  await Promise.all([
    posts(db).deleteMany({ _id: { $in: ids } }),
    deleteReactionsOn(db, "post", ids),
    closeReports(db, "post", ids, "deleted")
  ]);
  return ids.length;
}

/** `{ updateOne }` operations that count `field` down by how many of `rows` point at each parent. */
function countDown(rows, parent, field) {
  const gone = new Map();
  for (const row of rows) {
    const key = row[parent].toHexString();
    gone.set(key, { id: row[parent], count: (gone.get(key)?.count ?? 0) + 1 });
  }
  return [...gone.values()].map(({ id, count }) => ({
    updateOne: { filter: { _id: id }, update: { $inc: { [field]: -count } } }
  }));
}

/** Deletes the replies matching `filter`; each thread's `replyCount` goes down by its share. */
export async function deleteReplies(db, filter) {
  const rows = await replies(db).find(filter, { projection: { _id: 1, threadId: 1 } }).toArray();
  if (rows.length === 0) {
    return 0;
  }
  const ids = rows.map((reply) => reply._id);
  await Promise.all([
    replies(db).deleteMany({ _id: { $in: ids } }),
    deleteReactionsOn(db, "reply", ids),
    closeReports(db, "reply", ids, "deleted"),
    threads(db).bulkWrite(countDown(rows, "threadId", "replyCount"), { ordered: false })
  ]);
  return ids.length;
}

/**
 * Deletes the threads matching `filter` with all their replies; each
 * community's `threadCount` goes down by its share, and a community left
 * with no members and no threads is deleted (see `leaveCommunities`).
 */
export async function deleteThreads(db, filter) {
  const rows = await threads(db).find(filter, { projection: { _id: 1, communityId: 1 } }).toArray();
  if (rows.length === 0) {
    return 0;
  }
  const ids = rows.map((thread) => thread._id);
  const under = (await replies(db).find({ threadId: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((reply) => reply._id);
  await Promise.all([
    threads(db).deleteMany({ _id: { $in: ids } }),
    replies(db).deleteMany({ _id: { $in: under } }),
    deleteReactionsOn(db, "thread", ids),
    deleteReactionsOn(db, "reply", under),
    closeReports(db, "thread", ids, "deleted"),
    closeReports(db, "reply", under, "deleted")
  ]);
  await communities(db).bulkWrite(countDown(rows, "communityId", "threadCount"), { ordered: false });
  await dropEmpty(db, rows.map((thread) => thread.communityId));
  return ids.length;
}

/** Deletes a community with its threads and replies. */
export async function deleteCommunity(db, id) {
  await deleteThreads(db, { communityId: id });
  await Promise.all([communities(db).deleteOne({ _id: id }), closeReports(db, "community", [id], "deleted")]);
}

/** A community nobody is in and nothing was said in has no reason to be there. */
const dropEmpty = (db, ids) =>
  communities(db).deleteMany({ _id: { $in: ids }, memberCount: { $lte: 0 }, threadCount: { $lte: 0 } });

/**
 * Takes a reader out of communities: the ones given, or every one they are
 * in. Returns how many they were actually in.
 *
 * The members are kept in the order they joined. When the keeper leaves, the
 * community goes to whoever has been in it longest. When the last member
 * leaves, a community with no threads is deleted; one with threads is kept
 * with no keeper (its discussion is other readers' writing, not the
 * leaver's to take away), and the next reader to join may become its keeper.
 * One update each, so two leaving at the same moment cannot leave a keeper
 * who is gone.
 */
export async function leaveCommunities(db, userId, communityIds = null) {
  const ids =
    communityIds ??
    (await communities(db).find({ memberIds: userId }, { projection: { _id: 1 } }).toArray()).map((community) => community._id);
  if (ids.length === 0) {
    return 0;
  }
  const { modifiedCount } = await communities(db).updateMany({ _id: { $in: ids }, memberIds: userId }, [
    { $set: { memberIds: { $filter: { input: "$memberIds", cond: { $ne: ["$$this", userId] } } } } },
    // Reads the list as the stage above left it: without the one leaving.
    {
      $set: {
        memberCount: { $size: "$memberIds" },
        keeperId: {
          $cond: [{ $eq: ["$keeperId", userId] }, { $ifNull: [{ $arrayElemAt: ["$memberIds", 0] }, null] }, "$keeperId"]
        }
      }
    }
  ]);
  await dropEmpty(db, ids);
  return modifiedCount;
}

/**
 * What an account leaves behind in the communities when it is deleted.
 *
 * Their replies go. Their threads go too where nobody else replied; a thread
 * others replied to is kept, with no author ("a reader who left"), because
 * deleting it would delete those other readers' replies with it. They leave
 * every community (the keeper's place is handed on), and are taken off the
 * lists of readers removed from one.
 */
export async function forgetAuthor(db, userId) {
  await deleteReplies(db, { authorId: userId });
  const mine = (await threads(db).find({ authorId: userId }, { projection: { _id: 1 } }).toArray()).map((thread) => thread._id);
  if (mine.length > 0) {
    // Their own replies are gone by now, so any reply left is somebody else's.
    const answered = await replies(db).distinct("threadId", { threadId: { $in: mine } });
    const keep = new Set(answered.map((id) => id.toHexString()));
    await deleteThreads(db, { _id: { $in: mine.filter((id) => !keep.has(id.toHexString())) } });
    await threads(db).updateMany({ _id: { $in: answered } }, { $set: { authorId: null } });
  }
  await leaveCommunities(db, userId);
  await communities(db).updateMany({ bannedIds: userId }, { $pull: { bannedIds: userId } });
}

/**
 * Everything a reader posted, for when their account or profile goes. (Not
 * the counts of what they posted, `tallies` and `quoteTallies`: deleting a
 * profile and making another must not refill an allowance. Those go with the
 * account: `routes/account.js`.)
 */
export async function forgetPosts(db, userId) {
  await deletePosts(db, { userId });
}
