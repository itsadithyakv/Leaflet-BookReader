import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { deleteAccount } from "../src/deletion.js";

/**
 * Deleting an account: by the reader (DELETE /v1/account) and by the owner on
 * request (src/tools/delete-account.js), which go the same way and both leave
 * the id, and only the id, in `deletions`.
 */

const run = promisify(execFile);
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const tool = join(serverDir, "src", "tools", "delete-account.js");
const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const PASSWORD = "correct horse battery";

let db;
let server;
let base;
let cwd;

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
  // An empty folder to run the tool in, so no .env is picked up.
  cwd = mkdtempSync(join(tmpdir(), "leaflet-delete-test-"));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.dropDatabase();
  await close();
  rmSync(cwd, { recursive: true, force: true });
});

async function call(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function reader() {
  const email = `reader-${randomBytes(4).toString("hex")}@example.com`;
  const made = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const handle = `del${randomBytes(3).toString("hex")}`;
  const { token } = made.body;
  assert.equal((await call("PUT", "/v1/profile/me", { token, body: { handle } })).status, 200);
  await call("PUT", "/v1/state", { token, body: { version: 0, state: Buffer.from("x").toString("base64") } });
  return { email, token, handle, id: new ObjectId(made.body.account.id) };
}

const tryTool = (args) =>
  run(process.execPath, [tool, ...args], { cwd, env: { ...process.env, MONGO_URI: uri, MONGO_DB: dbName } }).catch((error) => error);

describe("deleting an account", () => {
  test("the deletions collection keeps the id and the date, nothing else, and expires", async () => {
    const me = await reader();
    assert.equal((await call("DELETE", "/v1/account", { token: me.token, body: { password: PASSWORD } })).status, 200);
    const noted = await db.collection("deletions").findOne({ _id: me.id });
    assert.deepEqual(Object.keys(noted).sort(), ["_id", "at"]);
    assert.ok(noted.at instanceof Date && Date.now() - noted.at < MINUTE);
    const expiry = (await db.collection("deletions").indexes()).find((index) => index.name === "expiry");
    assert.equal(expiry.expireAfterSeconds, 45 * 24 * 60 * 60);
  });

  test("the owner's tool shows the account and deletes nothing without --yes", async () => {
    const me = await reader();
    const shown = await tryTool(["--email", `  ${me.email.toUpperCase()} `]);
    assert.equal(shown.code ?? 0, 0, shown.stderr);
    assert.match(shown.stdout, new RegExp(`@${me.handle}`));
    assert.match(shown.stdout, /sync state 1/);
    assert.match(shown.stdout, /Nothing deleted/);
    assert.equal(await db.collection("accounts").countDocuments({ _id: me.id }), 1);
    assert.equal((await call("GET", "/v1/auth/me", { token: me.token })).status, 200);
  });

  test("with --yes it deletes the way the route does", async () => {
    const me = await reader();
    const done = await tryTool(["--email", me.email, "--yes"]);
    assert.equal(done.code ?? 0, 0, done.stderr);
    assert.match(done.stdout, /Deleted/);
    for (const [name, filter] of [
      ["accounts", { _id: me.id }],
      ["profiles", { _id: me.id }],
      ["states", { _id: me.id }],
      ["sessions", { userId: me.id }]
    ]) {
      assert.equal(await db.collection(name).countDocuments(filter), 0, name);
    }
    assert.deepEqual(Object.keys(await db.collection("deletions").findOne({ _id: me.id })).sort(), ["_id", "at"]);
  });

  /**
   * Sync audit D5: a device's sync on its way while the account is deleted
   * on another (its push lost a race and retries at version 0) used to land
   * between the state going and the sessions ending, and put a new state
   * back: the reading outlived the deletion. Sessions end first now, and the
   * state goes again at the very end.
   */
  test("ends the sessions before anything is deleted, and deletes the state last", async () => {
    const me = await reader();
    const seen = [];
    const watch = (collection) =>
      new Proxy(collection, {
        get(target, name) {
          if (name === "deleteOne") {
            return async (...args) => {
              seen.push(await db.collection("sessions").countDocuments({ userId: me.id }));
              return target.deleteOne(...args);
            };
          }
          const value = target[name];
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    const watched = new Proxy(db, {
      get(target, name) {
        if (name === "collection") return (which) => (which === "states" ? watch(target.collection(which)) : target.collection(which));
        const value = target[name];
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    await deleteAccount(watched, me.id);
    assert.deepEqual(seen, [0, 0], "no session was left when the state went, either time");
    assert.equal(await db.collection("states").countDocuments({ _id: me.id }), 0);
    assert.equal((await call("PUT", "/v1/state", { token: me.token, body: { version: 0, state: Buffer.from("y").toString("base64") } })).status, 401);
    assert.equal(await db.collection("states").countDocuments({ _id: me.id }), 0);
  });

  test("a first copy is not kept for an account that is gone, even on a session still open", async () => {
    const me = await reader();
    await db.collection("states").deleteOne({ _id: me.id });
    // The account goes while a request already let in is on its way.
    await db.collection("accounts").deleteOne({ _id: me.id });
    const late = await call("PUT", "/v1/state", { token: me.token, body: { version: 0, state: Buffer.from("z").toString("base64") } });
    assert.equal(late.status, 401);
    assert.equal(await db.collection("states").countDocuments({ _id: me.id }), 0);
  });

  test("an address with no account is said so, and fails", async () => {
    const missing = await tryTool(["--email", "nobody-here@example.com", "--yes"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no account with the address nobody-here@example.com/);
  });
});
