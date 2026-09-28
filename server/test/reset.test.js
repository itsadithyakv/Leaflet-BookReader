import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createApp } from "../src/app.js";
import { accounts, close, connect, resets } from "../src/db.js";
import { appsScriptMailer } from "../src/mail.js";

/**
 * Password reset, against a throwaway database, with a mailer that records
 * what it would have sent.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;

let db;
const servers = [];
const sent = [];

const start = async (options) => {
  const app = createApp(db, {
    limits: {
      ip: { limit: 1000, windowMs: 15 * MINUTE },
      email: { limit: 1000, windowMs: 15 * MINUTE },
      signup: { limit: 1000, windowMs: 60 * MINUTE },
      resetIp: { limit: 1000, windowMs: 60 * MINUTE },
      resetEmail: { limit: 1000, windowMs: 60 * MINUTE },
      ...options.limits
    },
    mailer: options.mailer
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

let base;
let noMail;
let strict;

before(async () => {
  db = await connect(uri, dbName);
  base = await start({ mailer: async (message) => sent.push(message) });
  noMail = await start({ mailer: null });
  strict = await start({
    mailer: async (message) => sent.push(message),
    limits: { resetEmail: { limit: 2, windowMs: 60 * MINUTE } }
  });
});

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await db.dropDatabase();
  await close();
});

async function call(root, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(root + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const unique = () => `reader-${randomBytes(4).toString("hex")}@example.com`;
const OLD = "correct horse battery";
const NEW = "a brand new password";

async function signup(email) {
  const result = await call(base, "POST", "/v1/auth/signup", { body: { email, password: OLD } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.token;
}

const lastCodeFor = (email) =>
  [...sent].reverse().find((message) => message.to === email && message.kind === "code")?.code;
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("password reset", () => {
  test("a code from the email sets a new password, signs out everywhere and signs in", async () => {
    const email = unique();
    const oldToken = await signup(email);

    const asked = await call(base, "POST", "/v1/auth/reset/request", { body: { email: ` ${email.toUpperCase()} ` } });
    assert.equal(asked.status, 200);
    assert.equal(asked.body.minutes, 15);
    await settle();
    const code = lastCodeFor(email);
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(sent.at(-1).minutes, 15);

    // Typed loosely: lower case, no dash, spaces.
    const typed = ` ${code.toLowerCase().replace("-", " ")} `;
    const done = await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code: typed, password: NEW } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.ok(done.body.token);
    assert.equal(done.body.account.email, email);
    assert.equal(done.body.account.passwordHash, undefined);

    assert.equal((await call(base, "GET", "/v1/auth/me", { token: oldToken })).status, 401, "old sessions end");
    assert.equal((await call(base, "GET", "/v1/auth/me", { token: done.body.token })).status, 200);
    assert.equal((await call(base, "POST", "/v1/auth/login", { body: { email, password: OLD } })).status, 401);
    assert.equal((await call(base, "POST", "/v1/auth/login", { body: { email, password: NEW } })).status, 200);

    // Used once, gone.
    const again = await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code, password: OLD } });
    assert.equal(again.status, 400);
  });

  test("an unknown address gets the same answer and no email", async () => {
    const before = sent.length;
    const asked = await call(base, "POST", "/v1/auth/reset/request", { body: { email: unique() } });
    assert.equal(asked.status, 200);
    assert.deepEqual(asked.body, { ok: true, minutes: 15 });
    await settle();
    assert.equal(sent.length, before);
    const guessed = await call(base, "POST", "/v1/auth/reset/confirm", {
      body: { email: unique(), code: "ABCD-EFGH", password: NEW }
    });
    assert.equal(guessed.status, 400);
  });

  test("five wrong codes use the code up", async () => {
    const email = unique();
    await signup(email);
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    const code = lastCodeFor(email);
    const wrong = code === "AAAA-AAAA" ? "BBBB-BBBB" : "AAAA-AAAA";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code: wrong, password: NEW } });
      assert.equal(result.status, 400);
    }
    const right = await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code, password: NEW } });
    assert.equal(right.status, 400, "the real code no longer works");
  });

  test("a new code replaces the old one, and an expired code fails", async () => {
    const email = unique();
    await signup(email);
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    const first = lastCodeFor(email);
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    const second = lastCodeFor(email);
    if (first !== second) {
      const stale = await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code: first, password: NEW } });
      assert.equal(stale.status, 400);
    }
    await resets(db).updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code: second, password: NEW } });
    assert.equal(expired.status, 400);
  });

  test("a weak new password is refused before the code is spent", async () => {
    const email = unique();
    await signup(email);
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    const code = lastCodeFor(email);
    assert.equal((await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code, password: "short" } })).status, 400);
    assert.equal((await call(base, "POST", "/v1/auth/reset/confirm", { body: { email, code, password: NEW } })).status, 200);
  });

  test("requests are limited per address, and refused when no mailer is set up", async () => {
    const email = unique();
    await signup(email);
    assert.equal((await call(strict, "POST", "/v1/auth/reset/request", { body: { email } })).status, 200);
    assert.equal((await call(strict, "POST", "/v1/auth/reset/request", { body: { email } })).status, 200);
    assert.equal((await call(strict, "POST", "/v1/auth/reset/request", { body: { email } })).status, 429);

    const off = await call(noMail, "POST", "/v1/auth/reset/request", { body: { email } });
    assert.equal(off.status, 503);
    assert.match(off.body.error, /isn't set up/);
    assert.equal((await call(base, "POST", "/v1/auth/reset/request", { body: { email: "not an email" } })).status, 400);
  });

  test("three resets a year, then the email explains instead of sending a code", async () => {
    const email = unique();
    await signup(email);
    for (let round = 0; round < 3; round += 1) {
      await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
      await settle();
      const done = await call(base, "POST", "/v1/auth/reset/confirm", {
        body: { email, code: lastCodeFor(email), password: `${NEW} ${round}` }
      });
      assert.equal(done.status, 200, JSON.stringify(done.body));
    }
    const account = await accounts(db).findOne({ email });
    assert.equal(account.passwordResets.length, 3);

    const codesBefore = sent.filter((message) => message.kind === "code").length;
    const asked = await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    assert.deepEqual(asked.body, { ok: true, minutes: 15 }, "the same answer on screen");
    await settle();
    assert.equal(sent.filter((message) => message.kind === "code").length, codesBefore, "no fourth code");
    const notice = sent.at(-1);
    assert.equal(notice.kind, "limit");
    assert.equal(notice.to, email);
    assert.match(notice.availableOn, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);

    // A year on, the oldest no longer counts.
    const yearAgo = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    await accounts(db).updateOne({ _id: account._id }, { $set: { "passwordResets.0": yearAgo } });
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    assert.equal(sent.at(-1).kind, "code");
    const fourth = await call(base, "POST", "/v1/auth/reset/confirm", {
      body: { email, code: lastCodeFor(email), password: NEW }
    });
    assert.equal(fourth.status, 200);
    assert.equal((await accounts(db).findOne({ email })).passwordResets.length, 3, "the old one is dropped");
  });

  test("deleting the account removes a pending reset", async () => {
    const email = unique();
    const token = await signup(email);
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    assert.equal(await resets(db).countDocuments({}) > 0, true);
    const account = (await call(base, "GET", "/v1/auth/me", { token })).body.account;
    assert.equal((await call(base, "DELETE", "/v1/account", { token, body: { password: OLD } })).status, 200);
    const { ObjectId } = await import("mongodb");
    assert.equal(await resets(db).countDocuments({ _id: new ObjectId(account.id) }), 0);
  });
});

describe("Apps Script mailer", () => {
  test("posts the secret and the message, and fails on a refusal", async () => {
    const seen = [];
    const { createServer } = await import("node:http");
    let answer = { ok: true };
    const fake = createServer((request, response) => {
      let data = "";
      request.on("data", (chunk) => (data += chunk));
      request.on("end", () => {
        seen.push(JSON.parse(data));
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(answer));
      });
    });
    await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const mailer = appsScriptMailer({ url: `http://127.0.0.1:${fake.address().port}/exec`, secret: "s3cret" });
    try {
      await mailer({ kind: "code", to: "a@example.com", code: "ABCD-EFGH", minutes: 15 });
      assert.deepEqual(seen[0], { secret: "s3cret", kind: "code", to: "a@example.com", code: "ABCD-EFGH", minutes: 15 });
      answer = { ok: false, error: "forbidden" };
      await assert.rejects(mailer({ kind: "code", to: "a@example.com", code: "ABCD-EFGH", minutes: 15 }), /forbidden/);
    } finally {
      await new Promise((resolve) => fake.close(resolve));
    }
  });
});
