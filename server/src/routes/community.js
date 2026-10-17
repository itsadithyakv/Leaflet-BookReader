import { Router } from "express";
import { optionalAccount, requireAccount } from "../auth.js";
import {
  DUEL_LIMIT,
  FOLLOW_LIMIT,
  INBOX_LIMIT,
  PERSON_FIELDS,
  SOCIAL,
  canSee,
  countActiveDuels,
  duelView,
  exactMinutes,
  followedIds,
  isPublic,
  isSocial,
  minutesFor,
  pairKey,
  personView,
  pickVisitors,
  rememberKudos,
  shownBadges,
  socialProfilesById,
  visibleDuels
} from "../community.js";
import { asString, blocks, duels, events, followRequests, follows, kudos, profiles } from "../db.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import {
  NO_SUCH_READER,
  WHO_FIELDS,
  askedWeek,
  cleanHandle,
  findSocial,
  limiter,
  notSelf,
  objectId,
  socialByHandle,
  socialSelf,
  visibleByHandle
} from "../readers.js";
import { blockedWith, hasBlocked, refuseBlocked } from "../standing.js";
import { isPlausibleDayKey, isWeekKey, plausibleWeekKeys, weekIsOver } from "../week.js";
import { readablePost } from "./posts.js";
import { HANDLE_PATTERN } from "./social.js";
import { boardStamp, cachedBoard, cachedVisitors, forgetVisitors, rememberBoard, rememberVisitors } from "../boardCache.js";

/**
 * The interactive half of the board: following, kudos, weekly duels, the
 * inbox, and finding readers by handle.
 *
 * Friendly competition, strictly opt-in: only shared profiles appear, and only
 * a reader who shares theirs (publicly, or with followers) can follow, send
 * kudos or challenge. Private and missing handles are indistinguishable (both
 * 404). A reader who shares with followers only is on no public board; they
 * are found by handle, as a locked card, and seen in full by the readers
 * whose follow they have accepted.
 */

const LEADERBOARD_LIMIT = 100;
const SEARCH_LIMIT = 10;
const REQUEST_LIMIT = 100;
/** The most seeds two readers can put on a duel. The apps hold and settle them. */
const MAX_STAKE = 50;
const NO_SUCH_REQUEST = "No request to follow you from that reader.";
/** A post's id as kudos for it names it. */
const POST_ID = /^[0-9a-f]{24}$/i;
/** How much of a post's title a kudos for it keeps. */
const ABOUT_TITLE = 200;
/** Of a reader in a duel: who they are (`personView`), and the week's minutes the duel keeps. */
const DUELLIST_FIELDS = { ...PERSON_FIELDS, weekKey: 1, weekMinutes: 1 };
/**
 * What a row of a board shows of a profile (`rowView`), and what says it is
 * shared. Not the shelf, the badges or the camp: a board of the readers
 * followed read all of each, a few kilobytes a reader, to show a line.
 */
const ROW_FIELDS = { handle: 1, displayName: 1, avatar: 1, weekKey: 1, weekMinutes: 1, streak: 1, booksFinished: 1, visibility: 1, reading: 1, level: 1 };

const utcToday = () => new Date().toISOString().slice(0, 10);

/** A leaderboard row. */
function rowView(profile, weekKey, rank, meId) {
  return {
    ...personView(profile),
    rank,
    weekMinutes: minutesFor(profile, weekKey),
    streak: profile.streak ?? 0,
    booksFinished: profile.booksFinished ?? 0,
    // The book they are in the middle of, if they said: `{ title, author, percent }`.
    reading: profile.reading ?? null,
    level: profile.level ?? null,
    isYou: Boolean(meId && profile._id.equals(meId))
  };
}

const byBoardOrder = (weekKey) => (a, b) =>
  minutesFor(b, weekKey) - minutesFor(a, weekKey) ||
  (b.streak ?? 0) - (a.streak ?? 0) ||
  String(a.handle).localeCompare(String(b.handle));

export function communityRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const maybeAuth = optionalAccount(db);
  const fallback = defaultLimits();
  const writes = limiter(limits.social ?? fallback.social);
  const searches = limiter(limits.search ?? fallback.search);
  const visits = limiter(limits.visitors ?? fallback.visitors);

  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  /**
   * A week's board. `scope=everyone` (default) is public: the top 100, most
   * minutes first, ties broken by streak then handle. `scope=following` is the
   * signed-in reader plus everyone they follow who shares a profile (a
   * followers-only reader they follow has accepted them), zeros included.
   * When signed in and public but outside the top 100, `you` carries the
   * reader's own row and rank. `sharedReaders` (everyone only) counts the
   * public profiles there are, read this week or not.
   *
   * A followers-only reader is not on the everyone board and not counted in
   * it: that board is open to anybody, signed in or not.
   *
   * A private reader gets no row here, their own included: the app draws
   * their own row from the minutes on their device, so nothing about a
   * private profile ever has to be on this server to be shown to its owner.
   */
  router.get(
    "/leaderboard",
    maybeAuth,
    asyncHandler(async (request, response) => {
      const weekKey = askedWeek(request.query.week);
      const meId = request.account?.id ?? null;
      const scope = request.query.scope === "following" ? "following" : "everyone";

      if (scope === "following") {
        if (!meId) {
          throw new HttpError(401, "Sign in to see the readers you follow.");
        }
        const byId = await socialProfilesById(db, [meId, ...(await followedIds(db, meId))], {}, ROW_FIELDS);
        const rows = [...byId.values()].sort(byBoardOrder(weekKey));
        const entries = rows.map((row, index) => rowView(row, weekKey, index + 1, meId));
        response.json({ weekKey, scope, entries, you: entries.find((entry) => entry.isYou) ?? null });
        return;
      }

      let board = cachedBoard(weekKey);
      if (!board) {
        const stamp = boardStamp();
        const [rows, sharedReaders] = await Promise.all([
          profiles(db)
            .find(
              // Only profiles with a handle are shared with anyone. Without
              // that here, "public" profiles with no handle took places in
              // the hundred and were then left out, so a hundred of them
              // emptied the board for everybody.
              { visibility: "public", weekKey, weekMinutes: { $gt: 0 }, handle: { $type: "string" } },
              {
                projection: ROW_FIELDS,
                sort: { weekMinutes: -1, streak: -1, handle: 1 },
                limit: LEADERBOARD_LIMIT
              }
            )
            .toArray(),
          // Everyone who shares a profile, whether or not they have read this
          // week. A count only: it lets an empty board say why it is empty
          // ("nobody shares yet" or "nobody has read yet") and names nobody.
          profiles(db).countDocuments({ visibility: "public", handle: { $type: "string" } })
        ]);
        board = { rows, sharedReaders };
        rememberBoard(weekKey, rows, sharedReaders, stamp);
      }
      const { rows, sharedReaders } = board;
      const entries = rows.filter(isPublic).map((row, index) => rowView(row, weekKey, index + 1, meId));

      let you = entries.find((entry) => entry.isYou) ?? null;
      if (!you && meId) {
        const me = await profiles(db).findOne({ _id: meId }, { projection: ROW_FIELDS });
        if (isPublic(me) && minutesFor(me, weekKey) > 0) {
          const minutes = me.weekMinutes;
          const streak = me.streak ?? 0;
          const ahead = await profiles(db).countDocuments({
            visibility: "public",
            weekKey,
            handle: { $type: "string" },
            $or: [
              { weekMinutes: { $gt: minutes } },
              { weekMinutes: minutes, streak: { $gt: streak } },
              { weekMinutes: minutes, streak, handle: { $lt: me.handle } }
            ]
          });
          you = rowView(me, weekKey, ahead + 1, meId);
        }
      }
      response.json({ weekKey, scope, entries, you, sharedReaders });
    })
  );

  /**
   * A shared profile, by handle. Private ones are not merely hidden — they 404.
   * Signed in, it also says how the two readers stand: following, kudos sent
   * today (`?day=` is the reader's local date), and this week's duel.
   *
   * A followers-only profile is given whole to its owner and to the readers
   * whose follow it has accepted. Anyone else, signed in or not, gets the
   * locked card: who it is, that it is locked, and whether they have already
   * asked to follow. Nothing about the reading, and no counts.
   */
  router.get(
    "/profile/:handle",
    maybeAuth,
    asyncHandler(async (request, response) => {
      const profile = await socialByHandle(db, request.params.handle);
      const meId = request.account?.id ?? null;
      // To a reader they have blocked, they are not there: the same answer as
      // for a private profile, so a block cannot be told from one. (Signed
      // out, the card of a public reader is public, and stays so.)
      if (meId && !profile._id.equals(meId) && (await hasBlocked(db, profile._id, meId))) {
        throw new HttpError(404, NO_SUCH_READER);
      }
      if (!(await canSee(db, meId, profile))) {
        const [asked, youBlocked] = meId
          ? await Promise.all([
              followRequests(db).findOne({ fromId: meId, toId: profile._id }, { projection: { _id: 1 } }),
              hasBlocked(db, meId, profile._id)
            ])
          : [null, false];
        response.json({
          ...personView(profile),
          visibility: "followers",
          locked: true,
          requested: Boolean(asked),
          isYou: false,
          following: false,
          // Only when it is so (a block removes the follow, so a blocked
          // followers-only reader is always seen as this card): how the
          // blocker finds the one to unblock. Left out otherwise, so the
          // card is the shape it has always been.
          ...(youBlocked ? { youBlocked: true } : {}),
          // Nothing of theirs, but in the shape of a card: an app from before
          // `locked` existed draws every profile as a full one (it reads the
          // shelf's length), and without these it failed on a locked reader
          // instead of showing an empty card.
          isFollowing: false,
          weekKey: askedWeek(request.query.week),
          weekMinutes: 0,
          streak: 0,
          booksFinished: 0,
          shelf: [],
          kudosThisWeek: 0,
          followerCount: 0,
          followingCount: 0
        });
        return;
      }
      const weekKey = askedWeek(request.query.week);
      const [kudosThisWeek, followerCount, followingCount] = await Promise.all([
        kudos(db).countDocuments({ toId: profile._id, weekKey }),
        follows(db).countDocuments({ followeeId: profile._id }),
        follows(db).countDocuments({ followerId: profile._id })
      ]);
      const view = {
        ...personView(profile),
        visibility: profile.visibility,
        locked: false,
        weekKey,
        weekMinutes: minutesFor(profile, weekKey),
        streak: profile.streak ?? 0,
        booksFinished: profile.booksFinished ?? 0,
        shelf: profile.shelf ?? [],
        reading: profile.reading ?? null,
        level: profile.level ?? null,
        // What the app saved, with the kudos badges as this server counts them.
        badges: shownBadges(profile),
        arcade: profile.arcade ?? null,
        camp: profile.camp ?? null,
        // Whether there is a library to ask for (`GET /profile/:handle/library`),
        // which is for the readers who follow them.
        sharesLibrary: profile.shareLibrary === true,
        kudosThisWeek,
        followerCount,
        followingCount
      };

      if (meId) {
        const dayKey = isPlausibleDayKey(request.query.day) ? request.query.day : utcToday();
        const isYou = profile._id.equals(meId);
        const [following, followsYou, sentToday, duel, youBlocked] = isYou
          ? [null, null, null, null, false]
          : await Promise.all([
              follows(db).findOne({ followerId: meId, followeeId: profile._id }),
              follows(db).findOne({ followerId: profile._id, followeeId: meId }),
              kudos(db).findOne({ fromId: meId, toId: profile._id, dayKey }),
              duels(db).findOne({ pair: pairKey(meId, profile._id), weekKey }),
              hasBlocked(db, meId, profile._id)
            ]);
        Object.assign(view, {
          isYou,
          isFollowing: Boolean(following),
          followsYou: Boolean(followsYou),
          // The reader has blocked this one (and can undo it from here).
          youBlocked,
          kudosSentToday: Boolean(sentToday),
          activeDuel: duel
            ? { id: duel._id.toHexString(), status: duel.status, youChallenged: duel.challengerId.equals(meId) }
            : null
        });
      }
      response.json(view);
    })
  );

  /**
   * Follow a reader, or ask to. Idempotent.
   *
   * A public reader is followed at once, and told once, not on every
   * re-follow. A reader who shares with followers only is asked instead: the
   * request waits for them (`GET /follow-requests`), they are told once, and
   * nothing of theirs is shown until they accept. The answer says which
   * happened: `following`, or `requested`.
   */
  router.post(
    "/follows/:handle",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const me = await socialSelf(db, request.account.id, WHO_FIELDS);
      const them = await socialByHandle(db, request.params.handle, WHO_FIELDS);
      notSelf(me, them, "You can't follow yourself — but you're doing great.");
      await refuseBlocked(db, me._id, them._id);

      const pair = { followerId: me._id, followeeId: them._id };
      const waiting = { fromId: me._id, toId: them._id };
      // Checked before the limit, so asking again for a follow that is
      // already there is a yes, however many readers they follow.
      if (await follows(db).findOne(pair, { projection: { _id: 1 } })) {
        response.json({ following: true, requested: false });
        return;
      }
      if ((await follows(db).countDocuments({ followerId: me._id })) >= FOLLOW_LIMIT) {
        throw new HttpError(409, `You can follow up to ${FOLLOW_LIMIT} readers.`);
      }
      const now = new Date();
      if (them.visibility === "followers") {
        const { upsertedCount } = await followRequests(db).updateOne(
          waiting,
          { $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
        if (upsertedCount) {
          // Once per pair, like a follow: asking, withdrawing and asking
          // again does not fill their inbox.
          await events(db).updateOne(
            { userId: them._id, type: "follow_request", actorId: me._id },
            { $setOnInsert: { refId: null, createdAt: now } },
            { upsert: true }
          );
        }
        response.json({ following: false, requested: true });
        return;
      }
      const { upsertedCount } = await follows(db).updateOne(pair, { $setOnInsert: { createdAt: now } }, { upsert: true });
      // A request left from when they shared with followers only is settled
      // by this follow.
      await followRequests(db).deleteOne(waiting);
      // A visit needs both to follow the other, so this changes both lists.
      forgetVisitors(me._id.toHexString());
      forgetVisitors(them._id.toHexString());
      if (upsertedCount) {
        await events(db).updateOne(
          { userId: them._id, type: "follow", actorId: me._id },
          { $setOnInsert: { refId: null, createdAt: now } },
          { upsert: true }
        );
      }
      response.json({ following: true, requested: false });
    })
  );

  /**
   * Unfollow, or take back a request that is still waiting. Works even if
   * either side has since gone private.
   */
  router.delete(
    "/follows/:handle",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const handle = String(request.params.handle ?? "").toLowerCase();
      const them = HANDLE_PATTERN.test(handle) ? await profiles(db).findOne({ handle: asString(handle) }, { projection: { _id: 1 } }) : null;
      if (them) {
        await Promise.all([
          follows(db).deleteOne({ followerId: request.account.id, followeeId: them._id }),
          followRequests(db).deleteOne({ fromId: request.account.id, toId: them._id })
        ]);
        forgetVisitors(them._id.toHexString());
      }
      forgetVisitors(request.account.id.toHexString());
      response.json({ following: false, requested: false });
    })
  );

  /**
   * Who the reader follows (the ones who still share a profile), and how many
   * follow them. A followers-only reader is in the list only once they have
   * accepted: until then there is no follow, only a request.
   */
  router.get(
    "/follows",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const [ids, followerCount] = await Promise.all([
        followedIds(db, meId),
        follows(db).countDocuments({ followeeId: meId })
      ]);
      const byId = await socialProfilesById(db, ids, {}, PERSON_FIELDS);
      const following = [...byId.values()]
        .map(personView)
        .sort((a, b) => a.handle.localeCompare(b.handle));
      response.json({ following, followerCount });
    })
  );

  /**
   * The requests to follow this reader that are waiting for an answer, newest
   * first, at most a hundred. A reader who has since stopped sharing their
   * own profile is left out, as they are everywhere; their request is still
   * there if they share again.
   */
  router.get(
    "/follow-requests",
    auth,
    asyncHandler(async (request, response) => {
      const rows = await followRequests(db)
        .find({ toId: request.account.id }, { sort: { createdAt: -1 }, limit: REQUEST_LIMIT })
        .toArray();
      const byId = await socialProfilesById(db, rows.map((row) => row.fromId), {}, PERSON_FIELDS);
      const requests = [];
      for (const row of rows) {
        const asker = byId.get(row.fromId.toHexString());
        if (asker) {
          requests.push({ ...personView(asker), createdAt: row.createdAt.toISOString() });
        }
      }
      response.json({ requests });
    })
  );

  /**
   * Answers a request to follow. Accepting makes the follow and tells the
   * asker; declining just removes the request, and tells nobody.
   *
   * 404 when that reader has not asked, and also when they have stopped
   * sharing since: such a reader is not in the list above either, and an
   * answer here must not tell them apart from a handle that does not exist.
   */
  const answerRequest = (accept) =>
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const meId = request.account.id;
      const them = await findSocial(db, request.params.handle, WHO_FIELDS);
      const waiting = them ? await followRequests(db).findOne({ fromId: them._id, toId: meId }) : null;
      if (!waiting) {
        throw new HttpError(404, NO_SUCH_REQUEST);
      }
      if (!accept) {
        await followRequests(db).deleteOne({ _id: waiting._id });
        response.json({ declined: true });
        return;
      }
      // The follow is theirs, so it is their limit that counts. The request
      // is kept: they may make room.
      if ((await follows(db).countDocuments({ followerId: them._id })) >= FOLLOW_LIMIT) {
        throw new HttpError(409, `They already follow ${FOLLOW_LIMIT} readers, which is as many as anyone can.`);
      }
      const now = new Date();
      await follows(db).updateOne(
        { followerId: them._id, followeeId: meId },
        { $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      await followRequests(db).deleteOne({ _id: waiting._id });
      forgetVisitors(meId.toHexString());
      forgetVisitors(them._id.toHexString());
      await events(db).updateOne(
        { userId: them._id, type: "follow_accept", actorId: meId },
        { $setOnInsert: { refId: null, createdAt: now } },
        { upsert: true }
      );
      response.json({ accepted: true });
    });

  router.post("/follow-requests/:handle/accept", auth, answerRequest(true));
  router.post("/follow-requests/:handle/decline", auth, answerRequest(false));

  /**
   * Whose Pip could come by today: the readers this reader follows, and who
   * follow this reader back, who read on `?day=` (the reader's own local
   * date), at most a handful, picked the same way all day (see `pickVisitors`).
   *
   * "Read today" is the friend's own word: the `readDay` their app publishes
   * with their minutes, held only while their profile is shared. It is
   * compared here and never sent on, so all this tells anyone is that a
   * friend (each follows the other) has read today. Each side may share
   * publicly or with followers only: the follow each way is what makes them
   * friends, and a followers-only reader accepted theirs. A reader whose own
   * profile is not shared has no visitors: an empty list, not an error, since
   * nothing they asked to do is being refused.
   */
  router.get(
    "/visitors",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      visits(`acct:${meId}`);
      const day = request.query.day;
      if (!isPlausibleDayKey(day)) {
        throw new HttpError(400, "day must be today's local date, like 2026-09-27.");
      }
      const weekKey = askedWeek(request.query.week);
      const key = `${day}:${weekKey}`;
      const reader = meId.toHexString();

      let list = cachedVisitors(reader, key);
      if (!list) {
        const stamp = boardStamp();
        list = [];
        const me = await profiles(db).findOne({ _id: meId }, { projection: { handle: 1, visibility: 1 } });
        if (isSocial(me)) {
          const followed = (await followedIds(db, meId)).filter((id) => !id.equals(meId));
          // A friend is a reader who follows back. Following is one-way, and
          // "read today" is told to nobody a reader has not chosen: a visit
          // needs both to have followed the other.
          //
          // Asked of the `pair` index by name: a seek for each reader
          // followed (500 at most), and with no `_id` asked for no follow is
          // fetched. Left to choose, the database sometimes takes `followee`
          // instead and reads every reader who follows this one, however
          // many thousand that is.
          const back = followed.length
            ? await follows(db)
                .find({ followerId: { $in: followed }, followeeId: meId }, { projection: { _id: 0, followerId: 1 }, hint: "pair" })
                .toArray()
            : [];
          const ids = back.map((row) => row.followerId);
          const rows = ids.length
            ? await profiles(db)
                .find(
                  { _id: { $in: ids }, visibility: { $in: SOCIAL }, readDay: day },
                  { projection: { handle: 1, displayName: 1, avatar: 1, visibility: 1, weekKey: 1, weekMinutes: 1, streak: 1 } }
                )
                .toArray()
            : [];
          list = pickVisitors(rows.filter(isSocial), day, meId).map((row) => ({
            ...personView(row),
            weekMinutes: minutesFor(row, weekKey),
            streak: row.streak ?? 0
          }));
        }
        rememberVisitors(reader, key, list, stamp);
      }
      response.json({ day, visitors: list });
    })
  );

  /**
   * Kudos: once per reader, per local day. For a reader the sender can see: a
   * public one, or a followers-only one who has accepted their follow (403
   * otherwise: there are no minutes in front of them to cheer).
   *
   * `postId`, when sent, says it is for one of their moments: a post of
   * theirs the sender may read where the posts routes list it
   * (`readablePost`). Anything else is the same 404, so a kudos cannot be
   * used to learn whether a post was deleted, hidden or is for followers.
   * What it was for (its kind, and the book's title as it was) is kept on the
   * kudos and its event, so the inbox can say so without reading the post
   * again, and still can once the post is gone. It is still one kudos a day
   * between the two, for a post or not.
   */
  router.post(
    "/kudos/:handle",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { dayKey, weekKey, postId: askedPost } = request.body ?? {};
      if (!isPlausibleDayKey(dayKey)) {
        throw new HttpError(400, "dayKey must be today's local date, like 2026-09-27.");
      }
      if (!isWeekKey(weekKey) || !plausibleWeekKeys().has(weekKey)) {
        throw new HttpError(400, "weekKey must be the current ISO week, like 2026-W39.");
      }
      // Left out (or null), it is kudos for the reader, as it always was.
      const forPost = askedPost !== undefined && askedPost !== null;
      if (forPost && (typeof askedPost !== "string" || !POST_ID.test(askedPost))) {
        throw new HttpError(400, "postId is a post's id: 24 hexadecimal characters.");
      }
      const postId = forPost ? objectId(askedPost) : null;
      const me = await socialSelf(db, request.account.id, WHO_FIELDS);
      const them = await visibleByHandle(db, me._id, request.params.handle, WHO_FIELDS);
      notSelf(me, them, "Kudos to you — but they're for other readers.");
      await refuseBlocked(db, me._id, them._id);

      let about = null;
      if (postId) {
        const post = await readablePost(db, postId, them._id, me._id);
        if (!post) {
          throw new HttpError(404, "That post isn't there any more.");
        }
        about = { kind: post.kind ?? "finished", title: String(post.title ?? "").slice(0, ABOUT_TITLE) };
      }

      const now = new Date();
      const sent = { fromId: me._id, toId: them._id, dayKey, weekKey, createdAt: now, ...(about ? { postId, about } : {}) };
      let insertedId;
      try {
        ({ insertedId } = await kudos(db).insertOne(sent));
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "You've already sent them kudos today.");
        }
        throw error;
      }
      await events(db).insertOne({
        userId: them._id,
        type: "kudos",
        actorId: me._id,
        refId: insertedId,
        ...(about ? { about } : {}),
        createdAt: now
      });
      // Who has cheered whom, for the two kudos badges (`kudosBadges`).
      await rememberKudos(db, me._id, them._id);
      const kudosThisWeek = await kudos(db).countDocuments({ toId: them._id, weekKey });
      response.status(201).json({ sent: true, kudosThisWeek });
    })
  );

  /**
   * Challenge a reader to a duel for this week: a public one, or a
   * followers-only one who has accepted the challenger's follow.
   *
   * `stake` (0 to 50, 0 when left out) is what the two play for. It is kept
   * on the duel and shown to both, and that is all: this server holds nobody's
   * seeds, and the two apps settle it themselves.
   */
  router.post(
    "/duels",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const { handle, weekKey, stake: asked } = request.body ?? {};
      if (!isWeekKey(weekKey) || !plausibleWeekKeys().has(weekKey)) {
        throw new HttpError(400, "weekKey must be the current ISO week, like 2026-W39.");
      }
      const stake = asked === undefined ? 0 : wholeNumber(asked, 0, MAX_STAKE, "stake");
      // Of each side: who they are, and this week's minutes for the duel to start from.
      const me = await socialSelf(db, request.account.id, DUELLIST_FIELDS);
      const them = await visibleByHandle(db, me._id, handle, DUELLIST_FIELDS);
      notSelf(me, them, "You can't duel yourself. Tempting, though.");
      await refuseBlocked(db, me._id, them._id);

      if ((await countActiveDuels(db, me._id, weekKey)) >= DUEL_LIMIT) {
        throw new HttpError(409, `You already have ${DUEL_LIMIT} duels this week.`);
      }
      if ((await countActiveDuels(db, them._id, weekKey)) >= DUEL_LIMIT) {
        throw new HttpError(409, `They already have ${DUEL_LIMIT} duels this week.`);
      }

      const now = new Date();
      const duel = {
        challengerId: me._id,
        opponentId: them._id,
        pair: pairKey(me._id, them._id),
        weekKey,
        status: "pending",
        stake,
        challengerMinutes: exactMinutes(me, weekKey),
        opponentMinutes: exactMinutes(them, weekKey),
        createdAt: now,
        respondedAt: null
      };
      try {
        duel._id = (await duels(db).insertOne(duel)).insertedId;
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "You two already have a duel this week.");
        }
        throw error;
      }
      // The two counts above were taken before the insert, so challenges sent
      // at the same moment each saw room and all went in: six duels where
      // three are allowed, and as many invites in one reader's inbox. Counted
      // again with this duel in place, and taken back out if it is one too
      // many. Whichever of several checks last sees all the others, so the
      // limit holds; at worst a few sent together are all refused.
      const [mine, theirs] = await Promise.all([
        countActiveDuels(db, me._id, weekKey),
        countActiveDuels(db, them._id, weekKey)
      ]);
      if (mine > DUEL_LIMIT || theirs > DUEL_LIMIT) {
        await duels(db).deleteOne({ _id: duel._id });
        throw new HttpError(409, "Too many challenges at once. Try that one again.");
      }
      await events(db).insertOne({ userId: them._id, type: "duel_invite", actorId: me._id, refId: duel._id, createdAt: now });
      const byId = await socialProfilesById(db, [me._id, them._id], {}, PERSON_FIELDS);
      response.status(201).json(duelView(duel, me._id, byId));
    })
  );

  const respond = (accept) =>
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const meId = request.account.id;
      const duel = id ? await duels(db).findOne({ _id: id, opponentId: meId }) : null;
      if (!duel) {
        throw new HttpError(404, "No such duel.");
      }
      if (duel.status !== "pending") {
        throw new HttpError(409, duel.status === "accepted" ? "You already accepted." : "You already declined.");
      }
      if (weekIsOver(duel.weekKey)) {
        throw new HttpError(409, "That week is over.");
      }

      const now = new Date();
      if (!accept) {
        await duels(db).updateOne({ _id: id, status: "pending" }, { $set: { status: "declined", respondedAt: now } });
        response.json({ id: duel._id.toHexString(), status: "declined" });
        return;
      }

      // The challenger needs only to be sharing still: by challenging, they
      // put their name and this week's minutes in front of this reader.
      const me = await socialSelf(db, meId, DUELLIST_FIELDS);
      const byId = await socialProfilesById(db, [duel.challengerId, meId], {}, DUELLIST_FIELDS);
      const challenger = byId.get(duel.challengerId.toHexString());
      if (!challenger) {
        throw new HttpError(404, "That reader's profile isn't shared any more.");
      }
      const updated = await duels(db).findOneAndUpdate(
        { _id: id, status: "pending" },
        {
          $set: {
            status: "accepted",
            respondedAt: now,
            challengerMinutes: exactMinutes(challenger, duel.weekKey),
            opponentMinutes: exactMinutes(me, duel.weekKey)
          }
        },
        { returnDocument: "after" }
      );
      if (!updated) {
        throw new HttpError(409, "That duel has already been answered.");
      }
      await events(db).insertOne({
        userId: duel.challengerId,
        type: "duel_accepted",
        actorId: meId,
        refId: duel._id,
        createdAt: now
      });
      response.json(duelView(updated, meId, byId));
    });

  router.post("/duels/:id/accept", auth, respond(true));
  router.post("/duels/:id/decline", auth, respond(false));

  /** This week's duels and recent results. Settles any finished ones first. */
  router.get(
    "/duels",
    auth,
    asyncHandler(async (request, response) => {
      response.json({ duels: await visibleDuels(db, request.account.id) });
    })
  );

  /**
   * The newest events (≤ 50) after `?since=` (an ISO time). Events from
   * readers who no longer share a profile are left out.
   *
   * Every event is `{ id, type, createdAt, actor }`: `follow`,
   * `follow_request`, `follow_accept`, `kudos` and `gift` are no more than
   * that (an actor who shares with followers only is shown as their card,
   * which anyone may see). A `follow_request` also says whether it is still
   * `pending`, since the event stays as history once it is answered or taken
   * back; a `duel_*` event carries its duel; a `kudos` for a post carries
   * `about`, what it was for.
   */
  router.get(
    "/inbox",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const parsed = typeof request.query.since === "string" ? new Date(request.query.since) : null;
      const since = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);

      // Settling posts result events, so it goes first.
      const duelViews = await visibleDuels(db, meId);
      const rows = await events(db)
        .find({ userId: meId, createdAt: { $gt: since } }, { sort: { createdAt: -1 }, limit: INBOX_LIMIT })
        .toArray();

      const actors = await socialProfilesById(db, [meId, ...rows.map((row) => row.actorId)], {}, PERSON_FIELDS);
      // Nothing from a reader on either side of a block, whenever it happened.
      const blocked = await blockedWith(db, meId);
      const askers = rows.filter((row) => row.type === "follow_request").map((row) => row.actorId);
      const waiting = askers.length
        ? await followRequests(db).find({ toId: meId, fromId: { $in: askers } }, { projection: { fromId: 1 } }).toArray()
        : [];
      const stillAsking = new Set(waiting.map((row) => row.fromId.toHexString()));
      const duelIds = rows.filter((row) => row.type.startsWith("duel_")).map((row) => row.refId);
      const duelRows = duelIds.length ? await duels(db).find({ _id: { $in: duelIds } }).toArray() : [];
      const duelsById = new Map(duelRows.map((duel) => [duel._id.toHexString(), duel]));
      const shownDuels = new Map(duelViews.map((view) => [view.id, view]));

      const out = [];
      for (const row of rows) {
        const actor = actors.get(row.actorId.toHexString());
        if (!actor || blocked.has(row.actorId.toHexString())) {
          continue;
        }
        const item = {
          id: row._id.toHexString(),
          type: row.type,
          createdAt: row.createdAt.toISOString(),
          actor: personView(actor)
        };
        if (row.type === "follow_request") {
          item.pending = stillAsking.has(row.actorId.toHexString());
        }
        // Kudos for a moment says which: `{ kind, title }`, as the post was.
        if (row.type === "kudos" && row.about) {
          item.about = { kind: row.about.kind, title: row.about.title };
        }
        if (row.type.startsWith("duel_")) {
          const key = row.refId?.toHexString();
          const duel = duelsById.get(key);
          if (!duel) {
            continue; // expired or deleted
          }
          item.duel = shownDuels.get(key) ?? duelView(duel, meId, actors);
          // A declined invite still shows, so the inbox reads as history.
          if (duel.status === "declined") {
            item.duel = { ...item.duel, status: "declined" };
          }
        }
        out.push(item);
      }
      response.json({ events: out, now: new Date().toISOString() });
    })
  );

  /**
   * Shared profiles whose handle starts with `?q=`. At most ten.
   *
   * A reader who shares with followers only is found like any other, as a
   * locked card: `locked: true`, and no minutes or streak (sent as 0, so an
   * app from before `locked` existed still has numbers to draw). Signed in,
   * the cards of the readers who have accepted the reader's follow, and their
   * own, are not locked.
   */
  router.get(
    "/search",
    maybeAuth,
    asyncHandler(async (request, response) => {
      searches(`ip:${request.ip ?? "unknown"}`);
      const q = cleanHandle(request.query.q);
      // Only handle characters, so the anchored prefix is safe as a regex and
      // is served by the handle index (which is why it says the handle is a
      // string: see `asString`).
      if (!/^[a-z0-9_-]{1,24}$/.test(q)) {
        response.json({ results: [] });
        return;
      }
      const weekKey = askedWeek(request.query.week);
      const rows = await profiles(db)
        .find(
          { handle: asString(q, { $regex: `^${q}` }), visibility: { $in: SOCIAL } },
          { projection: { handle: 1, displayName: 1, avatar: 1, visibility: 1, weekKey: 1, weekMinutes: 1, streak: 1 }, sort: { handle: 1 }, limit: SEARCH_LIMIT }
        )
        .toArray();
      const meId = request.account?.id ?? null;
      // A reader who has blocked the one searching is not found by them.
      const gone =
        meId && rows.length
          ? await blocks(db)
              .find({ blockerId: { $in: rows.map((row) => row._id) }, blockedId: meId }, { projection: { blockerId: 1 } })
              .toArray()
          : [];
      const unseen = new Set(gone.map((row) => row.blockerId.toHexString()));
      const found = rows.filter((row) => isSocial(row) && !unseen.has(row._id.toHexString()));
      const closed = found.filter((row) => row.visibility === "followers" && !(meId && row._id.equals(meId)));
      // One query for all of them, not one each.
      const accepted =
        meId && closed.length
          ? await follows(db)
              .find({ followerId: meId, followeeId: { $in: closed.map((row) => row._id) } }, { projection: { followeeId: 1 } })
              .toArray()
          : [];
      const open = new Set(accepted.map((row) => row.followeeId.toHexString()));
      response.json({
        results: found.map((row) => {
          const locked = closed.includes(row) && !open.has(row._id.toHexString());
          return {
            ...personView(row),
            visibility: row.visibility,
            locked,
            weekMinutes: locked ? 0 : minutesFor(row, weekKey),
            streak: locked ? 0 : row.streak ?? 0
          };
        })
      });
    })
  );

  return router;
}
