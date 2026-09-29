import { useEffect, type CSSProperties, type ReactNode } from "react";
import { UiIcon } from "../UiIcon";

export type UndoToastItem = {
  id: number;
  /** "Cookie for Pip", "Blush", "Radish in plot 3". */
  label: string;
  price: number;
  art?: ReactNode;
  startedAt: number;
  endsAt: number;
};

/**
 * A quick purchase's few seconds: what was just had, what it cost, and Undo.
 * A bar runs down the time left (still, under reduced motion); Ctrl+Z works
 * too while it shows. It hangs from the top of the room (`style` says where),
 * over the ceiling, clear of Pip and of the rail; on a phone it sits at the
 * bottom of the screen instead.
 */
export const UndoToast = ({ item, onUndo, style }: { item: UndoToastItem | null; onUndo: (id: number) => void; style?: CSSProperties }) => {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      // Typing keeps its own undo.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      onUndo(item.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onUndo]);

  if (!item) return null;
  const left = Math.max(0, item.endsAt - Date.now());
  const whole = Math.max(1, item.endsAt - item.startedAt);
  return (
    // Keyed, so the next purchase's toast pops in afresh and its bar starts full.
    <div key={item.id} className="pip-undo" role="status" aria-live="polite" style={style}>
      {item.art && (
        <span className="pip-undo-art" aria-hidden="true">
          {item.art}
        </span>
      )}
      <span className="pip-undo-text">
        <strong>{item.label}</strong>
        <span className="pip-undo-cost">
          <UiIcon name="seed" size={12} />−{item.price}
        </span>
      </span>
      <button type="button" className="pip-key pip-undo-button" onClick={() => onUndo(item.id)} aria-label={`Undo: ${item.label}, ${item.price} seeds back`}>
        <UiIcon name="undo" size={15} />
        Undo
      </button>
      <span
        className="pip-undo-time"
        aria-hidden="true"
        style={{ "--left": left / whole, animationDuration: `${left}ms` } as CSSProperties}
      />
    </div>
  );
};
