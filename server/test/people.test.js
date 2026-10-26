import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { BACKFILLS, backfillPeople, fold, queryWords, searchWords } from "../src/people.js";
import { isoWeekKey } from "../src/week.js";

/**
 * Finding readers (1.5.15): search by name or handle, browsing every public
 * reader, suggestions, the lists of followers and following, and the counts
 * a profile keeps. Mostly the privacy rules (public, followers-only, private,
 * blocks) and that the counts stay right whatever changes a follow. Against a
 * throwaway database (TEST_MONGO_URI, default mongodb://127.0.0.1:27017)
 * dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = isoWeekKey();
const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const PASSWORD = "correct horse battery";
const NEUTRAL = "You can't interact with this reader.";

let db;
let server;
let base;
let tight;
let tightBase;

before(async () => {
  db = await connect(uri, dbName);
  const roomy = (windowMs) => ({ limit: 100_000, windowMs });
  const limits = {
    ip: roomy(15 * MINUTE),
    email: roomy(15 * MINUTE),
    signup: roomy(60 * MINUTE),
    social: roomy(15 * MINUTE),
    search: roomy(5 * MINUTE),
    people: roomy(5 * MINUTE),
    library: roomy(15 * MINUTE),
    profile: roomy(15 * MINUTE)
  };
  const listen = (app) =>
    new Promise((resolve) => {
      const made = app.listen(0, "127.0.0.1", () => resolve(made));
    });
  server = await listen(createApp(db, { limits }));
  base = `http://127.0.0.1:${server.address().port}`;
  // The same database behind tiny limits, for the rate limits alone.
  tight = await listen(createApp(db, { limits: { ...limits, search: { limit: 3, windowMs: 5 * MINUTE }, people: { limit: 3, windowMs: 5 * MINUTE } } }));
  tightBase = `http://127.0.0.1:${tight.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => tight.close(resolve));
  await db.dropDatabase();
  await close();
});

async function call(method, path, { token, body, at = base } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(at + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const col = (name) => db.collection(name);
const stored = (who) => col("profiles").findOne({ _id: who.id });
const counts = async (who) => {
  const profile = await stored(who);
  return [profile.followerCount ?? 0, profile.followingCount ?? 0];
};

/** A signed-up reader with a profile; public unless told otherwise. */
async function reader({ visibility = "public", minutes = 30, streak = 2, prefix = "p", name } = {}) {
  const email = `p-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: name ?? handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: minutes, streak, readDay: TODAY }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: new ObjectId(signup.body.account.id) };
}

/** `a` follows `b`: at once if `b` is public, by a request `b` accepts otherwise. */
async function follow(a, b) {
  const asked = await call("POST", `/v1/follows/${b.handle}`, { token: a.token });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  if (asked.body.requested) {
    const accepted = await call("POST", `/v1/follow-requests/${a.handle}/accept`, { token: b.token });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  }
}

const block = (a, b) => call("POST", `/v1/blocks/${b.handle}`, { token: a.token });
const handles = (list) => list.map((row) => row.handle);
const search = (q, token, at) => call("GET", `/v1/search?q=${encodeURIComponent(q)}&week=${WEEK}`, { token, at });

/** Every page of a list, following `next`. */
async function allPages(path, token) {
  const out = [];
  let next = null;
  for (let page = 0; page < 50; page += 1) {
    const join = path.includes("?") ? "&" : "?";
    const answer = await call("GET", next ? `${path}${join}before=${encodeURIComponent(next)}` : path, { token });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.ok(answer.body.people.length <= 20);
    out.push(...answer.body.people);
    next = answer.body.next;
    if (!next) return { people: out, pages: page + 1 };
  }
  throw new Error("too many pages");
}

describe("search words", () => {
  test("names are folded and split; handles kept whole and in parts", () => {
    assert.equal(fold("Zoë Ångström"), "zoe angstrom");
    assert.deepEqual(searchWords("Ada Lovelace-Byron", "the_lovebird"), ["ada", "lovelace", "byron", "the_lovebird", "the", "lovebird"]);
    assert.deepEqual(searchWords(null, "solo"), ["solo"]);
    assert.deepEqual(searchWords(null, null), []);
    // Longest first; only letters and digits, so each is safe in a regex.
    assert.deepEqual(queryWords("@ada lov"), ["ada", "lov"]);
    assert.deepEqual(queryWords(".*"), []);
    assert.deepEqual(queryWords("a$b(c"), ["a", "b", "c"]);
  });
});

describe("search", () => {
  test("by the start of any word of a name or a handle, accents aside", async () => {
    const tag = randomBytes(3).toString("hex");
    const ada = await reader({ prefix: `q${tag}`, name: `Zoë Lovelace${tag}` });
    const bird = await reader({ prefix: `lovebird${tag}_` });
    const me = await reader();

    assert.deepEqual(handles((await search(`lovelace${tag}`)).body.results), [ada.handle]);
    assert.deepEqual(handles((await search(`zoe lovel`)).body.results).includes(ada.handle), true);
    assert.deepEqual(handles((await search(`ZOË LOVELACE${tag}`)).body.results), [ada.handle]);
    // A word inside a handle, not only its start.
    const middle = bird.handle.split("_")[1];
    assert.deepEqual(handles((await search(middle)).body.results), [bird.handle]);
    // The start of the handle still finds it.
    assert.ok(handles((await search(`q${tag}`)).body.results).includes(ada.handle));
    // Signed in, each says how the two stand.
    await follow(me, ada);
    const mine = (await search(`lovelace${tag}`, me.token)).body.results[0];
    assert.deepEqual([mine.followState, mine.followsYou, mine.isYou], ["following", false, false]);
    // A name changed is searched by its new words, and no longer by the old.
    assert.equal((await call("PUT", "/v1/profile/me", { token: ada.token, body: { displayName: `Grace${tag}` } })).status, 200);
    assert.deepEqual(handles((await search(`grace${tag}`)).body.results), [ada.handle]);
    assert.deepEqual((await search(`lovelace${tag}`)).body.results, []);
  });

  test("followers-only is a locked card, private never; the exact handle comes first", async () => {
    const tag = `w${randomBytes(3).toString("hex")}`;
    const quiet = await reader({ visibility: "followers", prefix: tag, minutes: 444 });
    const shy = await reader({ visibility: "private", prefix: tag });
    const open = await reader({ prefix: `${quiet.handle}x` });
    const found = (await search(quiet.handle)).body.results;
    assert.deepEqual(handles(found), [quiet.handle, open.handle]);
    assert.deepEqual([found[0].locked, found[0].weekMinutes, found[0].visibility], [true, 0, "followers"]);
    assert.ok(!handles((await search(tag)).body.results).includes(shy.handle));
    assert.deepEqual((await search(shy.handle)).body.results, []);
    // Asked to follow: the card says so.
    const fan = await reader();
    assert.equal((await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token })).body.requested, true);
    const card = (await search(quiet.handle, fan.token)).body.results[0];
    assert.deepEqual([card.locked, card.followState], [true, "requested"]);
    // Accepted: open to them.
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/accept`, { token: quiet.token })).status, 200);
    const now = (await search(quiet.handle, fan.token)).body.results[0];
    assert.deepEqual([now.locked, now.weekMinutes, now.followState], [false, 444, "following"]);
  });

  test("neither side of a block finds the other", async () => {
    const tag = `b${randomBytes(3).toString("hex")}`;
    const a = await reader({ prefix: tag });
    const b = await reader({ prefix: tag });
    const bystander = await reader();
    assert.equal((await block(a, b)).status, 200);
    assert.ok(!handles((await search(tag, a.token)).body.results).includes(b.handle));
    assert.ok(!handles((await search(tag, b.token)).body.results).includes(a.handle));
    assert.deepEqual(handles((await search(tag, bystander.token)).body.results).sort(), [a.handle, b.handle].sort());
  });

  test("is rate limited", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await search("anything", undefined, tightBase)).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});

describe("browse", () => {
  test("new: every public reader with a handle, newest first, twenty a page, no repeats", async () => {
    const made = [];
    for (let i = 0; i < 23; i += 1) made.push(await reader({ prefix: "n" }));
    const quiet = await reader({ visibility: "followers" });
    const shy = await reader({ visibility: "private" });
    const nameless = await reader();
    await col("profiles").updateOne({ _id: nameless.id }, { $set: { handle: null } });
    const viewer = await reader();

    const { people, pages } = await allPages("/v1/people?sort=new", viewer.token);
    assert.ok(pages >= 2);
    const seen = handles(people);
    assert.equal(new Set(seen).size, seen.length, "no reader twice");
    for (const one of made) assert.ok(seen.includes(one.handle));
    assert.ok(!seen.includes(quiet.handle) && !seen.includes(shy.handle) && !seen.includes(viewer.handle));
    assert.ok(people.every((row) => row.visibility === "public" && row.locked === false && row.handle));
    // Newest first: the last made before the viewer comes before the first.
    assert.ok(seen.indexOf(made[22].handle) < seen.indexOf(made[0].handle));
    // Signed out too, without how the two stand.
    const open = await call("GET", "/v1/people?sort=new");
    assert.equal(open.status, 200);
    assert.equal(open.body.people[0].followState, undefined);
    assert.equal(JSON.stringify(open.body).includes("readDay"), false);
  });

  test("most: this week's minutes, most first, past the board's hundred; active: read this week, latest first", async () => {
    const tag = randomBytes(2).toString("hex");
    const big = await reader({ minutes: 9000 + Number.parseInt(tag, 16) % 500, prefix: "m" });
    const small = await reader({ minutes: 1, prefix: "m" });
    const idle = await reader({ minutes: 0, prefix: "m" });
    await col("profiles").updateOne({ _id: idle.id }, { $set: { readDay: daysAgo(30) } });
    const viewer = await reader();
    const most = (await allPages("/v1/people?sort=most", viewer.token)).people;
    const minutes = most.map((row) => row.weekMinutes);
    assert.deepEqual(minutes, [...minutes].sort((a, b) => b - a));
    assert.ok(handles(most).indexOf(big.handle) < handles(most).indexOf(small.handle));
    assert.ok(!handles(most).includes(idle.handle), "nobody without minutes this week");

    await col("profiles").updateOne({ _id: small.id }, { $set: { readDay: daysAgo(3) } });
    const active = handles((await allPages("/v1/people?sort=active", viewer.token)).people);
    assert.ok(active.indexOf(big.handle) < active.indexOf(small.handle));
    assert.ok(!active.includes(idle.handle), "not read in the last week");
    // The default is active.
    assert.equal((await call("GET", "/v1/people", { token: viewer.token })).body.sort, "active");
  });

  test("blocks hide both ways; a cursor that is not one is refused", async () => {
    const a = await reader();
    const b = await reader();
    await block(a, b);
    const toA = handles((await allPages("/v1/people?sort=new", a.token)).people);
    const toB = handles((await allPages("/v1/people?sort=new", b.token)).people);
    assert.ok(!toA.includes(b.handle) && !toB.includes(a.handle));
    assert.equal((await call("GET", "/v1/people?sort=new&before=nonsense", { token: a.token })).status, 400);
    const wrongKind = Buffer.from(JSON.stringify([1, 2, "x"])).toString("base64url");
    assert.equal((await call("GET", `/v1/people?sort=new&before=${wrongKind}`)).status, 400);
  });

  test("a followed reader's card says so, and whether they follow back", async () => {
    const me = await reader();
    const friend = await reader();
    await follow(me, friend);
    await follow(friend, me);
    const row = (await allPages("/v1/people?sort=new", me.token)).people.find((one) => one.handle === friend.handle);
    assert.deepEqual([row.followState, row.followsYou], ["following", true]);
  });

  test("is rate limited", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await call("GET", "/v1/people", { at: tightBase })).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });
});

describe("suggestions", () => {
  test("readers of the same books, and readers followed by those you follow; public only", async () => {
    const me = await reader();
    const key = `dune|herbert|${randomBytes(3).toString("hex")}`;
    assert.equal(
      (await call("PUT", "/v1/library/me", { token: me.token, body: { books: [{ key, title: "Dune", author: "Herbert", state: "reading", percent: 40 }] } })).status,
      200
    );
    const fellow = await reader();
    const quietFellow = await reader({ visibility: "followers" });
    const blockedFellow = await reader();
    const post = (who, audience = "everyone") =>
      col("posts").insertOne({ userId: who.id, kind: "finished", audience, hiddenAt: null, bookKey: key, title: "Dune", createdAt: new Date() });
    await post(fellow);
    await post(quietFellow);
    await post(blockedFellow);
    await block(blockedFellow, me);

    const friend = await reader();
    const friendOfFriend = await reader();
    const privateOne = await reader();
    await follow(me, friend);
    await follow(friend, friendOfFriend);
    await follow(friend, privateOne);
    await call("PUT", "/v1/profile/me", { token: privateOne.token, body: { visibility: "private" } });

    const answer = await call("GET", "/v1/people/suggested", { token: me.token });
    assert.equal(answer.status, 200);
    const byHandle = new Map(answer.body.people.map((row) => [row.handle, row]));
    assert.deepEqual(byHandle.get(fellow.handle)?.reason, { kind: "book", title: "Dune" });
    const via = byHandle.get(friendOfFriend.handle)?.reason;
    assert.deepEqual([via?.kind, via?.count, via?.via?.handle], ["follows", 1, friend.handle]);
    for (const left of [quietFellow, blockedFellow, privateOne, friend, me]) {
      assert.ok(!byHandle.has(left.handle), `${left.handle} is not suggested`);
    }
    assert.ok(answer.body.people.length <= 10);

    // Followed since: gone at once, though the list is kept for a while.
    await follow(me, fellow);
    const again = await call("GET", "/v1/people/suggested", { token: me.token });
    assert.ok(!handles(again.body.people).includes(fellow.handle));
    // Gone private since: gone too.
    await call("PUT", "/v1/profile/me", { token: friendOfFriend.token, body: { visibility: "private" } });
    assert.ok(!handles((await call("GET", "/v1/people/suggested", { token: me.token })).body.people).includes(friendOfFriend.handle));
  });

  test("needs an account, and a shared profile to suggest anyone", async () => {
    assert.equal((await call("GET", "/v1/people/suggested")).status, 401);
    const shy = await reader({ visibility: "private" });
    assert.deepEqual((await call("GET", "/v1/people/suggested", { token: shy.token })).body, { people: [] });
  });
});

describe("followers and following", () => {
  test("paged, newest first, counted; a followers-only follower not followed back is locked", async () => {
    const me = await reader();
    const fans = [];
    for (let i = 0; i < 22; i += 1) {
      const fan = await reader();
      await follow(fan, me);
      fans.push(fan);
    }
    const quietFan = await reader({ visibility: "followers", minutes: 321 });
    await follow(quietFan, me);
    const first = await call("GET", "/v1/people/me/followers", { token: me.token });
    assert.equal(first.status, 200);
    assert.equal(first.body.count, 23);
    assert.equal(first.body.people.length, 20);
    assert.equal(first.body.people[0].handle, quietFan.handle);
    assert.deepEqual([first.body.people[0].locked, first.body.people[0].weekMinutes, first.body.people[0].followsYou], [true, 0, true]);
    const all = await allPages("/v1/people/me/followers", me.token);
    assert.equal(all.people.length, 23);
    assert.equal(all.pages, 2);

    await follow(me, fans[0]);
    await follow(me, quietFan);
    const following = await call("GET", "/v1/people/me/following", { token: me.token });
    assert.deepEqual(handles(following.body.people), [quietFan.handle, fans[0].handle]);
    assert.equal(following.body.count, 2);
    assert.deepEqual([following.body.people[0].locked, following.body.people[0].weekMinutes], [false, 321]);
    assert.ok(following.body.people.every((row) => row.followState === "following" && row.followsYou));

    // A blocked follower is left out (the block also removed the follow).
    await block(me, fans[1]);
    assert.ok(!handles((await allPages("/v1/people/me/followers", me.token)).people).includes(fans[1].handle));
    assert.equal((await call("GET", "/v1/people/me/followers")).status, 401);
  });
});

describe("the profile", () => {
  test("says how the two stand, with counts kept on the profile and kudos this month", async () => {
    const me = await reader();
    const them = await reader();
    await follow(them, me);
    const card = await call("GET", `/v1/profile/${them.handle}?week=${WEEK}&day=${TODAY}`, { token: me.token });
    assert.deepEqual(
      [card.body.followState, card.body.followsYou, card.body.followerCount, card.body.followingCount, card.body.kudosThisMonth],
      ["none", true, 0, 1, 0]
    );
    assert.equal((await call("POST", `/v1/kudos/${them.handle}`, { token: me.token, body: { dayKey: TODAY, weekKey: WEEK } })).status, 201);
    await follow(me, them);
    const after = await call("GET", `/v1/profile/${them.handle}?week=${WEEK}&day=${TODAY}`, { token: me.token });
    assert.deepEqual([after.body.followState, after.body.followerCount, after.body.kudosThisMonth], ["following", 1, 1]);
    // A month kept from before reads as none this month.
    await col("profiles").updateOne({ _id: them.id }, { $set: { kudosMonthKey: "2000-01" } });
    assert.equal((await call("GET", `/v1/profile/${them.handle}`)).body.kudosThisMonth, 0);

    // A locked card: requested, and whether they follow you; no counts.
    const quiet = await reader({ visibility: "followers" });
    await call("POST", `/v1/follows/${me.handle}`, { token: quiet.token });
    await call("POST", `/v1/follows/${quiet.handle}`, { token: me.token });
    const locked = await call("GET", `/v1/profile/${quiet.handle}`, { token: me.token });
    assert.deepEqual(
      [locked.body.locked, locked.body.followState, locked.body.followsYou, locked.body.followerCount, locked.body.kudosThisMonth],
      [true, "requested", true, 0, undefined]
    );
  });
});

describe("counts stay right", () => {
  test("on follow, follow again, unfollow, accept, going public, block and deleting an account", async () => {
    const a = await reader();
    const b = await reader();
    await follow(a, b);
    await follow(a, b);
    assert.deepEqual([await counts(a), await counts(b)], [[0, 1], [1, 0]]);
    await call("DELETE", `/v1/follows/${b.handle}`, { token: a.token });
    await call("DELETE", `/v1/follows/${b.handle}`, { token: a.token });
    assert.deepEqual([await counts(a), await counts(b)], [[0, 0], [0, 0]]);

    // Accepted by hand.
    const quiet = await reader({ visibility: "followers" });
    await follow(a, quiet);
    assert.deepEqual([await counts(a), await counts(quiet)], [[0, 1], [1, 0]]);
    // Requests turned into follows by going public.
    const c = await reader();
    const d = await reader();
    await call("POST", `/v1/follows/${quiet.handle}`, { token: c.token });
    await call("POST", `/v1/follows/${quiet.handle}`, { token: d.token });
    await call("PUT", "/v1/profile/me", { token: quiet.token, body: { visibility: "public" } });
    assert.deepEqual([await counts(quiet), await counts(c), await counts(d)], [[3, 0], [0, 1], [0, 1]]);

    // A block takes the follows each way, and both counts with them.
    await follow(quiet, a);
    assert.deepEqual([await counts(a), await counts(quiet)], [[1, 1], [3, 1]]);
    assert.equal((await block(a, quiet)).status, 200);
    assert.deepEqual([await counts(a), await counts(quiet)], [[0, 0], [2, 0]]);
    assert.equal((await call("POST", `/v1/follows/${quiet.handle}`, { token: a.token })).body.error, NEUTRAL);

    // Deleting an account counts it out of everyone else's.
    await follow(c, d);
    await follow(d, c);
    assert.deepEqual(await counts(c), [1, 2]);
    assert.equal((await call("DELETE", "/v1/account", { token: d.token, body: { password: PASSWORD } })).status, 200);
    assert.deepEqual([await counts(c), await counts(quiet)], [[0, 1], [1, 0]]);
    // So does deleting a profile alone.
    await follow(a, c);
    await call("DELETE", "/v1/profile/me", { token: a.token });
    assert.deepEqual(await counts(c), [0, 1]);
  });
});

describe("backfills", () => {
  test("search words for profiles without, then the counts and this month's kudos once", async () => {
    const x = await reader({ name: "Backfill Person" });
    const y = await reader();
    await follow(y, x);
    await call("POST", `/v1/kudos/${x.handle}`, { token: y.token, body: { dayKey: TODAY, weekKey: WEEK } });
    // As a server from before 1.5.15 would have left them.
    await col("profiles").updateMany({}, { $unset: { nameWords: "", followerCount: "", followingCount: "", kudosMonthKey: "", kudosMonthCount: "" } });
    await col("meta").deleteMany({ _id: { $in: Object.values(BACKFILLS) } });
    assert.deepEqual((await search("backfill")).body.results, []);

    const first = await backfillPeople(db);
    assert.ok(first.nameWords >= 2);
    assert.ok(first.followCounts >= 2 && first.kudosMonth >= 1);
    assert.deepEqual(handles((await search("backfill person")).body.results), [x.handle]);
    assert.deepEqual(await counts(x), [1, 0]);
    assert.equal((await call("GET", `/v1/profile/${x.handle}`)).body.kudosThisMonth, 1);

    // A second start writes nothing, and counts nothing again.
    await col("profiles").updateOne({ _id: x.id }, { $set: { followerCount: 7 } });
    const second = await backfillPeople(db);
    assert.deepEqual(second, { nameWords: 0, followCounts: null, kudosMonth: null });
    assert.deepEqual(await counts(x), [7, 0]);
    // With its marker removed by hand, the count is set from the follows again.
    await col("meta").deleteOne({ _id: BACKFILLS.followCounts });
    await backfillPeople(db);
    assert.deepEqual(await counts(x), [1, 0]);
  });
});

describe("capacity", () => {
  const planOf = async (filter, options = {}) => {
    const cursor = col("profiles").find(filter, options);
    const explained = await cursor.explain("executionStats");
    const plan = JSON.stringify(explained.queryPlanner.winningPlan);
    return { scan: /"stage":"COLLSCAN"/.test(plan), sorts: /"stage":"SORT"/.test(plan), keys: explained.executionStats.totalKeysExamined, docs: explained.executionStats.totalDocsExamined };
  };

  test("search, browse and lists are read off their indexes", async () => {
    await col("profiles").insertMany(
      Array.from({ length: 600 }, (_, n) => ({
        crowd: true,
        handle: `crowd${n}`,
        nameWords: [`name${n}`, `crowd${n}`],
        visibility: ["public", "followers", "private"][n % 3],
        readDay: daysAgo(n % 20),
        weekKey: WEEK,
        weekMinutes: n,
        streak: n % 9
      }))
    );
    const word = await planOf(
      { nameWords: { $all: [/^name40/] }, visibility: { $in: ["public", "followers"] }, handle: { $type: "string" } },
      { limit: 60, hint: "people_search" }
    );
    assert.equal(word.scan, false);
    assert.ok(word.docs <= 12, `${word.docs} profiles read for a search`);
    const newest = await planOf({ visibility: "public", handle: { $type: "string" } }, { sort: { _id: -1 }, limit: 21, hint: "people_new" });
    assert.deepEqual([newest.scan, newest.sorts], [false, false]);
    assert.ok(newest.docs <= 21);
    const active = await planOf(
      { visibility: "public", handle: { $type: "string" }, readDay: { $gte: daysAgo(8), $type: "string" } },
      { sort: { readDay: -1, _id: -1 }, limit: 21, hint: "people_active" }
    );
    assert.deepEqual([active.scan, active.sorts], [false, false]);
    assert.ok(active.docs <= 21);
    await col("profiles").deleteMany({ crowd: true });
  });
});
