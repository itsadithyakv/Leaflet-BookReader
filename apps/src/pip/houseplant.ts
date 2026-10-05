/**
 * The houseplant on Pip's fridge, which only free reading waters: reading
 * with no focus session running (the habit snapshot's `freeReads`, worked out
 * from the ledger; nothing is stored for the plant). Focus sessions water
 * the garden; this is what the other kind of reading does.
 *
 * The rule, pure (houseplant.test.ts). Each minute of free reading is a
 * minute of water, and water drains by two fifths a day, over a week. From
 * that: thriving, fine, thirsty or drooping. It never dies and costs
 * nothing, and it does not shame a reader who reads only in focus sessions:
 * with no free reading in the last week it is resting, which looks fine.
 * Only a plant that was being watered and then was not goes thirsty, droops
 * for a couple of days, and settles back to resting. All the free reading
 * there has ever been grows it: a new leaf every hour, a flower every five.
 */

export type PlantState = "thriving" | "fine" | "thirsty" | "drooping";

/** What a day's free reading is, as the snapshot lists it. */
export type FreeDay = { dateKey: string; minutes: number };

export const PLANT = {
  /** Days of free reading that still count as water (today and the six before). */
  days: 7,
  /** How much of a day's water is left the day after. */
  keeps: 0.6,
  /** Water to thrive (ten minutes read today does it), to be fine, and below which it droops. */
  thrive: 10,
  fine: 3,
  thirsty: 1,
  /** It starts with two leaves and grows another for each hour of free reading, up to six. */
  leaves: { first: 2, most: 6, everyMinutes: 60 },
  /** A flower for every five hours, up to three. */
  flowers: { most: 3, everyMinutes: 300 }
} as const;

const dayNumber = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? Math.round(Date.UTC(year, month - 1, day) / 86_400_000) : Number.NaN;
};

export type Plant = {
  state: PlantState;
  /** Resting: nobody has watered it this week, so it has settled, and looks fine. */
  resting: boolean;
  /** The water it has now, in minutes of reading. */
  water: number;
  /** Free reading today, and over the days that still count, in minutes. */
  today: number;
  week: number;
  /** Minutes of free reading today that would have it thriving; 0 when it is. */
  wants: number;
  /** All the free reading there has been, in minutes, and what it has grown. */
  total: number;
  leaves: number;
  flowers: number;
  /** Minutes of free reading until the next leaf and the next flower; null when it has them all. */
  nextLeaf: number | null;
  nextFlower: number | null;
};

/** The plant, from each day's free reading and today's date (`YYYY-MM-DD`, the reader's own day). */
export const plantOf = (freeReads: readonly FreeDay[], todayKey: string): Plant => {
  const now = dayNumber(todayKey);
  let water = 0;
  let today = 0;
  let week = 0;
  let total = 0;
  for (const free of freeReads) {
    const minutes = Number.isFinite(free.minutes) ? Math.max(0, free.minutes) : 0;
    const age = now - dayNumber(free.dateKey);
    // A day that is not a day, or one still to come (a clock set back), waters nothing.
    if (!Number.isFinite(age) || age < 0) continue;
    total += minutes;
    if (age >= PLANT.days) continue;
    water += minutes * PLANT.keeps ** age;
    week += minutes;
    if (age === 0) today += minutes;
  }
  // Under a minute in the whole week is nobody watering it.
  const resting = week < 1;
  const state: PlantState = resting ? "fine" : water >= PLANT.thrive ? "thriving" : water >= PLANT.fine ? "fine" : water >= PLANT.thirsty ? "thirsty" : "drooping";
  const { leaves, flowers } = PLANT;
  const grown = Math.floor(total / leaves.everyMinutes);
  const bloomed = Math.floor(total / flowers.everyMinutes);
  return {
    state,
    resting,
    water: Number(water.toFixed(2)),
    today: Math.round(today),
    week: Math.round(week),
    wants: state === "thriving" ? 0 : Math.max(1, Math.ceil(PLANT.thrive - water)),
    total: Math.round(total),
    leaves: Math.min(leaves.most, leaves.first + grown),
    flowers: Math.min(flowers.most, bloomed),
    nextLeaf: leaves.first + grown >= leaves.most ? null : Math.ceil((grown + 1) * leaves.everyMinutes - total),
    nextFlower: bloomed >= flowers.most ? null : Math.ceil((bloomed + 1) * flowers.everyMinutes - total)
  };
};

const minutes = (count: number) => `${count} minute${count === 1 ? "" : "s"}`;
/** A stretch of reading in words: "40 minutes", "2 hours", "1 hour 20 minutes". */
const stretch = (count: number) => {
  const hours = Math.floor(count / 60);
  const rest = count % 60;
  if (hours === 0) return minutes(count);
  return `${hours} hour${hours === 1 ? "" : "s"}${rest > 0 ? ` ${minutes(rest)}` : ""}`;
};

/** How the plant is, in a word or two, for its label. */
export const plantNow = (plant: Plant) => (plant.resting ? "fine, resting" : plant.state);

/** What it wants, in plain numbers: for its label and its card. */
export const plantWants = (plant: Plant) =>
  plant.state === "thriving" ? "It has all the water it wants today." : `It wants about ${minutes(plant.wants)} more of reading outside a focus session today.`;

/** The plant's card, a line at a time: how it is, what waters it, what it wants, and what it is growing towards. */
export const plantReport = (plant: Plant): string[] => {
  const how = plant.resting
    ? "Fine. Nobody has watered it this week, so it is resting; it comes to no harm."
    : plant.state === "thriving"
      ? "Thriving."
      : plant.state === "fine"
        ? "Fine."
        : plant.state === "thirsty"
          ? "A little thirsty."
          : "Drooping a little. It will pick up, or settle by itself: it never dies.";
  const watered = plant.resting
    ? "Only reading outside a focus session waters it (focus sessions water the garden)."
    : `Watered by reading outside a focus session: ${minutes(plant.today)} today, ${minutes(plant.week)} this week.`;
  const leaf = plant.nextLeaf === null ? `All ${plant.leaves} of its leaves are out.` : `${plant.leaves} leaves; the next after ${stretch(plant.nextLeaf)} more.`;
  const flower =
    plant.nextFlower === null
      ? `${plant.flowers} flowers, as many as it has.`
      : `${plant.flowers === 0 ? "No flower yet" : `${plant.flowers} flower${plant.flowers === 1 ? "" : "s"}`}; the next after ${stretch(plant.nextFlower)} more.`;
  return [how, watered, plantWants(plant), `${leaf} ${flower}`];
};

/** What Pip says to it, standing by it: a few lines for each way it can be. */
export const plantLines = (plant: Plant): string[] =>
  plant.resting
    ? ["hello, plant. having a rest?", "a page read just for fun would wake you."]
    : plant.state === "thriving"
      ? ["look at you. all that reading.", "you're doing so well."]
      : plant.state === "fine"
        ? ["you're doing fine.", "growing nicely. keep it up."]
        : plant.state === "thirsty"
          ? ["thirsty? i can't water you. reading does.", "a chapter just for fun would fix you up."]
          : ["chin up, plant. a few pages will do it.", "don't worry. you always pick up."];
