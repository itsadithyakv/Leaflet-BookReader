import { Router } from "express";
import { requireAccount } from "../auth.js";
import { SOCIAL, followedIds, isSocial, socialProfilesById } from "../community.js";
import { follows, profiles, raids } from "../db.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { listOf, wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import { dailyLimit, limiter, notSelf, objectId, socialByHandle, socialSelf } from "../readers.js";
import { NO_INTERACTION, blockedAmong, isBlockedPair } from "../standing.js";

/**
 * Raids between friends: one reader's Pip going at another's camp in the
 * Hollow.
 *
 * A raid here is only a note that one happened: who raided whom, how many
 * stars it won and when. The fight is played on the raider's device, against
 * the camp their friend's profile already shows, and what it does to the
 * camp raided is that reader's app's business; this server holds nobody's
 * camp but the summary on a profile, and does not know the game. It carries
 * the note to the reader raided, keeps it until their app has seen it, and
 * bounds how often one camp can be raided and how many notes can pile up.
 *
 * Both readers must share a profile and each must follow the other (for a
 * followers-only reader, a follow they accepted), the camp must be on its
 * reader's profile, and that reader must have switched raids on
 * (`raidable` on the profile). Since app 1.5.10 it is off until the reader
 * turns it on: a reader who never touched the switch (no `raidable` at all)
 * cannot be raided, whatever an older app assumed.
 */

const MAX_STARS = 3;
/** The most raids kept waiting for one reader; a newer one pushes the oldest out. */
const RAIDS_WAITING = 20;
const TARGET_LIMIT = 50;
/** The most ids one acknowledgement names: every raid that can be waiting, several times over. */
const MAX_ACKNOWLEDGED = 100;

/** The UTC date a raid counts against: one a day, per raider, per camp. */
const utcDay = (now) => now.toISOString().slice(0, 10);

/** What a reader is called: the name they chose, or their handle. */
const nameOf = (profile) => profile.displayName ?? profile.handle;

/** Whether a profile shows a camp at all. */
const hasCamp = (profile) => typeof profile.camp === "object" && profile.camp !== null;

/**
 * What recording a raid needs of each of the two readers, so that neither
 * whole profile (a shelf, the badges, a camp of up to 3 KB) is read to make
 * a note of five things. Of the raider, what they are called. Of the reader
 * raided, the switch, and of their camp only that there is one: a single
 * number of it is asked for, which comes back inside a `camp` where there is
 * a camp and not at all where there is none, so `hasCamp` reads it as it
 * would the whole.
 */
const RAIDER_FIELDS = { handle: 1, displayName: 1, visibility: 1 };
const RAIDED_FIELDS = { handle: 1, visibility: 1, raidable: 1, "camp.camps": 1 };
/** Of a raider whose raid is waiting, only whether they still share a profile. */
const SHARING_FIELDS = { handle: 1, visibility: 1 };

export function raidRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const writes = limiter(limits.social ?? defaultLimits().social);
  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  /**
   * Whose camp the reader could raid: the readers they follow who follow them
   * back, who show a camp and have not switched raids off, by handle, at most
   * fifty. Each comes with the camp as their profile shows it (which a friend
   * may already see there) and whether this reader has raided it today (UTC).
   *
   * A reader whose own profile is not shared has nobody to raid: an empty
   * list, not an error, since nothing they asked to do is being refused.
   *
   * Five queries at most, however many readers are followed, stopping as
   * soon as there is nobody left to ask about. The last three are each told
   * which index to use. For each the database has a second it could take,
   * which reads far more than is wanted (every reader who follows this one;
   * every profile there is, in order of handle; every raid ever made on a
   * friend), and which of the two it picks changes with the data. Named, the
   * cost is known: a seek for each reader followed (500 at most), then one
   * for each friend, and only the friends' profiles are fetched.
   */
  router.get(
    "/raids/targets",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const me = await profiles(db).findOne({ _id: meId }, { projection: { handle: 1, visibility: 1 } });
      if (!isSocial(me)) {
        response.json({ targets: [] });
        return;
      }
      const followed = (await followedIds(db, meId)).filter((id) => !id.equals(meId));
      // Which of them follow back. One pair is one row, so no more rows than
      // readers followed, and with no `_id` asked for none is fetched.
      const back = followed.length
        ? await follows(db)
            .find({ followerId: { $in: followed }, followeeId: meId }, { projection: { _id: 0, followerId: 1 }, hint: "pair" })
            .toArray()
        : [];
      const friends = back.map((row) => row.followerId);
      const rows = friends.length
        ? await profiles(db)
            .find(
              // `raidable` is absent until the switch is first touched, and absent means no (since app 1.5.10).
              {
                _id: { $in: friends },
                visibility: { $in: SOCIAL },
                handle: { $type: "string" },
                camp: { $type: "object" },
                raidable: true
              },
              {
                projection: { handle: 1, displayName: 1, visibility: 1, camp: 1 },
                sort: { handle: 1 },
                limit: TARGET_LIMIT,
                hint: { _id: 1 }
              }
            )
            .toArray()
        : [];
      const camps = rows.filter(isSocial);
      // One raid a day on one camp, so no more rows than camps listed; read
      // from the index alone, as the follows are.
      const raided = camps.length
        ? await raids(db)
            .find(
              { fromId: meId, toId: { $in: camps.map((row) => row._id) }, day: utcDay(new Date()) },
              { projection: { _id: 0, toId: 1 }, hint: "once_a_day" }
            )
            .toArray()
        : [];
      const today = new Set(raided.map((row) => row.toId.toHexString()));
      response.json({
        targets: camps.map((row) => ({
          handle: row.handle,
          name: nameOf(row),
          camp: row.camp,
          raidedToday: today.has(row._id.toHexString())
        }))
      });
    })
  );

  /**
   * Records a raid the reader has just played: `to` (a handle) and `stars`
   * (0 to 3). One a day (UTC) from one reader on one camp. At most twenty
   * wait for the reader raided; a newer one takes the oldest's place, so
   * nobody comes back to an app buried in them.
   *
   * What is kept is who raided whom, the raider's handle and name as they
   * were, the stars and the time: nothing of either camp, and nothing about
   * anybody's reading.
   */
  router.post(
    "/raids",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { to, stars: won } = request.body ?? {};
      const stars = wholeNumber(won, 0, MAX_STARS, "stars");
      const me = await socialSelf(db, request.account.id, RAIDER_FIELDS);
      const them = await socialByHandle(db, to, RAIDED_FIELDS);
      notSelf(me, them, "Your own camp is safe from you.");
      // The block and the two follows are asked about together, and the
      // follows in one query: a pair each way round is two rows of the
      // `pair` index, or it is not a friendship. A block is still what is
      // said first.
      const [blocked, each] = await Promise.all([
        isBlockedPair(db, me._id, them._id),
        follows(db)
          .find(
            { $or: [{ followerId: me._id, followeeId: them._id }, { followerId: them._id, followeeId: me._id }] },
            { projection: { _id: 0, followerId: 1 }, limit: 2 }
          )
          .toArray()
      ]);
      if (blocked) {
        throw new HttpError(403, NO_INTERACTION);
      }
      if (each.length < 2) {
        throw new HttpError(403, "Raids are for friends: a reader you follow who follows you back.");
      }
      if (them.raidable !== true) {
        throw new HttpError(403, "They have switched raids off.");
      }
      if (!hasCamp(them)) {
        throw new HttpError(409, "They have no camp to raid.");
      }

      const now = new Date();
      const raid = {
        fromId: me._id,
        toId: them._id,
        by: me.handle,
        name: nameOf(me),
        stars,
        day: utcDay(now),
        createdAt: now,
        seenAt: null
      };
      try {
        await raids(db).insertOne(raid);
      } catch (error) {
        if (error?.code === 11000) {
          throw dailyLimit("You've already raided their camp today. More tomorrow.", now);
        }
        throw error;
      }
      // Counted with this raid in place, so several landing at the same
      // moment cannot leave more than twenty waiting. The ones pushed out
      // are marked as seen rather than deleted: a raid still stands against
      // its raider's one a day.
      const pushedOut = await raids(db)
        .find({ toId: them._id, seenAt: null }, { projection: { _id: 1 }, sort: { createdAt: -1, _id: -1 }, skip: RAIDS_WAITING })
        .toArray();
      if (pushedOut.length > 0) {
        await raids(db).updateMany({ _id: { $in: pushedOut.map((row) => row._id) }, seenAt: null }, { $set: { seenAt: now } });
      }
      response.status(201).json({ raid: { id: raid._id.toHexString() } });
    })
  );

  /**
   * The raids on the reader's camp that their app has not seen yet, oldest
   * first: `{ id, by, name, stars, at }`, the raider's handle and name being
   * the ones kept with the raid. One from a reader who no longer shares a
   * profile, or on either side of a block, is left out, as that reader is
   * everywhere.
   */
  router.get(
    "/raids",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const rows = await raids(db)
        .find(
          { toId: meId, seenAt: null },
          { projection: { fromId: 1, by: 1, name: 1, stars: 1, createdAt: 1 }, sort: { createdAt: 1, _id: 1 }, limit: RAIDS_WAITING }
        )
        .toArray();
      // Asked every time the camp is opened, and most times nobody has
      // raided it: that is the one query, and the answer.
      if (rows.length === 0) {
        response.json({ raids: [] });
        return;
      }
      // Otherwise two more, at once, about the raiders alone (twenty at
      // most): which still share a profile, read as two fields of it, and
      // which are on either side of a block with this reader.
      const from = rows.map((raid) => raid.fromId);
      const [raiders, blocked] = await Promise.all([
        socialProfilesById(db, from, {}, SHARING_FIELDS),
        blockedAmong(db, meId, from)
      ]);
      const waiting = [];
      for (const raid of rows) {
        const raider = raid.fromId.toHexString();
        if (raiders.has(raider) && !blocked.has(raider)) {
          waiting.push({
            id: raid._id.toHexString(),
            by: raid.by,
            name: raid.name,
            stars: raid.stars,
            at: raid.createdAt.toISOString()
          });
        }
      }
      response.json({ raids: waiting });
    })
  );

  /**
   * Marks raids as seen, so they stop being handed over: `ids`, a list of
   * raid ids. Only raids on the reader's own camp are touched; an id that is
   * somebody else's, already seen or gone is passed over, since an app that
   * never heard the first answer will ask twice.
   */
  router.post(
    "/raids/ack",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const ids = listOf(request.body?.ids, MAX_ACKNOWLEDGED, "ids").map((value) => {
        const id = typeof value === "string" ? objectId(value) : null;
        if (!id) {
          throw new HttpError(400, "ids should be the ids of raids.");
        }
        return id;
      });
      if (ids.length > 0) {
        await raids(db).updateMany({ _id: { $in: ids }, toId: request.account.id, seenAt: null }, { $set: { seenAt: new Date() } });
      }
      response.json({ acknowledged: true });
    })
  );

  return router;
}
