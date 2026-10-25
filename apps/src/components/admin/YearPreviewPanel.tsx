import { useMemo, useState } from "react";
import { openYearReview } from "../share/shareStore";
import { yearsRead } from "../share/yearReview";
import { useHabitStore } from "../../store/habitStore";

/** The years the preview offers: this one (so far), every year with reading, latest first. */
export const previewYears = (days: ReadonlyArray<{ dateKey: string; minutes: number }>, today: Date) => {
  const thisYear = today.getFullYear();
  return [thisYear, ...yearsRead([...days]).filter((year) => year !== thisYear)].sort((a, b) => b - a);
};

/**
 * "Your Year in Pages" whenever the owner likes, not only from 24 December:
 * this year so far, any year with reading, or any year at all (an empty one
 * shows its single kind card). It is the reader's own story on this device,
 * the same as the Library's key opens.
 */
export const YearPreviewPanel = () => {
  const days = useHabitStore((state) => state.snapshot.days);
  const today = useMemo(() => new Date(), []);
  const years = useMemo(() => previewYears(days, today), [days, today]);
  const [other, setOther] = useState("");
  const chosen = Number(other);
  const valid = Number.isInteger(chosen) && chosen >= 2000 && chosen <= today.getFullYear();

  return (
    <section className="paper-surface max-w-xl rounded-xl p-4 sm:p-6" aria-labelledby="year-preview-title">
      <h2 id="year-preview-title" className="text-lg font-semibold">
        Your Year in Pages
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {years.map((year) => (
          <button key={year} type="button" className="tactile-button px-3 py-2 text-sm font-semibold tabular-nums" onClick={() => openYearReview(year)}>
            {year === today.getFullYear() ? `${year} so far` : year}
          </button>
        ))}
      </div>
      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) openYearReview(chosen);
        }}
      >
        <input
          className="w-28 rounded-lg border border-outline-variant/60 bg-surface-container px-3 py-2 text-sm tabular-nums"
          inputMode="numeric"
          aria-label="Any year"
          placeholder="Year"
          value={other}
          onChange={(event) => setOther(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
        />
        <button type="submit" className="tactile-button px-3 py-2 text-sm font-semibold" disabled={!valid}>
          Open
        </button>
      </form>
    </section>
  );
};
