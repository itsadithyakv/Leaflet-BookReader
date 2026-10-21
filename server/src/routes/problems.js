import { Router } from "express";
import { optionalAccount, requireAccount } from "../auth.js";
import { problems, profiles } from "../db.js";
import { HttpError, asyncHandler, plainLines, problemJson, smallJson } from "../http.js";
import { defaultLimits } from "../rateLimit.js";
import { limiter, objectId } from "../readers.js";
import { requireAdmin } from "../standing.js";
import { giveBack, spend } from "../tallies.js";
import { emailProblem, normaliseEmail } from "./account.js";

/**
 * Problem reports: a reader says something went wrong, from Settings, and
 * the owner reads it in the app's own admin section. Not a report about
 * another reader (that is `routes/moderation.js`): one about Leaflet.
 *
 * Anyone may send one, signed in or not, since the testers most likely to
 * find a problem may have no account. So it is held to a few a day from one
 * address and from one account, and to so many waiting at once: past that
 * the server says it is full rather than fill a free cluster with them. A
 * report keeps the words, the app's diagnostics if the reader chose to send
 * them, the version and the platform; and, signed in, who sent it (the
 * account and its handle), or, signed out, an address for a reply if one was
 * given. It goes by itself after 90 days, and with the account.
 *
 * What a report says is never written to the log: it may hold file paths
 * and whatever the reader typed.
 */

/** The longest message, in characters, and the longest note the owner keeps on one. */
export const MESSAGE_MAX = 2000;
export const NOTE_MAX = 500;
/** The most diagnostics a report carries, in bytes (UTF-8). */
export const DIAGNOSTICS_MAX = 64 * 1024;
/** Reports from one account a UTC day (`tallies`). The per-address limit is `problems`. */
export const PROBLEMS_PER_DAY = 5;
/** How many may wait for the owner at once before new ones are turned away. */
export const OPEN_MAX = 1000;
/** How many the admin's list shows at a time. */
const PAGE = 50;
/** How much of a message the list shows. */
const PREVIEW = 200;

export const PLATFORMS = ["windows", "android", "macos", "linux"];
const STATUSES = ["open", "closed"];
const VERSION = /^\d{1,4}(\.\d{1,4}){1,3}$/;
// Control characters but for the line break and the tab, which a log keeps.
const CONTROL = /[^\P{Cc}\n\t]/gu;

export const FULL =
  "Leaflet can't take more problem reports just now. Try again later, or email them.";

/**
 * The diagnostics as kept: plain text, its lines and columns as they were
 * (it is read in monospace), without the control characters a terminal or a
 * viewer could act on. Null for nothing.
 */
export function cleanDiagnostics(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "diagnostics should be text.");
  }
  if (Buffer.byteLength(value, "utf8") > DIAGNOSTICS_MAX) {
    throw new HttpError(400, `diagnostics can be up to ${DIAGNOSTICS_MAX / 1024} KB.`);
  }
  const text = value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
  return text || null;
}

/** The reader's words: up to `max` characters, refused (not cut) when longer. */
function words(value, max, name, { required }) {
  if (value === undefined || value === null) {
    if (required) {
      throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
    }
    return null;
  }
  if (typeof value !== "string" || [...value].length > max) {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  const text = plainLines(value, max);
  if (!text && required) {
    throw new HttpError(400, `${name} should be text, up to ${max} characters.`);
  }
  return text || null;
}

/** An address for a reply, from a reader who is signed out: optional, and a real-looking one. */
function contactOf(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const email = normaliseEmail(value);
  if (emailProblem(email)) {
    throw new HttpError(400, "That email address doesn't look right.");
  }
  return email;
}

const iso = (date) => (date instanceof Date ? date.toISOString() : null);

/** A report as the admin's list shows it: no diagnostics, the start of the message. */
const rowView = (doc) => ({
  id: doc._id.toHexString(),
  at: iso(doc.at),
  preview: doc.preview,
  cut: doc.long,
  hasDiagnostics: doc.hasDiagnostics,
  version: doc.version,
  platform: doc.platform,
  signedIn: Boolean(doc.accountId),
  handle: doc.handle ?? null,
  contact: doc.contact ?? null,
  status: doc.status,
  note: doc.note ?? null
});

/** The whole of one report. */
const fullView = (doc) => ({
  id: doc._id.toHexString(),
  at: iso(doc.at),
  message: doc.message,
  diagnostics: doc.diagnostics ?? null,
  version: doc.version,
  platform: doc.platform,
  signedIn: Boolean(doc.accountId),
  handle: doc.handle ?? null,
  contact: doc.contact ?? null,
  status: doc.status,
  note: doc.note ?? null,
  closedAt: iso(doc.closedAt)
});

export function problemRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const maybe = optionalAccount(db);
  const admin = requireAdmin(db);
  // Every attempt from one address counts, before its body is read, so a
  // stranger cannot have the server parse 64 KB after 64 KB.
  const fromAddress = limiter(limits.problems ?? defaultLimits().problems);
  const limitAddress = (request, _response, next) => {
    fromAddress(`ip:${request.ip ?? "unknown"}`);
    next();
  };

  /**
   * Sends a problem report. `{message, diagnostics?, version, platform,
   * contact?}`; `contact` only counts from a reader who is signed out.
   */
  router.post(
    "/problems",
    maybe,
    limitAddress,
    problemJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      const message = words(body.message, MESSAGE_MAX, "message", { required: true });
      const diagnostics = cleanDiagnostics(body.diagnostics);
      if (typeof body.version !== "string" || !VERSION.test(body.version)) {
        throw new HttpError(400, "version is numbers with dots, like 1.5.7.");
      }
      if (!PLATFORMS.includes(body.platform)) {
        throw new HttpError(400, `platform is one of ${PLATFORMS.join(", ")}.`);
      }
      const accountId = request.account?.id ?? null;
      // Signed in, the account is who to answer; an address typed as well is not kept.
      const contact = accountId ? null : contactOf(body.contact);
      const waiting = await problems(db).countDocuments({ status: "open" }, { limit: OPEN_MAX });
      if (waiting >= OPEN_MAX) {
        throw new HttpError(503, FULL);
      }
      const now = new Date();
      const { version, platform } = body;
      const doc = { at: now, message, diagnostics, version, platform, status: "open" };
      if (accountId) {
        const enough = `You can send ${PROBLEMS_PER_DAY} problem reports a day.`;
        await spend(db, accountId, "problem", PROBLEMS_PER_DAY, enough, now);
        const profile = await profiles(db).findOne(
          { _id: accountId },
          { projection: { handle: 1 } }
        );
        doc.accountId = accountId;
        doc.handle = profile?.handle ?? null;
      } else if (contact) {
        doc.contact = contact;
      }
      try {
        const { insertedId } = await problems(db).insertOne(doc);
        response.status(201).json({ id: insertedId.toHexString() });
      } catch (error) {
        if (accountId) {
          await giveBack(db, accountId, "problem", now);
        }
        throw error;
      }
    })
  );

  // ---- admin ------------------------------------------------------------------
  //
  // Answered as a route that does not exist to anyone but an admin (`requireAdmin`).

  const reportOf = async (raw) => {
    const id = objectId(raw);
    const doc = id ? await problems(db).findOne({ _id: id }) : null;
    if (!doc) {
      throw new HttpError(404, "That report is no longer there.");
    }
    return doc;
  };

  /**
   * The reports with one status (open unless asked), newest first, fifty at
   * a time; `before` is the id of the last one shown, for the next fifty.
   */
  router.get(
    "/admin/problems",
    auth,
    admin,
    asyncHandler(async (request, response) => {
      const status = STATUSES.includes(request.query.status) ? request.query.status : "open";
      const filter = { status };
      if (request.query.before !== undefined) {
        const before = objectId(request.query.before);
        if (!before) {
          throw new HttpError(400, "before is the id of a report.");
        }
        filter._id = { $lt: before };
      }
      const rows = await problems(db)
        .aggregate([
          { $match: filter },
          { $sort: { _id: -1 } },
          { $limit: PAGE + 1 },
          {
            $project: {
              at: 1,
              version: 1,
              platform: 1,
              accountId: 1,
              handle: 1,
              contact: 1,
              status: 1,
              note: 1,
              preview: { $substrCP: ["$message", 0, PREVIEW] },
              long: { $gt: [{ $strLenCP: "$message" }, PREVIEW] },
              hasDiagnostics: { $gt: [{ $strLenBytes: { $ifNull: ["$diagnostics", ""] } }, 0] }
            }
          }
        ])
        .toArray();
      response.json({ problems: rows.slice(0, PAGE).map(rowView), more: rows.length > PAGE });
    })
  );

  /** One report, all of it. */
  router.get(
    "/admin/problems/:id",
    auth,
    admin,
    asyncHandler(async (request, response) => {
      response.json(fullView(await reportOf(request.params.id)));
    })
  );

  /**
   * Closes or reopens a report, with a note (up to 500 characters) when one
   * is sent; `note: null` takes it away, and leaving it out keeps it.
   */
  router.post(
    "/admin/problems/:id",
    auth,
    admin,
    smallJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      if (!STATUSES.includes(body.status)) {
        throw new HttpError(400, `status is one of ${STATUSES.join(", ")}.`);
      }
      const doc = await reportOf(request.params.id);
      const closing = body.status === "closed";
      const update = { status: body.status, closedAt: closing ? doc.closedAt ?? new Date() : null };
      if (body.note !== undefined) {
        update.note = words(body.note, NOTE_MAX, "note", { required: false });
      }
      const saved = await problems(db).findOneAndUpdate(
        { _id: doc._id },
        { $set: update },
        { returnDocument: "after" }
      );
      if (!saved) {
        throw new HttpError(404, "That report is no longer there.");
      }
      response.json(fullView(saved));
    })
  );

  router.delete(
    "/admin/problems/:id",
    auth,
    admin,
    asyncHandler(async (request, response) => {
      const id = objectId(request.params.id);
      const { deletedCount } = id ? await problems(db).deleteOne({ _id: id }) : {};
      if (!deletedCount) {
        throw new HttpError(404, "That report is no longer there.");
      }
      response.json({ deleted: true });
    })
  );

  return router;
}
