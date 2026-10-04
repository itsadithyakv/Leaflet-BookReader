import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";

/**
 * Runs the real app against a throwaway database on a local MongoDB
 * (TEST_MONGO_URI, default mongodb://127.0.0.1:27017) and drops it afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;

let db;
let server;
let base;

before(async () => {
  db = await connect(uri, dbName);
  const app = createApp(db, {
    limits: {
      ip: { limit: 1000, windowMs: 15 * MINUTE },
      email: { limit: 3, windowMs: 15 * MINUTE },
      signup: { limit: 1000, windowMs: 60 * MINUTE }
    }
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

async function call(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + path, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const unique = () => `reader-${randomBytes(4).toString("hex")}@example.com`;
const PASSWORD = "correct horse battery";

async function signup(email = unique(), password = PASSWORD) {
  const result = await call("POST", "/v1/auth/signup", { body: { email, password, displayName: "Ada" } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { email, token: result.body.token, account: result.body.account };
}

describe("accounts", () => {
  test("signup returns a token and never the hash", async () => {
    const email = unique();
    const { token, account } = await signup(`  ${email.toUpperCase()} `);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(account.email, email);
    assert.equal(account.displayName, "Ada");
    assert.equal("passwordHash" in account, false);

    const stored = await db.collection("accounts").findOne({ email });
    assert.match(stored.passwordHash, /^scrypt\$/);
    const session = await db.collection("sessions").findOne({ userId: stored._id });
    assert.notEqual(session._id, token, "only the hash of the token is stored");
    assert.ok(session.expiresAt > new Date(Date.now() + 89 * 24 * 3600 * 1000));
  });

  test("signup validates email and password", async () => {
    assert.equal((await call("POST", "/v1/auth/signup", { body: { email: "nope", password: PASSWORD } })).status, 400);
    assert.equal((await call("POST", "/v1/auth/signup", { body: { email: unique(), password: "short" } })).status, 400);
    assert.equal((await call("POST", "/v1/auth/signup", { body: { email: unique(), password: "x".repeat(201) } })).status, 400);
  });

  test("signup keeps a chosen avatar and refuses unknown ones", async () => {
    const email = unique();
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD, avatar: "wizard.magic" } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.account.avatar, "wizard.magic");
    const me = await call("GET", "/v1/auth/me", { token: made.body.token });
    assert.equal(me.body.account.avatar, "wizard.magic");

    // Earned-only skins, near misses and non-strings are all refused.
    for (const avatar of ["champ.champ", "Wizard.magic", "wizard.magic ", "wizard", "wizard.teleport", "wizard.magic.", "golden.moonwalk", 42, { id: "wizard.magic" }]) {
      const refused = await call("POST", "/v1/auth/signup", { body: { email: unique(), password: PASSWORD, avatar } });
      assert.equal(refused.status, 400, `${JSON.stringify(avatar)} should be refused`);
    }

    const plain = await signup();
    assert.equal(plain.account.avatar, null, "no avatar is null, so the app falls back to the handle's skin");
  });

  test("the avatar can be changed and cleared, leaving the name alone", async () => {
    const { token } = await signup();
    const changed = await call("PATCH", "/v1/account", { token, body: { avatar: "frost.tree" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.account.avatar, "frost.tree");
    assert.equal(changed.body.account.displayName, "Ada");

    assert.equal((await call("PATCH", "/v1/account", { token, body: { avatar: "golden.champ" } })).status, 400);
    assert.equal((await call("GET", "/v1/auth/me", { token })).body.account.avatar, "frost.tree");

    const cleared = await call("PATCH", "/v1/account", { token, body: { avatar: null } });
    assert.equal(cleared.body.account.avatar, null);
    assert.equal((await call("PATCH", "/v1/account", { body: { avatar: "frost.tree" } })).status, 401);
  });

  test("duplicate email is a 409", async () => {
    const { email } = await signup();
    const again = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
    assert.equal(again.status, 409);
  });

  test("login, me and logout", async () => {
    const { email } = await signup();
    const login = await call("POST", "/v1/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
    const me = await call("GET", "/v1/auth/me", { token: login.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.account.email, email);

    assert.equal((await call("POST", "/v1/auth/logout", { token: login.body.token })).status, 200);
    assert.equal((await call("GET", "/v1/auth/me", { token: login.body.token })).status, 401);
  });

  test("wrong password and unknown email look the same", async () => {
    const { email } = await signup();
    const wrong = await call("POST", "/v1/auth/login", { body: { email, password: "not the password" } });
    const unknown = await call("POST", "/v1/auth/login", { body: { email: unique(), password: PASSWORD } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test("repeated failures for one email are rate limited", async () => {
    const { email } = await signup();
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await call("POST", "/v1/auth/login", { body: { email, password: "wrong wrong" } })).status, 401);
    }
    const blocked = await call("POST", "/v1/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(blocked.status, 429);
  });

  test("changing the password revokes other sessions", async () => {
    const { email, token } = await signup();
    const other = (await call("POST", "/v1/auth/login", { body: { email, password: PASSWORD } })).body.token;

    const bad = await call("POST", "/v1/auth/password", { token, body: { current: "nope nope", next: "another password" } });
    assert.equal(bad.status, 403);

    const ok = await call("POST", "/v1/auth/password", { token, body: { current: PASSWORD, next: "another password" } });
    assert.equal(ok.status, 200);
    assert.equal((await call("GET", "/v1/auth/me", { token })).status, 200);
    assert.equal((await call("GET", "/v1/auth/me", { token: other })).status, 401);
    assert.equal((await call("POST", "/v1/auth/login", { body: { email, password: "another password" } })).status, 200);
  });

  test("deleting the account removes everything keyed to it", async () => {
    const { email, token, account } = await signup();
    await call("PUT", "/v1/profile/me", { token, body: { handle: `del${randomBytes(3).toString("hex")}` } });
    await call("PUT", "/v1/state", { token, body: { version: 0, state: Buffer.from("x").toString("base64") } });

    assert.equal((await call("DELETE", "/v1/account", { token, body: { password: "wrong one!" } })).status, 403);
    const deleted = await call("DELETE", "/v1/account", { token, body: { password: PASSWORD } });
    assert.equal(deleted.status, 200);

    const { ObjectId } = await import("mongodb");
    const id = new ObjectId(account.id);
    assert.equal(await db.collection("accounts").countDocuments({ email }), 0);
    assert.equal(await db.collection("sessions").countDocuments({ userId: id }), 0);
    assert.equal(await db.collection("profiles").countDocuments({ _id: id }), 0);
    assert.equal(await db.collection("states").countDocuments({ _id: id }), 0);
    assert.equal((await call("GET", "/v1/auth/me", { token })).status, 401);
  });

  test("malformed JSON is a 400, not a crash", async () => {
    const result = await call("POST", "/v1/auth/login", { raw: "{not json" });
    assert.equal(result.status, 400);
  });

  test("large bodies are refused on auth routes", async () => {
    const result = await call("POST", "/v1/auth/login", { body: { email: "a@b.co", password: "x".repeat(20_000) } });
    assert.equal(result.status, 413);
  });
});

describe("state", () => {
  test("requires an account", async () => {
    assert.equal((await call("GET", "/v1/state")).status, 401);
    assert.equal((await call("PUT", "/v1/state", { token: "x".repeat(43), body: { version: 0, state: "eA==" } })).status, 401);
  });

  test("optimistic versions: version 0 on an existing document is a 409", async () => {
    const { token } = await signup();
    const first = Buffer.from("first").toString("base64");
    const put = await call("PUT", "/v1/state", { token, body: { version: 0, state: first } });
    assert.equal(put.status, 200);
    assert.equal(put.body.version, 1);

    const stale = await call("PUT", "/v1/state", { token, body: { version: 0, state: Buffer.from("other").toString("base64") } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.version, 1);
    assert.equal(stale.body.state, first);

    assert.equal((await call("PUT", "/v1/state", { token, body: { version: 5, state: first } })).status, 409);
    assert.equal((await call("PUT", "/v1/state", { token, body: { version: 1, state: first } })).body.version, 2);
    const got = await call("GET", "/v1/state", { token });
    assert.equal(got.body.version, 2);
    assert.equal(got.body.state, first);
  });
});

describe("profiles", () => {
  test("saving a profile works, including the first save with visibility", async () => {
    const { token } = await signup();
    const handle = `r${randomBytes(4).toString("hex")}`;
    const saved = await call("PUT", "/v1/profile/me", {
      token,
      body: {
        handle,
        displayName: "Ada",
        visibility: "public",
        weekKey: isoWeekKey(),
        weekMinutes: 120,
        streak: 4,
        booksFinished: 2,
        shelf: [{ title: "Dune", author: "Herbert", styleSeed: "abc" }]
      }
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.visibility, "public");

    // A save without visibility keeps what is there.
    const again = await call("PUT", "/v1/profile/me", { token, body: { displayName: "Ada L." } });
    assert.equal(again.status, 200);
    assert.equal(again.body.visibility, "public");

    const board = await call("GET", "/v1/leaderboard");
    assert.ok(board.body.entries.some((entry) => entry.handle === handle));
    assert.equal((await call("GET", `/v1/profile/${handle}`)).status, 200);
  });

  test("a new profile is private and 404s by handle", async () => {
    const { token } = await signup();
    const handle = `p${randomBytes(4).toString("hex")}`;
    const saved = await call("PUT", "/v1/profile/me", { token, body: { handle } });
    assert.equal(saved.body.visibility, "private");
    assert.equal((await call("GET", `/v1/profile/${handle}`)).status, 404);
  });

  test("a name is one line of visible text, and an empty one clears it", async () => {
    const { token } = await signup();
    const save = async (displayName) => (await call("PUT", "/v1/profile/me", { token, body: { displayName } })).body.displayName;
    // A line break, a right-to-left override (which reverses the row it is
    // shown in) and a zero-width space.
    assert.equal(await save("  Ada\n\u202ELove\u200Blace\t "), "Ada Lovelace");
    // Nothing but invisible characters is no name at all, not a blank one.
    assert.equal(await save("\u200B\u202E\u2066 \n"), null);
    // Forty characters, and the cut never splits an emoji in two.
    const long = await save(`${"a".repeat(39)}😀😀`);
    assert.equal([...long].length, 40);
    assert.ok(long.endsWith("😀"));
    assert.ok(long.isWellFormed());
    // The app sends an empty name to remove it.
    assert.equal(await save("Ada"), "Ada");
    assert.equal(await save(""), null);

    // The account's own name and the shelf go through the same rule.
    const renamed = await call("PATCH", "/v1/account", { token, body: { displayName: "Gra\u202Ece\r\nHopper" } });
    assert.equal(renamed.body.account.displayName, "Grace Hopper");
    const shelved = await call("PUT", "/v1/profile/me", {
      token,
      body: { visibility: "public", shelf: [{ title: "Du\u202Ene\n", author: "\u200B", styleSeed: "s" }] }
    });
    assert.deepEqual(shelved.body.shelf, [{ title: "Dune", author: null, styleSeed: "s" }]);
  });

  test("two readers can both clear their handle", async () => {
    for (let i = 0; i < 2; i += 1) {
      const { token } = await signup();
      assert.equal((await call("PUT", "/v1/profile/me", { token, body: { handle: null } })).status, 200);
    }
  });

  test("stats are bounded and the week must be plausible", async () => {
    const { token } = await signup();
    const week = isoWeekKey();
    assert.equal((await call("PUT", "/v1/profile/me", { token, body: { weekKey: week, weekMinutes: 10_081 } })).status, 400);
    assert.equal((await call("PUT", "/v1/profile/me", { token, body: { weekKey: week, weekMinutes: "Infinity" } })).status, 400);
    assert.equal((await call("PUT", "/v1/profile/me", { token, body: { weekKey: "2001-W01", weekMinutes: 10 } })).status, 400);
    assert.equal((await call("PUT", "/v1/profile/me", { token, body: { weekMinutes: 10 } })).status, 400);
    assert.equal((await call("PUT", "/v1/profile/me", { token, body: { streak: -1 } })).status, 400);
    assert.equal((await call("PUT", "/v1/profile/me", { token, body: { weekKey: week, weekMinutes: 10_080 } })).status, 200);
  });

  test("reserved and taken handles are refused", async () => {
    const a = await signup();
    const b = await signup();
    assert.equal((await call("PUT", "/v1/profile/me", { token: a.token, body: { handle: "admin" } })).status, 400);
    assert.equal((await call("PUT", "/v1/profile/me", { token: a.token, body: { handle: "Pip" } })).status, 400);
    const handle = `t${randomBytes(4).toString("hex")}`;
    assert.equal((await call("PUT", "/v1/profile/me", { token: a.token, body: { handle } })).status, 200);
    assert.equal((await call("PUT", "/v1/profile/me", { token: b.token, body: { handle } })).status, 409);
  });

  test("ties on the board are broken by streak, then handle", async () => {
    const week = isoWeekKey();
    const minutes = 9_999.5; // unique to this test, so other rows do not interleave
    const suffix = randomBytes(3).toString("hex");
    for (const [name, streak] of [[`b${suffix}`, 1], [`a${suffix}`, 1], [`c${suffix}`, 9]]) {
      const { token } = await signup();
      await call("PUT", "/v1/profile/me", { token, body: { handle: name, visibility: "public", weekKey: week, weekMinutes: minutes, streak } });
    }
    const board = await call("GET", `/v1/leaderboard?week=${week}`);
    const order = board.body.entries.filter((entry) => entry.handle.endsWith(suffix)).map((entry) => entry.handle);
    assert.deepEqual(order, [`c${suffix}`, `a${suffix}`, `b${suffix}`]);
  });
});
