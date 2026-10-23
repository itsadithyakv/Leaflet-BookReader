import { meta } from "../db.js";

/**
 * When the last backup went through, for the owner's overview: the backup is
 * a process of its own (`run.js`, nightly by leaflet-backup.timer), so the
 * API cannot know of it otherwise. A backup that never ran said nothing
 * anywhere, and was found by chance.
 *
 * One small document (`meta`, `_id: "lastBackup"`) written after each run
 * that went through: one write a night. Never the backup's name or where it
 * went beyond "drive" or "folder", which say nothing to anyone reading the
 * database.
 */

const ID = "lastBackup";

/** Records a backup that went through (`result` is `runBackup`'s). */
export async function noteBackup(db, result, { where = "drive", now = new Date() } = {}) {
  await meta(db).updateOne(
    { _id: ID },
    {
      $set: {
        at: now,
        sizeMB: Math.round(((result?.size ?? 0) / 1024 / 1024) * 100) / 100,
        parts: result?.parts ?? 0,
        collections: Object.keys(result?.counts ?? {}).length,
        documents: result?.documents ?? 0,
        where
      }
    },
    { upsert: true }
  );
}

/** The last backup that went through as the overview shows it, or null when none has been noted. */
export async function lastBackup(db) {
  const doc = await meta(db).findOne({ _id: ID });
  if (!(doc?.at instanceof Date)) {
    return null;
  }
  return { at: doc.at.toISOString(), sizeMB: doc.sizeMB ?? 0, parts: doc.parts ?? 0, collections: doc.collections ?? 0, documents: doc.documents ?? 0, where: doc.where ?? "drive" };
}
