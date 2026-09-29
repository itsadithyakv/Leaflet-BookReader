import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PipSay } from "../PipSay";
import { placeNear, type Rect } from "./layout";
import { nextStep, type WalkStep, type WalkTarget } from "./walkSteps";

type WalkthroughProps = {
  steps: WalkStep[];
  /** The element a step points at, when it is on screen. */
  find: (target: WalkTarget) => Element | null;
  /** Gets a step ready before it shows (the plot's step rides up to the garden). */
  prepare?: (step: WalkStep) => Promise<void> | void;
  onClose: () => void;
};

/** Room round the spotlit thing. */
const PAD = 6;

const any = () => true;

/**
 * Pip shows a first-time reader round the house: a spotlight on one thing at
 * a time, the rest dimmed, and Pip's line in its speech bubble beside it.
 * Next, Skip, and Escape to leave; nothing else on the page reacts while it
 * runs. A step whose thing is not there (no garden in this house) is passed
 * over.
 */
export const Walkthrough = ({ steps, find, prepare, onClose }: WalkthroughProps) => {
  const [index, setIndex] = useState<number | null>(() => nextStep(-1, any, steps));
  const [spot, setSpot] = useState<Rect | null>(null);
  const [bubble, setBubble] = useState<{ left: number; top: number; side: "above" | "below"; tailAt: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const findRef = useRef(find);
  findRef.current = find;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const step = index === null ? null : steps[index];

  const close = () => {
    setIndex(null);
    closeRef.current();
  };
  const goTo = (next: number | null) => {
    if (next === null) {
      close();
      return;
    }
    setSpot(null);
    setBubble(null);
    setIndex(next);
  };

  // A step: get it ready, then find its thing; one that is not there is passed over.
  useEffect(() => {
    if (!step || index === null) return;
    let current = true;
    void Promise.resolve(prepare?.(step)).then(() => {
      if (!current) return;
      const found = findRef.current(step.target);
      if (!found) {
        goTo(nextStep(index, any, steps));
        return;
      }
      found.scrollIntoView({ block: "nearest" });
      const box = found.getBoundingClientRect();
      setSpot({ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 });
    });
    return () => {
      current = false;
    };
    // A new step is what starts this; the callbacks are read as they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // It follows its thing as the window changes.
  useEffect(() => {
    if (!step || !spot) return;
    const follow = () => {
      const box = findRef.current(step.target)?.getBoundingClientRect();
      if (box) setSpot({ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 });
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [step, spot]);

  useLayoutEffect(() => {
    const node = bubbleRef.current;
    if (!spot || !node || !step) return;
    const viewport = { left: 12, top: 12, width: window.innerWidth - 24, height: window.innerHeight - 24 };
    setBubble(placeNear(spot, { width: node.offsetWidth, height: node.offsetHeight }, viewport, { gap: 16, prefer: step.side }));
  }, [spot, step]);

  useEffect(() => {
    if (bubble) nextRef.current?.focus();
  }, [bubble]);

  // Escape leaves; the focus goes back where it was when the walk began.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before) && before !== document.body) before.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!step || index === null) return null;
  const last = nextStep(index, any, steps) === null;

  return (
    <div className="pip-walk">
      <div
        className="pip-walk-spot"
        aria-hidden="true"
        style={spot ? { left: spot.left, top: spot.top, width: spot.width, height: spot.height } : { opacity: 0 }}
      />
      <div ref={bubbleRef} className="pip-walk-bubble" style={spot && bubble ? { left: bubble.left, top: bubble.top } : { left: -9999, top: 0 }}>
        <PipSay key={step.target} text={step.line} tail={bubble?.side === "below" ? "up" : "down"} tailAt={bubble?.tailAt ?? 50}>
          <button ref={nextRef} type="button" className="pip-say-button pip-say-button-primary" onClick={() => goTo(nextStep(index, any, steps))}>
            {last ? "Let's go!" : "Next"}
          </button>
          {!last && (
            <button type="button" className="pip-say-button pip-say-button-quiet" onClick={close}>
              Skip
            </button>
          )}
          <span className="pip-say-count">
            {index + 1} / {steps.length}
          </span>
        </PipSay>
      </div>
    </div>
  );
};
