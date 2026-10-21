import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BackupError } from "./format.js";
import { partName } from "./rules.js";

/**
 * Where the parts of a backup go.
 *
 * `appsScriptTarget`: the Apps Script web app in the leafletmail account
 * (deploy/backup-receiver.gs), which writes them to that account's Drive.
 * The server holds only its URL and a secret that can add a backup, never
 * read, list or change one.
 *
 * `folderTarget`: a local folder, laid out the way the Drive folder is
 * (`part-000`, ..., `manifest.json`). For trying it out, and for `--out`.
 */

// An 8 MB part is an 11 MB request; Apps Script then decodes it and writes it
// to Drive, which can take a while on a slow day.
const POST_TIMEOUT_MS = 180_000;
const READ_TIMEOUT_MS = 60_000;
const READ_TRIES = 4;
const READ_PAUSE_MS = 1_000;
const TRIES = 5;
const BACKOFF_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The web app's URL with most of its deployment id left out, for messages:
 * https://script.google.com/macros/s/AKfy…3kQ/exec.
 */
export function shortUrl(url) {
  return String(url).replace(/\/s\/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{3})\//, "/s/$1…$2/");
}

const REFUSALS = {
  forbidden: "the receiver refused the secret: BACKUP_SECRET must equal the script's SECRET property",
  "bad name": "the receiver refused the backup's name (is the latest backup-receiver.gs deployed?)",
  "bad part": "the receiver refused a part (too large, or not base64)",
  "too many": "the receiver has had 6 backups in the last 24 hours and refuses more until tomorrow",
  "already complete": "a backup of this name is already complete in Drive (two runs in the same minute?)"
};

/**
 * The Apps Script web app, called the way `mail.js` calls the mailer: a POST
 * that Google answers with a redirect to the script's output, then a GET of
 * that output. Unlike an email, a part may be sent twice: the script replaces
 * a part it already has. So when anything goes wrong (a network error, a
 * timeout, an output that cannot be read) the part is sent again, up to 5
 * times, waiting longer each time. A refusal (the secret, the name) is final.
 */
export function appsScriptTarget({
  url,
  secret,
  tries = TRIES,
  backoffMs = BACKOFF_MS,
  readPauseMs = READ_PAUSE_MS,
  postTimeoutMs = POST_TIMEOUT_MS
}) {
  const call = async (body) => {
    const sent = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, ...body }),
      redirect: "manual",
      signal: AbortSignal.timeout(postTimeoutMs)
    });
    const output = sent.status >= 300 && sent.status < 400 ? sent.headers.get("location") : null;
    if (!output) {
      const reply = parse(await sent.text());
      if (!reply) {
        throw new Error(`HTTP ${sent.status} without a reply (check BACKUP_URL, and that the deployment's access is "Anyone")`);
      }
      return reply;
    }
    for (let attempt = 0; attempt < READ_TRIES; attempt += 1) {
      if (attempt > 0) {
        await sleep(readPauseMs * attempt);
      }
      try {
        const read = await fetch(new URL(output, url), { redirect: "follow", signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
        const reply = parse(await read.text());
        if (reply) {
          return reply;
        }
      } catch {
        // Read again, up to READ_TRIES.
      }
    }
    throw new Error("the script ran but its reply could not be read");
  };

  /** One message, sent until it is answered ok or refused. `what` is for the message on failure. */
  const send = async (body, what) => {
    let last = "no answer";
    for (let attempt = 0; attempt < tries; attempt += 1) {
      if (attempt > 0) {
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
      let reply;
      try {
        reply = await call(body);
      } catch (error) {
        last = error?.name === "TimeoutError" ? "timed out" : error?.cause?.code ?? error?.message ?? String(error);
        continue;
      }
      if (reply.ok) {
        return reply;
      }
      // A `done` whose first answer was lost: the backup was completed then.
      if (reply.error === "already complete" && body.action === "done" && attempt > 0) {
        return { ok: true };
      }
      // Busy with the copy sent before, or the part arrived damaged: again.
      if (reply.error === "busy" || reply.error === "damaged") {
        last = reply.error === "busy" ? "the receiver was busy" : "the part arrived damaged";
        continue;
      }
      throw new BackupError(`${what}: ${REFUSALS[reply.error] ?? `the receiver answered "${reply.error ?? "not ok"}"`}`);
    }
    throw new BackupError(`${what}: gave up after ${tries} tries (${last}) at ${shortUrl(url)}`);
  };

  return {
    ping: () => send({ action: "ping" }, "checking the receiver"),
    part: ({ name, part, data, sha256 }) =>
      send({ action: "part", name, part, data: data.toString("base64"), sha256 }, `sending ${partName(part)}`),
    done: ({ name, parts, size, sha256, counts }) =>
      send({ action: "done", name, parts, size, sha256, counts }, "completing the backup")
  };
}

/** The manifest the receiver writes, and the folder target writes the same. */
export function manifestOf({ name, parts, size, sha256, counts }, partSizes, partSha256, completedAt = new Date()) {
  return { leafletBackup: 1, name, parts, size, sha256, counts, partSizes, partSha256, completedAt: completedAt.toISOString() };
}

/** A local folder: `<dir>/<name>/part-000`, ..., `manifest.json`. */
export function folderTarget(dir) {
  let folder = null;
  const sizes = [];
  const hashes = [];
  return {
    get folder() {
      return folder;
    },
    part: async ({ name, part, data, sha256 }) => {
      if (!folder) {
        folder = join(dir, name);
        if (existsSync(folder)) {
          throw new BackupError(`${folder} already exists`);
        }
        await mkdir(folder, { recursive: true });
      }
      await writeFile(join(folder, partName(part)), data);
      sizes[part] = data.length;
      hashes[part] = sha256;
    },
    done: async (result) => {
      await writeFile(join(folder, "manifest.json"), JSON.stringify(manifestOf(result, sizes, hashes), null, 2) + "\n");
    }
  };
}
