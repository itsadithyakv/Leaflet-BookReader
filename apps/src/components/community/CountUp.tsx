import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./format";

/**
 * A number that counts from its previous value to the new one, so a refresh
 * that moved someone's minutes is visible without anything flashing. The first
 * render shows the value as is: only *changes* animate. `duration` stretches
 * the count to match something else (seeds landing in the counter one by one).
 */
export const CountUp = ({
  value,
  format = (n: number) => String(n),
  duration = 700
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) => {
  const [shown, setShown] = useState(value);
  // Where the count is now, so a new value mid-count carries on from there.
  const current = useRef(value);
  const length = useRef(duration);
  length.current = duration;

  useEffect(() => {
    const start = current.current;
    if (start === value || prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const began = performance.now();
    const span = Math.max(1, length.current);
    const tick = (time: number) => {
      const progress = Math.min(1, (time - began) / span);
      const eased = 1 - Math.pow(1 - progress, 3);
      current.current = Math.round(start + (value - start) * eased);
      setShown(current.current);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
};
