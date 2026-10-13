import { Router } from "express";
import { requireAccount } from "../auth.js";
import { PERSON_FIELDS, followedIds, personView, socialProfilesById } from "../community.js";
import { follows, libraries } from "../db.js";
import { HttpError, asyncHandler, keysJson, libraryJson } from "../http.js";
import { listOf, optionalText, record, requiredText, wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import { limiter, socialByHandle, socialSelf } from "../readers.js";

/**
 * A reader's library, for the readers who follow them.
 *
 * The server cannot read inside the sync state (by design), so a reader who
 * wants their library seen uploads a plain list of it here: a key, a title,
 * an author, where they are in it. Nothing else about a book, and no file.
 *
 * It is shown only where two things hold: the owner switched `shareLibrary`
 * on (`PUT /v1/profile/me`), and the reader asking follows them. For a
 * followers-only owner that follow was accepted by them; for a public one it
 * is any follower. A whole library is more than a board row, so even a
 * public reader's is not handed to a stranger.
 */

const MAX_BOOKS = 3000;
const MAX_KEY = 160;
const MAX_KEYS = 500;
/** How many readers are named as "reading this now" for one book. */
const READERS_SHOWN = 5;
const STATES = new Set(["reading", "finished", "unread"]);
const NO_LIBRARY = "No library shared by that reader.";

/**
 * A book's key as stored: trimmed and lower-cased, so the same book has the
 * same key in two readers' lists whatever case their apps wrote it in. Never
 * cut to length: a shortened key would be another book's.
 */
function cleanKey(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!key || key.length > MAX_KEY) {
    throw new HttpError(400, `A book's key should be text, up to ${MAX_KEY} characters.`);
  }
  return key;
}

function cleanBook(value) {
  const book = record(value, "A book");
  if (!STATES.has(book.state)) {
    throw new HttpError(400, "A book's state is one of reading, finished or unread.");
  }
  return {
    key: cleanKey(book.key),
    title: requiredText(book.title, 160, "A book's title"),
    author: optionalText(book.author, 80, "A book's author"),
    state: book.state,
    percent: wholeNumber(book.percent, 0, 100, "A book's percent")
  };
}

export function libraryRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const fallback = defaultLimits();
  const uploads = limiter(limits.library ?? fallback.library);
  const lookups = limiter(limits.search ?? fallback.search);

  /**
   * Counted before the body is read: an upload is up to a megabyte or two to
   * buffer and parse, which is the cost the limit is there to bound.
   */
  const limitUpload = (request, _response, next) => {
    uploads(`acct:${request.account.id}`);
    next();
  };

  /**
   * Replaces the reader's uploaded library with this list. Only for a reader
   * who shares a profile: a private reader's library is not kept here at all.
   * A key sent twice is kept once, as the later of the two.
   */
  router.put(
    "/library/me",
    auth,
    limitUpload,
    libraryJson,
    asyncHandler(async (request, response) => {
      const byKey = new Map();
      for (const book of listOf(request.body?.books, MAX_BOOKS, "books").map(cleanBook)) {
        byKey.set(book.key, book);
      }
      const books = [...byKey.values()];
      const me = await socialSelf(db, request.account.id);
      await libraries(db).replaceOne({ _id: me._id }, { books, updatedAt: new Date() }, { upsert: true });
      response.json({ count: books.length });
    })
  );

  router.delete(
    "/library/me",
    auth,
    asyncHandler(async (request, response) => {
      await libraries(db).deleteOne({ _id: request.account.id });
      response.json({ deleted: true });
    })
  );

  /**
   * A reader's library, to its owner and to the readers who follow them.
   *
   * 404 when there is nothing to be had: no such reader, a followers-only
   * reader who has not accepted the one asking, or a reader who does not
   * share a library (the same answer for all three, so a stranger cannot
   * learn whether a locked reader shares one). 403 only for a public reader
   * who does share theirs, to someone who does not follow them yet. A reader
   * who shares but has uploaded nothing has an empty library, not a missing
   * one.
   */
  router.get(
    "/profile/:handle/library",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const owner = await socialByHandle(db, request.params.handle);
      const isFollower =
        owner._id.equals(meId) ||
        Boolean(await follows(db).findOne({ followerId: meId, followeeId: owner._id }, { projection: { _id: 1 } }));
      if (owner.shareLibrary !== true || (owner.visibility === "followers" && !isFollower)) {
        throw new HttpError(404, NO_LIBRARY);
      }
      if (!isFollower) {
        throw new HttpError(403, "Follow them first to see their library.");
      }
      const library = await libraries(db).findOne({ _id: owner._id });
      response.json({
        books: library?.books ?? [],
        updatedAt: library?.updatedAt instanceof Date ? library.updatedAt.toISOString() : null
      });
    })
  );

  /**
   * "Who among the readers I follow has this book": for each key asked about,
   * how many of them finished it, and up to five who are reading it now,
   * furthest along first. Only the books somebody has; in the order asked.
   *
   * Over the readers this one follows (so a followers-only one has accepted
   * them) who still share a profile and share their library. Three queries
   * however many readers that is: the follows, their profiles, and their
   * libraries. The database hands back only the books asked about, since 500
   * whole libraries of 3000 books would be far too much to hold in memory
   * just to throw most of it away. (The keys go in as a `$literal`: they are
   * a reader's own text, and one starting with "$" would otherwise be read
   * as the name of a field.)
   */
  router.post(
    "/library/among",
    auth,
    keysJson,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      lookups(`acct:${meId}`);
      const keys = [...new Set(listOf(request.body?.keys, MAX_KEYS, "keys").map(cleanKey))];
      const owners = keys.length
        ? await socialProfilesById(db, await followedIds(db, meId), { shareLibrary: true }, PERSON_FIELDS)
        : new Map();
      const shelves = owners.size
        ? await libraries(db)
            .aggregate([
              { $match: { _id: { $in: [...owners.values()].map((owner) => owner._id) } } },
              { $project: { books: { $filter: { input: "$books", cond: { $in: ["$$this.key", { $literal: keys }] } } } } }
            ])
            .toArray()
        : [];

      const byKey = new Map(keys.map((key) => [key, { finished: 0, readers: [] }]));
      for (const shelf of shelves) {
        const owner = owners.get(shelf._id.toHexString());
        for (const book of shelf.books ?? []) {
          const entry = byKey.get(book.key);
          if (!entry) {
            continue;
          }
          if (book.state === "finished") {
            entry.finished += 1;
          } else if (book.state === "reading") {
            entry.readers.push({ ...personView(owner), state: book.state, percent: book.percent });
          }
        }
      }
      const books = [];
      for (const [key, entry] of byKey) {
        if (entry.finished > 0 || entry.readers.length > 0) {
          const readers = entry.readers
            .sort((a, b) => b.percent - a.percent || a.handle.localeCompare(b.handle))
            .slice(0, READERS_SHOWN);
          books.push({ key, finished: entry.finished, readers });
        }
      }
      response.json({ books });
    })
  );

  return router;
}
