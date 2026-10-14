import { GAMES, type GameId } from "./games";
import { purseLeft } from "../../../pip/base/rules";
import { minutesRead, useBaseStore } from "../../../store/baseStore";
import { useHabitStore } from "../../../store/habitStore";

/**
 * Under a game while no run is on: how many paid runs the reader's reading
 * has earned for the camp.
 *
 * It used to offer a wager on beating one's own usual score. Wagers were
 * put away on 2026-10-15 (the only way to lose acorns by choice, and nothing
 * to do with reading); a wager placed before then is still shown, and still
 * settled by the next finished run of its game (`afterGame`), so no stake
 * is left hanging.
 */
export const WagerBar = ({ game }: { game: GameId }) => {
  const base = useBaseStore((state) => state.base);
  const minutes = useHabitStore((state) => minutesRead(state.snapshot));
  if (!base) {
    return null;
  }
  const runs = purseLeft(base, minutes);
  const pending = base.wager;
  const nameOf = (id: GameId) => GAMES.find((entry) => entry.id === id)?.name ?? id;

  return (
    <div className="pip-arcade-wager">
      <span title="Ten minutes of reading earns a run that pays the camp. Runs past that are for fun.">
        {runs === 0 ? "No paid runs in hand" : `${runs} paid ${runs === 1 ? "run" : "runs"} in hand`}
      </span>
      {pending && (
        <span className="font-semibold text-on-surface" title="A wager from before wagers were put away: the next run of its game settles it">
          {pending.game === game ? `${pending.stake} acorns on reaching ${pending.target}` : `A wager is waiting on ${nameOf(pending.game)}`}
        </span>
      )}
    </div>
  );
};
