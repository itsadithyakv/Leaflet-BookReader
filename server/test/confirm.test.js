import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import vm from "node:vm";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { accounts, close, confirmations, connect, resets } from "../src/db.js";
import { hashPassword } from "../src/passwords.js";

/**
 * Confirming an email address, against a throwaway database, with a mailer
 * that records what it would have sent.
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
      confirmAccount: { limit: 1000, windowMs: 60 * MINUTE },
      confirmEmail: { limit: 1000, windowMs: 60 * MINUTE },
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

const record = async (message) => sent.push(message);
/** The script as deployed before this existed: any message but "limit" needs a `code`. */
const olderScript = async (message) => {
  if (message.kind !== "limit" && !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(message.code ?? "")) {
    throw new Error("mailer refused: bad request");
  }
  sent.push(message);
};

let base;
let noMail;
let perAddress;
let perAccount;
let older;

before(async () => {
  db = await connect(uri, dbName);
  base = await start({ mailer: record });
  noMail = await start({ mailer: null });
  perAddress = await start({ mailer: record, limits: { confirmEmail: { limit: 3, windowMs: 60 * MINUTE } } });
  perAccount = await start({ mailer: record, limits: { confirmAccount: { limit: 2, windowMs: 60 * MINUTE } } });
  older = await start({ mailer: olderScript });
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
const PASSWORD = "correct horse battery";

async function signup(email, root = base) {
  const result = await call(root, "POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await settle();
  return result.body;
}

const mailsTo = (email, kind = "confirm") => sent.filter((message) => message.to === email && message.kind === kind);
const lastCodeFor = (email) => mailsTo(email).at(-1)?.confirmation;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const me = async (token, root = base) => (await call(root, "GET", "/v1/auth/me", { token })).body.account;
const wrongFor = (code) => (code === "AAAA-AAAA" ? "BBBB-BBBB" : "AAAA-AAAA");

const quietly = async (run) => {
  const original = console.error;
  const lines = [];
  console.error = (...parts) => lines.push(parts.join(" "));
  try {
    await run();
    await settle();
  } finally {
    console.error = original;
  }
  return lines;
};

describe("confirming an email address", () => {
  test("signing up emails a code, and the account starts unconfirmed", async () => {
    const email = unique();
    const { token, account } = await signup(email);
    assert.equal(account.emailConfirmed, false);
    assert.equal((await me(token)).emailConfirmed, false);

    const mails = mailsTo(email);
    assert.equal(mails.length, 1);
    assert.match(mails[0].confirmation, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(mails[0].minutes, 30);
    // Not under `code`: a script that does not know this message must refuse it.
    assert.equal(mails[0].code, undefined);

    const pending = await confirmations(db).findOne({ _id: new ObjectId(account.id) });
    assert.equal(pending.attempts, 0);
    assert.equal(JSON.stringify(pending).includes(mails[0].confirmation), false, "only a hash is kept");
    assert.equal((await accounts(db).findOne({ email })).emailConfirmedAt, null);
  });

  test("the code from the email confirms the address, once", async () => {
    const email = unique();
    const { token, account } = await signup(email);
    const code = lastCodeFor(email);

    // Typed loosely: lower case, no dash, spaces.
    const typed = ` ${code.toLowerCase().replace("-", " ")} `;
    const done = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: typed } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.account.emailConfirmed, true);
    assert.equal(done.body.account.email, email);
    assert.equal(done.body.account.passwordHash, undefined);

    assert.equal((await me(token)).emailConfirmed, true);
    assert.ok((await accounts(db).findOne({ email })).emailConfirmedAt instanceof Date);
    assert.equal(await confirmations(db).countDocuments({ _id: new ObjectId(account.id) }), 0, "the code is spent");
    const login = await call(base, "POST", "/v1/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(login.body.account.emailConfirmed, true);

    // Confirmed stays confirmed: nothing more is asked for, and nothing more is sent.
    const again = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: "nonsense" } });
    assert.equal(again.status, 200);
    assert.equal(again.body.account.emailConfirmed, true);
    const before = sent.length;
    const asked = await call(base, "POST", "/v1/account/email/code", { token });
    assert.equal(asked.status, 200);
    assert.equal(asked.body.sent, false);
    assert.equal(asked.body.account.emailConfirmed, true);
    await settle();
    assert.equal(sent.length, before);
  });

  test("a code confirms only the account it was sent for", async () => {
    const first = unique();
    const second = unique();
    await signup(first);
    const other = await signup(second);
    const borrowed = await call(base, "POST", "/v1/account/email/confirm", {
      token: other.token,
      body: { code: lastCodeFor(first) }
    });
    assert.equal(borrowed.status, 400);
    assert.equal((await me(other.token)).emailConfirmed, false);
  });

  test("five wrong codes use the code up", async () => {
    const email = unique();
    const { token } = await signup(email);
    const code = lastCodeFor(email);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: wrongFor(code) } });
      assert.equal(result.status, 400);
      assert.match(result.body.error, /wrong or has expired/);
    }
    const right = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code } });
    assert.equal(right.status, 400, "the real code no longer works");
    assert.equal((await me(token)).emailConfirmed, false);

    // A new one does.
    assert.equal((await call(base, "POST", "/v1/account/email/code", { token })).status, 200);
    await settle();
    const fresh = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: lastCodeFor(email) } });
    assert.equal(fresh.status, 200);
  });

  test("an expired code fails, and no code at all fails the same way", async () => {
    const email = unique();
    const { token, account } = await signup(email);
    const code = lastCodeFor(email);
    await confirmations(db).updateOne(
      { _id: new ObjectId(account.id) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const expired = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code } });
    assert.equal(expired.status, 400);

    await confirmations(db).deleteOne({ _id: new ObjectId(account.id) });
    const none = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code } });
    assert.equal(none.status, 400);
    assert.equal(none.body.error, expired.body.error);
    assert.equal((await call(base, "POST", "/v1/account/email/confirm", { token })).status, 400, "no body");
  });

  test("a new code replaces the old one and its wrong tries", async () => {
    const email = unique();
    const { token, account } = await signup(email);
    const first = lastCodeFor(email);
    await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: wrongFor(first) } });

    const asked = await call(base, "POST", "/v1/account/email/code", { token });
    assert.equal(asked.status, 200);
    assert.deepEqual({ sent: asked.body.sent, minutes: asked.body.minutes }, { sent: true, minutes: 30 });
    assert.equal(asked.body.account.emailConfirmed, false);
    await settle();
    assert.equal(mailsTo(email).length, 2);
    const second = lastCodeFor(email);
    assert.equal((await confirmations(db).findOne({ _id: new ObjectId(account.id) })).attempts, 0);

    if (first !== second) {
      const stale = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: first } });
      assert.equal(stale.status, 400);
    }
    assert.equal((await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: second } })).status, 200);
  });

  test("new codes are limited per address and per account", async () => {
    // Three emails to one address an hour, the one from signing up included.
    const email = unique();
    const { token } = await signup(email, perAddress);
    assert.equal((await call(perAddress, "POST", "/v1/account/email/code", { token })).status, 200);
    assert.equal((await call(perAddress, "POST", "/v1/account/email/code", { token })).status, 200);
    const refused = await call(perAddress, "POST", "/v1/account/email/code", { token });
    assert.equal(refused.status, 429);
    await settle();
    assert.equal(mailsTo(email).length, 3);

    // Two asks an hour per account, wherever they are sent.
    const asker = unique();
    const { token: askerToken } = await signup(asker, perAccount);
    assert.equal((await call(perAccount, "POST", "/v1/account/email/code", { token: askerToken })).status, 200);
    const moved = await call(perAccount, "POST", "/v1/account/email", {
      token: askerToken,
      body: { password: PASSWORD, email: unique() }
    });
    assert.equal(moved.status, 200);
    assert.equal((await call(perAccount, "POST", "/v1/account/email/code", { token: askerToken })).status, 429);
    const again = await call(perAccount, "POST", "/v1/account/email", {
      token: askerToken,
      body: { password: PASSWORD, email: unique() }
    });
    assert.equal(again.status, 429);
    await settle();
  });

  test("all of it needs a session", async () => {
    for (const path of ["/v1/account/email/code", "/v1/account/email/confirm", "/v1/account/email"]) {
      const result = await call(base, "POST", path, { body: { code: "ABCD-EFGH", password: PASSWORD, email: unique() } });
      assert.equal(result.status, 401, path);
    }
  });
});

describe("changing the email address", () => {
  test("the password is asked for, and the address has to be new, valid and free", async () => {
    const email = unique();
    const taken = unique();
    const { token } = await signup(email);
    await signup(taken);
    const change = (body) => call(base, "POST", "/v1/account/email", { token, body });

    const wrong = await change({ password: "not the password", email: unique() });
    assert.equal(wrong.status, 403, "403, not 401: the session is fine");
    assert.equal((await change({ email: unique() })).status, 403);
    assert.equal((await change({ password: PASSWORD, email: "not an email" })).status, 400);
    assert.equal((await change({ password: PASSWORD, email: ` ${email.toUpperCase()} ` })).status, 400);
    const clash = await change({ password: PASSWORD, email: taken.toUpperCase() });
    assert.equal(clash.status, 409);
    assert.match(clash.body.error, /already exists/);

    // Nothing changed, and nothing was sent anywhere new.
    const account = await me(token);
    assert.equal(account.email, email);
    assert.equal(mailsTo(email).length, 1);
    assert.equal(mailsTo(taken).length, 1);
  });

  test("the new address starts unconfirmed and is sent the code; every device stays signed in", async () => {
    const email = unique();
    const next = unique();
    const { token } = await signup(email);
    const elsewhere = (await call(base, "POST", "/v1/auth/login", { body: { email, password: PASSWORD } })).body.token;
    const oldCode = lastCodeFor(email);
    assert.equal((await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: oldCode } })).status, 200);

    const changed = await call(base, "POST", "/v1/account/email", {
      token,
      body: { password: PASSWORD, email: ` ${next.toUpperCase()} ` }
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.account.email, next);
    assert.equal(changed.body.account.emailConfirmed, false, "a confirmed address does not vouch for the next one");
    await settle();
    assert.equal(mailsTo(next).length, 1);
    assert.equal(mailsTo(email).length, 1, "nothing more to the old address");

    assert.equal((await me(token)).email, next);
    assert.equal((await me(elsewhere)).email, next, "the other device is still signed in");
    assert.equal((await call(base, "POST", "/v1/auth/login", { body: { email, password: PASSWORD } })).status, 401);
    assert.equal((await call(base, "POST", "/v1/auth/login", { body: { email: next, password: PASSWORD } })).status, 200);

    const done = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: lastCodeFor(next) } });
    assert.equal(done.status, 200);
    assert.equal(done.body.account.emailConfirmed, true);

    // The address it left is free again.
    assert.equal((await call(base, "POST", "/v1/auth/signup", { body: { email, password: PASSWORD } })).status, 201);
    await settle();
  });

  test("codes sent to the old address stop working", async () => {
    const email = unique();
    const next = unique();
    const { token, account } = await signup(email);
    const oldCode = lastCodeFor(email);
    await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    const resetCode = mailsTo(email, "code").at(-1).code;
    assert.equal(await resets(db).countDocuments({ _id: new ObjectId(account.id) }), 1);
    const oldPending = await confirmations(db).findOne({ _id: new ObjectId(account.id) });

    const changed = await call(base, "POST", "/v1/account/email", { token, body: { password: PASSWORD, email: next } });
    assert.equal(changed.status, 200);
    await settle();

    const stale = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: oldCode } });
    assert.equal(stale.status, 400);
    // Even were the old code still the one on file (a confirmation racing the
    // change), it is hashed with the address it went to and fits no other.
    await confirmations(db).replaceOne({ _id: oldPending._id }, oldPending);
    const raced = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: oldCode } });
    assert.equal(raced.status, 400);
    assert.equal((await me(token)).emailConfirmed, false);

    assert.equal(await resets(db).countDocuments({ _id: new ObjectId(account.id) }), 0);
    const reset = await call(base, "POST", "/v1/auth/reset/confirm", {
      body: { email: next, code: resetCode, password: "a brand new password" }
    });
    assert.equal(reset.status, 400, "a reset code mailed to the old address cannot take the account");
  });
});

describe("accounts and servers from before confirmation", () => {
  test("an account with no confirmation state is reported unconfirmed, and can confirm", async () => {
    const email = unique();
    const now = new Date();
    // As the server wrote accounts before this: no emailConfirmedAt at all.
    await accounts(db).insertOne({
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: "Ada",
      avatar: null,
      createdAt: now,
      passwordChangedAt: now
    });
    const login = await call(base, "POST", "/v1/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
    assert.equal(login.body.account.emailConfirmed, false);
    assert.equal(mailsTo(email).length, 0, "nothing is sent until asked for");

    const token = login.body.token;
    const renamed = await call(base, "PATCH", "/v1/account", { token, body: { displayName: "Ada L" } });
    assert.equal(renamed.body.account.emailConfirmed, false);

    assert.equal((await call(base, "POST", "/v1/account/email/code", { token })).status, 200);
    await settle();
    const done = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: lastCodeFor(email) } });
    assert.equal(done.status, 200);
    assert.equal(done.body.account.emailConfirmed, true);
    assert.equal(done.body.account.displayName, "Ada L");
  });

  test("signing in and resetting a password work as they did, confirmed or not", async () => {
    const email = unique();
    const { token, account } = await signup(email);
    assert.deepEqual(Object.keys(account).sort(), ["avatar", "createdAt", "displayName", "email", "emailConfirmed", "id"]);

    const login = await call(base, "POST", "/v1/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
    assert.deepEqual(Object.keys(login.body).sort(), ["account", "token"]);
    assert.equal((await call(base, "POST", "/v1/auth/login", { body: { email, password: "wrong" } })).status, 401);

    // An unconfirmed address is still sent a reset code, in the reset email.
    const asked = await call(base, "POST", "/v1/auth/reset/request", { body: { email } });
    assert.deepEqual(asked.body, { ok: true, minutes: 15 });
    await settle();
    const mail = mailsTo(email, "code").at(-1);
    assert.match(mail.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(mail.confirmation, undefined);

    // The two codes are not each other's.
    const crossed = await call(base, "POST", "/v1/account/email/confirm", { token, body: { code: mail.code } });
    assert.equal(crossed.status, 400);
    const swapped = await call(base, "POST", "/v1/auth/reset/confirm", {
      body: { email, code: lastCodeFor(email), password: "a brand new password" }
    });
    assert.equal(swapped.status, 400);

    const done = await call(base, "POST", "/v1/auth/reset/confirm", {
      body: { email, code: mail.code, password: "a brand new password" }
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.ok(done.body.token);
    assert.equal((await call(base, "GET", "/v1/auth/me", { token })).status, 401, "old sessions end");
    // A reset leaves confirmation as it was, and the confirmation code alive.
    assert.equal((await me(done.body.token)).emailConfirmed, false);
    const confirmed = await call(base, "POST", "/v1/account/email/confirm", {
      token: done.body.token,
      body: { code: lastCodeFor(email) }
    });
    assert.equal(confirmed.status, 200);
  });

  test("a server with no mailer says nothing about confirmation and refuses its routes", async () => {
    const email = unique();
    const { token, account } = await signup(email, noMail);
    // The account as it was before this existed, so the app shows none of it.
    assert.deepEqual(Object.keys(account).sort(), ["avatar", "createdAt", "displayName", "email", "id"]);
    assert.equal("emailConfirmed" in (await me(token, noMail)), false);
    assert.equal(mailsTo(email).length, 0);
    assert.equal(await confirmations(db).countDocuments({ _id: new ObjectId(account.id) }), 0);

    for (const path of ["/v1/account/email/code", "/v1/account/email/confirm", "/v1/account/email"]) {
      const result = await call(noMail, "POST", path, { token, body: { code: "ABCD-EFGH", password: PASSWORD, email: unique() } });
      assert.equal(result.status, 503, path);
      assert.match(result.body.error, /isn't set up/);
    }
    assert.equal((await me(token, noMail)).email, email);
  });

  test("a script that does not know the message costs the email, and nothing else", async () => {
    const email = unique();
    let created;
    const logged = await quietly(async () => {
      created = await signup(email, older);
    });
    assert.equal(created.account.emailConfirmed, false, "the account is made all the same");
    assert.equal(mailsTo(email).length, 0);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /confirmation email not sent/);

    // Asking again answers as usual; the failure is the server's to log.
    const asked = await quietly(async () => {
      assert.equal((await call(older, "POST", "/v1/account/email/code", { token: created.token })).status, 200);
    });
    assert.equal(asked.length, 1);

    // Reset emails still go through that script.
    await call(older, "POST", "/v1/auth/reset/request", { body: { email } });
    await settle();
    assert.equal(mailsTo(email, "code").length, 1);
  });

  test("deleting the account removes a pending confirmation", async () => {
    const email = unique();
    const { token, account } = await signup(email);
    assert.equal(await confirmations(db).countDocuments({ _id: new ObjectId(account.id) }), 1);
    assert.equal((await call(base, "DELETE", "/v1/account", { token, body: { password: PASSWORD } })).status, 200);
    assert.equal(await confirmations(db).countDocuments({ _id: new ObjectId(account.id) }), 0);
  });

  test("pending confirmations expire by themselves", async () => {
    const indexes = await confirmations(db).indexes();
    const expiry = indexes.find((index) => index.name === "expiry");
    assert.deepEqual(expiry.key, { expiresAt: 1 });
    assert.equal(expiry.expireAfterSeconds, 0);
  });
});

describe("the Apps Script's confirmation email", () => {
  /** Runs deploy/password-reset-mailer.gs with stand-ins for Google's services. */
  function script({ quota = 100 } = {}) {
    const mails = [];
    const sandbox = {
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => "s3cret" }) },
      MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (mail) => mails.push(mail) },
      ContentService: {
        MimeType: { JSON: "json" },
        createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) })
      }
    };
    vm.runInNewContext(readFileSync(new URL("../deploy/password-reset-mailer.gs", import.meta.url), "utf8"), sandbox);
    const post = (body) => sandbox.doPost({ postData: { contents: JSON.stringify({ secret: "s3cret", ...body }) } });
    return { mails, post };
  }

  test("is fixed text around the code, to the address given", () => {
    const { mails, post } = script();
    const reply = post({
      kind: "confirm",
      to: "ada@example.com",
      confirmation: "ABCD-2345",
      minutes: 30,
      subject: "Anything else",
      text: "is not passed on"
    });
    assert.deepEqual(reply, { ok: true });
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, "ada@example.com");
    assert.equal(mails[0].subject, "Confirm your email for Leaflet: ABCD-2345");
    assert.match(mails[0].body, /confirm this email address/);
    assert.match(mails[0].body, /ABCD-2345/);
    assert.match(mails[0].body, /30 minutes/);
    assert.match(mails[0].htmlBody, /ABCD-2345/);
    assert.equal(/Anything else|not passed on|new password/.test(mails[0].body + mails[0].htmlBody), false);
  });

  test("is refused without a well-formed code, and never sent as a reset", () => {
    const { mails, post } = script();
    assert.deepEqual(post({ kind: "confirm", to: "ada@example.com", confirmation: "<b>hello</b>" }), { ok: false, error: "bad request" });
    assert.deepEqual(post({ kind: "confirm", to: "ada@example.com", code: "ABCD-2345" }), { ok: false, error: "bad request" });
    assert.deepEqual(post({ kind: "confirm", to: "not an address", confirmation: "ABCD-2345" }), { ok: false, error: "bad request" });
    assert.equal(mails.length, 0);
  });

  test("leaves the reset emails as they were", () => {
    const { mails, post } = script();
    assert.deepEqual(post({ kind: "code", to: "ada@example.com", code: "ABCD-2345", minutes: 15 }), { ok: true });
    assert.deepEqual(post({ kind: "limit", to: "ada@example.com", availableOn: "12 March 2027" }), { ok: true });
    assert.equal(mails[0].subject, "Your Leaflet code: ABCD-2345");
    assert.match(mails[0].body, /set a new password/);
    assert.equal(mails[1].subject, "About resetting your Leaflet password");
  });
});
