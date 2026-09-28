import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
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
