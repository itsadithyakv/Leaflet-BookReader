import { createHash } from "node:crypto";
import { errorFixes, errorKinds } from "./db.js";
import { HttpError } from "./http.js";
import { PLATFORMS, VERSION } from "./metrics.js";

/**
 * Error reports the apps send by themselves (`POST /v1/errors`): not what
 * went wrong for whom, but which kinds of error happen, in which versions,
 * on which platforms, and how often. Anonymous, from readers signed in or
 * not, and switched off in the app's Settings by anyone who would rather not.
 *
 * A kind is an error's name, its message and the top few places in the code
 * it came from, with everything that could be a reader's taken out first:
 * paths and file names, addresses, emails, numbers and anything quoted (a
 * book's title is most often in quotes, when it is in a message at all). The
 * app does that before sending (`apps/src/services/errorScrub.ts`), and it
 * is done again here with the same rules, since a request can say anything.
 *
 * One document per kind, version, platform and UTC day, counted up with
 * `$inc`; gone after 90 days by itself (TTL). A day takes at most
 * `NEW_KINDS_PER_DAY` kinds it has not seen yet; past that, only the ones
 * it already has are counted, so a flood of made-up kinds cannot fill a free
 * cluster. Nothing about the sender is kept: no account (the request is not
 * signed in), no address, no time finer than the day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The most kinds one batch carries, and the most a day takes that it has not seen yet. */
export const KINDS_PER_BATCH = 20;
export const NEW_KINDS_PER_DAY = 100;
export const NAME_MAX = 60;
export const MESSAGE_MAX = 200;
export const FRAMES_MAX = 5;
export const FRAME_MAX = 80;
/** How many times one kind may say it happened in a session, at most. */
const COUNT_MAX = 1000;

// ---- scrubbing (the same rules as apps/src/services/errorScrub.ts) ------------

const CONTROL = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)]+/gi;
// C:\..., \\server\share\..., ~/..., /a/b..., and a relative a/b/c.d.
const WINDOWS_PATH = /(?:\b[a-z]:|\\\\[^\s\\]+)\\[^\s"'`<>|]*/gi;
const UNIX_PATH = /(?:~|\.{1,2})?\/[^\s"'`<>/]+(?:\/[^\s"'`<>/]*)+/g;
const FILE = /[^\s"'`<>/\\]+\.(?:epub|pdf|mobi|azw3?|kfx|cbz|cbr|cb7|fb2|djvu|txt|rtf|docx?|odt|html?|xhtml|zip|rar|7z|png|jpe?g|webp|gif|svg|json|db|sqlite|log|ttf|otf)\b/gi;
// A single quote only opens after something that is not a letter, and only
// closes before one, so "couldn't" and "the reader's" are words, not quotes;
// one inside ('It's here') does not end it.
const QUOTED =
  /"[^"]*"|(?<![\p{L}\p{N}])'(?:[^']|'(?=\p{L}))*'(?![\p{L}\p{N}])|`[^`]*`|\u201C[^\u201D]*\u201D|(?<![\p{L}\p{N}])\u2018(?:[^\u2019]|\u2019(?=\p{L}))*\u2019(?![\p{L}\p{N}])|\u00AB[^\u00BB]*\u00BB/gu;
// Long runs of letters and digits that are ids, tokens or hashes, not words.
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g;
const NUMBER = /\b0x[0-9a-f]+\b|\d+(?:[.,:]\d+)*/gi;

/** A message, a name or a context as kept: one line, nothing of the reader's, at most `max` characters. */
export function scrubText(value, max = MESSAGE_MAX) {
  const text = String(value ?? "")
    .replace(CONTROL, " ")
    .replace(EMAIL, "<email>")
    .replace(URL, "<url>")
    .replace(WINDOWS_PATH, "<path>")
    .replace(UNIX_PATH, "<path>")
    .replace(FILE, "<file>")
    .replace(QUOTED, "<q>")
    .replace(TOKEN, "<id>")
    .replace(NUMBER, "#")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, max).join("").trim();
}

/**
 * One place in the code as kept: a function's name and the file it is in,
 * without the build's hash ("LibraryPage-Dx81aQ.js" is "LibraryPage.js"),
 * the line or the column (they move with every release, and a kind should
 * not), and with anything else made plain the way a message is.
 */
export function scrubFrame(value) {
  const frame = String(value ?? "").replace(CONTROL, " ").trim();
  const [fn = "", file = ""] = frame.split("@");
  const where = file
    .replace(/[?#].*$/, "")
    .replace(/(?::\d+)+$/, "")
    .replace(/-[A-Za-z0-9_]{6,12}(?=\.[a-z]+$)/, "");
  const name = fn.replace(/[^\p{L}\p{N}_$.<> ]/gu, "").trim();
  const place = /^[\p{L}\p{N}_$./-]+$/u.test(where) && !/\d{3,}/.test(where) ? where.split("/").slice(-3).join("/") : where ? "<path>" : "";
  const kept = `${name && name.length > 2 ? name : "?"}${place ? `@${place}` : ""}`;
  return [...kept].slice(0, FRAME_MAX).join("");
}

/** The key a kind is counted under: the same scrubbed name, message and places, the same kind. */
export const signatureOf = ({ name, message, frames }) =>
  createHash("sha256").update([name, message, ...frames].join("\n")).digest("hex").slice(0, 32);

/** A version as compared: "1.5.12" is [1, 5, 12]. */
const parts = (version) => String(version).split(".").map(Number);
/** Below zero when `a` is the older version, above when it is the newer, 0 when they are the same. */
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let index = 0; index < Math.max(x.length, y.length); index += 1) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

const versionOr = (value, fallback) => (typeof value === "string" && VERSION.test(value) ? value : fallback);

/**
 * A batch as kept: the platform, and each kind scrubbed again with the
 * version it was seen in. Refused (400) when it is not one at all; a kind
 * that scrubs down to nothing is left out rather than refuse the rest.
 */
export function cleanBatch(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.kinds)) {
    throw new HttpError(400, "kinds should be a list.");
  }
  if (!PLATFORMS.includes(body.platform)) {
    throw new HttpError(400, `platform is one of ${PLATFORMS.join(", ")}.`);
  }
  const version = versionOr(body.version, null);
  if (!version) {
    throw new HttpError(400, "version is numbers with dots, like 1.5.12.");
  }
  if (body.kinds.length > KINDS_PER_BATCH) {
    throw new HttpError(400, `A batch is up to ${KINDS_PER_BATCH} kinds.`);
  }
  const kinds = new Map();
  for (const raw of body.kinds) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const name = scrubText(raw.name || "Error", NAME_MAX) || "Error";
    const message = scrubText(raw.message, MESSAGE_MAX);
    const frames = (Array.isArray(raw.frames) ? raw.frames : []).slice(0, FRAMES_MAX).map(scrubFrame).filter(Boolean);
    if (!message && frames.length === 0) {
      continue;
    }
    const count = Number.isInteger(raw.count) ? Math.min(Math.max(raw.count, 1), COUNT_MAX) : 1;
    const kind = { name, message, frames, version: versionOr(raw.version, version) };
    const sig = signatureOf(kind);
    const key = `${sig}:${kind.version}`;
    const same = kinds.get(key);
    if (same) {
      same.count = Math.min(same.count + count, COUNT_MAX);
    } else {
      kinds.set(key, { ...kind, sig, count });
    }
  }
  return { platform: body.platform, kinds: [...kinds.values()] };
}

// ---- keeping them --------------------------------------------------------------

const utcDay = (now) => now.toISOString().slice(0, 10);
const dayStart = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * How many kinds today has that it did not have before, as this process
 * counts them: read from the database once a day (and after a restart), then
 * counted up from what each batch adds. Two batches at the same moment may
 * between them go a few past the cap; that is all.
 */
const today = { day: null, made: 0 };

/** For tests: forget the day's count, so the next batch reads it again. */
export function forgetTodaysKinds() {
  today.day = null;
  today.made = 0;
}

/**
 * Counts a cleaned batch: one upsert for each kind (one round trip for the
 * lot), or, once today has taken its share of new kinds, an update of those
 * it already has and nothing for the rest. Resolves to how many were counted.
 */
export async function keepBatch(db, batch, now = new Date(), newPerDay = NEW_KINDS_PER_DAY) {
  if (batch.kinds.length === 0) {
    return 0;
  }
  const day = utcDay(now);
  if (today.day !== day) {
    today.day = day;
    today.made = await errorKinds(db).countDocuments({ day });
  }
  const roomForNew = today.made < newPerDay;
  const operations = batch.kinds.map((kind) => ({
    updateOne: {
      filter: { _id: `${kind.sig}:${kind.version}:${batch.platform}:${day}` },
      update: {
        $inc: { count: kind.count },
        $max: { lastAt: now },
        $setOnInsert: {
          sig: kind.sig,
          version: kind.version,
          platform: batch.platform,
          day,
          at: dayStart(now),
          name: kind.name,
          message: kind.message,
          frames: kind.frames,
          firstAt: now
        }
      },
      upsert: roomForNew
    }
  }));
  const result = await errorKinds(db).bulkWrite(operations, { ordered: false });
  today.made += result.upsertedCount ?? 0;
  return (result.matchedCount ?? 0) + (result.upsertedCount ?? 0);
}

const iso = (date) => (date instanceof Date ? date.toISOString() : null);

/**
 * The kinds as the owner's list shows them, one row a kind: what it says,
 * how often in all, in which versions and on which platforms, when it was
 * first and last seen, and whether it was marked fixed. A kind marked fixed
 * in a version and since seen in that version or a later one is open again.
 * `status` is "open", "fixed" or "all"; the most recently seen first.
 */
export async function listKinds(db, status = "open", limit = 100) {
  const rows = await errorKinds(db)
    .aggregate([
      { $sort: { lastAt: -1 } },
      {
        $group: {
          _id: "$sig",
          name: { $first: "$name" },
          message: { $first: "$message" },
          frames: { $first: "$frames" },
          count: { $sum: "$count" },
          versions: { $addToSet: "$version" },
          platforms: { $addToSet: "$platform" },
          firstAt: { $min: "$firstAt" },
          lastAt: { $max: "$lastAt" },
          today: { $sum: { $cond: [{ $gte: ["$lastAt", new Date(Date.now() - DAY_MS)] }, "$count", 0] } }
        }
      },
      { $sort: { lastAt: -1 } },
      { $limit: 500 }
    ])
    .toArray();
  const fixes = await errorFixes(db)
    .find({ _id: { $in: rows.map((row) => row._id) } })
    .toArray();
  const fixedIn = new Map(fixes.map((fix) => [fix._id, fix.fixedIn]));
  return rows
    .map((row) => {
      const versions = [...row.versions].sort(compareVersions);
      const fix = fixedIn.get(row._id) ?? null;
      const again = Boolean(fix) && versions.some((version) => compareVersions(version, fix) >= 0);
      return {
        sig: row._id,
        name: row.name,
        message: row.message,
        frames: row.frames ?? [],
        count: row.count,
        recent: row.today,
        versions,
        platforms: [...row.platforms].sort(),
        firstAt: iso(row.firstAt),
        lastAt: iso(row.lastAt),
        fixedIn: fix,
        status: fix && !again ? "fixed" : "open",
        reopened: again
      };
    })
    .filter((row) => status === "all" || row.status === status)
    .slice(0, limit);
}

/** Marks a kind fixed in `version`, or (null) open again. 404 for a kind there is no record of. */
export async function markKind(db, sig, version) {
  if (!/^[0-9a-f]{32}$/.test(sig ?? "")) {
    throw new HttpError(404, "There is no such error.");
  }
  if (version !== null && !(typeof version === "string" && VERSION.test(version))) {
    throw new HttpError(400, "A version is numbers with dots, like 1.5.12.");
  }
  if (!(await errorKinds(db).findOne({ sig }, { projection: { _id: 1 } }))) {
    throw new HttpError(404, "There is no such error.");
  }
  if (version === null) {
    await errorFixes(db).deleteOne({ _id: sig });
  } else {
    await errorFixes(db).updateOne({ _id: sig }, { $set: { fixedIn: version, at: new Date() } }, { upsert: true });
  }
  return { sig, fixedIn: version };
}
