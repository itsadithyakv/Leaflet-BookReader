import { Router } from "express";
import { accounts, profiles, sessions, states } from "../db.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { accountView, createSession, loadAccount, requireAccount } from "../auth.js";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "../passwords.js";
import { RateLimiter } from "../rateLimit.js";
import { deleteCommunityData } from "../community.js";
import { forgetBoards } from "../boardCache.js";
import { isAvatar } from "../avatars.js";

/**
 * Email + password accounts.
 *
 * One identity across devices. The desktop app is free and needs no account
 * for anything but the leaderboard and cloud state; the account exists now so
 * a reader is the same reader on the mobile app later.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const DISPLAY_NAME_MAX = 40;
const LOGIN_FAILED = "Email or password is incorrect.";

export function normaliseEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function emailProblem(email) {
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

function cleanDisplayName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "Display name should be text.");
  }
  return value.trim().slice(0, DISPLAY_NAME_MAX) || null;
}

/** An avatar id from the allowlist, null to clear it, or a 400. */
function cleanAvatar(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isAvatar(value)) {
    throw new HttpError(400, "Pick one of the avatars on offer.");
  }
  return value;
}

export function accountRoutes(db, limits) {
  const router = Router();
  const byIp = new RateLimiter(limits.ip);
  const byEmail = new RateLimiter(limits.email);
  const signups = new RateLimiter(limits.signup);
  const auth = requireAccount(db);

  const tooMany = (seconds) =>
    new HttpError(429, "Too many attempts. Try again in a few minutes.", { retryAfter: seconds });

  /** Every signup/login counts against the caller's address. */
  const limitIp = (request) => {
    const key = request.ip ?? "unknown";
    const wait = byIp.blockedFor(key);
    if (wait) {
      throw tooMany(wait);
    }
    byIp.hit(key);
  };

  /** A password check against an account, keyed by whatever names it. */
  const checkPassword = async (key, password, hash) => {
    const wait = byEmail.blockedFor(key);
    if (wait) {
      throw tooMany(wait);
    }
    const ok = hash ? await verifyPassword(password, hash) : await burnPasswordCheck(password);
    if (ok) {
      byEmail.reset(key);
    } else {
      byEmail.hit(key);
    }
    return ok;
  };

  router.post(
    "/auth/signup",
    smallJson,
    asyncHandler(async (request, response) => {
      limitIp(request);
      const body = request.body ?? {};
      const email = normaliseEmail(body.email);
      const problem = emailProblem(email) ?? passwordProblem(body.password);
      if (problem) {
        throw new HttpError(400, problem);
      }
      const displayName = cleanDisplayName(body.displayName);
      const avatar = cleanAvatar(body.avatar);

      const ipKey = request.ip ?? "unknown";
      const wait = Math.max(signups.blockedFor(ipKey), signups.blockedFor(`email:${email}`));
      if (wait) {
        throw tooMany(wait);
      }
      signups.hit(ipKey);
      signups.hit(`email:${email}`);

      const now = new Date();
      const doc = {
        email,
        passwordHash: await hashPassword(body.password),
        displayName,
        avatar,
        createdAt: now,
        passwordChangedAt: now
      };
      try {
        const { insertedId } = await accounts(db).insertOne(doc);
        doc._id = insertedId;
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "An account with that email already exists. Sign in instead.");
        }
        throw error;
      }

      const token = await createSession(db, doc._id);
      response.status(201).json({ token, account: accountView(doc) });
    })
  );

  router.post(
    "/auth/login",
    smallJson,
    asyncHandler(async (request, response) => {
      limitIp(request);
      const body = request.body ?? {};
      const email = normaliseEmail(body.email);
      if (emailProblem(email) || typeof body.password !== "string" || !body.password) {
        throw new HttpError(401, LOGIN_FAILED);
      }
      // The same work, the same message and the same status whether or not the
      // email exists, so a login form cannot be used to test addresses.
      const account = await accounts(db).findOne({ email });
      const ok = await checkPassword(`email:${email}`, body.password, account?.passwordHash);
      if (!account || !ok) {
        throw new HttpError(401, LOGIN_FAILED);
      }
      const token = await createSession(db, account._id);
      response.json({ token, account: accountView(account) });
    })
  );

  router.post(
    "/auth/logout",
    auth,
    asyncHandler(async (request, response) => {
      await sessions(db).deleteOne({ _id: request.account.sessionId });
      response.json({ ok: true });
    })
  );

  router.get(
    "/auth/me",
    auth,
    asyncHandler(async (request, response) => {
      const account = await loadAccount(db, request.account.id);
      response.json({ account: accountView(account) });
    })
  );

  /** Changes the password and signs out every other device. */
  router.post(
    "/auth/password",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      const account = await loadAccount(db, request.account.id);
      // 403 rather than 401: the session is fine, the password is not, and a
      // client treats 401 as "you have been signed out".
      if (!(await checkPassword(`id:${account._id}`, body.current, account.passwordHash))) {
        throw new HttpError(403, "Current password is incorrect.");
      }
      const problem = passwordProblem(body.next);
      if (problem) {
        throw new HttpError(400, problem);
      }
      await accounts(db).updateOne(
        { _id: account._id },
        { $set: { passwordHash: await hashPassword(body.next), passwordChangedAt: new Date() } }
      );
      const { deletedCount } = await sessions(db).deleteMany({
        userId: account._id,
        _id: { $ne: request.account.sessionId }
      });
      response.json({ ok: true, otherSessionsRevoked: deletedCount });
    })
  );

  /**
   * Updates what the reader controls about the account itself. Only the fields
   * sent change, so picking an avatar leaves the name alone.
   *
   * The avatar is also copied onto the community profile, if there is one, so
   * the board can show it without a second lookup per row.
   */
  router.patch(
    "/account",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      const update = {};
      if (body.displayName !== undefined) {
        update.displayName = cleanDisplayName(body.displayName);
      }
      if (body.avatar !== undefined) {
        update.avatar = cleanAvatar(body.avatar);
      }
      if (Object.keys(update).length > 0) {
        await accounts(db).updateOne({ _id: request.account.id }, { $set: update });
      }
      if (update.avatar !== undefined) {
        await profiles(db).updateOne({ _id: request.account.id }, { $set: { avatar: update.avatar } });
        forgetBoards();
      }
      response.json({ account: accountView(await loadAccount(db, request.account.id)) });
    })
  );

  /**
   * Deletes the account and everything keyed to it: community data (follows,
   * kudos, duels, inbox events), profile, state blob, sessions, then the account. Sessions go before the account, so a failure
   * part-way leaves an account the reader can still sign in to and delete.
   */
  router.delete(
    "/account",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      const account = await loadAccount(db, request.account.id);
      if (!(await checkPassword(`id:${account._id}`, request.body?.password, account.passwordHash))) {
        throw new HttpError(403, "Password is incorrect.");
      }
      await deleteCommunityData(db, account._id);
      await profiles(db).deleteOne({ _id: account._id });
      forgetBoards();
      await states(db).deleteOne({ _id: account._id });
      await sessions(db).deleteMany({ userId: account._id });
      await accounts(db).deleteOne({ _id: account._id });
      response.json({ deleted: true });
    })
  );

  return router;
}
