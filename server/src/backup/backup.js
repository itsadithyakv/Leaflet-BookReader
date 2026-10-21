import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { BSON } from "mongodb";
import { BackupError, encryptor } from "./format.js";
import { MAX_PARTS, backupName } from "./rules.js";

const { EJSON } = BSON;

/**
 * One backup: the whole database, read with the driver (no mongodump), as
 * NDJSON, gzipped, encrypted (format.js) and cut into parts that go to a
 * target (targets.js) one at a time.
 *
 * What is inside, line by line, once decrypted and gunzipped:
 *
 *   {"leafletBackup":1,"db":"leaflet","at":"2026-10-17T03:30:12.345Z","collections":{"accounts":12,...}}
 *   {"c":"accounts","d":{...one document, canonical Extended JSON...}}
 *   ...
 *   {"leafletBackupEnd":1,"collections":{"accounts":12,...}}
 *
 * The header's counts are taken just before the reading starts, the last
 * line's as it ends; the API keeps running, so the two can differ by what
 * readers did meanwhile. Each collection is read once, in turn: this is not a
 * point-in-time snapshot of the whole database, which for this app (each
 * reader's data on its own documents) does not matter. Documents are
 * canonical Extended JSON, read without promoting numbers, so an ObjectId,
 * Date, Binary, Long, Decimal128, and an int or a double, all come back as
 * exactly what they were. Indexes are not kept: the server makes its own on
 * every start (`ensureIndexes` in db.js).
 *
 * Nothing holds the whole dump: the documents stream through gzip and the
 * cipher, and at most one part (plus a chunk) is in memory at a time.
 */

const LINE_BATCH = 256 * 1024;

/** The lines of the dump, in chunks of about 256 KB. */
async function* dumpLines(db, names, header, counts) {
  yield Buffer.from(JSON.stringify(header) + "\n");
  for (const name of names) {
    let chunk = "";
    let count = 0;
    const cursor = db.collection(name).find({}, { promoteValues: false, bsonRegExp: true, batchSize: 500 });
    for await (const doc of cursor) {
      chunk += `{"c":${JSON.stringify(name)},"d":${EJSON.stringify(doc, { relaxed: false })}}\n`;
      count += 1;
      if (chunk.length >= LINE_BATCH) {
        yield Buffer.from(chunk);
        chunk = "";
      }
    }
    if (chunk) {
      yield Buffer.from(chunk);
    }
    counts[name] = count;
  }
  yield Buffer.from(JSON.stringify({ leafletBackupEnd: 1, collections: counts }) + "\n");
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Backs up `db` to `target` and resolves to what was sent:
 * `{ name, parts, size, sha256, counts, documents }`.
 *
 * `target` is `{ ping?(), part({ name, part, data, sha256 }), done({ name, parts, size, sha256, counts }) }`.
 */
export async function runBackup({ db, dbName, publicKey, target, partSize = 8 * 1024 * 1024, now = new Date() }) {
  if (!(partSize >= 1024)) {
    throw new BackupError("the part size must be at least 1 KB");
  }
  const name = backupName(now);
  if (target.ping) {
    await target.ping();
  }

  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = listed
    .filter((info) => (info.type ?? "collection") === "collection" && !info.name.startsWith("system."))
    .map((info) => info.name)
    .sort();
  const before = {};
  for (const collection of names) {
    before[collection] = await db.collection(collection).countDocuments({});
  }
  const header = { leafletBackup: 1, db: dbName ?? db.databaseName, at: now.toISOString(), collections: before };
  const counts = {};

  const whole = createHash("sha256");
  let size = 0;
  let parts = 0;
  const send = async (data) => {
    if (parts >= MAX_PARTS) {
      throw new BackupError(`the backup needs more than ${MAX_PARTS} parts; raise BACKUP_PART_MB`);
    }
    await target.part({ name, part: parts, data, sha256: sha256(data) });
    parts += 1;
  };

  await pipeline(
    Readable.from(dumpLines(db, names, header, counts)),
    createGzip({ level: 9 }),
    encryptor(publicKey),
    async (source) => {
      let pending = [];
      let pendingBytes = 0;
      for await (const chunk of source) {
        whole.update(chunk);
        size += chunk.length;
        pending.push(chunk);
        pendingBytes += chunk.length;
        while (pendingBytes >= partSize) {
          const all = Buffer.concat(pending);
          const rest = Buffer.from(all.subarray(partSize));
          pending = rest.length ? [rest] : [];
          pendingBytes = rest.length;
          await send(all.subarray(0, partSize));
        }
      }
      if (pendingBytes > 0) {
        await send(Buffer.concat(pending));
      }
    }
  );

  const result = { name, parts, size, sha256: whole.digest("hex"), counts };
  await target.done(result);
  return { ...result, documents: Object.values(counts).reduce((sum, n) => sum + n, 0) };
}
