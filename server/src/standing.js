import { createHmac } from "node:crypto";
import { ObjectId } from "mongodb";
import { isPublic } from "./community.js";
import { accounts, blocks, profiles, settings, suspensions } from "./db.js";
import { HttpError, asyncHandler, notFound } from "./http.js";

/**
 * Who may do things in public, and who is kept from whom.
 *
 * Everything before this was between readers who chose each other: a follow,
 * a club joined with a code. Posts for everyone, book communities and their
 * threads are read by strangers, so what can be written there is held to
 * more. A reader is in good standing for public posting when all of these
 * hold, each of which costs someone who only wants to make a mess something
 * they cannot get by running a script:
 *
 *   a public profile        they are answerable under a handle anyone can see;
 *   a confirmed email       one account per address somebody really reads;
 *   an account 3 days old   a batch of new accounts cannot be used the same day;
 *   the guidelines accepted they were told what is not welcome before they wrote;
 *   not suspended           an admin has not sent them away for a while;
 *   public posting is on    the owner has not switched the whole layer off.
 *
 * Each has its own message, so a reader knows what is in the way. None of it
 * is needed to read, or for anything between followers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const MIN_ACCOUNT_AGE_DAYS = 3;
/** The most readers one reader can block (and so the most ids a feed has to leave out for them). */
export const BLOCK_LIMIT = 1000;
/** How many blocks against one reader are read to filter what they see. */
const BLOCKED_BY_LIMIT = 5000;

export const PAUSED = "Public posting is paused for now.";
export const MAKE_PUBLIC = "Make your profile public to post publicly.";
export const CONFIRM_EMAIL = "Confirm your email address first (Settings, Account).";
export const ACCEPT_RULES = "Read and accept the community guidelines first.";
/** One sentence for both sides of a block, so it never says who blocked whom. */
export const NO_INTERACTION = "You can't interact with this reader.";

/** How old an account is, in days (with a fraction). 0 when it has no date at all. */
export const accountAgeDays = (account, now = new Date()) =>
  account?.createdAt instanceof Date ? Math.max(0, (now.getTime() - account.createdAt.getTime()) / DAY_MS) : 0;

/**
 * Whether the account's address has been confirmed with the emailed code.
 * False for an account made before confirmation existed (it has no
 * `emailConfirmedAt` at all) until its owner confirms it from Settings.
 */
export const emailConfirmed = (account) => account?.emailConfirmedAt instanceof Date;

/** When the reader's suspension ends, if it has not ended yet; else null. */
export const suspendedUntil = (profile, now = new Date()) =>
  profile?.suspendedUntil instanceof Date && profile.suspendedUntil > now ? profile.suspendedUntil : null;

export const isAdmin = (profile) => profile?.role === "admin";

const longDate = (date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const tooNew = (days, what = "post publicly") => new HttpError(403, `New accounts can ${what} after ${days} days.`);

/** Refuses a suspended reader, with the day it ends. */
export function refuseSuspended(profile, now = new Date()) {
  const until = suspendedUntil(profile, now);
  if (until) {
    throw new HttpError(403, `Your account is suspended from posting until ${longDate(until)}.`);
  }
}

/**
 * For what carries weight without being writing: a like or a dislike moves a
 * post up or down for everybody, and a report can hide one. Each needs an
 * account that has been there three days, at an address somebody confirmed,
 * so that neither can be had by the dozen from accounts made this morning.
 * (Not the guidelines, and not a public profile: those are for writing.)
 */
export async function provenAccount(db, accountId, what, now = new Date()) {
  const account = await accounts(db).findOne({ _id: accountId }, { projection: { createdAt: 1, emailConfirmedAt: 1 } });
  if (!emailConfirmed(account)) {
    throw new HttpError(403, CONFIRM_EMAIL);
  }
  if (accountAgeDays(account, now) < MIN_ACCOUNT_AGE_DAYS) {
    throw tooNew(MIN_ACCOUNT_AGE_DAYS, what);
  }
  return account;
}

// ---- a suspension that outlasts the account ------------------------------------
//
// Suspended, a reader could delete the account and sign up again with the
// same address, and be back the same afternoon. So for as long as a
// suspension lasts, the address it was given to is remembered: not the
// address, but a keyed hash of it, which says nothing to anyone who reads the
// database without the key, and is deleted by a TTL index the moment the
// suspension ends. An account made with that address, or changed to it,
// starts out suspended until the same day.

/**
 * What the hash is keyed with when the server has no secret of its own (no
 * mailer configured, so no `RESET_MAIL_SECRET`). Better than a bare hash,
 * since it is at least particular to this application, but it is in the
 * source: with it, someone holding the database could test whether a given
 * address is among the suspended. The secret, where there is one, closes that.
 */
const APPLICATION_SALT = "leaflet:suspensions:v1";

/** The key an address is remembered under. `salt` is the server's secret, or empty. */
export const suspensionKey = (email, salt = "") =>
  createHmac("sha256", salt || APPLICATION_SALT).update(String(email).trim().toLowerCase()).digest("hex");

/** Until when the address is suspended, if it is; else null. */
export async function liveSuspension(db, email, salt, now = new Date()) {
  const kept = await suspensions(db).findOne({ _id: suspensionKey(email, salt) });
  return kept?.suspendedUntil instanceof Date && kept.suspendedUntil > now ? kept.suspendedUntil : null;
}

/**
 * Remembers that the account's address is suspended until `until`. The
 * account's id is kept beside it only so that lifting the suspension can
 * find every address it was remembered under.
 */
export async function rememberSuspension(db, accountId, email, until, salt) {
  await suspensions(db).updateOne(
    { _id: suspensionKey(email, salt) },
    { $set: { accountId, suspendedUntil: until } },
    { upsert: true }
  );
}

/** Forgets every address remembered for this account: its suspension was lifted. */
export const forgetSuspension = (db, accountId) => suspensions(db).deleteMany({ accountId });

/**
 * The owner's switch for the whole public layer (`PUT /v1/admin/settings`).
 * On unless it has been turned off: a server that has never had it set
 * behaves as before.
 */
export async function publicPostingOn(db) {
  const site = await settings(db).findOne({ _id: "site" }, { projection: { publicPosting: 1 } });
  return site?.publicPosting !== false;
}

/** 503 while public posting is switched off. Reading is never refused by it. */
export async function refusePaused(db) {
  if (!(await publicPostingOn(db))) {
    throw new HttpError(503, PAUSED);
  }
}

/**
 * The reader's profile and account, if they are in good standing for public
 * posting; else the refusal that says what is in the way (403, or 503 while
 * the layer is paused).
 */
export async function goodStanding(db, accountId, now = new Date()) {
  const [me, account] = await Promise.all([
    profiles(db).findOne({ _id: accountId }),
    accounts(db).findOne({ _id: accountId }, { projection: { createdAt: 1, emailConfirmedAt: 1 } }),
    refusePaused(db)
  ]);
  if (!isPublic(me)) {
    throw new HttpError(403, MAKE_PUBLIC);
  }
  if (!emailConfirmed(account)) {
    throw new HttpError(403, CONFIRM_EMAIL);
  }
  if (accountAgeDays(account, now) < MIN_ACCOUNT_AGE_DAYS) {
    throw tooNew(MIN_ACCOUNT_AGE_DAYS);
  }
  if (!(me.rulesAcceptedAt instanceof Date)) {
    throw new HttpError(403, ACCEPT_RULES);
  }
  refuseSuspended(me, now);
  return { me, account };
}

/**
 * For the admin routes: anyone who is not an admin is answered as if the
 * route did not exist, so there is nothing here to probe. An admin is a
 * profile with `role: "admin"`, which only the owner can set, by hand, in
 * the database; no route writes it.
 */
export function requireAdmin(db) {
  return asyncHandler(async (request, response, next) => {
    const me = await profiles(db).findOne({ _id: request.account.id }, { projection: { role: 1 } });
    if (!isAdmin(me)) {
      notFound(request, response);
      return;
    }
    next();
  });
}

// ---- blocks -----------------------------------------------------------------

/**
 * Everyone `userId` has blocked or been blocked by, as hex ids. A block cuts
 * both ways for what is shown: neither sees the other's posts, threads or
 * replies, whoever did the blocking.
 */
export async function blockedWith(db, userId) {
  const [mine, theirs] = await Promise.all([
    blocks(db).find({ blockerId: userId }, { projection: { blockedId: 1 }, limit: BLOCK_LIMIT }).toArray(),
    blocks(db).find({ blockedId: userId }, { projection: { blockerId: 1 }, limit: BLOCKED_BY_LIMIT }).toArray()
  ]);
  return new Set([...mine.map((row) => row.blockedId.toHexString()), ...theirs.map((row) => row.blockerId.toHexString())]);
}

/**
 * Which of `ids` are on either side of a block with `userId`, as hex ids:
 * what `blockedWith` says, asked about a known few (whoever a short list is
 * from) rather than read in full. A reader may have blocked a thousand and
 * been blocked by thousands more, and all of those rows were being read to
 * check twenty.
 *
 * A seek in the `pair` index for each id, each way round, and no block
 * fetched; so at most twice as many rows as ids. The index is named because
 * the second half could also be answered from `blocked`, by reading everyone
 * who has blocked this reader, and which of the two the database picks is
 * not ours to count on.
 */
export async function blockedAmong(db, userId, ids) {
  if (ids.length === 0) {
    return new Set();
  }
  const rows = await blocks(db)
    .find(
      { $or: [{ blockerId: userId, blockedId: { $in: ids } }, { blockerId: { $in: ids }, blockedId: userId }] },
      { projection: { _id: 0, blockerId: 1, blockedId: 1 }, hint: "pair" }
    )
    .toArray();
  return new Set(rows.map((row) => (row.blockerId.equals(userId) ? row.blockedId : row.blockerId).toHexString()));
}

/** Whether either of the two has blocked the other. */
export async function isBlockedPair(db, a, b) {
  const row = await blocks(db).findOne(
    { $or: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    { projection: { _id: 1 } }
  );
  return Boolean(row);
}

/** Whether `ownerId` has blocked `viewerId` (that way round only). */
export async function hasBlocked(db, ownerId, viewerId) {
  return Boolean(await blocks(db).findOne({ blockerId: ownerId, blockedId: viewerId }, { projection: { _id: 1 } }));
}

/** 403, in the one neutral sentence, when either of the two has blocked the other. */
export async function refuseBlocked(db, a, b) {
  if (await isBlockedPair(db, a, b)) {
    throw new HttpError(403, NO_INTERACTION);
  }
}

// ---- whose writing is shown ---------------------------------------------------

/**
 * An aggregation stage that attaches the author's profile to each document
 * as `as` (a list of one, or of none), when that author's writing may be
 * shown at all: they still have a handle and are not suspended. A post names
 * it `poster`, because a post's own `author` is the book's. Whether they
 * are public, followed or blocked is for the stage after it, which knows who
 * is asking.
 *
 * Done in the database, before the page is cut, so that a page of thirty is
 * thirty that can be shown, and "is there more" is true.
 */
export const withAuthor = (field, viewerId = null, now = new Date(), as = "author") => ({
  $lookup: {
    from: "profiles",
    let: { author: `$${field}` },
    pipeline: [
      { $match: { $expr: { $eq: ["$_id", "$$author"] } } },
      {
        $match: {
          handle: { $type: "string" },
          visibility: { $in: ["public", "followers"] },
          // A suspended reader's writing is shown to nobody but themself.
          $or: [
            { _id: viewerId },
            { suspendedUntil: { $exists: false } },
            { suspendedUntil: null },
            { suspendedUntil: { $lte: now } }
          ]
        }
      },
      { $project: { handle: 1, displayName: 1, avatar: 1, visibility: 1 } }
    ],
    as
  }
});

/** Hex ids as ObjectIds, for a `$nin`. */
export const idsOf = (set) => [...set].map((hex) => new ObjectId(hex));
