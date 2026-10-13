import { posts, reactions, replies, threads } from "./db.js";
import { HttpError } from "./http.js";

/**
 * Likes and dislikes on posts, threads and replies.
 *
 * One row per reader per thing (the unique index makes a second impossible),
 * and the totals kept on the thing itself: `likes`, `dislikes`, and `score`
 * (likes less dislikes, which is what "top" sorts by). The totals move by the
 * difference between what the reader had said and what they say now, so
 * changing a like to a dislike takes one off one count and adds one to the
 * other, and saying the same thing twice changes nothing.
 */

/** Where each kind of thing lives. */
const HOME = { post: posts, thread: threads, reply: replies };

/** 1 to like, -1 to dislike, 0 to take either back. */
export function reactionValue(value) {
  if (value !== 1 && value !== -1 && value !== 0) {
    throw new HttpError(400, "value is 1 (like), -1 (dislike) or 0 (neither).");
  }
  return value;
}

/** Sets `userId`'s reaction to one thing, and answers with the totals as they now stand. */
export async function react(db, target, targetId, userId, value) {
  const key = { target, targetId, userId };
  let before = null;
  if (value === 0) {
    before = await reactions(db).findOneAndDelete(key);
  } else {
    const set = () =>
      reactions(db).findOneAndUpdate(
        key,
        { $set: { value }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, returnDocument: "before" }
      );
    // Two taps at the same moment can both try to insert the first row; the
    // index refuses one, which then finds the other's and changes it.
    before = await set().catch((error) => (error?.code === 11000 ? set() : Promise.reject(error)));
  }
  const was = before?.value ?? 0;
  const change = {
    likes: (value === 1 ? 1 : 0) - (was === 1 ? 1 : 0),
    dislikes: (value === -1 ? 1 : 0) - (was === -1 ? 1 : 0),
    score: value - was
  };
  const home = HOME[target](db);
  const totals =
    value === was
      ? await home.findOne({ _id: targetId }, { projection: { likes: 1, dislikes: 1 } })
      : await home.findOneAndUpdate({ _id: targetId }, { $inc: change }, { returnDocument: "after", projection: { likes: 1, dislikes: 1 } });
  if (!totals) {
    // Deleted while this was on its way: nothing left to have an opinion of.
    await reactions(db).deleteOne(key);
    throw new HttpError(404, "That is no longer there.");
  }
  return { likes: Math.max(0, totals.likes ?? 0), dislikes: Math.max(0, totals.dislikes ?? 0), myReaction: value };
}

/** What `userId` said of each of these things: hex id → 1 or -1 (absent for neither). */
export async function myReactions(db, target, ids, userId) {
  if (!userId || ids.length === 0) {
    return new Map();
  }
  const rows = await reactions(db)
    .find({ target, targetId: { $in: ids }, userId }, { projection: { targetId: 1, value: 1 } })
    .toArray();
  return new Map(rows.map((row) => [row.targetId.toHexString(), row.value]));
}

/** The totals and the asker's own reaction, as every view carries them. */
export const reactionView = (doc, mine) => ({
  likes: Math.max(0, doc.likes ?? 0),
  dislikes: Math.max(0, doc.dislikes ?? 0),
  myReaction: mine.get(doc._id.toHexString()) ?? 0
});

/** The reactions to things that are being deleted go with them. */
export async function deleteReactionsOn(db, target, ids) {
  if (ids.length > 0) {
    await reactions(db).deleteMany({ target, targetId: { $in: ids } });
  }
}

/**
 * Takes back every reaction a reader ever made, for when their account goes.
 *
 * The totals are counted down by exactly what each reaction had added (not
 * recounted): one `$inc` per reaction, a thousand to a batch, so a reader who
 * liked ten thousand things does not need them all in memory, and a thing
 * deleted meanwhile is simply not there to be changed.
 */
export async function removeReactionsBy(db, userId) {
  for (;;) {
    const rows = await reactions(db).find({ userId }, { limit: 1000 }).toArray();
    if (rows.length === 0) {
      return;
    }
    for (const target of Object.keys(HOME)) {
      const changes = rows
        .filter((row) => row.target === target)
        .map((row) => ({
          updateOne: {
            filter: { _id: row.targetId },
            update: { $inc: { likes: row.value === 1 ? -1 : 0, dislikes: row.value === -1 ? -1 : 0, score: -row.value } }
          }
        }));
      if (changes.length > 0) {
        await HOME[target](db).bulkWrite(changes, { ordered: false });
      }
    }
    await reactions(db).deleteMany({ _id: { $in: rows.map((row) => row._id) } });
  }
}
