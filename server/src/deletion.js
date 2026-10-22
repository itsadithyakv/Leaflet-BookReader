import { endSessionsOf } from "./auth.js";
import { forgetBoards } from "./boardCache.js";
import { deleteCommunityData } from "./community.js";
import {
  accounts,
  confirmations,
  deletions,
  problems,
  profiles,
  quoteTallies,
  resets,
  states,
  tallies
} from "./db.js";

/**
 * Deleting an account, in one place: the DELETE /v1/account route, the
 * owner's `src/tools/delete-account.js` (a request by email) and the restore
 * tool (`src/backup/restore.js --deletions-from`, which deletes again from a
 * restored copy every account deleted since the backup was taken) all call
 * `deleteAccount`, so what goes is the same whichever way it is asked.
 */

/**
 * Deletes the account and everything keyed to it: its sessions first, then
 * community data (follows and requests to follow, kudos, duels, the library,
 * posts, gifts, places in clubs, inbox events; see `deleteCommunityData`),
 * profile, state blob, the problem reports it sent, then the account. A
 * failure part-way still leaves an account the reader can sign in to again
 * and delete.
 *
 * Sessions go first (sync audit D5). They used to go near the end, after the
 * state: a device of the reader's whose sync was on its way (a push that lost
 * a race, retried at version 0) could land between the two and insert a new
 * state document, and the reading history outlived the deletion. With the
 * sessions gone first no new request is let in; the state is deleted once
 * more at the very end, for a request that was let in just before; and the
 * state route will not insert a first copy for an account that is gone.
 *
 * First of all it notes the deletion in `deletions`: the account's id and
 * when, nothing else (no email, no handle), kept 45 days (the TTL index in
 * `db.js`), longer than any backup is kept. Restoring a backup then deletes
 * again whatever was deleted after it was taken. It goes first so that a
 * deletion which fails part-way is still on the list. `at` is when it was
 * asked for (the restore tool passes the original date along).
 *
 * The suspension of a suspended reader's address is kept (`standing.js`):
 * that is what makes a suspension outlast deleting the account.
 */
export async function deleteAccount(db, accountId, at = new Date()) {
  await deletions(db).updateOne({ _id: accountId }, { $set: { at } }, { upsert: true });
  await endSessionsOf(db, accountId);
  await deleteCommunityData(db, accountId);
  await profiles(db).deleteOne({ _id: accountId });
  forgetBoards();
  await states(db).deleteOne({ _id: accountId });
  // The counts behind the daily and per-book allowances. Kept when only
  // the profile is deleted (or that would refill them); the account
  // going is the end of them.
  await tallies(db).deleteMany({ userId: accountId });
  await quoteTallies(db).deleteMany({ userId: accountId });
  // What it said went wrong (`routes/problems.js`). One sent signed out has
  // no account on it, and goes after its 90 days.
  await problems(db).deleteMany({ accountId });
  await resets(db).deleteOne({ _id: accountId });
  await confirmations(db).deleteOne({ _id: accountId });
  await accounts(db).deleteOne({ _id: accountId });
  // A sync let in before the sessions went may have written since.
  await states(db).deleteOne({ _id: accountId });
}

/**
 * How much there is of a reader, for the owner to look at before deleting an
 * account by hand. Only for showing: what is deleted is decided by
 * `deleteAccount` above, not by this list.
 */
export async function accountFootprint(db, id) {
  const count = (name, filter) => db.collection(name).countDocuments(filter);
  const either = (a, b) => ({ $or: [{ [a]: id }, { [b]: id }] });
  const entries = await Promise.all(
    Object.entries({
      "sync state": count("states", { _id: id }),
      profile: count("profiles", { _id: id }),
      "signed-in devices": count("sessions", { userId: id }),
      library: count("libraries", { _id: id }),
      follows: count("follows", either("followerId", "followeeId")),
      "follow requests": count("followRequests", either("fromId", "toId")),
      kudos: count("kudos", either("fromId", "toId")),
      duels: count("duels", either("challengerId", "opponentId")),
      posts: count("posts", { userId: id }),
      threads: count("threads", { authorId: id }),
      replies: count("replies", { authorId: id }),
      reactions: count("reactions", { userId: id }),
      gifts: count("gifts", either("fromId", "toId")),
      raids: count("raids", either("fromId", "toId")),
      "inbox events": count("events", either("userId", "actorId")),
      clubs: count("clubs", { memberIds: id }),
      communities: count("communities", { memberIds: id }),
      "reports made": count("reports", { reporterId: id }),
      "problem reports": count("problems", { accountId: id }),
      blocks: count("blocks", either("blockerId", "blockedId"))
    }).map(async ([label, counting]) => [label, await counting])
  );
  return Object.fromEntries(entries);
}
