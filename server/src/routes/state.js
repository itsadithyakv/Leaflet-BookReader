import { Router } from "express";
import { Binary } from "mongodb";
import { requireAccount } from "../auth.js";
import { accounts, states } from "../db.js";
import { HttpError, asyncHandler, stateJson } from "../http.js";
import { defaultLimits } from "../rateLimit.js";
import { limiter } from "../readers.js";

/**
 * The sync document, stored and returned verbatim.
 *
 * The server does not read inside it and does not merge. Merging lives in the
 * app (`sync/merge.rs`). What the server owns is the version counter, so two
 * devices writing at once cannot silently overwrite each other.
 */

/** A generous ceiling: ~15 KB is typical, and 2 MB is a decade of heavy use. */
const MAX_STATE_BYTES = 2 * 1024 * 1024;

const encode = (doc) => (doc?.state ? Buffer.from(doc.state.buffer).toString("base64") : null);

/**
 * The version named by `?have=`, or null when there is none to go by: a
 * whole number above 0, written plainly (no sign, no leading 0, no point).
 * 0 is "I have none", which the full answer already says, and anything else
 * is taken as not sent.
 */
function heldVersion(have) {
  if (typeof have !== "string" || !/^[1-9][0-9]{0,15}$/.test(have)) {
    return null;
  }
  const version = Number(have);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

export function stateRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  // The document is the largest thing this server is sent or sends (megabytes
  // at its most), so how often one account may fetch it, and how often
  // write it, is bounded: far above what an app syncing after every
  // highlight does, and counted before a body is read.
  const syncs = limiter(limits.state ?? defaultLimits().state);
  const limitRead = (request, _response, next) => {
    syncs(`read:${request.account.id}`);
    next();
  };
  const limitWrite = (request, _response, next) => {
    syncs(`write:${request.account.id}`);
    next();
  };

  // What the client holds now, and the version it must quote to write.
  //
  // `?have=N` says the app already holds version N, kept from an earlier
  // fetch: when that is still the version stored, the answer is
  // `{version, unchanged: true}` and no `state`: the database still loads
  // the document to answer, but sends back only its version, so neither
  // Atlas's transfer nor this server carries the document. An app checks for a
  // newer document every time it opens and after every sync, and nearly
  // always there is none, so this was up to 2 MB from the database and to
  // the app for nothing. An app that sends no `have` (every one before
  // this), or one that is not a version (0, junk, a list), gets the answer
  // it always had; so does one whose version is no longer the stored one.
  router.get(
    "/state",
    auth,
    limitRead,
    asyncHandler(async (request, response) => {
      const have = heldVersion(request.query.have);
      // One read either way: the state comes back only when its version is
      // not the one the app has.
      const projection =
        have === null ? { version: 1, state: 1 } : { version: 1, state: { $cond: [{ $eq: ["$version", have] }, "$$REMOVE", "$state"] } };
      const doc = await states(db).findOne({ _id: request.account.id }, { projection });
      if (have !== null && doc?.version === have) {
        response.json({ version: have, unchanged: true });
        return;
      }
      response.json({ version: doc?.version ?? 0, state: encode(doc) });
    })
  );

  // `auth` runs before `stateJson`, so a stranger never gets a 3 MB body parsed.
  router.put(
    "/state",
    auth,
    limitWrite,
    stateJson,
    asyncHandler(async (request, response) => {
      const { version, state } = request.body ?? {};
      if (typeof state !== "string" || state.length === 0) {
        throw new HttpError(400, "Missing state.");
      }
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new HttpError(400, "Missing or invalid version.");
      }
      const bytes = Buffer.from(state, "base64");
      if (bytes.length === 0) {
        throw new HttpError(400, "Empty state.");
      }
      if (bytes.length > MAX_STATE_BYTES) {
        throw new HttpError(413, "That library is too large to sync.");
      }

      const id = request.account.id;
      const now = new Date();
      let written = false;
      if (version === 0) {
        // "I have never seen a document." An insert, so an existing document
        // is a conflict (E11000 on _id) rather than an upsert that blows up.
        // Not for an account that is gone: a request let in just before its
        // deletion ended the sessions must not leave a copy behind (sync
        // audit D5). Once per account, so the read is no cost.
        if (!(await accounts(db).findOne({ _id: id }, { projection: { _id: 1 } }))) {
          throw new HttpError(401, "Your session has ended. Sign in again.");
        }
        try {
          await states(db).insertOne({ _id: id, state: new Binary(bytes), version: 1, updatedAt: now });
          written = true;
        } catch (error) {
          if (error?.code !== 11000) {
            throw error;
          }
        }
      } else {
        const result = await states(db).updateOne(
          { _id: id, version },
          { $set: { state: new Binary(bytes), version: version + 1, updatedAt: now } }
        );
        written = result.matchedCount === 1;
      }

      if (!written) {
        const current = await states(db).findOne({ _id: id });
        response.status(409).json({
          error: "Another device wrote first.",
          version: current?.version ?? 0,
          state: encode(current)
        });
        return;
      }
      response.json({ version: version + 1 });
    })
  );

  router.delete(
    "/state",
    auth,
    limitWrite,
    asyncHandler(async (request, response) => {
      await states(db).deleteOne({ _id: request.account.id });
      response.json({ deleted: true });
    })
  );

  return router;
}
