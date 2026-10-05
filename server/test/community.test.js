import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect, ensureIndexes } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";
import { forgetBoards } from "../src/boardCache.js";
import { PIP_PARTS } from "../src/avatars.js";

/**
 * Follows, kudos, duels, the inbox and search, against a throwaway database
 * (TEST_MONGO_URI, default mongodb://127.0.0.1:27017) dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const WEEK = isoWeekKey();
const TODAY = new Date().toISOString().slice(0, 10);
const PASSWORD = "correct horse battery";

let db;
let server;
let base;

before(async () => {
  db = await connect(uri, dbName);
  const app = createApp(db, {
    limits: {
      ip: { limit: 1000, windowMs: 15 * MINUTE },
      email: { limit: 100, windowMs: 15 * MINUTE },
      signup: { limit: 1000, windowMs: 60 * MINUTE },
      social: { limit: 1000, windowMs: 15 * MINUTE },
      search: { limit: 1000, windowMs: 5 * MINUTE }
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A signed-up reader with a profile; public unless told otherwise. */
async function reader({ visibility = "public", minutes = 30, streak = 2, prefix = "r" } = {}) {
  const email = `c-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: minutes, streak }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: new ObjectId(signup.body.account.id) };
}

const kudosBody = { dayKey: TODAY, weekKey: WEEK };

describe("board", () => {
  test("everyone is public, marks you, and carries a pip seed", async () => {
    const a = await reader({ minutes: 4321.5 });
    const open = await call("GET", `/v1/leaderboard?week=${WEEK}`);
    assert.equal(open.status, 200);
    const row = open.body.entries.find((entry) => entry.handle === a.handle);
    assert.equal(row.pipSeed, a.handle);
    assert.equal(row.avatar, null);
    assert.equal(row.isYou, false);

    const mine = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: a.token });
    assert.equal(mine.body.entries.find((entry) => entry.handle === a.handle).isYou, true);
    assert.equal(mine.body.you.handle, a.handle);

    // A stale token is just "signed out" on a public route.
    assert.equal((await call("GET", "/v1/leaderboard", { token: "x".repeat(43) })).status, 200);
  });

  test("rows, cards and search carry the avatar a reader picked", async () => {
    const a = await reader({ minutes: 25, prefix: "av" });
    // Picked after the profile exists: the profile's copy follows the account.
    const picked = await call("PATCH", "/v1/account", { token: a.token, body: { avatar: "ghost.ghost" } });
    assert.equal(picked.status, 200, JSON.stringify(picked.body));

    const board = await call("GET", `/v1/leaderboard?week=${WEEK}`);
    assert.equal(board.body.entries.find((entry) => entry.handle === a.handle).avatar, "ghost.ghost");
    assert.equal((await call("GET", `/v1/profile/${a.handle}`)).body.avatar, "ghost.ghost");
    const found = await call("GET", `/v1/search?q=${a.handle}`);
    assert.equal(found.body.results[0].avatar, "ghost.ghost");

    // Picked at signup, before any profile: the first profile save copies it.
    const email = `c-${randomBytes(5).toString("hex")}@example.com`;
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD, avatar: "classic.robot" } });
    const handle = `av${randomBytes(4).toString("hex")}`;
    await call("PUT", "/v1/profile/me", {
      token: made.body.token,
      body: { handle, visibility: "public", weekKey: WEEK, weekMinutes: 12, streak: 1 }
    });
    const again = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: made.body.token });
    assert.equal(again.body.entries.find((entry) => entry.handle === handle).avatar, "classic.robot");
    assert.equal(again.body.you.avatar, "classic.robot");

    // The reader's own Pip from the Pip tab (a shop variant and move, and an
    // outfit when the wardrobe has one) travels the same way.
    const accessory = Object.keys(PIP_PARTS.accessories)[0];
    const own = accessory ? `${PIP_PARTS.skins.at(-1)}.moonwalk.${accessory}` : `${PIP_PARTS.skins.at(-1)}.moonwalk`;
    const dressed = await call("PATCH", "/v1/account", { token: made.body.token, body: { avatar: own } });
    assert.equal(dressed.status, 200, JSON.stringify(dressed.body));
    const ownBoard = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: made.body.token });
    assert.equal(ownBoard.body.entries.find((entry) => entry.handle === handle).avatar, own);
    assert.equal((await call("GET", `/v1/profile/${handle}`)).body.avatar, own);
    // A part that is not on offer is refused, and the avatar stays as it was.
    const refused = await call("PATCH", "/v1/account", { token: made.body.token, body: { avatar: `${own}+nope` } });
    assert.equal(refused.status, 400);
    assert.equal((await call("GET", `/v1/profile/${handle}`)).body.avatar, own);

    // A value that slipped past validation some other way is never passed on.
    await db.collection("profiles").updateOne({ handle }, { $set: { avatar: "champ.champ" } });
    // Written behind the API's back, so the board cache cannot know.
    forgetBoards();
    const scrubbed = await call("GET", `/v1/leaderboard?week=${WEEK}`);
    assert.equal(scrubbed.body.entries.find((entry) => entry.handle === handle).avatar, null);
  });

  test("a private reader is on nobody's board, their own included, until they share", async () => {
    const shy = await reader({ visibility: "private", minutes: 240, prefix: "shy" });
    const other = await reader({ minutes: 15 });
    const onBoard = (board) => board.body.entries.some((entry) => entry.handle === shy.handle);

    const before = await call("GET", `/v1/leaderboard?week=${WEEK}`);
    assert.equal(onBoard(before), false);
    assert.equal(onBoard(await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: other.token })), false);
    // Not even to themselves: the app draws a private reader's own row from
    // the minutes on their device, so the server never has to hand it out.
    const own = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: shy.token });
    assert.equal(onBoard(own), false);
    assert.equal(own.body.you, null);
    assert.equal((await call("GET", `/v1/profile/${shy.handle}`)).status, 404);
    assert.equal((await call("GET", `/v1/search?q=${shy.handle}`)).body.results.length, 0);

    // Sharing is the one switch; the app sends this week's minutes with it.
    const shared = await call("PUT", "/v1/profile/me", {
      token: shy.token,
      body: { visibility: "public", weekKey: WEEK, weekMinutes: 240 }
    });
    assert.equal(shared.body.visibility, "public");
    const after = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: shy.token });
    assert.equal(after.body.you.handle, shy.handle);
    assert.equal(after.body.you.weekMinutes, 240);
    assert.equal(after.body.sharedReaders, before.body.sharedReaders + 1);

    await call("PUT", "/v1/profile/me", { token: shy.token, body: { visibility: "private" } });
    const hidden = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: shy.token });
    assert.equal(onBoard(hidden), false);
    assert.equal(hidden.body.sharedReaders, before.body.sharedReaders);
  });

  test("a new account is private, with no profile, until its owner says otherwise", async () => {
    const email = `c-${randomBytes(5).toString("hex")}@example.com`;
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD, displayName: "New Friend" } });
    assert.equal(made.status, 201);
    const mine = await call("GET", "/v1/profile/me", { token: made.body.token });
    assert.equal(mine.body.visibility, "private");
    assert.equal(mine.body.handle, null);
    assert.equal(await db.collection("profiles").countDocuments({ _id: new ObjectId(made.body.account.id) }), 0);

    // Saving a name and handle, or this week's minutes, does not share anything.
    const handle = `nf${randomBytes(4).toString("hex")}`;
    const saved = await call("PUT", "/v1/profile/me", {
      token: made.body.token,
      body: { handle, displayName: "New Friend", weekKey: WEEK, weekMinutes: 90, streak: 1 }
    });
    assert.equal(saved.body.visibility, "private");
    const board = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: made.body.token });
    assert.equal(board.body.entries.some((entry) => entry.handle === handle), false);
    assert.equal(board.body.you, null);
  });

  test("an empty board says whether anyone shares a profile at all", async () => {
    const a = await reader({ minutes: 40, prefix: "wk" });
    const total = await db.collection("profiles").countDocuments({ visibility: "public", handle: { $type: "string" } });
    assert.ok(total >= 1);

    const thisWeek = await call("GET", `/v1/leaderboard?week=${WEEK}`);
    assert.equal(thisWeek.body.sharedReaders, total);
    assert.ok(thisWeek.body.entries.some((entry) => entry.handle === a.handle));

    // Minutes from a week that is over, as every profile's are on a Monday
    // morning: off this week's board, but still counted as sharing.
    const past = isoWeekKey(new Date(Date.now() - 14 * 24 * 3600 * 1000));
    await db.collection("profiles").updateOne({ handle: a.handle }, { $set: { weekKey: past } });
    forgetBoards();
    const monday = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: a.token });
    assert.equal(monday.body.weekKey, WEEK);
    assert.equal(monday.body.entries.some((entry) => entry.handle === a.handle), false);
    assert.equal(monday.body.you, null);
    assert.equal(monday.body.sharedReaders, total);

    // A public profile with no handle is not shared with anyone, so not counted.
    await db.collection("profiles").updateOne({ handle: a.handle }, { $set: { handle: null } });
    forgetBoards();
    assert.equal((await call("GET", `/v1/leaderboard?week=${WEEK}`)).body.sharedReaders, total - 1);
  });

  test("following is you plus the public readers you follow", async () => {
    const me = await reader({ minutes: 10 });
    const friend = await reader({ minutes: 50 });
    const idle = await reader({ minutes: 0 });
    const hidden = await reader({ minutes: 70 });
    assert.equal((await call("GET", "/v1/leaderboard?scope=following")).status, 401);

    for (const other of [friend, idle, hidden]) {
      assert.equal((await call("POST", `/v1/follows/${other.handle}`, { token: me.token })).status, 200);
    }
    await call("PUT", "/v1/profile/me", { token: hidden.token, body: { visibility: "private" } });

    const board = await call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token: me.token });
    assert.equal(board.status, 200);
    assert.deepEqual(board.body.entries.map((entry) => entry.handle), [friend.handle, me.handle, idle.handle]);
    assert.deepEqual(board.body.entries.map((entry) => entry.rank), [1, 2, 3]);
    assert.equal(board.body.you.handle, me.handle);
  });
});

describe("profiles and follows", () => {
  test("a profile says how two readers stand", async () => {
    const a = await reader();
    const b = await reader();
    await call("POST", `/v1/follows/${b.handle}`, { token: a.token });
    await call("POST", `/v1/kudos/${b.handle}`, { token: a.token, body: kudosBody });

    const anon = await call("GET", `/v1/profile/${b.handle}?week=${WEEK}`);
    assert.equal(anon.status, 200);
    assert.equal(anon.body.followerCount, 1);
    assert.equal(anon.body.kudosThisWeek, 1);
    assert.equal("isFollowing" in anon.body, false);

    const seen = await call("GET", `/v1/profile/${b.handle}?week=${WEEK}&day=${TODAY}`, { token: a.token });
    assert.equal(seen.body.isFollowing, true);
    assert.equal(seen.body.kudosSentToday, true);
    assert.equal(seen.body.isYou, false);
    assert.equal(seen.body.activeDuel, null);

    const self = await call("GET", `/v1/profile/${a.handle}`, { token: a.token });
    assert.equal(self.body.isYou, true);
  });

  test("follow refusals: self, private target, private follower", async () => {
    const a = await reader();
    const hidden = await reader({ visibility: "private" });
    assert.equal((await call("POST", `/v1/follows/${a.handle}`, { token: a.token })).status, 400);
    assert.equal((await call("POST", `/v1/follows/${hidden.handle}`, { token: a.token })).status, 404);
    assert.equal((await call("POST", `/v1/follows/nobody-here`, { token: a.token })).status, 404);
    const refused = await call("POST", `/v1/follows/${a.handle}`, { token: hidden.token });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /public/);
    assert.equal((await call("POST", `/v1/follows/${a.handle}`)).status, 401);
  });

  test("follow, list, unfollow; a re-follow does not notify twice", async () => {
    const a = await reader();
    const b = await reader();
    assert.equal((await call("POST", `/v1/follows/${b.handle}`, { token: a.token })).status, 200);
    assert.equal((await call("POST", `/v1/follows/${b.handle}`, { token: a.token })).status, 200);
    const list = await call("GET", "/v1/follows", { token: a.token });
    assert.deepEqual(list.body.following.map((row) => row.handle), [b.handle]);
    assert.equal((await call("GET", "/v1/follows", { token: b.token })).body.followerCount, 1);

    assert.equal((await call("DELETE", `/v1/follows/${b.handle}`, { token: a.token })).status, 200);
    assert.equal((await call("GET", "/v1/follows", { token: a.token })).body.following.length, 0);
    await call("POST", `/v1/follows/${b.handle}`, { token: a.token });
    const inbox = await call("GET", "/v1/inbox", { token: b.token });
    assert.equal(inbox.body.events.filter((event) => event.type === "follow").length, 1);
  });
});

describe("kudos", () => {
  test("once per reader per day", async () => {
    const a = await reader();
    const b = await reader();
    const sent = await call("POST", `/v1/kudos/${b.handle}`, { token: a.token, body: kudosBody });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.kudosThisWeek, 1);
    const again = await call("POST", `/v1/kudos/${b.handle}`, { token: a.token, body: kudosBody });
    assert.equal(again.status, 409);

    const inbox = await call("GET", "/v1/inbox", { token: b.token });
    const event = inbox.body.events.find((item) => item.type === "kudos");
    assert.equal(event.actor.handle, a.handle);
  });

  test("refusals: self, private target, bad day", async () => {
    const a = await reader();
    const hidden = await reader({ visibility: "private" });
    assert.equal((await call("POST", `/v1/kudos/${a.handle}`, { token: a.token, body: kudosBody })).status, 400);
    assert.equal((await call("POST", `/v1/kudos/${hidden.handle}`, { token: a.token, body: kudosBody })).status, 404);
    const b = await reader();
    assert.equal(
      (await call("POST", `/v1/kudos/${b.handle}`, { token: a.token, body: { dayKey: "2001-01-01", weekKey: WEEK } })).status,
      400
    );
    assert.equal(
      (await call("POST", `/v1/kudos/${b.handle}`, { token: a.token, body: { dayKey: TODAY, weekKey: "2001-W01" } })).status,
      400
    );
  });
});

describe("duels", () => {
  test("challenge, accept, and minutes follow the profiles", async () => {
    const a = await reader({ minutes: 20 });
    const b = await reader({ minutes: 35 });
    await call("PATCH", "/v1/account", { token: a.token, body: { avatar: "wizard.magic" } });
    await call("PATCH", "/v1/account", { token: b.token, body: { avatar: "cactus.boxing" } });
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.status, "pending");
    assert.equal(made.body.them.handle, b.handle);
    assert.equal(made.body.them.avatar, "cactus.boxing");
    assert.equal(made.body.you.avatar, "wizard.magic");

    const inbox = await call("GET", "/v1/inbox", { token: b.token });
    const invite = inbox.body.events.find((event) => event.type === "duel_invite");
    assert.equal(invite.actor.avatar, "wizard.magic");
    assert.equal(invite.duel.id, made.body.id);
    assert.equal(invite.duel.status, "pending");

    // Only the opponent can answer.
    assert.equal((await call("POST", `/v1/duels/${made.body.id}/accept`, { token: a.token })).status, 404);
    const accepted = await call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, "accepted");
    assert.equal((await call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token })).status, 409);

    await call("PUT", "/v1/profile/me", { token: a.token, body: { weekKey: WEEK, weekMinutes: 90 } });
    const mine = await call("GET", "/v1/duels", { token: a.token });
    const duel = mine.body.duels.find((item) => item.id === made.body.id);
    assert.equal(duel.you.minutes, 90);
    assert.equal(duel.them.minutes, 35);

    const aInbox = await call("GET", "/v1/inbox", { token: a.token });
    assert.ok(aInbox.body.events.some((event) => event.type === "duel_accepted"));

    const card = await call("GET", `/v1/profile/${b.handle}?week=${WEEK}`, { token: a.token });
    assert.equal(card.body.activeDuel.status, "accepted");
    assert.equal(card.body.activeDuel.youChallenged, true);
  });

  test("decline, and one duel per pair per week", async () => {
    const a = await reader();
    const b = await reader();
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    assert.equal((await call("POST", "/v1/duels", { token: b.token, body: { handle: a.handle, weekKey: WEEK } })).status, 409);
    const declined = await call("POST", `/v1/duels/${made.body.id}/decline`, { token: b.token });
    assert.equal(declined.body.status, "declined");
    assert.equal((await call("GET", "/v1/duels", { token: a.token })).body.duels.length, 0);
    assert.equal((await call("POST", "/v1/duels/not-an-id/accept", { token: b.token })).status, 404);
  });

  test("refusals: self, private target, a fourth active duel", async () => {
    const a = await reader();
    const hidden = await reader({ visibility: "private" });
    assert.equal((await call("POST", "/v1/duels", { token: a.token, body: { handle: a.handle, weekKey: WEEK } })).status, 400);
    assert.equal((await call("POST", "/v1/duels", { token: a.token, body: { handle: hidden.handle, weekKey: WEEK } })).status, 404);
    assert.equal((await call("POST", "/v1/duels", { token: hidden.token, body: { handle: a.handle, weekKey: WEEK } })).status, 403);
    assert.equal((await call("POST", "/v1/duels", { token: a.token, body: { handle: "x", weekKey: "1999-W01" } })).status, 400);

    for (let i = 0; i < 3; i += 1) {
      const other = await reader();
      assert.equal((await call("POST", "/v1/duels", { token: a.token, body: { handle: other.handle, weekKey: WEEK } })).status, 201);
    }
    const fourth = await reader();
    const refused = await call("POST", "/v1/duels", { token: a.token, body: { handle: fourth.handle, weekKey: WEEK } });
    assert.equal(refused.status, 409);
    // And the other way round: nobody can pull them into a fourth.
    assert.equal((await call("POST", "/v1/duels", { token: fourth.token, body: { handle: a.handle, weekKey: WEEK } })).status, 409);
  });

  test("challenges sent at the same moment still stop at three a side", async () => {
    // One reader challenging six at once (each request used to count the
    // others as not there yet, and all six went in).
    const keen = await reader();
    const six = [];
    for (let i = 0; i < 6; i += 1) {
      six.push(await reader());
    }
    const sent = await Promise.all(
      six.map((other) => call("POST", "/v1/duels", { token: keen.token, body: { handle: other.handle, weekKey: WEEK } }))
    );
    const made = (answers) => answers.filter((answer) => answer.status === 201).length;
    assert.ok(sent.every((answer) => answer.status === 201 || answer.status === 409), JSON.stringify(sent));
    assert.ok(made(sent) <= 3, `${made(sent)} challenges went through`);
    // A refused challenge leaves nothing behind: no duel, and no invite.
    assert.equal(await db.collection("duels").countDocuments({ challengerId: keen.id }), made(sent));
    assert.equal(await db.collection("events").countDocuments({ actorId: keen.id, type: "duel_invite" }), made(sent));
    assert.equal((await call("GET", "/v1/duels", { token: keen.token })).body.duels.length, made(sent));

    // And six readers challenging one at once: never more than three invites.
    const popular = await reader();
    const got = await Promise.all(
      six.map((other) => call("POST", "/v1/duels", { token: other.token, body: { handle: popular.handle, weekKey: WEEK } }))
    );
    assert.ok(made(got) <= 3, `${made(got)} challenges went through`);
    assert.equal(await db.collection("duels").countDocuments({ opponentId: popular.id }), made(got));
    const invites = (await call("GET", "/v1/inbox", { token: popular.token })).body.events;
    assert.equal(invites.filter((event) => event.type === "duel_invite").length, made(got));

    // One at a time, as the app sends them, the limit is three as before.
    const steady = await reader();
    const inTurn = [];
    for (const other of six.slice(0, 4)) {
      inTurn.push(await call("POST", "/v1/duels", { token: steady.token, body: { handle: other.handle, weekKey: WEEK } }));
    }
    assert.ok(made(inTurn) <= 3);
    assert.equal(inTurn[3].status, 409);
  });

  test("a finished week is settled once, with a result in both inboxes", async () => {
    const a = await reader();
    const b = await reader();
    const past = isoWeekKey(new Date(Date.now() - 14 * 24 * 3600 * 1000));
    const { insertedId } = await db.collection("duels").insertOne({
      challengerId: a.id,
      opponentId: b.id,
      pair: [a.id.toHexString(), b.id.toHexString()].sort().join(":"),
      weekKey: past,
      status: "accepted",
      challengerMinutes: 120,
      opponentMinutes: 80,
      createdAt: new Date(),
      respondedAt: new Date()
    });
    const mine = await call("GET", "/v1/duels", { token: a.token });
    const duel = mine.body.duels.find((item) => item.id === insertedId.toHexString());
    assert.equal(duel.status, "finished");
    assert.equal(duel.result, "won");

    const theirs = await call("GET", "/v1/inbox", { token: b.token });
    const results = theirs.body.events.filter((event) => event.type === "duel_result");
    assert.equal(results.length, 1);
    assert.equal(results[0].duel.result, "lost");
    await call("GET", "/v1/duels", { token: b.token });
    assert.equal(await db.collection("events").countDocuments({ refId: insertedId, type: "duel_result" }), 2);
  });
});

describe("inbox and search", () => {
  test("since filters, and private actors drop out", async () => {
    const me = await reader();
    const fan = await reader();
    const shy = await reader();
    await call("POST", `/v1/kudos/${me.handle}`, { token: shy.token, body: kudosBody });
    await call("PUT", "/v1/profile/me", { token: shy.token, body: { visibility: "private" } });
    await call("POST", `/v1/follows/${me.handle}`, { token: fan.token });
    const all = await call("GET", "/v1/inbox", { token: me.token });
    assert.deepEqual(all.body.events.map((event) => event.actor.handle), [fan.handle]);
    const later = await call("GET", `/v1/inbox?since=${encodeURIComponent(all.body.events[0].createdAt)}`, { token: me.token });
    assert.equal(later.body.events.length, 0);
    assert.equal((await call("GET", "/v1/inbox")).status, 401);
  });

  test("prefix search over public handles, at most ten", async () => {
    const prefix = `s${randomBytes(2).toString("hex")}`;
    for (let i = 0; i < 11; i += 1) {
      await reader({ prefix });
    }
    const hidden = await reader({ prefix, visibility: "private" });
    const found = await call("GET", `/v1/search?q=${prefix}`);
    assert.equal(found.status, 200);
    assert.equal(found.body.results.length, 10);
    assert.ok(found.body.results.every((row) => row.handle.startsWith(prefix)));
    assert.ok(!found.body.results.some((row) => row.handle === hidden.handle));
    assert.deepEqual((await call("GET", "/v1/search?q=.*")).body.results, []);
    assert.equal((await call("GET", `/v1/search?q=@${hidden.handle}`)).body.results.length, 0);
  });
});

describe("privacy", () => {
  const FIGURES = { weekKey: WEEK, weekMinutes: 77, streak: 5, booksFinished: 3, shelf: [{ title: "Dune", author: "Herbert", styleSeed: "s" }] };
  const stored = (id) => db.collection("profiles").findOne({ _id: id });
  const hasFigures = (doc) =>
    Boolean(doc.weekKey) || (doc.weekMinutes ?? 0) > 0 || (doc.streak ?? 0) > 0 || (doc.booksFinished ?? 0) > 0 || (doc.shelf ?? []).length > 0;

  test("a private profile's reading figures are not kept on the server", async () => {
    // What a device does when it still believes the profile is shared: it
    // was made private on another computer, or the publish was already on
    // its way when the reader pressed "Make private".
    const shy = await reader({ visibility: "private", minutes: 240, streak: 9 });
    assert.equal(hasFigures(await stored(shy.id)), false, "saved with the profile while private");
    const late = await call("PUT", "/v1/profile/me", { token: shy.token, body: FIGURES });
    assert.equal(late.status, 200);
    // The answer says the profile is private, which is how the app learns it.
    assert.equal(late.body.visibility, "private");
    assert.equal(late.body.weekMinutes, 0);
    assert.equal(hasFigures(await stored(shy.id)), false, "published while private");
    // Still checked, so a bad number is refused the same either way.
    assert.equal((await call("PUT", "/v1/profile/me", { token: shy.token, body: { weekKey: WEEK, weekMinutes: -1 } })).status, 400);

    // Shared: the figures sent with the switch, and every publish after it, are kept.
    await call("PUT", "/v1/profile/me", { token: shy.token, body: { visibility: "public", ...FIGURES } });
    assert.equal((await stored(shy.id)).weekMinutes, 77);
    await call("PUT", "/v1/profile/me", { token: shy.token, body: { weekKey: WEEK, weekMinutes: 80 } });
    const kept = await stored(shy.id);
    assert.equal(kept.weekMinutes, 80);
    assert.equal(kept.shelf.length, 1);
    // A name change with the profile's own visibility repeated loses nothing.
    await call("PUT", "/v1/profile/me", { token: shy.token, body: { displayName: "Shy", visibility: "public" } });
    assert.equal((await stored(shy.id)).weekMinutes, 80);

    // Made private: the figures leave the server, and a publish that lands
    // afterwards does not bring them back.
    await call("PUT", "/v1/profile/me", { token: shy.token, body: { visibility: "private" } });
    assert.equal(hasFigures(await stored(shy.id)), false, "after un-sharing");
    await call("PUT", "/v1/profile/me", { token: shy.token, body: FIGURES });
    assert.equal(hasFigures(await stored(shy.id)), false, "a publish after un-sharing");
  });

  test("a publish for a private profile does not move a duel's minutes", async () => {
    const a = await reader({ minutes: 20 });
    const b = await reader({ minutes: 35 });
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    await call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token });
    await call("PUT", "/v1/profile/me", { token: b.token, body: { visibility: "private" } });
    await call("PUT", "/v1/profile/me", { token: b.token, body: { weekKey: WEEK, weekMinutes: 500 } });
    const duel = await db.collection("duels").findOne({ challengerId: a.id, opponentId: b.id });
    assert.equal(duel.opponentMinutes, 35);
  });

  test("un-sharing hides a reader from every answer another reader can get, at once", async () => {
    const me = await reader({ minutes: 10 });
    const shy = await reader({ minutes: 4000.5, prefix: "hide" });
    // An avatar no other reader in these tests wears.
    await call("PATCH", "/v1/account", { token: shy.token, body: { avatar: "sakura.smitten" } });
    await call("PUT", "/v1/profile/me", {
      token: shy.token,
      body: {
        displayName: "Shy Reader Name",
        visibility: "public",
        ...FIGURES,
        weekMinutes: 4000.5,
        shelf: [{ title: "A Secret Shelf Book", styleSeed: "s" }]
      }
    });
    // Tangled every way two readers can be: follows both ways, kudos both
    // ways, and a duel that is on.
    await call("POST", `/v1/follows/${shy.handle}`, { token: me.token });
    await call("POST", `/v1/follows/${me.handle}`, { token: shy.token });
    await call("POST", `/v1/kudos/${shy.handle}`, { token: me.token, body: kudosBody });
    await call("POST", `/v1/kudos/${me.handle}`, { token: shy.token, body: kudosBody });
    const made = await call("POST", "/v1/duels", { token: shy.token, body: { handle: me.handle, weekKey: WEEK } });
    assert.equal((await call("POST", `/v1/duels/${made.body.id}/accept`, { token: me.token })).status, 200);

    const everything = async (token) => {
      const answers = await Promise.all([
        call("GET", `/v1/leaderboard?week=${WEEK}`, { token }),
        call("GET", `/v1/leaderboard?week=${WEEK}`),
        call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token }),
        call("GET", "/v1/follows", { token }),
        call("GET", "/v1/duels", { token }),
        call("GET", "/v1/inbox", { token }),
        call("GET", `/v1/search?q=${shy.handle}`, { token }),
        call("GET", "/v1/search?q=hide"),
        call("GET", `/v1/profile/${shy.handle}?week=${WEEK}&day=${TODAY}`, { token }),
        call("GET", `/v1/profile/${me.handle}?week=${WEEK}&day=${TODAY}`, { token })
      ]);
      return JSON.stringify(answers.map((answer) => answer.body));
    };
    // (Their minutes are not searched for: four digits turn up in ids by chance.)
    const TRACES = [shy.handle, "Shy Reader Name", "A Secret Shelf Book", "sakura.smitten"];
    const seen = (text) => TRACES.filter((trace) => text.includes(trace));

    // Shared: all of it is there to see (and the board is now in the cache).
    assert.deepEqual(seen(await everything(me.token)), TRACES);

    await call("PUT", "/v1/profile/me", { token: shy.token, body: { visibility: "private" } });
    assert.deepEqual(seen(await everything(me.token)), [], "after un-sharing");
    // Nor can they be reached: each of these would tell them apart from a
    // handle that does not exist.
    assert.equal((await call("POST", `/v1/follows/${shy.handle}`, { token: me.token })).status, 404);
    assert.equal((await call("POST", `/v1/kudos/${shy.handle}`, { token: me.token, body: kudosBody })).status, 404);
    assert.equal((await call("POST", "/v1/duels", { token: me.token, body: { handle: shy.handle, weekKey: WEEK } })).status, 404);
    // What they were to this reader is still there to undo.
    assert.equal((await call("DELETE", `/v1/follows/${shy.handle}`, { token: me.token })).status, 200);
    assert.equal(await db.collection("follows").countDocuments({ followerId: me.id, followeeId: shy.id }), 0);
  });

  test("a reader who deletes their account mid-duel takes the duel with them", async () => {
    const a = await reader({ minutes: 20 });
    const b = await reader({ minutes: 35, prefix: "gone" });
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    await call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token });
    assert.equal((await call("GET", "/v1/duels", { token: a.token })).body.duels.length, 1);
    await call("GET", `/v1/leaderboard?week=${WEEK}`);

    assert.equal((await call("DELETE", "/v1/account", { token: b.token, body: { password: PASSWORD } })).status, 200);
    assert.equal((await call("GET", "/v1/duels", { token: a.token })).body.duels.length, 0);
    const text = JSON.stringify([
      (await call("GET", "/v1/inbox", { token: a.token })).body,
      (await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: a.token })).body,
      (await call("GET", `/v1/search?q=${b.handle}`)).body
    ]);
    assert.equal(text.includes(b.handle), false);
    // Their session went with the account.
    assert.equal((await call("GET", "/v1/duels", { token: b.token })).status, 401);
  });

  test("profiles that are public but have no handle take no place on the board", async () => {
    const real = await reader({ minutes: 6, prefix: "real" });
    // Written straight to the database: the API allows `visibility: "public"`
    // with no handle, and a hundred of these used to fill the top hundred,
    // be left out of the answer, and leave the board empty for everybody.
    const ghosts = Array.from({ length: 100 }, () => ({
      _id: new ObjectId(),
      handle: null,
      visibility: "public",
      weekKey: WEEK,
      weekMinutes: 10_000,
      streak: 1
    }));
    await db.collection("profiles").insertMany(ghosts);
    forgetBoards();
    try {
      const board = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: real.token });
      assert.ok(board.body.entries.length > 0, "the board is not emptied");
      assert.ok(board.body.entries.every((entry) => typeof entry.handle === "string"));
      // Their own place counts only the readers actually on the board.
      const ahead = await db.collection("profiles").countDocuments({
        visibility: "public",
        weekKey: WEEK,
        handle: { $type: "string" },
        weekMinutes: { $gt: 6 }
      });
      assert.equal(board.body.you.handle, real.handle);
      assert.equal(board.body.you.rank, ahead + 1);
    } finally {
      await db.collection("profiles").deleteMany({ _id: { $in: ghosts.map((ghost) => ghost._id) } });
      forgetBoards();
    }
  });
});

describe("sharing by default, from sign-up on", () => {
  const newcomer = async (displayName = "New Reader") => {
    const email = `c-${randomBytes(5).toString("hex")}@example.com`;
    const made = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD, displayName, avatar: "wizard.magic" } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    return { token: made.body.token, id: new ObjectId(made.body.account.id) };
  };
  const figures = { weekKey: WEEK, weekMinutes: 42, streak: 3, booksFinished: 1, shelf: [] };

  test("the app's sign-up: an account, then its profile shared in the next request", async () => {
    const me = await newcomer();
    const handle = `new${randomBytes(4).toString("hex")}`;
    // What the form sends once the account exists. The handle arrives bare,
    // but one typed with its "@" is taken the same way.
    const shared = await call("PUT", "/v1/profile/me", {
      token: me.token,
      body: { handle: `@${handle}`, displayName: "New Reader", visibility: "public", ...figures }
    });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.equal(shared.body.visibility, "public");
    assert.equal(shared.body.handle, handle);
    assert.equal((await db.collection("profiles").findOne({ _id: me.id })).handle, handle);

    // On the board and findable straight away, with no other step.
    const board = await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: me.token });
    assert.equal(board.body.you.handle, handle);
    assert.equal(board.body.you.weekMinutes, 42);
    assert.equal(board.body.you.avatar, "wizard.magic");
    assert.equal((await call("GET", `/v1/profile/@${handle}`)).status, 200);
    assert.equal((await call("GET", `/v1/search?q=@${handle}`)).body.results.length, 1);

    // And made private afterwards, exactly as before: off every answer, and
    // the figures leave the server.
    const hidden = await call("PUT", "/v1/profile/me", { token: me.token, body: { visibility: "private" } });
    assert.equal(hidden.body.visibility, "private");
    assert.equal(hidden.body.handle, handle, "the handle is kept for when they share again");
    assert.equal((await call("GET", `/v1/profile/${handle}`)).status, 404);
    assert.equal((await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: me.token })).body.you, null);
    const kept = await db.collection("profiles").findOne({ _id: me.id });
    assert.equal(kept.weekMinutes, 0);
    assert.equal(kept.weekKey, null);
  });

  test("a taken handle at sign-up leaves a signed-in account with nothing shared", async () => {
    const first = await reader({ prefix: "taken" });
    const me = await newcomer();
    const refused = await call("PUT", "/v1/profile/me", {
      token: me.token,
      body: { handle: first.handle, displayName: "New Reader", visibility: "public", ...figures }
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, "That handle is taken.");
    // The account is there and signed in; no profile was made, public or otherwise.
    assert.equal((await call("GET", "/v1/auth/me", { token: me.token })).status, 200);
    assert.equal(await db.collection("profiles").countDocuments({ _id: me.id }), 0);
    const mine = await call("GET", "/v1/profile/me", { token: me.token });
    assert.equal(mine.body.visibility, "private");
    assert.equal(mine.body.handle, null);
    // A reserved or malformed handle is refused the same way.
    for (const handle of ["admin", "a", "two words"]) {
      const bad = await call("PUT", "/v1/profile/me", { token: me.token, body: { handle, visibility: "public", ...figures } });
      assert.equal(bad.status, 400, handle);
    }
    assert.equal(await db.collection("profiles").countDocuments({ _id: me.id }), 0);

    // Another handle, and they are on the board.
    const handle = `free${randomBytes(4).toString("hex")}`;
    const shared = await call("PUT", "/v1/profile/me", { token: me.token, body: { handle, visibility: "public", ...figures } });
    assert.equal(shared.body.visibility, "public");
    assert.equal((await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: me.token })).body.you.handle, handle);
  });

  test("the server itself shares nothing: an account made without the switch is private", async () => {
    // An older app, or "Share my profile" turned off on the form.
    const quiet = await newcomer();
    assert.equal((await call("GET", "/v1/profile/me", { token: quiet.token })).body.visibility, "private");
    assert.equal(await db.collection("profiles").countDocuments({ _id: quiet.id }), 0);
    // Even sign-up fields a newer client might send do not share anything here.
    const email = `c-${randomBytes(5).toString("hex")}@example.com`;
    const eager = await call("POST", "/v1/auth/signup", {
      body: { email, password: PASSWORD, handle: `eager${randomBytes(3).toString("hex")}`, visibility: "public" }
    });
    assert.equal(eager.status, 201);
    assert.equal((await call("GET", "/v1/profile/me", { token: eager.body.token })).body.visibility, "private");
    // A handle kept for later, with no choice made, stays private too.
    const handle = `later${randomBytes(4).toString("hex")}`;
    const saved = await call("PUT", "/v1/profile/me", { token: quiet.token, body: { handle, displayName: "Quiet" } });
    assert.equal(saved.body.visibility, "private");
    assert.equal((await call("GET", `/v1/profile/${handle}`)).status, 404);
  });

  test("a profile that was private stays private: nothing but its owner's own switch shares it", async () => {
    // Accounts from before sharing became the default: one with a private
    // profile (as the app left it), one written by an older server with no
    // visibility at all, and one that never saved a profile.
    const old = await reader({ visibility: "private", minutes: 120, prefix: "old" });
    const older = await newcomer();
    const olderHandle = `older${randomBytes(4).toString("hex")}`;
    await db.collection("profiles").insertOne({ _id: older.id, handle: olderHandle, displayName: "Older", weekKey: WEEK, weekMinutes: 300 });
    const never = await newcomer();
    const publicBefore = await db.collection("profiles").countDocuments({ visibility: "public" });

    // Everything a newer app and a newer server do that is not that switch:
    // a restart (the indexes are ensured again), signing in again, reading
    // and saving the profile, publishing, changing the Pip, looking at boards.
    await ensureIndexes(db);
    for (const who of [old, older, never]) {
      assert.equal((await call("GET", "/v1/auth/me", { token: who.token })).status, 200);
      await call("GET", "/v1/profile/me", { token: who.token });
      await call("PUT", "/v1/profile/me", { token: who.token, body: { displayName: "Still Me" } });
      await call("PUT", "/v1/profile/me", { token: who.token, body: figures });
      await call("PATCH", "/v1/account", { token: who.token, body: { avatar: "ghost.ghost" } });
      await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: who.token });
      await call("GET", `/v1/leaderboard?scope=following&week=${WEEK}`, { token: who.token });
      await call("GET", "/v1/inbox", { token: who.token });
    }
    forgetBoards();

    assert.equal(await db.collection("profiles").countDocuments({ visibility: "public" }), publicBefore);
    for (const who of [old, older, never]) {
      const mine = await call("GET", "/v1/profile/me", { token: who.token });
      assert.equal(mine.body.visibility, "private");
      assert.equal((await call("GET", `/v1/leaderboard?week=${WEEK}`, { token: who.token })).body.you, null);
    }
    const board = JSON.stringify((await call("GET", `/v1/leaderboard?week=${WEEK}`)).body);
    for (const handle of [old.handle, olderHandle]) {
      assert.equal(board.includes(handle), false);
      assert.equal((await call("GET", `/v1/profile/${handle}`)).status, 404);
      assert.equal((await call("GET", `/v1/search?q=${handle}`)).body.results.length, 0);
    }
    // Their own switch still works, and is the only thing that does.
    const shared = await call("PUT", "/v1/profile/me", { token: old.token, body: { visibility: "public", ...figures } });
    assert.equal(shared.body.visibility, "public");
    assert.equal(await db.collection("profiles").countDocuments({ visibility: "public" }), publicBefore + 1);
  });
});

describe("who may call what", () => {
  test("every signed-in route refuses a missing, made-up or signed-out token", async () => {
    const a = await reader();
    const gone = await reader();
    assert.equal((await call("POST", "/v1/auth/logout", { token: gone.token })).status, 200);
    const routes = [
      ["GET", "/v1/profile/me"],
      ["PUT", "/v1/profile/me", { displayName: "x" }],
      ["DELETE", "/v1/profile/me"],
      ["GET", "/v1/leaderboard?scope=following"],
      ["POST", `/v1/follows/${a.handle}`],
      ["DELETE", `/v1/follows/${a.handle}`],
      ["GET", "/v1/follows"],
      ["POST", `/v1/kudos/${a.handle}`, kudosBody],
      ["POST", "/v1/duels", { handle: a.handle, weekKey: WEEK }],
      ["POST", `/v1/duels/${"a".repeat(24)}/accept`],
      ["POST", `/v1/duels/${"a".repeat(24)}/decline`],
      ["GET", "/v1/duels"],
      ["GET", "/v1/inbox"],
      ["GET", `/v1/visitors?day=${TODAY}`],
      ["PATCH", "/v1/account", { displayName: "x" }],
      ["DELETE", "/v1/account", { password: PASSWORD }],
      ["GET", "/v1/state"]
    ];
    for (const [method, path, body] of routes) {
      for (const token of [undefined, "x".repeat(43), "short", gone.token]) {
        const answer = await call(method, path, { token, body });
        assert.equal(answer.status, 401, `${method} ${path} with ${token ? "a bad token" : "no token"}`);
      }
    }
    // The public ones answer anyone, and tell a stranger nothing extra.
    for (const path of [`/v1/leaderboard?week=${WEEK}`, `/v1/profile/${a.handle}`, `/v1/search?q=${a.handle}`]) {
      const answer = await call("GET", path, { token: gone.token });
      assert.equal(answer.status, 200, path);
      assert.equal(JSON.stringify(answer.body).includes('"isYou":true'), false);
    }
    assert.equal((await call("GET", "/v1/profile/me", { token: a.token })).body.handle, a.handle);
  });

  test("only the challenged reader answers a duel, and only once", async () => {
    const a = await reader();
    const b = await reader();
    const stranger = await reader();
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    for (const action of ["accept", "decline"]) {
      assert.equal((await call("POST", `/v1/duels/${made.body.id}/${action}`, { token: stranger.token })).status, 404);
      assert.equal((await call("POST", `/v1/duels/${made.body.id}/${action}`, { token: a.token })).status, 404);
    }
    assert.equal((await call("GET", "/v1/duels", { token: stranger.token })).body.duels.length, 0);

    // Accept pressed twice at once (the card and the inbox both offer it).
    const answers = await Promise.all([
      call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token }),
      call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token })
    ]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
    assert.equal(await db.collection("events").countDocuments({ refId: new ObjectId(made.body.id), type: "duel_accepted" }), 1);
    assert.equal((await call("POST", `/v1/duels/${made.body.id}/decline`, { token: b.token })).status, 409);
  });

  test("a duel cannot be accepted once the other reader has gone private", async () => {
    const a = await reader();
    const b = await reader();
    const made = await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    await call("PUT", "/v1/profile/me", { token: a.token, body: { visibility: "private" } });
    const refused = await call("POST", `/v1/duels/${made.body.id}/accept`, { token: b.token });
    assert.equal(refused.status, 404);
    assert.equal(JSON.stringify(refused.body).includes(a.handle), false);
    assert.equal(JSON.stringify((await call("GET", "/v1/inbox", { token: b.token })).body).includes(a.handle), false);
  });
});

describe("deletion", () => {
  async function tangled() {
    const a = await reader();
    const b = await reader();
    await call("POST", `/v1/follows/${b.handle}`, { token: a.token });
    await call("POST", `/v1/follows/${a.handle}`, { token: b.token });
    await call("POST", `/v1/kudos/${b.handle}`, { token: a.token, body: kudosBody });
    await call("POST", `/v1/kudos/${a.handle}`, { token: b.token, body: kudosBody });
    await call("POST", "/v1/duels", { token: a.token, body: { handle: b.handle, weekKey: WEEK } });
    return { a, b };
  }

  async function traces(id) {
    const count = (name, filter) => db.collection(name).countDocuments(filter);
    return (
      (await count("follows", { $or: [{ followerId: id }, { followeeId: id }] })) +
      (await count("kudos", { $or: [{ fromId: id }, { toId: id }] })) +
      (await count("duels", { $or: [{ challengerId: id }, { opponentId: id }] })) +
      (await count("events", { $or: [{ userId: id }, { actorId: id }] }))
    );
  }

  test("deleting the profile removes community data both ways", async () => {
    const { a, b } = await tangled();
    assert.ok((await traces(a.id)) > 0);
    assert.equal((await call("DELETE", "/v1/profile/me", { token: a.token })).status, 200);
    assert.equal(await traces(a.id), 0);
    assert.equal((await call("GET", "/v1/inbox", { token: b.token })).body.events.length, 0);
  });

  test("deleting the account removes community data both ways", async () => {
    const { a } = await tangled();
    assert.equal((await call("DELETE", "/v1/account", { token: a.token, body: { password: PASSWORD } })).status, 200);
    assert.equal(await traces(a.id), 0);
  });
});
