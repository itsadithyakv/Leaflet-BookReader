import { follows, followRequests, kudos, meta, profiles } from "./db.js";
import { backfillFollowCounts } from "./followCounts.js";

/**
 * Finding readers (1.5.15): what a profile is searched by, how two readers
 * stand, and the counts a profile keeps for itself. The routes are in
 * `routes/people.js` (browse, suggestions, the two lists) and
 * `routes/community.js` (search, the profile).
 *
 * **Search** matches the start of any word of a reader's name or handle: "lov"
 * finds "Ada Lovelace" and "@the_lovebird". It is one multikey index on a
 * list of words kept on the profile (`nameWords`), never a scan:
 *
 *   - the words are the name's, folded (lower case, accents off: "Zoë" is
 *     "zoe"), plus the handle whole and its parts split at "-" and "_";
 *   - each word of the query (at most three) must start a word of the list
 *     (`$all` of anchored regexes: the first is the index's range, the
 *     others are checked on what it finds);
 *   - "contains" anywhere inside a word ("velace") is not matched: no index
 *     serves it, and a scan of every profile per keystroke is what a free
 *     cluster cannot afford.
 *
 * The list is written by a profile save whenever the name or the handle
 * changes (`routes/social.js`), and once for every profile that has none at
 * the first start of this server (`backfillNameWords`).
 */

/** Lower case, accents and other marks taken off: "Zoë Ångström" → "zoe angstrom". */
export const fold = (text) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

/** Letters and digits in runs: the words of folded text. */
const wordsOf = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The most words a profile is searched by, and the longest of them kept. */
const MAX_WORDS = 12;
const MAX_WORD = 40;

/**
 * What a profile is searched by: the words of its name, then its handle and
 * the handle's parts, each once, in that order. Empty for a profile with
 * neither.
 */
export function searchWords(displayName, handle) {
  const words = [...wordsOf(displayName)];
  if (typeof handle === "string" && handle) {
    words.push(handle, ...handle.split(/[-_]+/));
  }
  return [...new Set(words.filter(Boolean).map((word) => word.slice(0, MAX_WORD)))].slice(0, MAX_WORDS);
}

/** The most words of a query that count, and the longest of each. */
const MAX_QUERY_WORDS = 3;
const MAX_QUERY_WORD = 24;

/**
 * The words of a search, longest first (the first is the index's range, so
 * the longest is the narrowest): letters and digits only, so each is safe
 * inside a regex. An "@" before a handle is fine. Empty when there is nothing
 * to look for.
 */
export function queryWords(raw) {
  const words = wordsOf(String(raw ?? "").trim().replace(/^@/, ""))
    .map((word) => word.slice(0, MAX_QUERY_WORD))
    .slice(0, MAX_QUERY_WORDS);
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** The query for profiles whose words start with every word asked. */
export const wordsFilter = (words) => ({ nameWords: { $all: words.map((word) => new RegExp(`^${word}`)) } });

/**
 * How the reader asking stands with each of `ids`: whether they follow them
 * (`followState`: `following`, `requested` while a request waits, else
 * `none`) and whether they follow back (`followsYou`). Three small queries
 * however many there are (a page is twenty), each on its pair index; none at
 * all when signed out.
 */
export async function relationsFor(db, meId, ids) {
  const out = new Map(ids.map((id) => [id.toHexString(), { followState: "none", followsYou: false }]));
  if (!meId || ids.length === 0) {
    return out;
  }
  const [mine, theirs, asked] = await Promise.all([
    follows(db)
      .find({ followerId: meId, followeeId: { $in: ids } }, { projection: { _id: 0, followeeId: 1 }, hint: "pair" })
      .toArray(),
    follows(db)
      .find({ followerId: { $in: ids }, followeeId: meId }, { projection: { _id: 0, followerId: 1 }, hint: "pair" })
      .toArray(),
    followRequests(db)
      .find({ fromId: meId, toId: { $in: ids } }, { projection: { _id: 0, toId: 1 } })
      .toArray()
  ]);
  for (const row of asked) {
    out.get(row.toId.toHexString()).followState = "requested";
  }
  for (const row of mine) {
    out.get(row.followeeId.toHexString()).followState = "following";
  }
  for (const row of theirs) {
    out.get(row.followerId.toHexString()).followsYou = true;
  }
  return out;
}

// ---- kudos this month ---------------------------------------------------------
//
// Kudos expire after 21 days, so "this month" cannot be counted from them.
// A profile keeps its own: the UTC month (`kudosMonthKey`, "2026-10") and how
// many it was sent in it (`kudosMonthCount`), started again at 1 by the first
// kudos of a new month. Read as 0 when the month kept is not this one.

/** The UTC month a date is in: "2026-10". */
export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

/** Counts one kudos received now. A pipeline update, so the month's turn and the count are one write. */
export async function countKudosReceived(db, toId, now = new Date()) {
  const month = monthKey(now);
  await profiles(db).updateOne({ _id: toId }, [
    {
      $set: {
        kudosMonthCount: {
          $cond: [{ $eq: ["$kudosMonthKey", month] }, { $add: [{ $ifNull: ["$kudosMonthCount", 0] }, 1] }, 1]
        },
        kudosMonthKey: month
      }
    }
  ]);
}

/** A profile's kudos this month, as shown. */
export const kudosThisMonth = (profile, now = new Date()) =>
  profile?.kudosMonthKey === monthKey(now) ? Math.max(0, Math.floor(profile.kudosMonthCount ?? 0)) : 0;

// ---- backfills ------------------------------------------------------------------

/**
 * Gives `nameWords` to every profile with a handle that has none, five
 * hundred at a time. At every start: once they all have one it reads the
 * few written by a server from before 1.5.15 (none, normally) and writes
 * nothing. Says how many it wrote.
 */
export async function backfillNameWords(db) {
  let written = 0;
  for (;;) {
    const rows = await profiles(db)
      .find({ nameWords: { $exists: false }, handle: { $type: "string" } }, { projection: { handle: 1, displayName: 1 }, limit: 500 })
      .toArray();
    if (rows.length === 0) {
      return written;
    }
    await profiles(db).bulkWrite(
      rows.map((row) => ({
        updateOne: { filter: { _id: row._id }, update: { $set: { nameWords: searchWords(row.displayName, row.handle) } } }
      })),
      { ordered: false }
    );
    written += rows.length;
  }
}

/**
 * This month's kudos, counted from the kudos kept (three weeks of them), for
 * the profiles sent kudos before the profile counted them itself. Once
 * (`backfillPeople`): after it, every kudos is counted as it is sent.
 */
export async function backfillKudosMonth(db, now = new Date()) {
  const month = monthKey(now);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const counts = await kudos(db)
    .aggregate([{ $match: { createdAt: { $gte: start } } }, { $group: { _id: "$toId", count: { $sum: 1 } } }])
    .toArray();
  for (let at = 0; at < counts.length; at += 1000) {
    await profiles(db).bulkWrite(
      counts.slice(at, at + 1000).map((row) => ({
        updateOne: { filter: { _id: row._id }, update: { $set: { kudosMonthKey: month, kudosMonthCount: row.count } } }
      })),
      { ordered: false }
    );
  }
  return counts.length;
}

/** The markers (`meta`) that say a once-only backfill has run. Delete one by hand to run it again at the next start. */
export const BACKFILLS = { followCounts: "backfill:followCounts", kudosMonth: "backfill:kudosMonth" };

/** Runs `work` unless its marker is there, and leaves the marker when it has. Says what it did, or null when it was done already. */
async function once(db, marker, work) {
  if (await meta(db).findOne({ _id: marker }, { projection: { _id: 1 } })) {
    return null;
  }
  const result = await work();
  await meta(db).updateOne({ _id: marker }, { $set: { at: new Date(), result } }, { upsert: true });
  return result;
}

/**
 * Everything 1.5.15 needs on the profiles it finds: the search words (every
 * start, idempotent), the follow counts and this month's kudos (once each).
 * Run by `index.js` before the server listens, so no follow or kudos can
 * land between a count and its marker.
 */
export async function backfillPeople(db, now = new Date()) {
  return {
    nameWords: await backfillNameWords(db),
    followCounts: await once(db, BACKFILLS.followCounts, () => backfillFollowCounts(db)),
    kudosMonth: await once(db, BACKFILLS.kudosMonth, () => backfillKudosMonth(db, now))
  };
}

// ---- suggestions, kept a while ---------------------------------------------------
//
// Working out whom to suggest is several queries (`routes/people.js`), and the
// answer changes slowly, so it is kept per reader for ten minutes: only the
// ids and why, never a profile. Every answer re-reads those few profiles, so a
// reader who goes private or blocks someone in the meantime is never shown.
// A reader's own follow or unfollow forgets theirs.

const SUGGEST_TTL_MS = 10 * 60_000;
const MAX_SUGGEST_LISTS = 2000;
const suggestions = new Map();

export function cachedSuggestions(readerId, now = Date.now()) {
  const entry = suggestions.get(readerId);
  if (!entry || now - entry.at > SUGGEST_TTL_MS) {
    suggestions.delete(readerId);
    return null;
  }
  return entry.list;
}

export function rememberSuggestions(readerId, list, now = Date.now()) {
  if (suggestions.size >= MAX_SUGGEST_LISTS) {
    suggestions.clear();
  }
  suggestions.set(readerId, { at: now, list });
}

export function forgetSuggestions(readerId) {
  suggestions.delete(readerId);
}
