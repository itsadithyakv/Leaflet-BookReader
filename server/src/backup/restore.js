import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import { BSON, MongoClient, ObjectId } from "mongodb";
import { deleteAccount } from "../deletion.js";
import { BackupError, decryptor, loadPrivateKey } from "./format.js";

const { EJSON } = BSON;

/**
 * Restoring a backup. Mostly run on the owner's PC, against the local MongoDB:
 *
 *   node src/backup/restore.js --in <folder of part-NNN | one file> --key <private.pem> --list
 *   node src/backup/restore.js --in ... --key ... [--uri mongodb://127.0.0.1:27017] [--db leaflet_restore]
 *        [--replace] [--yes-production] [--deletions-from <live uri>] [--deletions-db leaflet]
 *
 * It reads the backup twice. First to check it, writing nothing: the
 * sha256 of every part and of the whole (against manifest.json, when it is
 * there), the encryption tag (which proves nothing was changed, and that no
 * part is missing), and that every collection has as many documents as the
 * backup says. `--list` stops there. Then again to insert, in batches.
 *
 * It refuses a target that already has collections unless `--replace` (which
 * drops them first), and the database called `leaflet` (production's name)
 * unless `--yes-production` too.
 *
 * `--deletions-from` names the live database (still reachable, in a
 * disaster that is not its loss): every account deleted there since the
 * backup was taken (its `deletions`, kept 45 days) is deleted again from the
 * restored copy, the same way the server deletes one (`deleteAccount`).
 */

const BATCH_DOCS = 1000;
const BATCH_BYTES = 8 * 1024 * 1024;
const PART = /^part-(\d{3})$/;

/**
 * The files of a backup, in order, and its manifest when there is one.
 * `input` is one file (the parts put together), or a folder of part-NNN
 * files as downloaded from Drive (or the folder above it, holding just that
 * one).
 */
export function backupFiles(input) {
  let stat;
  try {
    stat = statSync(input);
  } catch {
    throw new BackupError(`${input} does not exist`);
  }
  if (stat.isFile()) {
    return { files: [resolve(input)], manifest: null, folder: null };
  }
  let folder = resolve(input);
  let entries = readdirSync(folder, { withFileTypes: true });
  if (!entries.some((entry) => PART.test(entry.name))) {
    const inner = entries.filter((entry) => entry.isDirectory());
    if (inner.length === 1) {
      folder = join(folder, inner[0].name);
      entries = readdirSync(folder, { withFileTypes: true });
    }
  }
  const numbers = entries
    .filter((entry) => entry.isFile() && PART.test(entry.name))
    .map((entry) => Number(PART.exec(entry.name)[1]))
    .sort((a, b) => a - b);
  if (numbers.length === 0) {
    throw new BackupError(`no part-000, part-001, ... in ${folder}`);
  }
  let manifest = null;
  if (entries.some((entry) => entry.name === "manifest.json")) {
    try {
      manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
    } catch {
      throw new BackupError("manifest.json is not valid JSON");
    }
  }
  const expected = manifest ? manifest.parts : numbers[numbers.length - 1] + 1;
  for (let n = 0; n < expected; n += 1) {
    if (!numbers.includes(n)) {
      throw new BackupError(`part-${String(n).padStart(3, "0")} is missing from ${folder}`);
    }
  }
  if (numbers.length > expected) {
    throw new BackupError(`${folder} has more parts than its manifest says (${expected})`);
  }
  const files = numbers.map((n) => join(folder, `part-${String(n).padStart(3, "0")}`));
  return { files, manifest, folder };
}

/**
 * Checks every sha256 the manifest has, a part at a time (8 MB). Without a
 * manifest only the encryption tag can tell.
 */
async function checkHashes({ files, manifest }) {
  if (!manifest) {
    return false;
  }
  const whole = createHash("sha256");
  let size = 0;
  for (const [n, file] of files.entries()) {
    const data = readFileSync(file);
    size += data.length;
    whole.update(data);
    if (manifest.partSizes?.[n] !== undefined && manifest.partSizes[n] !== data.length) {
      throw new BackupError(`part-${String(n).padStart(3, "0")} is ${data.length} bytes; the manifest says ${manifest.partSizes[n]} (download it again)`);
    }
    if (manifest.partSha256?.[n] && createHash("sha256").update(data).digest("hex") !== manifest.partSha256[n]) {
      throw new BackupError(`part-${String(n).padStart(3, "0")} does not match its sha256 in the manifest: it was changed or damaged`);
    }
  }
  if (size !== manifest.size) {
    throw new BackupError(`the parts add up to ${size} bytes; the manifest says ${manifest.size}`);
  }
  if (whole.digest("hex") !== manifest.sha256) {
    throw new BackupError("the backup does not match its sha256 in the manifest: it was changed or damaged");
  }
  return true;
}

/** The backup's files, one after the other, as one stream. */
const joined = (files) =>
  Readable.from(
    (async function* () {
      for (const file of files) {
        yield* createReadStream(file);
      }
    })()
  );

/**
 * Decrypts and reads the backup line by line: `onHeader(header)`, then
 * `onDocument(collection, doc)` for each, then `onEnd(trailer)`. Fails with
 * a BackupError when anything is wrong with it.
 */
async function readBackup(files, privateKey, { onHeader, onDocument }) {
  let header = null;
  let trailer = null;
  let rest = "";
  const handle = async (line) => {
    if (!line) {
      return;
    }
    if (trailer) {
      throw new BackupError("the backup goes on after its last line");
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new BackupError("the backup has a line that is not JSON: it is damaged");
    }
    if (!header) {
      if (value?.leafletBackup !== 1) {
        throw new BackupError("this is not a Leaflet backup, or a newer kind than this tool reads");
      }
      header = value;
      await onHeader?.(header);
    } else if (value.leafletBackupEnd === 1) {
      trailer = value;
    } else {
      await onDocument?.(value.c, EJSON.deserialize(value.d, { relaxed: false }));
    }
  };
  try {
    await pipeline(joined(files), decryptor(privateKey), createGunzip(), async (source) => {
      for await (const chunk of source) {
        const lines = (rest + chunk.toString("utf8")).split("\n");
        rest = lines.pop();
        for (const line of lines) {
          await handle(line);
        }
      }
      await handle(rest);
    });
  } catch (error) {
    if (error instanceof BackupError) {
      throw error;
    }
    if (error?.code?.startsWith?.("Z_") || /incorrect header|unexpected end|invalid/.test(error?.message ?? "")) {
      throw new BackupError("the backup does not unpack (gzip): it is damaged");
    }
    throw error;
  }
  if (!header || !trailer) {
    throw new BackupError("the backup ends before its last line: it is incomplete");
  }
  return { header, trailer };
}

/** Reads the whole backup, writing nothing: its header, its last line and what is in it. */
export async function checkBackup({ input, keyPath }) {
  const found = backupFiles(input);
  const hashed = await checkHashes(found);
  const privateKey = loadPrivateKey(keyPath);
  const counts = {};
  const { header, trailer } = await readBackup(found.files, privateKey, {
    onDocument: (name) => {
      counts[name] = (counts[name] ?? 0) + 1;
    }
  });
  for (const [name, count] of Object.entries(trailer.collections)) {
    if ((counts[name] ?? 0) !== count) {
      throw new BackupError(`${name} has ${counts[name] ?? 0} documents in the backup; its last line says ${count}: it is damaged`);
    }
  }
  return { ...found, hashed, header, trailer, privateKey };
}

function table(rows, heads) {
  const widths = heads.map((head, i) => Math.max(head.length, ...rows.map((row) => String(row[i]).length)));
  const line = (row) => "  " + row.map((cell, i) => (i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]))).join("   ");
  return [line(heads), ...rows.map(line)].join("\n");
}

/**
 * The whole restore. Resolves to `{ header, trailer, restored, redeleted }`;
 * `log` gets the lines to print.
 */
export async function restore({
  input,
  keyPath,
  uri = "mongodb://127.0.0.1:27017",
  dbName = "leaflet_restore",
  replace = false,
  yesProduction = false,
  list = false,
  deletionsFrom = null,
  deletionsDb = "leaflet",
  log = () => {}
}) {
  if (!input || !keyPath) {
    throw new BackupError("--in and --key are both needed");
  }
  if (!list) {
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(dbName)) {
      throw new BackupError(`"${dbName}" is not a database name this tool will write to`);
    }
    if (dbName === "leaflet" && !yesProduction) {
      throw new BackupError('--db leaflet is the production database: add --yes-production as well (and stop the API first)');
    }
  }

  const checked = await checkBackup({ input, keyPath });
  const { header, trailer } = checked;
  log(`${checked.folder ?? checked.files[0]}`);
  log(`backup of "${header.db}", taken ${header.at}, ${checked.files.length} part${checked.files.length === 1 ? "" : "s"}`);
  log(
    table(
      Object.keys(trailer.collections).map((name) => [name, header.collections[name] ?? "-", trailer.collections[name]]),
      ["collection", "at start", "in backup"]
    )
  );
  log(`checked: ${checked.hashed ? "sha256 of every part and of the whole, " : "(no manifest.json: no sha256 to check) "}encryption tag, document counts`);
  if (list) {
    return { header, trailer, restored: null, redeleted: null };
  }

  const client = new MongoClient(uri, { appName: "leaflet-restore", serverSelectionTimeoutMS: 15_000 });
  const live = deletionsFrom ? new MongoClient(deletionsFrom, { appName: "leaflet-restore", serverSelectionTimeoutMS: 15_000 }) : null;
  try {
    await client.connect();
    const db = client.db(dbName);

    // Read before anything is dropped: the live database may be the target.
    let deleted = [];
    if (live) {
      await live.connect();
      deleted = await live.db(deletionsDb).collection("deletions").find({}, { projection: { _id: 1, at: 1 } }).toArray();
    }

    const existing = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((info) => info.name)
      .filter((name) => !name.startsWith("system."));
    if (existing.length > 0) {
      if (!replace) {
        throw new BackupError(
          `database "${dbName}" already has ${existing.length} collection${existing.length === 1 ? "" : "s"} (${existing.slice(0, 4).join(", ")}${existing.length > 4 ? ", ..." : ""}): ` +
            "pick another --db, or add --replace to drop them first"
        );
      }
      for (const name of existing) {
        await db.collection(name).drop();
      }
      log(`dropped ${existing.length} collections from "${dbName}"`);
    }

    for (const [name, count] of Object.entries(trailer.collections)) {
      if (count === 0) {
        await db.createCollection(name);
      }
    }
    let batch = [];
    let batchName = null;
    let batchBytes = 0;
    const flush = async () => {
      if (batch.length > 0) {
        await db.collection(batchName).insertMany(batch, { ordered: true, bypassDocumentValidation: true });
      }
      batch = [];
      batchBytes = 0;
    };
    await readBackup(checked.files, checked.privateKey, {
      onDocument: async (name, doc) => {
        if (name !== batchName) {
          await flush();
          batchName = name;
        }
        batch.push(doc);
        batchBytes += BSON.calculateObjectSize(doc);
        if (batch.length >= BATCH_DOCS || batchBytes >= BATCH_BYTES) {
          await flush();
        }
      }
    });
    await flush();

    const restored = {};
    for (const name of Object.keys(trailer.collections)) {
      restored[name] = await db.collection(name).countDocuments({});
    }
    log(`restored into "${dbName}":`);
    log(table(Object.keys(trailer.collections).map((name) => [name, trailer.collections[name], restored[name]]), ["collection", "in backup", "restored"]));
    const short = Object.keys(trailer.collections).filter((name) => restored[name] !== trailer.collections[name]);
    if (short.length > 0) {
      throw new BackupError(`restored counts differ from the backup's in ${short.join(", ")}`);
    }

    let redeleted = null;
    if (live) {
      redeleted = 0;
      for (const { _id, at } of deleted) {
        const id = _id instanceof ObjectId ? _id : null;
        if (!id) {
          continue;
        }
        const had = await db.collection("accounts").countDocuments({ _id: id }, { limit: 1 });
        await deleteAccount(db, id, at instanceof Date ? at : new Date());
        redeleted += had;
      }
      log(
        `deleted again ${redeleted} account${redeleted === 1 ? "" : "s"} deleted since the backup ` +
          `(${deleted.length} deletion${deleted.length === 1 ? "" : "s"} in the last 45 days in the live database)`
      );
    }
    log("indexes: the API makes them when it starts on this database");
    return { header, trailer, restored, redeleted };
  } finally {
    await client.close().catch(() => {});
    await live?.close().catch(() => {});
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      key: { type: "string" },
      uri: { type: "string" },
      db: { type: "string" },
      replace: { type: "boolean" },
      "yes-production": { type: "boolean" },
      list: { type: "boolean" },
      "deletions-from": { type: "string" },
      "deletions-db": { type: "string" }
    }
  });
  await restore({
    input: values.in,
    keyPath: values.key,
    uri: values.uri,
    dbName: values.db,
    replace: values.replace,
    yesProduction: values["yes-production"],
    list: values.list,
    deletionsFrom: values["deletions-from"],
    deletionsDb: values["deletions-db"],
    log: (line) => console.log(line)
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof BackupError ? error.message : error?.message ?? String(error);
    console.error(`restore refused: ${message.split("\n")[0]}`);
    process.exit(1);
  });
}
