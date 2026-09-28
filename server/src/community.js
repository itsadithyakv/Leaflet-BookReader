import { duels, events, follows, kudos, profiles } from "./db.js";
import { isoWeekKey, weekIsOver } from "./week.js";
import { avatarView } from "./avatars.js";

/**
 * The community's data rules, shared by the routes and by account deletion.
 *
 * Everything a reader does here (follows, kudos, duels) is keyed by account id,
 * and everything shown is filtered to *public* profiles at read time. Going
 * private therefore hides a reader everywhere at once, without rewriting their
 * follows or duels; going public again brings them back.
 */

export const DUEL_LIMIT = 3;
export const FOLLOW_LIMIT = 500;
export const INBOX_LIMIT = 50;
/** How long a settled duel keeps showing as a result card. */
const RESULT_VISIBLE_MS = 8 * 24 * 60 * 60 * 1000;

const ACTIVE = ["pending", "accepted"];

/** Two ids in a fixed order, so A-vs-B and B-vs-A are the same pair. */
export const pairKey = (a, b) => [a.toHexString(), b.toHexString()].sort().join(":");

/** Minutes for a week, or 0 when the profile's figures belong to another one. */
export const minutesFor = (profile, weekKey) =>
  profile?.weekKey === weekKey ? Math.round(profile.weekMinutes ?? 0) : 0;

/** The little a stranger may know about someone they cannot see in full. */
export const personView = (profile) => ({
  handle: profile.handle,
  displayName: profile.displayName ?? null,
  // The fallback avatar's skin is picked from this on the client, deterministically.
  pipSeed: profile.handle,
  // The avatar the reader picked (`skin.move`), or null for the fallback.
  avatar: avatarView(profile.avatar)
});

export const isPublic = (profile) =>
  Boolean(profile && profile.visibility === "public" && typeof profile.handle === "string");

/** Public profiles by id, in one query. */
export async function publicProfilesById(db, ids) {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await profiles(db)
    .find({ _id: { $in: ids }, visibility: "public" })
    .toArray();
  return new Map(rows.filter(isPublic).map((row) => [row._id.toHexString(), row]));
}

/** The duels either side of `userId` is in, for a range of weeks. */
async function duelsOf(db, userId, weekFilter, extra = {}) {
  const [asChallenger, asOpponent] = await Promise.all([
    duels(db).find({ challengerId: userId, weekKey: weekFilter, ...extra }).toArray(),
    duels(db).find({ opponentId: userId, weekKey: weekFilter, ...extra }).toArray()
  ]);
  return [...asChallenger, ...asOpponent];
}

export async function countActiveDuels(db, userId, weekKey) {
  const [a, b] = await Promise.all([
    duels(db).countDocuments({ challengerId: userId, weekKey, status: { $in: ACTIVE } }),
    duels(db).countDocuments({ opponentId: userId, weekKey, status: { $in: ACTIVE } })
  ]);
  return a + b;
}

/**
 * Keeps each side's minutes on the duel itself.
 *
 * A profile only holds the *current* week, so once the week turns over the
 * duel would lose its numbers. Copying them on every publish means the last
 * figures of the week are still on the duel when it is settled.
 */
export async function recordDuelMinutes(db, userId, weekKey, minutes) {
  const open = { weekKey, status: { $in: ACTIVE }, resultAt: { $exists: false } };
  await Promise.all([
    duels(db).updateMany({ challengerId: userId, ...open }, { $set: { challengerMinutes: minutes } }),
    duels(db).updateMany({ opponentId: userId, ...open }, { $set: { opponentMinutes: minutes } })
  ]);
}

/**
 * Settles this reader's accepted duels whose week is over everywhere, and
 * posts the result to both inboxes. Lazy — there is no scheduler — and safe to
 * race: only the call that sets `resultAt` posts the events.
 */
export async function settleDuels(db, userId, now = new Date()) {
  const current = isoWeekKey(now);
  const candidates = await duelsOf(db, userId, { $lt: current }, {
    status: "accepted",
    resultAt: { $exists: false }
  });
  for (const duel of candidates) {
    if (!weekIsOver(duel.weekKey, now)) {
      continue;
    }
    const a = duel.challengerMinutes ?? 0;
    const b = duel.opponentMinutes ?? 0;
    const winnerId = a === b ? null : a > b ? duel.challengerId : duel.opponentId;
    const settled = await duels(db).findOneAndUpdate(
      { _id: duel._id, resultAt: { $exists: false } },
      { $set: { resultAt: now, winnerId } },
      { returnDocument: "after" }
    );
    if (settled) {
      await events(db).insertMany([
        { userId: duel.challengerId, type: "duel_result", actorId: duel.opponentId, refId: duel._id, createdAt: now },
        { userId: duel.opponentId, type: "duel_result", actorId: duel.challengerId, refId: duel._id, createdAt: now }
      ]);
    }
  }
}

/** A duel as one side sees it. `them` is null when the other side is not public. */
export function duelView(duel, meId, profilesById, now = new Date()) {
  const mine = duel.challengerId.equals(meId);
  const otherId = mine ? duel.opponentId : duel.challengerId;
  const other = profilesById.get(otherId.toHexString());
  const me = profilesById.get(meId.toHexString());
  const myMinutes = Math.round((mine ? duel.challengerMinutes : duel.opponentMinutes) ?? 0);
  const theirMinutes = Math.round((mine ? duel.opponentMinutes : duel.challengerMinutes) ?? 0);
  let result = null;
  if (duel.resultAt) {
    result = !duel.winnerId ? "tie" : duel.winnerId.equals(meId) ? "won" : "lost";
  }
  return {
    id: duel._id.toHexString(),
    weekKey: duel.weekKey,
    status: duel.resultAt ? "finished" : duel.status,
    youChallenged: mine,
    weekOver: weekIsOver(duel.weekKey, now),
    you: { ...(me ? personView(me) : { handle: null, displayName: null, pipSeed: null, avatar: null }), minutes: myMinutes },
    them: other ? { ...personView(other), minutes: theirMinutes } : null,
    result
  };
}

/**
 * The duels worth showing on the Social page: this week's pending and
 * accepted ones, and results settled in the last week or so. Duels with
 * someone who has since gone private simply drop out.
 */
export async function visibleDuels(db, meId, now = new Date()) {
  await settleDuels(db, meId, now);
  const since = isoWeekKey(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000));
  const all = await duelsOf(db, meId, { $gte: since }, { status: { $in: ACTIVE } });
  const shown = all.filter((duel) =>
    duel.resultAt
      ? now - duel.resultAt < RESULT_VISIBLE_MS
      : !weekIsOver(duel.weekKey, now)
  );
  const ids = shown.map((duel) => (duel.challengerId.equals(meId) ? duel.opponentId : duel.challengerId));
  const byId = await publicProfilesById(db, [meId, ...ids]);
  return shown
    .map((duel) => duelView(duel, meId, byId, now))
    .filter((view) => view.them)
    .sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id) : a.status === "pending" ? -1 : 1));
}

/**
 * Removes everything the community holds about a reader, in both directions:
 * who they follow and who follows them, kudos sent and received, their duels,
 * their inbox and the events they caused in other inboxes.
 */
export async function deleteCommunityData(db, userId) {
  await Promise.all([
    follows(db).deleteMany({ followerId: userId }),
    follows(db).deleteMany({ followeeId: userId }),
    kudos(db).deleteMany({ fromId: userId }),
    kudos(db).deleteMany({ toId: userId }),
    duels(db).deleteMany({ challengerId: userId }),
    duels(db).deleteMany({ opponentId: userId }),
    events(db).deleteMany({ userId }),
    events(db).deleteMany({ actorId: userId })
  ]);
}
