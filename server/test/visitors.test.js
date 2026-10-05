import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";
import { boardStamp, cachedVisitors, forgetBoards, forgetVisitors, rememberVisitors } from "../src/boardCache.js";
import { VISITOR_LIMIT, pickVisitors } from "../src/community.js";

/**
 * Visitors: the readers a reader follows who read today, for a friend's Pip
 * to come by in the app. Against a throwaway database (TEST_MONGO_URI,
 * default mongodb://127.0.0.1:27017) dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = isoWeekKey();
const dayKey = (offset = 0) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const TODAY = dayKey();
const YESTERDAY = dayKey(-1);
const TOMORROW = dayKey(1);
const PASSWORD = "correct horse battery";
const ROOMY = {
  ip: { limit: 1000, windowMs: 15 * MINUTE },
  email: { limit: 100, windowMs: 15 * MINUTE },
  signup: { limit: 1000, windowMs: 60 * MINUTE },
  social: { limit: 1000, windowMs: 15 * MINUTE },
  search: { limit: 1000, windowMs: 5 * MINUTE },
  visitors: { limit: 1000, windowMs: 15 * MINUTE }
};

let db;
let server;
let base;

const listen = (app) =>
  new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

before(async () => {
  db = await connect(uri, dbName);
  server = await listen(createApp(db, { limits: ROOMY }));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.dropDatabase();
  await close();
});

async function call(method, path, { token, body, at = base } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(at + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, retryAfter: response.headers.get("retry-after") };
}

/**
 * A signed-up reader with a profile. Public, and has read today, unless told
 * otherwise; `readDay: undefined` is an app from before visitors, which never
 * sends one.
 */
async function reader(options = {}) {
  const { visibility = "public", minutes = 30, streak = 2, prefix = "v" } = options;
  const readDay = "readDay" in options ? options.readDay : TODAY;
  const email = `v-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: minutes, streak, readDay }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: new ObjectId(signup.body.account.id) };
}

const follow = async (from, to) => {
  const answer = await call("POST", `/v1/follows/${to.handle}`, { token: from.token });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
};
/** Friends: each follows the other. Only friends visit. */
const befriend = async (a, b) => {
  await follow(a, b);
  await follow(b, a);
};
const visitors = (who, day = TODAY) => call("GET", `/v1/visitors?day=${day}&week=${WEEK}`, { token: who.token });
const handles = (answer) => answer.body.visitors.map((row) => row.handle).sort();
const stored = (id) => db.collection("profiles").findOne({ _id: id });

describe("visitors", () => {
  test("the readers you follow who read today, with what their profile already shows", async () => {
    const me = await reader();
    const today = await reader({ minutes: 95.4, streak: 7 });
    const yesterday = await reader({ readDay: YESTERDAY });
    const oldApp = await reader({ readDay: undefined });
    const stranger = await reader();
    for (const friend of [today, yesterday, oldApp]) {
      await befriend(me, friend);
    }
    await call("PATCH", "/v1/account", { token: today.token, body: { avatar: "ghost.ghost" } });

    const answer = await visitors(me);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.day, TODAY);
    assert.deepEqual(answer.body.visitors, [
      { handle: today.handle, displayName: today.handle.toUpperCase(), pipSeed: today.handle, avatar: "ghost.ghost", weekMinutes: 95, streak: 7 }
    ]);
    // The day a reader read is compared, never passed on.
    assert.equal(JSON.stringify(answer.body).includes("readDay"), false);
    assert.equal(JSON.stringify(answer.body).includes(stranger.handle), false, "not followed");

    // Nor is it in any answer that was there before.
    for (const path of [`/v1/profile/${today.handle}`, `/v1/leaderboard?week=${WEEK}`, `/v1/search?q=${today.handle}`]) {
      assert.equal(JSON.stringify((await call("GET", path, { token: me.token })).body).includes("readDay"), false, path);
    }
    assert.equal("readDay" in (await call("GET", "/v1/profile/me", { token: today.token })).body, false);
  });

  test("a follow one way is not a friend: a visit needs both to follow the other", async () => {
    const me = await reader();
    const admired = await reader({ minutes: 30 });
    await follow(me, admired);
    assert.deepEqual(handles(await visitors(me)), [], "I follow them; they have not followed back");
    assert.deepEqual(handles(await visitors(admired)), [], "and I do not turn up at theirs");
    // They follow back: friends now, at once, on both sides.
    await follow(admired, me);
    assert.deepEqual(handles(await visitors(me)), [admired.handle]);
    assert.deepEqual(handles(await visitors(admired)), [me.handle]);
    // Either one unfollowing ends it for both, at once.
    await call("DELETE", `/v1/follows/${me.handle}`, { token: admired.token });
    assert.deepEqual(handles(await visitors(me)), []);
    assert.deepEqual(handles(await visitors(admired)), []);
  });

  test("the reader asking is never their own visitor", async () => {
    const me = await reader();
    const friend = await reader();
    await befriend(me, friend);
    // A follow of oneself cannot be made through the API; one that got in
    // some other way still brings nobody to their own door.
    await db.collection("follows").insertOne({ followerId: me.id, followeeId: me.id, createdAt: new Date() });
    forgetVisitors(me.id.toHexString());
    assert.deepEqual(handles(await visitors(me)), [friend.handle]);
  });

  test("an empty result: nobody followed, or nobody who read today", async () => {
    const me = await reader();
    assert.deepEqual((await visitors(me)).body, { day: TODAY, visitors: [] });
    const friend = await reader({ readDay: YESTERDAY });
    await befriend(me, friend);
    assert.deepEqual((await visitors(me)).body, { day: TODAY, visitors: [] });
  });

  test("a private reader neither visits nor is visited", async () => {
    const me = await reader();
    const friend = await reader();
    await follow(me, friend);
    await follow(friend, me);
    assert.deepEqual(handles(await visitors(me)), [friend.handle]);

    // The friend un-shares: gone from the very next answer, and the day they
    // read leaves the server with the rest of their figures.
    await call("PUT", "/v1/profile/me", { token: friend.token, body: { visibility: "private" } });
    assert.deepEqual(handles(await visitors(me)), []);
    assert.equal((await stored(friend.id)).readDay, null);
    // A publish already on its way does not bring it back.
    const late = await call("PUT", "/v1/profile/me", { token: friend.token, body: { weekKey: WEEK, weekMinutes: 40, readDay: TODAY } });
    assert.equal(late.status, 200);
    assert.equal((await stored(friend.id)).readDay, null);
    assert.deepEqual(handles(await visitors(me)), []);
    // And they have no visitors themselves, though they still follow a reader who read today.
    assert.deepEqual((await visitors(friend)).body, { day: TODAY, visitors: [] });

    // Shared again, and reading again: back.
    await call("PUT", "/v1/profile/me", { token: friend.token, body: { visibility: "public", weekKey: WEEK, weekMinutes: 40, readDay: TODAY } });
    assert.deepEqual(handles(await visitors(me)), [friend.handle]);
    assert.deepEqual(handles(await visitors(friend)), [me.handle]);

    // A reader who was never public is not shown even if a follow and a day
    // were written behind the API's back.
    const shy = await reader({ visibility: "private" });
    assert.equal((await stored(shy.id)).readDay ?? null, null, "a private profile's day is not kept");
    await db.collection("follows").insertOne({ followerId: me.id, followeeId: shy.id, createdAt: new Date() });
    await db.collection("follows").insertOne({ followerId: shy.id, followeeId: me.id, createdAt: new Date() });
    await db.collection("profiles").updateOne({ _id: shy.id }, { $set: { readDay: TODAY } });
    forgetBoards();
    assert.equal(JSON.stringify((await visitors(me)).body).includes(shy.handle), false);

    // A friend who deletes their account stops visiting.
    assert.equal((await call("DELETE", "/v1/account", { token: friend.token, body: { password: PASSWORD } })).status, 200);
    assert.deepEqual(handles(await visitors(me)), []);
  });

  test("the day boundary: a friend visits only on the day they read", async () => {
    const me = await reader();
    const friend = await reader({ readDay: TODAY });
    await befriend(me, friend);
    assert.deepEqual(handles(await visitors(me, TODAY)), [friend.handle]);
    // Asked about another day (a reader whose clock is already in tomorrow,
    // or still in yesterday), the same friend has not read on it.
    assert.deepEqual(handles(await visitors(me, TOMORROW)), []);
    assert.deepEqual(handles(await visitors(me, YESTERDAY)), []);

    // The friend's day turns over and they read again: today's visit is over.
    await call("PUT", "/v1/profile/me", { token: friend.token, body: { weekKey: WEEK, weekMinutes: 31, readDay: TOMORROW } });
    assert.deepEqual(handles(await visitors(me, TODAY)), []);
    assert.deepEqual(handles(await visitors(me, TOMORROW)), [friend.handle]);
    // A publish without a day (nothing read yet on the new day) leaves the last one standing.
    await call("PUT", "/v1/profile/me", { token: friend.token, body: { weekKey: WEEK, weekMinutes: 31 } });
    assert.equal((await stored(friend.id)).readDay, TOMORROW);
    // And null clears it.
    await call("PUT", "/v1/profile/me", { token: friend.token, body: { readDay: null } });
    assert.deepEqual(handles(await visitors(me, TOMORROW)), []);
  });

  test("days no clock could be in are refused, asked about or published", async () => {
    const me = await reader();
    for (const day of ["", "2020-01-01", dayKey(-3), dayKey(3), "today", "2026-13-40", `${TODAY}T00:00`]) {
      const answer = await call("GET", `/v1/visitors?day=${encodeURIComponent(day)}`, { token: me.token });
      assert.equal(answer.status, 400, `day=${day}`);
    }
    assert.equal((await call("GET", "/v1/visitors", { token: me.token })).status, 400, "no day at all");
    for (const readDay of ["2020-01-01", dayKey(-3), 20261004, "", { $gt: "" }]) {
      const answer = await call("PUT", "/v1/profile/me", { token: me.token, body: { readDay } });
      assert.equal(answer.status, 400, `readDay=${JSON.stringify(readDay)}`);
    }
    assert.equal((await stored(me.id)).readDay, TODAY, "a refused day changes nothing");
  });

  test("signed out, there are no visitors to ask about", async () => {
    const gone = await reader();
    await call("POST", "/v1/auth/logout", { token: gone.token });
    for (const token of [undefined, "x".repeat(43), gone.token]) {
      assert.equal((await call("GET", `/v1/visitors?day=${TODAY}`, { token })).status, 401);
    }
  });

  test("a handful, and the same handful all day", async () => {
    const me = await reader();
    const friends = [];
    for (let index = 0; index < VISITOR_LIMIT + 3; index += 1) {
      const friend = await reader({ minutes: 10 + index });
      await befriend(me, friend);
      friends.push(friend);
    }
    const first = await visitors(me);
    assert.equal(first.body.visitors.length, VISITOR_LIMIT);
    assert.ok(first.body.visitors.every((row) => friends.some((friend) => friend.handle === row.handle)));
    // Worked out afresh (nothing kept), it is the same list in the same order.
    forgetBoards();
    assert.deepEqual((await visitors(me)).body, first.body);

    // Unfollowing one of them takes them off at once, and another takes the place.
    const dropped = first.body.visitors[0].handle;
    await call("DELETE", `/v1/follows/${dropped}`, { token: me.token });
    const after = await visitors(me);
    assert.equal(after.body.visitors.length, VISITOR_LIMIT);
    assert.equal(handles(after).includes(dropped), false);
  });

  test("the pick is by day and reader, not by minutes or name", () => {
    const rows = Array.from({ length: 12 }, () => ({ _id: new ObjectId() }));
    const me = new ObjectId();
    const ids = (list) => list.map((row) => row._id.toHexString());
    const today = ids(pickVisitors(rows, "2026-10-04", me));
    assert.equal(today.length, VISITOR_LIMIT);
    assert.deepEqual(ids(pickVisitors([...rows].reverse(), "2026-10-04", me)), today, "whatever order they were read in");
    // Over a fortnight, and for another reader, the handful changes.
    const days = Array.from({ length: 14 }, (_, index) => `2026-10-${String(index + 5).padStart(2, "0")}`);
    assert.ok(days.some((day) => ids(pickVisitors(rows, day, me)).join() !== today.join()));
    assert.ok(days.some((day) => ids(pickVisitors(rows, day, new ObjectId())).join() !== ids(pickVisitors(rows, day, me)).join()));
    assert.deepEqual(pickVisitors([], "2026-10-04", me), []);
    assert.equal(pickVisitors(rows.slice(0, 2), "2026-10-04", me).length, 2);
  });

  test("an answer is kept for a moment, and any profile change clears it", async () => {
    const me = await reader();
    const friend = await reader();
    await befriend(me, friend);
    assert.deepEqual(handles(await visitors(me)), [friend.handle]);
    // Changed behind the API's back: the kept answer still stands, for the day it was asked about.
    await db.collection("profiles").updateOne({ _id: friend.id }, { $set: { readDay: YESTERDAY } });
    assert.deepEqual(handles(await visitors(me)), [friend.handle]);
    // A change made through the API (anyone's) clears it.
    await call("PUT", "/v1/profile/me", { token: me.token, body: { weekKey: WEEK, weekMinutes: 33, readDay: TODAY } });
    assert.deepEqual(handles(await visitors(me)), []);
    assert.deepEqual(handles(await visitors(me, YESTERDAY)), [friend.handle]);
  });

  test("a list read while a profile changed is not kept", () => {
    forgetBoards();
    const stamp = boardStamp();
    // A friend goes private while the database is answering.
    forgetBoards();
    rememberVisitors("reader", "2026-10-04:2026-W40", [{ handle: "maya" }], stamp);
    assert.equal(cachedVisitors("reader", "2026-10-04:2026-W40"), null);
    rememberVisitors("reader", "2026-10-04:2026-W40", [{ handle: "maya" }], boardStamp());
    assert.deepEqual(cachedVisitors("reader", "2026-10-04:2026-W40"), [{ handle: "maya" }]);
    assert.equal(cachedVisitors("reader", "2026-10-05:2026-W41"), null, "another day");
    rememberVisitors("reader", "2026-10-04:2026-W40", [], boardStamp());
    forgetVisitors("reader");
    assert.equal(cachedVisitors("reader", "2026-10-04:2026-W40"), null);
  });

  test("asking is rate limited per account", async () => {
    const strict = await listen(createApp(db, { limits: { ...ROOMY, visitors: { limit: 2, windowMs: 15 * MINUTE } } }));
    const at = `http://127.0.0.1:${strict.address().port}`;
    try {
      const me = await reader();
      const other = await reader();
      const ask = (who) => call("GET", `/v1/visitors?day=${TODAY}`, { token: who.token, at });
      assert.equal((await ask(me)).status, 200);
      assert.equal((await ask(me)).status, 200);
      const refused = await ask(me);
      assert.equal(refused.status, 429);
      assert.ok(Number(refused.retryAfter) > 0);
      // One reader's asking does not use up another's.
      assert.equal((await ask(other)).status, 200);
    } finally {
      await new Promise((resolve) => strict.close(resolve));
    }
  });
});
