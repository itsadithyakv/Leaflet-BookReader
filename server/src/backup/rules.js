/**
 * The receiver's rules, as plain functions: what a backup may be called,
 * how many parts it may have and how large, which backups to throw away, and
 * when the newest is too old.
 *
 * The block between the two marker lines is pasted, unchanged, into
 * `deploy/backup-receiver.gs` (Apps Script cannot import a file), and
 * test/backup.test.js fails when the two copies differ. So: edit it here,
 * then paste it over the same block in the .gs. It is old-style JavaScript
 * (`var`, `function`) to read the same in both places.
 *
 * Times are milliseconds since 1970. A backup, for these functions, is
 * `{ name, created, complete }`: `created` is when the receiver made its
 * folder (Drive's date, not the name's, so a name cannot make a backup look
 * younger than it is), `complete` whether its manifest was written.
 */

// ---- rules: begin (mirrored verbatim in deploy/backup-receiver.gs) ----
var NAME_PATTERN = /^leaflet-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})Z$/;
var MAX_PARTS = 500;
var MAX_PART_BYTES = 12 * 1024 * 1024;
var KEEP_NEWEST = 3;
var KEEP_DAYS_DEFAULT = 14;
var MAX_DAYS = 30;
var INCOMPLETE_DAYS = 2;
var STALE_HOURS = 36;
var MAX_NEW_A_DAY = 6;
var HOUR_MS = 60 * 60 * 1000;
var DAY_MS = 24 * HOUR_MS;

/** `leaflet-2026-10-17T0330Z`, and a real date and time. */
function isBackupName(name) {
  var m = typeof name === "string" ? NAME_PATTERN.exec(name) : null;
  if (!m) {
    return false;
  }
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3]) &&
    d.getUTCHours() === Number(m[4]) &&
    d.getUTCMinutes() === Number(m[5])
  );
}

/** 0 to 499. */
function isPartNumber(part) {
  return typeof part === "number" && Math.floor(part) === part && part >= 0 && part < MAX_PARTS;
}

/** part-000, part-001, ... */
function partName(part) {
  return "part-" + ("00" + part).slice(-3);
}

/** How many bytes a base64 string decodes to, or -1 when it is not base64 or too large. */
function decodedLength(data) {
  if (typeof data !== "string" || data.length === 0 || data.length % 4 !== 0) {
    return -1;
  }
  if (data.length > (Math.ceil(MAX_PART_BYTES / 3) + 1) * 4 || !/^[A-Za-z0-9+\/]*={0,2}$/.test(data)) {
    return -1;
  }
  var padding = data.charAt(data.length - 2) === "=" ? 2 : data.charAt(data.length - 1) === "=" ? 1 : 0;
  var bytes = (data.length / 4) * 3 - padding;
  return bytes > MAX_PART_BYTES ? -1 : bytes;
}

/** The KEEP_DAYS property as a number of days: 14 when unset or not a number, never more than 30. */
function keepDays(value) {
  var days = Number(value);
  if (value === null || value === undefined || value === "" || !(days >= 1)) {
    return KEEP_DAYS_DEFAULT;
  }
  return Math.min(MAX_DAYS, Math.floor(days));
}

/**
 * The names of the backups to move to the bin:
 * - a complete backup older than `days`, unless it is one of the 3 newest
 *   complete ones;
 * - an incomplete one older than 2 days (a run that failed part-way);
 * - anything older than 30 days, the 3 newest included.
 */
function toTrash(backups, now, days) {
  var complete = backups
    .filter(function (b) { return b.complete; })
    .sort(function (a, b) { return b.created - a.created; });
  var names = [];
  complete.forEach(function (b, index) {
    var age = now - b.created;
    if (age > MAX_DAYS * DAY_MS || (index >= KEEP_NEWEST && age > days * DAY_MS)) {
      names.push(b.name);
    }
  });
  backups.forEach(function (b) {
    if (!b.complete && now - b.created > INCOMPLETE_DAYS * DAY_MS) {
      names.push(b.name);
    }
  });
  return names;
}

/** When the newest complete backup was made, or null when there is none. */
function newestComplete(backups) {
  var newest = null;
  backups.forEach(function (b) {
    if (b.complete && (newest === null || b.created > newest)) {
      newest = b.created;
    }
  });
  return newest;
}

/** No complete backup at all, or the newest is more than 36 hours old. */
function isStale(backups, now) {
  var newest = newestComplete(backups);
  return newest === null || now - newest > STALE_HOURS * HOUR_MS;
}

/**
 * Whether one more backup may be started now: at most 6 in any 24 hours,
 * so a leaked secret cannot fill the Drive with a flood of them.
 */
function mayStart(backups, now) {
  var recent = backups.filter(function (b) { return now - b.created < DAY_MS; });
  return recent.length < MAX_NEW_A_DAY;
}
// ---- rules: end ----

export {
  DAY_MS,
  HOUR_MS,
  INCOMPLETE_DAYS,
  KEEP_DAYS_DEFAULT,
  KEEP_NEWEST,
  MAX_DAYS,
  MAX_NEW_A_DAY,
  MAX_PARTS,
  MAX_PART_BYTES,
  STALE_HOURS,
  decodedLength,
  isBackupName,
  isPartNumber,
  isStale,
  keepDays,
  mayStart,
  newestComplete,
  partName,
  toTrash
};

/** The name of a backup started at `date`: leaflet-2026-10-17T0330Z. */
export function backupName(date) {
  const iso = date.toISOString(); // 2026-10-17T03:30:12.345Z
  return `leaflet-${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}
