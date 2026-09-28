import { Router } from "express";
import { Binary } from "mongodb";
import { requireAccount } from "../auth.js";
import { states } from "../db.js";
import { HttpError, asyncHandler, stateJson } from "../http.js";

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

export function stateRoutes(db) {
  const router = Router();
  const auth = requireAccount(db);

  // What the client holds now, and the version it must quote to write.
  router.get(
    "/state",
    auth,
    asyncHandler(async (request, response) => {
      const doc = await states(db).findOne({ _id: request.account.id });
      response.json({ version: doc?.version ?? 0, state: encode(doc) });
    })
  );

  // `auth` runs before `stateJson`, so a stranger never gets a 3 MB body parsed.
  router.put(
    "/state",
    auth,
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
    asyncHandler(async (request, response) => {
      await states(db).deleteOne({ _id: request.account.id });
      response.json({ deleted: true });
    })
  );

  return router;
}
