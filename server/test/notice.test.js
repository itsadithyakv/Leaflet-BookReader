import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";

/**
 * The update notice: the owner says from the admin panel that a newer
 * Leaflet is out, and every app may ask for it, signed in or not. Against a
 * throwaway database (TEST_MONGO_URI, default mongodb://127.0.0.1:27017)
 * dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;

let db;
let server;
let base;

before(async () => {
  db = await connect(uri, dbName);
  const roomy = (windowMs) => ({ limit: 100_000, windowMs });
  const app = createApp(db, {
    limits: { ip: roomy(15 * MINUTE), email: roomy(15 * MINUTE), signup: roomy(60 * MINUTE), social: roomy(15 * MINUTE) }
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.dropDatabase();
  await close();
});

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function reader({ role } = {}) {
  const email = `n-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: "correct horse battery" } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `n${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", { token, body: { handle, visibility: "public" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  if (role) await db.collection("profiles").updateOne({ handle }, { $set: { role } });
  return { token, handle };
}

describe("the update notice", () => {
  test("says nothing until the owner sets it, and may be asked for by anyone", async () => {
    const none = await call("GET", "/v1/notice");
    assert.equal(none.status, 200);
    assert.deepEqual(none.body, { version: null, note: null, at: null });
  });

  test("is set by the owner, seen at once by everybody, and taken down again", async () => {
    const owner = await reader({ role: "admin" });
    const set = await call("PUT", "/v1/admin/notice", { token: owner.token, body: { version: "1.4.2", note: "  Friends, a calmer camp,\n and fixes.  " } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.version, "1.4.2");
    assert.equal(set.body.note, "Friends, a calmer camp, and fixes.");
    // Kept in memory for a minute, but a change is seen at once.
    const seen = await call("GET", "/v1/notice");
    assert.equal(seen.body.version, "1.4.2");
    assert.equal(seen.body.note, "Friends, a calmer camp, and fixes.");
    assert.ok(Date.parse(seen.body.at) > 0);

    const down = await call("PUT", "/v1/admin/notice", { token: owner.token, body: { version: null, note: "ignored" } });
    assert.equal(down.status, 200);
    assert.deepEqual((await call("GET", "/v1/notice")).body.version, null);
    assert.deepEqual((await call("GET", "/v1/notice")).body.note, null);
  });

  test("takes a version of numbers with dots, and a short note", async () => {
    const owner = await reader({ role: "admin" });
    for (const version of ["1.4", "1.4.2", "10.0.0.1"]) {
      assert.equal((await call("PUT", "/v1/admin/notice", { token: owner.token, body: { version } })).status, 200, version);
    }
    for (const version of ["1", "v1.4.2", "1.4.2-beta", "1..2", 142, ""]) {
      assert.equal((await call("PUT", "/v1/admin/notice", { token: owner.token, body: { version } })).status, 400, String(version));
    }
    assert.equal((await call("PUT", "/v1/admin/notice", { token: owner.token, body: { version: "1.4.2", note: 5 } })).status, 400);
    const long = await call("PUT", "/v1/admin/notice", { token: owner.token, body: { version: "1.4.2", note: "x".repeat(500) } });
    assert.equal(long.body.note.length, 160);
  });

  test("is set by nobody else: a reader is told no such thing exists, and nobody signed out may", async () => {
    const me = await reader();
    const missing = await call("GET", "/v1/no-such-route", { token: me.token });
    const tried = await call("PUT", "/v1/admin/notice", { token: me.token, body: { version: "9.9.9" } });
    assert.equal(tried.status, 404);
    assert.deepEqual(tried.body, missing.body);
    assert.equal((await call("PUT", "/v1/admin/notice", { body: { version: "9.9.9" } })).status, 401);
    assert.notEqual((await call("GET", "/v1/notice")).body.version, "9.9.9");
  });
});
