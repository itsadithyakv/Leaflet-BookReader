import express, { Router } from "express";
import { ObjectId } from "mongodb";
import { requireAccount } from "../auth.js";
import { lastBackup } from "../backup/note.js";
import { accounts, errorKinds, problems, reports } from "../db.js";
import { cleanBatch, keepBatch, listKinds, markKind } from "../errorKinds.js";
import { asyncHandler, smallJson } from "../http.js";
import { defaultLimits } from "../rateLimit.js";
import { limiter } from "../readers.js";
import { requireAdmin } from "../standing.js";

/**
 * The owner's overview of Leaflet as a whole, and the error kinds the apps
 * send by themselves (`errorKinds.js`).
 *
 * The overview is what opening the admin page costs, so it is a handful of
 * reads, each served from an index or from the database's own counts, and
 * kept a minute in memory: opened ten times in that minute it is read once.
 * The collections' sizes are more reads (one a collection) and change
 * slowly, so they are kept a quarter of an hour.
 *
 * Every admin route answers anyone else as a route that does not exist
 * (`requireAdmin`). Sending errors needs no account and is never signed in,
 * so a report says nothing about who sent it; it is held to a few an hour
 * from one address, and to a small body.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERVIEW_KEPT_MS = 60_000;
const SIZES_KEPT_MS = 15 * 60_000;
/** What a free Atlas cluster holds (M0: 512 MB), which the overview measures against. */
export const STORAGE_QUOTA = 512 * 1024 * 1024;
/** A batch is twenty kinds of a couple of hundred characters each; 24 KB is room and to spare. */
const errorsJson = express.json({ limit: "24kb" });

const startOfUtcDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * The database's size, and how much of the free cluster it takes. Atlas
 * counts a free cluster's data and indexes as they are, before compression,
 * so that is what is measured. Null if the cluster will not say.
 */
async function storageOf(db) {
  try {
    const stats = await db.command({ dbStats: 1 });
    const used = (stats.dataSize ?? 0) + (stats.indexSize ?? 0);
    return {
      usedBytes: used,
      dataBytes: stats.dataSize ?? 0,
      indexBytes: stats.indexSize ?? 0,
      onDiskBytes: (stats.storageSize ?? 0) + (stats.indexSize ?? 0),
      documents: stats.objects ?? 0,
      quotaBytes: STORAGE_QUOTA
    };
  } catch {
    return null;
  }
}

/** Each collection's size (data and indexes), largest first, or null if the cluster will not say. */
async function collectionSizes(db) {
  try {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name).filter((name) => !name.startsWith("system."));
    const sizes = [];
    for (const name of names) {
      const [stats] = await db
        .collection(name)
        .aggregate([{ $collStats: { storageStats: {} } }])
        .toArray();
      const storage = stats?.storageStats;
      if (storage) {
        sizes.push({ name, bytes: (storage.size ?? 0) + (storage.totalIndexSize ?? 0), documents: storage.count ?? 0 });
      }
    }
    return sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 12);
  } catch {
    return null;
  }
}

/** The readers: how many accounts, new this week, used today and in the last 7 and 30 days, and from which apps. */
async function readersOf(db, now) {
  const today = startOfUtcDay(now);
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const month = new Date(now.getTime() - 30 * DAY_MS);
  const [total, joined, [used]] = await Promise.all([
    accounts(db).estimatedDocumentCount(),
    // An account's id carries when it was made, and the id's own index answers this.
    accounts(db).countDocuments({ _id: { $gte: ObjectId.createFromTime(Math.floor(week.getTime() / 1000)) } }),
    accounts(db)
      .aggregate([
        { $match: { lastSeenAt: { $gte: month } } },
        { $project: { _id: 0, lastSeenAt: 1, version: "$client.version", platform: "$client.platform" } },
        {
          $facet: {
            active: [
              {
                $group: {
                  _id: null,
                  today: { $sum: { $cond: [{ $gte: ["$lastSeenAt", today] }, 1, 0] } },
                  week: { $sum: { $cond: [{ $gte: ["$lastSeenAt", week] }, 1, 0] } },
                  month: { $sum: 1 }
                }
              }
            ],
            versions: [{ $group: { _id: "$version", readers: { $sum: 1 } } }, { $sort: { readers: -1 } }, { $limit: 12 }],
            platforms: [{ $group: { _id: "$platform", readers: { $sum: 1 } } }, { $sort: { readers: -1 } }]
          }
        }
      ])
      .toArray()
  ]);
  const active = used?.active?.[0] ?? { today: 0, week: 0, month: 0 };
  // An account last used from an app older than 1.5.12 has no version: "unknown".
  const named = (rows) => (rows ?? []).map((row) => ({ name: row._id ?? "unknown", readers: row.readers }));
  return {
    accounts: total,
    newThisWeek: joined,
    activeToday: active.today,
    active7: active.week,
    active30: active.month,
    versions: named(used?.versions),
    platforms: named(used?.platforms)
  };
}

/** What waits for the owner: problem reports and reported things, open; and the errors of the last week. */
async function queuesOf(db, now) {
  const week = new Date(startOfUtcDay(now).getTime() - 6 * DAY_MS);
  const [openProblems, [reported], [errors]] = await Promise.all([
    problems(db).countDocuments({ status: "open" }),
    reports(db)
      .aggregate([{ $match: { resolvedAt: null } }, { $group: { _id: { target: "$target", targetId: "$targetId" } } }, { $count: "things" }])
      .toArray(),
    errorKinds(db)
      .aggregate([
        { $match: { at: { $gte: week } } },
        {
          $facet: {
            kinds: [{ $group: { _id: "$sig" } }, { $count: "kinds" }],
            days: [{ $group: { _id: "$day", count: { $sum: "$count" } } }, { $sort: { _id: 1 } }]
          }
        }
      ])
      .toArray()
  ]);
  return {
    openProblems,
    openReports: reported?.things ?? 0,
    errorKinds7: errors?.kinds?.[0]?.kinds ?? 0,
    errorDays: (errors?.days ?? []).map((row) => ({ day: row._id, count: row.count }))
  };
}

export function adminRoutes(db, limits = defaultLimits(), stats = null) {
  const router = Router();
  const auth = requireAccount(db);
  const admin = requireAdmin(db);
  const fromAddress = limiter(limits.errors ?? defaultLimits().errors);
  const newPerDay = limits.errorKindsPerDay;

  let kept = null;
  let sizesKept = null;
  const sizes = async (now) => {
    if (!sizesKept || now - sizesKept.at >= SIZES_KEPT_MS) {
      sizesKept = { at: now, value: await collectionSizes(db) };
    }
    return sizesKept.value;
  };
  const overview = async () => {
    const now = Date.now();
    if (kept && now - kept.at < OVERVIEW_KEPT_MS) {
      return kept.value;
    }
    // Asked for again while it is being read: the same answer, not a second read.
    const reading = (async () => {
      const at = new Date(now);
      const [readers, queues, storage, collections, backup] = await Promise.all([
        readersOf(db, at),
        queuesOf(db, at),
        storageOf(db),
        sizes(now),
        lastBackup(db).catch(() => null)
      ]);
      return { at: at.toISOString(), readers, queues, storage, collections, backup };
    })();
    kept = { at: now, value: reading };
    try {
      return await reading;
    } catch (error) {
      kept = null;
      throw error;
    }
  };

  /**
   * Everything at a glance: readers, versions and platforms, what waits, the
   * database's size, the last backup that went through (`backup/note.js`;
   * null when none has been noted), and this server's own requests since it started (from
   * memory, as of the moment asked, so never kept).
   */
  router.get(
    "/admin/overview",
    auth,
    admin,
    asyncHandler(async (_request, response) => {
      const value = await overview();
      response.json({ ...value, server: stats ? stats.summary() : null });
    })
  );

  /** The error kinds, one row a kind: open (unless asked for "fixed" or "all"), the most recently seen first. */
  router.get(
    "/admin/errors",
    auth,
    admin,
    asyncHandler(async (request, response) => {
      const status = ["open", "fixed", "all"].includes(request.query.status) ? request.query.status : "open";
      response.json({ errors: await listKinds(db, status) });
    })
  );

  /** Marks a kind fixed in a version (`{fixedIn: "1.5.12"}`), or open again (`{fixedIn: null}`). */
  router.post(
    "/admin/errors/:sig",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const fixedIn = request.body?.fixedIn ?? null;
      response.json(await markKind(db, String(request.params.sig), fixedIn));
    })
  );

  /**
   * One app's batch of error kinds: `{version, platform, kinds: [{name,
   * message, frames, count, version?}]}`, at most twenty. Any sign-in sent
   * with it is not looked at. Answered 202 with how many were counted.
   */
  router.post(
    "/errors",
    (request, _response, next) => {
      fromAddress(`ip:${request.ip ?? "unknown"}`);
      next();
    },
    errorsJson,
    asyncHandler(async (request, response) => {
      const batch = cleanBatch(request.body);
      const counted = await keepBatch(db, batch, new Date(), newPerDay);
      response.status(202).json({ counted });
    })
  );

  return router;
}
