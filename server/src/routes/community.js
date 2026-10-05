import { Router } from "express";
import { ObjectId } from "mongodb";
import { optionalAccount, requireAccount } from "../auth.js";
import {
  DUEL_LIMIT,
  FOLLOW_LIMIT,
  INBOX_LIMIT,
  countActiveDuels,
  duelView,
  isPublic,
  minutesFor,
  pairKey,
  personView,
  pickVisitors,
  publicProfilesById,
  visibleDuels
} from "../community.js";
import { duels, events, follows, kudos, profiles } from "../db.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { RateLimiter, defaultLimits } from "../rateLimit.js";
import { isPlausibleDayKey, isWeekKey, isoWeekKey, plausibleWeekKeys, weekIsOver } from "../week.js";
import { HANDLE_PATTERN } from "./social.js";
import { boardStamp, cachedBoard, cachedVisitors, forgetVisitors, rememberBoard, rememberVisitors } from "../boardCache.js";

/**
 * The interactive half of the board: following, kudos, weekly duels, the
 * inbox, and finding readers by handle.
 *
 * Friendly competition, strictly opt-in: only public profiles appear, and only
 * a reader with a public profile can follow, send kudos or challenge. Private and
 * missing handles are indistinguishable (both 404).
 */

const LEADERBOARD_LIMIT = 100;
const SEARCH_LIMIT = 10;
const MAKE_PUBLIC = "Make your profile public to join in.";
const NO_SUCH_READER = "No shared profile with that handle.";

/** `?week=` when it is one a real clock could be in, else the server's. */
const askedWeek = (value) =>
  typeof value === "string" && isWeekKey(value) && plausibleWeekKeys().has(value) ? value : isoWeekKey();

const utcToday = () => new Date().toISOString().slice(0, 10);

/** A leaderboard row. */
function rowView(profile, weekKey, rank, meId) {
  return {
    ...personView(profile),
    rank,
    weekMinutes: minutesFor(profile, weekKey),
    streak: profile.streak ?? 0,
    booksFinished: profile.booksFinished ?? 0,
    isYou: Boolean(meId && profile._id.equals(meId))
  };
}

const byBoardOrder = (weekKey) => (a, b) =>
  minutesFor(b, weekKey) - minutesFor(a, weekKey) ||
  (b.streak ?? 0) - (a.streak ?? 0) ||
  String(a.handle).localeCompare(String(b.handle));

async function publicByHandle(db, raw) {
  const handle = String(raw ?? "").trim().toLowerCase().replace(/^@/, "");
  const profile = HANDLE_PATTERN.test(handle)
    ? await profiles(db).findOne({ handle, visibility: "public" })
    : null;
  if (!isPublic(profile)) {
    throw new HttpError(404, NO_SUCH_READER);
  }
  return profile;
}

/** The acting reader's own profile, which must be public to interact. */
async function publicSelf(db, id) {
  const me = await profiles(db).findOne({ _id: id });
  if (!isPublic(me)) {
    throw new HttpError(403, MAKE_PUBLIC);
  }
  return me;
}

const notSelf = (me, them, message) => {
  if (me._id.equals(them._id)) {
    throw new HttpError(400, message);
  }
};

const objectId = (value) => (ObjectId.isValid(value) && String(value).length === 24 ? new ObjectId(value) : null);

export function communityRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const maybeAuth = optionalAccount(db);
  const fallback = defaultLimits();
  const writes = new RateLimiter(limits.social ?? fallback.social);
  const searches = new RateLimiter(limits.search ?? fallback.search);
  const visits = new RateLimiter(limits.visitors ?? fallback.visitors);

  const limit = (limiter, key) => {
    const wait = limiter.blockedFor(key);
    if (wait) {
      throw new HttpError(429, "That's a lot at once. Try again in a few minutes.", { retryAfter: wait });
    }
    limiter.hit(key);
  };
  const limitWrite = (request) => limit(writes, `acct:${request.account.id}`);

  /**
   * A week's board. `scope=everyone` (default) is public: the top 100, most
   * minutes first, ties broken by streak then handle. `scope=following` is the
   * signed-in reader plus everyone they follow who is public, zeros included.
   * When signed in and public but outside the top 100, `you` carries the
   * reader's own row and rank. `sharedReaders` (everyone only) counts the
   * public profiles there are, read this week or not.
   *
   * A private reader gets no row here, their own included: the app draws
   * their own row from the minutes on their device, so nothing about a
   * private profile ever has to be on this server to be shown to its owner.
   */
  router.get(
    "/leaderboard",
    maybeAuth,
    asyncHandler(async (request, response) => {
      const weekKey = askedWeek(request.query.week);
      const meId = request.account?.id ?? null;
      const scope = request.query.scope === "following" ? "following" : "everyone";

      if (scope === "following") {
        if (!meId) {
          throw new HttpError(401, "Sign in to see the readers you follow.");
        }
        const followed = await follows(db)
          .find({ followerId: meId }, { projection: { followeeId: 1 }, limit: FOLLOW_LIMIT })
          .toArray();
        const byId = await publicProfilesById(db, [meId, ...followed.map((row) => row.followeeId)]);
        const rows = [...byId.values()].sort(byBoardOrder(weekKey));
        const entries = rows.map((row, index) => rowView(row, weekKey, index + 1, meId));
        response.json({ weekKey, scope, entries, you: entries.find((entry) => entry.isYou) ?? null });
        return;
      }

      let board = cachedBoard(weekKey);
      if (!board) {
        const stamp = boardStamp();
        const [rows, sharedReaders] = await Promise.all([
          profiles(db)
            .find(
              // Only profiles with a handle are shared with anyone. Without
              // that here, "public" profiles with no handle took places in
              // the hundred and were then left out, so a hundred of them
              // emptied the board for everybody.
              { visibility: "public", weekKey, weekMinutes: { $gt: 0 }, handle: { $type: "string" } },
              {
                projection: { handle: 1, displayName: 1, avatar: 1, weekKey: 1, weekMinutes: 1, streak: 1, booksFinished: 1, visibility: 1 },
                sort: { weekMinutes: -1, streak: -1, handle: 1 },
                limit: LEADERBOARD_LIMIT
              }
            )
            .toArray(),
          // Everyone who shares a profile, whether or not they have read this
          // week. A count only: it lets an empty board say why it is empty
          // ("nobody shares yet" or "nobody has read yet") and names nobody.
          profiles(db).countDocuments({ visibility: "public", handle: { $type: "string" } })
        ]);
        board = { rows, sharedReaders };
        rememberBoard(weekKey, rows, sharedReaders, stamp);
      }
      const { rows, sharedReaders } = board;
      const entries = rows.filter(isPublic).map((row, index) => rowView(row, weekKey, index + 1, meId));

      let you = entries.find((entry) => entry.isYou) ?? null;
      if (!you && meId) {
        const me = await profiles(db).findOne({ _id: meId });
        if (isPublic(me) && minutesFor(me, weekKey) > 0) {
          const minutes = me.weekMinutes;
          const streak = me.streak ?? 0;
          const ahead = await profiles(db).countDocuments({
            visibility: "public",
            weekKey,
            handle: { $type: "string" },
            $or: [
              { weekMinutes: { $gt: minutes } },
              { weekMinutes: minutes, streak: { $gt: streak } },
              { weekMinutes: minutes, streak, handle: { $lt: me.handle } }
            ]
          });
          you = rowView(me, weekKey, ahead + 1, meId);
        }
      }
      response.json({ weekKey, scope, entries, you, sharedReaders });
    })
  );

  /**
   * A shared profile, by handle. Private ones are not merely hidden — they 404.
   * Signed in, it also says how the two readers stand: following, kudos sent
   * today (`?day=` is the reader's local date), and this week's duel.
   */
  router.get(
    "/profile/:handle",
    maybeAuth,
    asyncHandler(async (request, response) => {
      const profile = await publicByHandle(db, request.params.handle);
      const weekKey = askedWeek(request.query.week);
      const [kudosThisWeek, followerCount, followingCount] = await Promise.all([
        kudos(db).countDocuments({ toId: profile._id, weekKey }),
        follows(db).countDocuments({ followeeId: profile._id }),
        follows(db).countDocuments({ followerId: profile._id })
      ]);
      const view = {
        ...personView(profile),
        visibility: "public",
        weekKey,
        weekMinutes: minutesFor(profile, weekKey),
        streak: profile.streak ?? 0,
        booksFinished: profile.booksFinished ?? 0,
        shelf: profile.shelf ?? [],
        kudosThisWeek,
        followerCount,
        followingCount
      };

      const meId = request.account?.id;
      if (meId) {
        const dayKey = isPlausibleDayKey(request.query.day) ? request.query.day : utcToday();
        const isYou = profile._id.equals(meId);
        const [following, followsYou, sentToday, duel] = isYou
          ? [null, null, null, null]
          : await Promise.all([
              follows(db).findOne({ followerId: meId, followeeId: profile._id }),
              follows(db).findOne({ followerId: profile._id, followeeId: meId }),
              kudos(db).findOne({ fromId: meId, toId: profile._id, dayKey }),
              duels(db).findOne({ pair: pairKey(meId, profile._id), weekKey })
            ]);
        Object.assign(view, {
          isYou,
          isFollowing: Boolean(following),
          followsYou: Boolean(followsYou),
          kudosSentToday: Boolean(sentToday),
          activeDuel: duel
            ? { id: duel._id.toHexString(), status: duel.status, youChallenged: duel.challengerId.equals(meId) }
            : null
        });
      }
      response.json(view);
    })
  );

  /** Follow a public reader. Idempotent; tells them once, not on every re-follow. */
  router.post(
    "/follows/:handle",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const me = await publicSelf(db, request.account.id);
      const them = await publicByHandle(db, request.params.handle);
      notSelf(me, them, "You can't follow yourself — but you're doing great.");

      if ((await follows(db).countDocuments({ followerId: me._id })) >= FOLLOW_LIMIT) {
        throw new HttpError(409, `You can follow up to ${FOLLOW_LIMIT} readers.`);
      }
      const now = new Date();
      const { upsertedCount } = await follows(db).updateOne(
        { followerId: me._id, followeeId: them._id },
        { $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      // A visit needs both to follow the other, so this changes both lists.
      forgetVisitors(me._id.toHexString());
      forgetVisitors(them._id.toHexString());
      if (upsertedCount) {
        await events(db).updateOne(
          { userId: them._id, type: "follow", actorId: me._id },
          { $setOnInsert: { refId: null, createdAt: now } },
          { upsert: true }
        );
      }
      response.json({ following: true });
    })
  );

  /** Unfollow. Works even if either side has since gone private. */
  router.delete(
    "/follows/:handle",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const handle = String(request.params.handle ?? "").toLowerCase();
      const them = HANDLE_PATTERN.test(handle) ? await profiles(db).findOne({ handle }) : null;
      if (them) {
        await follows(db).deleteOne({ followerId: request.account.id, followeeId: them._id });
        forgetVisitors(them._id.toHexString());
      }
      forgetVisitors(request.account.id.toHexString());
      response.json({ following: false });
    })
  );

  /** Who the reader follows (public ones only), and how many follow them. */
  router.get(
    "/follows",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const [rows, followerCount] = await Promise.all([
        follows(db).find({ followerId: meId }, { projection: { followeeId: 1 }, limit: FOLLOW_LIMIT }).toArray(),
        follows(db).countDocuments({ followeeId: meId })
      ]);
      const byId = await publicProfilesById(db, rows.map((row) => row.followeeId));
      const following = [...byId.values()]
        .map(personView)
        .sort((a, b) => a.handle.localeCompare(b.handle));
      response.json({ following, followerCount });
    })
  );

  /**
   * Whose Pip could come by today: the public readers this reader follows, and
   * who follow this reader back, who read on `?day=` (the reader's own local
   * date), at most a handful, picked the same way all day (see `pickVisitors`).
   *
   * "Read today" is the friend's own word: the `readDay` their app publishes
   * with their minutes, held only while their profile is public. It is
   * compared here and never sent on, so all this tells anyone is that a
   * friend (each follows the other) has read today. A reader whose own profile is not
   * public has no visitors: an empty list, not an error, since nothing they
   * asked to do is being refused.
   */
  router.get(
    "/visitors",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      limit(visits, `acct:${meId}`);
      const day = request.query.day;
      if (!isPlausibleDayKey(day)) {
        throw new HttpError(400, "day must be today's local date, like 2026-09-27.");
      }
      const weekKey = askedWeek(request.query.week);
      const key = `${day}:${weekKey}`;
      const reader = meId.toHexString();

      let list = cachedVisitors(reader, key);
      if (!list) {
        const stamp = boardStamp();
        list = [];
        const me = await profiles(db).findOne({ _id: meId }, { projection: { handle: 1, visibility: 1 } });
        if (isPublic(me)) {
          const followed = await follows(db)
            .find({ followerId: meId }, { projection: { followeeId: 1 }, limit: FOLLOW_LIMIT })
            .toArray();
          const followedIds = followed.map((row) => row.followeeId).filter((id) => !id.equals(meId));
          // A friend is a reader who follows back. Following is one-way, and
          // "read today" is told to nobody a reader has not chosen: a visit
          // needs both to have followed the other.
          const back = followedIds.length
            ? await follows(db)
                .find({ followerId: { $in: followedIds }, followeeId: meId }, { projection: { followerId: 1 } })
                .toArray()
            : [];
          const ids = back.map((row) => row.followerId);
          const rows = ids.length
            ? await profiles(db)
                .find(
                  { _id: { $in: ids }, visibility: "public", readDay: day },
                  { projection: { handle: 1, displayName: 1, avatar: 1, visibility: 1, weekKey: 1, weekMinutes: 1, streak: 1 } }
                )
                .toArray()
            : [];
          list = pickVisitors(rows.filter(isPublic), day, meId).map((row) => ({
            ...personView(row),
            weekMinutes: minutesFor(row, weekKey),
            streak: row.streak ?? 0
          }));
        }
        rememberVisitors(reader, key, list, stamp);
      }
      response.json({ day, visitors: list });
    })
  );

  /** Kudos: once per reader, per local day. */
  router.post(
    "/kudos/:handle",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { dayKey, weekKey } = request.body ?? {};
      if (!isPlausibleDayKey(dayKey)) {
        throw new HttpError(400, "dayKey must be today's local date, like 2026-09-27.");
      }
      if (!isWeekKey(weekKey) || !plausibleWeekKeys().has(weekKey)) {
        throw new HttpError(400, "weekKey must be the current ISO week, like 2026-W39.");
      }
      const me = await publicSelf(db, request.account.id);
      const them = await publicByHandle(db, request.params.handle);
      notSelf(me, them, "Kudos to you — but they're for other readers.");

      const now = new Date();
      let insertedId;
      try {
        ({ insertedId } = await kudos(db).insertOne({ fromId: me._id, toId: them._id, dayKey, weekKey, createdAt: now }));
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "You've already sent them kudos today.");
        }
        throw error;
      }
      await events(db).insertOne({ userId: them._id, type: "kudos", actorId: me._id, refId: insertedId, createdAt: now });
      const kudosThisWeek = await kudos(db).countDocuments({ toId: them._id, weekKey });
      response.status(201).json({ sent: true, kudosThisWeek });
    })
  );

  /** Challenge a public reader to a duel for this week. */
  router.post(
    "/duels",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { handle, weekKey } = request.body ?? {};
      if (!isWeekKey(weekKey) || !plausibleWeekKeys().has(weekKey)) {
        throw new HttpError(400, "weekKey must be the current ISO week, like 2026-W39.");
      }
      const me = await publicSelf(db, request.account.id);
      const them = await publicByHandle(db, handle);
      notSelf(me, them, "You can't duel yourself. Tempting, though.");

      if ((await countActiveDuels(db, me._id, weekKey)) >= DUEL_LIMIT) {
        throw new HttpError(409, `You already have ${DUEL_LIMIT} duels this week.`);
      }
      if ((await countActiveDuels(db, them._id, weekKey)) >= DUEL_LIMIT) {
        throw new HttpError(409, `They already have ${DUEL_LIMIT} duels this week.`);
      }

      const now = new Date();
      const duel = {
        challengerId: me._id,
        opponentId: them._id,
        pair: pairKey(me._id, them._id),
        weekKey,
        status: "pending",
        challengerMinutes: minutesFor(me, weekKey),
        opponentMinutes: minutesFor(them, weekKey),
        createdAt: now,
        respondedAt: null
      };
      try {
        duel._id = (await duels(db).insertOne(duel)).insertedId;
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "You two already have a duel this week.");
        }
        throw error;
      }
      // The two counts above were taken before the insert, so challenges sent
      // at the same moment each saw room and all went in: six duels where
      // three are allowed, and as many invites in one reader's inbox. Counted
      // again with this duel in place, and taken back out if it is one too
      // many. Whichever of several checks last sees all the others, so the
      // limit holds; at worst a few sent together are all refused.
      const [mine, theirs] = await Promise.all([
        countActiveDuels(db, me._id, weekKey),
        countActiveDuels(db, them._id, weekKey)
      ]);
      if (mine > DUEL_LIMIT || theirs > DUEL_LIMIT) {
        await duels(db).deleteOne({ _id: duel._id });
        throw new HttpError(409, "Too many challenges at once. Try that one again.");
      }
      await events(db).insertOne({ userId: them._id, type: "duel_invite", actorId: me._id, refId: duel._id, createdAt: now });
      const byId = await publicProfilesById(db, [me._id, them._id]);
      response.status(201).json(duelView(duel, me._id, byId));
    })
  );

  const respond = (accept) =>
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const meId = request.account.id;
      const duel = id ? await duels(db).findOne({ _id: id, opponentId: meId }) : null;
      if (!duel) {
        throw new HttpError(404, "No such duel.");
      }
      if (duel.status !== "pending") {
        throw new HttpError(409, duel.status === "accepted" ? "You already accepted." : "You already declined.");
      }
      if (weekIsOver(duel.weekKey)) {
        throw new HttpError(409, "That week is over.");
      }

      const now = new Date();
      if (!accept) {
        await duels(db).updateOne({ _id: id, status: "pending" }, { $set: { status: "declined", respondedAt: now } });
        response.json({ id: duel._id.toHexString(), status: "declined" });
        return;
      }

      const me = await publicSelf(db, meId);
      const byId = await publicProfilesById(db, [duel.challengerId, meId]);
      const challenger = byId.get(duel.challengerId.toHexString());
      if (!challenger) {
        throw new HttpError(404, "That reader's profile isn't shared any more.");
      }
      const updated = await duels(db).findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: {
            status: "accepted",
            respondedAt: now,
            challengerMinutes: minutesFor(challenger, duel.weekKey),
            opponentMinutes: minutesFor(me, duel.weekKey)
          }
        },
        { returnDocument: "after" }
      );
      if (!updated) {
        throw new HttpError(409, "That duel has already been answered.");
      }
      await events(db).insertOne({
        userId: duel.challengerId,
        type: "duel_accepted",
        actorId: meId,
        refId: duel._id,
        createdAt: now
      });
      response.json(duelView(updated, meId, byId));
    });

  router.post("/duels/:id/accept", auth, respond(true));
  router.post("/duels/:id/decline", auth, respond(false));

  /** This week's duels and recent results. Settles any finished ones first. */
  router.get(
    "/duels",
    auth,
    asyncHandler(async (request, response) => {
      response.json({ duels: await visibleDuels(db, request.account.id) });
    })
  );

  /**
   * The newest events (≤ 50) after `?since=` (an ISO time). Events from
   * readers who are no longer public are left out.
   */
  router.get(
    "/inbox",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const parsed = typeof request.query.since === "string" ? new Date(request.query.since) : null;
      const since = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);

      // Settling posts result events, so it goes first.
      const duelViews = await visibleDuels(db, meId);
      const rows = await events(db)
        .find({ userId: meId, createdAt: { $gt: since } }, { sort: { createdAt: -1 }, limit: INBOX_LIMIT })
        .toArray();

      const actors = await publicProfilesById(db, [meId, ...rows.map((row) => row.actorId)]);
      const duelIds = rows.filter((row) => row.type.startsWith("duel_")).map((row) => row.refId);
      const duelRows = duelIds.length ? await duels(db).find({ _id: { $in: duelIds } }).toArray() : [];
      const duelsById = new Map(duelRows.map((duel) => [duel._id.toHexString(), duel]));
      const shownDuels = new Map(duelViews.map((view) => [view.id, view]));

      const out = [];
      for (const row of rows) {
        const actor = actors.get(row.actorId.toHexString());
        if (!actor) {
          continue;
        }
        const item = {
          id: row._id.toHexString(),
          type: row.type,
          createdAt: row.createdAt.toISOString(),
          actor: personView(actor)
        };
        if (row.type.startsWith("duel_")) {
          const key = row.refId?.toHexString();
          const duel = duelsById.get(key);
          if (!duel) {
            continue; // expired or deleted
          }
          item.duel = shownDuels.get(key) ?? duelView(duel, meId, actors);
          // A declined invite still shows, so the inbox reads as history.
          if (duel.status === "declined") {
            item.duel = { ...item.duel, status: "declined" };
          }
        }
        out.push(item);
      }
      response.json({ events: out, now: new Date().toISOString() });
    })
  );

  /** Public profiles whose handle starts with `?q=`. At most ten. */
  router.get(
    "/search",
    asyncHandler(async (request, response) => {
      limit(searches, `ip:${request.ip ?? "unknown"}`);
      const q = String(request.query.q ?? "").trim().toLowerCase().replace(/^@/, "");
      // Only handle characters, so the anchored prefix is safe as a regex and
      // is served by the handle index.
      if (!/^[a-z0-9_-]{1,24}$/.test(q)) {
        response.json({ results: [] });
        return;
      }
      const weekKey = askedWeek(request.query.week);
      const rows = await profiles(db)
        .find(
          { handle: { $regex: `^${q}` }, visibility: "public" },
          { projection: { handle: 1, displayName: 1, avatar: 1, visibility: 1, weekKey: 1, weekMinutes: 1, streak: 1 }, sort: { handle: 1 }, limit: SEARCH_LIMIT }
        )
        .toArray();
      response.json({
        results: rows.filter(isPublic).map((row) => ({
          ...personView(row),
          weekMinutes: minutesFor(row, weekKey),
          streak: row.streak ?? 0
        }))
      });
    })
  );

  return router;
}
