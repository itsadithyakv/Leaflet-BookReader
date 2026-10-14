import type { HeroTraits } from "./battle";

/**
 * The heroes who go raiding with Pip's scouts, and the villains who guard
 * the magpies' strongholds.
 *
 * A hero comes out of the reading: each belongs to a kind of book, and
 * finishing a book of that kind brings them to the camp (so does simply
 * finishing enough books, for a library whose genres say little). One goes on
 * a raid, and does one thing no scout does.
 *
 * They are the camp's own characters. Each tips a hat to a kind of hero
 * every reader has met (the young wizard, the sea-born fighter, the thief in
 * the mist), and none is anybody else's: the names, the looks and the words
 * are Leaflet's.
 */

export type Hero = {
  id: number;
  name: string;
  /** What they are called on a button. */
  short: string;
  /** Who they are, in a few words. */
  title: string;
  /** The one thing they do, for the reader to choose by. */
  does: string;
  /** The kinds of trophy (`trophies.ts`) that bring them, and how many of those it takes. */
  kinds: number[];
  need: number;
  /** Trophies of any kind that bring them all the same. */
  total: number;
  traits: Omit<HeroTraits, "id">;
};

export const HEROES: readonly Hero[] = [
  {
    id: 0,
    name: "Marian Inkwell",
    short: "Marian",
    title: "the Librarian",
    does: "Reads to the wounded: the worst hurt scout near her mends",
    kinds: [0],
    need: 1,
    total: 1,
    traits: { hp: 70, dps: 8, speed: 18, reach: 3, heals: 5 }
  },
  {
    id: 1,
    name: "Barnaby Thistlewand",
    short: "Barnaby",
    title: "a young wizard, top of nothing but trouble",
    does: "Strikes hard from far off with a crooked wand",
    kinds: [1],
    need: 1,
    total: 4,
    traits: { hp: 46, dps: 14, speed: 18, reach: 34 }
  },
  {
    id: 2,
    name: "Piers Jetsam",
    short: "Piers",
    title: "raised at a summer camp, claimed by the sea",
    does: "Brings a wave: what he strikes, everything beside it feels",
    kinds: [9, 10],
    need: 1,
    total: 7,
    traits: { hp: 95, dps: 11, speed: 21, reach: 3, splash: 16 }
  },
  {
    id: 3,
    name: "Vess Ashfall",
    short: "Vess",
    title: "a thief who walks the mist",
    does: "Leaps the walls and goes straight for the loot",
    kinds: [1],
    need: 3,
    total: 11,
    traits: { hp: 85, dps: 10, speed: 34, reach: 3, leaps: true, prefers: "hoard", times: { hoard: 2.5 } }
  },
  {
    id: 4,
    name: "Kestrel Evergreen",
    short: "Kestrel",
    title: "an archer who never wanted to be anyone's symbol",
    does: "Picks the sentries off from further than they can throw",
    kinds: [10],
    need: 2,
    total: 15,
    traits: { hp: 50, dps: 8, speed: 20, reach: 52, prefers: "perch", times: { perch: 1.4 } }
  },
  {
    id: 5,
    name: "Inspector Sheldrake Holm",
    short: "Inspector Holm",
    title: "who notices what others only see",
    does: "The sentries never spot him",
    kinds: [3],
    need: 1,
    total: 20,
    traits: { hp: 60, dps: 12, speed: 20, reach: 3, unseen: true, prefers: "perch", times: { perch: 1.5 } }
  },
  {
    id: 6,
    name: "Old Grey Mumble",
    short: "Old Mumble",
    title: "a wizard, never late, seldom on time",
    does: "Stands in the way: every sentry throws at him first",
    kinds: [8, 1],
    need: 2,
    total: 26,
    traits: { hp: 130, dps: 8, speed: 15, reach: 3, taunts: true }
  },
  {
    id: 7,
    name: "Captain Vega Starling",
    short: "Captain Vega",
    title: "of a ship that is mostly held together by hope",
    does: "Cuts through walls as if they were paper",
    kinds: [2],
    need: 1,
    total: 33,
    traits: { hp: 60, dps: 10, speed: 22, reach: 34, times: { wall: 6 } }
  },
  {
    id: 8,
    name: "Lady Rosalind Thorne",
    short: "Lady Rosalind",
    title: "who has opinions, and a parasol",
    does: "Keeps spirits up: the worst hurt scout near her mends fast",
    kinds: [4],
    need: 1,
    total: 40,
    traits: { hp: 70, dps: 6, speed: 18, reach: 3, heals: 9 }
  },
  {
    id: 9,
    name: "Doctor Marrow",
    short: "Doctor Marrow",
    title: "who hunts what goes bump",
    does: "Made for monsters: far stronger against nests and champions",
    kinds: [5],
    need: 1,
    total: 50,
    traits: { hp: 100, dps: 10, speed: 19, reach: 3, times: { nest: 1.8, champion: 2.5 } }
  }
];

/** Trophies of each kind, by the kind's number (`trophies.ts`): what the heroes are counted against. */
export type Shelf = readonly number[];

/** Whether a hero has come to the camp. */
export const heroOpen = (shelf: Shelf, trophies: number, id: number): boolean => {
  const hero = HEROES[id];
  if (!hero) return false;
  return trophies >= hero.total || hero.kinds.reduce((sum, kind) => sum + (shelf[kind] ?? 0), 0) >= hero.need;
};

/** What still has to be finished to bring a hero, in a few words. */
export const heroWants = (hero: Hero, kindNames: readonly string[]): string => {
  const kinds = hero.kinds.map((kind) => kindNames[kind]?.toLowerCase() ?? "any");
  const own = hero.kinds[0] === 0 ? "any book" : `${hero.need === 1 ? (/^[aeiou]/.test(kinds[0] ?? "") ? "an" : "a") : hero.need} ${kinds.join(" or ")} ${hero.need === 1 ? "book" : "books"}`;
  return hero.total > 1 ? `Finish ${own}, or ${hero.total} books in all` : `Finish ${own}`;
};

export const heroTraits = (id: number): HeroTraits | null => (HEROES[id] ? { id, ...HEROES[id].traits } : null);

/** The villains: one for each kind of stronghold, and the King's own. Which picture, and what he is called. */
export const CHAMPIONS: readonly string[] = [
  "Scratch the Twig-Tyrant",
  "The Bramble Baron",
  "Tin-Eye the Collector",
  "The Crow Regent",
  "Lord Roost, the Ever-Feathered",
  "The Hoarder King, He Who Must Not Be Plucked"
];
export const KING_CHAMPION = 5;
