import { Router } from "express";
import { isDeepStrictEqual } from "node:util";
import { requireAccount } from "../auth.js";
import { accounts, profiles } from "../db.js";
import { avatarView } from "../avatars.js";
import { HttpError, asyncHandler, plainText, smallJson } from "../http.js";
import { listOf, optionalText, record, requiredText, wholeNumber } from "../input.js";
import { isPlausibleDayKey, isWeekKey, plausibleWeekKeys } from "../week.js";
import { SOCIAL, acceptAllRequests, deleteCommunityData, deleteSharedData, isKudosBadge, leavePublic, recordDuelMinutes } from "../community.js";
import { isAdmin, suspendedUntil } from "../standing.js";
import { forgetBoards } from "../boardCache.js";
import { defaultLimits } from "../rateLimit.js";
import { limiter } from "../readers.js";

/**
 * A reader's own profile: the numbers the board ranks on and the shelf they
 * chose to show. The public side (the board, other readers' profiles, follows,
 * kudos and duels) is in `community.js`.
 *
 * Nothing is shared unless a request says so. A profile starts `private`,
 * appears on no board and is readable by nobody, until a save carries
 * `visibility: "public"` (everybody) or `"followers"` (the readers whose
 * follow it accepts). Since 1.2 the app sends `public` straight after sign-up
 * unless the reader turned "Share my profile" off on the form; this server
 * never makes that choice itself, and never changes one already made, so
 * every profile that was private stays private.
 */

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$/;
/** Handles that could be mistaken for the app, its staff or its mascot. */
export const RESERVED_HANDLES = new Set([
  "admin", "administrator", "root", "system", "moderator", "mod", "staff",
  "leaflet", "leafletapp", "leaflet-app", "leaflet_app", "official", "team",
  "support", "help", "helpdesk", "security", "privacy", "legal", "abuse",
  "contact", "info", "news", "api", "www", "mail", "noreply", "no-reply",
  "pip", "paperkite", "me", "you", "null", "undefined", "anonymous", "everyone"
]);

const MAX_SHELF = 12;
/** Minutes in a week. A reader cannot have read more than that in one. */
const MAX_WEEK_MINUTES = 7 * 24 * 60;
/** A century of days; anything larger is not a real streak. */
const MAX_STREAK = 36_500;
const MAX_BOOKS_FINISHED = 100_000;

const MAX_LEVEL = 999;
const MAX_BADGES = 80;
const BADGE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** The arcade's games, and a best score no real game reaches. */
const ARCADE_GAMES = ["dash", "catch", "flap"];
const MAX_ARCADE_SCORE = 10_000_000;
/**
 * Pip's camp in the Hollow, the arcade's building game: its six buildings and
 * the level each stops at, what a plot of the yard can hold, and counts no
 * real camp reaches.
 */
const CAMP_BUILDINGS = ["burrow", "oak", "store", "fence", "tower", "hut"];
const MAX_CAMP_LEVEL = 5;
const CAMP_YARD_KINDS = ["workshop", "hive", "well", "stall"];
const MAX_CAMP_YARD = 2;
const MAX_CAMP_YARD_LEVEL = 3;
const MAX_CAMP_COUNT = 100_000;
/**
 * How a camp is laid out: the seven things that stand somewhere, the clearing
 * they stand in (the art's own pixels), the most pieces of fence and things
 * set down a camp has, and how many kinds of thing there are.
 */
const CAMP_PLACED = ["burrow", "oak", "store", "tower", "hut", "yard0", "yard1"];
const CAMP_SCENE_WIDTH = 240;
const CAMP_SCENE_HEIGHT = 120;
const MAX_CAMP_WALLS = 32;
const MAX_CAMP_DECOR = 24;
const CAMP_DECOR_KINDS = 18;
/**
 * What else stands about a camp: the most pieces of landscape (ponds, a
 * knoll, trees) and defences it has, how many kinds of each there are, the
 * posts a guardian can stand at, the rank one stops at, and the guardian
 * with no signpost on the ground (the dragon keeps to the larder's roof).
 */
const MAX_CAMP_LAND = 30;
const CAMP_LAND_KINDS = 10;
const MAX_CAMP_WORKS = 12;
const CAMP_WORK_KINDS = 12;
const CAMP_GUARD_POSTS = 7;
const MAX_CAMP_GUARD_RANK = 3;
const CAMP_GUARD_NO_POST = 4;

/** What a reader publishes about their reading, as opposed to who they are. */
const FIGURES = ["weekKey", "weekMinutes", "streak", "booksFinished", "shelf", "readDay", "reading", "level", "badges", "arcade", "camp"];
const NO_FIGURES = {
  weekKey: null,
  weekMinutes: 0,
  streak: 0,
  booksFinished: 0,
  shelf: [],
  readDay: null,
  reading: null,
  level: null,
  badges: [],
  arcade: null,
  camp: null
};

/**
 * What of a profile `ownView` reads, and nothing else: the reads answered
 * with it ask for only this. A reader's own profile is fetched on every save
 * of their figures, which an open app makes every minute or few, so it was
 * the largest part of what the server took from the database. Left out are
 * what the view does not show (when it was saved, the avatar's copy, the
 * day last read) and the two lists of readers behind the kudos counts, which
 * come back as their lengths: two numbers where there were twenty ids.
 */
const OWN_VIEW = {
  _id: 0,
  handle: 1,
  displayName: 1,
  visibility: 1,
  weekKey: 1,
  weekMinutes: 1,
  streak: 1,
  booksFinished: 1,
  shelf: 1,
  reading: 1,
  level: 1,
  badges: 1,
  arcade: 1,
  camp: 1,
  shareLibrary: 1,
  raidable: 1,
  rulesAcceptedAt: 1,
  role: 1,
  suspendedUntil: 1,
  kudosFrom: { $size: { $ifNull: ["$kudosFrom", []] } },
  kudosTo: { $size: { $ifNull: ["$kudosTo", []] } }
};

/** A list of readers' ids as `OWN_VIEW` reads it (its length), or as it is stored. */
const howMany = (ids) => (typeof ids === "number" ? ids : ids?.length ?? 0);

function ownView(profile) {
  return {
    handle: profile?.handle ?? null,
    displayName: profile?.displayName ?? null,
    visibility: profile?.visibility ?? "private",
    weekKey: profile?.weekKey ?? null,
    weekMinutes: Math.round(profile?.weekMinutes ?? 0),
    streak: profile?.streak ?? 0,
    booksFinished: profile?.booksFinished ?? 0,
    shelf: profile?.shelf ?? [],
    reading: profile?.reading ?? null,
    level: profile?.level ?? null,
    badges: profile?.badges ?? [],
    arcade: profile?.arcade ?? null,
    camp: profile?.camp ?? null,
    // How many different readers have sent this one kudos, and how many this
    // one has sent kudos to, up to KUDOS_BADGE_AT: how near the two kudos
    // badges are. The counts only; the ids they are counted from stay here.
    kudosFrom: howMany(profile?.kudosFrom),
    kudosTo: howMany(profile?.kudosTo),
    sharesLibrary: profile?.shareLibrary === true,
    // Whether friends may raid the camp (`routes/raids.js`): no, until the
    // reader says yes (since app 1.5.10; it was yes until they said no). A
    // reader who never touched the switch has no `raidable` at all.
    raidable: profile?.raidable === true,
    // Where the reader stands for posting in public (`standing.js`): whether
    // they have accepted the guidelines, and until when an admin has
    // suspended them, if one has. `isAdmin` only tells the app to show the
    // admin's screens; every admin route checks for itself.
    rulesAccepted: profile?.rulesAcceptedAt instanceof Date,
    isAdmin: isAdmin(profile),
    suspendedUntil: suspendedUntil(profile)?.toISOString() ?? null
  };
}

/** The book a reader is in the middle of: `{ title, author, percent }`, or null for none. */
function sanitiseReading(reading) {
  if (reading === null) {
    return null;
  }
  const book = record(reading, "reading");
  return {
    title: requiredText(book.title, 120, "reading.title"),
    author: optionalText(book.author, 80, "reading.author"),
    percent: wholeNumber(book.percent, 0, 100, "reading.percent")
  };
}

/**
 * Badge ids, each once, in the order sent. A kudos badge (`kudos-…`) is
 * dropped, not refused: only this server says one is earned (`kudosBadges`),
 * and an app that sends back the badges it was shown is not wrong to.
 */
function sanitiseBadges(badges) {
  const seen = new Set();
  for (const badge of listOf(badges, MAX_BADGES, "badges")) {
    if (typeof badge !== "string" || !BADGE_PATTERN.test(badge)) {
      throw new HttpError(400, "A badge is a short id: lower-case letters, numbers and hyphens.");
    }
    if (!isKudosBadge(badge)) {
      seen.add(badge);
    }
  }
  return [...seen];
}

/** Best scores, one per game; a game left out is 0, and one not in the arcade is dropped. */
function sanitiseArcade(arcade) {
  const scores = record(arcade, "arcade");
  return Object.fromEntries(
    ARCADE_GAMES.map((game) => [
      game,
      scores[game] === undefined ? 0 : wholeNumber(scores[game], 0, MAX_ARCADE_SCORE, `arcade.${game}`)
    ])
  );
}

/** A whole number brought into [0, max], or null for anything that is not one. */
function campWhole(value, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(0, value)) : null;
}

/** A place in the clearing, `[x, y]`, brought inside the scene; null for what is not a pair of whole numbers. */
function campSpot(spot) {
  if (!Array.isArray(spot)) {
    return null;
  }
  const x = campWhole(spot[0], CAMP_SCENE_WIDTH);
  const y = campWhole(spot[1], CAMP_SCENE_HEIGHT);
  return x === null || y === null ? null : [x, y];
}

/**
 * One thing that stands somewhere, `{kind, x, y}`; null for what is not one,
 * or is of a kind there is not (`kinds` of them, from 0).
 */
function campThing(thing, kinds) {
  if (typeof thing !== "object" || thing === null || Array.isArray(thing)) {
    return null;
  }
  const x = campWhole(thing.x, CAMP_SCENE_WIDTH);
  const y = campWhole(thing.y, CAMP_SCENE_HEIGHT);
  const known = Number.isInteger(thing.kind) && thing.kind >= 0 && thing.kind < kinds;
  return known && x !== null && y !== null ? { kind: thing.kind, x, y } : null;
}

/**
 * The rank of the guardian at each of the seven posts, 0 for a post with
 * none: always all seven, a rank that cannot be read as 0 and one past the
 * top as the top. Null for what is not a list, or has no guardian posted.
 */
function campGuards(guards) {
  if (!Array.isArray(guards)) {
    return null;
  }
  const ranks = Array.from({ length: CAMP_GUARD_POSTS }, (_, post) => campWhole(guards[post], MAX_CAMP_GUARD_RANK) ?? 0);
  return ranks.some((rank) => rank > 0) ? ranks : null;
}

/**
 * Where each guardian's signpost was carried to, one entry for each of the
 * seven in their order: a place brought inside the scene, or null for a post
 * that was never moved (the app stands it beside the guardian's building).
 * Null as well for the dragon, who has no post, for a guardian not posted
 * (`ranks`, as `campGuards` reads them), and for a place that cannot be
 * read. Null for the lot if it is not a list of seven, or none of the seven
 * is somewhere.
 */
function campPosts(posts, ranks) {
  if (!Array.isArray(posts) || posts.length !== CAMP_GUARD_POSTS || ranks === null) {
    return null;
  }
  const moved = Array.from({ length: CAMP_GUARD_POSTS }, (_, guard) =>
    guard !== CAMP_GUARD_NO_POST && ranks[guard] > 0 ? campSpot(posts[guard]) : null
  );
  return moved.some((post) => post !== null) ? moved : null;
}

/** The first `max` entries of a list that `read` can make something of. */
function campFirst(list, max, read) {
  const kept = [];
  for (const entry of list) {
    if (kept.length >= max) {
      break;
    }
    const made = read(entry);
    if (made !== null) {
      kept.push(made);
    }
  }
  return kept;
}

/**
 * How the camp is laid out, for a friend's card to draw it as it is: `spots`
 * (where each building stands), `walls` (each piece of fence), `decor`
 * (each thing set down), `land` (each piece of the landscape), `works`
 * (each defence), `guards` (the rank of the guardian at each post) and
 * `posts` (where each guardian's signpost was carried to).
 *
 * Unlike the rest of the camp this is never refused. An app from before the
 * layout sends none of it, and a camp reads well enough without: a part that
 * is not what it should be is left out, an entry that is not is dropped from
 * its list, a place outside the clearing is brought to its edge, a second
 * defence of a kind is dropped, and a list is cut to what a camp can hold.
 * The app draws what is missing as a camp begins. `guards` is seven ranks or
 * left out: a short list is filled out with 0, and one with no guardian
 * posted says nothing. `posts` is seven places or nulls, or left out: a post
 * that cannot be read is null (the app stands it beside its building), and
 * a list that is not seven long, or with no post moved, says nothing.
 */
function campLayout(sent) {
  const layout = {};
  const { spots, walls, decor, land, works } = sent;
  if (typeof spots === "object" && spots !== null && !Array.isArray(spots)) {
    const placed = CAMP_PLACED.map((site) => [site, campSpot(spots[site])]).filter(([, spot]) => spot !== null);
    if (placed.length > 0) {
      layout.spots = Object.fromEntries(placed);
    }
  }
  if (Array.isArray(walls)) {
    layout.walls = campFirst(walls, MAX_CAMP_WALLS, campSpot);
  }
  if (Array.isArray(decor)) {
    layout.decor = campFirst(decor, MAX_CAMP_DECOR, (thing) => campThing(thing, CAMP_DECOR_KINDS));
  }
  if (Array.isArray(land)) {
    layout.land = campFirst(land, MAX_CAMP_LAND, (piece) => campThing(piece, CAMP_LAND_KINDS));
  }
  if (Array.isArray(works)) {
    // One defence of a kind at most: a second of a kind is dropped, and the first kept.
    const kinds = new Set();
    layout.works = campFirst(works, MAX_CAMP_WORKS, (work) => {
      const made = campThing(work, CAMP_WORK_KINDS);
      if (made === null || kinds.has(made.kind)) {
        return null;
      }
      kinds.add(made.kind);
      return made;
    });
  }
  const guards = campGuards(sent.guards);
  if (guards !== null) {
    layout.guards = guards;
  }
  const posts = campPosts(sent.posts, guards);
  if (posts !== null) {
    layout.posts = posts;
  }
  return layout;
}

/**
 * Pip's camp as its reader shows it, or null for none: the level of each
 * building, what stands on each plot of the yard, three counts (magpie
 * camps beaten, banners, trophies), and where things stand (`campLayout`).
 *
 * Every part but the layout has to be there and in range, as the app sends
 * it. What is kept is built from those parts alone, so anything else sent
 * beside them (the books behind the trophies, say) is never stored.
 */
function sanitiseCamp(camp) {
  if (camp === null) {
    return null;
  }
  const sent = record(camp, "camp");
  const levels = record(sent.levels, "camp.levels");
  return {
    levels: Object.fromEntries(
      CAMP_BUILDINGS.map((name) => [name, wholeNumber(levels[name], 0, MAX_CAMP_LEVEL, `camp.levels.${name}`)])
    ),
    yard: listOf(sent.yard, MAX_CAMP_YARD, "camp.yard").map((plot) => {
      const { kind, level } = record(plot, "A plot of camp.yard");
      // An empty plot is `null`; a thing this server does not know is refused.
      if (kind !== null && !CAMP_YARD_KINDS.includes(kind)) {
        throw new HttpError(400, `A plot of camp.yard holds one of ${CAMP_YARD_KINDS.join(", ")}, or null.`);
      }
      return { kind, level: wholeNumber(level, 0, MAX_CAMP_YARD_LEVEL, "camp.yard level") };
    }),
    camps: wholeNumber(sent.camps, 0, MAX_CAMP_COUNT, "camp.camps"),
    banners: wholeNumber(sent.banners, 0, MAX_CAMP_COUNT, "camp.banners"),
    trophies: wholeNumber(sent.trophies, 0, MAX_CAMP_COUNT, "camp.trophies"),
    ...campLayout(sent)
  };
}

function sanitiseShelf(shelf) {
  if (!Array.isArray(shelf)) {
    throw new HttpError(400, "Shelf should be a list.");
  }
  return shelf.slice(0, MAX_SHELF).map((book) => ({
    title: plainText(book?.title ?? "", 120),
    author: book?.author ? plainText(book.author, 80) || null : null,
    // Drives the spine's look. Deterministic, so no image is ever uploaded.
    styleSeed: String(book?.styleSeed ?? "").slice(0, 64)
  }));
}

/** A finite number in [0, max], or a 400. */
function bounded(value, max, name, integer) {
  const number = Number(value);
  if (typeof value !== "number" || !Number.isFinite(number) || number < 0 || number > max) {
    throw new HttpError(400, `${name} must be a number between 0 and ${max}.`);
  }
  return integer ? Math.trunc(number) : number;
}

export function handleProblem(handle) {
  if (!HANDLE_PATTERN.test(handle)) {
    return "Handles are 3–24 characters: letters, numbers, hyphens and underscores.";
  }
  if (RESERVED_HANDLES.has(handle)) {
    return "That handle is reserved. Try another.";
  }
  return null;
}

/**
 * Whether a save says nothing the profile held does not say already: every
 * part it names (but for when it was sent) is what is held. A part held as
 * nothing and sent as `null` is the same.
 */
function saysNothingNew(held, update) {
  return Object.entries(update).every(([name, value]) => name === "updatedAt" || isDeepStrictEqual(held[name] ?? null, value ?? null));
}

/** What a save can read of the profile first: what the answer shows, and two parts it does not. */
const HELD_VIEW = { ...OWN_VIEW, avatar: 1, readDay: 1 };

/**
 * What every save reads of the profile held, whatever it names: who sees
 * it, the standing and the kudos counts the answer shows, the handle and
 * name, and the avatar's copy. A few hundred bytes.
 */
const HELD_ALWAYS = Object.fromEntries(Object.entries(HELD_VIEW).filter(([name]) => !FIGURES.includes(name)));

/**
 * What a save reads of the profile held: `HELD_ALWAYS`, and each of the
 * figures it names, to tell whether they moved. A figure it leaves out is
 * neither read nor answered with.
 *
 * Since 1.5.12 the app names only the figures that moved since it last
 * sent them (and all of them every six hours), so most saves are a few
 * numbers: reading the whole profile for each (the camp alone is about
 * 3 KB) was most of what a save took out of the database. An app before
 * 1.5.12 names every figure, is read for every one, and is answered in full
 * as before; so is a save that names none (a new name, a switch), which is
 * the reader's own doing and rare, and which an older app may show from.
 */
export function heldViewFor(names) {
  const named = FIGURES.filter((name) => names.includes(name));
  if (named.length === 0) {
    return HELD_VIEW;
  }
  return { ...HELD_ALWAYS, ...Object.fromEntries(named.map((name) => [name, 1])) };
}

/**
 * The profile as the answer to a save shows it: `ownView`, without the
 * figures the save neither named nor had read (`read`, the projection it
 * was read with). Those are as they were, and an app that left them out
 * knows what they are; leaving them out, rather than sending them as
 * nothing, keeps the answer true.
 */
function answerOf(profile, read) {
  const view = ownView(profile);
  for (const name of FIGURES) {
    if (!(name in read) && name in view) {
      delete view[name];
    }
  }
  return view;
}

/**
 * What a save asks back of the profile it has just written: only what
 * another request may have changed since it was read (who sees it, the
 * standing, the kudos counts). The rest the save has just read or set, so
 * nothing as large as the camp or the shelf comes back from the database.
 */
const FRESH_AFTER_SAVE = Object.fromEntries(Object.entries(HELD_ALWAYS).filter(([name]) => name !== "avatar"));

/**
 * The parts of a save the profile does not hold already, to `$set`. A save
 * names every part the app has (the camp alone is a few kilobytes), and most
 * of them are as they were: only what moved is written (sync audit C8). A
 * part the profile was not read for (`read`, the projection) is always
 * written.
 */
export function changedParts(held, update, read = HELD_VIEW) {
  return Object.fromEntries(
    Object.entries(update).filter(
      ([name, value]) => name === "updatedAt" || !(name in read) || !isDeepStrictEqual(held[name] ?? null, value ?? null)
    )
  );
}

export function socialRoutes(db, limits = defaultLimits()) {
  const router = Router();
  const auth = requireAccount(db);
  const saves = limiter(limits.profile ?? defaultLimits().profile);
  /** Counted before the body is read, as an upload of the library is. */
  const limitSave = (request, _response, next) => {
    saves(`acct:${request.account.id}`);
    next();
  };

  router.get(
    "/profile/me",
    auth,
    asyncHandler(async (request, response) => {
      response.json(ownView(await profiles(db).findOne({ _id: request.account.id }, { projection: OWN_VIEW })));
    })
  );

  /**
   * Publishes the numbers the board ranks on, plus the shelf.
   *
   * Self-reported: the server cannot read inside the state blob by design.
   * Bounded so one client cannot park an impossible number on the board.
   */
  router.put(
    "/profile/me",
    auth,
    limitSave,
    smallJson,
    asyncHandler(async (request, response) => {
      const body = request.body ?? {};
      const update = { updatedAt: new Date() };

      if (body.displayName !== undefined) {
        update.displayName = body.displayName === null ? null : plainText(body.displayName, 40) || null;
      }
      if (body.handle !== undefined) {
        // Handles are shown with an "@" and stored without one.
        const handle = body.handle === null ? "" : String(body.handle).trim().toLowerCase().replace(/^@/, "");
        if (handle) {
          const problem = handleProblem(handle);
          if (problem) {
            throw new HttpError(400, problem);
          }
        }
        update.handle = handle || null;
      }
      if (body.visibility !== undefined) {
        // Anything that is not one of the two ways of sharing is private: a
        // value this server does not know must never share more than was meant.
        update.visibility = SOCIAL.includes(body.visibility) ? body.visibility : "private";
      }
      if (body.shareLibrary !== undefined) {
        // A switch, like visibility: whether the readers who follow this one
        // may ask for their library (`routes/library.js`). Kept whatever the
        // visibility, as the handle is, for when they share again.
        if (typeof body.shareLibrary !== "boolean") {
          throw new HttpError(400, "shareLibrary must be true or false.");
        }
        update.shareLibrary = body.shareLibrary;
      }
      if (body.raidable !== undefined) {
        // Another switch: whether friends may raid this reader's camp in the
        // Hollow (`routes/raids.js`). Off until it is turned on, and kept
        // whatever the visibility, as the library's is.
        if (typeof body.raidable !== "boolean") {
          throw new HttpError(400, "raidable must be true or false.");
        }
        update.raidable = body.raidable;
      }
      if (body.weekMinutes !== undefined) {
        // The client sums minutes over its own *local* ISO week, so it names
        // that week; the server only checks it is one a real clock could be in.
        if (!isWeekKey(body.weekKey) || !plausibleWeekKeys().has(body.weekKey)) {
          throw new HttpError(400, "weekKey must be the current ISO week, like 2026-W39.");
        }
        update.weekMinutes = bounded(body.weekMinutes, MAX_WEEK_MINUTES, "weekMinutes", false);
        update.weekKey = body.weekKey;
      }
      if (body.streak !== undefined) {
        update.streak = bounded(body.streak, MAX_STREAK, "streak", true);
      }
      if (body.booksFinished !== undefined) {
        update.booksFinished = bounded(body.booksFinished, MAX_BOOKS_FINISHED, "booksFinished", true);
      }
      if (body.shelf !== undefined) {
        update.shelf = sanitiseShelf(body.shelf);
      }
      if (body.readDay !== undefined) {
        // The reader's own local date on which they last read: what lets a
        // friend's Pip visit "on a day you both read" (`GET /v1/visitors`).
        // Named by the client like the week, and checked the same way; never
        // sent back to anyone as a date.
        if (body.readDay !== null && !isPlausibleDayKey(body.readDay)) {
          throw new HttpError(400, "readDay must be today's local date, like 2026-09-27.");
        }
        update.readDay = body.readDay;
      }
      // What a profile can say beyond the board's numbers: the book being
      // read, and what the reader has earned in the app (level, badges, best
      // arcade scores, Pip's camp). Self-reported like the rest, and bounded
      // like it.
      if (body.reading !== undefined) {
        update.reading = sanitiseReading(body.reading);
      }
      if (body.level !== undefined) {
        update.level = wholeNumber(body.level, 0, MAX_LEVEL, "level");
      }
      if (body.badges !== undefined) {
        update.badges = sanitiseBadges(body.badges);
      }
      if (body.arcade !== undefined) {
        update.arcade = sanitiseArcade(body.arcade);
      }
      if (body.camp !== undefined) {
        update.camp = sanitiseCamp(body.camp);
      }
      // The avatar belongs to the account (it is picked at signup, before any
      // profile exists); the profile keeps a copy for the board to show.
      // With it, when the save does not choose who sees the profile, the
      // profile as it is held: see "says nothing new" below. As much of it
      // as the answer shows, and the two parts a save can say that it does
      // not (the avatar's copy, the day last read), to tell whether it does.
      // Of the figures, only those the save names (`heldViewFor`).
      const read = heldViewFor(Object.keys(update));
      const [account, held] = await Promise.all([
        accounts(db).findOne({ _id: request.account.id }, { projection: { avatar: 1, suspendedUntil: 1 } }),
        update.visibility === undefined
          ? profiles(db).findOne({ _id: request.account.id }, { projection: read })
          : null
      ]);
      update.avatar = avatarView(account?.avatar);
      // A suspension is kept on the account as well, so that deleting the
      // profile and making another does not end it early.
      if (account?.suspendedUntil instanceof Date && account.suspendedUntil > new Date()) {
        update.suspendedUntil = account.suspendedUntil;
      }

      // The reading figures are kept for a shared profile only (public, or
      // with followers): that is the privacy policy's promise, and the app's
      // check (made on the device, from what it last heard) can be out of
      // date: a profile made private on another computer, or a publish
      // already on its way when the reader un-shared. So they are split off,
      // and saved only where the profile is shared once this request's own
      // choice has been applied.
      const figures = {};
      for (const name of FIGURES) {
        if (update[name] !== undefined) {
          figures[name] = update[name];
          delete update[name];
        }
      }
      // An open app sends its figures every few minutes, and every minute
      // while a book or the board is open, whether or not a page was read:
      // most saves say what the last one said. Such a save writes nothing
      // (it was four writes and two reads). Only for a save that leaves
      // visibility alone: one that names it is the reader's own doing, and
      // is carried out in full every time.
      if (held && saysNothingNew(held, { ...update, ...(SOCIAL.includes(held.visibility) ? figures : {}) })) {
        response.json(answerOf(held, read));
        return;
      }
      // The save an app makes of its own accord, to a profile that is shared:
      // everything it says goes in at once, and the profile comes back as it
      // then stands, in the one operation. (It was three: the rest of the
      // profile, then the figures if it was still shared, then a read of the
      // result.) Still only if the profile is shared at that moment; one
      // made private in between is no match, and is saved the long way below,
      // without its figures. What comes back from the database is only what
      // another request could have changed since the read (the visibility,
      // the kudos counts, the standing: `FRESH_AFTER_SAVE`): what the save
      // set is in `changes`, and the rest is what was just read. Sending
      // the camp back as well doubled what a save cost.
      // And only what moved is set: the rest the profile holds already.
      //
      // The board kept in memory is left alone (sync audit C3). Every save
      // that moved anything used to throw it away, and with a few hundred
      // apps saving every few minutes it was read from the database for
      // nearly every request. It now lasts its half minute: a reader's own
      // row is drawn by the app from the minutes on the device, and the
      // rest of the board may be that much behind. A choice of who sees
      // the profile (the long way, below) and a deletion still clear it at
      // once, so a reader who goes private leaves the board then.
      if (held && SOCIAL.includes(held.visibility)) {
        const changes = changedParts(held, { ...update, ...figures }, read);
        let saved;
        try {
          saved = await profiles(db).findOneAndUpdate(
            { _id: request.account.id, visibility: { $in: SOCIAL } },
            { $set: changes },
            { returnDocument: "after", projection: FRESH_AFTER_SAVE }
          );
        } catch (error) {
          if (error?.code === 11000) {
            throw new HttpError(409, "That handle is taken.");
          }
          throw error;
        }
        if (saved) {
          // A duel keeps each side's minutes as the profile has them, so
          // there is something to write there only when they have changed.
          if (figures.weekKey !== undefined && (figures.weekKey !== held.weekKey || figures.weekMinutes !== held.weekMinutes)) {
            await recordDuelMinutes(db, request.account.id, figures.weekKey, figures.weekMinutes);
          }
          response.json(answerOf({ ...held, ...saved, ...changes }, read));
          return;
        }
      }
      const shares = SOCIAL.includes(update.visibility);
      if (shares) {
        Object.assign(update, figures);
      } else if (update.visibility === "private") {
        // Going private takes the figures off the server, not just off the board.
        Object.assign(update, NO_FIGURES);
      }

      // `visibility` may only be in one of $set / $setOnInsert: naming it in
      // both is a Mongo conflict error, which is what broke every profile save.
      const operation = { $set: update };
      if (update.visibility === undefined) {
        operation.$setOnInsert = { visibility: "private" };
      }
      let figuresSaved = shares;
      try {
        await profiles(db).updateOne({ _id: request.account.id }, operation, { upsert: true });
        if (update.visibility === undefined && Object.keys(figures).length > 0) {
          // No choice in this request: the figures go in only if the profile
          // is shared at the moment they are written.
          const { matchedCount } = await profiles(db).updateOne(
            { _id: request.account.id, visibility: { $in: SOCIAL } },
            { $set: figures }
          );
          figuresSaved = matchedCount > 0;
        }
        // Who sees the profile changed: the board and the visitors kept in
        // memory may show it where it is no longer shared, and go at once.
        // Any other save here is of a profile not on the board (one being
        // made, or a private one).
        if (update.visibility !== undefined) {
          forgetBoards();
        }
      } catch (error) {
        if (error?.code === 11000) {
          throw new HttpError(409, "That handle is taken.");
        }
        throw error;
      }
      if (update.visibility === "private") {
        // And with the figures go the library and the requests to follow
        // that were waiting. Posts stay stored and hidden, like follows.
        await deleteSharedData(db, request.account.id);
        await leavePublic(db, request.account.id);
      } else if (update.visibility === "followers") {
        // No longer public: out of the book communities, which are. What
        // they wrote there stays, unseen, for if they come back.
        await leavePublic(db, request.account.id);
      } else if (update.visibility === "public") {
        // Anyone may follow a public reader, so nobody is left waiting to be
        // let in: the requests made while it was followers-only become follows.
        await acceptAllRequests(db, request.account.id);
      }
      // A duel keeps each side's latest minutes, so its result survives the
      // week turning over on the profile.
      if (figuresSaved && figures.weekKey !== undefined) {
        await recordDuelMinutes(db, request.account.id, figures.weekKey, figures.weekMinutes);
      }
      response.json(ownView(await profiles(db).findOne({ _id: request.account.id }, { projection: OWN_VIEW })));
    })
  );

  router.delete(
    "/profile/me",
    auth,
    limitSave,
    asyncHandler(async (request, response) => {
      // Leaving the community takes its traces too: follows and requests both
      // ways, kudos, duels, the library, posts, gifts, places in clubs and
      // inbox events.
      await deleteCommunityData(db, request.account.id);
      await profiles(db).deleteOne({ _id: request.account.id });
      forgetBoards();
      response.json({ deleted: true });
    })
  );

  return router;
}
