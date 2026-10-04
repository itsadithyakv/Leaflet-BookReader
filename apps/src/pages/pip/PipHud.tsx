import type { MutableRefObject, ReactNode, RefObject } from "react";
import type { ShopKind } from "../../pip/shop";
import type { WishView } from "../../pip/wish";
import { GoalChip } from "../../components/pip/GoalChip";
import { PipGoals, type PipGoalsProps } from "../../components/pip/PipGoals";
import { PipWish } from "../../components/pip/PipWish";
import { CountUp } from "../../components/community/CountUp";
import { UiIcon } from "../../components/UiIcon";
import type { usePinnedGoal } from "./usePinnedGoal";
import { moodWord, plural } from "./common";

type PipHudProps = {
  seedChipRef: RefObject<HTMLButtonElement>;
  heartsRef: RefObject<HTMLButtonElement>;
  /** Each heart, for the pop as it fills. */
  heartRefs: MutableRefObject<Array<HTMLSpanElement | null>>;
  goalRef: RefObject<HTMLDivElement>;
  /** Seeds to spend now. */
  spendable: number;
  /** The number the counter holds while seeds fly to it, if they are. */
  heldSeeds: number | null;
  /** How long the counter takes to count up to a new number. */
  countMs: number;
  /** The hearts shown, in halves. */
  hearts: number;
  /** Pip's mood as the hearts show it. */
  shownMood: number;
  /** Seeds: where they come from. */
  openMe: () => void;
  /** Pip's mood: why it is what it is, and what would lift it. */
  openMood: () => void;
  onGoalsFlight: PipGoalsProps["onFlight"];
  pinned: ReturnType<typeof usePinnedGoal>;
  artFor: (kind: ShopKind, id: string, size: number) => ReactNode;
  grantWish: (wish: WishView) => void;
  /** The floor on screen. */
  floorName: string;
  startWalk: () => void;
};

/**
 * The top bar over the house: the house's resources (seeds, Pip's mood, a
 * new reader's first steps), a goal pinned from the shop, Pip's wish today,
 * the floor's name plate and the walkthrough's way back in.
 */
export const PipHud = ({
  seedChipRef,
  heartsRef,
  heartRefs,
  goalRef,
  spendable,
  heldSeeds,
  countMs,
  hearts,
  shownMood,
  openMe,
  openMood,
  onGoalsFlight,
  pinned,
  artFor,
  grantWish,
  floorName,
  startWalk
}: PipHudProps) => {
  const { goal, goalEntry, goalItem, goalLock, progress, openGoal, setGoal } = pinned;
  return (
    <div className="pip-hud-top">
      {/* Seeds and mood, the house's resources. The cluster takes more (a goals widget) as another .pip-resource. */}
      <div className="pip-resources" data-walk="resources" role="group" aria-label="Seeds and mood">
        <button
          ref={seedChipRef}
          type="button"
          className="pip-resource pip-resource-seeds"
          onClick={() => openMe()}
          aria-label={`${plural(spendable, "seed")}. Where they come from`}
          title="Seeds: where they come from"
        >
          <span className="pip-resource-icon">
            <UiIcon name="seed" size={16} />
          </span>
          <span className="pip-resource-value tabular-nums">
            <CountUp value={heldSeeds ?? spendable} duration={heldSeeds === null ? countMs : 700} />
          </span>
        </button>
        {/* The hearts are Pip's mood: they open why it is what it is. */}
        <button
          ref={heartsRef}
          type="button"
          className="pip-resource pip-resource-mood"
          onClick={() => openMood()}
          aria-label={`Pip's mood: ${hearts} of 5 hearts. ${moodWord(shownMood)}. Why, and what would lift it`}
          title={`Pip's mood: ${moodWord(shownMood)}. Select to see why`}
        >
          <span className="pip-resource-label">Mood</span>
          <span className="pip-hearts">
            {[0, 1, 2, 3, 4].map((index) => (
              <span
                key={index}
                ref={(node) => {
                  heartRefs.current[index] = node;
                }}
                className="pip-heart"
                data-fill={hearts >= index + 1 ? "full" : hearts > index ? "half" : "empty"}
              >
                <UiIcon name="heart" size={14} />
              </span>
            ))}
          </span>
        </button>
        {/* First steps (its own resource until they are all done): a reward's
            seeds fly to the counter, which holds its old number meanwhile,
            as it does for a harvest. */}
        <PipGoals dropdown className="pip-resource pip-resource-goals" counter={() => seedChipRef.current} onFlight={onGoalsFlight} />
      </div>
      {goal && goalEntry && goalItem && progress && (
        <GoalChip
          ref={goalRef}
          name={goalEntry.name}
          art={artFor(goal.kind, goal.id, 32)}
          have={progress.have}
          price={progress.price}
          fraction={progress.fraction}
          ready={progress.ready}
          locked={goalLock}
          onOpen={openGoal}
          onUnpin={() => setGoal(null)}
        />
      )}
      <PipWish compact onGrant={grantWish} counter={() => seedChipRef.current} />
      <span className="pip-hud-spacer" />
      <span className="pip-floor-plate" title={`You're in the ${floorName}`}>
        <UiIcon name="home" size={14} />
        <span className="truncate">{floorName}</span>
      </span>
      <button type="button" className="pip-hud-help" onClick={startWalk} aria-label="Show me around" title="Show me around">
        <UiIcon name="help" size={18} />
      </button>
    </div>
  );
};
