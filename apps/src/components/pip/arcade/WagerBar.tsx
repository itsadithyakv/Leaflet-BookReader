import { Nut } from "lucide-react";
import { GAMES, type GameId } from "./games";
import { STAKES, purseLeft, runsToUsual, wagerBlocked, wagerTarget } from "../../../pip/base/rules";
import { getDateKey } from "../../../services/habitService";
import { minutesRead, useBaseStore } from "../../../store/baseStore";
import { useHabitStore } from "../../../store/habitStore";

/**
 * Under a game while no run is on: how many paid runs the reader's reading
 * has earned, and a wager on beating their own usual score. The stake is
 * taken when it is placed and settled by the next finished run, so a bad run
 * cannot be walked away from.
 */
export const WagerBar = ({ game }: { game: GameId }) => {
  const base = useBaseStore((state) => state.base);
  const minutes = useHabitStore((state) => minutesRead(state.snapshot));
  if (!base) {
    return null;
  }
  const day = getDateKey();
  const runs = purseLeft(base, minutes);
  const target = wagerTarget(base, game);
  const pending = base.wager;
  const nameOf = (id: GameId) => GAMES.find((entry) => entry.id === id)?.name ?? id;

  return (
    <div className="pip-arcade-wager">
      <span title="Ten minutes of reading earns a run that pays the camp. Runs past that are for fun.">
        {runs === 0 ? "No paid runs in hand" : `${runs} paid ${runs === 1 ? "run" : "runs"} in hand`}
      </span>
      {pending ? (
        <span className="font-semibold text-on-surface">
          {pending.game === game ? `${pending.stake} acorns on reaching ${pending.target}` : `A wager is waiting on ${nameOf(pending.game)}`}
        </span>
      ) : target === null ? (
        <span title="A wager is on beating your own usual score, so a few runs come first">Wagers after {runsToUsual(base, game)} more</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5" title="Reach it and the stake comes back doubled. Fall short and it is lost.">
          Wager on reaching {target}:
          {STAKES.map((stake) => (
            <button
              key={stake}
              type="button"
              className="tactile-button px-2 py-0.5 text-xs disabled:opacity-50"
              disabled={wagerBlocked(base, game, stake, day) !== null}
              onClick={() => useBaseStore.getState().placeWager(game, stake)}
            >
              <span className="pip-base-acorns">
                <Nut size={11} aria-hidden />
                {stake}
              </span>
            </button>
          ))}
        </span>
      )}
    </div>
  );
};
