import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { hashToken } from "../src/auth.js";
import { noteBackup } from "../src/backup/note.js";
import { accounts, close, connect, errorKinds, meta, sessions } from "../src/db.js";
import { DORMANT_DEFAULTS, useDormantPolicy } from "../src/dormant.js";
import { forgetTodaysKinds, scrubFrame, scrubText, signatureOf } from "../src/errorKinds.js";
import { RequestStats, clientOf, percentile } from "../src/metrics.js";

/**
 * The owner's admin page, server side: the overview (readers, versions,
 * what waits, the database's size, this server's own requests), the error
 * kinds apps send by themselves, and the announcements that ride on the
 * update notice. Against a throwaway database (TEST_MONGO_URI, default
 * mongodb://127.0.0.1:27017) dropped afterwards. Three apps on it: one with
 * room for everything, one that takes two new error kinds a day, and one
 * that lets an address send two batches.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery";

let db;
const servers = [];
let base;
let fewKinds;
let tight;

const roomy = (windowMs) => ({ limit: 100_000, windowMs });
const limits = {
  ip: roomy(15 * MINUTE),
  email: roomy(15 * MINUTE),
  signup: roomy(60 * MINUTE),
  social: roomy(15 * MINUTE),
  errors: roomy(HOUR)
};

const listen = async (app) => {
  const server = await new Promise((resolve) => {
    const made = app.listen(0, "127.0.0.1", () => resolve(made));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

before(async () => {
  db = await connect(uri, dbName);
  base = await listen(createApp(db, { limits }));
  fewKinds = await listen(createApp(db, { limits: { ...limits, errorKindsPerDay: 2 } }));
  tight = await listen(createApp(db, { limits: { ...limits, errors: { limit: 2, windowMs: HOUR } } }));
});

after(async () => {
  useDormantPolicy(DORMANT_DEFAULTS);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await db.dropDatabase();
  await close();
});

async function call(method, path, { token, body, raw, headers: extra = {}, to = base } = {}) {
  const headers = { ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  const sent = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await fetch(to + path, { method, headers, body: sent });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

async function reader({ role } = {}) {
  const email = `a-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const id = new ObjectId(signup.body.account.id);
  const handle = `a${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", { token, body: { handle } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  if (role) await db.collection("profiles").updateOne({ _id: id }, { $set: { role } });
  return { token, id, email };
}

/**
 * An account last used `daysAgo` with a session whose hourly refresh is due,
 * so that its next request notes the day it was used (`dormant.js`).
 */
async function returningReader(daysAgo) {
  const now = Date.now();
  // Made long ago: an account's id carries the time it was made.
  const bytes = Buffer.from(new ObjectId().id);
  bytes.writeUInt32BE(Math.floor((now - 400 * DAY) / 1000), 0);
  const _id = new ObjectId(bytes);
  await accounts(db).insertOne({ _id, email: `r-${_id.toHexString()}@example.com`, createdAt: new Date(now - 400 * DAY), lastSeenAt: new Date(now - daysAgo * DAY) });
  const token = randomBytes(32).toString("base64url");
  await sessions(db).insertOne({ _id: hashToken(token), userId: _id, createdAt: new Date(now - 2 * DAY), lastUsedAt: new Date(now - 2 * HOUR), expiresAt: new Date(now + 30 * DAY) });
  return { _id, token };
}

const kind = (message, extra = {}) => ({ name: "TypeError", message, frames: ["openBook@assets/LibraryPage-Dx81aQzz.js:1:2345"], count: 1, ...extra });
const batch = (kinds, extra = {}) => ({ version: "1.5.12", platform: "android", kinds, ...extra });

describe("what the app says it is", () => {
  test("is a version and a platform, or nothing", () => {
    assert.deepEqual(clientOf("1.5.12; android"), { version: "1.5.12", platform: "android" });
    assert.deepEqual(clientOf(" 1.5.12 ;Windows"), { version: "1.5.12", platform: "windows" });
    for (const bad of [undefined, "", "1.5.12", "leaflet; android", "1.5.12; ios", "1.5.12; android; extra-long-".repeat(3)]) {
      assert.equal(clientOf(bad), null, String(bad));
    }
  });
});

describe("the server's own counts", () => {
  test("keep the last 24 hours in hourly buckets and each route, from memory", () => {
    const start = Date.UTC(2026, 9, 23, 10, 30);
    const stats = new RequestStats(start);
    for (let index = 0; index < 90; index += 1) stats.record("GET /v1/state", 200, 8, start);
    for (let index = 0; index < 10; index += 1) stats.record("PUT /v1/state", 500, 900, start);
    stats.record("GET /v1/state", 200, 40, start + 3 * HOUR);
    // An hour more than a day old has fallen out.
    stats.record("GET /old", 200, 1, start - 30 * HOUR);
    const summary = stats.summary(start + 3 * HOUR);
    assert.equal(summary.hours.length, 24);
    assert.equal(summary.day.requests, 101);
    assert.equal(summary.day.failed, 10);
    assert.equal(summary.day.p50, 10);
    assert.equal(summary.day.p95, 1000);
    assert.equal(summary.uptimeSeconds, 3 * 60 * 60);
    assert.equal(summary.hours.at(-1).requests, 1);
    assert.equal(summary.hours.at(-4).requests, 100);
    assert.equal(summary.busiest[0].route, "GET /v1/state");
    assert.equal(summary.slowest[0].route, "PUT /v1/state");
    assert.equal(summary.slowest[0].failed, 10);
    assert.equal(percentile([0, 0, 0], 0.5), null);
  });
});

describe("the overview", () => {
  beforeEach(() => useDormantPolicy({ seen: true }));

  test("is the owner's alone: anyone else is told there is no such route", async () => {
    const me = await reader();
    const missing = await call("GET", "/v1/no-such-route", { token: me.token });
    for (const [method, path] of [
      ["GET", "/v1/admin/overview"],
      ["GET", "/v1/admin/errors"],
      ["POST", `/v1/admin/errors/${"a".repeat(32)}`],
      ["GET", "/v1/admin/announcements"],
      ["POST", "/v1/admin/announcements"],
      ["DELETE", "/v1/admin/announcements/0123456789ab"]
    ]) {
      const tried = await call(method, path, { token: me.token, body: method === "GET" || method === "DELETE" ? undefined : {} });
      assert.equal(tried.status, 404, `${method} ${path}`);
      assert.deepEqual(tried.body, missing.body);
      assert.equal((await call(method, path)).status, 401, `${method} ${path} signed out`);
    }
  });

  test("counts readers by the day they last used Leaflet, and the apps they used it from", async () => {
    const owner = await reader({ role: "admin" });
    const back = await returningReader(3);
    const away = await returningReader(20);
    await returningReader(45);
    // Their next request notes today, with the app's version and platform, once.
    const header = { "x-leaflet-client": "1.5.12; android" };
    assert.equal((await call("GET", "/v1/profile/me", { token: back.token, headers: header })).status, 200);
    assert.equal((await call("GET", "/v1/profile/me", { token: away.token, headers: { "x-leaflet-client": "nonsense" } })).status, 200);
    const noted = await accounts(db).findOne({ _id: back._id });
    assert.deepEqual(noted.client, { version: "1.5.12", platform: "android" });
    assert.ok(Date.now() - noted.lastSeenAt.getTime() < MINUTE);
    assert.equal((await accounts(db).findOne({ _id: away._id })).client, undefined, "a header that is not one is not kept");
    for (let index = 0; index < 3; index += 1) {
      await call("GET", "/v1/profile/me", { token: back.token, headers: header });
    }
    assert.equal((await accounts(db).findOne({ _id: back._id })).lastSeenAt.getTime(), noted.lastSeenAt.getTime(), "once a day");

    const seen = await call("GET", "/v1/admin/overview", { token: owner.token });
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    const { readers, queues, storage, server } = seen.body;
    assert.ok(readers.accounts >= 5);
    assert.ok(readers.newThisWeek >= 1, "the owner's own account is new");
    assert.ok(readers.newThisWeek < readers.accounts, "the old ones are not");
    assert.ok(readers.activeToday >= 2);
    assert.ok(readers.active30 >= readers.active7 && readers.active7 >= readers.activeToday);
    assert.ok(readers.versions.some((row) => row.name === "1.5.12" && row.readers >= 1));
    assert.ok(readers.platforms.some((row) => row.name === "android"));
    assert.equal(typeof queues.openProblems, "number");
    assert.equal(typeof queues.openReports, "number");
    assert.ok(storage === null || storage.quotaBytes === 512 * 1024 * 1024);
    assert.ok(server.uptimeSeconds >= 0);
    assert.ok(server.day.requests >= 3);
    assert.ok(server.busiest.some((row) => row.route === "GET /v1/profile/me"), JSON.stringify(server.busiest));

    // Kept a minute: asked again, the same reading (but the server's counts are of now).
    const again = await call("GET", "/v1/admin/overview", { token: owner.token });
    assert.equal(again.body.at, seen.body.at);
    assert.ok(again.body.server.day.requests > server.day.requests);
  });

  test("says when the last backup went through, and nothing when none has", async () => {
    const owner = await reader({ role: "admin" });
    await meta(db).deleteMany({});
    const none = await call("GET", "/v1/admin/overview", { token: owner.token, to: await listen(createApp(db, { limits })) });
    assert.equal(none.body.backup, null);

    const at = new Date(Date.now() - 3 * HOUR);
    await noteBackup(db, { name: "leaflet-x", counts: { accounts: 3, states: 2 }, documents: 5, parts: 2, size: 3.5 * 1024 * 1024 }, { now: at });
    // One document, written over each night.
    await noteBackup(db, { counts: { accounts: 3, states: 2, profiles: 1 }, documents: 6, parts: 1, size: 1024 * 1024 }, { now: new Date(at.getTime() + 1000), where: "folder" });
    assert.equal(await meta(db).countDocuments({}), 1);
    const seen = await call("GET", "/v1/admin/overview", { token: owner.token, to: await listen(createApp(db, { limits })) });
    assert.deepEqual(seen.body.backup, { at: new Date(at.getTime() + 1000).toISOString(), sizeMB: 1, parts: 1, collections: 3, documents: 6, where: "folder" });
    assert.ok(!JSON.stringify(await meta(db).findOne({})).includes("leaflet-x"), "not the backup's name");
  });

  test("notes nothing about use while neither the dormant policy nor active readers is on", async () => {
    useDormantPolicy(DORMANT_DEFAULTS);
    const back = await returningReader(5);
    await call("GET", "/v1/profile/me", { token: back.token, headers: { "x-leaflet-client": "1.5.12; windows" } });
    const kept = await accounts(db).findOne({ _id: back._id });
    assert.ok(Date.now() - kept.lastSeenAt.getTime() > 4 * DAY);
    assert.equal(kept.client, undefined);
  });
});

describe("error reports", () => {
  beforeEach(() => forgetTodaysKinds());

  test("are scrubbed of anything that could be a reader's", () => {
    const said = scrubText(
      `Failed to open "The Hobbit" from C:\\Users\\Ada\\Books\\hobbit.epub for ada@example.com at https://example.com/x?y=1 (page 214, id 9f8e7d6c5b4a39281706)`
    );
    assert.equal(said, "Failed to open <q> from <path> for <email> at <url> (page #, id <id>)");
    assert.equal(scrubText("ENOENT: no such file /home/ada/Leaflet/Dune.epub"), "ENOENT: no such file <path>");
    assert.equal(scrubText("couldn't read Dune.pdf, ‘Arrakis’ and 'x'"), "couldn't read <file>, <q> and <q>");
    assert.equal(scrubText("It's 'It's here' and the reader's"), "It's <q> and the reader's");
    assert.equal(scrubText("x".repeat(500)).length, 200);
    assert.equal(scrubFrame("openBook@assets/LibraryPage-Dx81aQzz.js:1:2345"), "openBook@assets/LibraryPage.js");
    assert.equal(scrubFrame("a@http://tauri.localhost/assets/index-AbC123xy.js:1:9"), "?@<path>");
    assert.equal(scrubFrame("load@src/readers/text/useBookOpening.ts?t=1729"), "load@readers/text/useBookOpening.ts");
    assert.equal(scrubFrame("panic@sync/cloud.rs:812"), "panic@sync/cloud.rs");
    assert.equal(scrubFrame("x@C:\\Users\\Ada\\Leaflet\\a.js"), "?@<path>");
  });

  test("are counted by kind, version, platform and day, scrubbed again on the server, with nobody's name on them", async () => {
    const me = await reader();
    const sent = await call("POST", "/v1/errors", {
      token: me.token,
      body: batch([
        kind(`Cannot read "Dune" of undefined at /home/ada/Dune.epub`, { count: 2 }),
        kind(`Cannot read "Emma" of undefined at /home/bob/Emma.epub`),
        kind("Load failed 503", { name: "NetworkError", frames: [] })
      ])
    });
    assert.equal(sent.status, 202, JSON.stringify(sent.body));
    const sig = signatureOf({ name: "TypeError", message: "Cannot read <q> of undefined at <path>", frames: ["openBook@assets/LibraryPage.js"] });
    const docs = await errorKinds(db).find({ sig }).toArray();
    assert.equal(docs.length, 1, "two titles, one kind");
    assert.equal(docs[0].count, 3);
    assert.equal(docs[0].message, "Cannot read <q> of undefined at <path>");
    assert.deepEqual(docs[0].frames, ["openBook@assets/LibraryPage.js"]);
    assert.equal(docs[0].platform, "android");
    assert.equal(docs[0].version, "1.5.12");
    const text = JSON.stringify(await errorKinds(db).find({}).toArray());
    for (const secret of ["Dune", "Emma", "ada", me.id.toHexString(), me.email]) {
      assert.ok(!text.includes(secret), secret);
    }

    // The next session's batch adds to the same day's count.
    await call("POST", "/v1/errors", { body: batch([kind(`Cannot read "Persuasion" of undefined at /x/y.epub`)]) });
    assert.equal((await errorKinds(db).findOne({ sig })).count, 4);
  });

  test("are refused when they are not a batch, too many, or too large", async () => {
    assert.equal((await call("POST", "/v1/errors", { body: batch("nope") })).status, 400);
    assert.equal((await call("POST", "/v1/errors", { body: batch([kind("x")], { platform: "ios" }) })).status, 400);
    assert.equal((await call("POST", "/v1/errors", { body: batch([kind("x")], { version: "next" }) })).status, 400);
    const many = Array.from({ length: 21 }, (_, index) => kind(`kind ${String.fromCharCode(65 + index)}`));
    assert.equal((await call("POST", "/v1/errors", { body: batch(many) })).status, 400);
    assert.equal((await call("POST", "/v1/errors", { raw: JSON.stringify(batch([kind("y".repeat(30_000))])) })).status, 413);
    assert.equal((await call("POST", "/v1/errors", { raw: "{not json" })).status, 400);
  });

  test("take so many new kinds a day, and still count the ones they have", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await errorKinds(db).deleteMany({ day });
    forgetTodaysKinds();
    const three = [kind("first kind"), kind("second kind"), kind("third kind")];
    assert.equal((await call("POST", "/v1/errors", { to: fewKinds, body: batch(three.slice(0, 2)) })).status, 202);
    const third = await call("POST", "/v1/errors", { to: fewKinds, body: batch(three) });
    assert.equal(third.status, 202);
    assert.equal(third.body.counted, 2);
    assert.equal(await errorKinds(db).countDocuments({ day }), 2);
    assert.equal(await errorKinds(db).countDocuments({ day, message: "third kind" }), 0);
    assert.equal((await errorKinds(db).findOne({ day, message: "first kind" })).count, 2);
  });

  test("are held to a few batches an hour from one address", async () => {
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await call("POST", "/v1/errors", { to: tight, body: batch([kind("limited")]) })).status, 202);
    }
    const third = await call("POST", "/v1/errors", { to: tight, body: batch([kind("limited")]) });
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get("retry-after")) > 0);
  });

  test("are listed for the owner one row a kind, and a kind fixed in a version is open again when that version has it", async () => {
    const owner = await reader({ role: "admin" });
    const message = `fixable ${randomBytes(3).toString("hex").replace(/\d/g, "x")}`;
    await call("POST", "/v1/errors", { body: batch([kind(message)], { version: "1.5.10", platform: "windows" }) });
    await call("POST", "/v1/errors", { body: batch([kind(message)], { version: "1.5.11" }) });
    const listed = await call("GET", "/v1/admin/errors", { token: owner.token });
    assert.equal(listed.status, 200);
    const row = listed.body.errors.find((entry) => entry.message === message);
    assert.ok(row, JSON.stringify(listed.body));
    assert.equal(row.count, 2);
    assert.deepEqual(row.versions, ["1.5.10", "1.5.11"]);
    assert.deepEqual(row.platforms, ["android", "windows"]);
    assert.ok(row.firstAt <= row.lastAt);
    assert.equal(row.status, "open");

    const fixed = await call("POST", `/v1/admin/errors/${row.sig}`, { token: owner.token, body: { fixedIn: "1.5.12" } });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.ok(!(await call("GET", "/v1/admin/errors", { token: owner.token })).body.errors.some((entry) => entry.sig === row.sig));
    const done = (await call("GET", "/v1/admin/errors?status=fixed", { token: owner.token })).body.errors.find((entry) => entry.sig === row.sig);
    assert.equal(done.fixedIn, "1.5.12");

    // Still seen in an older version: still fixed. Seen in 1.5.12: open again.
    await call("POST", "/v1/errors", { body: batch([kind(message)], { version: "1.5.11" }) });
    assert.equal((await call("GET", "/v1/admin/errors?status=fixed", { token: owner.token })).body.errors.some((entry) => entry.sig === row.sig), true);
    await call("POST", "/v1/errors", { body: batch([kind(message)], { version: "1.5.12" }) });
    const back = (await call("GET", "/v1/admin/errors", { token: owner.token })).body.errors.find((entry) => entry.sig === row.sig);
    assert.equal(back.status, "open");
    assert.equal(back.reopened, true);

    assert.equal((await call("POST", `/v1/admin/errors/${row.sig}`, { token: owner.token, body: { fixedIn: "soon" } })).status, 400);
    assert.equal((await call("POST", `/v1/admin/errors/${"0".repeat(32)}`, { token: owner.token, body: { fixedIn: "1.5.12" } })).status, 404);
    assert.equal((await call("POST", `/v1/admin/errors/${row.sig}`, { token: owner.token, body: { fixedIn: null } })).status, 200);
  });

  test("show in the overview: the kinds of the last week, and each day's count", async () => {
    const owner = await reader({ role: "admin" });
    // A fresh app: the other's overview is kept a minute.
    const fresh = await listen(createApp(db, { limits }));
    const seen = await call("GET", "/v1/admin/overview", { token: owner.token, to: fresh });
    assert.ok(seen.body.queues.errorKinds7 >= 1);
    assert.ok(seen.body.queues.errorDays.some((row) => row.day === new Date().toISOString().slice(0, 10) && row.count > 0));
  });
});

describe("announcements", () => {
  const notice = async () => (await call("GET", "/v1/notice")).body;
  const publish = (token, body) => call("POST", "/v1/admin/announcements", { token, body });

  test("ride on the update notice only when there are any, and may be cached a minute", async () => {
    const asked = await call("GET", "/v1/notice");
    assert.equal(asked.status, 200);
    assert.equal(asked.body.announcements, undefined);
    assert.equal(asked.headers.get("cache-control"), "public, max-age=60");
  });

  test("are published, shown to everybody at once, and withdrawn", async () => {
    const owner = await reader({ role: "admin" });
    const made = await publish(owner.token, {
      title: "  Drive backups need you  ",
      body: "Google changed how Leaflet signs in.\n\n\n\nReconnect Drive and all is well. Sorry!",
      link: { label: "Reconnect", action: "reconnect_drive" },
      audience: { kind: "drive" }
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.match(made.body.id, /^[0-9a-f]{12}$/);
    assert.equal(made.body.title, "Drive backups need you");
    assert.equal(made.body.body, "Google changed how Leaflet signs in.\n\nReconnect Drive and all is well. Sorry!");
    const shown = (await notice()).announcements;
    assert.deepEqual(shown.map((item) => item.id), [made.body.id]);
    assert.deepEqual(shown[0].link, { label: "Reconnect", action: "reconnect_drive" });
    assert.deepEqual(shown[0].audience, { kind: "drive" });

    const listed = await call("GET", "/v1/admin/announcements", { token: owner.token });
    assert.equal(listed.body.announcements[0].live, true);

    const gone = await call("DELETE", `/v1/admin/announcements/${made.body.id}`, { token: owner.token });
    assert.equal(gone.status, 200);
    assert.equal((await notice()).announcements, undefined);
    assert.equal((await call("DELETE", `/v1/admin/announcements/${made.body.id}`, { token: owner.token })).status, 404);
    assert.equal((await call("DELETE", "/v1/admin/announcements/nope", { token: owner.token })).status, 404);
  });

  test("run out on the day set, and only so many are up at once", async () => {
    const owner = await reader({ role: "admin" });
    const soon = await publish(owner.token, { title: "Brief", body: "Gone soon.", expiresAt: new Date(Date.now() + 1500).toISOString() });
    assert.equal(soon.status, 201, JSON.stringify(soon.body));
    assert.ok((await notice()).announcements.some((item) => item.id === soon.body.id));
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.ok(!((await notice()).announcements ?? []).some((item) => item.id === soon.body.id), "run out, though the notice is kept in memory");
    const listed = (await call("GET", "/v1/admin/announcements", { token: owner.token })).body.announcements;
    assert.equal(listed.find((item) => item.id === soon.body.id).live, false);

    const ids = [];
    for (const title of ["One", "Two", "Three"]) {
      const made = await publish(owner.token, { title, body: "Hello." });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      ids.push(made.body.id);
    }
    const fourth = await publish(owner.token, { title: "Four", body: "Too many." });
    assert.equal(fourth.status, 409);
    // The one that ran out was cleared away on the way.
    const kept = (await call("GET", "/v1/admin/announcements", { token: owner.token })).body.announcements;
    assert.ok(!kept.some((item) => item.id === soon.body.id));
    for (const id of ids) {
      await call("DELETE", `/v1/admin/announcements/${id}`, { token: owner.token });
    }
  });

  test("take a title, a message, an https link or a known action, an audience and an end, and refuse anything else", async () => {
    const owner = await reader({ role: "admin" });
    const good = await publish(owner.token, {
      title: "New in 1.5.12",
      body: "Read more.",
      link: { label: "Read", url: "https://itsadithyakv.github.io/Leaflet-BookReader/" },
      audience: { kind: "below", version: "1.5.12" },
      expiresAt: new Date(Date.now() + 7 * DAY).toISOString()
    });
    assert.equal(good.status, 201, JSON.stringify(good.body));
    assert.deepEqual(good.body.audience, { kind: "below", version: "1.5.12" });
    await call("DELETE", `/v1/admin/announcements/${good.body.id}`, { token: owner.token });

    for (const bad of [
      { body: "No title." },
      { title: "No body" },
      { title: "x".repeat(81), body: "Long title." },
      { title: "Long", body: "x".repeat(601) },
      { title: "Plain http", body: "x", link: { label: "Go", url: "http://example.com" } },
      { title: "A scheme", body: "x", link: { label: "Go", url: "javascript:alert(1)" } },
      { title: "Unknown action", body: "x", link: { label: "Go", action: "delete_library" } },
      { title: "No label", body: "x", link: { url: "https://example.com" } },
      { title: "Odd audience", body: "x", audience: { kind: "ios" } },
      { title: "No version", body: "x", audience: { kind: "below" } },
      { title: "Past", body: "x", expiresAt: new Date(Date.now() - DAY).toISOString() },
      { title: "Far", body: "x", expiresAt: new Date(Date.now() + 400 * DAY).toISOString() }
    ]) {
      assert.equal((await publish(owner.token, bad)).status, 400, JSON.stringify(bad));
    }
  });
});
