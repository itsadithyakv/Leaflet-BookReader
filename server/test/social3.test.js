import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { ObjectId } from "mongodb";
import { createApp } from "../src/app.js";
import { close, connect } from "../src/db.js";
import { isoWeekKey } from "../src/week.js";

/**
 * The public layer: who may post for everyone, reviews and quotes, likes and
 * dislikes, the discover feed, book communities with their threads, reports,
 * the admin's tools, and blocks. Mostly the rules that refuse something,
 * since those are what it is for. Against a throwaway database
 * (TEST_MONGO_URI, default mongodb://127.0.0.1:27017) dropped afterwards.
 */

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `leaflet_test_${randomBytes(4).toString("hex")}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEEK = isoWeekKey();
const TODAY = new Date().toISOString().slice(0, 10);
const PASSWORD = "correct horse battery";
const PERSON = ["avatar", "displayName", "handle", "pipSeed"];
const NEUTRAL = "You can't interact with this reader.";

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
      react: roomy(15 * MINUTE),
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

const col = (name) => db.collection(name);
const count = (name, filter) => col(name).countDocuments(filter);
const oid = (hex) => new ObjectId(hex);
const unique = (prefix = "k") => `${prefix}:${randomBytes(5).toString("hex")}`;

/** A signed-up reader with a profile; public unless told otherwise. A new account: unconfirmed, made just now. */
async function reader({ visibility = "public", minutes = 30, prefix = "p" } = {}) {
  const email = `p-${randomBytes(5).toString("hex")}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const token = signup.body.token;
  const handle = `${prefix}${randomBytes(4).toString("hex")}`;
  const saved = await call("PUT", "/v1/profile/me", {
    token,
    body: { handle, displayName: handle.toUpperCase(), visibility, weekKey: WEEK, weekMinutes: minutes, streak: 2, readDay: TODAY }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { token, handle, id: oid(signup.body.account.id) };
}

/** Makes the account `days` old, as if it had signed up then. */
const aged = (who, days) => col("accounts").updateOne({ _id: who.id }, { $set: { createdAt: new Date(Date.now() - days * DAY) } });
/** Confirms the account's address, as the emailed code would. */
const confirmed = (who) => col("accounts").updateOne({ _id: who.id }, { $set: { emailConfirmedAt: new Date() } });
const acceptRules = (who) => call("POST", "/v1/rules/accept", { token: who.token });

/** A reader in good standing for public posting: public, confirmed, a month old, guidelines accepted. */
async function good(options = {}) {
  const who = await reader(options);
  await confirmed(who);
  await aged(who, options.days ?? 30);
  assert.equal((await acceptRules(who)).status, 200);
  return who;
}

/**
 * A reader who may like, dislike and report with weight (a confirmed address,
 * an account ten days old), and no more: the guidelines not accepted, so no
 * writing in public.
 */
async function plain(options = {}) {
  const who = await reader(options);
  await confirmed(who);
  await aged(who, 10);
  return who;
}

/** A reader ten days old whose address was never confirmed: may report, but it does not count; may not like. */
async function unproven(options = {}) {
  const who = await reader(options);
  await aged(who, 10);
  return who;
}

/** Today's count of a kind for a reader, as if they had done that many already. */
const tallied = (who, kind, count) =>
  col("tallies").updateOne(
    { userId: who.id, kind, day: TODAY },
    { $set: { count, expiresAt: new Date(Date.now() + 4 * DAY) } },
    { upsert: true }
  );
/** Moves today's count of a kind to yesterday: "the next day". */
const nextDay = (who, kind) =>
  col("tallies").updateOne({ userId: who.id, kind, day: TODAY }, { $set: { day: new Date(Date.now() - DAY).toISOString().slice(0, 10) } });

/** The owner: in good standing, and made an admin by hand in the database, which is the only way. */
async function admin() {
  const who = await good({ prefix: "adm" });
  await col("profiles").updateOne({ _id: who.id }, { $set: { role: "admin" } });
  return who;
}

async function follow(a, b) {
  const asked = await call("POST", `/v1/follows/${b.handle}`, { token: a.token });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  if (asked.body.requested) {
    assert.equal((await call("POST", `/v1/follow-requests/${a.handle}/accept`, { token: b.token })).status, 200);
  }
}

const setVisibility = (who, visibility) =>
  call("PUT", "/v1/profile/me", { token: who.token, body: { visibility, weekKey: WEEK, weekMinutes: 30 } });

/** A post for everyone, by a reader in good standing. */
async function publicPost(who, body = {}) {
  const made = await call("POST", "/v1/posts", {
    token: who.token,
    body: { title: `Book ${randomBytes(3).toString("hex")}`, audience: "everyone", ...body }
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return made.body.post;
}

const report = (who, target, id, reason = "spam", extra = {}) =>
  call("POST", "/v1/reports", { token: who.token, body: { target, id, reason, ...extra } });

const react = (who, kind, id, value) => call("POST", `/v1/${kind}/${id}/react`, { token: who.token, body: { value } });

/** A community started by `keeper` (who needs their one-a-day), joined by `others`. */
async function community(keeper, others = [], body = {}) {
  const made = await call("POST", "/v1/communities", {
    token: keeper.token,
    body: { kind: "book", key: unique("isbn"), title: `A Book ${randomBytes(3).toString("hex")}`, author: "An Author", ...body }
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  for (const other of others) {
    const joined = await call("POST", `/v1/communities/${made.body.community.id}/join`, { token: other.token });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  return made.body.community;
}

async function thread(who, room, body = {}) {
  const made = await call("POST", `/v1/communities/${room.id}/threads`, {
    token: who.token,
    body: { title: "A thread", body: "What did everyone make of it?", ...body }
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return made.body.thread;
}

async function reply(who, to, body = "I liked it.") {
  const made = await call("POST", `/v1/threads/${to.id}/replies`, { token: who.token, body: { body } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  return made.body.reply;
}

const discover = async (who, query = "") => (await call("GET", `/v1/discover${query}`, { token: who.token })).body;
const inDiscover = async (who, post) => (await discover(who)).posts.some((row) => row.id === post.id);
const threadsOf = async (who, room) => (await call("GET", `/v1/communities/${room.id}/threads`, { token: who.token })).body.threads;

describe("who may post for everyone", () => {
  const everyone = (who) => call("POST", "/v1/posts", { token: who.token, body: { title: "Dune", audience: "everyone" } });

  test("each thing in the way has its own answer, and with none of them in the way it goes through", async () => {
    // Not public: a followers-only reader, however old and confirmed.
    const quiet = await good({ visibility: "followers" });
    const notPublic = await everyone(quiet);
    assert.equal(notPublic.status, 403);
    assert.match(notPublic.body.error, /public/);

    const me = await reader();
    const mine = () => call("GET", "/v1/profile/me", { token: me.token });
    assert.deepEqual(
      [(await mine()).body.rulesAccepted, (await mine()).body.isAdmin, (await mine()).body.suspendedUntil],
      [false, false, null]
    );
    // A new account, in order: the address, the three days, the guidelines.
    const unconfirmed = await everyone(me);
    assert.equal(unconfirmed.status, 403);
    assert.equal(unconfirmed.body.error, "Confirm your email address first (Settings, Account).");
    await confirmed(me);
    const young = await everyone(me);
    assert.equal(young.status, 403);
    assert.equal(young.body.error, "New accounts can post publicly after 3 days.");
    await aged(me, 2.9);
    assert.equal((await everyone(me)).status, 403);
    await aged(me, 3.1);
    const unread = await everyone(me);
    assert.equal(unread.status, 403);
    assert.equal(unread.body.error, "Read and accept the community guidelines first.");

    // None of it is needed to post to followers, as before.
    assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: "Dune" } })).status, 201);

    assert.deepEqual((await acceptRules(me)).body, { accepted: true });
    const acceptedAt = (await col("profiles").findOne({ _id: me.id })).rulesAcceptedAt;
    assert.ok(acceptedAt instanceof Date);
    // Accepting again changes nothing.
    assert.deepEqual((await acceptRules(me)).body, { accepted: true });
    assert.equal((await col("profiles").findOne({ _id: me.id })).rulesAcceptedAt.getTime(), acceptedAt.getTime());
    assert.equal((await mine()).body.rulesAccepted, true);

    const made = await everyone(me);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.post.audience, "everyone");
    // Going private keeps the acceptance: it was made once.
    await setVisibility(me, "private");
    assert.equal((await mine()).body.rulesAccepted, true);

    // There has to be a profile to keep it on.
    const email = `p-${randomBytes(5).toString("hex")}@example.com`;
    const bare = await call("POST", "/v1/auth/signup", { body: { email, password: PASSWORD } });
    assert.equal((await call("POST", "/v1/rules/accept", { token: bare.body.token })).status, 403);
    assert.equal((await call("POST", "/v1/rules/accept")).status, 401);
  });

  test("a suspended reader posts nowhere until it ends, and a new profile does not end it", async () => {
    const owner = await admin();
    const me = await good({ prefix: "sus" });
    const shown = await publicPost(me);
    const viewer = await plain();
    assert.equal(await inDiscover(viewer, shown), true);

    const suspended = await call("POST", "/v1/admin/suspend", { token: owner.token, body: { handle: `@${me.handle}`, days: 2 } });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    assert.equal(suspended.body.handle, me.handle);
    const until = new Date(suspended.body.suspendedUntil);
    assert.ok(Math.abs(until.getTime() - (Date.now() + 2 * DAY)) < MINUTE);

    const refused = await everyone(me);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /^Your account is suspended from posting until \d{1,2} \w+ \d{4}\.$/);
    // Not to followers either, and no likes or reports.
    assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: "Dune" } })).status, 403);
    const other = await publicPost(await good());
    assert.equal((await react(me, "posts", other.id, 1)).status, 403);
    assert.equal((await report(me, "post", other.id)).status, 403);
    assert.equal((await call("GET", "/v1/profile/me", { token: me.token })).body.suspendedUntil, suspended.body.suspendedUntil);
    // What they had posted is shown to nobody but themself, and they can still read.
    assert.equal(await inDiscover(viewer, shown), false);
    assert.equal((await call("GET", `/v1/profile/${me.handle}/posts`, { token: viewer.token })).body.posts.length, 0);
    assert.equal((await call("GET", `/v1/profile/${me.handle}/posts`, { token: me.token })).body.posts.length, 1);
    assert.equal((await call("GET", "/v1/discover", { token: me.token })).status, 200);

    // Deleting the profile and making another does not shake it off.
    assert.equal((await call("DELETE", "/v1/profile/me", { token: me.token })).status, 200);
    const again = await call("PUT", "/v1/profile/me", { token: me.token, body: { handle: `new${me.handle}`, visibility: "public" } });
    assert.equal(again.body.suspendedUntil, suspended.body.suspendedUntil);
    await acceptRules(me);
    assert.equal((await everyone(me)).status, 403);

    // Lifted, they post again.
    const lifted = await call("POST", "/v1/admin/suspend", { token: owner.token, body: { handle: `new${me.handle}`, days: 0 } });
    assert.deepEqual(lifted.body, { handle: `new${me.handle}`, suspendedUntil: null });
    assert.equal((await everyone(me)).status, 201);
    assert.equal((await call("GET", "/v1/profile/me", { token: me.token })).body.suspendedUntil, null);

    for (const body of [{ handle: me.handle }, { handle: me.handle, days: -1 }, { handle: me.handle, days: 1.5 }, { handle: me.handle, days: 4000 }]) {
      assert.equal((await call("POST", "/v1/admin/suspend", { token: owner.token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await call("POST", "/v1/admin/suspend", { token: owner.token, body: { handle: "nobody-here", days: 1 } })).status, 404);
  });

  test("the owner's switch pauses every public write, and nothing else", async () => {
    const owner = await admin();
    const me = await good();
    const friend = await good();
    const room = await community(me, [friend]);
    const talk = await thread(me, room);
    const settings = (body) => call(body ? "PUT" : "GET", "/v1/admin/settings", { token: owner.token, body });
    assert.deepEqual((await settings()).body, { publicPosting: true });
    assert.equal((await settings({ publicPosting: "off" })).status, 400);

    assert.deepEqual((await settings({ publicPosting: false })).body, { publicPosting: false });
    try {
      assert.deepEqual((await settings()).body, { publicPosting: false });
      const late = await good();
      const paused = [
        await everyone(me),
        await call("POST", "/v1/communities", { token: late.token, body: { kind: "book", key: unique(), title: "A New Book" } }),
        await call("POST", `/v1/communities/${room.id}/join`, { token: late.token }),
        await call("POST", `/v1/communities/${room.id}/threads`, { token: me.token, body: { title: "x", body: "y" } }),
        await call("POST", `/v1/threads/${talk.id}/replies`, { token: friend.token, body: { body: "y" } })
      ];
      for (const answer of paused) {
        assert.equal(answer.status, 503, JSON.stringify(answer.body));
        assert.equal(answer.body.error, "Public posting is paused for now.");
      }
      // The owner too: paused is paused.
      assert.equal((await everyone(owner)).status, 503);
      // Reading goes on, and so does everything between followers.
      assert.equal((await call("GET", "/v1/discover", { token: me.token })).status, 200);
      assert.equal((await call("GET", `/v1/communities/${room.id}/threads`, { token: friend.token })).status, 200);
      assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: friend.token })).status, 200);
      assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: "For my followers" } })).status, 201);
      assert.equal((await call("POST", `/v1/communities/${room.id}/leave`, { token: friend.token })).status, 200);
    } finally {
      assert.deepEqual((await settings({ publicPosting: true })).body, { publicPosting: true });
    }
    assert.equal((await everyone(me)).status, 201);
  });
});

describe("reviews and quotes", () => {
  test("each kind has its own fields, checked, and keeps its line breaks", async () => {
    const me = await good({ prefix: "rev" });
    const review = await call("POST", "/v1/posts", {
      token: me.token,
      body: {
        kind: "review",
        title: " Piranesi ",
        author: "Susanna Clarke",
        bookKey: "  ISBN:Piranesi ",
        audience: "everyone",
        spoiler: true,
        rating: 5,
        body: "  The House is   beautiful.\r\n\r\n\r\n\r\nAnd kind.\t\n\n  "
      }
    });
    assert.equal(review.status, 201, JSON.stringify(review.body));
    assert.equal(review.body.replaced, false);
    const post = review.body.post;
    assert.deepEqual(Object.keys(post).sort(), [
      "audience", "author", "body", "bookKey", "createdAt", "dislikes", "editedAt", "hidden", "id", "isYou", "kind", "likes",
      "line", "myReaction", "note", "person", "quote", "rating", "spoiler", "title"
    ]);
    assert.deepEqual(Object.keys(post.person).sort(), PERSON);
    assert.deepEqual(
      { ...post, id: null, createdAt: null, person: post.person.handle },
      {
        id: null, kind: "review", person: me.handle, title: "Piranesi", author: "Susanna Clarke", bookKey: "isbn:piranesi",
        rating: 5, line: null, body: "The House is beautiful.\n\nAnd kind.", quote: null, note: null, spoiler: true,
        audience: "everyone", likes: 0, dislikes: 0, myReaction: 0, hidden: false, createdAt: null, editedAt: null, isYou: true
      }
    );

    const quote = await call("POST", "/v1/posts", {
      token: me.token,
      body: { kind: "quote", title: "Piranesi", quote: " The Beauty of the House\nis immeasurable. ", note: "p. 5" }
    });
    assert.equal(quote.status, 201, JSON.stringify(quote.body));
    assert.deepEqual(
      [quote.body.post.kind, quote.body.post.quote, quote.body.post.note, quote.body.post.audience, quote.body.post.spoiler, quote.body.post.rating, quote.body.post.bookKey],
      ["quote", "The Beauty of the House is immeasurable.", "p. 5", "followers", false, null, null]
    );
    // The old kind is the default, and still what it was.
    const finished = await call("POST", "/v1/posts", { token: me.token, body: { title: "Dune", rating: 4, line: "Sand." } });
    assert.deepEqual([finished.body.post.kind, finished.body.post.rating, finished.body.post.line, finished.body.post.body], ["finished", 4, "Sand.", null]);

    const bad = [
      { kind: "essay", title: "x" },
      { kind: "review", title: "x", body: "No rating." },
      { kind: "review", title: "x", rating: 4 },
      { kind: "review", title: "x", rating: 4, body: "  \n \n" },
      { kind: "review", title: "x", rating: 6, body: "y" },
      { kind: "quote", title: "x" },
      { kind: "quote", title: "x", quote: 5 },
      { kind: "quote", title: "x", quote: "y", note: 5 },
      { title: "x", audience: "world" },
      { title: "x", spoiler: "yes" },
      { title: "x", bookKey: "" },
      { title: "x", bookKey: "k".repeat(161) },
      { title: "x", bookKey: 7 }
    ];
    for (const body of bad) {
      assert.equal((await call("POST", "/v1/posts", { token: me.token, body })).status, 400, JSON.stringify(body));
    }
    // A review is cut at 3000 characters and a quote at 500, not refused.
    const long = await call("POST", "/v1/posts", { token: me.token, body: { kind: "review", title: "Long", rating: 3, body: "a".repeat(3500) } });
    assert.equal(long.body.post.body.length, 3000);
    const longQuote = await call("POST", "/v1/posts", { token: me.token, body: { kind: "quote", title: "Long", quote: "q".repeat(600) } });
    assert.equal(longQuote.body.post.quote.length, 500);
  });

  test("one review of a book per reader: a second replaces the first where it stands", async () => {
    const me = await good();
    const fan = await plain();
    const key = unique("isbn");
    const first = await call("POST", "/v1/posts", {
      token: me.token,
      body: { kind: "review", title: "Middlemarch", bookKey: key, audience: "everyone", rating: 3, body: "Slow." }
    });
    assert.equal(first.status, 201);
    assert.deepEqual((await react(fan, "posts", first.body.post.id, 1)).body, { likes: 1, dislikes: 0, myReaction: 1 });

    const second = await call("POST", "/v1/posts", {
      token: me.token,
      body: { kind: "review", title: "Middlemarch", bookKey: key.toUpperCase(), audience: "everyone", rating: 5, body: "I was wrong." }
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.replaced, true);
    const post = second.body.post;
    assert.equal(post.id, first.body.post.id, "the same post");
    assert.deepEqual([post.rating, post.body], [5, "I was wrong."]);
    // Where it stood: its place in time is the first one's, so it cannot be re-posted to the top.
    assert.equal(post.createdAt, first.body.post.createdAt);
    assert.ok(post.editedAt);
    // The like was for what it said before.
    assert.deepEqual([post.likes, post.dislikes], [0, 0]);
    assert.equal(await count("reactions", { targetId: oid(post.id) }), 0);
    assert.equal(await count("posts", { userId: me.id, kind: "review" }), 1);

    // With no key from the app, the same title and author is the same book.
    const typed = { kind: "review", title: "Bleak House", author: "Charles Dickens", rating: 4 };
    assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { ...typed, body: "Foggy." } })).status, 201);
    const retyped = await call("POST", "/v1/posts", { token: me.token, body: { ...typed, title: "bleak house", body: "Still foggy." } });
    assert.equal(retyped.status, 200);
    assert.equal(retyped.body.replaced, true);
    assert.equal(await count("posts", { userId: me.id, kind: "review" }), 2);
    // Another reader's review of the same book is their own.
    const other = await good();
    const theirs = await call("POST", "/v1/posts", { token: other.token, body: { kind: "review", title: "Middlemarch", bookKey: key, rating: 2, body: "No." } });
    assert.equal(theirs.status, 201);

    // Two first reviews of one book sent at once are one review.
    const twin = await good();
    const twinKey = unique("isbn");
    const both = await Promise.all(
      ["One.", "Two."].map((body) => call("POST", "/v1/posts", { token: twin.token, body: { kind: "review", title: "Twins", bookKey: twinKey, rating: 4, body } }))
    );
    assert.deepEqual(both.map((answer) => answer.status).sort(), [200, 201], JSON.stringify(both.map((answer) => answer.body)));
    assert.equal(await count("posts", { userId: twin.id, bookKey: twinKey }), 1);
  });

  test("thirty quotes from one book, ever", async () => {
    const me = await good();
    const key = unique("isbn");
    const quote = (bookKey = key) => call("POST", "/v1/posts", { token: me.token, body: { kind: "quote", title: "Ulysses", bookKey, quote: "Yes I said yes." } });
    const first = await quote();
    assert.equal(first.status, 201);
    assert.equal((await col("quoteTallies").findOne({ userId: me.id, bookRef: key })).count, 1);
    // (Twenty-eight more, on other days: the tally is what remembers them.)
    await col("quoteTallies").updateOne({ userId: me.id, bookRef: key }, { $set: { count: 29 } });
    assert.equal((await quote()).status, 201);
    const refused = await quote();
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /lot of this book already/);
    assert.equal(await count("posts", { userId: me.id, kind: "quote" }), 2);
    // Deleting one does not make room: "ever" is what stops a book going up a paragraph at a time.
    assert.equal((await call("DELETE", `/v1/posts/${first.body.post.id}`, { token: me.token })).status, 200);
    assert.equal((await quote()).status, 409);
    assert.equal((await col("quoteTallies").findOne({ userId: me.id, bookRef: key })).count, 30);
    // Another book is another thirty.
    assert.equal((await quote(unique("isbn"))).status, 201);
  });

  test("a like or a dislike, changed and taken back, keeps the counts true", async () => {
    const author = await good();
    const b = await plain();
    const c = await plain();
    const post = await publicPost(author);
    assert.deepEqual((await react(b, "posts", post.id, 1)).body, { likes: 1, dislikes: 0, myReaction: 1 });
    // The same again is the same.
    assert.deepEqual((await react(b, "posts", post.id, 1)).body, { likes: 1, dislikes: 0, myReaction: 1 });
    // Changed: one count down, the other up.
    assert.deepEqual((await react(b, "posts", post.id, -1)).body, { likes: 0, dislikes: 1, myReaction: -1 });
    assert.deepEqual((await react(c, "posts", post.id, 1)).body, { likes: 1, dislikes: 1, myReaction: 1 });
    assert.equal((await col("posts").findOne({ _id: oid(post.id) })).score, 0);
    assert.deepEqual((await react(b, "posts", post.id, 0)).body, { likes: 1, dislikes: 0, myReaction: 0 });
    assert.deepEqual((await react(b, "posts", post.id, 0)).body, { likes: 1, dislikes: 0, myReaction: 0 });
    assert.equal((await col("posts").findOne({ _id: oid(post.id) })).score, 1);
    assert.equal(await count("reactions", { targetId: oid(post.id) }), 1);
    // Every view carries the counts and the reader's own.
    const seen = (await discover(c)).posts.find((row) => row.id === post.id);
    assert.deepEqual([seen.likes, seen.dislikes, seen.myReaction], [1, 0, 1]);
    assert.equal((await discover(b)).posts.find((row) => row.id === post.id).myReaction, 0);

    // Two taps at once from one reader are one like.
    const d = await plain();
    await Promise.all([react(d, "posts", post.id, 1), react(d, "posts", post.id, 1)]);
    assert.equal((await col("posts").findOne({ _id: oid(post.id) })).likes, 2);

    assert.equal((await react(author, "posts", post.id, 1)).status, 400, "not one's own");
    for (const value of [2, "1", null, undefined, 0.5]) {
      assert.equal((await react(b, "posts", post.id, value)).status, 400, String(value));
    }
    const shy = await reader({ visibility: "private" });
    assert.equal((await react(shy, "posts", post.id, 1)).status, 403);
    // A like moves a post for everybody, so it takes a confirmed address and three days.
    const loose = await unproven();
    const unconfirmed = await react(loose, "posts", post.id, 1);
    assert.equal(unconfirmed.status, 403);
    assert.equal(unconfirmed.body.error, "Confirm your email address first (Settings, Account).");
    const young = await reader();
    await confirmed(young);
    const early = await react(young, "posts", post.id, 1);
    assert.equal(early.status, 403);
    assert.equal(early.body.error, "New accounts can like and dislike after 3 days.");
    assert.equal((await col("posts").findOne({ _id: oid(post.id) })).likes, 2, "neither counted");
    await aged(young, 3.5);
    assert.equal((await react(young, "posts", post.id, 1)).body.likes, 3);
    // (The guidelines and a public profile are for writing, not for this.)
    const quiet = await plain({ visibility: "followers" });
    assert.equal((await react(quiet, "posts", post.id, -1)).status, 200);
    assert.equal((await react(b, "posts", "a".repeat(24), 1)).status, 404);
    assert.equal((await react(b, "posts", "not-an-id", 1)).status, 404);
    assert.equal((await call("POST", `/v1/posts/${post.id}/react`, { body: { value: 1 } })).status, 401);
    // A post made for followers is not there for a stranger to react to.
    const closed = (await call("POST", "/v1/posts", { token: author.token, body: { title: "For followers" } })).body.post;
    assert.equal((await react(b, "posts", closed.id, 1)).status, 404);
    await follow(b, author);
    assert.equal((await react(b, "posts", closed.id, 1)).status, 200);
  });
});

describe("discover and a book's page", () => {
  test("discover is posts for everyone by public readers, and not one's own", async () => {
    const a = await good({ prefix: "disc" });
    const b = await good();
    const me = await good();
    const open = await publicPost(a, { title: "Open One" });
    const closed = (await call("POST", "/v1/posts", { token: a.token, body: { title: "Closed One" } })).body.post;
    const theirs = await publicPost(b, { title: "Theirs" });
    const mine = await publicPost(me, { title: "Mine" });

    const first = await discover(me);
    const ids = first.posts.map((post) => post.id);
    assert.ok(ids.includes(open.id) && ids.includes(theirs.id));
    assert.equal(ids.includes(closed.id), false, "a post for followers");
    assert.equal(ids.includes(mine.id), false, "one's own");
    assert.ok(ids.indexOf(theirs.id) < ids.indexOf(open.id), "newest first");
    assert.equal(first.posts.find((post) => post.id === open.id).isYou, false);
    assert.equal((await call("GET", "/v1/discover")).status, 401);
    // Following them does not put their followers' posts into discover: that is what the feed is for.
    await follow(me, a);
    assert.equal(await inDiscover(me, closed), false);

    // No longer public: out of discover, with nothing deleted, and back when they are.
    await setVisibility(b, "followers");
    assert.equal(await inDiscover(me, theirs), false);
    await setVisibility(b, "private");
    assert.equal(await inDiscover(me, theirs), false);
    await setVisibility(b, "public");
    assert.equal(await inDiscover(me, theirs), true);
    // On their profile, a reader who does not follow them sees the posts for everyone and no others.
    const stranger = await plain();
    const page = await call("GET", `/v1/profile/${a.handle}/posts`, { token: stranger.token });
    assert.deepEqual(page.body.posts.map((post) => post.title), ["Open One"]);
    assert.deepEqual((await call("GET", `/v1/profile/${a.handle}/posts`)).body.posts.map((post) => post.title), ["Open One"]);
    assert.deepEqual((await call("GET", `/v1/profile/${a.handle}/posts`, { token: me.token })).body.posts.map((post) => post.title), ["Closed One", "Open One"]);
    // And the feed has both kinds and both audiences, from the readers one follows.
    const feed = await call("GET", "/v1/feed", { token: me.token });
    assert.deepEqual(feed.body.posts.map((post) => post.title), ["Mine", "Closed One", "Open One"]);
  });

  test("three posts to a reader on a page of discover, the rest of theirs on later pages, in both orders", async () => {
    const me = await plain();
    const flood = await plain({ prefix: "flood" });
    const others = [await plain(), await plain(), await plain(), await plain()];
    const start = Date.now() - 5 * DAY;
    const row = (who, index, minute, score) => ({
      userId: who.id, kind: "finished", title: `${who.handle} ${index}`, author: null, audience: "everyone", spoiler: false,
      likes: 0, dislikes: 0, score, hiddenAt: null, createdAt: new Date(start + minute * MINUTE)
    });
    // Forty posts by four readers, a minute apart...
    const rows = others.flatMap((who, nth) => Array.from({ length: 10 }, (_, index) => row(who, index, index * 4 + nth, 100 + index * 4 + nth)));
    // ...and then one reader's twenty-five in a row, newer than all of those and better liked.
    rows.push(...Array.from({ length: 25 }, (_, index) => row(flood, index, 100 + index, 1000 + index)));
    const seeded = rows.map((post) => post.title);
    // One from too long ago to be "top", however loved, and one for followers.
    rows.push({ ...row(flood, "old", 0, 99_999), createdAt: new Date(Date.now() - 31 * DAY) });
    rows.push({ ...row(flood, "closed", 200, 99_999), audience: "followers" });
    await col("posts").insertMany(rows);
    const ours = new Set([flood, ...others].map((who) => who.handle));
    const most = (page) => {
      const counts = new Map();
      for (const post of page.posts) counts.set(post.person.handle, (counts.get(post.person.handle) ?? 0) + 1);
      return Math.max(0, ...counts.values());
    };
    const floods = (page) => page.posts.filter((post) => post.person.handle === flood.handle).length;

    // Newest first, by the cursor each page hands on.
    const pages = [await discover(me)];
    assert.equal(typeof pages[0].next, "string");
    while (pages.at(-1).more) {
      assert.ok(pages.length < 40, "paging ends");
      pages.push(await discover(me, `?cursor=${pages.at(-1).next}`));
    }
    assert.equal(pages.at(-1).next, null);
    for (const page of pages) {
      assert.ok(most(page) <= 3, "no more than three by one reader");
      const times = page.posts.map((post) => post.createdAt);
      assert.deepEqual(times, [...times].sort().reverse(), "newest first within the page");
    }
    const seen = pages.flatMap((page) => page.posts).filter((post) => ours.has(post.person.handle)).map((post) => post.title);
    // Nothing lost and nothing twice: every post is on some page ("old" too: new has no thirty days).
    assert.deepEqual([...seen].sort(), [...seeded, `${flood.handle} old`].sort());
    // The busy reader's are spread over nine pages or more, in their own order, among everyone else's.
    assert.ok(pages.filter((page) => floods(page) > 0).length >= 9);
    const firstWithFlood = pages.find((page) => floods(page) > 0);
    assert.equal(floods(firstWithFlood), 3);
    assert.ok(new Set(firstWithFlood.posts.map((post) => post.person.handle)).size > 1, "not one reader's page");
    const theirs = seen.filter((title) => title.startsWith(flood.handle) && !title.endsWith("old"));
    assert.deepEqual(theirs, Array.from({ length: 25 }, (_, index) => `${flood.handle} ${24 - index}`));
    // `before` still starts a page at a date, under the same rule.
    const dated = await discover(me, `?before=${encodeURIComponent(new Date(start + 110 * MINUTE).toISOString())}`);
    assert.ok(most(dated) <= 3);
    assert.equal(dated.posts.filter((post) => post.person.handle === flood.handle)[0].title, `${flood.handle} 9`);
    // A cursor is checked like anything else from outside.
    for (const cursor of ["garbage", Buffer.from(JSON.stringify({ b: "never", h: [] })).toString("base64url"), Buffer.from(JSON.stringify({ b: null, h: ["x"] })).toString("base64url")]) {
      assert.equal((await call("GET", `/v1/discover?cursor=${cursor}`, { token: me.token })).status, 400, cursor);
    }

    // Best first, by skip.
    const best = [];
    for (let skip = 0; ; skip += 30) {
      const page = await discover(me, `?sort=top&skip=${skip}`);
      best.push(page);
      assert.ok(most(page) <= 3, "no more than three by one reader");
      assert.equal(page.next, null);
      if (!page.more) break;
      assert.ok(skip < 300, "paging ends");
    }
    // The twenty-five best-liked posts are all one reader's: the page starts with their best three, then somebody else's.
    assert.deepEqual(best[0].posts.slice(0, 3).map((post) => post.title), [24, 23, 22].map((index) => `${flood.handle} ${index}`));
    assert.notEqual(best[0].posts[3].person.handle, flood.handle);
    const ranked = best.flatMap((page) => page.posts).filter((post) => ours.has(post.person.handle)).map((post) => post.title);
    assert.deepEqual([...ranked].sort(), [...seeded].sort(), "all of them, once; not the old one or the one for followers");
    const scoreOf = new Map(rows.map((post) => [post.title, post.score]));
    for (const who of [flood, ...others]) {
      const own = ranked.filter((title) => title.startsWith(who.handle)).map((title) => scoreOf.get(title));
      assert.deepEqual(own, [...own].sort((x, y) => y - x), "each reader's own, best first");
    }
    // A skip that is not a number is none, and one past the end is cut to 300.
    assert.equal((await call("GET", "/v1/discover?sort=top&skip=abc", { token: me.token })).status, 200);
    assert.equal((await call("GET", "/v1/discover?sort=top&skip=100000", { token: me.token })).status, 200);
  });

  test("a book's page: everyone's posts about it, one's follows', and the average of its reviews", async () => {
    const key = unique("isbn");
    const me = await good();
    const a = await good();
    const b = await good();
    const followed = await plain();
    const unfollowed = await plain();
    await follow(me, followed);
    const about = (who, body) => call("POST", "/v1/posts", { token: who.token, body: { title: "The Book", bookKey: key, ...body } });
    assert.equal((await about(a, { kind: "review", audience: "everyone", rating: 5, body: "Loved it." })).status, 201);
    assert.equal((await about(b, { kind: "review", audience: "everyone", rating: 4, body: "Liked it." })).status, 201);
    // A review for followers only is not part of the public average.
    assert.equal((await about(followed, { kind: "review", rating: 1, body: "For my followers." })).status, 201);
    assert.equal((await about(unfollowed, { line: "Nobody but my followers sees this." })).status, 201);
    assert.equal((await about(me, { kind: "quote", quote: "Mine." })).status, 201);
    // Another book entirely.
    await publicPost(a, { bookKey: unique("isbn") });

    const page = await call("GET", `/v1/books/posts?key=${encodeURIComponent(key.toUpperCase())}`, { token: me.token });
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.deepEqual(page.body.posts.map((post) => post.person.handle), [me.handle, followed.handle, b.handle, a.handle]);
    assert.equal(page.body.more, false);
    assert.deepEqual(page.body.summary, { reviews: 2, average: 4.5 });
    // A stranger sees the two for everyone.
    const stranger = await plain();
    const theirs = await call("GET", `/v1/books/posts?key=${encodeURIComponent(key)}`, { token: stranger.token });
    assert.deepEqual(theirs.body.posts.map((post) => post.person.handle), [b.handle, a.handle]);

    // One decimal.
    const c = await good();
    await about(c, { kind: "review", audience: "everyone", rating: 4, body: "Fine." });
    assert.deepEqual((await call("GET", `/v1/books/posts?key=${key}`, { token: stranger.token })).body.summary, { reviews: 3, average: 4.3 });
    assert.deepEqual((await call("GET", `/v1/books/posts?key=${unique()}`, { token: me.token })).body, { posts: [], more: false, summary: { reviews: 0, average: null } });
    assert.equal((await call("GET", "/v1/books/posts", { token: me.token })).status, 400);
    assert.equal((await call("GET", `/v1/books/posts?key=${key}`)).status, 401);
  });
});

describe("book communities", () => {
  const start = (who, body = {}) =>
    call("POST", "/v1/communities", { token: who.token, body: { kind: "book", key: unique("isbn"), title: "A Book", ...body } });

  test("starting one takes good standing, a week, and is one a day and five kept", async () => {
    const me = await good({ prefix: "keep" });
    const made = await start(me, { key: " ISBN:Kept ", title: "  The Kept\nBook ", author: "An Author" });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const room = made.body.community;
    assert.deepEqual(Object.keys(room).sort(), ["author", "createdAt", "id", "isKeeper", "isMember", "key", "kind", "listed", "memberCount", "threadCount", "title"]);
    assert.deepEqual(
      { ...room, id: null, createdAt: null },
      { id: null, kind: "book", key: "isbn:kept", title: "The Kept Book", author: "An Author", memberCount: 1, threadCount: 0, isMember: true, isKeeper: true, listed: false, createdAt: null }
    );
    // One a day, and deleting it does not give the day's one back.
    const second = await start(me);
    assert.equal(second.status, 429);
    assert.ok(Number(second.retryAfter) > 0);
    assert.equal((await call("POST", `/v1/communities/${room.id}/leave`, { token: me.token })).status, 200);
    assert.equal(await count("communities", { _id: oid(room.id) }), 0);
    assert.equal((await start(me)).status, 429);
    // Nor does deleting the profile and making another.
    assert.equal((await call("DELETE", "/v1/profile/me", { token: me.token })).status, 200);
    await call("PUT", "/v1/profile/me", { token: me.token, body: { handle: me.handle, visibility: "public" } });
    await acceptRules(me);
    assert.equal((await start(me)).status, 429);
    // Tomorrow there is another.
    await nextDay(me, "community");
    assert.equal((await start(me)).status, 201);

    // A week old, not three days: a new account can post before it can open a room.
    const young = await good({ days: 5 });
    const tooYoung = await start(young);
    assert.equal(tooYoung.status, 403);
    assert.equal(tooYoung.body.error, "New accounts can start a community after 7 days.");
    // (Joining one that is there needs only good standing.)
    const existing = await community(await good());
    assert.equal((await call("POST", `/v1/communities/${existing.id}/join`, { token: young.token })).status, 200);
    await aged(young, 8);
    assert.equal((await start(young)).status, 201);

    // And good standing in the first place, each condition as for a post.
    const unconfirmed = await reader();
    await aged(unconfirmed, 30);
    await acceptRules(unconfirmed);
    assert.match((await start(unconfirmed)).body.error, /Confirm your email/);
    const unread = await reader();
    await aged(unread, 30);
    await confirmed(unread);
    assert.match((await start(unread)).body.error, /guidelines/);
    const quiet = await good({ visibility: "followers" });
    assert.equal((await start(quiet)).status, 403);
    assert.equal(await count("communities", { createdBy: { $in: [unconfirmed.id, unread.id, quiet.id] } }), 0);

    // Five kept is the most.
    const busy = await good();
    await col("communities").insertMany(
      Array.from({ length: 5 }, () => ({
        kind: "book", key: unique("isbn"), title: "Kept", author: null, createdBy: busy.id, keeperId: busy.id, memberIds: [busy.id],
        memberCount: 1, bannedIds: [], threadCount: 0, reportCount: 0, unlistedAt: null, createdAt: new Date(Date.now() - 9 * DAY), lastActivityAt: new Date()
      }))
    );
    const sixth = await start(busy);
    assert.equal(sixth.status, 409);
    assert.match(sixth.body.error, /keep up to 5/);

    for (const body of [{ kind: "club" }, { key: "" }, { key: "k".repeat(161) }, { title: "" }, { title: 7 }, { author: 7 }]) {
      assert.equal((await start(await good(), body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call("POST", "/v1/communities", { body: { kind: "book", key: "k", title: "t" } })).status, 401);
  });

  test("one per book: a second reader with the same key joins the first", async () => {
    const first = await good();
    const second = await good();
    const key = unique("isbn");
    const made = await start(first, { key, title: "The Real Title" });
    assert.equal(made.status, 201);
    const joined = await start(second, { key: key.toUpperCase(), title: "A Rival Title", author: "Someone Else" });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.community.id, made.body.community.id);
    assert.deepEqual(
      [joined.body.community.title, joined.body.community.author, joined.body.community.memberCount, joined.body.community.isMember, joined.body.community.isKeeper],
      ["The Real Title", null, 2, true, false]
    );
    assert.equal(await count("communities", { key }), 1);
    // Joining that way does not use up the day's one, and is idempotent.
    assert.equal((await start(second, { key })).body.community.memberCount, 2);
    assert.equal((await start(second)).status, 201);
    // The same key as a series is another thing.
    const third = await good();
    const series = await start(third, { kind: "series", key });
    assert.equal(series.status, 201);
    assert.notEqual(series.body.community.id, made.body.community.id);

    // Two readers starting the same book at the same moment make one community.
    const raceKey = unique("isbn");
    const racers = [await good(), await good()];
    const answers = await Promise.all(racers.map((who) => start(who, { key: raceKey })));
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 201], JSON.stringify(answers.map((answer) => answer.body)));
    assert.equal(await count("communities", { key: raceKey }), 1);
    assert.equal((await col("communities").findOne({ key: raceKey })).memberCount, 2);
    // The one who joined instead still has their one for the day.
    const joiner = racers[answers.findIndex((answer) => answer.status === 200)];
    assert.equal((await start(joiner)).status, 201);
  });

  test("unlisted until three readers have joined; found by its key meanwhile", async () => {
    const keeper = await good();
    const second = await good();
    const third = await good();
    const looker = await plain();
    const title = `The C++ [Book] ${randomBytes(3).toString("hex")}`;
    const key = unique("isbn");
    const room = await community(keeper, [second], { key, title });
    const directory = async (who, query = "") => (await call("GET", `/v1/communities${query}`, { token: who.token })).body.communities.map((row) => row.id);
    const q = `?q=${encodeURIComponent("c++ [book]")}`;

    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: second.token })).body.community.listed, false);
    assert.equal((await directory(looker)).includes(room.id), false);
    assert.equal((await directory(looker, q)).includes(room.id), false);
    assert.equal((await directory(keeper, q)).includes(room.id), false, "not even to its members");
    // But it is there for whoever comes from the book, and for its members.
    const found = await call("GET", `/v1/communities/find?kind=book&key=${encodeURIComponent(key.toUpperCase())}`, { token: looker.token });
    assert.equal(found.status, 200);
    assert.deepEqual([found.body.community.id, found.body.community.listed, found.body.community.isMember, found.body.community.memberCount], [room.id, false, false, 2]);
    const byId = await call("GET", `/v1/communities/${room.id}`, { token: looker.token });
    assert.equal(byId.status, 200);
    assert.deepEqual(byId.body, found.body);
    assert.deepEqual(await directory(second, "?mine=1"), [room.id]);
    assert.deepEqual(await directory(looker, "?mine=1"), []);

    const joined = await call("POST", `/v1/communities/${room.id}/join`, { token: third.token });
    assert.equal(joined.status, 200);
    assert.deepEqual([joined.body.community.listed, joined.body.community.memberCount, joined.body.community.isMember], [true, 3, true]);
    assert.equal((await directory(looker)).includes(room.id), true);
    assert.equal((await directory(looker, q)).includes(room.id), true);
    // The search is text, not a pattern, and wants two characters.
    assert.equal((await directory(looker, `?q=${encodeURIComponent(".*")}`)).includes(room.id), false);
    assert.equal((await directory(looker, `?q=${encodeURIComponent("c.. [book]")}`)).includes(room.id), false);
    assert.equal((await directory(looker, "?q=c")).includes(room.id), true, "one letter is the largest, unfiltered");
    // One leaves: it stays listed. A directory entry does not come and go with every member.
    await call("POST", `/v1/communities/${room.id}/leave`, { token: third.token });
    assert.equal((await directory(looker)).includes(room.id), true);
    const after = await call("GET", `/v1/communities/${room.id}`, { token: looker.token });
    assert.deepEqual([after.body.community.listed, after.body.community.memberCount], [true, 2]);
    assert.ok((await col("communities").findOne({ _id: oid(room.id) })).listedAt instanceof Date);

    // Three members are not enough by themselves: three whose accounts are a
    // week old, at a confirmed address. Two friends made on the same day as
    // the keeper's request can join (three days is enough for that) and the
    // community is still in no directory.
    const fresh = [await good({ days: 4 }), await good({ days: 4 })];
    const propped = await community(await good(), fresh);
    const seenAs = async () => (await call("GET", `/v1/communities/${propped.id}`, { token: looker.token })).body.community;
    assert.deepEqual([(await seenAs()).listed, (await seenAs()).memberCount], [false, 3]);
    assert.equal((await directory(looker)).includes(propped.id), false);
    // An established reader joins: that is two. Still not.
    const established = await good();
    assert.equal((await call("POST", `/v1/communities/${propped.id}/join`, { token: established.token })).body.community.listed, false);
    // One of the friends' accounts turns a week old: three, and it is listed the next time anyone looks.
    await aged(fresh[0], 7.5);
    assert.equal((await seenAs()).listed, true);
    assert.equal((await directory(looker)).includes(propped.id), true);
    // A member whose address was never confirmed does not count, however old the account.
    const unconfirmedOld = await good();
    await col("accounts").updateOne({ _id: unconfirmedOld.id }, { $set: { emailConfirmedAt: null } });
    const hollow = await community(await good(), [await good()]);
    await col("communities").updateOne({ _id: oid(hollow.id) }, { $push: { memberIds: unconfirmedOld.id }, $inc: { memberCount: 1 } });
    assert.deepEqual(
      [(await call("GET", `/v1/communities/${hollow.id}`, { token: looker.token })).body.community.listed, (await col("communities").findOne({ _id: oid(hollow.id) })).memberCount],
      [false, 3]
    );

    assert.equal((await call("GET", `/v1/communities/find?kind=book&key=${unique()}`, { token: looker.token })).status, 404);
    assert.equal((await call("GET", "/v1/communities/find?kind=shelf&key=x", { token: looker.token })).status, 400);
    assert.equal((await call("GET", `/v1/communities/${"a".repeat(24)}`, { token: looker.token })).status, 404);
    assert.equal((await call("GET", "/v1/communities/not-an-id", { token: looker.token })).status, 404);
    // Only for a reader who shares a profile.
    const shy = await reader({ visibility: "private" });
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: shy.token })).status, 404);
    for (const path of ["/v1/communities", `/v1/communities/${room.id}`, "/v1/communities/find?kind=book&key=x", `/v1/communities/${room.id}/threads`]) {
      assert.equal((await call("GET", path)).status, 401, path);
    }
  });

  test("joining takes good standing, and fifty is the most", async () => {
    const room = await community(await good());
    const join = (who) => call("POST", `/v1/communities/${room.id}/join`, { token: who.token });
    const me = await good();
    const joined = await join(me);
    assert.equal(joined.status, 200);
    assert.deepEqual(Object.keys(joined.body), ["community"]);
    assert.equal(joined.body.community.memberCount, 2);
    // Again changes nothing.
    assert.equal((await join(me)).body.community.memberCount, 2);

    const unconfirmed = await reader();
    await aged(unconfirmed, 30);
    await acceptRules(unconfirmed);
    assert.equal((await join(unconfirmed)).status, 403);
    assert.equal((await join(await plain())).status, 403);
    assert.equal((await join(await good({ visibility: "followers" }))).status, 403);
    assert.equal((await call("POST", `/v1/communities/${"a".repeat(24)}/join`, { token: me.token })).status, 404);
    assert.equal((await call("POST", `/v1/communities/${room.id}/join`)).status, 401);
    assert.equal((await col("communities").findOne({ _id: oid(room.id) })).memberCount, 2);

    const busy = await good();
    await col("communities").insertMany(
      Array.from({ length: 50 }, () => ({
        kind: "book", key: unique("isbn"), title: "In", author: null, keeperId: null, memberIds: [busy.id], memberCount: 1, bannedIds: [],
        threadCount: 1, reportCount: 0, unlistedAt: null, createdAt: new Date(), lastActivityAt: new Date()
      }))
    );
    const refused = await join(busy);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /up to 50/);
  });

  test("a member the keeper removes is out, and stays out", async () => {
    const keeper = await good();
    const member = await good();
    const troll = await good({ prefix: "troll" });
    const key = unique("isbn");
    const room = await community(keeper, [member, troll], { key });
    const talk = await thread(keeper, room);
    const remove = (who, handle) => call("POST", `/v1/communities/${room.id}/members/${handle}/remove`, { token: who.token });

    // Only the keeper (or an admin).
    assert.equal((await remove(member, troll.handle)).status, 403);
    assert.equal((await remove(troll, member.handle)).status, 403);
    assert.equal((await remove(keeper, keeper.handle)).status, 400);
    assert.equal((await remove(keeper, "nobody-here")).status, 404);
    assert.equal((await call("POST", `/v1/communities/${room.id}/members/${troll.handle}/remove`)).status, 401);

    assert.deepEqual((await remove(keeper, `@${troll.handle}`)).body, { removed: true });
    const stored = await col("communities").findOne({ _id: oid(room.id) });
    assert.deepEqual([stored.memberCount, stored.memberIds.length, stored.bannedIds.map(String)], [2, 2, [String(troll.id)]]);
    // Out of every way back in, and of reading it.
    const refused = await call("POST", `/v1/communities/${room.id}/join`, { token: troll.token });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "You can't take part in this community.");
    assert.equal((await call("POST", "/v1/communities", { token: troll.token, body: { kind: "book", key, title: "Let me in" } })).status, 403);
    assert.equal((await call("GET", `/v1/communities/${room.id}/threads`, { token: troll.token })).status, 403);
    assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: troll.token })).status, 403);
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: troll.token })).status, 404);
    assert.equal((await call("POST", `/v1/communities/${room.id}/threads`, { token: troll.token, body: { title: "x", body: "y" } })).status, 403);
    assert.equal((await call("POST", `/v1/threads/${talk.id}/replies`, { token: troll.token, body: { body: "y" } })).status, 403);
    assert.equal((await react(troll, "threads", talk.id, -1)).status, 403);
    assert.equal((await col("communities").findOne({ _id: oid(room.id) })).memberCount, 2);
    // An admin can remove a member too, the keeper included, whose place is handed on.
    const owner = await admin();
    assert.deepEqual((await remove(owner, keeper.handle)).body, { removed: true });
    const after = await col("communities").findOne({ _id: oid(room.id) });
    assert.ok(after.keeperId.equals(member.id));
    assert.deepEqual(after.memberIds.map(String), [String(member.id)]);
  });

  test("the keeper leaving hands it on; the last one out closes it, unless there is talk in it", async () => {
    const keeper = await good();
    const second = await good();
    const third = await good();
    const room = await community(keeper, [second, third]);
    const stored = () => col("communities").findOne({ _id: oid(room.id) });
    const leave = (who) => call("POST", `/v1/communities/${room.id}/leave`, { token: who.token });

    assert.equal((await leave(await good())).status, 404, "not a member");
    assert.deepEqual((await leave(keeper)).body, { left: true });
    assert.ok((await stored()).keeperId.equals(second.id), "the member who joined first");
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: second.token })).body.community.isKeeper, true);
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: third.token })).body.community.isKeeper, false);
    assert.equal((await leave(keeper)).status, 404);

    // With a thread in it, the last one out leaves it standing, with no keeper.
    const talk = await thread(third, room);
    await leave(second);
    assert.ok((await stored()).keeperId.equals(third.id));
    await leave(third);
    const empty = await stored();
    assert.deepEqual([empty.memberCount, empty.keeperId, empty.threadCount], [0, null, 1]);
    assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: keeper.token })).status, 200);
    // A reader too new to start a community does not pick up the keeper's place by joining...
    const young = await good({ days: 4 });
    assert.equal((await call("POST", `/v1/communities/${room.id}/join`, { token: young.token })).body.community.isKeeper, false);
    assert.equal((await stored()).keeperId, null);
    // ...the next one who could have started it does.
    const next = await good();
    assert.equal((await call("POST", `/v1/communities/${room.id}/join`, { token: next.token })).body.community.isKeeper, true);
    assert.ok((await stored()).keeperId.equals(next.id));

    // With nothing in it, the last one out closes it; and so does its last thread going after them.
    const solo = await good();
    const quiet = await community(solo);
    await call("POST", `/v1/communities/${quiet.id}/leave`, { token: solo.token });
    assert.equal(await count("communities", { _id: oid(quiet.id) }), 0);
    const other = await good();
    const brief = await community(other);
    const only = await thread(other, brief);
    await call("POST", `/v1/communities/${brief.id}/leave`, { token: other.token });
    assert.equal(await count("communities", { _id: oid(brief.id) }), 1);
    assert.equal((await call("DELETE", `/v1/threads/${only.id}`, { token: other.token })).status, 200);
    assert.equal(await count("communities", { _id: oid(brief.id) }), 0);
  });

  test("a reader who stops being public leaves their communities, and what they wrote is hidden, not deleted", async () => {
    const keeper = await good();
    const member = await good();
    const looker = await plain();
    const room = await community(keeper, [member]);
    const talk = await thread(keeper, room, { title: "The keeper's thread" });
    const answered = await thread(member, room, { title: "The member's thread" });
    await reply(keeper, answered, "The keeper's reply.");
    await reply(member, answered, "The member's reply.");
    const post = await publicPost(keeper);
    const titles = async () => (await threadsOf(looker, room)).map((row) => row.title);
    const repliesSeen = async () => (await call("GET", `/v1/threads/${answered.id}`, { token: looker.token })).body.replies.map((row) => row.body);
    assert.deepEqual(await titles(), ["The member's thread", "The keeper's thread"]);

    await setVisibility(keeper, "followers");
    const stored = await col("communities").findOne({ _id: oid(room.id) });
    assert.ok(stored.keeperId.equals(member.id), "handed on");
    assert.deepEqual(stored.memberIds.map(String), [String(member.id)]);
    assert.deepEqual(await titles(), ["The member's thread"]);
    assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: looker.token })).status, 404);
    assert.deepEqual(await repliesSeen(), ["The member's reply."]);
    assert.equal(await inDiscover(looker, post), false);
    // All still there.
    assert.equal(await count("threads", { _id: oid(talk.id) }), 1);
    assert.equal(await count("replies", { authorId: keeper.id }), 1);

    await setVisibility(keeper, "private");
    assert.deepEqual(await titles(), ["The member's thread"]);
    // Public again: their writing is back. Their place is not; they can join again.
    await setVisibility(keeper, "public");
    assert.deepEqual(await titles(), ["The member's thread", "The keeper's thread"]);
    assert.deepEqual(await repliesSeen(), ["The keeper's reply.", "The member's reply."]);
    assert.equal(await inDiscover(looker, post), true);
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: keeper.token })).body.community.isMember, false);
  });
});

describe("threads and replies", () => {
  test("a thread list never carries a spoiler: no body, and an excerpt only where there is none to give away", async () => {
    const keeper = await good();
    const member = await good();
    const room = await community(keeper, [member]);
    const safe = await thread(member, room, { title: "First impressions", body: `No spoilers here.\n\n${"Just vibes. ".repeat(40)}` });
    const marked = await thread(member, room, { title: "The ending", body: "THE BUTLER DID IT.", spoiler: { percent: 100 } });
    assert.deepEqual(Object.keys(marked).sort(), [
      "author", "body", "canRemove", "communityId", "createdAt", "dislikes", "hidden", "id", "isYou", "lastActivityAt", "likes",
      "myReaction", "pinned", "replyCount", "spoiler", "title", "titleHidden"
    ]);
    assert.deepEqual([marked.title, marked.titleHidden], ["The ending", false]);
    assert.deepEqual([marked.body, marked.spoiler, marked.author.handle, marked.isYou, marked.canRemove], ["THE BUTLER DID IT.", { percent: 100 }, member.handle, true, true]);
    assert.equal(safe.spoiler, null);

    // Read by anyone who shares a profile, member or not.
    const looker = await plain();
    const list = await call("GET", `/v1/communities/${room.id}/threads`, { token: looker.token });
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.body).sort(), ["community", "more", "threads"]);
    assert.equal(list.body.community.id, room.id);
    assert.equal(list.body.community.threadCount, 2);
    const [second, first] = list.body.threads;
    assert.deepEqual([second.id, first.id], [marked.id, safe.id], "latest activity first");
    assert.equal("body" in second, false);
    assert.equal("body" in first, false);
    assert.equal(second.excerpt, null);
    assert.equal(JSON.stringify(list.body).includes("BUTLER"), false);
    // Nor its title, which can give as much away: only that there is one.
    assert.deepEqual([second.title, second.titleHidden, second.spoiler], [null, true, { percent: 100 }]);
    assert.equal(JSON.stringify(list.body).includes("The ending"), false);
    assert.deepEqual([first.title, first.titleHidden], ["First impressions", false]);
    // Its author sees it, and so does a reader who says they have got that far; not one who has not.
    const listFor = async (who, query = "") =>
      (await call("GET", `/v1/communities/${room.id}/threads${query}`, { token: who.token })).body.threads.find((row) => row.id === marked.id);
    assert.deepEqual([(await listFor(member)).title, (await listFor(member)).titleHidden], ["The ending", false]);
    assert.deepEqual([(await listFor(looker, "?at=100")).title, (await listFor(looker, "?at=100")).titleHidden], ["The ending", false]);
    assert.equal((await listFor(looker, "?at=99")).title, null);
    assert.equal((await listFor(looker, "?at=lots")).title, null);
    assert.equal((await listFor(looker, "?at=100")).excerpt, null, "the excerpt stays out of the list");
    const partWay = await thread(member, room, { title: "Halfway there", body: "Up to the midpoint.", spoiler: { percent: 50 } });
    const halves = async (at) =>
      (await call("GET", `/v1/communities/${room.id}/threads?at=${at}`, { token: looker.token })).body.threads.find((row) => row.id === partWay.id).title;
    assert.deepEqual([await halves(49), await halves(50), await halves(80)], [null, "Halfway there", "Halfway there"]);
    await call("DELETE", `/v1/threads/${partWay.id}`, { token: member.token });
    assert.ok(first.excerpt.startsWith("No spoilers here. Just vibes."));
    assert.equal(first.excerpt.length, 200);
    assert.deepEqual([first.isYou, first.canRemove, first.author.handle, first.replyCount, first.pinned], [false, false, member.handle, 0, false]);
    assert.deepEqual(Object.keys(first.author).sort(), PERSON);
    // The thread itself has the whole body, for whoever chooses to open it.
    const opened = await call("GET", `/v1/threads/${marked.id}`, { token: looker.token });
    assert.deepEqual(Object.keys(opened.body).sort(), ["community", "more", "replies", "thread"]);
    assert.deepEqual([opened.body.thread.body, opened.body.replies, opened.body.more, opened.body.community.id], ["THE BUTLER DID IT.", [], false, room.id]);
    // Opening it is the reader's choice, and gives the title.
    assert.deepEqual([opened.body.thread.title, opened.body.thread.titleHidden], ["The ending", false]);
    assert.equal("excerpt" in opened.body.thread, false);

    // How far in is said in the community's own terms.
    const post = (body) => call("POST", `/v1/communities/${room.id}/threads`, { token: member.token, body: { title: "t", body: "b", ...body } });
    for (const spoiler of [{ percent: 0 }, { percent: 101 }, { percent: 12.5 }, { book: 2 }, {}, "all of it", [50]]) {
      assert.equal((await post({ spoiler })).status, 400, JSON.stringify(spoiler));
    }
    for (const body of [{ title: "" }, { body: "" }, { title: 5 }, { body: " \n " }]) {
      assert.equal((await post(body)).status, 400, JSON.stringify(body));
    }
    const saga = await community(await good(), [member], { kind: "series" });
    const upTo = await thread(member, saga, { spoiler: { book: 3 } });
    assert.deepEqual(upTo.spoiler, { book: 3 });
    const wrong = await call("POST", `/v1/communities/${saga.id}/threads`, { token: member.token, body: { title: "t", body: "b", spoiler: { percent: 50 } } });
    assert.equal(wrong.status, 400);
    assert.equal(await count("threads", { communityId: oid(room.id) }), 2);
    // Only for readers who share a profile.
    const shy = await reader({ visibility: "private" });
    assert.equal((await call("GET", `/v1/communities/${room.id}/threads`, { token: shy.token })).status, 403);
    assert.equal((await call("GET", `/v1/threads/${marked.id}`, { token: shy.token })).status, 403);
    assert.equal((await call("GET", `/v1/threads/${"a".repeat(24)}`, { token: looker.token })).status, 404);
  });

  test("posting is for members in good standing: five threads and sixty replies a day", async () => {
    const keeper = await good();
    const member = await good();
    const room = await community(keeper, [member]);
    const outsider = await good();
    const start = (who, at = room) => call("POST", `/v1/communities/${at.id}/threads`, { token: who.token, body: { title: "A thread", body: "Words." } });

    const notIn = await start(outsider);
    assert.equal(notIn.status, 403);
    assert.equal(notIn.body.error, "Join the community to post in it.");
    // A member who is not in good standing any more: here, one whose guidelines were never accepted.
    await col("profiles").updateOne({ _id: member.id }, { $unset: { rulesAcceptedAt: "" } });
    assert.match((await start(member)).body.error, /guidelines/);
    await acceptRules(member);
    assert.equal((await start(await plain())).status, 403);
    assert.equal((await call("POST", `/v1/communities/${"a".repeat(24)}/threads`, { token: member.token, body: { title: "t", body: "b" } })).status, 404);
    assert.equal((await call("POST", `/v1/communities/${room.id}/threads`, { body: { title: "t", body: "b" } })).status, 401);

    const made = await start(member);
    assert.equal(made.status, 201);
    assert.deepEqual(Object.keys(made.body), ["thread"]);
    const talk = made.body.thread;
    // Five a day, across every community.
    const elsewhere = await community(await good(), [member]);
    for (let index = 0; index < 4; index += 1) {
      assert.equal((await start(member, index % 2 ? room : elsewhere)).status, 201);
    }
    const sixth = await start(member, elsewhere);
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.retryAfter) > 0);
    assert.equal(await count("threads", { authorId: member.id }), 5);
    assert.equal((await col("communities").findOne({ _id: oid(room.id) })).threadCount, 3);
    // Deleting one does not buy another: the day's five are five started, not five standing.
    const spare = (await threadsOf(member, elsewhere))[0];
    assert.equal((await call("DELETE", `/v1/threads/${spare.id}`, { token: member.token })).status, 200);
    assert.equal((await start(member, elsewhere)).status, 429);
    assert.equal((await col("tallies").findOne({ userId: member.id, kind: "thread" })).count, 5);

    // Replies: oldest first, and they move the thread up.
    const answer = (who, to = talk) => call("POST", `/v1/threads/${to.id}/replies`, { token: who.token, body: { body: " One line.\n\n\n\nAnother. " } });
    const first = await answer(keeper);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(Object.keys(first.body), ["reply"]);
    assert.deepEqual(Object.keys(first.body.reply).sort(), ["author", "body", "canRemove", "createdAt", "dislikes", "hidden", "id", "isYou", "likes", "myReaction", "threadId"]);
    assert.deepEqual([first.body.reply.body, first.body.reply.threadId, first.body.reply.isYou, first.body.reply.author.handle], ["One line.\n\nAnother.", talk.id, true, keeper.handle]);
    await reply(member, talk, "Second.");
    const opened = await call("GET", `/v1/threads/${talk.id}`, { token: outsider.token });
    assert.deepEqual(opened.body.replies.map((row) => row.body), ["One line.\n\nAnother.", "Second."]);
    assert.equal(opened.body.thread.replyCount, 2);
    assert.ok(opened.body.thread.lastActivityAt > opened.body.thread.createdAt);
    assert.equal((await threadsOf(outsider, room))[0].id, talk.id, "the thread just replied to is first");
    const after = await call("GET", `/v1/threads/${talk.id}?after=${encodeURIComponent(opened.body.replies[0].createdAt)}`, { token: outsider.token });
    assert.deepEqual(after.body.replies.map((row) => row.body), ["Second."]);

    assert.equal((await answer(outsider)).status, 403, "not a member");
    assert.equal((await answer(await plain())).status, 403, "not in good standing");
    for (const body of [{}, { body: "" }, { body: 5 }]) {
      assert.equal((await call("POST", `/v1/threads/${talk.id}/replies`, { token: keeper.token, body })).status, 400);
    }
    assert.equal((await call("POST", `/v1/threads/${"a".repeat(24)}/replies`, { token: keeper.token, body: { body: "x" } })).status, 404);

    // Sixty a day.
    const chatty = await good();
    await call("POST", `/v1/communities/${room.id}/join`, { token: chatty.token });
    await tallied(chatty, "reply", 59);
    const sixtieth = await answer(chatty);
    assert.equal(sixtieth.status, 201);
    const tooMany = await answer(chatty);
    assert.equal(tooMany.status, 429);
    assert.ok(Number(tooMany.retryAfter) > 0);
    // Nor does deleting a reply make room for one.
    assert.equal((await call("DELETE", `/v1/replies/${sixtieth.body.reply.id}`, { token: chatty.token })).status, 200);
    assert.equal((await answer(chatty)).status, 429);
    assert.equal(await count("replies", { authorId: chatty.id }), 0);
    await nextDay(chatty, "reply");
    assert.equal((await answer(chatty)).status, 201);
  });

  test("a hundred replies a page, and thirty threads, pinned ones first", async () => {
    const keeper = await good();
    const member = await good();
    const room = await community(keeper, [member]);
    const start = Date.now() - DAY;
    const rows = Array.from({ length: 33 }, (_, index) => ({
      communityId: oid(room.id), authorId: member.id, title: `Thread ${index}`, body: "Body.", spoiler: null, pinned: false, replyCount: 0,
      likes: 0, dislikes: 0, score: 0, createdAt: new Date(start + index * 1000), lastActivityAt: new Date(start + index * 1000), hiddenAt: null
    }));
    await col("threads").insertMany(rows);
    const pin = (who, id, pinned = true) => call("POST", `/v1/threads/${id}/pin`, { token: who.token, body: { pinned } });
    const oldest = rows[0]._id.toHexString();

    // Only the keeper pins.
    assert.equal((await pin(member, oldest)).status, 403);
    assert.equal((await pin(keeper, oldest, "yes")).status, 400);
    assert.equal((await pin(keeper, "a".repeat(24))).status, 404);
    assert.deepEqual((await pin(keeper, oldest)).body, { pinned: true });

    const first = await call("GET", `/v1/communities/${room.id}/threads`, { token: member.token });
    assert.equal(first.body.threads.length, 31, "the pinned one, then thirty");
    assert.deepEqual([first.body.threads[0].title, first.body.threads[0].pinned], ["Thread 0", true]);
    assert.deepEqual(first.body.threads.slice(1).map((row) => row.title), rows.slice(3).reverse().map((row) => row.title));
    assert.equal(first.body.more, true);
    const next = await call("GET", `/v1/communities/${room.id}/threads?before=${encodeURIComponent(first.body.threads.at(-1).lastActivityAt)}`, { token: member.token });
    assert.deepEqual(next.body.threads.map((row) => row.title), ["Thread 2", "Thread 1"], "the pinned one is not repeated");
    assert.equal(next.body.more, false);

    // Three pinned at most.
    assert.equal((await pin(keeper, rows[1]._id.toHexString())).status, 200);
    assert.equal((await pin(keeper, rows[2]._id.toHexString())).status, 200);
    const fourth = await pin(keeper, rows[3]._id.toHexString());
    assert.equal(fourth.status, 409);
    assert.deepEqual((await pin(keeper, oldest, false)).body, { pinned: false });
    assert.equal((await pin(keeper, rows[3]._id.toHexString())).status, 200);
    assert.equal(await count("threads", { communityId: oid(room.id), pinned: true }), 3);

    const talk = rows[10]._id;
    await col("replies").insertMany(
      Array.from({ length: 103 }, (_, index) => ({ threadId: talk, communityId: oid(room.id), authorId: member.id, body: `Reply ${index}`, likes: 0, dislikes: 0, score: 0, createdAt: new Date(start + index * 1000), hiddenAt: null }))
    );
    const page = await call("GET", `/v1/threads/${talk.toHexString()}`, { token: keeper.token });
    assert.equal(page.body.replies.length, 100);
    assert.deepEqual([page.body.replies[0].body, page.body.replies[99].body, page.body.more], ["Reply 0", "Reply 99", true]);
    const rest = await call("GET", `/v1/threads/${talk.toHexString()}?after=${encodeURIComponent(page.body.replies[99].createdAt)}`, { token: keeper.token });
    assert.deepEqual([rest.body.replies.map((row) => row.body), rest.body.more], [["Reply 100", "Reply 101", "Reply 102"], false]);
  });

  test("its author, the keeper or an admin takes a thread or reply down; nobody else", async () => {
    const keeper = await good();
    const member = await good();
    const other = await good();
    const room = await community(keeper, [member, other]);
    const talk = await thread(member, room);
    const theirs = await reply(other, talk, "Other's reply.");
    const mine = await reply(member, talk, "Member's reply.");
    const stays = await reply(keeper, talk, "Keeper's reply.");
    const view = async (who) => (await call("GET", `/v1/threads/${talk.id}`, { token: who.token })).body;

    // `canRemove` says who may.
    assert.deepEqual((await view(other)).replies.map((row) => row.canRemove), [true, false, false]);
    assert.deepEqual((await view(keeper)).replies.map((row) => row.canRemove), [true, true, true]);
    assert.equal((await view(other)).thread.canRemove, false);
    assert.equal((await view(keeper)).thread.canRemove, true);
    const owner = await admin();
    assert.equal((await view(owner)).thread.canRemove, true);

    assert.equal((await call("DELETE", `/v1/replies/${mine.id}`, { token: other.token })).status, 403);
    assert.equal((await call("DELETE", `/v1/threads/${talk.id}`, { token: other.token })).status, 403);
    assert.equal((await call("DELETE", `/v1/replies/${mine.id}`)).status, 401);
    assert.equal((await call("DELETE", `/v1/replies/${"a".repeat(24)}`, { token: keeper.token })).status, 404);
    assert.equal((await call("DELETE", "/v1/threads/not-an-id", { token: keeper.token })).status, 404);

    await react(keeper, "replies", theirs.id, 1);
    assert.deepEqual((await call("DELETE", `/v1/replies/${theirs.id}`, { token: other.token })).body, { deleted: true }, "its author");
    assert.deepEqual((await call("DELETE", `/v1/replies/${mine.id}`, { token: keeper.token })).body, { deleted: true }, "the keeper");
    assert.equal(await count("reactions", { targetId: oid(theirs.id) }), 0, "its likes go with it");
    const left = await view(member);
    assert.deepEqual([left.replies.map((row) => row.id), left.thread.replyCount], [[stays.id], 1]);

    // An admin, who is not even a member.
    const second = await thread(other, room);
    assert.equal((await call("DELETE", `/v1/threads/${second.id}`, { token: owner.token })).status, 200);
    // A thread goes with all its replies, and the community's count follows.
    assert.equal((await call("DELETE", `/v1/threads/${talk.id}`, { token: member.token })).status, 200);
    assert.equal(await count("replies", { threadId: oid(talk.id) }), 0);
    assert.equal((await col("communities").findOne({ _id: oid(room.id) })).threadCount, 0);
    assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: member.token })).status, 404);
  });

  test("threads and replies are liked and disliked as posts are", async () => {
    const keeper = await good();
    const member = await good();
    const room = await community(keeper, [member]);
    const talk = await thread(member, room);
    const answer = await reply(keeper, talk);
    const looker = await plain();
    assert.deepEqual((await react(looker, "threads", talk.id, 1)).body, { likes: 1, dislikes: 0, myReaction: 1 });
    assert.deepEqual((await react(looker, "threads", talk.id, -1)).body, { likes: 0, dislikes: 1, myReaction: -1 });
    assert.deepEqual((await react(keeper, "threads", talk.id, 1)).body, { likes: 1, dislikes: 1, myReaction: 1 });
    assert.deepEqual((await react(looker, "replies", answer.id, 1)).body, { likes: 1, dislikes: 0, myReaction: 1 });
    assert.deepEqual((await react(member, "replies", answer.id, -1)).body, { likes: 1, dislikes: 1, myReaction: -1 });
    assert.deepEqual((await react(member, "replies", answer.id, 0)).body, { likes: 1, dislikes: 0, myReaction: 0 });
    const seen = await call("GET", `/v1/threads/${talk.id}`, { token: looker.token });
    assert.deepEqual([seen.body.thread.likes, seen.body.thread.dislikes, seen.body.thread.myReaction], [1, 1, -1]);
    assert.deepEqual([seen.body.replies[0].likes, seen.body.replies[0].myReaction], [1, 1]);
    assert.equal((await threadsOf(keeper, room))[0].myReaction, 1);

    assert.equal((await react(member, "threads", talk.id, 1)).status, 400, "one's own thread");
    assert.equal((await react(keeper, "replies", answer.id, 1)).status, 400, "one's own reply");
    assert.equal((await react(looker, "threads", talk.id, 5)).status, 400);
    assert.equal((await react(looker, "threads", "a".repeat(24), 1)).status, 404);
    assert.equal((await react(looker, "replies", "a".repeat(24), 1)).status, 404);
    const shy = await reader({ visibility: "private" });
    assert.equal((await react(shy, "threads", talk.id, 1)).status, 403);
    const loose = await unproven();
    assert.match((await react(loose, "threads", talk.id, 1)).body.error, /Confirm your email/);
    assert.match((await react(loose, "replies", answer.id, 1)).body.error, /Confirm your email/);
    const young = await reader();
    await confirmed(young);
    assert.match((await react(young, "replies", answer.id, 1)).body.error, /after 3 days/);
    assert.equal((await col("threads").findOne({ _id: oid(talk.id) })).likes, 1);
    assert.equal((await call("POST", `/v1/replies/${answer.id}/react`, { body: { value: 1 } })).status, 401);
  });
});

describe("reports", () => {
  test("three readers hide a post; two do not, and one reader twice is one", async () => {
    const author = await good({ prefix: "rep" });
    const viewer = await plain();
    const [r1, r2, r3] = [await plain(), await plain(), await plain()];
    const post = await publicPost(author, { title: "Buy cheap watches" });

    assert.deepEqual((await report(r1, "post", post.id, "spam", { note: " Not about a book. " })).body, { reported: true });
    assert.deepEqual((await report(r2, "post", post.id, "hate")).body, { reported: true });
    // The same reader again, with another reason: still their one report.
    assert.deepEqual((await report(r1, "post", post.id, "sexual")).body, { reported: true });
    assert.equal(await count("reports", { targetId: oid(post.id) }), 2);
    assert.equal((await col("reports").findOne({ targetId: oid(post.id), reporterId: r1.id })).note, "Not about a book.");
    assert.equal(await inDiscover(viewer, post), true, "two are not enough");
    assert.equal((await col("posts").findOne({ _id: oid(post.id) })).hiddenAt, null);

    await report(r3, "post", post.id, "spam");
    const stored = await col("posts").findOne({ _id: oid(post.id) });
    assert.ok(stored.hiddenAt instanceof Date);
    assert.equal(stored.hiddenBy, "reports");
    assert.equal(await inDiscover(viewer, post), false);
    assert.equal((await call("GET", `/v1/profile/${author.handle}/posts`, { token: viewer.token })).body.posts.length, 0);
    assert.equal((await react(viewer, "posts", post.id, 1)).status, 404);
    // Its author still sees it, and that it is hidden.
    const own = await call("GET", `/v1/profile/${author.handle}/posts`, { token: author.token });
    assert.deepEqual([own.body.posts[0].id, own.body.posts[0].hidden], [post.id, true]);
    assert.equal((await call("GET", "/v1/feed", { token: author.token })).body.posts[0].hidden, true);
    // Re-posting a hidden review does not bring it back: it replaces the same, hidden post.
    const review = { kind: "review", title: "Watches", bookKey: unique("isbn"), audience: "everyone", rating: 5, body: "Buy them." };
    const first = (await call("POST", "/v1/posts", { token: author.token, body: review })).body.post;
    for (const who of [r1, r2, r3]) await report(who, "post", first.id);
    const again = await call("POST", "/v1/posts", { token: author.token, body: { ...review, body: "Buy them now." } });
    assert.deepEqual([again.body.post.id, again.body.post.hidden], [first.id, true]);
    assert.equal(await inDiscover(viewer, first), false);
  });

  test("who may report, and what", async () => {
    const author = await good();
    const post = await publicPost(author);
    const me = await plain();
    assert.equal((await report(author, "post", post.id)).status, 400, "one's own");
    const shy = await reader({ visibility: "private" });
    await aged(shy, 10);
    assert.equal((await report(shy, "post", post.id)).status, 403);
    const fresh = await reader();
    const tooNew = await report(fresh, "post", post.id);
    assert.equal(tooNew.status, 403);
    assert.equal(tooNew.body.error, "New accounts can report things after 3 days.");
    assert.equal((await call("POST", "/v1/reports", { body: { target: "post", id: post.id, reason: "spam" } })).status, 401);
    assert.equal(await count("reports", { targetId: oid(post.id) }), 0);

    for (const body of [{ target: "book", id: post.id, reason: "spam" }, { target: "post", id: post.id, reason: "boring" }, { target: "post", id: post.id }, { target: "post", id: post.id, reason: "spam", note: 5 }]) {
      assert.equal((await call("POST", "/v1/reports", { token: me.token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await report(me, "post", "a".repeat(24))).status, 404);
    assert.equal((await report(me, "thread", post.id)).status, 404, "a post is not a thread");
    assert.equal((await report(me, "post", undefined)).status, 404);
    // A profile is reported by its handle; one's own is not.
    assert.deepEqual((await call("POST", "/v1/reports", { token: me.token, body: { target: "profile", handle: author.handle, reason: "harassment" } })).body, { reported: true });
    assert.equal((await call("POST", "/v1/reports", { token: me.token, body: { target: "profile", handle: me.handle, reason: "other" } })).status, 400);
    assert.equal((await call("POST", "/v1/reports", { token: me.token, body: { target: "profile", handle: "nobody-here", reason: "other" } })).status, 404);
    // Which changes nothing by itself, however many.
    for (let index = 0; index < 4; index += 1) {
      await call("POST", "/v1/reports", { token: (await plain()).token, body: { target: "profile", handle: author.handle, reason: "harassment" } });
    }
    assert.equal(await count("reports", { target: "profile", targetId: author.id }), 5);
    assert.equal((await call("GET", `/v1/profile/${author.handle}`)).status, 200);
    assert.equal((await call("POST", "/v1/posts", { token: author.token, body: { title: "Still here", audience: "everyone" } })).status, 201);

    // Twenty a day.
    const keen = await plain();
    await tallied(keen, "report", 19);
    assert.equal((await report(keen, "post", post.id)).status, 200);
    // The same report again is not another one, and is not counted as one.
    assert.equal((await report(keen, "post", post.id)).status, 200);
    const next = await publicPost(author);
    const refused = await report(keen, "post", next.id);
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.retryAfter) > 0);
    assert.equal(await count("reports", { reporterId: keen.id }), 1);
  });

  test("threads and replies are hidden the same way; a spoiler report widens the spoiler instead", async () => {
    const keeper = await good();
    const member = await good();
    const room = await community(keeper, [member]);
    const looker = await plain();
    const reporters = [await plain(), await plain(), await plain()];
    const talk = await thread(member, room, { title: "A fine thread" });
    const rude = await reply(keeper, talk, "A rude reply.");
    await reply(member, talk, "A civil reply.");
    const nasty = await thread(member, room, { title: "A nasty thread" });

    for (const who of reporters.slice(0, 2)) {
      await report(who, "reply", rude.id, "harassment");
      await report(who, "thread", nasty.id, "hate");
    }
    assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: looker.token })).body.replies.length, 2);
    assert.equal((await threadsOf(looker, room)).length, 2);
    await report(reporters[2], "reply", rude.id, "harassment");
    await report(reporters[2], "thread", nasty.id, "hate");
    assert.deepEqual((await call("GET", `/v1/threads/${talk.id}`, { token: looker.token })).body.replies.map((row) => row.body), ["A civil reply."]);
    assert.deepEqual((await threadsOf(looker, room)).map((row) => row.title), ["A fine thread"]);
    assert.equal((await call("GET", `/v1/threads/${nasty.id}`, { token: looker.token })).status, 404);
    assert.equal((await react(looker, "replies", rude.id, -1)).status, 404);
    // Their authors see them, marked; and nobody replies to a hidden thread.
    assert.equal((await call("GET", `/v1/threads/${talk.id}`, { token: keeper.token })).body.replies.find((row) => row.id === rude.id).hidden, true);
    assert.equal((await call("GET", `/v1/threads/${nasty.id}`, { token: member.token })).body.thread.hidden, true);
    assert.equal((await call("POST", `/v1/threads/${nasty.id}/replies`, { token: member.token, body: { body: "Hello?" } })).status, 409);
    assert.equal((await call("POST", `/v1/threads/${nasty.id}/replies`, { token: keeper.token, body: { body: "Hello?" } })).status, 404);

    // A spoiler complaint is answered by marking the thread as spoiling the whole book.
    const loose = await thread(member, room, { title: "About the ending", body: "It was all a dream." });
    await report(reporters[0], "thread", loose.id, "spoiler");
    assert.equal((await threadsOf(looker, room)).find((row) => row.id === loose.id).excerpt, "It was all a dream.");
    await report(reporters[1], "thread", loose.id, "spoiler");
    const marked = (await threadsOf(looker, room)).find((row) => row.id === loose.id);
    assert.deepEqual([marked.spoiler, marked.excerpt], [{ percent: 100 }, null]);
    // And is not hidden for it, by two or by three.
    await report(reporters[2], "thread", loose.id, "spoiler");
    assert.equal((await call("GET", `/v1/threads/${loose.id}`, { token: looker.token })).status, 200);
    assert.equal((await col("threads").findOne({ _id: oid(loose.id) })).hiddenAt, null);

    // In a series, "the whole of it" is every book.
    const saga = await community(await good(), [member], { kind: "series" });
    const partTwo = await thread(member, saga, { spoiler: { book: 2 } });
    await report(reporters[0], "thread", partTwo.id, "spoiler");
    await report(reporters[1], "thread", partTwo.id, "spoiler");
    assert.deepEqual((await col("threads").findOne({ _id: oid(partTwo.id) })).spoiler, { book: 99 });
    // A post is marked as a spoiler the same way.
    const post = await publicPost(member);
    await report(reporters[0], "post", post.id, "spoiler");
    assert.equal((await discover(looker)).posts.find((row) => row.id === post.id).spoiler, false);
    await report(reporters[1], "post", post.id, "spoiler");
    await report(reporters[2], "post", post.id, "spoiler");
    assert.equal((await discover(looker)).posts.find((row) => row.id === post.id).spoiler, true);
  });

  test("five readers take a community out of the directory; four do not", async () => {
    const keeper = await good();
    const room = await community(keeper, [await good(), await good()]);
    const looker = await plain();
    const listed = async () => (await call("GET", `/v1/communities/${room.id}`, { token: looker.token })).body.community.listed;
    const inDirectory = async () => (await call("GET", "/v1/communities", { token: looker.token })).body.communities.some((row) => row.id === room.id);
    assert.equal(await listed(), true);
    assert.equal((await report(keeper, "community", room.id)).status, 400, "its keeper");
    for (let index = 0; index < 4; index += 1) {
      assert.equal((await report(await plain(), "community", room.id, "hate")).status, 200);
    }
    assert.equal(await listed(), true);
    assert.equal(await inDirectory(), true);
    await report(await plain(), "community", room.id, "hate");
    assert.equal(await listed(), false);
    assert.equal(await inDirectory(), false);
    const stored = await col("communities").findOne({ _id: oid(room.id) });
    assert.ok(stored.unlistedAt instanceof Date);
    assert.equal(stored.reportCount, 5);
    // Still there for its members and by its key: unlisted, not closed.
    assert.equal((await call("GET", `/v1/communities/${room.id}/threads`, { token: looker.token })).status, 200);
  });
});

describe("the admin", () => {
  test("to anyone else, the admin routes are not there", async () => {
    const me = await good();
    const post = await publicPost(await good());
    const routes = [
      ["GET", "/v1/admin/reports"],
      ["POST", "/v1/admin/resolve", { target: "post", id: post.id, action: "remove" }],
      ["POST", "/v1/admin/suspend", { handle: me.handle, days: 0 }],
      ["GET", "/v1/admin/settings"],
      ["PUT", "/v1/admin/settings", { publicPosting: false }],
      ["POST", "/v1/admin/community", { id: "a".repeat(24), title: "Mine now" }]
    ];
    const missing = await call("GET", "/v1/no-such-route", { token: me.token });
    assert.equal(missing.status, 404);
    for (const [method, path, body] of routes) {
      const answer = await call(method, path, { token: me.token, body });
      assert.equal(answer.status, 404, `${method} ${path}`);
      assert.deepEqual(answer.body, missing.body, "exactly as a route that does not exist");
      assert.equal((await call(method, path, { body })).status, 401, `${method} ${path} signed out`);
    }
    // Nothing happened.
    assert.equal(await count("posts", { _id: oid(post.id) }), 1);
    assert.notEqual((await col("settings").findOne({ _id: "site" }))?.publicPosting, false);
    // And no route makes an admin: the field is not something a profile save can set.
    await call("PUT", "/v1/profile/me", { token: me.token, body: { role: "admin", suspendedUntil: null, rulesAcceptedAt: "2020-01-01" } });
    assert.equal((await call("GET", "/v1/profile/me", { token: me.token })).body.isAdmin, false);
    assert.equal((await call("GET", "/v1/admin/reports", { token: me.token })).status, 404);
    assert.equal((await call("GET", "/v1/profile/me", { token: (await admin()).token })).body.isAdmin, true);
  });

  test("the queue shows what was reported as it stands; restore, dismiss and remove settle it", async () => {
    const owner = await admin();
    const author = await good({ prefix: "queue" });
    const viewer = await plain();
    const reporters = [await plain(), await plain(), await plain()];
    const post = await publicPost(author, { kind: "quote", title: "A Book", quote: "A line somebody disliked." });
    await report(reporters[0], "post", post.id, "spam", { note: "Why is this here" });
    await report(reporters[1], "post", post.id, "spam");
    await report(reporters[2], "post", post.id, "hate");
    assert.equal(await inDiscover(viewer, post), false);
    const queue = async () => (await call("GET", "/v1/admin/reports", { token: owner.token })).body.reports;
    const entry = (await queue()).find((row) => row.id === post.id);
    assert.deepEqual(Object.keys(entry).sort(), ["content", "count", "counting", "firstAt", "id", "latestAt", "notes", "reasons", "target"]);
    assert.deepEqual([entry.target, entry.count, entry.counting, entry.reasons, entry.notes], ["post", 3, 3, { spam: 2, hate: 1 }, ["Why is this here"]]);
    assert.deepEqual(Object.keys(entry.content).sort(), ["author", "body", "createdAt", "hidden", "kind", "line", "note", "person", "quote", "spoiler", "title", "unlisted"]);
    assert.deepEqual(
      [entry.content.person.handle, entry.content.kind, entry.content.title, entry.content.quote, entry.content.hidden],
      [author.handle, "quote", "A Book", "A line somebody disliked.", true]
    );

    const resolve = (body) => call("POST", "/v1/admin/resolve", { token: owner.token, body });
    for (const body of [{ target: "book", id: post.id, action: "remove" }, { target: "post", id: post.id, action: "burn" }, { target: "post", id: post.id }]) {
      assert.equal((await resolve(body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await resolve({ target: "post", id: "not-an-id", action: "dismiss" })).status, 404);

    // Restore: back for everyone, the reports closed (and kept, to expire later).
    assert.deepEqual((await resolve({ target: "post", id: post.id, action: "restore" })).body, { resolved: 3, action: "restore" });
    assert.equal(await inDiscover(viewer, post), true);
    assert.equal((await queue()).some((row) => row.id === post.id), false);
    const closed = await col("reports").find({ targetId: oid(post.id) }).toArray();
    assert.ok(closed.every((row) => row.resolvedAt instanceof Date && row.resolution === "restore"));
    // Once an admin has let it stand, three more reports no longer hide it: they wait in the queue.
    for (let index = 0; index < 3; index += 1) await report(await plain(), "post", post.id, "spam");
    assert.equal(await inDiscover(viewer, post), true);
    assert.equal((await queue()).find((row) => row.id === post.id).count, 3);
    // Nor do the first three count again.
    assert.deepEqual((await report(reporters[0], "post", post.id)).body, { reported: true });
    assert.equal(await count("reports", { targetId: oid(post.id) }), 6);
    assert.deepEqual((await resolve({ target: "post", id: post.id, action: "dismiss" })).body, { resolved: 3, action: "dismiss" });
    assert.equal(await inDiscover(viewer, post), true);

    // Remove: gone, with its likes.
    await react(viewer, "posts", post.id, 1);
    await report(await plain(), "post", post.id, "sexual");
    assert.deepEqual((await resolve({ target: "post", id: post.id, action: "remove" })).body, { resolved: 1, action: "remove" });
    assert.equal(await count("posts", { _id: oid(post.id) }), 0);
    assert.equal(await count("reactions", { targetId: oid(post.id) }), 0);

    // A thing its author deleted while reported leaves no entry behind.
    const gone = await publicPost(author);
    await report(reporters[0], "post", gone.id);
    await call("DELETE", `/v1/posts/${gone.id}`, { token: author.token });
    assert.equal((await queue()).some((row) => row.id === gone.id), false);
    assert.equal((await col("reports").findOne({ targetId: oid(gone.id) })).resolution, "deleted");
  });

  test("a reported thread, reply, community and profile in the queue", async () => {
    const owner = await admin();
    const keeper = await good();
    const member = await good({ prefix: "rude" });
    const room = await community(keeper, [member, await good()], { title: "A Reported Book" });
    const talk = await thread(member, room, { title: "A reported thread", body: "Its body." });
    const answer = await reply(member, talk, "A reported reply.");
    const other = await thread(keeper, room);
    await reply(member, other);
    const me = await plain();
    await report(me, "thread", talk.id, "harassment");
    await report(me, "reply", answer.id, "harassment");
    await report(me, "community", room.id, "other");
    await call("POST", "/v1/reports", { token: me.token, body: { target: "profile", handle: member.handle, reason: "harassment" } });

    const queue = (await call("GET", "/v1/admin/reports", { token: owner.token })).body.reports;
    const of = (target, id) => queue.find((row) => row.target === target && row.id === id);
    assert.deepEqual([of("thread", talk.id).content.title, of("thread", talk.id).content.body, of("thread", talk.id).content.person.handle], ["A reported thread", "Its body.", member.handle]);
    assert.deepEqual([of("reply", answer.id).content.body, of("reply", answer.id).content.person.handle], ["A reported reply.", member.handle]);
    assert.deepEqual([of("community", room.id).content.title, of("community", room.id).content.person.handle, of("community", room.id).content.unlisted], ["A Reported Book", keeper.handle, false]);
    assert.deepEqual([of("profile", String(member.id)).content.person.handle, of("profile", String(member.id)).content.visibility], [member.handle, "public"]);

    const resolve = (body) => call("POST", "/v1/admin/resolve", { token: owner.token, body });
    // A profile is not removed by this (suspending is how a reader is dealt with); by id or by handle.
    assert.deepEqual((await resolve({ target: "profile", id: member.handle, action: "remove" })).body, { resolved: 1, action: "remove" });
    assert.equal((await call("GET", `/v1/profile/${member.handle}`)).status, 200);
    assert.deepEqual((await resolve({ target: "reply", id: answer.id, action: "remove" })).body, { resolved: 1, action: "remove" });
    assert.equal((await col("threads").findOne({ _id: oid(talk.id) })).replyCount, 0);
    // Removing a community takes its threads and replies, and every report on them.
    assert.deepEqual((await resolve({ target: "community", id: room.id, action: "remove" })).body, { resolved: 1, action: "remove" });
    assert.equal(await count("communities", { _id: oid(room.id) }), 0);
    assert.equal(await count("threads", { communityId: oid(room.id) }), 0);
    assert.equal(await count("replies", { communityId: oid(room.id) }), 0);
    assert.equal(await count("reports", { resolvedAt: null, targetId: { $in: [oid(talk.id), oid(room.id), oid(answer.id)] } }), 0);
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: keeper.token })).status, 404);

    // A community that reports unlisted is relisted by restore.
    const second = await community(await good(), [await good(), await good()]);
    for (let index = 0; index < 5; index += 1) await report(await plain(), "community", second.id);
    assert.equal((await call("GET", `/v1/communities/${second.id}`, { token: me.token })).body.community.listed, false);
    assert.deepEqual((await resolve({ target: "community", id: second.id, action: "restore" })).body, { resolved: 5, action: "restore" });
    assert.equal((await call("GET", `/v1/communities/${second.id}`, { token: me.token })).body.community.listed, true);
    for (let index = 0; index < 5; index += 1) await report(await plain(), "community", second.id);
    assert.equal((await call("GET", `/v1/communities/${second.id}`, { token: me.token })).body.community.listed, true, "already looked at");
  });
});

describe("blocks", () => {
  test("a block hides each from the other, and refuses every way of reaching them in the same words", async () => {
    const me = await good({ prefix: "blocker" });
    const them = await good({ prefix: "blocked" });
    const bystander = await plain();
    await follow(me, them);
    await follow(them, me);
    const quiet = await good({ visibility: "followers" });
    await call("POST", `/v1/follows/${quiet.handle}`, { token: them.token });
    const key = unique("isbn");
    const mine = await publicPost(me, { bookKey: key, title: "Blocker's post" });
    const theirs = await publicPost(them, { bookKey: key, title: "Blocked's post" });
    const room = await community(me, [them]);
    const myThread = await thread(me, room, { title: "Blocker's thread" });
    const theirThread = await thread(them, room, { title: "Blocked's thread" });
    await reply(them, myThread, "Blocked's reply.");
    await reply(me, theirThread, "Blocker's reply.");
    await reply(me, myThread, "Blocker's own reply.");

    assert.equal((await call("POST", `/v1/blocks/${me.handle}`, { token: me.token })).status, 400);
    assert.equal((await call("POST", "/v1/blocks/nobody-here", { token: me.token })).status, 404);
    assert.equal((await call("POST", `/v1/blocks/${them.handle}`)).status, 401);
    assert.deepEqual((await call("POST", `/v1/blocks/@${them.handle}`, { token: me.token })).body, { blocked: true });
    assert.deepEqual((await call("POST", `/v1/blocks/${them.handle}`, { token: me.token })).body, { blocked: true });
    assert.equal(await count("blocks", { blockerId: me.id }), 1);
    // A second pair, to see that a request waiting is removed too.
    await call("POST", `/v1/blocks/${them.handle}`, { token: quiet.token });
    assert.equal(await count("followRequests", { fromId: them.id, toId: quiet.id }), 0);

    // The follows between them are gone, both ways.
    assert.equal(await count("follows", { $or: [{ followerId: me.id, followeeId: them.id }, { followerId: them.id, followeeId: me.id }] }), 0);
    const listed = await call("GET", "/v1/blocks", { token: me.token });
    assert.deepEqual(listed.body.blocked.map((row) => row.handle), [them.handle]);
    assert.deepEqual(Object.keys(listed.body.blocked[0]).sort(), PERSON);
    // Only the blocker's list says so.
    assert.deepEqual((await call("GET", "/v1/blocks", { token: them.token })).body, { blocked: [] });

    // Every way of reaching the other is refused, either way round, in one sentence.
    const body = { dayKey: TODAY, weekKey: WEEK };
    for (const [from, to] of [[me, them], [them, me]]) {
      const refusals = [
        await call("POST", `/v1/follows/${to.handle}`, { token: from.token }),
        await call("POST", `/v1/kudos/${to.handle}`, { token: from.token, body }),
        await call("POST", "/v1/duels", { token: from.token, body: { handle: to.handle, weekKey: WEEK } }),
        await call("POST", "/v1/gifts", { token: from.token, body: { to: to.handle, kind: "skin", itemId: "fox" } })
      ];
      for (const refusal of refusals) {
        assert.equal(refusal.status, 403, JSON.stringify(refusal.body));
        assert.equal(refusal.body.error, NEUTRAL);
      }
    }
    assert.equal(await count("follows", { followerId: them.id, followeeId: me.id }), 0);
    // A followers-only reader who blocked them is not even asked.
    assert.equal((await call("POST", `/v1/follows/${quiet.handle}`, { token: them.token })).body.error, NEUTRAL);
    assert.equal(await count("followRequests", { toId: quiet.id }), 0);

    // To the blocked reader, the blocker is gone: as a private profile is.
    const gone = await call("GET", `/v1/profile/${me.handle}`, { token: them.token });
    const shy = await reader({ visibility: "private" });
    const hidden = await call("GET", `/v1/profile/${shy.handle}`, { token: them.token });
    assert.deepEqual([gone.status, gone.body], [404, hidden.body]);
    assert.equal((await call("GET", `/v1/search?q=${me.handle}`, { token: them.token })).body.results.length, 0);
    assert.equal((await call("GET", `/v1/profile/${me.handle}/posts`, { token: them.token })).status, 404);
    // The blocker can still open the blocked reader's card, which says so; anyone else sees both.
    const card = await call("GET", `/v1/profile/${them.handle}`, { token: me.token });
    assert.deepEqual([card.status, card.body.youBlocked, card.body.isFollowing], [200, true, false]);
    assert.equal((await call("GET", `/v1/profile/${me.handle}`, { token: bystander.token })).body.youBlocked, false);
    assert.equal((await call("GET", `/v1/search?q=${me.handle}`, { token: bystander.token })).body.results.length, 1);

    // Neither sees the other's posts, anywhere.
    assert.equal(await inDiscover(me, theirs), false);
    assert.equal(await inDiscover(them, mine), false);
    assert.equal(await inDiscover(bystander, mine), true);
    assert.equal(await inDiscover(bystander, theirs), true);
    const book = async (who) => (await call("GET", `/v1/books/posts?key=${key}`, { token: who.token })).body.posts.map((post) => post.title);
    assert.deepEqual(await book(me), ["Blocker's post"]);
    assert.deepEqual(await book(them), ["Blocked's post"]);
    assert.deepEqual(await book(bystander), ["Blocked's post", "Blocker's post"]);
    assert.equal((await call("GET", `/v1/profile/${them.handle}/posts`, { token: me.token })).status, 404);
    assert.equal((await react(them, "posts", mine.id, -1)).status, 404);
    const feedOf = async (who) => (await call("GET", "/v1/feed", { token: who.token })).body.posts.map((post) => post.title);
    assert.deepEqual(await feedOf(me), ["Blocker's post"]);
    // Nor each other's threads and replies.
    const titles = async (who) => (await threadsOf(who, room)).map((row) => row.title).sort();
    assert.deepEqual(await titles(me), ["Blocker's thread"]);
    assert.deepEqual(await titles(them), ["Blocked's thread"]);
    assert.deepEqual(await titles(bystander), ["Blocked's thread", "Blocker's thread"]);
    assert.equal((await call("GET", `/v1/threads/${myThread.id}`, { token: them.token })).status, 404);
    assert.equal((await call("GET", `/v1/threads/${theirThread.id}`, { token: me.token })).status, 404);
    assert.deepEqual((await call("GET", `/v1/threads/${myThread.id}`, { token: me.token })).body.replies.map((row) => row.body), ["Blocker's own reply."]);
    assert.deepEqual((await call("GET", `/v1/threads/${theirThread.id}`, { token: them.token })).body.replies, []);
    assert.equal((await call("GET", `/v1/threads/${myThread.id}`, { token: bystander.token })).body.replies.length, 2);
    assert.equal((await call("POST", `/v1/threads/${myThread.id}/replies`, { token: them.token, body: { body: "Still here." } })).status, 404);
    assert.equal((await react(them, "threads", myThread.id, -1)).status, 404);
    // Nor anything from them in the inbox, from before the block or after.
    assert.equal(JSON.stringify((await call("GET", "/v1/inbox", { token: me.token })).body).includes(them.handle), false);
    assert.equal(JSON.stringify((await call("GET", "/v1/inbox", { token: them.token })).body).includes(me.handle), false);

    // Unblocked: seen again, but the follows do not come back by themselves.
    assert.deepEqual((await call("DELETE", `/v1/blocks/${them.handle}`, { token: me.token })).body, { blocked: false });
    assert.deepEqual((await call("DELETE", `/v1/blocks/${them.handle}`, { token: me.token })).body, { blocked: false });
    assert.equal((await call("GET", `/v1/profile/${me.handle}`, { token: them.token })).status, 200);
    assert.equal(await inDiscover(me, theirs), true);
    assert.deepEqual(await titles(them), ["Blocked's thread", "Blocker's thread"]);
    assert.equal((await call("GET", `/v1/profile/${them.handle}`, { token: me.token })).body.isFollowing, false);
    assert.equal((await call("POST", `/v1/follows/${me.handle}`, { token: them.token })).status, 200);
  });

  test("the blocked reader cannot undo it, and a gift already waiting is not handed over", async () => {
    const me = await good();
    const them = await good();
    await follow(me, them);
    await follow(them, me);
    assert.equal((await call("POST", "/v1/gifts", { token: them.token, body: { to: me.handle, kind: "skin", itemId: "fox" } })).status, 201);
    assert.equal((await call("GET", "/v1/gifts", { token: me.token })).body.gifts.length, 1);
    await call("POST", `/v1/blocks/${them.handle}`, { token: me.token });
    assert.deepEqual((await call("GET", "/v1/gifts", { token: me.token })).body, { gifts: [] });
    // Their own "unblock" is of a block they never made.
    assert.deepEqual((await call("DELETE", `/v1/blocks/${me.handle}`, { token: them.token })).body, { blocked: false });
    assert.equal(await count("blocks", { blockerId: me.id, blockedId: them.id }), 1);
    assert.equal((await call("GET", `/v1/profile/${me.handle}`, { token: them.token })).status, 404);
    // Blocking back makes two blocks; lifting one leaves the other.
    await call("POST", `/v1/blocks/${me.handle}`, { token: them.token });
    await call("DELETE", `/v1/blocks/${them.handle}`, { token: me.token });
    assert.equal((await call("POST", `/v1/follows/${them.handle}`, { token: me.token })).body.error, NEUTRAL);
  });
});

describe("leaving", () => {
  test("deleting an account takes its public writing, and leaves the counts true and others' replies standing", async () => {
    const me = await good({ prefix: "leaver" });
    const friend = await good();
    const other = await good();
    const blocker = await plain();
    const blocked = await plain();
    const room = await community(me, [friend, other]);
    // A thread of theirs that others answered, one nobody else did, and a reply to someone else's.
    const answered = await thread(me, room, { title: "Answered", body: "What they asked." });
    await reply(friend, answered, "Friend's answer.");
    await reply(me, answered, "Their own follow-up.");
    const lonely = await thread(me, room, { title: "Lonely" });
    await reply(me, lonely, "Talking to themself.");
    const theirs = await thread(friend, room, { title: "Friend's thread" });
    const mine = await reply(me, theirs, "Their reply elsewhere.");
    await react(friend, "replies", mine.id, 1);
    // Likes and dislikes they gave.
    const post = await publicPost(friend);
    await react(me, "posts", post.id, 1);
    await react(other, "posts", post.id, 1);
    await react(me, "threads", theirs.id, -1);
    const friendReply = (await call("GET", `/v1/threads/${answered.id}`, { token: friend.token })).body.replies[0];
    await react(me, "replies", friendReply.id, 1);
    // Posts, a quote's tally, a report made, a report about them, blocks both ways.
    const own = await publicPost(me, { kind: "quote", quote: "A line.", bookKey: unique("isbn") });
    await react(friend, "posts", own.id, 1);
    await report(me, "post", post.id);
    await report(friend, "post", own.id);
    await call("POST", "/v1/reports", { token: other.token, body: { target: "profile", handle: me.handle, reason: "other" } });
    await call("POST", `/v1/blocks/${blocked.handle}`, { token: me.token });
    await call("POST", `/v1/blocks/${me.handle}`, { token: blocker.token });
    const banned = await community(other, [], {});
    await col("communities").updateOne({ _id: oid(banned.id) }, { $set: { bannedIds: [me.id] } });

    const gone = await call("DELETE", "/v1/account", { token: me.token, body: { password: PASSWORD } });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));

    const left = {
      posts: await count("posts", { userId: me.id }),
      tallies: await count("quoteTallies", { userId: me.id }),
      reactions: await count("reactions", { userId: me.id }),
      reactionsToTheirs: await count("reactions", { targetId: { $in: [oid(own.id), oid(mine.id)] } }),
      replies: await count("replies", { authorId: me.id }),
      threads: await count("threads", { authorId: me.id }),
      reportsMade: await count("reports", { reporterId: me.id }),
      reportsAbout: await count("reports", { target: "profile", targetId: me.id }),
      blocks: await count("blocks", { $or: [{ blockerId: me.id }, { blockedId: me.id }] }),
      rooms: await count("communities", { $or: [{ memberIds: me.id }, { keeperId: me.id }, { bannedIds: me.id }] })
    };
    assert.deepEqual(left, { posts: 0, tallies: 0, reactions: 0, reactionsToTheirs: 0, replies: 0, threads: 0, reportsMade: 0, reportsAbout: 0, blocks: 0, rooms: 0 });
    // The report against their post is closed, not left waiting on nothing.
    assert.equal((await col("reports").findOne({ targetId: oid(own.id) })).resolution, "deleted");

    // Counted back down, exactly: the other reader's like stays.
    const liked = await col("posts").findOne({ _id: oid(post.id) });
    assert.deepEqual([liked.likes, liked.dislikes, liked.score], [1, 0, 1]);
    const disliked = await col("threads").findOne({ _id: oid(theirs.id) });
    assert.deepEqual([disliked.likes, disliked.dislikes, disliked.score, disliked.replyCount], [0, 0, 0, 0]);
    assert.equal((await col("replies").findOne({ _id: oid(friendReply.id) })).likes, 0);

    // The thread others answered stands, with no author; the one nobody answered is gone.
    assert.equal(await count("threads", { _id: oid(lonely.id) }), 0);
    const kept = await col("threads").findOne({ _id: oid(answered.id) });
    assert.deepEqual([kept.authorId, kept.replyCount], [null, 1]);
    const seen = await call("GET", `/v1/threads/${answered.id}`, { token: other.token });
    assert.equal(seen.status, 200);
    assert.deepEqual(
      [seen.body.thread.author, seen.body.thread.isYou, seen.body.thread.body, seen.body.replies.map((row) => row.body)],
      [null, false, "What they asked.", ["Friend's answer."]]
    );
    const listed = (await threadsOf(other, room)).find((row) => row.id === answered.id);
    assert.deepEqual([listed.author, listed.isYou], [null, false]);
    // The community goes on, kept by its longest-standing member, its count right.
    const stored = await col("communities").findOne({ _id: oid(room.id) });
    assert.ok(stored.keeperId.equals(friend.id));
    assert.deepEqual([stored.memberIds.map(String), stored.memberCount, stored.threadCount], [[friend.id, other.id].map(String), 2, 2]);
    // And a reply can still be added under it.
    assert.equal((await call("POST", `/v1/threads/${answered.id}/replies`, { token: other.token, body: { body: "They left, sadly." } })).status, 201);
  });

  test("deleting the profile does the same", async () => {
    const me = await good();
    const friend = await good();
    const room = await community(me, [friend]);
    const answered = await thread(me, room);
    await reply(friend, answered);
    const post = await publicPost(friend);
    await react(me, "posts", post.id, -1);
    await publicPost(me);
    assert.equal((await call("DELETE", "/v1/profile/me", { token: me.token })).status, 200);
    assert.deepEqual(
      [await count("posts", { userId: me.id }), await count("reactions", { userId: me.id }), await count("communities", { memberIds: me.id })],
      [0, 0, 0]
    );
    assert.equal((await col("posts").findOne({ _id: oid(post.id) })).dislikes, 0);
    assert.equal((await col("threads").findOne({ _id: oid(answered.id) })).authorId, null);
  });
});

describe("closing what was left open", () => {
  test("a report always reaches the queue, but only a proven reader's counts towards hiding", async () => {
    const owner = await admin();
    const author = await good();
    const viewer = await plain();
    const post = await publicPost(author);
    const queue = async (id) => (await call("GET", "/v1/admin/reports", { token: owner.token })).body.reports.find((row) => row.id === id);
    const resolve = (id, action) => call("POST", "/v1/admin/resolve", { token: owner.token, body: { target: "post", id, action } });

    // Three readers old enough to report, none at a confirmed address: recorded, seen by the admin, and nothing happens.
    for (const who of [await unproven(), await unproven(), await unproven()]) {
      assert.deepEqual((await report(who, "post", post.id)).body, { reported: true });
    }
    assert.equal(await count("reports", { targetId: oid(post.id), counts: false }), 3);
    assert.equal(await inDiscover(viewer, post), true);
    assert.deepEqual([(await queue(post.id)).count, (await queue(post.id)).counting], [3, 0]);
    // Two who count beside them make two, not five...
    await report(await plain(), "post", post.id);
    await report(await plain({ visibility: "followers" }), "post", post.id);
    assert.equal(await inDiscover(viewer, post), true);
    // ...and the third who counts hides it. (A followers-only profile counts: it is the account that is weighed.)
    await report(await plain(), "post", post.id);
    assert.equal(await inDiscover(viewer, post), false);
    assert.deepEqual([(await queue(post.id)).count, (await queue(post.id)).counting], [6, 3]);
    // The same for a community's five and a spoiler's two.
    const room = await community(await good(), [await good(), await good()]);
    for (let index = 0; index < 5; index += 1) await report(await unproven(), "community", room.id);
    assert.equal((await call("GET", `/v1/communities/${room.id}`, { token: viewer.token })).body.community.listed, true);
    const marked = await publicPost(author);
    await report(await unproven(), "post", marked.id, "spoiler");
    await report(await unproven(), "post", marked.id, "spoiler");
    assert.equal((await col("posts").findOne({ _id: oid(marked.id) })).spoiler, false);

    // A reader whose reports keep being dismissed stops counting: five dismissed, none upheld.
    const crier = await plain();
    for (let index = 0; index < 5; index += 1) {
      const fine = await publicPost(author);
      await report(crier, "post", fine.id, "other");
      assert.equal((await col("reports").findOne({ targetId: oid(fine.id) })).counts, true, "counted until then");
      assert.equal((await resolve(fine.id, index % 2 ? "restore" : "dismiss")).status, 200);
    }
    const target = await publicPost(author);
    await report(await plain(), "post", target.id);
    await report(await plain(), "post", target.id);
    assert.deepEqual((await report(crier, "post", target.id)).body, { reported: true }, "told nothing of it");
    assert.equal((await col("reports").findOne({ targetId: oid(target.id), reporterId: crier.id })).counts, false);
    assert.equal(await inDiscover(viewer, target), true);
    // One report of theirs upheld, and they count again.
    const bad = await publicPost(author);
    await report(crier, "post", bad.id);
    assert.equal((await resolve(bad.id, "remove")).status, 200);
    const again = await publicPost(author);
    await report(await plain(), "post", again.id);
    await report(await plain(), "post", again.id);
    await report(crier, "post", again.id);
    assert.equal(await inDiscover(viewer, again), false);
    // And dismissals from long ago are not held against anyone.
    const reformed = await plain();
    await col("reports").insertMany(
      Array.from({ length: 6 }, () => ({
        target: "post", targetId: new ObjectId(), reporterId: reformed.id, reason: "other", note: null, counts: true,
        createdAt: new Date(Date.now() - 120 * DAY), resolvedAt: new Date(Date.now() - 100 * DAY), resolution: "dismiss"
      }))
    );
    const fresh = await publicPost(author);
    await report(reformed, "post", fresh.id);
    assert.equal((await col("reports").findOne({ targetId: oid(fresh.id) })).counts, true);
  });

  test("ten quotes a day beside the thirty a book, and a refused one uses nothing up", async () => {
    const me = await good();
    const quote = (bookKey) => call("POST", "/v1/posts", { token: me.token, body: { kind: "quote", title: "A Book", bookKey, quote: "A line." } });
    const key = unique("isbn");
    await tallied(me, "quote", 9);
    assert.equal((await quote(key)).status, 201);
    const refused = await quote(key);
    assert.equal(refused.status, 429);
    assert.match(refused.body.error, /10 quotes a day/);
    assert.ok(Number(refused.retryAfter) > 0);
    // From another book too: it is a day's quotes, from all books together.
    assert.equal((await quote(unique("isbn"))).status, 429);
    // What the refused ones took on the way was handed back: one post today, one quote from that book.
    assert.equal((await col("tallies").findOne({ userId: me.id, kind: "post" })).count, 1);
    assert.equal((await col("quoteTallies").findOne({ userId: me.id, bookRef: key })).count, 1);
    assert.equal(await count("quoteTallies", { userId: me.id }), 1);
    // Other kinds of post are not quotes.
    assert.equal((await call("POST", "/v1/posts", { token: me.token, body: { title: "Finished one" } })).status, 201);
    await nextDay(me, "quote");
    assert.equal((await quote(key)).status, 201);
    // A count is kept a few days and no longer.
    const kept = await col("tallies").findOne({ userId: me.id, kind: "post" });
    assert.ok(kept.expiresAt > new Date(Date.now() + 2 * DAY) && kept.expiresAt < new Date(Date.now() + 5 * DAY));
    const ttl = (await col("tallies").indexes()).find((index) => index.name === "expiry");
    assert.equal(ttl.expireAfterSeconds, 0);
    // The counts go with the account, and not before.
    await call("DELETE", "/v1/profile/me", { token: me.token });
    assert.ok((await count("tallies", { userId: me.id })) > 0);
    assert.equal((await call("DELETE", "/v1/account", { token: me.token, body: { password: PASSWORD } })).status, 200);
    assert.deepEqual([await count("tallies", { userId: me.id }), await count("quoteTallies", { userId: me.id })], [0, 0]);
  });

  test("the owner puts a community right: its name, its keeper, a ban, its place in the directory", async () => {
    const owner = await admin();
    const keeper = await good();
    const member = await good();
    const out = await good({ prefix: "out" });
    const room = await community(keeper, [member, out], { title: "Teh Wrnog Titel", author: "Nobody" });
    const looker = await plain();
    const fix = (body) => call("POST", "/v1/admin/community", { token: owner.token, body: { id: room.id, ...body } });
    const seen = async (who = looker) => (await call("GET", `/v1/communities/${room.id}`, { token: who.token })).body.community;

    const named = await fix({ title: "  The Right\nTitle ", author: "Somebody" });
    assert.equal(named.status, 200, JSON.stringify(named.body));
    assert.deepEqual(Object.keys(named.body), ["community"]);
    assert.deepEqual(Object.keys(named.body.community).sort(), Object.keys(room).sort(), "the same view as everywhere");
    assert.deepEqual(
      [named.body.community.title, named.body.community.author, named.body.community.memberCount, named.body.community.listed, named.body.community.isMember],
      ["The Right Title", "Somebody", 3, true, false]
    );
    // Only what is sent changes.
    assert.deepEqual([(await fix({ author: null })).body.community.author, (await seen()).title], [null, "The Right Title"]);
    assert.equal((await fix({})).status, 200);

    // A new keeper, from among the members.
    assert.equal((await fix({ keeper: `@${member.handle}` })).status, 200);
    assert.deepEqual([(await seen(member)).isKeeper, (await seen(keeper)).isKeeper, (await seen(keeper)).isMember], [true, false, true]);
    assert.equal((await fix({ keeper: looker.handle })).status, 409, "not a member");
    assert.equal((await fix({ keeper: "nobody-here" })).status, 404);

    // A ban lifted: they may join again (and have to).
    assert.equal((await call("POST", `/v1/communities/${room.id}/members/${out.handle}/remove`, { token: member.token })).status, 200);
    assert.equal((await call("POST", `/v1/communities/${room.id}/join`, { token: out.token })).status, 403);
    assert.equal((await fix({ unban: out.handle })).status, 200);
    assert.deepEqual((await col("communities").findOne({ _id: oid(room.id) })).bannedIds, []);
    assert.equal((await seen(out)).isMember, false);
    assert.equal((await call("POST", `/v1/communities/${room.id}/join`, { token: out.token })).status, 200);

    // Back into the directory after reports took it out; and out of it by the owner's own hand.
    for (let index = 0; index < 5; index += 1) await report(await plain(), "community", room.id);
    assert.equal((await seen()).listed, false);
    assert.equal((await fix({ relist: true })).body.community.listed, true);
    for (let index = 0; index < 5; index += 1) await report(await plain(), "community", room.id);
    assert.equal((await seen()).listed, true, "looked at: reports no longer act on it");
    assert.equal((await fix({ relist: false })).body.community.listed, false);
    assert.equal((await call("GET", "/v1/communities", { token: looker.token })).body.communities.some((row) => row.id === room.id), false);
    assert.equal((await fix({ relist: true })).body.community.listed, true);
    // It does not list what never was: that still takes three established members.
    const small = await community(await good());
    const forced = await call("POST", "/v1/admin/community", { token: owner.token, body: { id: small.id, relist: true } });
    assert.equal(forced.body.community.listed, false);

    for (const body of [{ title: "" }, { title: 5 }, { author: 5 }, { relist: "yes" }]) {
      assert.equal((await fix(body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call("POST", "/v1/admin/community", { token: owner.token, body: { id: "a".repeat(24), title: "x" } })).status, 404);
    assert.equal((await call("POST", "/v1/admin/community", { token: owner.token, body: { title: "x" } })).status, 404);
    // Not for a keeper, however much it is their community.
    assert.equal((await call("POST", "/v1/admin/community", { token: member.token, body: { id: room.id, title: "Mine" } })).status, 404);
    assert.equal((await seen()).title, "The Right Title");
  });

  test("a keeper removes ten members a day; the admin's removals are not counted", async () => {
    const owner = await admin();
    const keeper = await good();
    const room = await community(keeper);
    const remove = (who, target) => call("POST", `/v1/communities/${room.id}/members/${target.handle}/remove`, { token: who.token });
    assert.equal((await remove(keeper, await plain())).status, 200);
    assert.equal((await col("tallies").findOne({ userId: keeper.id, kind: "removal" })).count, 1);
    await tallied(keeper, "removal", 9);
    assert.equal((await remove(keeper, await plain())).status, 200);
    const eleventh = await plain();
    const refused = await remove(keeper, eleventh);
    assert.equal(refused.status, 429);
    assert.match(refused.body.error, /10 members a day/);
    assert.ok(Number(refused.retryAfter) > 0);
    assert.equal((await col("communities").findOne({ _id: oid(room.id) })).bannedIds.length, 2);
    // The owner is not held to it.
    assert.equal((await remove(owner, eleventh)).status, 200);
    assert.equal(await count("tallies", { userId: owner.id, kind: "removal" }), 0);
    await nextDay(keeper, "removal");
    assert.equal((await remove(keeper, await plain())).status, 200);
  });

  test("a suspension is remembered against the address, as a hash, and is waiting at the door", async () => {
    const owner = await admin();
    const email = `back-${randomBytes(5).toString("hex")}@example.com`;
    const signUp = async (address, at) => (await call("POST", "/v1/auth/signup", { body: { email: address, password: PASSWORD }, at })).body;
    const profile = async (token, handle) => (await call("PUT", "/v1/profile/me", { token, body: { handle, visibility: "public" } })).body;
    const first = await signUp(email);
    const handle = `back${randomBytes(4).toString("hex")}`;
    await profile(first.token, handle);
    const suspended = await call("POST", "/v1/admin/suspend", { token: owner.token, body: { handle, days: 5 } });
    assert.equal(suspended.status, 200);

    // What is kept is a keyed hash and a date. Never the address, nor any part of it.
    const kept = await col("suspensions").find({ accountId: oid(first.account.id) }).toArray();
    assert.equal(kept.length, 1);
    assert.match(kept[0]._id, /^[0-9a-f]{64}$/);
    assert.equal(kept[0].suspendedUntil.toISOString(), suspended.body.suspendedUntil);
    assert.deepEqual(Object.keys(kept[0]).sort(), ["_id", "accountId", "suspendedUntil"]);
    const dump = JSON.stringify(await col("suspensions").find({}).toArray());
    assert.equal(dump.includes(email) || dump.includes(email.split("@")[0]), false);
    // And it goes by itself the day the suspension ends.
    const ttl = (await col("suspensions").indexes()).find((index) => index.name === "expiry");
    assert.deepEqual([ttl.key, ttl.expireAfterSeconds], [{ suspendedUntil: 1 }, 0]);

    // The account deleted, and the same address signed up again (typed a little differently): still suspended.
    assert.equal((await call("DELETE", "/v1/account", { token: first.token, body: { password: PASSWORD } })).status, 200);
    assert.equal(await count("suspensions", { _id: kept[0]._id }), 1);
    const second = await signUp(`  ${email.toUpperCase()} `);
    assert.equal("suspendedUntil" in second.account, false, "the account's own view says nothing new");
    const again = await profile(second.token, handle);
    assert.equal(again.suspendedUntil, suspended.body.suspendedUntil);
    const back = { token: second.token, id: oid(second.account.id) };
    await confirmed(back);
    await aged(back, 30);
    await acceptRules(back);
    const refused = await call("POST", "/v1/posts", { token: back.token, body: { title: "Back again", audience: "everyone" } });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, /suspended from posting until/);
    assert.equal((await call("POST", "/v1/posts", { token: back.token, body: { title: "Back again" } })).status, 403);
    // Somebody else's address is nobody's business.
    const other = await signUp(`other-${randomBytes(5).toString("hex")}@example.com`);
    assert.equal((await profile(other.token, `oth${randomBytes(4).toString("hex")}`)).suspendedUntil, null);

    // Lifted for the new account, it is forgotten: a third sign-up starts clean.
    assert.equal((await call("POST", "/v1/admin/suspend", { token: owner.token, body: { handle, days: 0 } })).body.suspendedUntil, null);
    assert.equal(await count("suspensions", { _id: kept[0]._id }), 0);
    assert.equal((await call("POST", "/v1/posts", { token: back.token, body: { title: "Back again", audience: "everyone" } })).status, 201);
    await call("DELETE", "/v1/account", { token: back.token, body: { password: PASSWORD } });
    const third = await signUp(email);
    assert.equal((await profile(third.token, handle)).suspendedUntil, null);

    // Changing an account's address to a suspended one brings the suspension with it. (Changing an
    // address sends a code, so this needs a server with a mailer; the same database.)
    const mailed = [];
    const withMail = createApp(db, { mailer: async (message) => mailed.push(message), limits: { ip: { limit: 1000, windowMs: MINUTE }, signup: { limit: 1000, windowMs: MINUTE } } });
    const listening = await new Promise((resolve) => {
      const started = withMail.listen(0, "127.0.0.1", () => resolve(started));
    });
    try {
      const at = `http://127.0.0.1:${listening.address().port}`;
      const gone = `gone-${randomBytes(5).toString("hex")}@example.com`;
      const banned = await signUp(gone, at);
      const bannedHandle = `gone${randomBytes(4).toString("hex")}`;
      await profile(banned.token, bannedHandle);
      const until = (await call("POST", "/v1/admin/suspend", { token: owner.token, body: { handle: bannedHandle, days: 9 } })).body.suspendedUntil;
      await call("DELETE", "/v1/account", { token: banned.token, body: { password: PASSWORD } });
      // An account they had ready, under another address, takes the old one over.
      const spare = await signUp(`spare-${randomBytes(5).toString("hex")}@example.com`, at);
      const spareHandle = `spare${randomBytes(4).toString("hex")}`;
      assert.equal((await profile(spare.token, spareHandle)).suspendedUntil, null);
      const changed = await call("POST", "/v1/account/email", { token: spare.token, body: { password: PASSWORD, email: gone }, at });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      assert.equal((await call("GET", "/v1/profile/me", { token: spare.token })).body.suspendedUntil, until);
      // And a suspended reader who moves to a new address is remembered there as well.
      const moved = `moved-${randomBytes(5).toString("hex")}@example.com`;
      assert.equal((await call("POST", "/v1/account/email", { token: spare.token, body: { password: PASSWORD, email: moved }, at })).status, 200);
      await call("DELETE", "/v1/account", { token: spare.token, body: { password: PASSWORD }, at });
      const fresh = await signUp(moved, at);
      assert.equal((await profile(fresh.token, spareHandle)).suspendedUntil, until);
    } finally {
      await new Promise((resolve) => listening.close(resolve));
    }
  });

  test("a reader the viewer has blocked, and one who has blocked the viewer, by handle", async () => {
    const me = await plain();
    const open = await plain();
    const quiet = await plain({ visibility: "followers" });
    await call("POST", `/v1/blocks/${open.handle}`, { token: me.token });
    await call("POST", `/v1/blocks/${quiet.handle}`, { token: me.token });
    // One the viewer blocked: their card as ever, saying so. A followers-only one is the locked card, saying so too.
    const card = await call("GET", `/v1/profile/${open.handle}`, { token: me.token });
    assert.deepEqual([card.status, card.body.locked, card.body.youBlocked, card.body.isFollowing], [200, false, true, false]);
    const locked = await call("GET", `/v1/profile/${quiet.handle}`, { token: me.token });
    assert.deepEqual([locked.status, locked.body.locked, locked.body.youBlocked], [200, true, true]);
    // To anyone else the locked card is as it always was, with no such field.
    assert.equal("youBlocked" in (await call("GET", `/v1/profile/${quiet.handle}`, { token: open.token })).body, false);
    assert.equal("youBlocked" in (await call("GET", `/v1/profile/${quiet.handle}`)).body, false);
    // One who blocked the viewer: not there, in the words used for a handle nobody has.
    const gone = await call("GET", `/v1/profile/${me.handle}`, { token: open.token });
    const never = await call("GET", "/v1/profile/nobody-at-all", { token: open.token });
    assert.deepEqual([gone.status, gone.body], [404, never.body]);
    assert.deepEqual(gone.body, { error: "No shared profile with that handle." });
    // Signed out, a public card is public.
    assert.equal((await call("GET", `/v1/profile/${me.handle}`)).status, 200);
  });
});

describe("who may call what", () => {
  test("every new signed-in route refuses a missing or made-up token", async () => {
    const id = "a".repeat(24);
    const routes = [
      ["POST", "/v1/rules/accept"],
      ["POST", `/v1/posts/${id}/react`, { value: 1 }],
      ["GET", "/v1/discover"],
      ["GET", "/v1/books/posts?key=x"],
      ["POST", "/v1/communities", { kind: "book", key: "x", title: "x" }],
      ["GET", "/v1/communities"],
      ["GET", "/v1/communities/find?kind=book&key=x"],
      ["GET", `/v1/communities/${id}`],
      ["POST", `/v1/communities/${id}/join`],
      ["POST", `/v1/communities/${id}/leave`],
      ["POST", `/v1/communities/${id}/members/someone/remove`],
      ["GET", `/v1/communities/${id}/threads`],
      ["POST", `/v1/communities/${id}/threads`, { title: "x", body: "y" }],
      ["GET", `/v1/threads/${id}`],
      ["POST", `/v1/threads/${id}/replies`, { body: "y" }],
      ["DELETE", `/v1/threads/${id}`],
      ["DELETE", `/v1/replies/${id}`],
      ["POST", `/v1/threads/${id}/pin`, { pinned: true }],
      ["POST", `/v1/threads/${id}/react`, { value: 1 }],
      ["POST", `/v1/replies/${id}/react`, { value: 1 }],
      ["POST", "/v1/reports", { target: "post", id, reason: "spam" }],
      ["POST", "/v1/blocks/someone"],
      ["DELETE", "/v1/blocks/someone"],
      ["GET", "/v1/blocks"],
      ["GET", "/v1/admin/reports"],
      ["POST", "/v1/admin/resolve", { target: "post", id, action: "dismiss" }],
      ["POST", "/v1/admin/suspend", { handle: "someone", days: 1 }],
      ["GET", "/v1/admin/settings"],
      ["PUT", "/v1/admin/settings", { publicPosting: true }],
      ["POST", "/v1/admin/community", { id }]
    ];
    for (const [method, path, body] of routes) {
      for (const token of [undefined, "x".repeat(43)]) {
        const answer = await call(method, path, { token, body });
        assert.equal(answer.status, 401, `${method} ${path} with ${token ? "a bad token" : "no token"}`);
      }
    }
  });
});
