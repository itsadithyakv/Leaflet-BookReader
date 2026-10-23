import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { clientOptions } from "../db.js";
import { runBackup } from "./backup.js";
import { BackupError, loadPublicKey } from "./format.js";
import { noteBackup } from "./note.js";
import { appsScriptTarget, folderTarget, shortUrl } from "./targets.js";

/**
 * The nightly backup: `node src/backup/run.js`, run by leaflet-backup.service
 * (deploy/), which reads /etc/leaflet-api.env (MONGO_URI, MONGO_DB) and
 * /etc/leaflet-backup.env (BACKUP_URL, BACKUP_SECRET, BACKUP_PUBLIC_KEY).
 * See docs/backups.md.
 *
 *   node src/backup/run.js             the database to the Apps Script receiver
 *   node src/backup/run.js --out DIR   to DIR/<name>/ instead (nothing is sent)
 *
 * Optional: BACKUP_PART_MB (1 to 8, default 8), the size of a part.
 *
 * Prints one line, and exits 1 with the reason when it fails. Never prints
 * the secret, and the URL only shortened.
 */

if (existsSync(".env") && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env");
}

const say = (line) => console.log(`[leaflet-backup] ${line}`);

function fail(message) {
  let text = String(message);
  const { BACKUP_SECRET: secret, BACKUP_URL: url, MONGO_URI: uri } = process.env;
  for (const [value, shown] of [
    [secret, "<BACKUP_SECRET>"],
    [url, url ? shortUrl(url) : ""],
    [uri, "<MONGO_URI>"]
  ]) {
    if (value && value.length >= 8) {
      text = text.split(value).join(shown);
    }
  }
  console.error(`[leaflet-backup] failed: ${text.split("\n")[0]}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const env = process.env;
  const uri = env.MONGO_URI || env.MONGODB_URI;
  const dbName = env.MONGO_DB || env.MONGODB_DB || "leaflet";
  if (!uri) {
    throw new BackupError("MONGO_URI is not set");
  }
  if (!env.BACKUP_PUBLIC_KEY) {
    throw new BackupError("BACKUP_PUBLIC_KEY is not set (the path of the public key, /etc/leaflet-backup.pub on the VM)");
  }
  const publicKey = loadPublicKey(env.BACKUP_PUBLIC_KEY);
  const partMb = env.BACKUP_PART_MB ? Number(env.BACKUP_PART_MB) : 8;
  if (!(partMb >= 1 && partMb <= 8)) {
    throw new BackupError("BACKUP_PART_MB must be a number from 1 to 8");
  }

  let target;
  if (values.out) {
    target = folderTarget(values.out);
  } else {
    const url = env.BACKUP_URL?.trim();
    const secret = env.BACKUP_SECRET?.trim();
    if (!url || !secret) {
      throw new BackupError("BACKUP_URL and BACKUP_SECRET must both be set (or pass --out DIR)");
    }
    if (!/^https:\/\/script\.google\.com\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      throw new BackupError("BACKUP_URL should be the Apps Script web app's https://script.google.com/macros/s/.../exec URL");
    }
    if (/same-long-random-string|BACKUP_SECRET|DEPLOYMENT_ID/.test(secret + url)) {
      throw new BackupError("/etc/leaflet-backup.env still has the example values");
    }
    target = appsScriptTarget({ url, secret });
  }

  const started = Date.now();
  // One connection is all it uses; reading from a secondary where there is
  // one leaves the primary to the API.
  const client = new MongoClient(uri, {
    ...clientOptions(env),
    appName: "leaflet-backup",
    maxPoolSize: 2,
    waitQueueTimeoutMS: 60_000,
    serverSelectionTimeoutMS: 30_000,
    readPreference: "secondaryPreferred"
  });
  try {
    await client.connect();
    const result = await runBackup({
      db: client.db(dbName),
      dbName,
      publicKey,
      target,
      partSize: Math.round(partMb * 1024 * 1024)
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    const where = values.out ? `written to ${target.folder}` : "sent to Drive";
    say(
      `${result.name}: ${Object.keys(result.counts).length} collections, ${result.documents} documents, ` +
        `${result.parts} part${result.parts === 1 ? "" : "s"}, ${(result.size / 1024 / 1024).toFixed(2)} MB, ${where} in ${seconds} s`
    );
    // For the owner's overview: when the last backup went through. One write
    // a night; a backup that went through is not failed for want of it.
    await noteBackup(client.db(dbName), result, { where: values.out ? "folder" : "drive" }).catch((error) =>
      say(`could not note the backup for the overview: ${error?.message ?? error}`)
    );
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => fail(error instanceof BackupError ? error.message : error?.message ?? error));
