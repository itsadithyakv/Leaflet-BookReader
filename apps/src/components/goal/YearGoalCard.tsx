import { useMemo, useState } from "react";
import { useBooksRead } from "../../library/finishedBooks";
import { EYEBROW } from "../ui/SectionHeader";
import { UiIcon } from "../UiIcon";
import { MAX_YEAR_GOAL, cleanGoal, finishedInYear, goalStanding, setYearGoal, yearGoal } from "./yearGoal";

/**
 * This year's goal of books to finish, on Social, Stats: how many are done,
 * how that stands against the pace, and the goal itself to set or change in
 * place. With no goal it is one quiet line offering to set one.
 */
export const YearGoalCard = () => {
  const books = useBooksRead();
  const year = new Date().getFullYear();
  const [goal, setGoal] = useState(() => yearGoal(year));
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  const finished = useMemo(() => finishedInYear(books, year), [books, year]);

  const save = (value: number | null) => {
    setGoal(setYearGoal(year, value, new Date(), finished));
    setEditing(false);
  };

  const edit = () => {
    setTyped(goal === null ? "" : String(goal.goal));
    setEditing(true);
  };

  if (editing) {
    return (
      <form
        className="paper-surface flex flex-wrap items-center gap-3 rounded-xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          save(cleanGoal(typed));
        }}
      >
        <label className={EYEBROW} htmlFor="year-goal">
          Books in {year}
        </label>
        <input
          id="year-goal"
          autoFocus
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_YEAR_GOAL}
          className="inset-field w-24 px-3 py-2 text-sm text-on-surface"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <button type="submit" className="tactile-button tactile-button-primary px-4 py-2 text-xs font-semibold">
          Set
        </button>
        {goal !== null && (
          <button type="button" className="tactile-button px-4 py-2 text-xs font-semibold" onClick={() => save(null)}>
            No goal
          </button>
        )}
      </form>
    );
  }

  if (goal === null) {
    return (
      <button
        type="button"
        className="paper-surface flex items-center justify-between gap-4 rounded-xl p-5 text-left transition hover:text-primary"
        onClick={edit}
      >
        <span>
          <span className={EYEBROW}>{year} goal</span>
          <span className="mt-2 block text-xl font-semibold text-on-surface">Set a goal of books for the year</span>
        </span>
        <UiIcon name="goal" size={20} className="text-on-surface-variant" />
      </button>
    );
  }

  const standing = goalStanding(finished, goal, year, new Date());
  const target = goal.goal;
  return (
    <div className="paper-surface rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={EYEBROW}>{year} goal</p>
          <p className="mt-2 text-xl font-semibold text-on-surface">
            <span className="tabular-nums">{finished}</span> of <span className="tabular-nums">{target}</span> books
          </p>
        </div>
        <div className="flex items-center gap-3">
          {standing.words && <span className="text-sm text-on-surface-variant">{standing.words}</span>}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Change the goal"
            title="Change the goal"
            onClick={edit}
          >
            <UiIcon name="edit" size={16} />
          </button>
        </div>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-surface-container-highest"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(finished, target)}
        aria-label={`${finished} of ${target} books finished in ${year}`}
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${standing.share * 100}%` }} />
      </div>
    </div>
  );
};
