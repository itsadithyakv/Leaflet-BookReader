import { useEffect, useMemo, useState } from "react";
import { friendsService } from "../../services/friendsService";
import { pipService } from "../../services/pipService";
import { getDateKey } from "../../services/habitService";
import { useHabitStore } from "../../store/habitStore";
import { EYEBROW } from "../ui/SectionHeader";
import { BadgeWall, type BadgeStatus } from "./BadgeMedal";
import { badgeInfo } from "./badges";
import "./friends.css";

/** How many badges not yet earned show before "Show all": the ones nearest to done. */
const NEAREST = 6;

type Level = { level: number; earned: number; floor: number; next: number };

/**
 * The reader's badges and level: what their reading has earned, and what is
 * nearest. Worked out by Rust from the ledger, the shelf and the shop
 * (`pip_badges`); a shared profile shows the earned ones to other readers.
 * Nothing here is drawn until there is something to show.
 */
export const BadgesCard = () => {
  const [statuses, setStatuses] = useState<BadgeStatus[]>([]);
  const [level, setLevel] = useState<Level | null>(null);
  const [all, setAll] = useState(false);
  // Read again as the day's reading grows (a badge may have been reached), not on every minute.
  const reading = useHabitStore((state) => Math.floor(state.snapshot.todayMinutes / 5));
  const sessions = useHabitStore((state) => state.snapshot.sessions.length);

  useEffect(() => {
    let live = true;
    friendsService
      .badges(getDateKey())
      .then((found) => live && setStatuses(found))
      .catch(() => undefined);
    pipService
      .overview()
      .then((overview) => live && setLevel((overview as { level?: Level }).level ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [reading, sessions]);

  const known = useMemo(() => statuses.filter((status) => badgeInfo(status.id) !== null), [statuses]);
  const earned = known.filter((status) => status.earned);
  const ahead = useMemo(
    () =>
      known
        .filter((status) => !status.earned && status.target > 0)
        .sort((a, b) => b.value / b.target - a.value / a.target),
    [known]
  );
  // This month's challenge: the first of its two not yet reached, or the second once both are.
  const month = getDateKey().slice(0, 7);
  const monthly = known.filter((status) => status.id.startsWith(`month-${month}-`));
  const challenge = monthly.find((status) => !status.earned) ?? monthly[monthly.length - 1] ?? null;
  if (known.length === 0) {
    return null;
  }
  const shown = all ? [...earned, ...ahead] : [...earned, ...ahead.slice(0, NEAREST)];
  const share = level && level.next > level.floor ? Math.min(1, (level.earned - level.floor) / (level.next - level.floor)) : 0;

  return (
    <section className="paper-surface rounded-xl p-5" aria-labelledby="badges-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={EYEBROW}>Earned by reading</p>
          <h2 id="badges-title" className="page-title mt-2 text-2xl">
            Badges <span className="text-base font-semibold tabular-nums text-on-surface-variant">{earned.length}</span>
          </h2>
        </div>
        {level && (
          <div className="min-w-[9rem]" title={`${level.earned.toLocaleString("en")} seeds earned in all; level ${level.level + 1} at ${level.next.toLocaleString("en")}`}>
            <p className="flex items-baseline justify-between gap-3 text-sm font-semibold text-on-surface">
              Level {level.level}
              <span className="text-[11px] font-normal tabular-nums text-on-surface-variant">
                {(level.next - level.earned).toLocaleString("en")} seeds to {level.level + 1}
              </span>
            </p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
              <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      {challenge && (
        <div className="mt-4" title="A badge for each calendar month with 500 minutes read, and another at 1,000">
          <p className="flex items-baseline justify-between gap-3 text-sm text-on-surface">
            <span className="font-semibold">This month</span>
            <span className="text-xs tabular-nums text-on-surface-variant">
              {Math.floor(challenge.value).toLocaleString("en")} of {challenge.target.toLocaleString("en")} minutes
              {challenge.earned ? " · done" : ""}
            </span>
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
            <div className="h-full rounded-full bg-tertiary/80" style={{ width: `${Math.round(Math.min(1, challenge.value / Math.max(1, challenge.target)) * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="mt-5">
        <BadgeWall statuses={shown} />
      </div>
      {ahead.length > NEAREST && (
        <button type="button" className="mt-4 text-xs font-semibold text-primary hover:underline" onClick={() => setAll((value) => !value)}>
          {all ? "Show fewer" : `Show all ${known.length}`}
        </button>
      )}
    </section>
  );
};
