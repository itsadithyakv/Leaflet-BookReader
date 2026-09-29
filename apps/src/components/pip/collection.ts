/**
 * How much of a kind of thing Pip has: "Wardrobe 5/42". Shown on the shop's
 * tabs and in Pip's things, so the catalogue reads as something to collect.
 * Counts only; set rewards are the Rust side's.
 */
export type Tally = { owned: number; total: number };

/** What of `items` is Pip's. Things bought each time (snacks) are not collected, so they are left out. */
export const tally = <T,>(items: readonly T[], owns: (item: T) => boolean, collectable: (item: T) => boolean = () => true): Tally => {
  const counted = items.filter(collectable);
  return { owned: counted.filter(owns).length, total: counted.length };
};

export const tallyText = ({ owned, total }: Tally) => `${owned}/${total}`;

/** Spoken: "5 of 42 collected". */
export const tallyLabel = ({ owned, total }: Tally) => (owned >= total && total > 0 ? `all ${total} collected` : `${owned} of ${total} collected`);

export const isComplete = ({ owned, total }: Tally) => total > 0 && owned >= total;
