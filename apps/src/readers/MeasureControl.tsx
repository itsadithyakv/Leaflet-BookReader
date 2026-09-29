import { MEASURE_EM, type ReaderMeasure } from "./readerTypes";

const OPTIONS: Array<{ id: ReaderMeasure; label: string; span: number }> = [
  { id: "narrow", label: "Narrow lines", span: 7 },
  { id: "medium", label: "Medium lines", span: 10 },
  { id: "wide", label: "Wide lines", span: 13 },
  { id: "full", label: "Full width", span: 16 }
];

/**
 * Line length, beside the type size: four little columns of text, narrow to
 * the whole window. Each is drawn as the column it gives.
 */
export const MeasureControl = ({ value, onChange }: { value: ReaderMeasure; onChange: (next: ReaderMeasure) => void }) => (
  <div className="reader-measure" role="radiogroup" aria-label="Line length">
    {OPTIONS.map((option) => {
      const on = value === option.id;
      const em = MEASURE_EM[option.id];
      return (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={on}
          aria-label={option.label}
          title={em === null ? option.label : `${option.label} (about ${Math.round(em / 0.47)} characters)`}
          className={`reader-measure-option rounded-md border transition reader-border reader-icon reader-hover-accent ${on ? "is-on" : ""}`}
          onClick={() => onChange(option.id)}
        >
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
            {[3, 7, 11].map((y, line) => (
              <rect
                key={y}
                x={(18 - option.span) / 2}
                y={y - 0.8}
                width={line === 2 ? option.span * 0.65 : option.span}
                height="1.6"
                rx="0.8"
                fill="currentColor"
              />
            ))}
          </svg>
        </button>
      );
    })}
  </div>
);
