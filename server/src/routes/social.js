import { Router } from "express";
import { requireAccount } from "../auth.js";
import { accounts, profiles } from "../db.js";
import { avatarView } from "../avatars.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { isWeekKey, plausibleWeekKeys } from "../week.js";
import { deleteCommunityData, recordDuelMinutes } from "../community.js";
import { forgetBoards } from "../boardCache.js";

/**
 * A reader's own profile: the numbers the board ranks on and the shelf they
 * chose to show. The public side (the board, other readers' profiles, follows,
 * kudos and duels) is in `community.js`.
 *
 * Everything here is opt-in. A profile starts `private`, appears on no board and
 * is readable by nobody, until its owner turns sharing on.
 */

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/;
/** Handles that could be mistaken for the app, its staff or its mascot. */
export const RESERVED_HANDLES = new Set([
  "admin", "administrator", "root", "system", "moderator", "mod", "staff",
  "leaflet", "leafletapp", "leaflet-app", "leaflet_app", "official", "team",
  "support", "help", "helpdesk", "security", "privacy", "legal", "abuse",
  "contact", "info", "news", "api", "www", "mail", "noreply", "no-reply",
  "pip", "paperkite", "me", "you", "null", "undefined", "anonymous", "everyone"
]);

const MAX_SHELF = 12;
/** Minutes in a week. A reader cannot have read more than that in one. */
const MAX_WEEK_MINUTES = 7 * 24 * 60;
/** A century of days; anything larger is not a real streak. */
const MAX_STREAK = 36_500;
const MAX_BOOKS_FINISHED = 100_000;

function ownView(profile) {
  return {
    handle: profile?.handle ?? null,
    displayName: profile?.displayName ?? null,
    visibility: profile?.visibility ?? "private",
    weekKey: profile?.weekKey ?? null,
    weekMinutes: Math.round(profile?.weekMinutes ?? 0),
    streak: profile?.streak ?? 0,
    booksFinished: profile?.booksFinished ?? 0,
    shelf: profile?.shelf ?? []
  };
}

function sanitiseShelf(shelf) {
  if (!Array.isArray(shelf)) {
    throw new HttpError(400, "Shelf should be a list.");
  }
  return shelf.slice(0, MAX_SHELF).map((book) => ({
    title: String(book?.title ?? "").slice(0, 120),
    author: book?.author ? String(book.author).slice(0, 80) : null,
    // Drives the spine's look. Deterministic, so no image is ever uploaded.
    styleSeed: String(book?.styleSeed ?? "").slice(0, 64)
  }));
}

/** A finite number in [0, max], or a 400. */
function bounded(value, max, name, integer) {
  const number = Number(value);
  if (typeof value !== "number" || !Number.isFinite(number) || number < 0 || number > max) {
    throw new HttpError(400, `${name} must be a number between 0 and ${max}.`);
  }
  return integer ? Math.trunc(number) : number;
}

export function handleProblem(handle) {
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handles are 3–24 characters: letters, numbers, hyphens and underscores.";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved. Try another.";
  }
  return null;
}

export function socialRoutes(db) {
  const router = Router();
  const auth = requireAccount(db);

  router.get(
    "/profile/me",
    auth,
    asyncHandler(async (request, response) => {
      response.json(ownView(await profiles(db).findOne({ _id: request.account.id })));
    })
  );

  /**
   * Publishes the numbers the board ranks on, plus the shelf.
   *
   * Self-reported: the server cannot read inside the state blob by design.
   * Bounded so one client cannot park an impossible number on the board.
   */
  router.put(
    "/profile/me",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      const update = { updatedAt: new Date() };

      if (body.displayName !== undefined) {
        update.displayName =
          body.displayName === null ? null : String(body.displayName).trim().slice(0, 40) || null;
      }
      if (body.handle !== undefined) {
        const handle = body.handle === null ? "" : String(body.handle).trim().toLowerCase();
        if (handle) {
          const problem = handleProblem(handle);
          if (problem) {
            throw new HttpError(400, problem);
          }
        }
        update.handle = handle || null;
      }
      if (body.visibility !== undefined) {
        update.visibility = body.visibility === "public" ? "public" : "private";
      }
      if (body.weekMinutes !== undefined) {
        // The client sums minutes over its own *local* ISO week, so it names
        // that week; the server only checks it is one a real clock could be in.
        if (!isWeekKey(body.weekKey) || !plausibleWeekKeys().has(body.weekKey)) {
          throw new HttpError(400, "weekKey must be the current ISO week, like 2026-W39.");
        }
        update.weekMinutes = bounded(body.weekMinutes, MAX_WEEK_MINUTES, "weekMinutes", false);
        update.weekKey = body.weekKey;
      }
      if (body.streak !== undefined) {
        update.streak = bounded(body.streak, MAX_STREAK, "streak", true);
      }
      if (body.booksFinished !== undefined) {
        update.booksFinished = bounded(body.booksFinished, MAX_BOOKS_FINISHED, "booksFinished", true);
      }
      if (body.shelf !== undefined) {
        update.shelf = sanitiseShelf(body.shelf);
      }
      // The avatar belongs to the account (it is picked at signup, before any
      // profile exists); the profile keeps a copy for the board to show.
      const account = await accounts(db).findOne({ _id: request.account.id }, { projection: { avatar: 1 } });
      update.avatar = avatarView(account?.avatar);

      // `visibility` may only be in one of $set / $setOnInsert: naming it in
      // both is a Mongo conflict error, which is what broke every profile save.
      const operation = { $set: update };
      if (update.visibility === undefined) {
        operation.$setOnInsert = { visibility: "private" };
      }
      try {
        await profiles(db).updateOne({ _id: request.account.id }, operation, { upsert: true });
        forgetBoards();
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "That handle is taken.");
        }
        throw error;
      }
      // A duel keeps each side's latest minutes, so its result survives the
      // week turning over on the profile.
      if (update.weekKey !== undefined) {
        await recordDuelMinutes(db, request.account.id, update.weekKey, update.weekMinutes);
      }
      response.json(ownView(await profiles(db).findOne({ _id: request.account.id })));
    })
  );

  router.delete(
    "/profile/me",
    auth,
    asyncHandler(async (request, response) => {
      // Leaving the community takes its traces too: follows both ways, kudos,
      // duels and inbox events.
      await deleteCommunityData(db, request.account.id);
      await profiles(db).deleteOne({ _id: request.account.id });
      forgetBoards();
      response.json({ deleted: true });
    })
  );

  return router;
}
