import { Router } from "express";
import { requireAccount } from "../auth.js";
import { personView, socialProfilesById } from "../community.js";
import { events, follows, gifts } from "../db.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { defaultLimits } from "../rateLimit.js";
import { WHO_FIELDS, dailyLimit, limiter, notSelf, objectId, socialByHandle, socialSelf, utcDayStart } from "../readers.js";
import { blockedAmong, refuseBlocked } from "../standing.js";

/**
 * Gifts between friends: something from the Pip shop, sent to a reader who
 * follows back.
 *
 * A gift here is only a note of what was given: a kind and an item's id.
 * Like a duel's stake, what it costs and what it unlocks is the two apps'
 * business; this server holds nobody's seeds or wardrobe, and does not know
 * the shop. It carries the note to the receiver, keeps it until they claim
 * it, and bounds how many can be sent and how many can pile up.
 *
 * Both readers must share a profile and each must follow the other (for a
 * followers-only reader, a follow they accepted): a gift lands in someone's
 * app, so it only comes from a reader they chose.
 */

const GIFT_KINDS = new Set(["accessory", "room", "wallpaper", "flooring", "skin", "move"]);
const ITEM_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const GIFTS_PER_DAY = 5;
const GIFTS_WAITING = 20;
/**
 * What a waiting gift shows of its sender (`personView`), and what says they
 * still share a profile: the rest of a profile (a shelf, the badges, a camp
 * of up to 3 KB) is not read to show a name and an avatar.
 */
const SENDER_FIELDS = { handle: 1, displayName: 1, avatar: 1, visibility: 1 };

export function giftRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const writes = limiter(limits.social ?? defaultLimits().social);
  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  /**
   * Sends a gift. At most five a day (UTC) from one reader, and at most
   * twenty unclaimed ones waiting for one receiver, so nobody comes back to
   * an app buried in them.
   */
  router.post(
    "/gifts",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { to, kind, itemId } = request.body ?? {};
      if (!GIFT_KINDS.has(kind)) {
        throw new HttpError(400, `kind is one of ${[...GIFT_KINDS].join(", ")}.`);
      }
      if (typeof itemId !== "string" || !ITEM_PATTERN.test(itemId)) {
        throw new HttpError(400, "itemId should be an item's id, like top_hat.");
      }
      const me = await socialSelf(db, request.account.id, WHO_FIELDS);
      const them = await socialByHandle(db, to, WHO_FIELDS);
      notSelf(me, them, "A gift to yourself is just shopping.");
      await refuseBlocked(db, me._id, them._id);
      const [mine, theirs] = await Promise.all([
        follows(db).findOne({ followerId: me._id, followeeId: them._id }, { projection: { _id: 1 } }),
        follows(db).findOne({ followerId: them._id, followeeId: me._id }, { projection: { _id: 1 } })
      ]);
      if (!mine || !theirs) {
        throw new HttpError(403, "Gifts are for friends: a reader you follow who follows you back.");
      }

      const now = new Date();
      const sentToday = { fromId: me._id, createdAt: { $gte: utcDayStart(now) } };
      const waiting = { toId: them._id, claimedAt: null };
      const spent = () => dailyLimit(`You can send ${GIFTS_PER_DAY} gifts a day. More tomorrow.`, now);
      const piled = () => new HttpError(409, "They have a pile of gifts to open first. Try again later.");
      if ((await gifts(db).countDocuments(sentToday)) >= GIFTS_PER_DAY) {
        throw spent();
      }
      if ((await gifts(db).countDocuments(waiting)) >= GIFTS_WAITING) {
        throw piled();
      }
      const gift = { fromId: me._id, toId: them._id, kind, itemId, createdAt: now, claimedAt: null };
      await gifts(db).insertOne(gift);
      // Both counted again with this gift in place, as for duels: several
      // sent at the same moment each saw room. One too many is taken back.
      const [sent, pile] = await Promise.all([gifts(db).countDocuments(sentToday), gifts(db).countDocuments(waiting)]);
      if (sent > GIFTS_PER_DAY || pile > GIFTS_WAITING) {
        await gifts(db).deleteOne({ _id: gift._id });
        throw sent > GIFTS_PER_DAY ? spent() : piled();
      }
      await events(db).insertOne({ userId: them._id, type: "gift", actorId: me._id, refId: gift._id, createdAt: now });
      response.status(201).json({ gift: { id: gift._id.toHexString() } });
    })
  );

  /**
   * The gifts waiting for the reader, oldest first. One from a reader who no
   * longer shares a profile is left out, as that reader is everywhere; it is
   * there again if they share again.
   */
  router.get(
    "/gifts",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const rows = await gifts(db)
        .find(
          { toId: meId, claimedAt: null },
          { projection: { fromId: 1, kind: 1, itemId: 1, createdAt: 1 }, sort: { createdAt: 1 }, limit: GIFTS_WAITING }
        )
        .toArray();
      // Most times nothing is waiting: that is the one query, and the answer.
      if (rows.length === 0) {
        response.json({ gifts: [] });
        return;
      }
      // Otherwise two more, at once, about the senders alone (twenty at
      // most): the little of each profile that is shown, and which of them
      // are on either side of a block with this reader. Not every block the
      // reader is in, which can be thousands of rows.
      const from = rows.map((gift) => gift.fromId);
      const [senders, blocked] = await Promise.all([
        socialProfilesById(db, from, {}, SENDER_FIELDS),
        blockedAmong(db, meId, from)
      ]);
      const waiting = [];
      for (const gift of rows) {
        const sender = senders.get(gift.fromId.toHexString());
        if (sender && !blocked.has(gift.fromId.toHexString())) {
          waiting.push({
            id: gift._id.toHexString(),
            from: personView(sender),
            kind: gift.kind,
            itemId: gift.itemId,
            createdAt: gift.createdAt.toISOString()
          });
        }
      }
      response.json({ gifts: waiting });
    })
  );

  /**
   * Marks a gift as taken, so it stops being offered. Only its receiver can;
   * claiming one already claimed is a yes again, since an app that never
   * heard the first answer will ask twice.
   */
  router.post(
    "/gifts/:id/claim",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const mine = { _id: id, toId: request.account.id };
      const { matchedCount } = id
        ? await gifts(db).updateOne({ ...mine, claimedAt: null }, { $set: { claimedAt: new Date() } })
        : { matchedCount: 0 };
      if (!matchedCount && !(id && (await gifts(db).findOne(mine, { projection: { _id: 1 } })))) {
        throw new HttpError(404, "No such gift.");
      }
      response.json({ claimed: true });
    })
  );

  return router;
}
