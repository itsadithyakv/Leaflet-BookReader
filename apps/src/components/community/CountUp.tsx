import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./format";

/**
 * A number that counts from its previous value to the new one, so a refresh
 * that moved someone's minutes is visible without anything flashing. The first
 * render shows the value as is: only *changes* animate.
 */
export const CountUp = ({ value, format = (n: number) => String(n) }: { value: number; format?: (n: number) => string }) => {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const began = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - began) / 700);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
};
