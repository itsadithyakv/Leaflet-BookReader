import { Router } from "express";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { accounts, confirmations, profiles, resets, sessions, states } from "../db.js";
import { HttpError, asyncHandler, plainText, smallJson } from "../http.js";
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

// ---- password reset ---------------------------------------------------------
//
// A code, not a link: the app is a desktop program with no web page for a
// link to open, and a code is typed where the reader already is.
//
// Eight characters from 29 that are hard to misread (no 0/O, 1/I/L, U/V),
// shown as ABCD-EFGH: 29^8 ≈ 5e11 codes, valid 15 minutes, 5 wrong tries,
// then gone.
const RESET_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
const RESET_LENGTH = 8;
export const RESET_MINUTES = 15;
const RESET_TRIES = 5;
const RESET_FAILED = "That code is wrong or has expired. Ask for a new one.";
// Completed resets allowed per account in any 365 days. Past that, the request
// emails an explanation instead of a code (the reply on screen stays the same,
// so it still cannot tell whether an address has an account).
export const RESETS_PER_YEAR = 3;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** The account's completed resets in the last 365 days, oldest first. */
function resetsThisYear(account, now = Date.now()) {
  return (account.passwordResets ?? [])
    .map((at) => new Date(at))
    .filter((at) => now - at.getTime() < YEAR_MS)
    .sort((a, b) => a - b);
}

/** "12 March 2027": the day a reset is possible again. */
function resetAvailableOn(recent) {
  const at = new Date(recent[0].getTime() + YEAR_MS);
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function newResetCode() {
  let code = "";
  for (let index = 0; index < RESET_LENGTH; index += 1) {
    code += RESET_ALPHABET[randomInt(RESET_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What the reader typed, as stored: upper case, no spaces or dashes. */
function resetDigest(code) {
  const cleaned = typeof code === "string" ? code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  return createHash("sha256").update(cleaned).digest();
}

// ---- email confirmation -----------------------------------------------------
//
// A typo in the address at sign-up used to lose the account for good: the
// reset email could never arrive. So a code goes to the address when the
// account is made, and the app asks for it. Nothing waits on it: the account
// works at once, confirmed or not.
//
// The same kind of code as a reset, kept the same way. It lasts longer, since
// the reader has to go and find the email first.
export const CONFIRM_MINUTES = 30;
const CONFIRM_TRIES = 5;
const CONFIRM_FAILED = "That code is wrong or has expired. Ask for a new one.";

/**
 * A confirmation code as stored: hashed together with the address it was sent
 * to, so it can never confirm another one (the address can change while a
 * code is out).
 */
function confirmDigest(email, code) {
  return createHash("sha256").update(email).update("\n").update(resetDigest(code)).digest();
}

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
  return plainText(value, DISPLAY_NAME_MAX) || null;
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

export function accountRoutes(db, limits, mailer = null) {
  const router = Router();
  const byIp = new RateLimiter(limits.ip);
  const byEmail = new RateLimiter(limits.email);
  const signups = new RateLimiter(limits.signup);
  const resetsByIp = new RateLimiter(limits.resetIp);
  const resetsByEmail = new RateLimiter(limits.resetEmail);
  const confirmsByAccount = new RateLimiter(limits.confirmAccount);
  const confirmsByEmail = new RateLimiter(limits.confirmEmail);
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

  /**
   * The account for the client. Without a mailer no code can be sent, so the
   * account is described as it was before confirmation existed, and the app
   * shows nothing about it.
   */
  const view = (account) => {
    const seen = accountView(account);
    if (!mailer) {
      delete seen.emailConfirmed;
    }
    return seen;
  };

  /** A new code for the account's address, replacing the last one and its wrong tries. */
  const newConfirmation = async (accountId, email) => {
    const code = newResetCode();
    const now = new Date();
    await confirmations(db).replaceOne(
      { _id: accountId },
      {
        codeHash: confirmDigest(email, code).toString("hex"),
        attempts: 0,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CONFIRM_MINUTES * 60_000)
      },
      { upsert: true }
    );
    return code;
  };

  /**
   * Emails the code, after the answer has gone. A failure is only logged:
   * "refused: bad request" means the Apps Script is older than this message
   * and needs its new version deployed.
   */
  const mailConfirmation = (email, code) => {
    confirmsByEmail.hit(email);
    Promise.resolve()
      // `confirmation`, not `code`: a script from before this message existed
      // takes any `code` for a password reset and would send that email.
      .then(() => mailer({ kind: "confirm", to: email, confirmation: code, minutes: CONFIRM_MINUTES }))
      .catch((error) => console.error("[leaflet] confirmation email not sent:", error?.message ?? error));
  };

  /** Refuses another confirmation email for now, or counts this one. */
  const limitConfirmation = (accountId, email) => {
    const key = `id:${accountId}`;
    const wait = Math.max(confirmsByAccount.blockedFor(key), confirmsByEmail.blockedFor(email));
    if (wait) {
      throw tooMany(wait);
    }
    confirmsByAccount.hit(key);
  };

  const noMailer = () => new HttpError(503, "Email confirmation isn't set up on this server yet.");

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
        passwordChangedAt: now,
        emailConfirmedAt: null
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
      // The account is made whatever happens to its code: it can be asked for
      // again from Settings.
      const code = mailer
        ? await newConfirmation(doc._id, email).catch((error) => {
            console.error("[leaflet] confirmation code not kept:", error?.message ?? error);
            return null;
          })
        : null;
      response.status(201).json({ token, account: view(doc) });
      if (code) {
        mailConfirmation(email, code);
      }
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
      response.json({ token, account: view(account) });
    })
  );

  /**
   * Emails a reset code, if the address has an account. The answer is the same
   * either way, and the email is sent after answering, so neither the reply nor
   * its timing tells whether an address is registered.
   */
  router.post(
    "/auth/reset/request",
    smallJson,
    asyncHandler(async (request, response) => {
      if (!mailer) {
        throw new HttpError(503, "Password reset isn't set up on this server yet.");
      }
      const email = normaliseEmail(request.body?.email);
      const problem = emailProblem(email);
      if (problem) {
        throw new HttpError(400, problem);
      }
      const ipKey = request.ip ?? "unknown";
      const wait = Math.max(resetsByIp.blockedFor(ipKey), resetsByEmail.blockedFor(email));
      if (wait) {
        throw tooMany(wait);
      }
      resetsByIp.hit(ipKey);
      resetsByEmail.hit(email);

      const account = await accounts(db).findOne({ email }, { projection: { _id: 1, passwordResets: 1 } });
      const recent = account ? resetsThisYear(account) : [];
      if (account && recent.length >= RESETS_PER_YEAR) {
        const availableOn = resetAvailableOn(recent);
        Promise.resolve()
          .then(() => mailer({ kind: "limit", to: email, availableOn }))
          .catch((error) => console.error("[leaflet] reset limit email not sent:", error?.message ?? error));
      } else if (account) {
        const code = newResetCode();
        const now = new Date();
        // A new code replaces the last one, and its count of wrong tries.
        await resets(db).replaceOne(
          { _id: account._id },
          {
            codeHash: resetDigest(code).toString("hex"),
            attempts: 0,
            createdAt: now,
            expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000)
          },
          { upsert: true }
        );
        Promise.resolve()
          .then(() => mailer({ kind: "code", to: email, code, minutes: RESET_MINUTES }))
          .catch((error) => console.error("[leaflet] reset email not sent:", error?.message ?? error));
      }
      response.json({ ok: true, minutes: RESET_MINUTES });
    })
  );

  /**
   * Sets a new password with an emailed code, signs out every device, and
   * signs this one in.
   */
  router.post(
    "/auth/reset/confirm",
    smallJson,
    asyncHandler(async (request, response) => {
      limitIp(request);
      const body = request.body ?? {};
      const email = normaliseEmail(body.email);
      const problem = passwordProblem(body.password);
      if (problem) {
        throw new HttpError(400, problem);
      }
      const key = `reset:${email}`;
      const wait = byEmail.blockedFor(key);
      if (wait) {
        throw tooMany(wait);
      }
      const account = emailProblem(email) ? null : await accounts(db).findOne({ email });
      const pending = account ? await resets(db).findOne({ _id: account._id }) : null;
      const fresh = pending && pending.expiresAt > new Date() && pending.attempts < RESET_TRIES;
      const matches =
        fresh && timingSafeEqual(Buffer.from(pending.codeHash, "hex"), resetDigest(body.code));
      if (!matches) {
        byEmail.hit(key);
        if (pending) {
          // Wrong tries use the code up; the last one takes it away.
          if (pending.attempts + 1 >= RESET_TRIES) {
            await resets(db).deleteOne({ _id: pending._id });
          } else {
            await resets(db).updateOne({ _id: pending._id }, { $inc: { attempts: 1 } });
          }
        }
        throw new HttpError(400, RESET_FAILED);
      }
      byEmail.reset(key);
      const recent = resetsThisYear(account);
      if (recent.length >= RESETS_PER_YEAR) {
        await resets(db).deleteOne({ _id: account._id });
        throw new HttpError(403, `This account has been reset ${RESETS_PER_YEAR} times this year. It can be reset again on ${resetAvailableOn(recent)}.`);
      }

      // The code is spent before anything else, so it can never be used twice.
      const { deletedCount } = await resets(db).deleteOne({ _id: account._id, codeHash: pending.codeHash });
      if (deletedCount !== 1) {
        throw new HttpError(400, RESET_FAILED);
      }
      await accounts(db).updateOne(
        { _id: account._id },
        {
          $set: {
            passwordHash: await hashPassword(body.password),
            passwordChangedAt: new Date(),
            // Only the last year's are kept; older ones no longer count.
            passwordResets: [...recent, new Date()]
          }
        }
      );
      await sessions(db).deleteMany({ userId: account._id });
      const token = await createSession(db, account._id);
      response.json({ token, account: view(account) });
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
      response.json({ account: view(account) });
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
      response.json({ account: view(await loadAccount(db, request.account.id)) });
    })
  );

  /**
   * Emails a new confirmation code to the account's address. The last code
   * stops working. An address already confirmed is sent nothing.
   */
  router.post(
    "/account/email/code",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      if (!mailer) {
        throw noMailer();
      }
      const account = await loadAccount(db, request.account.id);
      if (account.emailConfirmedAt instanceof Date) {
        response.json({ sent: false, minutes: CONFIRM_MINUTES, account: view(account) });
        return;
      }
      limitConfirmation(account._id, account.email);
      const code = await newConfirmation(account._id, account.email);
      response.json({ sent: true, minutes: CONFIRM_MINUTES, account: view(account) });
      mailConfirmation(account.email, code);
    })
  );

  /** Confirms the account's address with the emailed code. */
  router.post(
    "/account/email/confirm",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      if (!mailer) {
        throw noMailer();
      }
      const account = await loadAccount(db, request.account.id);
      // Confirmed already (on another device, say): nothing left to do.
      if (account.emailConfirmedAt instanceof Date) {
        response.json({ account: view(account) });
        return;
      }
      const key = `confirm:${account._id}`;
      const wait = byEmail.blockedFor(key);
      if (wait) {
        throw tooMany(wait);
      }
      const pending = await confirmations(db).findOne({ _id: account._id });
      const fresh = pending && pending.expiresAt > new Date() && pending.attempts < CONFIRM_TRIES;
      const matches =
        fresh &&
        timingSafeEqual(Buffer.from(pending.codeHash, "hex"), confirmDigest(account.email, request.body?.code));
      if (!matches) {
        byEmail.hit(key);
        if (pending) {
          // Wrong tries use the code up; the last one takes it away.
          if (pending.attempts + 1 >= CONFIRM_TRIES) {
            await confirmations(db).deleteOne({ _id: pending._id });
          } else {
            await confirmations(db).updateOne({ _id: pending._id }, { $inc: { attempts: 1 } });
          }
        }
        throw new HttpError(400, CONFIRM_FAILED);
      }
      byEmail.reset(key);
      // Spent first, so it works once. And only while the address is still
      // the one it was checked against: a change of address made meanwhile
      // leaves the new one unconfirmed.
      const { deletedCount } = await confirmations(db).deleteOne({ _id: account._id, codeHash: pending.codeHash });
      const confirmedAt = new Date();
      const { matchedCount } = deletedCount
        ? await accounts(db).updateOne(
            { _id: account._id, email: account.email },
            { $set: { emailConfirmedAt: confirmedAt } }
          )
        : { matchedCount: 0 };
      if (matchedCount !== 1) {
        throw new HttpError(400, CONFIRM_FAILED);
      }
      response.json({ account: view({ ...account, emailConfirmedAt: confirmedAt }) });
    })
  );

  /**
   * Changes the account's address, with the password. Every device stays
   * signed in. The new address starts unconfirmed and is sent a code; codes
   * sent to the old one (to confirm it, or to reset the password) stop
   * working.
   */
  router.post(
    "/account/email",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      if (!mailer) {
        throw noMailer();
      }
      const body = request.body ?? {};
      const account = await loadAccount(db, request.account.id);
      // 403 rather than 401, as for a change of password.
      if (!(await checkPassword(`id:${account._id}`, body.password, account.passwordHash))) {
        throw new HttpError(403, "Password is incorrect.");
      }
      const email = normaliseEmail(body.email);
      const problem = emailProblem(email);
      if (problem) {
        throw new HttpError(400, problem);
      }
      if (email === account.email) {
        throw new HttpError(400, "That is already this account's email.");
      }
      limitConfirmation(account._id, email);
      try {
        await accounts(db).updateOne({ _id: account._id }, { $set: { email, emailConfirmedAt: null } });
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "An account with that email already exists.");
        }
        throw error;
      }
      await resets(db).deleteOne({ _id: account._id });
      const code = await newConfirmation(account._id, email);
      response.json({ sent: true, minutes: CONFIRM_MINUTES, account: view({ ...account, email, emailConfirmedAt: null }) });
      mailConfirmation(email, code);
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
      await resets(db).deleteOne({ _id: account._id });
      await confirmations(db).deleteOne({ _id: account._id });
      await accounts(db).deleteOne({ _id: account._id });
      response.json({ deleted: true });
    })
  );

  return router;
}
