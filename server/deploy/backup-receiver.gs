/**
 * Leaflet backups — a Google Apps Script web app.
 *
 * The VM's nightly backup (server/src/backup/run.js) posts the encrypted
 * dump here, a part at a time, and this script writes it to the Drive of the
 * Gmail account that owns it, in a folder "Leaflet backups":
 *
 *   Leaflet backups/leaflet-2026-10-17T0330Z/part-000
 *                                            part-001 ...
 *                                            manifest.json
 *
 *   {secret, action: "ping"}                                checks the secret, writes nothing
 *   {secret, action: "part", name, part, data, sha256}      one part, base64 (at most 12 MB decoded);
 *                                                           sent again, it replaces the first
 *   {secret, action: "done", name, parts, size, sha256, counts}
 *                                                           checks every part is there and the sizes
 *                                                           add up, writes manifest.json, then moves
 *                                                           old backups to the bin
 *
 * The parts are encrypted on the VM to the owner's public key: nothing here
 * (or in Drive) can read them. The secret can add a backup and nothing else:
 * nothing here lists, sends back or changes a backup that is complete, so
 * the worst a leaked secret can do is add up to 6 backups a day.
 *
 * Kept: every complete backup of the last KEEP_DAYS days (Script Property,
 * default 14), and the 3 newest complete ones whatever their age, but nothing
 * older than 30 days. A backup left incomplete goes after 2 days. "Goes"
 * means Drive's bin, which empties itself after 30 days, or, with the Drive
 * API advanced service switched on, deleted for good at once (see discard).
 *
 * checkFresh() is for a daily time-driven trigger: it emails ALERT_EMAIL
 * (Script Property) when the newest complete backup is more than 36 hours
 * old, or there is none.
 *
 * Step-by-step setup: docs/backups.md. After editing this script: Deploy ->
 * Manage deployments -> edit (pencil) -> Version: New version -> Deploy. The
 * URL stays the same.
 *
 * Script Properties: SECRET, ALERT_EMAIL, KEEP_DAYS (optional). FOLDER_ID is
 * written by the script itself (the id of "Leaflet backups").
 */

var ROOT_NAME = "Leaflet backups";
var SHA256 = /^[0-9a-f]{64}$/;

// The block below is a copy of server/src/backup/rules.js, between its
// "rules: begin" and "rules: end" lines, pasted unchanged (the server's
// tests check the two are the same). Edit it there, then paste it here.

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

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return reply({ ok: false, error: "bad request" });
  }

  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || !body || body.secret !== secret) {
    return reply({ ok: false, error: "forbidden" });
  }
  if (body.action === "ping") {
    return reply({ ok: true });
  }
  if (!isBackupName(body.name)) {
    return reply({ ok: false, error: "bad name" });
  }

  // One at a time: a part sent again after a timeout may arrive while the
  // first copy is still being written.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) {
    return reply({ ok: false, error: "busy" });
  }
  try {
    if (body.action === "part") {
      return reply(savePart(body));
    }
    if (body.action === "done") {
      return reply(finish(body));
    }
    return reply({ ok: false, error: "bad request" });
  } finally {
    lock.releaseLock();
  }
}

/** One part: decoded, checked against its sha256, saved as part-NNN (replacing an earlier copy). */
function savePart(body) {
  var length = decodedLength(body.data);
  if (!isPartNumber(body.part) || length < 0) {
    return { ok: false, error: "bad part" };
  }
  var root = rootFolder(true);
  var all = backups(root);
  var backup = find(all, body.name);
  if (backup && backup.complete) {
    return { ok: false, error: "already complete" };
  }
  var folder;
  if (backup) {
    folder = backup.folder;
  } else {
    if (!mayStart(all, Date.now())) {
      return { ok: false, error: "too many" };
    }
    folder = root.createFolder(body.name);
  }

  var bytes;
  try {
    bytes = Utilities.base64Decode(body.data);
  } catch (error) {
    return { ok: false, error: "bad part" };
  }
  if (bytes.length !== length) {
    return { ok: false, error: "bad part" };
  }
  var sha = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (body.sha256 !== sha) {
    // Damaged on the way: the server sends it again.
    return { ok: false, error: "damaged" };
  }

  var name = partName(body.part);
  trashFiles(folder, function (fileName) { return fileName === name; });
  var file = folder.createFile(Utilities.newBlob(bytes, "application/octet-stream", name));
  file.setDescription(sha);
  return { ok: true, part: body.part, size: bytes.length };
}

/** The end of a backup: every part there, the sizes adding up; then manifest.json, then the pruning. */
function finish(body) {
  var parts = body.parts;
  if (typeof parts !== "number" || Math.floor(parts) !== parts || parts < 1 || parts > MAX_PARTS || !SHA256.test(String(body.sha256))) {
    return { ok: false, error: "bad request" };
  }
  var root = rootFolder(true);
  var all = backups(root);
  var backup = find(all, body.name);
  if (!backup) {
    return { ok: false, error: "no such backup" };
  }
  if (backup.complete) {
    return { ok: false, error: "already complete" };
  }

  var sizes = [];
  var hashes = [];
  var total = 0;
  for (var n = 0; n < parts; n++) {
    var file = liveFile(backup.folder, partName(n));
    if (!file) {
      return { ok: false, error: "missing " + partName(n) };
    }
    sizes.push(file.getSize());
    hashes.push(file.getDescription() || "");
    total += file.getSize();
  }
  if (total !== body.size) {
    return { ok: false, error: "size mismatch" };
  }
  // Parts past the last (from an earlier, longer try of the same name).
  trashFiles(backup.folder, function (fileName) {
    var m = /^part-(\d{3})$/.exec(fileName);
    return Boolean(m) && Number(m[1]) >= parts;
  });

  var manifest = {
    leafletBackup: 1,
    name: body.name,
    parts: parts,
    size: total,
    sha256: body.sha256,
    counts: cleanCounts(body.counts),
    partSizes: sizes,
    partSha256: hashes,
    completedAt: new Date().toISOString()
  };
  backup.folder.createFile("manifest.json", JSON.stringify(manifest, null, 2), "application/json");
  backup.complete = true;

  var keep = keepDays(PropertiesService.getScriptProperties().getProperty("KEEP_DAYS"));
  var trashed = 0;
  toTrash(all, Date.now(), keep).forEach(function (name) {
    var old = find(all, name);
    if (old) {
      discard(old.folder);
      trashed++;
    }
  });
  return { ok: true, parts: parts, size: total, trashed: trashed };
}

/**
 * For a daily time-driven trigger (Triggers -> Add Trigger -> checkFresh,
 * Time-driven, Day timer). Emails ALERT_EMAIL when there has been no
 * complete backup for 36 hours.
 */
function checkFresh() {
  var to = PropertiesService.getScriptProperties().getProperty("ALERT_EMAIL");
  var root = rootFolder(false);
  var all = root ? backups(root) : [];
  if (!isStale(all, Date.now())) {
    return "fresh";
  }
  var newest = newestComplete(all);
  var text =
    (newest === null
      ? "There is no complete Leaflet backup in Drive (folder \"" + ROOT_NAME + "\")."
      : "The newest complete Leaflet backup is from " + new Date(newest).toISOString() + ", more than " + STALE_HOURS + " hours ago.") +
    "\n\nOn the VM:\n" +
    "    systemctl list-timers leaflet-backup\n" +
    "    sudo journalctl -u leaflet-backup -n 30\n\n" +
    "The last line of the log says why it failed. See docs/backups.md.\n\n- Leaflet backups";
  if (to) {
    MailApp.sendEmail(to, "Leaflet: no backup for " + STALE_HOURS + " hours", text);
  }
  return "stale";
}

/** Optional: run once from the editor to add checkFresh's daily trigger (instead of the Triggers page). */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "checkFresh") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("checkFresh").timeBased().everyDays(1).atHour(9).create();
}

/** Opening the URL in a browser shows this: a quick check that it is deployed. Nothing else. */
function doGet() {
  // Whether old backups are deleted for good (the Drive API service is on) or
  // only moved to the bin: the run sheet's step 9 is checked here.
  var forGood = typeof Drive !== "undefined" && Boolean(Drive.Files && Drive.Files.remove);
  return reply({ ok: true, service: "leaflet-backups", deletes: forGood ? "for good" : "to the bin" });
}

// ---- Drive -------------------------------------------------------------------

/** "Leaflet backups", made the first time (or null, when `create` is false and there is none). */
function rootFolder(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("FOLDER_ID");
  if (id) {
    try {
      var kept = DriveApp.getFolderById(id);
      if (!kept.isTrashed()) {
        return kept;
      }
    } catch (error) {
      // Deleted for good: make another.
    }
  }
  if (!create) {
    return null;
  }
  var folder = DriveApp.createFolder(ROOT_NAME);
  props.setProperty("FOLDER_ID", folder.getId());
  return folder;
}

/** Every backup folder in the root, as the rules see them, with the folder itself. */
function backups(root) {
  var all = [];
  var folders = root.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    if (folder.isTrashed() || !isBackupName(folder.getName())) {
      continue;
    }
    all.push({
      name: folder.getName(),
      created: folder.getDateCreated().getTime(),
      complete: Boolean(liveFile(folder, "manifest.json")),
      folder: folder
    });
  }
  return all;
}

function find(all, name) {
  for (var i = 0; i < all.length; i++) {
    if (all[i].name === name) {
      return all[i];
    }
  }
  return null;
}

/**
 * An old backup goes. Into Drive's bin (which keeps it 30 more days, then
 * empties itself), unless the Drive API advanced service is switched on for
 * this project (Services -> + -> Drive API): then it is deleted for good at
 * once, so nothing is ever kept past MAX_DAYS. See docs/backups.md.
 */
function discard(folder) {
  if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.remove) {
    try {
      Drive.Files.remove(folder.getId());
      return;
    } catch (error) {
      // Fall back to the bin.
    }
  }
  folder.setTrashed(true);
}

/** The file of that name in the folder that is not in the bin, or null. */
function liveFile(folder, name) {
  var files = folder.getFilesByName(name);
  while (files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed()) {
      return file;
    }
  }
  return null;
}

function trashFiles(folder, matches) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed() && matches(file.getName())) {
      file.setTrashed(true);
    }
  }
}

/** {collection: count}, kept only when it looks like one. */
function cleanCounts(counts) {
  var clean = {};
  if (!counts || typeof counts !== "object") {
    return clean;
  }
  Object.keys(counts).slice(0, 200).forEach(function (name) {
    var count = counts[name];
    if (/^[A-Za-z0-9_.-]{1,120}$/.test(name) && typeof count === "number" && Math.floor(count) === count && count >= 0) {
      clean[name] = count;
    }
  });
  return clean;
}

/** Apps Script's digests are signed bytes. */
function hex(bytes) {
  return bytes
    .map(function (b) {
      return ("0" + (b & 0xff).toString(16)).slice(-2);
    })
    .join("");
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
