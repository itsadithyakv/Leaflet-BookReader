import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type PointerEvent } from "react";
import { fractionAlong, seekByKey } from "./seek";
import "./progressBar.css";

type ProgressBarProps = {
  /** How far through the book the reader is, 0 to 1. */
  value: number;
  /** The chapter a fraction of the book falls in, for the label under the pointer. */
  chapterAt: (fraction: number) => string | null;
  /** In a set of books (readers/innerBooks.ts): the book a fraction falls in, named above the chapter. */
  bookAt?: (fraction: number) => string | null;
  /** Where each book of a set begins along the bar (0 to 1): a small mark at each. */
  marks?: { at: number; label: string }[];
  /** Go there. Called once, when the handle is let go (or the keys rest). */
  onSeek: (fraction: number) => void;
  /** The dock is awake (under the pointer, focused, opened or just jumped): the bar shows with it. */
  shown: boolean;
  /** For the reader's Escape (readers/escapeOrder.ts): whether the handle is held, and letting it go without going anywhere. */
  holdRef?: MutableRefObject<{ held: () => boolean; letGo: () => void } | null>;
};

/** How long after the last key press the place is gone to: a held arrow is one jump, not thirty. */
const KEY_REST_MS = 450;

/**
 * The whole book along the bottom edge of the page: a thin bar with a handle.
 * Dragging (or pointing) shows the chapter and the percentage there; letting
 * go goes there. A slider to the keyboard: arrows move a hundredth, Page Up
 * and Down a tenth, Home and End to the ends.
 */
export const ProgressBar = ({ value, chapterAt, bookAt, marks, onSeek, shown, holdRef }: ProgressBarProps) => {
  const track = useRef<HTMLDivElement | null>(null);
  /** Where the handle is being held, or the pointer rests; null when the bar just shows the place. */
  const [pending, setPending] = useState<number | null>(null);
  const [mode, setModeState] = useState<"idle" | "hover" | "drag" | "keys">("idle");
  // Read by the pointer handlers: a quick tap is down and up before the next render.
  const modeRef = useRef(mode);
  const setMode = (next: typeof mode) => {
    modeRef.current = next;
    setModeState(next);
  };
  const pendingRef = useRef<number | null>(null);
  const keyTimer = useRef<number | null>(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  const hold = (fraction: number | null) => {
    pendingRef.current = fraction;
    setPending(fraction);
  };
  const commit = () => {
    const target = pendingRef.current;
    hold(null);
    setMode("idle");
    if (target !== null) {
      onSeekRef.current(target);
    }
  };

  useEffect(
    () => () => {
      if (keyTimer.current !== null) {
        window.clearTimeout(keyTimer.current);
      }
    },
    []
  );

  const letGo = () => {
    if (keyTimer.current !== null) {
      window.clearTimeout(keyTimer.current);
      keyTimer.current = null;
    }
    hold(null);
    setMode("idle");
  };
  useEffect(() => {
    if (!holdRef) {
      return undefined;
    }
    holdRef.current = { held: () => modeRef.current === "drag" || modeRef.current === "keys", letGo };
    return () => {
      holdRef.current = null;
    };
  }, [holdRef]);

  const at = (event: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect();
    return box ? fractionAlong(event.clientX, box.left, box.width) : 0;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === "Escape" && pendingRef.current !== null) {
      // Let go without going anywhere.
      event.preventDefault();
      event.stopPropagation();
      letGo();
      return;
    }
    const next = seekByKey(event.key, pendingRef.current ?? value);
    if (next === null) {
      return;
    }
    // The reader's own keys (arrows change chapter, turn pages) stay out of it.
    event.preventDefault();
    event.stopPropagation();
    hold(next);
    setMode("keys");
    if (keyTimer.current !== null) {
      window.clearTimeout(keyTimer.current);
    }
    keyTimer.current = window.setTimeout(() => {
      keyTimer.current = null;
      commit();
    }, KEY_REST_MS);
  };

  const showing = pending ?? value;
  const percent = Math.round(showing * 100);
  const chapter = chapterAt(showing);
  const inBook = bookAt?.(showing) ?? null;
  const active = mode !== "idle";
  return (
    <div className={`reader-progress ${shown || active ? "is-shown" : ""} ${active ? "is-active" : ""}`}>
      <div
        ref={track}
        className="reader-progress-track"
        role="slider"
        tabIndex={0}
        aria-label="Place in the book"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={[`${percent}%`, inBook, chapter].filter(Boolean).join(", ")}
        title="Drag to go anywhere in the book"
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (modeRef.current === "keys") {
            if (keyTimer.current !== null) {
              window.clearTimeout(keyTimer.current);
              keyTimer.current = null;
            }
            commit();
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          hold(at(event));
          setMode("drag");
        }}
        onPointerMove={(event) => {
          if (modeRef.current === "drag") {
            hold(at(event));
          } else if (modeRef.current !== "keys" && event.pointerType === "mouse") {
            // Pointing shows what is there; nothing moves until a press.
            hold(at(event));
            setMode("hover");
          }
        }}
        onPointerUp={(event) => {
          if (modeRef.current === "drag") {
            hold(at(event));
            commit();
          }
        }}
        onPointerCancel={() => {
          hold(null);
          setMode("idle");
        }}
        onPointerLeave={() => {
          if (modeRef.current === "hover") {
            hold(null);
            setMode("idle");
          }
        }}
      >
        <span className="reader-progress-line" aria-hidden="true">
          <span className="reader-progress-fill" style={{ width: `${value * 100}%` }} />
        </span>
        {(marks ?? []).map((mark) => (
          <span key={`${mark.at}-${mark.label}`} className="reader-progress-mark" style={{ left: `${mark.at * 100}%` }} aria-hidden="true" />
        ))}
        <span className="reader-progress-handle" style={{ left: `${showing * 100}%` }} aria-hidden="true" />
      </div>
      {active && (
        <span
          className={`reader-progress-bubble reader-panel reader-border ${inBook ? "has-book" : ""}`}
          style={{ left: `clamp(7rem, ${showing * 100}%, calc(100% - 7rem))` }}
          aria-hidden="true"
        >
          <span className="reader-progress-where">
            {inBook && <span className="reader-progress-book reader-muted">{inBook}</span>}
            <span className="reader-progress-chapter">{chapter ?? "The book"}</span>
          </span>
          <span className="tabular-nums reader-accent">{percent}%</span>
        </span>
      )}
    </div>
  );
};
