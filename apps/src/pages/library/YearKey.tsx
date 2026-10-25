import { useEffect } from "react";
import { UiIcon } from "../../components/UiIcon";
import { openYearReview } from "../../components/share/shareStore";
import { PIP_TOLD_KEY, pipHasToTell, pipYearLine, readIn, yearInSeason } from "../../components/share/yearMoment";
import { usePageShown } from "../../hooks/pageShown";
import { useStartupSettled } from "../../platform/afterStartup";
import { useHabitStore } from "../../store/habitStore";
import { usePipStore } from "../../store/pipStore";
import "./yearKey.css";

/** How long after the Library is up Pip says it: once the page has settled, not over its first paint. */
const PIP_AFTER_MS = 1800;

const told = () => {
  try {
    return localStorage.getItem(PIP_TOLD_KEY);
  } catch {
    return null;
  }
};

/**
 * "Your 2026 in pages" in the Library's header, from 24 December to 7 January
 * (`yearMoment.ts`), for a reader with reading in that year: the only
 * standing way in while it is in season. Pip says so once a year, in her
 * bubble. Desktop: a key in the shelf's toolbar. A phone: an icon beside the
 * others. The story itself is its own chunk, loaded when it opens.
 */
export const YearKey = ({ compact = false }: { compact?: boolean }) => {
  const days = useHabitStore((state) => state.snapshot.days);
  const shown = usePageShown();
  const settled = useStartupSettled();
  const year = yearInSeason(new Date());
  const ready = year !== null && readIn(days, year);

  useEffect(() => {
    if (!ready || !shown || !settled || year === null || !pipHasToTell(year, told())) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(PIP_TOLD_KEY, String(year));
      } catch {
        // She may say it again another day, then.
      }
      usePipStore.getState().showPeek("cheer", pipYearLine(year), 2);
    }, PIP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [ready, shown, settled, year]);

  if (!ready || year === null) {
    return null;
  }
  const label = `Your ${year} in pages`;
  return compact ? (
    <button type="button" className="key-button year-key is-compact" onClick={() => openYearReview(year)} aria-label={label} title={label}>
      <UiIcon name="sparkle" size={18} />
    </button>
  ) : (
    <button type="button" className="year-key flex items-center gap-2 px-3 py-2 text-xs font-semibold" onClick={() => openYearReview(year)} title="Your year of reading, as a story to share">
      <UiIcon name="sparkle" size={16} />
      {label}
    </button>
  );
};
