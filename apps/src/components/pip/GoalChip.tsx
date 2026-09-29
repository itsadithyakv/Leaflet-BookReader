import { forwardRef, type ReactNode } from "react";
import { UiIcon } from "../UiIcon";

type GoalChipProps = {
  name: string;
  art: ReactNode;
  have: number;
  price: number;
  fraction: number;
  ready: boolean;
  /** Why it cannot be bought even with the seeds (a floor below to open first). */
  locked?: string | null;
  onOpen: () => void;
  onUnpin: () => void;
};

/**
 * The goal pinned from the shop, in the HUD: the thing, a bar of seeds
 * towards it, and the count. Once the seeds are there it says so, and
 * selecting it opens the thing in the shop, ready to buy. No taller than the
 * seeds beside it, so pinning a goal never shrinks the room.
 */
export const GoalChip = forwardRef<HTMLDivElement, GoalChipProps>(function GoalChip(
  { name, art, have, price, fraction, ready, locked, onOpen, onUnpin },
  ref
) {
  const status = ready ? (locked ? "Not yet" : "Ready!") : `${have}/${price}`;
  return (
    <div ref={ref} className="pip-goal" data-ready={(ready && !locked) || undefined}>
      <button
        type="button"
        className="pip-goal-main"
        onClick={onOpen}
        aria-label={`Your goal: ${name}. ${ready ? (locked ? locked : "You have the seeds for it.") : `${have} of ${price} seeds.`} Open it in the shop.`}
        title={locked && ready ? `${name}: ${locked}` : `Goal: ${name}`}
      >
        <span className="pip-goal-art" aria-hidden="true">
          {art}
        </span>
        <span className="pip-goal-body">
          <span className="pip-goal-line">
            <span className="pip-goal-name">
              <UiIcon name="goal" size={11} />
              {name}
            </span>
            <span className="pip-goal-count tabular-nums">{status}</span>
          </span>
          <span className="pip-goal-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, fraction)).toFixed(3)})` }} />
          </span>
        </span>
      </button>
      <button type="button" className="pip-goal-unpin" onClick={onUnpin} aria-label={`Unpin ${name} as your goal`} title="Unpin">
        <UiIcon name="close" size={12} />
      </button>
    </div>
  );
});
