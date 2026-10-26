import { Router } from "express";
import { LIVE_MAX, announcementView, cleanAnnouncement, isLive } from "../announcements.js";
import { requireAccount } from "../auth.js";
import { forgetVisitors } from "../boardCache.js";
import { PERSON_FIELDS, personView, socialProfilesById } from "../community.js";
import { accounts, asString, blocks, communities, followRequests, posts, profiles, replies, reports, settings, threads } from "../db.js";
import { removeFollow } from "../followCounts.js";
import { forgetSuggestions } from "../people.js";
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
        // One at a time, so each side's counts move with it (`followCounts.js`).
        removeFollow(db, meId, them._id),
        removeFollow(db, them._id, meId),
        followRequests(db).deleteMany({ $or: [{ fromId: meId, toId: them._id }, { fromId: them._id, toId: meId }] })
      ]);
      // A visit needs a follow each way, and there is none now.
      forgetVisitors(meId.toHexString());
      forgetVisitors(them._id.toHexString());
      forgetSuggestions(meId.toHexString());
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

  // ---- the update notice ------------------------------------------------------
  //
  // The owner says a newer Leaflet is out, from the admin panel, and every app
  // newer than this server's first notice asks for it now and then and offers
  // the update to a reader who is behind. The Store updates most installs by
  // itself, but not all, and not soon. Asked for without an account (most
  // readers have none), so the answer is kept a minute in memory: hundreds of
  // apps asking cost one read a minute at most.
  //
  // The owner's announcements (`announcements.js`) come in the same answer and
  // the same read, so they cost no more: the notice's document and theirs are
  // fetched together, and one that has run out is left out when it is sent.
  let noticeKept = null;
  const readNotice = async () => {
    if (noticeKept && Date.now() - noticeKept.at < NOTICE_KEPT_MS) return noticeKept.value;
    const docs = await settings(db)
      .find({ _id: { $in: ["notice", "announcements"] } }, { projection: { version: 1, note: 1, updatedAt: 1, items: 1 } })
      .toArray();
    const doc = docs.find((found) => found._id === "notice");
    const items = docs.find((found) => found._id === "announcements")?.items ?? [];
    const value = {
      notice: { version: doc?.version ?? null, note: doc?.note ?? null, at: doc?.updatedAt ? doc.updatedAt.toISOString() : null },
      items
    };
    noticeKept = { at: Date.now(), value };
    return value;
  };

  router.get(
    "/notice",
    asyncHandler(async (_request, response) => {
      const { notice, items } = await readNotice();
      const live = items.filter((item) => isLive(item)).map(announcementView);
      // Nothing personal is in it, and every app gets the same: a cache on the
      // way may keep it as long as this server does.
      response.set("Cache-Control", `public, max-age=${NOTICE_KEPT_MS / 1000}`);
      // Only when there are any, so the answer is as it always was otherwise.
      response.json(live.length > 0 ? { ...notice, announcements: live } : notice);
    })
  );

  /**
   * The newest version, and a line about it (optional). `version: null` takes
   * the notice down. A version is two to four whole numbers with dots ("1.4.2").
   */
  router.put(
    "/admin/notice",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const version = request.body?.version ?? null;
      const rawNote = request.body?.note ?? null;
      if (version !== null && (typeof version !== "string" || !/^\d{1,4}(\.\d{1,4}){1,3}$/.test(version))) {
        throw new HttpError(400, "A version is numbers with dots, like 1.4.2.");
      }
      if (rawNote !== null && typeof rawNote !== "string") {
        throw new HttpError(400, "The note must be text.");
      }
      const note = rawNote === null ? null : rawNote.trim().replace(/\s+/g, " ").slice(0, NOTICE_NOTE_MAX) || null;
      const updatedAt = new Date();
      await settings(db).updateOne({ _id: "notice" }, { $set: { version, note: version === null ? null : note, updatedAt } }, { upsert: true });
      noticeKept = null;
      response.json({ version, note: version === null ? null : note, at: updatedAt.toISOString() });
    })
  );

  // ---- announcements ----------------------------------------------------------

  const keptAnnouncements = async () =>
    (await settings(db).findOne({ _id: "announcements" }, { projection: { items: 1 } }))?.items ?? [];

  /** Every announcement kept, live or run out, newest first, with whether it is still shown. */
  router.get(
    "/admin/announcements",
    auth,
    admin,
    asyncHandler(async (_request, response) => {
      const now = new Date();
      const items = await keptAnnouncements();
      response.json({
        announcements: [...items].reverse().map((item) => ({ ...announcementView(item), live: isLive(item, now) })),
        liveMax: LIVE_MAX
      });
    })
  );

  /**
   * Publishes one: `{title, body, link?, audience?, expiresAt?}` (see
   * `cleanAnnouncement`). Ones that have run out are cleared away on the way;
   * with `LIVE_MAX` still live, it is refused until one is withdrawn.
   */
  router.post(
    "/admin/announcements",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const now = new Date();
      const made = cleanAnnouncement(request.body, now);
      const live = (await keptAnnouncements()).filter((item) => isLive(item, now));
      if (live.length >= LIVE_MAX) {
        throw new HttpError(409, `Up to ${LIVE_MAX} announcements can be up at once. Withdraw one first.`);
      }
      await settings(db).updateOne({ _id: "announcements" }, { $set: { items: [...live, made], updatedAt: now } }, { upsert: true });
      noticeKept = null;
      response.status(201).json({ ...announcementView(made), live: true });
    })
  );

  /** Withdraws one: apps stop showing it at their next look at the notice. */
  router.delete(
    "/admin/announcements/:id",
    auth,
    admin,
    asyncHandler(async (request, response) => {
      const id = String(request.params.id);
      const { modifiedCount } = /^[0-9a-f]{12}$/.test(id)
        ? await settings(db).updateOne({ _id: "announcements", "items.id": id }, { $pull: { items: { id } }, $set: { updatedAt: new Date() } })
        : { modifiedCount: 0 };
      if (!modifiedCount) {
        throw new HttpError(404, "That announcement is no longer up.");
      }
      noticeKept = null;
      response.json({ withdrawn: true });
    })
  );

  return router;
}

/** How long the notice is kept in memory between reads, and the longest note. */
const NOTICE_KEPT_MS = 60_000;
export const NOTICE_NOTE_MAX = 160;
