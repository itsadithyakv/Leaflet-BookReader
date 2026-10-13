import { useState } from "react";
import { UiIcon } from "../../components/UiIcon";
import { getDateKey } from "../../services/habitService";
import { goalPrize, seedExtras, seedService } from "../../services/seedService";
import { useHabitStore } from "../../store/habitStore";
import { usePipWardrobeStore } from "../../store/pipWardrobeStore";

/** The stakes a reader picks from, where the rules and the balance allow them. */
const STAKES = [10, 25, 50, 100];

/** Monday is 1, Sunday 7: as Rust counts the days a stake may be placed on. */
const weekday = (date = new Date()) => ((date.getDay() + 6) % 7) + 1;

/**
 * What seeds do besides dressing Pip, in the Seeds drawer: the reader's
 * level, a streak freeze to buy, and a stake on the week's goal. Each is one
 * row; what it costs and why it is refused are on the button, not in a
 * paragraph. The rules are Rust's (services/seedService.ts).
 */
export const SeedUses = () => {
  const overview = usePipWardrobeStore((state) => state.overview);
  const loadHabit = useHabitStore((state) => state.load);
  const [busy, setBusy] = useState<"freeze" | "stake" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeds, setSeeds] = useState(25);
  const [days, setDays] = useState(5);
  const { level, freezes, goalStake, stakeRules } = seedExtras(overview);
  const balance = overview?.wallet.balance ?? 0;

  const act = (kind: "freeze" | "stake", work: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    work()
      // The freeze is the streak's: show it where the streak is shown.
      .then(() => (kind === "freeze" ? loadHabit() : undefined))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(null));
  };

  const share = level && level.next > level.floor ? Math.min(1, (level.earned - level.floor) / (level.next - level.floor)) : 0;

  const freezeWhyNot = !freezes
    ? null
    : freezes.held >= freezes.cap
      ? `You hold ${freezes.held}, the most there is room for`
      : freezes.boughtThisMonth >= freezes.perMonth
        ? `${freezes.perMonth} a month, and this month's are bought`
        : balance < freezes.price
          ? `${freezes.price - balance} more seeds needed`
          : null;

  const stakes = stakeRules ? STAKES.filter((amount) => amount >= stakeRules.minSeeds && amount <= stakeRules.maxSeeds) : [];
  const dayChoices = stakeRules ? Array.from({ length: stakeRules.maxDays - stakeRules.minDays + 1 }, (_, at) => stakeRules.minDays + at) : [];
  const tooLate = stakeRules ? weekday() > stakeRules.lastWeekday : false;
  const stakeWhyNot = !stakeRules ? null : tooLate ? "Placed Monday to Wednesday: next week's opens on Monday" : balance < seeds ? `${seeds - balance} more seeds needed` : null;
  // This week's stake while it runs; last week's result until a new one is placed.
  const current = goalStake ?? null;
  const placing = current === null || current.state !== "open";

  if (!level && !freezes?.price && !stakeRules) {
    return null;
  }

  return (
    <div className="section-rule mt-4 flex flex-col gap-4 pt-3">
      {level && (
        <div title={`${level.earned.toLocaleString("en")} seeds earned in all, spent or not; level ${level.level + 1} at ${level.next.toLocaleString("en")}`}>
          <p className="flex items-baseline justify-between gap-3 text-sm font-semibold text-on-surface">
            Level {level.level}
            <span className="text-[11px] font-normal tabular-nums text-on-surface-variant">{(level.next - level.earned).toLocaleString("en")} to go</span>
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        </div>
      )}

      {freezes && freezes.price > 0 && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">Streak freeze</p>
            <p className="text-[11px] tabular-nums text-on-surface-variant">
              {freezes.held} of {freezes.cap} held
            </p>
          </div>
          <button
            type="button"
            className="pip-key disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy !== null || freezeWhyNot !== null}
            title={freezeWhyNot ?? "A freeze covers one missed day, so the streak carries on"}
            onClick={() => act("freeze", () => seedService.buyFreeze(getDateKey()))}
          >
            <UiIcon name="seed" size={14} />
            {busy === "freeze" ? "…" : freezes.price}
          </button>
        </div>
      )}

      {stakeRules && (
        <div>
          <p className="text-sm font-semibold text-on-surface" title={`A day counts with ${stakeRules.dayMinutes} minutes read and your goal met`}>
            This week's bet
          </p>
          {current && (
            <p className="mt-1 text-xs tabular-nums text-on-surface-variant">
              {current.seeds} seeds on {current.days} days ·{" "}
              {current.state === "open" ? (
                <>
                  {current.met} of {current.days} so far · pays {current.payout}
                </>
              ) : current.state === "won" ? (
                <span className="font-semibold text-tertiary">won {current.payout}</span>
              ) : (
                <span>lost</span>
              )}
            </p>
          )}
          {placing && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="inset-field px-2 py-1.5 text-xs text-on-surface" aria-label="Seeds to stake" value={seeds} onChange={(event) => setSeeds(Number(event.target.value))}>
                {stakes.map((amount) => (
                  <option key={amount} value={amount}>
                    {amount} seeds
                  </option>
                ))}
              </select>
              <select className="inset-field px-2 py-1.5 text-xs text-on-surface" aria-label="Days of the week to meet the goal on" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                {dayChoices.map((count) => (
                  <option key={count} value={count}>
                    on {count} days
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pip-key disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy !== null || stakeWhyNot !== null}
                title={stakeWhyNot ?? "Meet your goal on that many days this week and it comes back with more; miss, and it is gone"}
                onClick={() => act("stake", () => seedService.stakeGoal(seeds, days, getDateKey()))}
              >
                {busy === "stake" ? "…" : `Bet · pays ${goalPrize(seeds, days, stakeRules)}`}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-surface">{error}</p>}
    </div>
  );
};
