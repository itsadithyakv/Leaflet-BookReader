import { useEffect, useRef, useState } from "react";
import type { HouseLevel } from "../../pip/home.js";
import { UiIcon } from "../UiIcon";

type Props = {
  levels: HouseLevel[];
  current: HouseLevel;
  above: HouseLevel | undefined;
  below: HouseLevel | undefined;
  unlocked: (level: HouseLevel) => boolean;
  /** Why a floor is locked, or null when seeds alone open it. */
  lockReason: (level: HouseLevel) => string | null;
  priceOf: (level: HouseLevel) => number;
  onOpen: (level: HouseLevel) => void;
};

/**
 * Up, down, and the floor Pip is on (select it for every floor). It lives in
 * the bar over the house: as a column beside the scene it took a sixth of the
 * width, and the scene is sized by its width.
 */
export const FloorSwitch = ({ levels, current, above, below, unlocked, lockReason, priceOf, onOpen }: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const index = levels.findIndex((level) => level.id === current.id);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div className="pip-floor-switch" ref={rootRef} role="group" aria-label="Floors of the house">
      <button
        type="button"
        className="pip-floor-step"
        onClick={() => above && go(above)}
        disabled={!above}
        aria-label={above ? `Up to the ${above.name}${unlocked(above) ? "" : " (locked)"}` : "Top floor"}
        title={above ? `Up: ${above.name}` : "Top floor"}
      >
        <span aria-hidden="true">▲</span>
      </button>
      <button
        type="button"
        className="pip-floor-current"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Every floor of the house"
      >
        <UiIcon name="home" size={15} />
        <span className="truncate">{current.name}</span>
        <span className="pip-floor-count tabular-nums">
          {index + 1}/{levels.length}
        </span>
      </button>
      <button
        type="button"
        className="pip-floor-step"
        onClick={() => below && go(below)}
        disabled={!below}
        aria-label={below ? `Down to the ${below.name}` : "Ground floor"}
        title={below ? `Down: ${below.name}` : "Ground floor"}
      >
        <span aria-hidden="true">▼</span>
      </button>
      {open && (
        <ol className="pip-floor-menu modal-surface" role="menu" aria-label="Floors, top first">
          {[...levels].reverse().map((level) => {
            const isOpen = unlocked(level);
            const why = isOpen ? null : lockReason(level);
            return (
              <li key={level.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="pip-floor"
                  aria-current={level.id === current.id ? "true" : undefined}
                  data-locked={!isOpen || undefined}
                  onClick={() => go(level)}
                  title={isOpen ? level.name : `${level.name}: ${why ?? `${priceOf(level)} seeds`}`}
                >
                  <span className="truncate">{level.name}</span>
                  {!isOpen &&
                    (why ? (
                      <UiIcon name="lock" size={11} />
                    ) : (
                      <span className="pip-floor-price">
                        <UiIcon name="seed" size={10} />
                        {priceOf(level)}
                      </span>
                    ))}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
