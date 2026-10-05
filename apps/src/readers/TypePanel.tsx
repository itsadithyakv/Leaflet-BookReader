import type { KeyboardEvent } from "react";
import { MeasureControl } from "./MeasureControl";
import {
  FALLBACK_FACE,
  TYPEFACE_STACK,
  type ReaderAlign,
  type ReaderMeasure,
  type ReaderSpacing,
  type ReaderTypeface
} from "./readerTypes";
import "./typePanel.css";

type TypePanelProps = {
  fontSize: number;
  onFontSize: (next: number) => void;
  measure: ReaderMeasure;
  onMeasure: (next: ReaderMeasure) => void;
  typeface: ReaderTypeface;
  onTypeface: (next: ReaderTypeface) => void;
  spacing: ReaderSpacing;
  onSpacing: (next: ReaderSpacing) => void;
  align: ReaderAlign;
  onAlign: (next: ReaderAlign) => void;
};

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 32;

const FACES: Array<{ id: ReaderTypeface; name: string; hint: string }> = [
  { id: "book", name: "Book's own", hint: "The face the publisher chose" },
  { id: "serif", name: "Book serif", hint: "Georgia" },
  { id: "modern", name: "Modern serif", hint: "Cambria" },
  { id: "sans", name: "Sans", hint: "Segoe UI" },
  { id: "wide", name: "Wide sans", hint: "Verdana" }
];

const SPACINGS: Array<{ id: ReaderSpacing; name: string; gap: number }> = [
  { id: "compact", name: "Compact", gap: 3 },
  { id: "normal", name: "Normal", gap: 4 },
  { id: "airy", name: "Airy", gap: 5 }
];

const ALIGNS: Array<{ id: ReaderAlign; name: string; hint: string; lines: number[] }> = [
  { id: "justify", name: "Justified", hint: "Both edges straight, words hyphenated", lines: [14, 14, 14, 9] },
  { id: "left", name: "Left", hint: "A ragged right edge, no hyphenation", lines: [14, 10, 13, 7] }
];

/** Arrow keys move through a row of choices, as a radio group's do. */
const arrowTo = <T,>(event: KeyboardEvent<HTMLElement>, ids: T[], current: T, choose: (next: T) => void) => {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const at = ids.indexOf(current);
  const next = ids[(at + step + ids.length) % ids.length];
  choose(next);
  const group = event.currentTarget;
  window.requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
};

/**
 * The type panel: the size and the line length it always held, and the
 * typeface, the line spacing and the alignment. It opens under its toolbar
 * button, like the notes; every choice shows on the page at once.
 */
export const TypePanel = ({
  fontSize,
  onFontSize,
  measure,
  onMeasure,
  typeface,
  onTypeface,
  spacing,
  onSpacing,
  align,
  onAlign
}: TypePanelProps) => (
  <div
    className="reader-type-panel reader-menu absolute right-0 mt-3 rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
    role="dialog"
    aria-label="Text settings"
  >
    <div className="reader-type-row">
      <span className="reader-type-label reader-muted" id="reader-type-size">
        Size
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby="reader-type-size">
        <button
          type="button"
          className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
          onClick={() => onFontSize(Math.max(MIN_FONT_SIZE, fontSize - 2))}
          disabled={fontSize <= MIN_FONT_SIZE}
          aria-label="Smaller text"
          title="Smaller text"
        >
          A-
        </button>
        <span className="min-w-[40px] text-center tabular-nums" aria-live="polite">
          {fontSize}px
        </span>
        <button
          type="button"
          className="rounded-md border px-2 py-1 transition reader-border reader-icon reader-hover-accent"
          onClick={() => onFontSize(Math.min(MAX_FONT_SIZE, fontSize + 2))}
          disabled={fontSize >= MAX_FONT_SIZE}
          aria-label="Larger text"
          title="Larger text"
        >
          A+
        </button>
      </div>
    </div>

    <div className="reader-type-row">
      <span className="reader-type-label reader-muted">Line length</span>
      <MeasureControl value={measure} onChange={onMeasure} />
    </div>

    <div className="reader-type-block">
      <span className="reader-type-label reader-muted" id="reader-type-face">
        Typeface
      </span>
      <div
        className="reader-type-faces"
        role="radiogroup"
        aria-labelledby="reader-type-face"
        onKeyDown={(event) =>
          arrowTo(
            event,
            FACES.map((face) => face.id),
            typeface,
            onTypeface
          )
        }
      >
        {FACES.map((face) => {
          const on = typeface === face.id;
          return (
            <button
              key={face.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={face.hint}
              className={`reader-type-option reader-border ${on ? "is-on" : ""}`}
              onClick={() => onTypeface(face.id)}
            >
              <span className="reader-type-sample" style={{ fontFamily: TYPEFACE_STACK[face.id] ?? FALLBACK_FACE }} aria-hidden="true">
                {face.id === "book" ? "❦" : "Aa"}
              </span>
              <span>{face.name}</span>
            </button>
          );
        })}
      </div>
    </div>

    <div className="reader-type-row">
      <span className="reader-type-label reader-muted" id="reader-type-spacing">
        Line spacing
      </span>
      <div
        className="reader-measure"
        role="radiogroup"
        aria-labelledby="reader-type-spacing"
        onKeyDown={(event) =>
          arrowTo(
            event,
            SPACINGS.map((item) => item.id),
            spacing,
            onSpacing
          )
        }
      >
        {SPACINGS.map((item) => {
          const on = spacing === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${item.name} line spacing`}
              tabIndex={on ? 0 : -1}
              title={item.name}
              className={`reader-measure-option rounded-md border transition reader-border reader-icon reader-hover-accent ${on ? "is-on" : ""}`}
              onClick={() => onSpacing(item.id)}
            >
              <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
                {[0, 1, 2].map((line) => (
                  <rect key={line} x="2" y={8 - item.gap + line * item.gap - 0.8} width="14" height="1.6" rx="0.8" fill="currentColor" />
                ))}
              </svg>
            </button>
          );
        })}
      </div>
    </div>

    <div className="reader-type-row">
      <span className="reader-type-label reader-muted" id="reader-type-align">
        Alignment
      </span>
      <div
        className="reader-measure"
        role="radiogroup"
        aria-labelledby="reader-type-align"
        onKeyDown={(event) =>
          arrowTo(
            event,
            ALIGNS.map((item) => item.id),
            align,
            onAlign
          )
        }
      >
        {ALIGNS.map((item) => {
          const on = align === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={item.name}
              tabIndex={on ? 0 : -1}
              title={`${item.name}: ${item.hint.toLowerCase()}`}
              className={`reader-measure-option rounded-md border transition reader-border reader-icon reader-hover-accent ${on ? "is-on" : ""}`}
              onClick={() => onAlign(item.id)}
            >
              <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
                {item.lines.map((width, line) => (
                  <rect key={line} x="2" y={2 + line * 4 - 0.8} width={width} height="1.6" rx="0.8" fill="currentColor" />
                ))}
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);
