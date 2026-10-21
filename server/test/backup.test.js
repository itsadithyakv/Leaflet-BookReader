import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import { BSON, Binary, Decimal128, Double, Int32, Long, MongoClient, ObjectId, UUID } from "mongodb";
import { deleteAccount } from "../src/deletion.js";
import { runBackup } from "../src/backup/backup.js";
import { BackupError, loadPrivateKey, loadPublicKey } from "../src/backup/format.js";
import { keygen } from "../src/backup/keygen.js";
import { restore } from "../src/backup/restore.js";
import * as rules from "../src/backup/rules.js";
import { appsScriptTarget, folderTarget, shortUrl } from "../src/backup/targets.js";

/**
 * The backups: a seeded throwaway database is backed up to a fake of the
 * Apps Script receiver (the same JSON protocol, the same redirect, the same
 * rules), "downloaded" to a folder and restored into another throwaway
 * database, which must then hold exactly what the first did. Then every way
 * a restore must refuse. Keys are made for the tests, in a temporary folder
 * that is deleted at the end.
 */

const { EJSON } = BSON;
const run = promisify(execFile);
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const tag = randomBytes(4).toString("hex");
const SOURCE = `leaflet_test_${tag}_src`;
const restoredNames = [];
const target = (label) => {
  const name = `leaflet_test_${tag}_${label}`;
  restoredNames.push(name);
  return name;
};
const SECRET = "test-secret-" + randomBytes(8).toString("hex");
const DAY = 24 * 60 * 60 * 1000;

let client;
let source;
let dir;
let keys;
let otherKeys;
let receiver;
let receiverUrl;
let backup; // the round trip's result
let downloaded; // its folder, as if downloaded from Drive

/**
 * A fake of deploy/backup-receiver.gs: a POST is answered with a redirect to
 * its output, as Apps Script does; the rules are the same module's. The
 * first output read is answered with Google's error page, once, to make the
 * client read again.
 */
function fakeReceiver(secret) {
  const backups = new Map(); // name -> { created, complete, parts: Map, manifest }
  const outputs = new Map();
  let next = 0;
  let flakyOnce = true;
  const list = () => [...backups.entries()].map(([name, b]) => ({ name, created: b.created, complete: b.complete }));

  const handle = (body) => {
    if (!body || body.secret !== secret) {
      return { ok: false, error: "forbidden" };
    }
    if (body.action === "ping") {
      return { ok: true };
    }
    if (!rules.isBackupName(body.name)) {
      return { ok: false, error: "bad name" };
    }
    const now = Date.now();
    let backup = backups.get(body.name);
    if (body.action === "part") {
      const length = rules.decodedLength(body.data);
      if (!rules.isPartNumber(body.part) || length < 0) {
        return { ok: false, error: "bad part" };
      }
      if (backup?.complete) {
        return { ok: false, error: "already complete" };
      }
      if (!backup) {
        if (!rules.mayStart(list(), now)) {
          return { ok: false, error: "too many" };
        }
        backup = { created: now, complete: false, parts: new Map(), manifest: null };
        backups.set(body.name, backup);
      }
      const bytes = Buffer.from(body.data, "base64");
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== length || body.sha256 !== sha) {
        return { ok: false, error: "damaged" };
      }
      backup.parts.set(body.part, { bytes, sha });
      return { ok: true, part: body.part, size: bytes.length };
    }
    if (body.action === "done") {
      if (!backup) {
        return { ok: false, error: "no such backup" };
      }
      if (backup.complete) {
        return { ok: false, error: "already complete" };
      }
      const sizes = [];
      const hashes = [];
      for (let n = 0; n < body.parts; n += 1) {
        const part = backup.parts.get(n);
        if (!part) {
          return { ok: false, error: `missing ${rules.partName(n)}` };
        }
        sizes.push(part.bytes.length);
        hashes.push(part.sha);
      }
      const total = sizes.reduce((a, b) => a + b, 0);
      if (total !== body.size) {
        return { ok: false, error: "size mismatch" };
      }
      backup.manifest = {
        leafletBackup: 1,
        name: body.name,
        parts: body.parts,
        size: total,
        sha256: body.sha256,
        counts: body.counts,
        partSizes: sizes,
        partSha256: hashes,
        completedAt: new Date().toISOString()
      };
      backup.complete = true;
      for (const name of rules.toTrash(list(), now, rules.keepDays(undefined))) {
        backups.delete(name);
      }
      return { ok: true, parts: body.parts, size: total };
    }
    return { ok: false, error: "bad request" };
  };

  const server = createServer(async (request, response) => {
    const answer = (status, value, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(typeof value === "string" ? value : JSON.stringify(value));
    };
    if (request.method === "GET" && request.url.startsWith("/out/")) {
      if (flakyOnce) {
        flakyOnce = false;
        return answer(200, "<html>Sorry, unable to open the file at present.</html>");
      }
      return answer(200, outputs.get(request.url.slice(5)) ?? { ok: false, error: "no output" });
    }
    if (request.method === "GET") {
      return answer(200, { ok: true, service: "leaflet-backups" });
    }
    let text = "";
    for await (const chunk of request) {
      text += chunk;
    }
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Answered as "forbidden" below, like a body without the secret.
    }
    const id = String(next++);
    outputs.set(id, handle(body));
    answer(302, "", { location: `/out/${id}` });
  });

  return {
    server,
    backups,
    /** What a Drive folder download of a backup gives: its parts and manifest.json. */
    download(name, into) {
      const backup = backups.get(name);
      const folder = join(into, name);
      mkdirSync(folder, { recursive: true });
      for (const [n, part] of backup.parts) {
        writeFileSync(join(folder, rules.partName(n)), part.bytes);
      }
      if (backup.manifest) {
        writeFileSync(join(folder, "manifest.json"), JSON.stringify(backup.manifest, null, 2));
      }
      return folder;
    }
  };
}

const quick = (secret = SECRET) => appsScriptTarget({ url: receiverUrl, secret, tries: 3, backoffMs: 1, readPauseMs: 1 });

/** Every collection of a database, as canonical Extended JSON, documents in _id order. */
async function contents(dbName) {
  const db = client.db(dbName);
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name).filter((name) => !name.startsWith("system.")).sort();
  const all = {};
  for (const name of names) {
    const docs = await db.collection(name).find({}, { promoteValues: false, bsonRegExp: true }).toArray();
    all[name] = docs.map((doc) => EJSON.stringify(doc, { relaxed: false })).sort();
  }
  return all;
}

const ALICE = new ObjectId();
const BOB = new ObjectId();

async function seed(db) {
  await db.collection("accounts").insertMany([
    { _id: ALICE, email: "alice@example.com", createdAt: new Date("2026-01-02T03:04:05.678Z"), passwordResets: [] },
    { _id: BOB, email: "bob@example.com", createdAt: new Date(), suspendedUntil: null }
  ]);
  await db.collection("profiles").insertMany([
    { _id: ALICE, handle: "alice", weekMinutes: new Int32(120), streak: 3, kudosFrom: [BOB] },
    { _id: BOB, handle: "bob", weekMinutes: new Double(0), ratio: new Double(3), big: Long.fromString("9007199254740993") }
  ]);
  await db.collection("states").insertMany([
    { _id: ALICE, blob: new Binary(randomBytes(3000)), updatedAt: new Date() },
    { _id: BOB, blob: new Binary(randomBytes(3000)), updatedAt: new Date() }
  ]);
  await db.collection("follows").insertOne({ followerId: BOB, followeeId: ALICE, createdAt: new Date() });
  // Enough incompressible bytes that a 16 KB part size makes several parts.
  await db.collection("posts").insertMany(
    Array.from({ length: 40 }, (_, n) => ({
      userId: n % 2 ? ALICE : BOB,
      createdAt: new Date(Date.now() - n * 1000),
      text: `Post ${n}: "quoted", line\nbreak, ünïcode 📚`,
      price: Decimal128.fromString("1.10"),
      uuid: new UUID(),
      noise: new Binary(randomBytes(1500)),
      nested: { a: [1, { b: null, c: [] }], d: { e: { f: true } } },
      pattern: /ab+c/i,
      tags: n % 3 ? ["a", "b"] : []
    }))
  );
  await db.collection("settings").insertOne({ _id: "public", on: true, changedAt: new Date() });
  await db.createCollection("clubs"); // an empty collection is restored as one
}

before(async () => {
  client = new MongoClient(uri);
  await client.connect();
  source = client.db(SOURCE);
  await seed(source);
  dir = mkdtempSync(join(tmpdir(), "leaflet-backup-test-"));
  keys = keygen(join(dir, "keys", "backup-private.pem"), { bits: 2048 });
  otherKeys = keygen(join(dir, "keys", "other-private.pem"), { bits: 2048 });
  receiver = fakeReceiver(SECRET);
  await new Promise((resolve) => receiver.server.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${receiver.server.address().port}/macros/s/AKfycbTESTDEPLOYMENTID1234567890/exec`;
});

after(async () => {
  receiver?.server.close();
  for (const name of [SOURCE, ...restoredNames]) {
    await client.db(name).dropDatabase().catch(() => {});
  }
  await client?.close();
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the receiver's rules", () => {
  test("are the same in rules.js and backup-receiver.gs", () => {
    const block = (text) => {
      const start = text.indexOf("// ---- rules: begin");
      const end = text.indexOf("// ---- rules: end ----");
      assert.ok(start >= 0 && end > start, "the rules markers are there");
      return text.slice(start, end);
    };
    const js = readFileSync(join(serverDir, "src", "backup", "rules.js"), "utf8").replace(/\r\n/g, "\n");
    const gs = readFileSync(join(serverDir, "deploy", "backup-receiver.gs"), "utf8").replace(/\r\n/g, "\n");
    assert.equal(block(gs), block(js), "paste the rules block of rules.js over the one in backup-receiver.gs");
  });

  test("names", () => {
    assert.equal(rules.isBackupName("leaflet-2026-10-17T0330Z"), true);
    assert.equal(rules.backupName(new Date("2026-10-17T03:30:59.999Z")), "leaflet-2026-10-17T0330Z");
    for (const bad of ["leaflet-2026-02-30T0330Z", "leaflet-2026-10-17T2460Z", "leaflet-2026-10-17T0330", "../leaflet-2026-10-17T0330Z", "", null, 5]) {
      assert.equal(rules.isBackupName(bad), false, String(bad));
    }
    assert.equal(rules.partName(7), "part-007");
    assert.equal(rules.isPartNumber(499), true);
    assert.equal(rules.isPartNumber(500), false);
    assert.equal(rules.isPartNumber(1.5), false);
  });

  test("parts are base64 of at most 12 MB", () => {
    assert.equal(rules.decodedLength(Buffer.from("hello").toString("base64")), 5);
    assert.equal(rules.decodedLength("not base64!"), -1);
    assert.equal(rules.decodedLength(""), -1);
    assert.equal(rules.decodedLength(Buffer.alloc(12 * 1024 * 1024).toString("base64")), 12 * 1024 * 1024);
    assert.equal(rules.decodedLength(Buffer.alloc(12 * 1024 * 1024 + 3).toString("base64")), -1);
  });

  test("KEEP_DAYS is 14 unless set, and never more than 30", () => {
    assert.equal(rules.keepDays(null), 14);
    assert.equal(rules.keepDays("abc"), 14);
    assert.equal(rules.keepDays("0"), 14);
    assert.equal(rules.keepDays("7"), 7);
    assert.equal(rules.keepDays("90"), 30);
  });

  test("what goes to the bin", () => {
    const now = Date.UTC(2026, 9, 17);
    const at = (days, complete = true, name = `b${days}`) => ({ name, created: now - days * DAY, complete });
    // Daily backups for 20 days: the ones older than 14 days go.
    const daily = Array.from({ length: 20 }, (_, n) => at(n + 0.5));
    assert.deepEqual(rules.toTrash(daily, now, 14).sort(), ["b14.5", "b15.5", "b16.5", "b17.5", "b18.5", "b19.5"].sort());
    // Backups stopped 20 days ago: the 3 newest stay whatever KEEP_DAYS says...
    assert.deepEqual(rules.toTrash([at(20), at(21), at(22), at(23)], now, 14), ["b23"]);
    // ...but nothing stays past 30 days, the newest included.
    assert.deepEqual(rules.toTrash([at(31), at(32), at(40)], now, 14).sort(), ["b31", "b32", "b40"]);
    assert.deepEqual(rules.toTrash([at(29), at(31)], now, 30), ["b31"]);
    // Incomplete ones go after 2 days, and do not count among the 3 newest.
    assert.deepEqual(rules.toTrash([at(1, false), at(3, false), at(20), at(21), at(22)], now, 14), ["b3"]);
  });

  test("stale after 36 hours, and at most 6 new backups a day", () => {
    const now = Date.UTC(2026, 9, 17);
    assert.equal(rules.isStale([], now), true);
    assert.equal(rules.isStale([{ name: "a", created: now - 35 * 60 * 60 * 1000, complete: true }], now), false);
    assert.equal(rules.isStale([{ name: "a", created: now - 37 * 60 * 60 * 1000, complete: true }], now), true);
    assert.equal(rules.isStale([{ name: "a", created: now - 60 * 1000, complete: false }], now), true);
    const recent = Array.from({ length: 6 }, (_, n) => ({ name: `r${n}`, created: now - n * 60 * 60 * 1000, complete: true }));
    assert.equal(rules.mayStart(recent.slice(0, 5), now), true);
    assert.equal(rules.mayStart(recent, now), false);
  });
});

describe("a backup and a restore", () => {
  test("round trip: every collection comes back exactly, types and all", async () => {
    backup = await runBackup({ db: source, dbName: SOURCE, publicKey: loadPublicKey(keys.publicPath), target: quick(), partSize: 16 * 1024 });
    assert.ok(backup.parts >= 4, `${backup.parts} parts`);
    assert.equal(backup.counts.posts, 40);
    assert.equal(backup.counts.clubs, 0);
    assert.ok(receiver.backups.get(backup.name).complete);
    downloaded = receiver.download(backup.name, join(dir, "drive"));

    const listed = await restore({ input: downloaded, keyPath: keys.privatePath, list: true });
    assert.equal(listed.header.leafletBackup, 1);
    assert.equal(listed.header.db, SOURCE);
    assert.deepEqual(listed.trailer.collections, backup.counts);

    const into = target("round");
    const lines = [];
    const done = await restore({ input: downloaded, keyPath: keys.privatePath, uri, dbName: into, log: (line) => lines.push(line) });
    assert.deepEqual(done.restored, backup.counts);
    assert.ok(lines.some((line) => /restored into/.test(line)));
    assert.deepEqual(await contents(into), await contents(SOURCE));
  });

  test("the folder above the backup's, or the parts put together in one file, restore too", async () => {
    const one = join(dir, "whole.lfbk");
    const files = [...receiver.backups.get(backup.name).parts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part.bytes);
    writeFileSync(one, Buffer.concat(files));
    const listed = await restore({ input: one, keyPath: keys.privatePath, list: true });
    assert.deepEqual(listed.trailer.collections, backup.counts);
    const above = await restore({ input: join(dir, "drive"), keyPath: keys.privatePath, list: true });
    assert.equal(above.header.at, listed.header.at);
  });

  test("a changed byte is refused, by the sha256 and, without the manifest, by the encryption tag", async () => {
    const copy = join(dir, "tampered");
    cpSync(downloaded, copy, { recursive: true });
    const file = join(copy, "part-001");
    const bytes = readFileSync(file);
    bytes[100] ^= 1;
    writeFileSync(file, bytes);
    const into = target("tampered");
    await assert.rejects(restore({ input: copy, keyPath: keys.privatePath, uri, dbName: into }), (error) => error instanceof BackupError && /sha256/.test(error.message));
    unlinkSync(join(copy, "manifest.json"));
    await assert.rejects(restore({ input: copy, keyPath: keys.privatePath, uri, dbName: into }), (error) => error instanceof BackupError && /encryption check|gzip|damaged/.test(error.message));
    const names = (await client.db(into).listCollections().toArray()).map((info) => info.name);
    assert.deepEqual(names, [], "nothing was written");
  });

  test("a missing part is refused", async () => {
    const copy = join(dir, "missing");
    cpSync(downloaded, copy, { recursive: true });
    unlinkSync(join(copy, "part-001"));
    await assert.rejects(restore({ input: copy, keyPath: keys.privatePath, list: true }), /part-001 is missing/);
    // The last part, with no manifest to say how many there were.
    const last = join(dir, "missing-last");
    cpSync(downloaded, last, { recursive: true });
    unlinkSync(join(last, "manifest.json"));
    unlinkSync(join(last, rules.partName(backup.parts - 1)));
    await assert.rejects(restore({ input: last, keyPath: keys.privatePath, list: true }), (error) => error instanceof BackupError);
  });

  test("the wrong key is refused", async () => {
    await assert.rejects(restore({ input: downloaded, keyPath: otherKeys.privatePath, list: true }), /does not open this backup/);
  });

  test("a database that has collections is refused, unless --replace", async () => {
    const into = target("busy");
    await client.db(into).collection("leftover").insertOne({ x: 1 });
    await assert.rejects(restore({ input: downloaded, keyPath: keys.privatePath, uri, dbName: into }), /already has 1 collection.*--replace/);
    await restore({ input: downloaded, keyPath: keys.privatePath, uri, dbName: into, replace: true });
    assert.deepEqual(await contents(into), await contents(SOURCE));
  });

  test("--db leaflet is refused without --yes-production, and the CLI says so in one line", async () => {
    await assert.rejects(restore({ input: downloaded, keyPath: keys.privatePath, uri, dbName: "leaflet" }), /--yes-production/);
    const ran = await run(process.execPath, ["src/backup/restore.js", "--in", downloaded, "--key", keys.privatePath, "--db", "leaflet"], { cwd: serverDir }).catch((error) => error);
    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /^restore refused: .*--yes-production.*\n$/);
  });

  test("--deletions-from deletes again, in the restored copy, an account deleted after the backup", async () => {
    await deleteAccount(source, ALICE);
    const live = await source.collection("deletions").findOne({ _id: ALICE });
    assert.deepEqual(Object.keys(live).sort(), ["_id", "at"]);
    const into = target("deletions");
    const lines = [];
    const done = await restore({ input: downloaded, keyPath: keys.privatePath, uri, dbName: into, deletionsFrom: uri, deletionsDb: SOURCE, log: (line) => lines.push(line) });
    assert.equal(done.redeleted, 1);
    assert.ok(lines.some((line) => /deleted again 1 account/.test(line)));
    const restored = client.db(into);
    assert.equal(await restored.collection("accounts").countDocuments({ _id: ALICE }), 0);
    assert.equal(await restored.collection("profiles").countDocuments({ _id: ALICE }), 0);
    assert.equal(await restored.collection("states").countDocuments({ _id: ALICE }), 0);
    assert.equal(await restored.collection("posts").countDocuments({ userId: ALICE }), 0);
    assert.equal(await restored.collection("follows").countDocuments({}), 0);
    assert.equal(await restored.collection("accounts").countDocuments({ _id: BOB }), 1);
    assert.equal(await restored.collection("posts").countDocuments({ userId: BOB }), 20);
    // The restored copy remembers the deletion too, with its first date.
    assert.deepEqual((await restored.collection("deletions").findOne({ _id: ALICE })).at, live.at);
  });
});

describe("sending a backup", () => {
  test("a wrong secret is refused at once, and the message has neither the secret nor the whole URL", async () => {
    const wrong = "wrong-secret-" + randomBytes(8).toString("hex");
    const before = receiver.backups.size;
    const error = await runBackup({ db: source, publicKey: loadPublicKey(keys.publicPath), target: quick(wrong), partSize: 16 * 1024 }).catch((e) => e);
    assert.ok(error instanceof BackupError);
    assert.match(error.message, /refused the secret/);
    assert.ok(!error.message.includes(wrong) && !error.message.includes("TESTDEPLOYMENTID"));
    assert.equal(receiver.backups.size, before, "nothing was stored");
    assert.equal(shortUrl(receiverUrl).includes("TESTDEPLOYMENTID"), false);
  });

  test("a receiver that cannot be reached fails with one line, after its tries", async () => {
    const nowhere = appsScriptTarget({ url: "http://127.0.0.1:9/macros/s/AKfycbNOWHERE1234567890/exec", secret: SECRET, tries: 2, backoffMs: 1 });
    const error = await runBackup({ db: source, publicKey: loadPublicKey(keys.publicPath), target: nowhere }).catch((e) => e);
    assert.ok(error instanceof BackupError);
    assert.match(error.message, /gave up after 2 tries/);
    assert.ok(!error.message.includes(SECRET) && !error.message.includes("NOWHERE"));
  });

  test("--out writes the same folder as Drive's, and it restores", async () => {
    const out = folderTarget(join(dir, "out"));
    const sent = await runBackup({ db: source, dbName: SOURCE, publicKey: loadPublicKey(keys.publicPath), target: out, partSize: 16 * 1024, now: new Date(Date.now() + 60_000) });
    assert.ok(existsSync(join(out.folder, "manifest.json")));
    const listed = await restore({ input: out.folder, keyPath: keys.privatePath, list: true });
    assert.deepEqual(listed.trailer.collections, sent.counts);
  });
});

describe("keys", () => {
  test("keygen refuses to overwrite, writes the .pub beside the key, and the server refuses a private key", () => {
    assert.ok(existsSync(join(dir, "keys", "backup-private.pub")));
    assert.match(readFileSync(keys.publicPath, "utf8"), /BEGIN PUBLIC KEY/);
    assert.throws(() => keygen(keys.privatePath, { bits: 2048 }), /already exists/);
    assert.throws(() => loadPublicKey(keys.privatePath), /PRIVATE key/);
    assert.ok(loadPrivateKey(keys.privatePath));
  });
});
