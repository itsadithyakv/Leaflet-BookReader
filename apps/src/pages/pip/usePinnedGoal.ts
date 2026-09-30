import { useEffect, useState, type RefObject } from "react";
import { catalogueItem, type ShopKind } from "../../pip/shop";
import type { PipOverview } from "../../services/pipService";
import type { HouseSceneHandle } from "../../components/pip/HouseScene";
import type { ShopCategory, ShopEntry, ShopRequest } from "../../components/pip/PipShop";
import { bump, confetti, reducedMotion } from "../../components/pip/fx";
import { goalProgress, readGoal, stepGoal, writeGoal, type PinnedGoal } from "../../components/pip/goal";
import { storage } from "./common";

type PinnedGoalOptions = {
  overview: PipOverview | null;
  owns: (kind: ShopKind, id: string) => boolean;
  /** The wallet's seeds. */
  balance: number;
  suspended: boolean;
  entryFor: (kind: ShopKind, id: string) => ShopEntry | null;
  shopCategories: ShopCategory[];
  goalRef: RefObject<HTMLDivElement>;
  sceneRef: RefObject<HouseSceneHandle>;
  play: (move: string, loops?: number, text?: string | null) => void;
  openShop: (request: ShopRequest) => void;
};

/**
 * A goal pinned from the shop (a preference of this device), shown in the
 * HUD: a cheer once it comes within reach, and its own moment once bought.
 */
export const usePinnedGoal = ({ overview, owns, balance, suspended, entryFor, shopCategories, goalRef, sceneRef, play, openShop }: PinnedGoalOptions) => {
  const [goal, setGoalState] = useState<PinnedGoal | null>(() => readGoal(storage()));

  const setGoal = (next: PinnedGoal | null) => {
    setGoalState(next);
    writeGoal(storage(), next);
  };

  const goalEntry = goal ? entryFor(goal.kind, goal.id) : null;
  const goalItem = goal ? catalogueItem(goal.kind, goal.id) : null;
  const goalLock = goalEntry?.locked ?? null;
  const progress = goalItem ? goalProgress(goalItem.price, balance) : null;

  // A goal comes within reach (a cheer, once), slips out of it, or is bought (done).
  useEffect(() => {
    if (!goal || !overview) return;
    if (!goalItem) {
      setGoal(null);
      return;
    }
    const { goal: next, event } = stepGoal(goal, { owned: owns(goal.kind, goal.id), ready: balance >= goalItem.price && !goalLock });
    if (next !== goal) setGoal(next);
    if (event === "affordable" && !suspended) {
      const chip = goalRef.current?.getBoundingClientRect();
      if (chip) confetti({ left: chip.left - 20, top: chip.top - 10, width: chip.width + 40, height: chip.height + 80 }, { px: 3, count: 28 });
      bump(goalRef.current, 1.2);
      play("cheer", 1, `enough seeds for the ${goalItem.name.toLowerCase()}!`);
    }
    // Saved up for and bought: the goal's own moment, once the purchase has
    // played out (the thing flying home), rather than a quiet unpinning.
    if (event === "reached" && !suspended) {
      const name = goalEntry?.name ?? goalItem.name;
      window.setTimeout(() => {
        sceneRef.current?.celebrate(name, "Goal reached!");
        play("fireworks", 1, `the ${name.toLowerCase()}! we saved up for that.`);
      }, reducedMotion() ? 0 : 900);
    }
    // The goal's own fields and the wallet are what move it on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal, balance, overview, goalLock, suspended]);

  const pinGoal = (entry: ShopEntry | null) => {
    if (!entry) {
      setGoal(null);
      return;
    }
    // Already within reach when pinned: nothing to cheer later.
    setGoal({ kind: entry.kind, id: entry.id, cheered: balance >= entry.price });
    play("idea", 1, `saving up for the ${entry.name.toLowerCase()}.`);
  };

  const openGoal = () => {
    if (!goal) return;
    const category = shopCategories.find((entry) => entry.entries.some((candidate) => candidate.kind === goal.kind && candidate.id === goal.id));
    openShop({ tab: category?.id ?? "variants", item: `${goal.kind}:${goal.id}` });
  };

  return { goal, setGoal, goalEntry, goalItem, goalLock, progress, pinGoal, openGoal };
};
