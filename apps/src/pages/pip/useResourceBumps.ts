import { useEffect, useRef, type RefObject } from "react";
import { bump, dip, floatText } from "../../components/pip/fx";

type ResourceBumpsOptions = {
  /** The house has loaded (the wallet is known). */
  loaded: boolean;
  /** Seeds to spend now. */
  spendable: number;
  /** The number the seed counter holds while seeds fly to it, if they are. */
  heldSeeds: number | null;
  seedChipRef: RefObject<HTMLButtonElement>;
  /** The hearts shown, in halves. */
  hearts: number;
};

/**
 * The HUD answers changes in the house's resources: the seed counter bumps or
 * dips and says by how much, and a heart pops as it fills. Returns the hearts'
 * elements for the HUD to fill in.
 */
export const useResourceBumps = ({ loaded, spendable, heldSeeds, seedChipRef, hearts }: ResourceBumpsOptions) => {
  // Seeds coming and going outside a harvest (a purchase, a reading session
  // finishing while the tab is open): the counter dips or bumps, and says by
  // how much. A quick purchase counts as it is shown, not again when it is made.
  const lastBalance = useRef<number | null>(loaded ? spendable : null);
  useEffect(() => {
    const before = lastBalance.current;
    lastBalance.current = loaded ? spendable : null;
    if (before === null || before === spendable || heldSeeds !== null) return;
    const chip = seedChipRef.current;
    const box = chip?.getBoundingClientRect();
    if (!chip || !box) return;
    const change = spendable - before;
    if (change > 0) {
      floatText({ x: box.left + box.width / 2, y: box.top }, `+${change}`, "gain");
      bump(chip);
    } else {
      floatText({ x: box.left + box.width / 2, y: box.bottom + 4 }, `−${-change}`, "spend");
      dip(chip);
    }
    // Only a new balance matters; the hold is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendable, loaded]);

  // A heart filling pops as it fills.
  const heartRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const lastHearts = useRef(hearts);
  useEffect(() => {
    const before = lastHearts.current;
    lastHearts.current = hearts;
    if (hearts <= before) return;
    heartRefs.current.forEach((node, index) => {
      if (index + 1 > before && index < hearts) bump(node, 1.6);
    });
  }, [hearts]);

  return heartRefs;
};
