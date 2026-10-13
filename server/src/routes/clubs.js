import { Router } from "express";
import { randomInt } from "node:crypto";
import { requireAccount } from "../auth.js";
import { PERSON_FIELDS, isSocial, leaveClubs, minutesFor, personView, socialProfilesById } from "../community.js";
import { clubs, profiles } from "../db.js";
import { HttpError, asyncHandler, smallJson } from "../http.js";
import { listOf, optionalText, record, requiredText, wholeNumber } from "../input.js";
import { defaultLimits } from "../rateLimit.js";
import { askedWeek, limiter, objectId, socialSelf } from "../readers.js";

/**
 * Book clubs: a few readers, a list of books, and a weekly goal in minutes.
 *
 * A club is joined with its code, which a member passes on outside the app.
 * Members see each other's name, Pip and minutes for the week whatever their
 * follows, a followers-only reader's included: joining is the consent, since
 * that is all a club is, and nothing else of a profile is shown through one.
 *
 * Only a reader who shares a profile can make, join or change a club. One who
 * goes private stays a member but is left out of the list, and is shown no
 * clubs, until they share again: they see nobody's minutes while nobody sees
 * theirs.
 */

const CLUBS_PER_READER = 10;
const CLUB_SIZE = 50;
const CLUB_BOOKS = 50;
/** Minutes in a week: a goal cannot ask for more. */
const MAX_GOAL = 7 * 24 * 60;
// The letters and digits of a reset code, for the same reason: none of them
// is easily read as another (no 0/O, 1/I/L, U/V). 29^8 is about 5e11 codes,
// far more than the write limit lets anyone try.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
const CODE_LENGTH = 8;
const NO_SUCH_CLUB = "No such club.";

function newCode() {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** A code as typed: any case, with or without spaces or dashes. */
const cleanCode = (value) => (typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

const cleanBook = (value) => {
  const book = record(value, "A book");
  return {
    title: requiredText(book.title, 160, "A book's title"),
    author: optionalText(book.author, 80, "A book's author")
  };
};

/** Two titles are the same book when they differ only in case. */
const titleKey = (book) => book.title.toLowerCase();

export function clubRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const writes = limiter(limits.social ?? defaultLimits().social);
  const limitWrite = (request) => writes(`acct:${request.account.id}`);

  /**
   * Clubs as `meId` sees them, with one query for all their members.
   *
   * Members are ordered as the board is: most minutes in the asked week
   * first, then by handle. One who has gone private is left out.
   */
  async function views(rows, meId, weekKey) {
    // A member is shown by name and this week's minutes: not the whole of each profile.
    const byId = await socialProfilesById(db, rows.flatMap((club) => club.memberIds), {}, { ...PERSON_FIELDS, weekKey: 1, weekMinutes: 1 });
    return rows.map((club) => ({
      id: club._id.toHexString(),
      name: club.name,
      code: club.code,
      goalMinutes: club.goalMinutes ?? 0,
      books: (club.books ?? []).map((book) => ({ title: book.title, author: book.author ?? null })),
      isOwner: Boolean(club.ownerId?.equals(meId)),
      members: club.memberIds
        .map((id) => byId.get(id.toHexString()))
        .filter(Boolean)
        .map((member) => ({
          ...personView(member),
          weekMinutes: minutesFor(member, weekKey),
          isYou: member._id.equals(meId)
        }))
        .sort((a, b) => b.weekMinutes - a.weekMinutes || a.handle.localeCompare(b.handle))
    }));
  }

  const view = async (club, request) =>
    (await views([club], request.account.id, askedWeek(request.query.week)))[0];

  /** The club with that id, if the reader is in it; else a 404, as for one that is not there. */
  async function memberClub(request) {
    const id = objectId(request.params.id);
    const club = id ? await clubs(db).findOne({ _id: id, memberIds: request.account.id }) : null;
    if (!club) {
      throw new HttpError(404, NO_SUCH_CLUB);
    }
    return club;
  }

  const countClubs = (userId) => clubs(db).countDocuments({ memberIds: userId });
  const tooManyClubs = () => new HttpError(409, `You can be in up to ${CLUBS_PER_READER} clubs.`);

  /** Starts a club, with the reader as its owner and first member. */
  router.post(
    "/clubs",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const body = request.body ?? {};
      const name = requiredText(body.name, 60, "name");
      const goalMinutes = body.goalMinutes === undefined ? 0 : wholeNumber(body.goalMinutes, 0, MAX_GOAL, "goalMinutes");
      const me = await socialSelf(db, request.account.id);
      if ((await countClubs(me._id)) >= CLUBS_PER_READER) {
        throw tooManyClubs();
      }

      const club = { name, code: null, ownerId: me._id, memberIds: [me._id], goalMinutes, books: [], createdAt: new Date() };
      // A code already in use is refused by the unique index; another is
      // drawn. (Not "until the club has an id": the driver gives it one
      // before it is sent, whether or not the insert then goes through.)
      for (let attempt = 0, made = false; !made; attempt += 1) {
        club.code = newCode();
        try {
          await clubs(db).insertOne(club);
          made = true;
        } catch (error) {
          if (error?.code !== 11000 || attempt >= 4) {
            throw error;
          }
        }
      }
      // Counted again with this club in place, as for duels: several made at
      // the same moment each saw room.
      if ((await countClubs(me._id)) > CLUBS_PER_READER) {
        await clubs(db).deleteOne({ _id: club._id });
        throw tooManyClubs();
      }
      response.status(201).json({ club: await view(club, request) });
    })
  );

  /**
   * The reader's clubs, oldest first, each with its members' minutes for
   * `?week=`. A reader who does not share a profile is shown none (an empty
   * list, not an error: nothing they asked to do is being refused).
   */
  router.get(
    "/clubs",
    auth,
    asyncHandler(async (request, response) => {
      const meId = request.account.id;
      const me = await profiles(db).findOne({ _id: meId }, { projection: { handle: 1, visibility: 1 } });
      const rows = isSocial(me)
        ? await clubs(db).find({ memberIds: meId }, { sort: { createdAt: 1 }, limit: CLUBS_PER_READER }).toArray()
        : [];
      response.json({ clubs: await views(rows, meId, askedWeek(request.query.week)) });
    })
  );

  /** Joins the club with that code. Joining one the reader is already in changes nothing. */
  router.post(
    "/clubs/join",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const code = cleanCode(request.body?.code);
      const me = await socialSelf(db, request.account.id);
      const found = code.length === CODE_LENGTH ? await clubs(db).findOne({ code }) : null;
      if (!found) {
        throw new HttpError(404, "No club with that code.");
      }
      const isMember = (club) => club.memberIds.some((id) => id.equals(me._id));
      if (!isMember(found)) {
        if ((await countClubs(me._id)) >= CLUBS_PER_READER) {
          throw tooManyClubs();
        }
        // One update that only goes through while there is a free place, so
        // two readers taking the last one cannot both get it.
        await clubs(db).updateOne(
          { _id: found._id, memberIds: { $ne: me._id }, [`memberIds.${CLUB_SIZE - 1}`]: { $exists: false } },
          { $push: { memberIds: me._id } }
        );
        if ((await countClubs(me._id)) > CLUBS_PER_READER) {
          await leaveClubs(db, me._id, [found._id]);
          throw tooManyClubs();
        }
      }
      const club = await clubs(db).findOne({ _id: found._id });
      if (!club) {
        throw new HttpError(404, "No club with that code.");
      }
      if (!isMember(club)) {
        throw new HttpError(409, `That club is full: a club holds ${CLUB_SIZE} readers.`);
      }
      response.json({ club: await view(club, request) });
    })
  );

  /**
   * Leaves a club. When the owner leaves, the club goes to the member who has
   * been in it longest; when the last member leaves, it is deleted.
   */
  router.post(
    "/clubs/:id/leave",
    auth,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const id = objectId(request.params.id);
      const left = id ? await leaveClubs(db, request.account.id, [id]) : 0;
      if (!left) {
        throw new HttpError(404, NO_SUCH_CLUB);
      }
      response.json({ left: true });
    })
  );

  /** Changes the club's name, goal or whole book list. Its owner only. */
  router.put(
    "/clubs/:id",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const body = request.body ?? {};
      const update = {};
      if (body.name !== undefined) {
        update.name = requiredText(body.name, 60, "name");
      }
      if (body.goalMinutes !== undefined) {
        update.goalMinutes = wholeNumber(body.goalMinutes, 0, MAX_GOAL, "goalMinutes");
      }
      if (body.books !== undefined) {
        // Each title once, as when they are added one at a time.
        const byTitle = new Map();
        for (const book of listOf(body.books, CLUB_BOOKS, "books").map(cleanBook)) {
          if (!byTitle.has(titleKey(book))) {
            byTitle.set(titleKey(book), book);
          }
        }
        update.books = [...byTitle.values()];
      }
      const me = await socialSelf(db, request.account.id);
      const club = await memberClub(request);
      if (!club.ownerId?.equals(me._id)) {
        throw new HttpError(403, "Only the club's owner can change it.");
      }
      if (Object.keys(update).length > 0) {
        // Still the owner as it is written: they may have left a moment ago.
        const { matchedCount } = await clubs(db).updateOne({ _id: club._id, ownerId: me._id }, { $set: update });
        if (!matchedCount) {
          throw new HttpError(404, NO_SUCH_CLUB);
        }
      }
      response.json({ club: await view({ ...club, ...update }, request) });
    })
  );

  /** Adds a book to the club's list. Any member may. */
  router.post(
    "/clubs/:id/books",
    auth,
    smallJson,
    asyncHandler(async (request, response) => {
      limitWrite(request);
      const book = cleanBook(request.body ?? {});
      await socialSelf(db, request.account.id);
      const club = await memberClub(request);
      const books = club.books ?? [];
      if (books.some((other) => titleKey(other) === titleKey(book))) {
        throw new HttpError(409, "That book is already on the club's list.");
      }
      if (books.length >= CLUB_BOOKS) {
        throw new HttpError(409, `A club's list holds ${CLUB_BOOKS} books.`);
      }
      // Added only to the list that was just checked: if another member added
      // one meanwhile, the list is a different length and nothing is written,
      // so two adding at once cannot slip in a duplicate or a fifty-first.
      const { matchedCount } = await clubs(db).updateOne(
        { _id: club._id, memberIds: request.account.id, books: { $size: books.length } },
        { $push: { books: book } }
      );
      if (!matchedCount) {
        throw new HttpError(409, "The club's list just changed. Try that again.");
      }
      response.json({ club: await view({ ...club, books: [...books, book] }, request) });
    })
  );

  return router;
}
