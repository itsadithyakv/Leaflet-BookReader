import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";

/**
 * Raids on a friend's camp: who may raid whom, one a day, the stars, how
 * many wait, who may mark them seen, and the switch that turns them off,
 * against a throwaway database (TEST_MONGO_URI, default
 * mongodb://127.0.0.1:27017) dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = isoWeekKey();
const TODAY = new Date().toISOString().slice(0, 10);
const PASSWORD = "correct horse battery";
const CAMP = {
  levels: { burrow: 3, oak: 2, store: 2, fence: 1, tower: 1, hut: 2 },
  yard: [{ kind: "workshop", level: 1 }, { kind: null, level: 0 }],
  camps: 7,
  banners: 2,
  trophies: 14,
  spots: { burrow: [120, 60] },
  walls: [[100, 50]],
  guards: [1, 0, 0, 0, 0, 0, 0]
};

let db;
let server;
let base;

before(async () => {
  db = await connect(uri, dbName);
  const roomy = (windowMs) => ({ limit: 100_000, windowMs });
  const app = createApp(db, {
    limits: {
      ip: roomy(15 * MINUTE),
      email: roomy(15 * MINUTE),
      signup: roomy(60 * MINUTE),
      social: roomy(15 * MINUTE),
      search: roomy(5 * MINUTE),
      visitors: roomy(15 * MINUTE),
      library: roomy(15 * MINUTE)
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

/** A signed-up reader with a profile and a camp on it; public unless told otherwise, and `camp: null` for none. */
async function reader({ visibility = "public", prefix = "r", camp = CAMP, extra = {} } = {}) {
  const email = `r-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: 30, streak: 2, readDay: TODAY, camp, ...extra }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: new ObjectId(signup.body.account.id) };
}

const save = (who, body) => call("PUT", "/v1/profile/me", { token: who.token, body });

/** `a` follows `b`: at once if `b` is public, by a request `b` accepts otherwise. */
async function follow(a, b) {
  const asked = await call("POST", `/v1/follows/${b.handle}`, { token: a.token });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  if (asked.body.requested) {
    const accepted = await call("POST", `/v1/follow-requests/${a.handle}/accept`, { token: b.token });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  }
}

async function befriend(a, b) {
  await follow(a, b);
  await follow(b, a);
}

const raids = () => db.collection("raids");
const count = (filter) => raids().countDocuments(filter);
const raid = (from, to, stars = 2, body = {}) => call("POST", "/v1/raids", { token: from.token, body: { to: to.handle, stars, ...body } });
const targets = async (who) => (await call("GET", "/v1/raids/targets", { token: who.token })).body.targets;
const waiting = async (who) => (await call("GET", "/v1/raids", { token: who.token })).body.raids;
const ack = (who, ids) => call("POST", "/v1/raids/ack", { token: who.token, body: { ids } });
/** Moves a raid back `days`, as if it had been made then. */
const agedRaid = (from, to, days) => {
  const then = new Date(Date.now() - days * DAY);
  return raids().updateMany({ fromId: from.id, toId: to.id, day: TODAY }, { $set: { createdAt: then, day: then.toISOString().slice(0, 10) } });
};

describe("who may raid whom", () => {
  test("only readers who follow each other, and only a camp that is shown", async () => {
    const raider = await reader({ prefix: "raid" });
    const friend = await reader();
    const stranger = await reader();

    // No follow, then a follow one way only, either way round: not friends yet.
    assert.deepEqual(await targets(raider), []);
    assert.equal((await raid(raider, friend)).status, 403);
    await follow(raider, friend);
    assert.equal((await raid(raider, friend)).status, 403);
    assert.equal((await raid(friend, raider)).status, 403);
    assert.deepEqual(await targets(raider), []);
    assert.deepEqual(await targets(friend), []);
    assert.equal(await count({}), 0);
    await follow(friend, raider);

    const listed = await targets(raider);
    assert.deepEqual(listed, [{ handle: friend.handle, name: friend.handle.toUpperCase(), camp: CAMP, raidedToday: false }]);
    const made = await raid(raider, friend, 2, { to: `@${friend.handle}` });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(Object.keys(made.body), ["raid"]);
    assert.match(made.body.raid.id, /^[0-9a-f]{24}$/);
    assert.equal((await targets(raider))[0].raidedToday, true);
    // Their friend has not raided them, and a stranger has nobody to raid.
    assert.equal((await targets(friend))[0].raidedToday, false);
    assert.deepEqual(await targets(stranger), []);

    // What is kept: who, whom, the raider as they were called, the stars and the time. No camp.
    const stored = await raids().findOne({ _id: new ObjectId(made.body.raid.id) });
    assert.deepEqual(Object.keys(stored).sort(), ["_id", "by", "createdAt", "day", "fromId", "name", "seenAt", "stars", "toId"]);
    assert.ok(stored.fromId.equals(raider.id) && stored.toId.equals(friend.id));
    assert.deepEqual([stored.by, stored.name, stored.stars, stored.day, stored.seenAt], [raider.handle, raider.handle.toUpperCase(), 2, TODAY, null]);
    assert.ok(stored.createdAt instanceof Date);

    // It waits for the reader raided, and for nobody else.
    const mine = await waiting(friend);
    assert.deepEqual(mine, [{ id: made.body.raid.id, by: raider.handle, name: raider.handle.toUpperCase(), stars: 2, at: stored.createdAt.toISOString() }]);
    assert.deepEqual(await waiting(raider), []);
    assert.deepEqual(await waiting(stranger), []);

    assert.equal((await raid(raider, raider)).status, 400);
    assert.equal((await raid(raider, { handle: "nobody-here" })).status, 404);
    assert.equal((await raid(raider, stranger)).status, 403);
    assert.equal((await call("POST", "/v1/raids", { body: { to: friend.handle, stars: 1 } })).status, 401);
    assert.equal((await call("GET", "/v1/raids")).status, 401);
    assert.equal((await call("GET", "/v1/raids/targets")).status, 401);
    assert.equal((await call("POST", "/v1/raids/ack", { body: { ids: [] } })).status, 401);
  });

  test("a reader with no name is called by their handle", async () => {
    const raider = await reader({ extra: { displayName: null } });
    const friend = await reader({ extra: { displayName: null } });
    await befriend(raider, friend);
    assert.equal((await targets(raider))[0].name, friend.handle);
    assert.equal((await raid(raider, friend)).status, 201);
    assert.deepEqual((await waiting(friend)).map((row) => [row.by, row.name]), [[raider.handle, raider.handle]]);
  });

  test("a friend with no camp is not listed and cannot be raided", async () => {
    const raider = await reader();
    const camper = await reader();
    const bare = await reader({ camp: null });
    await befriend(raider, camper);
    await befriend(raider, bare);
    assert.deepEqual((await targets(raider)).map((row) => row.handle), [camper.handle]);
    assert.equal((await raid(raider, bare)).status, 409);
    // A reader with no camp of their own may still raid a friend's.
    assert.equal((await raid(bare, raider)).status, 201);
    // The camp taken off the profile takes its reader off the list.
    await save(camper, { camp: null });
    assert.deepEqual(await targets(raider), []);
    assert.equal((await raid(raider, camper)).status, 409);
  });

  test("a followers-only reader raids and is raided, once each follows the other", async () => {
    const quiet = await reader({ visibility: "followers" });
    const friend = await reader();
    await follow(quiet, friend);
    await call("POST", `/v1/follows/${quiet.handle}`, { token: friend.token });
    // Asked, not accepted: not a follow.
    assert.deepEqual(await targets(friend), []);
    assert.equal((await raid(friend, quiet)).status, 403);
    await call("POST", `/v1/follow-requests/${friend.handle}/accept`, { token: quiet.token });
    assert.deepEqual((await targets(friend)).map((row) => row.handle), [quiet.handle]);
    assert.equal((await raid(friend, quiet)).status, 201);
    assert.equal((await raid(quiet, friend)).status, 201);
    assert.equal((await waiting(quiet))[0].by, friend.handle);
  });

  test("a reader who stops sharing neither raids nor is raided, and a raid of theirs is not handed over", async () => {
    const raider = await reader();
    const friend = await reader();
    await befriend(raider, friend);
    assert.equal((await raid(raider, friend)).status, 201);
    assert.equal((await waiting(friend)).length, 1);

    await save(raider, { visibility: "private" });
    assert.deepEqual(await targets(raider), []);
    assert.deepEqual(await targets(friend), []);
    assert.equal((await raid(friend, raider)).status, 404);
    await agedRaid(raider, friend, 1);
    assert.equal((await raid(raider, friend)).status, 403);
    assert.deepEqual(await waiting(friend), []);
    // Kept, and hidden: it is there again if they share again.
    await save(raider, { visibility: "public" });
    assert.equal((await waiting(friend)).length, 1);
  });

  test("a block ends it, and a raid already waiting is not handed over", async () => {
    const raider = await reader();
    const friend = await reader();
    await befriend(raider, friend);
    assert.equal((await raid(raider, friend)).status, 201);
    assert.equal((await call("POST", `/v1/blocks/${raider.handle}`, { token: friend.token })).status, 200);
    assert.deepEqual(await waiting(friend), []);
    assert.deepEqual(await targets(raider), []);
    await agedRaid(raider, friend, 1);
    assert.equal((await raid(raider, friend)).status, 403);
    assert.equal((await raid(friend, raider)).status, 403);
  });

  test("among several readers followed, only the friends are listed, each with their own raidedToday", async () => {
    const raider = await reader();
    const first = await reader({ prefix: "a" });
    const second = await reader({ prefix: "b" });
    const third = await reader({ prefix: "c" });
    const followed = await reader();
    const follower = await reader();
    for (const friend of [first, second, third]) {
      await befriend(raider, friend);
    }
    // A follow one way, either way round, beside the friends: neither is one.
    await follow(raider, followed);
    await follow(follower, raider);

    assert.equal((await raid(raider, second)).status, 201);
    // A raid on the raider, and one between two of their friends, are not raids the raider made.
    assert.equal((await raid(first, raider)).status, 201);
    await befriend(first, third);
    assert.equal((await raid(first, third)).status, 201);
    assert.deepEqual(
      (await targets(raider)).map((row) => [row.handle, row.raidedToday]),
      [[first.handle, false], [second.handle, true], [third.handle, false]]
    );
  });

  test("the list is by handle, and fifty at most", async () => {
    const raider = await reader();
    // Fifty-two friends, written straight in: a profile with a camp, and a follow each way.
    const friends = Array.from({ length: 52 }, (_, index) => ({
      _id: new ObjectId(),
      handle: `zz${String(index).padStart(2, "0")}${randomBytes(3).toString("hex")}`,
      displayName: null,
      visibility: "public",
      camp: CAMP
    }));
    await db.collection("profiles").insertMany(friends);
    await db.collection("follows").insertMany(
      friends.flatMap((friend) => [
        { followerId: raider.id, followeeId: friend._id, createdAt: new Date() },
        { followerId: friend._id, followeeId: raider.id, createdAt: new Date() }
      ])
    );
    const listed = await targets(raider);
    assert.equal(listed.length, 50);
    const handles = friends.map((friend) => friend.handle).sort();
    assert.deepEqual(listed.map((row) => row.handle), handles.slice(0, 50));
    assert.deepEqual(Object.keys(listed[0]).sort(), ["camp", "handle", "name", "raidedToday"]);
  });
});

describe("one raid a day", () => {
  test("a second on the same camp the same day is refused, and says when to come back", async () => {
    const raider = await reader();
    const friend = await reader();
    const other = await reader();
    await befriend(raider, friend);
    await befriend(raider, other);

    assert.equal((await raid(raider, friend, 3)).status, 201);
    const second = await raid(raider, friend, 1);
    assert.equal(second.status, 429);
    assert.ok(Number(second.retryAfter) > 0 && Number(second.retryAfter) <= 24 * 60 * 60);
    assert.equal(await count({ fromId: raider.id, toId: friend.id }), 1);
    assert.equal((await waiting(friend))[0].stars, 3);

    // Another camp is another allowance, and so is the friend's raid back.
    assert.equal((await raid(raider, other)).status, 201);
    assert.equal((await raid(friend, raider)).status, 201);
    assert.deepEqual(
      (await targets(raider)).map((row) => [row.handle, row.raidedToday]).sort(),
      [[friend.handle, true], [other.handle, true]].sort()
    );

    // Seen by their app, it still stands against today.
    const [seen] = await waiting(friend);
    assert.equal((await ack(friend, [seen.id])).status, 200);
    assert.equal((await raid(raider, friend)).status, 429);

    // Yesterday's raid does not count against today.
    await agedRaid(raider, friend, 1);
    assert.equal((await targets(raider)).find((row) => row.handle === friend.handle).raidedToday, false);
    assert.equal((await raid(raider, friend)).status, 201);
    assert.equal(await count({ fromId: raider.id, toId: friend.id }), 2);
  });

  test("two at the same moment are one", async () => {
    const raider = await reader();
    const friend = await reader();
    await befriend(raider, friend);
    const answers = await Promise.all(Array.from({ length: 6 }, () => raid(raider, friend)));
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [201, 429, 429, 429, 429, 429]);
    assert.equal(await count({ fromId: raider.id, toId: friend.id }), 1);
  });
});

describe("the stars", () => {
  test("a whole number from 0 to 3, and nothing else", async () => {
    const raider = await reader();
    const friend = await reader();
    await befriend(raider, friend);
    for (const stars of [-1, 4, 1.5, "2", null, true, [3], 1e9]) {
      assert.equal((await raid(raider, friend, stars)).status, 400, JSON.stringify(stars));
    }
    assert.equal((await call("POST", "/v1/raids", { token: raider.token, body: { to: friend.handle } })).status, 400);
    assert.equal(await count({ fromId: raider.id }), 0);

    // A raid that won nothing is still a raid.
    assert.equal((await raid(raider, friend, 0)).status, 201);
    await agedRaid(raider, friend, 1);
    assert.equal((await raid(raider, friend, 3)).status, 201);
    assert.deepEqual((await waiting(friend)).map((row) => row.stars), [0, 3]);
  });
});

describe("the raids waiting", () => {
  test("twenty at most: a newer one pushes the oldest out", async () => {
    const camper = await reader();
    const regular = await reader();
    const late = await reader();
    await befriend(regular, camper);
    await befriend(late, camper);
    // Twenty from one friend, a day apart, written straight in.
    const old = Array.from({ length: 20 }, (_, index) => {
      const then = new Date(Date.now() - (20 - index) * DAY);
      return { fromId: regular.id, toId: camper.id, by: regular.handle, name: "Regular", stars: index % 4, day: then.toISOString().slice(0, 10), createdAt: then, seenAt: null };
    });
    await raids().insertMany(old);
    const before = await waiting(camper);
    assert.equal(before.length, 20);
    // Oldest first.
    assert.deepEqual(before.map((row) => row.at), old.map((row) => row.createdAt.toISOString()));

    const made = await raid(late, camper, 1);
    assert.equal(made.status, 201);
    const now = await waiting(camper);
    assert.equal(now.length, 20);
    assert.equal(now.at(-1).id, made.body.raid.id);
    assert.equal(now.some((row) => row.id === before[0].id), false);
    assert.deepEqual(now.slice(0, 19).map((row) => row.id), before.slice(1).map((row) => row.id));
    // Pushed out, not deleted: marked as seen.
    assert.equal(await count({ toId: camper.id }), 21);
    assert.equal(await count({ toId: camper.id, seenAt: null }), 20);
    assert.ok((await raids().findOne({ _id: old[0]._id })).seenAt instanceof Date);

    // One seen makes room, so the next pushes nothing out.
    await ack(camper, [now[0].id]);
    assert.equal((await raid(regular, camper)).status, 201);
    assert.equal((await waiting(camper)).length, 20);
    assert.equal(await count({ toId: camper.id, seenAt: null }), 20);
  });

  test("of several, the ones from a reader blocked, blocking or no longer sharing are left out, and the rest handed over", async () => {
    const camper = await reader();
    const early = await reader();
    const unwelcome = await reader();
    const unwilling = await reader();
    const gone = await reader();
    const late = await reader();
    for (const raider of [early, unwelcome, unwilling, gone, late]) {
      await befriend(raider, camper);
      assert.equal((await raid(raider, camper)).status, 201);
    }
    assert.deepEqual((await waiting(camper)).map((row) => row.by), [early, unwelcome, unwilling, gone, late].map((raider) => raider.handle));

    // A block either way round, and a raider who stops sharing.
    assert.equal((await call("POST", `/v1/blocks/${unwelcome.handle}`, { token: camper.token })).status, 200);
    assert.equal((await call("POST", `/v1/blocks/${camper.handle}`, { token: unwilling.token })).status, 200);
    await save(gone, { visibility: "private" });
    assert.deepEqual((await waiting(camper)).map((row) => row.by), [early.handle, late.handle]);
    // Nothing is marked seen by being left out.
    assert.equal(await count({ toId: camper.id, seenAt: null }), 5);

    // A block is what a raid is refused for, before the follow it also ended, and in the same words to both.
    for (const [from, to] of [[camper, unwelcome], [unwelcome, camper], [camper, unwilling], [unwilling, camper]]) {
      const refused = await raid(from, to);
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error, "You can't interact with this reader.");
    }
  });

  test("are marked seen by the reader raided, and by nobody else", async () => {
    const camper = await reader();
    const raider = await reader();
    const second = await reader();
    const stranger = await reader();
    await befriend(raider, camper);
    await befriend(second, camper);
    await befriend(camper, stranger);
    const first = (await raid(raider, camper)).body.raid.id;
    const next = (await raid(second, camper)).body.raid.id;
    const theirs = (await raid(camper, stranger)).body.raid.id;

    // The raider, another raider and a stranger each name it: nothing happens.
    for (const who of [raider, second, stranger]) {
      const answer = await ack(who, [first, next]);
      assert.equal(answer.status, 200);
      assert.deepEqual(answer.body, { acknowledged: true });
    }
    assert.deepEqual((await waiting(camper)).map((row) => row.id), [first, next]);
    // Nor does naming a raid one made mark it for the reader it was on.
    await ack(camper, [theirs]);
    assert.deepEqual((await waiting(stranger)).map((row) => row.id), [theirs]);

    // Their own, with ids that are nobody's raid beside it.
    assert.deepEqual((await ack(camper, [first, "a".repeat(24), theirs])).body, { acknowledged: true });
    assert.deepEqual((await waiting(camper)).map((row) => row.id), [next]);
    const seenAt = (await raids().findOne({ _id: new ObjectId(first) })).seenAt;
    assert.ok(seenAt instanceof Date);
    // Twice is the same as once.
    assert.equal((await ack(camper, [first])).status, 200);
    assert.equal((await raids().findOne({ _id: new ObjectId(first) })).seenAt.getTime(), seenAt.getTime());
    assert.equal((await ack(camper, [])).status, 200);
    assert.deepEqual((await waiting(camper)).map((row) => row.id), [next]);

    for (const ids of [undefined, null, "all", first, { id: first }, ["not-an-id"], [first, 7], [null], Array.from({ length: 101 }, () => first)]) {
      assert.equal((await ack(camper, ids)).status, 400, JSON.stringify(ids)?.slice(0, 60));
    }
    assert.deepEqual((await waiting(camper)).map((row) => row.id), [next]);
  });

  test("expire after thirty days, seen or not", async () => {
    const indexes = await raids().indexes();
    const expiry = indexes.find((index) => index.name === "expiry");
    assert.deepEqual(expiry.key, { createdAt: 1 });
    assert.equal(expiry.expireAfterSeconds, 30 * 24 * 60 * 60);
    const once = indexes.find((index) => index.name === "once_a_day");
    assert.deepEqual([once.key, once.unique], [{ fromId: 1, toId: 1, day: 1 }, true]);
  });
});

describe("the switch", () => {
  test("is on until turned off, takes only true or false, and outlasts a change of visibility", async () => {
    const camper = await reader();
    const mine = async () => (await call("GET", "/v1/profile/me", { token: camper.token })).body.raidable;
    assert.equal(await mine(), true);
    assert.equal("raidable" in (await db.collection("profiles").findOne({ _id: camper.id })), false);
    for (const value of ["no", 0, null, {}]) {
      assert.equal((await save(camper, { raidable: value })).status, 400, JSON.stringify(value));
    }
    assert.equal(await mine(), true);

    const off = await save(camper, { raidable: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.raidable, false);
    // A save that does not name it leaves it alone, and so does going private and coming back.
    assert.equal((await save(camper, { streak: 5 })).body.raidable, false);
    assert.equal((await save(camper, { visibility: "private" })).body.raidable, false);
    assert.equal((await save(camper, { visibility: "public", camp: CAMP })).body.raidable, false);
    assert.equal((await save(camper, { raidable: true })).body.raidable, true);
    // It is the reader's own business: not on the card others are shown.
    assert.equal("raidable" in (await call("GET", `/v1/profile/${camper.handle}`)).body, false);
  });

  test("off, the reader is on nobody's list and cannot be raided; on again, they can", async () => {
    const camper = await reader();
    const raider = await reader();
    await befriend(raider, camper);
    assert.deepEqual((await targets(raider)).map((row) => row.handle), [camper.handle]);

    await save(camper, { raidable: false });
    assert.deepEqual(await targets(raider), []);
    const refused = await raid(raider, camper);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /switched raids off/);
    assert.equal(await count({ toId: camper.id }), 0);
    // Their own raids on a friend are not what the switch is about.
    assert.deepEqual((await targets(camper)).map((row) => row.handle), [raider.handle]);
    assert.equal((await raid(camper, raider)).status, 201);

    await save(camper, { raidable: true });
    assert.deepEqual((await targets(raider)).map((row) => row.handle), [camper.handle]);
    assert.equal((await raid(raider, camper)).status, 201);
  });
});

describe("leaving", () => {
  async function raidedBothWays() {
    const me = await reader();
    const friend = await reader();
    await befriend(me, friend);
    assert.equal((await raid(me, friend)).status, 201);
    assert.equal((await raid(friend, me)).status, 201);
    assert.equal(await count({ $or: [{ fromId: me.id }, { toId: me.id }] }), 2);
    return { me, friend };
  }

  test("deleting the account removes the raids it made and the raids on it", async () => {
    const { me, friend } = await raidedBothWays();
    const gone = await call("DELETE", "/v1/account", { token: me.token, body: { password: PASSWORD } });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal(await count({ $or: [{ fromId: me.id }, { toId: me.id }] }), 0);
    assert.deepEqual(await waiting(friend), []);
    assert.deepEqual(await targets(friend), []);
  });

  test("deleting the profile does the same", async () => {
    const { me, friend } = await raidedBothWays();
    assert.equal((await call("DELETE", "/v1/profile/me", { token: me.token })).status, 200);
    assert.equal(await count({ $or: [{ fromId: me.id }, { toId: me.id }] }), 0);
    assert.deepEqual(await waiting(friend), []);
  });
});

describe("who may call what", () => {
  test("every raid route refuses a missing or made-up token", async () => {
    const a = await reader();
    const routes = [
      ["GET", "/v1/raids/targets"],
      ["POST", "/v1/raids", { to: a.handle, stars: 1 }],
      ["GET", "/v1/raids"],
      ["POST", "/v1/raids/ack", { ids: ["a".repeat(24)] }]
    ];
    for (const [method, path, body] of routes) {
      for (const token of [undefined, "x".repeat(43)]) {
        const answer = await call(method, path, { token, body });
        assert.equal(answer.status, 401, `${method} ${path} with ${token ? "a bad token" : "no token"}`);
      }
    }
  });

  test("raiding is a community write, and is slowed like one", async () => {
    const tight = createApp(db, { limits: { social: { limit: 2, windowMs: 15 * MINUTE } } });
    const listener = await new Promise((resolve) => {
      const made = tight.listen(0, "127.0.0.1", () => resolve(made));
    });
    try {
      const at = `http://127.0.0.1:${listener.address().port}`;
      const a = await reader();
      const body = { ids: [] };
      assert.equal((await call("POST", "/v1/raids/ack", { token: a.token, body, at })).status, 200);
      assert.equal((await call("POST", "/v1/raids", { token: a.token, body: { to: a.handle, stars: 1 }, at })).status, 400);
      const third = await call("POST", "/v1/raids/ack", { token: a.token, body, at });
      assert.equal(third.status, 429);
      assert.ok(Number(third.retryAfter) > 0);
      // Reading is not counted.
      assert.equal((await call("GET", "/v1/raids", { token: a.token, at })).status, 200);
      assert.equal((await call("GET", "/v1/raids/targets", { token: a.token, at })).status, 200);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });
});
