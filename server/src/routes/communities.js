import { Router } from "express";
import { requireAccount } from "../auth.js";
import { isSocial, personView } from "../community.js";
import { accounts, asString, communities, profiles, replies, threads } from "../db.js";
import { deleteReplies, deleteThreads, leaveCommunities } from "../discussion.js";
import { HttpError, asyncHandler, plainText, smallJson } from "../http.js";
import { optionalText, record, requiredLines, requiredText, wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import { myReactions, react, reactionValue, reactionView } from "../reactions.js";
import { cleanHandle, findSocial, limiter, objectId, socialSelf } from "../readers.js";
import {
  accountAgeDays,
  blockedWith,
  goodStanding,
  idsOf,
  isAdmin,
  provenAccount,
  refuseSuspended,
  requireAdmin,
  tooNew,
  withAuthor
} from "../standing.js";
import { giveBack, spend } from "../tallies.js";
import { HANDLE_PATTERN } from "./social.js";

/**
 * Book communities: one place to talk about one book, or one series.
 *
 * What keeps them from being abused is mostly what they are not. A community
 * is not a name somebody thought up: it is keyed by a book or a series, and
 * the unique index allows one per key, so there is nothing to squat, no
 * second "official" one to split or impersonate the first, and nobody can
 * open twenty rooms about nothing. Starting one takes an account that is a
 * week old, in good standing (`standing.js`), and at most one a day and five
 * kept at a time.
 *
 * And a new one is invisible. Until three established readers have joined, a
 * community is in no directory and no search: it is reached only by its
 * book's key, from that book in the app. The server has no catalogue to
 * check a key or a title against, so anyone can make up a "book" with any
 * title; unlisted, such a thing is seen by its maker and by whoever goes
 * looking for that exact key, until three accounts, each at least a week old
 * with a confirmed address, have put their names to it. (A week, not the
 * three days it takes to join: three accounts made together on Monday can
 * join on Thursday, and still list nothing until the Monday after.) Once
 * listed it stays listed whoever leaves (`listedAt`), so a directory entry
 * does not flicker; five reports that count, or the admin, take it back out
 * (`unlistedAt`, which wins).
 *
 * Its first member is its keeper, who can pin threads, remove threads and
 * replies, and remove (and so ban) a member. Posting needs membership and
 * good standing; reading needs only a shared profile, so a reader can look
 * before joining.
 */

/** Established members (see `settleListing`) a community needs before it is listed. */
export const LISTED_AT = 3;
/** Members a keeper can remove in one UTC day. A purge of everyone who disagreed takes longer than a temper lasts. */
const REMOVALS_PER_DAY = 10;
/** How many of a community's members are looked at to decide whether it can be listed. */
const LISTING_SAMPLE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days an account must have existed to start a community (longer than to post). */
export const COMMUNITY_AGE_DAYS = 7;
const KEEPS_LIMIT = 5;
const MEMBERSHIP_LIMIT = 50;
/** Members' ids are kept on the community itself; this bounds the document. */
const COMMUNITY_SIZE = 50_000;
const DIRECTORY_LIMIT = 30;
const THREAD_PAGE = 30;
const REPLY_PAGE = 100;
const COMMUNITIES_PER_DAY = 1;
const THREADS_PER_DAY = 5;
const REPLIES_PER_DAY = 60;
const PINNED_LIMIT = 3;
const EXCERPT = 200;
const KINDS = ["book", "series"];
const MAX_KEY = 160;
const NO_SUCH_COMMUNITY = "No such community.";
const NO_SUCH_THREAD = "No such thread.";
const NO_SUCH_REPLY = "No such reply.";
const BANNED = "You can't take part in this community.";
const JOIN_FIRST = "Join the community to post in it.";

function cleanKey(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!key || key.length > MAX_KEY) {
    throw new HttpError(400, `key should be text, up to ${MAX_KEY} characters.`);
  }
  return key;
}

const cleanKind = (value) => {
  if (!KINDS.includes(value)) {
    throw new HttpError(400, "kind is book or series.");
  }
  return value;
};

/**
 * How far into the book a thread talks: null for no spoilers, `{ percent }`
 * (1 to 100) in a book's community, `{ book }` (1 to 99, "up to book N") in
 * a series'. Only stored: the app hides what is past the reader's own place.
 */
function cleanSpoiler(value, kind) {
  if (value === undefined || value === null) {
    return null;
  }
  const spoiler = record(value, "spoiler");
  return kind === "series"
    ? { book: wholeNumber(spoiler.book, 1, 99, "spoiler.book") }
    : { percent: wholeNumber(spoiler.percent, 1, 100, "spoiler.percent") };
}

const asDate = (value) => {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function communityRoomRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const fallback = defaultLimits();
  const writes = limiter(limits.social ?? fallback.social);
  const taps = limiter(limits.react ?? fallback.react);
  const lookups = limiter(limits.search ?? fallback.search);
  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  // ---- communities ----------------------------------------------------------

  /**
   * Communities as `meId` stands to them, without their lists of members:
   * those can be tens of thousands of ids, and all a request needs of them is
   * whether this one reader is on each.
   */
  const load = (match, meId, { sort = { _id: 1 }, limit = 1 } = {}) =>
    communities(db)
      .aggregate([
        { $match: match },
        { $sort: sort },
        { $limit: limit },
        {
          $addFields: {
            isMember: { $in: [meId, { $ifNull: ["$memberIds", []] }] },
            isBanned: { $in: [meId, { $ifNull: ["$bannedIds", []] }] }
          }
        },
        { $project: { memberIds: 0, bannedIds: 0 } }
      ])
      .toArray();

  const one = async (match, meId) => (await load(match, meId))[0] ?? null;

  const view = (community, meId) => ({
    id: community._id.toHexString(),
    kind: community.kind,
    key: community.key,
    title: community.title,
    author: community.author ?? null,
    memberCount: Math.max(0, community.memberCount ?? 0),
    threadCount: Math.max(0, community.threadCount ?? 0),
    isMember: community.isMember === true,
    isKeeper: Boolean(community.keeperId?.equals(meId)),
    listed: Boolean(community.listedAt) && !community.unlistedAt,
    createdAt: community.createdAt.toISOString()
  });

  /**
   * Lists a community the first time it has three established members:
   * accounts at least a week old, at a confirmed address. Asked whenever an
   * unlisted community with enough members is joined or looked up (an account
   * turns a week old without anything happening here to mark it). Once set,
   * `listedAt` is never unset by anyone leaving.
   */
  async function settleListing(community) {
    if (community.listedAt || (community.memberCount ?? 0) < LISTED_AT) {
      return community;
    }
    const now = new Date();
    const { memberIds = [] } =
      (await communities(db).findOne({ _id: community._id }, { projection: { memberIds: { $slice: LISTING_SAMPLE } } })) ?? {};
    const established = await accounts(db).countDocuments({
      _id: { $in: memberIds },
      emailConfirmedAt: { $type: "date" },
      createdAt: { $lte: new Date(now.getTime() - COMMUNITY_AGE_DAYS * DAY_MS) }
    });
    if (established < LISTED_AT) {
      return community;
    }
    await communities(db).updateOne({ _id: community._id, listedAt: null }, { $set: { listedAt: now } });
    return { ...community, listedAt: now };
  }

  /** The community with that id as the reader stands to it, or a 404. */
  async function byId(request) {
    const id = objectId(request.params.id);
    const community = id ? await one({ _id: id }, request.account.id) : null;
    if (!community) {
      throw new HttpError(404, NO_SUCH_COMMUNITY);
    }
    return community;
  }

  /** For reading: a shared profile, and not removed from this community. */
  async function reader(request, community) {
    const me = await socialSelf(db, request.account.id);
    if (community.isBanned) {
      throw new HttpError(403, BANNED);
    }
    return me;
  }

  /** Whether the reader may hold a keeper's place: the same bar as starting a community. */
  const mayKeep = async (account, meId) =>
    accountAgeDays(account) >= COMMUNITY_AGE_DAYS && (await communities(db).countDocuments({ keeperId: meId })) < KEEPS_LIMIT;

  /**
   * Puts a reader in good standing into a community, and answers with it.
   * Joining one they are already in changes nothing.
   */
  async function join(community, { me, account }) {
    if (community.isMember) {
      return community;
    }
    if (community.isBanned) {
      throw new HttpError(403, BANNED);
    }
    const tooMany = () => new HttpError(409, `You can be in up to ${MEMBERSHIP_LIMIT} communities.`);
    if ((await communities(db).countDocuments({ memberIds: me._id })) >= MEMBERSHIP_LIMIT) {
      throw tooMany();
    }
    // A community everyone left has no keeper. The next to join takes the
    // place, but only a reader who could have started one: otherwise a
    // three-day-old account could pick up a keeper's powers over old
    // discussions just by being first through the door.
    const keeper = (await mayKeep(account, me._id)) ? me._id : null;
    await communities(db).updateOne(
      { _id: community._id, memberIds: { $ne: me._id }, bannedIds: { $ne: me._id }, memberCount: { $lt: COMMUNITY_SIZE } },
      [
        { $set: { memberIds: { $concatArrays: ["$memberIds", [me._id]] } } },
        { $set: { memberCount: { $size: "$memberIds" }, keeperId: { $ifNull: ["$keeperId", keeper] } } }
      ]
    );
    if ((await communities(db).countDocuments({ memberIds: me._id })) > MEMBERSHIP_LIMIT) {
      await leaveCommunities(db, me._id, [community._id]);
      throw tooMany();
    }
    const joined = await one({ _id: community._id }, me._id);
    if (!joined) {
      throw new HttpError(404, NO_SUCH_COMMUNITY);
    }
    if (!joined.isMember) {
      throw joined.isBanned ? new HttpError(403, BANNED) : new HttpError(409, "That community is full.");
    }
    return settleListing(joined);
  }

  /**
   * The community for a book or series: joined if there is one (200), started
   * if there is not (201).
   *
   * Starting one needs good standing, an account a week old, none started
   * already today (UTC), and fewer than five kept. The day's one is taken
   * from the reader's tallies (`tallies.js`) before the community is made, so
   * two requests at once cannot both get it, and it is not given back by
   * deleting the community, or the profile, afterwards.
   */
  router.post(
    "/communities",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const body = request.body ?? {};
      const kind = cleanKind(body.kind);
      const key = cleanKey(body.key);
      const title = requiredText(body.title, 120, "title");
      const author = optionalText(body.author, 80, "author");
      const standing = await goodStanding(db, request.account.id);
      const { me, account } = standing;

      let community = await one({ kind, key }, me._id);
      if (!community) {
        if (accountAgeDays(account) < COMMUNITY_AGE_DAYS) {
          throw tooNew(COMMUNITY_AGE_DAYS, "start a community");
        }
        const tooManyKept = () => new HttpError(409, `You can keep up to ${KEEPS_LIMIT} communities.`);
        if ((await communities(db).countDocuments({ keeperId: me._id })) >= KEEPS_LIMIT) {
          throw tooManyKept();
        }
        if ((await communities(db).countDocuments({ memberIds: me._id })) >= MEMBERSHIP_LIMIT) {
          throw new HttpError(409, `You can be in up to ${MEMBERSHIP_LIMIT} communities.`);
        }
        const now = new Date();
        await spend(db, me._id, "community", COMMUNITIES_PER_DAY, "You can start one community a day. Another tomorrow.", now);
        const handBack = () => giveBack(db, me._id, "community", now);
        const fresh = {
          kind,
          key,
          title,
          author,
          createdBy: me._id,
          keeperId: me._id,
          memberIds: [me._id],
          memberCount: 1,
          bannedIds: [],
          threadCount: 0,
          reportCount: 0,
          listedAt: null,
          unlistedAt: null,
          createdAt: now,
          lastActivityAt: now
        };
        let made = false;
        try {
          await communities(db).insertOne(fresh);
          made = true;
        } catch (error) {
          await handBack();
          // Somebody started this book's community a moment ago: join theirs.
          if (error?.code !== 11000) {
            throw error;
          }
        }
        if (made) {
          // Counted again with this one in place, as for duels.
          if ((await communities(db).countDocuments({ keeperId: me._id })) > KEEPS_LIMIT) {
            await communities(db).deleteOne({ _id: fresh._id });
            await handBack();
            throw tooManyKept();
          }
          response.status(201).json({ community: view({ ...fresh, isMember: true }, me._id) });
          return;
        }
        community = await one({ kind, key }, me._id);
        if (!community) {
          throw new HttpError(409, "Try that again.");
        }
      }
      response.json({ community: view(await join(community, standing), me._id) });
    })
  );

  /**
   * `mine=1`: the caller's communities, whatever their size, most recently
   * active first. Otherwise the directory: listed communities (three
   * established members at some time, and not taken out by reports or the
   * admin) whose title contains `q`, largest first, at most thirty; with `q`
   * shorter than two characters, the thirty largest. `q` is matched as plain
   * text, never as a pattern.
   */
  router.get(
    "/communities",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      lookups(`acct:${meId}`);
      if (request.query.mine === "1") {
        const mine = await load({ memberIds: meId }, meId, { sort: { lastActivityAt: -1, _id: 1 }, limit: MEMBERSHIP_LIMIT });
        response.json({ communities: mine.map((community) => view(community, meId)) });
        return;
      }
      const q = plainText(typeof request.query.q === "string" ? request.query.q : "", 60);
      const match = { listedAt: { $type: "date" }, unlistedAt: null };
      if (q.length >= 2) {
        match.title = { $regex: escapeRegex(q), $options: "i" };
      }
      const found = await load(match, meId, { sort: { memberCount: -1, _id: 1 }, limit: DIRECTORY_LIMIT });
      response.json({ communities: found.map((community) => view(community, meId)) });
    })
  );

  /** The community for a book or series, listed or not: how the app gets from a book to its discussion. */
  router.get(
    "/communities/find",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      lookups(`acct:${meId}`);
      const community = await one({ kind: cleanKind(request.query.kind), key: cleanKey(request.query.key) }, meId);
      if (!community) {
        throw new HttpError(404, NO_SUCH_COMMUNITY);
      }
      response.json({ community: view(await settleListing(community), meId) });
    })
  );

  /**
   * One community by id, listed or not, for a reader who shares a profile
   * and has not been removed from it (404 otherwise, as if it were not
   * there). What the app draws a community's header and Join button from.
   */
  router.get(
    "/communities/:id",
    auth,
    asyncHandler(async (request, response) => {
      const community = await byId(request);
      const me = await profiles(db).findOne({ _id: request.account.id }, { projection: { handle: 1, visibility: 1 } });
      if (!isSocial(me) || community.isBanned) {
        throw new HttpError(404, NO_SUCH_COMMUNITY);
      }
      response.json({ community: view(await settleListing(community), request.account.id) });
    })
  );

  router.post(
    "/communities/:id/join",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const standing = await goodStanding(db, request.account.id);
      const community = await byId(request);
      response.json({ community: view(await join(community, standing), request.account.id) });
    })
  );

  /** Leaves a community. Always allowed, whatever the reader's standing. */
  router.post(
    "/communities/:id/leave",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const left = id ? await leaveCommunities(db, request.account.id, [id]) : 0;
      if (!left) {
        throw new HttpError(404, NO_SUCH_COMMUNITY);
      }
      response.json({ left: true });
    })
  );

  /**
   * Removes a reader from a community and keeps them out of it. The keeper,
   * or an admin. (Also works on a reader who is not a member, to keep out
   * someone who left before they could be removed.)
   *
   * A keeper can remove ten a day. There is one community per book, so its
   * keeper is the only keeper that book has: the limit is there so that one
   * cannot empty it of everyone they disagree with in an evening, before the
   * owner has heard of it (who can undo each removal, and replace the keeper:
   * `POST /admin/community`). An admin's removals are not counted.
   */
  router.post(
    "/communities/:id/members/:handle/remove",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const community = await byId(request);
      const me = await profiles(db).findOne({ _id: request.account.id }, { projection: { role: 1 } });
      if (!community.keeperId?.equals(request.account.id) && !isAdmin(me)) {
        throw new HttpError(403, "Only the community's keeper can remove a member.");
      }
      const them = await findSocial(db, request.params.handle);
      if (!them) {
        throw new HttpError(404, "No shared profile with that handle.");
      }
      if (them._id.equals(request.account.id)) {
        throw new HttpError(400, "To go, leave the community instead.");
      }
      if (!isAdmin(me)) {
        await spend(db, request.account.id, "removal", REMOVALS_PER_DAY, `A keeper can remove ${REMOVALS_PER_DAY} members a day.`);
      }
      // Out first (which hands the keeper's place on, were it theirs), then barred.
      await leaveCommunities(db, them._id, [community._id]);
      await communities(db).updateOne({ _id: community._id }, { $addToSet: { bannedIds: them._id } });
      response.json({ removed: true });
    })
  );

  // ---- threads and replies ----------------------------------------------------

  /**
   * Threads or replies matching `match` as `me` may see them, authors
   * attached, one more than `limit` when there are more.
   *
   * Whose writing is shown is decided here, at read time: its author is
   * public, not suspended, and on neither side of a block with the reader.
   * So a reader who goes private or is suspended takes their threads and
   * replies out of every list without anything being deleted, and they are
   * back when that ends. A thread whose author's account is gone
   * (`authorId: null`) is shown, as by "a reader who left". Something hidden
   * by reports is shown to its author only.
   */
  async function visible(home, match, me, { sort, limit }) {
    const blocked = idsOf(await blockedWith(db, me._id));
    return home(db)
      .aggregate([
        {
          $match: { $and: [match, { $or: [{ hiddenAt: null }, { authorId: me._id }] }, { authorId: { $nin: blocked } }] }
        },
        { $sort: sort },
        withAuthor("authorId", me._id),
        { $match: { $or: [{ authorId: null }, { "author.visibility": "public" }] } },
        { $limit: limit + 1 }
      ])
      .toArray();
  }

  /** What every thread and reply view carries about who wrote it and what the reader may do. */
  const signed = (doc, me, community, mine) => {
    const isYou = Boolean(doc.authorId?.equals(me._id));
    return {
      author: doc.author?.[0] ? personView(doc.author[0]) : null,
      isYou,
      ...reactionView(doc, mine),
      hidden: isYou && Boolean(doc.hiddenAt),
      canRemove: isYou || Boolean(community.keeperId?.equals(me._id)) || isAdmin(me)
    };
  };

  /**
   * A thread. In a list it has no body: an excerpt instead, and that only
   * when the thread is marked as free of spoilers, so the list cannot give
   * away what the mark is there to hold back. A title can give it away as
   * well ("I can't believe she dies"), so in a list a marked thread's title
   * is sent only to its author, or to a reader who says they are already
   * that far (`reached`, from `?at=`: their own place, so a lie spoils only
   * the one telling it). To anyone else it is `title: null` with
   * `titleHidden: true`; opening the thread is their choice, and gives it.
   */
  const threadView = (thread, me, community, mine, whole, reached = 0) => {
    const mark = thread.spoiler ? thread.spoiler.percent ?? thread.spoiler.book ?? Infinity : 0;
    const titleHidden = !whole && Boolean(thread.spoiler) && !thread.authorId?.equals(me._id) && reached < mark;
    return threadShape(thread, me, community, mine, whole, titleHidden);
  };

  const threadShape = (thread, me, community, mine, whole, titleHidden) => ({
    id: thread._id.toHexString(),
    communityId: thread.communityId.toHexString(),
    title: titleHidden ? null : thread.title,
    titleHidden,
    ...(whole
      ? { body: thread.body }
      : { excerpt: thread.spoiler ? null : plainText(thread.body, EXCERPT) }),
    spoiler: thread.spoiler ?? null,
    pinned: thread.pinned === true,
    replyCount: Math.max(0, thread.replyCount ?? 0),
    createdAt: thread.createdAt.toISOString(),
    lastActivityAt: thread.lastActivityAt.toISOString(),
    ...signed(thread, me, community, mine)
  });

  const replyView = (reply, me, community, mine) => ({
    id: reply._id.toHexString(),
    threadId: reply.threadId.toHexString(),
    body: reply.body,
    createdAt: reply.createdAt.toISOString(),
    ...signed(reply, me, community, mine)
  });

  /** The thread with that id as the reader may see it, and its community; else a 404. */
  async function threadFor(request, me, id = objectId(request.params.id)) {
    const [thread] = id ? await visible(threads, { _id: id }, me, { sort: { _id: 1 }, limit: 1 }) : [];
    const community = thread ? await one({ _id: thread.communityId }, me._id) : null;
    if (!thread || !community) {
      throw new HttpError(404, NO_SUCH_THREAD);
    }
    if (community.isBanned) {
      throw new HttpError(403, BANNED);
    }
    return { thread, community };
  }

  /**
   * A community's threads: the pinned ones first (on the first page only),
   * then by latest activity, thirty a page. `?before=` is the
   * `lastActivityAt` of the last thread of the page before. `?at=` is how far
   * the reader is (see `threadView`).
   */
  router.get(
    "/communities/:id/threads",
    auth,
    asyncHandler(async (request, response) => {
      const community = await byId(request);
      const me = await reader(request, community);
      const before = asDate(request.query.before);
      const [pinned, rest] = await Promise.all([
        before
          ? []
          : visible(threads, { communityId: community._id, pinned: true }, me, { sort: { lastActivityAt: -1, _id: -1 }, limit: PINNED_LIMIT }),
        visible(
          threads,
          { communityId: community._id, pinned: { $ne: true }, ...(before ? { lastActivityAt: { $lt: before } } : {}) },
          me,
          { sort: { lastActivityAt: -1, _id: -1 }, limit: THREAD_PAGE }
        )
      ]);
      const shown = [...pinned.slice(0, PINNED_LIMIT), ...rest.slice(0, THREAD_PAGE)];
      const mine = await myReactions(db, "thread", shown.map((thread) => thread._id), me._id);
      // How far the reader says they are: percent of the book, or which book
      // of the series. Anything that is not a number is "nowhere yet".
      const at = Number(request.query.at);
      const reached = Number.isFinite(at) && at > 0 ? at : 0;
      response.json({
        community: view(community, me._id),
        threads: shown.map((thread) => threadView(thread, me, community, mine, false, reached)),
        more: rest.length > THREAD_PAGE
      });
    })
  );

  /**
   * Starts a thread. Members in good standing; five a day (UTC) across all
   * communities, which is plenty to talk and too few to flood.
   */
  router.post(
    "/communities/:id/threads",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const body = request.body ?? {};
      const title = requiredText(body.title, 120, "title");
      const text = requiredLines(body.body, 5000, "body");
      const { me } = await goodStanding(db, request.account.id);
      const community = await byId(request);
      const spoiler = cleanSpoiler(body.spoiler, community.kind);
      if (!community.isMember) {
        throw new HttpError(403, community.isBanned ? BANNED : JOIN_FIRST);
      }
      const now = new Date();
      await spend(db, me._id, "thread", THREADS_PER_DAY, `You can start ${THREADS_PER_DAY} threads a day. More tomorrow.`, now);
      const thread = {
        communityId: community._id,
        authorId: me._id,
        title,
        body: text,
        spoiler,
        pinned: false,
        replyCount: 0,
        likes: 0,
        dislikes: 0,
        score: 0,
        createdAt: now,
        lastActivityAt: now,
        hiddenAt: null
      };
      await threads(db).insertOne(thread);
      await communities(db).updateOne({ _id: community._id }, { $inc: { threadCount: 1 }, $set: { lastActivityAt: now } });
      response.status(201).json({ thread: threadView({ ...thread, author: [me] }, me, community, new Map(), true) });
    })
  );

  /**
   * A thread with its body, its community, and its replies oldest first, a
   * hundred a page. `?after=` is the `createdAt` of the last reply of the
   * page before.
   */
  router.get(
    "/threads/:id",
    auth,
    asyncHandler(async (request, response) => {
      const me = await socialSelf(db, request.account.id);
      const { thread, community } = await threadFor(request, me);
      const after = asDate(request.query.after);
      const rows = await visible(
        replies,
        { threadId: thread._id, ...(after ? { createdAt: { $gt: after } } : {}) },
        me,
        { sort: { createdAt: 1, _id: 1 }, limit: REPLY_PAGE }
      );
      const shown = rows.slice(0, REPLY_PAGE);
      const [mineThread, mineReplies] = await Promise.all([
        myReactions(db, "thread", [thread._id], me._id),
        myReactions(db, "reply", shown.map((reply) => reply._id), me._id)
      ]);
      response.json({
        thread: threadView(thread, me, community, mineThread, true),
        community: view(community, me._id),
        replies: shown.map((reply) => replyView(reply, me, community, mineReplies)),
        more: rows.length > REPLY_PAGE
      });
    })
  );

  /** Replies to a thread. Members in good standing; sixty a day (UTC). Not to a hidden thread. */
  router.post(
    "/threads/:id/replies",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const text = requiredLines(request.body?.body, 3000, "body");
      const { me } = await goodStanding(db, request.account.id);
      const { thread, community } = await threadFor(request, me);
      if (!community.isMember) {
        throw new HttpError(403, JOIN_FIRST);
      }
      if (thread.hiddenAt) {
        throw new HttpError(409, "This thread is hidden while it is looked at.");
      }
      const now = new Date();
      await spend(db, me._id, "reply", REPLIES_PER_DAY, `You can post ${REPLIES_PER_DAY} replies a day. More tomorrow.`, now);
      const reply = {
        threadId: thread._id,
        communityId: community._id,
        authorId: me._id,
        body: text,
        likes: 0,
        dislikes: 0,
        score: 0,
        createdAt: now,
        hiddenAt: null
      };
      await replies(db).insertOne(reply);
      const { matchedCount } = await threads(db).updateOne(
        { _id: thread._id },
        { $inc: { replyCount: 1 }, $set: { lastActivityAt: now } }
      );
      if (!matchedCount) {
        // The thread was deleted while this was on its way.
        await replies(db).deleteOne({ _id: reply._id });
        await giveBack(db, me._id, "reply", now);
        throw new HttpError(404, NO_SUCH_THREAD);
      }
      await communities(db).updateOne({ _id: community._id }, { $set: { lastActivityAt: now } });
      response.status(201).json({ reply: replyView({ ...reply, author: [me] }, me, community, new Map()) });
    })
  );

  /** Who may take a thread or reply down: its author, its community's keeper, or an admin. */
  async function mayRemove(request, doc) {
    const [me, community] = await Promise.all([
      profiles(db).findOne({ _id: request.account.id }, { projection: { role: 1 } }),
      communities(db).findOne({ _id: doc.communityId }, { projection: { keeperId: 1 } })
    ]);
    const meId = request.account.id;
    if (!doc.authorId?.equals(meId) && !community?.keeperId?.equals(meId) && !isAdmin(me)) {
      throw new HttpError(403, "Only its author or the community's keeper can remove that.");
    }
  }

  router.delete(
    "/threads/:id",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const thread = id ? await threads(db).findOne({ _id: id }, { projection: { authorId: 1, communityId: 1 } }) : null;
      if (!thread) {
        throw new HttpError(404, NO_SUCH_THREAD);
      }
      await mayRemove(request, thread);
      await deleteThreads(db, { _id: id });
      response.json({ deleted: true });
    })
  );

  router.delete(
    "/replies/:id",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const reply = id ? await replies(db).findOne({ _id: id }, { projection: { authorId: 1, communityId: 1 } }) : null;
      if (!reply) {
        throw new HttpError(404, NO_SUCH_REPLY);
      }
      await mayRemove(request, reply);
      await deleteReplies(db, { _id: id });
      response.json({ deleted: true });
    })
  );

  /** Pins or unpins a thread. The keeper, or an admin; three pinned at most. */
  router.post(
    "/threads/:id/pin",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const pinned = request.body?.pinned;
      if (typeof pinned !== "boolean") {
        throw new HttpError(400, "pinned must be true or false.");
      }
      const id = objectId(request.params.id);
      const thread = id ? await threads(db).findOne({ _id: id }, { projection: { communityId: 1, pinned: 1 } }) : null;
      if (!thread) {
        throw new HttpError(404, NO_SUCH_THREAD);
      }
      const [me, community] = await Promise.all([
        profiles(db).findOne({ _id: request.account.id }, { projection: { role: 1 } }),
        communities(db).findOne({ _id: thread.communityId }, { projection: { keeperId: 1 } })
      ]);
      if (!community?.keeperId?.equals(request.account.id) && !isAdmin(me)) {
        throw new HttpError(403, "Only the community's keeper can pin a thread.");
      }
      const others = { communityId: thread.communityId, pinned: true };
      const tooMany = () => new HttpError(409, `A community can have ${PINNED_LIMIT} pinned threads. Unpin one first.`);
      if (pinned && thread.pinned !== true && (await threads(db).countDocuments(others)) >= PINNED_LIMIT) {
        throw tooMany();
      }
      await threads(db).updateOne({ _id: id }, { $set: { pinned } });
      if (pinned && (await threads(db).countDocuments(others)) > PINNED_LIMIT) {
        await threads(db).updateOne({ _id: id }, { $set: { pinned: false } });
        throw tooMany();
      }
      response.json({ pinned });
    })
  );

  /** Likes or dislikes a thread, or takes either back: as for a post. */
  router.post(
    "/threads/:id/react",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      taps(`acct:${request.account.id}`);
      const value = reactionValue(request.body?.value);
      const me = await socialSelf(db, request.account.id);
      refuseSuspended(me);
      await provenAccount(db, me._id, "like and dislike");
      const { thread } = await threadFor(request, me);
      if (thread.hiddenAt) {
        throw new HttpError(404, NO_SUCH_THREAD);
      }
      if (thread.authorId?.equals(me._id)) {
        throw new HttpError(400, "That one is yours. Other readers get to say.");
      }
      response.json(await react(db, "thread", thread._id, me._id, value));
    })
  );

  router.post(
    "/replies/:id/react",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      taps(`acct:${request.account.id}`);
      const value = reactionValue(request.body?.value);
      const me = await socialSelf(db, request.account.id);
      refuseSuspended(me);
      await provenAccount(db, me._id, "like and dislike");
      const id = objectId(request.params.id);
      const [reply] = id ? await visible(replies, { _id: id }, me, { sort: { _id: 1 }, limit: 1 }) : [];
      if (!reply || reply.hiddenAt) {
        throw new HttpError(404, NO_SUCH_REPLY);
      }
      // Its thread has to be one the reader may read, in a community they are not removed from.
      await threadFor(request, me, reply.threadId);
      if (reply.authorId.equals(me._id)) {
        throw new HttpError(400, "That one is yours. Other readers get to say.");
      }
      response.json(await react(db, "reply", reply._id, me._id, value));
    })
  );

  // ---- the admin's hand on a community -------------------------------------------

  /**
   * What only the owner can put right in a community (404 to anyone else,
   * like every admin route):
   *   `title`, `author`  whatever its first member typed is what the one
   *                      community for that book is called, and nobody else
   *                      can change it;
   *   `keeper`           a member's handle: gives them the keeper's place,
   *                      for a keeper who has gone quiet or gone wrong;
   *   `unban`            a handle: lets a removed reader back in (they still
   *                      have to join);
   *   `relist`           true puts it back in the directory after reports
   *                      took it out (it still needs to have been listed in
   *                      the first place); false takes it out.
   * Only what is sent changes.
   */
  router.post(
    "/admin/community",
    auth,
    requireAdmin(db),
    smallJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      const id = objectId(body.id);
      const community = id ? await communities(db).findOne({ _id: id }, { projection: { memberIds: 1 } }) : null;
      if (!community) {
        throw new HttpError(404, NO_SUCH_COMMUNITY);
      }
      const set = {};
      const change = { $set: set };
      if (body.title !== undefined) {
        set.title = requiredText(body.title, 120, "title");
      }
      if (body.author !== undefined) {
        set.author = optionalText(body.author, 80, "author");
      }
      /** The profile with that handle, whatever its visibility: an admin is told the truth. */
      const byHandle = async (raw, name) => {
        const handle = cleanHandle(raw);
        const profile = HANDLE_PATTERN.test(handle) ? await profiles(db).findOne({ handle: asString(handle) }, { projection: { _id: 1 } }) : null;
        if (!profile) {
          throw new HttpError(404, `${name}: no profile with that handle.`);
        }
        return profile._id;
      };
      if (body.keeper !== undefined) {
        const keeperId = await byHandle(body.keeper, "keeper");
        if (!community.memberIds.some((memberId) => memberId.equals(keeperId))) {
          throw new HttpError(409, "keeper: that reader is not a member of this community.");
        }
        set.keeperId = keeperId;
      }
      if (body.unban !== undefined) {
        change.$pull = { bannedIds: await byHandle(body.unban, "unban") };
      }
      if (body.relist !== undefined) {
        if (typeof body.relist !== "boolean") {
          throw new HttpError(400, "relist must be true or false.");
        }
        // Looked at, either way: reports no longer act on it by themselves.
        Object.assign(set, { unlistedAt: body.relist ? null : new Date(), clearedAt: new Date() });
        if (body.relist) {
          set.reportCount = 0;
        }
      }
      if (Object.keys(set).length === 0) {
        delete change.$set;
      }
      if (Object.keys(change).length > 0) {
        await communities(db).updateOne({ _id: id }, change);
      }
      response.json({ community: view(await settleListing(await one({ _id: id }, request.account.id)), request.account.id) });
    })
  );

  return router;
}
