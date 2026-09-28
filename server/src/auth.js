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
    const session = await sessions(db).findOne({ _id: sessionId, expiresAt: { $gt: now } });
    if (!session) {
      throw new HttpError(401, "Your session has ended. Sign in again.");
    }
    if (now - session.lastUsedAt > REFRESH_AFTER_MS) {
      await sessions(db).updateOne(
        { _id: sessionId },
        { $set: { lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_MS) } }
      );
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
      const session = await sessions(db).findOne({ _id: sessionId, expiresAt: { $gt: new Date() } });
      if (session) {
        request.account = { id: session.userId, sessionId };
      }
    }
    next();
  });
}

/** The account as the client sees it. Never includes the password hash. */
export function accountView(account) {
  return {
    id: account._id.toHexString(),
    email: account.email,
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
