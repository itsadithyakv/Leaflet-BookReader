import { MongoClient } from "mongodb";

/**
 * Four core collections, split by how they are read, plus the small
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
 *             since only "this week" and "today" are ever asked of it. One
 *             for a post keeps the post's id and what it was (`about`). Who
 *             has cheered whom for longer than that is kept on the profiles
 *             (`kudosFrom`, `kudosTo`: see `kudosCircleWrites`).
 * `duels`     one per pair per week; expires after 90 days.
 * `events`    the inbox, materialised; expires after 60 days.
 * `followRequests` one per (asker, asked) pair, while a reader who shares with
 *             followers only has not answered. Accepted, it becomes a `follows`
 *             row; declined or withdrawn, it is deleted.
 * `libraries` one per reader who uploaded theirs: the books (title, author,
 *             state, percent) as one array, since it is only ever replaced
 *             whole and read whole.
 * `posts`     one per "I finished this" a reader posted.
 * `clubs`     one per book club: its members' ids in the order they joined.
 * `gifts`     one per gift sent; a claimed one expires after 30 days.
 * `raids`     one per raid on a friend's camp in the Hollow: who raided whom,
 *             how many stars and when. Expires after 30 days.
 *
 * The public layer (optional, and moderated; see `standing.js`):
 * `posts`     also holds reviews and quotes, some of them for everyone.
 * `quoteTallies` how many quotes a reader has ever posted from one book.
 * `reactions` one like or dislike per reader per post, thread or reply; the
 *             totals are kept on the thing itself.
 * `communities` one per book or series: its keeper and members' ids.
 * `threads`, `replies` the discussion in a community.
 * `reports`   one per reader per thing reported; a resolved one expires
 *             after 180 days.
 * `blocks`    one per (blocker, blocked) pair.
 * `settings`  one document: whether public posting is switched on.
 * `tallies`   one per reader, kind and UTC day: how many posts, quotes,
 *             threads, replies, reports, communities started and members
 *             removed that day. Expires a few days later.
 * `suspensions` one per suspended reader's email address, as a keyed hash
 *             (never the address), until the suspension ends: what makes a
 *             suspension outlast deleting the account and signing up again.
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
 * `problems`  one per problem report a reader sent from Settings (signed in
 *             or not): their words, the app's diagnostics if they chose to
 *             send them, the version and platform, and who (the account) or
 *             an address for a reply. Expires 90 days after it was sent.
 * `deletions` one per deleted account: its id and when (`at`), nothing else,
 *             for 45 days (TTL). A restore from backup reads it from the live
 *             database to delete again what was deleted after the backup
 *             (`deletion.js`, `backup/restore.js --deletions-from`). Backups
 *             are kept 30 days at most, so 45 covers every one of them.
 * `errorKinds` one per kind of error the apps reported by themselves, per
 *             version, platform and UTC day: its scrubbed name, message and
 *             places in the code, and how many times (`errorKinds.js`).
 *             Nothing about who sent it. Expires after 90 days.
 * `errorFixes` one per kind of error the owner marked fixed, and in which
 *             version; forgotten 180 days after it was marked.
 * `meta`      small facts about the server kept by its other processes: the
 *             last nightly backup that went through (`_id: "lastBackup"`,
 *             `backup/note.js`), so the owner's overview can say when it was.
 *
 *             (`accounts.lastSeenAt` is the day an account was last used, and
 *             `accounts.client` the version and platform of the app it was
 *             used from that day: `dormant.js`, written once a day at most.)
 */

const DAY_SECONDS = 24 * 60 * 60;
/** How long a problem report is kept (`routes/problems.js`). */
export const PROBLEM_DAYS = 90;
/** How long an error kind is kept (`errorKinds.js`). */
export const ERROR_DAYS = 90;

let client = null;
let database = null;

/** A whole number from the environment within [least, most], or `fallback` when it is unset or not one. */
function envWhole(env, name, fallback, least, most) {
  const value = Number(env[name]);
  return env[name] !== undefined && env[name] !== "" && Number.isInteger(value) && value >= least && value <= most ? value : fallback;
}

/**
 * How this process talks to MongoDB: one client, one small pool.
 *
 * The whole server shares the one `MongoClient` made in `connect`; nothing
 * opens another (no client per request, per route or per timer). So the
 * connections it holds are the pool's, to the primary, plus the driver's own
 * monitoring of each member of the cluster (two a member; an Atlas cluster
 * has three): `MONGO_MAX_POOL` + 6 at the very most, 16 with the default,
 * out of the few hundred a free-tier cluster allows in all.
 *
 * `MONGO_MAX_POOL` (10; 1 to 50) is how many operations can be at the
 * database at once. A request makes a handful, one or two at a time, and
 * each is a round trip to Atlas: at 50 ms a trip ten sockets carry 200
 * operations a second, which is more than a free cluster lets through
 * before it slows everyone down. So a larger pool buys nothing but more
 * connections, and five (what this was) was the limit a little too early,
 * with the cluster a slow trip away. No connection is opened until it is
 * needed (`minPoolSize` 0), and an idle one is let go after
 * `MONGO_MAX_IDLE_MS` (a minute), so a quiet server holds one or two.
 *
 * With every socket busy a request waits its turn, and for no longer than
 * `MONGO_WAIT_QUEUE_MS` (2 s): then it is answered 503, "busy", instead of
 * queueing without end behind a database that has stopped answering (the
 * driver's default is to wait for ever). Two seconds, not more, because a
 * request is several operations and waits for each: the inbox is nine. `MONGO_SERVER_SELECTION_MS` (10 s)
 * is the same for a cluster that cannot be reached at all.
 */
export function clientOptions(env = process.env) {
  return {
    maxPoolSize: envWhole(env, "MONGO_MAX_POOL", 10, 1, 50),
    minPoolSize: 0,
    // Idle pooled sockets (and their TLS buffers) are released rather than
    // held all night on a memory-capped VM.
    maxIdleTimeMS: envWhole(env, "MONGO_MAX_IDLE_MS", 60_000, 1_000, 3_600_000),
    waitQueueTimeoutMS: envWhole(env, "MONGO_WAIT_QUEUE_MS", 2_000, 100, 60_000),
    // Fail a request after 10 s when Atlas is unreachable, instead of the
    // driver's 30 s default holding the socket and the client waiting.
    serverSelectionTimeoutMS: envWhole(env, "MONGO_SERVER_SELECTION_MS", 10_000, 1_000, 60_000),
    appName: "leaflet-api",
    retryWrites: true,
    compressors: envCompressors(env)
  };
}

/**
 * Whether what goes to and from the database is compressed on the wire:
 * zlib, unless `MONGO_COMPRESSORS` is `none`.
 *
 * The first limit a free cluster reaches is its transfer (10 GB each way a
 * week), and what is sent is JSON-like documents (profiles, camps, boards)
 * that zlib makes several times smaller, at a little processor on each side.
 * zlib is the one compressor built into Node and the driver; snappy and zstd
 * would each be another package to install and build, for a few per cent.
 * The cluster uses the first compressor it is offered that it supports, and
 * the handshake and sign-in go uncompressed whatever is set.
 *
 * `compressors=zlib` in `MONGO_URI` does the same. The driver does not let
 * one of the two win: it takes the union of both lists, these listed before
 * the URI's. So `none` here switches off only what this adds, and a URI that
 * names a compressor still has it. Anything other than `zlib` or `none` (a
 * mistyped name, or snappy without its package, which would stop the server
 * starting) is ignored in favour of the default, as `envWhole`'s numbers are.
 */
function envCompressors(env) {
  const named = String(env.MONGO_COMPRESSORS ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (named.length > 0 && named.every((name) => name === "none")) {
    return ["none"];
  }
  return ["zlib"];
}

export async function connect(uri, dbName, env = process.env) {
  if (database) {
    return database;
  }
  client = new MongoClient(uri, clientOptions(env));
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes(database);
  return database;
}

/**
 * A string to look a document up by, on a field whose index is partial:
 * `handle` on a profile, `bookKey` on a post. Only real, string values are
 * in such an index, and the database uses it only for a query that says the
 * field is a string. Asked for `{ handle: "ada" }` alone it does not: it
 * read every profile to find one (or, with a visibility beside it, walked
 * the whole of the leaderboard's index), and every post to find a book's.
 * `extra` is for a prefix search: `{ $regex: "^ad" }` in place of the `$eq`.
 */
export const asString = (value, extra = undefined) => ({ ...(extra ?? { $eq: value }), $type: "string" });

async function dropIfPresent(collection, name, isCurrent) {
  const existing = await collection.indexes().catch(() => []);
  const found = existing.find((index) => index.name === name);
  if (found && !isCurrent(found)) {
    await collection.dropIndex(name);
  }
}

export async function ensureIndexes(db) {
  await accounts(db).createIndex({ email: 1 }, { name: "email", unique: true });
  // The owner's count of active readers (`routes/admin.js`), and the
  // dormant sweep's "not used since": both ask for a range of days. Sparse,
  // since an account that has never been noted as used has no day at all.
  await accounts(db).createIndex({ lastSeenAt: 1 }, { name: "seen", sparse: true });

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
  // A deleted account is remembered (by id alone) for longer than any backup
  // is kept, and then forgotten.
  await deletions(db).createIndex({ at: 1 }, { name: "expiry", expireAfterSeconds: 45 * DAY_SECONDS });

  // Problem reports: the admin's list (open or closed, newest first, and how
  // many are open), deleting an account's own, and gone after 90 days.
  await problems(db).createIndex({ status: 1, _id: -1 }, { name: "list" });
  await problems(db).createIndex({ accountId: 1 }, { name: "account", sparse: true });
  await problems(db).createIndex(
    { at: 1 },
    { name: "expiry", expireAfterSeconds: PROBLEM_DAYS * DAY_SECONDS }
  );

  // Error kinds: the owner's list (by signature) and the overview's last
  // week (by day, from this index), and gone after 90 days.
  await errorKinds(db).createIndex({ at: 1 }, { name: "expiry", expireAfterSeconds: ERROR_DAYS * DAY_SECONDS });
  await errorKinds(db).createIndex({ sig: 1 }, { name: "sig" });
  await errorFixes(db).createIndex({ at: 1 }, { name: "expiry", expireAfterSeconds: 180 * DAY_SECONDS });

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

  // One request per pair; the prefix also serves deleting a reader's own.
  await followRequests(db).createIndex({ fromId: 1, toId: 1 }, { name: "pair", unique: true });
  // "Who is asking to follow me", newest first, and deletion by the reader asked.
  await followRequests(db).createIndex({ toId: 1, createdAt: -1 }, { name: "asked" });

  // (`libraries` is only ever read by `_id`, the account's.)

  // A reader's own posts, the feed (several readers' posts, newest first),
  // today's count, and deletion by author.
  await posts(db).createIndex({ userId: 1, createdAt: -1 }, { name: "author" });

  // A join code names one club.
  await clubs(db).createIndex({ code: 1 }, { name: "code", unique: true });
  // "The clubs I am in".
  await clubs(db).createIndex({ memberIds: 1 }, { name: "member" });

  // The gifts waiting for a reader, oldest first, and deletion by receiver.
  await gifts(db).createIndex({ toId: 1, claimedAt: 1, createdAt: 1 }, { name: "waiting" });
  // "Sent today", and deletion by sender.
  await gifts(db).createIndex({ fromId: 1, createdAt: -1 }, { name: "sent" });
  // A claimed gift has been handed over and is never read again. (A TTL index
  // skips documents whose field is not a date, so unclaimed ones stay.)
  await gifts(db).createIndex({ claimedAt: 1 }, { name: "expiry", expireAfterSeconds: 30 * DAY_SECONDS });

  // One raid per raider, per camp, per UTC day: the unique index is what
  // refuses a second, however two requests race. The prefix serves "whom
  // have I raided today" and deletion by raider.
  await raids(db).createIndex({ fromId: 1, toId: 1, day: 1 }, { name: "once_a_day", unique: true });
  // The raids a reader has not seen yet, oldest first, and deletion by the reader raided.
  await raids(db).createIndex({ toId: 1, seenAt: 1, createdAt: 1 }, { name: "waiting" });
  // Seen or not, a raid is of no use a month on.
  await raids(db).createIndex({ createdAt: 1 }, { name: "expiry", expireAfterSeconds: 30 * DAY_SECONDS });

  await ensurePublicIndexes(db);
}

/** The public layer: posts for everyone, reactions, book communities, reports, blocks. */
async function ensurePublicIndexes(db) {
  // Discover, newest first: "posts for everyone, not hidden".
  await posts(db).createIndex({ audience: 1, createdAt: -1 }, { name: "discover_new" });
  // Discover, best first: `score` is likes less dislikes, kept on the post so
  // this order can be read from an index instead of worked out per request.
  await posts(db).createIndex({ audience: 1, score: -1, createdAt: -1 }, { name: "discover_top" });
  // A book's page: its posts, newest first.
  await posts(db).createIndex({ bookKey: 1, createdAt: -1 }, { name: "book", partialFilterExpression: { bookKey: { $type: "string" } } });
  // One review of a book per reader: a second replaces the first, and when
  // two arrive at once this index is what makes one of them the second.
  await posts(db).createIndex(
    { userId: 1, bookRef: 1 },
    { name: "one_review", unique: true, partialFilterExpression: { kind: "review" } }
  );

  // How many quotes a reader has ever posted from one book. Never counted
  // down, so deleting quotes does not buy room for more.
  await quoteTallies(db).createIndex({ userId: 1, bookRef: 1 }, { name: "reader_book", unique: true });

  // One reaction per reader per thing; the prefix serves "my reactions to
  // these" and deleting a thing's reactions with it.
  await reactions(db).createIndex({ target: 1, targetId: 1, userId: 1 }, { name: "once", unique: true });
  // Taking a reader's reactions back out when their account goes.
  await reactions(db).createIndex({ userId: 1 }, { name: "reader" });

  // One community per book or series: the unique index is what stops a
  // second one, however two requests race.
  await communities(db).createIndex({ kind: 1, key: 1 }, { name: "book", unique: true });
  // "The communities I am in", and "the ones I keep".
  await communities(db).createIndex({ memberIds: 1 }, { name: "member" });
  await communities(db).createIndex({ keeperId: 1 }, { name: "keeper" });
  // "The communities I am banned from": asked when an account or a profile
  // is deleted, to take its reader off those lists. Without this that read
  // every community there is, members and all.
  await communities(db).createIndex({ bannedIds: 1 }, { name: "banned" });
  // The directory: the listed communities, largest first, in the order they
  // are shown (`_id` settles a tie), so a page of it is read straight off the
  // index. The index before this one (`size`, on `memberCount` alone) could
  // not give that order, so every community there is was read, members and
  // all, and sorted, to show thirty.
  await dropIfPresent(communities(db), "size", () => false);
  await communities(db).createIndex(
    { memberCount: -1, _id: 1 },
    { name: "directory", partialFilterExpression: { listedAt: { $type: "date" } } }
  );

  // A community's threads: pinned first, then by latest activity.
  await threads(db).createIndex({ communityId: 1, pinned: -1, lastActivityAt: -1 }, { name: "community" });
  // "Threads I started today", and what an account leaves behind.
  await threads(db).createIndex({ authorId: 1, createdAt: -1 }, { name: "author" });

  // A thread's replies, oldest first.
  await replies(db).createIndex({ threadId: 1, createdAt: 1 }, { name: "thread" });
  await replies(db).createIndex({ authorId: 1, createdAt: -1 }, { name: "author" });
  // Deleting a community takes its replies with it.
  await replies(db).createIndex({ communityId: 1 }, { name: "community" });

  // One report per reader per thing, so three reports are three readers.
  await reports(db).createIndex({ target: 1, targetId: 1, reporterId: 1 }, { name: "once", unique: true });
  // "Reports I made today", and deleting a reader's own.
  await reports(db).createIndex({ reporterId: 1, createdAt: -1 }, { name: "reporter" });
  // A report that has been dealt with is kept half a year, as a record of
  // what was said about whom, and then goes. An open one has `null` here,
  // which a TTL index leaves alone; the same index finds the open ones for
  // the admin's queue.
  await reports(db).createIndex({ resolvedAt: 1 }, { name: "expiry", expireAfterSeconds: 180 * DAY_SECONDS });

  // One block per pair, each way round; the prefix serves "whom I blocked".
  await blocks(db).createIndex({ blockerId: 1, blockedId: 1 }, { name: "pair", unique: true });
  // "Who blocked me".
  await blocks(db).createIndex({ blockedId: 1 }, { name: "blocked" });

  // (`settings` is one document, read by `_id`.)

  // One count per reader, per kind of thing, per UTC day: what the daily
  // allowances are counted in. Counted up when something is made and never
  // down when it is deleted, so deleting does not buy another.
  await tallies(db).createIndex({ userId: 1, kind: 1, day: 1 }, { name: "reader_day", unique: true });
  // A day's counts are of no use a few days on.
  await tallies(db).createIndex({ expiresAt: 1 }, { name: "expiry", expireAfterSeconds: 0 });

  // (`suspensions` is keyed by `_id`, a keyed hash of an email address.)
  // Gone the moment the suspension it remembers is over.
  await suspensions(db).createIndex({ suspendedUntil: 1 }, { name: "expiry", expireAfterSeconds: 0 });
  // Lifting a suspension finds it by the account it was given to.
  await suspensions(db).createIndex({ accountId: 1 }, { name: "account" });
}

export const accounts = (db) => db.collection("accounts");
export const sessions = (db) => db.collection("sessions");
export const states = (db) => db.collection("states");
export const profiles = (db) => db.collection("profiles");
export const follows = (db) => db.collection("follows");
export const kudos = (db) => db.collection("kudos");
export const duels = (db) => db.collection("duels");
export const events = (db) => db.collection("events");
export const followRequests = (db) => db.collection("followRequests");
export const libraries = (db) => db.collection("libraries");
export const posts = (db) => db.collection("posts");
export const clubs = (db) => db.collection("clubs");
export const gifts = (db) => db.collection("gifts");
export const raids = (db) => db.collection("raids");
export const quoteTallies = (db) => db.collection("quoteTallies");
export const reactions = (db) => db.collection("reactions");
export const communities = (db) => db.collection("communities");
export const threads = (db) => db.collection("threads");
export const replies = (db) => db.collection("replies");
export const reports = (db) => db.collection("reports");
export const blocks = (db) => db.collection("blocks");
export const settings = (db) => db.collection("settings");
export const tallies = (db) => db.collection("tallies");
export const suspensions = (db) => db.collection("suspensions");
export const resets = (db) => db.collection("resets");
export const confirmations = (db) => db.collection("confirmations");
export const deletions = (db) => db.collection("deletions");
export const problems = (db) => db.collection("problems");
export const errorKinds = (db) => db.collection("errorKinds");
export const errorFixes = (db) => db.collection("errorFixes");
export const meta = (db) => db.collection("meta");

export async function close() {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}
