import { Router } from "express";
import { ObjectId } from "mongodb";
import { optionalAccount, requireAccount } from "../auth.js";
import { followedIds, isSocial, minutesFor, personView } from "../community.js";
import { follows, libraries, posts, profiles } from "../db.js";
import { countOf } from "../followCounts.js";
import { HttpError, asyncHandler } from "../http.js";
import { cachedSuggestions, relationsFor, rememberSuggestions } from "../people.js";
import { defaultLimits } from "../rateLimit.js";
import { askedWeek, limiter } from "../readers.js";
import { blockedAmong } from "../standing.js";

/**
 * Finding readers to follow (1.5.15): every public reader, a page at a time,
 * in one of three orders; a few suggested ones; and the reader's own
 * followers and following. Search and the profile are in `community.js`.
 *
 * What may be seen is what may be seen elsewhere:
 *   - browse and suggestions list **public** readers only (with a handle);
 *     a reader who shares with followers only is found by search alone, as
 *     a locked card, and a private one nowhere;
 *   - neither side of a block appears to the other;
 *   - the two lists are the caller's own: in them a followers-only reader
 *     who follows the caller, and whom the caller does not follow, is a
 *     locked card (who, not their reading), as in search.
 *
 * Each list is read straight off an index, twenty at a time, and pages by a
 * cursor (`next`, handed back as `?before=`), never by skipping. A page can
 * hold fewer than twenty when some of it is left out (a block, a reader gone
 * private since); `next` still goes on from where it was read to, and is
 * null only at the end.
 */

const PAGE = 20;
/** How many suggestions are given, and how many are kept per reader to give them from. */
const SUGGESTED = 10;
const SUGGEST_POOL = 30;
/** How far back "Active this week" looks: a week, and a day for time zones ahead of the server's. */
const ACTIVE_DAYS = 8;
const SORTS = ["active", "most", "new"];
/** What a card of a reader shows, and what pages and checks it. */
const CARD_FIELDS = { handle: 1, displayName: 1, avatar: 1, visibility: 1, weekKey: 1, weekMinutes: 1, streak: 1, readDay: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;
const BAD_CURSOR = "That list has moved on. Start again from the top.";

const isHexId = (value) => typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);

/** A cursor as handed out: what the last row was sorted by, as base64url JSON. */
const cursorOf = (parts) => Buffer.from(JSON.stringify(parts)).toString("base64url");

/** A cursor handed back, as its parts; `check` says whether they are what this list's cursors hold. 400 otherwise. */
function partsOf(raw, check) {
  if (raw === undefined || raw === "") {
    return null;
  }
  let parts = null;
  try {
    parts = typeof raw === "string" && raw.length <= 200 ? JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) : null;
  } catch {
    parts = null;
  }
  if (!Array.isArray(parts) || !check(parts)) {
    throw new HttpError(400, BAD_CURSOR);
  }
  return parts;
}

/** A reader as a card in a list: who, their week, and how the caller stands with them. */
function cardOf(row, weekKey, how, locked = false) {
  return {
    ...personView(row),
    visibility: row.visibility,
    locked,
    weekMinutes: locked ? 0 : minutesFor(row, weekKey),
    streak: locked ? 0 : row.streak ?? 0,
    ...(how ? { followState: how.followState, followsYou: how.followsYou } : {})
  };
}

/**
 * The query, order, index and cursor of one way of browsing. `after` is the
 * cursor's parts, or null for the first page; `meId` (or null) is left out.
 */
function browsing(sort, after, meId, weekKey, now) {
  const notMe = meId ? { _id: { $ne: meId } } : {};
  const base = { visibility: "public", handle: { $type: "string" }, ...notMe };
  if (sort === "new") {
    return {
      filter: after ? { ...base, _id: { $lt: new ObjectId(after[0]), ...notMe._id } } : base,
      sort: { _id: -1 },
      hint: "people_new",
      cursor: (row) => [row._id.toHexString()]
    };
  }
  if (sort === "most") {
    // The board's own order and index (`leaderboard`), on past its hundred.
    const filter = { ...base, weekKey, weekMinutes: { $gt: 0 } };
    if (after) {
      const [minutes, streak, handle] = after;
      filter.$or = [
        { weekMinutes: { $lt: minutes } },
        { weekMinutes: minutes, streak: { $lt: streak } },
        { weekMinutes: minutes, streak, handle: { $gt: handle } }
      ];
    }
    return {
      filter,
      sort: { weekMinutes: -1, streak: -1, handle: 1 },
      hint: "leaderboard",
      cursor: (row) => [row.weekMinutes ?? 0, row.streak ?? 0, row.handle]
    };
  }
  // "Active this week": read on a day of the last week, the latest first.
  const since = new Date(now.getTime() - ACTIVE_DAYS * DAY_MS).toISOString().slice(0, 10);
  const filter = { ...base, readDay: { $gte: since, $type: "string" } };
  if (after) {
    const [day, id] = after;
    filter.$or = [{ readDay: { $lt: day } }, { readDay: day, _id: { $lt: new ObjectId(id) } }];
  }
  return {
    filter,
    sort: { readDay: -1, _id: -1 },
    hint: "people_active",
    cursor: (row) => [row.readDay, row._id.toHexString()]
  };
}

/** Whether a cursor's parts are what `sort`'s cursors hold. */
const CURSOR_CHECKS = {
  new: (parts) => parts.length === 1 && isHexId(parts[0]),
  most: (parts) =>
    parts.length === 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && typeof parts[2] === "string" && parts[2].length <= 24,
  active: (parts) => parts.length === 2 && typeof parts[0] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && isHexId(parts[1])
};

export function peopleRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const maybeAuth = optionalAccount(db);
  const fallback = defaultLimits();
  const looks = limiter(limits.people ?? fallback.people);
  const limitLook = (request) => looks(request.account ? `acct:${request.account.id}` : `ip:${request.ip ?? "unknown"}`);

  /**
   * Every public reader, twenty at a time. `sort`:
   *   `active` (the default) readers who read in the last week, the latest
   *            first (by the day they last read, which is never sent);
   *   `most`   this week's minutes, most first: the board, on past its hundred;
   *   `new`    the newest accounts first.
   * Signed in, the caller is left out and each card says how the two stand.
   * Cost: one indexed read of 21 small profiles, and signed in one query for
   * blocks and three for how the two stand, on those twenty ids.
   */
  router.get(
    "/people",
    maybeAuth,
    asyncHandler(async (request, response) => {
      limitLook(request);
      const sort = SORTS.includes(request.query.sort) ? request.query.sort : "active";
      const after = partsOf(request.query.before, CURSOR_CHECKS[sort]);
      const meId = request.account?.id ?? null;
      const weekKey = askedWeek(request.query.week);
      const how = browsing(sort, after, meId, weekKey, new Date());
      const rows = await profiles(db)
        .find(how.filter, { projection: CARD_FIELDS, sort: how.sort, limit: PAGE + 1, hint: how.hint })
        .toArray();
      const page = rows.slice(0, PAGE);
      const next = rows.length > PAGE ? cursorOf(how.cursor(page[page.length - 1])) : null;
      const shown = meId ? await without(db, meId, page) : page;
      const stand = await relationsFor(db, meId, shown.map((row) => row._id));
      response.json({
        sort,
        people: shown.map((row) => cardOf(row, weekKey, meId ? stand.get(row._id.toHexString()) : null)),
        next
      });
    })
  );

  /**
   * Up to ten public readers the caller might follow, each with why:
   *   `{kind: "book", title}`     they posted (for everyone) about a book the
   *                               caller is reading (in the library the
   *                               caller uploaded) or posted about;
   *   `{kind: "follows", count, via}`  followed by `count` of the readers the
   *                               caller followed most lately; `via` names
   *                               one of them, when that one is public.
   * Never a reader already followed, the caller, either side of a block, or
   * one who is not public. Libraries are not looked in: a library is shown
   * only to its owner's followers, and these readers do not follow them yet.
   *
   * Working it out is a handful of indexed queries (the caller's library and
   * posts, posts about those books, the follows of up to fifty readers), so
   * the ids and reasons are kept per reader for ten minutes (`people.js`).
   * Each answer reads those few profiles again (one query), with the blocks
   * and follows among them (three more), so what is shown is never stale on
   * who may be seen.
   */
  router.get(
    "/people/suggested",
    auth,
    asyncHandler(async (request, response) => {
      limitLook(request);
      const meId = request.account.id;
      const weekKey = askedWeek(request.query.week);
      const me = await profiles(db).findOne({ _id: meId }, { projection: { handle: 1, visibility: 1 } });
      if (!isSocial(me)) {
        // Following needs a shared profile, so there is nobody to suggest yet.
        response.json({ people: [] });
        return;
      }
      const key = meId.toHexString();
      let pool = cachedSuggestions(key);
      if (!pool) {
        pool = await suggestionPool(db, meId);
        rememberSuggestions(key, pool);
      }
      const ids = pool.map((entry) => entry.id);
      const viaIds = pool.flatMap((entry) => (entry.via ? [entry.via] : []));
      const [rows, vias] = await Promise.all([
        ids.length
          ? profiles(db).find({ _id: { $in: ids }, visibility: "public", handle: { $type: "string" } }, { projection: CARD_FIELDS }).toArray()
          : [],
        viaIds.length
          ? profiles(db).find({ _id: { $in: viaIds }, visibility: "public", handle: { $type: "string" } }, { projection: { handle: 1, displayName: 1, avatar: 1, visibility: 1 } }).toArray()
          : []
      ]);
      const byId = new Map(rows.map((row) => [row._id.toHexString(), row]));
      const viaById = new Map(vias.map((row) => [row._id.toHexString(), row]));
      const blocked = await blockedAmong(db, meId, rows.map((row) => row._id));
      const stand = await relationsFor(db, meId, rows.map((row) => row._id));
      const people = [];
      for (const entry of pool) {
        const hex = entry.id.toHexString();
        const row = byId.get(hex);
        const how = stand.get(hex);
        if (!row || blocked.has(hex) || how.followState !== "none") {
          continue;
        }
        const via = entry.via ? viaById.get(entry.via.toHexString()) : null;
        const reason =
          entry.kind === "book"
            ? { kind: "book", title: entry.title }
            : { kind: "follows", count: entry.count, via: via ? personView(via) : null };
        people.push({ ...cardOf(row, weekKey, how), reason });
        if (people.length >= SUGGESTED) {
          break;
        }
      }
      response.json({ people });
    })
  );

  /**
   * The caller's followers, or the readers they follow, newest follow first,
   * twenty at a time (`?before=` is the `next` of the page before), with how
   * many there are in all (`count`, kept on the profile). A reader who no
   * longer shares a profile is left out of the page but still counted, as
   * on the profile. Cost: one indexed read of 21 follows, one of their
   * profiles, one for blocks and three for how the two stand.
   */
  const list = (which) =>
    asyncHandler(async (request, response) => {
      limitLook(request);
      const meId = request.account.id;
      const weekKey = askedWeek(request.query.week);
      const before = partsOf(request.query.before, (parts) => parts.length === 1 && isHexId(parts[0]));
      const followers = which === "followers";
      const [mine, theirs, field] = followers
        ? ["followeeId", "followerId", "followerCount"]
        : ["followerId", "followeeId", "followingCount"];
      const [rows, me] = await Promise.all([
        follows(db)
          .find(
            { [mine]: meId, ...(before ? { _id: { $lt: new ObjectId(before[0]) } } : {}) },
            { projection: { _id: 1, [theirs]: 1 }, sort: { _id: -1 }, limit: PAGE + 1, hint: followers ? "followers" : "following" }
          )
          .toArray(),
        profiles(db).findOne({ _id: meId }, { projection: { [field]: 1 } })
      ]);
      const page = rows.slice(0, PAGE);
      const next = rows.length > PAGE ? cursorOf([page[page.length - 1]._id.toHexString()]) : null;
      const ids = page.map((row) => row[theirs]);
      const found = ids.length
        ? await profiles(db).find({ _id: { $in: ids }, visibility: { $in: ["public", "followers"] }, handle: { $type: "string" } }, { projection: CARD_FIELDS }).toArray()
        : [];
      const byId = new Map(found.filter(isSocial).map((row) => [row._id.toHexString(), row]));
      const ordered = ids.map((id) => byId.get(id.toHexString())).filter(Boolean);
      const shown = await without(db, meId, ordered);
      const stand = await relationsFor(db, meId, shown.map((row) => row._id));
      response.json({
        people: shown.map((row) => {
          const how = stand.get(row._id.toHexString());
          // A followers-only reader is seen in full only by the readers they accepted.
          const locked = row.visibility === "followers" && how.followState !== "following";
          return cardOf(row, weekKey, how, locked);
        }),
        next,
        count: countOf(me?.[field])
      });
    });

  router.get("/people/me/followers", auth, list("followers"));
  router.get("/people/me/following", auth, list("following"));

  return router;
}

/** `rows` less the readers on either side of a block with `meId`. */
async function without(db, meId, rows) {
  const blocked = await blockedAmong(db, meId, rows.map((row) => row._id));
  return blocked.size ? rows.filter((row) => !blocked.has(row._id.toHexString())) : rows;
}

/**
 * Whom to suggest, and why, before anything is checked about who may be
 * seen (the answer does that each time): up to thirty, readers of the same
 * books first (at most half), then the readers followed by the readers the
 * caller follows, most followed first. Already followed, and the caller,
 * left out.
 */
async function suggestionPool(db, meId) {
  const followed = new Set((await followedIds(db, meId)).map((id) => id.toHexString()));
  const skip = (id) => id.equals(meId) || followed.has(id.toHexString());

  // The books: those the caller is reading in the library they uploaded (if
  // they did; their own), and those they posted about lately.
  const [shelf, mine, recent] = await Promise.all([
    libraries(db)
      .aggregate([
        { $match: { _id: meId } },
        {
          $project: {
            keys: {
              $slice: [{ $map: { input: { $filter: { input: { $ifNull: ["$books", []] }, cond: { $eq: ["$$this.state", "reading"] } } }, in: "$$this.key" } }, 30]
            }
          }
        }
      ])
      .toArray(),
    posts(db)
      .find({ userId: meId, bookKey: { $type: "string" } }, { projection: { _id: 0, bookKey: 1 }, sort: { createdAt: -1 }, limit: 20 })
      .toArray(),
    follows(db)
      .find({ followerId: meId }, { projection: { _id: 0, followeeId: 1 }, sort: { _id: -1 }, limit: 50, hint: "following" })
      .toArray()
  ]);
  const keys = [...new Set([...(shelf[0]?.keys ?? []), ...mine.map((post) => post.bookKey)])].filter((key) => typeof key === "string").slice(0, 40);
  const [readers, circle] = await Promise.all([
    keys.length
      ? posts(db)
          .aggregate([
            { $match: { bookKey: { $in: keys, $type: "string" }, audience: "everyone", hiddenAt: null } },
            { $sort: { createdAt: -1 } },
            { $limit: 200 },
            { $group: { _id: "$userId", title: { $first: "$title" }, at: { $first: "$createdAt" } } },
            { $sort: { at: -1 } },
            { $limit: 40 }
          ])
          .toArray()
      : [],
    recent.length
      ? follows(db)
          .aggregate([
            { $match: { followerId: { $in: recent.map((row) => row.followeeId) } } },
            { $limit: 5000 },
            { $group: { _id: "$followeeId", count: { $sum: 1 }, via: { $first: "$followerId" } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 60 }
          ])
          .toArray()
      : []
  ]);

  const pool = [];
  const taken = new Set();
  const add = (entry) => {
    const hex = entry.id.toHexString();
    if (taken.has(hex) || skip(entry.id) || pool.length >= SUGGEST_POOL) {
      return;
    }
    taken.add(hex);
    pool.push(entry);
  };
  const books = readers.map((row) => ({ id: row._id, kind: "book", title: String(row.title ?? "").slice(0, 160) }));
  const others = circle.map((row) => ({ id: row._id, kind: "follows", count: row.count, via: row.via }));
  for (const entry of books.slice(0, SUGGEST_POOL / 2)) add(entry);
  for (const entry of others) add(entry);
  for (const entry of books) add(entry);
  return pool;
}
