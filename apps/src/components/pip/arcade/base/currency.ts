/**
 * What the Hollow's chips say when they are tapped: what acorns are, how
 * reading earns them, what they buy and what holds them; and what charm is.
 *
 * Since 1.5.8 acorns are the Hollow's one money: reading earns them (the oak,
 * the parcels), and everything is bought with them, a building's work
 * included (`ACORNS_A_MINUTE`). Every figure here is the rules' own, for this
 * camp as it stands: nothing is written out by hand that the rules could say
 * otherwise.
 */
import { ANIMALS } from "../../../../pip/base/guards";
import {
  MAX_LEVEL,
  STRETCH_MINUTES,
  charm,
  hides,
  holds,
  oakDrops,
  oakHolds,
  parcelGives,
  streakAdds,
  streakNext,
  type BaseState
} from "../../../../pip/base/rules";

export type CardLine = { icon: "read" | "oak" | "parcel" | "streak" | "list" | "raid" | "build" | "larder" | "charm" | "animal"; text: string };
export type ChipCard = {
  title: string;
  /** What it is, in a line. */
  lead: string;
  /** How it is earned, in a few lines. */
  earn: CardLine[];
  /** What it buys. */
  spend: string;
  /** What holds it, and how to hold more; null where nothing does. */
  cap: string | null;
  /** The larder, where building it up holds more. */
  more: "store" | null;
  /** What the lines of `earn` are headed (by default, how acorns are earned, or how charm grows). */
  earnLabel?: string;
};

const ONE_PLACE = (value: number) => (Math.round(value * 10) / 10).toString();

/** Acorns a minute of reading earns from the oak, at its level and with the streak: for "you earn N for every minute you read". */
export const acornsAMinute = (base: BaseState, streak = 0) => (oakDrops(base) * (1 + streakAdds(streak))) / 10;

/** The larder's next level, and what it would hold; null at the top. */
export const nextLarder = (base: BaseState): { level: number; holds: number } | null =>
  base.levels.store >= MAX_LEVEL ? null : { level: base.levels.store + 1, holds: holds({ ...base, levels: { ...base.levels, store: base.levels.store + 1 } }) };

export const acornCard = (base: BaseState, streak = 0): ChipCard => {
  const drops = Math.round(oakDrops(base) * (1 + streakAdds(streak)));
  const minute = acornsAMinute(base, streak);
  const earn: CardLine[] = [];
  if (base.levels.oak > 0) {
    earn.push({ icon: "read", text: `About ${ONE_PLACE(minute)} for every minute you read: the oak drops ${drops} every 10 minutes. Tap the oak to collect them: it keeps them all until you do.` });
  } else {
    earn.push({ icon: "read", text: "Build the oak: it drops acorns as you read." });
  }
  const adds = streakAdds(streak);
  const next = streakNext(streak);
  if (adds > 0) earn.push({ icon: "streak", text: `Your ${streak}-day reading streak adds ${Math.round(adds * 100)}% to the oak.` });
  else if (next !== null) earn.push({ icon: "streak", text: `A ${next}-day reading streak adds ${Math.round(streakAdds(next) * 100)}% to the oak.` });
  earn.push({ icon: "parcel", text: `A sitting of ${STRETCH_MINUTES} minutes or more, or a day's goal met, sends a parcel: ${parcelGives(base)} acorns.` });
  earn.push({ icon: "list", text: "Each chapter's goals pay acorns, and so does its chest." });
  if (base.levels.hut > 0) earn.push({ icon: "raid", text: "Raids on the magpies bring acorns home." });
  const larder = nextLarder(base);
  return {
    title: "Acorns",
    lead: "The Hollow's money. Reading earns them, and they buy everything here.",
    earn,
    spend: "Buildings and their upgrades, guardians, constructs, decorations, fixes, and raids.",
    // (1.5.10) Nothing holds them: the larder keeps a share safe from prowlers, and that is all.
    cap: base.levels.store === 0 ? null : `Your larder keeps ${hides(base)} of them safe from prowlers.`,
    more: larder ? "store" : null
  };
};

export const charmCard = (base: BaseState): ChipCard => {
  const next = ANIMALS.filter((animal) => !base.animals.includes(animal.id)).sort((a, b) => a.charm - b.charm)[0] ?? null;
  return {
    title: "Charm",
    lead: `How charming the camp is: ${charm(base)}. Not spent; it only grows.`,
    earn: [
      { icon: "charm", text: "Decorations add charm, and so do the trophies of the books you finish and the banners you win." },
      { icon: "animal", text: next ? `It brings animals to the meadow: the ${next.name.toLowerCase()} comes at ${next.charm}.` : "Every animal has come to the meadow." },
      { icon: "parcel", text: "And better parcels: an acorn more in each for every 30 charm." }
    ],
    spend: "",
    cap: null,
    more: null
  };
};

/**
 * The parcels chip's card, for when a tap cannot open them (a tap opens them where it can): how many wait, why they
 * wait, and where they come from.
 */
export const parcelCard = (base: BaseState, openable: number): ChipCard => ({
  title: "Parcels",
  earnLabel: "Where they come from",
  lead:
    openable === 0
      ? `${base.parcels === 1 ? "A parcel waits" : `${base.parcels} parcels wait`} by the burrow's door: the larder is full. Each goes in whole, so it waits for room.`
      : `${base.parcels === 1 ? "A parcel waits" : `${base.parcels} parcels wait`} by the burrow's door.`,
  earn: [
    { icon: "parcel", text: `A sitting of ${STRETCH_MINUTES} minutes or more, or a day's goal met, sends one: ${parcelGives(base)} acorns.` },
    { icon: "larder", text: "Spend some acorns, or build the larder up, and they go in." }
  ],
  spend: "",
  cap: null,
  more: nextLarder(base) ? "store" : null
});
