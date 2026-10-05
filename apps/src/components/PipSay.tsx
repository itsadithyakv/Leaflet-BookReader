import { forwardRef, useEffect, useState, type ReactNode } from "react";

const CHARS_PER_SECOND = 38;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export type PipSayTail = "down" | "up" | "left" | "right";

type PipSayProps = {
  text: string;
  /** Which edge the tail leaves from, pointing at Pip. */
  tail?: PipSayTail;
  /** Where along that edge, as a percentage. */
  tailAt?: number;
  /** Buttons under the line (the tour, the shortcut menu). Makes it clickable. */
  children?: ReactNode;
  className?: string;
};

/**
 * Pip's speech bubble. A pixel-art frame, like Pip: notched corners, a stepped
 * tail, cream in both themes. The line types out like game dialogue; the
 * untyped remainder is laid out invisibly, so the bubble has its final size
 * from the first letter and never grows under the reader's eye.
 */
export const PipSay = forwardRef<HTMLSpanElement, PipSayProps>(
  ({ text, tail = "down", tailAt = 50, children, className }, ref) => {
    const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0));

    useEffect(() => {
      if (prefersReducedMotion()) {
        setShown(text.length);
        return;
      }
      setShown(0);
      const started = performance.now();
      let frame = 0;
      const step = (now: number) => {
        const count = Math.min(text.length, Math.floor(((now - started) / 1000) * CHARS_PER_SECOND) + 1);
        setShown(count);
        if (count < text.length) {
          frame = requestAnimationFrame(step);
        }
      };
      frame = requestAnimationFrame(step);
      return () => cancelAnimationFrame(frame);
    }, [text]);

    // A word Pip leans on is written "*there*": the marks come off, and the
    // word is set in italics. The line types out by its letters, not its marks.
    const parts = text.split(/\*([^*]+)\*/);
    const plain = parts.join("");
    const typed = (from: number, to: number) => {
      let at = 0;
      return parts.map((part, index) => {
        const piece = part.slice(Math.max(0, from - at), Math.max(0, to - at));
        at += part.length;
        return piece && index % 2 === 1 ? <em key={index}>{piece}</em> : piece;
      });
    };

    return (
      // A span, so the bubble is valid inside a button (the reader peek).
      <span
        ref={ref}
        className={`pip-say ${children ? "pip-say-interactive" : ""} ${className ?? ""}`}
        data-tail={tail}
        style={{ ["--tail-at" as string]: `${tailAt}%` }}
        role={children ? "dialog" : "status"}
        aria-live="polite"
      >
        <span className="sr-only">{plain}</span>
        <span aria-hidden="true">
          {typed(0, shown)}
          <span className="pip-say-rest">{typed(shown, plain.length)}</span>
        </span>
        {children && <span className="pip-say-actions">{children}</span>}
      </span>
    );
  }
);

PipSay.displayName = "PipSay";
