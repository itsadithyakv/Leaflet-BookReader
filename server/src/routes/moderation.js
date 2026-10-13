import { Router } from "express";
import { requireAccount } from "../auth.js";
import { forgetVisitors } from "../boardCache.js";
import { PERSON_FIELDS, personView, socialProfilesById } from "../community.js";
import { accounts, asString, blocks, communities, followRequests, follows, posts, profiles, replies, reports, settings, threads } from "../db.js";
import { deleteCommunity, deletePosts, deleteReplies, deleteThreads } from "../discussion.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { optionalText, wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import { cleanHandle, limiter, notSelf, objectId, socialByHandle, socialSelf } from "../readers.js";
import { REPORT_REASONS, REPORT_TARGETS, afterReport, closeReports, isDiscredited } from "../reports.js";
import { giveBack, spend } from "../tallies.js";
import {
  BLOCK_LIMIT,
  MIN_ACCOUNT_AGE_DAYS,
  accountAgeDays,
  emailConfirmed,
  forgetSuspension,
  publicPostingOn,
  refuseSuspended,
  rememberSuspension,
  requireAdmin,
  suspendedUntil,
  tooNew
} from "../standing.js";
import { HANDLE_PATTERN } from "./social.js";

/**
 * What keeps the public layer civil: the guidelines a reader accepts before
 * posting in public, blocking, reporting, and the admin's tools.
 *
 * There is no moderation team. There is the owner, and these: enough
 * reports act by themselves until the owner has looked (`reports.js`); a
 * reader can block another without anyone's leave; and the owner can remove
 * a thing, suspend a reader for some days, or switch all public posting off
 * while reading goes on.
 */

const REPORTS_PER_DAY = 20;
const ADMIN_QUEUE = 100;
const MAX_SUSPENSION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
const RESOLUTIONS = ["remove", "restore", "dismiss"];
const HOME = { post: posts, thread: threads, reply: replies, community: communities };

export function moderationRoutes(db, limits = defaultLimits(), suspensionSalt = "") {
  const router = Router();
  const auth = requireAccount(db);
  const admin = requireAdmin(db);
  const writes = limiter(limits.social ?? defaultLimits().social);
  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  /**
   * Accepts the community guidelines, once. Posting in public is refused
   * until this has been done, so nobody is held to rules they were never
   * shown. Kept on the profile, so there has to be one.
   */
  router.post(
    "/rules/accept",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { matchedCount } = await profiles(db).updateOne(
        { _id: request.account.id, rulesAcceptedAt: { $not: { $type: "date" } } },
        { $set: { rulesAcceptedAt: new Date() } }
      );
      if (!matchedCount && !(await profiles(db).findOne({ _id: request.account.id }, { projection: { _id: 1 } }))) {
        throw new HttpError(403, "Set up your profile first.");
      }
      response.json({ accepted: true });
    })
  );

  // ---- blocks -----------------------------------------------------------------

  /**
   * Blocks a reader. From then on neither sees the other's posts, threads or
   * replies, neither can follow, cheer, challenge or give to the other, and
   * the blocked reader finds the blocker's profile gone. The follows and
   * requests between the two are removed, both ways. Idempotent.
   */
  router.post(
    "/blocks/:handle",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const meId = request.account.id;
      const them = await socialByHandle(db, request.params.handle);
      notSelf({ _id: meId }, them, "You can't block yourself.");
      if ((await blocks(db).countDocuments({ blockerId: meId })) >= BLOCK_LIMIT) {
        throw new HttpError(409, `You can block up to ${BLOCK_LIMIT} readers.`);
      }
      await blocks(db).updateOne(
        { blockerId: meId, blockedId: them._id },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      await Promise.all([
        follows(db).deleteMany({ $or: [{ followerId: meId, followeeId: them._id }, { followerId: them._id, followeeId: meId }] }),
        followRequests(db).deleteMany({ $or: [{ fromId: meId, toId: them._id }, { fromId: them._id, toId: meId }] })
      ]);
      // A visit needs a follow each way, and there is none now.
      forgetVisitors(meId.toHexString());
      forgetVisitors(them._id.toHexString());
      response.json({ blocked: true });
    })
  );

  /** Unblocks. Works whatever the other reader's visibility now is; the follows do not come back. */
  router.delete(
    "/blocks/:handle",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const handle = cleanHandle(request.params.handle);
      const them = HANDLE_PATTERN.test(handle) ? await profiles(db).findOne({ handle: asString(handle) }, { projection: { _id: 1 } }) : null;
      if (them) {
        await blocks(db).deleteOne({ blockerId: request.account.id, blockedId: them._id });
      }
      response.json({ blocked: false });
    })
  );

  /** The readers the caller has blocked (never who has blocked them), newest first. */
  router.get(
    "/blocks",
    auth,
    asyncHandler(async (request, response) => {
      const rows = await blocks(db)
        .find({ blockerId: request.account.id }, { sort: { createdAt: -1 }, limit: BLOCK_LIMIT })
        .toArray();
      const byId = await socialProfilesById(db, rows.map((row) => row.blockedId), {}, PERSON_FIELDS);
      response.json({
        blocked: rows.map((row) => byId.get(row.blockedId.toHexString())).filter(Boolean).map(personView)
      });
    })
  );

  // ---- reports ----------------------------------------------------------------

  /** What a report is about: its id, and whose it is (to refuse a report of one's own). */
  async function reported(target, body) {
    if (target === "profile") {
      const profile = await socialByHandle(db, body.handle ?? body.id);
      return { targetId: profile._id, ownerId: profile._id };
    }
    const id = objectId(body.id);
    const owner = { post: "userId", thread: "authorId", reply: "authorId", community: "keeperId" }[target];
    const doc = id ? await HOME[target](db).findOne({ _id: id }, { projection: { [owner]: 1 } }) : null;
    if (!doc) {
      throw new HttpError(404, "That is no longer there.");
    }
    return { targetId: doc._id, ownerId: doc[owner] ?? null };
  }

  /**
   * Reports a post, thread, reply, community or profile. Once per reader per
   * thing: reporting it again changes nothing. From a reader who shares a
   * profile, is not suspended, and whose account is three days old, twenty
   * a day at most (a report taken back by deleting what it was about is
   * still one of the day's).
   *
   * Recorded whoever makes it, for the admin to see. Whether it counts
   * towards hiding the thing by itself is another matter (`reports.js`):
   * that takes a confirmed email address, and a reader whose reports have
   * not kept being dismissed. The answer is the same either way, so nobody
   * learns from it whether theirs still count.
   */
  router.post(
    "/reports",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const body = request.body ?? {};
      if (!REPORT_TARGETS.includes(body.target)) {
        throw new HttpError(400, `target is one of ${REPORT_TARGETS.join(", ")}.`);
      }
      if (!REPORT_REASONS.includes(body.reason)) {
        throw new HttpError(400, `reason is one of ${REPORT_REASONS.join(", ")}.`);
      }
      const note = optionalText(body.note, 280, "note");
      const me = await socialSelf(db, request.account.id);
      refuseSuspended(me);
      const account = await accounts(db).findOne({ _id: me._id }, { projection: { createdAt: 1, emailConfirmedAt: 1 } });
      if (accountAgeDays(account) < MIN_ACCOUNT_AGE_DAYS) {
        throw tooNew(MIN_ACCOUNT_AGE_DAYS, "report things");
      }
      const { targetId, ownerId } = await reported(body.target, body);
      if (ownerId?.equals(me._id)) {
        throw new HttpError(400, "That one is yours: you can remove it yourself.");
      }
      const key = { target: body.target, targetId, reporterId: me._id };
      if (!(await reports(db).findOne(key, { projection: { _id: 1 } }))) {
        const now = new Date();
        const counts = emailConfirmed(account) && !(await isDiscredited(db, me._id, now));
        await spend(db, me._id, "report", REPORTS_PER_DAY, `You can make ${REPORTS_PER_DAY} reports a day.`, now);
        const { upsertedCount } = await reports(db).updateOne(
          key,
          { $setOnInsert: { reason: body.reason, note, counts, createdAt: now, resolvedAt: null, resolution: null } },
          { upsert: true }
        );
        if (!upsertedCount) {
          // Sent twice at the same moment: this one was not a new report.
          await giveBack(db, me._id, "report", now);
        } else if (counts) {
          await afterReport(db, body.target, targetId, now);
        }
      }
      response.json({ reported: true });
    })
  );

  // ---- admin ------------------------------------------------------------------
  //
  // Every route below answers a reader who is not an admin exactly as a route
  // that does not exist would (`requireAdmin`).

  /** The thing a report is about, as it stands now, for the admin to judge. Null when it is gone. */
  async function contentOf(target, targetId) {
    if (target === "profile") {
      const profile = await profiles(db).findOne({ _id: targetId });
      return profile?.handle
        ? { person: personView(profile), visibility: profile.visibility ?? "private", suspendedUntil: suspendedUntil(profile)?.toISOString() ?? null }
        : null;
    }
    const doc = await HOME[target](db).findOne({ _id: targetId }, { projection: { memberIds: 0, bannedIds: 0 } });
    if (!doc) {
      return null;
    }
    const writerId = doc.userId ?? doc.authorId ?? doc.keeperId ?? null;
    const writer = writerId ? await profiles(db).findOne({ _id: writerId }) : null;
    return {
      person: writer?.handle ? personView(writer) : null,
      kind: doc.kind ?? null,
      title: doc.title ?? null,
      author: target === "post" || target === "community" ? doc.author ?? null : null,
      body: doc.body ?? null,
      quote: doc.quote ?? null,
      note: doc.note ?? null,
      line: doc.line ?? null,
      spoiler: doc.spoiler ?? null,
      hidden: Boolean(doc.hiddenAt),
      unlisted: target === "community" ? Boolean(doc.unlistedAt) : null,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null
    };
  }

  /**
   * The open reports, one entry per thing reported, the most recently
   * reported first, a hundred at most. Each with the thing as it stands, who
   * wrote it, how many readers reported it and why. Reports of something
   * that has since been deleted are closed on the way and left out.
   */
  router.get(
    "/admin/reports",
    auth,
    admin,
    asyncHandler(async (_request, response) => {
      const groups = await reports(db)
        .aggregate([
          { $match: { resolvedAt: null } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: { target: "$target", targetId: "$targetId" },
              count: { $sum: 1 },
              counting: { $sum: { $cond: [{ $eq: ["$counts", true] }, 1, 0] } },
              reasons: { $push: "$reason" },
              notes: { $push: "$note" },
              latestAt: { $max: "$createdAt" },
              firstAt: { $min: "$createdAt" }
            }
          },
          { $sort: { latestAt: -1 } },
          { $limit: ADMIN_QUEUE }
        ])
        .toArray();
      const out = [];
      for (const group of groups) {
        const { target, targetId } = group._id;
        const content = await contentOf(target, targetId);
        if (!content) {
          await closeReports(db, target, [targetId], "deleted");
          continue;
        }
        const reasons = {};
        for (const reason of group.reasons) {
          reasons[reason] = (reasons[reason] ?? 0) + 1;
        }
        out.push({
          target,
          id: targetId.toHexString(),
          count: group.count,
          // How many of them count towards hiding it by themselves (`reports.js`).
          counting: group.counting,
          reasons,
          notes: group.notes.filter(Boolean).slice(0, 10),
          firstAt: group.firstAt.toISOString(),
          latestAt: group.latestAt.toISOString(),
          content
        });
      }
      response.json({ reports: out });
    })
  );

  /**
   * Settles the reports on one thing.
   *   `remove`   deletes it (a community with its threads and replies; a
   *              profile is not deleted by this: suspend the reader instead).
   *   `restore`  brings back what reports hid or unlisted.
   *   `dismiss`  leaves it exactly as it is.
   * All three close its open reports. `restore` and `dismiss` also mark the
   * thing as looked at, after which reports no longer act on it by
   * themselves.
   */
  router.post(
    "/admin/resolve",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const { target, id, action } = request.body ?? {};
      if (!REPORT_TARGETS.includes(target)) {
        throw new HttpError(400, `target is one of ${REPORT_TARGETS.join(", ")}.`);
      }
      if (!RESOLUTIONS.includes(action)) {
        throw new HttpError(400, `action is one of ${RESOLUTIONS.join(", ")}.`);
      }
      let targetId = objectId(id);
      if (target === "profile" && !targetId) {
        const handle = cleanHandle(id);
        targetId = (HANDLE_PATTERN.test(handle) ? await profiles(db).findOne({ handle: asString(handle) }, { projection: { _id: 1 } }) : null)?._id ?? null;
      }
      if (!targetId) {
        throw new HttpError(404, "That is no longer there.");
      }
      const now = new Date();
      // Closed first, under the admin's own verdict: deleting the thing would
      // otherwise close them as merely "deleted".
      const { modifiedCount } = await reports(db).updateMany(
        { target, targetId, resolvedAt: null },
        { $set: { resolvedAt: now, resolution: action } }
      );
      if (target !== "profile") {
        if (action === "remove") {
          const remove = { post: deletePosts, thread: deleteThreads, reply: deleteReplies }[target];
          await (target === "community" ? deleteCommunity(db, targetId) : remove(db, { _id: targetId }));
        } else {
          const cleared = { clearedAt: now };
          if (action === "restore") {
            Object.assign(cleared, target === "community" ? { unlistedAt: null, reportCount: 0 } : { hiddenAt: null, hiddenBy: null });
          }
          await HOME[target](db).updateOne({ _id: targetId }, { $set: cleared });
        }
      }
      response.json({ resolved: modifiedCount, action });
    })
  );

  /**
   * Suspends a reader from posting for `days` (0 lifts it). While it lasts
   * they can read, and cannot post, react, report, or start, join or write in
   * a community, and what they wrote is shown to nobody but themself.
   *
   * Kept on the profile and on the account: the profile is what every check
   * reads, and the account's copy puts it back if they delete the profile and
   * make another. And remembered against their email address, as a keyed
   * hash, until it ends (`standing.js`), so that deleting the account and
   * signing up again with the same address does not end it either.
   */
  router.post(
    "/admin/suspend",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const days = wholeNumber(request.body?.days, 0, MAX_SUSPENSION_DAYS, "days");
      const handle = cleanHandle(request.body?.handle);
      const them = HANDLE_PATTERN.test(handle) ? await profiles(db).findOne({ handle: asString(handle) }, { projection: { handle: 1 } }) : null;
      if (!them) {
        throw new HttpError(404, "No profile with that handle.");
      }
      const until = days > 0 ? new Date(Date.now() + days * DAY_MS) : null;
      const account = await accounts(db).findOne({ _id: them._id }, { projection: { email: 1 } });
      await Promise.all([
        profiles(db).updateOne({ _id: them._id }, { $set: { suspendedUntil: until } }),
        accounts(db).updateOne({ _id: them._id }, { $set: { suspendedUntil: until } }),
        // Lifting forgets every address it was remembered under; suspending
        // again replaces the date.
        forgetSuspension(db, them._id)
      ]);
      if (until && account?.email) {
        await rememberSuspension(db, them._id, account.email, until, suspensionSalt);
      }
      response.json({ handle: them.handle, suspendedUntil: until?.toISOString() ?? null });
    })
  );

  router.get(
    "/admin/settings",
    auth,
    admin,
    asyncHandler(async (_request, response) => {
      response.json({ publicPosting: await publicPostingOn(db) });
    })
  );

  /**
   * The switch for the whole public layer. Off, every public write (a post
   * for everyone, starting or joining a community, a thread, a reply) is a
   * 503 that says it is paused; reading, and everything between followers,
   * goes on.
   */
  router.put(
    "/admin/settings",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const publicPosting = request.body?.publicPosting;
      if (typeof publicPosting !== "boolean") {
        throw new HttpError(400, "publicPosting must be true or false.");
      }
      await settings(db).updateOne({ _id: "site" }, { $set: { publicPosting, updatedAt: new Date() } }, { upsert: true });
      response.json({ publicPosting });
    })
  );

  return router;
}
