import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { accountFootprint } from "../src/deletion.js";
import { DIAGNOSTICS_MAX, FULL, OPEN_MAX, PROBLEMS_PER_DAY } from "../src/routes/problems.js";

/**
 * Problem reports: sent from Settings by anyone, signed in or not, and read
 * by the owner in the app's admin section. Against a throwaway database
 * (TEST_MONGO_URI, default mongodb://127.0.0.1:27017) dropped afterwards.
 * Two apps on it: one with room for every test, and one that lets an
 * address send three, for the per-address limit.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PASSWORD = "correct horse battery";

let db;
const servers = [];
let base;
let tight;

const roomy = (windowMs) => ({ limit: 100_000, windowMs });
const limits = {
  ip: roomy(15 * MINUTE),
  email: roomy(15 * MINUTE),
  signup: roomy(60 * MINUTE),
  social: roomy(15 * MINUTE),
  problems: roomy(DAY)
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
  const three = { ...limits, problems: { limit: 3, windowMs: DAY } };
  tight = await listen(createApp(db, { limits: three }));
});

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await db.dropDatabase();
  await close();
});

async function call(method, path, { token, body, raw, to = base } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  const sent = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await fetch(to + path, { method, headers, body: sent });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function reader({ role, handle = true } = {}) {
  const email = `p-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const id = new ObjectId(signup.body.account.id);
  const name = handle ? `p${randomBytes(4).toString("hex")}` : null;
  if (name) {
    const saved = await call("PUT", "/v1/profile/me", { token, body: { handle: name } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  }
  if (role) await db.collection("profiles").updateOne({ _id: id }, { $set: { role } });
  return { token, id, handle: name, email };
}

const problem = (extra = {}) => ({
  message: "The book would not open.",
  diagnostics: "Leaflet 1.5.7\nRecent log:\n...",
  version: "1.5.7",
  platform: "windows",
  ...extra
});

const send = (body, options = {}) => call("POST", "/v1/problems", { body, ...options });
const stored = (id) => db.collection("problems").findOne({ _id: new ObjectId(id) });

describe("sending a problem report", () => {
  test("works signed out, keeps an address for a reply, and nothing of who sent it", async () => {
    const sent = await send(problem({ contact: "  Tester@Example.COM " }));
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const doc = await stored(sent.body.id);
    assert.deepEqual(
      Object.keys(doc).sort(),
      ["_id", "at", "contact", "diagnostics", "message", "platform", "status", "version"]
    );
    assert.equal(doc.contact, "tester@example.com");
    assert.equal(doc.status, "open");
    assert.ok(doc.at instanceof Date && Date.now() - doc.at < MINUTE);
    // No address given, none kept.
    const bare = await send(problem({ diagnostics: undefined }));
    assert.equal(bare.status, 201);
    const plain = await stored(bare.body.id);
    assert.equal(plain.contact, undefined);
    assert.equal(plain.diagnostics, null);
  });

  test("signed in, names the account and its handle, and ignores an address", async () => {
    const me = await reader();
    const body = problem({ contact: "not even an address", platform: "android" });
    const sent = await send(body, { token: me.token });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const doc = await stored(sent.body.id);
    assert.ok(doc.accountId.equals(me.id));
    assert.equal(doc.handle, me.handle);
    assert.equal(doc.contact, undefined);
    assert.equal(doc.platform, "android");
    // An account with no profile yet: the account, and no handle.
    const nameless = await reader({ handle: false });
    const theirs = await stored((await send(problem(), { token: nameless.token })).body.id);
    assert.ok(theirs.accountId.equals(nameless.id));
    assert.equal(theirs.handle, null);
  });

  test("takes the words it should and refuses the rest, saying which", async () => {
    for (const [extra, field] of [
      [{ message: undefined }, "message"],
      [{ message: "   \n  " }, "message"],
      [{ message: 7 }, "message"],
      [{ message: "x".repeat(2001) }, "message"],
      [{ diagnostics: "x".repeat(DIAGNOSTICS_MAX + 1) }, "diagnostics"],
      [{ diagnostics: { log: "x" } }, "diagnostics"],
      [{ version: "v1.5.7" }, "version"],
      [{ version: undefined }, "version"],
      [{ platform: "ios" }, "platform"],
      [{ contact: "nobody" }, "email"]
    ]) {
      const refused = await send(problem(extra));
      assert.equal(refused.status, 400, JSON.stringify(extra).slice(0, 80));
      assert.match(refused.body.error, new RegExp(field), JSON.stringify(refused.body));
    }
    // At the caps, taken whole.
    const fullest = { message: "y".repeat(2000), diagnostics: "z".repeat(DIAGNOSTICS_MAX) };
    const longest = await send(problem(fullest));
    assert.equal(longest.status, 201, JSON.stringify(longest.body));
    const doc = await stored(longest.body.id);
    assert.equal(doc.message.length, 2000);
    assert.equal(doc.diagnostics.length, DIAGNOSTICS_MAX);
    // Far past them, the body is not read at all.
    const raw = JSON.stringify(problem({ diagnostics: "z".repeat(400_000) }));
    const huge = await call("POST", "/v1/problems", { raw });
    assert.equal(huge.status, 413);
  });

  test("strips control characters, keeping the lines and tabs of a log", async () => {
    const sent = await send(
      problem({
        message: "It \u0007beeped\r\nand then\u0000 stopped",
        diagnostics: "\u001b[31mred\u001b[0m\r\ncol\tcol\n  indented"
      })
    );
    assert.equal(sent.status, 201);
    const doc = await stored(sent.body.id);
    assert.equal(doc.message, "It beeped\nand then stopped");
    assert.equal(doc.diagnostics, "[31mred[0m\ncol\tcol\n  indented");
  });

  test("writes nothing it was told to the log", async () => {
    const said = [];
    const kept = { log: console.log, error: console.error, warn: console.warn };
    for (const name of Object.keys(kept)) console[name] = (...args) => said.push(args.join(" "));
    try {
      assert.equal((await send(problem({ message: "secret-words-here" }))).status, 201);
      assert.equal((await send(problem({ message: "" }))).status, 400);
    } finally {
      Object.assign(console, kept);
    }
    assert.ok(!said.some((line) => line.includes("secret-words")), said.join("\n"));
  });

  test(`takes ${PROBLEMS_PER_DAY} a day from one account`, async () => {
    const me = await reader();
    for (let sent = 0; sent < PROBLEMS_PER_DAY; sent += 1) {
      assert.equal((await send(problem(), { token: me.token })).status, 201);
    }
    const refused = await send(problem(), { token: me.token });
    assert.equal(refused.status, 429);
    assert.match(refused.body.error, /5 problem reports a day/);
    // Another account is not held to it.
    assert.equal((await send(problem(), { token: (await reader()).token })).status, 201);
  });

  test("takes so many from one address, signed in or not", async () => {
    for (let sent = 0; sent < 3; sent += 1) {
      assert.equal((await send(problem(), { to: tight })).status, 201);
    }
    assert.equal((await send(problem(), { to: tight })).status, 429);
    assert.equal((await send(problem(), { to: tight, token: (await reader()).token })).status, 429);
  });

  test(`turns new ones away while ${OPEN_MAX} wait, and takes them once one closes`, async () => {
    const open = await db.collection("problems").countDocuments({ status: "open" });
    const filler = Array.from({ length: OPEN_MAX - open }, () => ({
      at: new Date(),
      message: "filler",
      diagnostics: null,
      version: "1.5.7",
      platform: "linux",
      status: "open"
    }));
    const { insertedIds } = await db.collection("problems").insertMany(filler);
    const ids = Object.values(insertedIds);
    try {
      const full = await send(problem());
      assert.equal(full.status, 503);
      assert.equal(full.body.error, FULL);
      await db.collection("problems").updateOne({ _id: ids[0] }, { $set: { status: "closed" } });
      assert.equal((await send(problem())).status, 201);
    } finally {
      await db.collection("problems").deleteMany({ _id: { $in: ids } });
    }
  });

  test("expire 90 days after they were sent, and are indexed for the admin's list", async () => {
    const indexes = await db.collection("problems").indexes();
    const expiry = indexes.find((index) => index.name === "expiry");
    assert.deepEqual(expiry.key, { at: 1 });
    assert.equal(expiry.expireAfterSeconds, 90 * 24 * 60 * 60);
    assert.deepEqual(indexes.find((index) => index.name === "list").key, { status: 1, _id: -1 });
    assert.deepEqual(indexes.find((index) => index.name === "account").key, { accountId: 1 });
  });
});

describe("the admin's problems", () => {
  test("to anyone else are not there, and need an account", async () => {
    const me = await reader();
    const id = (await send(problem())).body.id;
    const missing = await call("GET", "/v1/no-such-route", { token: me.token });
    for (const [method, path, body] of [
      ["GET", "/v1/admin/problems"],
      ["GET", `/v1/admin/problems/${id}`],
      ["POST", `/v1/admin/problems/${id}`, { status: "closed" }],
      ["DELETE", `/v1/admin/problems/${id}`]
    ]) {
      const answer = await call(method, path, { token: me.token, body });
      assert.equal(answer.status, 404, `${method} ${path}`);
      assert.deepEqual(answer.body, missing.body, "exactly as a route that does not exist");
      const signedOut = await call(method, path, { body });
      assert.equal(signedOut.status, 401, `${method} ${path} signed out`);
    }
    const doc = await stored(id);
    assert.equal(doc.status, "open");
  });

  test("lists the newest first, without diagnostics; opens, closes, reopens, deletes", async () => {
    const owner = await reader({ role: "admin" });
    const ask = (method, path, body) =>
      call(method, `/v1/admin/problems${path}`, { token: owner.token, body });
    const tester = await reader();
    const long = "A long one. ".repeat(40);
    const first = (await send(problem({ message: long }), { token: tester.token })).body.id;
    const reply = { diagnostics: null, contact: "reply@example.com" };
    const second = (await send(problem(reply))).body.id;

    const listed = await ask("GET", "");
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const [newest, next] = listed.body.problems;
    assert.equal(newest.id, second);
    assert.equal(next.id, first);
    assert.equal(newest.hasDiagnostics, false);
    assert.equal(newest.contact, "reply@example.com");
    assert.equal(newest.signedIn, false);
    assert.equal(next.hasDiagnostics, true);
    assert.equal(next.handle, tester.handle);
    assert.equal(next.signedIn, true);
    assert.equal(next.preview, long.slice(0, 200));
    assert.equal(next.cut, true);
    assert.equal(newest.cut, false);
    for (const row of listed.body.problems) {
      assert.equal(row.diagnostics, undefined);
      assert.equal(row.message, undefined);
      assert.equal(row.accountId, undefined);
    }

    const whole = await ask("GET", `/${first}`);
    assert.equal(whole.status, 200);
    assert.equal(whole.body.message, long.trim());
    assert.equal(whole.body.diagnostics, "Leaflet 1.5.7\nRecent log:\n...");
    assert.equal(whole.body.version, "1.5.7");
    assert.equal(whole.body.platform, "windows");

    const closing = { status: "closed", note: "  Fixed in\n1.5.8  " };
    const closed = await ask("POST", `/${first}`, closing);
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.status, "closed");
    assert.equal(closed.body.note, "Fixed in\n1.5.8");
    assert.ok(Date.parse(closed.body.closedAt) > 0);
    const open = (await ask("GET", "")).body.problems;
    assert.ok(!open.some((row) => row.id === first));
    const done = (await ask("GET", "?status=closed")).body;
    assert.equal(done.problems[0].id, first);
    assert.equal(done.problems[0].note, "Fixed in\n1.5.8");

    // Reopened, the note stays unless it is sent.
    const reopened = await ask("POST", `/${first}`, { status: "open" });
    assert.equal(reopened.body.status, "open");
    assert.equal(reopened.body.note, "Fixed in\n1.5.8");
    assert.equal(reopened.body.closedAt, null);
    const cleared = await ask("POST", `/${first}`, { status: "open", note: null });
    assert.equal(cleared.body.note, null);

    const tooLong = { status: "closed", note: "n".repeat(501) };
    for (const body of [{ status: "done" }, {}, tooLong, { status: "open", note: 5 }]) {
      const refused = await ask("POST", `/${first}`, body);
      assert.equal(refused.status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await ask("GET", "/nope")).status, 404);
    assert.equal((await ask("GET", "?before=nope")).status, 400);

    assert.equal((await ask("DELETE", `/${second}`)).status, 200);
    assert.equal(await stored(second), null);
    assert.equal((await ask("DELETE", `/${second}`)).status, 404);
    assert.equal((await ask("GET", `/${second}`)).status, 404);
  });

  test("pages by fifty, with the id of the last one shown", async () => {
    const owner = await reader({ role: "admin" });
    const now = Date.now();
    await db.collection("problems").insertMany(
      Array.from({ length: 60 }, (_, index) => ({
        _id: ObjectId.createFromTime(Math.floor(now / 1000) + 3600 + index),
        at: new Date(now),
        message: `paged ${index}`,
        diagnostics: null,
        version: "1.5.7",
        platform: "macos",
        status: "closed"
      }))
    );
    const closed = (query) =>
      call("GET", `/v1/admin/problems?status=closed${query}`, { token: owner.token });
    const page = (await closed("")).body;
    assert.equal(page.problems.length, 50);
    assert.equal(page.more, true);
    assert.equal(page.problems[0].preview, "paged 59");
    const last = page.problems.at(-1).id;
    const rest = (await closed(`&before=${last}`)).body;
    assert.equal(rest.problems[0].preview, "paged 9");
    assert.ok(rest.problems.every((row) => row.status === "closed"));
  });
});

describe("deleting an account", () => {
  test("deletes the problem reports it sent, and no one else's", async () => {
    const me = await reader();
    const mine = (await send(problem(), { token: me.token })).body.id;
    const stranger = (await send(problem())).body.id;
    assert.equal((await accountFootprint(db, me.id))["problem reports"], 1);
    const body = { password: PASSWORD };
    const gone = await call("DELETE", "/v1/account", { token: me.token, body });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal(await stored(mine), null);
    assert.notEqual(await stored(stranger), null);
    assert.equal(await db.collection("problems").countDocuments({ accountId: me.id }), 0);
  });
});
