import { accounts, libraries, states } from "./db.js";

/**
 * Accounts nobody uses any more (sync audit C6): off unless the owner turns
 * it on (`DORMANT_ACCOUNTS=on`), and nothing is removed or sent while it is
 * off.
 *
 * The day an account was last used (`lastSeenAt`) is also what the owner's
 * overview counts active readers by (`routes/admin.js`), with the version and
 * platform of the app it was used from (`client`, from the app's
 * `X-Leaflet-Client` header, on the same write). So it is noted while the
 * policy is off as well, unless `ACTIVE_READERS=off`: still once a day at
 * most for each account, and nothing at all with both off.
 *
 * The proposal, as built:
 *
 * - An account is **dormant** once it has not been used for `months` (12):
 *   no request with one of its sign-ins, and no sign-in. When it was last
 *   used is kept on the account (`lastSeenAt`), to the day, written at most
 *   once a day for each account (`noteSeen`). Accounts from before this was
 *   on have no `lastSeenAt`: the first sweep gives them today's, so the
 *   twelve months start then for everybody and no account is ever judged on
 *   a clock that was not running.
 * - A dormant account that still has a synced reading state (`states`) or a
 *   shared library (`libraries`) here is sent **one email**: what will be
 *   removed, and on which day, unless the reader signs in before then
 *   (`graceDays`, 60, later). No email can be sent (no mailer set up, a
 *   mailer whose script does not know the message yet, its daily quota
 *   gone), then nothing is warned, and so nothing is ever removed: removal
 *   only ever follows a warning that went out. At most `mailPerDay` (20)
 *   warnings a day, so the ~100 a day the Apps Script mailer may send leave
 *   room for reset and confirmation codes.
 * - Once that day has passed, still unused: the **sync state and the shared
 *   library are deleted**, and nothing else. The account, its profile, its
 *   posts and its follows stay; signing in again works, and the reader's
 *   devices, which hold the whole library, send their state again at their
 *   next sync. What is lost is only a library no device of theirs still has.
 * - Any use at all before then (a sign-in, an app that syncs) cancels the
 *   warning and starts the twelve months again.
 *
 * Why only those two: they are what is large (the sync state is 3 KB to
 * 0.5 MB, a library up to 70 KB, against a profile's 4 KB and an account's
 * 1 KB), and they are copies of what the reader's devices keep. Deleting the
 * account itself would end their handle, posts and follows on a reader who
 * may only have been away, which the privacy policy does not say we do.
 *
 * The sweep runs once a day (`index.js`). Everything it does is logged as
 * counts, never addresses.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// `seen`: note the day an account was used even with the policy off (for the overview's active readers).
export const DORMANT_DEFAULTS = Object.freeze({ enabled: false, seen: false, months: 12, graceDays: 60, mailPerDay: 20, removePerRun: 200 });

/** A whole number from the environment within [least, most], or `fallback`. */
function envWhole(env, name, fallback, least, most) {
  const value = Number(env[name]);
  return env[name] !== undefined && env[name] !== "" && Number.isInteger(value) && value >= least && value <= most ? value : fallback;
}

/**
 * The policy the environment sets: off unless `DORMANT_ACCOUNTS` is `on`;
 * `DORMANT_MONTHS` (12; 6 to 120), `DORMANT_GRACE_DAYS` (60; 30 to 365) and
 * `DORMANT_MAIL_PER_DAY` (20; 0 to 90). The day of use is noted unless
 * `ACTIVE_READERS` is `off`.
 */
export function dormantPolicyFromEnv(env = process.env) {
  return {
    enabled: String(env.DORMANT_ACCOUNTS ?? "").trim().toLowerCase() === "on",
    seen: String(env.ACTIVE_READERS ?? "").trim().toLowerCase() !== "off",
    months: envWhole(env, "DORMANT_MONTHS", DORMANT_DEFAULTS.months, 6, 120),
    graceDays: envWhole(env, "DORMANT_GRACE_DAYS", DORMANT_DEFAULTS.graceDays, 30, 365),
    mailPerDay: envWhole(env, "DORMANT_MAIL_PER_DAY", DORMANT_DEFAULTS.mailPerDay, 0, 90),
    removePerRun: DORMANT_DEFAULTS.removePerRun
  };
}

let policy = DORMANT_DEFAULTS;
/** Accounts noted as seen today in this process: their id, and the day (UTC) it was. */
const seenToday = new Map();
const MAX_SEEN = 20_000;

/** Sets the policy for this process (`index.js`; tests). */
export function useDormantPolicy(next = {}) {
  policy = Object.freeze({ ...DORMANT_DEFAULTS, ...next });
  seenToday.clear();
}

export function dormantPolicy() {
  return policy;
}

/**
 * Notes that an account was used, and so is not dormant: its `lastSeenAt`
 * becomes now, and a warning it was sent is called off. At most one write a
 * (UTC) day for each account (the sessions' own hourly refresh calls this).
 * `client` is the app's `{version, platform}` (`metrics.js`, `clientOf`),
 * kept on the same write when there is one. Nothing at all while the policy
 * is off and active readers are not counted.
 */
export async function noteSeen(db, userId, now = new Date(), client = null) {
  if (!(policy.enabled || policy.seen) || !userId) {
    return;
  }
  const key = String(userId);
  const day = Math.floor(now.getTime() / DAY_MS);
  if (seenToday.get(key) === day) {
    return;
  }
  if (seenToday.size >= MAX_SEEN) {
    seenToday.clear();
  }
  seenToday.set(key, day);
  // Once a UTC day, not once in 24 hours: used every evening and every
  // morning, an account noted only when a whole day had passed was missed
  // from "today" for most of the day. Either way one write a day at most.
  const set = client ? { lastSeenAt: now, client: { version: client.version, platform: client.platform } } : { lastSeenAt: now };
  await accounts(db).updateOne(
    { _id: userId, $or: [{ lastSeenAt: { $exists: false } }, { lastSeenAt: { $lt: new Date(day * DAY_MS) } }] },
    { $set: set, $unset: { dormantWarnedAt: "", dormantRemoveAfter: "", dormantClearedAt: "" } }
  );
}

/** `months` calendar months before `now`. */
export function monthsBefore(now, months) {
  const at = new Date(now.getTime());
  at.setUTCMonth(at.getUTCMonth() - months);
  return at;
}

/** A day as the mailer's script takes it: "1 March 2027" (UTC). */
export function mailDay(date) {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Whether there is anything of the account's to remove: a sync state or a shared library. */
async function holdsSomething(db, id) {
  const [state, library] = await Promise.all([
    states(db).findOne({ _id: id }, { projection: { _id: 1 } }),
    libraries(db).findOne({ _id: id }, { projection: { _id: 1 } })
  ]);
  return Boolean(state || library);
}

/**
 * One day's sweep: start the clock where it is not running, remove what was
 * warned about and is due, then warn the newly dormant (`mailer`, as
 * `mail.js` makes it). Resolves to counts: `started`, `removed`, `warned`,
 * `cleared` (dormant, but nothing here to remove), `unsent` (a warning that
 * could not go, after which the sweep stops warning for the day).
 */
export async function sweepDormant(db, { mailer = null, now = new Date(), log = console } = {}) {
  const counts = { started: 0, removed: 0, warned: 0, cleared: 0, unsent: 0 };
  if (!policy.enabled) {
    return counts;
  }
  counts.started = (await accounts(db).updateMany({ lastSeenAt: { $exists: false } }, { $set: { lastSeenAt: now } })).modifiedCount;
  const idleSince = monthsBefore(now, policy.months);

  // Due: warned, the day named has come, and still not used since.
  const due = await accounts(db)
    .find({ lastSeenAt: { $lt: idleSince }, dormantRemoveAfter: { $lte: now } }, { projection: { _id: 1 }, limit: policy.removePerRun })
    .toArray();
  for (const { _id } of due) {
    await states(db).deleteOne({ _id });
    await libraries(db).deleteOne({ _id });
    await accounts(db).updateOne(
      { _id, lastSeenAt: { $lt: idleSince } },
      { $set: { dormantClearedAt: now }, $unset: { dormantWarnedAt: "", dormantRemoveAfter: "" } }
    );
    counts.removed += 1;
  }

  if (policy.mailPerDay === 0) {
    return counts;
  }
  if (!mailer) {
    log.warn?.("[leaflet] dormant accounts: no mailer set up, so none is warned and nothing is removed.");
    return counts;
  }
  // Dormant, not warned, and not already cleared since they were last seen.
  const cursor = accounts(db).find(
    { lastSeenAt: { $lt: idleSince }, dormantWarnedAt: { $exists: false }, dormantClearedAt: { $exists: false } },
    { projection: { _id: 1, email: 1 } }
  );
  const removeOn = new Date(now.getTime() + policy.graceDays * DAY_MS);
  try {
    for await (const account of cursor) {
      if (counts.warned >= policy.mailPerDay) {
        break;
      }
      if (!(await holdsSomething(db, account._id))) {
        await accounts(db).updateOne({ _id: account._id }, { $set: { dormantClearedAt: now } });
        counts.cleared += 1;
        continue;
      }
      try {
        await mailer({ kind: "dormant", to: account.email, removeOn: mailDay(removeOn) });
      } catch (error) {
        counts.unsent += 1;
        log.warn?.(`[leaflet] dormant accounts: a warning could not be sent (${error?.message ?? error}); none more today.`);
        break;
      }
      await accounts(db).updateOne(
        { _id: account._id, lastSeenAt: { $lt: idleSince } },
        { $set: { dormantWarnedAt: now, dormantRemoveAfter: removeOn } }
      );
      counts.warned += 1;
    }
  } finally {
    await cursor.close().catch(() => {});
  }
  return counts;
}
