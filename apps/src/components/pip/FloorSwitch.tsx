import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HouseLevel } from "../../pip/home.js";
import { UiIcon } from "../UiIcon";
import { liftShowsAll, liftShowsArrows } from "./layout";
import { useCoarsePointer } from "./useCoarsePointer";

type Props = {
  levels: HouseLevel[];
  current: HouseLevel;
  unlocked: (level: HouseLevel) => boolean;
  /** Why a floor is locked, or null when seeds alone open it. */
  lockReason: (level: HouseLevel) => string | null;
  priceOf: (level: HouseLevel) => number;
  onOpen: (level: HouseLevel) => void;
  /** The room's height: the lift is as tall as the room beside it. */
  height: number;
  style?: CSSProperties;
};

/**
 * The lift up the side of Pip's house: a shaft with a stop for every floor,
 * numbered from the ground up like a real one, and a car that rides to the
 * floor Pip is on. Up and down at either end. A locked floor's stop shows a
 * padlock; selecting it says why, or offers to open it. In a room too short
 * for every stop, the lift shows the floor it is on, and the others open as
 * a list from it.
 */
export const FloorSwitch = ({ levels, current, unlocked, lockReason, priceOf, onOpen, height, style }: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const index = Math.max(0, levels.findIndex((level) => level.id === current.id));
  const above = levels[index + 1];
  const below = levels[index - 1];
  // Under a finger every key is 44 px (index.css), so fewer fit: the lift folds to one floor sooner, and in a room
  // too short for three such keys it is the one key alone (its list reaches every floor, as the arrows did).
  const touch = useCoarsePointer();
  const showAll = liftShowsAll(levels.length, height, touch);
  const arrows = showAll || liftShowsArrows(height, touch);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const go = (level: HouseLevel) => {
    setOpen(false);
    onOpen(level);
  };

  /** Spoken and shown on hover: the floor, and what it takes when it is locked. */
  const describe = (level: HouseLevel) => {
    const number = levels.indexOf(level) + 1;
    if (level.id === current.id) return `Floor ${number}, ${level.name}: you're here`;
    if (unlocked(level)) return `Floor ${number}, ${level.name}`;
    const why = lockReason(level);
    return `Floor ${number}, ${level.name}: locked. ${why ?? `Open it for ${priceOf(level)} seeds.`}`;
  };

  const stop = (level: HouseLevel, extra: { role?: "menuitem" } = {}) => {
    const here = level.id === current.id;
    const locked = !unlocked(level);
    return (
      <button
        type="button"
        className="pip-lift-stop"
        aria-current={here ? "true" : undefined}
        data-locked={locked || undefined}
        onClick={() => (here ? undefined : go(level))}
        aria-label={describe(level)}
        title={describe(level)}
        {...extra}
      >
        <span className="pip-lift-number">{levels.indexOf(level) + 1}</span>
        {extra.role === "menuitem" && <span className="pip-lift-name">{level.name}</span>}
        {locked && <UiIcon name="lock" size={10} className="pip-lift-lock" />}
      </button>
    );
  };

  return (
    <nav
      ref={rootRef}
      className="pip-lift"
      style={{ ...style, height }}
      aria-label="Lift: the floors of Pip's house"
      data-compact={!showAll || undefined}
    >
      {arrows && (
        <button
          type="button"
          className="pip-lift-arrow"
          onClick={() => above && go(above)}
          disabled={!above}
          aria-label={above ? `Up to the ${above.name}${unlocked(above) ? "" : " (locked)"}` : "Top floor"}
          title={above ? `Up: ${above.name}` : "Top floor"}
        >
          <UiIcon name="up" size={18} />
        </button>
      )}
      {showAll ? (
        <ol className="pip-lift-shaft" style={{ "--floors": levels.length, "--at": index } as CSSProperties}>
          {/* The car rides to the floor Pip is on (a transition, so a switch is a ride). */}
          <span className="pip-lift-car" aria-hidden="true" />
          {[...levels].reverse().map((level) => (
            <li key={level.id}>{stop(level)}</li>
          ))}
        </ol>
      ) : (
        <div className="pip-lift-shaft">
          <button
            type="button"
            className="pip-lift-stop"
            aria-current="true"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            aria-label={`${describe(current)}. Every floor`}
            title="Every floor of the house"
          >
            <span className="pip-lift-number">{index + 1}</span>
          </button>
          {open && (
            <ol className="pip-lift-menu" role="menu" aria-label="Floors, top first">
              {[...levels].reverse().map((level) => (
                <li key={level.id}>{stop(level, { role: "menuitem" })}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {arrows && (
        <button
          type="button"
          className="pip-lift-arrow"
          onClick={() => below && go(below)}
          disabled={!below}
          aria-label={below ? `Down to the ${below.name}` : "Ground floor"}
          title={below ? `Down: ${below.name}` : "Ground floor"}
        >
          <UiIcon name="down" size={18} />
        </button>
      )}
    </nav>
  );
};
