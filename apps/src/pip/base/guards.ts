/**
 * The camp's guardians and its animals.
 *
 * A guardian is posted at a building and does one thing for the camp when the
 * magpies come: the lookout sees further, the fence stands longer, the larder
 * takes more getting into. They take no ground of their own, which is the
 * point: a camp can have all seven and be no more crowded than it was. Each
 * has three ranks, bought with acorns, training and all, as a building is
 * (`guardCost` in rules.ts).
 *
 * What each does was chosen so that it always tells. The first draft gave
 * most of them a throw from their own building, and measured over eighty
 * nights four of the seven changed nothing: a magpie makes for the larder,
 * and a building that is not on the way to it is not in the fight. So the
 * ones below act on the larder, on the magpies themselves, or on every
 * thrower the camp has.
 *
 * Like the heroes they are the camp's own characters. Each tips a hat to a
 * kind of figure every reader has met (the ranger out of the north, the
 * watchman sworn to a wall, the shepherd of trees), and none is anybody
 * else's: the names, the looks and the words are Leaflet's.
 *
 * The animals are not bought at all. They come to a camp that has been made
 * charming, by what is set about it and by the books finished, and they
 * stay. Each brings one small good thing.
 */

/** Where a guardian is posted: one of the six buildings, or the yard (whichever plot was built first). */
export type Post = "burrow" | "oak" | "store" | "fence" | "tower" | "hut" | "yard";

export type Guardian = {
  id: number;
  name: string;
  /** What they are called on a button. */
  short: string;
  /** Who they are, in a few words. */
  title: string;
  /** What having them at their post does. */
  does: string;
  post: Post;
};

export const GUARDIANS: readonly Guardian[] = [
  { id: 0, name: "Halvar Longstride", short: "Halvar", title: "a ranger out of the north, and there is a rumour about a crown", does: "The lookout sees, and throws, further", post: "tower" },
  { id: 1, name: "Corwin Blackcloak", short: "Corwin", title: "who took an oath on a far colder wall than this", does: "The wall and its gate stand longer", post: "fence" },
  { id: 2, name: "Mossgather", short: "Mossgather", title: "a shepherd of trees, and in no hurry about it", does: "Roots catch at their feet: raiders on foot come slower", post: "oak" },
  { id: 3, name: "Dame Berit Tallshield", short: "Dame Berit", title: "who has never once broken a promise", does: "Stands before the larder: it takes far more getting into", post: "burrow" },
  { id: 4, name: "Emberling", short: "Emberling", title: "a very small dragon who is sure she is a large one", does: "Scorches whoever is on the wing before anything else", post: "store" },
  { id: 5, name: "Pim Greenhand", short: "Pim", title: "a gardener of uncommon nerve", does: "The larder hides more from prowlers", post: "yard" },
  { id: 6, name: "Ilsa Reedwhistle", short: "Ilsa", title: "an archer of the old wood, who says she does not miss", does: "Drills the camp: everything that throws, throws faster", post: "hut" }
];

/**
 * The top rank, and what each rank costs: its acorns, and the minutes of training it took when training was done by
 * reading. Since 1.5.8 those are paid in acorns too (`guardCost`: half an acorn a minute), and a rank is had at once.
 */
export const GUARD_MOST = 3;
export const GUARD_COSTS = [0, 120, 300, 600];
export const GUARD_MINUTES = [0, 20, 45, 80];

/** What each rank is worth, by guardian: read by the rules that lay the camp out for the night. */
export const GUARD_GIVES = {
  /** The ranger: the lookout's reach, as so many times what it was. */
  tower: [1, 1.15, 1.3, 1.45],
  /** The watchman: a piece of fence's sturdiness, as so many times. */
  fence: [1, 1.5, 2, 2.6],
  /** The shepherd of trees: how much slower the magpies on foot come, as a share. */
  oak: [0, 0.12, 0.22, 0.32],
  /** The knight: the larder's sturdiness, as so many times. */
  burrow: [1, 1.35, 1.7, 2.1],
  /** The dragon on the larder: what she breathes, how far and how often. She goes for the ones on the wing first. */
  store: { hit: [0, 4, 6, 8], range: 26, every: 0.9 },
  /** The gardener: what the larder hides, as so many times. */
  yard: [1, 1.25, 1.5, 1.75],
  /** The archer: how long everything that throws takes between throws, as so many times. */
  hut: [1, 0.9, 0.8, 0.7]
} as const;

export type Animal = {
  id: number;
  name: string;
  /** How charming the camp has to be for it to come. */
  charm: number;
  does: string;
};

export const ANIMALS: readonly Animal[] = [
  { id: 0, name: "Hen", charm: 8, does: "An egg most mornings: a parcel a day" },
  { id: 1, name: "Cat", charm: 20, does: "One prowler in ten thinks better of it and stays in the wood" },
  { id: 2, name: "Goat", charm: 35, does: "Leans on the wall: it stands a quarter longer" },
  { id: 3, name: "Owl", charm: 55, does: "Keeps watch: mending what prowlers did costs a quarter less" },
  { id: 4, name: "Fox", charm: 80, does: "A tenth more from every raid" },
  { id: 5, name: "Tortoise", charm: 110, does: "The larder holds a tenth more" }
];

/** What each animal's one good thing comes to. */
export const HEN_LAYS = 3;
export const GOAT_PIECES = 2;
export const FOX_MORE = 1.1;
export const TORTOISE_MORE = 1.1;

/**
 * Landscape: what a reader sets about a clearing to make it theirs. It does
 * nothing but look as they want it to, which is the point of it: a pond
 * here, a knoll at the back, a stand of birches. The flat ones lie on the
 * ground under everything; the others stand, and are walked behind.
 */
export const SCENERY: ReadonlyArray<{ name: string; cost: number; flat: boolean }> = [
  { name: "Pond", cost: 20, flat: true },
  { name: "Lake", cost: 45, flat: true },
  { name: "Knoll", cost: 30, flat: false },
  { name: "Boulders", cost: 10, flat: false },
  { name: "Pine", cost: 15, flat: false },
  { name: "Bush", cost: 8, flat: false },
  { name: "Wildflowers", cost: 8, flat: true },
  { name: "Stepping stones", cost: 10, flat: true },
  { name: "Tall grass", cost: 5, flat: true },
  { name: "Birch", cost: 15, flat: false }
];
/** How much of it a clearing takes. */
export const LAND_MOST = 30;

/**
 * Defensive constructs. Since 1.5.11 (the front, `front.ts`) there are seven, each with one job and one kind of
 * prowler it beats: four traps that lie on the trail in front of the wall (thorn strip, tanglefoot, pitfall,
 * thumper), two towers that stand on pads behind it (archer's nest, stone thrower), and the watch bell on the gate.
 * The other five are kept in this list so that their numbers stay what they were (a camp kept from before reads
 * them), marked `retired`: the hedge and caltrops are the thorn strip now, the ward stone and the hornet jar the
 * archer's nest, and the smoke brazier and the dread totem are no more (paid back).
 */
export type Work = {
  name: string;
  cost: number;
  /** The burrow's level it could be had from, before chapters (the front goes by `front.ts` `WORK_CHAPTER`). */
  burrow: number;
  hp: number;
  /** How far about itself it acts; 0 for one that acts on the whole flock. */
  reach: number;
  does: string;
  /** No longer had (1.5.11): what it became, if anything, is in `front.ts` `BECAME`. */
  retired?: boolean;
};
export const WORKS: readonly Work[] = [
  { name: "Ward stone", cost: 180, burrow: 3, hp: 150, reach: 34, does: "Nothing flies past it: inside its ring, whoever is on the wing has to walk", retired: true },
  { name: "Whip-thorn hedge", cost: 140, burrow: 3, hp: 90, reach: 13, does: "Cuts whatever walks through it", retired: true },
  { name: "Thumper", cost: 220, burrow: 4, hp: 240, reach: 30, does: "Drums diggers up out of the ground near the wall, dazed" },
  { name: "Smoke brazier", cost: 260, burrow: 4, hp: 120, reach: 0, does: "Its smoke hides the larder: they go for whatever is nearest instead of straight to it", retired: true },
  { name: "Tanglefoot", cost: 90, burrow: 2, hp: 60, reach: 15, does: "Walkers cross it at under half their pace, under fire for longer" },
  { name: "Hornet jar", cost: 160, burrow: 3, hp: 70, reach: 26, does: "Stings whatever is on the wing near it, for as long as it is", retired: true },
  { name: "Pitfall", cost: 200, burrow: 4, hp: 1, reach: 6, does: "Swallows a brute who walks onto it (two a night; lighter ones walk over). Dug again by morning" },
  { name: "Watch bell", cost: 280, burrow: 5, hp: 110, reach: 32, does: "Hangs on the gate: while anyone is at the wall, everything throws a third faster" },
  { name: "Thorn strip", cost: 100, burrow: 2, hp: 40, reach: 8, does: "Cuts every walker crossing it, and runners three times as fast" },
  { name: "Stone thrower", cost: 240, burrow: 3, hp: 120, reach: 44, does: "Slow and heavy, and hits a few at once. A stone sets a bomber off where he stands" },
  { name: "Archer's nest", cost: 150, burrow: 2, hp: 80, reach: 30, does: "Quick and light, and shoots down fliers first, twice as hard" },
  { name: "Dread totem", cost: 170, burrow: 4, hp: 100, reach: 24, does: "Whoever is near it has no heart for the work: they do half the harm, and some turn and run", retired: true }
];
/** What caltrops do to whoever is on them, a second. */
export const CALTROP_CUTS = 3;
/** What the two constructs that throw, throw: how hard, and how long between. The reach is the construct's own. */
export const NEST_THROWS = { hit: 2, every: 1 };
export const STONE_THROWS = { hit: 4, every: 2.6 };
/** The share of their harm that whoever is near a dread totem still does. */
export const TOTEM_DAUNTS = 0.5;
/** What the hedge does to whoever is in it, a second. */
export const HEDGE_CUTS = 5;
/** The share of their pace a tanglefoot patch takes from whoever is in it. */
export const TANGLE_SLOWS = 0.55;
/** What the hornets do to whatever is on the wing near their jar, a second. */
export const HORNET_STINGS = 5;
/** How many a pitfall takes before it is full. */
export const PIT_TAKES = 3;
/** What the watch bell does to the wait between throws, while it is ringing. */
export const BELL_QUICKER = 0.7;

/**
 * The blades. Each was a lord's of the magpies, or the King's, and is won
 * the first time he falls. A hero can carry one, and it changes what they
 * are on a raid. Like the heroes they nod at blades readers know (the whip
 * that is a sword, the knife of a great worm's tooth, the greatsword too big
 * for anyone sensible) and are nobody's but the camp's.
 */
export type Blade = {
  id: number;
  name: string;
  /** Who it is won from, or had from. */
  from: string;
  /** A hero's own: theirs to give once they are a friend of the camp. Which hero. */
  hero?: number;
  title: string;
  /** What carrying it does: so many times as hard, as sturdy, as quick; so much further; what it strikes hurts what stands beside it; so many times as much to a champion. */
  gives: { dps?: number; hp?: number; speed?: number; reach?: number; splash?: number; champion?: number };
};
export const BLADES: readonly Blade[] = [
  { id: 0, name: "Thornwhip", from: "Scratch the Twig-Tyrant", title: "a blade of links: a whip, until it is not", gives: { reach: 10, dps: 1.1 } },
  { id: 1, name: "The Maker's Tooth", from: "the Bramble Baron", title: "a knife of a great worm's tooth, never sheathed unblooded", gives: { dps: 1.35, hp: 0.9 } },
  { id: 2, name: "Winterglass", from: "Tin-Eye the Collector", title: "a greatsword of smoke-dark steel, too big for anyone sensible", gives: { dps: 1.25, speed: 0.9, splash: 6 } },
  { id: 3, name: "Longfang", from: "the Crow Regent", title: "a hand-and-a-half sword, a fox's head on its pommel", gives: { hp: 1.2, dps: 1.15 } },
  { id: 4, name: "Needlewise", from: "Lord Roost", title: "small, slender, and quicker than whoever holds it", gives: { speed: 1.25, dps: 1.1 } },
  { id: 5, name: "Dawnsplitter", from: "the Magpie King", title: "pale as milk, and warm in the hand at sunrise", gives: { dps: 1.3, hp: 1.15, champion: 1.5 } },
  { id: 6, name: "Undertow", from: "Piers, as a friend", hero: 2, title: "a bronze sword that is a pen until it is wanted", gives: { dps: 1.2, speed: 1.1 } },
  { id: 7, name: "The Songbird Bow", from: "Kestrel, as a friend", hero: 4, title: "strung with a promise she did not want to make", gives: { reach: 20, dps: 1.1 } },
  { id: 8, name: "Ashglass knives", from: "Vess, as a friend", hero: 3, title: "a pair, dark as the mist they were made for", gives: { speed: 1.2, dps: 1.2, hp: 0.9 } }
];
/** How good a friend a hero has to be to give the camp their own. */
export const BLADE_AT_BOND = 3;

/**
 * Who comes by night. The magpies were the first and are still the commonest;
 * a camp that has grown is worth other people's while. Each is beaten by
 * something different, which is the point: a camp laid out for the magpies is
 * not laid out for the Gilded, and the lookout says who is coming.
 */
export type Foe = {
  id: number;
  name: string;
  /** What they are like, for the reader to lay the camp out by. */
  does: string;
  /** The burrow's level from which they come at all. */
  from: number;
};
export const FOES: readonly Foe[] = [
  { id: 0, name: "Magpies", does: "Some on foot, some on the wing straight for the larder", from: 2 },
  { id: 1, name: "The Mudtusk rabble", does: "A great many, all on foot, and hard on a fence", from: 3 },
  { id: 2, name: "The Gilded", does: "Few and proud: each as sturdy as a wall, and no drum turns them", from: 4 },
  { id: 3, name: "The Stumbling", does: "Slow, and each gets up again once", from: 4 },
  { id: 4, name: "Frostwights", does: "What throws, throws slower near them. Fire is what they fear", from: 5 }
];

/** What a blade does, in a few words, for the reader to choose by. */
export const bladeSays = (blade: Blade) => {
  const { dps, hp, speed, reach, splash, champion } = blade.gives;
  const share = (times: number) => `${times >= 1 ? "+" : "-"}${Math.round(Math.abs(times - 1) * 100)}%`;
  return [
    dps ? `${share(dps)} strike` : "",
    hp ? `${share(hp)} sturdy` : "",
    speed ? `${share(speed)} quick` : "",
    reach ? "strikes from further off" : "",
    splash ? "hurts what stands beside" : "",
    champion ? "half as much again to a champion" : ""
  ]
    .filter(Boolean)
    .join(", ");
};
