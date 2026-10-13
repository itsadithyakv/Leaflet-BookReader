import { ObjectId } from "mongodb";
import { SOCIAL, canSee, isSocial } from "./community.js";
import { asString, profiles } from "./db.js";
import { HttpError } from "./http.js";
import { RateLimiter } from "./rateLimit.js";
import { isWeekKey, isoWeekKey, plausibleWeekKeys } from "./week.js";
import { HANDLE_PATTERN } from "./routes/social.js";

/**
 * Finding the two readers a community request is about, the one asking and
 * the one named, shared by every community route so they all refuse in the
 * same words.
 *
 * A private handle and one that does not exist are indistinguishable (both
 * 404). A reader who shares with followers only can be found, so asking for
 * more than their card without following them is a 403 that says so.
 */

/**
 * Who a profile is and whether it is shared, and no more: the projection for
 * a route that only needs to know the two readers it is about (a follow, a
 * gift, kudos), not the shelf, badges and camp each of them carries.
 */
export const WHO_FIELDS = { handle: 1, visibility: 1 };

export const SHARE_FIRST = "Make your profile public or followers-only to join in.";
export const NO_SUCH_READER = "No shared profile with that handle.";
export const FOLLOW_FIRST = "They share with their followers only. Follow them first.";

/** `?week=` when it is one a real clock could be in, else the server's. */
export const askedWeek = (value) =>
  typeof value === "string" && isWeekKey(value) && plausibleWeekKeys().has(value) ? value : isoWeekKey();

/** A handle as stored: lower case, without the "@" it is shown with. */
export const cleanHandle = (raw) => String(raw ?? "").trim().toLowerCase().replace(/^@/, "");

/**
 * The shared profile with that handle (public or followers-only), or null.
 *
 * `fields`, here and below, is a projection for a route that needs only a
 * little of the profile (it carries a shelf, badges and a camp of up to
 * 3 KB). It has to keep `handle` and `visibility`: those are what say a
 * profile is shared. Left out, the whole profile is read.
 */
export async function findSocial(db, raw, fields = undefined) {
  const handle = cleanHandle(raw);
  const profile = HANDLE_PATTERN.test(handle)
    ? await profiles(db).findOne({ handle: asString(handle), visibility: { $in: SOCIAL } }, fields ? { projection: fields } : {})
    : null;
  return isSocial(profile) ? profile : null;
}

/** The same, or a 404. */
export async function socialByHandle(db, raw, fields = undefined) {
  const profile = await findSocial(db, raw, fields);
  if (!profile) {
    throw new HttpError(404, NO_SUCH_READER);
  }
  return profile;
}

/**
 * A reader `viewerId` may see in full: a public one, or a followers-only one
 * who has accepted their follow. 404 for a private or missing handle, 403 for
 * a followers-only reader they do not follow.
 */
export async function visibleByHandle(db, viewerId, raw, fields = undefined) {
  const profile = await socialByHandle(db, raw, fields);
  if (!(await canSee(db, viewerId, profile))) {
    throw new HttpError(403, FOLLOW_FIRST);
  }
  return profile;
}

/** The acting reader's own profile, which must be shared to interact. */
export async function socialSelf(db, id, fields = undefined) {
  const me = await profiles(db).findOne({ _id: id }, fields ? { projection: fields } : {});
  if (!isSocial(me)) {
    throw new HttpError(403, SHARE_FIRST);
  }
  return me;
}

export const notSelf = (me, them, message) => {
  if (me._id.equals(them._id)) {
    throw new HttpError(400, message);
  }
};

export const objectId = (value) => (ObjectId.isValid(value) && String(value).length === 24 ? new ObjectId(value) : null);

/**
 * A rate limit as a function of its key: throws the 429 when the key has had
 * its share, and counts the attempt otherwise.
 */
export function limiter(config) {
  const counts = new RateLimiter(config);
  return (key) => {
    const wait = counts.blockedFor(key);
    if (wait) {
      throw new HttpError(429, "That's a lot at once. Try again in a few minutes.", { retryAfter: wait });
    }
    counts.hit(key);
  };
}

/** Midnight UTC at the start of today: "per day" limits count from here. */
export const utcDayStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** A 429 for a daily allowance that is used up, good again at midnight UTC. */
export function dailyLimit(message, now = new Date()) {
  const next = utcDayStart(now).getTime() + 24 * 60 * 60 * 1000;
  return new HttpError(429, message, { retryAfter: Math.max(1, Math.ceil((next - now.getTime()) / 1000)) });
}
