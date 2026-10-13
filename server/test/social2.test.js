import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";

/**
 * Followers-only profiles and follow requests, what a profile can carry, the
 * library, finished-book posts and the feed, clubs, gifts and a duel's stake,
 * against a throwaway database (TEST_MONGO_URI, default
 * mongodb://127.0.0.1:27017) dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const WEEK = isoWeekKey();
const TODAY = new Date().toISOString().slice(0, 10);
const PASSWORD = "correct horse battery";
const PERSON = ["avatar", "displayName", "handle", "pipSeed"];

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

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, retryAfter: response.headers.get("retry-after") };
}

/** A signed-up reader with a profile; public unless told otherwise. `extra` goes into the profile save. */
async function reader({ visibility = "public", minutes = 30, streak = 2, prefix = "s", extra = {} } = {}) {
  const email = `s-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: minutes, streak, readDay: TODAY, ...extra }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: new ObjectId(signup.body.account.id) };
}

const setVisibility = (who, visibility, extra = {}) =>
  call("PUT", "/v1/profile/me", { token: who.token, body: { visibility, ...extra } });

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

const count = (name, filter) => db.collection(name).countDocuments(filter);
const kudosBody = { dayKey: TODAY, weekKey: WEEK };
const book = (key, state = "reading", percent = 10) => ({ key, title: `Title of ${key}`, author: "An Author", state, percent });

describe("a followers-only profile", () => {
  test("is found by anyone as a locked card, and is on no public board", async () => {
    const boardBefore = await call("GET", `/v1/leaderboard?week=${WEEK}`);
    const quiet = await reader({ visibility: "followers", minutes: 555, prefix: "lock", extra: { shelf: [{ title: "A Shelf Book" }] } });
    const stranger = await reader();

    for (const token of [undefined, stranger.token]) {
      const card = await call("GET", `/v1/profile/${quiet.handle}?week=${WEEK}`, { token });
      assert.equal(card.status, 200);
      // The person, and how the two stand. Nothing about the reading.
      // Who they are, that the card is locked, and a full card's figures all
      // empty: an app from before `locked` draws it as an empty profile
      // instead of failing on a shelf that is not there.
      const EMPTY = { isFollowing: false, weekMinutes: 0, streak: 0, booksFinished: 0, shelf: [], kudosThisWeek: 0, followerCount: 0, followingCount: 0 };
      assert.deepEqual(
        Object.keys(card.body).sort(),
        [...PERSON, "following", "isYou", "locked", "requested", "visibility", "weekKey", ...Object.keys(EMPTY)].sort()
      );
      assert.deepEqual(
        { ...card.body, avatar: undefined, displayName: undefined, weekKey: undefined },
        { handle: quiet.handle, pipSeed: quiet.handle, visibility: "followers", locked: true, requested: false, isYou: false, following: false, ...EMPTY, avatar: undefined, displayName: undefined, weekKey: undefined }
      );
      assert.equal(JSON.stringify(card.body).includes("555"), false);
    }

    const found = await call("GET", `/v1/search?q=${quiet.handle}`, { token: stranger.token });
    assert.equal(found.body.results.length, 1);
    assert.equal(found.body.results[0].locked, true);
    assert.equal(found.body.results[0].visibility, "followers");
    assert.equal(found.body.results[0].weekMinutes, 0);
    // A public reader's card says so too.
    const open = await call("GET", `/v1/search?q=${stranger.handle}`);
    assert.equal(open.body.results[0].locked, false);
    assert.equal(open.body.results[0].weekMinutes, 30);

    // Not on the board everybody sees, and not counted among those who share on it.
    const board = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: quiet.token });
    assert.equal(board.body.entries.some((entry) => entry.handle === quiet.handle), false);
    assert.equal(board.body.you, null);
    assert.equal(board.body.sharedReaders, boardBefore.body.sharedReaders + 1, "only the stranger was added");

    // To themself it is whole, and their figures are kept.
    const own = await call("GET", `/v1/profile/${quiet.handle}?week=${WEEK}`, { token: quiet.token });
    assert.equal(own.body.locked, false);
    assert.equal(own.body.isYou, true);
    assert.equal(own.body.visibility, "followers");
    assert.equal(own.body.weekMinutes, 555);
    assert.equal(own.body.shelf[0].title, "A Shelf Book");
    const mine = await call("GET", "/v1/profile/me", { token: quiet.token });
    assert.equal(mine.body.visibility, "followers");
    assert.equal(mine.body.weekMinutes, 555);
    const following = await call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token: quiet.token });
    assert.deepEqual(following.body.entries.map((entry) => entry.handle), [quiet.handle]);
  });

  test("a request, accepted, opens the whole profile to that reader alone", async () => {
    const quiet = await reader({ visibility: "followers", minutes: 77, prefix: "req" });
    const fan = await reader({ minutes: 10 });
    const other = await reader();

    const asked = await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token });
    assert.equal(asked.status, 200);
    assert.deepEqual(asked.body, { following: false, requested: true });
    // Asking again changes nothing, and does not tell them twice.
    assert.deepEqual((await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token })).body, { following: false, requested: true });
    assert.equal(await count("followRequests", { fromId: fan.id, toId: quiet.id }), 1);
    assert.equal(await count("follows", { followerId: fan.id, followeeId: quiet.id }), 0);

    // Still locked while it waits, but it says the request is in.
    const waiting = await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token });
    assert.equal(waiting.body.locked, true);
    assert.equal(waiting.body.requested, true);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: other.token })).body.requested, false);
    // And nothing a follower could do is open yet.
    assert.equal((await call("GET", "/v1/follows", { token: fan.token })).body.following.length, 0);
    const boardWaiting = await call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token: fan.token });
    assert.deepEqual(boardWaiting.body.entries.map((entry) => entry.handle), [fan.handle]);
    assert.equal((await call("POST", `/v1/kudos/${quiet.handle}`, { token: fan.token, body: kudosBody })).status, 403);
    assert.equal((await call("POST", "/v1/duels", { token: fan.token, body: { handle: quiet.handle, weekKey: WEEK } })).status, 403);

    // They are told once, and the request is listed for them.
    const inbox = await call("GET", "/v1/inbox", { token: quiet.token });
    const events = inbox.body.events.filter((event) => event.type === "follow_request");
    assert.equal(events.length, 1);
    assert.equal(events[0].actor.handle, fan.handle);
    assert.equal(events[0].pending, true);
    const listed = await call("GET", "/v1/follow-requests", { token: quiet.token });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.requests.length, 1);
    assert.deepEqual(Object.keys(listed.body.requests[0]).sort(), [...PERSON, "createdAt"].sort());
    assert.equal(listed.body.requests[0].handle, fan.handle);
    // Only the reader asked can answer.
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/accept`, { token: other.token })).status, 404);
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/accept`)).status, 401);
    assert.equal((await call("GET", "/v1/follow-requests")).status, 401);

    const accepted = await call("POST", `/v1/follow-requests/${fan.handle}/accept`, { token: quiet.token });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, { accepted: true });
    assert.equal(await count("followRequests", { toId: quiet.id }), 0);
    assert.equal(await count("follows", { followerId: fan.id, followeeId: quiet.id }), 1);
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/accept`, { token: quiet.token })).status, 404);

    // The whole profile, to the accepted reader.
    const full = await call("GET", `/v1/profile/${quiet.handle}?week=${WEEK}`, { token: fan.token });
    assert.equal(full.body.locked, false);
    assert.equal(full.body.visibility, "followers");
    assert.equal(full.body.weekMinutes, 77);
    assert.equal(full.body.isFollowing, true);
    assert.equal(full.body.followerCount, 1);
    // Still locked to everyone else, signed in or not.
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: other.token })).body.locked, true);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`)).body.locked, true);
    assert.equal((await call("GET", `/v1/search?q=${quiet.handle}`, { token: fan.token })).body.results[0].locked, false);
    assert.equal((await call("GET", `/v1/search?q=${quiet.handle}`, { token: other.token })).body.results[0].locked, true);

    // The asker is told, and the reader now takes part like any they follow.
    const told = await call("GET", "/v1/inbox", { token: fan.token });
    assert.equal(told.body.events.filter((event) => event.type === "follow_accept" && event.actor.handle === quiet.handle).length, 1);
    assert.deepEqual((await call("GET", "/v1/follows", { token: fan.token })).body.following.map((row) => row.handle), [quiet.handle]);
    const board = await call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token: fan.token });
    assert.deepEqual(board.body.entries.map((entry) => entry.handle), [quiet.handle, fan.handle]);
    assert.equal((await call("POST", `/v1/kudos/${quiet.handle}`, { token: fan.token, body: kudosBody })).status, 201);
    const duel = await call("POST", "/v1/duels", { token: fan.token, body: { handle: quiet.handle, weekKey: WEEK } });
    assert.equal(duel.status, 201, JSON.stringify(duel.body));
    assert.equal(duel.body.them.handle, quiet.handle);
    assert.equal((await call("POST", `/v1/duels/${duel.body.id}/accept`, { token: quiet.token })).status, 200);
    assert.equal((await call("GET", "/v1/duels", { token: fan.token })).body.duels.length, 1);
    // A follow that is already there is a plain yes.
    assert.deepEqual((await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token })).body, { following: true, requested: false });
    // The request's event stays as history, no longer waiting.
    const after = await call("GET", "/v1/inbox", { token: quiet.token });
    assert.equal(after.body.events.find((event) => event.type === "follow_request").pending, false);
  });

  test("a reader who shares with followers only follows, cheers and duels like a public one", async () => {
    const quiet = await reader({ visibility: "followers", minutes: 12 });
    const open = await reader({ minutes: 40 });
    assert.deepEqual((await call("POST", `/v1/follows/${open.handle}`, { token: quiet.token })).body, { following: true, requested: false });
    assert.equal((await call("POST", `/v1/kudos/${open.handle}`, { token: quiet.token, body: kudosBody })).status, 201);
    const duel = await call("POST", "/v1/duels", { token: quiet.token, body: { handle: open.handle, weekKey: WEEK } });
    assert.equal(duel.status, 201, JSON.stringify(duel.body));
    // The reader challenged sees who it is and the duel's minutes, and can accept.
    const invite = (await call("GET", "/v1/inbox", { token: open.token })).body.events.find((event) => event.type === "duel_invite");
    assert.equal(invite.actor.handle, quiet.handle);
    assert.equal(invite.duel.them.minutes, 12);
    assert.equal((await call("POST", `/v1/duels/${duel.body.id}/accept`, { token: open.token })).status, 200);

    // Visits need a follow each way, as before; either side may be followers-only.
    assert.equal((await call("GET", `/v1/visitors?day=${TODAY}&week=${WEEK}`, { token: open.token })).body.visitors.length, 0);
    await follow(open, quiet);
    const visitors = await call("GET", `/v1/visitors?day=${TODAY}&week=${WEEK}`, { token: open.token });
    assert.deepEqual(visitors.body.visitors.map((row) => row.handle), [quiet.handle]);
    const back = await call("GET", `/v1/visitors?day=${TODAY}&week=${WEEK}`, { token: quiet.token });
    assert.deepEqual(back.body.visitors.map((row) => row.handle), [open.handle]);
  });

  test("a request declined is gone, and the profile stays locked", async () => {
    const quiet = await reader({ visibility: "followers" });
    const fan = await reader();
    await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token });
    const declined = await call("POST", `/v1/follow-requests/@${fan.handle}/decline`, { token: quiet.token });
    assert.equal(declined.status, 200);
    assert.deepEqual(declined.body, { declined: true });
    assert.equal(await count("followRequests", { toId: quiet.id }), 0);
    assert.equal(await count("follows", { followeeId: quiet.id }), 0);
    assert.equal((await call("GET", "/v1/follow-requests", { token: quiet.token })).body.requests.length, 0);
    const card = await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token });
    assert.equal(card.body.locked, true);
    assert.equal(card.body.requested, false);
    // Nobody is told, and there is nothing left to answer.
    assert.equal((await call("GET", "/v1/inbox", { token: fan.token })).body.events.length, 0);
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/decline`, { token: quiet.token })).status, 404);
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/accept`, { token: quiet.token })).status, 404);
    assert.equal((await call("POST", "/v1/follow-requests/nobody-here/accept", { token: quiet.token })).status, 404);
    // They can ask again; it is not announced a second time.
    assert.equal((await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token })).body.requested, true);
    assert.equal(await count("events", { userId: quiet.id, type: "follow_request" }), 1);
  });

  test("a request is taken back with the same call that unfollows", async () => {
    const quiet = await reader({ visibility: "followers" });
    const fan = await reader();
    await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token });
    assert.equal((await call("GET", "/v1/follow-requests", { token: quiet.token })).body.requests.length, 1);
    const withdrawn = await call("DELETE", `/v1/follows/${quiet.handle}`, { token: fan.token });
    assert.equal(withdrawn.status, 200);
    assert.deepEqual(withdrawn.body, { following: false, requested: false });
    assert.equal(await count("followRequests", { fromId: fan.id }), 0);
    assert.equal((await call("GET", "/v1/follow-requests", { token: quiet.token })).body.requests.length, 0);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token })).body.requested, false);
    assert.equal((await call("POST", `/v1/follow-requests/${fan.handle}/accept`, { token: quiet.token })).status, 404);

    // And an accepted follow is undone the same way, which locks the profile again.
    await follow(fan, quiet);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token })).body.locked, false);
    await call("DELETE", `/v1/follows/${quiet.handle}`, { token: fan.token });
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token })).body.locked, true);
  });

  test("going public turns the waiting requests into follows", async () => {
    const quiet = await reader({ visibility: "followers", minutes: 61 });
    const one = await reader();
    const two = await reader();
    for (const fan of [one, two]) {
      assert.equal((await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token })).body.requested, true);
    }
    const shared = await setVisibility(quiet, "public", { weekKey: WEEK, weekMinutes: 61 });
    assert.equal(shared.body.visibility, "public");
    assert.equal(await count("followRequests", { toId: quiet.id }), 0);
    assert.equal(await count("follows", { followeeId: quiet.id }), 2);
    for (const fan of [one, two]) {
      const view = await call("GET", `/v1/profile/${quiet.handle}?week=${WEEK}`, { token: fan.token });
      assert.equal(view.body.locked, false);
      assert.equal(view.body.isFollowing, true);
      assert.equal(view.body.weekMinutes, 61);
      const inbox = await call("GET", "/v1/inbox", { token: fan.token });
      assert.equal(inbox.body.events.filter((event) => event.type === "follow_accept").length, 1);
    }
    assert.equal((await call("GET", "/v1/follow-requests", { token: quiet.token })).body.requests.length, 0);
    // A follow of a public reader is immediate again.
    const three = await reader();
    assert.deepEqual((await call("POST", `/v1/follows/${quiet.handle}`, { token: three.token })).body, { following: true, requested: false });
  });

  test("going private drops the requests to it, and hides a reader who had asked", async () => {
    const quiet = await reader({ visibility: "followers" });
    const fan = await reader();
    const shy = await reader({ prefix: "shyreq" });
    await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token });
    await call("POST", `/v1/follows/${quiet.handle}`, { token: shy.token });

    // The asker goes private: left out of the list, and not to be told apart
    // from a handle that does not exist.
    await setVisibility(shy, "private");
    const listed = await call("GET", "/v1/follow-requests", { token: quiet.token });
    assert.deepEqual(listed.body.requests.map((row) => row.handle), [fan.handle]);
    assert.equal(JSON.stringify((await call("GET", "/v1/inbox", { token: quiet.token })).body).includes(shy.handle), false);
    assert.equal((await call("POST", `/v1/follow-requests/${shy.handle}/accept`, { token: quiet.token })).status, 404);
    assert.equal((await call("POST", `/v1/follow-requests/${shy.handle}/decline`, { token: quiet.token })).status, 404);

    // The reader asked goes private: nothing is left waiting for them.
    await setVisibility(quiet, "private");
    assert.equal(await count("followRequests", { toId: quiet.id }), 0);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token })).status, 404);
    assert.equal((await call("POST", `/v1/follows/${quiet.handle}`, { token: fan.token })).status, 404);
    assert.equal((await call("GET", `/v1/search?q=${quiet.handle}`)).body.results.length, 0);
  });
});

describe("more on a profile", () => {
  const MORE = {
    shareLibrary: true,
    reading: { title: "  The Left Hand\nof Darkness ", author: "Ursula K. Le Guin", percent: 42 },
    level: 7,
    badges: ["first-book", "night-owl", "first-book", "100-days"],
    arcade: { dash: 1200, flap: 9 }
  };

  test("the book being read, level, badges and arcade scores are saved and shown", async () => {
    const me = await reader({ minutes: 9000, prefix: "more" });
    const fresh = await call("GET", "/v1/profile/me", { token: me.token });
    assert.deepEqual(
      [fresh.body.reading, fresh.body.level, fresh.body.badges, fresh.body.arcade, fresh.body.sharesLibrary],
      [null, null, [], null, false]
    );

    const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: MORE });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const expected = {
      reading: { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", percent: 42 },
      level: 7,
      badges: ["first-book", "night-owl", "100-days"],
      arcade: { dash: 1200, catch: 0, flap: 9 },
      sharesLibrary: true,
      visibility: "public"
    };
    const pick = (body) => Object.fromEntries(Object.keys(expected).map((key) => [key, body[key]]));
    assert.deepEqual(pick(saved.body), expected);
    assert.deepEqual(pick((await call("GET", "/v1/profile/me", { token: me.token })).body), expected);
    assert.deepEqual(pick((await call("GET", `/v1/profile/${me.handle}`)).body), expected);

    // A board row carries the book and the level.
    const board = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: me.token });
    const row = board.body.entries.find((entry) => entry.handle === me.handle);
    assert.deepEqual(row.reading, expected.reading);
    assert.equal(row.level, 7);
    const mine = await call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token: me.token });
    assert.deepEqual(mine.body.you.reading, expected.reading);

    // No book, or no author.
    const cleared = await call("PUT", "/v1/profile/me", { token: me.token, body: { reading: null } });
    assert.equal(cleared.body.reading, null);
    const bare = await call("PUT", "/v1/profile/me", { token: me.token, body: { reading: { title: "Untitled", percent: 0 } } });
    assert.deepEqual(bare.body.reading, { title: "Untitled", author: null, percent: 0 });
  });

  test("a malformed value is refused, and changes nothing", async () => {
    const me = await reader();
    await call("PUT", "/v1/profile/me", { token: me.token, body: MORE });
    const bad = [
      { shareLibrary: "yes" },
      { reading: "Dune" },
      { reading: [] },
      { reading: { title: "", percent: 5 } },
      { reading: { title: "Dune" } },
      { reading: { title: "Dune", percent: 101 } },
      { reading: { title: "Dune", percent: 12.5 } },
      { reading: { title: "Dune", author: 7, percent: 5 } },
      { level: -1 },
      { level: 1000 },
      { level: "7" },
      { level: null },
      { badges: "first-book" },
      { badges: ["Not A Badge"] },
      { badges: [7] },
      { badges: Array.from({ length: 81 }, (_, index) => `badge-${index}`) },
      { arcade: [1, 2, 3] },
      { arcade: { dash: -5 } },
      { arcade: { dash: 10_000_001 } },
      { arcade: { catch: "lots" } }
    ];
    for (const body of bad) {
      const refused = await call("PUT", "/v1/profile/me", { token: me.token, body });
      assert.equal(refused.status, 400, JSON.stringify(body));
    }
    const kept = await call("GET", "/v1/profile/me", { token: me.token });
    assert.equal(kept.body.level, 7);
    assert.equal(kept.body.reading.percent, 42);
    assert.equal(kept.body.badges.length, 3);
    // Eighty badges is the most, and is fine.
    const many = await call("PUT", "/v1/profile/me", {
      token: me.token,
      body: { badges: Array.from({ length: 80 }, (_, index) => `badge-${index}`) }
    });
    assert.equal(many.body.badges.length, 80);
  });

  test("they are kept for a shared profile only, and leave the server with it", async () => {
    const shy = await reader({ visibility: "private" });
    const late = await call("PUT", "/v1/profile/me", { token: shy.token, body: MORE });
    assert.equal(late.status, 200);
    assert.deepEqual([late.body.reading, late.body.level, late.body.badges, late.body.arcade], [null, null, [], null]);
    // The switch is a setting, kept like the handle; what it would share is not there.
    assert.equal(late.body.sharesLibrary, true);

    await setVisibility(shy, "followers", MORE);
    const stored = await db.collection("profiles").findOne({ _id: shy.id });
    assert.equal(stored.level, 7);
    assert.equal(stored.reading.percent, 42);

    await setVisibility(shy, "private");
    const gone = await db.collection("profiles").findOne({ _id: shy.id });
    assert.deepEqual([gone.reading, gone.level, gone.badges, gone.arcade], [null, null, [], null]);
  });
});

describe("Pip's camp on a profile", () => {
  const CAMP = {
    levels: { burrow: 3, oak: 2, store: 2, fence: 1, tower: 1, hut: 2 },
    yard: [{ kind: "workshop", level: 1 }, { kind: null, level: 0 }],
    camps: 7,
    banners: 2,
    trophies: 14
  };

  test("is saved and shown, and nothing sent beside it is kept", async () => {
    const me = await reader({ prefix: "camp" });
    assert.equal((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, null);
    assert.equal((await call("GET", `/v1/profile/${me.handle}`)).body.camp, null);

    // What the app never sends, sent anyway: the books behind the trophies, the acorns.
    const nosy = {
      ...CAMP,
      acorns: 950,
      raised: ["a-book-id", "another-book-id"],
      levels: { ...CAMP.levels, cellar: 4 },
      yard: [{ ...CAMP.yard[0], built: "2026-10-01" }, CAMP.yard[1]]
    };
    const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: nosy } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.camp, CAMP);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, CAMP);
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`)).body.camp, CAMP);
    const friend = await reader();
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`, { token: friend.token })).body.camp, CAMP);
    const stored = await db.collection("profiles").findOne({ _id: me.id });
    assert.deepEqual(stored.camp, CAMP);
    assert.equal(JSON.stringify(stored).includes("a-book-id"), false);

    // A camp with nothing built yet, and one with an empty yard, are camps too.
    const bare = {
      levels: { burrow: 0, oak: 0, store: 0, fence: 0, tower: 0, hut: 0 },
      yard: [],
      camps: 0,
      banners: 0,
      trophies: 0
    };
    assert.deepEqual((await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: bare } })).body.camp, bare);
    // The most each part can be.
    const most = {
      levels: { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut: 5 },
      yard: [{ kind: "hive", level: 3 }, { kind: "stall", level: 3 }],
      camps: 100_000,
      banners: 100_000,
      trophies: 100_000
    };
    assert.deepEqual((await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: most } })).body.camp, most);
  });

  test("null clears it, and a save that does not name it leaves it alone", async () => {
    const me = await reader({ extra: { camp: CAMP } });
    const other = await call("PUT", "/v1/profile/me", { token: me.token, body: { level: 3, arcade: { dash: 5 } } });
    assert.deepEqual(other.body.camp, CAMP);

    const cleared = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: null } });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.camp, null);
    assert.equal((await call("GET", `/v1/profile/${me.handle}`)).body.camp, null);
    assert.equal((await db.collection("profiles").findOne({ _id: me.id })).camp, null);
    // The rest of the profile is as it was.
    assert.equal(cleared.body.level, 3);
  });

  test("a wrong shape is refused, and changes nothing", async () => {
    const me = await reader({ extra: { camp: CAMP } });
    const without = (key) => Object.fromEntries(Object.entries(CAMP).filter(([name]) => name !== key));
    const bad = [
      "a fine camp",
      7,
      true,
      [],
      [CAMP],
      {},
      without("levels"),
      without("yard"),
      without("camps"),
      without("banners"),
      without("trophies"),
      { ...CAMP, levels: null },
      { ...CAMP, levels: [3, 2, 2, 1, 1, 2] },
      { ...CAMP, levels: { burrow: 3 } },
      { ...CAMP, levels: { ...CAMP.levels, hut: undefined } },
      { ...CAMP, levels: { ...CAMP.levels, burrow: 6 } },
      { ...CAMP, levels: { ...CAMP.levels, oak: -1 } },
      { ...CAMP, levels: { ...CAMP.levels, store: 2.5 } },
      { ...CAMP, levels: { ...CAMP.levels, tower: "1" } },
      { ...CAMP, levels: { ...CAMP.levels, fence: null } },
      { ...CAMP, yard: null },
      { ...CAMP, yard: { kind: "workshop", level: 1 } },
      { ...CAMP, yard: [CAMP.yard[0], CAMP.yard[1], CAMP.yard[1]] },
      { ...CAMP, yard: ["workshop"] },
      { ...CAMP, yard: [null] },
      { ...CAMP, yard: [{ level: 1 }] },
      { ...CAMP, yard: [{ kind: "workshop" }] },
      { ...CAMP, yard: [{ kind: "castle", level: 1 }] },
      { ...CAMP, yard: [{ kind: 3, level: 1 }] },
      { ...CAMP, yard: [{ kind: "hive", level: 4 }] },
      { ...CAMP, yard: [{ kind: "well", level: -1 }] },
      { ...CAMP, yard: [{ kind: "stall", level: 1.5 }] },
      { ...CAMP, camps: -1 },
      { ...CAMP, camps: 100_001 },
      { ...CAMP, camps: "7" },
      { ...CAMP, banners: ["2026-10", "2026-11"] },
      { ...CAMP, banners: 2.5 },
      { ...CAMP, trophies: ["a-book-id"] },
      { ...CAMP, trophies: null },
      { ...CAMP, trophies: 100_001 }
    ];
    for (const camp of bad) {
      const refused = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp, level: 9 } });
      assert.equal(refused.status, 400, JSON.stringify(camp));
      assert.equal(typeof refused.body.error, "string");
    }
    const kept = await call("GET", "/v1/profile/me", { token: me.token });
    assert.deepEqual(kept.body.camp, CAMP);
    assert.equal(kept.body.level, null, "nothing sent with a refused camp was saved either");
  });

  /** Where things stand in a camp: its buildings, its pieces of fence, what is set about it. */
  const LAYOUT = {
    spots: { burrow: [120, 90], oak: [44, 76], store: [176, 70], tower: [200, 100], hut: [64, 104], yard0: [150, 108], yard1: [96, 66] },
    walls: [[110, 104], [120, 104], [130, 104]],
    decor: [{ kind: 3, x: 30, y: 100 }, { kind: 0, x: 222, y: 60 }]
  };

  test("its layout is saved and shown, and a camp sent without one has none", async () => {
    const me = await reader({ prefix: "campl" });
    const laid = { ...CAMP, ...LAYOUT };
    const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: laid } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.camp, laid);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, laid);
    const friend = await reader();
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`, { token: friend.token })).body.camp, laid);
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, laid);

    // The edges of the clearing, no fence and nothing set down: a layout too.
    const edges = {
      ...CAMP,
      spots: { burrow: [0, 0], oak: [240, 120], store: [0, 120], tower: [240, 0], hut: [1, 1], yard0: [239, 119], yard1: [120, 60] },
      walls: [],
      decor: []
    };
    assert.deepEqual((await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: edges } })).body.camp, edges);
    // As many pieces of fence and things as a camp holds, of every kind.
    const full = {
      ...CAMP,
      ...LAYOUT,
      walls: Array.from({ length: 32 }, (_, piece) => [8 + piece * 7, 116]),
      decor: Array.from({ length: 24 }, (_, thing) => ({ kind: thing % 18, x: 8 + thing * 9, y: 52 + thing })),
      land: Array.from({ length: 30 }, (_, piece) => ({ kind: piece % 10, x: 240 - piece, y: 120 - piece })),
      works: Array.from({ length: 12 }, (_, work) => ({ kind: work, x: 20 + work * 20, y: 110 })),
      guards: [3, 3, 3, 3, 3, 3, 3],
      posts: [[200, 100], [100, 104], [30, 80], [130, 96], null, [160, 110], [60, 108]]
    };
    const most = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: full } });
    assert.deepEqual(most.body.camp, full);
    assert.ok(JSON.stringify(most.body.camp).length < 3072, "the fullest camp is still small");
    // The same with every number as long as it can be written.
    const widest = {
      levels: { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut: 5 },
      yard: [{ kind: "workshop", level: 3 }, { kind: "workshop", level: 3 }],
      camps: 100_000,
      banners: 100_000,
      trophies: 100_000,
      spots: Object.fromEntries(Object.keys(LAYOUT.spots).map((site) => [site, [240, 120]])),
      walls: Array.from({ length: 32 }, () => [240, 120]),
      decor: Array.from({ length: 24 }, () => ({ kind: 17, x: 240, y: 120 })),
      land: Array.from({ length: 30 }, () => ({ kind: 9, x: 240, y: 120 })),
      works: Array.from({ length: 12 }, (_, work) => ({ kind: work, x: 240, y: 120 })),
      guards: [3, 3, 3, 3, 3, 3, 3],
      posts: Array.from({ length: 7 }, (_, guard) => (guard === 4 ? null : [240, 120]))
    };
    const wide = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: widest } });
    assert.deepEqual(wide.body.camp, widest);
    assert.equal(JSON.stringify(wide.body.camp).length, 2588);
    assert.ok(JSON.stringify(wide.body.camp).length < 3072, `the widest camp is ${JSON.stringify(wide.body.camp).length} bytes`);

    // An app from before the layout sends none: saved as ever, and the layout held goes with the old camp.
    const plain = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: CAMP } });
    assert.equal(plain.status, 200);
    assert.deepEqual(plain.body.camp, CAMP);
    for (const part of ["spots", "walls", "decor", "land", "works", "guards", "posts"]) {
      assert.equal(part in plain.body.camp, false, part);
    }
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, CAMP);
  });

  test("a layout that is not one is left out or mended, never refused", async () => {
    const me = await reader({ prefix: "campm" });
    const save = async (layout) => {
      const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...layout } } });
      assert.equal(saved.status, 200, JSON.stringify([layout, saved.body]));
      return saved.body.camp;
    };

    // A part of the wrong type altogether is left out, and the camp is saved without it.
    for (const wrong of ["a layout", 7, true, null, [[120, 90]]]) {
      assert.deepEqual(await save({ spots: wrong }), CAMP, JSON.stringify(wrong));
    }
    for (const wrong of ["a fence", 7, true, null, { 0: [110, 104] }]) {
      assert.deepEqual(await save({ walls: wrong }), CAMP, JSON.stringify(wrong));
      assert.deepEqual(await save({ decor: wrong }), CAMP, JSON.stringify(wrong));
    }
    // One part wrong takes nothing from the others.
    assert.deepEqual(await save({ ...LAYOUT, walls: "a fence" }), { ...CAMP, spots: LAYOUT.spots, decor: LAYOUT.decor });

    // Buildings: one with no place that can be read is left out, and so is one no camp has.
    const spots = await save({
      spots: { burrow: [120, 90], oak: "left", store: [176], tower: [200.5, 100], hut: ["64", 104], yard0: null, yard1: [96, 66, 3], cellar: [50, 50], fence: [10, 60] }
    });
    assert.deepEqual(spots.spots, { burrow: [120, 90], yard1: [96, 66] });
    // With none that can be read there is nothing to say.
    assert.deepEqual(await save({ spots: { oak: "left", cellar: [50, 50] } }), CAMP);
    assert.deepEqual(await save({ spots: {} }), CAMP);
    // A place outside the clearing is brought to its edge.
    const far = await save({ spots: { burrow: [-20, 500], oak: [9999, -1], store: [1e300, -1e300] }, walls: [[-5, 130], [241, 121]], decor: [{ kind: 4, x: 900, y: -3 }] });
    assert.deepEqual(far.spots, { burrow: [0, 120], oak: [240, 0], store: [240, 0] });
    assert.deepEqual(far.walls, [[0, 120], [240, 120]]);
    assert.deepEqual(far.decor, [{ kind: 4, x: 240, y: 0 }]);

    // Fence: what is not a place is dropped, and the rest keep their order.
    const walls = await save({ walls: [[10, 60], "a wall", [20], [30, 60.5], { x: 40, y: 60 }, null, [50, 60, "oak"], [[60], 60], [70, 60]] });
    assert.deepEqual(walls.walls, [[10, 60], [50, 60], [70, 60]]);
    // Things: one of a kind no camp has is dropped, never taken for another; nothing sent beside a thing is kept.
    const decor = await save({
      decor: [
        { kind: 9, x: 232, y: 116, name: "Picnic blanket", cost: 30 },
        { kind: 18, x: 50, y: 60 },
        { kind: -1, x: 50, y: 60 },
        { kind: "pond", x: 50, y: 60 },
        { kind: 1.5, x: 50, y: 60 },
        { kind: 2, x: "50", y: 60 },
        { kind: 2, x: 50 },
        [2, 50, 60],
        null,
        "a bench",
        { kind: 0, x: 8, y: 52 }
      ]
    });
    assert.deepEqual(decor.decor, [{ kind: 9, x: 232, y: 116 }, { kind: 0, x: 8, y: 52 }]);

    // More than a camp holds: the first thirty-two pieces of fence and the first two dozen things that can be read.
    const many = await save({
      walls: ["a wall", ...Array.from({ length: 33 }, (_, piece) => [piece, 60])],
      decor: [null, ...Array.from({ length: 60 }, (_, thing) => ({ kind: thing % 10, x: thing, y: 60 }))]
    });
    assert.deepEqual(many.walls, Array.from({ length: 32 }, (_, piece) => [piece, 60]));
    assert.deepEqual(many.decor, Array.from({ length: 24 }, (_, thing) => ({ kind: thing % 10, x: thing, y: 60 })));
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, many);

    // The rest of the camp is still held to its rules, layout or no layout.
    const refused = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...LAYOUT, camps: -1 } } });
    assert.equal(refused.status, 400);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, many);
  });

  /** What else stands about a camp: its landscape, its defences, and the guardian at each of seven posts. */
  const ABOUT = {
    land: [{ kind: 0, x: 20, y: 64 }, { kind: 7, x: 210, y: 88 }],
    works: [{ kind: 2, x: 132, y: 112 }],
    guards: [3, 0, 2, 0, 1, 0, 0]
  };

  test("its landscape, defences and guardians are saved and shown, with or without the rest of the layout", async () => {
    const me = await reader({ prefix: "campa" });
    const whole = { ...CAMP, ...LAYOUT, ...ABOUT };
    const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: whole } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.camp, whole);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, whole);
    const friend = await reader();
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`, { token: friend.token })).body.camp, whole);
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, whole);

    // Each on its own, and at the edges of what it can be.
    for (const part of [
      { land: ABOUT.land },
      { works: ABOUT.works },
      { guards: ABOUT.guards },
      { land: [{ kind: 9, x: 0, y: 0 }, { kind: 0, x: 240, y: 120 }], works: [{ kind: 0, x: 0, y: 120 }, { kind: 11, x: 240, y: 0 }], guards: [0, 0, 0, 0, 0, 0, 1] },
      // The four defences an app from before the others knows: kept as they always were.
      { works: Array.from({ length: 4 }, (_, work) => ({ kind: work, x: 100 + work * 20, y: 110 })) },
      // No landscape and no defence is still said, as an empty list.
      { land: [], works: [] }
    ]) {
      const alone = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...part } } });
      assert.equal(alone.status, 200, JSON.stringify(part));
      assert.deepEqual(alone.body.camp, { ...CAMP, ...part }, JSON.stringify(part));
    }
    // An app from before them sends the layout it knows, and nothing is made up for the rest.
    const older = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...LAYOUT } } });
    assert.deepEqual(older.body.camp, { ...CAMP, ...LAYOUT });
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, { ...CAMP, ...LAYOUT });
  });

  test("landscape, defences or guardians that are not are left out or mended, never refused", async () => {
    const me = await reader({ prefix: "campb" });
    const save = async (about) => {
      const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...about } } });
      assert.equal(saved.status, 200, JSON.stringify([about, saved.body]));
      return saved.body.camp;
    };

    // A part of the wrong type altogether is left out, and the camp is saved without it.
    for (const wrong of ["a pond", 7, true, null, { 0: { kind: 0, x: 20, y: 64 } }, { kind: 0, x: 20, y: 64 }]) {
      assert.deepEqual(await save({ land: wrong }), CAMP, JSON.stringify(wrong));
      assert.deepEqual(await save({ works: wrong }), CAMP, JSON.stringify(wrong));
      assert.deepEqual(await save({ guards: wrong }), CAMP, JSON.stringify(wrong));
    }
    // One part wrong takes nothing from the others.
    assert.deepEqual(await save({ ...LAYOUT, ...ABOUT, land: "a pond" }), { ...CAMP, ...LAYOUT, works: ABOUT.works, guards: ABOUT.guards });

    // Landscape: ten kinds, a place brought inside the scene, and nothing sent beside a piece is kept.
    const land = await save({
      land: [
        { kind: 9, x: 12, y: 70, name: "Pond" },
        { kind: 10, x: 50, y: 60 },
        { kind: -1, x: 50, y: 60 },
        { kind: "pond", x: 50, y: 60 },
        { kind: 0.5, x: 50, y: 60 },
        { kind: 1, x: 50.5, y: 60 },
        { kind: 1, x: "50", y: 60 },
        { kind: 1, y: 60 },
        [1, 50, 60],
        "a knoll",
        null,
        { kind: 0, x: -40, y: 4000 }
      ]
    });
    assert.deepEqual(land.land, [{ kind: 9, x: 12, y: 70 }, { kind: 0, x: 0, y: 120 }]);
    // Defences: twelve kinds. One that decorations have and defences do not is dropped.
    const works = await save({
      works: [
        { kind: 12, x: 50, y: 60 },
        { kind: 17, x: 50, y: 60 },
        { kind: -1, x: 50, y: 60 },
        { kind: "moat", x: 50, y: 60 },
        { kind: 11.5, x: 50, y: 60 },
        { kind: 1, x: null, y: 60 },
        { kind: 2, x: 241, y: 121, cost: 400 },
        { kind: 0, x: 100, y: 100 },
        { kind: 11, x: 60, y: 90 },
        // One of a kind at most: a second is dropped. One that could not be read was never the first.
        { kind: 2, x: 10, y: 10 },
        { kind: 11, x: 60, y: 90 },
        { kind: 1, x: 30, y: 40 },
        { kind: 4, x: 150, y: 70 }
      ]
    });
    assert.deepEqual(works.works, [{ kind: 2, x: 240, y: 120 }, { kind: 0, x: 100, y: 100 }, { kind: 11, x: 60, y: 90 }, { kind: 1, x: 30, y: 40 }, { kind: 4, x: 150, y: 70 }]);
    // Nothing but one kind, many times over: the first of them.
    assert.deepEqual((await save({ works: Array.from({ length: 12 }, (_, work) => ({ kind: 5, x: work, y: 60 })) })).works, [{ kind: 5, x: 0, y: 60 }]);

    // More than a camp holds: the first thirty pieces and the first twelve defences that can be read, one of each kind.
    const many = await save({
      land: [null, ...Array.from({ length: 50 }, (_, piece) => ({ kind: piece % 10, x: piece, y: 60 }))],
      works: [{ kind: 12, x: 1, y: 1 }, ...Array.from({ length: 13 }, (_, work) => ({ kind: work % 12, x: work, y: 60 }))]
    });
    assert.deepEqual(many.land, Array.from({ length: 30 }, (_, piece) => ({ kind: piece % 10, x: piece, y: 60 })));
    assert.deepEqual(many.works, Array.from({ length: 12 }, (_, work) => ({ kind: work, x: work, y: 60 })));

    // Guardians: always seven ranks. A short list is filled out, a long one cut, a rank past the top is the top, and what is not a rank is none.
    assert.deepEqual((await save({ guards: [1] })).guards, [1, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual((await save({ guards: [0, 0, 0, 0, 0, 0, 2, 3, 3] })).guards, [0, 0, 0, 0, 0, 0, 2]);
    assert.deepEqual((await save({ guards: [9, -2, "3", 2.5, null, 1e300, 1] })).guards, [3, 0, 0, 0, 0, 3, 1]);
    // Nobody posted, nobody among the seven, or nothing that can be read: not said.
    for (const none of [[], [0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 3], ["3", 2.5, true, [3]]]) {
      assert.deepEqual(await save({ guards: none }), CAMP, JSON.stringify(none));
    }
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, CAMP);

    // The rest of the camp is still held to its rules.
    const refused = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...ABOUT, camps: -1 } } });
    assert.equal(refused.status, 400);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, CAMP);
  });

  test("the guardians' signposts are seven places or nulls, mended or left out, never refused", async () => {
    const me = await reader({ prefix: "campp" });
    const POSTED = { guards: [3, 1, 2, 1, 3, 1, 2] };
    const save = async (about) => {
      const saved = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...about } } });
      assert.equal(saved.status, 200, JSON.stringify([about, saved.body]));
      return saved.body.camp;
    };

    // Every post carried somewhere: saved and shown as sent, the dragon's place in the list held by a null.
    const all = [[200, 100], [100, 104], [30, 80], [130, 96], null, [160, 110], [60, 108]];
    const whole = { ...CAMP, ...LAYOUT, ...ABOUT, ...POSTED, posts: all };
    assert.deepEqual(await save({ ...LAYOUT, ...ABOUT, ...POSTED, posts: all }), whole);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, whole);
    const friend = await reader();
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`, { token: friend.token })).body.camp, whole);
    assert.deepEqual((await db.collection("profiles").findOne({ _id: me.id })).camp, whole);
    // Only some moved: the rest stay null, and the app stands them beside the building.
    const some = [null, null, [30, 80], null, null, null, [0, 0]];
    assert.deepEqual((await save({ ...POSTED, posts: some })).posts, some);

    // Nothing moved is not said at all: the camp is what it was before signposts could be carried.
    const unmoved = await save({ ...POSTED, posts: [null, null, null, null, null, null, null] });
    assert.deepEqual(unmoved, { ...CAMP, ...POSTED });
    assert.equal("posts" in unmoved, false);
    assert.equal(JSON.stringify(unmoved), JSON.stringify(await save(POSTED)));
    assert.equal("posts" in (await db.collection("profiles").findOne({ _id: me.id })).camp, false);

    // The dragon has no post, and neither has a guardian who is not posted, whatever is sent for them.
    assert.deepEqual((await save({ ...POSTED, posts: [[200, 100], [100, 104], [30, 80], [130, 96], [176, 60], [160, 110], [60, 108]] })).posts, all);
    assert.deepEqual((await save({ guards: [3, 0, 2, 0, 0, 0, 0], posts: all })).posts, [[200, 100], null, [30, 80], null, null, null, null]);
    assert.deepEqual(await save({ ...POSTED, posts: [null, null, null, null, [176, 60], null, null] }), { ...CAMP, ...POSTED });
    // With nobody posted, or no ranks that can be read, there are no posts to say.
    for (const guards of [undefined, [0, 0, 0, 0, 0, 0, 0], [], "3,1,2", null]) {
      assert.deepEqual(await save({ guards, posts: all }), CAMP, JSON.stringify(guards));
    }

    // A place outside the clearing is brought to its edge.
    const far = await save({ ...POSTED, posts: [[-20, 500], [9999, -1], [1e300, -1e300], [241, 121], null, [0, 0], [240, 120]] });
    assert.deepEqual(far.posts, [[0, 120], [240, 0], [240, 0], [240, 120], null, [0, 0], [240, 120]]);
    // One that is not a place is null, and takes nothing from the others.
    const mended = await save({ ...POSTED, posts: [[200.5, 100], "left", [30], { x: 130, y: 96 }, null, ["160", 110], [60, 108, 7]] });
    assert.deepEqual(mended.posts, [null, null, null, null, null, null, [60, 108]]);
    assert.deepEqual(await save({ ...POSTED, posts: [[200.5, 100], "left", [30], { x: 130, y: 96 }, null, ["160", 110], true] }), { ...CAMP, ...POSTED });

    // What is not a list of seven is left out altogether, and the rest of the camp is saved without it.
    for (const wrong of [
      "a signpost",
      7,
      true,
      null,
      {},
      { 0: [200, 100], 2: [30, 80] },
      [],
      [[200, 100]],
      all.slice(0, 6),
      [...all, [50, 60]],
      [all]
    ]) {
      assert.deepEqual(await save({ ...POSTED, posts: wrong }), { ...CAMP, ...POSTED }, JSON.stringify(wrong));
    }
    // One part wrong takes nothing from the others.
    assert.deepEqual(await save({ ...LAYOUT, ...ABOUT, posts: "a signpost" }), { ...CAMP, ...LAYOUT, ...ABOUT });
    assert.deepEqual((await save({ ...POSTED, posts: some, works: "a moat" })).posts, some);

    // The rest of the camp is still held to its rules, posts or no posts.
    const refused = await call("PUT", "/v1/profile/me", { token: me.token, body: { camp: { ...CAMP, ...POSTED, posts: all, camps: -1 } } });
    assert.equal(refused.status, 400);
    assert.deepEqual((await call("GET", "/v1/profile/me", { token: me.token })).body.camp, { ...CAMP, ...POSTED, posts: some });
  });

  test("is not on a locked card, and is not kept for a private profile", async () => {
    const quiet = await reader({ visibility: "followers", prefix: "campq", extra: { camp: CAMP } });
    const stranger = await reader();
    const fan = await reader();
    await follow(fan, quiet);

    // Locked: who it is, nothing of the camp, to a stranger signed in or out.
    for (const token of [undefined, stranger.token]) {
      const card = await call("GET", `/v1/profile/${quiet.handle}`, { token });
      assert.equal(card.status, 200);
      assert.equal(card.body.locked, true);
      assert.equal("camp" in card.body, false);
      assert.equal(JSON.stringify(card.body).includes("burrow"), false);
    }
    // In full to its owner and to a reader it accepted.
    for (const token of [quiet.token, fan.token]) {
      const full = await call("GET", `/v1/profile/${quiet.handle}`, { token });
      assert.equal(full.body.locked, false);
      assert.deepEqual(full.body.camp, CAMP);
    }
    // Nor in search, where a followers-only reader is a locked row.
    const found = await call("GET", `/v1/search?q=${quiet.handle}`);
    assert.equal(JSON.stringify(found.body).includes("burrow"), false);

    // Going private takes it off the server, and the handle answers like one that does not exist.
    await setVisibility(quiet, "private");
    assert.equal((await db.collection("profiles").findOne({ _id: quiet.id })).camp, null);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`, { token: fan.token })).status, 404);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}`)).status, 404);

    // Sent for a private profile it is checked, answered and not stored.
    const shy = await reader({ visibility: "private" });
    const late = await call("PUT", "/v1/profile/me", { token: shy.token, body: { camp: CAMP } });
    assert.equal(late.status, 200);
    assert.equal(late.body.camp, null);
    assert.equal((await db.collection("profiles").findOne({ _id: shy.id })).camp ?? null, null);
    assert.equal((await call("PUT", "/v1/profile/me", { token: shy.token, body: { camp: { ...CAMP, camps: -1 } } })).status, 400);
    // Shared again, with a camp: kept from then on.
    await setVisibility(shy, "followers", { camp: CAMP });
    assert.deepEqual((await db.collection("profiles").findOne({ _id: shy.id })).camp, CAMP);
  });
});

describe("the library", () => {
  const BOOKS = [book("isbn:1", "reading", 40), book("isbn:2", "finished", 100), book("isbn:3", "unread", 0)];

  test("is given to its owner and their followers, and to nobody else", async () => {
    const owner = await reader({ extra: { shareLibrary: true } });
    const fan = await reader();
    const stranger = await reader();
    await follow(fan, owner);

    const put = await call("PUT", "/v1/library/me", {
      token: owner.token,
      body: { books: [{ ...BOOKS[0], key: "  ISBN:1 ", title: " A\tTitle " }, BOOKS[1], BOOKS[2], { ...BOOKS[2], percent: 3 }] }
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.deepEqual(put.body, { count: 3 }, "a key sent twice is one book");

    const own = await call("GET", `/v1/profile/${owner.handle}/library`, { token: owner.token });
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.books, [
      { key: "isbn:1", title: "A Title", author: "An Author", state: "reading", percent: 40 },
      BOOKS[1],
      { ...BOOKS[2], percent: 3 }
    ]);
    assert.ok(!Number.isNaN(new Date(own.body.updatedAt).getTime()));
    assert.deepEqual((await call("GET", `/v1/profile/${owner.handle}/library`, { token: fan.token })).body, own.body);
    assert.equal((await call("GET", `/v1/profile/${owner.handle}`, { token: stranger.token })).body.sharesLibrary, true);

    // A stranger is told how to see it; signed out, to sign in.
    const refused = await call("GET", `/v1/profile/${owner.handle}/library`, { token: stranger.token });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /[Ff]ollow/);
    assert.equal((await call("GET", `/v1/profile/${owner.handle}/library`)).status, 401);
    assert.equal((await call("GET", "/v1/profile/nobody-here/library", { token: fan.token })).status, 404);

    // Replaced whole by the next upload.
    assert.deepEqual((await call("PUT", "/v1/library/me", { token: owner.token, body: { books: [BOOKS[1]] } })).body, { count: 1 });
    assert.deepEqual((await call("GET", `/v1/profile/${owner.handle}/library`, { token: fan.token })).body.books, [BOOKS[1]]);

    // Switched off: there is no library to be had, for anyone.
    await call("PUT", "/v1/profile/me", { token: owner.token, body: { shareLibrary: false } });
    for (const who of [owner, fan, stranger]) {
      assert.equal((await call("GET", `/v1/profile/${owner.handle}/library`, { token: who.token })).status, 404);
    }
    assert.equal((await call("GET", `/v1/profile/${owner.handle}`, { token: fan.token })).body.sharesLibrary, false);
    await call("PUT", "/v1/profile/me", { token: owner.token, body: { shareLibrary: true } });
    assert.equal((await call("GET", `/v1/profile/${owner.handle}/library`, { token: fan.token })).status, 200);

    // Deleted: shared still, and empty.
    assert.deepEqual((await call("DELETE", "/v1/library/me", { token: owner.token })).body, { deleted: true });
    assert.deepEqual((await call("GET", `/v1/profile/${owner.handle}/library`, { token: fan.token })).body, { books: [], updatedAt: null });
    assert.equal((await call("DELETE", "/v1/library/me")).status, 401);
    assert.equal((await call("PUT", "/v1/library/me", { body: { books: [] } })).status, 401);
  });

  test("a followers-only reader's is for accepted followers; a private reader has none", async () => {
    const quiet = await reader({ visibility: "followers", extra: { shareLibrary: true } });
    const fan = await reader();
    const waiting = await reader();
    const stranger = await reader();
    await follow(fan, quiet);
    await call("POST", `/v1/follows/${quiet.handle}`, { token: waiting.token });
    assert.equal((await call("PUT", "/v1/library/me", { token: quiet.token, body: { books: BOOKS } })).status, 200);

    assert.equal((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: fan.token })).body.books.length, 3);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: quiet.token })).body.books.length, 3);
    // Not visible to them at all, so not "follow first" but nothing there.
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: stranger.token })).status, 404);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: waiting.token })).status, 404);

    // Made private: the library leaves the server, and the reader answers like no reader.
    await setVisibility(quiet, "private");
    assert.equal(await count("libraries", { _id: quiet.id }), 0);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: fan.token })).status, 404);
    assert.equal((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: quiet.token })).status, 404);
    // And one cannot be uploaded while private.
    const refused = await call("PUT", "/v1/library/me", { token: quiet.token, body: { books: BOOKS } });
    assert.equal(refused.status, 403);
    assert.equal(await count("libraries", { _id: quiet.id }), 0);
    // Shared again, there is nothing until the app uploads it again.
    await setVisibility(quiet, "followers");
    assert.deepEqual((await call("GET", `/v1/profile/${quiet.handle}/library`, { token: fan.token })).body, { books: [], updatedAt: null });
  });

  test("an upload is checked book by book, and bounded", async () => {
    const me = await reader();
    const put = (books) => call("PUT", "/v1/library/me", { token: me.token, body: { books } });
    const bad = [
      "not a list",
      [{ ...BOOKS[0], key: "" }],
      [{ ...BOOKS[0], key: "k".repeat(161) }],
      [{ ...BOOKS[0], key: 12 }],
      [{ ...BOOKS[0], title: "   " }],
      [{ ...BOOKS[0], author: 5 }],
      [{ ...BOOKS[0], state: "abandoned" }],
      [{ ...BOOKS[0], percent: 100.5 }],
      [{ ...BOOKS[0], percent: -1 }],
      ["a book"],
      Array.from({ length: 3001 }, (_, index) => book(`k${index}`))
    ];
    for (const books of bad) {
      assert.equal((await put(books)).status, 400, JSON.stringify(books).slice(0, 80));
    }
    assert.equal((await call("PUT", "/v1/library/me", { token: me.token, body: {} })).status, 400);
    assert.equal(await count("libraries", { _id: me.id }), 0);

    // Three thousand books with long titles is more than a small body, and goes in.
    const big = Array.from({ length: 3000 }, (_, index) => ({ ...book(`key-${index}`), title: "T".repeat(150), author: null }));
    const saved = await put(big);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.count, 3000);
    const kept = await db.collection("libraries").findOne({ _id: me.id });
    assert.equal(kept.books.length, 3000);
    assert.equal(kept.books[0].author, null);
  });

  test("among the readers I follow: who finished a book, and up to five reading it", async () => {
    const me = await reader();
    const sharing = { extra: { shareLibrary: true } };
    // Six reading the same book, each a different way through it.
    const readers = [];
    for (const percent of [10, 95, 50, 70, 30, 85]) {
      const friend = await reader({ ...sharing, visibility: percent === 95 ? "followers" : "public" });
      await follow(me, friend);
      await call("PUT", "/v1/library/me", { token: friend.token, body: { books: [book("book:one", "reading", percent), book("book:two", "unread", 0)] } });
      readers.push({ ...friend, percent });
    }
    // Two who finished things.
    const done = await reader(sharing);
    await follow(me, done);
    await call("PUT", "/v1/library/me", { token: done.token, body: { books: [book("book:one", "finished", 100), book("book:three", "finished", 100)] } });
    const alsoDone = await reader(sharing);
    await follow(me, alsoDone);
    await call("PUT", "/v1/library/me", { token: alsoDone.token, body: { books: [book("book:three", "finished", 100)] } });

    // And readers who must not count: one who does not share their library,
    // one I do not follow, one whose request is still waiting, one gone private.
    const closed = await reader();
    await follow(me, closed);
    await call("PUT", "/v1/library/me", { token: closed.token, body: { books: [book("book:one", "finished", 100)] } });
    const unknown = await reader(sharing);
    await call("PUT", "/v1/library/me", { token: unknown.token, body: { books: [book("book:one", "reading", 99)] } });
    const pending = await reader({ ...sharing, visibility: "followers" });
    await call("POST", `/v1/follows/${pending.handle}`, { token: me.token });
    await call("PUT", "/v1/library/me", { token: pending.token, body: { books: [book("book:one", "reading", 98)] } });
    const hidden = await reader(sharing);
    await follow(me, hidden);
    await call("PUT", "/v1/library/me", { token: hidden.token, body: { books: [book("book:one", "reading", 97)] } });
    await db.collection("profiles").updateOne({ _id: hidden.id }, { $set: { visibility: "private" } });

    const asked = await call("POST", "/v1/library/among", {
      token: me.token,
      body: { keys: ["book:three", " BOOK:ONE ", "book:two", "book:nobody", "book:one", "$books"] }
    });
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    // Only the books somebody has finished or is reading, in the order asked.
    assert.deepEqual(asked.body.books.map((entry) => entry.key), ["book:three", "book:one"]);
    const [three, one] = asked.body.books;
    assert.equal(three.finished, 2);
    assert.deepEqual(three.readers, []);
    assert.equal(one.finished, 1);
    // Five of the six, furthest along first.
    assert.deepEqual(one.readers.map((row) => row.percent), [95, 85, 70, 50, 30]);
    const top = [...readers].sort((a, b) => b.percent - a.percent).slice(0, 5);
    assert.deepEqual(one.readers.map((row) => row.handle), top.map((row) => row.handle));
    assert.deepEqual(Object.keys(one.readers[0]).sort(), [...PERSON, "percent", "state"].sort());
    assert.equal(one.readers[0].state, "reading");

    assert.deepEqual((await call("POST", "/v1/library/among", { token: me.token, body: { keys: [] } })).body, { books: [] });
    // Someone who follows nobody is told about nobody.
    assert.deepEqual((await call("POST", "/v1/library/among", { token: unknown.token, body: { keys: ["book:one"] } })).body, { books: [] });
    const tooMany = Array.from({ length: 501 }, (_, index) => `k${index}`);
    assert.equal((await call("POST", "/v1/library/among", { token: me.token, body: { keys: tooMany } })).status, 400);
    assert.equal((await call("POST", "/v1/library/among", { token: me.token, body: { keys: tooMany.slice(0, 500).map((key) => key.padEnd(160, "x")) } })).status, 200);
    assert.equal((await call("POST", "/v1/library/among", { token: me.token, body: { keys: [5] } })).status, 400);
    assert.equal((await call("POST", "/v1/library/among", { token: me.token, body: {} })).status, 400);
    assert.equal((await call("POST", "/v1/library/among", { body: { keys: [] } })).status, 401);
  });
});

describe("finished-book posts and the feed", () => {
  /** Posts written straight to the database, a second apart, newest last: past the daily allowance, and in a known order. */
  async function seed(who, howMany, startMs) {
    const rows = Array.from({ length: howMany }, (_, index) => ({
      userId: who.id,
      kind: "finished",
      title: `${who.handle} book ${index}`,
      author: null,
      rating: null,
      line: null,
      createdAt: new Date(startMs + index * 1000)
    }));
    await db.collection("posts").insertMany(rows);
    return rows;
  }

  test("a post is the book, a rating and a line, from a reader who shares", async () => {
    const me = await reader({ prefix: "post" });
    const made = await call("POST", "/v1/posts", {
      token: me.token,
      body: { title: "  Piranesi ", author: "Susanna Clarke", rating: 5, line: "The beauty of the House\nis immeasurable." }
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const { post } = made.body;
    assert.match(post.id, /^[0-9a-f]{24}$/);
    assert.deepEqual(Object.keys(post.person).sort(), PERSON);
    // (A post has since grown more fields: the other kinds', its audience and
    // its likes. `test/social3.test.js` checks those; these are the first.)
    assert.deepEqual(
      { kind: post.kind, person: post.person.handle, title: post.title, author: post.author, rating: post.rating, line: post.line, isYou: post.isYou },
      { kind: "finished", person: me.handle, title: "Piranesi", author: "Susanna Clarke", rating: 5, line: "The beauty of the House is immeasurable.", isYou: true }
    );
    const stored = await db.collection("posts").findOne({ _id: new ObjectId(post.id) });
    assert.equal(stored.kind, "finished");
    assert.ok(stored.userId.equals(me.id));

    // Only the title is needed.
    const bare = await call("POST", "/v1/posts", { token: me.token, body: { title: "Dune" } });
    assert.deepEqual([bare.body.post.author, bare.body.post.rating, bare.body.post.line], [null, null, null]);

    for (const body of [{}, { title: "" }, { title: 5 }, { title: "x", rating: 0 }, { title: "x", rating: 6 }, { title: "x", rating: 4.5 }, { title: "x", line: 9 }, { title: "x", author: {} }]) {
      assert.equal((await call("POST", "/v1/posts", { token: me.token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await call("POST", "/v1/posts", { body: { title: "x" } })).status, 401);
    const shy = await reader({ visibility: "private" });
    assert.equal((await call("POST", "/v1/posts", { token: shy.token, body: { title: "x" } })).status, 403);

    // A post is for the reader's followers unless it says it is for everyone
    // (since posts gained an audience): a follower reads them, newest first;
    // anyone else, signed in or not, is given the page with none of them on it.
    const fan = await reader();
    await follow(fan, me);
    const seen = await call("GET", `/v1/profile/${me.handle}/posts`, { token: fan.token });
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.body.posts.map((row) => row.title), ["Dune", "Piranesi"]);
    assert.equal(seen.body.posts[0].isYou, false);
    const anon = await call("GET", `/v1/profile/${me.handle}/posts`);
    assert.equal(anon.status, 200);
    assert.deepEqual(anon.body.posts, []);
    assert.equal((await call("GET", `/v1/profile/${me.handle}/posts`, { token: me.token })).body.posts[0].isYou, true);

    // Deleting is for one's own.
    assert.equal((await call("DELETE", `/v1/posts/${post.id}`, { token: shy.token })).status, 404);
    assert.equal((await call("DELETE", `/v1/posts/${post.id}`)).status, 401);
    assert.equal((await call("DELETE", "/v1/posts/not-an-id", { token: me.token })).status, 404);
    assert.deepEqual((await call("DELETE", `/v1/posts/${post.id}`, { token: me.token })).body, { deleted: true });
    assert.equal((await call("DELETE", `/v1/posts/${post.id}`, { token: me.token })).status, 404);
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}/posts`, { token: fan.token })).body.posts.map((row) => row.title), ["Dune"]);
  });

  test("twenty posts a day, and no more", async () => {
    const me = await reader();
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: `Book ${index}` } })).status, 201);
    }
    const refused = await call("POST", "/v1/posts", { token: me.token, body: { title: "One too many" } });
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.retryAfter) > 0);
    assert.equal(await count("posts", { userId: me.id }), 20);
    // Deleting them does not buy twenty more: the day's count only goes up.
    const { posts: mine } = (await call("GET", `/v1/profile/${me.handle}/posts`, { token: me.token })).body;
    assert.equal((await call("DELETE", `/v1/posts/${mine[0].id}`, { token: me.token })).status, 200);
    assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: "In its place" } })).status, 429);
    // Yesterday's do not count against today. (The count is kept by UTC day,
    // in `tallies`, since the allowance stopped being a count of the posts.)
    const yesterday = new Date(Date.now() - 24 * 60 * MINUTE).toISOString().slice(0, 10);
    const moved = await db.collection("tallies").updateOne({ userId: me.id, kind: "post" }, { $set: { day: yesterday } });
    assert.equal(moved.modifiedCount, 1);
    assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: "A new day" } })).status, 201);
  });

  test("the feed is mine and my follows', newest first, thirty a page", async () => {
    const me = await reader({ prefix: "feed" });
    const friend = await reader();
    const quiet = await reader({ visibility: "followers" });
    const stranger = await reader();
    await follow(me, friend);
    await follow(me, quiet);
    const start = Date.now() - 60 * MINUTE;
    // 70 posts, interleaved in time: friend, quiet, me, friend, quiet, me...
    const all = [
      ...(await seed(friend, 30, start)),
      ...(await seed(quiet, 20, start + 300)),
      ...(await seed(me, 20, start + 600))
    ].sort((a, b) => b.createdAt - a.createdAt);
    await seed(stranger, 5, start + 900);

    const first = await call("GET", "/v1/feed", { token: me.token });
    assert.equal(first.status, 200);
    assert.equal(first.body.posts.length, 30);
    assert.equal(first.body.more, true);
    assert.deepEqual(first.body.posts.map((post) => post.title), all.slice(0, 30).map((post) => post.title));
    assert.equal(first.body.posts.find((post) => post.person.handle === me.handle).isYou, true);
    assert.equal(first.body.posts.find((post) => post.person.handle === friend.handle).isYou, false);

    const pages = [first.body];
    while (pages.at(-1).more) {
      const before = encodeURIComponent(pages.at(-1).posts.at(-1).createdAt);
      pages.push((await call("GET", `/v1/feed?before=${before}`, { token: me.token })).body);
      assert.ok(pages.length <= 4, "paging ends");
    }
    assert.deepEqual(pages.map((page) => page.posts.length), [30, 30, 10]);
    const seen = pages.flatMap((page) => page.posts);
    assert.deepEqual(seen.map((post) => post.title), all.map((post) => post.title));
    assert.equal(new Set(seen.map((post) => post.id)).size, 70);
    assert.equal(seen.some((post) => post.person.handle === stranger.handle), false);

    // A `before` that is not a date is as good as none.
    assert.equal((await call("GET", "/v1/feed?before=yesterday", { token: me.token })).body.posts.length, 30);
    // A feed of one's own, with nobody followed.
    const alone = await call("GET", "/v1/feed", { token: stranger.token });
    assert.deepEqual([alone.body.posts.length, alone.body.more], [5, false]);
    assert.equal((await call("GET", "/v1/feed")).status, 401);
  });

  test("a listed post names the book's author, not its poster's profile", async () => {
    // Listing looks the poster's profile up; that once landed on `author` and
    // wrote over the book's, so every listed post answered a list of profiles.
    const me = await reader({ prefix: "byline" });
    const posted = await call("POST", "/v1/posts", { token: me.token, body: { title: "Emma", author: "Jane Austen" } });
    assert.equal(posted.body.post.author, "Jane Austen");
    for (const path of ["/v1/feed", `/v1/profile/${me.handle}/posts`]) {
      const [listed] = (await call("GET", path, { token: me.token })).body.posts;
      assert.equal(listed.author, "Jane Austen", path);
      assert.equal(listed.person.handle, me.handle, path);
      assert.equal(listed.poster, undefined, path);
    }
  });

  test("a reader who goes private takes their posts out of every answer, until they share again", async () => {
    const me = await reader();
    const friend = await reader({ prefix: "gonepost" });
    await befriend(me, friend);
    await call("POST", "/v1/posts", { token: friend.token, body: { title: "A Book Only Friends See", line: "Loved it." } });
    await call("POST", "/v1/posts", { token: me.token, body: { title: "My Own Book" } });
    const titles = async (who) => (await call("GET", "/v1/feed", { token: who.token })).body.posts.map((post) => post.title);
    assert.deepEqual(await titles(me), ["My Own Book", "A Book Only Friends See"]);

    await setVisibility(friend, "private");
    assert.deepEqual(await titles(me), ["My Own Book"]);
    assert.equal((await call("GET", `/v1/profile/${friend.handle}/posts`, { token: me.token })).status, 404);
    // Hidden from their own feed too: nothing of a private profile is served, even to its owner.
    assert.deepEqual(await titles(friend), ["My Own Book"]);
    // Stored still, which is what lets them come back.
    assert.equal(await count("posts", { userId: friend.id }), 1);

    await setVisibility(friend, "followers");
    assert.deepEqual(await titles(me), ["My Own Book", "A Book Only Friends See"]);
    // Followers-only: the reader's posts are for the readers they accepted.
    assert.equal((await call("GET", `/v1/profile/${friend.handle}/posts`, { token: me.token })).body.posts.length, 1);
    assert.equal((await call("GET", `/v1/profile/${friend.handle}/posts`, { token: friend.token })).body.posts.length, 1);
    const stranger = await reader();
    assert.equal((await call("GET", `/v1/profile/${friend.handle}/posts`, { token: stranger.token })).status, 403);
    assert.equal((await call("GET", `/v1/profile/${friend.handle}/posts`)).status, 403);

    // Unfollowed, a reader's posts leave the feed.
    await call("DELETE", `/v1/follows/${friend.handle}`, { token: me.token });
    assert.deepEqual(await titles(me), ["My Own Book"]);
  });
});

describe("book clubs", () => {
  const makeClub = async (who, body = { name: "The Night Readers" }) => {
    const made = await call("POST", "/v1/clubs", { token: who.token, body });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return made.body.club;
  };
  const join = (who, code) => call("POST", `/v1/clubs/join?week=${WEEK}`, { token: who.token, body: { code } });

  test("made with a name, joined with its code, and members see each other's week", async () => {
    const owner = await reader({ minutes: 20, prefix: "club" });
    // Followers-only, and following nobody in the club: joining is the consent.
    const quiet = await reader({ visibility: "followers", minutes: 90 });
    const idle = await reader({ minutes: 0 });

    const club = await makeClub(owner, { name: "  The Night\nReaders ", goalMinutes: 300 });
    assert.deepEqual(Object.keys(club).sort(), ["books", "code", "goalMinutes", "id", "isOwner", "members", "name"]);
    assert.equal(club.name, "The Night Readers");
    assert.equal(club.goalMinutes, 300);
    assert.match(club.code, /^[ABCDEFGHJKMNPQRSTWXYZ23456789]{8}$/);
    assert.equal(club.isOwner, true);
    assert.deepEqual(club.books, []);
    assert.equal(club.members.length, 1);
    assert.deepEqual(Object.keys(club.members[0]).sort(), [...PERSON, "isYou", "weekMinutes"].sort());
    assert.deepEqual([club.members[0].handle, club.members[0].weekMinutes, club.members[0].isYou], [owner.handle, 20, true]);

    // The code as someone might type it.
    const joined = await join(quiet, `${club.code.slice(0, 4).toLowerCase()}-${club.code.slice(4).toLowerCase()}`);
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.club.id, club.id);
    assert.equal(joined.body.club.isOwner, false);
    // Most minutes first, then by handle.
    assert.deepEqual(joined.body.club.members.map((member) => member.handle), [quiet.handle, owner.handle]);
    assert.deepEqual(joined.body.club.members.map((member) => member.weekMinutes), [90, 20]);
    assert.deepEqual(joined.body.club.members.map((member) => member.isYou), [true, false]);
    // Joining again changes nothing.
    assert.equal((await join(quiet, club.code)).status, 200);
    await join(idle, club.code);
    assert.equal((await db.collection("clubs").findOne({ _id: new ObjectId(club.id) })).memberIds.length, 3);

    const mine = await call("GET", `/v1/clubs?week=${WEEK}`, { token: owner.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.clubs.length, 1);
    assert.deepEqual(mine.body.clubs[0].members.map((member) => member.handle), [quiet.handle, owner.handle, idle.handle]);
    assert.equal(mine.body.clubs[0].isOwner, true);
    assert.equal((await call("GET", "/v1/clubs", { token: idle.token })).body.clubs[0].isOwner, false);
    // A stranger is in no clubs, and learns of none.
    const stranger = await reader();
    assert.deepEqual((await call("GET", "/v1/clubs", { token: stranger.token })).body, { clubs: [] });

    for (const code of ["AAAAAAAA", "short", "", undefined, 12345678]) {
      assert.equal((await join(stranger, code)).status, 404, String(code));
    }
    for (const body of [{}, { name: "" }, { name: 7 }, { name: "x", goalMinutes: -1 }, { name: "x", goalMinutes: 10081 }, { name: "x", goalMinutes: 1.5 }]) {
      assert.equal((await call("POST", "/v1/clubs", { token: owner.token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await makeClub(stranger, { name: "No Goal" })).goalMinutes, 0);
    for (const [method, path, body] of [["POST", "/v1/clubs", { name: "x" }], ["GET", "/v1/clubs"], ["POST", "/v1/clubs/join", { code: club.code }], ["POST", `/v1/clubs/${club.id}/leave`], ["PUT", `/v1/clubs/${club.id}`, { name: "x" }], ["POST", `/v1/clubs/${club.id}/books`, { title: "x" }]]) {
      assert.equal((await call(method, path, { body })).status, 401, `${method} ${path}`);
    }
  });

  test("the owner changes it; any member adds a book", async () => {
    const owner = await reader();
    const member = await reader();
    const stranger = await reader();
    const club = await makeClub(owner);
    await join(member, club.code);

    const changed = await call("PUT", `/v1/clubs/${club.id}`, {
      token: owner.token,
      body: { name: "Slow Readers", goalMinutes: 120, books: [{ title: "Middlemarch", author: "George Eliot" }, { title: "Bleak House" }, { title: "MIDDLEMARCH" }] }
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.club.name, "Slow Readers");
    assert.equal(changed.body.club.goalMinutes, 120);
    assert.deepEqual(changed.body.club.books, [{ title: "Middlemarch", author: "George Eliot" }, { title: "Bleak House", author: null }]);
    assert.equal(changed.body.club.members.length, 2);
    // Only what is sent changes.
    const renamed = await call("PUT", `/v1/clubs/${club.id}`, { token: owner.token, body: { name: "Slower Readers" } });
    assert.equal(renamed.body.club.goalMinutes, 120);
    assert.equal(renamed.body.club.books.length, 2);

    assert.equal((await call("PUT", `/v1/clubs/${club.id}`, { token: member.token, body: { name: "Mine Now" } })).status, 403);
    assert.equal((await call("PUT", `/v1/clubs/${club.id}`, { token: stranger.token, body: { name: "Mine Now" } })).status, 404);
    assert.equal((await call("PUT", "/v1/clubs/not-an-id", { token: owner.token, body: { name: "x" } })).status, 404);
    for (const body of [{ name: "" }, { goalMinutes: "lots" }, { books: "Dune" }, { books: [{ author: "Nobody" }] }, { books: Array.from({ length: 51 }, (_, index) => ({ title: `Book ${index}` })) }]) {
      assert.equal((await call("PUT", `/v1/clubs/${club.id}`, { token: owner.token, body })).status, 400, JSON.stringify(body));
    }

    const added = await call("POST", `/v1/clubs/${club.id}/books`, { token: member.token, body: { title: " The Waves ", author: "Virginia Woolf" } });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.deepEqual(added.body.club.books.at(-1), { title: "The Waves", author: "Virginia Woolf" });
    assert.equal(added.body.club.books.length, 3);
    assert.equal(added.body.club.name, "Slower Readers");
    // The same title in another case is the same book.
    assert.equal((await call("POST", `/v1/clubs/${club.id}/books`, { token: owner.token, body: { title: "the waves" } })).status, 409);
    assert.equal((await call("POST", `/v1/clubs/${club.id}/books`, { token: stranger.token, body: { title: "Dune" } })).status, 404);
    assert.equal((await call("POST", `/v1/clubs/${club.id}/books`, { token: member.token, body: { author: "Nobody" } })).status, 400);
    // Fifty is the most.
    await db.collection("clubs").updateOne(
      { _id: new ObjectId(club.id) },
      { $set: { books: Array.from({ length: 50 }, (_, index) => ({ title: `Book ${index}`, author: null })) } }
    );
    assert.equal((await call("POST", `/v1/clubs/${club.id}/books`, { token: member.token, body: { title: "One More" } })).status, 409);
    assert.equal((await call("GET", "/v1/clubs", { token: member.token })).body.clubs[0].books.length, 50);
  });

  test("leaving: the owner hands it to the longest-standing member, the last one out closes it", async () => {
    const owner = await reader();
    const second = await reader();
    const third = await reader();
    const club = await makeClub(owner);
    await join(second, club.code);
    await join(third, club.code);
    const stored = () => db.collection("clubs").findOne({ _id: new ObjectId(club.id) });

    const stranger = await reader();
    assert.equal((await call("POST", `/v1/clubs/${club.id}/leave`, { token: stranger.token })).status, 404);
    assert.equal((await call("POST", "/v1/clubs/not-an-id/leave", { token: owner.token })).status, 404);

    // A member who is not the owner leaves: nothing else changes.
    const rejoin = await reader();
    await join(rejoin, club.code);
    assert.deepEqual((await call("POST", `/v1/clubs/${club.id}/leave`, { token: rejoin.token })).body, { left: true });
    assert.ok((await stored()).ownerId.equals(owner.id));
    assert.equal((await stored()).memberIds.length, 3);

    assert.deepEqual((await call("POST", `/v1/clubs/${club.id}/leave`, { token: owner.token })).body, { left: true });
    const handed = await stored();
    assert.ok(handed.ownerId.equals(second.id), "the member who joined first");
    assert.deepEqual(handed.memberIds.map(String), [second.id, third.id].map(String));
    assert.equal((await call("GET", "/v1/clubs", { token: second.token })).body.clubs[0].isOwner, true);
    assert.equal((await call("GET", "/v1/clubs", { token: third.token })).body.clubs[0].isOwner, false);
    assert.equal((await call("GET", "/v1/clubs", { token: owner.token })).body.clubs.length, 0);
    assert.equal((await call("POST", `/v1/clubs/${club.id}/leave`, { token: owner.token })).status, 404);
    // The new owner can change it; the old one no longer can.
    assert.equal((await call("PUT", `/v1/clubs/${club.id}`, { token: second.token, body: { name: "Ours" } })).status, 200);
    assert.equal((await call("PUT", `/v1/clubs/${club.id}`, { token: owner.token, body: { name: "Mine" } })).status, 404);

    await call("POST", `/v1/clubs/${club.id}/leave`, { token: second.token });
    assert.ok((await stored()).ownerId.equals(third.id));
    await call("POST", `/v1/clubs/${club.id}/leave`, { token: third.token });
    assert.equal(await stored(), null, "nobody left in it");
    assert.equal((await join(owner, club.code)).status, 404);
  });

  test("ten clubs for a reader, fifty readers for a club", async () => {
    const keen = await reader();
    for (let index = 0; index < 10; index += 1) {
      await makeClub(keen, { name: `Club ${index}` });
    }
    assert.equal((await call("POST", "/v1/clubs", { token: keen.token, body: { name: "An Eleventh" } })).status, 409);
    const other = await reader();
    const theirs = await makeClub(other);
    assert.equal((await join(keen, theirs.code)).status, 409);
    assert.equal(await count("clubs", { memberIds: keen.id }), 10);
    assert.equal((await call("GET", "/v1/clubs", { token: keen.token })).body.clubs.length, 10);

    // A club with fifty in it has no place left.
    const full = await makeClub(other, { name: "Full House" });
    const crowd = Array.from({ length: 49 }, () => new ObjectId());
    await db.collection("clubs").updateOne({ _id: new ObjectId(full.id) }, { $push: { memberIds: { $each: crowd } } });
    const late = await reader();
    const refused = await join(late, full.code);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /full/);
    assert.equal((await db.collection("clubs").findOne({ _id: new ObjectId(full.id) })).memberIds.length, 50);
    // One leaves, and there is room for one: two at once cannot both take it.
    await db.collection("clubs").updateOne({ _id: new ObjectId(full.id) }, { $pull: { memberIds: crowd[0] } });
    const racer = await reader();
    const answers = await Promise.all([join(late, full.code), join(racer, full.code)]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
    assert.equal((await db.collection("clubs").findOne({ _id: new ObjectId(full.id) })).memberIds.length, 50);
  });

  test("a member who goes private is left out of the list, stays a member, and is shown no clubs", async () => {
    const owner = await reader({ minutes: 5 });
    const shy = await reader({ minutes: 50, prefix: "shyclub" });
    const club = await makeClub(owner);
    await join(shy, club.code);
    const members = async (who) => (await call("GET", `/v1/clubs?week=${WEEK}`, { token: who.token })).body.clubs[0]?.members.map((member) => member.handle);
    assert.deepEqual(await members(owner), [shy.handle, owner.handle]);

    await setVisibility(shy, "private");
    assert.deepEqual(await members(owner), [owner.handle]);
    assert.equal(JSON.stringify((await call("GET", "/v1/clubs", { token: owner.token })).body).includes(shy.handle), false);
    assert.equal((await db.collection("clubs").findOne({ _id: new ObjectId(club.id) })).memberIds.length, 2);
    assert.deepEqual((await call("GET", "/v1/clubs", { token: shy.token })).body, { clubs: [] });
    // Nor can they make, join or add to one while private.
    assert.equal((await call("POST", "/v1/clubs", { token: shy.token, body: { name: "Hidden" } })).status, 403);
    assert.equal((await join(shy, club.code)).status, 403);
    assert.equal((await call("POST", `/v1/clubs/${club.id}/books`, { token: shy.token, body: { title: "Dune" } })).status, 403);

    // Shared again (their app publishes the week with it), they are back.
    await setVisibility(shy, "public", { weekKey: WEEK, weekMinutes: 50 });
    assert.deepEqual(await members(owner), [shy.handle, owner.handle]);
    assert.deepEqual(await members(shy), [shy.handle, owner.handle]);
  });
});

describe("gifts", () => {
  const gift = (from, to, body = {}) =>
    call("POST", "/v1/gifts", { token: from.token, body: { to: to.handle, kind: "accessory", itemId: "top_hat", ...body } });

  test("go between readers who follow each other, wait to be claimed, and are claimed once", async () => {
    const giver = await reader({ prefix: "give" });
    const friend = await reader();
    const stranger = await reader();

    // No follow, then a follow one way only, either way round: not friends yet.
    assert.equal((await gift(giver, friend)).status, 403);
    await follow(giver, friend);
    assert.equal((await gift(giver, friend)).status, 403);
    assert.equal((await gift(friend, giver)).status, 403);
    assert.equal(await count("gifts", { fromId: { $in: [giver.id, friend.id] } }), 0);
    await follow(friend, giver);

    const sent = await gift(giver, friend, { to: `@${friend.handle}`, kind: "wallpaper", itemId: "night-sky_2" });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(Object.keys(sent.body), ["gift"]);
    assert.match(sent.body.gift.id, /^[0-9a-f]{24}$/);
    const second = await gift(giver, friend);
    assert.equal(second.status, 201);

    const waiting = await call("GET", "/v1/gifts", { token: friend.token });
    assert.equal(waiting.status, 200);
    // Oldest first.
    assert.deepEqual(waiting.body.gifts.map((row) => row.id), [sent.body.gift.id, second.body.gift.id]);
    const [first] = waiting.body.gifts;
    assert.deepEqual(Object.keys(first).sort(), ["createdAt", "from", "id", "itemId", "kind"]);
    assert.deepEqual(Object.keys(first.from).sort(), PERSON);
    assert.deepEqual([first.from.handle, first.kind, first.itemId], [giver.handle, "wallpaper", "night-sky_2"]);
    // Nothing waits for the giver, and the receiver is told.
    assert.deepEqual((await call("GET", "/v1/gifts", { token: giver.token })).body, { gifts: [] });
    const inbox = await call("GET", "/v1/inbox", { token: friend.token });
    const told = inbox.body.events.filter((event) => event.type === "gift");
    assert.equal(told.length, 2);
    assert.equal(told[0].actor.handle, giver.handle);

    // Only the receiver claims it; twice is the same as once.
    assert.equal((await call("POST", `/v1/gifts/${first.id}/claim`, { token: giver.token })).status, 404);
    assert.equal((await call("POST", `/v1/gifts/${first.id}/claim`, { token: stranger.token })).status, 404);
    assert.equal((await call("POST", `/v1/gifts/${first.id}/claim`)).status, 401);
    assert.equal((await call("POST", "/v1/gifts/not-an-id/claim", { token: friend.token })).status, 404);
    const claimed = await call("POST", `/v1/gifts/${first.id}/claim`, { token: friend.token });
    assert.equal(claimed.status, 200);
    assert.deepEqual(claimed.body, { claimed: true });
    const stored = await db.collection("gifts").findOne({ _id: new ObjectId(first.id) });
    assert.ok(stored.claimedAt instanceof Date);
    assert.deepEqual((await call("POST", `/v1/gifts/${first.id}/claim`, { token: friend.token })).body, { claimed: true });
    assert.equal((await db.collection("gifts").findOne({ _id: stored._id })).claimedAt.getTime(), stored.claimedAt.getTime());
    assert.deepEqual((await call("GET", "/v1/gifts", { token: friend.token })).body.gifts.map((row) => row.id), [second.body.gift.id]);

    for (const body of [{ kind: "seeds" }, { kind: undefined }, { itemId: "Top Hat" }, { itemId: "" }, { itemId: 7 }, { itemId: "x".repeat(33) }, { itemId: "9lives" }]) {
      assert.equal((await gift(giver, friend, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await gift(giver, giver)).status, 400);
    assert.equal((await gift(giver, { handle: "nobody-here" })).status, 404);
    assert.equal((await call("POST", "/v1/gifts", { body: { to: friend.handle, kind: "skin", itemId: "fox" } })).status, 401);
    assert.equal((await call("GET", "/v1/gifts")).status, 401);
    // A reader who has stopped sharing neither gives nor is given to, and a gift of theirs is not offered.
    await setVisibility(giver, "private");
    assert.equal((await gift(giver, friend)).status, 403);
    assert.equal((await gift(friend, giver)).status, 404);
    assert.deepEqual((await call("GET", "/v1/gifts", { token: friend.token })).body, { gifts: [] });
  });

  test("a followers-only reader gives and is given to, once each follows the other", async () => {
    const quiet = await reader({ visibility: "followers" });
    const friend = await reader();
    await follow(quiet, friend);
    await call("POST", `/v1/follows/${quiet.handle}`, { token: friend.token });
    // Asked, not accepted: not a follow.
    assert.equal((await gift(friend, quiet)).status, 403);
    await call("POST", `/v1/follow-requests/${friend.handle}/accept`, { token: quiet.token });
    assert.equal((await gift(friend, quiet, { kind: "move", itemId: "moonwalk" })).status, 201);
    assert.equal((await gift(quiet, friend, { kind: "skin", itemId: "fox" })).status, 201);
    assert.equal((await call("GET", "/v1/gifts", { token: quiet.token })).body.gifts[0].from.handle, friend.handle);
  });

  test("of several waiting, the ones from a reader blocked, blocking or no longer sharing are left out, and the rest handed over", async () => {
    const receiver = await reader();
    const early = await reader();
    const unwelcome = await reader();
    const unwilling = await reader();
    const gone = await reader();
    const late = await reader();
    const givers = [early, unwelcome, unwilling, gone, late];
    for (const giver of givers) {
      await befriend(giver, receiver);
      assert.equal((await gift(giver, receiver)).status, 201);
    }
    const from = async () => (await call("GET", "/v1/gifts", { token: receiver.token })).body.gifts.map((row) => row.from);
    assert.deepEqual((await from()).map((person) => person.handle), givers.map((giver) => giver.handle));

    // A block either way round, and a giver who stops sharing.
    assert.equal((await call("POST", `/v1/blocks/${unwelcome.handle}`, { token: receiver.token })).status, 200);
    assert.equal((await call("POST", `/v1/blocks/${receiver.handle}`, { token: unwilling.token })).status, 200);
    await setVisibility(gone, "private");
    // The rest come as they did: the whole of what is shown of a person.
    assert.deepEqual(await from(), [early, late].map((giver) => ({
      handle: giver.handle,
      displayName: giver.handle.toUpperCase(),
      pipSeed: giver.handle,
      avatar: null
    })));
    // Nothing is claimed by being left out.
    assert.equal(await count("gifts", { toId: receiver.id, claimedAt: null }), 5);
  });

  test("five a day from one reader, and twenty waiting for another", async () => {
    const giver = await reader();
    const friend = await reader();
    await befriend(giver, friend);
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await gift(giver, friend, { itemId: `hat_${index}` })).status, 201);
    }
    const sixth = await gift(giver, friend);
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.retryAfter) > 0);
    assert.equal(await count("gifts", { fromId: giver.id }), 5);
    assert.equal(await count("events", { userId: friend.id, type: "gift" }), 5);
    // The friend's own allowance is their own.
    assert.equal((await gift(friend, giver)).status, 201);
    // Yesterday's gifts do not count against today.
    await db.collection("gifts").updateMany({ fromId: giver.id }, { $set: { createdAt: new Date(Date.now() - 25 * 60 * MINUTE) } });
    assert.equal((await gift(giver, friend)).status, 201);

    // Twenty unopened is a full doorstep, whoever they are from.
    const popular = await reader();
    const fan = await reader();
    await befriend(fan, popular);
    await db.collection("gifts").insertMany(
      Array.from({ length: 20 }, () => ({ fromId: new ObjectId(), toId: popular.id, kind: "room", itemId: "attic", createdAt: new Date(Date.now() - 3 * 24 * 60 * MINUTE), claimedAt: null }))
    );
    const refused = await gift(fan, popular);
    assert.equal(refused.status, 409);
    assert.equal(await count("gifts", { toId: popular.id }), 20);
    // One opened makes room for one.
    await db.collection("gifts").updateOne({ toId: popular.id, claimedAt: null }, { $set: { claimedAt: new Date() } });
    assert.equal((await gift(fan, popular)).status, 201);
    assert.equal((await gift(fan, popular)).status, 409);
  });
});

describe("a stake on a duel", () => {
  test("is kept on the duel and shown to both sides; none is 0", async () => {
    const a = await reader();
    const b = await reader();
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK, stake: 25 } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.stake, 25);
    assert.equal((await db.collection("duels").findOne({ _id: new ObjectId(made.body.id) })).stake, 25);

    const invite = (await call("GET", "/v1/inbox", { token: b.token })).body.events.find((event) => event.type === "duel_invite");
    assert.equal(invite.duel.stake, 25);
    assert.equal((await call("GET", "/v1/duels", { token: b.token })).body.duels[0].stake, 25);
    const accepted = await call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token });
    assert.equal(accepted.body.stake, 25);
    assert.equal((await call("GET", "/v1/duels", { token: a.token })).body.duels[0].stake, 25);

    const c = await reader();
    const plain = await call("POST", "/v1/duels", { token: a.token, body: { handle: c.handle, weekKey: WEEK } });
    assert.equal(plain.status, 201);
    assert.equal(plain.body.stake, 0);
    assert.equal((await db.collection("duels").findOne({ _id: new ObjectId(plain.body.id) })).stake, 0);
    // A duel from before stakes existed has none.
    await db.collection("duels").updateOne({ _id: new ObjectId(plain.body.id) }, { $unset: { stake: "" } });
    assert.equal((await call("GET", "/v1/duels", { token: c.token })).body.duels[0].stake, 0);

    const d = await reader();
    for (const stake of [51, -1, 2.5, "5", null]) {
      const refused = await call("POST", "/v1/duels", { token: a.token, body: { handle: d.handle, weekKey: WEEK, stake } });
      assert.equal(refused.status, 400, JSON.stringify(stake));
    }
    assert.equal(await count("duels", { opponentId: d.id }), 0);
    const most = await call("POST", "/v1/duels", { token: a.token, body: { handle: d.handle, weekKey: WEEK, stake: 50 } });
    assert.equal(most.body.stake, 50);
  });
});

describe("leaving", () => {
  /** A reader tangled every new way: a library, posts, requests and gifts both ways, and two clubs. */
  async function tangled() {
    const me = await reader({ visibility: "followers", extra: { shareLibrary: true } });
    const friend = await reader();
    const quiet = await reader({ visibility: "followers" });
    const asker = await reader();
    await befriend(me, friend);
    // A request each way, both still waiting.
    await call("POST", `/v1/follows/${quiet.handle}`, { token: me.token });
    await call("POST", `/v1/follows/${me.handle}`, { token: asker.token });
    await call("PUT", "/v1/library/me", { token: me.token, body: { books: [book("isbn:9")] } });
    await call("POST", "/v1/posts", { token: me.token, body: { title: "Last Book" } });
    await call("POST", "/v1/gifts", { token: me.token, body: { to: friend.handle, kind: "skin", itemId: "fox" } });
    await call("POST", "/v1/gifts", { token: friend.token, body: { to: me.handle, kind: "skin", itemId: "owl" } });
    const shared = (await call("POST", "/v1/clubs", { token: me.token, body: { name: "Shared" } })).body.club;
    await call("POST", "/v1/clubs/join", { token: friend.token, body: { code: shared.code } });
    const solo = (await call("POST", "/v1/clubs", { token: me.token, body: { name: "Solo" } })).body.club;
    const theirs = (await call("POST", "/v1/clubs", { token: friend.token, body: { name: "Theirs" } })).body.club;
    await call("POST", "/v1/clubs/join", { token: me.token, body: { code: theirs.code } });
    return { me, friend, shared, solo, theirs };
  }

  async function traces(id) {
    return {
      library: await count("libraries", { _id: id }),
      posts: await count("posts", { userId: id }),
      requests: await count("followRequests", { $or: [{ fromId: id }, { toId: id }] }),
      follows: await count("follows", { $or: [{ followerId: id }, { followeeId: id }] }),
      gifts: await count("gifts", { $or: [{ fromId: id }, { toId: id }] }),
      clubs: await count("clubs", { $or: [{ memberIds: id }, { ownerId: id }] }),
      events: await count("events", { $or: [{ userId: id }, { actorId: id }] })
    };
  }
  const NOTHING = { library: 0, posts: 0, requests: 0, follows: 0, gifts: 0, clubs: 0, events: 0 };

  async function checkGone({ me, friend, shared, solo, theirs }) {
    assert.deepEqual(await traces(me.id), NOTHING);
    // The club they owned went to its other member; the one they were alone in is gone.
    const handed = await db.collection("clubs").findOne({ _id: new ObjectId(shared.id) });
    assert.ok(handed.ownerId.equals(friend.id));
    assert.deepEqual(handed.memberIds.map(String), [String(friend.id)]);
    assert.equal(await count("clubs", { _id: new ObjectId(solo.id) }), 0);
    assert.deepEqual((await db.collection("clubs").findOne({ _id: new ObjectId(theirs.id) })).memberIds.map(String), [String(friend.id)]);
    // And nothing of theirs is left in what their friend is shown.
    const seen = JSON.stringify([
      (await call("GET", "/v1/feed", { token: friend.token })).body,
      (await call("GET", "/v1/gifts", { token: friend.token })).body,
      (await call("GET", "/v1/clubs", { token: friend.token })).body,
      (await call("GET", "/v1/inbox", { token: friend.token })).body,
      (await call("GET", "/v1/follows", { token: friend.token })).body
    ]);
    assert.equal(seen.includes(me.handle), false);
    assert.equal((await call("GET", "/v1/clubs", { token: friend.token })).body.clubs.length, 2);
  }

  test("deleting the account removes the library, posts, requests, gifts and club places", async () => {
    const all = await tangled();
    const before = await traces(all.me.id);
    assert.deepEqual(
      [before.library, before.posts, before.requests, before.gifts, before.clubs],
      [1, 1, 2, 2, 3],
      JSON.stringify(before)
    );
    const gone = await call("DELETE", "/v1/account", { token: all.me.token, body: { password: PASSWORD } });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    await checkGone(all);
    assert.equal(await count("profiles", { _id: all.me.id }), 0);
  });

  test("deleting the profile does the same", async () => {
    const all = await tangled();
    assert.equal((await call("DELETE", "/v1/profile/me", { token: all.me.token })).status, 200);
    await checkGone(all);
  });

  test("going private removes the library and the requests to it, and keeps the rest hidden", async () => {
    const all = await tangled();
    const { me, friend } = all;
    assert.equal((await setVisibility(me, "private")).body.visibility, "private");
    const left = await traces(me.id);
    assert.equal(left.library, 0);
    assert.equal(await count("followRequests", { toId: me.id }), 0);
    // Kept, and hidden: the post, the request they made, the gifts, the clubs.
    assert.deepEqual([left.posts, left.requests, left.gifts, left.clubs], [1, 1, 2, 3]);
    const seen = JSON.stringify([
      (await call("GET", "/v1/feed", { token: friend.token })).body,
      (await call("GET", "/v1/gifts", { token: friend.token })).body,
      (await call("GET", "/v1/clubs", { token: friend.token })).body,
      (await call("GET", "/v1/inbox", { token: friend.token })).body,
      (await call("GET", "/v1/follows", { token: friend.token })).body,
      (await call("GET", `/v1/search?q=${me.handle}`, { token: friend.token })).body
    ]);
    assert.equal(seen.includes(me.handle), false);
    assert.equal((await call("GET", `/v1/profile/${me.handle}/posts`, { token: friend.token })).status, 404);
    assert.equal((await call("GET", `/v1/profile/${me.handle}/library`, { token: friend.token })).status, 404);
  });
});

describe("who may call what", () => {
  test("every new signed-in route refuses a missing or made-up token", async () => {
    const a = await reader();
    const id = "a".repeat(24);
    const routes = [
      ["GET", "/v1/follow-requests"],
      ["POST", `/v1/follow-requests/${a.handle}/accept`],
      ["POST", `/v1/follow-requests/${a.handle}/decline`],
      ["PUT", "/v1/library/me", { books: [] }],
      ["DELETE", "/v1/library/me"],
      ["GET", `/v1/profile/${a.handle}/library`],
      ["POST", "/v1/library/among", { keys: [] }],
      ["POST", "/v1/posts", { title: "x" }],
      ["GET", "/v1/feed"],
      ["DELETE", `/v1/posts/${id}`],
      ["POST", "/v1/clubs", { name: "x" }],
      ["GET", "/v1/clubs"],
      ["POST", "/v1/clubs/join", { code: "ABCDEFGH" }],
      ["POST", `/v1/clubs/${id}/leave`],
      ["PUT", `/v1/clubs/${id}`, { name: "x" }],
      ["POST", `/v1/clubs/${id}/books`, { title: "x" }],
      ["POST", "/v1/gifts", { to: a.handle, kind: "skin", itemId: "fox" }],
      ["GET", "/v1/gifts"],
      ["POST", `/v1/gifts/${id}/claim`]
    ];
    for (const [method, path, body] of routes) {
      for (const token of [undefined, "x".repeat(43)]) {
        const answer = await call(method, path, { token, body });
        assert.equal(answer.status, 401, `${method} ${path} with ${token ? "a bad token" : "no token"}`);
      }
    }
    // A body too large for its route is refused before it is read into the app.
    const huge = await call("POST", "/v1/posts", { token: a.token, body: { title: "x", line: "y".repeat(20_000) } });
    assert.equal(huge.status, 413);
  });
});
