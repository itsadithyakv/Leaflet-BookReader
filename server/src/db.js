import { MongoClient } from "mongodb";

/**
 * Four core collections, split by how they are read, plus four small
 * community ones (see below).
 *
 * `accounts`  one per reader: email, password hash, optional display name.
 * `sessions`  one per signed-in device: only the SHA-256 of the token.
 * `states`    one per reader: the whole sync state as a single gzipped blob.
 *             Nothing queries inside it — the merge runs on the client — so
 *             paying BSON's per-document field names for every book and ledger
 *             day would be pure waste (~15 KB compressed vs ~90 KB).
 * `profiles`  the small, queryable half: what the leaderboard sorts on and the
 *             shelf a reader chose to show.
 *
 * Every per-reader document is keyed by the account's ObjectId.
 *
 * Community (all tiny, all indexed, most self-expiring):
 * `follows`   one per (follower, followee) pair.
 * `kudos`     one per (sender, recipient, local day); expires after 21 days,
 *             since only "this week" and "today" are ever asked of it.
 * `duels`     one per pair per week; expires after 90 days.
 * `events`    the inbox, materialised; expires after 60 days.
 *
 *             (`accounts.passwordResets` keeps when the last year's resets were
 *             completed; three a year is the limit.)
 * `resets`    at most one pending password reset per account: the SHA-256 of
 *             the emailed code, how many wrong tries it has had, and when it
 *             expires (15 minutes; the TTL index removes it).
 * `confirmations` at most one pending email confirmation per account, kept
 *             the same way: the code's SHA-256, its wrong tries, its expiry
 *             (30 minutes). (`accounts.emailConfirmedAt` is when the address
 *             was confirmed: null until then, and absent on accounts made
 *             before confirmation existed.)
 */

const DAY_SECONDS = 24 * 60 * 60;

let client = null;
let database = null;

export async function connect(uri, dbName) {
  if (database) {
    return database;
  }
  client = new MongoClient(uri, {
    // A free-tier cluster allows few connections; one small pool per instance
    // keeps headroom for other clients.
    maxPoolSize: 5,
    // Idle pooled sockets (and their TLS buffers) are released rather than
    // held all night on a memory-capped VM.
    maxIdleTimeMS: 60_000,
    // Fail a request after 10 s when Atlas is unreachable, instead of the
    // driver's 30 s default holding the socket and the client waiting.
    serverSelectionTimeoutMS: 10_000,
    appName: "leaflet-api",
    retryWrites: true
  });
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes(database);
  return database;
}

async function dropIfPresent(collection, name, isCurrent) {
  const existing = await collection.indexes().catch(() => []);
  const found = existing.find((index) => index.name === name);
  if (found && !isCurrent(found)) {
    await collection.dropIndex(name);
  }
}

export async function ensureIndexes(db) {
  await accounts(db).createIndex({ email: 1 }, { name: "email", unique: true });

  // Expired sessions delete themselves. TTL runs about once a minute, so
  // lookups also check `expiresAt` rather than rely on it.
  await sessions(db).createIndex({ expiresAt: 1 }, { name: "expiry", expireAfterSeconds: 0 });
  // "Sign out everywhere else" and account deletion find sessions by owner.
  await sessions(db).createIndex({ userId: 1 }, { name: "owner" });

  // An earlier version made this sparse, which still indexes an explicit null
  // — so a second reader clearing their handle hit a duplicate-key error.
  // A partial index only covers real, string handles.
  await dropIfPresent(profiles(db), "handle", (index) => Boolean(index.partialFilterExpression));
  await profiles(db).createIndex(
    { handle: 1 },
    { name: "handle", unique: true, partialFilterExpression: { handle: { $type: "string" } } }
  );

  // The only query the leaderboard makes, served entirely from this index:
  // "public profiles, this week, highest minutes first", with a stable
  // tiebreak so equal readers do not swap places between requests.
  await dropIfPresent(profiles(db), "leaderboard", (index) => "handle" in index.key);
  await profiles(db).createIndex(
    { visibility: 1, weekKey: 1, weekMinutes: -1, streak: -1, handle: 1 },
    { name: "leaderboard" }
  );

  await resets(db).createIndex({ expiresAt: 1 }, { name: "expiry", expireAfterSeconds: 0 });
  await confirmations(db).createIndex({ expiresAt: 1 }, { name: "expiry", expireAfterSeconds: 0 });

  await ensureCommunityIndexes(db);
}

async function ensureCommunityIndexes(db) {
  // One follow per pair; the prefix also serves "who do I follow".
  await follows(db).createIndex({ followerId: 1, followeeId: 1 }, { name: "pair", unique: true });
  // Follower counts, and deleting a reader's incoming follows.
  await follows(db).createIndex({ followeeId: 1 }, { name: "followee" });

  // Once per sender, per recipient, per local day. The prefix serves deletion by sender.
  await kudos(db).createIndex({ fromId: 1, toId: 1, dayKey: 1 }, { name: "once_a_day", unique: true });
  // "Kudos received this week", and deletion by recipient.
  await kudos(db).createIndex({ toId: 1, weekKey: 1 }, { name: "received" });
  await kudos(db).createIndex({ createdAt: 1 }, { name: "expiry", expireAfterSeconds: 21 * DAY_SECONDS });

  // One duel per pair per week, whoever challenged whom: `pair` is the two
  // ids sorted, so the unique index settles a race between two challenges.
  await duels(db).createIndex({ pair: 1, weekKey: 1 }, { name: "pair_week", unique: true });
  await duels(db).createIndex({ challengerId: 1, weekKey: 1 }, { name: "challenger" });
  await duels(db).createIndex({ opponentId: 1, weekKey: 1 }, { name: "opponent" });
  await duels(db).createIndex({ createdAt: 1 }, { name: "expiry", expireAfterSeconds: 90 * DAY_SECONDS });

  await events(db).createIndex({ userId: 1, createdAt: -1 }, { name: "inbox" });
  await events(db).createIndex({ actorId: 1 }, { name: "actor" });
  await events(db).createIndex({ createdAt: 1 }, { name: "expiry", expireAfterSeconds: 60 * DAY_SECONDS });
}

export const accounts = (db) => db.collection("accounts");
export const sessions = (db) => db.collection("sessions");
export const states = (db) => db.collection("states");
export const profiles = (db) => db.collection("profiles");
export const follows = (db) => db.collection("follows");
export const kudos = (db) => db.collection("kudos");
export const duels = (db) => db.collection("duels");
export const events = (db) => db.collection("events");
export const resets = (db) => db.collection("resets");
export const confirmations = (db) => db.collection("confirmations");

export async function close() {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}
