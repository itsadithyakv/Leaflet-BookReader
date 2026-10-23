import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { Binary, ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { accounts, close, connect, libraries, profiles, states } from "../src/db.js";
import { DORMANT_DEFAULTS, dormantPolicyFromEnv, mailDay, noteSeen, sweepDormant, useDormantPolicy } from "../src/dormant.js";

/**
 * Accounts nobody uses (sync audit C6): off by default; on, a year unused
 * brings one email, and the sync state and shared library go only after the
 * day it named. Against a throwaway local database
 * (TEST_MONGO_URI, default mongodb://127.0.0.1:27017).
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;
const quiet = { warn: () => {} };

let db;
let server;
let base;

before(async () => {
  db = await connect(uri, dbName);
  const app = createApp(db, {
    limits: {
      ip: { limit: 1000, windowMs: 15 * MINUTE },
      email: { limit: 1000, windowMs: 15 * MINUTE },
      signup: { limit: 1000, windowMs: 60 * MINUTE }
    }
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  useDormantPolicy(DORMANT_DEFAULTS);
  await new Promise((resolve) => server.close(resolve));
  await db.dropDatabase();
  await close();
});

beforeEach(() => useDormantPolicy({ enabled: true }));

async function call(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** An account made long ago and last used `idleDays` before `now`, holding a state and, if asked, a library. */
async function idleAccount(now, idleDays, { state = true, library = false } = {}) {
  const _id = new ObjectId();
  await accounts(db).insertOne({ _id, email: `idle-${_id.toHexString()}@example.com`, createdAt: new Date(now - 900 * DAY), lastSeenAt: new Date(now - idleDays * DAY) });
  if (state) await states(db).insertOne({ _id, state: new Binary(Buffer.from("x")), version: 3, updatedAt: new Date(now - idleDays * DAY) });
  if (library) await libraries(db).insertOne({ _id, books: [], updatedAt: new Date(now - idleDays * DAY) });
  await profiles(db).insertOne({ _id, handle: `idle${_id.toHexString().slice(-8)}`, visibility: "private" });
  return _id;
}

function recordingMailer() {
  const sent = [];
  const mailer = async (message) => {
    sent.push(message);
  };
  return { sent, mailer };
}

describe("dormant accounts", () => {
  test("are left alone unless the owner turns the policy on", async () => {
    assert.equal(dormantPolicyFromEnv({}).enabled, false);
    assert.equal(dormantPolicyFromEnv({ DORMANT_ACCOUNTS: "yes" }).enabled, false);
    assert.equal(dormantPolicyFromEnv({ DORMANT_ACCOUNTS: "on" }).enabled, true);
    assert.equal(dormantPolicyFromEnv({ DORMANT_MONTHS: "2" }).months, 12, "below six months is not taken");
    useDormantPolicy(DORMANT_DEFAULTS);
    const now = new Date();
    const id = await idleAccount(now.getTime(), 800);
    const { sent, mailer } = recordingMailer();
    assert.deepEqual(await sweepDormant(db, { mailer, now, log: quiet }), { started: 0, removed: 0, warned: 0, cleared: 0, unsent: 0 });
    assert.equal(sent.length, 0);
    assert.ok(await states(db).findOne({ _id: id }), "nothing removed while off");

    // Nor is anything recorded about use while it is off.
    const email = `off-${randomBytes(4).toString("hex")}@example.com`;
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: "correct horse battery" } });
    assert.equal(made.status, 201);
    assert.equal((await accounts(db).findOne({ email })).lastSeenAt, undefined);
  });

  test("a sign-in notes the account as used, and the first sweep starts every other clock at today", async () => {
    const email = `on-${randomBytes(4).toString("hex")}@example.com`;
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: "correct horse battery" } });
    assert.equal(made.status, 201);
    assert.ok((await accounts(db).findOne({ email })).lastSeenAt instanceof Date);

    const old = new ObjectId();
    await accounts(db).insertOne({ _id: old, email: `old-${old.toHexString()}@example.com`, createdAt: new Date(Date.now() - 1000 * DAY) });
    await states(db).insertOne({ _id: old, state: new Binary(Buffer.from("x")), version: 1, updatedAt: new Date(Date.now() - 1000 * DAY) });
    const now = new Date();
    const { sent, mailer } = recordingMailer();
    const counts = await sweepDormant(db, { mailer, now, log: quiet });
    assert.ok(counts.started >= 1);
    assert.equal((await accounts(db).findOne({ _id: old })).lastSeenAt.getTime(), now.getTime(), "judged from today, not from when it was made");
    assert.ok(!sent.some((message) => message.to.startsWith("old-")), "no warning on a clock that was not running");
  });

  test("a year unused brings one email; the state and library go only once the day it names has passed", async () => {
    const start = Date.now();
    const id = await idleAccount(start, 400, { library: true });
    const { sent, mailer } = recordingMailer();
    const now = new Date(start);
    const first = await sweepDormant(db, { mailer, now, log: quiet });
    assert.ok(first.warned >= 1);
    const mine = sent.filter((message) => message.to === `idle-${id.toHexString()}@example.com`);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].kind, "dormant");
    assert.equal(mine[0].removeOn, mailDay(new Date(start + 60 * DAY)));
    assert.match(mine[0].removeOn, /^\d{1,2} [A-Z][a-z]+ \d{4}$/, "the date as the script checks it");

    // The next day: not warned again, nothing gone.
    await sweepDormant(db, { mailer, now: new Date(start + DAY), log: quiet });
    assert.equal(sent.filter((message) => message.to === mine[0].to).length, 1);
    assert.ok(await states(db).findOne({ _id: id }));

    // The day named: the sync state and the library go, the rest stays.
    const later = await sweepDormant(db, { mailer, now: new Date(start + 60 * DAY + 1), log: quiet });
    assert.ok(later.removed >= 1);
    assert.equal(await states(db).findOne({ _id: id }), null);
    assert.equal(await libraries(db).findOne({ _id: id }), null);
    const account = await accounts(db).findOne({ _id: id });
    assert.ok(account, "the account stays");
    assert.ok(account.dormantClearedAt instanceof Date);
    assert.equal(account.dormantWarnedAt, undefined);
    assert.ok(await profiles(db).findOne({ _id: id }), "the profile stays");
    // Cleared: never warned again for the same idleness.
    await sweepDormant(db, { mailer, now: new Date(start + 61 * DAY), log: quiet });
    assert.equal(sent.filter((message) => message.to === mine[0].to).length, 1);
  });

  test("using the account after the email calls the removal off", async () => {
    const start = Date.now();
    const id = await idleAccount(start, 400);
    const { mailer } = recordingMailer();
    await sweepDormant(db, { mailer, now: new Date(start), log: quiet });
    assert.ok((await accounts(db).findOne({ _id: id })).dormantWarnedAt instanceof Date);

    await noteSeen(db, id, new Date(start + 10 * DAY));
    const seen = await accounts(db).findOne({ _id: id });
    assert.equal(seen.dormantWarnedAt, undefined);
    assert.equal(seen.dormantRemoveAfter, undefined);

    await sweepDormant(db, { mailer, now: new Date(start + 61 * DAY), log: quiet });
    assert.ok(await states(db).findOne({ _id: id }), "kept: the reader came back");
  });

  test("with no mailer, or one that refuses the message, nobody is warned and so nothing is removed", async () => {
    const start = Date.now();
    const id = await idleAccount(start, 500);
    assert.equal((await sweepDormant(db, { mailer: null, now: new Date(start), log: quiet })).warned, 0);
    const refusing = async () => {
      throw new Error("mailer refused: bad request");
    };
    const counts = await sweepDormant(db, { mailer: refusing, now: new Date(start), log: quiet });
    assert.equal(counts.warned, 0);
    assert.equal(counts.unsent, 1, "one try, then none more that day");
    await sweepDormant(db, { mailer: null, now: new Date(start + 400 * DAY), log: quiet });
    assert.ok(await states(db).findOne({ _id: id }));
    assert.equal((await accounts(db).findOne({ _id: id })).dormantWarnedAt, undefined);
  });

  test("an idle account with nothing here to remove gets no email", async () => {
    const start = Date.now();
    const id = await idleAccount(start, 500, { state: false });
    const { sent, mailer } = recordingMailer();
    await sweepDormant(db, { mailer, now: new Date(start), log: quiet });
    assert.equal(sent.filter((message) => message.to === `idle-${id.toHexString()}@example.com`).length, 0);
    assert.ok((await accounts(db).findOne({ _id: id })).dormantClearedAt instanceof Date);
  });

  test("no more warnings a day than the policy allows", async () => {
    useDormantPolicy({ enabled: true, mailPerDay: 2 });
    const start = Date.now();
    for (let index = 0; index < 4; index += 1) {
      await idleAccount(start, 450);
    }
    const { sent, mailer } = recordingMailer();
    const counts = await sweepDormant(db, { mailer, now: new Date(start), log: quiet });
    assert.equal(counts.warned, 2);
    assert.equal(sent.length, 2);
  });

  test("a reader back after the removal syncs again from their device", async () => {
    const email = `back-${randomBytes(4).toString("hex")}@example.com`;
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: "correct horse battery" } });
    const { token } = made.body;
    const id = new ObjectId(made.body.account.id);
    assert.equal((await call("PUT", "/v1/state", { token, body: { version: 0, state: Buffer.from("first").toString("base64") } })).status, 200);
    // What the sweep leaves of an account it cleared.
    await states(db).deleteOne({ _id: id });
    await accounts(db).updateOne({ _id: id }, { $set: { dormantClearedAt: new Date() } });

    const pulled = await call("GET", "/v1/state", { token });
    assert.deepEqual(pulled.body, { version: 0, state: null });
    const pushed = await call("PUT", "/v1/state", { token, body: { version: 0, state: Buffer.from("again").toString("base64") } });
    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.version, 1);
  });
});
