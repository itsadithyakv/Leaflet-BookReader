import { createHash } from "node:crypto";
import { blocks, clubs, duels, events, followRequests, follows, gifts, kudos, libraries, profiles, raids, reports } from "./db.js";
import { forgetAuthor, forgetPosts, leaveCommunities } from "./discussion.js";
import { removeReactionsBy } from "./reactions.js";
import { isoWeekKey, weekIsOver } from "./week.js";
import { avatarView } from "./avatars.js";
import { countBulkFollows, removeFollowsOf } from "./followCounts.js";

/**
 * The community's data rules, shared by the routes and by account deletion.
 *
 * Everything a reader does here (follows, kudos, duels, posts, clubs, gifts)
 * is keyed by account id, and everything shown is filtered at read time to
 * the profiles the reader asking may see. Going private therefore hides a
 * reader everywhere at once, without rewriting their follows or duels;
 * sharing again brings them back.
 *
 * A profile is shared one of three ways:
 *   `public`    with everybody: on the board, and open to anyone who asks.
 *   `followers` with the readers whose follow it has accepted. Anyone else
 *               can find it by handle and sees a locked card: who it is, and
 *               nothing about their reading.
 *   `private`   with nobody. It answers like a handle that does not exist.
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

/**
 * The same as the profile holds them, unrounded: what a duel keeps of each
 * side. A save of the reader's figures writes them to their duels exactly
 * (`recordDuelMinutes`), so a duel made or accepted starts from them
 * exactly too, and a save that says nothing new has nothing to write there.
 * (They are rounded where they are shown: `duelView`.)
 */
export const exactMinutes = (profile, weekKey) => (profile?.weekKey === weekKey ? profile.weekMinutes ?? 0 : 0);

/** The little a stranger may know about someone they cannot see in full. */
export const personView = (profile) => ({
  handle: profile.handle,
  displayName: profile.displayName ?? null,
  // The fallback avatar's skin is picked from this on the client, deterministically.
  pipSeed: profile.handle,
  // The avatar the reader picked (`skin.move`), or null for the fallback.
  avatar: avatarView(profile.avatar)
});

/**
 * What `personView` shows of a profile, and what says it is shared: a
 * projection for the lists that show readers by name and nothing else. A
 * whole profile carries a shelf, badges and a camp (a few kilobytes), and a
 * list of the readers followed is up to five hundred of them.
 */
export const PERSON_FIELDS = { handle: 1, displayName: 1, avatar: 1, visibility: 1 };

export const isPublic = (profile) =>
  Boolean(profile && profile.visibility === "public" && typeof profile.handle === "string");

/** The two ways of sharing a profile, for a query. */
export const SOCIAL = ["public", "followers"];

/**
 * Shared with somebody: public, or with followers only. Such a reader can be
 * found by handle and can follow, send kudos, duel, post, join a club and
 * give, whichever of the two it is.
 */
export const isSocial = (profile) =>
  Boolean(profile && SOCIAL.includes(profile.visibility) && typeof profile.handle === "string");

/**
 * Whether `viewerId` (null when signed out) may see the whole of a profile:
 * anyone may see a public one; a followers-only one is seen by its owner and
 * by the readers whose follow it has accepted (a row in `follows`: a request
 * still waiting is not one); a private one by nobody.
 */
export async function canSee(db, viewerId, profile) {
  if (!isSocial(profile)) {
    return false;
  }
  if (profile.visibility === "public") {
    return true;
  }
  if (!viewerId) {
    return false;
  }
  if (profile._id.equals(viewerId)) {
    return true;
  }
  return Boolean(await follows(db).findOne({ followerId: viewerId, followeeId: profile._id }, { projection: { _id: 1 } }));
}

/** How many friends a day's visitors are picked from. A handful: one visits at a time. */
export const VISITOR_LIMIT = 5;

/**
 * At most `limit` of `rows`, for one reader and one day.
 *
 * Ordered by a hash of the day, the reader asking and each friend, so the
 * same handful is given all day (a visitor does not change between two
 * requests), a different one tomorrow, and nobody is favoured for their
 * minutes or their place in the alphabet.
 */
export function pickVisitors(rows, dayKey, readerId, limit = VISITOR_LIMIT) {
  const me = readerId.toHexString();
  const order = (row) => createHash("sha256").update(`${dayKey}:${me}:${row._id.toHexString()}`).digest("hex");
  return rows
    .map((row) => ({ row, at: order(row) }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(0, limit)
    .map((entry) => entry.row);
}

/**
 * Shared profiles (public or followers-only) by id, in one query.
 *
 * For the places where the reader asking already stands in some relation to
 * each of them that lets them be shown: a reader they follow (a follow of a
 * followers-only reader exists only once accepted), the other side of a duel,
 * whoever sent them kudos, a fellow member of a club.
 *
 * `fields`, when given, is a projection, for a caller that shows little or
 * nothing of them (a profile carries a shelf, badges and a camp of up to
 * 3 KB). It has to keep `handle` and `visibility`: those are what say a
 * profile is shared.
 */
export async function socialProfilesById(db, ids, extra = {}, fields = undefined) {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await profiles(db)
    .find({ _id: { $in: ids }, visibility: { $in: SOCIAL }, ...extra }, fields ? { projection: fields } : {})
    .toArray();
  return new Map(rows.filter(isSocial).map((row) => [row._id.toHexString(), row]));
}

/**
 * The ids `userId` follows (accepted follows only), at most FOLLOW_LIMIT.
 * Read from the `pair` index alone: with no `_id` asked for, no follow is
 * fetched.
 */
export async function followedIds(db, userId) {
  const rows = await follows(db)
    .find({ followerId: userId }, { projection: { _id: 0, followeeId: 1 }, limit: FOLLOW_LIMIT })
    .toArray();
  return rows.map((row) => row.followeeId);
}

/**
 * How many different readers the two kudos badges are for: kudos from ten
 * readers, and kudos sent to ten. Counted by people, not by kudos, so that
 * one friend's kudos every day for a month earns neither.
 */
export const KUDOS_BADGE_AT = 10;
/** The badges only this server gives (`kudosBadges`); a profile save may not name one. */
export const KUDOS_BADGES = { from: `kudos-from-${KUDOS_BADGE_AT}`, to: `kudos-to-${KUDOS_BADGE_AT}` };
export const isKudosBadge = (id) => typeof id === "string" && id.startsWith("kudos-");

/**
 * The writes that remember a kudos from `fromId` to `toId`, on both profiles:
 * the sender in the recipient's `kudosFrom`, the recipient in the sender's
 * `kudosTo`. Each list holds distinct ids and stops at KUDOS_BADGE_AT, which
 * is all a badge needs to know, so it can be written again and again (by a
 * kudos a day, or by the backfill) and neither grows nor counts twice. Never
 * an upsert: a reader without a profile is not given one.
 */
export function kudosCircleWrites(fromId, toId) {
  const roomIn = (field) => ({ [`${field}.${KUDOS_BADGE_AT - 1}`]: { $exists: false } });
  return [
    { updateOne: { filter: { _id: toId, ...roomIn("kudosFrom") }, update: { $addToSet: { kudosFrom: fromId } } } },
    { updateOne: { filter: { _id: fromId, ...roomIn("kudosTo") }, update: { $addToSet: { kudosTo: toId } } } }
  ];
}

/** Remembers one kudos sent, on both profiles (`kudosCircleWrites`). */
export async function rememberKudos(db, fromId, toId) {
  await profiles(db).bulkWrite(kudosCircleWrites(fromId, toId), { ordered: false });
}

/** The kudos badges a profile has earned, by the readers counted on it. */
export function kudosBadges(profile) {
  const earned = [];
  if ((profile?.kudosFrom?.length ?? 0) >= KUDOS_BADGE_AT) {
    earned.push(KUDOS_BADGES.from);
  }
  if ((profile?.kudosTo?.length ?? 0) >= KUDOS_BADGE_AT) {
    earned.push(KUDOS_BADGES.to);
  }
  return earned;
}

/**
 * The badges a profile shows: what the app saved, less any kudos badge (only
 * this server says those are earned), and then the kudos badges earned, each
 * once.
 */
export const shownBadges = (profile) => [
  ...new Set([...(profile?.badges ?? []).filter((id) => !isKudosBadge(id)), ...kudosBadges(profile)])
];

/**
 * Fills `kudosFrom` and `kudosTo` from the kudos still kept (the last 21
 * days), for the readers who sent or were sent kudos before the lists
 * existed. Run at every start (`index.js`): there is no marker to say it has
 * been done, and it needs none, since the writes are those a kudos makes
 * (`kudosCircleWrites`) and change nothing a second time. Bounded by the
 * kudos collection, which keeps three weeks: one write each way per pair of
 * readers, a thousand pairs at a time. Says how many pairs it went through.
 */
export async function backfillKudosCircles(db) {
  const pairs = await kudos(db)
    .aggregate([{ $group: { _id: { fromId: "$fromId", toId: "$toId" } } }])
    .toArray();
  for (let at = 0; at < pairs.length; at += 1000) {
    const writes = pairs.slice(at, at + 1000).flatMap((pair) => kudosCircleWrites(pair._id.fromId, pair._id.toId));
    await profiles(db).bulkWrite(writes, { ordered: false });
  }
  return pairs.length;
}

/**
 * Turns every request to follow `userId` into a follow: what making a
 * followers-only profile public means, since anyone may follow a public one.
 * Each asker is told, as for a request accepted by hand.
 *
 * An asker who already follows as many readers as they may is not added; their
 * request is dropped with the rest, and they can follow in the usual way.
 * Worked through a thousand at a time, so a reader with a great many waiting
 * does not have them all held in memory at once.
 */
export async function acceptAllRequests(db, userId, now = new Date()) {
  let accepted = 0;
  for (;;) {
    const waiting = await followRequests(db)
      .find({ toId: userId }, { projection: { fromId: 1 }, limit: 1000 })
      .toArray();
    if (waiting.length === 0) {
      return accepted;
    }
    const askers = waiting.map((row) => row.fromId);
    const counts = await follows(db)
      .aggregate([{ $match: { followerId: { $in: askers } } }, { $group: { _id: "$followerId", count: { $sum: 1 } } }])
      .toArray();
    const full = new Set(counts.filter((row) => row.count >= FOLLOW_LIMIT).map((row) => row._id.toHexString()));
    const welcome = askers.filter((id) => !full.has(id.toHexString()));
    if (welcome.length > 0) {
      const made = await follows(db).bulkWrite(
        welcome.map((id) => ({
          updateOne: {
            filter: { followerId: id, followeeId: userId },
            update: { $setOnInsert: { createdAt: now } },
            upsert: true
          }
        })),
        { ordered: false }
      );
      // Counted on both sides (`followCounts.js`): only the follows this made,
      // by their place in the list, not one already there.
      await countBulkFollows(db, Object.keys(made.upsertedIds ?? {}).map((index) => welcome[Number(index)]), userId);
      await events(db).bulkWrite(
        welcome.map((id) => ({
          updateOne: {
            filter: { userId: id, type: "follow_accept", actorId: userId },
            update: { $setOnInsert: { refId: null, createdAt: now } },
            upsert: true
          }
        })),
        { ordered: false }
      );
      accepted += welcome.length;
    }
    await followRequests(db).deleteMany({ _id: { $in: waiting.map((row) => row._id) } });
  }
}

/**
 * The duels either side of `userId` is in, for a range of weeks. One query
 * for both sides (it was one each): each half of the `$or` is read off its
 * own index, `challenger` and `opponent`.
 */
function duelsOf(db, userId, weekFilter, extra = {}) {
  return duels(db)
    .find({ $or: [{ challengerId: userId, weekKey: weekFilter, ...extra }, { opponentId: userId, weekKey: weekFilter, ...extra }] })
    .toArray();
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

/** A duel as one side sees it. `them` is null when the other side no longer shares a profile. */
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
    // What the two agreed to play for. Only a number to this server: it holds
    // nobody's seeds, and the two apps settle it between themselves.
    stake: duel.stake ?? 0,
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
  // A duel shows each side's name and the minutes kept on the duel itself,
  // which both agreed to by challenging and accepting. So a followers-only
  // reader's duels show like a public one's.
  const byId = await socialProfilesById(db, [meId, ...ids], {}, PERSON_FIELDS);
  return shown
    .map((duel) => duelView(duel, meId, byId, now))
    .filter((view) => view.them)
    .sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id) : a.status === "pending" ? -1 : 1));
}

/**
 * Takes a reader out of clubs: the ones given, or every one they are in.
 *
 * The members are kept in the order they joined, so when the owner leaves the
 * club goes to whoever has been in it longest, and a club nobody is left in is
 * deleted. Each step is a single update, so two members leaving at the same
 * moment cannot leave a club with an owner who is gone, or an empty one.
 */
export async function leaveClubs(db, userId, clubIds = null) {
  const ids =
    clubIds ??
    (await clubs(db).find({ memberIds: userId }, { projection: { _id: 1 } }).toArray()).map((club) => club._id);
  if (ids.length === 0) {
    return 0;
  }
  const { modifiedCount } = await clubs(db).updateMany({ _id: { $in: ids }, memberIds: userId }, [
    { $set: { memberIds: { $filter: { input: "$memberIds", cond: { $ne: ["$$this", userId] } } } } },
    // Reads the list as the stage above left it: without the one leaving.
    // (With nobody left there is no first member; that club is deleted below.)
    { $set: { ownerId: { $cond: [{ $eq: ["$ownerId", userId] }, { $arrayElemAt: ["$memberIds", 0] }, "$ownerId"] } } }
  ]);
  await clubs(db).deleteMany({ _id: { $in: ids }, memberIds: { $size: 0 } });
  return modifiedCount;
}

/**
 * What leaves the server the moment a profile is made private, beyond the
 * reading figures on the profile itself: the uploaded library, and the
 * requests to follow it that were still waiting (there is nothing left to ask
 * to see).
 *
 * Posts, club memberships and gifts are kept: like follows, they are hidden
 * wherever their reader is, and come back if the reader shares again.
 */
export async function deleteSharedData(db, userId) {
  await Promise.all([
    libraries(db).deleteOne({ _id: userId }),
    followRequests(db).deleteMany({ toId: userId })
  ]);
}

/**
 * What a reader gives up the moment their profile stops being public
 * (private, or followers only): their places in book communities, the
 * keeper's included, which is handed on. A community is a public room, and
 * its members are counted and can post in it; a reader who is no longer
 * public can do neither.
 *
 * Their threads, replies and posts for everyone are not deleted. They are
 * left out of every answer while their author is not public (the routes
 * check at read time) and are back if the profile is made public again.
 */
export async function leavePublic(db, userId) {
  await leaveCommunities(db, userId);
}

/**
 * Removes everything the community holds about a reader, in both directions:
 * who they follow and who follows them, requests to follow sent and received,
 * kudos sent and received, their duels, their library, their posts, gifts
 * sent and received, raids made and suffered, their places in clubs, their
 * inbox and the events they caused in other inboxes.
 *
 * And of the public layer: their likes and dislikes (each total counted back
 * down), the reports they made and those about their profile, blocks in both
 * directions, their replies, their threads and their places in communities
 * (see `forgetAuthor` for the one thing that stays: a thread other readers
 * replied to, with no author).
 *
 * Their id is left in other readers' `kudosFrom` and `kudosTo`. It is an
 * opaque id that points at nothing once the account is gone, nothing shows
 * it, and taking it out would take away a kudos badge the other reader has
 * earned (or put them back below ten, to earn it again). Their own two lists
 * go with their profile, which the caller deletes.
 */
export async function deleteCommunityData(db, userId) {
  await Promise.all([
    // Counted down on the other side of each (`followCounts.js`).
    removeFollowsOf(db, userId),
    followRequests(db).deleteMany({ fromId: userId }),
    followRequests(db).deleteMany({ toId: userId }),
    kudos(db).deleteMany({ fromId: userId }),
    kudos(db).deleteMany({ toId: userId }),
    duels(db).deleteMany({ challengerId: userId }),
    duels(db).deleteMany({ opponentId: userId }),
    libraries(db).deleteOne({ _id: userId }),
    forgetPosts(db, userId),
    forgetAuthor(db, userId),
    removeReactionsBy(db, userId),
    reports(db).deleteMany({ reporterId: userId }),
    reports(db).deleteMany({ target: "profile", targetId: userId }),
    blocks(db).deleteMany({ blockerId: userId }),
    blocks(db).deleteMany({ blockedId: userId }),
    gifts(db).deleteMany({ fromId: userId }),
    gifts(db).deleteMany({ toId: userId }),
    raids(db).deleteMany({ fromId: userId }),
    raids(db).deleteMany({ toId: userId }),
    leaveClubs(db, userId),
    events(db).deleteMany({ userId }),
    events(db).deleteMany({ actorId: userId })
  ]);
}
