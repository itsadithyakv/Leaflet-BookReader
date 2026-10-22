/**
 * The animals' fondness (1.5.11, "Your reading, made visible"): each animal
 * in the meadow grows fond of the camp as the reader reads, from the day it
 * came. Hearts at 3, 10 and 25 hours read since then, and never lost. At one
 * heart it has a home of its own in the meadow; at three it wears a ribbon
 * (or a bell) and its good thing is twice what it was.
 *
 * Also here: the `md:` mark, which keeps the meadow's two new fields (when
 * the camp was last arrived at, and when each animal came) in `taught`, so
 * that a camp saved by an older build loses neither.
 *
 * Plain numbers of plain state: no import of the rules but their type.
 */
import type { BaseState } from "./rules";

/** How many animals there are (`ANIMALS`, guards.ts). */
export const ANIMAL_COUNT = 6;
/** Hours read since an animal came at which it has one heart, two and three. */
export const HEART_HOURS = [3, 10, 25] as const;
export const HEARTS_MOST = HEART_HOURS.length;

/** Hearts for so many minutes read since an animal came. */
export const heartsFor = (minutesSince: number): number => {
  const read = Math.max(0, Math.floor(Number.isFinite(minutesSince) ? minutesSince : 0));
  return HEART_HOURS.filter((hours) => read >= hours * 60).length;
};

/** When each animal came, in minutes read in all (-1 for one that has not), as the camp has it. */
const fromOf = (state: Pick<BaseState, "animals"> & { animalsFrom?: readonly number[] }, animal: number): number => {
  if (!state.animals.includes(animal)) return -1;
  const from = state.animalsFrom?.[animal];
  return typeof from === "number" && from >= 0 ? from : -1;
};

/** An animal's hearts: 0 to 3, by the reading since it came. 0 for one not here. */
export const heartsOf = (state: Pick<BaseState, "animals" | "minutes"> & { animalsFrom?: readonly number[] }, animal: number, minutes: number = state.minutes): number => {
  const from = fromOf(state, animal);
  return from < 0 ? 0 : heartsFor(Math.max(0, minutes - from));
};

/** How much more reading an animal's next heart wants, in minutes; null at three hearts (or for one not here). */
export const nextHeartIn = (state: Pick<BaseState, "animals" | "minutes"> & { animalsFrom?: readonly number[] }, animal: number, minutes: number = state.minutes): number | null => {
  const from = fromOf(state, animal);
  if (from < 0) return null;
  const hearts = heartsOf(state, animal, minutes);
  if (hearts >= HEARTS_MOST) return null;
  return Math.max(0, HEART_HOURS[hearts] * 60 - Math.max(0, Math.floor(minutes - from)));
};

/** At three hearts: its good thing doubles. */
export const isFond = (state: Pick<BaseState, "animals" | "minutes"> & { animalsFrom?: readonly number[] }, animal: number, minutes?: number) => heartsOf(state, animal, minutes) >= HEARTS_MOST;

// ---- each animal's good thing, and at three hearts twice it -----------------------------------

/** The hen: eggs a day on a day of reading (each a parcel). */
export const HEN_EGGS = [1, 2] as const;
/** The cat: the share of the night's prowlers who stay in the wood. (One in five was the plan; the Front's simulation keeps it.) */
export const CAT_STAYS = [0.1, 0.2] as const;
/** The goat: how much longer the wall stands. */
export const GOAT_WALL = [1.25, 1.5] as const;
/** The owl: what mending costs, of what it would. */
export const OWL_MEND = [0.75, 0.5] as const;
/** The fox: loot from raids. */
export const FOX_LOOT = [1.1, 1.2] as const;
/** The tortoise: what the larder holds. */
export const TORTOISE_LARDER = [1.1, 1.2] as const;

/** What an animal's good thing comes to, by how fond it is: [as it came, at three hearts]. */
export const giftOf = <T>(state: Pick<BaseState, "animals" | "minutes"> & { animalsFrom?: readonly number[] }, animal: number, gift: readonly [T, T]): T => gift[isFond(state, animal) ? 1 : 0];

/** Each animal's good thing at three hearts, in words (the animals card's line once it is so). */
export const FOND_DOES: readonly string[] = [
  "Two eggs on a day you read: two parcels",
  "One creeper in five thinks better of it and stays in the wood",
  "Leans on the wall: it stands half as long again",
  "Keeps watch: mending what prowlers did costs half",
  "A fifth more from every raid",
  "The larder holds a fifth more"
];
/** What each animal has in the meadow at one heart: its home. */
export const HOME_NAMES: readonly string[] = ["A hen house", "A cat basket", "A bell post", "An owl perch", "A fox den", "A sunning stone"];
/** And wears at three. */
export const FINERY_NAMES: readonly string[] = ["a ribbon", "a bell", "a bell", "a ribbon", "a ribbon", "a ribbon"];

/** The journal's line for an animal's new heart. */
export const heartLine = (name: string, hearts: number): string =>
  hearts >= HEARTS_MOST
    ? `The ${name.toLowerCase()} is fond of the camp: three hearts, and its good thing is doubled.`
    : hearts === 1
      ? `The ${name.toLowerCase()} has a home in the meadow now.`
      : `The ${name.toLowerCase()} is warming to the camp: ${hearts} hearts.`;

// ---- the md: mark -------------------------------------------------------------------------------

export const MEADOW_MARK = "md:";

/** The meadow's mark for `taught`: when the camp was last arrived at, and when each animal came. Short, in base 36. */
export const meadowMark = (seenAt: number, animalsFrom: readonly number[]): string => {
  const one = (value: number | undefined) => (typeof value === "number" && value >= 0 ? Math.floor(value).toString(36) : "-");
  return `${MEADOW_MARK}${[one(seenAt), ...Array.from({ length: ANIMAL_COUNT }, (_, animal) => one(animalsFrom[animal]))].join(".")}`;
};

/** The mark read back: null where there is none (or it cannot be read). */
export const readMeadowMark = (taught: readonly string[]): { seenAt: number | null; animalsFrom: number[] } | null => {
  const entry = taught.find((name) => name.startsWith(MEADOW_MARK));
  if (!entry) return null;
  const parts = entry.slice(MEADOW_MARK.length).split(".");
  if (parts.length < 1 + ANIMAL_COUNT) return null;
  const one = (part: string): number | null => {
    if (part === "-" || part === "") return null;
    const value = parseInt(part, 36);
    return Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : null;
  };
  return { seenAt: one(parts[0]), animalsFrom: Array.from({ length: ANIMAL_COUNT }, (_, animal) => one(parts[1 + animal]) ?? -1) };
};
