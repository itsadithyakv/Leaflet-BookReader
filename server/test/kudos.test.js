import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { KUDOS_BADGE_AT, backfillKudosCircles } from "../src/community.js";
import { close, connect } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";

/**
 * Kudos for a moment (one of a reader's posts), and the two kudos badges the
 * server gives, counted by different readers, against a throwaway database
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
  const roomy = (windowMs) => ({ limit: 100_000, windowMs });
  const app = createApp(db, {
    limits: {
      ip: roomy(15 * MINUTE),
      email: roomy(15 * MINUTE),
      signup: roomy(60 * MINUTE),
      social: roomy(15 * MINUTE),
      search: roomy(5 * MINUTE),
      visitors: roomy(15 * MINUTE),
      profile: roomy(15 * MINUTE)
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

/** A signed-up reader with a public profile. */
async function reader({ visibility = "public", prefix = "k" } = {}) {
  const email = `k-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: 30, streak: 2, readDay: TODAY }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: new ObjectId(signup.body.account.id) };
}

const readers = (n) => Promise.all(Array.from({ length: n }, () => reader()));

/** A post by `who`, for their followers; `everyone` makes it for anybody (set in the database: that needs good standing). */
async function postBy(who, body = {}, { everyone = false } = {}) {
  const made = await call("POST", "/v1/posts", { token: who.token, body: { title: "Piranesi", ...body } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  if (everyone) {
    await db.collection("posts").updateOne({ _id: new ObjectId(made.body.post.id) }, { $set: { audience: "everyone" } });
  }
  return made.body.post.id;
}

const kudosTo = (from, to, extra = {}) =>
  call("POST", `/v1/kudos/${to.handle}`, { token: from.token, body: { dayKey: TODAY, weekKey: WEEK, ...extra } });

/** As if a day had passed between two readers: today's kudos is forgotten, so another may be sent. */
const nextDay = (from, to) => db.collection("kudos").deleteMany({ fromId: from.id, toId: to.id });

const profileOf = (who) => db.collection("profiles").findOne({ _id: who.id });

describe("kudos for a moment", () => {
  test("names the post: kept on the kudos and its event, and shown in the inbox", async () => {
    const [fan, writer] = await readers(2);
    const postId = await postBy(writer, { kind: "quote", title: "The House of Many Rooms", quote: "The Beauty of the House is immeasurable." }, { everyone: true });

    const sent = await kudosTo(fan, writer, { postId });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual(sent.body, { sent: true, kudosThisWeek: 1 });

    const about = { kind: "quote", title: "The House of Many Rooms" };
    const stored = await db.collection("kudos").findOne({ fromId: fan.id, toId: writer.id });
    assert.equal(stored.postId.toHexString(), postId);
    assert.deepEqual(stored.about, about);
    const event = await db.collection("events").findOne({ userId: writer.id, type: "kudos", actorId: fan.id });
    assert.deepEqual(event.about, about);

    const inbox = await call("GET", "/v1/inbox", { token: writer.token });
    const item = inbox.body.events.find((row) => row.type === "kudos");
    assert.equal(item.actor.handle, fan.handle);
    assert.deepEqual(item.about, about);
  });

  test("a finished-book post is `finished`, and kudos without a post says nothing of one", async () => {
    const [fan, other, writer] = await readers(3);
    // A post for followers, which a follower may read.
    await call("POST", `/v1/follows/${writer.handle}`, { token: fan.token });
    const postId = await postBy(writer, { title: "Dune" });
    assert.equal((await kudosTo(fan, writer, { postId })).status, 201);
    assert.equal((await kudosTo(other, writer)).status, 201);
    // `null` is the same as leaving it out.
    const third = await reader();
    assert.equal((await kudosTo(third, writer, { postId: null })).status, 201);

    const inbox = await call("GET", "/v1/inbox", { token: writer.token });
    const byActor = new Map(inbox.body.events.filter((row) => row.type === "kudos").map((row) => [row.actor.handle, row]));
    assert.deepEqual(byActor.get(fan.handle).about, { kind: "finished", title: "Dune" });
    assert.equal("about" in byActor.get(other.handle), false);
    assert.equal("about" in byActor.get(third.handle), false);
    const plain = await db.collection("kudos").findOne({ fromId: other.id, toId: writer.id });
    assert.equal("postId" in plain, false);
    assert.equal("about" in plain, false);
  });

  test("a postId that is not a post's id is a 400, and nothing is sent", async () => {
    const [fan, writer] = await readers(2);
    for (const postId of ["not-an-id", "abc", 12345, "0".repeat(25), { $ne: null }, ["0".repeat(24)]]) {
      const asked = await kudosTo(fan, writer, { postId });
      assert.equal(asked.status, 400, `${JSON.stringify(postId)}: ${JSON.stringify(asked.body)}`);
    }
    assert.equal(await db.collection("kudos").countDocuments({ fromId: fan.id }), 0);
  });

  test("a post that is not theirs, not there, hidden or not for the sender is the same 404", async () => {
    const [fan, writer, someoneElse] = await readers(3);
    const theirs = await postBy(someoneElse, {}, { everyone: true });
    const forFollowers = await postBy(writer, { title: "For my followers" });
    const hidden = await postBy(writer, { title: "Reported" }, { everyone: true });
    await db.collection("posts").updateOne({ _id: new ObjectId(hidden) }, { $set: { hiddenAt: new Date() } });
    const deleted = await postBy(writer, { title: "Taken back" }, { everyone: true });
    assert.equal((await call("DELETE", `/v1/posts/${deleted}`, { token: writer.token })).status, 200);

    const messages = new Set();
    for (const postId of [theirs, forFollowers, hidden, deleted, new ObjectId().toHexString()]) {
      const asked = await kudosTo(fan, writer, { postId });
      assert.equal(asked.status, 404, `${postId}: ${JSON.stringify(asked.body)}`);
      messages.add(asked.body.error);
    }
    // One message for all of them: which rule it was is not told.
    assert.equal(messages.size, 1);
    assert.equal(await db.collection("kudos").countDocuments({ fromId: fan.id }), 0);
    assert.equal(await db.collection("events").countDocuments({ userId: writer.id, type: "kudos" }), 0);

    // The followers-only post was refused for who was asking: once they
    // follow, it is theirs to cheer.
    assert.equal((await call("POST", `/v1/follows/${writer.handle}`, { token: fan.token })).status, 200);
    assert.equal((await kudosTo(fan, writer, { postId: forFollowers })).status, 201);
  });

  test("is still one kudos a day between two readers, for a post or not", async () => {
    const [fan, writer, other] = await readers(3);
    const postId = await postBy(writer, {}, { everyone: true });
    const second = await postBy(writer, { title: "Another" }, { everyone: true });

    assert.equal((await kudosTo(fan, writer)).status, 201);
    assert.equal((await kudosTo(fan, writer, { postId })).status, 409);

    assert.equal((await kudosTo(other, writer, { postId })).status, 201);
    assert.equal((await kudosTo(other, writer)).status, 409);
    assert.equal((await kudosTo(other, writer, { postId: second })).status, 409);
    assert.equal(await db.collection("kudos").countDocuments({ toId: writer.id }), 2);
  });
});

describe("the kudos badges", () => {
  test(`kudos from ${KUDOS_BADGE_AT} different readers earns kudos-from-${KUDOS_BADGE_AT}, and the list stops there`, async () => {
    const star = await reader();
    const fans = await readers(KUDOS_BADGE_AT + 1);

    // One fan, again and again, is one reader.
    const [first] = fans;
    for (let day = 0; day < 3; day += 1) {
      assert.equal((await kudosTo(first, star)).status, 201);
      await nextDay(first, star);
    }
    assert.equal((await call("GET", "/v1/profile/me", { token: star.token })).body.kudosFrom, 1);
    assert.equal((await call("GET", "/v1/profile/me", { token: first.token })).body.kudosTo, 1);

    for (const fan of fans.slice(1, KUDOS_BADGE_AT - 1)) {
      assert.equal((await kudosTo(fan, star)).status, 201);
    }
    const almost = await call("GET", `/v1/profile/${star.handle}`);
    assert.equal(almost.body.badges.includes(`kudos-from-${KUDOS_BADGE_AT}`), false);
    assert.equal((await call("GET", "/v1/profile/me", { token: star.token })).body.kudosFrom, KUDOS_BADGE_AT - 1);

    for (const fan of fans.slice(KUDOS_BADGE_AT - 1)) {
      assert.equal((await kudosTo(fan, star)).status, 201);
    }
    const stored = await profileOf(star);
    assert.equal(stored.kudosFrom.length, KUDOS_BADGE_AT);
    assert.equal(new Set(stored.kudosFrom.map((id) => id.toHexString())).size, KUDOS_BADGE_AT);
    // The eleventh is not kept: the list is for the badge, not a record.
    assert.equal(stored.kudosFrom.some((id) => id.equals(fans[KUDOS_BADGE_AT].id)), false);

    const own = await call("GET", "/v1/profile/me", { token: star.token });
    assert.equal(own.body.kudosFrom, KUDOS_BADGE_AT);
    assert.equal(own.body.kudosTo, 0);
    // The reader's own badges are as saved; the earned ones are on their card.
    assert.deepEqual(own.body.badges, []);
    const card = await call("GET", `/v1/profile/${star.handle}`);
    assert.deepEqual(card.body.badges, [`kudos-from-${KUDOS_BADGE_AT}`]);
    // Each fan has sent one reader kudos: nowhere near the other badge.
    assert.equal((await call("GET", "/v1/profile/me", { token: fans[5].token })).body.kudosTo, 1);
  });

  test(`kudos sent to ${KUDOS_BADGE_AT} different readers earns kudos-to-${KUDOS_BADGE_AT}`, async () => {
    const cheerer = await reader();
    const others = await readers(KUDOS_BADGE_AT + 1);
    for (const other of others) {
      assert.equal((await kudosTo(cheerer, other)).status, 201);
    }
    assert.equal((await profileOf(cheerer)).kudosTo.length, KUDOS_BADGE_AT);
    const own = await call("GET", "/v1/profile/me", { token: cheerer.token });
    assert.equal(own.body.kudosTo, KUDOS_BADGE_AT);
    assert.equal(own.body.kudosFrom, 0);
    const card = await call("GET", `/v1/profile/${cheerer.handle}`, { token: others[0].token });
    assert.deepEqual(card.body.badges, [`kudos-to-${KUDOS_BADGE_AT}`]);
  });

  test("a profile save cannot give itself one, and the card shows each badge once", async () => {
    const me = await reader();
    const saved = await call("PUT", "/v1/profile/me", {
      token: me.token,
      body: { badges: ["first-book", `kudos-from-${KUDOS_BADGE_AT}`, "kudos-to-10", "kudos-anything", "night-owl"] }
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.badges, ["first-book", "night-owl"]);
    assert.deepEqual((await profileOf(me)).badges, ["first-book", "night-owl"]);
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`)).body.badges, ["first-book", "night-owl"]);

    // One stored before this server dropped them is not shown unless earned,
    // and one earned is shown once, after the app's own.
    await db.collection("profiles").updateOne(
      { _id: me.id },
      {
        $set: {
          badges: ["kudos-to-10", "first-book", "kudos-from-10"],
          kudosFrom: Array.from({ length: KUDOS_BADGE_AT }, () => new ObjectId())
        }
      }
    );
    assert.deepEqual((await call("GET", `/v1/profile/${me.handle}`)).body.badges, ["first-book", "kudos-from-10"]);
  });

  test("the lists are in no answer about anybody, only counted on the reader's own profile", async () => {
    const [fan, star] = await readers(2);
    await call("POST", `/v1/follows/${star.handle}`, { token: fan.token });
    assert.equal((await kudosTo(fan, star)).status, 201);
    const ids = [fan.id.toHexString(), star.id.toHexString()];

    const answers = await Promise.all([
      call("GET", `/v1/leaderboard?week=${WEEK}`),
      call("GET", `/v1/leaderboard?week=${WEEK}&scope=following`, { token: fan.token }),
      call("GET", `/v1/search?q=${star.handle}`, { token: fan.token }),
      call("GET", `/v1/search?q=${fan.handle}`),
      call("GET", `/v1/profile/${star.handle}`, { token: fan.token }),
      call("GET", `/v1/profile/${fan.handle}`),
      call("GET", "/v1/inbox", { token: star.token })
    ]);
    for (const answer of answers) {
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
      const text = JSON.stringify(answer.body);
      assert.equal(text.includes("kudosFrom"), false, text);
      assert.equal(text.includes("kudosTo"), false, text);
      // The ids are never shown: a profile says who it is by handle.
      for (const id of ids) {
        assert.equal(text.includes(id), false, text);
      }
    }
    const own = await call("GET", "/v1/profile/me", { token: star.token });
    assert.equal(own.body.kudosFrom, 1);
    assert.equal(JSON.stringify(own.body).includes(fan.id.toHexString()), false);
  });

  test("are filled from the kudos kept, as often as the server starts, and stop at the same number", async () => {
    const star = await reader();
    const fans = await readers(KUDOS_BADGE_AT + 2);
    const kudosRow = (fromId, toId, dayKey) => ({ fromId, toId, dayKey, weekKey: WEEK, createdAt: new Date() });
    // As a server from before the lists left them: kudos, and no lists.
    await db.collection("kudos").insertMany([
      ...fans.map((fan) => kudosRow(fan.id, star.id, TODAY)),
      // The same pair on two days is one reader.
      kudosRow(fans[0].id, star.id, "2000-01-01"),
      kudosRow(star.id, fans[0].id, TODAY),
      kudosRow(star.id, fans[1].id, TODAY)
    ]);
    await db.collection("profiles").updateMany(
      { _id: { $in: [star.id, ...fans.map((fan) => fan.id)] } },
      { $unset: { kudosFrom: "", kudosTo: "" } }
    );

    assert.ok((await backfillKudosCircles(db)) >= fans.length + 2);
    const once = await profileOf(star);
    assert.equal(once.kudosFrom.length, KUDOS_BADGE_AT);
    assert.deepEqual(once.kudosTo.map((id) => id.toHexString()).sort(), [fans[0].id, fans[1].id].map((id) => id.toHexString()).sort());
    const firstFan = await profileOf(fans[0]);
    assert.deepEqual(firstFan.kudosTo.map((id) => id.toHexString()), [star.id.toHexString()]);
    assert.deepEqual(firstFan.kudosFrom.map((id) => id.toHexString()), [star.id.toHexString()]);

    // A second start changes nothing.
    await backfillKudosCircles(db);
    const twice = await profileOf(star);
    assert.deepEqual(twice.kudosFrom, once.kudosFrom);
    assert.deepEqual(twice.kudosTo, once.kudosTo);
    assert.deepEqual((await call("GET", `/v1/profile/${star.handle}`)).body.badges, [`kudos-from-${KUDOS_BADGE_AT}`]);
  });

  test("deleting an account leaves the readers it cheered their count", async () => {
    const [fan, star] = await readers(2);
    assert.equal((await kudosTo(fan, star)).status, 201);
    const gone = await call("DELETE", "/v1/profile/me", { token: fan.token });
    assert.equal(gone.status, 200);
    assert.equal(await profileOf(fan), null);
    assert.equal(await db.collection("kudos").countDocuments({ fromId: fan.id }), 0);
    assert.equal((await call("GET", "/v1/profile/me", { token: star.token })).body.kudosFrom, 1);
  });
});
