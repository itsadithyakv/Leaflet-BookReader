import { useEffect, useState, type RefObject } from "react";

/**
 * What a thing means, said where a pointer cannot hover.
 *
 * The camp keeps its explanations off the page: they are each thing's
 * `title`, which a mouse shows by resting on it. A finger cannot rest, so
 * here the same words are shown in a small bubble: by holding a finger on
 * anything that has some (a button held this way is not pressed), and by a
 * plain tap, or a click, on a thing that only explains and does nothing.
 * The bubble goes at the next touch, or after a few seconds.
 *
 * One of these serves the whole arcade (ArcadeOverlay): it listens at the
 * dialog, which is what scrolls, and the bubble is placed inside it.
 */

/** How long a finger is held before the words are shown. */
export const HOLD_MS = 450;
/** How far a held finger may drift and still be holding. */
const DRIFT = 10;
const SHOWN_MS = 4500;
/** Things a tap already does something to: only a hold explains these. */
const PRESSABLE = "button, a, input, select, textarea, label, summary, [role='tab'], canvas";

type Tip = { text: string; x: number; y: number; under: boolean; wide: number };

/** The nearest thing at or above an element that has words to say, inside the root. */
export const holderOf = (target: EventTarget | null, root: HTMLElement): HTMLElement | null => {
  const from = target instanceof Element ? target : null;
  const found = from?.closest<HTMLElement>("[title], [data-tip]") ?? null;
  return found && root.contains(found) ? found : null;
};

export const wordsOf = (holder: HTMLElement) => (holder.getAttribute("title") || holder.dataset.tip || "").trim();

export const TipLayer = ({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) => {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let holding = 0;
    let hiding = 0;
    let from: { x: number; y: number } | null = null;
    /** The press that is under way was a hold: its click is not a press. */
    let held = false;

    const show = (holder: HTMLElement) => {
      const text = wordsOf(holder);
      if (!text) return;
      const box = holder.getBoundingClientRect();
      const frame = root.getBoundingClientRect();
      const wide = Math.min(260, frame.width - 8);
      const middle = box.left + box.width / 2 - frame.left;
      // Over the thing where there is room over it, under it at the top of the camp.
      const under = box.top - frame.top < 64;
      setTip({
        text,
        wide,
        x: Math.min(Math.max(wide / 2 + 4, middle), Math.max(wide / 2 + 4, frame.width - wide / 2 - 4)),
        y: (under ? box.bottom : box.top) - frame.top + root.scrollTop,
        under
      });
      window.clearTimeout(hiding);
      hiding = window.setTimeout(() => setTip(null), SHOWN_MS);
    };

    const let_go = () => {
      window.clearTimeout(holding);
      from = null;
    };
    const down = (event: PointerEvent) => {
      setTip(null);
      held = false;
      let_go();
      if (event.pointerType === "mouse") return;
      const holder = holderOf(event.target, root);
      if (!holder) return;
      from = { x: event.clientX, y: event.clientY };
      holding = window.setTimeout(() => {
        held = true;
        show(holder);
      }, HOLD_MS);
    };
    const move = (event: PointerEvent) => {
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRIFT) let_go();
    };
    const click = (event: MouseEvent) => {
      if (held) {
        // The finger was held to ask, not to press.
        held = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const holder = holderOf(event.target, root);
      const target = event.target instanceof Element ? event.target : null;
      if (holder && !target?.closest(PRESSABLE)) show(holder);
    };
    // A held finger also asks for the system's menu: not while it is asking for these words.
    const menu = (event: MouseEvent) => {
      if (from || held) event.preventDefault();
    };

    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", let_go);
    root.addEventListener("pointercancel", let_go);
    root.addEventListener("click", click, true);
    root.addEventListener("contextmenu", menu);
    return () => {
      window.clearTimeout(holding);
      window.clearTimeout(hiding);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", let_go);
      root.removeEventListener("pointercancel", let_go);
      root.removeEventListener("click", click, true);
      root.removeEventListener("contextmenu", menu);
    };
  }, [rootRef]);

  if (!tip) return null;
  return (
    <p className={`pip-tip${tip.under ? " is-under" : ""}`} role="status" style={{ left: tip.x, top: tip.y, width: tip.wide }}>
      <span>{tip.text}</span>
    </p>
  );
};
