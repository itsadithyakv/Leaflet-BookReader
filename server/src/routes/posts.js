import { Router } from "express";
import { optionalAccount, requireAccount } from "../auth.js";
import { canSee, followedIds, personView } from "../community.js";
import { asString, follows, posts, quoteTallies } from "../db.js";
import { deletePosts } from "../discussion.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { optionalText, requiredLines, requiredText, wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import { deleteReactionsOn, myReactions, react, reactionValue, reactionView } from "../reactions.js";
import { FOLLOW_FIRST, NO_SUCH_READER, limiter, objectId, socialByHandle, socialSelf } from "../readers.js";
import { blockedWith, goodStanding, idsOf, isBlockedPair, provenAccount, refuseSuspended, withAuthor } from "../standing.js";
import { giveBack, spend } from "../tallies.js";

/**
 * Posts: "I finished this", a review, or a quote, and the places they are
 * read (the feed of the readers one follows, the discover feed of posts made
 * for everyone, a book's page, a reader's profile).
 *
 * Every post has an audience. `followers` (the default) is shown to the
 * readers who follow its author, and needs only a shared profile, as before.
 * `everyone` is shown to strangers, so its author has to be in good standing
 * (`standing.js`) when they post it, and it is shown only while they are
 * public, not suspended, and the post has not been hidden by reports.
 *
 * Nothing is rewritten when a reader goes private or is suspended: their
 * posts stay stored and drop out of every answer, their own feed included,
 * and are back when they share again or the suspension ends.
 */

const POSTS_PER_DAY = 20;
/** Of those twenty, how many may be quotes: a few lines a day, from all books together. */
const QUOTES_PER_DAY = 10;
const FEED_PAGE = 30;
/** One reader's posts on one page of discover. The rest of theirs wait for later pages. */
const DISCOVER_PER_AUTHOR = 3;
/** How many posts held over for later pages a discover cursor will carry. */
const DISCOVER_HELD = 90;
/** How many posts are read at a time to fill a discover page. */
const DISCOVER_BATCH = 90;
/** Quotes one reader may ever post from one book. Enough to love a book in public; not enough to republish it. */
const QUOTES_PER_BOOK = 30;
/** "Top" is the best of the last month, not of all time: old favourites would never leave it. */
const TOP_DAYS = 30;
const TOP_SKIP_MAX = 300;
/** How many of a book's newest reviews its average is taken over. */
const SUMMARY_REVIEWS = 1000;
const KINDS = ["finished", "review", "quote"];
const AUDIENCES = ["followers", "everyone"];
const MAX_KEY = 160;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A book's key as the app made it: trimmed and lower-cased, never cut (a shortened key would be another book's). */
function cleanKey(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!key || key.length > MAX_KEY) {
    throw new HttpError(400, `bookKey should be text, up to ${MAX_KEY} characters.`);
  }
  return key;
}

const oneOf = (value, choices, fallback, name) => {
  if (value === undefined) {
    return fallback;
  }
  if (!choices.includes(value)) {
    throw new HttpError(400, `${name} is one of ${choices.join(", ")}.`);
  }
  return value;
};

/** `?before=` as a date, or null when it is not one. */
const asDate = (value) => {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

/** What the body says, by kind. The fields a kind does not have are null, so every post has one shape. */
function contentOf(kind, body) {
  const content = { rating: null, line: null, body: null, quote: null, note: null };
  if (kind === "finished") {
    content.rating = body.rating === undefined || body.rating === null ? null : wholeNumber(body.rating, 1, 5, "rating");
    content.line = optionalText(body.line, 280, "line");
  } else if (kind === "review") {
    // A review without a rating is a blog post; the rating is what a book's average is made of.
    content.rating = wholeNumber(body.rating, 1, 5, "rating");
    content.body = requiredLines(body.body, 3000, "body");
  } else {
    content.quote = requiredText(body.quote, 500, "quote");
    content.note = optionalText(body.note, 280, "note");
  }
  return content;
}

export function postRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const maybeAuth = optionalAccount(db);
  const fallback = defaultLimits();
  const writes = limiter(limits.social ?? fallback.social);
  const taps = limiter(limits.react ?? fallback.react);
  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  /**
   * Posts as `viewerId` (null when signed out) may see them, in order, up to
   * `limit` (`page` asks for one more than a page, to know if there are more).
   *
   * The same three rules everywhere a post is listed, applied in the database
   * before the page is cut:
   *   - a post hidden by reports is shown to its author only;
   *   - its author still shares a profile and is not suspended (`withAuthor`),
   *     and neither of the two readers has blocked the other;
   *   - an `everyone` post by a public reader is for anybody; any other post
   *     is for the readers in `close`: the viewer, and whom they follow.
   */
  async function rows({ match, viewerId, close, blocked, sort, skip = 0, limit, now = new Date() }) {
    return posts(db)
      .aggregate([
        {
          $match: {
            $and: [match, { $or: [{ hiddenAt: null }, { userId: viewerId }] }, { userId: { $nin: blocked } }]
          }
        },
        { $sort: sort },
        // As `poster`: a post's own `author` is the book's, and is not to be written over.
        withAuthor("userId", viewerId, now, "poster"),
        {
          $match: {
            poster: { $ne: [] },
            $or: [{ audience: "everyone", "poster.visibility": "public" }, { userId: { $in: close } }]
          }
        },
        { $skip: skip },
        { $limit: limit }
      ])
      .toArray();
  }

  /** Those rows as the viewer sees them, each with the viewer's own like or dislike. */
  async function views(shown, viewerId) {
    const mine = await myReactions(db, "post", shown.map((post) => post._id), viewerId);
    return shown.map((post) => postView(post, post.poster[0], viewerId, mine));
  }

  async function page({ limit = FEED_PAGE, ...asked }) {
    const found = await rows({ ...asked, limit: limit + 1 });
    return { posts: await views(found.slice(0, limit), asked.viewerId), more: found.length > limit };
  }

  /** A post as `meId` (null when signed out) sees it. `poster` is its reader's profile. */
  const postView = (post, poster, meId, mine = new Map()) => {
    const isYou = Boolean(meId && post.userId.equals(meId));
    return {
      id: post._id.toHexString(),
      kind: post.kind ?? "finished",
      person: personView(poster),
      title: post.title,
      author: post.author ?? null,
      bookKey: post.bookKey ?? null,
      rating: post.rating ?? null,
      line: post.line ?? null,
      body: post.body ?? null,
      quote: post.quote ?? null,
      note: post.note ?? null,
      spoiler: post.spoiler === true,
      audience: post.audience === "everyone" ? "everyone" : "followers",
      ...reactionView(post, mine),
      // Only ever true to its author: a hidden post is in nobody else's answers.
      hidden: isYou && Boolean(post.hiddenAt),
      createdAt: post.createdAt.toISOString(),
      editedAt: post.editedAt instanceof Date ? post.editedAt.toISOString() : null,
      isYou
    };
  };

  /** The viewer, and the readers they follow: whose `followers` posts they may see. */
  const closeTo = async (meId) => [meId, ...(await followedIds(db, meId))];

  /**
   * Posts a finished book, a review or a quote.
   *
   * At most twenty posts a day (UTC), of any kind, ten of them quotes; a
   * post deleted is still one of the day's (`tallies.js`). One review of a
   * book per reader: a second replaces the first where it stands (same post,
   * same place in every feed, its likes started over, and still hidden if it
   * was), so a review cannot be re-posted to the top or out from under its
   * reports. At most thirty quotes from one book per reader, ever: deleting
   * some does not make room, so a book cannot be posted a paragraph at a time.
   *
   * "The same book" is its `bookKey` when the app sent one, else its title
   * and author as typed.
   */
  router.post(
    "/posts",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const body = request.body ?? {};
      const kind = oneOf(body.kind, KINDS, "finished", "kind");
      const audience = oneOf(body.audience, AUDIENCES, "followers", "audience");
      if (body.spoiler !== undefined && typeof body.spoiler !== "boolean") {
        throw new HttpError(400, "spoiler must be true or false.");
      }
      const now = new Date();
      const post = {
        userId: request.account.id,
        kind,
        title: requiredText(body.title, 160, "title"),
        author: optionalText(body.author, 80, "author"),
        bookKey: body.bookKey === undefined || body.bookKey === null ? null : cleanKey(body.bookKey),
        audience,
        spoiler: body.spoiler === true,
        ...contentOf(kind, body),
        likes: 0,
        dislikes: 0,
        score: 0,
        hiddenAt: null,
        createdAt: now
      };
      if (kind !== "finished") {
        post.bookRef = post.bookKey ?? `title:${post.title.toLowerCase()}|${(post.author ?? "").toLowerCase()}`;
      }
      // For everyone: good standing. For followers: a shared profile, as
      // before. A suspended reader posts to neither.
      const me = audience === "everyone" ? (await goodStanding(db, request.account.id, now)).me : await socialSelf(db, request.account.id);
      refuseSuspended(me, now);

      const replace = async () => {
        // Everything the new one says, and nothing of where the old one
        // stands: not its id (which the driver has put on `post` by the time
        // an insert is refused), its date, or whether it is hidden.
        const { _id, userId: _userId, createdAt: _createdAt, hiddenAt: _hiddenAt, ...fresh } = post;
        const replaced = await posts(db).findOneAndUpdate(
          { userId: me._id, kind: "review", bookRef: post.bookRef },
          { $set: { ...fresh, editedAt: now } },
          { returnDocument: "after" }
        );
        if (replaced) {
          // The likes were for what it said before.
          await deleteReactionsOn(db, "post", [replaced._id]);
        }
        return replaced;
      };
      if (kind === "review") {
        const replaced = await replace();
        if (replaced) {
          response.json({ post: postView(replaced, me, me._id), replaced: true });
          return;
        }
      }

      // What this post uses up, each handed back if a later limit, or the
      // insert itself, refuses it.
      const taken = [];
      const giveAllBack = () => Promise.all(taken.map((undo) => undo()));
      await spend(db, me._id, "post", POSTS_PER_DAY, `You can post ${POSTS_PER_DAY} times a day. More tomorrow.`, now);
      taken.push(() => giveBack(db, me._id, "post", now));
      const tally = { userId: me._id, bookRef: post.bookRef };
      if (kind === "quote") {
        try {
          await spend(db, me._id, "quote", QUOTES_PER_DAY, `You can post ${QUOTES_PER_DAY} quotes a day. More tomorrow.`, now);
        } catch (error) {
          await giveAllBack();
          throw error;
        }
        taken.push(() => giveBack(db, me._id, "quote", now));
        // One update that only goes through while there is room. With the
        // tally full it matches nothing and tries to insert a second row for
        // the pair, which the unique index refuses: that refusal is the limit.
        const count = () =>
          quoteTallies(db).updateOne({ ...tally, count: { $lt: QUOTES_PER_BOOK } }, { $inc: { count: 1 } }, { upsert: true });
        try {
          // (Tried twice: the very first two quotes from a book, sent at the
          // same moment, both try to insert the row.)
          await count().catch((error) => (error?.code === 11000 ? count() : Promise.reject(error)));
        } catch (error) {
          await giveAllBack();
          if (error?.code === 11000) {
            throw new HttpError(409, "That's a lot of this book already. Quotes are for the lines that stayed with you.");
          }
          throw error;
        }
        taken.push(() => quoteTallies(db).updateOne(tally, { $inc: { count: -1 } }));
      }
      try {
        await posts(db).insertOne(post);
      } catch (error) {
        await giveAllBack();
        // Two first reviews of one book at the same moment: this is the second.
        const replaced = error?.code === 11000 && kind === "review" ? await replace() : null;
        if (!replaced) {
          throw error;
        }
        response.json({ post: postView(replaced, me, me._id), replaced: true });
        return;
      }
      response.status(201).json({ post: postView(post, me, me._id), replaced: false });
    })
  );

  /**
   * Likes or dislikes a post, or takes either back. For a reader who shares
   * a profile, is not suspended, has an account three days old at a confirmed
   * address (`provenAccount`: a score is not to be moved by accounts made for
   * the purpose), can see the post, and did not write it.
   */
  router.post(
    "/posts/:id/react",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      taps(`acct:${request.account.id}`);
      const value = reactionValue(request.body?.value);
      const id = objectId(request.params.id);
      const me = await socialSelf(db, request.account.id);
      refuseSuspended(me);
      await provenAccount(db, me._id, "like and dislike");
      const seen = id
        ? await page({
            match: { _id: id },
            viewerId: me._id,
            close: await closeTo(me._id),
            blocked: idsOf(await blockedWith(db, me._id)),
            sort: { _id: 1 },
            limit: 1
          })
        : { posts: [] };
      const [post] = seen.posts;
      if (!post || post.hidden) {
        throw new HttpError(404, "No such post.");
      }
      if (post.isYou) {
        throw new HttpError(400, "That one is yours. Other readers get to say.");
      }
      response.json(await react(db, "post", id, me._id, value));
    })
  );

  /**
   * The reader's feed: their own posts and those of the readers they follow
   * who still share a profile, newest first, thirty a page. `?before=` (the
   * `createdAt` of the last post of the page before) asks for the next page;
   * `more` says whether there is one.
   */
  router.get(
    "/feed",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const before = asDate(request.query.before);
      // A follow of a followers-only reader exists only once they accepted
      // it, so everything these readers posted may be shown to this one.
      const close = await closeTo(meId);
      response.json(
        await page({
          match: { userId: { $in: close }, ...(before ? { createdAt: { $lt: before } } : {}) },
          viewerId: meId,
          close,
          blocked: idsOf(await blockedWith(db, meId)),
          sort: { createdAt: -1, _id: -1 }
        })
      );
    })
  );

  /**
   * One page of discover being filled, three posts to a reader at most.
   *
   * Without that, one reader posting their twenty a day is the whole first
   * page, and discover is theirs. A post whose author already has three on
   * the page is not dropped: it is held over, and offered first to the page
   * after, where the same rule applies. So a busy reader's posts are spread
   * down the pages, among everybody else's, instead of standing in a block.
   */
  const emptyPage = () => ({ taken: [], held: [], byAuthor: new Map() });
  const isFull = (state) => state.taken.length >= FEED_PAGE;
  function offer(state, post) {
    const author = post.userId.toHexString();
    const has = state.byAuthor.get(author) ?? 0;
    if (!isFull(state) && has < DISCOVER_PER_AUTHOR) {
      state.taken.push(post);
      state.byAuthor.set(author, has + 1);
    } else {
      state.held.push(post);
    }
  }

  /**
   * Where a "new" page left off: the date it had read down to, and the posts
   * held over on the way. Opaque to the app, which sends back what it was
   * given; checked here all the same, since it comes from outside.
   */
  const writeCursor = (before, held) =>
    Buffer.from(
      JSON.stringify({ b: before ? before.toISOString() : null, h: held.slice(0, DISCOVER_HELD).map((post) => post._id.toHexString()) })
    ).toString("base64url");

  function readCursor(value) {
    try {
      const { b, h } = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
      const held = h.map(objectId);
      if (h.length > DISCOVER_HELD || held.includes(null) || (b !== null && !asDate(b))) {
        throw new Error("not a cursor");
      }
      return { before: b === null ? null : asDate(b), held };
    } catch {
      throw new HttpError(400, "cursor is not one this server gave out.");
    }
  }

  /**
   * Posts made for everyone, by readers the caller does not have to follow.
   *
   * Only posts whose author is public and not suspended, that are not hidden,
   * and that are not the caller's own or from a reader on either side of a
   * block with them. At most three by one reader on a page, in both orders
   * (see `offer`).
   *
   * `sort=new` (default): newest first. The answer's `next` is the cursor for
   * the page after (`?cursor=`), which is what carries the posts held over.
   * `?before=` (a date) still starts a page from that moment, as it did, but
   * knows nothing of what was held over before it.
   * `sort=top`: the last thirty days by likes less dislikes, then newest,
   * paged by `skip` (up to 300: nobody reads further). Each answer is worked
   * out from the top down to the page asked for, so what one page holds over
   * is on the next without the app carrying anything.
   */
  router.get(
    "/discover",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const now = new Date();
      const asked = {
        viewerId: meId,
        close: [],
        blocked: [meId, ...idsOf(await blockedWith(db, meId))],
        limit: DISCOVER_BATCH,
        now
      };

      if (request.query.sort === "top") {
        const skipped = Number(request.query.skip);
        const index = Math.floor((Number.isInteger(skipped) && skipped > 0 ? Math.min(skipped, TOP_SKIP_MAX) : 0) / FEED_PAGE);
        const match = { audience: "everyone", createdAt: { $gte: new Date(now.getTime() - TOP_DAYS * DAY_MS) } };
        let state = emptyPage();
        let waiting = [];
        let read = 0;
        let dry = false;
        for (let turn = 0; turn <= index; turn += 1) {
          const carried = state.held;
          state = emptyPage();
          carried.forEach((post) => offer(state, post));
          while (!isFull(state) && !(dry && waiting.length === 0)) {
            if (waiting.length === 0) {
              waiting = await rows({ ...asked, match, sort: { score: -1, createdAt: -1, _id: -1 }, skip: read });
              read += waiting.length;
              // (Ten batches is three times the furthest page: enough unless
              // nearly everything in the month is by a handful of readers.)
              dry = waiting.length < DISCOVER_BATCH || read >= 10 * DISCOVER_BATCH;
            } else {
              offer(state, waiting.shift());
            }
          }
        }
        response.json({
          posts: await views(state.taken, meId),
          more: state.held.length > 0 || waiting.length > 0 || !dry,
          next: null
        });
        return;
      }

      const from =
        request.query.cursor === undefined ? { before: asDate(request.query.before), held: [] } : readCursor(request.query.cursor);
      const state = emptyPage();
      const newest = { createdAt: -1, _id: -1 };
      if (from.held.length > 0) {
        // Held over from the pages before: newer than anything still to come,
        // so they are offered first, and are checked again like any post (one
        // may have been deleted or hidden since).
        const carried = await rows({ ...asked, match: { audience: "everyone", _id: { $in: from.held } }, sort: newest });
        carried.forEach((post) => offer(state, post));
      }
      let before = from.before;
      let dry = false;
      for (let batches = 0; !isFull(state) && !dry && batches < 5; batches += 1) {
        const batch = await rows({
          ...asked,
          match: { audience: "everyone", ...(before ? { createdAt: { $lt: before } } : {}) },
          sort: newest
        });
        dry = batch.length < DISCOVER_BATCH;
        for (const post of batch) {
          if (isFull(state)) {
            // The rest of the batch has not been read: it is the next page's.
            dry = false;
            break;
          }
          offer(state, post);
          before = post.createdAt;
        }
      }
      const more = state.held.length > 0 || !dry;
      response.json({ posts: await views(state.taken, meId), more, next: more ? writeCursor(before, state.held) : null });
    })
  );

  /**
   * One book's posts, newest first: those made for everyone (under the
   * discover rules), those of the readers the caller follows, and the
   * caller's own. `summary` is how many public reviews the book has and their
   * average rating to one decimal (null with none), taken over its newest
   * thousand.
   */
  router.get(
    "/books/posts",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const key = cleanKey(request.query.key);
      const before = asDate(request.query.before);
      const now = new Date();
      const [listed, totals] = await Promise.all([
        page({
          // `asString`, here and below: what lets the book's own index be used.
          match: { bookKey: asString(key), ...(before ? { createdAt: { $lt: before } } : {}) },
          viewerId: meId,
          close: await closeTo(meId),
          blocked: idsOf(await blockedWith(db, meId)),
          sort: { createdAt: -1, _id: -1 },
          now
        }),
        posts(db)
          .aggregate([
            { $match: { bookKey: asString(key), kind: "review", audience: "everyone", hiddenAt: null } },
            { $sort: { createdAt: -1 } },
            { $limit: SUMMARY_REVIEWS },
            withAuthor("userId", null, now, "poster"),
            { $match: { "poster.visibility": "public" } },
            { $group: { _id: null, reviews: { $sum: 1 }, average: { $avg: "$rating" } } }
          ])
          .toArray()
      ]);
      const [total] = totals;
      response.json({
        ...listed,
        summary: { reviews: total?.reviews ?? 0, average: total ? Math.round(total.average * 10) / 10 : null }
      });
    })
  );

  /**
   * One reader's latest posts. Their `everyone` posts are for anyone, signed
   * out too, while they are public; the rest are for the readers who follow
   * them, and themself. A followers-only reader's are for accepted followers
   * (403 to anyone else, as for kudos). A reader on either side of a block
   * with the caller answers like one who is not there.
   */
  router.get(
    "/profile/:handle/posts",
    maybeAuth,
    asyncHandler(async (request, response) => {
      const meId = request.account?.id ?? null;
      const poster = await socialByHandle(db, request.params.handle);
      const isYou = Boolean(meId && poster._id.equals(meId));
      if (meId && !isYou && (await isBlockedPair(db, meId, poster._id))) {
        throw new HttpError(404, NO_SUCH_READER);
      }
      if (!(await canSee(db, meId, poster))) {
        throw new HttpError(403, FOLLOW_FIRST);
      }
      const follower =
        isYou ||
        Boolean(meId && (await follows(db).findOne({ followerId: meId, followeeId: poster._id }, { projection: { _id: 1 } })));
      const { posts: latest } = await page({
        match: { userId: poster._id },
        viewerId: meId,
        close: follower ? [poster._id] : [],
        blocked: [],
        sort: { createdAt: -1, _id: -1 }
      });
      response.json({ posts: latest });
    })
  );

  /** Deletes one of the reader's own posts. Anyone else's is a 404, like one that is not there. */
  router.delete(
    "/posts/:id",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const deleted = id ? await deletePosts(db, { _id: id, userId: request.account.id }) : 0;
      if (!deleted) {
        throw new HttpError(404, "No such post.");
      }
      response.json({ deleted: true });
    })
  );

  return router;
}
