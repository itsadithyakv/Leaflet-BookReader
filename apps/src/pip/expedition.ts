/**
 * Pip's expeditions: she goes out for the length of a focus session and comes
 * back with something she found, for her album.
 *
 * Nothing here is stored. What a session found is a pure function of that
 * session alone (its id, the minutes read, whether it ran to its end without
 * leaving the book), so the album is worked out from the shelf every time:
 * sessions from before this existed have their finds too, a session that
 * arrives by sync brings its find with it, and two devices holding the same
 * shelf show the same album. No table, no sync rule, nothing to delete.
 *
 * The rules, each tested (expedition.test.ts):
 *
 * - A session of under five minutes read finds nothing, however it ended.
 * - How far she gets is the minutes read, half as far again for a session
 *   completed without leaving the book (the garden's own bonus for water).
 *   A session ended early counts its minutes as they are.
 * - How far she got names a place, and each place has its own odds for the
 *   five rarities: the further, the rarer. Which rarity, and which thing of
 *   that rarity, is drawn from the session's own seed.
 * - A session burned by a broken streak still counts: she went, she found it.
 *
 * FROZEN ONCE SHIPPED. A find is an index into these lists, so adding a
 * thing, moving one between rarities, reordering a rarity or changing a
 * place's odds would change what past sessions found, in every reader's
 * album. New things need a new dated list for sessions that end after it
 * (as the daily wish has its eras); the test pins a few sessions to their
 * finds so a careless edit fails.
 */
import type { FocusSessionRecord } from "../services/habitService";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** Commonest first: the order of the album's rows and of every odds list. */
export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export const RARITY_NAME: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary"
};

/** Something Pip can bring back. */
export type Find = {
  id: string;
  /** With its article, as it is said: "a smooth stone". */
  name: string;
  rarity: Rarity;
  /** What she says about it. */
  line: string;
};

const things = (rarity: Rarity, list: Array<[id: string, name: string, line: string]>): Find[] =>
  list.map(([id, name, line]) => ({ id, name, rarity, line }));

/** Everything there is to find, in the album's order. Frozen once shipped (see above). */
export const FINDS: readonly Find[] = [
  ...things("common", [
    ["pressed-leaf", "a pressed leaf", "flat. dignified. a distant cousin, possibly."],
    ["acorn", "an acorn", "it's an oak. it just doesn't know yet."],
    ["smooth-stone", "a smooth stone", "it does nothing. i respect that."],
    ["bottle-cap", "a bottle cap", "someone had a nice afternoon. now it's mine."],
    ["feather", "a feather", "a bird's bookmark. finders keepers."],
    ["button", "a button", "somewhere a coat is slightly open."],
    ["good-stick", "a good stick", "a very good stick. you'd have picked it up too."],
    ["pine-cone", "a pine cone", "a tree's rough draft."],
    ["dandelion", "a dandelion clock", "i made a wish. it was about you. it was about reading."],
    ["paperclip", "a paperclip", "holding it together. unlike some of us."],
    ["snail-shell", "a snail shell", "vacant. i checked. twice."],
    ["pencil-stub", "a pencil stub", "most of it is already written somewhere."],
    ["clover", "a clover", "three leaves. i counted. still nice."],
    ["mushroom", "a mushroom", "i did not eat it. write that down."]
  ]),
  ...things("uncommon", [
    ["ticket-stub", "a ticket stub", "admit one. the show was over. i kept the proof."],
    ["lost-bookmark", "a lost bookmark", "someone doesn't know where they were. i do. page 112."],
    ["marble", "a marble", "there's a whole swirl in there. nobody's steering it."],
    ["small-key", "a small key", "it opens something. it won't say what. rude."],
    ["jay-feather", "a jay feather", "bluer than it needed to be. show-off."],
    ["sea-glass", "a piece of sea glass", "a bottle that took early retirement."],
    ["conker", "a conker", "shiny for about a week. we have that in common."],
    ["library-card", "a library card", "expired in 1987. the fines must be magnificent."],
    ["die", "a die", "i rolled a four. no idea what i won."],
    ["postage-stamp", "a postage stamp", "it's been further than i have. i'm not jealous."],
    ["thimble", "a thimble", "it's a hat. don't argue. it's a hat."]
  ]),
  ...things("rare", [
    ["tiny-fossil", "a tiny fossil", "it waited four hundred million years for me. punctual."],
    ["four-leaf-clover", "a four-leaf clover", "four. i counted five times."],
    ["old-coin", "an old coin", "can't spend it. can admire it. cheaper hobby."],
    ["compass", "a compass", "it pointed north. i pointed home. we compromised."],
    ["seashell", "a seashell", "you can hear the sea in it. or me breathing. one of those."],
    ["magnifying-glass", "a magnifying glass", "everything's a clue if you're nosy enough."],
    ["quill", "a quill", "for strongly worded letters to plot holes."],
    ["sealed-letter", "a sealed letter", "not addressed to me. i haven't opened it. yet."],
    ["tiny-bell", "a tiny bell", "it rings when i walk. stealth is over."]
  ]),
  ...things("epic", [
    ["message-bottle", "a message in a bottle", "it says 'read more'. i may have written it."],
    ["map-fragment", "a map fragment", "the x is on the missing piece. of course it is."],
    ["pocket-watch", "a pocket watch", "stopped at ten past four. a good time to stop."],
    ["geode", "a geode", "dull outside, glittering inside. like chapter one."],
    ["spyglass", "a spyglass", "i can see your bookmark from here. it hasn't moved."],
    ["tiny-book", "a tiny book", "a book my size. finally. representation."]
  ]),
  ...things("legendary", [
    ["star-jar", "a star in a jar", "it fell. i caught it. we don't talk about how."],
    ["golden-acorn", "a golden acorn", "the tree it grows will have opinions."],
    ["dragon-scale", "a dragon scale", "it was just lying there. the dragon wasn't. i hope."],
    ["moon-piece", "a piece of the moon", "it won't be missed. it's a big moon."]
  ])
];

const BY_ID = new Map(FINDS.map((find) => [find.id, find]));
const BY_RARITY: Record<Rarity, Find[]> = { common: [], uncommon: [], rare: [], epic: [], legendary: [] };
for (const find of FINDS) BY_RARITY[find.rarity].push(find);

export const findById = (id: string): Find | null => BY_ID.get(id) ?? null;
export const findsOf = (rarity: Rarity): readonly Find[] => BY_RARITY[rarity];

/** Under this many minutes read she is not out long enough to find anything. */
export const MIN_FIND_MINUTES = 5;
/** A session completed without leaving the book takes her this much further (the water bonus, habit/seeds.rs). */
export const CLEAN_REACH = 1.5;

/** How far she got: a place, and its odds for each rarity (percent, in RARITIES' order). */
export type Place = {
  id: "gate" | "lane" | "woods" | "hills" | "shore" | "edge";
  /** As it is said after "as far as": "the woods". */
  name: string;
  /** The least reach that gets her here. */
  from: number;
  odds: readonly [number, number, number, number, number];
};

/**
 * Nearest first. With the session lengths on offer, completed cleanly: 10
 * minutes is the lane, 20 the woods, 30 the hills, 45 the shore, an hour the
 * map's edge. The commonest things never fall under 15 in 100, so a reader
 * of long sessions still finishes the first page. Frozen once shipped.
 */
export const PLACES: readonly Place[] = [
  { id: "gate", name: "the garden gate", from: MIN_FIND_MINUTES, odds: [90, 10, 0, 0, 0] },
  { id: "lane", name: "the lane", from: 15, odds: [62, 30, 8, 0, 0] },
  { id: "woods", name: "the woods", from: 30, odds: [40, 34, 20, 5, 1] },
  { id: "hills", name: "the hills", from: 45, odds: [27, 32, 27, 12, 2] },
  { id: "shore", name: "the shore", from: 60, odds: [19, 27, 29, 18, 7] },
  { id: "edge", name: "the edge of the map", from: 90, odds: [18, 24, 27, 19, 12] }
];

/** What the rules need to know about a session: the shelf's own record has it all. */
export type ExpeditionSession = Pick<FocusSessionRecord, "id" | "minutes" | "endedReason" | "clean"> &
  Partial<Pick<FocusSessionRecord, "styleSeed" | "startedAt" | "endedAt" | "title" | "bookId" | "burnedAt">>;

/** Ran to its planned end without leaving the book: the shelf's gold band, the garden's bonus. */
const completedClean = (session: ExpeditionSession) => session.endedReason === "completed" && Boolean(session.clean);

/**
 * How far a session took her, in minutes' worth of walking: 0 for one too
 * short to find anything (or with minutes that are not a number).
 */
export const reachOf = (session: ExpeditionSession): number => {
  const minutes = Number(session.minutes);
  if (!Number.isFinite(minutes) || minutes < MIN_FIND_MINUTES) {
    return 0;
  }
  return completedClean(session) ? minutes * CLEAN_REACH : minutes;
};

/** The furthest place a reach gets her to; none under the least. */
export const placeFor = (reach: number): Place | null => {
  let found: Place | null = null;
  for (const place of PLACES) {
    if (reach >= place.from) found = place;
  }
  return found;
};

/** The nearest place a rarity is found at all: where to send her for a thing not found yet. */
export const nearestPlaceFor = (rarity: Rarity): Place => {
  const index = RARITIES.indexOf(rarity);
  return PLACES.find((place) => place.odds[index] > 0) ?? PLACES[PLACES.length - 1];
};

/** The shortest session, read to its end without leaving the book, that reaches a place. */
export const minutesToReach = (place: Place) => Math.max(MIN_FIND_MINUTES, Math.ceil(place.from / CLEAN_REACH));

/** FNV-1a, then one turn of mulberry32 to spread ids that differ only in their last digits. */
const unit = (seed: string, salt: string): number => {
  let h = 2166136261;
  const text = `${salt}:${seed}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = (h + 0x6d2b79f5) >>> 0;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
};

/** The rarity a place's odds give for a draw in [0, 1). */
export const rarityAt = (place: Place, draw: number): Rarity => {
  let left = Math.max(0, Math.min(0.999999, draw)) * 100;
  for (let index = 0; index < RARITIES.length; index += 1) {
    if (left < place.odds[index]) return RARITIES[index];
    left -= place.odds[index];
  }
  return RARITIES[0];
};

/** One trip out: how far she got and what she brought back. */
export type Expedition = {
  sessionId: string;
  reach: number;
  place: Place;
  find: Find;
};

/**
 * What a session found; null when it was too short to find anything. The
 * same session always gives the same answer, on every device.
 */
export const expeditionOf = (session: ExpeditionSession): Expedition | null => {
  const reach = reachOf(session);
  const place = placeFor(reach);
  if (!place) {
    return null;
  }
  // The shelf's seed (the session id, on every session so far) seeds the find too.
  const seed = session.styleSeed || session.id;
  const pool = BY_RARITY[rarityAt(place, unit(seed, "rarity"))];
  const find = pool[Math.min(pool.length - 1, Math.floor(unit(seed, "thing") * pool.length))];
  return { sessionId: session.id, reach, place, find };
};

/** A find as it was made: the trip, and the session it was made in. */
export type Found = Expedition & {
  /** When she came back: the session's end (its start, for a record with no end). */
  at: string;
  minutes: number;
  title: string | null;
  bookId: string | null;
};

export type AlbumEntry = {
  find: Find;
  /** How many times it has been found; 0 for a thing not found yet. */
  count: number;
  /** The first time, when there was one. */
  first: Found | null;
};

export type RarityTally = { rarity: Rarity; found: number; total: number; left: number };

export type Album = {
  /** Every thing there is, found or not, in the album's order. */
  entries: AlbumEntry[];
  /** Different things found, of `total`. */
  found: number;
  total: number;
  /** Trips that brought something back. */
  trips: number;
  byRarity: RarityTally[];
  /** Every find, newest first. */
  finds: Found[];
};

const when = (session: ExpeditionSession) => session.endedAt || session.startedAt || "";
const instant = (stamp: string) => {
  const at = Date.parse(stamp);
  return Number.isNaN(at) ? 0 : at;
};

/**
 * The album a shelf makes. Burned sessions count like any other, and the
 * order the sessions are given in does not matter: "first found" is the
 * earliest by the clock, ties settled by id.
 */
export const buildAlbum = (sessions: readonly ExpeditionSession[]): Album => {
  const finds: Found[] = [];
  for (const session of sessions) {
    const trip = expeditionOf(session);
    if (trip) {
      finds.push({
        ...trip,
        at: when(session),
        minutes: Number(session.minutes),
        title: session.title ?? null,
        bookId: session.bookId ?? null
      });
    }
  }
  finds.sort((a, b) => instant(b.at) - instant(a.at) || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));

  const counts = new Map<string, number>();
  const firsts = new Map<string, Found>();
  // Oldest first, so the first seen of each is the first found.
  for (let index = finds.length - 1; index >= 0; index -= 1) {
    const found = finds[index];
    counts.set(found.find.id, (counts.get(found.find.id) ?? 0) + 1);
    if (!firsts.has(found.find.id)) firsts.set(found.find.id, found);
  }

  const entries = FINDS.map((find) => ({ find, count: counts.get(find.id) ?? 0, first: firsts.get(find.id) ?? null }));
  const byRarity = RARITIES.map((rarity) => {
    const total = BY_RARITY[rarity].length;
    const found = BY_RARITY[rarity].filter((find) => counts.has(find.id)).length;
    return { rarity, found, total, left: total - found };
  });
  return { entries, found: counts.size, total: FINDS.length, trips: finds.length, byRarity, finds };
};

/** The newest finds, newest first: for a display of the latest few. */
export const latestFinds = (album: Album, count = 3): Found[] => album.finds.slice(0, Math.max(0, count));

/** "x3" for a thing found more than once; nothing for one found once or not at all. */
export const timesText = (count: number) => (count > 1 ? `x${count}` : "");

/**
 * Where she is while a focus session runs: out, and how far she has got so
 * far on the minutes read. What she will bring back is not known until the
 * session ends (ending early, or leaving the book, changes how far she got).
 */
export type Outing = {
  /** How far she has got on the minutes read so far; null while still short of the gate. */
  place: Place | null;
  /** How far she will get if the session runs to its end, clean. */
  heading: Place | null;
  minutesRead: number;
  minutesPlanned: number;
};

export const outingOf = (running: { durationMinutes: number }, readMs: number): Outing => {
  const minutesRead = Math.max(0, readMs) / 60000;
  return {
    place: placeFor(minutesRead >= MIN_FIND_MINUTES ? minutesRead : 0),
    heading: placeFor(running.durationMinutes >= MIN_FIND_MINUTES ? running.durationMinutes * CLEAN_REACH : 0),
    minutesRead,
    minutesPlanned: running.durationMinutes
  };
};

/**
 * How long after a session the house still has her come in with what she
 * found, if she has not shown it yet. Past this it is old news: it is in the
 * album, and she does not act it out (so a reader updating to this version
 * finds their past finds in the album, not Pip at the door with last month's).
 */
export const BACK_FOR_MS = 12 * 60 * 60_000;

/** The note she leaves while she is out. */
export const AWAY_NOTE = "out exploring. back when the session ends.";
/** What she says coming in with it: short enough for her speech bubble (the find's own line is for the album). */
export const showLine = (find: Find) => `look what i found: ${find.name}.`;

/** Where Pip is, for the house: out on a trip, or back with something to show, or neither. */
export type Trip = {
  /** Out: a focus session is running. */
  away: Outing | null;
  /** Back, with a find the house has not shown yet. */
  back: Found | null;
};

/**
 * She is out for as long as a focus session runs, and back when it ends. The
 * newest find is hers to show once: until the house says it has been shown
 * (`seen`: the session it came from, a note this device keeps), and only
 * while it is news.
 */
export const tripNow = (input: {
  running: { durationMinutes: number } | null;
  /** Reading the running session has counted, in milliseconds. */
  readMs: number;
  album: Album;
  seen: string | null;
  now: number;
}): Trip => {
  if (input.running) {
    return { away: outingOf(input.running, input.readMs), back: null };
  }
  const newest = input.album.finds[0];
  const since = newest ? input.now - instant(newest.at) : Number.POSITIVE_INFINITY;
  const news = Boolean(newest) && newest.sessionId !== input.seen && since <= BACK_FOR_MS;
  return { away: null, back: news ? newest : null };
};
