// How the API holds up with a couple of hundred apps open: seeds readers into
// a throwaway database on this machine, replays an hour of what open apps
// send, squeezed into a minute or two, and says what it cost.
//
//   node scripts/load.mjs                      200 readers, an hour in 120 s
//   node scripts/load.mjs --users 200 --seconds 120 --background 2000
//   node scripts/load.mjs --latency 40         every trip to the database 40 ms longer
//   node scripts/load.mjs --pool 5             the server's MONGO_MAX_POOL
//   node scripts/load.mjs --span 20 --seconds 300   the hour's first 20 minutes, at four times the pace
//   node scripts/load.mjs --app 1.5.12         what that version of the app sends (below)
//
// `--app`: which app's publishes are replayed. 1.5.10 (the default, as every
// figure here was measured before 1.5.12) sends the whole profile every
// time, a minute read or not; 1.5.11 sends nothing when nothing moved, and
// the whole profile when anything did; 1.5.12 sends only the figures that
// moved (a minute read: the minutes and their week).
//
// What it prints: each request's database operations and the plan each took
// (any collection scan is marked), p50/p95 latency by request, the most
// connections the database saw from the server, the server's memory at its
// highest, and what the seeded readers weigh in the database.
//
// The server runs as a child of this script, through the same `connect` and
// `createApp` the real one uses, with the real limits. Nothing here touches
// a database that is not on this machine, whatever the environment says.
import { fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer as createTcpServer, connect as tcpConnect } from "node:net";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const source = (file) => import(new URL(`../src/${file}`, import.meta.url).href);
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] !== undefined ? Number(process.argv[at + 1]) : fallback;
};

// ---- the server, as a child ---------------------------------------------------------------

if (process.argv.includes("--serve")) {
  const { createApp } = await source("app.js");
  const { connect, close } = await source("db.js");
  const db = await connect(process.env.LOAD_MONGO_URI, process.env.LOAD_MONGO_DB);
  const app = createApp(db);
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const server = app.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
  process.on("message", async (message) => {
    if (message === "stats") {
      const memory = process.memoryUsage();
      process.send({ rss: memory.rss, heap: memory.heapUsed, lagP99: lag.percentile(99) / 1e6 });
    } else if (message === "stop") {
      server.close();
      server.closeAllConnections?.();
      await close().catch(() => undefined);
      process.exit(0);
    }
  });
  await new Promise(() => undefined);
}

// ---- the load ---------------------------------------------------------------------------------

const USERS = option("users", 200);
const SECONDS = option("seconds", 120);
const BACKGROUND = option("background", 2000);
const LATENCY = option("latency", 0);
const POOL = option("pool", 0);
const APP = (() => {
  const at = process.argv.indexOf("--app");
  return at > 0 ? String(process.argv[at + 1]) : "1.5.10";
})();
if (!["1.5.10", "1.5.11", "1.5.12"].includes(APP)) {
  console.error("load: --app is 1.5.10, 1.5.11 or 1.5.12.");
  process.exit(1);
}
/** How much of an hour of open apps is replayed, in seconds: all of it unless `--span` (minutes) says less. */
const HOUR = Math.min(60, Math.max(1, option("span", 60))) * 60;
/** Seconds of what is replayed to a second of the clock. */
const SQUEEZE = HOUR / SECONDS;

const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(uri)) {
  console.error("load: TEST_MONGO_URI must be a MongoDB on this machine.");
  process.exit(1);
}
const { MongoClient, Binary, ObjectId } = await import("mongodb");
const { isoWeekKey } = await source("week.js");
const { hashPassword } = await source("passwords.js");

const dbName = `leaflet_load_${randomBytes(4).toString("hex")}`;
const mongo = new MongoClient(uri, { maxPoolSize: 4, appName: "leaflet-load" });
await mongo.connect();
const db = mongo.db(dbName);
const admin = mongo.db("admin");
// The connections the server holds, counted by the name its client gives
// (the pool's and the driver's own monitoring), idle ones included.
const connectionsNow = async () =>
  (await admin.aggregate([{ $currentOp: { allUsers: true, idleConnections: true } }, { $match: { appName: "leaflet-api" } }, { $count: "open" }]).toArray())[0]?.open ?? 0;
const opsNow = async () => {
  const { opcounters } = await admin.command({ serverStatus: 1 });
  return opcounters.insert + opcounters.query + opcounters.update + opcounters.delete + opcounters.getmore + opcounters.command;
};

// A trip to the database made longer, to stand in for a cluster that is not
// on this machine: every packet is held half the time each way.
let mongoPort = Number(new URL(uri).port || 27017);
let proxy = null;
if (LATENCY > 0) {
  proxy = createTcpServer((near) => {
    const far = tcpConnect(mongoPort, "127.0.0.1");
    const late = (to) => (chunk) => setTimeout(() => to.writable && to.write(chunk), LATENCY / 2);
    near.on("data", late(far));
    far.on("data", late(near));
    const end = () => {
      near.destroy();
      far.destroy();
    };
    near.on("close", end).on("error", end);
    far.on("close", end).on("error", end);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
}
const serverUri = LATENCY > 0 ? `mongodb://127.0.0.1:${proxy.address().port}/?directConnection=true` : uri;

const now = new Date();
const DAY = 24 * 60 * 60 * 1000;
const today = now.toISOString().slice(0, 10);
const week = isoWeekKey(now);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const pick = (list, n) => list[n % list.length];
const TITLES = ["The Long Way Round", "A Field Guide to Rain", "Salt and Lanterns", "The Orchard at Night", "Small Hours", "The Cartographer's Daughter", "Northing", "A Quiet Sort of Storm"];

/** A camp as large as the app sends one, already as the server keeps it. */
const camp = (n) => ({
  levels: { burrow: 5, oak: 4, store: 4, fence: 5, tower: 3, hut: 3 },
  yard: [{ kind: "workshop", level: 3 }, { kind: "hive", level: 2 }],
  camps: 40 + (n % 50),
  banners: 6,
  trophies: 30 + (n % 40),
  spots: { burrow: [120, 90], oak: [44, 76], store: [176, 70], tower: [200, 100], hut: [64, 104], yard0: [150, 108], yard1: [96, 66] },
  walls: Array.from({ length: 24 }, (_, piece) => [10 + piece * 9, 110]),
  decor: Array.from({ length: 18 }, (_, thing) => ({ kind: thing % 18, x: 10 + thing * 12, y: 60 + (thing % 5) * 10 })),
  land: Array.from({ length: 22 }, (_, piece) => ({ kind: piece % 10, x: 8 + piece * 10, y: 50 + (piece % 6) * 11 })),
  works: Array.from({ length: 8 }, (_, work) => ({ kind: work, x: 30 + work * 25, y: 100 })),
  guards: [3, 2, 2, 1, 1, 2, 3],
  posts: [[200, 100], [100, 104], [30, 80], [130, 96], null, [160, 110], [60, 108]]
});

/** What an app publishes of a reader's reading: the body of its `PUT /v1/profile/me`. */
const figures = (n, minutes) => ({
  weekKey: week,
  weekMinutes: minutes,
  streak: 3 + (n % 40),
  booksFinished: 5 + (n % 60),
  shelf: Array.from({ length: 8 }, (_, book) => ({ title: pick(TITLES, n + book), author: null, styleSeed: `seed-${n}-${book}` })),
  readDay: today,
  reading: { title: pick(TITLES, n), author: "Ann Author", percent: n % 100 },
  level: 4 + (n % 30),
  badges: Array.from({ length: 14 }, (_, badge) => `badge-${badge}`),
  arcade: { dash: 1200 + n, catch: 300 + n, flap: 40 + (n % 50) },
  camp: camp(n)
});

console.log(`load: seeding ${USERS} readers and ${BACKGROUND} more who are not here today, into ${dbName}`);
const readers = [];
const realHash = await hashPassword("load-test-password");
for (let n = 0; n < USERS + BACKGROUND; n += 1) {
  const active = n < USERS;
  const token = active ? randomBytes(32).toString("base64url") : null;
  readers.push({
    n,
    id: new ObjectId(),
    active,
    handle: active ? `reader${n}` : `away${n}`,
    token,
    visibility: n % 10 === 9 ? "private" : n % 10 === 8 ? "followers" : "public",
    minutes: 30 + (n % 400),
    address: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`
  });
}
const active = readers.filter((reader) => reader.active);

// The server first, so the indexes are the ones it makes at start.
// With the heap the deployed unit gives it (NODE_OPTIONS in deploy/leaflet-api.service).
const child = fork(fileURLToPath(import.meta.url), ["--serve"], {
  execArgv: ["--max-old-space-size=128"],
  env: { ...process.env, LOAD_MONGO_URI: serverUri, LOAD_MONGO_DB: dbName, ...(POOL ? { MONGO_MAX_POOL: String(POOL) } : {}) },
  stdio: ["ignore", "inherit", "inherit", "ipc"]
});
const listeners = new Set();
child.on("message", (message) => listeners.forEach((listener) => listener(message)));
const told = (wanted) =>
  new Promise((resolve) => {
    const listener = (message) => {
      if (wanted(message)) {
        listeners.delete(listener);
        resolve(message);
      }
    };
    listeners.add(listener);
  });
const { port } = await told((message) => typeof message.port === "number");
const base = `http://127.0.0.1:${port}`;
const serverStats = async () => {
  const answer = told((message) => typeof message.rss === "number");
  child.send("stats");
  return answer;
};

const many = async (name, docs) => {
  for (let at = 0; at < docs.length; at += 2000) {
    await db.collection(name).insertMany(docs.slice(at, at + 2000), { ordered: false });
  }
};
await many(
  "accounts",
  readers.map((reader) => ({
    _id: reader.id,
    email: `${reader.handle}@example.test`,
    passwordHash: realHash,
    displayName: `Reader ${reader.n}`,
    avatar: null,
    createdAt: new Date(now - 90 * DAY),
    emailConfirmedAt: new Date(now - 89 * DAY)
  }))
);
await many(
  "sessions",
  active.map((reader) => ({ _id: sha(reader.token), userId: reader.id, createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + 90 * DAY) }))
);
await many(
  "profiles",
  readers.map((reader) => ({
    _id: reader.id,
    handle: reader.handle,
    displayName: `Reader ${reader.n}`,
    visibility: reader.visibility,
    avatar: null,
    updatedAt: now,
    ...(reader.visibility === "private" ? {} : figures(reader.n, reader.minutes))
  }))
);
// Friends: each active reader and the seven either side follow each other, so
// everyone has fourteen friends; and each follows five readers who are away.
const follows = [];
for (const reader of active) {
  for (let step = 1; step <= 7; step += 1) {
    follows.push({ followerId: reader.id, followeeId: active[(reader.n + step) % USERS].id, createdAt: now });
    follows.push({ followerId: reader.id, followeeId: active[(reader.n - step + USERS) % USERS].id, createdAt: now });
  }
  for (let step = 0; step < 5 && BACKGROUND > 0; step += 1) {
    follows.push({ followerId: reader.id, followeeId: readers[USERS + ((reader.n * 7 + step) % BACKGROUND)].id, createdAt: now });
  }
}
await many("follows", follows);
// What a reader leaves behind in a month or two of use: the sync document
// (two in five back their reading up here), a shared library (one in five),
// inbox events, kudos, raids, gifts, posts.
await many(
  "states",
  readers.filter((reader) => reader.n % 5 < 2).map((reader) => ({ _id: reader.id, state: new Binary(randomBytes(15 * 1024)), version: 3, updatedAt: now }))
);
await many(
  "libraries",
  readers
    .filter((reader) => reader.n % 5 === 0 && reader.visibility !== "private")
    .map((reader) => ({
      _id: reader.id,
      updatedAt: now,
      books: Array.from({ length: 300 }, (_, book) => ({ key: `${pick(TITLES, book).toLowerCase()}|ann author|${book}`, title: pick(TITLES, book), author: "Ann Author", state: book % 3 ? "reading" : "finished", percent: book % 100 }))
    }))
);
const friend = (reader, step) => active[(reader.n + step) % USERS];
await many(
  "events",
  active.flatMap((reader) => Array.from({ length: 20 }, (_, event) => ({ userId: reader.id, type: event % 2 ? "kudos" : "follow", actorId: friend(reader, 1 + (event % 7)).id, refId: null, createdAt: new Date(now - event * 2 * DAY) })))
);
await many(
  "kudos",
  active.flatMap((reader) => Array.from({ length: 5 }, (_, day) => ({ fromId: friend(reader, 1 + day).id, toId: reader.id, dayKey: new Date(now - (day + 1) * DAY).toISOString().slice(0, 10), weekKey: week, createdAt: new Date(now - (day + 1) * DAY) })))
);
await many(
  "raids",
  active.flatMap((reader) =>
    Array.from({ length: 10 }, (_, raid) => ({ fromId: friend(reader, 1 + (raid % 7)).id, toId: reader.id, by: friend(reader, 1 + (raid % 7)).handle, name: "A friend", stars: raid % 4, day: new Date(now - (raid + 1) * DAY).toISOString().slice(0, 10), createdAt: new Date(now - (raid + 1) * DAY), seenAt: raid === 0 && reader.n % 10 === 0 ? null : now }))
  )
);
await many(
  "gifts",
  active.flatMap((reader) => Array.from({ length: 3 }, (_, gift) => ({ fromId: friend(reader, 2 + gift).id, toId: reader.id, kind: "accessory", itemId: "top_hat", createdAt: new Date(now - (gift + 2) * DAY), claimedAt: gift === 0 && reader.n % 20 === 0 ? null : new Date(now - DAY) })))
);
await many(
  "posts",
  readers
    .filter((reader) => reader.visibility !== "private")
    .flatMap((reader) =>
      Array.from({ length: reader.active ? 10 : 1 }, (_, post) => ({
        userId: reader.id,
        kind: post % 3 ? "finished" : "review",
        title: pick(TITLES, reader.n + post),
        author: "Ann Author",
        bookKey: `${pick(TITLES, reader.n + post).toLowerCase()}|ann author`,
        bookRef: `${pick(TITLES, reader.n + post).toLowerCase()}|ann author|${post}`,
        text: "A review of a few hundred characters. ".repeat(8),
        rating: 1 + (post % 5),
        audience: post % 2 ? "everyone" : "followers",
        likes: post,
        dislikes: 0,
        score: post,
        hiddenAt: null,
        createdAt: new Date(now - post * 3 * DAY - reader.n * 1000)
      }))
    )
);

// ---- requests ---------------------------------------------------------------------------------

const timings = new Map();
const statuses = new Map();
let failures = 0;
async function call(reader, label, method, path, body = undefined) {
  const started = performance.now();
  let status = 0;
  let json = null;
  try {
    const response = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${reader.token}`, "x-forwarded-for": reader.address, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    status = response.status;
    json = await response.json().catch(() => null);
  } catch {
    failures += 1;
  }
  const took = performance.now() - started;
  if (!timings.has(label)) {
    timings.set(label, []);
  }
  timings.get(label).push(took);
  statuses.set(`${label} ${status}`, (statuses.get(`${label} ${status}`) ?? 0) + 1);
  return { status, json };
}

const requests = {
  inbox: (reader) => call(reader, "GET /v1/inbox", "GET", "/v1/inbox"),
  publishSame: (reader) => call(reader, "PUT /v1/profile/me (nothing new)", "PUT", "/v1/profile/me", figures(reader.n, reader.minutes)),
  publishNew: (reader) => {
    reader.minutes += 1;
    return call(reader, "PUT /v1/profile/me (a minute read)", "PUT", "/v1/profile/me", figures(reader.n, reader.minutes));
  },
  // What 1.5.12 sends for a minute read: the minutes, with their week.
  publishMinutes: (reader) => {
    reader.minutes += 1;
    return call(reader, "PUT /v1/profile/me (a minute, 1.5.12)", "PUT", "/v1/profile/me", { weekKey: week, weekMinutes: reader.minutes });
  },
  following: (reader) => call(reader, "GET /v1/leaderboard?scope=following", "GET", `/v1/leaderboard?scope=following&week=${week}`),
  everyone: (reader) => call(reader, "GET /v1/leaderboard", "GET", `/v1/leaderboard?week=${week}`),
  gifts: (reader) => call(reader, "GET /v1/gifts", "GET", "/v1/gifts"),
  duels: (reader) => call(reader, "GET /v1/duels", "GET", "/v1/duels"),
  me: (reader) => call(reader, "GET /v1/auth/me", "GET", "/v1/auth/me"),
  mine: (reader) => call(reader, "GET /v1/profile/me", "GET", "/v1/profile/me"),
  blocks: (reader) => call(reader, "GET /v1/blocks", "GET", "/v1/blocks"),
  visitors: (reader) => call(reader, "GET /v1/visitors", "GET", `/v1/visitors?day=${today}&week=${week}`),
  raids: (reader) => call(reader, "GET /v1/raids", "GET", "/v1/raids"),
  targets: (reader) => call(reader, "GET /v1/raids/targets", "GET", "/v1/raids/targets"),
  raid: (reader) => call(reader, "POST /v1/raids", "POST", "/v1/raids", { to: friend(reader, 3).handle, stars: 2 }),
  card: (reader) => call(reader, "GET /v1/profile/:handle", "GET", `/v1/profile/${friend(reader, 2).handle}?week=${week}&day=${today}`),
  feed: (reader) => call(reader, "GET /v1/feed", "GET", "/v1/feed"),
  book: (reader) => call(reader, "GET /v1/books/posts", "GET", `/v1/books/posts?key=${encodeURIComponent(`${pick(TITLES, reader.n).toLowerCase()}|ann author`)}`),
  kudos: (reader) => call(reader, "POST /v1/kudos/:handle", "POST", `/v1/kudos/${friend(reader, 4).handle}`, { dayKey: today, weekKey: week }),
  search: (reader) => call(reader, "GET /v1/search", "GET", `/v1/search?q=reader${reader.n % 10}&week=${week}`),
  unfollow: (reader) => call(reader, "DELETE /v1/follows/:handle", "DELETE", `/v1/follows/${readers[USERS + ((reader.n * 7) % Math.max(1, BACKGROUND))]?.handle ?? "nobody-here"}`),
  communities: (reader) => call(reader, "GET /v1/communities", "GET", "/v1/communities"),
  // As an app that keeps the copy it last wrote or read: it names that
  // version, and is sent the document only when another device wrote since.
  sync: async (reader) => {
    const pulled = await call(reader, "GET /v1/state", "GET", `/v1/state${reader.stateVersion ? `?have=${reader.stateVersion}` : ""}`);
    const pushed = await call(reader, "PUT /v1/state", "PUT", "/v1/state", { version: pulled.json?.version ?? 0, state: randomBytes(15 * 1024).toString("base64") });
    reader.stateVersion = pushed.json?.version;
  }
};

// Each reader's profile as their app would have left it (so that a save that
// says nothing new really does say nothing new), and their session known.
for (let at = 0; at < active.length; at += 20) {
  await Promise.all(active.slice(at, at + 20).map((reader) => (reader.visibility === "private" ? requests.gifts(reader) : requests.publishSame(reader))));
}
timings.clear();
statuses.clear();

// ---- what each request costs the database ---------------------------------------------------

await db.createCollection("system.profile", { capped: true, size: 64 * 1024 * 1024 }).catch(() => undefined);
await db.command({ profile: 2 });
const profile = db.collection("system.profile");
const served = { appName: "leaflet-api" };
const costs = [];
/** What came back from the database for one request of each kind, by the name it is timed under. */
const bytesBack = new Map();
const sample = active.find((reader) => reader.visibility === "public" && reader.n % 5 === 0 && reader.n % 10 === 0) ?? active[0];
for (const [name, send] of Object.entries(requests)) {
  const before = await profile.countDocuments(served);
  timings.clear();
  const { status } = (await send(sample)) ?? { status: 200 };
  const operations = await profile.find(served, { sort: { ts: 1 }, skip: before }).toArray();
  // (A sync is two requests, timed apart: what came back is shared between them.)
  for (const label of timings.keys()) {
    bytesBack.set(label, operations.reduce((sum, entry) => sum + (entry.responseLength ?? 0), 0) / timings.size);
  }
  costs.push({
    name,
    status,
    operations: operations.length,
    plans: operations.map((entry) => ({
      on: String(entry.ns).split(".").slice(1).join("."),
      plan: entry.planSummary ?? entry.op,
      keys: entry.keysExamined ?? 0,
      docs: entry.docsExamined ?? 0,
      out: entry.nreturned ?? entry.nMatched ?? entry.ninserted ?? 0,
      bytes: entry.responseLength ?? 0
    }))
  });
}
await db.command({ profile: 0 });
timings.clear();
statuses.clear();

console.log("\nWhat each request asks of the database (the session is already known: add one lookup a minute an account)");
for (const cost of costs) {
  const scans = cost.plans.filter((plan) => /COLLSCAN/.test(plan.plan));
  const read = cost.plans.reduce((sum, plan) => sum + plan.docs, 0);
  const keys = cost.plans.reduce((sum, plan) => sum + plan.keys, 0);
  const bytes = cost.plans.reduce((sum, plan) => sum + plan.bytes, 0);
  console.log(`  ${cost.name.padEnd(12)} ${String(cost.status).padEnd(4)} ${String(cost.operations).padStart(2)} operations, ${String(keys).padStart(4)} keys, ${String(read).padStart(4)} documents, ${String(bytes).padStart(7)} bytes back${scans.length ? `   !! COLLSCAN on ${scans.map((plan) => plan.on).join(", ")}` : ""}`);
  if (process.argv.includes("--plans")) {
    for (const plan of cost.plans) {
      console.log(`      ${plan.on}: ${plan.plan} (keys ${plan.keys}, documents ${plan.docs}, returned ${plan.out})`);
    }
  }
}

// ---- an hour of open apps, squeezed ---------------------------------------------------------

// What a reader's app is doing this hour. The intervals are the app's own
// (apps/src: the pulse every 5 minutes, the board's refresh and the reading
// ledger's publish every minute, visitors every 10).
const doing = (reader) => (reader.n % 20 < 10 ? "idle" : reader.n % 20 < 15 ? "reading" : reader.n % 20 < 18 ? "board" : "camp");
const every = (seconds, phase, run) => Array.from({ length: Math.ceil((HOUR - phase) / seconds) }, (_, turn) => ({ at: phase + turn * seconds, run }));
const plan = [];
const tally = { idle: 0, reading: 0, board: 0, camp: 0 };
for (const reader of active) {
  const what = doing(reader);
  tally[what] += 1;
  const shared = reader.visibility !== "private";
  // 1.5.11 and 1.5.12 send nothing when nothing moved; 1.5.12 sends a minute alone.
  const publishSame = shared && APP === "1.5.10" ? requests.publishSame : async () => undefined;
  const publishNew = shared ? (APP === "1.5.12" ? requests.publishMinutes : requests.publishNew) : async () => undefined;
  const phase = (reader.n * 7919) % 300;
  const steps = [];
  // The pulse, on every tab: the inbox, a publish, the board of the readers followed, gifts.
  steps.push(...every(300, phase, async () => {
    await requests.inbox(reader);
    await (what === "idle" || what === "board" ? publishSame(reader) : publishNew(reader));
    await requests.following(reader);
    await requests.gifts(reader);
  }));
  if (what === "reading" || what === "camp") {
    // A minute credited to the ledger is a publish; twice in the hour a session ends.
    steps.push(...every(what === "reading" ? 60 : 120, phase % 60, () => publishNew(reader)));
    for (const at of [900 + phase, 2700 + phase]) {
      steps.push({ at, run: async () => {
        await publishNew(reader);
        await requests.following(reader);
        await requests.duels(reader);
      } });
    }
    // Two readers in five back their reading up here: a sync after a book is closed or a line marked.
    if (reader.n % 5 < 2) {
      steps.push(...every(900, phase * 2, async () => {
        await requests.sync(reader);
        await publishNew(reader);
      }));
    }
  }
  if (what === "board") {
    steps.push({ at: phase % 60, run: async () => {
      await requests.me(reader);
      await requests.mine(reader);
      await requests.blocks(reader);
    } });
    steps.push(...every(60, phase % 60, async () => {
      await publishSame(reader);
      await (reader.n % 2 ? requests.everyone(reader) : requests.following(reader));
      await requests.duels(reader);
    }));
  }
  if (what === "camp") {
    steps.push(...every(600, phase, () => requests.visitors(reader)));
    steps.push({ at: phase, run: () => requests.raids(reader) }, { at: 1800 + phase, run: () => requests.raids(reader) });
    steps.push({ at: 600 + phase, run: async () => {
      await requests.targets(reader);
      await requests.mine(reader);
      await requests.raid(reader);
    } });
  }
  // Now and then, whatever the tab: a friend's card, the feed, a book's page, kudos, a search.
  if (reader.n % 3 === 0) {
    steps.push({ at: 400 + phase * 3, run: () => requests.card(reader) }, { at: 2000 + phase * 3, run: () => requests.card(reader) });
  }
  if (reader.n % 5 === 1) {
    steps.push({ at: 1200 + phase, run: async () => {
      await requests.feed(reader);
      await requests.book(reader);
    } });
  }
  if (reader.n % 10 === 3 && shared) {
    steps.push({ at: 1500 + phase, run: () => requests.kudos(reader) });
  }
  if (reader.n % 20 === 7) {
    steps.push({ at: 2200 + phase, run: () => requests.search(reader) }, { at: 2300 + phase, run: () => requests.communities(reader) });
  }
  plan.push(...steps.filter((step) => step.at < HOUR));
}
plan.sort((a, b) => a.at - b.at);

console.log(`\nload: the app's publishes as ${APP} makes them`);
console.log(`load: ${USERS} apps open (${tally.idle} idle, ${tally.reading} reading, ${tally.board} on the board, ${tally.camp} in the camp): ${HOUR / 60} minutes of them in ${SECONDS} s, which is ${SQUEEZE.toFixed(0)} times as fast as they really go`);
let peakConnections = 0;
let peakRss = 0;
let peakHeap = 0;
let lagP99 = 0;
let samples = 0;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const [connections, stats] = await Promise.all([connectionsNow(), serverStats()]);
    samples += 1;
    peakConnections = Math.max(peakConnections, connections);
    peakRss = Math.max(peakRss, stats.rss);
    peakHeap = Math.max(peakHeap, stats.heap);
    lagP99 = stats.lagP99;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
})();
const idleStats = await serverStats();
const idleConnections = await connectionsNow();
const opsBefore = await opsNow();
const startedAt = performance.now();
const running = [];
for (const step of plan) {
  const due = startedAt + (step.at / SQUEEZE) * 1000;
  const wait = due - performance.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  running.push(step.run().catch(() => { failures += 1; }));
}
await Promise.all(running);
const elapsed = (performance.now() - startedAt) / 1000;
const opsAfter = await opsNow();
sampling = false;
await sampler;

// A burst of sign-ins, each a 32 MiB password hash: what it does to the server's memory.
const beforeBurst = await serverStats();
let burstRss = 0;
const watching = setInterval(async () => { burstRss = Math.max(burstRss, (await serverStats()).rss); }, 20);
const signIns = await Promise.all(
  active.slice(0, 24).map(async (reader) => {
    const started = performance.now();
    const response = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": reader.address }, body: JSON.stringify({ email: `${reader.handle}@example.test`, password: "load-test-password" }) });
    await response.text();
    return { status: response.status, took: performance.now() - started };
  })
);
clearInterval(watching);
burstRss = Math.max(burstRss, (await serverStats()).rss);

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const all = [];
console.log("\nLatency, in milliseconds, as this script saw it");
console.log(`  ${"request".padEnd(40)} ${"count".padStart(6)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)}`);
for (const [label, took] of [...timings.entries()].sort((a, b) => b[1].length - a[1].length)) {
  took.sort((a, b) => a - b);
  all.push(...took);
  console.log(`  ${label.padEnd(40)} ${String(took.length).padStart(6)} ${percentile(took, 50).toFixed(1).padStart(7)} ${percentile(took, 95).toFixed(1).padStart(7)} ${took.at(-1).toFixed(1).padStart(7)}`);
}
all.sort((a, b) => a - b);
const refused = [...statuses.entries()].filter(([key]) => !/ (200|201)$/.test(key));
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
console.log(`  ${"all".padEnd(40)} ${String(all.length).padStart(6)} ${percentile(all, 50).toFixed(1).padStart(7)} ${percentile(all, 95).toFixed(1).padStart(7)} ${all.at(-1).toFixed(1).padStart(7)}`);
console.log(`\n${all.length} requests in ${elapsed.toFixed(0)} s: ${(all.length / elapsed).toFixed(0)} a second here, ${(all.length / HOUR).toFixed(1)} a second at the apps' real pace (${(all.length / HOUR * 60).toFixed(0)} a minute)`);
console.log(`database operations: ${opsAfter - opsBefore - samples} in all, ${((opsAfter - opsBefore - samples) / all.length).toFixed(2)} a request, ${((opsAfter - opsBefore - samples) / elapsed).toFixed(0)} a second here, ${((opsAfter - opsBefore - samples) / HOUR).toFixed(1)} a second at the real pace`);
const megabytesBack = [...timings.entries()].reduce((sum, [label, took]) => sum + took.length * (bytesBack.get(label) ?? 0), 0) / 1024 / 1024;
console.log(`back from the database, going by what one request of each kind brought: about ${megabytesBack.toFixed(1)} MB, ${(megabytesBack * 3600 / HOUR).toFixed(0)} MB an hour at the real pace, ${(megabytesBack * 3600 / HOUR / USERS).toFixed(2)} MB an hour an app`);
console.log(`answers other than 200/201: ${refused.length ? refused.map(([key, count]) => `${key} x${count}`).join(", ") : "none"}; requests that did not complete: ${failures}`);
console.log(`connections the server held to the database: ${idleConnections} before, ${peakConnections} at most (pool of ${POOL || 10}, and the driver's own two to watch a one-member database${LATENCY ? `; each trip ${LATENCY} ms longer` : ""})`);
console.log(`server memory: ${megabytes(idleStats.rss)} before, ${megabytes(peakRss)} at most (heap ${megabytes(peakHeap)}); event loop held up ${lagP99.toFixed(0)} ms at the 99th percentile`);
const slowest = Math.max(...signIns.map((entry) => entry.took));
console.log(`24 sign-ins at once: ${megabytes(beforeBurst.rss)} before, ${megabytes(burstRss)} at most; the slowest took ${slowest.toFixed(0)} ms; answers ${[...new Set(signIns.map((entry) => entry.status))].join(", ")}`);

// ---- what the readers weigh ---------------------------------------------------------------------

const stats = await db.stats();
console.log(`\nWhat is stored (${USERS + BACKGROUND} readers; ${USERS} of them with a month or two of use behind them)`);
console.log(`  ${"collection".padEnd(16)} ${"documents".padStart(9)} ${"average".padStart(9)} ${"data".padStart(10)} ${"indexes".padStart(10)}`);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
for (const { name } of (await db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
  if (name.startsWith("system.")) {
    continue;
  }
  const [{ storageStats }] = await db.collection(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
  if (storageStats.count > 0) {
    console.log(`  ${name.padEnd(16)} ${String(storageStats.count).padStart(9)} ${`${Math.round(storageStats.avgObjSize ?? 0)} B`.padStart(9)} ${kb(storageStats.size).padStart(10)} ${kb(storageStats.totalIndexSize).padStart(10)}`);
  }
}
console.log(`  data ${kb(stats.dataSize)} + indexes ${kb(stats.indexSize)} = ${kb(stats.dataSize + stats.indexSize)}`);

child.send("stop");
await new Promise((resolve) => child.once("exit", resolve));
await db.dropDatabase();
await mongo.close();
proxy?.close();
process.exit(0);
