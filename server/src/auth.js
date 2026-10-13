import { createHash, randomBytes } from "node:crypto";
import { accounts, sessions } from "./db.js";
import { HttpError, asyncHandler } from "./http.js";
import { avatarView } from "./avatars.js";

/**
 * Sessions: an opaque random token for the client, only its hash for us.
 *
 * The token is 32 random bytes, shown to the client once. The database keeps
 * its SHA-256, so a leaked backup or a read-only breach yields nothing that
 * can sign in. (A slow hash is unnecessary here: the input is 256 bits of
 * randomness, not something a person chose.)
 *
 * A session lasts 90 days from its last use. Refreshing on every request would
 * write to Mongo on every request, so the expiry moves forward at most hourly.
 */

export const SESSION_DAYS = 90;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await sessions(db).insertOne({
    _id: hashToken(token),
    userId,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MS)
  });
  return token;
}

function bearer(request) {
  const header = request.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * The sessions seen in the last minute, so that a request does not begin
 * with a trip to the database to ask who is calling.
 *
 * Every request an open app makes carries the same token, and an app sends
 * a handful every few minutes, most of them one or two queries long: asking
 * about the session first was a third of everything the database was asked.
 * Kept for a minute, a session is asked about once a minute at most.
 *
 * Ending a session ends it here in the same breath (`endSession`,
 * `endSessionsOf`: signing out, a changed or reset password, a deleted
 * account), so a token that was signed out never works again, not even for
 * the minute. Like the rate limits this is one process's memory. Only a
 * session removed from the database by hand is still let in until its minute
 * is up.
 */
const SESSION_KEPT_MS = 60_000;
const MAX_KEPT_SESSIONS = 5_000;
const kept = new Map();

/** The live session with this id as `{ userId, lastUsedAt, expiresAt }`, or null. */
async function liveSession(db, sessionId, now) {
  const seen = kept.get(sessionId);
  if (seen && now - seen.at < SESSION_KEPT_MS && seen.session.expiresAt > now) {
    return seen.session;
  }
  kept.delete(sessionId);
  const session = await sessions(db).findOne({ _id: sessionId, expiresAt: { $gt: now } });
  if (session) {
    if (kept.size >= MAX_KEPT_SESSIONS) {
      kept.clear();
    }
    kept.set(sessionId, { at: now.getTime(), session });
  }
  return session;
}

/** Ends one session (signing out): deleted, and forgotten here once it is. */
export async function endSession(db, sessionId) {
  await sessions(db).deleteOne({ _id: sessionId });
  kept.delete(sessionId);
}

/**
 * Ends every session of an account, but for `exceptId` when one is given
 * (the device a password was just changed on). Resolves to how many ended.
 */
export async function endSessionsOf(db, userId, exceptId = null) {
  const { deletedCount } = await sessions(db).deleteMany(exceptId ? { userId, _id: { $ne: exceptId } } : { userId });
  for (const [sessionId, { session }] of kept) {
    if (sessionId !== exceptId && session.userId.equals(userId)) {
      kept.delete(sessionId);
    }
  }
  return deletedCount;
}

/**
 * Rejects anything without a live session, and sets `request.account` to
 * `{ id, sessionId }`.
 *
 * Runs before any body is parsed, so an unauthenticated request never gets to
 * make the server buffer a large upload.
 */
export function requireAccount(db) {
  return asyncHandler(async (request, _response, next) => {
    const token = bearer(request);
    if (!TOKEN_PATTERN.test(token)) {
      throw new HttpError(401, "Sign in to continue.");
    }
    const sessionId = hashToken(token);
    const now = new Date();
    const session = await liveSession(db, sessionId, now);
    if (!session) {
      throw new HttpError(401, "Your session has ended. Sign in again.");
    }
    if (now - session.lastUsedAt > REFRESH_AFTER_MS) {
      const expiresAt = new Date(now.getTime() + SESSION_MS);
      // Noted on the kept copy first, so the requests that arrive beside
      // this one do not each write the same thing.
      session.lastUsedAt = now;
      session.expiresAt = expiresAt;
      await sessions(db).updateOne({ _id: sessionId }, { $set: { lastUsedAt: now, expiresAt } });
    }
    request.account = { id: session.userId, sessionId };
    next();
  });
}

/**
 * Like `requireAccount`, but a missing or stale token is simply no account:
 * for public routes that say a little more to a signed-in reader ("that's
 * you", "you follow them"). Never a 401, so the public view always works.
 */
export function optionalAccount(db) {
  return asyncHandler(async (request, _response, next) => {
    const token = bearer(request);
    if (TOKEN_PATTERN.test(token)) {
      const sessionId = hashToken(token);
      const session = await liveSession(db, sessionId, new Date());
      if (session) {
        request.account = { id: session.userId, sessionId };
      }
    }
    next();
  });
}

/**
 * The account as the client sees it. Never includes the password hash.
 *
 * `emailConfirmed` is false for an account made before confirmation existed
 * (it has no `emailConfirmedAt` at all): nobody has shown the address works.
 */
export function accountView(account) {
  return {
    id: account._id.toHexString(),
    email: account.email,
    emailConfirmed: account.emailConfirmedAt instanceof Date,
    displayName: account.displayName ?? null,
    avatar: avatarView(account.avatar),
    createdAt: account.createdAt instanceof Date ? account.createdAt.toISOString() : null
  };
}

export async function loadAccount(db, id) {
  const account = await accounts(db).findOne({ _id: id });
  if (!account) {
    throw new HttpError(401, "Your session has ended. Sign in again.");
  }
  return account;
}
