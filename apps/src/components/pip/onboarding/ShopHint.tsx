import { useEffect, useState } from "react";
import { PipFace } from "../arcade/base/Sprite";
import { Coach } from "./Coach";
import { tapKey } from "./tapKey";
import { whole, type Rect } from "./geometry";

const LOOK_MS = 200;

const shown = (node: Element | null): node is HTMLElement => Boolean(node && node.getBoundingClientRect().width > 0);

/**
 * The first visit indoors, for a reader who skipped Pip's guided session (or
 * whose camp is from before it): Pip points at the shop, once, and that is
 * all. A light pointer, not a walk: nothing is dimmed and nothing is kept
 * from the page. It goes when "Got it" is pressed, when the shop is opened,
 * or when the reader goes back out.
 */
export const ShopHint = ({ line, skin, outfit, onDone }: { line: string; skin: string; outfit: readonly string[]; onDone: () => void }) => {
  const [view, setView] = useState<{ bounds: Rect; hole: Rect } | null>(null);
  useEffect(() => {
    const look = () => {
      // Opened the shop: what it was for is done.
      if (document.querySelector(".pip-shop")) {
        onDone();
        return;
      }
      const key = document.querySelector('[data-walk="shop"]');
      const page = document.querySelector(".pip-house-page");
      if (!shown(key) || !page) {
        setView(null);
        return;
      }
      const next = { bounds: whole(page.getBoundingClientRect()), hole: whole(key.getBoundingClientRect()) };
      setView((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    look();
    const timer = window.setInterval(look, LOOK_MS);
    return () => window.clearInterval(timer);
  }, [onDone]);
  if (!view) return null;
  const rail = document.querySelector(".pip-rail");
  return (
    <Coach
      bounds={view.bounds}
      hole={view.hole}
      dim={false}
      through
      float
      face={<PipFace skin={skin} outfit={outfit} box={34} move="idea" />}
      line={line}
      avoid={rail ? [whole(rail.getBoundingClientRect())] : []}
      keys={
        <span className="pip-coach-keys">
          <button type="button" className="pip-say-button pip-say-button-primary" {...tapKey(onDone)}>
            Got it
          </button>
        </span>
      }
    />
  );
};
