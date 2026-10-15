import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PRESSABLE, tipHolderOf, tipWordsOf } from "./touchTipWords";

/** How long a finger is held before the words are shown (as in the Hollow's TipLayer). */
const HOLD_MS = 450;
/** How far a held finger may drift and still be holding. */
const DRIFT = 10;
/** How long words asked for by a hold stay up. A tap's stay until the next touch. */
const SHOWN_MS = 4500;
const WIDE = 260;

type Tip = { text: string; x: number; y: number; under: boolean };

/**
 * Every `title` can be read by a finger (docs/android.md, rule 3). A finger
 * cannot rest on a thing to see its tooltip, so holding it on anything that
 * has one shows the words in a small bubble for a few seconds (the held
 * press is not a press: its click and the system's menu are swallowed), and
 * a tap on something that only explains (a day in the calendar, an (i))
 * shows them until the next touch. Key hints are left out.
 *
 * Mounted once, by the app, only for touch input. The arcade and the Hollow
 * have their own (`components/pip/arcade/base/Tips.tsx`), and the reader's
 * text, fields and Pip are left to their own long-press: see `TIPS_SKIP`.
 */
export const TouchTips = () => {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let holding = 0;
    let hiding = 0;
    let from: { x: number; y: number } | null = null;
    /** The press under way was a hold: its click is not a press. */
    let held = false;

    const show = (holder: HTMLElement, linger: boolean) => {
      const text = tipWordsOf(holder);
      if (!text) return;
      const box = holder.getBoundingClientRect();
      const width = window.innerWidth;
      const half = Math.min(WIDE, width - 16) / 2;
      const middle = box.left + box.width / 2;
      // Over the thing where there is room over it; under it near the top.
      const under = box.top < 72;
      setTip({
        text,
        x: Math.min(Math.max(half + 8, middle), width - half - 8),
        y: under ? box.bottom : box.top,
        under
      });
      window.clearTimeout(hiding);
      if (!linger) hiding = window.setTimeout(() => setTip(null), SHOWN_MS);
    };

    const letGo = () => {
      window.clearTimeout(holding);
      from = null;
    };
    const down = (event: PointerEvent) => {
      setTip(null);
      held = false;
      letGo();
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      const holder = tipHolderOf(event.target);
      if (!holder) return;
      from = { x: event.clientX, y: event.clientY };
      holding = window.setTimeout(() => {
        held = true;
        show(holder, false);
      }, HOLD_MS);
    };
    const move = (event: PointerEvent) => {
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRIFT) letGo();
    };
    const click = (event: MouseEvent) => {
      if (held) {
        // The finger was held to ask, not to press.
        held = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const holder = tipHolderOf(event.target);
      const target = event.target instanceof Element ? event.target : null;
      if (holder && !target?.closest(PRESSABLE)) show(holder, true);
    };
    // A held finger also asks for the system's menu: not while it is asking for these words.
    const menu = (event: Event) => {
      if (from || held) event.preventDefault();
    };
    const away = () => {
      letGo();
      setTip(null);
    };

    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", letGo, true);
    window.addEventListener("pointercancel", letGo, true);
    window.addEventListener("click", click, true);
    window.addEventListener("contextmenu", menu, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      window.clearTimeout(holding);
      window.clearTimeout(hiding);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", letGo, true);
      window.removeEventListener("pointercancel", letGo, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("contextmenu", menu, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <p className={`touch-tip${tip.under ? " is-under" : ""}`} role="status" style={{ left: tip.x, top: tip.y }}>
      <span>{tip.text}</span>
    </p>,
    document.body
  );
};
