import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { pickBeat } from "../../pip/moments";
import { LIB } from "../../pip";
import { treats } from "../../pip/shop";
import { ownedPremiumMoves, ownsItem } from "../../store/pipWardrobeStore";
import type { PipReaction } from "../../store/pipStore";
import type { PipOverview } from "../../services/pipService";
import type { Repertoire, SceneAct } from "../../components/pip/HouseScene";

/** How long a line stays up after Pip says it. */
const LINE_MS = 4200;

export type Act = SceneAct & { reactionId?: number };

type PipActsOptions = {
  reaction: PipReaction | null;
  suspended: boolean;
  finishReaction: (id: number) => void;
  overview: PipOverview | null;
  signature: string;
  /** Effects timed to Pip's current act (crumbs at each bite): a new act cancels them. */
  actTimers: MutableRefObject<Set<number>>;
  setHeldMood: Dispatch<SetStateAction<number | null>>;
};

/**
 * Pip's lines and moves in the house: what Pip is doing and saying, the
 * celebrations queued for the roaming Pip (played here while the tab is
 * open), a poke, and what she has to fill her own time with.
 */
export const usePipActs = ({ reaction, suspended, finishReaction, overview, signature, actTimers, setHeldMood }: PipActsOptions) => {
  const [act, setAct] = useState<Act | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const actKey = useRef(1);

  useEffect(() => {
    if (!line) return;
    const timer = window.setTimeout(() => setLine(null), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [line]);

  const actRef = useRef<Act | null>(null);
  actRef.current = act;
  const play = useCallback(
    (move: string, loops = 2, text: string | null = null, reactionId?: number) => {
      // A celebration cut short (by a poke, a treat) still counts as done, or
      // the queue behind it would wait until the tab closes.
      const previous = actRef.current;
      if (previous?.reactionId !== undefined && previous.reactionId !== reactionId) {
        finishReaction(previous.reactionId);
      }
      // Crumbs from a snack Pip is no longer eating would fall from nowhere,
      // and hearts that will not fly now should not keep the meter waiting.
      if (actTimers.current.size > 0) {
        actTimers.current.forEach((timer) => window.clearTimeout(timer));
        actTimers.current.clear();
        setHeldMood(null);
      }
      setAct({ move, loops, key: actKey.current++, reactionId });
      if (text) setLine(text);
    },
    [finishReaction]
  );
  /** Runs `run` in `ms`, unless Pip starts something else first. */
  const duringAct = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      actTimers.current.delete(timer);
      run();
    }, ms);
    actTimers.current.add(timer);
  };

  // Leaving the tab mid-celebration finishes it here rather than replaying it
  // when the roaming Pip comes back out.
  useEffect(
    () => () => {
      const reactionId = actRef.current?.reactionId;
      if (reactionId !== undefined) finishReaction(reactionId);
    },
    [finishReaction]
  );

  // Celebrations (goal met, a streak milestone...) play in the house while the
  // tab is open, since the roaming Pip is not out to do them.
  useEffect(() => {
    if (!reaction || suspended || act?.reactionId === reaction.id) return;
    play(reaction.move, reaction.loops, reaction.line, reaction.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaction, suspended]);

  const onActDone = () => {
    if (act?.reactionId !== undefined) finishReaction(act.reactionId);
    setAct(null);
  };

  // What Pip has to keep herself busy with (pip/behaviour.ts chooses among
  // it): her signature move, her hobbies (the free ones plus the moves the
  // reader bought, the dances among them apart), and the toys she owns.
  const repertoire: Repertoire = useMemo(() => {
    const bought = ownedPremiumMoves(overview);
    const dances = bought.filter((id) => LIB.find((move) => move.id === id)?.cat === "Dance");
    return {
      signature,
      hobbies: ["jog", "rope", "tree", ...bought.filter((id) => !dances.includes(id))],
      dances,
      toys: treats()
        .filter((treat) => treat.kind === "toy" && ownsItem(overview, "treat", treat.id))
        .map((treat) => treat.move)
    };
  }, [overview, signature]);

  const poke = useCallback(() => {
    const beat = pickBeat("poke", `${Date.now()}`);
    play(beat.move, 1, beat.line);
  }, [play]);

  return { act, line, play, duringAct, onActDone, repertoire, poke };
};
